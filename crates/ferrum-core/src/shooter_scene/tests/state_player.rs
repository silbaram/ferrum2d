use super::*;

#[test]
fn diagonal_movement_is_normalized() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let input = InputState {
        w: 1,
        d: 1,
        ..InputState::default()
    };

    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);

    let player = world.primary_actor_entity().unwrap();
    let v = world.velocity(player).unwrap();
    let speed = (v.vx * v.vx + v.vy * v.vy).sqrt();
    assert!((speed - DEFAULT_PLAYER_SPEED).abs() < 0.01);
}

#[test]
fn player_topdown_input_movement_pattern_overrides_config_speed() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_movement_pattern(player, MovementPattern::TopdownInput { speed: 96.0 });

    scene.apply_player_input(
        &mut world,
        &camera,
        InputState {
            d: 1,
            ..InputState::default()
        },
        &mut audio_events,
    );

    assert_eq!(world.velocity(player), Some(Velocity { vx: 96.0, vy: 0.0 }));
}

#[test]
fn player_movement_phase_is_separate_from_action_phase() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_velocity(player, Velocity { vx: 1.0, vy: 2.0 });
    let input = InputState {
        d: 1,
        ..InputState::default()
    };
    let input_actions = InputActionRegistry::default();

    scene.apply_player_actions_with_input(
        &mut world,
        &camera,
        input,
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );

    assert_eq!(world.velocity(player), Some(Velocity { vx: 1.0, vy: 2.0 }),);

    scene.apply_player_movement_input(&mut world, input);

    assert_eq!(
        world.velocity(player),
        Some(Velocity {
            vx: DEFAULT_PLAYER_SPEED,
            vy: 0.0,
        }),
    );
}

#[test]
fn title_enters_playing_with_enter_or_space() {
    let mut scene = ShooterScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(800.0, 480.0);
    let mut audio_events = Vec::new();
    scene.reset_to_title(&mut world, &mut camera, &mut audio_events);

    scene.update(
        &mut world,
        &mut camera,
        InputState {
            enter: 1,
            ..InputState::default()
        },
        &mut audio_events,
        &Tilemap::default(),
        0.016,
    );
    assert_eq!(scene.game_state(), GameState::Playing);

    let mut scene = ShooterScene::new();
    scene.reset_to_title(&mut world, &mut camera, &mut audio_events);
    scene.update(
        &mut world,
        &mut camera,
        InputState {
            space: 1,
            ..InputState::default()
        },
        &mut audio_events,
        &Tilemap::default(),
        0.016,
    );
    assert_eq!(scene.game_state(), GameState::Playing);
}

#[test]
fn title_does_not_start_from_mouse_left() {
    let mut scene = ShooterScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(800.0, 480.0);
    let mut audio_events = Vec::new();
    scene.reset_to_title(&mut world, &mut camera, &mut audio_events);

    scene.update(
        &mut world,
        &mut camera,
        InputState {
            mouse_left: 1,
            ..InputState::default()
        },
        &mut audio_events,
        &Tilemap::default(),
        0.016,
    );

    assert_eq!(scene.game_state(), GameState::Title);
}

#[test]
fn game_over_restarts_with_space() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.game_state = GameState::GameOver;
    scene.score = 7;

    scene.update(
        &mut world,
        &mut camera,
        InputState {
            space: 1,
            ..InputState::default()
        },
        &mut audio_events,
        &Tilemap::default(),
        0.016,
    );

    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(scene.score(), 0);
    assert!(world.primary_actor_entity().is_some());
}

#[test]
fn player_enemy_collision_sets_game_over() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let pt = world.transform(player).unwrap();
    world.spawn_enemy(pt.x, pt.y, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.game_state(), GameState::GameOver);
}

#[test]
fn player_is_clamped_inside_world_bounds() {
    let (scene, mut world, _, _) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(
        player,
        Transform2D {
            x: -100.0,
            y: 1000.0,
        },
    );

    scene.clamp_player_to_world(&mut world);

    let transform = world.transform(player).unwrap();
    assert_eq!(transform.x, 18.0);
    assert_eq!(transform.y, DEFAULT_WORLD_HEIGHT - 18.0);
}

#[test]
fn firing_uses_camera_adjusted_mouse_world_position() {
    let (scene, mut world, mut camera, mut audio_events) = playing_scene();
    camera.set_viewport_size(400.0, 240.0);
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(
        player,
        Transform2D {
            x: 1000.0,
            y: 600.0,
        },
    );
    scene.update_camera_follow(&world, &mut camera);

    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState {
            mouse_left: 1,
            mouse_x: 220.0,
            mouse_y: 120.0,
            ..InputState::default()
        },
        player,
        &mut audio_events,
    );

    let bullet_index = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Bullet))
        .unwrap();
    let bullet_velocity = world.velocity_at_index(bullet_index).unwrap();
    assert!((bullet_velocity.vx - DEFAULT_BULLET_SPEED).abs() < 0.01);
    assert!(bullet_velocity.vy.abs() < 0.01);
    let bullet_transform = world.transform_at_index(bullet_index).unwrap();
    let spawn_offset = scene
        .config
        .player_template
        .sprite_width
        .max(scene.config.player_template.sprite_height)
        * 0.5
        + scene
            .config
            .bullet_template
            .sprite_width
            .max(scene.config.bullet_template.sprite_height)
            * 0.5;
    assert!((bullet_transform.x - (1000.0 + spawn_offset)).abs() < 0.01);
    assert!((bullet_transform.y - 600.0).abs() < 0.01);
}

#[test]
fn legacy_projectile_fallback_requires_fire_input() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();

    scene.apply_player_input(
        &mut world,
        &camera,
        InputState::default(),
        &mut audio_events,
    );

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(scene.fire_cooldown_seconds, 0.0);

    scene.apply_player_input(
        &mut world,
        &camera,
        InputState {
            mouse_left: 1,
            ..InputState::default()
        },
        &mut audio_events,
    );

    assert_eq!(scene.pending_spawn_count(), 1);
    assert_eq!(scene.fire_cooldown_seconds, scene.config.fire_cooldown);
}

#[test]
fn update_records_spawn_flush_frame_diagnostics_for_projectile() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_sound_ids(10, 20, 30);

    scene.update(
        &mut world,
        &mut camera,
        InputState {
            mouse_left: 1,
            mouse_x: 900.0,
            mouse_y: 240.0,
            ..InputState::default()
        },
        &mut audio_events,
        &Tilemap::default(),
        0.016,
    );

    let result = scene.last_spawn_flush_result();
    assert_eq!(result.commands_drained, 1);
    assert_eq!(result.projectile_spawns, 1);
    assert_eq!(result.projectile_arcs_applied, 0);
    assert_eq!(result.projectile_shoot_audio_events_pushed, 1);
    assert_eq!(result.prefab_spawns, 0);
    assert_eq!(result.prefab_spawned_payloads, 0);
    assert_eq!(result.prefab_spawned_events_pushed, 0);
    assert_eq!(count_layer(&world, CollisionLayer::Bullet), 1);
    assert_eq!(audio_events.len(), 1);

    scene.reset_action_trigger_frame_diagnostics();
    assert_eq!(scene.last_spawn_flush_result(), Default::default());
}

#[test]
fn authored_projectile_action_overrides_player_fire_config_and_uses_cooldown() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let player_faction =
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap();
    world.set_gameplay_faction(player, player_faction);
    assert!(
        world.upsert_action_binding(player, ActionBinding::projectile(1, 0.5, 900.0, 3.0, 0.25),)
    );

    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);

    assert_eq!(count_layer(&world, CollisionLayer::Bullet), 0);
    assert_eq!(scene.pending_spawn_count(), 1);
    assert!(audio_events.is_empty());
    scene.flush_pending_spawns(&mut world, &mut audio_events);

    assert_eq!(count_layer(&world, CollisionLayer::Bullet), 1);
    let bullet_index = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Bullet))
        .unwrap();
    let bullet_velocity = world.velocity_at_index(bullet_index).unwrap();
    let bullet_speed =
        (bullet_velocity.vx * bullet_velocity.vx + bullet_velocity.vy * bullet_velocity.vy).sqrt();
    assert!((bullet_speed - 900.0).abs() < 0.01);
    assert_eq!(world.damage_at_index(bullet_index), Some(3.0));
    assert_eq!(world.gameplay_lifetime_at(bullet_index), Some(0.25));
    assert_eq!(
        world.gameplay_faction_at_index(bullet_index),
        Some(player_faction)
    );

    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);
    scene.flush_pending_spawns(&mut world, &mut audio_events);
    assert_eq!(count_layer(&world, CollisionLayer::Bullet), 1);

    world.tick_action_cooldowns(0.5);
    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);
    scene.flush_pending_spawns(&mut world, &mut audio_events);
    assert_eq!(count_layer(&world, CollisionLayer::Bullet), 2);
}

#[test]
fn authored_spawn_prefab_action_queues_enemy_prephysics_and_uses_cooldown() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let start = world.transform(player).unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            32.0,
            -8.0,
        ),
    ));
    let mut input_actions = InputActionRegistry::empty();
    assert!(input_actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };

    scene.apply_player_input_with_actions(
        &mut world,
        &camera,
        input,
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );

    assert_eq!(scene.pending_spawn_count(), 1);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.flush_pending_spawns_with_events(
            &mut world,
            &mut audio_events,
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);
    let enemy_index = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Enemy))
        .unwrap();
    let enemy_t = world.transform_at_index(enemy_index).unwrap();
    assert!((enemy_t.x - (start.x + 32.0)).abs() < 0.01);
    assert!((enemy_t.y - (start.y - 8.0)).abs() < 0.01);
    assert_eq!(
        world.health_at_index(enemy_index),
        Some(DEFAULT_ENEMY_HEALTH)
    );
    assert_eq!(
        world.score_reward_at_index(enemy_index),
        Some(DEFAULT_SCORE_REWARD)
    );
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(gameplay_events[0].actor_id, enemy_index as u32);
    assert_eq!(
        gameplay_events[0].actor_generation,
        world
            .generation_at_index(enemy_index)
            .expect("test entity index should exist")
    );
    assert_eq!(gameplay_events[0].source_id, player.id);
    assert_eq!(gameplay_events[0].source_generation, player.generation);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(gameplay_events[0].payload_bits, 11);
    assert!(
        (world
            .action_binding(player, 11)
            .unwrap()
            .cooldown
            .remaining_seconds
            - 0.5)
            .abs()
            < 0.001
    );

    scene.apply_player_input_with_actions(
        &mut world,
        &camera,
        input,
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );
    scene.flush_pending_spawns(&mut world, &mut audio_events);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);

    world.tick_action_cooldowns(0.5);
    scene.apply_player_input_with_actions(
        &mut world,
        &camera,
        input,
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );
    scene.flush_pending_spawns(&mut world, &mut audio_events);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 2);
}

#[test]
fn invalid_authored_spawn_prefab_action_does_not_consume_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            99,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let mut input_actions = InputActionRegistry::empty();
    assert!(input_actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));

    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
            &input_actions,
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].actor_id, player.id);
    assert_eq!(gameplay_events[0].source_id, player.id);
    assert_eq!(gameplay_events[0].token_id, 11);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB
    );
    assert_eq!(
        world
            .action_binding(player, 11)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0,
    );
}

#[test]
fn authored_spawn_prefab_action_reports_queue_full_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let mut input_actions = InputActionRegistry::empty();
    assert!(input_actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    scene.fill_pending_spawns_for_test();

    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
            &input_actions,
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 64);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 11);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL
    );
    assert_eq!(
        world
            .action_binding(player, 11)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0,
    );
}

#[test]
fn authored_spawn_prefab_action_reports_blocked_placement_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let mut input_actions = InputActionRegistry::empty();
    assert!(input_actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
        0,
        1,
        1,
        32.0,
        32.0,
        player_t.x - 16.0,
        player_t.y - 16.0,
        true,
        vec![1],
    );

    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
            &input_actions,
            &tilemap,
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 11);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT
    );
    assert_eq!(
        world
            .action_binding(player, 11)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0,
    );
}

#[test]
fn authored_spawn_prefab_action_queue_full_takes_precedence_over_blocked_placement() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let mut input_actions = InputActionRegistry::empty();
    assert!(input_actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
        0,
        1,
        1,
        32.0,
        32.0,
        player_t.x - 16.0,
        player_t.y - 16.0,
        true,
        vec![1],
    );
    scene.fill_pending_spawns_for_test();

    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
            &input_actions,
            &tilemap,
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 64);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 11);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL
    );
    assert_eq!(
        world
            .action_binding(player, 11)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0,
    );
}

#[test]
fn authored_spawn_prefab_action_ignores_non_collision_tilemap_layer() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let mut input_actions = InputActionRegistry::empty();
    assert!(input_actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
        0,
        1,
        1,
        32.0,
        32.0,
        player_t.x - 16.0,
        player_t.y - 16.0,
        false,
        vec![1],
    );

    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
            &input_actions,
            &tilemap,
            Some(&mut gameplay_sink),
        );
    }

    assert!(gameplay_events.is_empty());
    assert_eq!(scene.pending_spawn_count(), 1);
    assert_eq!(
        world
            .action_binding(player, 11)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.5,
    );
}

#[test]
fn blocked_spawn_prefab_uses_prefab_collider_offset() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    scene.config.enemy_template =
        scene
            .config
            .enemy_template
            .with_collider(crate::world::EntityTemplateCollider::aabb(
                12.0, 12.0, 40.0, 0.0, true, true, None,
            ));
    let player = world.primary_actor_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let mut input_actions = InputActionRegistry::empty();
    assert!(input_actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
        0,
        1,
        1,
        32.0,
        32.0,
        player_t.x + 24.0,
        player_t.y - 16.0,
        true,
        vec![1],
    );

    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
            &input_actions,
            &tilemap,
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT
    );
    assert_eq!(
        world
            .action_binding(player, 11)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0,
    );
}

#[test]
fn authored_dash_action_moves_player_and_uses_cooldown() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let start = world.transform(player).unwrap();
    assert!(world.upsert_action_binding(player, ActionBinding::dash(2, 0.5, 96.0)));
    let input = InputState {
        d: 1,
        enter: 1,
        ..InputState::default()
    };

    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);
    let after_dash = world.transform(player).unwrap();
    assert!((after_dash.x - (start.x + 96.0)).abs() < 0.01);
    assert!((after_dash.y - start.y).abs() < 0.01);

    scene.apply_player_input(
        &mut world,
        &camera,
        InputState {
            d: 1,
            ..InputState::default()
        },
        &mut audio_events,
    );
    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);
    let after_cooldown_block = world.transform(player).unwrap();
    assert!((after_cooldown_block.x - after_dash.x).abs() < 0.01);

    scene.apply_player_input(
        &mut world,
        &camera,
        InputState {
            d: 1,
            ..InputState::default()
        },
        &mut audio_events,
    );
    world.tick_action_cooldowns(0.5);
    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);
    let after_second_dash = world.transform(player).unwrap();
    assert!((after_second_dash.x - (after_dash.x + 96.0)).abs() < 0.01);
}

#[test]
fn non_projectile_primary_action_does_not_consume_cooldown() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(player, ActionBinding::dash(1, 0.5, 96.0)));
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };

    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);

    let binding = world.action_binding(player, 1).unwrap();
    assert_eq!(binding, ActionBinding::dash(1, 0.5, 96.0));
    assert_eq!(scene.pending_spawn_count(), 0);
}

#[test]
fn authored_projectile_action_reports_pattern_mismatch() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(player, ActionBinding::dash(1, 0.5, 96.0)));
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH
    );
    assert_eq!(
        world
            .action_binding(player, 1)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_projectile_action_reports_unsupported_aim_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::projectile_with_target(
            1,
            0.5,
            ProjectileActionConfig {
                speed: 900.0,
                damage: 3.0,
                lifetime_seconds: 0.25,
                aim: ActionAimSource::TargetPlayer,
                collision_target: ProjectileCollisionTarget::Enemies,
                tile_impact: ProjectileTileImpact::Despawn,
            },
        ),
    ));
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE
    );
    assert_eq!(
        world
            .action_binding(player, 1)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_projectile_action_unsupported_aim_takes_precedence_over_missing_source_transform() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.clear_transform_for_test(player));
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::projectile_with_target(
            1,
            0.5,
            ProjectileActionConfig {
                speed: 900.0,
                damage: 3.0,
                lifetime_seconds: 0.25,
                aim: ActionAimSource::TargetPlayer,
                collision_target: ProjectileCollisionTarget::Enemies,
                tile_impact: ProjectileTileImpact::Despawn,
            },
        ),
    ));
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE
    );
    assert_eq!(
        world
            .action_binding(player, 1)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_projectile_action_reports_unsupported_collision_target_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::projectile_with_target(
            1,
            0.5,
            ProjectileActionConfig {
                speed: 900.0,
                damage: 3.0,
                lifetime_seconds: 0.25,
                aim: ActionAimSource::Input,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Despawn,
            },
        ),
    ));
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET
    );
    assert_eq!(
        world
            .action_binding(player, 1)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_projectile_action_reports_missing_source_transform_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.clear_transform_for_test(player));
    assert!(
        world.upsert_action_binding(player, ActionBinding::projectile(1, 0.5, 900.0, 3.0, 0.25),)
    );
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM
    );
    assert_eq!(
        world
            .action_binding(player, 1)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn spawn_prefab_action_can_use_primary_action_id_without_false_pattern_mismatch() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            1,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let input = InputState {
        mouse_left: 1,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert!(gameplay_events.is_empty());
    assert_eq!(scene.pending_spawn_count(), 1);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.flush_pending_spawns_with_events(
            &mut world,
            &mut audio_events,
            Some(&mut gameplay_sink),
        );
    }
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(
        gameplay_events[0].payload_bits,
        SHOOTER_PRIMARY_FIRE_ACTION_ID
    );
}

#[test]
fn spawn_prefab_action_can_use_dash_action_id_without_false_pattern_mismatch() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            SHOOTER_DASH_ACTION_ID,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert!(gameplay_events.is_empty());
    assert_eq!(scene.pending_spawn_count(), 1);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.flush_pending_spawns_with_events(
            &mut world,
            &mut audio_events,
            Some(&mut gameplay_sink),
        );
    }
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(gameplay_events[0].payload_bits, SHOOTER_DASH_ACTION_ID);
}

#[test]
fn spawn_prefab_action_can_use_melee_action_id_without_false_pattern_mismatch() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            SHOOTER_MELEE_ACTION_ID,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };
    let mut input_actions = InputActionRegistry::default();
    assert!(input_actions.set_binding(
        SHOOTER_MELEE_ACTION_ID,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &input_actions,
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert!(gameplay_events.is_empty());
    assert_eq!(scene.pending_spawn_count(), 1);
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.flush_pending_spawns_with_events(
            &mut world,
            &mut audio_events,
            Some(&mut gameplay_sink),
        );
    }
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(gameplay_events[0].payload_bits, SHOOTER_MELEE_ACTION_ID);
}

#[test]
fn authored_projectile_action_reports_queue_full_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(
        world.upsert_action_binding(player, ActionBinding::projectile(1, 0.5, 900.0, 3.0, 0.25),)
    );
    scene.fill_pending_spawns_for_test();
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 64);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL
    );
    assert_eq!(
        world
            .action_binding(player, 1)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn cooling_down_authored_projectile_action_does_not_emit_failure() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(
        world.upsert_action_binding(player, ActionBinding::projectile(1, 0.5, 900.0, 3.0, 0.25),)
    );
    assert_eq!(
        world.commit_action_cooldown_if_ready(player, 1),
        Some(ActionBinding::projectile(1, 0.5, 900.0, 3.0, 0.25))
    );
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.pending_spawn_count(), 0);
    assert!(gameplay_events.is_empty());
}

#[test]
fn authored_dash_action_reports_missing_source_transform() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(player, ActionBinding::dash(2, 0.5, 96.0)));
    assert!(world.clear_transform_for_test(player));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 2);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM
    );
    assert_eq!(
        world
            .action_binding(player, 2)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_dash_action_reports_unsupported_aim_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::dash_with_aim(2, 0.5, 96.0, ActionAimSource::TargetPlayer,)
    ));
    let input = InputState {
        enter: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 2);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE
    );
    assert_eq!(
        world
            .action_binding(player, 2)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_dash_action_missing_source_transform_takes_precedence_over_unsupported_aim() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.clear_transform_for_test(player));
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::dash_with_aim(2, 0.5, 96.0, ActionAimSource::TargetPlayer,)
    ));
    let input = InputState {
        enter: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &InputActionRegistry::default(),
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 2);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM
    );
    assert_eq!(
        world
            .action_binding(player, 2)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_melee_action_damages_enemy_in_range_and_uses_cooldown() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    let player_height_span = HeightSpan::new(PhysicsFloorId(3), 1.0, 3.0).unwrap();
    assert!(world.set_height_span(player, player_height_span));
    let enemy = world.spawn_enemy(player_t.x + 48.0, player_t.y, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(enemy, HeightSpan::new(PhysicsFloorId(3), 2.0, 2.0).unwrap()));
    world.set_health(enemy, 2.0);
    assert!(world.upsert_action_binding(player, ActionBinding::melee(3, 0.5, 96.0, 2.0)));
    let mut input_actions = InputActionRegistry::default();
    assert!(input_actions.set_binding(
        3,
        3,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };

    scene.apply_player_input_with_actions(
        &mut world,
        &camera,
        input,
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );
    assert_eq!(scene.pending_melee_attacks.len(), 1);
    let command = scene.pending_melee_attacks[0];
    assert_eq!(command.attacker, player);
    assert_eq!(command.center, player_t);
    assert_eq!(command.range, 96.0);
    assert_eq!(command.damage, 2.0);
    assert_eq!(command.target, MeleeTarget::Enemies);
    assert_eq!(command.height_span, Some(player_height_span));
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.016,
        None,
        None,
        None,
        None,
    );

    assert!(!world.is_alive_index(enemy.id as usize));
    assert_eq!(scene.score(), DEFAULT_SCORE_REWARD);
    assert_eq!(
        world
            .action_binding(player, 3)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.5
    );

    let second = world.spawn_enemy(player_t.x + 48.0, player_t.y, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(
        second,
        HeightSpan::new(PhysicsFloorId(3), 2.0, 2.0).unwrap()
    ));
    world.set_health(second, 2.0);
    scene.apply_player_input_with_actions(
        &mut world,
        &camera,
        input,
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.016,
        None,
        None,
        None,
        None,
    );

    assert!(world.is_alive_index(second.id as usize));
    assert_eq!(scene.score(), DEFAULT_SCORE_REWARD);
}

#[test]
fn authored_melee_action_respects_faction_gate_without_score() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let mut gameplay_events = Vec::new();
    let player = world.primary_actor_entity().unwrap();
    let player_t = world.transform(player).unwrap();
    let enemy = world.spawn_enemy(player_t.x + 48.0, player_t.y, DEFAULT_TEXTURE_ID);
    world.set_health(enemy, 2.0);
    world.set_score_reward(enemy, 7);
    world.set_gameplay_faction(
        player,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
    );
    world.set_gameplay_faction(
        enemy,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    assert!(world.upsert_action_binding(player, ActionBinding::melee(3, 0.5, 96.0, 2.0)));
    let mut input_actions = InputActionRegistry::default();
    assert!(input_actions.set_binding(
        3,
        3,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));

    scene.apply_player_input_with_actions(
        &mut world,
        &camera,
        InputState {
            enter: 1,
            ..InputState::default()
        },
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.016,
            None,
            Some(&mut gameplay_sink),
            None,
            None,
        );
    }

    assert!(world.is_alive_index(enemy.id as usize));
    assert_eq!(world.health(enemy), Some(2.0));
    assert_eq!(scene.score(), 0);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(
        gameplay_events[0].kind,
        GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
    );
    assert_eq!(gameplay_events[0].actor_id, enemy.id);
    assert_eq!(gameplay_events[0].source_id, player.id);
    assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_PLAYER);
    assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_ENEMY);
    assert!(
        (world
            .action_binding(player, 3)
            .unwrap()
            .cooldown
            .remaining_seconds
            - 0.5)
            .abs()
            < 0.001
    );
}

#[test]
fn authored_melee_action_whiff_consumes_cooldown_without_score() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(player, ActionBinding::melee(3, 0.5, 32.0, 2.0)));
    let mut input_actions = InputActionRegistry::default();
    assert!(input_actions.set_binding(
        3,
        3,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };

    scene.apply_player_input_with_actions(
        &mut world,
        &camera,
        input,
        InputState::default(),
        &input_actions,
        &Tilemap::default(),
        None,
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.016,
        None,
        None,
        None,
        None,
    );

    assert_eq!(scene.score(), 0);
    assert_eq!(
        world
            .action_binding(player, 3)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.5
    );
}

#[test]
fn authored_melee_action_reports_unsupported_target_without_consuming_cooldown() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::melee_with_target(3, 0.5, 96.0, 2.0, MeleeTarget::Player,)
    ));
    let mut input_actions = InputActionRegistry::default();
    assert!(input_actions.set_binding(
        3,
        3,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &input_actions,
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 3);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET
    );
    assert_eq!(
        world
            .action_binding(player, 3)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn authored_melee_action_missing_source_transform_takes_precedence_over_unsupported_target() {
    let (mut scene, mut world, camera, _audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.clear_transform_for_test(player));
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::melee_with_target(3, 0.5, 96.0, 2.0, MeleeTarget::Player,)
    ));
    let mut input_actions = InputActionRegistry::default();
    assert!(input_actions.set_binding(
        3,
        3,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED,
    ));
    let input = InputState {
        enter: 1,
        ..InputState::default()
    };
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.apply_player_input_with_actions(
            &mut world,
            &camera,
            input,
            InputState::default(),
            &input_actions,
            &Tilemap::default(),
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
    assert_eq!(gameplay_events[0].token_id, 3);
    assert_eq!(
        gameplay_events[0].payload_bits,
        GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM
    );
    assert_eq!(
        world
            .action_binding(player, 3)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
}

#[test]
fn queued_projectile_spawns_are_cleared_by_reset_and_snapshot_restore() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    assert!(
        world.upsert_action_binding(player, ActionBinding::projectile(1, 0.5, 900.0, 3.0, 0.25),)
    );
    let snapshot = scene.snapshot(&world, &camera);
    let input = InputState {
        mouse_left: 1,
        mouse_x: 800.0,
        mouse_y: 240.0,
        ..InputState::default()
    };

    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);
    assert_eq!(scene.pending_spawn_count(), 1);
    assert!(scene.restore_snapshot(&mut world, &mut camera, &mut audio_events, &snapshot));
    assert_eq!(scene.pending_spawn_count(), 0);

    scene.apply_player_input(&mut world, &camera, input, &mut audio_events);
    assert_eq!(scene.pending_spawn_count(), 1);
    scene.reset_playing(&mut world, &mut camera, &mut audio_events);
    assert_eq!(scene.pending_spawn_count(), 0);
}

#[test]
fn queued_action_triggers_are_cleared_by_reset_and_snapshot_restore() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let snapshot = scene.snapshot(&world, &camera);

    assert!(scene.queue_action_trigger(runtime::ActionTriggerCommand::timer(player, 11)));
    assert_eq!(scene.action_triggers.pending_len(), 1);
    assert!(scene.restore_snapshot(&mut world, &mut camera, &mut audio_events, &snapshot));
    assert_eq!(scene.action_triggers.pending_len(), 0);

    let player = world.primary_actor_entity().unwrap();
    assert!(scene.queue_action_trigger(runtime::ActionTriggerCommand::timer(player, 11)));
    assert_eq!(scene.action_triggers.pending_len(), 1);
    scene.reset_playing(&mut world, &mut camera, &mut audio_events);
    assert_eq!(scene.action_triggers.pending_len(), 0);
}

#[test]
fn reset_game_clears_score_and_recreates_player() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.score = 42;
    if let Some(player) = world.primary_actor_entity() {
        world.despawn(player);
    }

    scene.reset_playing(&mut world, &mut camera, &mut audio_events);

    assert_eq!(scene.score(), 0);
    assert!(world.primary_actor_entity().is_some());
    assert_eq!(count_layer(&world, CollisionLayer::Player), 1);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
}
