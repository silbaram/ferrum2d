use super::*;

#[test]
fn gear_joint_damping_enforces_angular_velocity_ratio() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_angular_velocity(
        gear_a,
        AngularVelocity {
            radians_per_second: 3.0,
        },
    );
    world.set_rigid_body(gear_a, RigidBody::dynamic(1.0).with_inertia(1.0));
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_angular_velocity(
        gear_b,
        AngularVelocity {
            radians_per_second: 0.0,
        },
    );
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = GearJoint::new(gear_a, gear_b, 2.0)
        .with_stiffness(0.0)
        .with_damping(1.0);

    assert!(solve_gear_joint_velocity_constraint(
        &mut world, joint, 0.1, 1
    ));

    let angular_velocity_a = world.angular_velocity(gear_a).unwrap().radians_per_second;
    let angular_velocity_b = world.angular_velocity(gear_b).unwrap().radians_per_second;
    assert!(
            (angular_velocity_b + 2.0 * angular_velocity_a).abs() < 0.001,
            "gear joint should enforce omega_b + ratio * omega_a = 0, got a={angular_velocity_a}, b={angular_velocity_b}"
        );
}

#[test]
fn gear_joint_position_constraint_enforces_rotation_ratio() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_a, Rotation2D { radians: 0.25 });
    world.set_rigid_body(gear_a, RigidBody::static_body());
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = GearJoint::new(gear_a, gear_b, 2.0);

    assert!(solve_gear_joint_position_constraint(&mut world, joint));

    let rotation_b = world.rotation(gear_b).unwrap();
    assert!(
            (rotation_b.radians + 0.5).abs() < 0.001,
            "gear joint should rotate body B to satisfy theta_b + ratio * theta_a = reference, got {rotation_b:?}"
        );
}

#[test]
fn gear_joint_reference_angle_preserves_rotation_offset() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_a, Rotation2D { radians: 0.25 });
    world.set_rigid_body(gear_a, RigidBody::static_body());
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = GearJoint::new(gear_a, gear_b, 2.0).with_reference_angle(1.5);

    assert!(!solve_gear_joint_position_constraint(&mut world, joint));
    assert_eq!(world.rotation(gear_b), Some(Rotation2D { radians: 1.0 }));
}

#[test]
fn gear_joint_breaks_when_angle_error_exceeds_break_angle() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_a, Rotation2D { radians: 0.0 });
    world.set_rigid_body(gear_a, RigidBody::static_body());
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_b, Rotation2D { radians: 3.0 });
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_gear_joint(GearJoint::new(gear_a, gear_b, 1.0).with_break_angle(1.0));

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
    assert_eq!(world.gear_joint_count(), 0);
    assert_eq!(world.rotation(gear_b), Some(Rotation2D { radians: 3.0 }));
}

#[test]
fn gear_joint_break_angle_uses_wrapped_angle_error() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(
        gear_a,
        Rotation2D {
            radians: std::f32::consts::PI * 2.0 - 0.01,
        },
    );
    world.set_rigid_body(gear_a, RigidBody::static_body());
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_b, Rotation2D { radians: 0.0 });
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_gear_joint(GearJoint::new(gear_a, gear_b, 1.0).with_break_angle(0.1));

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
    assert_eq!(world.gear_joint_count(), 1);
}

#[test]
fn gear_joint_break_angle_allows_smaller_angle_error() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_a, Rotation2D { radians: 0.0 });
    world.set_rigid_body(gear_a, RigidBody::static_body());
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_b, Rotation2D { radians: 0.5 });
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_gear_joint(GearJoint::new(gear_a, gear_b, 1.0).with_break_angle(1.0));

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
    assert_eq!(world.gear_joint_count(), 1);
}

#[test]
fn gear_joint_break_angle_respects_reference_angle() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_a, Rotation2D { radians: 0.25 });
    world.set_rigid_body(gear_a, RigidBody::static_body());
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    world.add_gear_joint(
        GearJoint::new(gear_a, gear_b, 2.0)
            .with_reference_angle(1.5)
            .with_break_angle(0.1),
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

    assert_eq!(stats.broken_joints, 0);
    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.gear_joint_count(), 1);
}

#[test]
fn gear_joint_clears_despawned_entities() {
    let mut world = World::default();
    let gear_a = world.spawn_entity();
    world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_a, Rotation2D { radians: 0.0 });
    world.set_rigid_body(gear_a, RigidBody::static_body());
    let gear_b = world.spawn_entity();
    world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
    world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
    let joint = world.add_gear_joint(GearJoint::new(gear_a, gear_b, 1.0));
    world.despawn(gear_b);

    assert_eq!(world.gear_joint(joint), None);
    assert_eq!(world.gear_joint_count(), 0);

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
    assert_eq!(world.gear_joint_count(), 0);
}
