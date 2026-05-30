use super::*;

#[test]
fn engine_collision_events_report_enter_stay_and_exit() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    engine.set_collision_lifecycle_events_enabled(true);
    let a = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    let b = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

    engine.update(0.016);
    assert_eq!(engine.collision_enter_count(), 1);
    assert_eq!(engine.collision_event_len(), 1);
    assert_eq!(engine.physics_collision_pairs(), 1);
    assert_eq!(engine.physics_collision_solid_pairs(), 1);
    assert_eq!(engine.physics_collision_trigger_pairs(), 0);
    assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_ENTER);

    engine.update(0.016);
    assert_eq!(engine.collision_stay_count(), 1);
    assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_STAY);

    engine
        .world
        .set_transform(b, Transform2D { x: 40.0, y: 0.0 });
    engine.update(0.016);
    assert_eq!(engine.collision_exit_count(), 1);
    assert_eq!(engine.physics_collision_pairs(), 0);
    assert_eq!(engine.physics_collision_solid_pairs(), 0);
    assert_eq!(engine.physics_collision_trigger_pairs(), 0);
    assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_EXIT);
    assert_eq!(engine.collision_events[0].a_id, a.id.min(b.id));
}

#[test]
fn engine_collision_events_report_trigger_lifecycle_counts() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    engine.set_collision_lifecycle_events_enabled(true);
    let sensor =
        spawn_test_body_with_trigger(&mut engine.world, 0.0, 0.0, CollisionLayer::Player, true);
    let actor = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

    engine.update(0.016);
    assert_eq!(engine.collision_enter_count(), 0);
    assert_eq!(engine.collision_trigger_enter_count(), 1);
    assert_eq!(engine.physics_collision_pairs(), 1);
    assert_eq!(engine.physics_collision_solid_pairs(), 0);
    assert_eq!(engine.physics_collision_trigger_pairs(), 1);
    assert_eq!(
        engine.collision_events[0].kind,
        COLLISION_EVENT_TRIGGER_ENTER
    );

    engine.update(0.016);
    assert_eq!(engine.collision_stay_count(), 0);
    assert_eq!(engine.collision_trigger_stay_count(), 1);
    assert_eq!(
        engine.collision_events[0].kind,
        COLLISION_EVENT_TRIGGER_STAY
    );

    engine
        .world
        .set_transform(actor, Transform2D { x: 40.0, y: 0.0 });
    engine.update(0.016);
    assert_eq!(engine.collision_exit_count(), 0);
    assert_eq!(engine.collision_trigger_exit_count(), 1);
    assert_eq!(engine.physics_collision_pairs(), 0);
    assert_eq!(engine.physics_collision_solid_pairs(), 0);
    assert_eq!(engine.physics_collision_trigger_pairs(), 0);
    assert_eq!(
        engine.collision_events[0].kind,
        COLLISION_EVENT_TRIGGER_EXIT
    );
    assert_eq!(engine.collision_events[0].a_id, sensor.id.min(actor.id));
}

#[test]
fn engine_collision_lifecycle_events_are_opt_in() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

    engine.update(0.016);

    assert_eq!(engine.collision_enter_count(), 0);
    assert_eq!(engine.collision_event_len(), 0);
    assert_eq!(engine.physics_collision_pairs(), 0);

    engine.set_collision_lifecycle_events_enabled(true);
    engine.update(0.016);

    assert_eq!(engine.collision_enter_count(), 1);
    assert_eq!(engine.collision_event_len(), 1);
}

#[test]
fn engine_collision_events_include_shooter_hit_before_despawn() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.damages[bullet.id as usize] = Some(2.5);

    engine.update(0.016);

    assert_eq!(engine.collision_hit_count(), 1);
    let hit = engine
        .collision_events
        .iter()
        .find(|event| event.kind == COLLISION_EVENT_HIT)
        .expect("shooter hit should be recorded before despawn");
    assert_eq!(hit.a_id, bullet.id);
    assert_eq!(hit.a_generation, bullet.generation);
    assert_eq!(hit.b_id, enemy.id);
    assert_eq!(hit.b_generation, enemy.generation);
    assert_eq!(hit.damage(), 2.5);
}

#[test]
fn shooter_hit_particle_preset_spawns_on_bullet_enemy_hit() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    set_test_particle_preset(&mut engine, 3, 88, 2, 1.0);
    engine.set_shooter_hit_particle_preset(3);
    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.damages[bullet.id as usize] = Some(2.5);

    engine.update(0.016);

    assert_eq!(engine.collision_hit_count(), 1);
    assert_eq!(engine.particle_count(), 2);
    assert!(engine
        .render_commands
        .iter()
        .any(|command| command.texture_id == 88.0));
    assert!(!engine.world.alive[bullet.id as usize]);
    assert!(!engine.world.alive[enemy.id as usize]);
}

#[test]
fn shooter_hit_particles_require_scene_preset_binding() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    set_test_particle_preset(&mut engine, 3, 88, 2, 1.0);
    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.damages[bullet.id as usize] = Some(2.5);

    engine.update(0.016);

    assert_eq!(engine.collision_hit_count(), 1);
    assert_eq!(engine.particle_count(), 0);
    assert!(!engine.world.alive[enemy.id as usize]);
}

#[test]
fn shooter_non_lethal_enemy_hit_starts_tint_tween() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let enemy_index = enemy.id as usize;
    engine.world.healths[enemy_index] = Some(2.0);
    let original = engine.world.sprites[enemy_index].unwrap();
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.damages[bullet.id as usize] = Some(1.0);

    engine.update(0.0);

    let flashed = engine.world.sprites[enemy_index].unwrap();
    assert!(engine.world.alive[enemy_index]);
    assert_eq!(engine.tweens.tween_count(), 1);
    assert!(flashed.r >= original.r);
    assert!(flashed.g > original.g);
    assert!(flashed.b > original.b);
    assert!(flashed.a > original.a);

    engine.update(0.2);

    let restored = engine.world.sprites[enemy_index].unwrap();
    assert_eq!(restored.r, original.r);
    assert_eq!(restored.g, original.g);
    assert_eq!(restored.b, original.b);
    assert_eq!(restored.a, original.a);
    assert_eq!(engine.tweens.tween_count(), 0);
}

#[test]
fn shooter_lethal_enemy_hit_does_not_start_tint_tween() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let enemy_index = enemy.id as usize;
    engine.world.healths[enemy_index] = Some(1.0);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.damages[bullet.id as usize] = Some(1.0);

    engine.update(0.0);

    assert!(!engine.world.alive[enemy_index]);
    assert_eq!(engine.tweens.tween_count(), 0);
}

#[test]
fn collision_event_abi_includes_damage_payload_slot() {
    assert_eq!(crate::collision_event_u32s(), 6);
    assert_eq!(crate::collision_event_bytes(), 24);
}
