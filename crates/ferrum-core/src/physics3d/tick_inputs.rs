//! Engine inputs staged for the next fixed tick. They are applied after the
//! tick's rollback journal opens, so a zero-progress rejection restores the
//! pre-input bodies and the caller can stage the same inputs again on retry.
use super::{BodyId, PhysicsError, PhysicsWorld3d};

/// One body's legacy-component inputs, applied in field order.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct TickInput {
    pub sleeping: Option<bool>,
    pub force: Option<([f32; 3], [f32; 3])>,
    pub impulse: Option<[f32; 3]>,
    pub torque_impulse: Option<[f32; 3]>,
}

impl PhysicsWorld3d {
    /// Validates like the direct setters and queues for the next tick begin.
    pub(crate) fn stage_tick_input(
        &mut self,
        id: BodyId,
        input: TickInput,
    ) -> Result<(), PhysicsError> {
        self.validate_dynamic_body(id)?;
        if let Some((force, torque)) = input.force {
            self.validate_dynamic_motion(id, force, torque)?;
        }
        if let Some(impulse) = input.impulse {
            self.validate_dynamic_motion(id, impulse, [0.0; 3])?;
        }
        if let Some(torque) = input.torque_impulse {
            self.validate_dynamic_motion(id, [0.0; 3], torque)?;
        }
        self.staged_tick_inputs.push((id, input));
        Ok(())
    }

    /// Drops inputs that no tick consumed, e.g. after a failed admission.
    pub(crate) fn discard_staged_tick_inputs(&mut self) {
        self.staged_tick_inputs.clear();
    }

    pub(super) fn apply_staged_tick_inputs(&mut self) {
        let mut inputs = std::mem::take(&mut self.staged_tick_inputs);
        for &(id, input) in &inputs {
            // Validated at staging; no body kind change can run in between.
            if let Some(sleeping) = input.sleeping {
                let _ = self.set_sleeping(id, sleeping);
            }
            if let Some((force, torque)) = input.force {
                let _ = self.add_force(id, force, torque);
            }
            if let Some(impulse) = input.impulse {
                let _ = self.apply_impulse(id, impulse);
            }
            if let Some(torque) = input.torque_impulse {
                let _ = self.apply_torque_impulse(id, torque);
            }
        }
        inputs.clear();
        self.staged_tick_inputs = inputs;
    }
}
