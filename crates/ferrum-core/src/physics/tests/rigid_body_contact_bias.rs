use super::*;

#[test]
fn rigid_body_contact_baumgarte_bias_separates_resting_overlap() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
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

    let velocity = world.velocity(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert!(stats.baumgarte_velocity_biases > 0);
    assert_eq!(stats.position_corrections, 0);
    assert!(
        velocity.vx < -0.001,
        "Baumgarte bias should create separating velocity for resting overlap, got {velocity:?}"
    );
}

#[test]
fn rigid_body_contact_split_impulse_corrects_overlap_without_velocity_bias() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 4,
            position_iterations: 0,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: true,
            continuous: true,
        },
    );

    let transform = world.transform(body).unwrap();
    let velocity = world.velocity(body).unwrap();
    assert_eq!(stats.position_corrections, 0);
    assert_eq!(stats.baumgarte_velocity_biases, 0);
    assert!(stats.split_velocity_impulses > 0);
    assert!(
        transform.x < -0.001,
        "split impulse should correct overlap through transform only, got {transform:?}"
    );
    assert!(
        velocity.vx.abs() < 0.001 && velocity.vy.abs() < 0.001,
        "split impulse should not inject separating linear velocity, got {velocity:?}"
    );
}

#[test]
fn rigid_body_contact_baumgarte_bias_respects_position_slop() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 1.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.velocity_impulses, 0);
    assert_eq!(stats.baumgarte_velocity_biases, 0);
    assert_eq!(stats.position_corrections, 0);
    assert_eq!(world.velocity(body), Some(Velocity::default()));
}

#[test]
fn rigid_body_contact_baumgarte_bias_can_be_disabled_per_step() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
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
            contact_baumgarte_bias_factor: 0.0,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.velocity_impulses, 0);
    assert_eq!(stats.baumgarte_velocity_biases, 0);
    assert_eq!(stats.position_corrections, 0);
    assert_eq!(world.velocity(body), Some(Velocity::default()));
}

#[test]
fn rigid_body_contact_baumgarte_bias_respects_material_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0).with_contact_baumgarte_bias_scale(0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
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

    assert_eq!(stats.velocity_impulses, 0);
    assert_eq!(stats.baumgarte_velocity_biases, 0);
    assert_eq!(stats.position_corrections, 0);
    assert_eq!(world.velocity(body), Some(Velocity::default()));
}

#[test]
fn rigid_body_contact_baumgarte_bias_respects_material_max_velocity_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
            PhysicsMaterial::new(0.0, 0.0).with_max_contact_baumgarte_bias_velocity_scale(0.0),
        ),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
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

    assert_eq!(stats.velocity_impulses, 0);
    assert_eq!(stats.baumgarte_velocity_biases, 0);
    assert_eq!(stats.position_corrections, 0);
    assert_eq!(world.velocity(body), Some(Velocity::default()));
}

#[test]
fn rigid_body_contact_baumgarte_bias_sanitizes_invalid_config() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
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
            contact_baumgarte_bias_factor: f32::NAN,
            max_contact_baumgarte_bias_velocity: f32::NAN,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let velocity = world.velocity(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert!(stats.baumgarte_velocity_biases > 0);
    assert_eq!(stats.position_corrections, 0);
    assert!(
        velocity.vx < -0.001,
        "invalid Baumgarte config should fall back to default, got {velocity:?}"
    );
}

#[test]
fn rigid_body_contact_baumgarte_bias_sanitizes_invalid_material_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
            PhysicsMaterial::new(0.0, 0.0)
                .with_contact_baumgarte_bias_scale(f32::NAN)
                .with_max_contact_baumgarte_bias_velocity_scale(f32::NAN),
        ),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
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

    let velocity = world.velocity(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert!(stats.baumgarte_velocity_biases > 0);
    assert_eq!(stats.position_corrections, 0);
    assert!(
        velocity.vx < -0.001,
        "invalid material Baumgarte scale should fall back to default, got {velocity:?}"
    );
}
