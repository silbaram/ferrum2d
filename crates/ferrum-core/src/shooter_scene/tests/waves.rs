use super::*;

#[test]
fn enemy_spawn_pattern_corners_cycles_world_corners() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_spawn_pattern(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemySpawnPattern::Corners,
    );

    assert_eq!(scene.enemy_spawn_position(0), (0.0, 0.0));
    assert_eq!(scene.enemy_spawn_position(1), (1600.0, 0.0));
    assert_eq!(scene.enemy_spawn_position(2), (1600.0, 960.0));
    assert_eq!(scene.enemy_spawn_position(3), (0.0, 960.0));
}

#[test]
fn enemy_spawn_pattern_center_uses_world_center() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_spawn_pattern(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemySpawnPattern::Center,
    );

    assert_eq!(scene.enemy_spawn_position(7), (800.0, 480.0));
}

#[test]
fn wave_config_applies_spawn_preset_values() {
    let (mut scene, mut world, _, _) = playing_scene();
    scene.set_wave_config(
        0,
        ShooterWaveConfig::from_values(
            10.0,
            0.5,
            2,
            42.0,
            EnemyBehavior::Static,
            EnemySpawnPattern::Center,
            5.0,
            11,
        ),
    );
    scene.enemy_spawn_timer = 0.0;

    scene.spawn_enemy_if_needed(&mut world);

    let enemy = world
        .colliders
        .iter()
        .enumerate()
        .find(|(_, collider)| collider.is_some_and(|c| c.layer == CollisionLayer::Enemy))
        .map(|(index, _)| index)
        .unwrap();
    assert_eq!(world.transforms[enemy].unwrap().x, 800.0);
    assert_eq!(world.transforms[enemy].unwrap().y, 480.0);
    assert_eq!(world.healths[enemy], Some(5.0));
    assert_eq!(world.score_rewards[enemy], Some(11));

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(world.velocities[enemy], Some(Velocity::default()));
}

#[test]
fn wave_config_limits_spawn_count_and_cycles() {
    let (mut scene, mut world, _, _) = playing_scene();
    scene.set_wave_config(
        0,
        ShooterWaveConfig::from_values(
            10.0,
            0.25,
            1,
            72.0,
            EnemyBehavior::Chase,
            EnemySpawnPattern::Center,
            1.0,
            1,
        ),
    );
    scene.set_wave_config(
        1,
        ShooterWaveConfig::from_values(
            10.0,
            0.25,
            1,
            72.0,
            EnemyBehavior::Chase,
            EnemySpawnPattern::Corners,
            1.0,
            1,
        ),
    );
    scene.enemy_spawn_timer = 0.0;

    scene.spawn_enemy_if_needed(&mut world);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);

    scene.spawn_enemy_if_needed(&mut world);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);

    scene.advance_wave_if_needed(&world, None);
    scene.enemy_spawn_timer = 0.0;
    scene.spawn_enemy_if_needed(&mut world);

    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 2);
    assert_eq!(scene.active_wave_index, 1);
}

#[test]
fn wave_action_trigger_queues_source_owned_spawn_prefab_on_wave_advance() {
    let (mut scene, mut world, _camera, mut audio_events) = playing_scene();
    scene.set_wave_config(
        0,
        ShooterWaveConfig::from_values(
            0.1,
            0.25,
            1,
            72.0,
            EnemyBehavior::Chase,
            EnemySpawnPattern::Center,
            1.0,
            1,
        ),
    );
    scene.set_wave_config(
        1,
        ShooterWaveConfig::from_values(
            10.0,
            0.25,
            1,
            72.0,
            EnemyBehavior::Chase,
            EnemySpawnPattern::Center,
            1.0,
            1,
        ),
    );
    let source = world.spawn_entity();
    world.set_transform(source, Transform2D { x: 640.0, y: 240.0 });
    assert!(world.upsert_action_binding(
        source,
        ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            -32.0,
            0.0,
        ),
    ));
    assert!(scene.set_wave_action_trigger(&world, 1, source, 11));

    scene.wave_elapsed_seconds = 0.1;
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.advance_wave_if_needed(&world, Some(&mut gameplay_sink));
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut gameplay_sink));
        scene.flush_pending_spawns_with_events(
            &mut world,
            &mut audio_events,
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.active_wave_index, 1);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);
    assert_eq!(gameplay_events.len(), 1);
    assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_PREFAB_SPAWNED);
    assert_eq!(gameplay_events[0].source_id, source.id);
    assert_eq!(gameplay_events[0].source_generation, source.generation);
    assert_eq!(gameplay_events[0].token_id, 1);
    assert_eq!(gameplay_events[0].payload_bits, 11);
    assert_eq!(
        world
            .action_binding(source, 11)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.5,
    );
}

#[test]
fn wave_action_trigger_rejects_or_skips_stale_source_entity() {
    let (mut scene, mut world, _camera, mut audio_events) = playing_scene();
    scene.set_wave_config(
        0,
        ShooterWaveConfig::from_values(
            0.1,
            0.25,
            1,
            72.0,
            EnemyBehavior::Chase,
            EnemySpawnPattern::Center,
            1.0,
            1,
        ),
    );
    scene.set_wave_config(
        1,
        ShooterWaveConfig::from_values(
            10.0,
            0.25,
            1,
            72.0,
            EnemyBehavior::Chase,
            EnemySpawnPattern::Center,
            1.0,
            1,
        ),
    );
    let source = world.spawn_entity();
    assert!(world.upsert_action_binding(
        source,
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
    assert!(scene.set_wave_action_trigger(&world, 1, source, 11));
    world.despawn(source);
    assert!(!scene.set_wave_action_trigger(&world, 1, source, 11));

    scene.wave_elapsed_seconds = 0.1;
    let mut gameplay_events = Vec::new();
    {
        let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
        scene.advance_wave_if_needed(&world, Some(&mut gameplay_sink));
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut gameplay_sink));
        scene.flush_pending_spawns_with_events(
            &mut world,
            &mut audio_events,
            Some(&mut gameplay_sink),
        );
    }

    assert_eq!(scene.active_wave_index, 1);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
    assert!(gameplay_events.is_empty());
}
