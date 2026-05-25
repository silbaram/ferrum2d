use std::cmp::Ordering;
use std::collections::BinaryHeap;

use crate::camera::Camera2D;
use crate::collision::{AabbBounds, AabbContact, CollisionSystem, SweptAabbContactHit};
use crate::components::{AabbCollider, CollisionLayer, SpriteFrame, Transform2D, Velocity};
use crate::physics::{PhysicsCounters, SlopeConfig, SlopeSegment, SlopeSurfaceHit};
use crate::render_command::SpriteRenderCommand;
use crate::world::World;

const MAX_NAVIGATION_CELLS: usize = 4096;
const MAX_TILE_COLLISION_RESOLUTION_STEPS: usize = 4;
pub const MAX_TILEMAP_CONTACT_MANIFOLD_POINTS: usize = 2;
const TILE_SWEEP_EPSILON: f32 = 0.0001;
const TILE_GROUND_NORMAL_Y_MIN: f32 = 0.5;
const UNVISITED_CELL: usize = usize::MAX;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TileDefinition {
    pub texture_id: u32,
    pub frame: SpriteFrame,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TilemapLayer {
    pub columns: u32,
    pub rows: u32,
    pub tile_width: f32,
    pub tile_height: f32,
    pub origin_x: f32,
    pub origin_y: f32,
    pub collision: bool,
    pub tiles: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tilemap {
    definitions: Vec<Option<TileDefinition>>,
    slope_definitions: Vec<Option<TileSlopeDefinition>>,
    one_way_platform_definitions: Vec<bool>,
    layers: Vec<Option<TilemapLayer>>,
    collision_rects: Vec<Option<Vec<TileCollisionRect>>>,
}

#[derive(Debug, Default)]
pub(crate) struct TilemapNavigationScratch {
    came_from: Vec<usize>,
    g_scores: Vec<u32>,
    visited: Vec<usize>,
    open: BinaryHeap<PathNode>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TileRange {
    min_column: u32,
    max_column: u32,
    min_row: u32,
    max_row: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TileCollisionRect {
    tile_index: usize,
    min_column: u32,
    min_row: u32,
    columns: u32,
    rows: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TileRun {
    min_column: u32,
    columns: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TilemapSweepStats {
    pub candidate_tiles: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct TilemapResolveStats {
    candidate_tiles: u32,
    hit_tiles: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TilemapSweepHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub contact: SweptAabbContactHit,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapNearestObstacleHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapShapeCastHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapContactHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_x: f32,
    pub point_y: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TilemapContactPoint {
    pub point_x: f32,
    pub point_y: f32,
    pub penetration: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapContactManifoldHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub point_count: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub points: [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TileSlopeDefinition {
    pub local_x0: f32,
    pub local_y0: f32,
    pub local_x1: f32,
    pub local_y1: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TilemapSlopeGroundHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub surface: SlopeSurfaceHit,
    pub vertical_delta: f32,
    pub distance: f32,
}

impl TileSlopeDefinition {
    pub const fn new(local_x0: f32, local_y0: f32, local_x1: f32, local_y1: f32) -> Self {
        Self {
            local_x0,
            local_y0,
            local_x1,
            local_y1,
        }
    }

    fn world_segment(self, layer: &TilemapLayer, column: u32, row: u32) -> SlopeSegment {
        let tile_x = layer.origin_x + column as f32 * layer.tile_width;
        let tile_y = layer.origin_y + row as f32 * layer.tile_height;
        SlopeSegment::new(
            tile_x + self.local_x0 * layer.tile_width,
            tile_y + self.local_y0 * layer.tile_height,
            tile_x + self.local_x1 * layer.tile_width,
            tile_y + self.local_y1 * layer.tile_height,
        )
    }
}

impl TilemapNavigationScratch {
    fn prepare(&mut self, cell_count: usize) {
        self.clear_dirty();
        if self.came_from.len() < cell_count {
            self.came_from.resize(cell_count, UNVISITED_CELL);
        }
        if self.g_scores.len() < cell_count {
            self.g_scores.resize(cell_count, u32::MAX);
        }
    }

    fn set_score(&mut self, cell: usize, previous: usize, g_score: u32) {
        if self.g_scores[cell] == u32::MAX {
            self.visited.push(cell);
        }
        self.came_from[cell] = previous;
        self.g_scores[cell] = g_score;
    }

    fn clear_dirty(&mut self) {
        for cell in self.visited.drain(..) {
            if cell < self.came_from.len() {
                self.came_from[cell] = UNVISITED_CELL;
            }
            if cell < self.g_scores.len() {
                self.g_scores[cell] = u32::MAX;
            }
        }
        self.open.clear();
    }
}

impl Tilemap {
    pub fn clear(&mut self) {
        self.definitions.clear();
        self.slope_definitions.clear();
        self.one_way_platform_definitions.clear();
        self.layers.clear();
        self.collision_rects.clear();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_tile_definition(
        &mut self,
        tile_id: u32,
        texture_id: u32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
    ) {
        if tile_id == 0 {
            return;
        }
        let Some(frame) = SpriteFrame::from_values(u0, v0, u1, v1) else {
            return;
        };

        let index = tile_id as usize;
        if index >= self.definitions.len() {
            self.definitions.resize(index + 1, None);
        }
        self.definitions[index] = Some(TileDefinition {
            texture_id,
            frame,
            r: normalized_or_default(r, 1.0),
            g: normalized_or_default(g, 1.0),
            b: normalized_or_default(b, 1.0),
            a: normalized_or_default(a, 1.0),
        });
    }

    pub fn set_tile_slope_definition(
        &mut self,
        tile_id: u32,
        local_x0: f32,
        local_y0: f32,
        local_x1: f32,
        local_y1: f32,
    ) {
        if tile_id == 0 {
            return;
        }
        let Some(slope) = tile_slope_definition_from_values(local_x0, local_y0, local_x1, local_y1)
        else {
            return;
        };

        let index = tile_id as usize;
        if index >= self.slope_definitions.len() {
            self.slope_definitions.resize(index + 1, None);
        }
        self.slope_definitions[index] = Some(slope);
        self.rebuild_collision_rects();
    }

    pub fn clear_tile_slope_definition(&mut self, tile_id: u32) {
        let index = tile_id as usize;
        if index == 0 || index >= self.slope_definitions.len() {
            return;
        }
        self.slope_definitions[index] = None;
        self.rebuild_collision_rects();
    }

    pub fn set_tile_one_way_platform(&mut self, tile_id: u32) {
        if tile_id == 0 {
            return;
        }

        let index = tile_id as usize;
        if index >= self.one_way_platform_definitions.len() {
            self.one_way_platform_definitions.resize(index + 1, false);
        }
        self.one_way_platform_definitions[index] = true;
        self.rebuild_collision_rects();
    }

    pub fn clear_tile_one_way_platform(&mut self, tile_id: u32) {
        let index = tile_id as usize;
        if index == 0 || index >= self.one_way_platform_definitions.len() {
            return;
        }
        self.one_way_platform_definitions[index] = false;
        self.rebuild_collision_rects();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_layer(
        &mut self,
        index: u32,
        columns: u32,
        rows: u32,
        tile_width: f32,
        tile_height: f32,
        origin_x: f32,
        origin_y: f32,
        collision: bool,
        tiles: Vec<u32>,
    ) {
        let Some(layer) = TilemapLayer::from_values(
            columns,
            rows,
            tile_width,
            tile_height,
            origin_x,
            origin_y,
            collision,
            tiles,
        ) else {
            return;
        };

        let index = index as usize;
        if index >= self.layers.len() {
            self.layers.resize_with(index + 1, || None);
        }
        if index >= self.collision_rects.len() {
            self.collision_rects.resize_with(index + 1, || None);
        }
        self.layers[index] = Some(layer);
        self.rebuild_collision_rects_for_layer(index);
    }

    pub fn set_tile(&mut self, layer_index: u32, column: u32, row: u32, tile_id: u32) -> bool {
        let layer_index = layer_index as usize;
        let should_rebuild_collision = {
            let Some(Some(layer)) = self.layers.get_mut(layer_index) else {
                return false;
            };
            if column >= layer.columns || row >= layer.rows {
                return false;
            }
            let tile_index = layer.tile_index(column, row);
            let Some(tile) = layer.tiles.get_mut(tile_index) else {
                return false;
            };
            if *tile == tile_id {
                return false;
            }
            *tile = tile_id;
            layer.collision
        };

        if should_rebuild_collision {
            self.rebuild_collision_rects_for_layer(layer_index);
        }
        true
    }

    pub fn set_tiles_rect(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
        tile_id: u32,
    ) -> bool {
        if width == 0 || height == 0 {
            return false;
        }
        let layer_index = layer_index as usize;
        let (changed, should_rebuild_collision) = {
            let Some(Some(layer)) = self.layers.get_mut(layer_index) else {
                return false;
            };
            let Some(end_column) = column.checked_add(width) else {
                return false;
            };
            let Some(end_row) = row.checked_add(height) else {
                return false;
            };
            if end_column > layer.columns || end_row > layer.rows {
                return false;
            }

            let mut changed = false;
            for tile_row in row..end_row {
                for tile_column in column..end_column {
                    let tile_index = layer.tile_index(tile_column, tile_row);
                    let Some(tile) = layer.tiles.get_mut(tile_index) else {
                        return false;
                    };
                    if *tile != tile_id {
                        *tile = tile_id;
                        changed = true;
                    }
                }
            }
            (changed, changed && layer.collision)
        };

        if should_rebuild_collision {
            self.rebuild_collision_rects_for_layer(layer_index);
        }
        changed
    }

    pub fn resolve_dynamic_collisions(&self, world: &mut World) {
        self.resolve_dynamic_collisions_internal(world, None);
    }

    pub(crate) fn resolve_dynamic_collisions_with_counters(
        &self,
        world: &mut World,
        counters: &mut PhysicsCounters,
    ) {
        self.resolve_dynamic_collisions_internal(world, Some(counters));
    }

    fn resolve_dynamic_collisions_internal(
        &self,
        world: &mut World,
        mut counters: Option<&mut PhysicsCounters>,
    ) {
        for entity_index in 0..world.transforms.len() {
            if !world.alive[entity_index] {
                continue;
            }
            let Some(collider) = world.colliders[entity_index] else {
                continue;
            };
            if !collider.enabled || !is_tilemap_blocked_layer(collider.layer) {
                continue;
            }
            let Some(mut transform) = world.transforms[entity_index] else {
                continue;
            };
            if let Some(counters) = counters.as_deref_mut() {
                counters.kinematic_moves = counters.kinematic_moves.saturating_add(1);
            }
            let stats = self.resolve_transform_against_solid_tiles(&mut transform, collider);
            if let Some(counters) = counters.as_deref_mut() {
                counters.tile_candidate_checks = counters
                    .tile_candidate_checks
                    .saturating_add(stats.candidate_tiles);
                counters.kinematic_hits = counters.kinematic_hits.saturating_add(stats.hit_tiles);
                counters.kinematic_tile_hits =
                    counters.kinematic_tile_hits.saturating_add(stats.hit_tiles);
            }
            world.transforms[entity_index] = Some(transform);
        }
    }

    pub(crate) fn swept_aabb_contact(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        displacement: Velocity,
        stats: &mut TilemapSweepStats,
    ) -> Option<TilemapSweepHit> {
        let end = Transform2D {
            x: start.x + displacement.vx,
            y: start.y + displacement.vy,
        };
        let swept_bounds = AabbBounds::swept(start, end, collider);
        let mut best: Option<TilemapSweepHit> = None;

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(swept_bounds) else {
                continue;
            };

            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for rect in rects
                .iter()
                .copied()
                .filter(|rect| rect.intersects_tile_range(range))
            {
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(swept_bounds) {
                    continue;
                }
                stats.candidate_tiles = stats.candidate_tiles.saturating_add(1);
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::swept_aabb_contact(
                    start,
                    displacement,
                    collider,
                    rect_center,
                    Velocity::default(),
                    static_collider,
                    1.0,
                ) else {
                    continue;
                };
                if contact.time <= TILE_SWEEP_EPSILON
                    && CollisionSystem::aabb_contact(start, collider, rect_center, static_collider)
                        .is_none()
                {
                    continue;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    continue;
                }

                if best_tile_hit_is_better(&best, contact, layer_index, rect.tile_index) {
                    best = Some(TilemapSweepHit {
                        layer_index,
                        tile_index: rect.tile_index,
                        contact,
                    });
                }
            }

            self.update_one_way_tile_swept_hit_for_range(
                layer_index,
                layer,
                range,
                swept_bounds,
                start,
                collider,
                displacement,
                Some(&mut *stats),
                &mut best,
            );
        }

        best
    }

    pub fn shape_cast_aabb_obstacles(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        direction: Velocity,
        max_distance: f32,
    ) -> Vec<TilemapShapeCastHit> {
        let mut hits = Vec::new();
        self.shape_cast_aabb_obstacles_into(start, collider, direction, max_distance, &mut hits);
        hits
    }

    pub fn shape_cast_aabb_obstacles_into(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        direction: Velocity,
        max_distance: f32,
        hits: &mut Vec<TilemapShapeCastHit>,
    ) {
        hits.clear();
        if !tile_shape_cast_query_is_valid(start, collider, max_distance) {
            return;
        }
        let Some((unit_x, unit_y)) = tile_shape_cast_unit_direction(direction) else {
            return;
        };

        let displacement = Velocity {
            vx: unit_x * max_distance,
            vy: unit_y * max_distance,
        };
        let end = Transform2D {
            x: start.x + displacement.vx,
            y: start.y + displacement.vy,
        };
        let swept_bounds = AabbBounds::swept(start, end, collider);

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(swept_bounds) else {
                continue;
            };

            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for rect in rects
                .iter()
                .copied()
                .filter(|rect| rect.intersects_tile_range(range))
            {
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(swept_bounds) {
                    continue;
                }
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::swept_aabb_contact(
                    start,
                    displacement,
                    collider,
                    rect_center,
                    Velocity::default(),
                    static_collider,
                    1.0,
                ) else {
                    continue;
                };
                if contact.time <= TILE_SWEEP_EPSILON
                    && CollisionSystem::aabb_contact(start, collider, rect_center, static_collider)
                        .is_none()
                {
                    continue;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    continue;
                }

                hits.push(tilemap_shape_cast_hit_from_contact(
                    start,
                    collider,
                    unit_x,
                    unit_y,
                    max_distance,
                    layer_index,
                    rect.tile_index,
                    contact,
                ));
            }

            self.append_one_way_tile_shape_cast_hits_for_range(
                layer_index,
                layer,
                range,
                swept_bounds,
                start,
                collider,
                displacement,
                unit_x,
                unit_y,
                max_distance,
                hits,
            );
        }

        hits.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then_with(|| a.layer_index.cmp(&b.layer_index))
                .then_with(|| a.tile_index.cmp(&b.tile_index))
        });
    }

    pub fn raycast_obstacles(
        &self,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
    ) -> Vec<TilemapShapeCastHit> {
        let mut hits = Vec::new();
        self.raycast_obstacles_into(origin, direction, max_distance, &mut hits);
        hits
    }

    pub fn raycast_obstacles_into(
        &self,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        hits: &mut Vec<TilemapShapeCastHit>,
    ) {
        hits.clear();
        if !tile_raycast_query_is_valid(origin, max_distance) {
            return;
        }
        let Some((unit_x, unit_y)) = tile_shape_cast_unit_direction(direction) else {
            return;
        };
        let Some(ray_bounds) = tile_raycast_bounds(origin, unit_x, unit_y, max_distance) else {
            return;
        };

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(ray_bounds) else {
                continue;
            };

            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for rect in rects
                .iter()
                .copied()
                .filter(|rect| rect.intersects_tile_range(range))
            {
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(ray_bounds) {
                    continue;
                }
                let Some(hit) =
                    tilemap_raycast_bounds(origin, unit_x, unit_y, max_distance, rect_bounds)
                else {
                    continue;
                };
                hits.push(TilemapShapeCastHit {
                    layer_index,
                    tile_index: rect.tile_index,
                    distance: hit.distance,
                    point_x: origin.x + unit_x * hit.distance,
                    point_y: origin.y + unit_y * hit.distance,
                    normal_x: hit.normal_x,
                    normal_y: hit.normal_y,
                });
            }
        }

        sort_tile_linear_hits(hits);
    }

    pub fn segment_cast_obstacles(
        &self,
        start: Transform2D,
        end: Transform2D,
    ) -> Vec<TilemapShapeCastHit> {
        let mut hits = Vec::new();
        self.segment_cast_obstacles_into(start, end, &mut hits);
        hits
    }

    pub fn segment_cast_obstacles_into(
        &self,
        start: Transform2D,
        end: Transform2D,
        hits: &mut Vec<TilemapShapeCastHit>,
    ) {
        hits.clear();
        let Some((direction, max_distance)) = tile_segment_direction_and_distance(start, end)
        else {
            return;
        };
        self.raycast_obstacles_into(start, direction, max_distance, hits);
    }

    pub fn aabb_obstacle_contacts(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
    ) -> Vec<TilemapContactHit> {
        let mut hits = Vec::new();
        self.aabb_obstacle_contacts_into(transform, collider, &mut hits);
        hits
    }

    pub fn aabb_obstacle_contacts_into(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
        hits: &mut Vec<TilemapContactHit>,
    ) {
        hits.clear();
        if !tile_aabb_query_is_valid(transform, collider) {
            return;
        }
        let bounds = AabbBounds::from_transform(transform, collider);

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(bounds) else {
                continue;
            };

            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for rect in rects
                .iter()
                .copied()
                .filter(|rect| rect.intersects_tile_range(range))
            {
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(bounds) {
                    continue;
                }
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::aabb_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                ) else {
                    continue;
                };
                hits.push(tilemap_contact_hit_from_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                    layer_index,
                    rect.tile_index,
                    contact,
                ));
            }
        }

        hits.sort_by(|a, b| {
            a.layer_index
                .cmp(&b.layer_index)
                .then_with(|| a.tile_index.cmp(&b.tile_index))
        });
    }

    pub fn aabb_obstacle_manifolds(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
    ) -> Vec<TilemapContactManifoldHit> {
        let mut hits = Vec::new();
        self.aabb_obstacle_manifolds_into(transform, collider, &mut hits);
        hits
    }

    pub fn aabb_obstacle_manifolds_into(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
        hits: &mut Vec<TilemapContactManifoldHit>,
    ) {
        hits.clear();
        if !tile_aabb_query_is_valid(transform, collider) {
            return;
        }
        let bounds = AabbBounds::from_transform(transform, collider);

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(bounds) else {
                continue;
            };

            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for rect in rects
                .iter()
                .copied()
                .filter(|rect| rect.intersects_tile_range(range))
            {
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(bounds) {
                    continue;
                }
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::aabb_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                ) else {
                    continue;
                };
                let Some(manifold) = tilemap_contact_manifold_hit_from_contact(
                    transform,
                    collider,
                    rect_center,
                    static_collider,
                    layer_index,
                    rect.tile_index,
                    contact,
                ) else {
                    continue;
                };
                hits.push(manifold);
            }
        }

        hits.sort_by(|a, b| {
            a.layer_index
                .cmp(&b.layer_index)
                .then_with(|| a.tile_index.cmp(&b.tile_index))
        });
    }

    pub(crate) fn ground_probe_contact(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        probe_distance: f32,
    ) -> Option<TilemapSweepHit> {
        if !is_tilemap_blocked_layer(collider.layer)
            || !probe_distance.is_finite()
            || probe_distance <= 0.0
        {
            return None;
        }

        let displacement = Velocity {
            vx: 0.0,
            vy: probe_distance,
        };
        let end = Transform2D {
            x: start.x,
            y: start.y + probe_distance,
        };
        let swept_bounds = AabbBounds::swept(start, end, collider);
        let mut best: Option<TilemapSweepHit> = None;

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(swept_bounds) else {
                continue;
            };

            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for rect in rects
                .iter()
                .copied()
                .filter(|rect| rect.intersects_tile_range(range))
            {
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(swept_bounds) {
                    continue;
                }
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::swept_aabb_contact(
                    start,
                    displacement,
                    collider,
                    rect_center,
                    Velocity::default(),
                    static_collider,
                    1.0,
                ) else {
                    continue;
                };
                if contact.normal_y < TILE_GROUND_NORMAL_Y_MIN {
                    continue;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    continue;
                }

                if best_tile_hit_is_better(&best, contact, layer_index, rect.tile_index) {
                    best = Some(TilemapSweepHit {
                        layer_index,
                        tile_index: rect.tile_index,
                        contact,
                    });
                }
            }

            self.update_one_way_tile_swept_hit_for_range(
                layer_index,
                layer,
                range,
                swept_bounds,
                start,
                collider,
                displacement,
                None,
                &mut best,
            );
        }

        best
    }

    pub fn append_render_commands(
        &self,
        camera: &Camera2D,
        render_commands: &mut Vec<SpriteRenderCommand>,
    ) {
        for layer in self.layers.iter().flatten() {
            self.append_layer_render_commands(layer, camera, render_commands);
        }
    }

    pub fn navigation_waypoint(&self, from: Transform2D, to: Transform2D) -> Option<Transform2D> {
        let mut scratch = TilemapNavigationScratch::default();
        self.navigation_waypoint_with_scratch(from, to, &mut scratch)
    }

    pub fn nearest_collision_obstacle(
        &self,
        point: Transform2D,
        max_distance: f32,
    ) -> Option<TilemapNearestObstacleHit> {
        if !point.x.is_finite()
            || !point.y.is_finite()
            || !max_distance.is_finite()
            || max_distance < 0.0
        {
            return None;
        }
        let query_bounds = AabbBounds::from_center(point, max_distance, max_distance)?;
        let mut best = None;

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(query_bounds) else {
                continue;
            };
            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for rect in rects
                .iter()
                .copied()
                .filter(|rect| rect.intersects_tile_range(range))
            {
                let Some(hit) = nearest_obstacle_hit(point, max_distance, layer_index, layer, rect)
                else {
                    continue;
                };
                update_nearest_obstacle_hit(&mut best, hit);
            }
        }

        best
    }

    pub(crate) fn slope_ground_hit(
        &self,
        x: f32,
        bottom_y: f32,
        slope: SlopeConfig,
        allow_upward: bool,
        allow_downward: bool,
    ) -> Option<TilemapSlopeGroundHit> {
        if !x.is_finite()
            || !bottom_y.is_finite()
            || slope.snap_distance <= 0.0
            || !slope.max_climb_angle_radians.is_finite()
            || slope.max_climb_angle_radians < 0.0
        {
            return None;
        }

        let query_bounds = AabbBounds {
            min_x: x,
            min_y: bottom_y - slope.snap_distance,
            max_x: x,
            max_y: bottom_y + slope.snap_distance,
        };
        let mut best = None;

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(query_bounds) else {
                continue;
            };
            for row in range.min_row..=range.max_row {
                for column in range.min_column..=range.max_column {
                    let tile_index = layer.tile_index(column, row);
                    let Some(segment) = self.slope_segment_for_tile(layer, tile_index) else {
                        continue;
                    };
                    let Some(surface) = segment.surface_at_x(x) else {
                        continue;
                    };
                    if surface.angle_radians > slope.max_climb_angle_radians {
                        continue;
                    }

                    let vertical_delta = surface.y - bottom_y;
                    if vertical_delta < -TILE_SWEEP_EPSILON && !allow_upward {
                        continue;
                    }
                    if vertical_delta > TILE_SWEEP_EPSILON && !allow_downward {
                        continue;
                    }

                    let distance = vertical_delta.abs();
                    if distance > slope.snap_distance + TILE_SWEEP_EPSILON {
                        continue;
                    }

                    let hit = TilemapSlopeGroundHit {
                        layer_index,
                        tile_index,
                        surface,
                        vertical_delta,
                        distance,
                    };
                    if best_tile_slope_hit_is_better(&best, hit) {
                        best = Some(hit);
                    }
                }
            }
        }

        best
    }

    pub(crate) fn navigation_waypoint_with_scratch(
        &self,
        from: Transform2D,
        to: Transform2D,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<Transform2D> {
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            let Some(cell_count) = layer.cell_count() else {
                continue;
            };
            if cell_count > MAX_NAVIGATION_CELLS {
                continue;
            }
            let Some(start) = layer.walkable_cell_at(from) else {
                continue;
            };
            let Some(goal) = layer.walkable_cell_at(to) else {
                continue;
            };
            if start == goal {
                return Some(to);
            }
            let Some(next_cell) = layer.next_path_cell_with_scratch(start, goal, scratch) else {
                continue;
            };
            return Some(layer.tile_center(next_cell));
        }
        None
    }

    fn resolve_transform_against_solid_tiles(
        &self,
        transform: &mut Transform2D,
        collider: AabbCollider,
    ) -> TilemapResolveStats {
        let mut stats = TilemapResolveStats::default();
        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(rects) = self
                .collision_rects
                .get(layer_index)
                .and_then(Option::as_ref)
            else {
                continue;
            };
            for _ in 0..MAX_TILE_COLLISION_RESOLUTION_STEPS {
                let dynamic_bounds = AabbBounds::from_transform(*transform, collider);
                let Some(range) = layer.candidate_tile_range_for_bounds(dynamic_bounds) else {
                    break;
                };
                let mut resolved = false;

                for rect in rects
                    .iter()
                    .copied()
                    .filter(|rect| rect.intersects_tile_range(range))
                {
                    let rect_bounds = rect.bounds(layer);
                    if !rect_bounds.overlaps(dynamic_bounds) {
                        continue;
                    }
                    stats.candidate_tiles = stats.candidate_tiles.saturating_add(1);
                    if resolve_dynamic_aabb_against_static(
                        transform,
                        collider,
                        rect.center(layer),
                        rect.half_width(layer),
                        rect.half_height(layer),
                    ) {
                        resolved = true;
                        stats.hit_tiles = stats.hit_tiles.saturating_add(1);
                        break;
                    }
                }

                if !resolved {
                    break;
                }
            }
        }
        stats
    }

    fn append_layer_render_commands(
        &self,
        layer: &TilemapLayer,
        camera: &Camera2D,
        render_commands: &mut Vec<SpriteRenderCommand>,
    ) {
        for (tile_index, tile_id) in layer.tiles.iter().copied().enumerate() {
            if tile_id == 0 {
                continue;
            }
            let Some(definition) = self.tile_definition(tile_id) else {
                continue;
            };
            let center = layer.tile_center(tile_index);
            let screen = camera.world_to_screen(center);
            let (u0, v0, u1, v1) = definition.frame.uv();
            render_commands.push(SpriteRenderCommand {
                x: screen.x - layer.tile_width * 0.5,
                y: screen.y - layer.tile_height * 0.5,
                width: layer.tile_width,
                height: layer.tile_height,
                u0,
                v0,
                u1,
                v1,
                r: definition.r,
                g: definition.g,
                b: definition.b,
                a: definition.a,
                texture_id: definition.texture_id as f32,
            });
        }
    }

    fn tile_definition(&self, tile_id: u32) -> Option<TileDefinition> {
        self.definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
    }

    fn slope_definition(&self, tile_id: u32) -> Option<TileSlopeDefinition> {
        self.slope_definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
    }

    fn is_one_way_platform_tile(&self, tile_id: u32) -> bool {
        tile_id != 0
            && self
                .one_way_platform_definitions
                .get(tile_id as usize)
                .copied()
                .unwrap_or(false)
    }

    fn slope_segment_for_tile(
        &self,
        layer: &TilemapLayer,
        tile_index: usize,
    ) -> Option<SlopeSegment> {
        let tile_id = layer.tiles.get(tile_index).copied().unwrap_or(0);
        let slope = self.slope_definition(tile_id)?;
        let column = tile_index as u32 % layer.columns;
        let row = tile_index as u32 / layer.columns;
        Some(slope.world_segment(layer, column, row))
    }

    fn rebuild_collision_rects(&mut self) {
        let layer_count = self.layers.len();
        if self.collision_rects.len() < layer_count {
            self.collision_rects.resize_with(layer_count, || None);
        }
        for index in 0..layer_count {
            self.rebuild_collision_rects_for_layer(index);
        }
    }

    fn rebuild_collision_rects_for_layer(&mut self, index: usize) {
        if index >= self.collision_rects.len() {
            self.collision_rects.resize_with(index + 1, || None);
        }
        self.collision_rects[index] =
            self.layers
                .get(index)
                .and_then(Option::as_ref)
                .and_then(|layer| {
                    layer.collision.then(|| {
                        build_collision_rects_for_layer(
                            layer,
                            &self.slope_definitions,
                            &self.one_way_platform_definitions,
                        )
                    })
                });
    }

    #[allow(clippy::too_many_arguments)]
    fn update_one_way_tile_swept_hit_for_range(
        &self,
        layer_index: usize,
        layer: &TilemapLayer,
        range: TileRange,
        swept_bounds: AabbBounds,
        start: Transform2D,
        collider: AabbCollider,
        displacement: Velocity,
        mut stats: Option<&mut TilemapSweepStats>,
        best: &mut Option<TilemapSweepHit>,
    ) {
        for row in range.min_row..=range.max_row {
            for column in range.min_column..=range.max_column {
                let tile_index = layer.tile_index(column, row);
                let tile_id = layer.tiles.get(tile_index).copied().unwrap_or(0);
                if !self.is_one_way_platform_tile(tile_id) {
                    continue;
                }

                let tile_bounds = layer.tile_bounds(column, row);
                if !tile_bounds.overlaps(swept_bounds) {
                    continue;
                }
                if let Some(stats) = stats.as_deref_mut() {
                    stats.candidate_tiles = stats.candidate_tiles.saturating_add(1);
                }

                let static_collider = layer.tile_aabb_collider(collider.layer);
                let tile_center = layer.tile_center(tile_index);
                let Some(contact) = CollisionSystem::swept_aabb_contact(
                    start,
                    displacement,
                    collider,
                    tile_center,
                    Velocity::default(),
                    static_collider,
                    1.0,
                ) else {
                    continue;
                };
                if !one_way_tile_contact_blocks(start, collider, displacement, tile_bounds, contact)
                {
                    continue;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    continue;
                }

                if best_tile_hit_is_better(best, contact, layer_index, tile_index) {
                    *best = Some(TilemapSweepHit {
                        layer_index,
                        tile_index,
                        contact,
                    });
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn append_one_way_tile_shape_cast_hits_for_range(
        &self,
        layer_index: usize,
        layer: &TilemapLayer,
        range: TileRange,
        swept_bounds: AabbBounds,
        start: Transform2D,
        collider: AabbCollider,
        displacement: Velocity,
        unit_x: f32,
        unit_y: f32,
        max_distance: f32,
        hits: &mut Vec<TilemapShapeCastHit>,
    ) {
        for row in range.min_row..=range.max_row {
            for column in range.min_column..=range.max_column {
                let tile_index = layer.tile_index(column, row);
                let tile_id = layer.tiles.get(tile_index).copied().unwrap_or(0);
                if !self.is_one_way_platform_tile(tile_id) {
                    continue;
                }

                let tile_bounds = layer.tile_bounds(column, row);
                if !tile_bounds.overlaps(swept_bounds) {
                    continue;
                }

                let static_collider = layer.tile_aabb_collider(collider.layer);
                let tile_center = layer.tile_center(tile_index);
                let Some(contact) = CollisionSystem::swept_aabb_contact(
                    start,
                    displacement,
                    collider,
                    tile_center,
                    Velocity::default(),
                    static_collider,
                    1.0,
                ) else {
                    continue;
                };
                if !one_way_tile_contact_blocks(start, collider, displacement, tile_bounds, contact)
                {
                    continue;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    continue;
                }

                hits.push(tilemap_shape_cast_hit_from_contact(
                    start,
                    collider,
                    unit_x,
                    unit_y,
                    max_distance,
                    layer_index,
                    tile_index,
                    contact,
                ));
            }
        }
    }
}

impl TileCollisionRect {
    fn max_column(self) -> u32 {
        self.min_column + self.columns - 1
    }

    fn max_row(self) -> u32 {
        self.min_row + self.rows - 1
    }

    fn intersects_tile_range(self, range: TileRange) -> bool {
        self.min_column <= range.max_column
            && self.max_column() >= range.min_column
            && self.min_row <= range.max_row
            && self.max_row() >= range.min_row
    }

    fn center(self, layer: &TilemapLayer) -> Transform2D {
        Transform2D {
            x: layer.origin_x
                + self.min_column as f32 * layer.tile_width
                + self.columns as f32 * layer.tile_width * 0.5,
            y: layer.origin_y
                + self.min_row as f32 * layer.tile_height
                + self.rows as f32 * layer.tile_height * 0.5,
        }
    }

    fn half_width(self, layer: &TilemapLayer) -> f32 {
        self.columns as f32 * layer.tile_width * 0.5
    }

    fn half_height(self, layer: &TilemapLayer) -> f32 {
        self.rows as f32 * layer.tile_height * 0.5
    }

    fn bounds(self, layer: &TilemapLayer) -> AabbBounds {
        AabbBounds {
            min_x: layer.origin_x + self.min_column as f32 * layer.tile_width,
            min_y: layer.origin_y + self.min_row as f32 * layer.tile_height,
            max_x: layer.origin_x + (self.max_column() + 1) as f32 * layer.tile_width,
            max_y: layer.origin_y + (self.max_row() + 1) as f32 * layer.tile_height,
        }
    }

    fn aabb_collider(self, layer: &TilemapLayer, dynamic_layer: CollisionLayer) -> AabbCollider {
        AabbCollider {
            half_width: self.half_width(layer),
            half_height: self.half_height(layer),
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: dynamic_layer,
        }
    }
}

impl TilemapLayer {
    #[allow(clippy::too_many_arguments)]
    fn from_values(
        columns: u32,
        rows: u32,
        tile_width: f32,
        tile_height: f32,
        origin_x: f32,
        origin_y: f32,
        collision: bool,
        mut tiles: Vec<u32>,
    ) -> Option<Self> {
        if columns == 0 || rows == 0 || !is_positive(tile_width) || !is_positive(tile_height) {
            return None;
        }
        let expected_len = (columns as usize).checked_mul(rows as usize)?;
        tiles.resize(expected_len, 0);
        tiles.truncate(expected_len);

        Some(Self {
            columns,
            rows,
            tile_width,
            tile_height,
            origin_x: finite_or_default(origin_x, 0.0),
            origin_y: finite_or_default(origin_y, 0.0),
            collision,
            tiles,
        })
    }

    fn tile_center(&self, tile_index: usize) -> Transform2D {
        let column = (tile_index as u32 % self.columns) as f32;
        let row = (tile_index as u32 / self.columns) as f32;
        Transform2D {
            x: self.origin_x + column * self.tile_width + self.tile_width * 0.5,
            y: self.origin_y + row * self.tile_height + self.tile_height * 0.5,
        }
    }

    fn tile_index(&self, column: u32, row: u32) -> usize {
        (row * self.columns + column) as usize
    }

    fn tile_bounds(&self, column: u32, row: u32) -> AabbBounds {
        AabbBounds {
            min_x: self.origin_x + column as f32 * self.tile_width,
            min_y: self.origin_y + row as f32 * self.tile_height,
            max_x: self.origin_x + (column + 1) as f32 * self.tile_width,
            max_y: self.origin_y + (row + 1) as f32 * self.tile_height,
        }
    }

    fn tile_aabb_collider(&self, dynamic_layer: CollisionLayer) -> AabbCollider {
        AabbCollider {
            half_width: self.tile_width * 0.5,
            half_height: self.tile_height * 0.5,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: dynamic_layer,
        }
    }

    fn candidate_tile_range_for_bounds(&self, bounds: AabbBounds) -> Option<TileRange> {
        let layer_min_x = self.origin_x;
        let layer_min_y = self.origin_y;
        let layer_max_x = self.origin_x + self.columns as f32 * self.tile_width;
        let layer_max_y = self.origin_y + self.rows as f32 * self.tile_height;
        if bounds.max_x < layer_min_x
            || bounds.min_x > layer_max_x
            || bounds.max_y < layer_min_y
            || bounds.min_y > layer_max_y
        {
            return None;
        }

        Some(TileRange {
            min_column: tile_axis_index(
                bounds.min_x,
                self.origin_x,
                self.tile_width,
                self.columns - 1,
            ),
            max_column: tile_axis_index(
                bounds.max_x,
                self.origin_x,
                self.tile_width,
                self.columns - 1,
            ),
            min_row: tile_axis_index(bounds.min_y, self.origin_y, self.tile_height, self.rows - 1),
            max_row: tile_axis_index(bounds.max_y, self.origin_y, self.tile_height, self.rows - 1),
        })
    }

    fn cell_count(&self) -> Option<usize> {
        (self.columns as usize).checked_mul(self.rows as usize)
    }

    fn cell_at(&self, transform: Transform2D) -> Option<usize> {
        let max_x = self.origin_x + self.columns as f32 * self.tile_width;
        let max_y = self.origin_y + self.rows as f32 * self.tile_height;
        if transform.x < self.origin_x
            || transform.x > max_x
            || transform.y < self.origin_y
            || transform.y > max_y
        {
            return None;
        }

        let column = ((transform.x - self.origin_x) / self.tile_width)
            .floor()
            .clamp(0.0, (self.columns - 1) as f32) as u32;
        let row = ((transform.y - self.origin_y) / self.tile_height)
            .floor()
            .clamp(0.0, (self.rows - 1) as f32) as u32;
        Some((row * self.columns + column) as usize)
    }

    fn walkable_cell_at(&self, transform: Transform2D) -> Option<usize> {
        let cell = self.cell_at(transform)?;
        self.is_walkable(cell).then_some(cell)
    }

    fn is_walkable(&self, cell: usize) -> bool {
        self.tiles.get(cell).copied().unwrap_or(0) == 0
    }

    fn next_path_cell_with_scratch(
        &self,
        start: usize,
        goal: usize,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<usize> {
        let cell_count = self.cell_count()?;
        scratch.prepare(cell_count);
        scratch.g_scores[start] = 0;
        scratch.visited.push(start);
        scratch.open.push(PathNode {
            cell: start,
            g_score: 0,
            f_score: self.manhattan_distance(start, goal),
        });

        let mut result = None;
        while let Some(node) = scratch.open.pop() {
            if node.cell == goal {
                result = reconstruct_next_cell(start, goal, &scratch.came_from);
                break;
            }
            if node.g_score != scratch.g_scores[node.cell] {
                continue;
            }
            for neighbor in self.neighbor_indices(node.cell).into_iter().flatten() {
                if !self.is_walkable(neighbor) {
                    continue;
                }
                let next_g_score = node.g_score.saturating_add(1);
                if next_g_score >= scratch.g_scores[neighbor] {
                    continue;
                }
                scratch.set_score(neighbor, node.cell, next_g_score);
                scratch.open.push(PathNode {
                    cell: neighbor,
                    g_score: next_g_score,
                    f_score: next_g_score + self.manhattan_distance(neighbor, goal),
                });
            }
        }

        scratch.clear_dirty();
        result
    }

    fn neighbor_indices(&self, cell: usize) -> [Option<usize>; 4] {
        let column = cell as u32 % self.columns;
        let row = cell as u32 / self.columns;
        [
            (column > 0).then(|| cell - 1),
            (column + 1 < self.columns).then(|| cell + 1),
            (row > 0).then(|| cell - self.columns as usize),
            (row + 1 < self.rows).then(|| cell + self.columns as usize),
        ]
    }

    fn manhattan_distance(&self, from: usize, to: usize) -> u32 {
        let from_column = from as u32 % self.columns;
        let from_row = from as u32 / self.columns;
        let to_column = to as u32 % self.columns;
        let to_row = to as u32 / self.columns;
        from_column.abs_diff(to_column) + from_row.abs_diff(to_row)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PathNode {
    cell: usize,
    g_score: u32,
    f_score: u32,
}

impl Ord for PathNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .f_score
            .cmp(&self.f_score)
            .then_with(|| other.g_score.cmp(&self.g_score))
            .then_with(|| self.cell.cmp(&other.cell))
    }
}

impl PartialOrd for PathNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn reconstruct_next_cell(start: usize, goal: usize, came_from: &[usize]) -> Option<usize> {
    let mut current = goal;
    let mut previous = came_from.get(current).copied()?;
    if previous == UNVISITED_CELL {
        return None;
    }

    while previous != start {
        current = previous;
        previous = came_from.get(current).copied()?;
        if previous == UNVISITED_CELL {
            return None;
        }
    }

    Some(current)
}

fn build_collision_rects_for_layer(
    layer: &TilemapLayer,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
) -> Vec<TileCollisionRect> {
    let mut completed = Vec::new();
    let mut active = Vec::new();
    let mut next_active = Vec::new();

    for row in 0..layer.rows {
        next_active.clear();
        for run in solid_runs_for_row(layer, row, slope_definitions, one_way_platform_definitions) {
            if let Some(active_index) = active.iter().position(|rect: &TileCollisionRect| {
                rect.min_column == run.min_column
                    && rect.columns == run.columns
                    && rect.min_row + rect.rows == row
            }) {
                let mut rect = active.swap_remove(active_index);
                rect.rows += 1;
                next_active.push(rect);
            } else {
                next_active.push(TileCollisionRect {
                    tile_index: layer.tile_index(run.min_column, row),
                    min_column: run.min_column,
                    min_row: row,
                    columns: run.columns,
                    rows: 1,
                });
            }
        }
        completed.append(&mut active);
        std::mem::swap(&mut active, &mut next_active);
    }

    completed.append(&mut active);
    completed.sort_by_key(|rect| rect.tile_index);
    completed
}

fn solid_runs_for_row(
    layer: &TilemapLayer,
    row: u32,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
) -> Vec<TileRun> {
    let mut runs = Vec::new();
    let mut column = 0;
    while column < layer.columns {
        while column < layer.columns
            && !is_solid_tile(
                layer,
                column,
                row,
                slope_definitions,
                one_way_platform_definitions,
            )
        {
            column += 1;
        }
        if column >= layer.columns {
            break;
        }
        let min_column = column;
        while column < layer.columns
            && is_solid_tile(
                layer,
                column,
                row,
                slope_definitions,
                one_way_platform_definitions,
            )
        {
            column += 1;
        }
        runs.push(TileRun {
            min_column,
            columns: column - min_column,
        });
    }
    runs
}

fn is_solid_tile(
    layer: &TilemapLayer,
    column: u32,
    row: u32,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
) -> bool {
    let tile_id = layer
        .tiles
        .get(layer.tile_index(column, row))
        .copied()
        .unwrap_or(0);
    tile_id != 0
        && slope_definitions
            .get(tile_id as usize)
            .is_none_or(Option::is_none)
        && !one_way_platform_definitions
            .get(tile_id as usize)
            .copied()
            .unwrap_or(false)
}

fn one_way_tile_contact_blocks(
    start: Transform2D,
    collider: AabbCollider,
    displacement: Velocity,
    tile_bounds: AabbBounds,
    contact: SweptAabbContactHit,
) -> bool {
    if displacement.vy <= TILE_SWEEP_EPSILON || contact.normal_y < TILE_GROUND_NORMAL_Y_MIN {
        return false;
    }
    let mover_bottom = collider.center(start).y + collider.half_height;
    mover_bottom <= tile_bounds.min_y + TILE_SWEEP_EPSILON
}

#[allow(clippy::too_many_arguments)]
fn tilemap_shape_cast_hit_from_contact(
    start: Transform2D,
    collider: AabbCollider,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    layer_index: usize,
    tile_index: usize,
    contact: SweptAabbContactHit,
) -> TilemapShapeCastHit {
    let distance = contact.time.clamp(0.0, 1.0) * max_distance;
    let reference = collider.center(start);
    TilemapShapeCastHit {
        layer_index,
        tile_index,
        distance,
        point_x: reference.x + unit_x * distance,
        point_y: reference.y + unit_y * distance,
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
    }
}

#[allow(clippy::too_many_arguments)]
fn tilemap_contact_hit_from_contact(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    layer_index: usize,
    tile_index: usize,
    contact: AabbContact,
) -> TilemapContactHit {
    let (point_x, point_y) = tilemap_aabb_contact_point(
        transform,
        collider,
        static_transform,
        static_collider,
        contact,
    );
    TilemapContactHit {
        layer_index,
        tile_index,
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
        penetration: contact.penetration,
        point_x,
        point_y,
    }
}

#[allow(clippy::too_many_arguments)]
fn tilemap_contact_manifold_hit_from_contact(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    layer_index: usize,
    tile_index: usize,
    contact: AabbContact,
) -> Option<TilemapContactManifoldHit> {
    let (points, point_count) = tilemap_aabb_contact_manifold_points(
        transform,
        collider,
        static_transform,
        static_collider,
        contact,
    );
    (point_count > 0).then_some(TilemapContactManifoldHit {
        layer_index,
        tile_index,
        point_count,
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
        penetration: contact.penetration,
        points,
    })
}

fn tilemap_aabb_contact_point(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(transform, collider);
    let static_bounds = AabbBounds::from_transform(static_transform, static_collider);
    let center = collider.center(transform);
    if contact.normal_x != 0.0 {
        let min_y = bounds.min_y.max(static_bounds.min_y);
        let max_y = bounds.max_y.min(static_bounds.max_y);
        (
            center.x + contact.normal_x * collider.half_width,
            (min_y + max_y) * 0.5,
        )
    } else {
        let min_x = bounds.min_x.max(static_bounds.min_x);
        let max_x = bounds.max_x.min(static_bounds.max_x);
        (
            (min_x + max_x) * 0.5,
            center.y + contact.normal_y * collider.half_height,
        )
    }
}

fn tilemap_aabb_contact_manifold_points(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    contact: AabbContact,
) -> (
    [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
    u32,
) {
    let bounds = AabbBounds::from_transform(transform, collider);
    let static_bounds = AabbBounds::from_transform(static_transform, static_collider);
    let center = collider.center(transform);
    if contact.normal_x != 0.0 {
        let min_y = bounds.min_y.max(static_bounds.min_y);
        let max_y = bounds.max_y.min(static_bounds.max_y);
        let face_x = center.x + contact.normal_x * collider.half_width;
        tilemap_two_or_one_contact_points(face_x, min_y, face_x, max_y, contact.penetration)
    } else {
        let min_x = bounds.min_x.max(static_bounds.min_x);
        let max_x = bounds.max_x.min(static_bounds.max_x);
        let face_y = center.y + contact.normal_y * collider.half_height;
        tilemap_two_or_one_contact_points(min_x, face_y, max_x, face_y, contact.penetration)
    }
}

fn tilemap_two_or_one_contact_points(
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    penetration: f32,
) -> (
    [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
    u32,
) {
    if !x0.is_finite()
        || !y0.is_finite()
        || !x1.is_finite()
        || !y1.is_finite()
        || !penetration.is_finite()
    {
        return tilemap_empty_contact_manifold_points();
    }

    let dx = x1 - x0;
    let dy = y1 - y0;
    if dx * dx + dy * dy <= TILE_SWEEP_EPSILON * TILE_SWEEP_EPSILON {
        return (
            [
                TilemapContactPoint {
                    point_x: (x0 + x1) * 0.5,
                    point_y: (y0 + y1) * 0.5,
                    penetration,
                },
                TilemapContactPoint::default(),
            ],
            1,
        );
    }

    (
        [
            TilemapContactPoint {
                point_x: x0,
                point_y: y0,
                penetration,
            },
            TilemapContactPoint {
                point_x: x1,
                point_y: y1,
                penetration,
            },
        ],
        2,
    )
}

fn tilemap_empty_contact_manifold_points() -> (
    [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
    u32,
) {
    (
        [TilemapContactPoint::default(); MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
        0,
    )
}

fn tile_aabb_query_is_valid(start: Transform2D, collider: AabbCollider) -> bool {
    collider.enabled
        && is_tilemap_blocked_layer(collider.layer)
        && AabbBounds::from_center(
            collider.center(start),
            collider.half_width,
            collider.half_height,
        )
        .is_some()
}

fn tile_shape_cast_query_is_valid(
    start: Transform2D,
    collider: AabbCollider,
    max_distance: f32,
) -> bool {
    tile_aabb_query_is_valid(start, collider) && max_distance.is_finite() && max_distance >= 0.0
}

fn tile_shape_cast_unit_direction(direction: Velocity) -> Option<(f32, f32)> {
    if !direction.vx.is_finite() || !direction.vy.is_finite() {
        return None;
    }
    let length = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    if length <= TILE_SWEEP_EPSILON {
        None
    } else {
        Some((direction.vx / length, direction.vy / length))
    }
}

fn tile_raycast_query_is_valid(origin: Transform2D, max_distance: f32) -> bool {
    origin.x.is_finite() && origin.y.is_finite() && max_distance.is_finite() && max_distance >= 0.0
}

fn tile_segment_direction_and_distance(
    start: Transform2D,
    end: Transform2D,
) -> Option<(Velocity, f32)> {
    if !start.x.is_finite() || !start.y.is_finite() || !end.x.is_finite() || !end.y.is_finite() {
        return None;
    }
    let direction = Velocity {
        vx: end.x - start.x,
        vy: end.y - start.y,
    };
    let distance = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    (distance > TILE_SWEEP_EPSILON).then_some((direction, distance))
}

fn tile_raycast_bounds(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
) -> Option<AabbBounds> {
    let end_x = origin.x + unit_x * max_distance;
    let end_y = origin.y + unit_y * max_distance;
    AabbBounds::from_min_max(
        origin.x.min(end_x) - TILE_SWEEP_EPSILON,
        origin.y.min(end_y) - TILE_SWEEP_EPSILON,
        origin.x.max(end_x) + TILE_SWEEP_EPSILON,
        origin.y.max(end_y) + TILE_SWEEP_EPSILON,
    )
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct TilemapRaycastBoundsHit {
    distance: f32,
    normal_x: f32,
    normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct TileRayAxisEntryExit {
    entry: f32,
    exit: f32,
    normal: f32,
}

fn tilemap_raycast_bounds(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<TilemapRaycastBoundsHit> {
    if bounds.contains_point(origin) {
        return Some(TilemapRaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let x = tile_ray_axis_entry_exit(origin.x, unit_x, bounds.min_x, bounds.max_x)?;
    let y = tile_ray_axis_entry_exit(origin.y, unit_y, bounds.min_y, bounds.max_y)?;
    let entry = x.entry.max(y.entry);
    let exit = x.exit.min(y.exit);
    if entry > exit || exit < 0.0 || entry > max_distance {
        return None;
    }

    let distance = entry.max(0.0);
    let (normal_x, normal_y) = if x.entry > y.entry {
        (x.normal, 0.0)
    } else if y.entry > x.entry {
        (0.0, y.normal)
    } else if unit_x.abs() >= unit_y.abs() {
        (x.normal, 0.0)
    } else {
        (0.0, y.normal)
    };

    Some(TilemapRaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

fn tile_ray_axis_entry_exit(
    start: f32,
    direction: f32,
    min: f32,
    max: f32,
) -> Option<TileRayAxisEntryExit> {
    if direction.abs() <= TILE_SWEEP_EPSILON {
        return (start >= min && start <= max).then_some(TileRayAxisEntryExit {
            entry: f32::NEG_INFINITY,
            exit: f32::INFINITY,
            normal: 0.0,
        });
    }

    let inv_direction = direction.recip();
    let first = (min - start) * inv_direction;
    let second = (max - start) * inv_direction;
    if first <= second {
        Some(TileRayAxisEntryExit {
            entry: first,
            exit: second,
            normal: -1.0,
        })
    } else {
        Some(TileRayAxisEntryExit {
            entry: second,
            exit: first,
            normal: 1.0,
        })
    }
}

fn sort_tile_linear_hits(hits: &mut [TilemapShapeCastHit]) {
    hits.sort_by(|a, b| {
        a.distance
            .total_cmp(&b.distance)
            .then_with(|| a.layer_index.cmp(&b.layer_index))
            .then_with(|| a.tile_index.cmp(&b.tile_index))
    });
}

fn tile_slope_definition_from_values(
    local_x0: f32,
    local_y0: f32,
    local_x1: f32,
    local_y1: f32,
) -> Option<TileSlopeDefinition> {
    if !is_normalized(local_x0)
        || !is_normalized(local_y0)
        || !is_normalized(local_x1)
        || !is_normalized(local_y1)
        || (local_x1 - local_x0).abs() <= TILE_SWEEP_EPSILON
    {
        return None;
    }
    Some(TileSlopeDefinition::new(
        local_x0, local_y0, local_x1, local_y1,
    ))
}

fn best_tile_slope_hit_is_better(
    best: &Option<TilemapSlopeGroundHit>,
    next: TilemapSlopeGroundHit,
) -> bool {
    best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.layer_index.cmp(&current.layer_index))
            .then_with(|| next.tile_index.cmp(&current.tile_index))
            .is_lt()
    })
}

fn is_tilemap_blocked_layer(layer: CollisionLayer) -> bool {
    matches!(layer, CollisionLayer::Player | CollisionLayer::Enemy)
}

fn resolve_dynamic_aabb_against_static(
    transform: &mut Transform2D,
    collider: AabbCollider,
    static_center: Transform2D,
    static_half_width: f32,
    static_half_height: f32,
) -> bool {
    let static_collider = AabbCollider {
        half_width: static_half_width,
        half_height: static_half_height,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: false,
        layer: collider.layer,
    };
    let Some(contact) =
        CollisionSystem::aabb_contact(*transform, collider, static_center, static_collider)
    else {
        return false;
    };

    transform.x -= contact.normal_x * contact.penetration;
    transform.y -= contact.normal_y * contact.penetration;
    true
}

fn best_tile_hit_is_better(
    best: &Option<TilemapSweepHit>,
    contact: SweptAabbContactHit,
    layer_index: usize,
    tile_index: usize,
) -> bool {
    match best {
        Some(best_hit) => {
            let same_time = (contact.time - best_hit.contact.time).abs() <= f32::EPSILON;
            contact.time < best_hit.contact.time
                || (same_time
                    && (layer_index, tile_index) < (best_hit.layer_index, best_hit.tile_index))
        }
        None => true,
    }
}

fn nearest_obstacle_hit(
    point: Transform2D,
    max_distance: f32,
    layer_index: usize,
    layer: &TilemapLayer,
    rect: TileCollisionRect,
) -> Option<TilemapNearestObstacleHit> {
    let bounds = rect.bounds(layer);
    let point_x = point.x.max(bounds.min_x).min(bounds.max_x);
    let point_y = point.y.max(bounds.min_y).min(bounds.max_y);
    let dx = point.x - point_x;
    let dy = point.y - point_y;
    let distance = (dx * dx + dy * dy).sqrt();
    if !distance.is_finite() || distance > max_distance {
        return None;
    }
    Some(TilemapNearestObstacleHit {
        layer_index,
        tile_index: rect.tile_index,
        distance,
        point_x,
        point_y,
    })
}

fn update_nearest_obstacle_hit(
    best: &mut Option<TilemapNearestObstacleHit>,
    next: TilemapNearestObstacleHit,
) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.layer_index.cmp(&current.layer_index))
            .then_with(|| next.tile_index.cmp(&current.tile_index))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn tile_axis_index(value: f32, origin: f32, tile_size: f32, max_index: u32) -> u32 {
    ((value - origin) / tile_size)
        .floor()
        .clamp(0.0, max_index as f32) as u32
}

fn is_positive(value: f32) -> bool {
    value.is_finite() && value > 0.0
}

fn is_normalized(value: f32) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn finite_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

fn normalized_or_default(value: f32, default: f32) -> f32 {
    if is_normalized(value) {
        value
    } else {
        default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilemap_appends_static_tile_render_commands() {
        let mut tilemap = Tilemap::default();
        tilemap.set_tile_definition(1, 7, 0.25, 0.0, 0.5, 0.25, 0.8, 0.7, 0.6, 1.0);
        tilemap.set_layer(0, 2, 1, 32.0, 16.0, 10.0, 20.0, false, vec![1, 0]);
        let camera = Camera2D::new(320.0, 240.0);
        let mut commands = Vec::new();

        tilemap.append_render_commands(&camera, &mut commands);

        assert_eq!(commands.len(), 1);
        let command = commands[0];
        assert_eq!(command.texture_id, 7.0);
        assert_eq!(command.width, 32.0);
        assert_eq!(command.height, 16.0);
        assert_eq!(command.u0, 0.25);
        assert_eq!(command.v1, 0.25);
        assert_eq!(command.r, 0.8);
        assert!((command.x - 10.0).abs() < 0.01);
        assert!((command.y - 20.0).abs() < 0.01);
    }

    #[test]
    fn undefined_tiles_are_skipped() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 3, 1, 16.0, 16.0, 0.0, 0.0, false, vec![0, 2, 0]);
        let camera = Camera2D::new(320.0, 240.0);
        let mut commands = Vec::new();

        tilemap.append_render_commands(&camera, &mut commands);

        assert!(commands.is_empty());
    }

    #[test]
    fn collision_layers_resolve_player_overlap() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, true, vec![1]);
        let mut world = World::default();
        let player = world.spawn_player(20.0, 16.0, 0);

        tilemap.resolve_dynamic_collisions(&mut world);

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 50.0);
        assert_eq!(transform.y, 16.0);
    }

    #[test]
    fn collision_resolution_updates_physics_counters() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, true, vec![1]);
        let mut world = World::default();
        world.spawn_player(20.0, 16.0, 0);
        let mut counters = PhysicsCounters::default();

        tilemap.resolve_dynamic_collisions_with_counters(&mut world, &mut counters);

        assert_eq!(counters.kinematic_moves, 1);
        assert!(counters.kinematic_hits > 0);
        assert_eq!(counters.kinematic_tile_hits, counters.kinematic_hits);
        assert!(counters.tile_candidate_checks > 0);
    }

    #[test]
    fn non_collision_layers_do_not_block_player() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1]);
        let mut world = World::default();
        let player = world.spawn_player(20.0, 16.0, 0);

        tilemap.resolve_dynamic_collisions(&mut world);

        assert_eq!(
            world.transforms[player.id as usize],
            Some(Transform2D { x: 20.0, y: 16.0 })
        );
    }

    #[test]
    fn collision_candidate_range_only_covers_overlapping_tiles() {
        let layer =
            TilemapLayer::from_values(10, 10, 10.0, 10.0, 0.0, 0.0, true, Vec::new()).unwrap();

        let range = layer
            .candidate_tile_range_for_bounds(AabbBounds::from_transform(
                Transform2D { x: 25.0, y: 15.0 },
                test_collider(4.0, 4.0),
            ))
            .unwrap();

        assert_eq!(
            range,
            TileRange {
                min_column: 2,
                max_column: 2,
                min_row: 1,
                max_row: 1,
            }
        );
    }

    #[test]
    fn collision_rects_merge_adjacent_solid_tile_runs() {
        let layer = TilemapLayer::from_values(
            3,
            3,
            10.0,
            10.0,
            0.0,
            0.0,
            true,
            vec![1, 1, 0, 1, 1, 0, 0, 1, 1],
        )
        .unwrap();

        let rects = build_collision_rects_for_layer(&layer, &[], &[]);

        assert_eq!(
            rects,
            vec![
                TileCollisionRect {
                    tile_index: 0,
                    min_column: 0,
                    min_row: 0,
                    columns: 2,
                    rows: 2,
                },
                TileCollisionRect {
                    tile_index: 7,
                    min_column: 1,
                    min_row: 2,
                    columns: 2,
                    rows: 1,
                },
            ]
        );
    }

    #[test]
    fn slope_tiles_sample_surface_and_skip_solid_collision_merge() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

        let mut stats = TilemapSweepStats::default();
        assert!(tilemap
            .swept_aabb_contact(
                Transform2D { x: -5.0, y: 5.0 },
                test_collider(1.0, 1.0),
                Velocity { vx: 10.0, vy: 0.0 },
                &mut stats,
            )
            .is_some());

        tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);

        let hit = tilemap
            .slope_ground_hit(5.0, 7.0, SlopeConfig::new(0.8, 3.0), true, false)
            .expect("slope tile should report nearby surface");

        assert_eq!(hit.layer_index, 0);
        assert_eq!(hit.tile_index, 0);
        assert!((hit.surface.y - 5.0).abs() < 0.01);
        assert!((hit.vertical_delta + 2.0).abs() < 0.01);
        assert!(hit.surface.normal_y > TILE_GROUND_NORMAL_Y_MIN);

        let mut slope_stats = TilemapSweepStats::default();
        assert!(tilemap
            .swept_aabb_contact(
                Transform2D { x: -5.0, y: 5.0 },
                test_collider(1.0, 1.0),
                Velocity { vx: 10.0, vy: 0.0 },
                &mut slope_stats,
            )
            .is_none());
        assert_eq!(slope_stats.candidate_tiles, 0);
    }

    #[test]
    fn one_way_tiles_block_only_downward_sweeps_and_skip_solid_collision_merge() {
        let layer = TilemapLayer::from_values(1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]).unwrap();
        let one_way_definitions = vec![false, true];
        let rects = build_collision_rects_for_layer(&layer, &[], &one_way_definitions);

        assert!(rects.is_empty());

        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);
        tilemap.set_tile_one_way_platform(1);

        let mut downward_stats = TilemapSweepStats::default();
        let downward_hit = tilemap
            .swept_aabb_contact(
                Transform2D { x: 5.0, y: -2.0 },
                test_collider(1.0, 1.0),
                Velocity { vx: 0.0, vy: 10.0 },
                &mut downward_stats,
            )
            .expect("one-way tile should block downward movement from above");

        assert_eq!(downward_hit.layer_index, 0);
        assert_eq!(downward_hit.tile_index, 0);
        assert!(downward_hit.contact.normal_y >= TILE_GROUND_NORMAL_Y_MIN);
        assert_eq!(downward_stats.candidate_tiles, 1);

        let mut upward_stats = TilemapSweepStats::default();
        assert!(tilemap
            .swept_aabb_contact(
                Transform2D { x: 5.0, y: 12.0 },
                test_collider(1.0, 1.0),
                Velocity { vx: 0.0, vy: -10.0 },
                &mut upward_stats,
            )
            .is_none());
        assert_eq!(upward_stats.candidate_tiles, 1);

        let mut side_stats = TilemapSweepStats::default();
        assert!(tilemap
            .swept_aabb_contact(
                Transform2D { x: -2.0, y: 5.0 },
                test_collider(1.0, 1.0),
                Velocity { vx: 10.0, vy: 0.0 },
                &mut side_stats,
            )
            .is_none());
        assert_eq!(side_stats.candidate_tiles, 1);
    }

    #[test]
    fn nearest_collision_obstacle_returns_nearest_merged_rect() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 4, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1, 0]);

        let hit = tilemap
            .nearest_collision_obstacle(Transform2D { x: 0.0, y: 5.0 }, 100.0)
            .expect("nearest tile obstacle should be found");

        assert_eq!(hit.layer_index, 0);
        assert_eq!(hit.tile_index, 1);
        assert!((hit.distance - 10.0).abs() < 0.01);
        assert_eq!(hit.point_x, 10.0);
        assert_eq!(hit.point_y, 5.0);
    }

    #[test]
    fn set_tile_refreshes_collision_cache_for_tile_queries_and_sweeps() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 0]);

        let initial_hit = tilemap
            .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
            .expect("initial solid tile should be cached as an obstacle");
        assert_eq!(initial_hit.tile_index, 0);

        assert!(tilemap.set_tile(0, 0, 0, 0));
        assert!(tilemap
            .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
            .is_none());

        assert!(tilemap.set_tile(0, 1, 0, 1));
        let refreshed_hit = tilemap
            .nearest_collision_obstacle(Transform2D { x: 0.0, y: 5.0 }, 100.0)
            .expect("new solid tile should be visible to nearest obstacle queries");
        assert_eq!(refreshed_hit.tile_index, 1);
        assert_eq!(refreshed_hit.point_x, 10.0);
        assert_eq!(refreshed_hit.point_y, 5.0);

        let mut stats = TilemapSweepStats::default();
        let sweep_hit = tilemap
            .swept_aabb_contact(
                Transform2D { x: 0.0, y: 5.0 },
                test_collider(2.0, 2.0),
                Velocity { vx: 20.0, vy: 0.0 },
                &mut stats,
            )
            .expect("new solid tile should be visible to swept movement");
        assert_eq!(sweep_hit.tile_index, 1);
        assert!(stats.candidate_tiles > 0);

        assert!(!tilemap.set_tile(0, 1, 0, 1));
        assert!(!tilemap.set_tile(0, 2, 0, 1));
        assert!(!tilemap.set_tile(4, 0, 0, 1));
    }

    #[test]
    fn set_tiles_rect_refreshes_collision_cache_and_render_commands() {
        let mut tilemap = Tilemap::default();
        tilemap.set_tile_definition(1, 7, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        tilemap.set_layer(0, 4, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1, 1, 0]);
        let camera = Camera2D::new(320.0, 240.0);
        let mut commands = Vec::new();

        tilemap.append_render_commands(&camera, &mut commands);
        assert_eq!(commands.len(), 3);
        assert!(tilemap
            .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
            .is_some());

        assert!(tilemap.set_tiles_rect(0, 0, 0, 2, 1, 0));

        assert!(tilemap
            .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
            .is_none());
        let remaining_hit = tilemap
            .nearest_collision_obstacle(Transform2D { x: 25.0, y: 5.0 }, 0.0)
            .expect("remaining solid tile should still be cached as an obstacle");
        assert_eq!(remaining_hit.tile_index, 2);

        commands.clear();
        tilemap.append_render_commands(&camera, &mut commands);
        assert_eq!(commands.len(), 1);
        assert!((commands[0].x - 20.0).abs() < 0.01);

        let mut stats = TilemapSweepStats::default();
        let sweep_hit = tilemap
            .swept_aabb_contact(
                Transform2D { x: 15.0, y: 5.0 },
                test_collider(1.0, 1.0),
                Velocity { vx: 20.0, vy: 0.0 },
                &mut stats,
            )
            .expect("rect edit should leave remaining solid tiles in swept collision cache");
        assert_eq!(sweep_hit.tile_index, 2);
        assert!(stats.candidate_tiles > 0);

        assert!(!tilemap.set_tiles_rect(0, 0, 0, 2, 1, 0));
        assert!(!tilemap.set_tiles_rect(0, 0, 0, 0, 1, 1));
        assert!(!tilemap.set_tiles_rect(0, 3, 0, 2, 1, 1));
        assert!(!tilemap.set_tiles_rect(4, 0, 0, 1, 1, 1));
    }

    #[test]
    fn nearest_collision_obstacle_returns_zero_inside_obstacle() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

        let hit = tilemap
            .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
            .expect("point inside obstacle should hit at distance zero");

        assert_eq!(hit.layer_index, 0);
        assert_eq!(hit.tile_index, 0);
        assert_eq!(hit.distance, 0.0);
        assert_eq!(hit.point_x, 5.0);
        assert_eq!(hit.point_y, 5.0);
    }

    #[test]
    fn nearest_collision_obstacle_uses_layer_and_tile_tie_break() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(2, 1, 1, 10.0, 10.0, 20.0, 0.0, true, vec![1]);
        tilemap.set_layer(1, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

        let hit = tilemap
            .nearest_collision_obstacle(Transform2D { x: 15.0, y: 5.0 }, 20.0)
            .expect("nearest tie should be resolved by layer index");

        assert_eq!(hit.layer_index, 1);
        assert_eq!(hit.tile_index, 0);
        assert_eq!(hit.distance, 5.0);
    }

    #[test]
    fn nearest_collision_obstacle_ignores_non_collision_and_max_distance_misses() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, false, vec![1]);

        assert!(tilemap
            .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 100.0)
            .is_none());

        tilemap.set_layer(1, 1, 1, 10.0, 10.0, 20.0, 0.0, true, vec![1]);

        assert!(tilemap
            .nearest_collision_obstacle(Transform2D { x: 0.0, y: 5.0 }, 5.0)
            .is_none());
        assert!(tilemap
            .nearest_collision_obstacle(
                Transform2D {
                    x: f32::NAN,
                    y: 5.0,
                },
                100.0,
            )
            .is_none());
    }

    #[test]
    fn raycast_obstacles_returns_merged_solid_rect_hits() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(2, 4, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1, 1]);

        let hits = tilemap.raycast_obstacles(
            Transform2D { x: 0.0, y: 5.0 },
            Velocity { vx: 1.0, vy: 0.0 },
            50.0,
        );

        assert_eq!(
            hits,
            vec![TilemapShapeCastHit {
                layer_index: 2,
                tile_index: 1,
                distance: 10.0,
                point_x: 10.0,
                point_y: 5.0,
                normal_x: -1.0,
                normal_y: 0.0,
            }]
        );
    }

    #[test]
    fn raycast_obstacles_reports_zero_when_origin_is_inside_obstacle() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

        let hits = tilemap.raycast_obstacles(
            Transform2D { x: 5.0, y: 5.0 },
            Velocity { vx: 1.0, vy: 0.0 },
            0.0,
        );

        assert_eq!(
            hits,
            vec![TilemapShapeCastHit {
                layer_index: 0,
                tile_index: 0,
                distance: 0.0,
                point_x: 5.0,
                point_y: 5.0,
                normal_x: 0.0,
                normal_y: 0.0,
            }]
        );
    }

    #[test]
    fn segment_cast_obstacles_limits_hits_to_segment_endpoints() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);

        assert!(tilemap
            .segment_cast_obstacles(
                Transform2D { x: 0.0, y: 5.0 },
                Transform2D { x: 9.0, y: 5.0 }
            )
            .is_empty());

        let hits = tilemap.segment_cast_obstacles(
            Transform2D { x: 0.0, y: 5.0 },
            Transform2D { x: 10.0, y: 5.0 },
        );

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].distance, 10.0);
        assert_eq!(hits[0].tile_index, 1);
    }

    #[test]
    fn raycast_obstacles_skip_non_solid_metadata_and_clear_invalid_queries() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
        tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);
        tilemap.set_tile_one_way_platform(2);

        assert!(tilemap
            .raycast_obstacles(
                Transform2D { x: 0.0, y: 5.0 },
                Velocity { vx: 1.0, vy: 0.0 },
                30.0
            )
            .is_empty());

        let mut hits = vec![TilemapShapeCastHit {
            layer_index: 0,
            tile_index: 0,
            distance: 0.0,
            point_x: 0.0,
            point_y: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        }];
        tilemap.raycast_obstacles_into(
            Transform2D { x: 0.0, y: 5.0 },
            Velocity { vx: 0.0, vy: 0.0 },
            30.0,
            &mut hits,
        );

        assert!(hits.is_empty());
    }

    #[test]
    fn aabb_obstacle_contacts_return_merged_solid_overlap() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

        let hits =
            tilemap.aabb_obstacle_contacts(Transform2D { x: 9.0, y: 5.0 }, test_collider(2.0, 2.0));

        assert_eq!(
            hits,
            vec![TilemapContactHit {
                layer_index: 2,
                tile_index: 1,
                normal_x: -1.0,
                normal_y: 0.0,
                penetration: 1.0,
                point_x: 11.0,
                point_y: 5.0,
            }]
        );
    }

    #[test]
    fn aabb_obstacle_contacts_skip_non_solid_tile_metadata_and_clear_invalid_queries() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
        tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);
        tilemap.set_tile_one_way_platform(2);

        assert!(tilemap
            .aabb_obstacle_contacts(Transform2D { x: 10.0, y: 5.0 }, test_collider(12.0, 2.0))
            .is_empty());

        let mut hits = vec![TilemapContactHit {
            layer_index: 0,
            tile_index: 0,
            normal_x: 0.0,
            normal_y: 0.0,
            penetration: 0.0,
            point_x: 0.0,
            point_y: 0.0,
        }];
        tilemap.aabb_obstacle_contacts_into(
            Transform2D { x: 10.0, y: 5.0 },
            test_collider(-1.0, 2.0),
            &mut hits,
        );

        assert!(hits.is_empty());
    }

    #[test]
    fn aabb_obstacle_manifolds_return_two_face_points() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

        let hits = tilemap
            .aabb_obstacle_manifolds(Transform2D { x: 9.0, y: 5.0 }, test_collider(2.0, 2.0));

        assert_eq!(
            hits,
            vec![TilemapContactManifoldHit {
                layer_index: 2,
                tile_index: 1,
                point_count: 2,
                normal_x: -1.0,
                normal_y: 0.0,
                penetration: 1.0,
                points: [
                    TilemapContactPoint {
                        point_x: 11.0,
                        point_y: 3.0,
                        penetration: 1.0,
                    },
                    TilemapContactPoint {
                        point_x: 11.0,
                        point_y: 7.0,
                        penetration: 1.0,
                    },
                ],
            }]
        );
    }

    #[test]
    fn aabb_obstacle_manifolds_skip_non_solid_metadata_and_clear_invalid_queries() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
        tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);
        tilemap.set_tile_one_way_platform(2);

        assert!(tilemap
            .aabb_obstacle_manifolds(Transform2D { x: 10.0, y: 5.0 }, test_collider(12.0, 2.0))
            .is_empty());

        let mut hits = vec![TilemapContactManifoldHit {
            layer_index: 0,
            tile_index: 0,
            point_count: 1,
            normal_x: 0.0,
            normal_y: 0.0,
            penetration: 0.0,
            points: [TilemapContactPoint::default(); MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
        }];
        tilemap.aabb_obstacle_manifolds_into(
            Transform2D { x: 10.0, y: 5.0 },
            test_collider(-1.0, 2.0),
            &mut hits,
        );

        assert!(hits.is_empty());
    }

    #[test]
    fn collision_resolution_checks_merged_rect_once() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1]);
        let mut world = World::default();
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x: 9.0, y: 5.0 });
        world.set_aabb_collider(entity, test_collider(2.0, 2.0));
        let mut counters = PhysicsCounters::default();

        tilemap.resolve_dynamic_collisions_with_counters(&mut world, &mut counters);

        assert_eq!(counters.tile_candidate_checks, 2);
        assert_eq!(counters.kinematic_tile_hits, 1);
    }

    #[test]
    fn swept_aabb_contact_finds_nearest_solid_tile() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
        let mut stats = TilemapSweepStats::default();

        let hit = tilemap
            .swept_aabb_contact(
                Transform2D { x: 0.0, y: 5.0 },
                test_collider(2.0, 2.0),
                Velocity { vx: 20.0, vy: 0.0 },
                &mut stats,
            )
            .unwrap();

        assert_eq!(hit.layer_index, 0);
        assert_eq!(hit.tile_index, 1);
        assert!((hit.contact.time - 0.4).abs() < 0.01);
        assert_eq!(hit.contact.normal_x, 1.0);
        assert_eq!(hit.contact.normal_y, 0.0);
        assert!(stats.candidate_tiles > 0);
    }

    #[test]
    fn swept_aabb_contact_checks_merged_rect_once() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1]);
        let mut stats = TilemapSweepStats::default();

        let hit = tilemap
            .swept_aabb_contact(
                Transform2D { x: -5.0, y: 5.0 },
                test_collider(2.0, 2.0),
                Velocity { vx: 30.0, vy: 0.0 },
                &mut stats,
            )
            .unwrap();

        assert_eq!(hit.layer_index, 0);
        assert_eq!(hit.tile_index, 0);
        assert_eq!(stats.candidate_tiles, 1);
        assert!((hit.contact.time - 0.1).abs() < 0.01);
    }

    #[test]
    fn navigation_waypoint_uses_collision_layer_path() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(
            0,
            3,
            3,
            10.0,
            10.0,
            0.0,
            0.0,
            true,
            vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
        );

        let waypoint = tilemap
            .navigation_waypoint(
                Transform2D { x: 5.0, y: 5.0 },
                Transform2D { x: 25.0, y: 5.0 },
            )
            .unwrap();

        assert_eq!(waypoint, Transform2D { x: 5.0, y: 15.0 });
    }

    #[test]
    fn navigation_waypoint_with_scratch_reuses_buffers_and_resets_dirty_cells() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(
            0,
            3,
            3,
            10.0,
            10.0,
            0.0,
            0.0,
            true,
            vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
        );
        let mut scratch = TilemapNavigationScratch::default();

        let waypoint = tilemap
            .navigation_waypoint_with_scratch(
                Transform2D { x: 5.0, y: 5.0 },
                Transform2D { x: 25.0, y: 5.0 },
                &mut scratch,
            )
            .unwrap();
        let came_from_capacity = scratch.came_from.capacity();
        let g_scores_capacity = scratch.g_scores.capacity();
        let open_capacity = scratch.open.capacity();

        assert_eq!(waypoint, Transform2D { x: 5.0, y: 15.0 });
        assert!(scratch.visited.is_empty());
        assert!(scratch.came_from.iter().all(|cell| *cell == UNVISITED_CELL));
        assert!(scratch.g_scores.iter().all(|score| *score == u32::MAX));

        let waypoint = tilemap
            .navigation_waypoint_with_scratch(
                Transform2D { x: 5.0, y: 5.0 },
                Transform2D { x: 25.0, y: 5.0 },
                &mut scratch,
            )
            .unwrap();

        assert_eq!(waypoint, Transform2D { x: 5.0, y: 15.0 });
        assert_eq!(scratch.came_from.capacity(), came_from_capacity);
        assert_eq!(scratch.g_scores.capacity(), g_scores_capacity);
        assert_eq!(scratch.open.capacity(), open_capacity);
    }

    #[test]
    fn navigation_waypoint_is_none_without_collision_layer() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, false, vec![0, 0]);

        assert_eq!(
            tilemap.navigation_waypoint(
                Transform2D { x: 5.0, y: 5.0 },
                Transform2D { x: 15.0, y: 5.0 },
            ),
            None
        );
    }

    fn test_collider(half_width: f32, half_height: f32) -> AabbCollider {
        AabbCollider {
            half_width,
            half_height,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: true,
            layer: CollisionLayer::Player,
        }
    }
}
