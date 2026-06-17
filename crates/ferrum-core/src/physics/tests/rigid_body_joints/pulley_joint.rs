use super::*;

#[test]
fn pulley_joint_moves_dynamic_body_to_weighted_rest_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_pulley_joint(
        PulleyJoint::new(anchor, body, 8.0)
            .with_ground_anchor_a(0.0, 0.0)
            .with_ground_anchor_b(0.0, 0.0)
            .with_ratio(2.0),
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

    assert_eq!(stats.constraint_position_corrections, 1);
    assert_eq!(
        world.transform(anchor),
        Some(Transform2D { x: 0.0, y: 0.0 })
    );
    let body_transform = world.transform(body).unwrap();
    assert!(
        (body_transform.x - 4.0).abs() < 0.001,
        "ratio 2 pulley should move the body to length 4, got {body_transform:?}"
    );
}

#[test]
fn pulley_joint_breaks_when_weighted_length_error_exceeds_break_distance() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_pulley_joint(
        PulleyJoint::new(anchor, body, 4.0)
            .with_ground_anchor_a(0.0, 0.0)
            .with_ground_anchor_b(0.0, 0.0)
            .with_break_distance(2.0),
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
    assert_eq!(world.pulley_joint_count(), 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}

#[test]
fn pulley_joint_slack_does_not_push_body_when_weighted_length_is_below_rest_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_pulley_joint(
        PulleyJoint::new(anchor, body, 10.0)
            .with_ground_anchor_a(0.0, 0.0)
            .with_ground_anchor_b(0.0, 0.0)
            .with_break_distance(1.0)
            .with_slack(true),
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

    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(stats.broken_joints, 0);
    assert_eq!(world.pulley_joint_count(), 1);
    assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
}

#[test]
fn pulley_joint_slack_pulls_body_when_weighted_length_exceeds_rest_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_pulley_joint(
        PulleyJoint::new(anchor, body, 4.0)
            .with_ground_anchor_a(0.0, 0.0)
            .with_ground_anchor_b(0.0, 0.0)
            .with_slack(true),
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

    assert_eq!(stats.constraint_position_corrections, 1);
    let body_transform = world.transform(body).unwrap();
    assert!(
        (body_transform.x - 4.0).abs() < 0.001,
        "slack pulley should become taut and pull to rest length, got {body_transform:?}"
    );
}
