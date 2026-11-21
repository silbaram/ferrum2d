//! Native Platformer integration regressions.
use super::*;
use crate::components::gameplay::MovementPattern;
use crate::components::{
    AabbCollider, ChainCollider, CollisionLayer, RigidBody, MAX_CHAIN_COLLIDER_VERTICES,
};
use crate::input::InputState;
use crate::physics::{PlatformerControllerInput, PlatformerControllerState};

fn configured() -> Engine {
    let mut e = Engine::new();
    e.use_platformer_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        length_unit: 100.,
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    e
}
fn configured_legacy_scene_policy() -> Engine {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_platformer_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        length_unit: 100.,
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    e
}

fn playing_legacy_scene_policy() -> Engine {
    let mut e = configured_legacy_scene_policy();
    e.input.enter = 1;
    tick(&mut e);
    e.input = InputState::default();
    e
}

fn tick(e: &mut Engine) {
    e.update(0.01);
    assert_eq!(e.unified_physics_error(), None);
}
fn ticks(e: &mut Engine, n: usize) {
    for _ in 0..n {
        tick(e);
    }
}
fn playing() -> Engine {
    let mut e = configured();
    e.input.enter = 1;
    tick(&mut e);
    e.input = InputState::default();
    e
}
fn player(e: &Engine) -> Entity {
    e.scenes.platformer().player_entity().unwrap()
}
fn platform(e: &Engine) -> Entity {
    e.scenes.platformer().moving_platform_entity().unwrap()
}
fn state(e: &Engine) -> PlatformerControllerState {
    e.scenes
        .platformer()
        .plan_native_step(&e.world, 0., PlatformerControllerInput::new(0., false))
        .state
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.003, "{a} != {b}");
}
fn consistent(e: &Engine, a: Entity) {
    let p = e.world.transform(a).unwrap();
    let s = e.unified_body_state(a).unwrap();
    assert_eq!(s.pose.position, [p.x, p.y, 0.]);
    let v = e.world.velocity(a).unwrap_or_default();
    assert_eq!(s.linear_velocity, [v.vx, v.vy, 0.]);
}
fn on_floor(e: &mut Engine) {
    let p = player(e);
    e.world.set_transform(p, Transform2D { x: 96., y: 574. });
    e.world.set_velocity(p, Velocity::default());
    tick(e);
}

#[test]
fn platformer_native_opt_in_planar_roles_reset_before_query_and_scene_switch() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_platformer_scene();
    assert!(e.unified_physics.is_none());
    assert_eq!(
        e.configure_unified_physics(WorldConfig::default()),
        Err(UnifiedPhysicsError::WrongScene)
    );
    e = configured_legacy_scene_policy();
    assert_eq!(e.world.alive_count(), 8);
    for a in [player(&e), platform(&e)] {
        assert_eq!(
            e.unified_physics
                .as_ref()
                .unwrap()
                .physics
                .body_kind(e.unified_body_id(a).unwrap())
                .unwrap(),
            crate::physics3d::BodyKind::KinematicVelocity
        );
    }
    let old = player(&e);
    e.use_platformer_scene();
    let p = player(&e);
    assert_ne!(old, p);
    e.world.clear_collider(p);
    e.query_point_bodies(96., 500., u32::MAX);
    assert!(e.unified_body_state(old).is_err());
    assert!(e.unified_body_state(p).is_ok());
    e.reset_game();
    let p = player(&e);
    e.world.clear_collider(p);
    e.query_point_bodies(96., 500., u32::MAX);
    assert!(e.unified_body_state(p).is_ok());
    e.use_breakout_scene();
    assert!(e.unified_physics.is_none());
    assert!(e.world.unified_physics_entities.is_empty());
}

#[test]
fn platformer_native_start_held_jump_has_no_start_tick_motion_or_extra_jump() {
    let mut e = configured();
    e.input = InputState {
        space: 1,
        d: 1,
        ..Default::default()
    };
    let old = player(&e);
    tick(&mut e);
    let p = player(&e);
    assert_ne!(p, old);
    near(e.world.transform(p).unwrap().x, 96.);
    near(e.world.transform(p).unwrap().y, 500.);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .frame
            .fixed_steps,
        0
    );
    tick(&mut e);
    near(e.world.transform(p).unwrap().x, 98.1);
    near(e.world.transform(p).unwrap().y, 500.09);
    near(e.world.velocity(p).unwrap().vy, 9.);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .frame
            .fixed_steps,
        1
    );
    consistent(&e, p);
}

#[test]
fn platformer_native_falls_to_floor_and_landing_dust_occurs_once() {
    let mut e = playing();
    let p = player(&e);
    e.world.set_transform(p, Transform2D { x: 96., y: 564. });
    e.world.set_velocity(p, Velocity { vx: 0., vy: 220. });
    ticks(&mut e, 8);
    near(e.world.transform(p).unwrap().y, 574.);
    near(e.world.velocity(p).unwrap().vy, 0.);
    assert!(e.particles.particle_count() > 0);
    assert!(e.particles.particle_count() <= 12);
    let n = e.particles.particle_count();
    ticks(&mut e, 4);
    assert!(e.particles.particle_count() <= n);
    consistent(&e, p);
    assert!(state(&e).coyote_time_remaining > 0.);
    ticks(&mut e, 100);
    assert!(e.score() >= 1);
    near(e.world.transform(p).unwrap().y, 574.);
}

#[test]
fn platformer_native_jump_ceiling_and_held_space_do_not_stick_or_repeat() {
    let mut e = playing();
    on_floor(&mut e);
    let p = player(&e);
    e.input.space = 1;
    tick(&mut e);
    near(e.world.velocity(p).unwrap().vy, -420.);
    near(e.world.transform(p).unwrap().y, 569.8);
    ticks(&mut e, 5);
    near(e.world.velocity(p).unwrap().vy, -375.);
    let ceiling = e.world.spawn_entity();
    e.world
        .set_transform(ceiling, Transform2D { x: 96., y: 520. });
    e.world.set_aabb_collider(
        ceiling,
        AabbCollider::new(60., 4., false, CollisionLayer::Wall),
    );
    ticks(&mut e, 10);
    assert!(e.world.transform(p).unwrap().y >= 542. - 0.003);
    assert!(e.world.velocity(p).unwrap().vy >= 0.);
    ticks(&mut e, 80);
    near(e.world.transform(p).unwrap().y, 574.);
    near(e.world.velocity(p).unwrap().vy, 0.);
    consistent(&e, p);
}

#[test]
fn platformer_native_one_way_passes_upward_and_catches_only_from_above() {
    let mut e = playing();
    let p = player(&e);
    e.world.set_transform(p, Transform2D { x: 610., y: 360. });
    e.world.set_velocity(p, Velocity { vx: 0., vy: -600. });
    ticks(&mut e, 14);
    assert!(e.world.transform(p).unwrap().y < 295.);
    ticks(&mut e, 170);
    near(e.world.transform(p).unwrap().y, 295.);
    near(e.world.velocity(p).unwrap().vy, 0.);
    consistent(&e, p);
}

#[test]
fn platformer_native_coyote_window_allows_then_expires_after_support_removal() {
    for (wait, jumps) in [(3, true), (12, false)] {
        let mut e = playing();
        on_floor(&mut e);
        let p = player(&e);
        let floor = e
            .world
            .alive_indices()
            .iter()
            .filter_map(|&i| e.world.entity_at_index(i))
            .find(|&a| e.world.transform(a) == Some(Transform2D { x: 600., y: 616. }))
            .unwrap();
        e.world.despawn(floor);
        ticks(&mut e, wait);
        e.input.space = 1;
        tick(&mut e);
        assert_eq!(e.world.velocity(p).unwrap().vy < 0., jumps);
        if jumps {
            near(e.world.velocity(p).unwrap().vy, -420.);
        }
        consistent(&e, p);
    }
}

#[test]
fn platformer_native_buffered_jump_runs_on_landing_without_second_translation() {
    let mut e = playing();
    let p = player(&e);
    e.world.set_transform(p, Transform2D { x: 96., y: 560. });
    e.world.set_velocity(p, Velocity { vx: 0., vy: 100. });
    e.input.space = 1;
    tick(&mut e);
    e.input.space = 0;
    let mut triggered = None;
    for _ in 0..10 {
        let before = e.world.transform(p).unwrap();
        tick(&mut e);
        if e.world.velocity(p).unwrap().vy < 0. {
            triggered = Some((before, e.world.transform(p).unwrap()));
            break;
        }
    }
    let (before, after) = triggered.expect("buffered jump must trigger while landing");
    assert!(after.y >= before.y);
    near(e.world.velocity(p).unwrap().vy, -420.);
    tick(&mut e);
    assert!(e.world.transform(p).unwrap().y < after.y);
    consistent(&e, p);
}

#[test]
fn platformer_native_step_offset_accepts_low_step_and_rejects_tall_or_ceiling() {
    for (height, ceiling, passes) in [(8., false, true), (20., false, false), (8., true, false)] {
        let mut e = playing();
        on_floor(&mut e);
        let p = player(&e);
        let ledge = e.world.spawn_entity();
        e.world.set_transform(
            ledge,
            Transform2D {
                x: 150.,
                y: 592. - height * 0.5,
            },
        );
        e.world.set_aabb_collider(
            ledge,
            AabbCollider::new(25., height * 0.5, false, CollisionLayer::Wall),
        );
        if ceiling {
            let roof = e.world.spawn_entity();
            e.world
                .set_transform(roof, Transform2D { x: 150., y: 550. });
            e.world.set_aabb_collider(
                roof,
                AabbCollider::new(50., 2., false, CollisionLayer::Wall),
            );
        }
        e.input.d = 1;
        ticks(&mut e, 25);
        let pos = e.world.transform(p).unwrap();
        assert_eq!(
            pos.x > 125.,
            passes,
            "height={height} ceiling={ceiling} pos={pos:?}"
        );
        consistent(&e, p);
    }
}

#[test]
fn platformer_native_moving_platform_carries_rider_once_and_does_not_teleport_airborne() {
    let mut e = playing();
    let p = player(&e);
    let m = platform(&e);
    e.world.set_transform(p, Transform2D { x: 760., y: 471. });
    e.world.set_velocity(p, Velocity::default());
    for _ in 0..6 {
        let before = e.world.transform(p).unwrap();
        let old = e.world.transform(m).unwrap();
        tick(&mut e);
        let after = e.world.transform(p).unwrap();
        let next = e.world.transform(m).unwrap();
        near(after.x - before.x, next.x - old.x);
        near(after.y, 471.);
        consistent(&e, p);
        consistent(&e, m);
    }
    let start = e.world.transform(p).unwrap();
    e.world.set_transform(
        p,
        Transform2D {
            x: start.x,
            y: 400.,
        },
    );
    e.world.set_velocity(p, Velocity::default());
    tick(&mut e);
    near(e.world.transform(p).unwrap().x, start.x);
}

#[test]
fn platformer_native_carry_is_blocked_by_wall_but_platform_path_still_advances() {
    let mut e = playing();
    let p = player(&e);
    let m = platform(&e);
    e.world.set_transform(p, Transform2D { x: 760., y: 471. });
    e.world.set_velocity(p, Velocity::default());
    let wall = e.world.spawn_entity();
    e.world
        .set_transform(wall, Transform2D { x: 780., y: 460. });
    e.world.set_aabb_collider(
        wall,
        AabbCollider::new(6., 25., false, CollisionLayer::Wall),
    );
    tick(&mut e);
    near(e.world.transform(p).unwrap().x, 760.);
    assert!(e.world.transform(m).unwrap().x > 760.);
    consistent(&e, p);
}

#[test]
fn platformer_native_manual_capture_queues_jump_until_successful_fixed_step_and_checkpoint() {
    let mut e = playing();
    on_floor(&mut e);
    let p = player(&e);
    e.set_auto_rigid_body_step_enabled(false);
    e.input.space = 1;
    e.input.d = 1;
    tick(&mut e);
    e.input.space = 0;
    tick(&mut e);
    near(e.world.transform(p).unwrap().x, 96.);
    near(e.world.transform(p).unwrap().y, 574.);
    let cp = e.runtime_checkpoint().unwrap();
    e.step_rigid_bodies(0.01);
    let pos = e.world.transform(p);
    let velocity = e.world.velocity(p);
    near(velocity.unwrap().vy, -420.);
    near(pos.unwrap().x, 98.1);
    e.restore_runtime_checkpoint_native(&cp).unwrap();
    e.input.d = 0;
    e.step_rigid_bodies(0.01);
    assert_eq!(e.world.transform(p), pos);
    assert_eq!(e.world.velocity(p), velocity);
    consistent(&e, p);
    e.step_rigid_bodies(0.01);
    near(e.world.velocity(p).unwrap().vy, -411.);
}

#[test]
fn platformer_native_bad_clock_keeps_jump_command_and_does_not_advance_platform() {
    let mut e = playing();
    on_floor(&mut e);
    let p = player(&e);
    let m = platform(&e);
    e.set_auto_rigid_body_step_enabled(false);
    e.input.space = 1;
    tick(&mut e);
    let at = e.world.transform(m);
    e.step_rigid_bodies(0.02);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    assert_eq!(e.world.transform(m), at);
    near(e.world.transform(p).unwrap().y, 574.);
    e.step_rigid_bodies(0.01);
    near(e.world.velocity(p).unwrap().vy, -420.);
}

#[test]
fn platformer_native_missing_or_disabled_player_fixture_moves_with_native_gravity() {
    for clear in [false, true] {
        let mut e = playing();
        let p = player(&e);
        if clear {
            e.world.clear_collider(p);
        } else {
            let mut c = e.world.collider(p).unwrap();
            c.enabled = false;
            e.world.set_aabb_collider(p, c);
        }
        e.input.d = 1;
        tick(&mut e);
        near(e.world.transform(p).unwrap().x, 98.1);
        near(e.world.transform(p).unwrap().y, 500.09);
        consistent(&e, p);
    }
}

#[test]
fn platformer_native_query_failure_rolls_back_platform_phase_state_and_reserved_impulse() {
    let mut e = playing();
    let p = player(&e);
    let m = platform(&e);
    let phase_position = e.world.transform(m);
    let controller = state(&e);
    let mut vertices = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    vertices[..3].copy_from_slice(&[
        Transform2D { x: -14., y: 0. },
        Transform2D { x: 0., y: 0. },
        Transform2D { x: 14., y: 0. },
    ]);
    e.world.set_chain_collider(
        p,
        ChainCollider::new(vertices, 3, false, false, CollisionLayer::Player),
    );
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 900., y: 200. });
    e.world
        .set_aabb_collider(a, AabbCollider::new(2., 2., false, CollisionLayer::Wall));
    let mut body = RigidBody::dynamic(1.);
    body.impulse = Velocity { vx: 4., vy: 0. };
    e.world.set_rigid_body(a, body);
    e.update(0.01);
    assert!(e.unified_physics_error().is_some());
    assert_eq!(e.world.transform(m), phase_position);
    assert_eq!(state(&e), controller);
    assert_eq!(
        e.world.rigid_body(a).unwrap().impulse,
        Velocity { vx: 4., vy: 0. }
    );
    assert_eq!(e.score(), 0);
    consistent(&e, m);
}

#[test]
fn platformer_native_loss_restart_keeps_native_owner_and_drops_pending_input() {
    let mut e = playing_legacy_scene_policy();
    let p = player(&e);
    e.world.set_transform(p, Transform2D { x: 600., y: 720. });
    e.world.set_velocity(p, Velocity::default());
    tick(&mut e);
    assert_eq!(e.game_state_code(), 2);
    e.input.space = 1;
    tick(&mut e);
    assert_eq!(e.game_state_code(), 1);
    let new = player(&e);
    assert_ne!(new, p);
    assert!(e.unified_body_state(p).is_err());
    near(e.world.transform(new).unwrap().y, 500.);
    tick(&mut e);
    assert!(e.world.velocity(new).unwrap().vy > 0.);
    assert!(e.has_native_platformer());
    e.use_data_scene();
    assert!(e.unified_physics.is_none());
}

#[test]
fn platformer_native_checkpoint_replays_platform_rider_controller_and_particles_exactly() {
    let mut e = playing();
    let p = player(&e);
    let m = platform(&e);
    e.world.set_transform(p, Transform2D { x: 760., y: 471. });
    e.world.set_velocity(p, Velocity::default());
    tick(&mut e);
    let cp = e.runtime_checkpoint().unwrap();
    e.input.d = 1;
    ticks(&mut e, 12);
    let end = (
        e.world.transform(p),
        e.world.velocity(p),
        e.world.transform(m),
        state(&e),
        e.score(),
        e.particles.particle_count(),
    );
    e.restore_runtime_checkpoint_native(&cp).unwrap();
    e.input.d = 1;
    ticks(&mut e, 12);
    assert_eq!(
        (
            e.world.transform(p),
            e.world.velocity(p),
            e.world.transform(m),
            state(&e),
            e.score(),
            e.particles.particle_count()
        ),
        end
    );
    consistent(&e, p);
}

#[test]
fn platformer_native_authored_movement_tuning_and_path_are_applied_once() {
    let mut e = playing();
    let p = player(&e);
    let m = platform(&e);
    e.world.set_movement_pattern(
        p,
        MovementPattern::PlatformerInput {
            horizontal_speed: 100.,
            gravity: 100.,
            jump_speed: 200.,
            max_fall_speed: 50.,
            ground_probe_distance: 2.,
            step_offset: 12.,
            coyote_time_seconds: 0.1,
            jump_buffer_seconds: 0.1,
        },
    );
    e.world.set_movement_pattern(
        m,
        MovementPattern::Oscillate {
            origin_x: 760.,
            origin_y: 500.,
            amplitude_x: 0.,
            amplitude_y: 100.,
            phase_speed: 1.,
        },
    );
    e.input.d = 1;
    tick(&mut e);
    near(e.world.transform(p).unwrap().x, 97.);
    near(e.world.velocity(p).unwrap().vy, 1.);
    near(e.world.transform(m).unwrap().y, 500. + 0.01f32.sin() * 100.);
}

#[test]
fn platformer_native_dynamic_actor_is_rejected_without_world_admission() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_platformer_scene();
    let p = player(&e);
    e.world.set_rigid_body(p, RigidBody::dynamic(1.));
    assert!(e
        .configure_unified_physics(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.; 3],
            ..Default::default()
        })
        .is_err());
    assert!(e.unified_physics.is_none());
    assert!(e.world.unified_physics_entities.is_empty());
}
