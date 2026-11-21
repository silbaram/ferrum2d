//! Native variable duration, frame admission and ownership integration regressions.
use super::*;
use crate::components::{CircleCollider, CollisionLayer};
use crate::physics::RigidBodyStepConfig;
use crate::physics3d::{BodyKind, Shape};

fn config() -> WorldConfig {
    WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    }
}
fn engine() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(config()).unwrap();
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    e
}
fn dynamic(e: &mut Engine, velocity: [f32; 3]) -> Entity {
    e.create_unified_body(
        BodyDesc {
            linear_velocity: velocity,
            ..Default::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        [0.; 3],
    )
    .unwrap()
}
fn character(e: &mut Engine) -> Entity {
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
            [0.; 3],
        )
        .unwrap();
    e.enable_unified_character(
        a,
        CharacterConfig {
            push_mass: 2.,
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    a
}
fn near(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 0.00003,
        "{actual} != {expected}"
    );
}
fn nominal(e: &Engine) {
    assert_eq!(e.unified_physics_clock_step_seconds(), 0.01);
    let world = &e.unified_physics.as_ref().unwrap().physics;
    assert_eq!(world.config().step_seconds, 0.01);
    assert!(!world.has_active_interval());
    assert!(world.capture_snapshot().is_ok());
}

#[test]
fn variable_clock_actual_durations_drive_native_and_automatic_component_motion_once() {
    let mut e = engine();
    let body = dynamic(&mut e, [2., 0., 0.]);
    let component = e.world.spawn_entity();
    e.world
        .set_transform(component, Transform2D { x: 10., y: 0. });
    e.world.set_circle_collider(
        component,
        CircleCollider::new(0.2, false, CollisionLayer::Enemy),
    );
    e.world.set_velocity(component, Velocity { vx: 3., vy: 0. });
    let mut time = 0.;
    for dt in [0.007_f32, 0.023, 0.04, 0.001, 0.1] {
        e.update(f64::from(dt));
        time += dt;
        assert_eq!(e.unified_physics_error(), None);
        assert!(!e.fixed_timestep_enabled());
        near(e.fixed_timestep_consumed_seconds(), dt);
        assert_eq!(e.fixed_timestep_dropped_seconds(), 0.);
        assert_eq!(e.physics_fixed_steps(), 1);
        near(
            e.unified_body_state(body).unwrap().pose.position[0],
            2. * time,
        );
        near(e.world.transform(component).unwrap().x, 10. + 3. * time);
        nominal(&e);
    }
}

#[test]
fn variable_clock_character_force_uses_actual_interval_and_impulse_once() {
    let mut e = engine();
    let a = character(&mut e);
    let body = e.unified_body_id(a).unwrap();
    let physics = &mut e.unified_physics.as_mut().unwrap().physics;
    physics.add_character_force(body, [4., 0., 0.]).unwrap();
    physics.apply_character_impulse(body, [2., 0., 0.]).unwrap();
    let mut velocity = 1.;
    let mut x = 0.;
    for dt in [0.007_f32, 0.023, 0.04] {
        velocity += 2. * dt;
        x += velocity * dt;
        e.update(f64::from(dt));
        assert_eq!(e.unified_physics_error(), None);
        near(e.unified_character_state(a).unwrap().velocity[0], velocity);
        near(e.unified_body_state(a).unwrap().pose.position[0], x);
        nominal(&e);
    }
}

#[test]
fn variable_clock_invalid_frame_is_atomic_for_elapsed_camera_input_and_pending_forces() {
    let mut e = engine();
    let a = character(&mut e);
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [2., 0., 0.])
        .unwrap();
    e.set_input(false, false, false, false, true, false, false, 3., 4.);
    let before = crate::engine::persistence::encode(&e).unwrap();
    for dt in [
        -0.01,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::MAX,
        0.00001,
        f64::MIN_POSITIVE,
    ] {
        e.update_frame(dt, true, true, true);
        assert_eq!(
            e.take_unified_physics_error(),
            Some(UnifiedPhysicsError::ClockMismatch)
        );
        assert_eq!(
            crate::engine::persistence::encode(&e).unwrap(),
            before,
            "partial frame mutation for {dt}"
        );
        nominal(&e);
    }
    e.update(0.02);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.02);
    near(e.unified_character_state(a).unwrap().velocity[0], 1.);
}

#[test]
fn variable_clock_zero_frame_keeps_pending_impulse_and_step() {
    let mut e = engine();
    let a = character(&mut e);
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [2., 0., 0.])
        .unwrap();
    let before = e.unified_body_state(a).unwrap();
    let elapsed = e.elapsed_seconds;
    e.update(0.);
    assert_eq!(e.unified_body_state(a).unwrap(), before);
    assert_eq!(e.elapsed_seconds, elapsed);
    assert_eq!(e.fixed_timestep_consumed_seconds(), 0.);
    e.update(0.03);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.03);
    near(e.unified_character_state(a).unwrap().velocity[0], 1.);
}

#[test]
fn variable_clock_large_frame_reports_actual_bounded_duration() {
    let mut e = engine();
    let a = dynamic(&mut e, [3., 0., 0.]);
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 2));
    let elapsed = e.elapsed_seconds;
    e.update(1.);
    assert_eq!(e.unified_physics_error(), None);
    near(e.fixed_timestep_consumed_seconds(), 0.2);
    near(e.fixed_timestep_dropped_seconds(), 0.8);
    assert_eq!(e.physics_fixed_steps(), 2);
    near((e.elapsed_seconds - elapsed) as f32, 0.2);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.6);
    nominal(&e);
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    e.update(1.);
    near(e.fixed_timestep_consumed_seconds(), 0.25);
    near(e.fixed_timestep_dropped_seconds(), 0.75);
    assert_eq!(e.physics_fixed_steps(), 3);
    near(e.unified_body_state(a).unwrap().pose.position[0], 1.35);
    nominal(&e);
}

#[test]
fn variable_clock_checked_setter_rejects_before_mutation_and_preserves_fixed_mismatch() {
    let mut e = engine();
    let a = dynamic(&mut e, [1., 0., 0.]);
    let before = crate::engine::persistence::encode(&e).unwrap();
    for (enabled, step, frame, steps) in [
        (false, 0.02, 0.25, 8),
        (true, 0.02, 0.25, 8),
        (true, f32::NAN, 0.25, 8),
        (false, 0.01, f32::INFINITY, 8),
        (false, 0.01, 0., 8),
        (false, 0.01, 0.25, 0),
        (false, 0.01, 0.25, 1025),
        (false, 0.01, 0.25, u32::MAX),
        (false, 0.01, f32::MAX, 8),
    ] {
        assert!(!e.configure_unified_physics_clock(enabled, step, frame, steps));
        assert_eq!(
            e.take_unified_physics_error(),
            Some(UnifiedPhysicsError::ClockMismatch)
        );
        assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    }
    assert_eq!(e.unified_physics_clock_version(), 1);
    assert!(e.configure_unified_physics_clock(true, 0.01, 0.25, 8));
    let state = e.unified_body_state(a).unwrap();
    e.step_rigid_bodies(0.02);
    assert_eq!(e.unified_body_state(a).unwrap(), state);
    assert_eq!(
        e.take_unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    e.step_rigid_bodies(0.01);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.01);
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    e.step_rigid_bodies(0.023);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.033);
    nominal(&e);
}

#[test]
fn variable_clock_nested_and_failed_interval_restore_nominal_checkpoint_boundary() {
    let mut e = engine();
    dynamic(&mut e, [1., 0., 0.]);
    let result = e.with_unified_interval(0.023, |engine| {
        assert_eq!(engine.unified_physics_clock_step_seconds(), 0.01);
        assert_eq!(
            engine
                .unified_physics
                .as_ref()
                .unwrap()
                .physics
                .config()
                .step_seconds,
            0.023
        );
        assert!(
            engine.runtime_checkpoint().is_err(),
            "No transient clock can become a checkpoint"
        );
        let nested = engine.with_unified_interval(0.023, |engine| {
            assert_eq!(
                engine
                    .unified_physics
                    .as_ref()
                    .unwrap()
                    .physics
                    .config()
                    .step_seconds,
                0.023
            );
            Err::<(), ()>(())
        });
        assert_eq!(nested, Ok(Err(())));
        assert_eq!(
            engine
                .unified_physics
                .as_ref()
                .unwrap()
                .physics
                .config()
                .step_seconds,
            0.023
        );
        assert!(!engine.configure_unified_physics_clock(false, 0.01, 0.25, 8));
        assert_eq!(
            engine.take_unified_physics_error(),
            Some(UnifiedPhysicsError::ClockMismatch)
        );
        Err::<(), ()>(())
    });
    assert_eq!(result, Ok(Err(())));
    nominal(&e);
    assert!(e.runtime_checkpoint().is_ok());
}

#[test]
fn variable_clock_manual_ownership_and_one_shot_solver_are_independent() {
    let mut e = engine();
    let a = dynamic(&mut e, [2., 0., 0.]);
    e.set_auto_rigid_body_step_enabled(false);
    e.update(0.03);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.);
    let settings = e.auto_rigid_body_step_config;
    let request = RigidBodyStepConfig {
        gravity: Velocity { vx: 3., vy: 0. },
        ..settings
    };
    assert!(e.step_unified_manually(0.02, Some(request)));
    let velocity = e.unified_body_state(a).unwrap().linear_velocity[0];
    assert!(velocity > 2.05);
    assert_eq!(e.auto_rigid_body_step_config, settings);
    assert_eq!(
        e.unified_physics.as_ref().unwrap().physics.config().gravity,
        [0.; 3]
    );
    e.step_rigid_bodies(0.03);
    near(
        e.unified_body_state(a).unwrap().linear_velocity[0],
        velocity,
    );
    nominal(&e);
}

#[test]
fn variable_clock_checkpoint_replays_intervals_and_future_scene_clock_mode() {
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(config()).unwrap();
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    e.use_data_scene();
    assert!(!e.fixed_timestep_enabled());
    let a = dynamic(&mut e, [2., 0., 0.]);
    let checkpoint = e.runtime_checkpoint().unwrap();
    let mut states = Vec::new();
    for dt in [0.007, 0.023, 0.15] {
        e.update(dt);
        states.push(e.unified_body_state(a).unwrap());
    }
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    for (dt, state) in [0.007, 0.023, 0.15].into_iter().zip(states) {
        e.update(dt);
        assert_eq!(e.unified_body_state(a).unwrap(), state);
        nominal(&e);
    }
    e.use_breakout_scene();
    assert!(e.physics_spec_backend_active());
    assert!(!e.fixed_timestep_enabled());
    e.use_platformer_scene();
    assert!(e.physics_spec_backend_active());
    assert!(!e.fixed_timestep_enabled());
    e.use_data_scene();
    assert!(e.physics_spec_backend_active());
    assert!(!e.fixed_timestep_enabled());
    assert!(e.unified_body_state(a).is_err());
}

#[test]
fn variable_clock_terrain_phase_and_supported_character_use_same_actual_time() {
    let mut e = super::platform_tests::engine(0.01);
    let a = super::platform_tests::actor(&mut e);
    super::platform_tests::configure(&mut e, [1., 0., 0.], 1., 0.);
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    let before = e.unified_body_state(a).unwrap().pose.position;
    let mut accepted = 0.;
    for dt in [0.007_f32, 0.023, 0.04] {
        e.update(f64::from(dt));
        accepted += dt;
        assert_eq!(e.unified_physics_error(), None);
        near(e.spatial_scene.moving_platforms[0].phase as f32, accepted);
        near(
            e.unified_body_state(a).unwrap().pose.position[0] - before[0],
            accepted,
        );
        assert!(e.unified_character_state(a).unwrap().grounded);
        nominal(&e);
    }
}

#[test]
fn variable_clock_builtin_breakout_and_platformer_accept_actual_frame_and_manual_interval() {
    for platformer in [false, true] {
        let mut e = Engine::new();
        if platformer {
            e.use_platformer_scene();
        } else {
            e.use_breakout_scene();
        }
        e.configure_unified_physics(config()).unwrap();
        assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 8));
        e.input.enter = 1;
        e.update(0.007);
        e.input = crate::input::InputState::default();
        assert_eq!(e.unified_physics_error(), None);
        let a = if platformer {
            e.scenes.platformer().player_entity().unwrap()
        } else {
            e.scenes.breakout().ball_entity().unwrap()
        };
        let p = e.world.transform(a).unwrap();
        e.update(0.023);
        assert_eq!(e.unified_physics_error(), None);
        assert_ne!(e.world.transform(a).unwrap(), p);
        e.set_auto_rigid_body_step_enabled(false);
        let state = e.unified_body_state(a).unwrap();
        e.update(0.017);
        assert_eq!(e.unified_body_state(a).unwrap(), state);
        e.step_rigid_bodies(0.031);
        assert_eq!(e.unified_physics_error(), None);
        assert_ne!(e.unified_body_state(a).unwrap(), state);
        nominal(&e);
    }
}

#[test]
fn variable_clock_clamped_frame_tweens_and_gameplay_timer_share_physical_time() {
    use crate::tweens::{SpriteTint, TweenEasing};
    let mut e = engine();
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 2));
    let a = e.world.spawn_enemy(10., 10., 1);
    assert!(e.tweens.start_sprite_tint(
        &mut e.world,
        a,
        SpriteTint::new(1., 1., 1., 1.),
        SpriteTint::new(0., 0., 0., 0.),
        1.,
        TweenEasing::Linear,
    ));
    assert!(e.set_gameplay_timer_trigger(a.id, a.generation, 77, 1.));
    e.update(1.);
    assert_eq!(e.unified_physics_error(), None);
    near(e.world.sprite_at_index(a.id as usize).unwrap().r, 0.8);
    near(
        e.world.gameplay_timer_trigger(a).unwrap().remaining_seconds,
        0.8,
    );
    near(e.fixed_timestep_consumed_seconds(), 0.2);
    nominal(&e);
}

#[test]
fn variable_clock_latched_tap_and_held_press_are_consumed_only_once_across_split_frame() {
    use crate::gameplay_event::GameplayEvent;
    let mut e = engine();
    let actor = e.world.spawn_entity();
    e.world.set_transform(actor, Transform2D { x: 0., y: 0. });
    let site = e.world.spawn_entity();
    e.world.set_transform(site, Transform2D { x: 10., y: 0. });
    assert!(e.set_gameplay_interaction(site.id, site.generation, 17, 30., false));
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 91));
    assert!(e.set_input_action_binding(
        91,
        0,
        crate::input::INPUT_ACTION_CONTROL_SPACE,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    e.set_input(false, false, false, false, true, false, false, 0., 0.);
    e.set_input(false, false, false, false, false, false, false, 0., 0.);
    e.update(f64::NAN);
    assert_eq!(
        e.take_unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    e.update(0.25);
    assert_eq!(
        e.frame_buffers.gameplay_events,
        vec![GameplayEvent::interaction(actor, site, 17, false, false)]
    );
    e.clear_gameplay_events();
    e.update(0.25);
    assert!(e.frame_buffers.gameplay_events.is_empty());
    e.set_input(false, false, false, false, true, false, false, 0., 0.);
    e.update(0.25);
    assert_eq!(
        e.frame_buffers.gameplay_events,
        vec![GameplayEvent::interaction(actor, site, 17, false, false)]
    );
    e.clear_gameplay_events();
    e.update(0.25);
    assert!(
        e.frame_buffers.gameplay_events.is_empty(),
        "Held input is not a repeated pressed edge"
    );
}

#[test]
fn variable_clock_policy_query_and_checkpoint_distinguish_current_scene_from_future_default() {
    let mut e = Engine::new();
    assert!(!e.default_physics_policy_fixed_timestep());
    e.configure_unified_physics_defaults(config()).unwrap();
    assert!(e.default_physics_policy_fixed_timestep());
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    assert!(!e.default_physics_policy_fixed_timestep());
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        step_seconds: 0.02,
        ..config()
    })
    .unwrap();
    assert!(e.fixed_timestep_enabled());
    assert!(!e.default_physics_policy_fixed_timestep());
    assert_eq!(e.unified_physics_clock_step_seconds(), 0.02);
    let checkpoint = e.runtime_checkpoint().unwrap();
    e.use_breakout_scene();
    assert!(!e.fixed_timestep_enabled());
    assert_eq!(e.unified_physics_clock_step_seconds(), 0.01);
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    assert!(e.fixed_timestep_enabled());
    assert!(!e.default_physics_policy_fixed_timestep());
    e.use_platformer_scene();
    assert!(!e.fixed_timestep_enabled());
    assert!(e.configure_unified_physics_clock(true, 0.01, 0.25, 8));
    assert!(e.default_physics_policy_fixed_timestep());
    e.use_data_scene();
    assert!(e.fixed_timestep_enabled());
}

#[test]
fn variable_clock_manual_invalid_duration_does_not_consume_queued_impulse_or_ownership() {
    let mut e = engine();
    let a = character(&mut e);
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [2., 0., 0.])
        .unwrap();
    e.set_auto_rigid_body_step_enabled(false);
    let before = crate::engine::persistence::encode(&e).unwrap();
    for dt in [-0.01, f32::NAN, f32::INFINITY, 0.00001, 0.10001] {
        e.step_rigid_bodies(dt);
        assert_eq!(
            e.take_unified_physics_error(),
            Some(UnifiedPhysicsError::ClockMismatch)
        );
        assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    }
    e.step_rigid_bodies(0.0);
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    e.step_rigid_bodies(0.02);
    near(e.unified_character_state(a).unwrap().velocity[0], 1.);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.02);
    assert!(!e.auto_rigid_body_step_enabled);
    nominal(&e);
}

#[test]
fn variable_clock_zero_frame_rebuilds_authored_visual_without_advancing_simulation() {
    let mut e = engine();
    assert!(e.configure_data_scene_camera(400., 240., u32::MAX, 0, false, 0., 0., 0., 0., 0.));
    let a = character(&mut e);
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [2., 0., 0.])
        .unwrap();
    let visual = e.world.spawn_enemy(100., 100., 7);
    let elapsed = e.elapsed_seconds;
    e.update_frame(0., true, false, false);
    assert_eq!(e.frame_buffers.render_commands.len(), 1);
    assert_eq!(e.frame_buffers.render_commands[0].texture_id, 7.);
    e.world
        .sprite_mut_at_index(visual.id as usize)
        .unwrap()
        .texture_id = 9;
    e.world
        .set_transform(visual, Transform2D { x: 120., y: 100. });
    e.update_frame(0., true, false, false);
    assert_eq!(e.frame_buffers.render_commands.len(), 1);
    assert_eq!(e.frame_buffers.render_commands[0].texture_id, 9.);
    assert_eq!(e.elapsed_seconds, elapsed);
    assert_eq!(e.unified_body_state(a).unwrap().pose.position, [0.; 3]);
    e.update(0.02);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.02);
    near(e.unified_character_state(a).unwrap().velocity[0], 1.);
}

#[test]
fn variable_clock_subnominal_frame_budget_is_not_raised_to_nominal_tick() {
    let mut e = engine();
    let a = dynamic(&mut e, [2., 0., 0.]);
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.0001, 8));
    e.update(0.03);
    assert_eq!(e.unified_physics_error(), None);
    near(e.fixed_timestep_consumed_seconds(), 0.0001);
    near(e.fixed_timestep_dropped_seconds(), 0.0299);
    assert_eq!(e.physics_fixed_steps(), 1);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.0002);
    nominal(&e);
}

#[test]
fn variable_clock_larger_actual_duration_revalidates_pending_character_force_atomically() {
    let mut e = engine();
    let a = character(&mut e);
    let body = e.unified_body_id(a).unwrap();
    // Nominal .01 admits this finite-mass force, but .1 would exceed the same
    // external-velocity bounds. The complete frame must reject before any state advances.
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .enable_character(
            body,
            CharacterConfig {
                push_mass: 0.0001,
                step_height: 0.,
                snap_distance: 0.,
                ..Default::default()
            },
        )
        .unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_character_force(body, [10000., 0., 0.])
        .unwrap();
    let before = crate::engine::persistence::encode(&e).unwrap();
    e.update(0.1);
    assert_eq!(
        e.take_unified_physics_error(),
        Some(PhysicsError::InvalidCharacter.into())
    );
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    e.step_rigid_bodies(0.1);
    assert_eq!(
        e.take_unified_physics_error(),
        Some(PhysicsError::InvalidCharacter.into())
    );
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    nominal(&e);
}

#[test]
fn variable_clock_native_fixed_entry_rejects_nonfinite_input_but_retains_fixed_quantum() {
    let mut e = engine();
    let a = dynamic(&mut e, [2., 0., 0.]);
    assert!(e.configure_unified_physics_clock(true, 0.01, 0.25, 8));
    e.set_input(false, false, false, false, true, false, false, 7., 9.);
    let before = crate::engine::persistence::encode(&e).unwrap();
    for dt in [-0.01, f64::NAN, f64::INFINITY, f64::NEG_INFINITY, f64::MAX] {
        e.update_frame(dt, true, true, true);
        assert_eq!(
            e.take_unified_physics_error(),
            Some(UnifiedPhysicsError::ClockMismatch)
        );
        assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    }
    e.update(0.00001);
    assert_eq!(e.unified_physics_error(), None);
    assert_eq!(e.physics_fixed_steps(), 0);
    assert!(e.fixed_timestep_alpha() > 0.);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.);
    e.update(0.00399);
    assert_eq!(e.physics_fixed_steps(), 0);
    e.update(0.006);
    assert_eq!(e.physics_fixed_steps(), 1);
    near(e.unified_body_state(a).unwrap().pose.position[0], 0.02);
    near(e.fixed_timestep_consumed_seconds(), 0.01);
    nominal(&e);
}

fn opposing_force_peak(initial_speed: f32) -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        step_seconds: 0.1,
        ..config()
    })
    .unwrap();
    assert!(e.configure_unified_physics_clock(false, 0.1, 0.25, 8));
    let a = character(&mut e);
    e.enable_unified_character(
        a,
        CharacterConfig {
            push_mass: 1.,
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [initial_speed, 0., 0.])
        .unwrap();
    e.update(0.1);
    assert_eq!(e.unified_physics_error(), None);
    assert_eq!(
        e.unified_character_state(a).unwrap().velocity[0],
        initial_speed
    );
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_character_force(body, [-1_000_000., 0., 0.])
        .unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [1_000_000., 0., 0.])
        .unwrap();
    (e, a)
}
fn pending_frame_work(e: &mut Engine) {
    use crate::particles::{ParticlePreset, ParticleRange};
    use crate::tweens::{SpriteTint, TweenEasing};
    let visual = e.world.spawn_enemy(100., 100., 7);
    assert!(e.tweens.start_sprite_tint(
        &mut e.world,
        visual,
        SpriteTint::new(1., 1., 1., 1.),
        SpriteTint::new(0., 0., 0., 0.),
        1.,
        TweenEasing::Linear
    ));
    assert!(e.set_gameplay_timer_trigger(visual.id, visual.generation, 44, 1.));
    let mut preset = ParticlePreset::new(7);
    preset.burst_count = 1;
    preset.lifetime_seconds = ParticleRange::constant(2.);
    assert_eq!(e.particles.spawn_burst(preset, 100., 100.), 1);
    e.set_input(false, false, false, false, true, false, false, 15., 20.);
    e.set_input(false, false, false, false, false, false, false, 15., 20.);
}

#[test]
fn variable_clock_opposing_force_first_peak_rejects_before_any_frame_mutation() {
    let (mut e, a) = opposing_force_peak(90_000.);
    pending_frame_work(&mut e);
    assert_eq!(e.physics_fixed_steps(), 1);
    let physics = &e.unified_physics.as_ref().unwrap().physics;
    assert!(
        physics.validate_character_force_duration(0.1).is_ok(),
        "Cold nominal command admission"
    );
    assert!(
        physics.validate_character_force_duration(0.25).is_ok(),
        "Final endpoint alone is insufficient"
    );
    assert!(
        physics
            .validate_character_force_duration(0.25 / 3.)
            .is_err(),
        "First interval has the opposing-sign peak"
    );
    let body_before = e.unified_body_state(a).unwrap();
    let before = crate::engine::persistence::encode(&e).unwrap();
    e.update_frame(0.25, true, true, true);
    assert_eq!(
        e.take_unified_physics_error(),
        Some(PhysicsError::InvalidCharacter.into())
    );
    assert_eq!(e.unified_body_state(a).unwrap(), body_before);
    // Includes elapsed, camera, particles/tween age, input latch, force/impulse,
    // previous physics counters, native statistics and every frame output buffer.
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
}

#[test]
fn variable_clock_first_outer_admission_failure_does_not_begin_the_frame() {
    use crate::physics::FixedTimestepUpdate;
    let (mut e, _) = opposing_force_peak(90_000.);
    pending_frame_work(&mut e);
    let before = crate::engine::persistence::encode(&e).unwrap();
    // A stale prepared plan must still fail atomically at actual interval entry.
    let plan = super::variable_clock::VariableFramePlan {
        steps: 3,
        interval: 0.25 / 3.,
        update: FixedTimestepUpdate {
            steps: 3,
            consumed_seconds: 0.25,
            ..Default::default()
        },
    };
    assert_eq!(
        e.advance_variable_native_simulation(plan),
        Err(PhysicsError::InvalidCharacter.into())
    );
    assert_eq!(
        e.take_unified_physics_error(),
        Some(PhysicsError::InvalidCharacter.into())
    );
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
}

#[test]
fn variable_clock_valid_opposing_force_split_keeps_each_actual_interval_within_bounds() {
    let (mut e, a) = opposing_force_peak(80_000.);
    let checkpoint = e.runtime_checkpoint().unwrap();
    e.update(0.25);
    assert_eq!(e.unified_physics_error(), None);
    assert_eq!(e.physics_fixed_steps(), 3);
    let whole = e.unified_body_state(a).unwrap();
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    let interval = 0.25_f32 / 3.;
    for index in 1..=3 {
        e.update(f64::from(interval));
        assert_eq!(e.unified_physics_error(), None);
        let velocity = e.unified_character_state(a).unwrap().velocity[0];
        assert!(velocity.is_finite() && velocity.abs() <= 1_000_000.);
        let expected = 80_000. + 1_000_000. - 1_000_000. * interval * index as f32;
        assert!(
            (velocity - expected).abs() < 0.3,
            "{velocity} != {expected}"
        );
        assert_eq!(e.unified_physics_clock_step_seconds(), 0.1);
        assert!(e.runtime_checkpoint().is_ok());
    }
    assert_eq!(e.unified_body_state(a).unwrap(), whole);
}

#[test]
fn variable_clock_late_outer_failure_counts_only_completed_intervals() {
    use crate::physics::FixedTimestepUpdate;
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        step_seconds: 0.1,
        ..config()
    })
    .unwrap();
    assert!(e.configure_unified_physics_clock(false, 0.1, 0.25, 8));
    let a = character(&mut e);
    e.enable_unified_character(
        a,
        CharacterConfig {
            push_mass: 0.1,
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_character_force(body, [1_000_000., 0., 0.])
        .unwrap();
    pending_frame_work(&mut e);
    let elapsed = e.elapsed_seconds;
    // This deliberately stale plan bypasses the full-frame final-peak guard.
    let plan = super::variable_clock::VariableFramePlan {
        steps: 2,
        interval: 0.1,
        update: FixedTimestepUpdate {
            steps: 2,
            consumed_seconds: 0.2,
            ..Default::default()
        },
    };
    assert_eq!(e.advance_variable_native_simulation(plan), Ok(0.1));
    assert_eq!(
        e.take_unified_physics_error(),
        Some(PhysicsError::InvalidCharacter.into())
    );
    near((e.elapsed_seconds - elapsed) as f32, 0.1);
    assert_eq!(e.physics_fixed_steps(), 1);
    near(e.fixed_timestep_consumed_seconds(), 0.1);
    near(e.fixed_timestep_dropped_seconds(), 0.1);
    near(e.particles.particles()[0].age_seconds, 0.1);
    assert_eq!(e.unified_physics_frame_statistics().unwrap().fixed_steps, 1);
    assert_eq!(e.unified_physics_clock_step_seconds(), 0.1);
}

#[test]
fn variable_clock_zero_after_positive_clears_frame_statistics_but_keeps_queued_impulse() {
    let mut e = engine();
    let a = character(&mut e);
    e.set_unified_body_pose(
        a,
        Pose {
            position: [-10., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [2., 0., 0.])
        .unwrap();
    e.set_collision_lifecycle_events_enabled(true);
    let _ = dynamic(&mut e, [0.; 3]);
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            ..Default::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        [0.; 3],
    )
    .unwrap();
    e.update(0.02);
    assert_eq!(e.physics_fixed_steps(), 1);
    assert!(
        e.unified_physics_frame_statistics()
            .unwrap()
            .totals
            .backend_steps
            > 0
    );
    assert!(!e.frame_buffers.collision_events.is_empty());
    let before = e.unified_body_state(a).unwrap();
    let elapsed = e.elapsed_seconds;
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .apply_character_impulse(body, [2., 0., 0.])
        .unwrap();
    e.update_frame(0., true, true, true);
    assert_eq!(e.unified_body_state(a).unwrap(), before);
    assert_eq!(e.elapsed_seconds, elapsed);
    assert_eq!(e.physics_fixed_steps(), 0);
    assert_eq!(e.unified_physics_frame_statistics().unwrap().fixed_steps, 0);
    assert_eq!(
        e.unified_physics_frame_statistics()
            .unwrap()
            .totals
            .backend_steps,
        0
    );
    assert!(e.frame_buffers.collision_events.is_empty());
    assert_eq!(e.fixed_timestep_consumed_seconds(), 0.);
    // SAFETY: the public telemetry buffer is live and includes its fixed base
    // layout; no Engine mutation occurs while reading its clock-step field.
    assert_eq!(unsafe { *e.frame_telemetry_ptr().add(8) }, 0.);
    e.update(0.02);
    near(e.unified_character_state(a).unwrap().velocity[0], 2.);
}

#[test]
fn variable_clock_manual_only_frame_does_not_validate_unconsumed_force_peak() {
    let (mut e, a) = opposing_force_peak(90_000.);
    e.set_auto_rigid_body_step_enabled(false);
    let before = e.unified_body_state(a).unwrap();
    e.update(0.25);
    assert_eq!(e.unified_physics_error(), None);
    assert_eq!(e.unified_body_state(a).unwrap(), before);
    assert_eq!(e.physics_fixed_steps(), 3);
    assert_eq!(
        e.unified_physics_frame_statistics()
            .unwrap()
            .totals
            .backend_steps,
        0
    );
    e.step_rigid_bodies(0.25 / 3.);
    assert_eq!(
        e.take_unified_physics_error(),
        Some(PhysicsError::InvalidCharacter.into())
    );
    assert_eq!(e.unified_body_state(a).unwrap(), before);
}

#[test]
fn variable_clock_budget_queries_are_readonly_and_survive_identical_spec_and_checkpoint() {
    let raw = crate::engine::legacy_test_fixture::engine();
    assert_eq!(raw.unified_physics_clock_max_frame_seconds(), 0.);
    assert_eq!(raw.unified_physics_clock_max_steps_per_update(), 0);
    let mut e = engine();
    assert!(e.configure_unified_physics_clock(false, 0.01, 0.08, 3));
    let before = crate::engine::persistence::encode(&e).unwrap();
    assert_eq!(e.unified_physics_clock_max_frame_seconds(), 0.08);
    assert_eq!(e.unified_physics_clock_max_steps_per_update(), 3);
    assert_eq!(crate::engine::persistence::encode(&e).unwrap(), before);
    let checkpoint = e.runtime_checkpoint().unwrap();
    e.configure_physics_spec_planar(config()).unwrap();
    assert!(!e.fixed_timestep_enabled());
    assert_eq!(e.unified_physics_clock_max_frame_seconds(), 0.08);
    assert_eq!(e.unified_physics_clock_max_steps_per_update(), 3);
    assert!(e.configure_unified_physics_clock(true, 0.01, 0.2, 7));
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    assert!(!e.fixed_timestep_enabled());
    assert_eq!(e.unified_physics_clock_max_frame_seconds(), 0.08);
    assert_eq!(e.unified_physics_clock_max_steps_per_update(), 3);
}
