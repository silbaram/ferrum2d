//! Shared velocity and jump timing, independent of the collision backend.
use crate::components::Velocity;
use crate::physics::{
    PlatformerControllerConfig, PlatformerControllerInput, PlatformerControllerState,
};

use super::super::math::{finite_velocity, sanitize_delta_seconds};
use super::config::{
    clear_controller_jump_timers, sanitize_horizontal_axis, sanitize_platformer_controller_config,
    subtract_timer,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct PlatformerVelocityStep {
    pub(crate) velocity: Velocity,
    pub(crate) jumped: bool,
}

pub(crate) fn sanitized_platformer_step(
    config: PlatformerControllerConfig,
    delta_seconds: f32,
) -> (PlatformerControllerConfig, f32) {
    (
        sanitize_platformer_controller_config(config),
        sanitize_delta_seconds(delta_seconds),
    )
}

/// Computes intent using sanitized parameters and the pre-movement ground result.
pub(crate) fn prepare_platformer_velocity(
    current: Velocity,
    input: PlatformerControllerInput,
    config: PlatformerControllerConfig,
    delta_seconds: f32,
    grounded_before: bool,
    state: &mut Option<&mut PlatformerControllerState>,
) -> PlatformerVelocityStep {
    let mut velocity = finite_velocity(current);
    velocity.vx = sanitize_horizontal_axis(input.horizontal_axis) * config.horizontal_speed;

    let mut wants_jump = input.jump_pressed;
    let mut can_jump = grounded_before;
    if let Some(controller_state) = state {
        if grounded_before {
            controller_state.coyote_time_remaining = config.coyote_time_seconds;
        } else {
            controller_state.coyote_time_remaining =
                subtract_timer(controller_state.coyote_time_remaining, delta_seconds);
        }

        if input.jump_pressed {
            controller_state.jump_buffer_remaining = config.jump_buffer_seconds;
        } else {
            controller_state.jump_buffer_remaining =
                subtract_timer(controller_state.jump_buffer_remaining, delta_seconds);
        }

        wants_jump |= controller_state.jump_buffer_remaining > 0.0;
        can_jump |= controller_state.coyote_time_remaining > 0.0;
    }

    let jumped = wants_jump && can_jump;
    if jumped {
        velocity.vy = -config.jump_speed;
        clear_controller_jump_timers(state);
    } else {
        if grounded_before && velocity.vy > 0.0 {
            velocity.vy = 0.0;
        }
        velocity.vy = (velocity.vy + config.gravity * delta_seconds).min(config.max_fall_speed);
    }
    PlatformerVelocityStep { velocity, jumped }
}

/// Applies collision stopping and a buffered landing jump without moving geometry.
pub(crate) fn finish_platformer_velocity(
    mut step: PlatformerVelocityStep,
    blocked_y: bool,
    grounded_after: bool,
    config: PlatformerControllerConfig,
    state: &mut Option<&mut PlatformerControllerState>,
) -> PlatformerVelocityStep {
    if blocked_y {
        step.velocity.vy = 0.0;
    }
    if !step.jumped
        && state
            .as_ref()
            .is_some_and(|controller_state| controller_state.jump_buffer_remaining > 0.0)
        && grounded_after
    {
        step.jumped = true;
        step.velocity.vy = -config.jump_speed;
        clear_controller_jump_timers(state);
    } else if grounded_after && step.velocity.vy > 0.0 {
        step.velocity.vy = 0.0;
    }
    if !step.jumped {
        if let Some(controller_state) = state {
            if grounded_after {
                controller_state.coyote_time_remaining = config.coyote_time_seconds;
            }
        }
    }
    step
}

#[cfg(test)]
mod tests;
