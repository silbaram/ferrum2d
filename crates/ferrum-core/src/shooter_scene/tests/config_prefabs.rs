use super::*;

#[test]
fn config_changes_player_speed_and_world_bounds() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_config(
        &mut world,
        &mut camera,
        &mut audio_events,
        ShooterConfig::from_values(3200.0, 1800.0, 240.0, 72.0, 1.0, 360.0, 0.12, 1.8),
    );
    scene.game_state = GameState::Playing;

    scene.apply_player_input(
        &mut world,
        &camera,
        InputState {
            d: 1,
            ..InputState::default()
        },
        &mut audio_events,
    );

    let player = world.player_entity().unwrap();
    assert_eq!(world.transform(player).unwrap().x, 1600.0);
    assert_eq!(world.velocity(player).unwrap().vx, 240.0);
}

#[test]
fn config_changes_bullet_lifetime_and_speed() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let mut config_camera = Camera2D::new(800.0, 480.0);
    scene.set_config(
        &mut world,
        &mut config_camera,
        &mut audio_events,
        ShooterConfig::from_values(1600.0, 960.0, 180.0, 72.0, 1.0, 500.0, 0.12, 0.25),
    );
    let player = world.player_entity().unwrap();

    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState {
            mouse_x: 800.0,
            mouse_y: 240.0,
            ..InputState::default()
        },
        player,
        &mut audio_events,
    );

    let bullet_index = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| {
            world
                .velocity_at_index(index)
                .is_some_and(|velocity| velocity.vx != 0.0 || velocity.vy != 0.0)
        })
        .unwrap();
    assert!((world.velocity_at_index(bullet_index).unwrap().vx - 500.0).abs() < 0.01);

    scene.update_bullets(&mut world, 0.26);

    assert!(!world.is_alive_index(bullet_index));
}

#[test]
fn prefab_config_changes_spawned_sprite_and_collider_sizes() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_prefabs(
        &mut world,
        &mut camera,
        &mut audio_events,
        48.0,
        40.0,
        30.0,
        28.0,
        12.0,
        10.0,
    );
    scene.game_state = GameState::Playing;
    scene.enemy_spawn_timer = 0.0;

    let player = world.player_entity().unwrap();
    let player_sprite = world.sprite_at_index(player.id as usize).unwrap();
    assert_eq!(player_sprite.width, 48.0);
    assert_eq!(player_sprite.height, 40.0);
    let player_collider = world.collider(player).unwrap();
    assert_eq!(player_collider.half_width, 24.0);
    assert_eq!(player_collider.half_height, 20.0);

    scene.spawn_enemy_if_needed(&mut world);
    let enemy = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Enemy))
        .unwrap();
    let enemy_sprite = world.sprite_at_index(enemy).unwrap();
    assert_eq!(enemy_sprite.width, 30.0);
    assert_eq!(enemy_sprite.height, 28.0);

    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState {
            mouse_x: 800.0,
            mouse_y: 240.0,
            ..InputState::default()
        },
        player,
        &mut audio_events,
    );
    let bullet = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Bullet))
        .unwrap();
    let bullet_sprite = world.sprite_at_index(bullet).unwrap();
    assert_eq!(bullet_sprite.width, 12.0);
    assert_eq!(bullet_sprite.height, 10.0);
    let bullet_entity = world
        .entity_at_index(bullet)
        .expect("test bullet entity should exist");
    let bullet_collider = world.collider(bullet_entity).unwrap();
    assert_eq!(bullet_collider.half_width, 6.0);
    assert_eq!(bullet_collider.half_height, 5.0);
}

#[test]
fn prefab_collider_config_updates_spawned_and_existing_colliders() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let material =
        PhysicsMaterial::new(0.2, 0.8).with_surface_velocity(Velocity { vx: 2.0, vy: 0.0 });

    assert!(scene.set_prefab_collider(
        &mut world,
        0,
        EntityTemplateCollider::aabb(12.0, 14.0, 2.0, -3.0, false, false, Some(material)),
    ));

    let player = world.player_entity().unwrap();
    let player_collider = world.collider(player).unwrap();
    assert_eq!(player_collider.half_width, 12.0);
    assert_eq!(player_collider.half_height, 14.0);
    assert_eq!(player_collider.offset_x, 2.0);
    assert_eq!(player_collider.offset_y, -3.0);
    assert!(!player_collider.enabled);
    assert!(!player_collider.is_trigger);
    assert_eq!(world.collider_material(player), Some(material));

    assert!(scene.set_prefab_collider(
        &mut world,
        1,
        EntityTemplateCollider::aabb(9.0, 11.0, 1.0, 0.0, true, true, None),
    ));
    scene.game_state = GameState::Playing;
    scene.enemy_spawn_timer = 0.0;
    scene.spawn_enemy_if_needed(&mut world);
    let enemy = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Enemy))
        .unwrap();
    let enemy_entity = world
        .entity_at_index(enemy)
        .expect("test enemy entity should exist");
    let enemy_collider = world.collider(enemy_entity).unwrap();
    assert_eq!(enemy_collider.half_width, 9.0);
    assert_eq!(enemy_collider.offset_x, 1.0);
    assert_eq!(world.collider_material(enemy_entity), None);

    assert!(scene.set_prefab_collider(
        &mut world,
        2,
        EntityTemplateCollider::aabb(3.0, 5.0, -1.0, 1.0, true, true, Some(material)),
    ));
    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState {
            mouse_x: 800.0,
            mouse_y: 240.0,
            ..InputState::default()
        },
        player,
        &mut audio_events,
    );
    let bullet = world
        .alive_indices()
        .iter()
        .copied()
        .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Bullet))
        .unwrap();
    let bullet_entity = world
        .entity_at_index(bullet)
        .expect("test bullet entity should exist");
    let bullet_collider = world.collider(bullet_entity).unwrap();
    assert_eq!(bullet_collider.half_width, 3.0);
    assert_eq!(bullet_collider.half_height, 5.0);
    assert_eq!(bullet_collider.offset_x, -1.0);
    assert_eq!(world.collider_material(bullet_entity), Some(material));
}

#[test]
fn prefab_collider_config_supports_non_aabb_shapes() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.player_entity().unwrap();
    assert!(scene.set_prefab_collider(
        &mut world,
        0,
        EntityTemplateCollider {
            shape: EntityTemplateColliderShape::Circle { radius: 13.0 },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: 2.0,
            offset_y: -1.0,
            enabled: true,
            is_trigger: true,
            material: None,
        },
    ));
    let player_collider = world.circle_collider(player).unwrap();
    assert_eq!(player_collider.radius, 13.0);
    assert_eq!(player_collider.offset_x, 2.0);
    assert_eq!(
        world.collider_layer_at(player.id as usize),
        Some(CollisionLayer::Player)
    );

    assert!(scene.set_prefab_collider(
        &mut world,
        1,
        EntityTemplateCollider {
            shape: EntityTemplateColliderShape::Capsule {
                start_x: -4.0,
                start_y: 0.0,
                end_x: 4.0,
                end_y: 0.0,
                radius: 3.0,
            },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: 0.0,
            offset_y: 1.0,
            enabled: true,
            is_trigger: true,
            material: None,
        },
    ));
    scene.game_state = GameState::Playing;
    scene.enemy_spawn_timer = 0.0;
    scene.spawn_enemy_if_needed(&mut world);
    let enemy = (0..world.entity_capacity())
        .find(|index| world.collider_layer_at(*index) == Some(CollisionLayer::Enemy))
        .unwrap();
    let enemy_entity = world
        .entity_at_index(enemy)
        .expect("test enemy entity should exist");
    assert_eq!(world.capsule_collider(enemy_entity).unwrap().radius, 3.0);

    assert!(scene.set_prefab_collider(
        &mut world,
        1,
        EntityTemplateCollider {
            shape: EntityTemplateColliderShape::OrientedBox {
                half_width: 7.0,
                half_height: 5.0,
                rotation_radians: 0.25,
            },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: 1.0,
            offset_y: 2.0,
            enabled: true,
            is_trigger: false,
            material: None,
        },
    ));
    let enemy_box = world.oriented_box_collider(enemy_entity).unwrap();
    assert_eq!(enemy_box.half_width, 7.0);
    assert_eq!(enemy_box.rotation_radians, 0.25);
    assert!(!enemy_box.is_trigger);

    let mut vertices =
        [Transform2D { x: 0.0, y: 0.0 }; crate::components::MAX_CONVEX_POLYGON_VERTICES];
    vertices[0] = Transform2D { x: -3.0, y: -2.0 };
    vertices[1] = Transform2D { x: 3.0, y: -2.0 };
    vertices[2] = Transform2D { x: 0.0, y: 3.0 };
    assert!(scene.set_prefab_collider(
        &mut world,
        2,
        EntityTemplateCollider {
            shape: EntityTemplateColliderShape::ConvexPolygon {
                vertices,
                vertex_count: 3,
                rotation_radians: 0.1,
            },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: -1.0,
            offset_y: 0.5,
            enabled: true,
            is_trigger: true,
            material: None,
        },
    ));
    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState {
            mouse_x: 800.0,
            mouse_y: 240.0,
            ..InputState::default()
        },
        player,
        &mut audio_events,
    );
    let bullet = (0..world.entity_capacity())
        .find(|index| world.collider_layer_at(*index) == Some(CollisionLayer::Bullet))
        .unwrap();
    let bullet_entity = world
        .entity_at_index(bullet)
        .expect("test bullet entity should exist");
    let bullet_polygon = world.convex_polygon_collider(bullet_entity).unwrap();
    assert_eq!(bullet_polygon.vertex_count, 3);
    assert_eq!(bullet_polygon.offset_x, -1.0);
    assert_eq!(bullet_polygon.rotation_radians, 0.1);
}

#[test]
fn prefab_collider_config_falls_back_for_invalid_non_aabb_shapes() {
    let (mut scene, mut world, camera, mut audio_events) = playing_scene();
    let player = world.player_entity().unwrap();
    let original_player_collider = world.collider(player).unwrap();

    assert!(scene.set_prefab_collider(
        &mut world,
        0,
        EntityTemplateCollider {
            shape: EntityTemplateColliderShape::Circle { radius: f32::NAN },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: f32::NAN,
            offset_y: f32::INFINITY,
            enabled: true,
            is_trigger: true,
            material: None,
        },
    ));

    let config = scene.config();
    match config.player_template.collider_shape {
        EntityTemplateColliderShape::Aabb {
            half_width,
            half_height,
        } => {
            assert_eq!(half_width, original_player_collider.half_width);
            assert_eq!(half_height, original_player_collider.half_height);
        }
        _ => panic!("invalid circle prefab collider should fall back to the default AABB shape"),
    }
    assert!(world.circle_collider(player).is_none());
    let player_collider = world.collider(player).unwrap();
    assert_eq!(player_collider.offset_x, original_player_collider.offset_x);
    assert_eq!(player_collider.offset_y, original_player_collider.offset_y);

    let mut vertices =
        [Transform2D { x: 0.0, y: 0.0 }; crate::components::MAX_CONVEX_POLYGON_VERTICES];
    vertices[0] = Transform2D {
        x: f32::NAN,
        y: -2.0,
    };
    vertices[1] = Transform2D { x: 2.0, y: -2.0 };
    vertices[2] = Transform2D { x: 0.0, y: 2.0 };
    assert!(scene.set_prefab_collider(
        &mut world,
        2,
        EntityTemplateCollider {
            shape: EntityTemplateColliderShape::ConvexPolygon {
                vertices,
                vertex_count: 3,
                rotation_radians: 0.0,
            },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: f32::INFINITY,
            offset_y: f32::NAN,
            enabled: true,
            is_trigger: true,
            material: None,
        },
    ));
    scene.fire_bullet_toward_mouse(
        &mut world,
        &camera,
        InputState {
            mouse_x: 800.0,
            mouse_y: 240.0,
            ..InputState::default()
        },
        player,
        &mut audio_events,
    );

    let bullet = (0..world.entity_capacity())
        .find(|index| world.collider_layer_at(*index) == Some(CollisionLayer::Bullet))
        .unwrap();
    let bullet_entity = world
        .entity_at_index(bullet)
        .expect("test bullet entity should exist");
    assert!(world.convex_polygon_collider(bullet_entity).is_none());
    let bullet_collider = world.collider(bullet_entity).unwrap();
    assert_eq!(bullet_collider.half_width, 4.0);
    assert_eq!(bullet_collider.half_height, 4.0);
    assert_eq!(bullet_collider.offset_x, 0.0);
    assert_eq!(bullet_collider.offset_y, 0.0);
}

#[test]
fn configured_texture_ids_are_written_to_existing_sprites() {
    let (mut scene, mut world, _, _) = playing_scene();
    world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    world.spawn_bullet(120.0, 100.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);

    scene.set_texture_ids(&mut world, 1, 2, 3);

    let texture_ids: Vec<u32> = world
        .alive_indices()
        .iter()
        .filter_map(|&index| world.sprite_at_index(index))
        .map(|sprite| sprite.texture_id)
        .collect();
    assert!(texture_ids.contains(&1));
    assert!(texture_ids.contains(&2));
    assert!(texture_ids.contains(&3));
}
