use super::*;

#[test]
fn resolved_shooter_config_applies_all_values_with_one_call() {
    let mut engine = Engine::new();

    engine.set_shooter_resolved_config(
        3200.0, 1800.0, 240.0, 120.0, 0.75, 640.0, 0.08, 2.4, 40.0, 44.0, 30.0, 34.0, 10.0, 12.0,
        4, 12.0, 3, 9.0, 2, 18.0, 2, 2, 4.0, 2.0, 9, 220.0, 18.0,
    );

    let config = engine.scene.config();
    assert_eq!(config.world_width, 3200.0);
    assert_eq!(config.world_height, 1800.0);
    assert_eq!(config.player_speed, 240.0);
    assert_eq!(config.enemy_speed, 120.0);
    assert_eq!(config.enemy_spawn_interval, 0.75);
    assert_eq!(config.bullet_speed, 640.0);
    assert_eq!(config.fire_cooldown, 0.08);
    assert_eq!(config.bullet_lifetime, 2.4);
    assert_eq!(config.player_template.sprite_width, 40.0);
    assert_eq!(config.player_template.sprite_height, 44.0);
    assert_eq!(config.enemy_template.sprite_width, 30.0);
    assert_eq!(config.enemy_template.sprite_height, 34.0);
    assert_eq!(config.bullet_template.sprite_width, 10.0);
    assert_eq!(config.bullet_template.sprite_height, 12.0);
    assert_eq!(
        config.player_template.animation.unwrap().idle.frame_count,
        4
    );
    assert_eq!(
        config
            .player_template
            .animation
            .unwrap()
            .idle
            .frames_per_second,
        12.0
    );
    assert_eq!(config.enemy_template.animation.unwrap().idle.frame_count, 3);
    assert_eq!(
        config
            .enemy_template
            .animation
            .unwrap()
            .idle
            .frames_per_second,
        9.0
    );
    assert_eq!(
        config.bullet_template.animation.unwrap().idle.frame_count,
        2
    );
    assert_eq!(
        config
            .bullet_template
            .animation
            .unwrap()
            .idle
            .frames_per_second,
        18.0
    );
    assert_eq!(config.enemy_behavior, EnemyBehavior::Static);
    assert_eq!(config.enemy_spawn_pattern, EnemySpawnPattern::Center);
    assert_eq!(config.enemy_health, 4.0);
    assert_eq!(config.bullet_damage, 2.0);
    assert_eq!(config.score_reward, 9);
    assert_eq!(config.orbit_radius, 220.0);
    assert_eq!(config.orbit_radial_band, 18.0);
}

#[test]
fn shooter_prefab_collider_api_updates_template_and_existing_entities() {
    let mut engine = Engine::new();

    assert!(engine.set_shooter_prefab_collider(
        0, 12.0, 14.0, 2.0, -3.0, false, false, true, 0.2, 0.8, 2.0, 0.0, 1.4, 0.7, 0.6, 0.5, 0.4,
    ));

    let config = engine.scene.config();
    assert_eq!(config.player_template.collider_half_width, 12.0);
    assert_eq!(config.player_template.collider_half_height, 14.0);
    assert_eq!(config.player_template.collider_offset_x, 2.0);
    assert_eq!(config.player_template.collider_offset_y, -3.0);
    assert!(!config.player_template.collider_enabled);
    assert!(!config.player_template.collider_is_trigger);
    let player = engine.world.player.unwrap();
    let collider = engine.world.colliders[player.id as usize].unwrap();
    assert_eq!(collider.half_width, 12.0);
    assert_eq!(collider.offset_x, 2.0);
    assert!(!collider.enabled);
    assert_eq!(
        engine.world.collider_material(player).unwrap().friction,
        0.8
    );

    assert!(!engine.set_shooter_prefab_collider(
        0,
        f32::NAN,
        14.0,
        2.0,
        -3.0,
        false,
        false,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
    assert!(!engine.set_shooter_prefab_collider(
        99, 12.0, 14.0, 2.0, -3.0, false, false, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0,
        1.0,
    ));
}

#[test]
fn shooter_prefab_shape_collider_apis_update_templates_and_entities() {
    let mut engine = Engine::new();

    assert!(engine.set_shooter_prefab_circle_collider(
        0, 11.0, 1.0, -2.0, true, true, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0,
    ));
    let player = engine.world.player.unwrap();
    let player_collider = engine.world.circle_colliders[player.id as usize].unwrap();
    assert_eq!(player_collider.radius, 11.0);
    assert_eq!(player_collider.offset_x, 1.0);
    assert_eq!(
        engine.world.collider_layer_at(player.id as usize),
        Some(CollisionLayer::Player)
    );

    assert!(engine.set_shooter_prefab_capsule_collider(
        1, -5.0, 0.0, 5.0, 0.0, 3.0, 0.0, 2.0, true, true, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    ));
    let enemy = engine.world.spawn_enemy_from_template(
        100.0,
        100.0,
        DEFAULT_TEXTURE_ID,
        engine.scene.config().enemy_template,
        1.0,
        1,
    );
    assert_eq!(
        engine.world.capsule_colliders[enemy.id as usize]
            .unwrap()
            .radius,
        3.0
    );

    assert!(engine.set_shooter_prefab_oriented_box_collider(
        1, 7.0, 4.0, 0.3, 1.0, 1.0, true, false, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0,
        1.0,
    ));
    let enemy_collider = engine.world.oriented_box_colliders[enemy.id as usize].unwrap();
    assert_eq!(enemy_collider.half_width, 7.0);
    assert_eq!(enemy_collider.rotation_radians, 0.3);
    assert!(!enemy_collider.is_trigger);

    assert!(engine.set_shooter_prefab_convex_polygon_collider(
        2,
        vec![-2.0, -2.0, 2.0, -2.0, 0.0, 2.0],
        0.1,
        -1.0,
        0.5,
        true,
        true,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
    let bullet = engine.world.spawn_bullet_from_template(
        Transform2D { x: 0.0, y: 0.0 },
        Velocity { vx: 0.0, vy: 0.0 },
        DEFAULT_TEXTURE_ID,
        1.0,
        engine.scene.config().bullet_template,
        1.0,
    );
    let polygon = engine.world.convex_polygon_colliders[bullet.id as usize].unwrap();
    assert_eq!(polygon.vertex_count, 3);
    assert_eq!(polygon.offset_x, -1.0);
    assert_eq!(polygon.rotation_radians, 0.1);

    assert!(!engine.set_shooter_prefab_circle_collider(
        0,
        f32::NAN,
        0.0,
        0.0,
        true,
        true,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
    assert!(!engine.set_shooter_prefab_convex_polygon_collider(
        2,
        vec![0.0, 0.0, 1.0, 0.0],
        0.0,
        0.0,
        0.0,
        true,
        true,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
}
