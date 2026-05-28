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

    let player = world.player.unwrap();
    let v = world.velocities[player.id as usize].unwrap();
    let speed = (v.vx * v.vx + v.vy * v.vy).sqrt();
    assert!((speed - DEFAULT_PLAYER_SPEED).abs() < 0.01);
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
    assert!(world.player.is_some());
}

#[test]
fn player_enemy_collision_sets_game_over() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let player = world.player.unwrap();
    let pt = world.transforms[player.id as usize].unwrap();
    world.spawn_enemy(pt.x, pt.y, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

    assert_eq!(scene.game_state(), GameState::GameOver);
}

#[test]
fn player_is_clamped_inside_world_bounds() {
    let (scene, mut world, _, _) = playing_scene();
    let player = world.player.unwrap();
    world.transforms[player.id as usize] = Some(Transform2D {
        x: -100.0,
        y: 1000.0,
    });

    scene.clamp_player_to_world(&mut world);

    let transform = world.transforms[player.id as usize].unwrap();
    assert_eq!(transform.x, 18.0);
    assert_eq!(transform.y, DEFAULT_WORLD_HEIGHT - 18.0);
}

#[test]
fn firing_uses_camera_adjusted_mouse_world_position() {
    let (scene, mut world, mut camera, mut audio_events) = playing_scene();
    camera.set_viewport_size(400.0, 240.0);
    let player = world.player.unwrap();
    world.transforms[player.id as usize] = Some(Transform2D {
        x: 1000.0,
        y: 600.0,
    });
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

    let bullet_velocity = world
        .velocities
        .iter()
        .flatten()
        .find(|velocity| velocity.vx != 0.0 || velocity.vy != 0.0)
        .copied()
        .unwrap();
    assert!((bullet_velocity.vx - DEFAULT_BULLET_SPEED).abs() < 0.01);
    assert!(bullet_velocity.vy.abs() < 0.01);
}

#[test]
fn reset_game_clears_score_and_recreates_player() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.score = 42;
    if let Some(player) = world.player {
        world.despawn(player);
    }
    world.player = None;

    scene.reset_playing(&mut world, &mut camera, &mut audio_events);

    assert_eq!(scene.score(), 0);
    assert!(world.player.is_some());
    assert_eq!(count_layer(&world, CollisionLayer::Player), 1);
    assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
}
