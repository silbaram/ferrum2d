use super::*;

#[test]
fn revolute_joint_moves_dynamic_anchor_to_static_anchor() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_revolute_joint(RevoluteJoint::new(anchor, body));

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

    let transform = world.transform(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert_eq!(stats.constraint_position_corrections, 1);
    assert!(
        transform.x.abs() < 0.001,
        "revolute joint should pin body x to anchor, got {transform:?}"
    );
    assert!(
        transform.y.abs() < 0.001,
        "revolute joint should pin body y to anchor, got {transform:?}"
    );
}

#[test]
fn revolute_joint_breaks_when_anchor_error_exceeds_break_distance() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_revolute_joint(RevoluteJoint::new(anchor, body).with_break_distance(2.0));

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
    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.revolute_joint_count(), 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}

#[test]
fn revolute_joint_break_distance_allows_smaller_anchor_error() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 1.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_revolute_joint(RevoluteJoint::new(anchor, body).with_break_distance(2.0));

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

    assert_eq!(stats.broken_joints, 0);
    assert!(stats.constraint_velocity_corrections > 0);
    assert!(stats.constraint_position_corrections > 0);
    assert_eq!(world.revolute_joint_count(), 1);
}

#[test]
fn revolute_joint_splits_position_correction_by_inverse_mass() {
    let mut world = World::default();
    let left = world.spawn_entity();
    world.set_transform(left, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(left, RigidBody::dynamic(1.0));
    let right = world.spawn_entity();
    world.set_transform(right, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(right, RigidBody::dynamic(1.0));
    world.add_revolute_joint(RevoluteJoint::new(left, right));

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
    assert_eq!(world.transform(left), Some(Transform2D { x: 5.0, y: 0.0 }));
    assert_eq!(world.transform(right), Some(Transform2D { x: 5.0, y: 0.0 }));
}

#[test]
fn revolute_joint_damping_reduces_off_center_anchor_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.0 });
    world.set_angular_velocity(
        body,
        AngularVelocity {
            radians_per_second: 10.0,
        },
    );
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body)
        .with_local_anchor_b(1.0, 0.0)
        .with_stiffness(0.0)
        .with_damping(1.0);

    assert!(solve_revolute_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let velocity = world.velocity(body).unwrap();
    let angular_velocity = world.angular_velocity(body).unwrap();
    assert!(velocity.vx.abs() < 0.001);
    assert!(
        (velocity.vy + 5.0).abs() < 0.001,
        "anchor damping should add balancing linear velocity, got {velocity:?}"
    );
    assert!(
        (angular_velocity.radians_per_second - 5.0).abs() < 0.001,
        "anchor damping should reduce angular velocity, got {angular_velocity:?}"
    );
}

#[test]
fn revolute_joint_position_constraint_uses_local_anchors_and_rotation() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body)
        .with_local_anchor_a(0.0, 1.0)
        .with_local_anchor_b(1.0, 0.0);
    let before_error = revolute_joint_constraint_context(&world, joint)
        .map(|context| velocity_len_squared(context.error))
        .unwrap();

    assert!(solve_revolute_joint_position_constraint(&mut world, joint));

    let after_error = revolute_joint_constraint_context(&world, joint)
        .map(|context| velocity_len_squared(context.error))
        .unwrap();
    let rotation = world.rotation(body).unwrap();
    assert!(
            after_error < before_error,
            "local anchor position correction should reduce anchor error: before={before_error}, after={after_error}"
        );
    assert!(
        rotation.radians > 0.0,
        "off-center correction should rotate the dynamic body, got {rotation:?}"
    );
}

#[test]
fn revolute_joint_clamps_upper_angle_limit() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 1.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body).with_angle_limits(-0.5, 0.5);

    assert!(solve_revolute_joint_position_constraint(&mut world, joint));

    let rotation = world.rotation(body).unwrap();
    assert!(
        (rotation.radians - 0.5).abs() < 0.001,
        "upper angle limit should clamp body rotation, got {rotation:?}"
    );
}

#[test]
fn revolute_joint_clamps_lower_angle_limit() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: -1.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body).with_angle_limits(-0.5, 0.5);

    assert!(solve_revolute_joint_position_constraint(&mut world, joint));

    let rotation = world.rotation(body).unwrap();
    assert!(
        (rotation.radians + 0.5).abs() < 0.001,
        "lower angle limit should clamp body rotation, got {rotation:?}"
    );
}

#[test]
fn revolute_joint_normalized_limit_keeps_wrapped_default_behavior() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(
        body,
        Rotation2D {
            radians: std::f32::consts::TAU + 0.25,
        },
    );
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body).with_angle_limits(-0.5, 0.5);

    assert!(!solve_revolute_joint_position_constraint(&mut world, joint));

    let rotation = world.rotation(body).unwrap();
    assert!(
        (rotation.radians - (std::f32::consts::TAU + 0.25)).abs() < 0.001,
        "default normalized limit should preserve wrapped in-range angle, got {rotation:?}"
    );
}

#[test]
fn revolute_joint_continuous_limit_clamps_multi_turn_angle() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(
        body,
        Rotation2D {
            radians: std::f32::consts::TAU + 0.75,
        },
    );
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body)
        .with_angle_limits(-0.5, 0.5)
        .with_continuous_limit(true);

    assert!(solve_revolute_joint_position_constraint(&mut world, joint));

    let rotation = world.rotation(body).unwrap();
    assert!(
        (rotation.radians - 0.5).abs() < 0.001,
        "continuous limit should clamp against raw accumulated relative angle, got {rotation:?}"
    );
}

#[test]
fn revolute_joint_angle_limit_damping_reduces_outward_angular_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.75 });
    world.set_angular_velocity(
        body,
        AngularVelocity {
            radians_per_second: 10.0,
        },
    );
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body)
        .with_angle_limits(-0.5, 0.5)
        .with_stiffness(0.0)
        .with_damping(1.0);

    assert!(solve_revolute_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let angular_velocity = world.angular_velocity(body).unwrap();
    assert!(
        angular_velocity.radians_per_second.abs() < 0.001,
        "angle limit damping should remove outward angular velocity, got {angular_velocity:?}"
    );
}

#[test]
fn revolute_joint_angle_limit_allows_inward_angular_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.75 });
    world.set_angular_velocity(
        body,
        AngularVelocity {
            radians_per_second: -4.0,
        },
    );
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body)
        .with_angle_limits(-0.5, 0.5)
        .with_stiffness(0.0)
        .with_damping(1.0);

    assert!(!solve_revolute_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let angular_velocity = world.angular_velocity(body).unwrap();
    assert_eq!(
        angular_velocity,
        AngularVelocity {
            radians_per_second: -4.0,
        }
    );
}

#[test]
fn revolute_joint_motor_drives_relative_angular_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body)
        .with_motor(5.0, 100.0)
        .with_stiffness(0.0)
        .with_damping(0.0);

    assert!(solve_revolute_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let angular_velocity = world.angular_velocity(body).unwrap();
    assert!(
        (angular_velocity.radians_per_second - 5.0).abs() < 0.001,
        "revolute motor should drive angular velocity to target speed, got {angular_velocity:?}"
    );
}

#[test]
fn revolute_joint_motor_torque_limits_angular_impulse() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = RevoluteJoint::new(anchor, body)
        .with_motor(5.0, 10.0)
        .with_stiffness(0.0)
        .with_damping(0.0);

    assert!(solve_revolute_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let angular_velocity = world.angular_velocity(body).unwrap();
    assert!(
        (angular_velocity.radians_per_second - 1.0).abs() < 0.001,
        "max motor torque should clamp per-step angular impulse, got {angular_velocity:?}"
    );
}

#[test]
fn revolute_joint_motor_respects_angle_limit_direction() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.5 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let outward_joint = RevoluteJoint::new(anchor, body)
        .with_angle_limits(-0.5, 0.5)
        .with_motor(5.0, 100.0)
        .with_stiffness(0.0)
        .with_damping(0.0);

    assert!(!solve_revolute_joint_velocity_constraint(
        &mut world,
        outward_joint,
        0.1,
        1
    ));
    assert_eq!(
        world.angular_velocity(body),
        Some(AngularVelocity::default())
    );

    let inward_joint = RevoluteJoint::new(anchor, body)
        .with_angle_limits(-0.5, 0.5)
        .with_motor(-5.0, 100.0)
        .with_stiffness(0.0)
        .with_damping(0.0);

    assert!(solve_revolute_joint_velocity_constraint(
        &mut world,
        inward_joint,
        0.1,
        1
    ));
    let angular_velocity = world.angular_velocity(body).unwrap();
    assert!(
            (angular_velocity.radians_per_second + 5.0).abs() < 0.001,
            "revolute motor should allow inward angular velocity at upper limit, got {angular_velocity:?}"
        );
}

#[test]
fn revolute_joint_skips_despawned_entities() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_revolute_joint(RevoluteJoint::new(anchor, body));
    world.despawn(body);

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

    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.revolute_joint_count(), 1);
}
