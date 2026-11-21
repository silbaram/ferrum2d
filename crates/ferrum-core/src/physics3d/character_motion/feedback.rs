//! Commit accepted backend character metadata without another integration.
use crate::physics3d::{
    solver_trajectory::TrajectoryError, world::native_id, BodyId, PhysicsWorld3d,
};
use rapier3d::prelude as rp;

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct BackendCharacterFeedback {
    pub body: BodyId,
    pub translation: rp::Vector,
    pub carry_translation: rp::Vector,
    pub velocity_delta: rp::Vector,
    pub blocked_moving: bool,
    pub blocked_character: bool,
    pub hit_ceiling: bool,
}
impl PhysicsWorld3d {
    /// Validate every row before changing any character. The caller owns the
    /// accepted backend clock and has already committed all geometry responses.
    pub(in crate::physics3d) fn publish_backend_motion_feedback(
        &mut self,
        rows: &[BackendCharacterFeedback],
        dt: f32,
    ) -> Result<(), TrajectoryError> {
        if !dt.is_finite() || dt <= 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        let mut previous = None;
        for row in rows {
            if previous.is_some_and(|p| p >= row.body)
                || !self.characters.contains_key(&row.body)
                || !self
                    .backend
                    .bodies
                    .get(native_id(row.body))
                    .is_some_and(|b| b.is_enabled())
            {
                return Err(TrajectoryError::InvalidReference);
            }
            if !row.translation.is_finite()
                || !(row.translation / dt).is_finite()
                || !row.carry_translation.is_finite()
                || !row.velocity_delta.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            previous = Some(row.body);
        }
        for row in rows {
            // The complete census above ensures each local lookup still exists.
            let r = self
                .characters
                .get_mut(&row.body)
                .expect("prevalidated character feedback");
            r.state.translation = row.translation.to_array();
            r.state.velocity = (row.translation / dt).to_array();
            r.state.carry_translation = row.carry_translation.to_array();
            r.state.blocked_by_moving_obstacle |= row.blocked_moving;
            r.state.blocked_by_character |= row.blocked_character;
            r.state.hit_ceiling |= row.hit_ceiling;
            if row.hit_ceiling {
                r.state.vertical_speed = 0.;
            }
            if row.carry_translation.length_squared() <= 1e-12 {
                r.state.carried_by = None;
            }
            // The actual path already includes support displacement. The old
            // endpoint-only reconciliation must not apply it a second time.
            r.support_motion = None;
            let delta = row.velocity_delta;
            // Zero-mass controllers accept geometric motion without owning a
            // physical momentum ledger. A geometric response must not create
            // external velocity that survives this committed interval.
            if r.config.push_mass > 0. && delta.length_squared() > 1e-12 {
                let direction = delta.try_normalize().unwrap_or(rp::Vector::ZERO);
                let motor =
                    rp::Vector::from(r.input_velocity()) + rp::Vector::from(r.tick_velocity);
                let removed = (-motor.dot(direction)).max(0.).min(delta.length());
                let motor_reaction = direction * removed;
                r.contact_velocity =
                    (rp::Vector::from(r.contact_velocity) + motor_reaction).to_array();
                r.external_velocity =
                    (rp::Vector::from(r.external_velocity) + delta - motor_reaction).to_array();
            }
            r.state.grounded = false;
            r.state.ground = None;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
