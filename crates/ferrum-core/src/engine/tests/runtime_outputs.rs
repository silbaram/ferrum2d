use super::super::telemetry::frame_stats::{
    FRAME_TELEMETRY_ACTION_FAILURE_REASON_OFFSET,
    FRAME_TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE,
    FRAME_TELEMETRY_ACTION_TRIGGER_ATTEMPTS, FRAME_TELEMETRY_ACTION_TRIGGER_COMMIT_SKIPS,
    FRAME_TELEMETRY_ACTION_TRIGGER_FAILURES, FRAME_TELEMETRY_ACTION_TRIGGER_FAILURE_EVENTS_PUSHED,
    FRAME_TELEMETRY_F64S, FRAME_TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED,
    FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_EVENTS_PUSHED,
    FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS, FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS,
    FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED,
    FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED,
    FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS,
};
use super::*;
use crate::{
    GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
    GAMEPLAY_EVENT_ACTION_FAILED, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED,
};

fn telemetry_time(engine: &Engine) -> f64 {
    unsafe { *engine.frame_telemetry_ptr() }
}

fn start_shooter_playing(engine: &mut Engine) {
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update_frame(0.0, false, false, false);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
}

#[test]
fn update_frame_can_skip_unread_output_buffers() {
    let mut engine = Engine::new();

    engine.update_frame(0.016, true, true, true);
    assert!(engine.render_command_len() > 0);
    let written_time = telemetry_time(&engine);
    assert_eq!(written_time, engine.time());

    engine.update_frame(0.5, false, false, false);

    assert!(engine.time() > written_time);
    assert_eq!(engine.render_command_len(), 0);
    assert_eq!(engine.physics_debug_line_len(), 0);
    assert_eq!(telemetry_time(&engine), written_time);

    engine.update_frame(0.0, true, true, false);

    assert!(engine.render_command_len() > 0);
    assert_eq!(telemetry_time(&engine), engine.time());
}

#[test]
fn gameplay_interaction_events_are_bulk_frame_outputs() {
    let mut engine = Engine::new();
    engine.scenes.shooter.reset_playing(
        &mut engine.world,
        &mut engine.camera,
        &mut engine.audio_events,
    );
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 112.0, y: 100.0 });

    assert!(engine.set_gameplay_interaction(source.id, source.generation, 7, 16.0, true));
    engine.update_frame(0.016, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 1);
    let event = unsafe { *engine.gameplay_event_ptr() };
    assert_eq!(event.kind, GAMEPLAY_EVENT_INTERACTION);
    assert_eq!(event.actor_id, player.id);
    assert_eq!(event.actor_generation, player.generation);
    assert_eq!(event.source_id, source.id);
    assert_eq!(event.source_generation, source.generation);
    assert_eq!(event.token_id, 7);
    assert_eq!(
        event.flags,
        GAMEPLAY_EVENT_FLAG_ONCE | GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME
    );
    assert_eq!(event.payload_bits, 0);

    engine.update_frame(0.016, false, false, false);
    assert_eq!(engine.gameplay_event_len(), 0);
}

#[test]
fn gameplay_pickup_collected_events_are_bulk_frame_outputs() {
    let mut engine = Engine::new();
    engine.scenes.shooter.reset_playing(
        &mut engine.world,
        &mut engine.camera,
        &mut engine.audio_events,
    );
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let pickup = engine.world.spawn_entity();
    engine
        .world
        .set_transform(pickup, Transform2D { x: 100.0, y: 100.0 });
    engine.world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );

    assert!(engine.set_gameplay_pickup(
        pickup.id,
        pickup.generation,
        GAMEPLAY_PICKUP_ITEM_SCORE,
        3,
        true,
    ));
    engine.update_frame(0.016, false, false, false);

    assert_eq!(engine.scenes.shooter.score(), 3);
    assert_eq!(engine.gameplay_event_len(), 1);
    let event = unsafe { *engine.gameplay_event_ptr() };
    assert_eq!(event.kind, GAMEPLAY_EVENT_PICKUP_COLLECTED);
    assert_eq!(event.actor_id, player.id);
    assert_eq!(event.actor_generation, player.generation);
    assert_eq!(event.source_id, pickup.id);
    assert_eq!(event.source_generation, pickup.generation);
    assert_eq!(event.token_id, GAMEPLAY_PICKUP_ITEM_SCORE);
    assert_eq!(event.flags, GAMEPLAY_EVENT_FLAG_TARGET_REMOVED);
    assert_eq!(event.payload_bits, 3);

    engine.update_frame(0.016, false, false, false);
    assert_eq!(engine.scenes.shooter.score(), 3);
    assert_eq!(engine.gameplay_event_len(), 0);
}

#[test]
fn non_once_gameplay_interaction_is_deduped_across_fixed_substeps() {
    let mut engine = Engine::new();
    engine.scenes.shooter.reset_playing(
        &mut engine.world,
        &mut engine.camera,
        &mut engine.audio_events,
    );
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 112.0, y: 100.0 });

    assert!(engine.set_gameplay_interaction(source.id, source.generation, 9, 16.0, false));
    engine.configure_fixed_timestep(true, 1.0 / 60.0, 1.0, 4);
    engine.update_frame(0.05, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 1);
    let event = unsafe { *engine.gameplay_event_ptr() };
    assert_eq!(event.kind, GAMEPLAY_EVENT_INTERACTION);
    assert_eq!(event.token_id, 9);
    assert_eq!(event.flags, 0);
}

#[test]
fn gameplay_action_projectile_setter_drives_player_primary_fire() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();

    assert_eq!(engine.built_in_shooter_player_entity_id(), player.id);
    assert_eq!(
        engine.built_in_shooter_player_entity_generation(),
        player.generation
    );

    assert!(engine.set_gameplay_action_projectile(
        player.id,
        player.generation,
        1,
        0.05,
        900.0,
        3.0,
        2.0,
    ));

    engine.set_input(false, false, false, false, false, false, true, 800.0, 240.0);
    engine.update_frame(0.016, false, false, false);

    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 1);
    let bullet_index = engine
        .world
        .alive
        .iter()
        .enumerate()
        .find(|(index, alive)| {
            **alive && engine.world.collider_layer_at(*index) == Some(CollisionLayer::Bullet)
        })
        .map(|(index, _)| index)
        .unwrap();
    let velocity = engine.world.velocities[bullet_index].unwrap();
    let speed = (velocity.vx * velocity.vx + velocity.vy * velocity.vy).sqrt();
    assert!((speed - 900.0).abs() < 0.01);
    assert_eq!(engine.world.damages[bullet_index], Some(3.0));
    assert!((engine.world.bullet_lifetimes[bullet_index].unwrap() - (2.0 - 0.016)).abs() < 0.001);

    engine.update_frame(0.016, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 1);

    engine.update_frame(0.05, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 2);
}

#[test]
fn homing_projectile_seek_target_nearest_enemy_runs_through_shooter_frame_loop() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 400.0, y: 240.0 });
    let bullet = engine
        .world
        .spawn_bullet(50.0, 50.0, 0.0, -40.0, DEFAULT_TEXTURE_ID);
    let enemy = engine.world.spawn_enemy(80.0, 50.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_movement_static(enemy.id, enemy.generation));
    assert!(engine.set_gameplay_movement_seek_target_nearest_enemy(
        bullet.id,
        bullet.generation,
        120.0,
        1.0,
    ));

    engine.update_frame(0.25, false, false, false);

    assert!(!engine.world.alive[bullet.id as usize]);
    assert!(!engine.world.alive[enemy.id as usize]);
    assert_eq!(engine.score(), 1);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 0);
    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 0);
}

#[test]
fn homing_projectile_seek_target_nearest_tag_runs_through_shooter_frame_loop() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 400.0, y: 240.0 });
    let bullet = engine
        .world
        .spawn_bullet(50.0, 50.0, 0.0, -40.0, DEFAULT_TEXTURE_ID);
    let near_untagged = engine.world.spawn_enemy(60.0, 90.0, DEFAULT_TEXTURE_ID);
    let tagged_enemy = engine.world.spawn_enemy(80.0, 50.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_movement_static(near_untagged.id, near_untagged.generation));
    assert!(engine.set_gameplay_movement_static(tagged_enemy.id, tagged_enemy.generation));
    engine
        .world
        .set_gameplay_tags(tagged_enemy, GameplayTags::new(1 << 5).unwrap());
    assert!(engine.set_gameplay_movement_seek_target_nearest_tag(
        bullet.id,
        bullet.generation,
        5,
        120.0,
        1.0,
    ));

    engine.update_frame(0.25, false, false, false);

    assert!(!engine.world.alive[bullet.id as usize]);
    assert!(engine.world.alive[near_untagged.id as usize]);
    assert!(!engine.world.alive[tagged_enemy.id as usize]);
    assert_eq!(engine.score(), 1);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 0);
    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
}

#[test]
fn collision_emit_effect_payload_reaches_effect_event_buffer() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);

    assert!(engine.add_gameplay_collision_emit_effect_with_payload(
        bullet.id,
        bullet.generation,
        77,
        GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
        1,
        0.0,
        0,
        0.65,
        48.0,
    ));

    engine.update_frame(0.016, false, false, false);

    let events =
        unsafe { std::slice::from_raw_parts(engine.effect_event_ptr(), engine.effect_event_len()) };
    let event = events
        .iter()
        .find(|event| event.effect_id == 77)
        .expect("authored emit effect should produce an effect event");
    assert_eq!(event.actor_id, enemy.id);
    assert_eq!(event.actor_generation, enemy.generation);
    assert_eq!(event.effect_id, 77);
    assert_eq!(event.effect_type, GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM);
    assert_eq!(event.intensity, 0.65);
    assert_eq!(event.radius, 48.0);
}

#[test]
fn input_action_binding_remaps_player_primary_fire_without_widening_input_state() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();

    assert!(engine.set_gameplay_action_projectile(
        player.id,
        player.generation,
        1,
        0.05,
        900.0,
        3.0,
        2.0,
    ));
    assert!(engine.clear_input_action_bindings(1));
    assert!(engine.set_input_action_binding(
        1,
        0,
        crate::input::INPUT_ACTION_CONTROL_ENTER,
        crate::input::INPUT_ACTION_ACTIVATION_DOWN,
    ));

    engine.set_input(false, false, false, false, true, false, false, 800.0, 240.0);
    engine.update_frame(0.016, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 0);

    engine.set_input(false, false, false, false, false, true, false, 800.0, 240.0);
    engine.update_frame(0.016, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 1);
}

#[test]
fn input_action_binding_drives_player_melee_action() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    let player_t = engine.world.transform(player).unwrap();
    let enemy = engine
        .world
        .spawn_enemy(player_t.x + 72.0, player_t.y, DEFAULT_TEXTURE_ID);
    engine.world.healths[enemy.id as usize] = Some(2.0);

    assert!(engine.set_gameplay_action_melee(player.id, player.generation, 3, 0.5, 96.0, 2.0,));
    assert!(engine.set_input_action_binding(
        3,
        3,
        crate::input::INPUT_ACTION_CONTROL_ENTER,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED,
    ));

    engine.set_input(false, false, false, false, false, true, false, 800.0, 240.0);
    engine.update_frame(0.016, false, false, false);

    assert!(!engine.world.alive[enemy.id as usize]);
    assert_eq!(engine.score(), 1);
}

#[test]
fn gameplay_interaction_events_drive_rust_behavior_state_machine_once_per_frame() {
    let mut engine = Engine::new();
    engine.scenes.shooter.reset_playing(
        &mut engine.world,
        &mut engine.camera,
        &mut engine.audio_events,
    );
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 112.0, y: 100.0 });

    assert!(engine.set_gameplay_interaction(source.id, source.generation, 7, 16.0, false));
    assert!(engine.set_gameplay_behavior_state_machine(source.id, source.generation, 1));
    assert!(engine.add_gameplay_behavior_transition(source.id, source.generation, 1, 2, 7));
    assert!(engine.add_gameplay_behavior_transition(source.id, source.generation, 2, 3, 7));

    engine.update_frame(0.016, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_INTERACTION);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].actor_id, source.id);
    assert_eq!(events[1].source_id, source.id);
    assert_eq!(events[1].payload_bits, 1);
    assert_eq!(events[1].token_id, 2);
    assert_eq!(
        engine.gameplay_behavior_state(source.id, source.generation),
        2
    );

    engine.update_frame(0.016, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_INTERACTION);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].payload_bits, 2);
    assert_eq!(events[1].token_id, 3);
    assert_eq!(
        engine.gameplay_behavior_state(source.id, source.generation),
        3
    );
}

#[test]
fn fixed_timestep_processes_behavior_state_machine_events_once_per_render_frame() {
    let mut engine = Engine::new();
    engine.scenes.shooter.reset_playing(
        &mut engine.world,
        &mut engine.camera,
        &mut engine.audio_events,
    );
    start_shooter_playing(&mut engine);
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 112.0, y: 100.0 });

    assert!(engine.set_gameplay_interaction(source.id, source.generation, 7, 16.0, false));
    assert!(engine.set_gameplay_behavior_state_machine(source.id, source.generation, 1));
    assert!(engine.add_gameplay_behavior_transition(source.id, source.generation, 1, 2, 7));
    assert!(engine.add_gameplay_behavior_transition(source.id, source.generation, 2, 3, 7));
    engine.configure_fixed_timestep(true, 1.0 / 60.0, 1.0, 4);

    engine.update_frame(0.05, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_INTERACTION);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].payload_bits, 1);
    assert_eq!(events[1].token_id, 2);
    assert_eq!(engine.physics_fixed_steps(), 3);
    assert_eq!(
        engine.gameplay_behavior_state(source.id, source.generation),
        2
    );
}

#[test]
fn gameplay_timer_events_drive_rust_behavior_state_machine_same_frame() {
    let mut engine = Engine::new();
    let source = engine.world.spawn_entity();

    assert!(engine.set_gameplay_timer_trigger(source.id, source.generation, 9, 0.03));
    assert!(engine.set_gameplay_behavior_state_machine(source.id, source.generation, 1));
    assert!(engine.add_gameplay_behavior_event_transition(
        source.id,
        source.generation,
        1,
        2,
        GAMEPLAY_EVENT_TIMER,
        9,
    ));

    engine.update_frame(0.016, false, false, false);
    assert_eq!(engine.gameplay_event_len(), 0);
    assert_eq!(
        engine.gameplay_behavior_state(source.id, source.generation),
        1
    );

    engine.update_frame(0.016, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_TIMER);
    assert_eq!(events[0].actor_id, source.id);
    assert_eq!(events[0].source_id, source.id);
    assert_eq!(events[0].token_id, 9);
    assert_eq!(events[0].payload_bits, 0.03f32.to_bits());
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].payload_bits, 1);
    assert_eq!(events[1].token_id, 2);
    assert_eq!(
        engine.gameplay_behavior_state(source.id, source.generation),
        2
    );

    engine.update_frame(1.0, false, false, false);
    assert_eq!(engine.gameplay_event_len(), 0);
}

#[test]
fn gameplay_timer_action_trigger_queues_spawn_prefab_without_input_callback() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 500.0, y: 240.0 });

    assert!(engine.set_gameplay_action_spawn_prefab(
        source.id,
        source.generation,
        11,
        0.5,
        1,
        0,
        0,
        32.0,
        0.0,
    ));
    assert!(engine.set_gameplay_timer_action_trigger(source.id, source.generation, 5, 0.01, 11,));

    engine.update_frame(0.016, false, false, false);

    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
    let binding = engine.world.action_binding(source, 11).unwrap();
    assert!((binding.cooldown.remaining_seconds - 0.5).abs() < 0.001);
    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_TIMER);
    assert_eq!(events[0].token_id, 5);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(events[1].source_id, source.id);
    assert_eq!(events[1].token_id, 1);
    assert_eq!(events[1].payload_bits, 11);

    engine.update_frame(0.016, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
}

#[test]
fn frame_telemetry_reports_action_trigger_failure_diagnostics() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let source = engine.world.spawn_entity();

    assert!(engine.set_gameplay_action_dash(source.id, source.generation, 21, 0.5, 80.0));
    assert!(engine.set_gameplay_timer_action_trigger(source.id, source.generation, 5, 0.01, 21,));

    engine.update_frame(0.016, false, true, false);

    let telemetry =
        unsafe { std::slice::from_raw_parts(engine.frame_telemetry_ptr(), FRAME_TELEMETRY_F64S) };
    assert_eq!(telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_ATTEMPTS], 1.0);
    assert_eq!(telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_FAILURES], 1.0);
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_FAILURE_EVENTS_PUSHED],
        1.0
    );
    assert_eq!(telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_COMMIT_SKIPS], 0.0);
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE],
        GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM as f64
    );
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_FAILURE_REASON_OFFSET
            + GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM as usize],
        1.0
    );
    assert_eq!(
        engine
            .world
            .action_binding(source, 21)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn frame_telemetry_counts_action_trigger_preparation_failures_as_attempts() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 100.0, y: 100.0 });

    assert!(engine.set_gameplay_timer_action_trigger(source.id, source.generation, 5, 0.01, 99,));

    engine.update_frame(0.016, false, true, false);

    let telemetry =
        unsafe { std::slice::from_raw_parts(engine.frame_telemetry_ptr(), FRAME_TELEMETRY_F64S) };
    assert_eq!(telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_ATTEMPTS], 1.0);
    assert_eq!(telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_FAILURES], 1.0);
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_FAILURE_EVENTS_PUSHED],
        1.0
    );
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE],
        0.0
    );
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_FAILURE_REASON_OFFSET
            + GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING as usize],
        1.0
    );
}

#[test]
fn frame_telemetry_reports_spawn_flush_diagnostics() {
    let mut engine = Engine::new();
    engine.set_sound_ids(10, 20, 30);
    start_shooter_playing(&mut engine);

    engine.set_input(false, false, false, false, false, false, true, 800.0, 240.0);
    engine.update_frame(0.016, false, true, false);

    let telemetry =
        unsafe { std::slice::from_raw_parts(engine.frame_telemetry_ptr(), FRAME_TELEMETRY_F64S) };
    assert_eq!(telemetry[FRAME_TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED], 1.0);
    assert_eq!(
        telemetry[FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS],
        1.0
    );
    assert_eq!(
        telemetry[FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED],
        0.0
    );
    assert_eq!(
        telemetry[FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED],
        1.0
    );
    assert_eq!(telemetry[FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS], 0.0);
    assert_eq!(
        telemetry[FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS],
        0.0
    );
    assert_eq!(
        telemetry[FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_EVENTS_PUSHED],
        0.0
    );
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 1);
    assert_eq!(engine.audio_event_len(), 1);
}

#[test]
fn fixed_timestep_frame_telemetry_accumulates_action_trigger_diagnostics_across_substeps() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    engine.configure_fixed_timestep(true, 0.01, 1.0, 4);
    let source = engine.world.spawn_entity();

    assert!(engine.set_gameplay_action_dash(source.id, source.generation, 21, 0.5, 80.0));
    assert!(engine.set_gameplay_timer_action_trigger(source.id, source.generation, 5, 0.005, 21,));

    engine.update_frame(0.02, false, true, false);

    assert_eq!(engine.physics_fixed_steps(), 2);
    let telemetry =
        unsafe { std::slice::from_raw_parts(engine.frame_telemetry_ptr(), FRAME_TELEMETRY_F64S) };
    assert_eq!(telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_ATTEMPTS], 1.0);
    assert_eq!(telemetry[FRAME_TELEMETRY_ACTION_TRIGGER_FAILURES], 1.0);
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE],
        GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM as f64
    );
    assert_eq!(
        telemetry[FRAME_TELEMETRY_ACTION_FAILURE_REASON_OFFSET
            + GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM as usize],
        1.0
    );
}

#[test]
fn shooter_wave_action_trigger_queues_spawn_prefab_without_input_callback() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    engine.set_shooter_wave(
        0,
        0.01,
        999.0,
        99,
        72.0,
        EnemyBehavior::Chase as u32,
        EnemySpawnPattern::Center as u32,
        1.0,
        1,
    );
    engine.set_shooter_wave(
        1,
        10.0,
        999.0,
        99,
        72.0,
        EnemyBehavior::Chase as u32,
        EnemySpawnPattern::Center as u32,
        1.0,
        1,
    );
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 500.0, y: 240.0 });

    assert!(engine.set_gameplay_action_spawn_prefab(
        source.id,
        source.generation,
        11,
        0.5,
        1,
        0,
        0,
        32.0,
        0.0,
    ));
    assert!(engine.set_shooter_wave_action_trigger(1, source.id, source.generation, 11));

    engine.update_frame(0.016, false, false, false);

    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
    assert_eq!(engine.gameplay_event_len(), 1);
    let event = unsafe { *engine.gameplay_event_ptr() };
    assert_eq!(event.kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(event.source_id, source.id);
    assert_eq!(event.source_generation, source.generation);
    assert_eq!(event.token_id, 1);
    assert_eq!(event.payload_bits, 11);
    let binding = engine.world.action_binding(source, 11).unwrap();
    assert!((binding.cooldown.remaining_seconds - 0.5).abs() < 0.001);
}

#[test]
fn behavior_state_enter_action_trigger_runs_next_frame_pre_physics() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let source = engine.world.spawn_entity();
    engine
        .world
        .set_transform(source, Transform2D { x: 500.0, y: 240.0 });

    assert!(engine.set_gameplay_action_spawn_prefab(
        source.id,
        source.generation,
        11,
        0.5,
        1,
        0,
        0,
        32.0,
        0.0,
    ));
    assert!(engine.set_gameplay_timer_trigger(source.id, source.generation, 5, 0.01));
    assert!(engine.set_gameplay_behavior_state_machine(source.id, source.generation, 1));
    assert!(engine.add_gameplay_behavior_event_transition(
        source.id,
        source.generation,
        1,
        2,
        GAMEPLAY_EVENT_TIMER,
        5,
    ));
    assert!(engine.add_gameplay_behavior_state_enter_action(
        source.id,
        source.generation,
        2,
        11,
        0,
    ));

    engine.update_frame(0.016, false, false, false);

    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 0);
    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_TIMER);
    assert_eq!(events[0].token_id, 5);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].token_id, 2);

    engine.update_frame(0.016, false, false, false);

    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
    assert_eq!(engine.gameplay_event_len(), 1);
    let event = unsafe { *engine.gameplay_event_ptr() };
    assert_eq!(event.kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(event.source_id, source.id);
    assert_eq!(event.source_generation, source.generation);
    assert_eq!(event.token_id, 1);
    assert_eq!(event.payload_bits, 11);
    let binding = engine.world.action_binding(source, 11).unwrap();
    assert!((binding.cooldown.remaining_seconds - 0.5).abs() < 0.001);
}

#[test]
fn behavior_state_enter_action_trigger_reports_queue_full_from_engine_producer() {
    const SOURCE_COUNT: usize = 9;
    const ACTIONS_PER_SOURCE: usize = 8;

    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let mut sources = Vec::with_capacity(SOURCE_COUNT);
    for source_index in 0..SOURCE_COUNT {
        let source = engine.world.spawn_entity();
        sources.push(source);
        assert!(engine.set_gameplay_timer_trigger(source.id, source.generation, 5, 0.01));
        assert!(engine.set_gameplay_behavior_state_machine(source.id, source.generation, 1));
        assert!(engine.add_gameplay_behavior_event_transition(
            source.id,
            source.generation,
            1,
            2,
            GAMEPLAY_EVENT_TIMER,
            5,
        ));
        for action_index in 0..ACTIONS_PER_SOURCE {
            assert!(engine.add_gameplay_behavior_state_enter_action(
                source.id,
                source.generation,
                2,
                100 + (source_index * ACTIONS_PER_SOURCE + action_index) as u32,
                0,
            ));
        }
    }

    engine.update_frame(0.016, false, false, false);

    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    let failures: Vec<_> = events
        .iter()
        .filter(|event| event.kind == GAMEPLAY_EVENT_ACTION_FAILED)
        .collect();
    assert_eq!(failures.len(), 8);
    assert!(failures
        .iter()
        .all(|event| event.source_id == sources[8].id));
    assert!(failures
        .iter()
        .all(|event| event.source_generation == sources[8].generation));
    assert!(failures.iter().all(|event| event.actor_id == sources[8].id));
    assert!(failures
        .iter()
        .all(|event| event.actor_generation == sources[8].generation));
    assert!(failures
        .iter()
        .all(|event| event.payload_bits == GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL));
    assert_eq!(failures[0].token_id, 164);
    assert_eq!(failures[7].token_id, 171);
}

#[test]
fn behavior_state_enter_dash_action_runs_next_frame_pre_physics() {
    let mut engine = Engine::new();
    start_shooter_playing(&mut engine);
    let source = engine.world.spawn_entity();
    let player = engine.world.player.unwrap();
    engine
        .world
        .set_transform(player, Transform2D { x: 400.0, y: 240.0 });
    engine
        .world
        .set_transform(source, Transform2D { x: 720.0, y: 240.0 });

    assert!(engine.set_gameplay_action_dash_with_aim(
        source.id,
        source.generation,
        21,
        0.5,
        80.0,
        1,
    ));
    assert!(engine.set_gameplay_timer_trigger(source.id, source.generation, 5, 0.01));
    assert!(engine.set_gameplay_behavior_state_machine(source.id, source.generation, 1));
    assert!(engine.add_gameplay_behavior_event_transition(
        source.id,
        source.generation,
        1,
        2,
        GAMEPLAY_EVENT_TIMER,
        5,
    ));
    assert!(engine.add_gameplay_behavior_state_enter_action(
        source.id,
        source.generation,
        2,
        21,
        0,
    ));

    engine.update_frame(0.016, false, false, false);

    let before_dash = engine.world.transform(source).unwrap();
    assert!((before_dash.x - 720.0).abs() < 0.001);
    assert!((before_dash.y - 240.0).abs() < 0.001);
    assert_eq!(
        engine.gameplay_behavior_state(source.id, source.generation),
        2
    );
    assert_eq!(engine.gameplay_event_len(), 2);

    engine.update_frame(0.016, false, false, false);

    let after_dash = engine.world.transform(source).unwrap();
    assert!((after_dash.x - 640.0).abs() < 0.001);
    assert!((after_dash.y - 240.0).abs() < 0.001);
    assert_eq!(engine.gameplay_event_len(), 0);
    let binding = engine.world.action_binding(source, 21).unwrap();
    assert!((binding.cooldown.remaining_seconds - 0.5).abs() < 0.001);
}

#[test]
fn fixed_timestep_timer_events_drive_one_behavior_transition_per_render_frame() {
    let mut engine = Engine::new();
    let source = engine.world.spawn_entity();

    assert!(engine.set_gameplay_timer_trigger(source.id, source.generation, 9, 1.0 / 60.0));
    assert!(engine.set_gameplay_behavior_state_machine(source.id, source.generation, 1));
    assert!(engine.add_gameplay_behavior_event_transition(
        source.id,
        source.generation,
        1,
        2,
        GAMEPLAY_EVENT_TIMER,
        9,
    ));
    assert!(engine.add_gameplay_behavior_event_transition(
        source.id,
        source.generation,
        2,
        3,
        GAMEPLAY_EVENT_TIMER,
        9,
    ));
    engine.configure_fixed_timestep(true, 1.0 / 60.0, 1.0, 4);

    engine.update_frame(0.05, false, false, false);

    assert_eq!(engine.physics_fixed_steps(), 3);
    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_TIMER);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].payload_bits, 1);
    assert_eq!(events[1].token_id, 2);
    assert_eq!(
        engine.gameplay_behavior_state(source.id, source.generation),
        2
    );
}

#[test]
fn authored_collision_damage_events_drive_rust_behavior_state_machine_once_per_frame() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update_frame(0.016, false, false, false);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.healths[enemy.id as usize] = Some(3.0);
    engine.world.damages[bullet.id as usize] = Some(1.0);
    assert!(engine.add_gameplay_collision_damage(bullet.id, bullet.generation, 1));
    assert!(engine.set_gameplay_behavior_state_machine(bullet.id, bullet.generation, 1));
    assert!(engine.add_gameplay_behavior_event_transition(
        bullet.id,
        bullet.generation,
        1,
        2,
        GAMEPLAY_EVENT_COLLISION_DAMAGE,
        0,
    ));
    assert!(engine.add_gameplay_behavior_event_transition(
        bullet.id,
        bullet.generation,
        2,
        3,
        GAMEPLAY_EVENT_COLLISION_DAMAGE,
        0,
    ));

    engine.update_frame(0.016, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
    assert_eq!(events[0].actor_id, enemy.id);
    assert_eq!(events[0].source_id, bullet.id);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].actor_id, bullet.id);
    assert_eq!(events[1].source_id, bullet.id);
    assert_eq!(events[1].payload_bits, 1);
    assert_eq!(events[1].token_id, 2);
    assert_eq!(
        engine.gameplay_behavior_state(bullet.id, bullet.generation),
        2
    );

    engine.update_frame(0.016, false, false, false);

    assert_eq!(engine.gameplay_event_len(), 2);
    let events = unsafe {
        std::slice::from_raw_parts(engine.gameplay_event_ptr(), engine.gameplay_event_len())
    };
    assert_eq!(events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
    assert_eq!(events[1].kind, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED);
    assert_eq!(events[1].payload_bits, 2);
    assert_eq!(events[1].token_id, 3);
    assert_eq!(
        engine.gameplay_behavior_state(bullet.id, bullet.generation),
        3
    );
}

#[test]
fn fixed_timestep_collision_damage_events_drive_one_behavior_transition_per_render_frame() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update_frame(0.016, false, false, false);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.healths[enemy.id as usize] = Some(4.0);
    engine.world.damages[bullet.id as usize] = Some(1.0);
    assert!(engine.add_gameplay_collision_damage(bullet.id, bullet.generation, 1));
    assert!(engine.set_gameplay_behavior_state_machine(bullet.id, bullet.generation, 1));
    assert!(engine.add_gameplay_behavior_event_transition(
        bullet.id,
        bullet.generation,
        1,
        2,
        GAMEPLAY_EVENT_COLLISION_DAMAGE,
        0,
    ));
    assert!(engine.add_gameplay_behavior_event_transition(
        bullet.id,
        bullet.generation,
        2,
        3,
        GAMEPLAY_EVENT_COLLISION_DAMAGE,
        0,
    ));
    engine.configure_fixed_timestep(true, 1.0 / 60.0, 1.0, 4);

    engine.update_frame(0.05, false, false, false);

    assert_eq!(engine.physics_fixed_steps(), 3);
    assert!(engine.gameplay_event_len() >= 1);
    assert_eq!(
        engine.gameplay_behavior_state(bullet.id, bullet.generation),
        2
    );
}
