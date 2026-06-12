use super::*;

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_convex_polygon() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        mover,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall = spawn_static_convex_polygon(
        &mut world,
        50.0,
        0.0,
        convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
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
            continuous: true,
        },
    );

    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast AABB should stop at convex polygon time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the AABB/polygon CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_aabb() {
    let mut world = World::default();
    let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
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
            continuous: true,
        },
    );

    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast convex polygon should stop at AABB time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the polygon/AABB CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_circle() {
    let mut world = World::default();
    let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 50.0, y: 0.0 });
    world.set_circle_collider(
        target,
        crate::components::CircleCollider {
            radius: 5.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Wall,
        },
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
            continuous: true,
        },
    );

    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast convex polygon should stop at circle time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the polygon/circle CCD impact, got {velocity:?}"
    );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_oriented_box() {
    let mut world = World::default();
    let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
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
            continuous: true,
        },
    );

    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast convex polygon should stop at oriented-box time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the polygon/oriented-box CCD impact, got {velocity:?}"
        );
}

#[test]
fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_capsule() {
    let mut world = World::default();
    let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 50.0, y: 0.0 });
    world.set_capsule_collider(
        target,
        CapsuleCollider::new(0.0, -4.0, 0.0, 4.0, 5.0, false, CollisionLayer::Wall),
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
            continuous: true,
        },
    );

    assert!(stats.ccd_checks > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert!(stats.velocity_impulses > 0);
    let transform = world.transform(mover).unwrap();
    assert!(
        (transform.x - 44.0).abs() < 0.001,
        "fast convex polygon should stop at capsule time of impact, got {transform:?}"
    );
    let velocity = world.velocity(mover).unwrap();
    assert!(
        velocity.vx.abs() < 0.001,
        "normal velocity should be removed by the polygon/capsule CCD impact, got {velocity:?}"
    );
}
