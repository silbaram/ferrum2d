use super::super::queries::{
    one_way_tile_contact_blocks, tile_id_height_span_allows, tile_id_height_span_allows_movement,
    tilemap_shape_cast_hit_from_contact,
};
use super::super::{
    TileRange, Tilemap, TilemapLayer, TilemapShapeCastHit, TilemapSweepHit, TILE_SWEEP_EPSILON,
};
use crate::collision::{AabbBounds, CollisionSystem};
use crate::components::{AabbCollider, HeightSpan, Transform2D, Velocity};

impl Tilemap {
    fn is_one_way_platform_tile(&self, tile_id: u32) -> bool {
        tile_id != 0
            && self
                .one_way_platform_definitions
                .get(tile_id as usize)
                .copied()
                .unwrap_or(false)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn update_one_way_tile_swept_hit_for_range(
        &self,
        layer_index: usize,
        layer: &TilemapLayer,
        range: TileRange,
        swept_bounds: AabbBounds,
        start: Transform2D,
        collider: AabbCollider,
        displacement: Velocity,
        query_height_span: Option<HeightSpan>,
        mut stats: Option<&mut super::super::TilemapSweepStats>,
        best: &mut Option<TilemapSweepHit>,
    ) {
        for row in range.min_row..=range.max_row {
            for column in range.min_column..=range.max_column {
                let tile_index = layer.tile_index(column, row);
                let tile_id = layer.tiles.get(tile_index).copied().unwrap_or(0);
                if !self.is_one_way_platform_tile(tile_id) {
                    continue;
                }
                if !tile_id_height_span_allows_movement(
                    tile_id,
                    &self.height_span_definitions,
                    query_height_span,
                ) {
                    if let Some(stats) = stats.as_deref_mut() {
                        stats.hd2d_filtered_tiles = stats.hd2d_filtered_tiles.saturating_add(1);
                    }
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

                if super::super::queries::best_tile_hit_is_better(
                    best,
                    contact,
                    layer_index,
                    tile_index,
                ) {
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
    pub(super) fn append_one_way_tile_shape_cast_hits_for_range(
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
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<TilemapShapeCastHit>,
    ) {
        for row in range.min_row..=range.max_row {
            for column in range.min_column..=range.max_column {
                let tile_index = layer.tile_index(column, row);
                let tile_id = layer.tiles.get(tile_index).copied().unwrap_or(0);
                if !self.is_one_way_platform_tile(tile_id) {
                    continue;
                }
                if !tile_id_height_span_allows(
                    tile_id,
                    &self.height_span_definitions,
                    query_height_span,
                ) {
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
