use std::cmp::Ordering;
use std::collections::BinaryHeap;

use crate::camera::Camera2D;
use crate::collision::{AabbBounds, CollisionSystem, SweptAabbContactHit};
use crate::components::{AabbCollider, CollisionLayer, SpriteFrame, Transform2D, Velocity};
use crate::physics::PhysicsCounters;
use crate::render_command::SpriteRenderCommand;
use crate::world::World;

const MAX_NAVIGATION_CELLS: usize = 4096;
const MAX_TILE_COLLISION_RESOLUTION_STEPS: usize = 4;
const TILE_SWEEP_EPSILON: f32 = 0.0001;
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
    layers: Vec<Option<TilemapLayer>>,
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
        self.layers.clear();
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
        self.layers[index] = Some(layer);
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
            if !is_tilemap_blocked_layer(collider.layer) {
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

            for row in range.min_row..=range.max_row {
                for column in range.min_column..=range.max_column {
                    stats.candidate_tiles = stats.candidate_tiles.saturating_add(1);
                    let tile_index = layer.tile_index(column, row);
                    if layer.tiles.get(tile_index).copied().unwrap_or(0) == 0 {
                        continue;
                    }

                    let static_collider = AabbCollider {
                        half_width: layer.tile_width * 0.5,
                        half_height: layer.tile_height * 0.5,
                        is_trigger: false,
                        layer: collider.layer,
                    };
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
                    if contact.time <= TILE_SWEEP_EPSILON
                        && CollisionSystem::aabb_contact(
                            start,
                            collider,
                            tile_center,
                            static_collider,
                        )
                        .is_none()
                    {
                        continue;
                    }
                    let into_normal =
                        displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                    if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                        continue;
                    }

                    if best_tile_hit_is_better(&best, contact, layer_index, tile_index) {
                        best = Some(TilemapSweepHit {
                            layer_index,
                            tile_index,
                            contact,
                        });
                    }
                }
            }
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
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            for _ in 0..MAX_TILE_COLLISION_RESOLUTION_STEPS {
                let Some(range) = layer.candidate_tile_range(*transform, collider) else {
                    break;
                };
                let mut resolved = false;

                'tiles: for row in range.min_row..=range.max_row {
                    for column in range.min_column..=range.max_column {
                        stats.candidate_tiles = stats.candidate_tiles.saturating_add(1);
                        let tile_index = layer.tile_index(column, row);
                        if layer.tiles.get(tile_index).copied().unwrap_or(0) == 0 {
                            continue;
                        }
                        let tile_center = layer.tile_center(tile_index);
                        if resolve_dynamic_aabb_against_static(
                            transform,
                            collider,
                            tile_center,
                            layer.tile_width * 0.5,
                            layer.tile_height * 0.5,
                        ) {
                            resolved = true;
                            stats.hit_tiles = stats.hit_tiles.saturating_add(1);
                            break 'tiles;
                        }
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

    fn candidate_tile_range(
        &self,
        transform: Transform2D,
        collider: AabbCollider,
    ) -> Option<TileRange> {
        self.candidate_tile_range_for_bounds(AabbBounds::from_transform(transform, collider))
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

fn tile_axis_index(value: f32, origin: f32, tile_size: f32, max_index: u32) -> u32 {
    ((value - origin) / tile_size)
        .floor()
        .clamp(0.0, max_index as f32) as u32
}

fn is_positive(value: f32) -> bool {
    value.is_finite() && value > 0.0
}

fn finite_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

fn normalized_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
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
            .candidate_tile_range(Transform2D { x: 25.0, y: 15.0 }, test_collider(4.0, 4.0))
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
            is_trigger: true,
            layer: CollisionLayer::Player,
        }
    }
}
