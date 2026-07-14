use super::*;

#[test]
fn distance_joint_moves_dynamic_body_to_static_rest_length() {
    let mut world = World::default();
    let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0));

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
    assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
}

#[test]
fn distance_joint_splits_position_correction_by_inverse_mass() {
    let mut world = World::default();
    let left = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    let right = spawn_dynamic_body(&mut world, 8.0, 0.0, 1.0);
    world.set_rigid_body(left, RigidBody::dynamic(1.0));
    world.set_rigid_body(right, RigidBody::dynamic(3.0));
    world.add_distance_joint(DistanceJoint::new(left, right, 4.0));

    PhysicsSystem::step_rigid_bodies_with_config(
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

    let left_transform = world.transform(left).unwrap();
    let right_transform = world.transform(right).unwrap();
    assert!((left_transform.x - 3.0).abs() < 0.001);
    assert!((right_transform.x - 7.0).abs() < 0.001);
    assert!((right_transform.x - left_transform.x - 4.0).abs() < 0.001);
}

#[test]
fn distance_joint_damping_reduces_axis_relative_velocity() {
    let mut world = World::default();
    let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
    world.set_aabb_collider(
        anchor,
        AabbCollider::new(5.0, 5.0, true, CollisionLayer::Wall),
    );
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = spawn_dynamic_body(&mut world, 4.0, 0.0, 1.0);
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0).with_damping(1.0));

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

    let velocity = world.velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(velocity.vx.abs() < 0.001);
    assert!(velocity.vy.abs() < 0.001);
}

#[test]
fn distance_joint_damping_applies_angular_impulse_at_local_anchor() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_distance_joint(
        DistanceJoint::new(anchor, body, (20.0_f32).sqrt())
            .with_local_anchor_b(0.0, 2.0)
            .with_damping(1.0),
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

    let angular_velocity = world.angular_velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(
        angular_velocity.radians_per_second > 0.001,
        "off-center distance anchor should transfer impulse into rotation, got {angular_velocity:?}"
    );
}

#[test]
fn distance_joint_breaks_when_error_exceeds_break_distance() {
    let mut world = World::default();
    let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0).with_break_distance(2.0));

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
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.distance_joint_count(), 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}

#[test]
fn broken_distance_joint_bucket_index_is_skipped_after_clear() {
    let mut world = World::default();
    let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0).with_break_distance(2.0));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 2,
            position_iterations: 2,
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
    assert_eq!(world.distance_joint_count(), 0);
}

#[test]
fn distance_joint_break_distance_allows_smaller_error() {
    let mut world = World::default();
    let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = spawn_dynamic_body(&mut world, 5.0, 0.0, 1.0);
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0).with_break_distance(2.0));

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
    assert_eq!(stats.constraint_position_corrections, 1);
    assert_eq!(world.distance_joint_count(), 1);
    assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
}

#[test]
fn distance_joint_clears_despawned_entities() {
    let mut world = World::default();
    let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    let joint = world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0));
    world.despawn(body);

    assert_eq!(world.distance_joint(joint), None);
    assert_eq!(world.distance_joint_count(), 0);

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
    assert_eq!(world.distance_joint_count(), 0);
}
