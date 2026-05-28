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

    scene.advance_wave_if_needed();
    scene.enemy_spawn_timer = 0.0;
    scene.spawn_enemy_if_needed(&mut world);

    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 2);
    assert_eq!(scene.active_wave_index, 1);
}
