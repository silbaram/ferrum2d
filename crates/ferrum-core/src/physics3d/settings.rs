//! Mutable solver controls, independent of the world's fixed clock and capacity.
use super::types::{valid_vector, validate_plane};
use super::{PhysicsError, PhysicsWorld3d, Pose};

/// Iterative solver quality and impact controls. Native defaults retain the
/// original four substeps, one velocity sweep and one relaxation sweep per substep.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SolverSettings {
    /// Velocity PGS sweeps per substep, in [1, 32].
    pub velocity_iterations: u32,
    /// Position-relaxation sweeps per substep, in [1, 32].
    pub position_iterations: u32,
    /// Minimum approach speed for restitution, in [0, 1,000,000] engine units/s.
    /// Equality does not bounce. The speed includes angular contact-point motion.
    pub restitution_velocity_threshold: f32,
    /// Global continuous collision detection switch, including native automatic CCD.
    pub continuous: bool,
}
impl Default for SolverSettings {
    fn default() -> Self {
        Self {
            velocity_iterations: 1,
            position_iterations: 1,
            restitution_velocity_threshold: 0.0,
            continuous: true,
        }
    }
}
impl SolverSettings {
    pub(crate) fn validate(self) -> Result<(), PhysicsError> {
        if !(1..=32).contains(&self.velocity_iterations)
            || !(1..=32).contains(&self.position_iterations)
            || !self.restitution_velocity_threshold.is_finite()
            || !(0.0..=1e6).contains(&self.restitution_velocity_threshold)
        {
            return Err(PhysicsError::InvalidConfig);
        }
        Ok(())
    }
    pub(super) fn apply(self, params: &mut rapier3d::prelude::IntegrationParameters) {
        params.num_internal_pgs_iterations = self.velocity_iterations as usize;
        params.num_internal_stabilization_iterations = self.position_iterations as usize;
        params.restitution_velocity_threshold = self.restitution_velocity_threshold;
        params.max_ccd_substeps = usize::from(self.continuous);
    }
}
impl PhysicsWorld3d {
    pub(crate) fn validate_runtime_settings(
        &self,
        gravity: [f32; 3],
        solver: SolverSettings,
    ) -> Result<(), PhysicsError> {
        solver.validate()?;
        if !valid_vector(&gravity) {
            return Err(PhysicsError::InvalidConfig);
        }
        validate_plane(self.config.space, Pose::default(), gravity, [0.0; 3])
    }

    /// Changes gravity and solver controls atomically without resetting the fixed clock.
    /// A gravity change wakes dynamic bodies, including sleeping contact islands.
    /// A failed validation leaves configuration, poses, velocities and sleep unchanged.
    pub fn set_runtime_settings(
        &mut self,
        gravity: [f32; 3],
        solver: SolverSettings,
    ) -> Result<(), PhysicsError> {
        self.validate_runtime_settings(gravity, solver)?;
        if self.config.gravity != gravity {
            self.backend.gravity = gravity.into();
            self.config.gravity = gravity;
            for (_, body) in self.backend.bodies.iter_mut() {
                if body.is_dynamic() {
                    body.wake_up(true);
                }
            }
        }
        solver.apply(&mut self.backend.integration_parameters);
        self.config.solver = solver;
        Ok(())
    }
}
