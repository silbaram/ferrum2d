use super::*;

fn world_anchor(
    transform: Transform2D,
    rotation: Rotation2D,
    local_x: f32,
    local_y: f32,
) -> Transform2D {
    let cos = rotation.radians.cos();
    let sin = rotation.radians.sin();
    Transform2D {
        x: transform.x + local_x * cos - local_y * sin,
        y: transform.y + local_x * sin + local_y * cos,
    }
}

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
    let anchor_transform = world.transform(anchor).unwrap();
    let anchor_rotation = world.rotation(anchor).unwrap_or_default();
    let anchor_a = world_anchor(anchor_transform, anchor_rotation, 4.0, 0.0);
    let anchor_b = world_anchor(transform, rotation, -4.0, 0.0);
    let anchor_error =
        ((anchor_b.x - anchor_a.x).powi(2) + (anchor_b.y - anchor_a.y).powi(2)).sqrt();
    assert!(stats.constraint_position_corrections > 0);
    assert!(
        anchor_error < 0.08,
        "weld joint should align authored local anchors, got anchor_a {anchor_a:?}, anchor_b {anchor_b:?}, body transform {transform:?}"
    );
    assert!(
        rotation.radians.abs() < 0.05,
        "weld joint should lock relative angle, got {rotation:?}"
    );
}

#[test]
fn weld_joint_anchor_position_correction_rotates_off_center_body() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());

    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_rotation(body, Rotation2D { radians: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic_box(1.0, 2.0, 2.0));
    world.add_weld_joint(
        WeldJoint::new(anchor, body)
            .with_local_anchor_b(0.0, 2.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0),
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

    let rotation = world.rotation(body).unwrap_or_default();
    assert_eq!(stats.constraint_position_corrections, 1);
    assert!(
        rotation.radians.abs() > 0.001,
        "off-center weld anchor correction should rotate the body, got {rotation:?}"
    );
}

#[test]
fn weld_joint_angular_only_correction_keeps_body_center() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rotation(anchor, Rotation2D { radians: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());

    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 2.0 });
    world.set_rotation(body, Rotation2D { radians: 0.5 });
    world.set_rigid_body(body, RigidBody::dynamic_box(1.0, 2.0, 2.0));
    world.add_weld_joint(
        WeldJoint::new(anchor, body)
            .with_local_anchor_b(0.0, 2.0)
            .with_stiffness(0.0)
            .with_angular_stiffness(1.0),
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

    let transform = world.transform(body).unwrap();
    let rotation = world.rotation(body).unwrap_or_default();
    assert_eq!(stats.constraint_position_corrections, 1);
    assert!(
        (transform.x - 4.0).abs() < 0.001 && (transform.y - 2.0).abs() < 0.001,
        "angular-only weld correction should not translate the body center, got {transform:?}"
    );
    assert!(
        rotation.radians.abs() < 0.001,
        "angular-only weld correction should lock relative angle, got {rotation:?}"
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
