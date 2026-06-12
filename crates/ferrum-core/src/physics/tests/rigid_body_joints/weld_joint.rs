use super::*;

#[test]
fn weld_joint_locks_local_anchor_and_relative_angle() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());

    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 2.0 });
    world.set_rotation(body, Rotation2D { radians: 0.5 });
    world.set_rigid_body(body, RigidBody::dynamic_box(1.0, 2.0, 2.0));
    world.add_weld_joint(
        WeldJoint::new(anchor, body)
            .with_local_anchor_a(4.0, 0.0)
            .with_local_anchor_b(-4.0, 0.0)
            .with_reference_angle(0.0),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 4,
            position_iterations: 8,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let transform = world.transform(body).unwrap();
    let rotation = world.rotation(body).unwrap_or_default();
    assert!(stats.constraint_position_corrections > 0);
    assert!(
        (transform.x - 8.0).abs() < 0.05 && transform.y.abs() < 0.05,
        "weld joint should preserve the authored local anchor offset, got {transform:?}"
    );
    assert!(
        rotation.radians.abs() < 0.05,
        "weld joint should lock relative angle, got {rotation:?}"
    );
}

#[test]
fn weld_joint_breaks_on_linear_or_angular_error() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());

    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 2.0 });
    world.set_rigid_body(body, RigidBody::dynamic_box(1.0, 2.0, 2.0));
    world.add_weld_joint(
        WeldJoint::new(anchor, body)
            .with_break_distance(1.0)
            .with_break_angle(1.0),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.broken_joints, 1);
    assert_eq!(world.weld_joint_count(), 0);
}
