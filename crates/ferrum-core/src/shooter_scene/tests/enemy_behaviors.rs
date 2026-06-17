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

    scene.apply_enemy_movement_phase(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(world.velocity(enemy), Some(Velocity::default()));
}

#[test]
fn enemy_without_transform_keeps_existing_velocity() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_behavior(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemyBehavior::Drift,
    );
    let enemy = world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    assert!(world.clear_transform_for_test(enemy));
    world.set_velocity(enemy, Velocity { vx: 3.0, vy: 4.0 });

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(world.velocity(enemy), Some(Velocity { vx: 3.0, vy: 4.0 }));
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

    let velocity = world.velocity(enemy).unwrap();
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
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let enemy = world.spawn_enemy(280.0, 100.0, DEFAULT_TEXTURE_ID);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    let velocity = world.velocity(enemy).unwrap();
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
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let enemy = world.spawn_enemy(280.0, 100.0, DEFAULT_TEXTURE_ID);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    let velocity = world.velocity(enemy).unwrap();
    assert!(velocity.vx > 0.0);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_behavior_chase_uses_tilemap_navigation_waypoint() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 25.0, y: 5.0 });
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

    let velocity = world.velocity(enemy).unwrap();
    assert!(velocity.vx.abs() < 0.01);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_behavior_chase_reuses_navigation_waypoint_until_repath_interval() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 25.0, y: 5.0 });
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

    scene.apply_enemy_movement_phase(&mut world, &tilemap, 0.0);
    scene.apply_enemy_movement_phase(
        &mut world,
        &Tilemap::default(),
        NAVIGATION_REPATH_INTERVAL * 0.5,
    );

    let cached_velocity = world.velocity(enemy).unwrap();
    assert!(cached_velocity.vx.abs() < 0.01);
    assert!(cached_velocity.vy > 0.0);

    scene.apply_enemy_movement_phase(&mut world, &Tilemap::default(), NAVIGATION_REPATH_INTERVAL);

    let repathed_velocity = world.velocity(enemy).unwrap();
    assert!(repathed_velocity.vx > 0.0);
    assert!(repathed_velocity.vy.abs() < 0.01);
}

#[test]
fn enemy_movement_pattern_static_overrides_scene_behavior() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_behavior(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemyBehavior::Drift,
    );
    let enemy = world.spawn_enemy(0.0, 480.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(enemy, MovementPattern::Static);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(world.velocity(enemy), Some(Velocity::default()));
}

#[test]
fn enemy_movement_pattern_linear_and_move_to_point_drive_velocity() {
    let (mut scene, mut world, _, _) = playing_scene();
    let linear = world.spawn_enemy(0.0, 0.0, DEFAULT_TEXTURE_ID);
    let move_to = world.spawn_enemy(0.0, 0.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(linear, MovementPattern::Linear { vx: 3.0, vy: -4.0 });
    world.set_movement_pattern(
        move_to,
        MovementPattern::MoveToPoint {
            x: 10.0,
            y: 0.0,
            speed: 5.0,
        },
    );

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(world.velocity(linear), Some(Velocity { vx: 3.0, vy: -4.0 }));
    assert_eq!(world.velocity(move_to), Some(Velocity { vx: 5.0, vy: 0.0 }));
}

#[test]
fn enemy_movement_pattern_chase_player_reuses_navigation_waypoint() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_behavior(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemyBehavior::Static,
    );
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 25.0, y: 5.0 });
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: DEFAULT_ENEMY_SPEED,
        },
    );
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

    let velocity = world.velocity(enemy).unwrap();
    assert!(velocity.vx.abs() < 0.01);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_movement_pattern_chase_player_reuses_navigation_cache() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 25.0, y: 5.0 });
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: DEFAULT_ENEMY_SPEED,
        },
    );
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

    let cached_velocity = world.velocity(enemy).unwrap();
    assert!(cached_velocity.vx.abs() < 0.01);
    assert!(cached_velocity.vy > 0.0);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), NAVIGATION_REPATH_INTERVAL);

    let repathed_velocity = world.velocity(enemy).unwrap();
    assert!(repathed_velocity.vx > 0.0);
    assert!(repathed_velocity.vy.abs() < 0.01);
}

#[test]
fn enemy_movement_pattern_chase_player_ignores_stale_player_handle() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: DEFAULT_ENEMY_SPEED,
        },
    );
    world.despawn(player);
    world.set_raw_primary_actor_entity_for_test(Some(player));
    assert!(world.primary_actor_entity().is_none());

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(world.velocity(enemy), Some(Velocity::default()));
    assert!(scene.navigation_targets.is_empty());
}

#[test]
fn enemy_movement_pattern_chase_entity_uses_tilemap_navigation_waypoint() {
    let (mut scene, mut world, _, _) = playing_scene();
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    let target = world.spawn_enemy(25.0, 5.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 10.0,
        },
    );
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

    let velocity = world.velocity(enemy).unwrap();
    assert!(velocity.vx.abs() < 0.01);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_movement_pattern_chase_entity_does_not_reuse_player_navigation_cache() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 25.0, y: 5.0 });
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    let target = world.spawn_enemy(25.0, 5.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: DEFAULT_ENEMY_SPEED,
        },
    );
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
    let player_target_velocity = world.velocity(enemy).unwrap();
    assert!(player_target_velocity.vx.abs() < 0.01);
    assert!(player_target_velocity.vy > 0.0);

    world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: DEFAULT_ENEMY_SPEED,
        },
    );
    scene.update_enemy_velocity(
        &mut world,
        &Tilemap::default(),
        NAVIGATION_REPATH_INTERVAL * 0.5,
    );

    let entity_target_velocity = world.velocity(enemy).unwrap();
    assert!(entity_target_velocity.vx > 0.0);
    assert!(entity_target_velocity.vy.abs() < 0.01);
}

#[test]
fn enemy_movement_pattern_chase_entity_uses_generation_checked_target() {
    let (mut scene, mut world, _, _) = playing_scene();
    let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
    let target = world.spawn_enemy(25.0, 5.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 10.0,
        },
    );
    world.despawn(target);

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    assert_eq!(world.velocity(enemy), Some(Velocity::default()));
}

#[test]
fn enemy_movement_pattern_orbit_uses_pattern_radius() {
    let (mut scene, mut world, _, _) = playing_scene();
    let player = world.primary_actor_entity().unwrap();
    world.set_transform(player, Transform2D { x: 100.0, y: 100.0 });
    let enemy = world.spawn_enemy(280.0, 100.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(
        enemy,
        MovementPattern::Orbit {
            target: MovementTarget::PrimaryActor,
            speed: 80.0,
            radius: 220.0,
            radial_band: 0.0,
        },
    );

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    let velocity = world.velocity(enemy).unwrap();
    assert!(velocity.vx > 0.0);
    assert!(velocity.vy > 0.0);
}

#[test]
fn enemy_movement_pattern_topdown_input_falls_back_to_scene_behavior() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_enemy_behavior(
        &mut world,
        &mut camera,
        &mut audio_events,
        EnemyBehavior::Drift,
    );
    let enemy = world.spawn_enemy(0.0, 480.0, DEFAULT_TEXTURE_ID);
    world.set_movement_pattern(enemy, MovementPattern::TopdownInput { speed: 999.0 });

    scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

    let velocity = world.velocity(enemy).unwrap();
    assert!(velocity.vx > 0.0);
    assert!(velocity.vy.abs() < 0.01);
}
