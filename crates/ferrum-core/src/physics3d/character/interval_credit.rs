//! Local command/momentum credit before accepting any backend time.
use super::*;

#[derive(Clone)]
pub(in crate::physics3d) struct Credit {
    input: CharacterInput,
    state: CharacterState,
    carry_fraction: crate::physics3d::solver_trajectory::Time,
    carry_blocker: Option<BodyId>,
    motion_stop: Option<super::super::character_motion::MotionStop>,
    external_velocity: [f32; 3],
    pending_impulse: [f32; 3],
    contact_velocity: [f32; 3],
    free_velocity: [f32; 3],
    free_translation: [f32; 3],
    free_carry_translation: [f32; 3],
    support_motion: Option<(BodyId, rp::Vector, rp::Vector)>,
    dynamic_iterations: usize,
    dynamic_limited: bool,
}
impl Credit {
    pub(in crate::physics3d) fn original_carry_support(&self) -> Option<BodyId> {
        (self.state.grounded && self.input.jump_speed == 0.)
            .then_some(self.state.ground)
            .flatten()
            .map(|ground| ground.body)
    }
}
impl CharacterRuntime {
    pub(in crate::physics3d) fn interval_credit(&self) -> Credit {
        Credit {
            input: self.input.clone(),
            state: self.state.clone(),
            carry_fraction: self.carry_fraction,
            carry_blocker: self.carry_blocker,
            motion_stop: self.motion_stop.clone(),
            external_velocity: self.external_velocity,
            pending_impulse: self.pending_impulse,
            contact_velocity: self.contact_velocity,
            free_velocity: self.free_velocity,
            free_translation: self.free_translation,
            free_carry_translation: self.free_carry_translation,
            support_motion: self.support_motion,
            dynamic_iterations: self.dynamic_iterations,
            dynamic_limited: self.dynamic_limited,
        }
    }
    pub(in crate::physics3d) fn return_interval_credit(&mut self, credit: &Credit) {
        self.input.clone_from(&credit.input);
        self.state.clone_from(&credit.state);
        self.carry_fraction = credit.carry_fraction;
        self.carry_blocker = credit.carry_blocker;
        self.motion_stop.clone_from(&credit.motion_stop);
        self.external_velocity = credit.external_velocity;
        self.pending_impulse = credit.pending_impulse;
        self.contact_velocity = credit.contact_velocity;
        self.free_velocity = credit.free_velocity;
        self.free_translation = credit.free_translation;
        self.free_carry_translation = credit.free_carry_translation;
        self.support_motion = credit.support_motion;
        self.dynamic_iterations = credit.dynamic_iterations;
        self.dynamic_limited = credit.dynamic_limited;
    }
}
