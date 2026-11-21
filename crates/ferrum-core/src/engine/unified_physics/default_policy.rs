//! Engine-owned native defaults for scenes without an explicit physics world.
use super::*;

/// Shared raw/Web initial planar arcade settings. Engine units are unchanged;
/// automatic stepping and the variable clock are separate Engine policy fields.
pub(in crate::engine) fn initial_world_config() -> WorldConfig {
    WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        solver: crate::physics3d::SolverSettings {
            velocity_iterations: 1,
            position_iterations: 1,
            restitution_velocity_threshold: 1.,
            continuous: false,
        },
        length_unit: 1.,
        ..WorldConfig::default()
    }
}

impl Engine {
    /// Fresh creation only. Leave authored constructor components pending so a
    /// cold explicit legacy selection does not discard an imported body/solver.
    pub(in crate::engine) fn initialize_native_defaults(
        &mut self,
    ) -> Result<(), UnifiedPhysicsError> {
        let config = initial_world_config();
        let runtime = self.new_unified_runtime(config.clone())?;
        execution::copy_native_settings(
            &mut self.auto_rigid_body_step_config,
            config.gravity,
            config.solver,
        );
        self.default_unified_physics = Some(config);
        self.default_unified_physics_fixed = false;
        self.auto_rigid_body_step_enabled = true;
        self.unified_physics = Some(runtime);
        Ok(())
    }

    /// Explicit compatibility selection, before any native execution/import.
    /// World entities/components are preserved; only the untouched initial
    /// native/default policy is removed. An existing legacy selection is a no-op.
    pub(in crate::engine) fn select_legacy_physics_defaults(&mut self) -> bool {
        if self.default_unified_physics.is_none() && self.unified_physics.is_none() {
            return true;
        }
        let config = initial_world_config();
        let mut initial_step = crate::physics::RigidBodyStepConfig::default();
        execution::copy_native_settings(&mut initial_step, config.gravity, config.solver);
        let initial = self.is_built_in_shooter()
            && self.active_scene_game_state() == crate::game_state::GameState::Title
            && self.elapsed_seconds == 0.
            && self.checkpoint_revision == 0
            && self.world.alive_count() == 1
            && !self.fixed_timestep_enabled
            && !self.default_unified_physics_fixed
            && self.auto_rigid_body_step_enabled
            && self.auto_rigid_body_step_config == initial_step
            && self.default_unified_physics.as_ref() == Some(&config)
            && self.fixed_timestep.config() == crate::physics::FixedTimestepConfig::default()
            && self.unified_physics.as_ref().is_some_and(|runtime| {
                runtime.shooter_gameplay
                    && runtime.bindings.is_empty()
                    && runtime.physics.body_count() == 0
                    && runtime.physics.collider_count() == 0
                    && runtime.physics.joint_count() == 0
                    && !runtime.physics.has_active_interval()
                    && runtime.physics.config() == &config
                    && runtime.last_error.get().is_none()
            });
        if !initial {
            return false;
        }
        self.default_unified_physics = None;
        self.discard_unified_physics();
        self.default_unified_physics_fixed = false;
        true
    }

    /// Selects planar native defaults for this Engine and subsequent scene changes.
    ///
    /// This is cold setup: current authoring must admit before the policy changes.
    /// Raw creation already selects variable native defaults. This explicit
    /// operation selects a fixed clock; scene-local native worlds remain separate.
    pub fn configure_unified_physics_defaults(
        &mut self,
        config: WorldConfig,
    ) -> Result<(), UnifiedPhysicsError> {
        if config.space != Space::PlanarXy {
            return Err(PhysicsError::InvalidConfig.into());
        }
        let clock = self.fixed_timestep.config();
        self.configure_unified_physics(config.clone())?;
        self.apply_fixed_timestep_config(
            true,
            config.step_seconds,
            clock.max_frame_seconds,
            clock.max_steps_per_update,
        );
        self.default_unified_physics = Some(config);
        self.default_unified_physics_fixed = true;
        Ok(())
    }

    /// Recreates only on an actual scene change. Same-scene resets keep the
    /// configured world, solver settings and automatic/manual ownership.
    pub(in crate::engine) fn reset_unified_physics_to_defaults(&mut self) {
        let Some(config) = self.default_unified_physics.clone() else {
            return;
        };
        let runtime = match self.new_unified_runtime(config.clone()) {
            Ok(runtime) => runtime,
            Err(error) => {
                // The stored configuration was admitted before it became a
                // policy. Retain the old native sentinel on invariant failure.
                if let Some(runtime) = &mut self.unified_physics {
                    runtime.last_error.record(error);
                }
                return;
            }
        };
        let auto_enabled = self.auto_rigid_body_step_enabled;
        if let Some(previous) = self.unified_physics.take() {
            for (id, generation) in previous.bindings.into_keys() {
                self.world.despawn(Entity { id, generation });
            }
        }
        let clock = self.fixed_timestep.config();
        if self.fixed_timestep_enabled != self.default_unified_physics_fixed
            || clock.step_seconds != config.step_seconds
        {
            self.apply_fixed_timestep_config(
                self.default_unified_physics_fixed,
                config.step_seconds,
                clock.max_frame_seconds,
                clock.max_steps_per_update,
            );
        }
        execution::copy_native_settings(
            &mut self.auto_rigid_body_step_config,
            config.gravity,
            config.solver,
        );
        self.auto_rigid_body_step_enabled = auto_enabled;
        // Install the native world before pending scene components are imported.
        // Unsupported fixtures therefore reject through native admission rather
        // than advancing with the legacy movement or collision implementation.
        self.unified_physics = Some(runtime);
    }
}
