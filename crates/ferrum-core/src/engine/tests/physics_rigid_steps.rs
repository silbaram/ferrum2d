use super::*;

#[test]
fn engine_step_rigid_bodies_exposes_stats_for_wasm() {
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

    engine.step_rigid_bodies(1.0 / 60.0);

    assert_eq!(engine.rigid_body_step_substeps(), 1);
    assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);
    assert!(engine.rigid_body_step_contact_checks() > 0);
    assert!(engine.rigid_body_step_velocity_impulses() > 0);
    assert_eq!(
        engine.query_rigid_contact_impulses(),
        engine.rigid_body_step_contact_cache_entries()
    );
}

#[test]
fn engine_step_rigid_bodies_with_config_uses_wasm_options() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let body = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    engine
        .world
        .set_rigid_body(body, RigidBody::dynamic(1.0).with_sleeping_enabled(false));

    engine.step_rigid_bodies_with_config(
        0.5, 10.0, 0.0, 1, 1, 0.8, 0.01, 1.0, 0.2, 120.0, false, true,
    );

    let velocity = engine
        .world
        .velocity(body)
        .expect("rigid body should have a velocity component");
    assert!(velocity.vx > 0.0);
    assert_eq!(engine.rigid_body_step_substeps(), 1);
    assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);
    assert_eq!(engine.rigid_body_step_contact_checks(), 0);
}

#[test]
fn engine_auto_rigid_body_step_runs_inside_update() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let body = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    engine
        .world
        .set_rigid_body(body, RigidBody::dynamic(1.0).with_sleeping_enabled(false));

    engine.configure_auto_rigid_body_step(
        true, 0.0, 20.0, 1, 1, 0.8, 0.01, 1.0, 0.2, 120.0, false, true,
    );
    engine.update(0.5);

    let velocity = engine
        .world
        .velocity(body)
        .expect("auto-stepped rigid body should keep velocity");
    assert!(velocity.vy > 0.0);
    assert_eq!(engine.rigid_body_step_substeps(), 1);
    assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);

    engine.configure_auto_rigid_body_step(
        false, 0.0, 20.0, 1, 1, 0.8, 0.01, 1.0, 0.2, 120.0, false, true,
    );
    assert_eq!(engine.rigid_body_step_dynamic_bodies(), 0);
}
