use wasm_bindgen::prelude::*;

use crate::components::{
    AabbCollider, CapsuleCollider, ChainCollider, CircleCollider, CollisionFilter, CollisionMask,
    ConvexPolygonCollider, EdgeCollider, OrientedBoxCollider, Transform2D,
};

use super::super::{physics_bridge::PhysicsEntitySnapshot, Engine};

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_aabb_body(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y)
            || !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
        {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_aabb(
            body_type,
            mass_or_density,
            use_density,
            half_width,
            half_height,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_aabb_collider(
            entity,
            AabbCollider::new(
                half_width,
                half_height,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_circle_body(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) || !Self::valid_positive(radius) {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_circle(
            body_type,
            mass_or_density,
            use_density,
            radius,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_circle_collider(
            entity,
            CircleCollider::new(radius, is_trigger, Self::collision_layer_from_code(layer))
                .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_capsule_body(
        &mut self,
        x: f32,
        y: f32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y)
            || !Self::valid_transform(start_x, start_y)
            || !Self::valid_transform(end_x, end_y)
            || !Self::valid_positive(radius)
        {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_capsule(
            body_type,
            mass_or_density,
            use_density,
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_capsule_collider(
            entity,
            CapsuleCollider::new(
                start_x,
                start_y,
                end_x,
                end_y,
                radius,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_edge_body(
        &mut self,
        x: f32,
        y: f32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) || !Self::valid_edge(start_x, start_y, end_x, end_y) {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_edge(
            body_type,
            mass_or_density,
            use_density,
            start_x,
            start_y,
            end_x,
            end_y,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_edge_collider(
            entity,
            EdgeCollider::new(
                start_x,
                start_y,
                end_x,
                end_y,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_chain_body(
        &mut self,
        x: f32,
        y: f32,
        vertex_values: Vec<f32>,
        looped: bool,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some((vertices, vertex_count)) = Self::chain_vertices(&vertex_values, looped) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let Some(body) = Self::rigid_body_for_chain(
            body_type,
            mass_or_density,
            use_density,
            vertices,
            vertex_count,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_chain_collider(
            entity,
            ChainCollider::new(
                vertices,
                vertex_count,
                looped,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_oriented_box_body(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y)
            || !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !rotation_radians.is_finite()
        {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_oriented_box(
            body_type,
            mass_or_density,
            use_density,
            half_width,
            half_height,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_oriented_box_collider(
            entity,
            OrientedBoxCollider::new(
                half_width,
                half_height,
                rotation_radians,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_convex_polygon_body(
        &mut self,
        x: f32,
        y: f32,
        vertex_values: Vec<f32>,
        rotation_radians: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) || !rotation_radians.is_finite() {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some((vertices, vertex_count)) = Self::convex_polygon_vertices(&vertex_values) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let Some(body) = Self::rigid_body_for_convex_polygon(
            body_type,
            mass_or_density,
            use_density,
            vertices,
            vertex_count,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_convex_polygon_collider(
            entity,
            ConvexPolygonCollider::new(
                vertices,
                vertex_count,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_rotation(rotation_radians)
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }
}
