use super::*;

#[test]
fn rope_joint_clamps_dynamic_body_to_max_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_rope_joint(RopeJoint::new(anchor, body, 4.0));

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
fn rope_joint_allows_slack_under_max_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 3.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_rope_joint(RopeJoint::new(anchor, body, 4.0));

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
        },
    );

    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 3.0, y: 0.0 }));
}

#[test]
fn rope_joint_damping_reduces_separating_velocity_at_limit() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_damping(1.0));

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
        },
    );

    let velocity = world.velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(velocity.vx.abs() < 0.001);
    assert!(velocity.vy.abs() < 0.001);
    assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
}

#[test]
fn rope_joint_breaks_when_extension_exceeds_break_distance() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_break_distance(2.0));

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
        },
    );

    assert_eq!(stats.broken_joints, 1);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.rope_joint_count(), 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}

#[test]
fn rope_joint_break_distance_allows_smaller_extension() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 5.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_break_distance(2.0));

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
        },
    );

    assert_eq!(stats.broken_joints, 0);
    assert_eq!(stats.constraint_position_corrections, 1);
    assert_eq!(world.rope_joint_count(), 1);
    assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
}

#[test]
fn rope_joint_break_distance_ignores_slack() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 2.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_break_distance(0.0));

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
        },
    );

    assert_eq!(stats.broken_joints, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.rope_joint_count(), 1);
    assert_eq!(world.transform(body), Some(Transform2D { x: 2.0, y: 0.0 }));
}

#[test]
fn rope_joint_skips_despawned_entities() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_rope_joint(RopeJoint::new(anchor, body, 4.0));
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
        },
    );

    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.rope_joint_count(), 1);
}
