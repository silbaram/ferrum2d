use super::*;

#[test]
fn disabled_rigid_body_is_ignored_by_joint_solver() {
    let mut world = World::default();
    let anchor = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_enabled(false));
    let joint_id = world.add_distance_joint(DistanceJoint::new(anchor, body, 0.0));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        1.0,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        },
    );

    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(stats.broken_joints, 0);
    assert!(world.distance_joint(joint_id).is_some());
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}
