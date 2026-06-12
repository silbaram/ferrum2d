use super::*;

#[test]
fn rigid_body_step_resolves_dynamic_static_collision_with_restitution() {
    let mut world = World::default();
    let ball = spawn_dynamic_body(&mut world, 0.0, 4.0, 1.0);
    world.set_velocity(ball, Velocity { vx: 0.0, vy: 20.0 });
    world.set_rigid_body(
        ball,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.5, 0.0)),
    );
    let ground = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        10.0,
        CollisionLayer::Wall,
        false,
        20.0,
        1.0,
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.5, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.25,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 4,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert!(stats.velocity_impulses > 0);
    assert_eq!(stats.ccd_hits, 1);
    assert_eq!(stats.position_corrections, 0);
    let velocity = world.velocity(ball).unwrap();
    assert!(
        (velocity.vy + 10.0).abs() < 0.01,
        "velocity should bounce upward, got {velocity:?}"
    );
    let transform = world.transform(ball).unwrap();
    assert!(transform.y <= 8.0 + 0.01);
    assert_eq!(
        world.transform(ground),
        Some(Transform2D { x: 0.0, y: 10.0 })
    );
}

#[test]
fn rigid_body_step_resolves_dynamic_capsule_static_aabb_contact() {
    let mut world = World::default();
    let capsule = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
    );
    world.set_velocity(capsule, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(
        capsule,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 3.5, 0.0, CollisionLayer::Wall, false, 1.0, 3.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.016,
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

    let velocity = world.velocity(capsule).unwrap();
    let transform = world.transform(capsule).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert_eq!(stats.ccd_hits, 0);
    assert!(
        velocity.vx <= 0.01,
        "capsule should stop against wall: {velocity:?}"
    );
    assert!(
        transform.x < 0.0,
        "position correction should separate capsule from wall: {transform:?}"
    );
}

#[test]
fn rigid_body_step_resolves_dynamic_oriented_box_static_aabb_contact() {
    let mut world = World::default();
    let body = spawn_dynamic_oriented_box(
        &mut world,
        0.0,
        0.0,
        OrientedBoxCollider::new(1.0, 1.0, 0.0, false, CollisionLayer::Player),
    );
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 3.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.016,
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

    let velocity = world.velocity(body).unwrap();
    let transform = world.transform(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert_eq!(stats.ccd_hits, 0);
    assert!(
        velocity.vx <= 0.01,
        "oriented box should stop against wall: {velocity:?}"
    );
    assert!(
        transform.x < 0.0,
        "position correction should separate oriented box from wall: {transform:?}"
    );
}

#[test]
fn rigid_body_step_resolves_dynamic_aabb_static_convex_polygon_contact() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall = spawn_static_convex_polygon(
        &mut world,
        1.5,
        0.0,
        convex_polygon_collider(&[(-1.0, -3.0), (1.0, -3.0), (1.0, 3.0), (-1.0, 3.0)]),
    );
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.016,
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

    let velocity = world.velocity(body).unwrap();
    let transform = world.transform(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert_eq!(stats.ccd_hits, 0);
    assert!(
        velocity.vx <= 0.01,
        "AABB body should stop against polygon wall: {velocity:?}"
    );
    assert!(
        transform.x < 0.0,
        "position correction should separate AABB from polygon wall: {transform:?}"
    );
}

#[test]
fn rigid_body_restitution_threshold_suppresses_low_speed_bounce() {
    let mut world = World::default();
    let ball = spawn_dynamic_body(&mut world, 0.0, 8.5, 1.0);
    world.set_velocity(ball, Velocity { vx: 0.0, vy: 0.5 });
    world.set_rigid_body(
        ball,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
    );
    let ground = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        10.0,
        CollisionLayer::Wall,
        false,
        20.0,
        1.0,
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(1.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.01,
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

    assert!(stats.velocity_impulses > 0);
    assert!(stats.restitution_velocity_threshold_skips > 0);
    let velocity = world.velocity(ball).unwrap();
    assert!(
        velocity.vy.abs() < 0.001,
        "low-speed contact should stop without bounce, got {velocity:?}"
    );
    assert_eq!(
        world.transform(ground),
        Some(Transform2D { x: 0.0, y: 10.0 })
    );
}

#[test]
fn rigid_body_restitution_threshold_can_be_disabled_per_step() {
    let mut world = World::default();
    let ball = spawn_dynamic_body(&mut world, 0.0, 8.5, 1.0);
    world.set_velocity(ball, Velocity { vx: 0.0, vy: 0.5 });
    world.set_rigid_body(
        ball,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
    );
    let ground = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        10.0,
        CollisionLayer::Wall,
        false,
        20.0,
        1.0,
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(1.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.01,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: 0.0,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert!(stats.velocity_impulses > 0);
    assert_eq!(stats.restitution_velocity_threshold_skips, 0);
    let velocity = world.velocity(ball).unwrap();
    assert!(
        velocity.vy < -0.49,
        "disabled restitution threshold should allow low-speed bounce, got {velocity:?}"
    );
}

#[test]
fn rigid_body_restitution_threshold_sanitizes_invalid_config() {
    let mut world = World::default();
    let ball = spawn_dynamic_body(&mut world, 0.0, 8.5, 1.0);
    world.set_velocity(ball, Velocity { vx: 0.0, vy: 0.5 });
    world.set_rigid_body(
        ball,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
    );
    let ground = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        10.0,
        CollisionLayer::Wall,
        false,
        20.0,
        1.0,
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(1.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.01,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: f32::NAN,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert!(stats.restitution_velocity_threshold_skips > 0);
    let velocity = world.velocity(ball).unwrap();
    assert!(
        velocity.vy.abs() < 0.001,
        "invalid restitution threshold should fall back to default, got {velocity:?}"
    );
}

#[test]
fn rigid_body_surface_velocity_drives_tangent_contact_impulse() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 10.0)),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 2.0, CollisionLayer::Wall, false, 8.0, 1.0);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(
            PhysicsMaterial::new(0.0, 10.0).with_surface_velocity(Velocity { vx: 30.0, vy: 0.0 }),
        ),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity { vx: 0.0, vy: 20.0 },
            velocity_iterations: 4,
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

    let velocity = world.velocity(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert!(
        velocity.vx > 0.1,
        "surface velocity should push the dynamic body along the contact tangent, got {velocity:?}"
    );
}

#[test]
fn collider_material_overrides_rigid_body_material_for_contacts() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    world.set_collider_material(body, PhysicsMaterial::new(0.0, 10.0));
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 2.0, CollisionLayer::Wall, false, 8.0, 1.0);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    world.set_collider_material(
        ground,
        PhysicsMaterial::new(0.0, 10.0).with_surface_velocity(Velocity { vx: 30.0, vy: 0.0 }),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity { vx: 0.0, vy: 20.0 },
            velocity_iterations: 4,
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

    let velocity = world.velocity(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert!(
        velocity.vx > 0.1,
        "collider material should override body material in contact solving, got {velocity:?}"
    );
}

#[test]
fn secondary_compound_collider_material_overrides_body_material_for_contacts() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    assert_eq!(
        world.add_compound_collider(
            body,
            CompoundCollider::new(CompoundColliderShape::Aabb(
                AabbCollider::new(1.0, 1.0, false, CollisionLayer::Player).with_offset(0.0, 2.0),
            ))
            .with_filter(CollisionFilter::new(
                CollisionLayer::Player.mask(),
                CollisionMask::ALL,
            )),
        ),
        Some(1)
    );
    assert!(world.set_compound_collider_material(body, 1, PhysicsMaterial::new(0.0, 10.0)));
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 3.5, CollisionLayer::Wall, false, 8.0, 1.0);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    world.set_collider_material(
        ground,
        PhysicsMaterial::new(0.0, 10.0).with_surface_velocity(Velocity { vx: 30.0, vy: 0.0 }),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity { vx: 0.0, vy: 20.0 },
            velocity_iterations: 4,
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

    let velocity = world.velocity(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert!(
            velocity.vx > 0.1,
            "secondary compound collider material should participate in contact solving, got {velocity:?}"
        );
}

#[test]
fn rigid_body_step_splits_impulse_between_dynamic_bodies_by_mass() {
    let mut world = World::default();
    let left = spawn_dynamic_body(&mut world, -2.0, 0.0, 2.0);
    let right = spawn_dynamic_body(&mut world, 2.0, 0.0, 2.0);
    world.set_circle_collider(
        left,
        crate::components::CircleCollider {
            radius: 2.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Player,
        },
    );
    world.set_circle_collider(
        right,
        crate::components::CircleCollider {
            radius: 2.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Player,
        },
    );
    world.set_velocity(left, Velocity { vx: 10.0, vy: 0.0 });
    world.set_velocity(right, Velocity { vx: -2.0, vy: 0.0 });
    world.set_rigid_body(
        left,
        RigidBody::dynamic_circle(1.0, 2.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
    );
    world.set_rigid_body(
        right,
        RigidBody::dynamic_circle(3.0, 2.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
    );

    PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
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

    let left_velocity = world.velocity(left).unwrap();
    let right_velocity = world.velocity(right).unwrap();
    assert!(
        (left_velocity.vx + 8.0).abs() < 0.01,
        "left velocity changed to {left_velocity:?}, right velocity {right_velocity:?}"
    );
    assert!(
        (right_velocity.vx - 4.0).abs() < 0.01,
        "left velocity {left_velocity:?}, right velocity changed to {right_velocity:?}"
    );
}

#[test]
fn rigid_body_step_ignores_trigger_contacts() {
    let mut world = World::default();
    let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
    world.set_velocity(mover, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(mover, RigidBody::dynamic(1.0));
    spawn_kinematic_body(&mut world, 8.0, 0.0, CollisionLayer::Wall, true);

    PhysicsSystem::step_rigid_bodies_with_config(
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

    assert_eq!(world.velocity(mover), Some(Velocity { vx: 10.0, vy: 0.0 }));
}
