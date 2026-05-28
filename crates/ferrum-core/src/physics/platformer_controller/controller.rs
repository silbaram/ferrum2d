use crate::components::Velocity;
use crate::entity::Entity;
use crate::physics::{
    KinematicMoveSettings, PhysicsCounters, PlatformerControllerConfig, PlatformerControllerInput,
    PlatformerControllerResult, PlatformerControllerState, SlopeSegment, KINEMATIC_EPSILON,
};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::super::math::{finite_velocity, sanitize_delta_seconds};
use super::config::{
    clear_controller_jump_timers, sanitize_horizontal_axis, sanitize_platformer_controller_config,
    subtract_timer,
};
use super::ground_probe::ground_probe_internal;
use super::slope_ground::{
    merge_slope_ground_hit, move_with_optional_slope_snap, slope_ground_hit, SlopeSnapDirection,
    SlopeSnapSettings,
};
use super::step_offset::{move_with_optional_step_offset, StepOffsetSettings};

#[derive(Default)]
pub(super) struct PlatformerControllerRuntime<'a> {
    state: Option<&'a mut PlatformerControllerState>,
    counters: Option<&'a mut PhysicsCounters>,
    slopes: &'a [SlopeSegment],
}

impl<'a> PlatformerControllerRuntime<'a> {
    pub(super) fn new(
        state: Option<&'a mut PlatformerControllerState>,
        counters: Option<&'a mut PhysicsCounters>,
    ) -> Self {
        Self::new_with_slopes(state, counters, &[])
    }

    pub(super) fn new_with_slopes(
        state: Option<&'a mut PlatformerControllerState>,
        counters: Option<&'a mut PhysicsCounters>,
        slopes: &'a [SlopeSegment],
    ) -> Self {
        Self {
            state,
            counters,
            slopes,
        }
    }
}

pub(super) fn move_platformer_controller_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    input: PlatformerControllerInput,
    config: PlatformerControllerConfig,
    delta_seconds: f32,
    runtime: PlatformerControllerRuntime<'_>,
) -> PlatformerControllerResult {
    let PlatformerControllerRuntime {
        mut state,
        mut counters,
        slopes,
    } = runtime;
    let config = sanitize_platformer_controller_config(config);
    let delta_seconds = sanitize_delta_seconds(delta_seconds);
    let ground_before_probe = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
    let slope_before = slope_ground_hit(
        world,
        tilemap,
        entity,
        slopes,
        config.slope,
        true,
        config.slope.allow_downhill_snap,
    );
    let ground_before = merge_slope_ground_hit(ground_before_probe, slope_before);
    let mut velocity = finite_velocity(world.velocity(entity).unwrap_or_default());
    velocity.vx = sanitize_horizontal_axis(input.horizontal_axis) * config.horizontal_speed;

    let mut wants_jump = input.jump_pressed;
    let mut can_jump = ground_before.is_some();
    if let Some(controller_state) = &mut state {
        if ground_before.is_some() {
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

    let mut jumped = wants_jump && can_jump;
    if jumped {
        velocity.vy = -config.jump_speed;
        clear_controller_jump_timers(&mut state);
    } else {
        if ground_before.is_some() && velocity.vy > 0.0 {
            velocity.vy = 0.0;
        }
        velocity.vy = (velocity.vy + config.gravity * delta_seconds).min(config.max_fall_speed);
    }

    let movement_settings = KinematicMoveSettings::new(
        config.solid_mask,
        config.one_way_platforms,
        config.max_iterations,
    );
    let mut movement = move_with_optional_step_offset(
        world,
        tilemap,
        entity,
        Velocity {
            vx: velocity.vx * delta_seconds,
            vy: velocity.vy * delta_seconds,
        },
        movement_settings,
        if !jumped && ground_before.is_some() {
            StepOffsetSettings {
                enabled: true,
                offset: config.step_offset,
                ground_probe_distance: config.ground_probe_distance,
                solid_mask: config.solid_mask,
            }
        } else {
            StepOffsetSettings::disabled()
        },
        counters.as_deref_mut(),
    );
    if !jumped {
        let allow_upward_snap = ground_before.is_some();
        let allow_downward_snap = config.slope.allow_downhill_snap
            && (ground_before.is_some() || velocity.vy >= -KINEMATIC_EPSILON);
        movement = move_with_optional_slope_snap(
            world,
            tilemap,
            entity,
            movement,
            movement_settings,
            SlopeSnapSettings {
                slopes,
                slope: config.slope,
                direction: SlopeSnapDirection {
                    allow_upward: allow_upward_snap,
                    allow_downward: allow_downward_snap,
                },
            },
            counters,
        );
    }
    if movement.blocked_y {
        velocity.vy = 0.0;
    }

    let ground_after_probe = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
    let slope_after = slope_ground_hit(
        world,
        tilemap,
        entity,
        slopes,
        config.slope,
        true,
        config.slope.allow_downhill_snap,
    );
    let ground_after = merge_slope_ground_hit(ground_after_probe, slope_after);
    if !jumped
        && state
            .as_ref()
            .is_some_and(|controller_state| controller_state.jump_buffer_remaining > 0.0)
        && ground_after.is_some()
    {
        jumped = true;
        velocity.vy = -config.jump_speed;
        clear_controller_jump_timers(&mut state);
    } else if ground_after.is_some() && velocity.vy > 0.0 {
        velocity.vy = 0.0;
    }
    if !jumped {
        if let Some(controller_state) = &mut state {
            if ground_after.is_some() {
                controller_state.coyote_time_remaining = config.coyote_time_seconds;
            }
        }
    }
    world.set_velocity(entity, velocity);

    PlatformerControllerResult {
        movement,
        velocity,
        ground_before,
        ground_after,
        jumped,
        grounded: ground_after.is_some() && !jumped,
    }
}
