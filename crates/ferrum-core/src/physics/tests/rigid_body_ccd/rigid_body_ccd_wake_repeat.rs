use super::*;

#[test]
fn rigid_body_convex_polygon_ccd_wakes_sleeping_polygon_target() {
    let mut world = World::default();
    let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
    let sleeping = spawn_static_convex_polygon(
        &mut world,
        10.0,
        0.0,
        convex_polygon_collider(&[(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]),
    );
    world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        moving,
        RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let mut sleeping_body = RigidBody::dynamic_convex_polygon(
        1.0,
        convex_polygon_collider(&[(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]).vertices,
        4,
    )
    .with_material(PhysicsMaterial::new(0.0, 0.0));
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
            continuous: true,
        },
    );

    assert_eq!(stats.ccd_hits, 1);
    assert_eq!(stats.bodies_woken, 1);
    assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
    let moving_transform = world.transform(moving).unwrap();
    let sleeping_transform = world.transform(sleeping).unwrap();
    assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "polygon target CCD should keep bodies separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
    let moving_velocity = world.velocity(moving).unwrap();
    let sleeping_velocity = world.velocity(sleeping).unwrap();
    assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "polygon target CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
}

#[test]
fn rigid_body_oriented_box_ccd_wakes_sleeping_oriented_box_target() {
    let mut world = World::default();
    let moving = spawn_dynamic_oriented_box(
        &mut world,
        0.0,
        0.0,
        OrientedBoxCollider::new(0.5, 0.5, 0.0, false, CollisionLayer::Player),
    );
    let sleeping = spawn_dynamic_oriented_box(
        &mut world,
        10.0,
        0.0,
        OrientedBoxCollider::new(0.5, 0.5, 0.0, false, CollisionLayer::Player),
    );
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
            continuous: true,
        },
    );

    assert_eq!(stats.ccd_hits, 1);
    assert_eq!(stats.bodies_woken, 1);
    assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
    let moving_transform = world.transform(moving).unwrap();
    let sleeping_transform = world.transform(sleeping).unwrap();
    assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "oriented box CCD should keep targets separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
    let moving_velocity = world.velocity(moving).unwrap();
    let sleeping_velocity = world.velocity(sleeping).unwrap();
    assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "oriented box CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
}

#[test]
fn rigid_body_capsule_ccd_wakes_sleeping_capsule_target() {
    let mut world = World::default();
    let moving = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(0.0, -0.5, 0.0, 0.5, 0.5, false, CollisionLayer::Player),
    );
    let sleeping = spawn_dynamic_capsule(
        &mut world,
        10.0,
        0.0,
        CapsuleCollider::new(0.0, -0.5, 0.0, 0.5, 0.5, false, CollisionLayer::Player),
    );
    world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        moving,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let mut sleeping_body = RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0));
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
            continuous: true,
        },
    );

    assert_eq!(stats.ccd_hits, 1);
    assert_eq!(stats.bodies_woken, 1);
    assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
    let moving_transform = world.transform(moving).unwrap();
    let sleeping_transform = world.transform(sleeping).unwrap();
    assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "capsule CCD should keep targets separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
    let moving_velocity = world.velocity(moving).unwrap();
    let sleeping_velocity = world.velocity(sleeping).unwrap();
    assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "capsule CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
}

#[test]
fn rigid_body_ccd_repeats_for_remaining_step_time() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(
        mover,
        Velocity {
            vx: 100.0,
            vy: 100.0,
        },
    );
    world.set_rigid_body(
        mover,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let vertical_wall = spawn_kinematic_body_with_size(
        &mut world,
        50.0,
        40.0,
        CollisionLayer::Wall,
        false,
        5.0,
        100.0,
    );
    let horizontal_wall = spawn_kinematic_body_with_size(
        &mut world,
        40.0,
        70.0,
        CollisionLayer::Wall,
        false,
        100.0,
        5.0,
    );
    for wall in [vertical_wall, horizontal_wall] {
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
    }

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
            continuous: true,
        },
    );

    assert_eq!(stats.ccd_hits, 2);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001 && (transform.y - 64.0).abs() < 0.001,
        "multi-TOI CCD should stop against both walls, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001 && velocity.vy.abs() < 0.001,
        "both normal components should be removed after repeated CCD hits, got {velocity:?}"
    );
}

#[test]
fn rigid_body_circle_ccd_wakes_sleeping_circle_target() {
    let mut world = World::default();
    let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
    let sleeping = spawn_dynamic_body(&mut world, 10.0, 0.0, 0.5);
    for entity in [moving, sleeping] {
        world.set_circle_collider(
            entity,
            crate::components::CircleCollider {
                radius: 0.5,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Player,
            },
        );
    }
    world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        moving,
        RigidBody::dynamic_circle(1.0, 0.5).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let mut sleeping_body =
        RigidBody::dynamic_circle(1.0, 0.5).with_material(PhysicsMaterial::new(0.0, 0.0));
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
            continuous: true,
        },
    );

    assert_eq!(stats.ccd_hits, 1);
    assert_eq!(stats.bodies_woken, 1);
    assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
    let moving_transform = world.transform(moving).unwrap();
    let sleeping_transform = world.transform(sleeping).unwrap();
    assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "circle CCD should keep targets separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
    let moving_velocity = world.velocity(moving).unwrap();
    let sleeping_velocity = world.velocity(sleeping).unwrap();
    assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "circle CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
}
