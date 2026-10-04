use super::scenes::SceneMode;
use super::Engine;
use crate::tilemap::Tilemap;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Replaces the scene-owned XY navigation grid. 0 blocks a cell; positive costs are walkable.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_navigation(
        &mut self,
        columns: u32,
        rows: u32,
        cell_width: f32,
        cell_height: f32,
        origin_x: f32,
        origin_y: f32,
        costs: &[u32],
    ) -> bool {
        let cells = u64::from(columns) * u64::from(rows);
        if self.scene_mode != SceneMode::Data
            || cells == 0
            || cells > 4096
            || costs.len() as u64 != cells
            || costs.iter().any(|cost| *cost > 65535)
            || !cell_width.is_finite()
            || cell_width <= 0.0
            || !cell_height.is_finite()
            || cell_height <= 0.0
            || !origin_x.is_finite()
            || !origin_y.is_finite()
            || !(origin_x + columns as f32 * cell_width).is_finite()
            || !(origin_y + rows as f32 * cell_height).is_finite()
        {
            return false;
        }
        let mut grid = Tilemap::default();
        grid.set_layer(
            0,
            columns,
            rows,
            cell_width,
            cell_height,
            origin_x,
            origin_y,
            true,
            costs.iter().map(|cost| u32::from(*cost == 0)).collect(),
        );
        for (index, cost) in costs.iter().copied().enumerate() {
            grid.set_navigation_cost(0, index as u32 % columns, index as u32 / columns, cost);
        }
        self.data_scene.navigation = grid;
        self.frame_buffers.clear_tilemap_navigation_output();
        true
    }

    /// Changes one grid cell without changing the scene or physics colliders.
    pub fn set_data_scene_navigation_cost(&mut self, column: u32, row: u32, cost: u32) -> bool {
        if self.scene_mode != SceneMode::Data || cost > 65535 {
            return false;
        }
        let grid = &mut self.data_scene.navigation;
        let tile_changed = grid.set_tile(0, column, row, u32::from(cost == 0));
        let cost_changed = grid.set_navigation_cost(0, column, row, cost);
        if tile_changed || cost_changed {
            self.frame_buffers.clear_tilemap_navigation_output();
        }
        tile_changed || cost_changed
    }

    /// Clears only Data Scene navigation; unsupported scenes are left untouched.
    pub fn clear_data_scene_navigation(&mut self) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        self.data_scene.navigation.clear();
        self.frame_buffers.clear_tilemap_navigation_output();
        true
    }
}
