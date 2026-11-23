//! Versioned numeric boundary. Simulation and admission remain in the Rust world.
use super::{Engine, UnifiedPhysicsError};
use crate::entity::Entity;
use crate::physics3d::{BodyState, SolverSettings, Space, WorldConfig};
use wasm_bindgen::prelude::*;

mod authoring;
mod bindings;
mod character_forces;
mod characters;
mod collisions;
mod commands;
mod controls;
mod joints;
mod observations;
mod queries;
pub(in crate::engine) use queries::QueryBuffers;
mod shapes;
pub(in crate::engine) use characters::CharacterStateRecord;

const MAX_BATCH: usize = 65_536;
const STATE_WORDS: usize = 16;

#[repr(C)]
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct BodyStateRecord {
    entity_id: u32,
    generation: u32,
    flags: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    position: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    rotation: [f32; 4],
    #[serde(with = "crate::checkpoint_codec::array")]
    linear_velocity: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    angular_velocity: [f32; 3],
}
const _: () = assert!(std::mem::size_of::<BodyStateRecord>() == STATE_WORDS * 4);
const _: () = assert!(std::mem::align_of::<BodyStateRecord>() == 4);

impl BodyStateRecord {
    fn new(entity: Entity, state: BodyState) -> Self {
        Self {
            entity_id: entity.id,
            generation: entity.generation,
            flags: u32::from(state.sleeping),
            position: state.pose.position,
            rotation: state.pose.rotation,
            linear_velocity: state.linear_velocity,
            angular_velocity: state.angular_velocity,
        }
    }
}

fn entity(h: &[u32]) -> Entity {
    Entity {
        id: h[0],
        generation: h[1],
    }
}
fn validate_handles(handles: &[u32]) -> Result<(), String> {
    if !handles.len().is_multiple_of(2) || handles.len() / 2 > MAX_BATCH {
        return Err("Unified physics requires at most 65536 entity id/generation pairs".into());
    }
    Ok(())
}
fn vectors(values: &[f32]) -> ([f32; 3], [f32; 3]) {
    (
        [values[0], values[1], values[2]],
        [values[3], values[4], values[5]],
    )
}

fn decode_world_config(metadata: &[u32], values: &[f32]) -> Result<WorldConfig, String> {
    if metadata.len() != 9 || values.len() != 6 || metadata[0] > 1 || metadata[3] > 1 {
        return Err("Invalid unified physics configuration layout".into());
    }
    Ok(WorldConfig {
        space: if metadata[0] == 0 {
            Space::PlanarXy
        } else {
            Space::Spatial
        },
        gravity: [values[0], values[1], values[2]],
        step_seconds: values[3],
        length_unit: values[4],
        solver: SolverSettings {
            velocity_iterations: metadata[1],
            position_iterations: metadata[2],
            continuous: metadata[3] != 0,
            restitution_velocity_threshold: values[5],
        },
        max_bodies: metadata[4] as usize,
        max_colliders: metadata[5] as usize,
        max_events: metadata[6] as usize,
        max_characters: metadata[7] as usize,
        max_joints: metadata[8] as usize,
    })
}

#[wasm_bindgen]
impl Engine {
    /// Version 1: 9 configuration u32s, 6 configuration f32s, 16-word state rows.
    pub fn unified_physics_bridge_version(&self) -> u32 {
        1
    }

    /// Setup-only configuration. Metadata: space (0=XY,1=XYZ), velocity/position
    /// iterations, CCD (0/1), body/collider/event/character/joint capacities.
    /// Values: XYZ gravity, fixed step, length unit, restitution speed threshold.
    /// The complete configuration and existing authoring are checked before replacement.
    pub fn configure_unified_physics_world(
        &mut self,
        metadata: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        self.configure_unified_physics(decode_world_config(metadata, values)?)
            .map_err(|error| error.to_string())
    }

    /// Explicit legacy creation compatibility. Accepted only before the fresh
    /// native Engine has imported/executed/configured user simulation state.
    /// Rejection preserves the full Engine; no default-path fallback is allowed.
    pub fn configure_legacy_physics_defaults(&mut self) -> bool {
        self.select_legacy_physics_defaults()
    }

    /// `use_data_scene` for a physics-omitted HD-2D document that uses the
    /// heightSpan/AABB actor path. Accepted on a legacy Engine, or for an actual
    /// switch from a built-in scene while the engine-owned native defaults are
    /// untouched; the Data Scene then runs without a native world, as after
    /// `configure_legacy_physics_defaults`. False changes nothing and the caller
    /// activates the Data Scene normally.
    pub fn use_legacy_data_scene(&mut self) -> bool {
        self.activate_legacy_data_scene()
    }

    /// Read-only `use_legacy_data_scene` admission: true exactly when that
    /// call would activate the Data Scene on the legacy path now. Changes
    /// nothing, so a JSON progress restore can preflight the same decision.
    pub fn can_use_legacy_data_scene(&self) -> bool {
        self.legacy_data_scene_available()
    }

    /// Version 1 selects planar native defaults across subsequent scene changes.
    pub fn default_physics_policy_version(&self) -> u32 {
        1
    }

    /// Cold creation policy using the existing nine-u32/six-f32 world payload.
    /// Explicit scene worlds can override it until the next actual scene change.
    pub fn configure_default_physics_world(
        &mut self,
        metadata: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        self.configure_unified_physics_defaults(decode_world_config(metadata, values)?)
            .map_err(|error| error.to_string())
    }

    /// Current scene identity for creation-policy metadata: 0=off, 1=Shooter,
    /// 2=Breakout, 3=Platformer, 4=Data. No simulation or selection is performed.
    pub fn default_physics_policy_scene(&self) -> u32 {
        if self.default_unified_physics.is_none() {
            0
        } else if self.is_built_in_shooter() {
            1
        } else if self.is_built_in_breakout() {
            2
        } else if self.is_built_in_platformer() {
            3
        } else {
            4
        }
    }

    /// Planar Data/Shooter Physics Spec setup, preserving manual/automatic stepping.
    /// Version1 uses the same nine-u32/six-f32 setup payload as unified physics.
    pub fn physics_spec_backend_version(&self) -> u32 {
        1
    }

    /// True while the Engine owns a native rigid world, including an empty one.
    pub fn physics_spec_backend_active(&self) -> bool {
        self.unified_physics.is_some()
    }

    /// Imports authored planar components after complete validation. An identical
    /// world setup synchronizes additions without resetting existing solver state.
    pub fn configure_physics_spec_world(
        &mut self,
        metadata: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        self.configure_physics_spec_planar(decode_world_config(metadata, values)?)
            .map_err(|error| error.to_string())
    }

    /// Fills reused state rows in requested order. Failure clears previous output.
    /// The borrowed buffer expires at the next query or any Wasm memory growth.
    pub fn query_unified_physics_body_states(&mut self, handles: &[u32]) -> Result<(), String> {
        self.unified_physics_body_states.clear();
        validate_handles(handles)?;
        if self.unified_physics.is_none() {
            return Err(UnifiedPhysicsError::NotConfigured.to_string());
        }
        // Validate every identity before allocating/filling, including deleted render entities.
        for h in handles.chunks_exact(2) {
            self.unified_body_id(entity(h)).map_err(|e| e.to_string())?;
        }
        self.unified_physics_body_states.reserve(handles.len() / 2);
        for h in handles.chunks_exact(2) {
            let e = entity(h);
            let state = self.unified_body_state(e).map_err(|e| e.to_string())?;
            self.unified_physics_body_states
                .push(BodyStateRecord::new(e, state));
        }
        Ok(())
    }

    /// Atomically admits all velocities before modifying any body or waking it.
    /// Six floats per handle: linear XYZ, angular XYZ. Duplicate handles use the last row.
    /// Locked axes, stale handles and controller-owned velocities are rejected.
    pub fn set_unified_physics_velocities(
        &mut self,
        handles: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        validate_handles(handles)?;
        if values.len() != handles.len() / 2 * 6 {
            return Err("Unified physics velocity rows require six f32 values per handle".into());
        }
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
        for (h, v) in handles.chunks_exact(2).zip(values.chunks_exact(6)) {
            let id = self.unified_body_id(entity(h)).map_err(|e| e.to_string())?;
            let (linear, angular) = vectors(v);
            runtime
                .physics
                .validate_velocity(id, linear, angular)
                .map_err(|e| e.to_string())?;
        }
        // No calls can alter body identities or controller ownership between admission and commit.
        for (h, v) in handles.chunks_exact(2).zip(values.chunks_exact(6)) {
            let (linear, angular) = vectors(v);
            self.set_unified_body_velocity(entity(h), linear, angular)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn unified_physics_body_state_stride_words(&self) -> usize {
        STATE_WORDS
    }
    pub fn unified_physics_body_state_count(&self) -> usize {
        self.unified_physics_body_states.len()
    }
    pub fn unified_physics_body_state_ptr(&self) -> *const u32 {
        self.unified_physics_body_states.as_ptr().cast()
    }
}

#[cfg(test)]
mod spatial_tests;

#[cfg(test)]
mod command_tests;
#[cfg(test)]
mod tests;

pub(crate) mod file_output_admission;
