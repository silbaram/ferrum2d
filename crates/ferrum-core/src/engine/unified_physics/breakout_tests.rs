//! Breakout Engine/native ownership regressions.
use super::*;
use crate::breakout_scene::BreakoutHitKind;
use crate::collision_event::COLLISION_EVENT_HIT;
use crate::components::{AabbCollider, CollisionLayer, RigidBody};
use crate::input::InputState;

fn configured() -> Engine {
    let mut e = Engine::new();
    e.use_breakout_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        length_unit: 100.,
        ..Default::default()
    })
    .unwrap();
    e
}
fn configured_legacy_scene_policy() -> Engine {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_breakout_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        length_unit: 100.,
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
fn playing() -> Engine {
    let mut e = configured();
    e.input.enter = 1;
    tick(&mut e);
    e.input = InputState::default();
    e
}
fn ball(e: &Engine) -> Entity {
    e.scenes.breakout().ball_entity().unwrap()
}
fn paddle(e: &Engine) -> Entity {
    e.scenes.breakout().paddle_entity().unwrap()
}
fn consistent(e: &Engine, a: Entity) {
    let p = e.world.transform(a).unwrap();
    let s = e.unified_body_state(a).unwrap();
    assert_eq!(s.pose.position, [p.x, p.y, 0.]);
    let v = e.world.velocity(a).unwrap_or_default();
    assert_eq!(s.linear_velocity, [v.vx, v.vy, 0.]);
}
fn hit_count(e: &Engine) -> usize {
    e.frame_buffers
        .collision_events
        .iter()
        .filter(|h| h.kind == COLLISION_EVENT_HIT)
        .count()
}

#[test]
fn breakout_native_is_opt_in_planar_only_and_imports_roles_at_rest() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_breakout_scene();
    assert!(e.unified_physics.is_none());
    assert_eq!(
        e.configure_unified_physics(WorldConfig::default()),
        Err(UnifiedPhysicsError::WrongScene)
    );
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    assert_eq!(e.world.alive_count(), 55);
    for a in [paddle(&e), ball(&e)] {
        assert_eq!(
            e.unified_physics
                .as_ref()
                .unwrap()
                .physics
                .body_kind(e.unified_body_id(a).unwrap())
                .unwrap(),
            crate::physics3d::BodyKind::KinematicVelocity
        );
        assert!(e.world.collider(a).unwrap().is_trigger);
    }
    e.use_platformer_scene();
    assert!(e.unified_physics.is_none());
}

#[test]
fn breakout_native_title_start_rebuilds_without_step_then_moves_each_actor_once() {
    let mut e = configured();
    let old = ball(&e);
    e.input.d = 1;
    tick(&mut e);
    assert_eq!(e.world.transform(paddle(&e)).unwrap().x, 400.);
    e.input.enter = 1;
    tick(&mut e);
    assert_eq!(e.game_state_code(), 1);
    let b = ball(&e);
    assert_ne!(b, old);
    assert!(e.unified_body_state(old).is_err());
    let start = e.world.transform(b).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .frame
            .fixed_steps,
        0
    );
    e.input.enter = 0;
    tick(&mut e);
    let p = e.world.transform(paddle(&e)).unwrap();
    let end = e.world.transform(b).unwrap();
    assert!((p.x - 404.2).abs() < 0.002);
    assert!((end.x - start.x - 1.5675).abs() < 0.002);
    assert!((end.y - start.y + 2.85).abs() < 0.002);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .frame
            .fixed_steps,
        1
    );
    consistent(&e, b);
    consistent(&e, paddle(&e));
}

#[test]
fn breakout_native_paddle_clamp_retains_full_command_and_cannot_double_move() {
    let mut e = playing();
    let p = paddle(&e);
    e.world.set_transform(p, Transform2D { x: 738., y: 430. });
    e.input.d = 1;
    tick(&mut e);
    assert_eq!(e.world.transform(p).unwrap().x, 740.);
    assert_eq!(e.world.velocity(p).unwrap().vx, 420.);
    consistent(&e, p);
    tick(&mut e);
    assert_eq!(e.world.transform(p).unwrap().x, 740.);
}

#[test]
fn breakout_native_first_wall_contact_discards_remaining_time_then_moves_away() {
    let mut e = playing();
    let b = ball(&e);
    e.world.set_transform(b, Transform2D { x: 780., y: 250. });
    e.world.set_velocity(b, Velocity { vx: 2000., vy: 0. });
    tick(&mut e);
    assert!((e.world.transform(b).unwrap().x - 782.).abs() < 0.002);
    assert_eq!(e.world.velocity(b).unwrap().vx, -2000.);
    assert_eq!(hit_count(&e), 1);
    consistent(&e, b);
    tick(&mut e);
    assert!((e.world.transform(b).unwrap().x - 762.).abs() < 0.002);
    assert_eq!(hit_count(&e), 0);
}

#[test]
fn breakout_native_paddle_contact_offset_controls_reflection_without_normalization() {
    for offset in [-24., 0., 24.] {
        let mut e = playing();
        let b = ball(&e);
        e.world.set_transform(
            b,
            Transform2D {
                x: 400. + offset,
                y: 400.,
            },
        );
        e.world.set_velocity(b, Velocity { vx: 0., vy: 2000. });
        tick(&mut e);
        let v = e.world.velocity(b).unwrap();
        assert!((e.world.transform(b).unwrap().y - 416.).abs() < 0.002);
        assert!((v.vx - offset / 48. * 285.).abs() < 0.002);
        assert_eq!(v.vy, -285.);
        assert_eq!(hit_count(&e), 1);
        consistent(&e, b);
    }
}

#[test]
fn breakout_native_brick_damage_score_particles_and_despawn_are_post_step_once() {
    let mut e = playing();
    let b = ball(&e);
    let brick = e
        .scenes
        .breakout()
        .native_targets()
        .filter(|(_, k)| *k == BreakoutHitKind::Brick)
        .last()
        .unwrap()
        .0;
    let at = e.world.transform(brick).unwrap();
    e.world.set_transform(
        b,
        Transform2D {
            x: at.x,
            y: at.y + 30.,
        },
    );
    e.world.set_velocity(b, Velocity { vx: 0., vy: -3000. });
    tick(&mut e);
    assert!(!e.world.is_current_entity(brick));
    assert!(e.unified_body_state(brick).is_err());
    assert_eq!(e.score(), 10);
    assert_eq!(hit_count(&e), 1);
    assert!(e.world.velocity(b).unwrap().vy > 0.);
    assert!(e.particles.particle_count() > 0);
    consistent(&e, b);
    tick(&mut e);
    assert_eq!(e.score(), 10);
    assert_eq!(hit_count(&e), 0);
}

#[test]
fn breakout_native_exact_target_order_beats_native_arena_order_and_ignores_lookalikes() {
    let mut e = playing();
    let b = ball(&e);
    let p = paddle(&e);
    let targets: Vec<_> = e.scenes.breakout().native_targets().collect();
    let wall = targets
        .iter()
        .find(|(_, k)| *k == BreakoutHitKind::Wall)
        .unwrap()
        .0;
    let brick = targets
        .iter()
        .find(|(_, k)| *k == BreakoutHitKind::Brick)
        .unwrap()
        .0;
    for a in [p, wall, brick] {
        e.world.set_transform(a, Transform2D { x: 400., y: 300. });
        e.world.set_aabb_collider(
            a,
            AabbCollider::new(
                48.,
                8.,
                true,
                e.world.collider_layer_at(a.id as usize).unwrap(),
            ),
        );
    }
    let extra = e.world.spawn_entity();
    e.world
        .set_transform(extra, Transform2D { x: 400., y: 250. });
    e.world.set_aabb_collider(
        extra,
        AabbCollider::new(20., 2., false, CollisionLayer::Wall),
    );
    e.world.set_transform(b, Transform2D { x: 400., y: 220. });
    e.world.set_velocity(b, Velocity { vx: 0., vy: 10000. });
    tick(&mut e);
    let hit = e
        .frame_buffers
        .collision_events
        .iter()
        .find(|h| h.kind == COLLISION_EVENT_HIT)
        .unwrap();
    assert_eq!(hit.b_id, p.id);
    assert_eq!(e.score(), 0);
    assert!(e.world.is_current_entity(brick));
}

#[test]
fn breakout_native_manual_ticks_execute_motion_and_profile_response_without_sampling_input() {
    let mut e = playing();
    e.set_auto_rigid_body_step_enabled(false);
    let b = ball(&e);
    let p = paddle(&e);
    e.input.d = 1;
    e.world.set_transform(b, Transform2D { x: 780., y: 250. });
    e.world.set_velocity(b, Velocity { vx: 2000., vy: 0. });
    tick(&mut e);
    assert_eq!(e.world.transform(p).unwrap().x, 400.);
    assert_eq!(e.world.transform(b).unwrap().x, 780.);
    e.input.d = 0;
    e.step_rigid_bodies(0.01);
    assert!((e.world.transform(p).unwrap().x - 404.2).abs() < 0.002);
    assert!((e.world.transform(b).unwrap().x - 782.).abs() < 0.002);
    assert_eq!(e.world.velocity(b).unwrap().vx, -2000.);
    assert_eq!(hit_count(&e), 1);
    consistent(&e, b);
}

#[test]
fn breakout_native_disabled_or_removed_ball_fixture_keeps_native_integration() {
    for remove in [false, true] {
        let mut e = playing();
        let b = ball(&e);
        let start = e.world.transform(b).unwrap();
        if remove {
            e.world.clear_collider(b);
        } else {
            let mut c = e.world.collider(b).unwrap();
            c.enabled = false;
            e.world.set_aabb_collider(b, c);
        }
        tick(&mut e);
        let v = e.world.velocity(b).unwrap();
        assert!((e.world.transform(b).unwrap().x - start.x - v.vx * 0.01).abs() < 0.002);
        consistent(&e, b);
    }
}

#[test]
fn breakout_native_bad_tick_rejects_before_paddle_motion_and_preserves_commands() {
    let mut e = playing();
    e.set_auto_rigid_body_step_enabled(false);
    e.input.d = 1;
    tick(&mut e);
    let p = paddle(&e);
    let before = e.world.transform(p);
    let v = e.world.velocity(p);
    e.step_rigid_bodies(0.02);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    assert_eq!(e.world.transform(p), before);
    assert_eq!(e.world.velocity(p), v);
}

#[test]
fn breakout_native_lost_ball_restart_and_same_scene_reset_keep_backend_and_retire_generations() {
    let mut e = playing_legacy_scene_policy();
    let b = ball(&e);
    e.world.set_transform(b, Transform2D { x: 400., y: 493. });
    e.world.set_velocity(b, Velocity::default());
    tick(&mut e);
    assert_eq!(e.game_state_code(), 2);
    e.input.space = 1;
    tick(&mut e);
    assert_eq!(e.game_state_code(), 1);
    assert!(e.has_native_breakout());
    assert!(e.unified_body_state(b).is_err());
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .frame
            .fixed_steps,
        0
    );
    e.use_breakout_scene();
    assert!(e.has_native_breakout());
    tick(&mut e);
    e.use_data_scene();
    assert!(e.unified_physics.is_none());
    assert!(e.world.unified_physics_entities.is_empty());
}

#[test]
fn breakout_native_last_brick_uses_game_over_and_checkpoint_replays_exact_future() {
    let mut e = playing();
    let b = ball(&e);
    let bricks: Vec<_> = e
        .scenes
        .breakout()
        .native_targets()
        .filter(|(_, k)| *k == BreakoutHitKind::Brick)
        .map(|(e, _)| e)
        .collect();
    for a in &bricks[..bricks.len() - 1] {
        e.world.despawn(*a);
    }
    let last = *bricks.last().unwrap();
    let at = e.world.transform(last).unwrap();
    e.world.set_transform(
        b,
        Transform2D {
            x: at.x,
            y: at.y + 30.,
        },
    );
    e.world.set_velocity(b, Velocity { vx: 0., vy: -3000. });
    let cp = e.runtime_checkpoint().unwrap();
    tick(&mut e);
    let future = e.world.transform(b);
    let velocity = e.world.velocity(b);
    let events = e.frame_buffers.collision_events.clone();
    assert_eq!(e.game_state_code(), 2);
    assert_eq!(e.score(), 10);
    e.restore_runtime_checkpoint_native(&cp).unwrap();
    tick(&mut e);
    assert_eq!(e.world.transform(b), future);
    assert_eq!(e.world.velocity(b), velocity);
    assert_eq!(e.frame_buffers.collision_events, events);
    assert_eq!(e.game_state_code(), 2);
    assert_eq!(e.score(), 10);
}

#[test]
fn breakout_native_rejects_dynamic_controlled_body_before_admission() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_breakout_scene();
    let b = ball(&e);
    e.world.set_rigid_body(b, RigidBody::dynamic(1.));
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

#[test]
fn breakout_native_query_rejection_rolls_back_paddle_and_preserves_pending_impulse() {
    use crate::components::{ChainCollider, MAX_CHAIN_COLLIDER_VERTICES};
    let mut e = playing();
    let b = ball(&e);
    let p = paddle(&e);
    let start = e.world.transform(b).unwrap();
    let mut vertices = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    vertices[..3].copy_from_slice(&[
        Transform2D { x: -6., y: 0. },
        Transform2D { x: 0., y: 0. },
        Transform2D { x: 6., y: 0. },
    ]);
    e.world.set_chain_collider(
        b,
        ChainCollider::new(vertices, 3, false, true, CollisionLayer::Bullet),
    );
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 100., y: 300. });
    e.world
        .set_aabb_collider(a, AabbCollider::new(2., 2., false, CollisionLayer::Enemy));
    let mut body = RigidBody::dynamic(1.);
    body.impulse = Velocity { vx: 3., vy: 0. };
    e.world.set_rigid_body(a, body);
    e.input.d = 1;
    e.update(0.01);
    assert!(e.unified_physics_error().is_some());
    assert_eq!(e.world.transform(p).unwrap().x, 400.);
    assert_eq!(e.world.velocity(p).unwrap().vx, 420.);
    assert_eq!(e.world.transform(b), Some(start));
    consistent(&e, b);
    consistent(&e, p);
    assert_eq!(
        e.world.rigid_body(a).unwrap().impulse,
        Velocity { vx: 3., vy: 0. }
    );
    assert_eq!(e.unified_body_state(a).unwrap().linear_velocity, [0.; 3]);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .frame
            .fixed_steps,
        0
    );
}

#[test]
fn breakout_native_title_reselection_keeps_new_ball_kinematic_before_next_tick() {
    let mut e = configured();
    let old = ball(&e);
    e.use_breakout_scene();
    let b = ball(&e);
    assert_ne!(b, old);
    e.query_aabb_bodies(400., 400., 10., 10., u32::MAX);
    let runtime = e.unified_physics.as_ref().unwrap();
    let id = e.unified_body_id(b).unwrap();
    assert_eq!(
        runtime.physics.body_kind(id).unwrap(),
        crate::physics3d::BodyKind::KinematicVelocity
    );
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .frame
            .fixed_steps,
        0
    );
    e.reset_game();
    let reset_ball = ball(&e);
    e.world.clear_collider(reset_ball);
    e.query_aabb_bodies(400., 400., 10., 10., u32::MAX);
    let id = e.unified_body_id(reset_ball).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_kind(id)
            .unwrap(),
        crate::physics3d::BodyKind::KinematicVelocity
    );
}
