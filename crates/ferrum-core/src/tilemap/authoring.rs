use super::collision_cache::{
    build_collision_chunk_cache_for_layer, build_collision_rects_for_layer_range,
    chunk_range_for_tile_range, collision_chunk_count, tile_range_for_chunk, tile_range_from_rect,
};
use super::queries::{normalized_or_default, tile_slope_definition_from_values};
use super::render_cache::{
    build_render_chunk_cache_for_layer, rebuild_render_chunks_for_layer_range,
    rebuild_render_chunks_for_layer_tile_id, render_chunk_count,
};
use super::{
    Hd2dBridgePortalDefinition, Hd2dRampAxis, Hd2dRampDefinition, Hd2dTileDefinition, Hd2dTileKind,
    TileDefinition, Tilemap, TilemapLayer,
};
use crate::components::{HeightSpan, PhysicsFloorId, SpriteFrame};

impl Tilemap {
    pub fn clear(&mut self) {
        self.definitions.clear();
        self.slope_definitions.clear();
        self.one_way_platform_definitions.clear();
        self.height_span_definitions.clear();
        self.hd2d_definitions.clear();
        self.bridge_portal_definitions.clear();
        self.layers.clear();
        self.collision_rects.clear();
        self.collision_rect_chunks.clear();
        self.render_chunks.clear();
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
        self.rebuild_render_chunks_for_tile_id(tile_id);
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

    pub fn set_tile_height_span_definition(
        &mut self,
        tile_id: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> bool {
        if tile_id == 0 {
            return false;
        }
        let Some(height_span) = HeightSpan::new(PhysicsFloorId(floor_id), elevation, height) else {
            return false;
        };
        let index = tile_id as usize;
        if index >= self.height_span_definitions.len() {
            self.height_span_definitions.resize(index + 1, None);
        }
        if self.height_span_definitions[index] == Some(height_span) {
            return false;
        }
        self.height_span_definitions[index] = Some(height_span);
        self.rebuild_collision_rects();
        true
    }

    pub fn clear_tile_height_span_definition(&mut self, tile_id: u32) -> bool {
        let index = tile_id as usize;
        if index == 0 || index >= self.height_span_definitions.len() {
            return false;
        }
        if self.height_span_definitions[index].is_none() {
            return false;
        }
        self.height_span_definitions[index] = None;
        self.rebuild_collision_rects();
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_tile_hd2d_definition(
        &mut self,
        tile_id: u32,
        kind_code: u32,
        blocks_movement: bool,
        blocks_projectile: bool,
        blocks_vision: bool,
        occluder_height: f32,
        has_ramp: bool,
        ramp_axis_code: u32,
        ramp_start_elevation: f32,
        ramp_end_elevation: f32,
    ) -> bool {
        if tile_id == 0 {
            return false;
        }
        let Some(kind) = Hd2dTileKind::from_code(kind_code) else {
            return false;
        };
        let ramp = if has_ramp {
            let Some(axis) = Hd2dRampAxis::from_code(ramp_axis_code) else {
                return false;
            };
            let Some(ramp) =
                Hd2dRampDefinition::new(axis, ramp_start_elevation, ramp_end_elevation)
            else {
                return false;
            };
            Some(ramp)
        } else {
            None
        };
        let Some(definition) = Hd2dTileDefinition::new(
            kind,
            blocks_movement,
            blocks_projectile,
            blocks_vision,
            occluder_height,
            ramp,
        ) else {
            return false;
        };
        let index = tile_id as usize;
        if index >= self.hd2d_definitions.len() {
            self.hd2d_definitions.resize(index + 1, None);
        }
        if self.hd2d_definitions[index] == Some(definition) {
            return false;
        }
        self.hd2d_definitions[index] = Some(definition);
        self.rebuild_collision_rects();
        true
    }

    pub fn clear_tile_hd2d_definition(&mut self, tile_id: u32) -> bool {
        let index = tile_id as usize;
        if index == 0 || index >= self.hd2d_definitions.len() {
            return false;
        }
        if self.hd2d_definitions[index].is_none() {
            return false;
        }
        self.hd2d_definitions[index] = None;
        self.rebuild_collision_rects();
        true
    }

    pub fn set_tile_bridge_portal_definition(
        &mut self,
        tile_id: u32,
        lower_floor_id: u32,
        upper_floor_id: u32,
        lower_elevation: f32,
        upper_elevation: f32,
        navigation_cost: u32,
    ) -> bool {
        if tile_id == 0 {
            return false;
        }
        let Some(definition) = Hd2dBridgePortalDefinition::new(
            PhysicsFloorId(lower_floor_id),
            PhysicsFloorId(upper_floor_id),
            lower_elevation,
            upper_elevation,
            navigation_cost,
        ) else {
            return false;
        };
        let index = tile_id as usize;
        if index >= self.bridge_portal_definitions.len() {
            self.bridge_portal_definitions.resize(index + 1, None);
        }
        if self.bridge_portal_definitions[index] == Some(definition) {
            return false;
        }
        self.bridge_portal_definitions[index] = Some(definition);
        true
    }

    pub fn clear_tile_bridge_portal_definition(&mut self, tile_id: u32) -> bool {
        let index = tile_id as usize;
        if index == 0 || index >= self.bridge_portal_definitions.len() {
            return false;
        }
        if self.bridge_portal_definitions[index].is_none() {
            return false;
        }
        self.bridge_portal_definitions[index] = None;
        true
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
        if index >= self.collision_rect_chunks.len() {
            self.collision_rect_chunks.resize_with(index + 1, || None);
        }
        if index >= self.render_chunks.len() {
            self.render_chunks.resize_with(index + 1, || None);
        }
        self.layers[index] = Some(layer);
        self.rebuild_collision_rects_for_layer(index);
        self.rebuild_render_chunks_for_layer(index);
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
            self.rebuild_collision_rect_chunks_for_layer(layer_index, column, row, 1, 1);
        }
        self.rebuild_render_chunks_for_layer_rect(layer_index, column, row, 1, 1);
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
            self.rebuild_collision_rect_chunks_for_layer(layer_index, column, row, width, height);
        }
        if changed {
            self.rebuild_render_chunks_for_layer_rect(layer_index, column, row, width, height);
        }
        changed
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_tiles_rect_with_rebuild_budget(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
        tile_id: u32,
        max_rebuilt_chunks: u32,
    ) -> bool {
        let layer_index_usize = layer_index as usize;
        let Some(rebuilt_chunks) = self.collision_rebuild_chunk_count_for_rect(
            layer_index_usize,
            column,
            row,
            width,
            height,
        ) else {
            return false;
        };
        if rebuilt_chunks > max_rebuilt_chunks {
            return false;
        }
        self.set_tiles_rect(layer_index, column, row, width, height, tile_id)
    }

    pub fn set_navigation_cost(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        cost: u32,
    ) -> bool {
        let layer_index = layer_index as usize;
        let Some(Some(layer)) = self.layers.get_mut(layer_index) else {
            return false;
        };
        if column >= layer.columns || row >= layer.rows {
            return false;
        }
        let tile_index = layer.tile_index(column, row);
        let Some(cell_cost) = layer.navigation_costs.get_mut(tile_index) else {
            return false;
        };
        if *cell_cost == cost {
            return false;
        }
        *cell_cost = cost;
        true
    }

    pub fn collision_cache_last_rebuilt_chunks(&self, layer_index: u32) -> u32 {
        self.collision_rect_chunks
            .get(layer_index as usize)
            .and_then(Option::as_ref)
            .map(|cache| cache.last_rebuilt_chunks)
            .unwrap_or(0)
    }

    pub fn collision_cache_total_rebuilt_chunks(&self, layer_index: u32) -> u32 {
        self.collision_rect_chunks
            .get(layer_index as usize)
            .and_then(Option::as_ref)
            .map(|cache| cache.total_rebuilt_chunks)
            .unwrap_or(0)
    }

    pub fn render_cache_last_rebuilt_chunks(&self, layer_index: u32) -> u32 {
        self.render_chunks
            .get(layer_index as usize)
            .and_then(Option::as_ref)
            .map(|cache| cache.last_rebuilt_chunks)
            .unwrap_or(0)
    }

    pub fn render_cache_total_rebuilt_chunks(&self, layer_index: u32) -> u32 {
        self.render_chunks
            .get(layer_index as usize)
            .and_then(Option::as_ref)
            .map(|cache| cache.total_rebuilt_chunks)
            .unwrap_or(0)
    }

    fn rebuild_collision_rects(&mut self) {
        let layer_count = self.layers.len();
        if self.collision_rects.len() < layer_count {
            self.collision_rects.resize_with(layer_count, || None);
        }
        if self.collision_rect_chunks.len() < layer_count {
            self.collision_rect_chunks.resize_with(layer_count, || None);
        }
        for index in 0..layer_count {
            self.rebuild_collision_rects_for_layer(index);
        }
    }

    fn rebuild_collision_rects_for_layer(&mut self, index: usize) {
        if index >= self.collision_rects.len() {
            self.collision_rects.resize_with(index + 1, || None);
        }
        if index >= self.collision_rect_chunks.len() {
            self.collision_rect_chunks.resize_with(index + 1, || None);
        }
        let Some(layer) = self.layers.get(index).and_then(Option::as_ref) else {
            self.collision_rects[index] = None;
            self.collision_rect_chunks[index] = None;
            return;
        };
        if !layer.collision {
            self.collision_rects[index] = None;
            self.collision_rect_chunks[index] = None;
            return;
        }

        let cache = build_collision_chunk_cache_for_layer(
            layer,
            &self.slope_definitions,
            &self.one_way_platform_definitions,
            &self.height_span_definitions,
            &self.hd2d_definitions,
        );
        self.collision_rects[index] = Some(cache.flattened_rects());
        self.collision_rect_chunks[index] = Some(cache);
    }

    fn rebuild_collision_rect_chunks_for_layer(
        &mut self,
        index: usize,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
    ) {
        if !self.collision_chunk_cache_matches_layer(index) {
            self.rebuild_collision_rects_for_layer(index);
            return;
        }

        let Some(layer) = self.layers.get(index).and_then(Option::as_ref) else {
            self.rebuild_collision_rects_for_layer(index);
            return;
        };
        if !layer.collision {
            self.rebuild_collision_rects_for_layer(index);
            return;
        }
        let Some(cache) = self.collision_rect_chunks[index].as_ref() else {
            self.rebuild_collision_rects_for_layer(index);
            return;
        };
        let Some(changed_range) = tile_range_from_rect(layer, column, row, width, height) else {
            self.rebuild_collision_rects_for_layer(index);
            return;
        };
        let chunk_range = chunk_range_for_tile_range(changed_range, cache);
        let mut rebuilt_chunks = Vec::new();
        for chunk_row in chunk_range.min_row..=chunk_range.max_row {
            for chunk_column in chunk_range.min_column..=chunk_range.max_column {
                let chunk_index = cache.chunk_index(chunk_column, chunk_row);
                let tile_range = tile_range_for_chunk(layer, chunk_column, chunk_row);
                let rects = build_collision_rects_for_layer_range(
                    layer,
                    tile_range,
                    &self.slope_definitions,
                    &self.one_way_platform_definitions,
                    &self.height_span_definitions,
                    &self.hd2d_definitions,
                );
                rebuilt_chunks.push((chunk_index, rects));
            }
        }

        let Some(cache) = self.collision_rect_chunks[index].as_mut() else {
            self.rebuild_collision_rects_for_layer(index);
            return;
        };
        let rebuilt_count = rebuilt_chunks.len() as u32;
        for (chunk_index, rects) in rebuilt_chunks {
            if let Some(chunk) = cache.chunks.get_mut(chunk_index) {
                *chunk = rects;
            }
        }
        cache.last_rebuilt_chunks = rebuilt_count;
        cache.total_rebuilt_chunks = cache.total_rebuilt_chunks.saturating_add(rebuilt_count);
    }

    fn collision_rebuild_chunk_count_for_rect(
        &self,
        index: usize,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
    ) -> Option<u32> {
        if width == 0 || height == 0 {
            return None;
        }
        let layer = self.layers.get(index).and_then(Option::as_ref)?;
        let end_column = column.checked_add(width)?;
        let end_row = row.checked_add(height)?;
        if end_column > layer.columns || end_row > layer.rows {
            return None;
        }
        if !layer.collision {
            return Some(0);
        }
        if !self.collision_chunk_cache_matches_layer(index) {
            return None;
        }
        let cache = self.collision_rect_chunks.get(index)?.as_ref()?;
        let changed_range = tile_range_from_rect(layer, column, row, width, height)?;
        let chunk_range = chunk_range_for_tile_range(changed_range, cache);
        Some(
            (chunk_range.max_column - chunk_range.min_column + 1)
                .saturating_mul(chunk_range.max_row - chunk_range.min_row + 1),
        )
    }

    fn collision_chunk_cache_matches_layer(&self, index: usize) -> bool {
        let Some(layer) = self.layers.get(index).and_then(Option::as_ref) else {
            return false;
        };
        let Some(cache) = self
            .collision_rect_chunks
            .get(index)
            .and_then(Option::as_ref)
        else {
            return false;
        };
        cache.chunk_columns == collision_chunk_count(layer.columns)
            && cache.chunk_rows == collision_chunk_count(layer.rows)
    }

    fn rebuild_render_chunks_for_layer(&mut self, index: usize) {
        if index >= self.render_chunks.len() {
            self.render_chunks.resize_with(index + 1, || None);
        }
        let Some(layer) = self.layers.get(index).and_then(Option::as_ref) else {
            self.render_chunks[index] = None;
            return;
        };
        self.render_chunks[index] =
            Some(build_render_chunk_cache_for_layer(layer, &self.definitions));
    }

    fn rebuild_render_chunks_for_tile_id(&mut self, tile_id: u32) {
        let layer_count = self.layers.len();
        if self.render_chunks.len() < layer_count {
            self.render_chunks.resize_with(layer_count, || None);
        }
        for index in 0..layer_count {
            self.rebuild_render_chunks_for_layer_tile_id(index, tile_id);
        }
    }

    fn rebuild_render_chunks_for_layer_tile_id(&mut self, index: usize, tile_id: u32) {
        if !self.render_chunk_cache_matches_layer(index) {
            self.rebuild_render_chunks_for_layer(index);
            return;
        }

        let Some(layer) = self.layers.get(index).and_then(Option::as_ref) else {
            self.rebuild_render_chunks_for_layer(index);
            return;
        };
        let Some(cache) = self.render_chunks.get_mut(index).and_then(Option::as_mut) else {
            self.rebuild_render_chunks_for_layer(index);
            return;
        };
        rebuild_render_chunks_for_layer_tile_id(layer, &self.definitions, tile_id, cache);
    }

    fn rebuild_render_chunks_for_layer_rect(
        &mut self,
        index: usize,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
    ) {
        if !self.render_chunk_cache_matches_layer(index) {
            self.rebuild_render_chunks_for_layer(index);
            return;
        }

        let Some(layer) = self.layers.get(index).and_then(Option::as_ref) else {
            self.rebuild_render_chunks_for_layer(index);
            return;
        };
        let Some(changed_range) = tile_range_from_rect(layer, column, row, width, height) else {
            self.rebuild_render_chunks_for_layer(index);
            return;
        };
        let Some(cache) = self.render_chunks.get_mut(index).and_then(Option::as_mut) else {
            self.rebuild_render_chunks_for_layer(index);
            return;
        };
        rebuild_render_chunks_for_layer_range(layer, &self.definitions, changed_range, cache);
    }

    fn render_chunk_cache_matches_layer(&self, index: usize) -> bool {
        let Some(layer) = self.layers.get(index).and_then(Option::as_ref) else {
            return false;
        };
        let Some(cache) = self.render_chunks.get(index).and_then(Option::as_ref) else {
            return false;
        };
        cache.chunk_columns == render_chunk_count(layer.columns)
            && cache.chunk_rows == render_chunk_count(layer.rows)
    }
}
