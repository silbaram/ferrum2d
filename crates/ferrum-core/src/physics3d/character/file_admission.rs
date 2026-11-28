//! Cold saved-payload contracts. No solver state, input or force is consumed.
use super::{CharacterInput, CharacterPreview, CharacterRuntime, CharacterState};
use crate::physics3d::{motion_time::Time, types::valid_vector, Space};
use rapier3d::prelude as rp;

fn normalized_time(value: Time) -> bool {
    // These are saved private f64 fractions, not native f32 observer labels.
    // Keep signed zero and every finite in-range bit pattern unchanged.
    value.is_finite() && (0. ..=1.).contains(&value)
}

fn command_vector(value: &[f32; 3], space: Space) -> bool {
    valid_vector(value) && (space != Space::PlanarXy || value[2] == 0.)
}

fn result_vector(value: &[f32; 3], space: Space) -> bool {
    // A result may include carry, several accepted intervals, or a cold edit.
    // The command setter's component magnitude cap is not its output contract.
    value.iter().all(|v| v.is_finite()) && (space != Space::PlanarXy || value[2] == 0.)
}

fn input_numeric(input: &CharacterInput, space: Space, max_jump: f32) -> bool {
    command_vector(&input.velocity, space)
        && input.jump_speed.is_finite()
        && (0. ..=max_jump).contains(&input.jump_speed)
}

impl CharacterRuntime {
    pub(in crate::physics3d) fn saved_payload_valid(&self, space: Space) -> bool {
        // config and owning body/capsule have already passed native admission.
        if !input_numeric(&self.input, space, self.config.max_vertical_speed)
            || rp::Vector::from(self.input.velocity)
                .dot(self.config.up.into())
                .abs()
                > 1.0e-5
            || !self
                .state
                .saved_payload_valid(space, self.config.max_vertical_speed)
            || !command_vector(&self.tick_velocity, space)
            || !normalized_time(self.carry_fraction)
            || ![
                self.external_velocity,
                self.external_force,
                self.pending_impulse,
                self.contact_velocity,
            ]
            .iter()
            .all(|v| command_vector(v, space))
        {
            return false;
        }
        if self.config.push_mass == 0.
            && [
                self.external_velocity,
                self.external_force,
                self.pending_impulse,
                self.contact_velocity,
            ]
            .iter()
            .any(|v| *v != [0.; 3])
        {
            // enable/re-enable initializes these arrays, while the public force
            // API and finite-mass coupling never supply them at zero mass.
            return false;
        }
        if let Some(stop) = &self.motion_stop {
            if !normalized_time(stop.fraction) {
                return false;
            }
            let mut count = 0;
            let mut hole = false;
            for (index, body) in stop.bodies.iter().enumerate() {
                if let Some(body) = body {
                    if hole || stop.bodies[..index].contains(&Some(*body)) {
                        return false;
                    }
                    count += 1;
                } else {
                    hole = true;
                }
            }
            if count == 0 {
                return false;
            }
        }
        // carry_blocker, carried_by and stop bodies may refer to removed actors.
        // Their consumers use checked lookup; no current-world query is run.
        true
    }
}

impl CharacterState {
    pub(in crate::physics3d) fn saved_payload_valid(&self, space: Space, max_speed: f32) -> bool {
        self.grounded == self.ground.is_some()
            && self.ground.is_none_or(|ground| !ground.sensor)
            && result_vector(&self.translation, space)
            && result_vector(&self.velocity, space)
            && result_vector(&self.carry_translation, space)
            && self.vertical_speed.is_finite()
            && (-max_speed..=max_speed).contains(&self.vertical_speed)
            && (!self.grounded || (!self.sliding && self.vertical_speed == 0.))
            && self.failed_pair_casts <= self.character_pair_casts
            && self.failed_moving_obstacle_casts <= self.moving_obstacle_casts
            && self.failed_moving_obstacle_contacts <= self.moving_obstacle_contact_checks
    }
}

impl CharacterPreview {
    pub(in crate::physics3d) fn saved_payload_valid(&self, space: Space) -> bool {
        // The old config is deliberately absent from this wire type. Re-enable
        // can change its up/mass/speed while this old preview remains stored.
        input_numeric(&self.input, space, 10000.)
            && self.state.saved_payload_valid(space, 10000.)
            && [
                self.external_velocity,
                self.pending_impulse,
                self.contact_velocity,
            ]
            .iter()
            .all(|v| command_vector(v, space))
    }
}
