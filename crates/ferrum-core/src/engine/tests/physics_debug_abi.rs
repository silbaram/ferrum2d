use super::*;

#[test]
fn physics_debug_lines_are_opt_in_and_report_broadphase_and_contacts() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

    engine.update(0.016);
    assert_eq!(engine.physics_debug_line_len(), 0);

    engine.set_physics_debug_lines_enabled(true);
    engine.update(0.016);

    assert_eq!(engine.physics_debug_line_len(), 11);
    assert_eq!(
        engine
            .physics_debug_collision_scratch
            .usage()
            .current_proxies,
        2
    );
    assert_eq!(
        engine
            .physics_debug_collision_scratch
            .usage()
            .collider_pairs,
        1
    );
    assert_eq!(engine.physics_debug_lines[0].x0, -5.0);
    assert_eq!(engine.physics_debug_lines[0].x1, 5.0);
    assert_eq!(engine.physics_debug_lines[8].x0, 5.0);
    assert_eq!(engine.physics_debug_lines[8].x1, 21.0);
    assert_eq!(engine.physics_debug_lines[9].y0, 0.0);
    assert_eq!(engine.physics_debug_lines[10].x0, 5.0);
    assert_eq!(engine.physics_debug_lines[10].y0, -3.0);

    engine.set_physics_debug_lines_enabled(false);
    assert_eq!(engine.physics_debug_line_len(), 0);
}

#[test]
fn physics_debug_lines_report_ccd_hit_markers() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let mover = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    engine
        .world
        .set_rigid_body(mover, RigidBody::dynamic(1.0).with_sleeping_enabled(false));
    engine
        .world
        .set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    let wall = spawn_test_body(&mut engine.world, 50.0, 0.0, CollisionLayer::Wall);
    engine.world.set_rigid_body(wall, RigidBody::static_body());
    engine.set_physics_debug_line_flags(crate::collision::PHYSICS_DEBUG_CCD);
    engine.set_physics_debug_lines_enabled(true);

    engine
        .step_rigid_bodies_with_config(1.0, 0.0, 0.0, 1, 1, 1.0, 0.0, 1.0, 0.2, 120.0, false, true);
    engine.build_physics_debug_lines();

    assert_eq!(engine.rigid_body_step_ccd_hits(), 1);
    assert_eq!(engine.physics_debug_line_len(), 3);
    assert!((engine.physics_debug_lines[0].x0 - 41.0).abs() < 0.001);
    assert!((engine.physics_debug_lines[0].x1 - 49.0).abs() < 0.001);
    assert_eq!(engine.physics_debug_lines[0].y0, 0.0);
    assert!((engine.physics_debug_lines[1].y0 + 4.0).abs() < 0.001);
    assert!((engine.physics_debug_lines[1].y1 - 4.0).abs() < 0.001);
    assert!((engine.physics_debug_lines[2].x0 - 45.0).abs() < 0.001);
    assert!((engine.physics_debug_lines[2].x1 - 57.0).abs() < 0.001);
}

#[test]
fn physics_debug_line_abi_matches_float_buffer() {
    assert_eq!(crate::physics_debug_line_floats(), 8);
    assert_eq!(crate::physics_debug_line_bytes(), 32);
}

#[test]
fn physics_raycast_hit_abi_matches_mixed_buffer() {
    assert_eq!(crate::physics_raycast_hit_bytes(), 28);
}

#[test]
fn physics_tile_shape_cast_hit_abi_matches_mixed_buffer() {
    assert_eq!(crate::physics_tile_shape_cast_hit_bytes(), 28);
    assert_eq!(crate::physics_tile_contact_hit_bytes(), 28);
    assert_eq!(crate::physics_tile_manifold_hit_bytes(), 48);
}

#[test]
fn physics_body_contact_and_manifold_hit_abi_matches_mixed_buffer() {
    assert_eq!(crate::physics_body_contact_hit_bytes(), 36);
    assert_eq!(crate::physics_body_manifold_hit_bytes(), 56);
}

#[test]
fn physics_rigid_contact_impulse_hit_abi_matches_mixed_buffer() {
    assert_eq!(crate::physics_rigid_contact_impulse_hit_bytes(), 40);
}
