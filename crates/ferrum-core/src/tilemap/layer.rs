use super::{TileRange, TilemapLayer};
use crate::collision::AabbBounds;
use crate::components::{AabbCollider, CollisionLayer, Transform2D};

use super::queries::{finite_or_default, is_positive, tile_axis_index};

impl TilemapLayer {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn from_values(
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
            navigation_costs: vec![0; expected_len],
        })
    }

    pub(super) fn tile_center(&self, tile_index: usize) -> Transform2D {
        let column = (tile_index as u32 % self.columns) as f32;
        let row = (tile_index as u32 / self.columns) as f32;
        Transform2D {
            x: self.origin_x + column * self.tile_width + self.tile_width * 0.5,
            y: self.origin_y + row * self.tile_height + self.tile_height * 0.5,
        }
    }

    pub(super) fn tile_index(&self, column: u32, row: u32) -> usize {
        (row * self.columns + column) as usize
    }

    pub(super) fn tile_bounds(&self, column: u32, row: u32) -> AabbBounds {
        AabbBounds {
            min_x: self.origin_x + column as f32 * self.tile_width,
            min_y: self.origin_y + row as f32 * self.tile_height,
            max_x: self.origin_x + (column + 1) as f32 * self.tile_width,
            max_y: self.origin_y + (row + 1) as f32 * self.tile_height,
        }
    }

    pub(super) fn tile_aabb_collider(&self, dynamic_layer: CollisionLayer) -> AabbCollider {
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

    pub(super) fn candidate_tile_range_for_bounds(&self, bounds: AabbBounds) -> Option<TileRange> {
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
}
