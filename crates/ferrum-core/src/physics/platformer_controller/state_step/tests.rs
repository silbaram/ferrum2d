//! Shared timing regressions.
use super::*;
use crate::components::CollisionMask;
use crate::physics::{SlopeConfig, KINEMATIC_EPSILON};

fn config() -> PlatformerControllerConfig {
    PlatformerControllerConfig::new(CollisionMask::WALL, 4)
        .with_horizontal_speed(210.0)
        .with_gravity(900.0)
        .with_jump_speed(420.0)
        .with_max_fall_speed(760.0)
        .with_coyote_time_seconds(0.08)
        .with_jump_buffer_seconds(0.10)
}

#[test]
fn platformer_state_step_coyote_window_is_decremented_before_jump_admission() {
    for (remaining, expected_jump) in [(0.02, true), (0.01, false)] {
        let mut state = PlatformerControllerState {
            coyote_time_remaining: remaining,
            jump_buffer_remaining: 0.0,
        };
        let step = prepare_platformer_velocity(
            Velocity::default(),
            PlatformerControllerInput::new(0.0, true),
            config(),
            0.01,
            false,
            &mut Some(&mut state),
        );
        assert_eq!(step.jumped, expected_jump);
        assert_eq!(step.velocity.vy, if expected_jump { -420.0 } else { 9.0 });
        assert_eq!(state.coyote_time_remaining, 0.0);
        assert_eq!(
            state.jump_buffer_remaining,
            if expected_jump { 0.0 } else { 0.1 }
        );
    }
}

#[test]
fn platformer_state_step_buffered_landing_jump_overrides_collision_stop() {
    let mut state = PlatformerControllerState::new();
    let mut state_ref = Some(&mut state);
    let prepared = prepare_platformer_velocity(
        Velocity { vx: 0.0, vy: 300.0 },
        PlatformerControllerInput::new(1.0, true),
        config(),
        0.01,
        false,
        &mut state_ref,
    );
    assert!(!prepared.jumped);
    let landed = finish_platformer_velocity(prepared, true, true, config(), &mut state_ref);
    assert!(landed.jumped);
    assert_eq!(
        landed.velocity,
        Velocity {
            vx: 210.0,
            vy: -420.0
        }
    );
    assert_eq!(state, PlatformerControllerState::new());
}

#[test]
fn platformer_state_step_stateless_and_zero_buffer_do_not_defer_airborne_press() {
    let mut state = PlatformerControllerState::new();
    for mut state_ref in [None, Some(&mut state)] {
        let config = config().with_jump_buffer_seconds(0.0);
        let prepared = prepare_platformer_velocity(
            Velocity::default(),
            PlatformerControllerInput::new(0.0, true),
            config,
            0.01,
            false,
            &mut state_ref,
        );
        assert!(!prepared.jumped);
        let landed = finish_platformer_velocity(prepared, true, true, config, &mut state_ref);
        assert!(!landed.jumped);
        assert_eq!(landed.velocity.vy, 0.0);
    }
}

#[test]
fn platformer_state_step_grounded_gravity_and_ceiling_keep_jump_timing() {
    let mut state = PlatformerControllerState::new();
    let mut state_ref = Some(&mut state);
    let grounded = prepare_platformer_velocity(
        Velocity {
            vx: 10.0,
            vy: 760.0,
        },
        PlatformerControllerInput::new(-2.0, false),
        config(),
        0.01,
        true,
        &mut state_ref,
    );
    assert_eq!(
        grounded.velocity,
        Velocity {
            vx: -210.0,
            vy: 9.0
        }
    );
    let landed = finish_platformer_velocity(grounded, false, true, config(), &mut state_ref);
    assert!(!landed.jumped);
    assert_eq!(landed.velocity.vy, 0.0);
    assert_eq!(state_ref.as_ref().unwrap().coyote_time_remaining, 0.08);

    let jumping = prepare_platformer_velocity(
        landed.velocity,
        PlatformerControllerInput::new(0.0, true),
        config(),
        0.01,
        true,
        &mut state_ref,
    );
    assert_eq!(jumping.velocity.vy, -420.0);
    let ceiling = finish_platformer_velocity(jumping, true, false, config(), &mut state_ref);
    assert!(ceiling.jumped);
    assert_eq!(ceiling.velocity.vy, 0.0);
    assert_eq!(state, PlatformerControllerState::new());
}

#[test]
fn platformer_state_step_sanitizes_invalid_inputs_and_caps_fall_speed() {
    let invalid = config()
        .with_horizontal_speed(f32::NAN)
        .with_gravity(-1.0)
        .with_jump_speed(f32::INFINITY)
        .with_max_fall_speed(f32::NAN)
        .with_ground_probe_distance(0.0)
        .with_step_offset(-1.0)
        .with_coyote_time_seconds(f32::NAN)
        .with_jump_buffer_seconds(-1.0)
        .with_slope_config(SlopeConfig::new(f32::INFINITY, 1.0));
    let (sanitized, dt) = sanitized_platformer_step(invalid, f32::INFINITY);
    assert_eq!(dt, 0.0);
    assert_eq!(sanitized.horizontal_speed, 0.0);
    assert_eq!(sanitized.gravity, 0.0);
    assert_eq!(sanitized.jump_speed, 0.0);
    assert_eq!(sanitized.max_fall_speed, f32::MAX);
    assert_eq!(sanitized.ground_probe_distance, KINEMATIC_EPSILON);
    assert_eq!(sanitized.step_offset, 0.0);
    assert_eq!(sanitized.coyote_time_seconds, 0.0);
    assert_eq!(sanitized.jump_buffer_seconds, 0.0);
    assert_eq!(sanitized.slope, SlopeConfig::disabled());
    let result = prepare_platformer_velocity(
        Velocity {
            vx: f32::NAN,
            vy: f32::INFINITY,
        },
        PlatformerControllerInput::new(f32::NAN, false),
        sanitized,
        dt,
        false,
        &mut None,
    );
    assert_eq!(result.velocity, Velocity::default());
    let capped = prepare_platformer_velocity(
        Velocity { vx: 0.0, vy: 759.0 },
        PlatformerControllerInput::new(0.0, false),
        config(),
        0.01,
        false,
        &mut None,
    );
    assert_eq!(capped.velocity.vy, 760.0);
}
