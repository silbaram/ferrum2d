//! Cold aggregate admission after authoring has staged components and terrain.
use super::{Engine, SceneMode, UnifiedPhysicsError};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Aggregate admission and full native spatial-model presentation capability.
    pub fn unified_physics_scene_authoring_version(&self) -> u32 {
        1
    }

    /// Admits pending terrain, components and joints without advancing a tick.
    /// Failure restores the staged runtime; the rollback revision increases.
    pub fn finalize_unified_physics_authoring(&mut self) -> Result<(), String> {
        if self.scene_mode != SceneMode::Data || self.unified_physics.is_none() {
            return Err("native authoring requires a configured Data Scene".into());
        }
        let checkpoint = self.runtime_checkpoint().map_err(|e| e.to_string())?;
        match self.admit_unified_physics_authoring() {
            Ok(()) => Ok(()),
            Err(error) => {
                self.restore_runtime_checkpoint_native(&checkpoint)
                    .map_err(|e| format!("native authoring rollback rejected: {e}"))?;
                Err(error.to_string())
            }
        }
    }
}

impl Engine {
    fn admit_unified_physics_authoring(&mut self) -> Result<(), UnifiedPhysicsError> {
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        // Authored spatial documents cannot silently drop 2D colliders. Keep
        // this stricter admission rule out of the existing mixed runtime path.
        if runtime.physics.config().space == crate::physics3d::Space::Spatial
            && self.world.alive_indices().iter().any(|&i| {
                self.world.rigid_bodies[i].is_some()
                    || self.world.compound_collider_count_at(i) != 0
            })
        {
            return Err(UnifiedPhysicsError::LegacyBodiesPresent);
        }
        runtime.retire_deleted_entities(&self.world);
        runtime.retire_planar_components(&mut self.world);
        runtime.prepare_terrain(&self.tilemap, &self.spatial_scene)?;
        runtime.prepare_planar(&self.world, self.auto_rigid_body_step_config)?;
        runtime.prepare_planar_joints(&self.world)?;
        runtime.retire_terrain()?;
        runtime.commit_planar(&mut self.world, false)?;
        runtime.commit_terrain()?;
        runtime.commit_planar_joints()?;
        runtime.lifecycle.capture(
            &mut runtime.physics,
            &runtime.entities_by_body,
            &runtime.terrain.by_collider,
        );
        Ok(())
    }
}
