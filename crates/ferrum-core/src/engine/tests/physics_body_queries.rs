use super::*;

#[test]
fn engine_query_nearest_body_stores_scalar_result_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    let enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);

    assert!(engine.query_nearest_body(0.0, 0.0, 100.0, CollisionMask::ENEMY.bits));

    assert_eq!(engine.physics_query_entity_id(), enemy.id);
    assert_eq!(engine.physics_query_entity_generation(), enemy.generation);
    assert_eq!(engine.physics_query_point_x(), 15.0);
    assert_eq!(engine.physics_query_point_y(), 0.0);
    assert_eq!(engine.physics_query_distance(), 15.0);

    assert!(!engine.query_nearest_body(0.0, 0.0, 1.0, CollisionMask::ENEMY.bits));
    assert_eq!(engine.physics_query_entity_id(), 0);
    assert_eq!(engine.physics_query_distance(), 0.0);
}

#[test]
fn engine_query_body_contacts_and_manifolds_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let player = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    let enemy = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);
    spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);

    let contact_count =
        engine.query_body_contacts(CollisionMask::PLAYER.bits, CollisionMask::ENEMY.bits);

    assert_eq!(contact_count, 1);
    assert_eq!(engine.physics_body_contact_hit_len(), 1);
    assert_eq!(
        engine.physics_body_contact_hits,
        vec![PhysicsBodyContactHit {
            a_entity_id: player.id,
            a_entity_generation: player.generation,
            b_entity_id: enemy.id,
            b_entity_generation: enemy.generation,
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 2.0,
            point_x: 5.0,
            point_y: 0.0,
        }]
    );
    assert_eq!(
        engine.physics_body_contact_hit_ptr(),
        engine.physics_body_contact_hits.as_ptr()
    );

    let manifold_count =
        engine.query_body_manifolds(CollisionMask::ENEMY.bits, CollisionMask::PLAYER.bits);

    assert_eq!(manifold_count, 1);
    assert_eq!(engine.physics_body_manifold_hit_len(), 1);
    assert_eq!(engine.physics_body_manifold_hits[0].a_entity_id, enemy.id);
    assert_eq!(engine.physics_body_manifold_hits[0].b_entity_id, player.id);
    assert_eq!(engine.physics_body_manifold_hits[0].point_count, 2);
    assert_eq!(
        engine.physics_body_manifold_hit_ptr(),
        engine.physics_body_manifold_hits.as_ptr()
    );

    let miss_count =
        engine.query_body_contacts(CollisionMask::BULLET.bits, CollisionMask::ENEMY.bits);

    assert_eq!(miss_count, 0);
    assert!(engine.physics_body_contact_hits.is_empty());
}

#[test]
fn engine_query_rigid_contact_impulses_writes_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let body = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    let ground = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Wall);
    engine.world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 10.0, 10.0).with_sleeping_enabled(false),
    );
    engine
        .world
        .set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    engine
        .world
        .set_rigid_body(ground, RigidBody::static_body());

    let stats = PhysicsSystem::step_rigid_bodies(&mut engine.world, 1.0 / 60.0);
    let impulse_count = engine.query_rigid_contact_impulses();

    assert_eq!(impulse_count, stats.contact_cache_entries);
    assert_eq!(
        engine.physics_rigid_contact_impulse_hit_len(),
        impulse_count as usize
    );
    assert_eq!(
        engine.physics_rigid_contact_impulse_hit_ptr(),
        engine.physics_rigid_contact_impulse_hits.as_ptr()
    );
    assert!(engine
        .physics_rigid_contact_impulse_hits
        .iter()
        .any(|hit| hit.a_entity_id == body.id
            && hit.a_entity_generation == body.generation
            && hit.b_entity_id == ground.id
            && hit.b_entity_generation == ground.generation
            && hit.normal_impulse > 0.0));
}
