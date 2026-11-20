use wasm_bindgen::prelude::*;

use crate::components::{AabbCollider, CollisionLayer, Transform2D, Velocity};

use super::super::physics_bridge::PhysicsQueryResult;
use super::super::Engine;
use super::area_queries::physics_query_height_span;

#[wasm_bindgen]
impl Engine {
    pub fn query_nearest_tile_obstacle(&mut self, x: f32, y: f32, max_distance: f32) -> bool {
        if let Some(result) =
            self.query_native_tile_nearest(Transform2D { x, y }, max_distance, None)
        {
            return result;
        }

        let Some(hit) = self
            .tilemap
            .nearest_collision_obstacle(Transform2D { x, y }, max_distance)
        else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            point_x: hit.point_x,
            point_y: hit.point_y,
            distance: hit.distance,
        };
        true
    }

    pub fn query_nearest_tile_obstacle_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        max_distance: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> bool {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };
        if let Some(result) =
            self.query_native_tile_nearest(Transform2D { x, y }, max_distance, Some(height_span))
        {
            return result;
        }

        let Some(hit) = self.tilemap.nearest_collision_obstacle_with_height_span(
            Transform2D { x, y },
            max_distance,
            Some(height_span),
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            point_x: hit.point_x,
            point_y: hit.point_y,
            distance: hit.distance,
        };
        true
    }

    pub fn raycast_tile_obstacles(
        &mut self,
        origin_x: f32,
        origin_y: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
    ) -> u32 {
        if let Some(result) = self.query_native_tile_sweep(
            crate::collision::CollisionQueryShape::OrientedBox {
                center: Transform2D {
                    x: origin_x,
                    y: origin_y,
                },
                half_width: 0.,
                half_height: 0.,
                rotation_radians: 0.,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            None,
            true,
        ) {
            return result;
        }

        self.tilemap.raycast_obstacles_into(
            Transform2D {
                x: origin_x,
                y: origin_y,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            &mut self.physics_tile_shape_cast_scratch,
        );
        self.store_physics_tile_shape_cast_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn raycast_tile_obstacles_with_height_span(
        &mut self,
        origin_x: f32,
        origin_y: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_tile_shape_cast_hits.clear();
            return 0;
        };
        if let Some(result) = self.query_native_tile_sweep(
            crate::collision::CollisionQueryShape::OrientedBox {
                center: Transform2D {
                    x: origin_x,
                    y: origin_y,
                },
                half_width: 0.,
                half_height: 0.,
                rotation_radians: 0.,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            Some(height_span),
            true,
        ) {
            return result;
        }

        self.tilemap.raycast_obstacles_with_height_span_into(
            Transform2D {
                x: origin_x,
                y: origin_y,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            Some(height_span),
            &mut self.physics_tile_shape_cast_scratch,
        );
        self.store_physics_tile_shape_cast_hits_from_scratch()
    }

    pub fn segment_cast_tile_obstacles(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
    ) -> u32 {
        let dx = end_x - start_x;
        let dy = end_y - start_y;
        let distance = dx.hypot(dy);
        if let Some(result) = self.query_native_tile_sweep(
            crate::collision::CollisionQueryShape::OrientedBox {
                center: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                half_width: 0.,
                half_height: 0.,
                rotation_radians: 0.,
            },
            Velocity { vx: dx, vy: dy },
            distance,
            None,
            true,
        ) {
            return result;
        }

        self.tilemap.segment_cast_obstacles_into(
            Transform2D {
                x: start_x,
                y: start_y,
            },
            Transform2D { x: end_x, y: end_y },
            &mut self.physics_tile_shape_cast_scratch,
        );
        self.store_physics_tile_shape_cast_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn segment_cast_tile_obstacles_with_height_span(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_tile_shape_cast_hits.clear();
            return 0;
        };
        let dx = end_x - start_x;
        let dy = end_y - start_y;
        let distance = dx.hypot(dy);
        if let Some(result) = self.query_native_tile_sweep(
            crate::collision::CollisionQueryShape::OrientedBox {
                center: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                half_width: 0.,
                half_height: 0.,
                rotation_radians: 0.,
            },
            Velocity { vx: dx, vy: dy },
            distance,
            Some(height_span),
            true,
        ) {
            return result;
        }

        self.tilemap.segment_cast_obstacles_with_height_span_into(
            Transform2D {
                x: start_x,
                y: start_y,
            },
            Transform2D { x: end_x, y: end_y },
            Some(height_span),
            &mut self.physics_tile_shape_cast_scratch,
        );
        self.store_physics_tile_shape_cast_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_aabb_tile_obstacles(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
    ) -> u32 {
        if let Some(result) = self.query_native_tile_sweep(
            crate::collision::CollisionQueryShape::Aabb(crate::collision::AabbBounds {
                min_x: x - half_width,
                min_y: y - half_height,
                max_x: x + half_width,
                max_y: y + half_height,
            }),
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            None,
            false,
        ) {
            return result;
        }

        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        self.tilemap.shape_cast_aabb_obstacles_into(
            Transform2D { x, y },
            collider,
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            &mut self.physics_tile_shape_cast_scratch,
        );
        self.store_physics_tile_shape_cast_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_aabb_tile_obstacles_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_tile_shape_cast_hits.clear();
            return 0;
        };
        if let Some(result) = self.query_native_tile_sweep(
            crate::collision::CollisionQueryShape::Aabb(crate::collision::AabbBounds {
                min_x: x - half_width,
                min_y: y - half_height,
                max_x: x + half_width,
                max_y: y + half_height,
            }),
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            Some(height_span),
            false,
        ) {
            return result;
        }

        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        self.tilemap
            .shape_cast_aabb_obstacles_with_height_span_into(
                Transform2D { x, y },
                collider,
                Velocity {
                    vx: direction_x,
                    vy: direction_y,
                },
                max_distance,
                Some(height_span),
                &mut self.physics_tile_shape_cast_scratch,
            );
        self.store_physics_tile_shape_cast_hits_from_scratch()
    }

    pub fn query_aabb_tile_obstacle_contacts(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
    ) -> u32 {
        if let Some(result) = self.query_native_tile_contacts(
            Transform2D { x, y },
            [half_width, half_height],
            None,
            false,
        ) {
            return result;
        }

        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        self.tilemap.aabb_obstacle_contacts_into(
            Transform2D { x, y },
            collider,
            &mut self.physics_tile_contact_scratch,
        );
        self.store_physics_tile_contact_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_aabb_tile_obstacle_contacts_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_tile_contact_hits.clear();
            return 0;
        };
        if let Some(result) = self.query_native_tile_contacts(
            Transform2D { x, y },
            [half_width, half_height],
            Some(height_span),
            false,
        ) {
            return result;
        }

        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        self.tilemap.aabb_obstacle_contacts_with_height_span_into(
            Transform2D { x, y },
            collider,
            Some(height_span),
            &mut self.physics_tile_contact_scratch,
        );
        self.store_physics_tile_contact_hits_from_scratch()
    }

    pub fn query_aabb_tile_obstacle_manifolds(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
    ) -> u32 {
        if let Some(result) = self.query_native_tile_contacts(
            Transform2D { x, y },
            [half_width, half_height],
            None,
            true,
        ) {
            return result;
        }

        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        self.tilemap.aabb_obstacle_manifolds_into(
            Transform2D { x, y },
            collider,
            &mut self.physics_tile_manifold_scratch,
        );
        self.store_physics_tile_manifold_hits_from_scratch()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_aabb_tile_obstacle_manifolds_with_height_span(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> u32 {
        let Some(height_span) = physics_query_height_span(floor_id, elevation, height) else {
            self.physics_tile_manifold_hits.clear();
            return 0;
        };
        if let Some(result) = self.query_native_tile_contacts(
            Transform2D { x, y },
            [half_width, half_height],
            Some(height_span),
            true,
        ) {
            return result;
        }

        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        self.tilemap.aabb_obstacle_manifolds_with_height_span_into(
            Transform2D { x, y },
            collider,
            Some(height_span),
            &mut self.physics_tile_manifold_scratch,
        );
        self.store_physics_tile_manifold_hits_from_scratch()
    }
}
