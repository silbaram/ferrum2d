use super::*;

#[test]
fn rigid_body_step_puts_idle_dynamic_body_to_sleep() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic(1.0)
            .with_gravity_scale(0.0)
            .with_sleeping_enabled(true),
    );

    let config = RigidBodyStepConfig {
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
    };
    let first = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);
    let second = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);
    let third = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);

    assert_eq!(first.bodies_put_to_sleep, 0);
    assert_eq!(second.bodies_put_to_sleep, 1);
    assert_eq!(second.sleeping_bodies, 1);
    assert_eq!(third.dynamic_bodies, 0);
    assert_eq!(third.sleeping_bodies, 1);
    let body_component = world.rigid_body(body).unwrap();
    assert!(body_component.is_sleeping);
    assert_eq!(world.velocity(body), Some(Velocity::default()));
    assert_eq!(
        world.angular_velocity(body),
        Some(AngularVelocity::default())
    );
}

#[test]
fn rigid_body_island_sleep_puts_connected_idle_bodies_to_sleep_together() {
    let mut world = World::default();
    let left = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    let right = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    for entity in [left, right] {
        world.set_rigid_body(
            entity,
            RigidBody::dynamic(1.0)
                .with_gravity_scale(0.0)
                .with_sleeping_enabled(true),
        );
    }
    world.add_distance_joint(DistanceJoint::new(left, right, 10.0));

    let config = RigidBodyStepConfig {
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
    };
    let first = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);
    let second = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);

    assert_eq!(first.bodies_put_to_sleep, 0);
    assert_eq!(first.islands_put_to_sleep, 0);
    assert_eq!(second.bodies_put_to_sleep, 2);
    assert_eq!(second.islands_put_to_sleep, 1);
    assert_eq!(second.sleeping_bodies, 2);
    assert_eq!(second.active_islands, 0);
    assert_eq!(second.sleeping_islands, 1);
    assert!(world.rigid_body(left).unwrap().is_sleeping);
    assert!(world.rigid_body(right).unwrap().is_sleeping);
}

#[test]
fn rigid_body_island_sleep_waits_for_connected_active_body() {
    let mut world = World::default();
    let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    let idle = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    for entity in [active, idle] {
        world.set_rigid_body(
            entity,
            RigidBody::dynamic(1.0)
                .with_gravity_scale(0.0)
                .with_sleeping_enabled(true),
        );
    }
    world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
    world.add_distance_joint(DistanceJoint::new(active, idle, 10.0));

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
            continuous: true,
        },
    );

    assert_eq!(stats.bodies_put_to_sleep, 0);
    assert_eq!(stats.islands_put_to_sleep, 0);
    assert_eq!(stats.sleeping_bodies, 0);
    assert!(!world.rigid_body(active).unwrap().is_sleeping);
    assert!(!world.rigid_body(idle).unwrap().is_sleeping);
    assert_eq!(
        world.rigid_body(idle).unwrap().sleep_timer_seconds,
        DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS
    );
}

#[test]
fn rigid_body_impulse_wakes_sleeping_body() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    let mut rigid_body = RigidBody::dynamic(1.0);
    rigid_body.is_sleeping = true;
    rigid_body.sleep_timer_seconds = 0.5;
    world.set_rigid_body(body, rigid_body);

    world.apply_impulse(body, Velocity { vx: 2.0, vy: 0.0 });

    let body_component = world.rigid_body(body).unwrap();
    assert!(!body_component.is_sleeping);
    assert_eq!(body_component.sleep_timer_seconds, 0.0);
    assert_eq!(body_component.impulse, Velocity { vx: 2.0, vy: 0.0 });
}

#[test]
fn rigid_body_contact_wakes_sleeping_dynamic_body() {
    let mut world = World::default();
    let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(active, RigidBody::dynamic(1.0));
    let sleeping = spawn_dynamic_body(&mut world, 2.0, 0.0, 1.0);
    let mut sleeping_body = RigidBody::dynamic(1.0);
    sleeping_body.is_sleeping = true;
    sleeping_body.sleep_timer_seconds = 0.5;
    world.set_rigid_body(sleeping, sleeping_body);

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

    assert_eq!(stats.bodies_woken, 1);
    assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
}

#[test]
fn rigid_body_island_wake_reaches_joint_connected_sleeping_bodies() {
    let mut world = World::default();
    let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    let sleeping_a = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
    let sleeping_b = spawn_dynamic_body(&mut world, 20.0, 0.0, 1.0);

    world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
    for entity in [sleeping_a, sleeping_b] {
        let mut body = RigidBody::dynamic(1.0);
        body.is_sleeping = true;
        body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(entity, body);
    }
    world.add_distance_joint(DistanceJoint::new(active, sleeping_a, 10.0));
    world.add_distance_joint(DistanceJoint::new(sleeping_a, sleeping_b, 10.0));

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

    assert_eq!(stats.bodies_woken, 2);
    assert_eq!(stats.islands_woken, 1);
    assert!(!world.rigid_body(sleeping_a).unwrap().is_sleeping);
    assert!(!world.rigid_body(sleeping_b).unwrap().is_sleeping);
    assert_eq!(stats.active_islands, 1);
    assert_eq!(stats.sleeping_islands, 0);
}

#[test]
fn rigid_body_island_wake_ignores_disabled_joints() {
    let mut world = World::default();
    let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    let sleeping = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);

    world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
    let mut sleeping_body = RigidBody::dynamic(1.0);
    sleeping_body.is_sleeping = true;
    sleeping_body.sleep_timer_seconds = 0.5;
    world.set_rigid_body(sleeping, sleeping_body);
    world.add_distance_joint(DistanceJoint::new(active, sleeping, 10.0).with_enabled(false));

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

    assert_eq!(stats.bodies_woken, 0);
    assert_eq!(stats.islands_woken, 0);
    assert!(world.rigid_body(sleeping).unwrap().is_sleeping);
    assert_eq!(stats.active_islands, 1);
    assert_eq!(stats.sleeping_islands, 1);
}
