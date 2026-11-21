//! Infrequent authoring edits. Per-tick motion stays on the bulk command boundary.
use super::{authoring, Engine, UnifiedPhysicsError};
use crate::entity::Entity;
use crate::physics3d::{AdditionalMassProperties, BodyId, BodyOptions, ColliderId};
use wasm_bindgen::prelude::*;

impl Engine {
    fn editable_unified_body(&self, entity: Entity) -> Result<BodyId, String> {
        let id = self.unified_body_id(entity).map_err(|e| e.to_string())?;
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
        // Legacy components remain the source of truth for imported fixtures/settings.
        // Reject instead of silently accepting an edit later overwritten by synchronization.
        if runtime
            .bindings
            .get(&(entity.id, entity.generation))
            .is_some_and(|b| b.legacy.is_some())
        {
            return Err(UnifiedPhysicsError::BodyOwnershipConflict.to_string());
        }
        Ok(id)
    }

    fn editable_unified_collider(&self, entity: Entity, id: ColliderId) -> Result<(), String> {
        let body = self.editable_unified_body(entity)?;
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
        if runtime
            .physics
            .collider_owner(id)
            .map_err(|e| e.to_string())?
            .body
            != body
        {
            return Err("Unified physics collider does not belong to this entity".into());
        }
        Ok(())
    }
}

#[wasm_bindgen]
impl Engine {
    pub fn unified_physics_control_version(&self) -> u32 {
        1
    }

    /// Full replacement of integration settings: kind/flags and gravity/linear/angular damping.
    /// Flags enabled=1, can sleep=2, CCD=4, lock rotation=8. Pose and velocity are retained,
    /// except locking rotations clears angular velocity. Controller-owned bodies reject it.
    pub fn set_unified_physics_body_options(
        &mut self,
        id: u32,
        generation: u32,
        metadata: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        if metadata.len() != 2 || metadata[1] & !15 != 0 || values.len() != 3 {
            return Err("Invalid unified physics body settings payload".into());
        }
        let options = BodyOptions {
            kind: authoring::body_kind(metadata[0])?,
            enabled: metadata[1] & 1 != 0,
            can_sleep: metadata[1] & 2 != 0,
            ccd: metadata[1] & 4 != 0,
            lock_rotation: metadata[1] & 8 != 0,
            gravity_scale: values[0],
            linear_damping: values[1],
            angular_damping: values[2],
        };
        let entity = Entity { id, generation };
        let body = self.editable_unified_body(entity)?;
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
        runtime
            .physics
            .set_body_options(body, &options)
            .map_err(|e| e.to_string())?;
        runtime
            .write_entity(&mut self.world, entity)
            .map_err(|e| e.to_string())
    }

    /// Additive mass/inertia, not a density override. All collider densities must be zero
    /// when these values represent the complete body mass properties.
    pub fn set_unified_physics_mass_properties(
        &mut self,
        id: u32,
        generation: u32,
        values: &[f32],
    ) -> Result<(), String> {
        if values.len() != 11 {
            return Err("Invalid unified physics mass payload".into());
        }
        let body = self.editable_unified_body(Entity { id, generation })?;
        self.unified_physics
            .as_mut()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?
            .physics
            .set_additional_mass_properties(
                body,
                &AdditionalMassProperties {
                    mass: values[0],
                    principal_inertia: authoring::v3(&values[1..]),
                    center: authoring::v3(&values[4..]),
                    inertia_rotation: [values[7], values[8], values[9], values[10]],
                },
            )
            .map_err(|e| e.to_string())
    }

    /// Owned slot/generation pairs for all current fixtures, at most 64 per body.
    pub fn query_unified_physics_colliders(
        &self,
        id: u32,
        generation: u32,
    ) -> Result<Vec<u32>, String> {
        let body = self
            .unified_body_id(Entity { id, generation })
            .map_err(|e| e.to_string())?;
        Ok(self
            .unified_physics
            .as_ref()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?
            .physics
            .collider_ids(body)
            .map_err(|e| e.to_string())?
            .flat_map(|c| [c.slot, c.generation])
            .collect())
    }

    /// Add a fixture. Native validation controls shape, mass, capacity and capsule restrictions.
    pub fn add_unified_physics_collider(
        &mut self,
        id: u32,
        generation: u32,
        metadata: &[u32],
        values: &[f32],
        shape_metadata: &[u32],
        shape_values: &[f32],
    ) -> Result<Vec<u32>, String> {
        let body = self.editable_unified_body(Entity { id, generation })?;
        let desc = authoring::collider(metadata, values, shape_metadata, shape_values)?;
        let c = self
            .unified_physics
            .as_mut()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?
            .physics
            .add_collider(body, desc)
            .map_err(|e| e.to_string())?;
        Ok(vec![c.slot, c.generation])
    }

    /// Replace one collider without changing its identity. Handles contain the owner entity
    /// id/generation followed by collider slot/generation, preventing cross-owner edits.
    pub fn update_unified_physics_collider(
        &mut self,
        handles: &[u32],
        metadata: &[u32],
        values: &[f32],
        shape_metadata: &[u32],
        shape_values: &[f32],
    ) -> Result<(), String> {
        if handles.len() != 4 {
            return Err("Invalid unified physics collider handle payload".into());
        }
        let c = ColliderId {
            slot: handles[2],
            generation: handles[3],
        };
        self.editable_unified_collider(
            Entity {
                id: handles[0],
                generation: handles[1],
            },
            c,
        )?;
        let desc = authoring::collider(metadata, values, shape_metadata, shape_values)?;
        self.unified_physics
            .as_mut()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?
            .physics
            .update_collider(c, desc)
            .map_err(|e| e.to_string())
    }

    /// Remove a fixture and capture its collision exits before its slot can be reused.
    pub fn remove_unified_physics_collider(
        &mut self,
        id: u32,
        generation: u32,
        slot: u32,
        collider_generation: u32,
    ) -> Result<(), String> {
        let c = ColliderId {
            slot,
            generation: collider_generation,
        };
        self.editable_unified_collider(Entity { id, generation }, c)?;
        let r = self
            .unified_physics
            .as_mut()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
        r.physics.remove_collider(c).map_err(|e| e.to_string())?;
        r.lifecycle
            .capture(&mut r.physics, &r.entities_by_body, &r.terrain.by_collider);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
