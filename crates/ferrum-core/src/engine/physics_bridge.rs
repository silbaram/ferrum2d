use crate::components::{
    CollisionFilter, CollisionMask, CompoundCollider, CompoundColliderRef, CompoundColliderShape,
    CompoundColliderShapeRef, PhysicsMaterial,
};
use crate::entity::Entity;

mod body_snapshots;
mod hit_storage;
mod hit_types;
mod joint_snapshots;
mod snapshot_types;

pub use hit_types::{
    PhysicsBodyContactHit, PhysicsBodyManifoldHit, PhysicsQueryEntityHit, PhysicsRaycastBodyHit,
    PhysicsRigidContactImpulseHit, PhysicsTileContactHit, PhysicsTileManifoldHit,
    PhysicsTileShapeCastHit,
};
pub(super) use snapshot_types::{
    PhysicsBodyColliderSnapshot, PhysicsEntitySnapshot, PhysicsJointSnapshot, PhysicsQueryResult,
};

use super::{
    Engine, PHYSICS_COLLIDER_TYPE_AABB, PHYSICS_COLLIDER_TYPE_CAPSULE, PHYSICS_COLLIDER_TYPE_CHAIN,
    PHYSICS_COLLIDER_TYPE_CIRCLE, PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON, PHYSICS_COLLIDER_TYPE_EDGE,
    PHYSICS_COLLIDER_TYPE_NONE, PHYSICS_COLLIDER_TYPE_ORIENTED_BOX,
};

impl Engine {
    pub(super) fn entity_from_handle(
        &self,
        entity_id: u32,
        entity_generation: u32,
    ) -> Option<Entity> {
        let index = entity_id as usize;
        if index < self.world.alive.len()
            && self.world.alive[index]
            && self.world.generations[index] == entity_generation
        {
            Some(Entity {
                id: entity_id,
                generation: entity_generation,
            })
        } else {
            None
        }
    }

    pub(super) fn physics_body_collider_snapshot(
        &self,
        entity: Entity,
        collider_index: u32,
    ) -> Option<PhysicsBodyColliderSnapshot> {
        let body = self.world.rigid_body(entity)?;
        let entity_index = entity.id as usize;
        let collider = self
            .world
            .compound_collider_ref_at(entity_index, collider_index as usize)?;
        let filter = self
            .world
            .compound_collision_filter_at(entity_index, collider_index as usize)
            .unwrap_or_else(|| CollisionFilter::from_layer(collider.layer()));
        let material_override = collider.material().is_some();
        let material = collider.material().unwrap_or(body.material);
        let (
            collider_type,
            collider_enabled,
            collider_is_trigger,
            collider_offset_x,
            collider_offset_y,
        ) = Self::compound_collider_state(collider);
        Some(PhysicsBodyColliderSnapshot {
            collider_index,
            collider_type,
            collider_enabled,
            collider_is_trigger,
            collider_offset_x,
            collider_offset_y,
            collider_material_override: material_override,
            collider_restitution: material.restitution,
            collider_friction: material.friction,
            collider_surface_velocity_x: material.surface_velocity.vx,
            collider_surface_velocity_y: material.surface_velocity.vy,
            collider_density: material.density,
            collider_contact_baumgarte_bias_scale: material.contact_baumgarte_bias_scale,
            collider_max_contact_baumgarte_bias_velocity_scale: material
                .max_contact_baumgarte_bias_velocity_scale,
            collider_contact_position_correction_scale: material.contact_position_correction_scale,
            collider_contact_position_correction_slop_scale: material
                .contact_position_correction_slop_scale,
            collider_category_bits: filter.category.bits,
            collider_mask_bits: filter.mask.bits,
        })
    }

    pub(super) fn compound_collider_state(
        collider: CompoundColliderRef<'_>,
    ) -> (u32, bool, bool, f32, f32) {
        match collider.shape {
            CompoundColliderShapeRef::Aabb(collider) => (
                PHYSICS_COLLIDER_TYPE_AABB,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShapeRef::Circle(collider) => (
                PHYSICS_COLLIDER_TYPE_CIRCLE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShapeRef::Capsule(collider) => (
                PHYSICS_COLLIDER_TYPE_CAPSULE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShapeRef::Edge(collider) => (
                PHYSICS_COLLIDER_TYPE_EDGE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShapeRef::Chain(collider) => (
                PHYSICS_COLLIDER_TYPE_CHAIN,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShapeRef::OrientedBox(collider) => (
                PHYSICS_COLLIDER_TYPE_ORIENTED_BOX,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShapeRef::ConvexPolygon(collider) => (
                PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
        }
    }

    pub(super) fn physics_collider_snapshot(&self, entity: Entity) -> (u32, bool, bool, f32, f32) {
        if let Some(collider) = self.world.collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_AABB,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.circle_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CIRCLE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.capsule_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CAPSULE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.edge_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_EDGE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.chain_collider_ref(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CHAIN,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.oriented_box_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_ORIENTED_BOX,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.convex_polygon_collider_ref(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        (PHYSICS_COLLIDER_TYPE_NONE, false, false, 0.0, 0.0)
    }

    pub(super) fn has_physics_collider(&self, entity: Entity) -> bool {
        self.physics_collider_snapshot(entity).0 != PHYSICS_COLLIDER_TYPE_NONE
    }

    pub(super) fn physics_collider_material_snapshot(
        &self,
        entity: Entity,
        body_material: PhysicsMaterial,
    ) -> (bool, PhysicsMaterial) {
        match self.world.collider_material(entity) {
            Some(material) => (true, material),
            None => (false, body_material),
        }
    }

    pub(super) fn add_physics_compound_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        shape: CompoundColliderShape,
        category_bits: u32,
        mask_bits: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        let collider = CompoundCollider::new(shape).with_filter(CollisionFilter::new(
            CollisionMask::from_bits(category_bits),
            CollisionMask::from_bits(mask_bits),
        ));
        if self.world.add_compound_collider(entity, collider).is_none() {
            return false;
        }
        self.store_physics_entity_snapshot(entity)
    }
}
