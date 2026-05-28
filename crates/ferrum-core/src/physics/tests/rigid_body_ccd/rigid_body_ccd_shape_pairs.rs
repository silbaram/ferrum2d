use super::*;

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_circle_against_aabb() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_circle_collider(
        mover,
        crate::components::CircleCollider {
            radius: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Player,
        },
    );
    world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        mover,
        RigidBody::dynamic_circle(1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
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
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast circle should stop at first time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the circle CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_circle() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        mover,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let target = spawn_kinematic_body_with_size(
        &mut world,
        50.0,
        0.0,
        CollisionLayer::Wall,
        false,
        1.0,
        1.0,
    );
    world.set_circle_collider(
        target,
        crate::components::CircleCollider {
            radius: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Wall,
        },
    );
    world.set_rigid_body(
        target,
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
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 48.0).abs() < 0.001,
        "fast AABB should stop at circle time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the AABB/circle CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_capsule_against_aabb() {
    let mut world = World::default();
    let mover = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
    );
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
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 42.0).abs() < 0.001,
        "fast capsule should stop at first time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the capsule CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_capsule() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        mover,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 50.0, y: 0.0 });
    world.set_capsule_collider(
        target,
        CapsuleCollider::new(0.0, -4.0, 0.0, 4.0, 1.0, false, CollisionLayer::Wall),
    );
    world.set_collision_filter(
        target,
        CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        target,
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
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 48.0).abs() < 0.001,
        "fast AABB should stop at capsule time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the AABB/capsule CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_oriented_box_against_aabb() {
    let mut world = World::default();
    let mover = spawn_dynamic_oriented_box(
        &mut world,
        0.0,
        0.0,
        OrientedBoxCollider::new(
            1.0,
            1.0,
            std::f32::consts::FRAC_PI_4,
            false,
            CollisionLayer::Player,
        ),
    );
    world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        mover,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
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

    let expected_x = 45.0 - 2.0_f32.sqrt();
    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - expected_x).abs() < 0.01,
        "fast oriented box should stop at first time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the oriented box CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_oriented_box() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        mover,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall = spawn_dynamic_oriented_box(
        &mut world,
        50.0,
        0.0,
        OrientedBoxCollider::new(5.0, 5.0, 0.0, false, CollisionLayer::Wall),
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
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast AABB should stop at oriented box time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the AABB/oriented-box CCD impact, got {velocity:?}"
    );
}
