use super::*;

#[test]
fn engine_spawn_physics_joints_and_controls_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();

    assert!(engine.spawn_physics_aabb_body(
        0.0,
        0.0,
        2.0,
        2.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        false,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let entity_a_id = engine.physics_entity_id();
    let entity_a_generation = engine.physics_entity_generation();
    assert!(engine.spawn_physics_aabb_body(
        20.0,
        0.0,
        2.0,
        2.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        false,
        PHYSICS_LAYER_ENEMY,
        CollisionMask::ENEMY.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let entity_b_id = engine.physics_entity_id();
    let entity_b_generation = engine.physics_entity_generation();

    assert!(engine.spawn_physics_distance_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        10.0,
        1.0,
        0.25,
        f32::INFINITY,
        true,
    ));
    let distance_index = engine.physics_joint_index();
    let distance_generation = engine.physics_joint_generation();
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_DISTANCE);
    assert_eq!(engine.physics_joint_entity_a_id(), entity_a_id);
    assert_eq!(engine.physics_joint_entity_b_id(), entity_b_id);
    assert_eq!(engine.physics_joint_rest_length(), 10.0);
    assert_eq!(engine.physics_joint_damping(), 0.25);
    assert!(engine.physics_joint_enabled());

    engine.step_rigid_bodies(1.0 / 60.0);
    assert!(engine.rigid_body_step_constraint_position_corrections() > 0);

    assert!(engine.set_physics_joint_enabled(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
        false,
    ));
    assert!(!engine.physics_joint_enabled());
    assert!(engine.query_physics_joint(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
    ));
    assert!(!engine.physics_joint_enabled());

    assert!(engine.spawn_physics_rope_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        12.0,
        0.5,
        0.1,
        4.0,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_ROPE);
    assert_eq!(engine.physics_joint_max_length(), 12.0);
    assert_eq!(engine.physics_joint_break_distance(), 4.0);

    assert!(engine.spawn_physics_spring_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        8.0,
        0.75,
        0.5,
        f32::INFINITY,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_SPRING);
    assert_eq!(engine.physics_joint_rest_length(), 8.0);
    assert_eq!(engine.physics_joint_stiffness(), 0.75);

    assert!(engine.spawn_physics_pulley_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        -4.0,
        10.0,
        24.0,
        10.0,
        0.0,
        0.0,
        0.0,
        0.0,
        30.0,
        2.0,
        0.8,
        0.25,
        5.0,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_PULLEY);
    assert_eq!(engine.physics_joint_rest_length(), 30.0);
    assert_eq!(engine.physics_joint_ratio(), 2.0);
    assert_eq!(engine.physics_joint_ground_anchor_a_x(), -4.0);
    assert_eq!(engine.physics_joint_ground_anchor_b_y(), 10.0);
    assert_eq!(engine.physics_joint_break_distance(), 5.0);

    assert!(engine.spawn_physics_revolute_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        -1.0,
        0.0,
        1.0,
        0.0,
        0.8,
        0.6,
        5.0,
        true,
        -0.5,
        0.5,
        true,
        1.5,
        3.0,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_REVOLUTE);
    assert_eq!(engine.physics_joint_local_anchor_a_x(), -1.0);
    assert!(engine.physics_joint_limit_enabled());
    assert!(engine.physics_joint_motor_enabled());
    assert_eq!(engine.physics_joint_max_motor_torque(), 3.0);

    assert!(engine.spawn_physics_prismatic_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.25,
        0.9,
        0.4,
        0.7,
        0.3,
        6.0,
        true,
        -2.0,
        2.0,
        true,
        4.0,
        5.0,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_PRISMATIC);
    assert_eq!(engine.physics_joint_reference_angle(), 0.25);
    assert_eq!(engine.physics_joint_local_axis_a_x(), 1.0);
    assert_eq!(engine.physics_joint_angular_stiffness(), 0.7);
    assert_eq!(engine.physics_joint_max_motor_force(), 5.0);

    assert!(engine.spawn_physics_gear_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        2.0,
        0.5,
        0.8,
        0.2,
        1.5,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_GEAR);
    assert_eq!(engine.physics_joint_ratio(), 2.0);
    assert_eq!(engine.physics_joint_reference_angle(), 0.5);
    assert_eq!(engine.physics_joint_break_angle(), 1.5);

    assert!(engine.clear_physics_joint(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
    ));
    assert!(!engine.query_physics_joint(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
    ));
    assert!(!engine.spawn_physics_distance_joint(
        entity_a_id,
        entity_a_generation,
        999,
        0,
        10.0,
        1.0,
        0.0,
        f32::INFINITY,
        true,
    ));
}
