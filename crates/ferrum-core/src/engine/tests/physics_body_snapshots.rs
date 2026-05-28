use super::*;

#[test]
fn engine_spawn_physics_aabb_body_authoring_steps_and_queries_snapshot() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();

    assert!(engine.spawn_physics_aabb_body(
        0.0,
        0.0,
        5.0,
        5.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        true,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::WALL.bits,
        false,
        true,
        true,
        false,
    ));
    let body_id = engine.physics_entity_id();
    let body_generation = engine.physics_entity_generation();
    assert_eq!(engine.physics_entity_body_type(), PHYSICS_BODY_TYPE_DYNAMIC);
    assert!(engine.set_physics_body_velocity(body_id, body_generation, 10.0, 0.0));

    assert!(engine.spawn_physics_aabb_body(
        8.0,
        0.0,
        5.0,
        5.0,
        PHYSICS_BODY_TYPE_STATIC,
        1.0,
        true,
        PHYSICS_LAYER_WALL,
        CollisionMask::WALL.bits,
        CollisionMask::PLAYER.bits,
        false,
        true,
        true,
        false,
    ));

    engine.step_rigid_bodies(1.0 / 60.0);

    assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);
    assert!(engine.rigid_body_step_contact_checks() > 0);
    assert!(engine.rigid_body_step_velocity_impulses() > 0);
    assert!(engine.query_physics_entity(body_id, body_generation));
    assert_eq!(engine.physics_entity_id(), body_id);
    assert_eq!(engine.physics_entity_generation(), body_generation);
    assert!(engine.physics_entity_velocity_x() < 10.0);
}

#[test]
fn engine_queries_compound_collider_snapshot_for_replay_state() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();

    assert!(engine.spawn_physics_aabb_body(
        0.0,
        0.0,
        5.0,
        5.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        true,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::WALL.bits,
        false,
        true,
        true,
        false,
    ));
    let body_id = engine.physics_entity_id();
    let body_generation = engine.physics_entity_generation();
    assert_eq!(
        engine.physics_body_collider_count(body_id, body_generation),
        1
    );

    assert!(engine.add_physics_circle_collider(
        body_id,
        body_generation,
        3.0,
        1.0,
        2.0,
        PHYSICS_LAYER_ENEMY,
        CollisionMask::ENEMY.bits,
        CollisionMask::PLAYER.bits,
        true,
        false,
    ));
    assert_eq!(
        engine.physics_body_collider_count(body_id, body_generation),
        2
    );
    assert!(engine.set_physics_compound_collider_material(
        body_id,
        body_generation,
        1,
        0.25,
        0.75,
        2.0,
        -1.0,
        1.5,
        0.5,
        0.4,
        0.3,
        0.2,
    ));

    assert!(engine.query_physics_body_collider(body_id, body_generation, 1));
    assert_eq!(engine.physics_body_collider_index(), 1);
    assert_eq!(
        engine.physics_body_collider_type(),
        PHYSICS_COLLIDER_TYPE_CIRCLE
    );
    assert!(!engine.physics_body_collider_enabled());
    assert!(engine.physics_body_collider_is_trigger());
    assert!((engine.physics_body_collider_offset_x() - 1.0).abs() < 0.0001);
    assert!((engine.physics_body_collider_offset_y() - 2.0).abs() < 0.0001);
    assert!(engine.physics_body_collider_material_override());
    assert!((engine.physics_body_collider_restitution() - 0.25).abs() < 0.0001);
    assert!((engine.physics_body_collider_friction() - 0.75).abs() < 0.0001);
    assert!((engine.physics_body_collider_surface_velocity_x() - 2.0).abs() < 0.0001);
    assert!((engine.physics_body_collider_surface_velocity_y() + 1.0).abs() < 0.0001);
    assert!((engine.physics_body_collider_density() - 1.5).abs() < 0.0001);
    assert!((engine.physics_body_collider_contact_baumgarte_bias_scale() - 0.5).abs() < 0.0001);
    assert!(
        (engine.physics_body_collider_max_contact_baumgarte_bias_velocity_scale() - 0.4).abs()
            < 0.0001
    );
    assert!(
        (engine.physics_body_collider_contact_position_correction_scale() - 0.3).abs() < 0.0001
    );
    assert!(
        (engine.physics_body_collider_contact_position_correction_slop_scale() - 0.2).abs()
            < 0.0001
    );
    assert_eq!(
        engine.physics_body_collider_category_bits(),
        CollisionMask::ENEMY.bits
    );
    assert_eq!(
        engine.physics_body_collider_mask_bits(),
        CollisionMask::PLAYER.bits
    );
    assert!(!engine.query_physics_body_collider(body_id, body_generation, 2));
}

#[test]
fn engine_spawn_physics_body_shapes_and_controls_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();

    assert!(engine.spawn_physics_circle_body(
        0.0,
        0.0,
        4.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        true,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let circle_id = engine.physics_entity_id();
    let circle_generation = engine.physics_entity_generation();
    assert!(engine.set_physics_body_position(circle_id, circle_generation, 2.0, -3.0));
    assert!(engine.set_physics_collider_offset(circle_id, circle_generation, 1.0, 0.0));
    assert!(engine.set_physics_collider_enabled(circle_id, circle_generation, false));
    assert!(engine.query_physics_entity(circle_id, circle_generation));
    assert!((engine.physics_entity_x() - 2.0).abs() < 0.0001);
    assert!((engine.physics_entity_y() + 3.0).abs() < 0.0001);
    assert_eq!(
        engine.physics_entity_collider_type(),
        PHYSICS_COLLIDER_TYPE_CIRCLE
    );
    assert!(!engine.physics_entity_collider_enabled());
    assert!(!engine.physics_entity_collider_is_trigger());
    assert!((engine.physics_entity_collider_offset_x() - 1.0).abs() < 0.0001);
    assert!(engine.physics_entity_collider_offset_y().abs() < 0.0001);
    assert!(engine.set_physics_collider_enabled(circle_id, circle_generation, true));
    assert!(engine.set_physics_body_tuning(circle_id, circle_generation, 0.0, 0.0, 0.0));
    assert!(engine.set_physics_body_material(
        circle_id,
        circle_generation,
        0.1,
        0.5,
        1.0,
        -2.0,
        1.25,
        0.8,
        0.9,
        0.7,
        0.6,
    ));
    assert!(engine.set_physics_body_tuning(circle_id, circle_generation, 0.5, 0.2, 0.3));
    assert!(engine.set_physics_body_mass_properties(circle_id, circle_generation, 2.5, 7.5,));
    assert!(!engine.set_physics_body_mass_properties(circle_id, circle_generation, 0.0, 7.5,));
    assert!(engine.query_physics_entity(circle_id, circle_generation));
    assert!((engine.physics_entity_mass() - 2.5).abs() < 0.0001);
    assert!((engine.physics_entity_inverse_mass() - 0.4).abs() < 0.0001);
    assert!((engine.physics_entity_inertia() - 7.5).abs() < 0.0001);
    assert!((engine.physics_entity_inverse_inertia() - (1.0 / 7.5)).abs() < 0.0001);
    assert!((engine.physics_entity_gravity_scale() - 0.5).abs() < 0.0001);
    assert!((engine.physics_entity_linear_damping() - 0.2).abs() < 0.0001);
    assert!((engine.physics_entity_angular_damping() - 0.3).abs() < 0.0001);
    assert!((engine.physics_entity_restitution() - 0.1).abs() < 0.0001);
    assert!((engine.physics_entity_friction() - 0.5).abs() < 0.0001);
    assert!((engine.physics_entity_surface_velocity_x() - 1.0).abs() < 0.0001);
    assert!((engine.physics_entity_surface_velocity_y() + 2.0).abs() < 0.0001);
    assert!((engine.physics_entity_density() - 1.25).abs() < 0.0001);
    assert!((engine.physics_entity_contact_baumgarte_bias_scale() - 0.8).abs() < 0.0001);
    assert!(
        (engine.physics_entity_max_contact_baumgarte_bias_velocity_scale() - 0.9).abs() < 0.0001
    );
    assert!((engine.physics_entity_contact_position_correction_scale() - 0.7).abs() < 0.0001);
    assert!((engine.physics_entity_contact_position_correction_slop_scale() - 0.6).abs() < 0.0001);
    assert!(!engine.physics_entity_collider_material_override());
    assert!((engine.physics_entity_collider_restitution() - 0.1).abs() < 0.0001);
    assert!((engine.physics_entity_collider_friction() - 0.5).abs() < 0.0001);
    assert!(engine.set_physics_collider_material(
        circle_id,
        circle_generation,
        0.2,
        0.6,
        -3.0,
        4.0,
        1.75,
        0.4,
        0.3,
        0.2,
        0.1,
    ));
    assert!(!engine.set_physics_collider_material(
        circle_id,
        circle_generation,
        f32::NAN,
        0.6,
        -3.0,
        4.0,
        1.75,
        0.4,
        0.3,
        0.2,
        0.1,
    ));
    assert!(engine.query_physics_entity(circle_id, circle_generation));
    assert!(engine.physics_entity_collider_material_override());
    assert!((engine.physics_entity_collider_restitution() - 0.2).abs() < 0.0001);
    assert!((engine.physics_entity_collider_friction() - 0.6).abs() < 0.0001);
    assert!((engine.physics_entity_collider_surface_velocity_x() + 3.0).abs() < 0.0001);
    assert!((engine.physics_entity_collider_surface_velocity_y() - 4.0).abs() < 0.0001);
    assert!((engine.physics_entity_collider_density() - 1.75).abs() < 0.0001);
    assert!((engine.physics_entity_collider_contact_baumgarte_bias_scale() - 0.4).abs() < 0.0001);
    assert!(
        (engine.physics_entity_collider_max_contact_baumgarte_bias_velocity_scale() - 0.3).abs()
            < 0.0001
    );
    assert!(
        (engine.physics_entity_collider_contact_position_correction_scale() - 0.2).abs() < 0.0001
    );
    assert!(
        (engine.physics_entity_collider_contact_position_correction_slop_scale() - 0.1).abs()
            < 0.0001
    );
    assert!(engine.clear_physics_collider_material(circle_id, circle_generation));
    assert!(engine.query_physics_entity(circle_id, circle_generation));
    assert!(!engine.physics_entity_collider_material_override());
    assert!((engine.physics_entity_collider_restitution() - 0.1).abs() < 0.0001);
    assert!((engine.physics_entity_collider_friction() - 0.5).abs() < 0.0001);
    assert!(engine.apply_physics_body_impulse(circle_id, circle_generation, 4.0, 0.0));
    assert!(engine.apply_physics_body_angular_impulse(circle_id, circle_generation, 2.0));

    assert!(engine.spawn_physics_capsule_body(
        20.0,
        0.0,
        -4.0,
        0.0,
        4.0,
        0.0,
        2.0,
        PHYSICS_BODY_TYPE_KINEMATIC,
        1.0,
        true,
        PHYSICS_LAYER_ENEMY,
        CollisionMask::ENEMY.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    assert!(engine.spawn_physics_edge_body(
        30.0,
        0.0,
        -5.0,
        0.0,
        5.0,
        0.0,
        PHYSICS_BODY_TYPE_STATIC,
        1.0,
        true,
        PHYSICS_LAYER_WALL,
        CollisionMask::WALL.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let edge_id = engine.physics_entity_id();
    let edge_generation = engine.physics_entity_generation();
    assert_eq!(
        engine.physics_entity_collider_type(),
        PHYSICS_COLLIDER_TYPE_EDGE
    );
    assert!(engine.set_physics_collider_offset(edge_id, edge_generation, 0.0, 1.0));
    assert!(engine.query_physics_entity(edge_id, edge_generation));
    assert!((engine.physics_entity_collider_offset_y() - 1.0).abs() < 0.0001);
    assert!(!engine.spawn_physics_edge_body(
        30.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        PHYSICS_BODY_TYPE_STATIC,
        1.0,
        true,
        PHYSICS_LAYER_WALL,
        CollisionMask::WALL.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    assert!(engine.spawn_physics_chain_body(
        35.0,
        0.0,
        vec![0.0, 0.0, 8.0, 0.0, 8.0, 8.0],
        false,
        PHYSICS_BODY_TYPE_STATIC,
        1.0,
        true,
        PHYSICS_LAYER_WALL,
        CollisionMask::WALL.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    assert_eq!(
        engine.physics_entity_collider_type(),
        PHYSICS_COLLIDER_TYPE_CHAIN
    );
    let chain_id = engine.physics_entity_id();
    let chain_generation = engine.physics_entity_generation();
    assert!(engine.set_physics_collider_offset(chain_id, chain_generation, 0.0, 2.0));
    assert!(engine.query_physics_entity(chain_id, chain_generation));
    assert!((engine.physics_entity_collider_offset_y() - 2.0).abs() < 0.0001);
    assert!(!engine.spawn_physics_chain_body(
        35.0,
        0.0,
        vec![0.0, 0.0, 0.0, 0.0],
        false,
        PHYSICS_BODY_TYPE_STATIC,
        1.0,
        true,
        PHYSICS_LAYER_WALL,
        CollisionMask::WALL.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    assert!(engine.spawn_physics_oriented_box_body(
        40.0,
        0.0,
        5.0,
        3.0,
        0.25,
        PHYSICS_BODY_TYPE_STATIC,
        1.0,
        true,
        PHYSICS_LAYER_WALL,
        CollisionMask::WALL.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    assert!(engine.spawn_physics_convex_polygon_body(
        60.0,
        0.0,
        vec![-4.0, -4.0, 4.0, -4.0, 0.0, 4.0],
        0.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        true,
        PHYSICS_LAYER_BULLET,
        CollisionMask::BULLET.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    assert!(!engine.spawn_physics_convex_polygon_body(
        0.0,
        0.0,
        vec![0.0, 0.0, 1.0],
        0.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        true,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));

    engine.step_rigid_bodies(0.25);

    assert!(engine.query_physics_entity(circle_id, circle_generation));
    assert!(engine.physics_entity_velocity_x() > 0.0);
    assert!(engine.physics_entity_angular_velocity_radians_per_second() > 0.0);
    assert!(engine.set_physics_body_enabled(circle_id, circle_generation, false));
    assert!(engine.query_physics_entity(circle_id, circle_generation));
    assert!(!engine.physics_entity_body_enabled());
    assert!(engine.despawn_physics_entity(circle_id, circle_generation));
    assert!(!engine.query_physics_entity(circle_id, circle_generation));
}

#[test]
fn engine_captures_and_restores_physics_body_snapshot_bulk() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();

    assert!(engine.spawn_physics_aabb_body(
        0.0,
        0.0,
        5.0,
        6.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        true,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let body_id = engine.physics_entity_id();
    let body_generation = engine.physics_entity_generation();
    assert!(engine.set_physics_body_velocity(body_id, body_generation, 3.0, -2.0));
    assert!(engine.set_physics_body_rotation(body_id, body_generation, 0.25));
    assert!(engine.set_physics_body_angular_velocity(body_id, body_generation, 1.5));
    assert!(engine.set_physics_body_mass_properties(body_id, body_generation, 2.0, 5.0));
    assert!(engine.set_physics_body_tuning(body_id, body_generation, 0.75, 0.1, 0.2));
    assert!(engine.set_physics_body_material(
        body_id,
        body_generation,
        0.2,
        0.6,
        1.0,
        -1.0,
        1.25,
        0.8,
        0.9,
        0.7,
        0.6,
    ));
    assert!(engine.set_physics_collider_offset(body_id, body_generation, 1.5, -2.5));
    assert!(engine.set_physics_collider_material(
        body_id,
        body_generation,
        0.3,
        0.7,
        -2.0,
        3.0,
        1.5,
        0.5,
        0.4,
        0.3,
        0.2,
    ));

    assert!(engine.capture_physics_body_snapshot_bulk(vec![body_id, body_generation]));
    assert_eq!(
        engine.physics_body_snapshot_float_len(),
        engine.physics_body_snapshot_floats_per_body()
    );
    assert_eq!(
        engine.physics_body_snapshot_u32_len(),
        engine.physics_body_snapshot_u32s_per_body()
    );
    let floats = engine.physics_body_snapshot_floats.clone();
    let u32s = engine.physics_body_snapshot_u32s.clone();

    assert!(engine.set_physics_body_position(body_id, body_generation, 20.0, 30.0));
    assert!(engine.set_physics_body_velocity(body_id, body_generation, -8.0, 9.0));
    assert!(engine.set_physics_body_rotation(body_id, body_generation, -1.0));
    assert!(engine.set_physics_body_angular_velocity(body_id, body_generation, -4.0));
    assert!(engine.set_physics_body_mass_properties(body_id, body_generation, 4.0, 8.0));
    assert!(engine.set_physics_body_tuning(body_id, body_generation, 0.25, 0.4, 0.5));
    assert!(engine.clear_physics_collider_material(body_id, body_generation));
    assert!(engine.set_physics_collider_offset(body_id, body_generation, -5.0, 6.0));

    assert!(engine.restore_physics_body_snapshot_bulk(
        vec![body_id, body_generation],
        floats,
        u32s,
    ));
    assert!(engine.query_physics_entity(body_id, body_generation));
    assert!((engine.physics_entity_x()).abs() < 0.0001);
    assert!((engine.physics_entity_y()).abs() < 0.0001);
    assert!((engine.physics_entity_velocity_x() - 3.0).abs() < 0.0001);
    assert!((engine.physics_entity_velocity_y() + 2.0).abs() < 0.0001);
    assert!((engine.physics_entity_rotation_radians() - 0.25).abs() < 0.0001);
    assert!((engine.physics_entity_angular_velocity_radians_per_second() - 1.5).abs() < 0.0001);
    assert!((engine.physics_entity_mass() - 2.0).abs() < 0.0001);
    assert!((engine.physics_entity_inertia() - 5.0).abs() < 0.0001);
    assert!((engine.physics_entity_gravity_scale() - 0.75).abs() < 0.0001);
    assert!((engine.physics_entity_linear_damping() - 0.1).abs() < 0.0001);
    assert!((engine.physics_entity_angular_damping() - 0.2).abs() < 0.0001);
    assert!((engine.physics_entity_collider_offset_x() - 1.5).abs() < 0.0001);
    assert!((engine.physics_entity_collider_offset_y() + 2.5).abs() < 0.0001);
    assert!(engine.physics_entity_collider_material_override());
    assert!((engine.physics_entity_collider_friction() - 0.7).abs() < 0.0001);

    assert!(!engine.capture_physics_body_snapshot_bulk(vec![body_id]));
    assert!(!engine.restore_physics_body_snapshot_bulk(
        vec![body_id, body_generation],
        vec![0.0],
        vec![0],
    ));
}
