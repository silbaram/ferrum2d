use super::super::queries::best_tile_slope_hit_is_better;
use super::super::{
    TileSlopeDefinition, Tilemap, TilemapLayer, TilemapSlopeGroundHit, TILE_SWEEP_EPSILON,
};
use crate::collision::AabbBounds;
use crate::physics::{SlopeConfig, SlopeSegment};

impl Tilemap {
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

    fn slope_definition(&self, tile_id: u32) -> Option<TileSlopeDefinition> {
        self.slope_definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
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
}
