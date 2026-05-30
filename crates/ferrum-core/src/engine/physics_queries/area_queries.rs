use wasm_bindgen::prelude::*;

use crate::collision::{AabbBounds, CollisionQueryShape, CollisionSystem};
use crate::components::{CollisionMask, HeightSpan, PhysicsFloorId, Transform2D};

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn query_point_bodies(&mut self, x: f32, y: f32, query_mask_bits: u32) -> u32 {
        CollisionSystem::point_query_into(
            &self.world,
            Transform2D { x, y },
            CollisionMask::from_bits(query_mask_bits),
            &mut self.physics_point_query_scratch,
        );
        self.store_physics_query_entities_from_point_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_point_bodies_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_query_hits.clear();
            return 0;
        };
        CollisionSystem::point_query_with_height_span_into(
            &self.world,
            Transform2D { x, y },
            CollisionMask::from_bits(query_mask_bits),
            Some(height_span),
            &mut self.physics_point_query_scratch,
        );
        self.store_physics_query_entities_from_point_scratch()
    }

    pub fn query_aabb_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(bounds) = AabbBounds::from_center(Transform2D { x, y }, half_width, half_height)
        else {
            self.physics_query_hits.clear();
            return 0;
        };
        CollisionSystem::aabb_query_into(
            &self.world,
            bounds,
            CollisionMask::from_bits(query_mask_bits),
            &mut self.physics_aabb_query_scratch,
        );
        self.store_physics_query_entities_from_aabb_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_aabb_bodies_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(bounds) = AabbBounds::from_center(Transform2D { x, y }, half_width, half_height)
        else {
            self.physics_query_hits.clear();
            return 0;
        };
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_query_hits.clear();
            return 0;
        };
        CollisionSystem::aabb_query_with_height_span_into(
            &self.world,
            bounds,
            CollisionMask::from_bits(query_mask_bits),
            Some(height_span),
            &mut self.physics_aabb_query_scratch,
        );
        self.store_physics_query_entities_from_aabb_scratch()
    }

    pub fn query_circle_bodies(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        query_mask_bits: u32,
    ) -> u32 {
        CollisionSystem::circle_query_into(
            &self.world,
            Transform2D { x, y },
            radius,
            CollisionMask::from_bits(query_mask_bits),
            &mut self.physics_circle_query_scratch,
        );
        self.store_physics_query_entities_from_circle_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_circle_bodies_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_query_hits.clear();
            return 0;
        };
        CollisionSystem::circle_query_with_height_span_into(
            &self.world,
            Transform2D { x, y },
            radius,
            CollisionMask::from_bits(query_mask_bits),
            Some(height_span),
            &mut self.physics_circle_query_scratch,
        );
        self.store_physics_query_entities_from_circle_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_oriented_box_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_query_entities(
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x, y },
                half_width,
                half_height,
                rotation_radians,
            },
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_oriented_box_bodies_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_query_hits.clear();
            return 0;
        };
        self.store_physics_shape_query_entities_with_height_span(
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x, y },
                half_width,
                half_height,
                rotation_radians,
            },
            query_mask_bits,
            height_span,
        )
    }

    pub fn query_capsule_bodies(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_query_entities(
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                end: Transform2D { x: end_x, y: end_y },
                radius,
            },
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_capsule_bodies_with_height_span(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_query_hits.clear();
            return 0;
        };
        self.store_physics_shape_query_entities_with_height_span(
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                end: Transform2D { x: end_x, y: end_y },
                radius,
            },
            query_mask_bits,
            height_span,
        )
    }

    pub fn query_convex_polygon_bodies(
        &mut self,
        vertex_values: Vec<f32>,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(shape) = Self::convex_polygon_query_shape(&vertex_values) else {
            self.physics_query_hits.clear();
            return 0;
        };
        self.store_physics_shape_query_entities(shape, query_mask_bits)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_convex_polygon_bodies_with_height_span(
        &mut self,
        vertex_values: Vec<f32>,
        query_mask_bits: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(shape) = Self::convex_polygon_query_shape(&vertex_values) else {
            self.physics_query_hits.clear();
            return 0;
        };
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_query_hits.clear();
            return 0;
        };
        self.store_physics_shape_query_entities_with_height_span(
            shape,
            query_mask_bits,
            height_span,
        )
    }
}

pub(in crate::engine) fn physics_query_height_span(
    floor_id: u32,
    elevation: f32,
    height: f32,
) -> Option<HeightSpan> {
    HeightSpan::new(PhysicsFloorId(floor_id), elevation, height)
}
