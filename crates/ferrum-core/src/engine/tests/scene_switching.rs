use super::*;

#[test]
fn reset_game_clears_score_and_recreates_player() {
    let mut engine = Engine::new();
    engine.scene.update(
        &mut engine.world,
        &mut engine.camera,
        InputState {
            space: 1,
            ..InputState::default()
        },
        &mut engine.audio_events,
        &Tilemap::default(),
        0.016,
    );
    engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    engine.reset_game();

    assert_eq!(engine.score(), 0);
    assert!(engine.world.player.is_some());
    assert_eq!(count_layer(&engine, CollisionLayer::Player), 1);
    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 0);
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
    let brick_transform = engine.world.transforms[brick.id as usize].expect("brick has transform");
    let brick_collider = engine.world.colliders[brick.id as usize].expect("brick has collider");
    let ball_collider = engine.world.colliders[ball.id as usize].expect("ball has collider");
    engine.world.transforms[ball.id as usize] = Some(Transform2D {
        x: brick_transform.x,
        y: brick_transform.y + brick_collider.half_height + ball_collider.half_height + 1.0,
    });
    engine.world.velocities[ball.id as usize] = Some(crate::components::Velocity {
        vx: 0.0,
        vy: -285.0,
    });

    engine.update(0.1);

    assert_eq!(engine.collision_hit_count(), 1);
    assert_eq!(engine.particle_count(), 10);
    assert!(!engine.world.alive[brick.id as usize]);
    assert!(engine.render_commands.len() > engine.entity_count());
    assert!(engine
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
    assert_eq!(engine.sprite_count(), 8);
    assert_eq!(count_layer(&engine, CollisionLayer::Wall), 6);
    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);

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
    assert!(engine.render_commands.len() > engine.entity_count());
    assert!(engine
        .render_commands
        .iter()
        .any(|command| command.width < 9.0));
}
