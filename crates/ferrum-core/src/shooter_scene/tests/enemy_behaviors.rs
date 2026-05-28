use super::*;

#[test]
fn enemy_spawns_after_playing_interval() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();

    scene.update(
        &mut world,
        &mut camera,
        InputState::default(),
        &mut audio_events,
        &Tilemap::default(),
        DEFAULT_ENEMY_SPAWN_INTERVAL - 0.01,
    );
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);

    scene.update(
        &mut world,
        &mut camera,
        InputState::default(),
        &mut audio_events,
        &Tilemap::default(),
        0.02,
    );
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);
}

#[test]
fn enemy_behavior_static_stops_enemy_velocity() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_behavior(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemyBehavior::Static,
    );
    let enemy = world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(
        world.velocities[enemy.id as usize],
        Some(Velocity::default())
    );
}

#[test]
fn enemy_behavior_drift_moves_enemy_toward_world_center() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_behavior(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemyBehavior::Drift,
    );
    let enemy = world.spawn_enemy(0.0, 480.0, DEFAULT_TEXTURE_ID);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    let velocity = world.velocities[enemy.id as usize].unwrap();
    assert!(velocity.vx > 0.0);
    assert!(velocity.vy.abs() < 0.01);
}

#[test]
fn enemy_behavior_orbit_moves_enemy_around_player() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_behavior(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemyBehavior::Orbit,
    );
    let player = world.player.unwrap();
    world.transforms[player.id as usize] = Some(Transform2D { x: 100.0, y: 100.0 });
    let enemy = world.spawn_enemy(280.0, 100.0, DEFAULT_TEXTURE_ID);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    let velocity = world.velocities[enemy.id as usize].unwrap();
    assert!(velocity.vx.abs() < 0.01);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_behavior_orbit_uses_configured_radius() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_config(
        &mut world,
        &mut camera,
        &mut audio_events,
        ShooterConfig::default()
            .with_enemy_behavior(EnemyBehavior::Orbit)
            .with_orbit(220.0, 0.0),
    );
    let player = world.player.unwrap();
    world.transforms[player.id as usize] = Some(Transform2D { x: 100.0, y: 100.0 });
    let enemy = world.spawn_enemy(280.0, 100.0, DEFAULT_TEXTURE_ID);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    let velocity = world.velocities[enemy.id as usize].unwrap();
    assert!(velocity.vx > 0.0);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_behavior_chase_uses_tilemap_navigation_waypoint() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.player.unwrap();
    world.transforms[player.id as usize] = Some(Transform2D { x: 25.0, y: 5.0 });
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
        0,
        3,
        3,
        10.0,
        10.0,
        0.0,
        0.0,
        true,
        vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
    );

    scene.update_enemy_velocity(&mut world, &tilemap, 0.0);

    let velocity = world.velocities[enemy.id as usize].unwrap();
    assert!(velocity.vx.abs() < 0.01);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_behavior_chase_reuses_navigation_waypoint_until_repath_interval() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.player.unwrap();
    world.transforms[player.id as usize] = Some(Transform2D { x: 25.0, y: 5.0 });
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
        0,
        3,
        3,
        10.0,
        10.0,
        0.0,
        0.0,
        true,
        vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
    );

    scene.update_enemy_velocity(&mut world, &tilemap, 0.0);
    scene.update_enemy_velocity(
        &mut world,
        &Tilemap::default(),
        NAVIGATION_REPATH_INTERVAL * 0.5,
    );

    let cached_velocity = world.velocities[enemy.id as usize].unwrap();
    assert!(cached_velocity.vx.abs() < 0.01);
    assert!(cached_velocity.vy > 0.0);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), NAVIGATION_REPATH_INTERVAL);

    let repathed_velocity = world.velocities[enemy.id as usize].unwrap();
    assert!(repathed_velocity.vx > 0.0);
    assert!(repathed_velocity.vy.abs() < 0.01);
}
