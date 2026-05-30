use super::super::queries::{
    best_tile_hit_is_better, sort_tile_linear_hits, tile_height_span_allows,
    tile_height_span_allows_movement, tile_raycast_bounds, tile_raycast_query_is_valid,
    tile_segment_direction_and_distance, tile_shape_cast_query_is_valid,
    tile_shape_cast_unit_direction, tilemap_raycast_bounds, tilemap_shape_cast_hit_from_contact,
};
use super::super::{
    Tilemap, TilemapShapeCastHit, TilemapSweepHit, TilemapSweepStats, TILE_SWEEP_EPSILON,
};
use crate::collision::{AabbBounds, CollisionSystem};
use crate::components::{AabbCollider, HeightSpan, Transform2D, Velocity};

impl Tilemap {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn swept_aabb_contact(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        displacement: Velocity,
        stats: &mut TilemapSweepStats,
    ) -> Option<TilemapSweepHit> {
        self.swept_aabb_contact_internal(start, collider, displacement, None, stats)
    }

    pub(crate) fn swept_aabb_contact_with_movement_height_span(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        displacement: Velocity,
        query_height_span: Option<HeightSpan>,
        stats: &mut TilemapSweepStats,
    ) -> Option<TilemapSweepHit> {
        self.swept_aabb_contact_internal(start, collider, displacement, query_height_span, stats)
    }

    fn swept_aabb_contact_internal(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        displacement: Velocity,
        query_height_span: Option<HeightSpan>,
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

            self.visit_collision_rect_candidates(layer_index, range, |rect| {
                if !tile_height_span_allows_movement(rect, query_height_span) {
                    stats.hd2d_filtered_tiles = stats.hd2d_filtered_tiles.saturating_add(1);
                    return true;
                }
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(swept_bounds) {
                    return true;
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
                    return true;
                };
                if contact.time <= TILE_SWEEP_EPSILON
                    && CollisionSystem::aabb_contact(start, collider, rect_center, static_collider)
                        .is_none()
                {
                    return true;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    return true;
                }

                if best_tile_hit_is_better(&best, contact, layer_index, rect.tile_index) {
                    best = Some(TilemapSweepHit {
                        layer_index,
                        tile_index: rect.tile_index,
                        contact,
                    });
                }
                true
            });

            self.update_one_way_tile_swept_hit_for_range(
                layer_index,
                layer,
                range,
                swept_bounds,
                start,
                collider,
                displacement,
                query_height_span,
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
        self.shape_cast_aabb_obstacles_with_height_span_into(
            start,
            collider,
            direction,
            max_distance,
            None,
            hits,
        );
    }

    pub fn shape_cast_aabb_obstacles_with_height_span_into(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        direction: Velocity,
        max_distance: f32,
        query_height_span: Option<HeightSpan>,
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

            self.visit_collision_rect_candidates(layer_index, range, |rect| {
                if !tile_height_span_allows(rect, query_height_span) {
                    return true;
                }
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(swept_bounds) {
                    return true;
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
                    return true;
                };
                if contact.time <= TILE_SWEEP_EPSILON
                    && CollisionSystem::aabb_contact(start, collider, rect_center, static_collider)
                        .is_none()
                {
                    return true;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    return true;
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
                true
            });

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
                query_height_span,
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
        self.raycast_obstacles_with_height_span_into(origin, direction, max_distance, None, hits);
    }

    pub fn raycast_obstacles_with_height_span_into(
        &self,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_height_span: Option<HeightSpan>,
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

            self.visit_collision_rect_candidates(layer_index, range, |rect| {
                if !tile_height_span_allows(rect, query_height_span) {
                    return true;
                }
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(ray_bounds) {
                    return true;
                }
                let Some(hit) =
                    tilemap_raycast_bounds(origin, unit_x, unit_y, max_distance, rect_bounds)
                else {
                    return true;
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
                true
            });
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
        self.segment_cast_obstacles_with_height_span_into(start, end, None, hits);
    }

    pub fn segment_cast_obstacles_with_height_span_into(
        &self,
        start: Transform2D,
        end: Transform2D,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<TilemapShapeCastHit>,
    ) {
        hits.clear();
        let Some((direction, max_distance)) = tile_segment_direction_and_distance(start, end)
        else {
            return;
        };
        self.raycast_obstacles_with_height_span_into(
            start,
            direction,
            max_distance,
            query_height_span,
            hits,
        );
    }
}
