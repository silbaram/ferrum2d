use crate::physics::{
    PlatformerControllerConfig, PlatformerControllerState, SlopeConfig, KINEMATIC_EPSILON,
};

use super::super::math::sanitize_non_negative;

pub(super) fn is_valid_probe_distance(probe_distance: f32) -> bool {
    probe_distance.is_finite() && probe_distance > 0.0
}

pub(super) fn sanitize_horizontal_axis(horizontal_axis: f32) -> f32 {
    if horizontal_axis.is_finite() {
        horizontal_axis.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

pub(super) fn sanitize_slope_config(slope: SlopeConfig) -> SlopeConfig {
    if !slope.max_climb_angle_radians.is_finite() || slope.max_climb_angle_radians < 0.0 {
        return SlopeConfig::disabled();
    }
    SlopeConfig {
        max_climb_angle_radians: slope.max_climb_angle_radians,
        snap_distance: sanitize_non_negative(slope.snap_distance),
        allow_downhill_snap: slope.allow_downhill_snap,
    }
}

pub(super) fn is_slope_config_enabled(slope: SlopeConfig) -> bool {
    slope.max_climb_angle_radians.is_finite()
        && slope.max_climb_angle_radians >= 0.0
        && slope.snap_distance > 0.0
}

pub(super) fn subtract_timer(value: f32, delta_seconds: f32) -> f32 {
    sanitize_non_negative(value - delta_seconds)
}

pub(super) fn clear_controller_jump_timers(state: &mut Option<&mut PlatformerControllerState>) {
    if let Some(controller_state) = state {
        controller_state.coyote_time_remaining = 0.0;
        controller_state.jump_buffer_remaining = 0.0;
    }
}

pub(super) fn sanitize_platformer_controller_config(
    config: PlatformerControllerConfig,
) -> PlatformerControllerConfig {
    PlatformerControllerConfig {
        horizontal_speed: sanitize_non_negative(config.horizontal_speed),
        gravity: sanitize_non_negative(config.gravity),
        jump_speed: sanitize_non_negative(config.jump_speed),
        max_fall_speed: if config.max_fall_speed.is_finite() && config.max_fall_speed > 0.0 {
            config.max_fall_speed
        } else {
            f32::MAX
        },
        ground_probe_distance: if is_valid_probe_distance(config.ground_probe_distance) {
            config.ground_probe_distance
        } else {
            KINEMATIC_EPSILON
        },
        step_offset: sanitize_non_negative(config.step_offset),
        coyote_time_seconds: sanitize_non_negative(config.coyote_time_seconds),
        jump_buffer_seconds: sanitize_non_negative(config.jump_buffer_seconds),
        slope: sanitize_slope_config(config.slope),
        solid_mask: config.solid_mask,
        one_way_platforms: config.one_way_platforms,
        max_iterations: config.max_iterations,
    }
}
