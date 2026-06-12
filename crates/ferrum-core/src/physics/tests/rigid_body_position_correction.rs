use super::*;

#[test]
fn angular_contact_response_uses_offset_contact_point() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 1.0, 2.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 4.0, 4.0)
            .with_inertia(1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    let wall =
        spawn_kinematic_body_with_size(&mut world, 8.0, 0.0, CollisionLayer::Wall, false, 2.0, 2.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

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

    let velocity = world.velocity(body).unwrap();
    let angular_velocity = world.angular_velocity(body).unwrap();
    assert!(stats.velocity_impulses > 0);
    assert!(velocity.vx < 10.0);
    assert!(velocity.vy.abs() < 0.001);
    assert!(
            angular_velocity.radians_per_second.abs() > 0.001,
            "expected offset manifold contact to create angular velocity, got {angular_velocity:?} with {velocity:?} and {stats:?}"
        );
}

#[test]
fn rigid_body_split_position_correction_uses_contact_point_inertia() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 1.0, 2.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 4.0, 4.0)
            .with_inertia(1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let wall = spawn_kinematic_body_with_size(
        &mut world,
        3.0,
        -1.0,
        CollisionLayer::Wall,
        false,
        2.0,
        2.0,
    );
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
            position_correction_percent: 1.0,
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
    assert_eq!(stats.position_corrections, 1);
    assert_eq!(stats.split_position_corrections, 1);
    assert!(
        transform.x < -0.001,
        "split position correction should move dynamic body out of penetration, got {transform:?}"
    );
    assert!(
            rotation.radians < -0.001,
            "off-center contact point correction should rotate dynamic body through inverse inertia, got {rotation:?}"
        );
    assert_eq!(world.transform(wall), Some(Transform2D { x: 3.0, y: -1.0 }));
    assert_eq!(world.rotation(wall).unwrap_or_default().radians, 0.0);
}

#[test]
fn rigid_body_position_phase_rebuilds_contacts_when_reusing_scratch() {
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
            position_iterations: 3,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let transform = world.transform(body).unwrap();
    assert_eq!(stats.position_corrections, 1);
    assert_eq!(stats.position_contact_rebuilds, 2);
    assert!(
        (transform.x + 0.5).abs() < 0.001,
        "position contacts should be rebuilt after the first correction instead of reusing stale contacts, got {transform:?}"
    );
    assert_eq!(world.transform(wall), Some(Transform2D { x: 1.5, y: 0.0 }));
}

#[test]
fn rigid_body_position_phase_exits_after_converged_iteration() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 8,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.position_contact_rebuilds, 1);
    assert_eq!(stats.position_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
}

#[test]
fn rigid_body_split_position_correction_respects_material_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_scale(0.0),
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
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: 0.0,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.position_corrections, 0);
    assert_eq!(stats.split_position_corrections, 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
    assert_eq!(world.velocity(body), Some(Velocity::default()));
}

#[test]
fn rigid_body_split_position_correction_uses_collider_material_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    world.set_collider_material(
        body,
        PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_scale(0.0),
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
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: 0.0,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.position_corrections, 0);
    assert_eq!(stats.split_position_corrections, 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
}

#[test]
fn rigid_body_split_position_correction_sanitizes_invalid_material_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_scale(f32::NAN),
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
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: 0.0,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let transform = world.transform(body).unwrap();
    assert_eq!(stats.position_corrections, 1);
    assert_eq!(stats.split_position_corrections, 1);
    assert!(
        transform.x < -0.001,
        "invalid material position correction scale should fall back to default, got {transform:?}"
    );
}

#[test]
fn rigid_body_split_position_correction_respects_material_slop_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(2.0),
        ),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(2.0),
        ),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 1.0,
            position_correction_slop: 0.25,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: 0.0,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.position_corrections, 0);
    assert_eq!(stats.split_position_corrections, 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
}

#[test]
fn rigid_body_split_position_correction_uses_collider_material_slop_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(0.0),
        ),
    );
    world.set_collider_material(
        body,
        PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(1.0),
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
            position_correction_percent: 1.0,
            position_correction_slop: 1.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: 0.0,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.position_corrections, 0);
    assert_eq!(stats.split_position_corrections, 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
}

#[test]
fn rigid_body_split_position_correction_sanitizes_invalid_material_slop_scale() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(f32::NAN),
        ),
    );
    let wall =
        spawn_kinematic_body_with_size(&mut world, 1.5, 0.0, CollisionLayer::Wall, false, 1.0, 1.0);
    world.set_rigid_body(
        wall,
        RigidBody::static_body().with_material(
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(f32::NAN),
        ),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 1.0,
            position_correction_slop: 0.25,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: 0.0,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let transform = world.transform(body).unwrap();
    assert_eq!(stats.position_corrections, 1);
    assert_eq!(stats.split_position_corrections, 1);
    assert!(
            transform.x < -0.001,
            "invalid material position correction slop scale should fall back to default, got {transform:?}"
        );
}

#[test]
fn rigid_body_step_warm_starts_persistent_contacts() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 2.0, CollisionLayer::Wall, false, 8.0, 1.0);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let config = RigidBodyStepConfig {
        gravity: Velocity { vx: 0.0, vy: 10.0 },
        velocity_iterations: 4,
        position_iterations: 1,
        position_correction_percent: 1.0,
        position_correction_slop: 0.0,
        restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
        contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
        max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
        contact_split_impulse: false,
        continuous: true,
    };
    let first = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.1, config);
    let second = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.1, config);

    assert_eq!(first.warm_start_impulses, 0);
    assert!(first.contact_cache_entries > 0);
    assert!(second.warm_start_impulses > 0);
    assert!(second.contact_cache_entries > 0);
}

#[test]
fn rigid_body_step_exposes_post_solve_contact_impulses() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 2.0, CollisionLayer::Wall, false, 8.0, 1.0);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity { vx: 0.0, vy: 10.0 },
            velocity_iterations: 2,
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

    let impulses: Vec<_> = world.rigid_contact_impulses().collect();
    assert_eq!(world.rigid_contact_impulse_count(), impulses.len());
    assert_eq!(stats.contact_cache_entries as usize, impulses.len());
    assert!(world.rigid_contact_impulse_at(impulses.len()).is_none());
    assert!(
        impulses.iter().any(|impulse| {
            impulse.entity_a == body && impulse.entity_b == ground
                || impulse.entity_a == ground && impulse.entity_b == body
        }),
        "expected body/ground contact impulse, got {impulses:?}"
    );
    assert!(
        impulses
            .iter()
            .any(|impulse| impulse.normal_impulse > CONTACT_IMPULSE_EPSILON),
        "expected at least one positive normal impulse, got {impulses:?}"
    );
    for impulse in impulses {
        assert!(impulse.point_x.is_finite());
        assert!(impulse.point_y.is_finite());
        assert!(impulse.normal_x.is_finite());
        assert!(impulse.normal_y.is_finite());
        assert!(impulse.normal_impulse.is_finite());
        assert!(impulse.tangent_impulse.is_finite());
        assert!(impulse.normal_impulse >= 0.0);
    }
}
