use wasm_bindgen::prelude::*;

use crate::collision::{AabbBounds, CollisionQueryShape, CollisionSystem};
use crate::components::{CollisionMask, Transform2D, Velocity};

use super::super::Engine;
use super::area_queries::physics_query_height_span;

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn raycast_bodies(
        &mut self,
        origin_x: f32,
        origin_y: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        CollisionSystem::raycast_all_into(
            &self.world,
            Transform2D {
                x: origin_x,
                y: origin_y,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
            &mut self.physics_raycast_scratch,
        );
        self.store_physics_raycast_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn raycast_bodies_with_height_span(
        &mut self,
        origin_x: f32,
        origin_y: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        CollisionSystem::raycast_all_with_height_span_into(
            &self.world,
            Transform2D {
                x: origin_x,
                y: origin_y,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
            Some(height_span),
            &mut self.physics_raycast_scratch,
        );
        self.store_physics_raycast_hits_from_scratch()
    }

    pub fn segment_cast_bodies(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        query_mask_bits: u32,
    ) -> u32 {
        CollisionSystem::segment_cast_all_into(
            &self.world,
            Transform2D {
                x: start_x,
                y: start_y,
            },
            Transform2D { x: end_x, y: end_y },
            CollisionMask::from_bits(query_mask_bits),
            &mut self.physics_raycast_scratch,
        );
        self.store_physics_raycast_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn segment_cast_bodies_with_height_span(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        CollisionSystem::segment_cast_all_with_height_span_into(
            &self.world,
            Transform2D {
                x: start_x,
                y: start_y,
            },
            Transform2D { x: end_x, y: end_y },
            CollisionMask::from_bits(query_mask_bits),
            Some(height_span),
            &mut self.physics_raycast_scratch,
        );
        self.store_physics_raycast_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_aabb_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(bounds) = AabbBounds::from_center(Transform2D { x, y }, half_width, half_height)
        else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::Aabb(bounds),
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_aabb_bodies_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(bounds) = AabbBounds::from_center(Transform2D { x, y }, half_width, half_height)
        else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits_with_height_span(
            CollisionQueryShape::Aabb(bounds),
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
            height_span,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_circle_bodies(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::Circle {
                center: Transform2D { x, y },
                radius,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_circle_bodies_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits_with_height_span(
            CollisionQueryShape::Circle {
                center: Transform2D { x, y },
                radius,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
            height_span,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_oriented_box_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x, y },
                half_width,
                half_height,
                rotation_radians,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_oriented_box_bodies_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits_with_height_span(
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x, y },
                half_width,
                half_height,
                rotation_radians,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
            height_span,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_capsule_bodies(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                end: Transform2D { x: end_x, y: end_y },
                radius,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_capsule_bodies_with_height_span(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits_with_height_span(
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                end: Transform2D { x: end_x, y: end_y },
                radius,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
            height_span,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_convex_polygon_bodies(
        &mut self,
        vertex_values: Vec<f32>,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(shape) = Self::convex_polygon_query_shape(&vertex_values) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits(
            shape,
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_convex_polygon_bodies_with_height_span(
        &mut self,
        vertex_values: Vec<f32>,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(shape) = Self::convex_polygon_query_shape(&vertex_values) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits_with_height_span(
            shape,
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
            height_span,
        )
    }
}
