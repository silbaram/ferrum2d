use wasm_bindgen::prelude::*;

use crate::components::{HeightSpan, PhysicsFloorId, Transform2D};

use super::physics_bridge::PhysicsQueryResult;
use super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn clear_shooter_tilemap(&mut self) {
        self.activate_built_in_shooter_scene();
        self.tilemap.clear();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tile(
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
        self.activate_built_in_shooter_scene();
        self.tilemap
            .set_tile_definition(tile_id, texture_id, u0, v0, u1, v1, r, g, b, a);
    }

    pub fn set_shooter_tile_slope(
        &mut self,
        tile_id: u32,
        local_x0: f32,
        local_y0: f32,
        local_x1: f32,
        local_y1: f32,
    ) {
        self.activate_built_in_shooter_scene();
        self.tilemap
            .set_tile_slope_definition(tile_id, local_x0, local_y0, local_x1, local_y1);
    }

    pub fn set_shooter_tile_one_way_platform(&mut self, tile_id: u32) {
        self.activate_built_in_shooter_scene();
        self.tilemap.set_tile_one_way_platform(tile_id);
    }

    pub fn clear_shooter_tile_one_way_platform(&mut self, tile_id: u32) {
        self.activate_built_in_shooter_scene();
        self.tilemap.clear_tile_one_way_platform(tile_id);
    }

    pub fn set_shooter_tile_height_span(
        &mut self,
        tile_id: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap
            .set_tile_height_span_definition(tile_id, floor_id, elevation, height)
    }

    pub fn clear_shooter_tile_height_span(&mut self, tile_id: u32) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap.clear_tile_height_span_definition(tile_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tile_hd2d_metadata(
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
        self.activate_built_in_shooter_scene();
        self.tilemap.set_tile_hd2d_definition(
            tile_id,
            kind_code,
            blocks_movement,
            blocks_projectile,
            blocks_vision,
            occluder_height,
            has_ramp,
            ramp_axis_code,
            ramp_start_elevation,
            ramp_end_elevation,
        )
    }

    pub fn clear_shooter_tile_hd2d_metadata(&mut self, tile_id: u32) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap.clear_tile_hd2d_definition(tile_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tile_bridge_portal(
        &mut self,
        tile_id: u32,
        lower_floor_id: u32,
        upper_floor_id: u32,
        lower_elevation: f32,
        upper_elevation: f32,
        navigation_cost: u32,
    ) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap.set_tile_bridge_portal_definition(
            tile_id,
            lower_floor_id,
            upper_floor_id,
            lower_elevation,
            upper_elevation,
            navigation_cost,
        )
    }

    pub fn clear_shooter_tile_bridge_portal(&mut self, tile_id: u32) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap.clear_tile_bridge_portal_definition(tile_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tilemap_layer(
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
        self.activate_built_in_shooter_scene();
        self.tilemap.set_layer(
            index,
            columns,
            rows,
            tile_width,
            tile_height,
            origin_x,
            origin_y,
            collision,
            tiles,
        );
    }

    pub fn set_shooter_tilemap_tile(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        tile_id: u32,
    ) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap.set_tile(layer_index, column, row, tile_id)
    }

    pub fn set_shooter_tilemap_tiles_rect(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
        tile_id: u32,
    ) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap
            .set_tiles_rect(layer_index, column, row, width, height, tile_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tilemap_tiles_rect_with_rebuild_budget(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
        tile_id: u32,
        max_rebuilt_chunks: u32,
    ) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap.set_tiles_rect_with_rebuild_budget(
            layer_index,
            column,
            row,
            width,
            height,
            tile_id,
            max_rebuilt_chunks,
        )
    }

    pub fn set_shooter_tilemap_navigation_cost(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        cost: u32,
    ) -> bool {
        self.activate_built_in_shooter_scene();
        self.tilemap
            .set_navigation_cost(layer_index, column, row, cost)
    }

    pub fn query_tilemap_navigation_waypoint(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
    ) -> bool {
        let Some(waypoint) = self.tilemap.navigation_waypoint_with_scratch(
            Transform2D {
                x: from_x,
                y: from_y,
            },
            Transform2D { x: to_x, y: to_y },
            &mut self.tilemap_navigation_scratch,
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: waypoint.x,
            point_y: waypoint.y,
            distance: ((waypoint.x - from_x).powi(2) + (waypoint.y - from_y).powi(2)).sqrt(),
        };
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_tilemap_navigation_waypoint_with_height_span(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> bool {
        let Some(height_span) = HeightSpan::new(PhysicsFloorId(floor_id), elevation, height) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };
        let Some(waypoint) = self.tilemap.navigation_waypoint_with_height_span_scratch(
            Transform2D {
                x: from_x,
                y: from_y,
            },
            Transform2D { x: to_x, y: to_y },
            height_span,
            &mut self.tilemap_navigation_scratch,
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: waypoint.x,
            point_y: waypoint.y,
            distance: ((waypoint.x - from_x).powi(2) + (waypoint.y - from_y).powi(2)).sqrt(),
        };
        true
    }

    pub fn query_tilemap_navigation_path(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
    ) -> bool {
        let from = Transform2D {
            x: from_x,
            y: from_y,
        };
        let Some(path) = self.tilemap.navigation_path_with_scratch(
            from,
            Transform2D { x: to_x, y: to_y },
            &mut self.tilemap_navigation_scratch,
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            self.tilemap_navigation_path_points.clear();
            self.tilemap_navigation_debug_lines.clear();
            return false;
        };

        let (first, distance) = Self::store_tilemap_navigation_path(
            &mut self.tilemap_navigation_path_points,
            &mut self.tilemap_navigation_debug_lines,
            from,
            path,
        );
        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: first.x,
            point_y: first.y,
            distance,
        };
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_tilemap_navigation_path_between_height_spans(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
        from_floor_id: u32,
        from_elevation: f32,
        from_height: f32,
        to_floor_id: u32,
        to_elevation: f32,
        to_height: f32,
    ) -> bool {
        let from = Transform2D {
            x: from_x,
            y: from_y,
        };
        let Some(from_height_span) =
            HeightSpan::new(PhysicsFloorId(from_floor_id), from_elevation, from_height)
        else {
            self.physics_query_result = PhysicsQueryResult::default();
            self.tilemap_navigation_path_points.clear();
            self.tilemap_navigation_debug_lines.clear();
            return false;
        };
        let Some(to_height_span) =
            HeightSpan::new(PhysicsFloorId(to_floor_id), to_elevation, to_height)
        else {
            self.physics_query_result = PhysicsQueryResult::default();
            self.tilemap_navigation_path_points.clear();
            self.tilemap_navigation_debug_lines.clear();
            return false;
        };
        let Some(path) = self.tilemap.navigation_path_between_height_spans_scratch(
            from,
            Transform2D { x: to_x, y: to_y },
            from_height_span,
            to_height_span,
            &mut self.tilemap_navigation_scratch,
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            self.tilemap_navigation_path_points.clear();
            self.tilemap_navigation_debug_lines.clear();
            return false;
        };

        let (first, distance) = Self::store_hd2d_tilemap_navigation_path(
            &mut self.tilemap_navigation_path_points,
            &mut self.tilemap_navigation_debug_lines,
            from,
            path,
        );
        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: first.x,
            point_y: first.y,
            distance,
        };
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_tilemap_navigation_path_with_height_span(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> bool {
        let from = Transform2D {
            x: from_x,
            y: from_y,
        };
        let Some(height_span) = HeightSpan::new(PhysicsFloorId(floor_id), elevation, height) else {
            self.physics_query_result = PhysicsQueryResult::default();
            self.tilemap_navigation_path_points.clear();
            self.tilemap_navigation_debug_lines.clear();
            return false;
        };
        let Some(path) = self.tilemap.navigation_path_with_height_span_scratch(
            from,
            Transform2D { x: to_x, y: to_y },
            height_span,
            &mut self.tilemap_navigation_scratch,
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            self.tilemap_navigation_path_points.clear();
            self.tilemap_navigation_debug_lines.clear();
            return false;
        };

        let (first, distance) = Self::store_tilemap_navigation_path_with_height_span(
            &mut self.tilemap_navigation_path_points,
            &mut self.tilemap_navigation_debug_lines,
            from,
            path,
            height_span,
        );
        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: first.x,
            point_y: first.y,
            distance,
        };
        true
    }
}
