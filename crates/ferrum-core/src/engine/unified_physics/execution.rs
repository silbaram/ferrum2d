//! Automatic/manual calls share one configured native clock and solver.
use super::{Engine, UnifiedPhysicsError};
use crate::components::Velocity;
use crate::physics::RigidBodyStepConfig;
use crate::physics3d::{PhysicsWorld3d, SolverSettings};

pub(super) fn solver_settings(c: RigidBodyStepConfig) -> SolverSettings {
    SolverSettings {
        velocity_iterations: c.velocity_iterations,
        position_iterations: c.position_iterations,
        restitution_velocity_threshold: c.restitution_velocity_threshold,
        continuous: c.continuous,
    }
}
pub(super) fn gravity(world: &PhysicsWorld3d, c: RigidBodyStepConfig) -> [f32; 3] {
    // The existing two-component API sets native world X/Y; spatial Z is retained.
    [c.gravity.vx, c.gravity.vy, world.config().gravity[2]]
}
pub(super) fn copy_native_settings(c: &mut RigidBodyStepConfig, g: [f32; 3], s: SolverSettings) {
    c.gravity = Velocity { vx: g[0], vy: g[1] };
    c.velocity_iterations = s.velocity_iterations;
    c.position_iterations = s.position_iterations;
    c.restitution_velocity_threshold = s.restitution_velocity_threshold;
    c.continuous = s.continuous;
}

impl Engine {
    /// Changes the configured native world's full XYZ gravity and solver controls.
    /// The fixed tick and authored per-fixture contact correction remain unchanged.
    pub fn set_unified_runtime_settings(
        &mut self,
        gravity: [f32; 3],
        solver: SolverSettings,
    ) -> Result<(), UnifiedPhysicsError> {
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        runtime.physics.set_runtime_settings(gravity, solver)?;
        copy_native_settings(&mut self.auto_rigid_body_step_config, gravity, solver);
        Ok(())
    }

    pub(in crate::engine) fn accept_unified_auto_config(&mut self, c: RigidBodyStepConfig) -> bool {
        let Some(runtime) = &mut self.unified_physics else {
            return true;
        };
        let c = c.sanitized();
        if let Err(error) = runtime
            .physics
            .set_runtime_settings(gravity(&runtime.physics, c), solver_settings(c))
        {
            runtime.last_error.record(error.into());
            return false;
        }
        true
    }

    // Returns true whenever a native world exists, including invalid requests.
    // The caller must never fall through to the old rigid solver in that case.
    pub(in crate::engine) fn step_unified_manually(
        &mut self,
        dt: f32,
        config: Option<RigidBodyStepConfig>,
    ) -> bool {
        let Some(runtime) = &self.unified_physics else {
            return false;
        };
        if dt == 0.0 {
            return true;
        }
        let saved_gravity = runtime.physics.config().gravity;
        let saved_solver = runtime.physics.config().solver;
        let config = config.unwrap_or(self.auto_rigid_body_step_config);
        let succeeded = if self.has_native_breakout() {
            self.step_native_breakout(dt, config)
        } else if self.has_native_platformer() {
            self.step_native_platformer(dt, config)
        } else {
            self.step_unified_with_config(dt, config, false) == Some(true)
        };
        if let Some(runtime) = &mut self.unified_physics {
            // One-shot manual settings do not overwrite automatic world settings.
            if let Err(error) = runtime
                .physics
                .set_runtime_settings(saved_gravity, saved_solver)
            {
                runtime.last_error.record(error.into());
            }
            if succeeded {
                self.world.reset_render_interpolation();
            }
        }
        true
    }
}
