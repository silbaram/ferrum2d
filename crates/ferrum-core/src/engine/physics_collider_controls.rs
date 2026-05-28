use wasm_bindgen::prelude::*;

use crate::components::{
    AabbCollider, CapsuleCollider, ChainCollider, CircleCollider, CompoundColliderShape,
    ConvexPolygonCollider, EdgeCollider, OrientedBoxCollider, PhysicsMaterial, Velocity,
};
use crate::entity::Entity;

use super::Engine;

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_aabb_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        half_width: f32,
        half_height: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Aabb(
                AabbCollider::new(
                    half_width,
                    half_height,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_circle_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_positive(radius) || !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Circle(
                CircleCollider::new(radius, is_trigger, Self::collision_layer_from_code(layer))
                    .with_offset(offset_x, offset_y)
                    .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_capsule_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_transform(start_x, start_y)
            || !Self::valid_transform(end_x, end_y)
            || !Self::valid_positive(radius)
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Capsule(
                CapsuleCollider::new(
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    radius,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_edge_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_edge(start_x, start_y, end_x, end_y)
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Edge(
                EdgeCollider::new(
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_chain_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        vertex_values: Vec<f32>,
        looped: bool,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        let Some((vertices, vertex_count)) = Self::chain_vertices(&vertex_values, looped) else {
            return false;
        };
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Chain(
                ChainCollider::new(
                    vertices,
                    vertex_count,
                    looped,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_oriented_box_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !rotation_radians.is_finite()
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::OrientedBox(
                OrientedBoxCollider::new(
                    half_width,
                    half_height,
                    rotation_radians,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_convex_polygon_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        vertex_values: Vec<f32>,
        rotation_radians: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !rotation_radians.is_finite() || !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        let Some((vertices, vertex_count)) = Self::convex_polygon_vertices(&vertex_values) else {
            return false;
        };
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::ConvexPolygon(
                ConvexPolygonCollider::new(
                    vertices,
                    vertex_count,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_rotation(rotation_radians)
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_physics_compound_collider_material(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        collider_index: u32,
        restitution: f32,
        friction: f32,
        surface_velocity_x: f32,
        surface_velocity_y: f32,
        density: f32,
        contact_baumgarte_bias_scale: f32,
        max_contact_baumgarte_bias_velocity_scale: f32,
        contact_position_correction_scale: f32,
        contact_position_correction_slop_scale: f32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let material = PhysicsMaterial {
            restitution,
            friction,
            surface_velocity: Velocity {
                vx: surface_velocity_x,
                vy: surface_velocity_y,
            },
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        };
        if !Self::valid_physics_material_parts(
            material.restitution,
            material.friction,
            material.surface_velocity.vx,
            material.surface_velocity.vy,
            material.density,
            material.contact_baumgarte_bias_scale,
            material.max_contact_baumgarte_bias_velocity_scale,
            material.contact_position_correction_scale,
            material.contact_position_correction_slop_scale,
        ) {
            return false;
        }
        if !self
            .world
            .set_compound_collider_material(entity, collider_index, material)
        {
            return false;
        }
        self.store_physics_entity_snapshot(entity)
    }

    pub fn set_physics_collider_offset(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        offset_x: f32,
        offset_y: f32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.set_physics_collider_offset_for_entity(entity, offset_x, offset_y)
    }

    pub(super) fn set_physics_collider_offset_for_entity(
        &mut self,
        entity: Entity,
        offset_x: f32,
        offset_y: f32,
    ) -> bool {
        if !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        if let Some(collider) = self.world.collider(entity) {
            self.world
                .set_aabb_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.circle_collider(entity) {
            self.world
                .set_circle_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.oriented_box_collider(entity) {
            self.world
                .set_oriented_box_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.capsule_collider(entity) {
            self.world
                .set_capsule_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.edge_collider(entity) {
            self.world
                .set_edge_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.chain_collider(entity) {
            self.world
                .set_chain_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.convex_polygon_collider(entity) {
            self.world
                .set_convex_polygon_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        false
    }

    pub fn set_physics_collider_enabled(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        enabled: bool,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.set_physics_collider_enabled_for_entity(entity, enabled)
    }

    pub(super) fn set_physics_collider_enabled_for_entity(
        &mut self,
        entity: Entity,
        enabled: bool,
    ) -> bool {
        if let Some(collider) = self.world.collider(entity) {
            self.world
                .set_aabb_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.circle_collider(entity) {
            self.world
                .set_circle_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.oriented_box_collider(entity) {
            self.world
                .set_oriented_box_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.capsule_collider(entity) {
            self.world
                .set_capsule_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.edge_collider(entity) {
            self.world
                .set_edge_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.chain_collider(entity) {
            self.world
                .set_chain_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.convex_polygon_collider(entity) {
            self.world
                .set_convex_polygon_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        false
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_physics_collider_material(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        restitution: f32,
        friction: f32,
        surface_velocity_x: f32,
        surface_velocity_y: f32,
        density: f32,
        contact_baumgarte_bias_scale: f32,
        max_contact_baumgarte_bias_velocity_scale: f32,
        contact_position_correction_scale: f32,
        contact_position_correction_slop_scale: f32,
    ) -> bool {
        if !Self::valid_physics_material_parts(
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        ) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let material = Self::physics_material_from_parts(
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        );
        self.set_physics_collider_material_for_entity(entity, material)
    }

    pub(super) fn set_physics_collider_material_for_entity(
        &mut self,
        entity: Entity,
        material: PhysicsMaterial,
    ) -> bool {
        if self.world.rigid_body(entity).is_none() || !self.has_physics_collider(entity) {
            return false;
        }
        self.world.set_collider_material(entity, material);
        self.store_physics_entity_snapshot(entity)
    }

    pub fn clear_physics_collider_material(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.clear_physics_collider_material_for_entity(entity)
    }

    pub(super) fn clear_physics_collider_material_for_entity(&mut self, entity: Entity) -> bool {
        if self.world.rigid_body(entity).is_none() || !self.has_physics_collider(entity) {
            return false;
        }
        self.world.clear_collider_material(entity);
        self.store_physics_entity_snapshot(entity)
    }
}
