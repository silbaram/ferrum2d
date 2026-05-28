use super::*;

#[test]
fn engine_captures_and_restores_builtin_shooter_snapshot() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.damages[bullet.id as usize] = Some(1.0);
    engine.update(0.016);
    assert_eq!(engine.score(), 1);
    assert!(!engine.world.alive[enemy.id as usize]);

    let saved_enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    let saved_bullet = engine
        .world
        .spawn_bullet(120.0, 100.0, 12.0, 0.0, DEFAULT_TEXTURE_ID);
    assert!(engine.world.alive[saved_enemy.id as usize]);
    assert!(engine.world.alive[saved_bullet.id as usize]);
    let saved_entity_count = engine.entity_count();
    engine.camera.x = 320.0;
    engine.camera.y = 240.0;

    assert!(engine.capture_shooter_snapshot());
    assert_eq!(
        engine.shooter_snapshot_header_float_len(),
        engine.shooter_snapshot_header_floats()
    );
    assert_eq!(
        engine.shooter_snapshot_header_u32_len(),
        engine.shooter_snapshot_header_u32s()
    );
    assert!(engine.shooter_snapshot_entity_float_len() >= SHOOTER_SNAPSHOT_ENTITY_FLOATS);
    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();

    engine.reset_game();
    assert_eq!(engine.score(), 0);
    set_test_particle_preset(&mut engine, 0, DEFAULT_TEXTURE_ID, 2, 1.0);
    assert_eq!(engine.spawn_particle_burst(0, 100.0, 100.0), 2);
    assert_eq!(engine.particle_count(), 2);
    assert!(engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s
    ));

    assert_eq!(engine.score(), 1);
    assert_eq!(engine.game_state(), 1);
    assert_eq!(engine.entity_count(), saved_entity_count);
    assert_eq!(engine.camera_x(), 320.0);
    assert_eq!(engine.camera_y(), 240.0);
    assert_eq!(engine.particle_count(), 0);
    assert!(engine
        .world
        .transforms
        .iter()
        .flatten()
        .any(|transform| (transform.x - 100.0).abs() < 0.001));
    assert!(engine
        .world
        .velocities
        .iter()
        .flatten()
        .any(|velocity| (velocity.vx - 12.0).abs() < 0.001));
}

#[test]
fn shooter_snapshot_capture_does_not_switch_non_shooter_scene() {
    let mut engine = Engine::new();
    engine.use_platformer_scene();
    let entity_count = engine.entity_count();

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert!(!engine.capture_shooter_snapshot());

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert_eq!(engine.entity_count(), entity_count);
    assert_eq!(engine.shooter_snapshot_header_float_len(), 0);
    assert_eq!(engine.shooter_snapshot_header_u32_len(), 0);
    assert_eq!(engine.shooter_snapshot_entity_float_len(), 0);
    assert_eq!(engine.shooter_snapshot_entity_u32_len(), 0);
}

#[test]
fn failed_shooter_snapshot_restore_preserves_active_scene() {
    let mut engine = Engine::new();
    engine.use_platformer_scene();
    let entity_count = engine.entity_count();
    let mut header_u32s = vec![0; SHOOTER_SNAPSHOT_HEADER_U32S];
    header_u32s[0] = crate::shooter_scene::SHOOTER_SNAPSHOT_VERSION;

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert!(!engine.restore_shooter_snapshot(
        vec![0.0; SHOOTER_SNAPSHOT_HEADER_FLOATS],
        header_u32s,
        Vec::new(),
        Vec::new(),
    ));

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert_eq!(engine.entity_count(), entity_count);
}
