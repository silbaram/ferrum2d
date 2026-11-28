use super::types::valid_vector;
use super::world::native_id;
use super::{BodyId, PhysicsError, PhysicsWorld3d};
use rapier3d::prelude as rp;
use rapier3d::utils::PoseOps;

/// Non-consuming prediction. Native integration retains ownership of user force,
/// gravity, damping and angular momentum; this only reads their next-step effect.
pub(super) fn predicted_velocity(
    body: &rp::RigidBody,
    gravity: rp::Vector,
    dt: f32,
) -> (rp::Vector, rp::Vector) {
    let mass = body.mass_properties();
    let linear = (body.linvel()
        + (body.user_force() + gravity * body.mass() * body.gravity_scale())
            * mass.effective_inv_mass
            * dt)
        / (1. + dt * body.linear_damping());
    let angular = (body.angvel() + mass.effective_world_inv_inertia * body.user_torque() * dt)
        / (1. + dt * body.angular_damping());
    (linear, angular)
}
pub(super) fn predicted_pose(body: &rp::RigidBody, gravity: rp::Vector, dt: f32) -> rp::Pose {
    let (linear, angular) = predicted_velocity(body, gravity, dt);
    let center = body.center_of_mass();
    body.position()
        .append_translation(-center)
        .append_rotation(angular * dt)
        .append_translation(center + linear * dt)
}

impl PhysicsWorld3d {
    /// Adds a persistent world-space force and torque. Call `clear_forces` to remove them.
    /// Only dynamic bodies accept forces. Locked axes constrain their resulting acceleration.
    pub fn add_force(
        &mut self,
        id: BodyId,
        force: [f32; 3],
        torque: [f32; 3],
    ) -> Result<(), PhysicsError> {
        self.validate_dynamic_motion(id, force, torque)?;
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.add_force(force.into(), true);
        body.add_torque(torque.into(), true);
        Ok(())
    }

    /// Clears persistent force and torque without changing existing velocity.
    pub fn clear_forces(&mut self, id: BodyId) -> Result<(), PhysicsError> {
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.reset_forces(true);
        body.reset_torques(true);
        Ok(())
    }

    /// Applies a world-space angular impulse to a dynamic body.
    pub fn apply_torque_impulse(
        &mut self,
        id: BodyId,
        torque: [f32; 3],
    ) -> Result<(), PhysicsError> {
        self.validate_dynamic_motion(id, [0.0; 3], torque)?;
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.apply_torque_impulse(torque.into(), true);
        Ok(())
    }

    /// Explicitly sleeps a dynamic body (zeroing its velocities) or wakes it.
    pub fn set_sleeping(&mut self, id: BodyId, sleeping: bool) -> Result<(), PhysicsError> {
        self.validate_dynamic_body(id)?;
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        if sleeping {
            body.sleep();
        } else {
            body.wake_up(true);
        }
        Ok(())
    }

    pub(crate) fn validate_dynamic_body(&self, id: BodyId) -> Result<(), PhysicsError> {
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        if !body.is_dynamic() {
            return Err(PhysicsError::WrongBodyKind);
        }
        Ok(())
    }

    pub(crate) fn validate_dynamic_motion(
        &self,
        id: BodyId,
        linear: [f32; 3],
        angular: [f32; 3],
    ) -> Result<(), PhysicsError> {
        if !valid_vector(&linear) || !valid_vector(&angular) {
            return Err(PhysicsError::InvalidBody);
        }
        self.validate_dynamic_body(id)
    }
}
