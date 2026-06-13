use super::*;

#[test]
fn reset_game_clears_score_and_recreates_player() {
    let mut engine = Engine::new();
    engine.scenes.shooter.update(
        &mut engine.world,
        &mut engine.camera,
        InputState {
            space: 1,
            ..InputState::default()
        },
        &mut engine.frame_buffers.audio_events,
        &Tilemap::default(),
        0.016,
    );
    engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    engine.reset_game();

    assert_eq!(engine.score(), 0);
    assert!(engine.world.player_entity().is_some());
    assert_eq!(count_layer(&engine, CollisionLayer::Player), 1);
    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 0);
}

#[test]
fn data_scene_mode_starts_blank_and_updates_generic_world_state() {
    let mut engine = Engine::new();

    engine.use_data_scene();
    assert_eq!(engine.game_state(), 1);
    assert_eq!(engine.score(), 0);
    assert_eq!(engine.entity_count(), 0);
    assert_eq!(engine.built_in_shooter_player_entity_id(), u32::MAX);

    let entity = engine.world.spawn_entity();
    engine
        .world
        .set_transform(entity, Transform2D { x: 10.0, y: 20.0 });
    engine
        .world
        .set_velocity(entity, Velocity { vx: 8.0, vy: -4.0 });

    engine.update_frame(0.5, false, false, false);

    let transform = engine
        .world
        .transform(entity)
        .expect("entity has transform");
    assert_eq!(engine.entity_count(), 1);
    assert!((transform.x - 14.0).abs() < f32::EPSILON);
    assert!((transform.y - 18.0).abs() < f32::EPSILON);
}

#[test]
fn data_scene_reset_keeps_data_mode_without_recreating_builtin_entities() {
    let mut engine = Engine::new();
    engine.use_breakout_scene();
    assert!(engine.entity_count() > 0);

    engine.use_data_scene();
    let entity = engine.world.spawn_entity();
    engine
        .world
        .set_transform(entity, Transform2D { x: 10.0, y: 10.0 });
    assert_eq!(engine.entity_count(), 1);

    engine.reset_game();

    assert_eq!(engine.game_state(), 1);
    assert_eq!(engine.score(), 0);
    assert_eq!(engine.entity_count(), 0);
    assert_eq!(engine.built_in_shooter_player_entity_id(), u32::MAX);
}

#[test]
fn data_scene_switch_and_reset_clear_stale_output_buffers() {
    fn test_render_command() -> crate::render_command::SpriteRenderCommand {
        crate::render_command::SpriteRenderCommand {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
            texture_id: 0.0,
            effect_flags: 0.0,
        }
    }

    fn test_render_item() -> crate::render_command::SpriteRenderItem {
        crate::render_command::SpriteRenderItem {
            command: test_render_command(),
            sort_key: crate::render_command::SpriteRenderSortKey {
                floor_id: 0,
                elevation: 0.0,
                foot_y: 0.0,
                render_layer: 0,
                stable_id: 0,
            },
        }
    }

    fn test_audio_event() -> crate::audio_event::AudioEvent {
        crate::audio_event::AudioEvent {
            sound_id: 1.0,
            volume: 1.0,
            pitch: 1.0,
            channel_id: crate::audio_event::AUDIO_CHANNEL_SFX,
        }
    }

    let mut engine = Engine::new();
    engine.use_breakout_scene();
    engine.update(0.016);
    engine.frame_buffers.audio_events.push(test_audio_event());
    engine.frame_buffers.render_items.push(test_render_item());

    assert!(engine.render_command_len() > 0);
    assert_eq!(engine.audio_event_len(), 1);
    assert_eq!(engine.frame_buffers.render_items.len(), 1);

    engine.use_data_scene();

    assert_eq!(engine.render_command_len(), 0);
    assert_eq!(engine.audio_event_len(), 0);
    assert!(engine.frame_buffers.render_items.is_empty());

    engine
        .frame_buffers
        .render_commands
        .push(test_render_command());
    engine.frame_buffers.render_items.push(test_render_item());
    engine.frame_buffers.audio_events.push(test_audio_event());

    engine.reset_game();

    assert_eq!(engine.render_command_len(), 0);
    assert_eq!(engine.audio_event_len(), 0);
    assert!(engine.frame_buffers.render_items.is_empty());
}

#[test]
fn data_scene_rejects_builtin_shooter_snapshot_capture() {
    let mut engine = Engine::new();

    engine.use_data_scene();

    assert!(!engine.capture_shooter_snapshot());
    assert_eq!(engine.shooter_snapshot_header_float_len(), 0);
    assert_eq!(engine.shooter_snapshot_header_u32_len(), 0);
    assert_eq!(engine.shooter_snapshot_entity_float_len(), 0);
    assert_eq!(engine.shooter_snapshot_entity_u32_len(), 0);
}

#[test]
fn engine_can_switch_to_breakout_scene() {
    let mut engine = Engine::new();

    engine.use_breakout_scene();
    engine.update(0.016);

    assert_eq!(engine.game_state(), 0);
    assert_eq!(engine.score(), 0);
    assert_eq!(engine.entity_count(), 55);
    assert_eq!(engine.sprite_count(), 55);

    engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
    engine.update(0.016);

    assert_eq!(engine.game_state(), 1);
    assert_eq!(count_layer(&engine, CollisionLayer::Wall), 3);
}

#[test]
fn breakout_brick_hit_spawns_default_particle_burst() {
    let mut engine = Engine::new();
    engine.use_breakout_scene();
    engine.reset_game();
    let ball = find_layer(&engine, CollisionLayer::Bullet);
    let brick = find_lowest_layer(&engine, CollisionLayer::Enemy);
    let brick_transform = engine.world.transform(brick).expect("brick has transform");
    let brick_collider = engine.world.collider(brick).expect("brick has collider");
    let ball_collider = engine.world.collider(ball).expect("ball has collider");
    engine.world.set_transform(
        ball,
        Transform2D {
            x: brick_transform.x,
            y: brick_transform.y + brick_collider.half_height + ball_collider.half_height + 1.0,
        },
    );
    engine.world.set_velocity(
        ball,
        crate::components::Velocity {
            vx: 0.0,
            vy: -285.0,
        },
    );

    engine.update(0.1);

    assert_eq!(engine.collision_hit_count(), 1);
    assert_eq!(engine.particle_count(), 10);
    assert!(!engine.world.is_alive_index(brick.id as usize));
    assert!(engine.frame_buffers.render_commands.len() > engine.entity_count());
    assert!(engine
        .frame_buffers
        .render_commands
        .iter()
        .any(|command| command.width < 10.0));
}

#[test]
fn engine_can_switch_to_platformer_scene() {
    let mut engine = Engine::new();

    engine.use_platformer_scene();
    engine.update(0.016);

    assert_eq!(engine.game_state(), 0);
    assert_eq!(engine.score(), 0);
    assert_eq!(engine.entity_count(), 8);
    assert_eq!(engine.sprite_count(), 7);
    assert_eq!(count_layer(&engine, CollisionLayer::Wall), 6);
    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
    assert!(engine.world.player_entity().is_some());
    assert_eq!(engine.built_in_shooter_player_entity_id(), u32::MAX);
    assert_eq!(engine.built_in_shooter_player_entity_generation(), 0);

    engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, true, false, false, false, 0.0, 0.0);
    engine.update(0.25);

    assert_eq!(engine.game_state(), 1);
    assert!(engine.physics_kinematic_moves() > 0);
}

#[test]
fn platformer_landing_spawns_default_dust_burst() {
    let mut engine = Engine::new();
    engine.use_platformer_scene();
    engine.reset_game();
    let player = find_layer(&engine, CollisionLayer::Player);
    engine.world.set_transform(
        player,
        Transform2D {
            x: 96.0,
            y: 640.0 - 48.0 - 36.0 * 0.5 - 18.0,
        },
    );
    engine
        .world
        .set_velocity(player, crate::components::Velocity { vx: 0.0, vy: 220.0 });

    engine.update(0.1);

    assert_eq!(engine.particle_count(), 12);
    assert!(engine.frame_buffers.render_commands.len() > engine.entity_count());
    assert!(engine
        .frame_buffers
        .render_commands
        .iter()
        .any(|command| command.width < 9.0));
}
