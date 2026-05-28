use super::*;

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_dynamic_aabb() {
    let mut world = World::default();
    let left = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
    let right = spawn_dynamic_body(&mut world, 10.0, 0.0, 0.5);
    world.set_velocity(left, Velocity { vx: 100.0, vy: 0.0 });
    world.set_velocity(
        right,
        Velocity {
            vx: -100.0,
            vy: 0.0,
        },
    );
    world.set_rigid_body(
        left,
        RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    world.set_rigid_body(
        right,
        RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
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
        },
    );

    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert!(stats.velocity_impulses > 0);
    let left_transform = world.transform(left).unwrap();
    let right_transform = world.transform(right).unwrap();
    assert!(
            left_transform.x <= right_transform.x - 1.0 + 0.001,
            "dynamic bodies should stop at or before contact, got left={left_transform:?}, right={right_transform:?}"
        );
    let left_velocity = world.velocity(left).unwrap();
    let right_velocity = world.velocity(right).unwrap();
    assert!(
            left_velocity.vx.abs() < 0.001 && right_velocity.vx.abs() < 0.001,
            "inelastic dynamic-dynamic CCD should stop equal-mass bodies, got left={left_velocity:?}, right={right_velocity:?}"
        );
}

#[test]
fn rigid_body_dynamic_dynamic_ccd_wakes_sleeping_target() {
    let mut world = World::default();
    let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
    let sleeping = spawn_dynamic_body(&mut world, 10.0, 0.0, 0.5);
    world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        moving,
        RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let mut sleeping_body =
        RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0));
    sleeping_body.is_sleeping = true;
    sleeping_body.sleep_timer_seconds = 0.5;
    world.set_rigid_body(sleeping, sleeping_body);

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.2,
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

    assert_eq!(stats.ccd_hits, 1);
    assert_eq!(stats.bodies_woken, 1);
    assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
    let moving_velocity = world.velocity(moving).unwrap();
    let sleeping_velocity = world.velocity(sleeping).unwrap();
    assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        mover,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall = spawn_kinematic_body_with_size(
        &mut world,
        50.0,
        0.0,
        CollisionLayer::Wall,
        false,
        5.0,
        5.0,
    );
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

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

    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    let debug_hit = world
        .rigid_body_ccd_debug_hit_at(0)
        .expect("CCD impact should record a debug hit");
    assert_eq!(world.rigid_body_ccd_debug_hit_count(), 1);
    assert_eq!(debug_hit.moving_entity, mover);
    assert_eq!(debug_hit.target_entity, wall);
    assert!((debug_hit.point_x - 45.0).abs() < 0.001);
    assert!((debug_hit.point_y - 0.0).abs() < 0.001);
    assert!((debug_hit.normal_x - 1.0).abs() < 0.001);
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast body should stop at first time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the CCD impact, got {velocity:?}"
    );
    assert_eq!(world.transform(wall), Some(Transform2D { x: 50.0, y: 0.0 }));
}
