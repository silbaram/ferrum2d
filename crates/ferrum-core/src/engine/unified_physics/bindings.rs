//! Attach physics ownership to an existing render/gameplay entity.
use super::{Binding, Engine, UnifiedPhysicsError};
use crate::components::{AngularVelocity, Velocity};
use crate::engine::scenes::SceneMode;
use crate::entity::Entity;
use crate::physics3d::{BodyDesc, ColliderDesc, PhysicsError, Space};

impl Engine {
    pub(super) fn validate_unified_body_binding(
        &self,
        offset: [f32; 3],
    ) -> Result<(), UnifiedPhysicsError> {
        if !offset.iter().all(|v| v.is_finite() && v.abs() <= 1.0e6) {
            return Err(UnifiedPhysicsError::InvalidVisualOffset);
        }
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        if self.scene_mode != SceneMode::Data {
            return Err(UnifiedPhysicsError::WrongScene);
        }
        if runtime.physics.config().space == Space::PlanarXy && offset[2] != 0.0 {
            return Err(PhysicsError::OutOfPlane.into());
        }
        Ok(())
    }
    /// Attaches one validated native body/collider to a live visual/gameplay entity.
    /// No entity, sprite, asset or behavior is recreated. Existing native or component
    /// physics ownership is rejected. Pose is explicit physics XYZ, not inferred from pixels.
    pub fn bind_unified_body(
        &mut self,
        entity: Entity,
        desc: BodyDesc,
        collider: ColliderDesc,
        render_offset: [f32; 3],
    ) -> Result<(), UnifiedPhysicsError> {
        self.validate_unified_body_binding(render_offset)?;
        if !self.world.is_current_entity(entity) {
            return Err(UnifiedPhysicsError::StaleEntity);
        }
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        let key = (entity.id, entity.generation);
        if runtime.bindings.contains_key(&key)
            || self.world.rigid_body(entity).is_some()
            || self.world.compound_collider_count(entity) > 0
        {
            return Err(UnifiedPhysicsError::BodyOwnershipConflict);
        }
        runtime.retire_deleted_entities(&self.world);
        let body = runtime.physics.create_body(desc, collider)?;
        runtime.bindings.insert(
            key,
            Binding {
                body,
                render_offset,
                legacy: None,
            },
        );
        runtime.entities_by_body.insert(body, entity);
        self.world.unified_physics_entities.insert(key);
        runtime.write_entity(&mut self.world, entity)
    }
    /// Removes native body/colliders/joints/controller, retaining the visual/gameplay entity.
    /// Generated projectiles and imported component bodies keep their original ownership.
    /// Stops generated velocities so legacy integration cannot move the detached visual.
    pub fn unbind_unified_body(&mut self, entity: Entity) -> Result<(), UnifiedPhysicsError> {
        let body = self.unified_body_id(entity)?;
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        let key = (entity.id, entity.generation);
        if runtime
            .bindings
            .get(&key)
            .is_some_and(|b| b.legacy.is_some())
            || runtime.projectiles.contains_key(&key)
        {
            return Err(UnifiedPhysicsError::BodyOwnershipConflict);
        }
        runtime.physics.remove_body(body)?;
        runtime.joint_stream.capture(
            &mut runtime.physics,
            &runtime.entities_by_body,
            &mut runtime.native_joint_events,
        );
        runtime.lifecycle.capture(
            &mut runtime.physics,
            &runtime.entities_by_body,
            &runtime.terrain.by_collider,
        );
        runtime.bindings.remove(&key);
        runtime.entities_by_body.remove(&body);
        self.world.unified_physics_entities.remove(&key);
        self.world.set_velocity(entity, Velocity::default());
        self.world
            .set_angular_velocity(entity, AngularVelocity::default());
        Ok(())
    }
}
