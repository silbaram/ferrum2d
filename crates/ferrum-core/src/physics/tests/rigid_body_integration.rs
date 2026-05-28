use super::*;

#[test]
fn rigid_body_step_integrates_force_impulse_gravity_and_damping() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic(2.0)
            .with_gravity_scale(1.0)
            .with_linear_damping(0.5),
    );
    world.apply_force(body, Velocity { vx: 4.0, vy: 0.0 });
    world.apply_impulse(body, Velocity { vx: 2.0, vy: 0.0 });

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        1.0,
        RigidBodyStepConfig {
            gravity: Velocity { vx: 0.0, vy: 10.0 },
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

    assert_eq!(stats.dynamic_bodies, 1);
    assert_eq!(world.velocity(body), Some(Velocity { vx: 1.5, vy: 5.0 }));
    assert_eq!(world.transform(body), Some(Transform2D { x: 1.5, y: 5.0 }));
    let body_component = world.rigid_body(body).unwrap();
    assert_eq!(body_component.force, Velocity::default());
    assert_eq!(body_component.impulse, Velocity::default());
}

#[test]
fn rigid_body_substeps_apply_forces_across_substeps_and_impulses_once() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    world.set_rigid_body(body, RigidBody::dynamic(2.0).with_sleeping_enabled(false));
    world.set_rotation(body, Rotation2D { radians: 0.0 });
    world.apply_force(body, Velocity { vx: 4.0, vy: 0.0 });
    world.apply_impulse(body, Velocity { vx: 2.0, vy: 0.0 });
    world.apply_torque(body, 4.0);
    world.apply_angular_impulse(body, 2.0);

    let stats = PhysicsSystem::step_rigid_bodies_substepped_with_config(
        &mut world,
        1.0,
        4,
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

    assert_eq!(stats.substeps, 4);
    assert_eq!(stats.dynamic_bodies, 4);
    assert_eq!(stats.angular_bodies, 4);
    assert_eq!(world.velocity(body), Some(Velocity { vx: 3.0, vy: 0.0 }));
    assert_eq!(
        world.angular_velocity(body),
        Some(AngularVelocity {
            radians_per_second: 3.0
        })
    );
    assert_eq!(world.transform(body), Some(Transform2D { x: 2.25, y: 0.0 }));
    assert_eq!(world.rotation(body), Some(Rotation2D { radians: 2.25 }));
    let body_component = world.rigid_body(body).unwrap();
    assert_eq!(body_component.force, Velocity::default());
    assert_eq!(body_component.impulse, Velocity::default());
    assert_eq!(body_component.torque, 0.0);
    assert_eq!(body_component.angular_impulse, 0.0);
}

#[test]
fn rigid_body_substeps_clamp_invalid_and_large_counts() {
    let mut zero_world = World::default();
    let zero_body = spawn_dynamic_body(&mut zero_world, 0.0, 0.0, 2.0);
    zero_world.set_rigid_body(
        zero_body,
        RigidBody::dynamic(1.0)
            .with_gravity_scale(0.0)
            .with_sleeping_enabled(false),
    );
    zero_world.set_velocity(zero_body, Velocity { vx: 1.0, vy: 0.0 });

    let zero_stats = PhysicsSystem::step_rigid_bodies_substepped(&mut zero_world, 1.0, 0);

    assert_eq!(zero_stats.substeps, 1);
    assert_eq!(
        zero_world.transform(zero_body),
        Some(Transform2D { x: 1.0, y: 0.0 })
    );

    let mut large_world = World::default();
    let large_body = spawn_dynamic_body(&mut large_world, 0.0, 0.0, 2.0);
    large_world.set_rigid_body(
        large_body,
        RigidBody::dynamic(1.0)
            .with_gravity_scale(0.0)
            .with_sleeping_enabled(false),
    );
    large_world.set_velocity(large_body, Velocity { vx: 1.0, vy: 0.0 });

    let large_stats = PhysicsSystem::step_rigid_bodies_substepped(&mut large_world, 1.0, 99);

    assert_eq!(large_stats.substeps, MAX_RIGID_BODY_SUBSTEPS);
    assert_eq!(large_stats.dynamic_bodies, MAX_RIGID_BODY_SUBSTEPS);
    assert_eq!(
        large_world.transform(large_body),
        Some(Transform2D { x: 1.0, y: 0.0 })
    );
}

#[test]
fn disabled_rigid_body_skips_integration_and_clears_accumulators() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    let mut rigid_body = RigidBody::dynamic(2.0).with_enabled(false);
    rigid_body.force = Velocity { vx: 4.0, vy: 0.0 };
    rigid_body.impulse = Velocity { vx: 2.0, vy: 0.0 };
    rigid_body.torque = 6.0;
    rigid_body.angular_impulse = 3.0;
    world.set_rigid_body(body, rigid_body);
    world.set_velocity(body, Velocity { vx: 3.0, vy: 4.0 });
    world.set_angular_velocity(
        body,
        AngularVelocity {
            radians_per_second: 2.0,
        },
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        1.0,
        RigidBodyStepConfig {
            gravity: Velocity { vx: 0.0, vy: 10.0 },
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

    assert_eq!(stats.dynamic_bodies, 0);
    assert_eq!(stats.angular_bodies, 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
    assert_eq!(world.velocity(body), Some(Velocity { vx: 3.0, vy: 4.0 }));
    assert_eq!(
        world.angular_velocity(body),
        Some(AngularVelocity {
            radians_per_second: 2.0,
        })
    );
    let body_component = world.rigid_body(body).unwrap();
    assert_eq!(body_component.force, Velocity::default());
    assert_eq!(body_component.impulse, Velocity::default());
    assert_eq!(body_component.torque, 0.0);
    assert_eq!(body_component.angular_impulse, 0.0);
}

#[test]
fn disabled_rigid_body_is_ignored_by_contact_solver() {
    let mut world = World::default();
    let disabled = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    world.set_rigid_body(disabled, RigidBody::dynamic(1.0).with_enabled(false));
    let active = spawn_dynamic_body(&mut world, 1.0, 0.0, 2.0);

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

    assert_eq!(stats.velocity_impulses, 0);
    assert_eq!(stats.position_corrections, 0);
    assert_eq!(
        world.transform(disabled),
        Some(Transform2D { x: 0.0, y: 0.0 })
    );
    assert_eq!(
        world.transform(active),
        Some(Transform2D { x: 1.0, y: 0.0 })
    );
    assert_eq!(world.velocity(active), Some(Velocity::default()));
}

#[test]
fn disabled_collider_is_ignored_by_rigid_body_contact_solver() {
    let mut world = World::default();
    let disabled = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    world.set_aabb_collider(
        disabled,
        AabbCollider::new(2.0, 2.0, false, CollisionLayer::Player).with_enabled(false),
    );
    let active = spawn_dynamic_body(&mut world, 1.0, 0.0, 2.0);

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

    assert_eq!(stats.contact_checks, 0);
    assert_eq!(
        world.transform(disabled),
        Some(Transform2D { x: 0.0, y: 0.0 })
    );
    assert_eq!(
        world.transform(active),
        Some(Transform2D { x: 1.0, y: 0.0 })
    );
}

#[test]
fn angular_body_step_integrates_torque_impulse_and_damping() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic(2.0)
            .with_inertia(2.0)
            .with_angular_damping(0.5),
    );
    world.apply_torque(body, 4.0);
    world.apply_angular_impulse(body, 2.0);

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        1.0,
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

    assert_eq!(stats.dynamic_bodies, 1);
    assert_eq!(stats.angular_bodies, 1);
    assert_eq!(
        world.angular_velocity(body),
        Some(AngularVelocity {
            radians_per_second: 1.5,
        })
    );
    assert_eq!(world.rotation(body), Some(Rotation2D { radians: 1.5 }));
    let body_component = world.rigid_body(body).unwrap();
    assert_eq!(body_component.torque, 0.0);
    assert_eq!(body_component.angular_impulse, 0.0);
}

#[test]
fn angular_body_step_integrates_kinematic_rotation_only() {
    let mut world = World::default();
    let body = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, false);
    world.set_rigid_body(body, RigidBody::kinematic());
    world.set_rotation(body, Rotation2D { radians: 1.0 });
    world.set_angular_velocity(
        body,
        AngularVelocity {
            radians_per_second: 3.0,
        },
    );
    world.apply_torque(body, 100.0);
    world.apply_angular_impulse(body, 100.0);

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.5,
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

    assert_eq!(stats.dynamic_bodies, 0);
    assert_eq!(stats.angular_bodies, 0);
    assert_eq!(world.rotation(body), Some(Rotation2D { radians: 2.5 }));
    assert_eq!(
        world.angular_velocity(body),
        Some(AngularVelocity {
            radians_per_second: 3.0,
        })
    );
}

#[test]
fn angular_body_step_ignores_static_and_invalid_inertia() {
    let mut world = World::default();
    let static_body = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
    world.set_rigid_body(static_body, RigidBody::static_body());
    world.set_rotation(static_body, Rotation2D { radians: 2.0 });
    world.set_angular_velocity(
        static_body,
        AngularVelocity {
            radians_per_second: 5.0,
        },
    );

    let invalid_body = spawn_dynamic_body(&mut world, 20.0, 0.0, 2.0);
    let mut invalid_rigid_body = RigidBody::dynamic(1.0);
    invalid_rigid_body.inverse_inertia = f32::NAN;
    invalid_rigid_body.angular_damping = f32::NAN;
    world.set_rigid_body(invalid_body, invalid_rigid_body);
    world.apply_torque(invalid_body, 10.0);
    world.apply_angular_impulse(invalid_body, 10.0);

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        1.0,
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

    assert_eq!(stats.dynamic_bodies, 1);
    assert_eq!(stats.angular_bodies, 0);
    assert_eq!(
        world.rotation(static_body),
        Some(Rotation2D { radians: 2.0 })
    );
    assert_eq!(
        world.rotation(invalid_body),
        Some(Rotation2D { radians: 0.0 })
    );
    let invalid_rigid_body = world.rigid_body(invalid_body).unwrap();
    assert_eq!(invalid_rigid_body.torque, 0.0);
    assert_eq!(invalid_rigid_body.angular_impulse, 0.0);
}
