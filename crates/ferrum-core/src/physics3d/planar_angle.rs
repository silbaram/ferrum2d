//! Unwrapped planar angle alongside the quaternion pose, for authored continuous limits.
use super::world::native_id;
use super::{BodyId, PhysicsError, PhysicsWorld3d, Space};

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct PlanarAngle {
    wrapped: f64,
    turns: f64,
}

impl PlanarAngle {
    pub(super) fn value(&self) -> f64 {
        self.turns
    }
}

fn angle(q: [f32; 4]) -> f64 {
    2.0 * f64::from(q[2]).atan2(f64::from(q[3]))
}
pub(super) fn wrap(value: f64) -> f64 {
    (value + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}

impl PhysicsWorld3d {
    /// Reads the continuous Z rotation for a planar body; spatial bodies reject this operation.
    pub fn planar_rotation(&self, id: BodyId) -> Result<f64, PhysicsError> {
        if self.config.space != Space::PlanarXy {
            return Err(PhysicsError::OutOfPlane);
        }
        self.planar_angles
            .get(&id)
            .map(|s| s.turns)
            .ok_or(PhysicsError::StaleBody)
    }

    /// Sets a planar body's authored rotation, preserving whole turns up to 1,000,000 radians.
    /// This is a teleport, not a velocity or kinematic motion command.
    pub fn set_planar_rotation(&mut self, id: BodyId, radians: f64) -> Result<(), PhysicsError> {
        if self.config.space != Space::PlanarXy {
            return Err(PhysicsError::OutOfPlane);
        }
        if !radians.is_finite() || radians.abs() > 1.0e6 {
            return Err(PhysicsError::InvalidBody);
        }
        let mut pose = self.body_state(id)?.pose;
        let (s, c) = (radians * 0.5).sin_cos();
        pose.rotation = [0.0, 0.0, s as f32, c as f32];
        self.set_pose(id, pose)?;
        if let Some(state) = self.planar_angles.get_mut(&id) {
            state.turns = radians;
        }
        Ok(())
    }

    pub(super) fn initialize_planar_angle(&mut self, id: BodyId, q: [f32; 4]) {
        if self.config.space == Space::PlanarXy {
            let value = angle(q);
            self.planar_angles.insert(
                id,
                PlanarAngle {
                    wrapped: value,
                    turns: value,
                },
            );
        }
    }

    pub(super) fn advance_planar_angles(&mut self, dt: f32) {
        for (&id, state) in &mut self.planar_angles {
            if let Some(body) = self.backend.bodies.get(native_id(id)) {
                let next = angle(body.rotation().to_array());
                let short = wrap(next - state.wrapped);
                // Pick the turn count closest to the integrated angular motion. At ordinary
                // rates this is just the shortest signed quaternion change.
                let predicted = if body.is_enabled() {
                    f64::from(body.angvel().z) * f64::from(dt)
                } else {
                    0.0
                };
                let turns = ((predicted - short) / std::f64::consts::TAU).round();
                state.turns += short + turns * std::f64::consts::TAU;
                state.wrapped = next;
            }
        }
    }
}
