//! Built-in Shooter native integration regressions.
use super::*;
use crate::components::gameplay::{
    MovementPattern, Pickup, ProjectileTileImpact, GAMEPLAY_PICKUP_ITEM_SCORE,
};
use crate::components::{AabbCollider, CollisionLayer};
use crate::gameplay_event::{GAMEPLAY_EVENT_PICKUP_COLLECTED, GAMEPLAY_EVENT_TILE_IMPACT};
use crate::input::InputState;
use crate::shooter_scene::{EnemyBehavior, DEFAULT_TEXTURE_ID};

fn configured() -> Engine {
    let mut e = Engine::new();
    e.scenes.shooter_mut().set_enemy_behavior(
        &mut e.world,
        &mut e.camera,
        &mut e.frame_buffers.audio_events,
        EnemyBehavior::Static,
    );
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
        length_unit: 100.,
        ..Default::default()
    })
    .unwrap();
    e
}
fn configured_legacy_scene_policy() -> Engine {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.scenes.shooter_mut().set_enemy_behavior(
        &mut e.world,
        &mut e.camera,
        &mut e.frame_buffers.audio_events,
        EnemyBehavior::Static,
    );
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
        length_unit: 100.,
        ..Default::default()
    })
    .unwrap();
    e
}

fn playing_legacy_scene_policy() -> Engine {
    let mut e = configured_legacy_scene_policy();
    e.input = InputState {
        enter: 1,
        ..Default::default()
    };
    tick(&mut e);
    assert_eq!(e.game_state_code(), 1);
    e.input = InputState::default();
    e
}

fn tick(e: &mut Engine) {
    e.update(0.1);
    assert_eq!(e.unified_physics_error(), None);
}
fn playing() -> Engine {
    let mut e = configured();
    e.input = InputState {
        enter: 1,
        ..Default::default()
    };
    tick(&mut e);
    assert_eq!(e.game_state_code(), 1);
    e.input = InputState::default();
    e
}
fn same_pose(e: &Engine, a: Entity) {
    let p = e.world.transform(a).unwrap();
    assert_eq!(
        e.unified_body_state(a).unwrap().pose.position,
        [p.x, p.y, 0.]
    );
}
fn wall(e: &mut Engine) {
    e.tilemap
        .set_tile_definition(1, 7, 0., 0., 1., 1., 1., 1., 1., 1.);
    e.tilemap
        .set_layer(0, 1, 1, 32., 32., 48., 34., true, vec![1]);
}

#[test]
fn shooter_native_is_opt_in_and_rejects_other_builtin_and_spatial_scenes() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    assert!(e.unified_physics.is_none());
    assert!(!e.fixed_timestep_enabled());
    assert_eq!(
        e.configure_unified_physics(WorldConfig::default()),
        Err(UnifiedPhysicsError::WrongScene)
    );
    e.use_platformer_scene();
    assert_eq!(
        e.configure_unified_physics(WorldConfig {
            space: Space::Spatial,
            ..Default::default()
        }),
        Err(UnifiedPhysicsError::WrongScene)
    );
    assert!(e.unified_physics.is_none());
}

#[test]
fn shooter_native_title_and_start_tick_do_not_integrate_then_move_once() {
    let mut e = configured();
    let p = e.world.primary_actor_entity().unwrap();
    let start = e.world.transform(p).unwrap();
    e.input.d = 1;
    tick(&mut e);
    assert_eq!(e.world.transform(p), Some(start));
    e.input.enter = 1;
    tick(&mut e);
    assert_eq!(e.world.transform(p), Some(start));
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
    let v = e.world.velocity(p).unwrap();
    assert!(v.vx > 0.);
    assert!((e.world.transform(p).unwrap().x - start.x - v.vx * 0.1).abs() < 0.002);
    same_pose(&e, p);
    e.input.d = 0;
    let end = e.world.transform(p);
    tick(&mut e);
    assert_eq!(e.world.transform(p), end);
}

#[test]
fn shooter_native_cold_bullet_sweep_damages_enemy_and_scores_once() {
    let mut e = playing();
    let b = e
        .world
        .spawn_bullet(10., 50., 1000., 0., DEFAULT_TEXTURE_ID);
    let enemy = e.world.spawn_enemy(60., 50., DEFAULT_TEXTURE_ID);
    tick(&mut e);
    assert!(!e.world.is_current_entity(b));
    assert!(!e.world.is_current_entity(enemy));
    assert_eq!(e.score(), 1);
    assert_eq!(
        e.frame_buffers
            .collision_events
            .iter()
            .filter(|event| event.kind == crate::collision_event::COLLISION_EVENT_HIT)
            .count(),
        1
    );
    assert!(e.unified_body_state(b).is_err());
    assert!(e.unified_body_state(enemy).is_err());
    tick(&mut e);
    assert_eq!(e.score(), 1);
    assert!(e
        .frame_buffers
        .collision_events
        .iter()
        .all(|event| event.kind != crate::collision_event::COLLISION_EVENT_HIT));
}

#[test]
fn shooter_native_bullet_tile_policies_and_post_sync_are_preserved() {
    for policy in [
        ProjectileTileImpact::Bounce,
        ProjectileTileImpact::PassThrough,
        ProjectileTileImpact::Despawn,
    ] {
        let mut e = playing();
        wall(&mut e);
        let b = e.world.spawn_bullet(30., 50., 400., 0., DEFAULT_TEXTURE_ID);
        e.world.set_projectile_tile_impact(b, policy);
        tick(&mut e);
        match policy {
            ProjectileTileImpact::Bounce => {
                assert!(e.world.velocity(b).unwrap().vx < 0.);
                assert!(e.world.transform(b).unwrap().x < 48.);
                same_pose(&e, b);
                assert_eq!(
                    e.unified_body_state(b).unwrap().linear_velocity[0],
                    e.world.velocity(b).unwrap().vx
                );
            }
            ProjectileTileImpact::PassThrough => {
                assert!((e.world.transform(b).unwrap().x - 70.).abs() < 0.002);
                same_pose(&e, b);
            }
            ProjectileTileImpact::Despawn => assert!(!e.world.is_current_entity(b)),
        }
        assert_eq!(
            e.frame_buffers
                .gameplay_events
                .iter()
                .filter(|event| event.kind == GAMEPLAY_EVENT_TILE_IMPACT)
                .count(),
            usize::from(policy != ProjectileTileImpact::PassThrough)
        );
    }
}

#[test]
fn shooter_native_wall_blocks_actor_but_actor_overlap_still_deals_contact_damage() {
    let mut e = playing();
    wall(&mut e);
    let p = e.world.primary_actor_entity().unwrap();
    e.world.set_transform(p, Transform2D { x: 20., y: 50. });
    e.input.d = 1;
    for _ in 0..4 {
        tick(&mut e);
    }
    assert!(e.world.transform(p).unwrap().x < 48.);
    same_pose(&e, p);
    e.tilemap.clear();
    e.input.d = 0;
    let at = e.world.transform(p).unwrap();
    let enemy = e.world.spawn_enemy(at.x + 30., at.y, DEFAULT_TEXTURE_ID);
    e.world
        .set_movement_pattern(enemy, MovementPattern::Linear { vx: -300., vy: 0. });
    tick(&mut e);
    assert_eq!(e.game_state_code(), 2);
}

#[test]
fn shooter_native_pickup_is_collected_after_player_movement_once() {
    let mut e = playing();
    let p = e.world.primary_actor_entity().unwrap();
    let start = e.world.transform(p).unwrap();
    let pickup = e.world.spawn_entity();
    e.world.set_transform(
        pickup,
        Transform2D {
            x: start.x + 25.,
            y: start.y,
        },
    );
    e.world.set_aabb_collider(
        pickup,
        AabbCollider::new(2., 2., true, CollisionLayer::Pickup),
    );
    assert!(e
        .world
        .set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true)));
    e.input.d = 1;
    tick(&mut e);
    assert!(!e.world.is_current_entity(pickup));
    assert_eq!(e.score(), 3);
    assert_eq!(
        e.frame_buffers
            .gameplay_events
            .iter()
            .filter(|event| event.kind == GAMEPLAY_EVENT_PICKUP_COLLECTED)
            .count(),
        1
    );
    assert!(e.unified_body_state(pickup).is_err());
    tick(&mut e);
    assert_eq!(e.score(), 3);
}

#[test]
fn shooter_native_reset_and_authoring_keep_backend_scene_switch_drops_it() {
    let mut e = playing_legacy_scene_policy();
    let old = e.world.primary_actor_entity().unwrap();
    e.set_sound_ids(1, 2, 3);
    assert!(e.has_native_shooter());
    e.reset_game();
    assert!(e.has_native_shooter());
    let p = e.world.primary_actor_entity().unwrap();
    assert_ne!(p, old);
    tick(&mut e);
    assert!(e.unified_body_state(old).is_err());
    same_pose(&e, p);
    e.use_data_scene();
    assert!(e.unified_physics.is_none());
    assert!(e.world.unified_physics_entities.is_empty());
}

#[test]
fn shooter_native_manual_step_is_only_physics_and_never_double_integrates() {
    let mut e = playing();
    e.set_auto_rigid_body_step_enabled(false);
    e.input.d = 1;
    let p = e.world.primary_actor_entity().unwrap();
    let start = e.world.transform(p).unwrap();
    tick(&mut e);
    assert_eq!(e.world.transform(p), Some(start));
    let v = e.world.velocity(p).unwrap();
    e.step_rigid_bodies(0.1);
    let end = e.world.transform(p).unwrap();
    assert!((end.x - start.x - v.vx * 0.1).abs() < 0.002);
    tick(&mut e);
    assert_eq!(e.world.transform(p), Some(end));
}

#[test]
fn shooter_native_memory_checkpoint_replays_movement_and_rejects_legacy_save() {
    let mut e = playing();
    let p = e.world.primary_actor_entity().unwrap();
    e.input.d = 1;
    tick(&mut e);
    let checkpoint = e.runtime_checkpoint().unwrap();
    tick(&mut e);
    let future = e.world.transform(p);
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    tick(&mut e);
    assert_eq!(e.world.transform(p), future);
    same_pose(&e, p);
    assert!(!e.capture_shooter_snapshot());
    assert!(!e.restore_shooter_snapshot(vec![], vec![], vec![], vec![]));
    assert!(e.has_native_shooter());
    assert_eq!(e.world.transform(p), future);
}

#[test]
fn shooter_native_stationary_actor_recovers_when_wall_is_added_underneath() {
    let mut e = playing();
    let p = e.world.primary_actor_entity().unwrap();
    e.world.set_transform(p, Transform2D { x: 50., y: 50. });
    tick(&mut e);
    assert_eq!(
        e.world.transform(p).unwrap(),
        Transform2D { x: 50., y: 50. }
    );
    wall(&mut e);
    tick(&mut e);
    let recovered = e.world.transform(p).unwrap();
    assert!(
        recovered.x <= 30.002
            || recovered.x >= 97.998
            || recovered.y <= 16.002
            || recovered.y >= 83.998,
        "{recovered:?}"
    );
    assert_eq!(e.world.velocity(p), Some(Velocity::default()));
    same_pose(&e, p);
    tick(&mut e);
    assert_eq!(e.world.transform(p), Some(recovered));
}
