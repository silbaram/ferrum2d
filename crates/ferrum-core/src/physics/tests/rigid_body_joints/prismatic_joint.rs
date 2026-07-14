use super::*;

#[test]
fn prismatic_joint_allows_axis_translation() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body));

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
    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert!(
        (transform.x - 10.0).abs() < 0.001,
        "slider should allow translation on local axis, got {transform:?}"
    );
    assert!(
        transform.y.abs() < 0.001,
        "slider should not add perpendicular drift, got {transform:?}"
    );
}

#[test]
fn prismatic_joint_break_distance_allows_axis_translation() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_break_distance(2.0));

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
    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.prismatic_joint_count(), 1);
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}

#[test]
fn prismatic_joint_allows_translation_inside_limits() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 3.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0));

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
    assert_eq!(world.transform(body), Some(Transform2D { x: 3.0, y: 0.0 }));
}

#[test]
fn prismatic_joint_clamps_upper_translation_limit() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0));

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
        (transform.x - 4.0).abs() < 0.001,
        "slider should clamp upper translation limit, got {transform:?}"
    );
    assert!(transform.y.abs() < 0.001);
}

#[test]
fn prismatic_joint_clamps_lower_translation_limit() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: -10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0));

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
        (transform.x + 4.0).abs() < 0.001,
        "slider should clamp lower translation limit, got {transform:?}"
    );
    assert!(transform.y.abs() < 0.001);
}

#[test]
fn prismatic_joint_translation_limit_uses_rotated_local_axis() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(
        anchor,
        Rotation2D {
            radians: std::f32::consts::FRAC_PI_2,
        },
    );
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 10.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0));

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
    assert_eq!(stats.constraint_position_corrections, 1);
    assert!(transform.x.abs() < 0.001);
    assert!(
        (transform.y - 4.0).abs() < 0.001,
        "rotated slider axis should clamp world y translation, got {transform:?}"
    );
}

#[test]
fn prismatic_joint_corrects_perpendicular_drift() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 5.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body));

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
        (transform.x - 10.0).abs() < 0.001,
        "slider correction should preserve axis translation, got {transform:?}"
    );
    assert!(
        transform.y.abs() < 0.001,
        "slider should remove perpendicular drift, got {transform:?}"
    );
}

#[test]
fn prismatic_joint_breaks_when_perpendicular_anchor_error_exceeds_break_distance() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 10.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_break_distance(2.0));

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
    assert_eq!(world.prismatic_joint_count(), 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 10.0 }));
}

#[test]
fn prismatic_joint_break_distance_allows_smaller_perpendicular_anchor_error() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 1.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_break_distance(2.0));

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
    assert_eq!(world.prismatic_joint_count(), 1);
}

#[test]
fn prismatic_joint_local_axis_rotates_with_entity_a() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(
        anchor,
        Rotation2D {
            radians: std::f32::consts::FRAC_PI_2,
        },
    );
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 5.0, y: 10.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_prismatic_joint(PrismaticJoint::new(anchor, body));

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
    assert_eq!(stats.constraint_position_corrections, 1);
    assert!(
        transform.x.abs() < 0.001,
        "rotated local axis should constrain world x drift, got {transform:?}"
    );
    assert!(
        (transform.y - 10.0).abs() < 0.001,
        "rotated local axis should allow world y translation, got {transform:?}"
    );
}

#[test]
fn prismatic_joint_locks_relative_angle() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.5 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = PrismaticJoint::new(anchor, body).with_stiffness(0.0);

    assert!(solve_prismatic_joint_position_constraint(&mut world, joint));

    let rotation = world.rotation(body).unwrap();
    assert!(
        rotation.radians.abs() < 0.001,
        "slider should lock relative angle to reference angle, got {rotation:?}"
    );
}

#[test]
fn prismatic_joint_limit_damping_reduces_outward_axis_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 6.0, y: 0.0 });
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = PrismaticJoint::new(anchor, body)
        .with_translation_limits(-4.0, 4.0)
        .with_stiffness(0.0)
        .with_damping(1.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);

    assert!(solve_prismatic_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let velocity = world.velocity(body).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "limit damping should remove outward axis velocity, got {velocity:?}"
    );
    assert!(velocity.vy.abs() < 0.001);
}

#[test]
fn prismatic_joint_motor_drives_axis_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = PrismaticJoint::new(anchor, body)
        .with_motor(5.0, 100.0)
        .with_stiffness(0.0)
        .with_damping(0.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);

    assert!(solve_prismatic_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let velocity = world.velocity(body).unwrap();
    assert!(
        (velocity.vx - 5.0).abs() < 0.001,
        "slider motor should drive axis velocity to target speed, got {velocity:?}"
    );
    assert!(velocity.vy.abs() < 0.001);
}

#[test]
fn prismatic_joint_motor_force_limits_axis_impulse() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = PrismaticJoint::new(anchor, body)
        .with_motor(5.0, 10.0)
        .with_stiffness(0.0)
        .with_damping(0.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);

    assert!(solve_prismatic_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let velocity = world.velocity(body).unwrap();
    assert!(
        (velocity.vx - 1.0).abs() < 0.001,
        "max motor force should clamp per-step axis impulse, got {velocity:?}"
    );
    assert!(velocity.vy.abs() < 0.001);
}

#[test]
fn prismatic_joint_motor_uses_rotated_local_axis() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(
        anchor,
        Rotation2D {
            radians: std::f32::consts::FRAC_PI_2,
        },
    );
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = PrismaticJoint::new(anchor, body)
        .with_motor(5.0, 100.0)
        .with_stiffness(0.0)
        .with_damping(0.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);

    assert!(solve_prismatic_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let velocity = world.velocity(body).unwrap();
    assert!(velocity.vx.abs() < 0.001);
    assert!(
        (velocity.vy - 5.0).abs() < 0.001,
        "rotated slider motor should drive world y velocity, got {velocity:?}"
    );
}

#[test]
fn prismatic_joint_motor_respects_translation_limit_direction() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let outward_joint = PrismaticJoint::new(anchor, body)
        .with_translation_limits(-4.0, 4.0)
        .with_motor(5.0, 100.0)
        .with_stiffness(0.0)
        .with_damping(0.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);

    assert!(!solve_prismatic_joint_velocity_constraint(
        &mut world,
        outward_joint,
        0.1,
        1
    ));
    assert_eq!(world.velocity(body), Some(Velocity::default()));

    let inward_joint = PrismaticJoint::new(anchor, body)
        .with_translation_limits(-4.0, 4.0)
        .with_motor(-5.0, 100.0)
        .with_stiffness(0.0)
        .with_damping(0.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);

    assert!(solve_prismatic_joint_velocity_constraint(
        &mut world,
        inward_joint,
        0.1,
        1
    ));
    let velocity = world.velocity(body).unwrap();
    assert!(
        (velocity.vx + 5.0).abs() < 0.001,
        "slider motor should allow inward velocity at upper limit, got {velocity:?}"
    );
}

#[test]
fn prismatic_joint_damping_reduces_perpendicular_anchor_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_velocity(body, Velocity { vx: 0.0, vy: 10.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = PrismaticJoint::new(anchor, body)
        .with_stiffness(0.0)
        .with_damping(1.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);

    assert!(solve_prismatic_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let velocity = world.velocity(body).unwrap();
    assert!(velocity.vx.abs() < 0.001);
    assert!(
        velocity.vy.abs() < 0.001,
        "slider damping should remove perpendicular anchor velocity, got {velocity:?}"
    );
}

#[test]
fn prismatic_joint_angular_damping_reduces_relative_angular_velocity() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
    world.set_angular_velocity(
        body,
        AngularVelocity {
            radians_per_second: 10.0,
        },
    );
    world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = PrismaticJoint::new(anchor, body)
        .with_stiffness(0.0)
        .with_damping(0.0)
        .with_angular_stiffness(0.0)
        .with_angular_damping(1.0);

    assert!(solve_prismatic_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let angular_velocity = world.angular_velocity(body).unwrap();
    assert!(
        angular_velocity.radians_per_second.abs() < 0.001,
        "slider angular damping should remove relative angular velocity, got {angular_velocity:?}"
    );
}

#[test]
fn prismatic_joint_clears_despawned_entities() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 5.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    let joint = world.add_prismatic_joint(PrismaticJoint::new(anchor, body));
    world.despawn(body);

    assert_eq!(world.prismatic_joint(joint), None);
    assert_eq!(world.prismatic_joint_count(), 0);

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
    assert_eq!(world.prismatic_joint_count(), 0);
}
