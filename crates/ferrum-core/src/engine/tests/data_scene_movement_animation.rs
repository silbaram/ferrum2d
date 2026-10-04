use super::data_scene_visuals::sprite;
use super::*;
use crate::game_state::GameState;

fn clips(engine: &mut Engine, actor: Entity) {
    let descriptors: Vec<f32> = (0..8).flat_map(|id| [id as f32, 2.0, 4.0, 1.0]).collect();
    let frames: Vec<f32> = (0..8)
        .flat_map(|_| [0.0, 0.0, 0.5, 1.0, 0.5, 0.0, 1.0, 1.0])
        .collect();
    assert!(engine.configure_data_scene_sprite_clips(
        actor.id,
        actor.generation,
        &descriptors,
        &frames,
        0
    ));
}

fn poses() -> Vec<u32> {
    (0..8).flat_map(|id| [id, 0, 0]).collect()
}

fn setup() -> (Engine, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 1, 50.0, 50.0, 0);
    let mut collider = engine.world.collider(actor).unwrap();
    collider.is_trigger = false;
    engine.world.set_aabb_collider(actor, collider);
    engine.world.set_rigid_body(actor, RigidBody::kinematic());
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(engine.configure_data_scene_navigation(5, 5, 20.0, 20.0, 0.0, 0.0, &[1; 25]));
    clips(&mut engine, actor);
    assert!(engine.configure_data_scene_movement_animation(&poses(), 1));
    (engine, actor)
}

fn state(engine: &Engine, actor: Entity) -> Vec<f64> {
    engine.data_scene_sprite_animation_state(actor.id, actor.generation)
}

fn go(engine: &mut Engine, x: f32, y: f32, speed: f32) {
    assert!(engine.move_data_scene_actor_to(x, y, speed, 0.0, u32::MAX, true));
}

#[test]
fn movement_animation_selects_four_directions_and_advances_once_without_restarts() {
    for (direction, x, y) in [
        (0, 50.0, 10.0),
        (1, 50.0, 90.0),
        (2, 10.0, 50.0),
        (3, 90.0, 50.0),
    ] {
        let (mut engine, actor) = setup();
        assert_eq!(state(&engine, actor)[0], 1.0);
        go(&mut engine, x, y, 20.0);
        engine.update(0.25);
        assert_eq!(state(&engine, actor)[0], (direction + 4) as f64);
        assert_eq!(state(&engine, actor)[2], 0.0);
        engine.update(0.25);
        assert_eq!(state(&engine, actor)[1], 1.0);
        assert_eq!(state(&engine, actor)[2], 0.25);
        engine.update(10.0);
        assert_eq!(engine.data_scene_move_status(), 2);
        assert_eq!(state(&engine, actor)[0], direction as f64);
        assert_eq!(state(&engine, actor)[2], 0.0);
    }
}

#[test]
fn movement_animation_arrival_uses_last_segment_not_net_displacement() {
    let (mut engine, actor) = setup();
    engine
        .world
        .set_transform(actor, Transform2D { x: 10.0, y: 50.0 });
    go(&mut engine, 83.0, 53.0, 1000.0);
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 2);
    assert_eq!(
        state(&engine, actor)[0],
        2.0,
        "final approach from the cell center faces left"
    );
}

#[test]
fn movement_animation_shared_clip_flip_preserves_time_and_updates_uv() {
    let (mut engine, actor) = setup();
    let mut mapping = poses();
    mapping[18] = 7;
    mapping[19] = 1;
    assert!(engine.configure_data_scene_movement_animation(&mapping, 3));
    engine
        .world
        .set_velocity(actor, Velocity { vx: 10.0, vy: 0.0 });
    engine.update(0.125);
    engine.update(0.125);
    assert_eq!(state(&engine, actor)[2], 0.125);
    engine
        .world
        .set_velocity(actor, Velocity { vx: -10.0, vy: 0.0 });
    engine.update(0.125);
    let current = state(&engine, actor);
    assert_eq!((current[0], current[2], current[5]), (7.0, 0.25, 1.0));
    let visual = engine.world.sprite_at_index(actor.id as usize).unwrap();
    assert_eq!((visual.u0, visual.u1), (1.0, 0.5));
}

#[test]
fn movement_animation_obeys_pause_zero_substeps_cancel_complete_and_manual_handoff() {
    let (mut engine, actor) = setup();
    go(&mut engine, 90.0, 50.0, 20.0);
    engine.update(0.0);
    assert_eq!(state(&engine, actor)[0], 1.0);
    engine.configure_fixed_timestep(true, 0.125, 1.0, 8);
    go(&mut engine, 90.0, 50.0, 20.0);
    engine.update(0.01);
    assert_eq!(state(&engine, actor)[0], 1.0);
    engine.update(0.125);
    let before_pause = state(&engine, actor);
    assert!(engine.pause_data_scene());
    engine.update(0.5);
    assert_eq!(state(&engine, actor), before_pause);
    assert!(engine.resume_data_scene());
    assert!(engine.cancel_data_scene_move());
    assert_eq!(state(&engine, actor)[0], 3.0);
    go(&mut engine, 90.0, 50.0, 20.0);
    engine.set_input(false, false, false, true, false, false, false, 0.0, 0.0);
    engine
        .world
        .set_velocity(actor, Velocity { vx: 10.0, vy: 0.0 });
    engine.update(0.125);
    assert_eq!(engine.data_scene_move_status(), 4);
    assert_eq!(state(&engine, actor)[0], 7.0);
    assert!(!engine.cancel_data_scene_move());
    assert_eq!(state(&engine, actor)[0], 7.0);
    assert!(engine.complete_data_scene());
    assert_eq!(state(&engine, actor)[0], 3.0);
}

#[test]
fn movement_animation_blocked_frame_is_idle_and_later_manual_motion_walks() {
    let (mut engine, actor) = setup();
    engine
        .world
        .set_transform(actor, Transform2D { x: 10.0, y: 50.0 });
    spawn_test_body(&mut engine.world, 50.0, 50.0, CollisionLayer::Wall);
    go(&mut engine, 90.0, 50.0, 1000.0);
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 3);
    assert_eq!(state(&engine, actor)[0], 3.0);
    engine
        .world
        .set_velocity(actor, Velocity { vx: -10.0, vy: 0.0 });
    engine.update(0.125);
    assert_eq!(state(&engine, actor)[0], 6.0);
    engine.world.set_velocity(actor, Velocity::default());
    engine.update(0.125);
    assert_eq!(state(&engine, actor)[0], 2.0);
}

#[test]
fn movement_animation_manual_commands_detach_only_after_full_validation() {
    let (mut engine, actor) = setup();
    let other = sprite(&mut engine, 1, 10.0, 10.0, 0);
    clips(&mut engine, other);
    let mut invalid = poses();
    invalid[21] = 999;
    assert!(!engine.configure_data_scene_movement_animation(&invalid, 1));
    assert!(!engine.configure_data_scene_sprite_clips(
        actor.id,
        actor.generation,
        &[0.0, 0.0, 1.0, 1.0],
        &[],
        0
    ));
    assert!(!engine.update_data_scene_sprite_animations(&[
        actor.id,
        actor.generation,
        33,
        0,
        0,
        0,
        0,
        0,
        other.id,
        other.generation,
        1,
        999,
        0,
        0,
        0,
        0
    ]));
    assert!(engine.update_data_scene_sprite_animations(&[
        other.id,
        other.generation,
        33,
        1,
        0,
        0,
        0,
        0
    ]));
    assert!(engine.update_data_scene_sprite_animations(&[
        actor.id,
        actor.generation,
        0,
        0,
        0,
        0,
        0,
        0
    ]));
    go(&mut engine, 90.0, 50.0, 20.0);
    engine.update(0.125);
    assert_eq!(state(&engine, actor)[0], 7.0);
    assert!(engine.update_data_scene_sprite_animations(&[
        actor.id,
        actor.generation,
        33,
        0,
        0,
        0,
        0,
        0
    ]));
    engine.update(0.125);
    assert_eq!(state(&engine, actor)[0], 0.0);
    assert!(engine.configure_data_scene_movement_animation(&poses(), 1));
    clips(&mut engine, actor);
    engine.update(0.125);
    assert_eq!(state(&engine, actor)[0], 0.0);
}

#[test]
fn movement_animation_disable_rebind_and_reused_handles_do_not_leak_binding() {
    let (mut engine, actor) = setup();
    go(&mut engine, 90.0, 50.0, 20.0);
    engine.update(0.125);
    assert!(engine.configure_data_scene_movement_animation(&[], 1));
    let disabled = state(&engine, actor);
    assert!(engine.cancel_data_scene_move());
    assert_eq!(state(&engine, actor), disabled);
    assert!(engine.configure_data_scene_movement_animation(&poses(), 1));
    let other = sprite(&mut engine, 1, 10.0, 10.0, 0);
    clips(&mut engine, other);
    assert!(engine.configure_data_scene_gameplay(true, other.id, other.generation, 0));
    engine
        .world
        .set_velocity(other, Velocity { vx: 10.0, vy: 0.0 });
    engine.update(0.125);
    assert_eq!(state(&engine, other)[0], 0.0);
    assert!(engine.configure_data_scene_movement_animation(&poses(), 1));
    engine.world.despawn(other);
    let replacement = sprite(&mut engine, 1, 10.0, 10.0, 0);
    clips(&mut engine, replacement);
    assert_eq!(replacement.id, other.id);
    assert_ne!(replacement.generation, other.generation);
    engine.update(0.125);
    assert_eq!(state(&engine, replacement)[0], 0.0);
    engine.reset_game();
    assert!(!engine.configure_data_scene_movement_animation(&poses(), 1));
}

#[test]
fn movement_animation_configuration_preserves_paused_lifecycle_and_rejects_other_scenes() {
    let mut engine = Engine::new();
    assert!(!engine.configure_data_scene_movement_animation(&[], 1));
    let (mut engine, actor) = setup();
    assert!(engine.pause_data_scene());
    assert!(engine.configure_data_scene_movement_animation(&poses(), 0));
    let paused = state(&engine, actor);
    engine.update(1.0);
    assert_eq!(engine.data_scene_game_state(), GameState::Paused.code());
    assert_eq!(state(&engine, actor), paused);
}
