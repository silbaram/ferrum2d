use super::*;
use crate::alloc_prelude::*;
use crate::num::Zero;
use crate::prelude::*;

fn limits() -> StoredBodyNumericLimits {
    StoredBodyNumericLimits {
        max_work: 1_000_000,
        max_additional_solver_iterations: 32,
        max_additional_pgs_iterations: 32,
    }
}
fn check(world: &PhysicsWorld) -> Result<usize, StoredBodyNumericError> {
    validate_stored_body_numerics(&world.bodies, &world.colliders, limits())
}
fn scene() -> (PhysicsWorld, RigidBodyHandle, ColliderHandle) {
    let mut world = PhysicsWorld::new();
    world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.5, 0.0)),
        ColliderBuilder::cuboid(5.0, 0.5, 5.0),
    );
    let (body, collider) = world.insert(
        RigidBodyBuilder::dynamic().translation(Vector::new(0.0, 0.5, 0.0)),
        ColliderBuilder::ball(0.5),
    );
    for _ in 0..4 {
        world.step();
    }
    (world, body, collider)
}
fn unchanged_and_replay(world: &PhysicsWorld) {
    let before = bincode::serialize(world).unwrap();
    let pairs: Vec<_> = world
        .narrow_phase
        .contact_pairs()
        .map(|pair| (pair.collider1, pair.collider2))
        .collect();
    check(world).unwrap();
    assert_eq!(bincode::serialize(world).unwrap(), before);
    assert_eq!(
        world
            .narrow_phase
            .contact_pairs()
            .map(|pair| (pair.collider1, pair.collider2))
            .collect::<Vec<_>>(),
        pairs
    );
    let mut expected: PhysicsWorld = bincode::deserialize(&before).unwrap();
    let mut restored: PhysicsWorld = bincode::deserialize(&before).unwrap();
    check(&restored).unwrap();
    for _ in 0..4 {
        expected.step();
        restored.step();
        assert_eq!(
            bincode::serialize(&expected).unwrap(),
            bincode::serialize(&restored).unwrap()
        );
        check(&restored).unwrap();
    }
}

#[test]
fn stored_body_numerics_rejects_body_payload_tampering_without_mutation() {
    type Tamper = fn(&mut RigidBody);
    let cases: &[Tamper] = &[
        |body| body.pos.position.translation.x = f32::NAN,
        |body| body.pos.position.rotation = Rotation::from_array([0.0; 4]),
        |body| body.pos.next_position.translation.x = f32::NAN,
        |body| body.pos.next_position.rotation = Rotation::from_array([0.0, 0.0, 0.0, 2.0]),
        |body| body.vels.linvel.x = f32::INFINITY,
        |body| body.vels.angvel.y = f32::NAN,
        |body| body.ccd_vels.linvel.z = f32::NAN,
        |body| body.ccd_vels.angvel.x = f32::NEG_INFINITY,
        |body| body.forces.force.x = f32::NAN,
        |body| body.forces.torque.x = f32::NAN,
        |body| body.forces.user_force.x = f32::NAN,
        |body| body.forces.user_torque.x = f32::NAN,
        |body| body.forces.gravity_scale = f32::NAN,
        |body| body.damping.linear_damping = -1.0,
        |body| body.damping.angular_damping = f32::INFINITY,
        |body| body.mprops.local_mprops.local_com.x = f32::NAN,
        |body| body.mprops.local_mprops.inv_mass = -1.0,
        |body| body.mprops.local_mprops.inv_principal_inertia.y = f32::INFINITY,
        |body| {
            body.mprops.local_mprops.principal_inertia_local_frame = Rotation::from_array([0.0; 4])
        },
        |body| body.mprops.world_com.y = f32::NAN,
        |body| body.mprops.effective_inv_mass.z = -1.0,
        |body| body.mprops.effective_world_inv_inertia.m12 = f32::INFINITY,
        |body| {
            body.mprops.effective_world_inv_inertia =
                AngularInertia::new(1.0, 2.0, 0.0, 1.0, 0.0, 1.0)
        },
        |body| body.mprops.max_extent = -1.0,
        |body| {
            body.mprops.additional_local_mprops =
                Some(Box::new(RigidBodyAdditionalMassProps::Mass(-1.0)))
        },
        |body| {
            body.mprops.additional_local_mprops = Some(Box::new(
                RigidBodyAdditionalMassProps::MassProps(MassProperties {
                    inv_mass: f32::NAN,
                    ..MassProperties::zero()
                }),
            ))
        },
        |body| body.activation.normalized_linear_threshold = f32::NAN,
        |body| body.activation.angular_threshold = f32::INFINITY,
        |body| body.activation.time_until_sleep = -1.0,
        |body| body.activation.time_since_can_sleep = f32::NAN,
        |body| body.activation.sleep_prev_pose.rotation = Rotation::from_array([0.0; 4]),
        |body| body.ccd.ccd_thickness = f32::NAN,
        |body| body.ccd.soft_ccd_prediction = -1.0,
        |body| body.additional_solver_iterations = usize::MAX,
        |body| body.additional_pgs_iterations = usize::MAX,
        |body| body.soft_motion_margin = f32::NAN,
    ];
    for (index, tamper) in cases.iter().enumerate() {
        let (mut world, body, _) = scene();
        tamper(world.bodies.get_mut_internal(body).unwrap());
        let bytes = bincode::serialize(&world).unwrap();
        let restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        assert!(check(&restored).is_err(), "body tamper {index}");
        assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    }
}

#[test]
fn stored_body_numerics_rejects_collider_payload_tampering_without_mutation() {
    type Tamper = fn(&mut Collider);
    let cases: &[Tamper] = &[
        |collider| collider.pos.0.translation.x = f32::NAN,
        |collider| collider.pos.0.rotation = Rotation::from_array([0.0; 4]),
        |collider| {
            collider
                .parent
                .as_mut()
                .unwrap()
                .pos_wrt_parent
                .translation
                .y = f32::INFINITY
        },
        |collider| {
            collider.parent.as_mut().unwrap().pos_wrt_parent.rotation =
                Rotation::from_array([0.0; 4])
        },
        |collider| collider.mprops = ColliderMassProps::Density(-1.0),
        |collider| collider.mprops = ColliderMassProps::Mass(f32::NAN),
        |collider| {
            collider.mprops = ColliderMassProps::MassProperties(Box::new(MassProperties {
                inv_mass: f32::INFINITY,
                ..MassProperties::zero()
            }))
        },
        |collider| collider.material.friction = -1.0,
        |collider| collider.material.restitution = f32::INFINITY,
        |collider| collider.set_contact_skin(f32::NAN),
        |collider| collider.set_contact_force_event_threshold(f32::NAN),
        |collider| collider.set_contact_force_event_threshold(f32::NEG_INFINITY),
    ];
    for (index, tamper) in cases.iter().enumerate() {
        let (mut world, _, collider) = scene();
        tamper(world.colliders.get_mut_internal(collider).unwrap());
        let bytes = bincode::serialize(&world).unwrap();
        let restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        assert!(check(&restored).is_err(), "collider tamper {index}");
        assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    }
}

#[test]
fn stored_body_numerics_preserves_pending_targets_forces_mass_locks_and_sleep() {
    let (mut world, body, collider) = scene();
    let body_ref = world.bodies.get_mut(body).unwrap();
    body_ref.add_force(Vector::new(-3.0, 5.0, 2.0), false);
    body_ref.add_torque(Vector::new(1.0, -2.0, 3.0), false);
    body_ref.set_gravity_scale(-1.0, false);
    body_ref.set_locked_axes(
        LockedAxes::TRANSLATION_LOCKED_Z | LockedAxes::ROTATION_LOCKED_X,
        false,
    );
    body_ref.set_additional_mass_properties(
        MassProperties::new(Vector::new(0.2, 0.1, 0.0), 2.0, Vector::new(0.0, 2.0, 3.0)),
        false,
    );
    world.colliders.get_mut(collider).unwrap().set_density(2.0);
    unchanged_and_replay(&world);
    world.bodies.get_mut(body).unwrap().sleep();
    unchanged_and_replay(&world);
    world.islands.wake_up(&mut world.bodies, body, true);
    world
        .bodies
        .get_mut(body)
        .unwrap()
        .set_body_type(RigidBodyType::KinematicPositionBased, false);
    world
        .bodies
        .get_mut(body)
        .unwrap()
        .set_next_kinematic_translation(Vector::new(2.0, 0.5, 0.0));
    assert_ne!(
        world.bodies[body].pos.position,
        world.bodies[body].pos.next_position
    );
    unchanged_and_replay(&world);
    world.bodies.get_mut(body).unwrap().set_enabled(false);
    unchanged_and_replay(&world);
}

#[test]
fn stored_body_numerics_preserves_zero_mass_signed_history_and_material_comparator_sentinels() {
    let (mut world, body, collider) = scene();
    world
        .bodies
        .get_mut(body)
        .unwrap()
        .set_additional_mass_properties(MassProperties::zero(), false);
    world
        .bodies
        .get_mut(body)
        .unwrap()
        .set_locked_axes(LockedAxes::all(), false);
    *world.bodies.get_mut(body).unwrap().activation_mut() = RigidBodyActivation::cannot_sleep();
    world.colliders.get_mut(collider).unwrap().set_density(0.0);
    world
        .colliders
        .get_mut(collider)
        .unwrap()
        .set_restitution(1.5);
    world
        .colliders
        .get_mut(collider)
        .unwrap()
        .set_contact_force_event_threshold(f32::INFINITY);
    world
        .colliders
        .get_mut(collider)
        .unwrap()
        .set_active_events(ActiveEvents::CONTACT_FORCE_EVENTS);
    unchanged_and_replay(&world);
    world.step();
    unchanged_and_replay(&world);
}

#[test]
fn stored_body_numerics_accepts_authored_rotation_composition_without_normalizing_bytes() {
    let mut world = PhysicsWorld::new();
    let q = Rotation::from_array([0.0, 0.0, 0.0, (1.0f32 + 9.0e-6).sqrt()]);
    let mut properties = MassProperties::new(Vector::ZERO, 1.0, Vector::ONE);
    properties.principal_inertia_local_frame = q;
    world.insert(RigidBodyBuilder::fixed(), ColliderBuilder::ball(0.5));
    let (body, collider) = world.insert(
        RigidBodyBuilder::dynamic().pose(Pose::from_parts(Vector::new(0.0, 2.0, 0.0), q)),
        ColliderBuilder::ball(0.5)
            .position(Pose::from_parts(Vector::ZERO, q))
            .mass_properties(properties),
    );
    assert!((world.colliders[collider].rotation().length_squared() - 1.0).abs() > 1.0e-5);
    assert!(
        (world.bodies[body]
            .mprops
            .local_mprops
            .principal_inertia_local_frame
            .length_squared()
            - 1.0)
            .abs()
            > 1.0e-5
    );
    unchanged_and_replay(&world);
}

#[test]
fn stored_body_numerics_accepts_actual_finite_overflow_quarantine_history() {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    let (body, _) = world.insert(RigidBodyBuilder::dynamic(), ColliderBuilder::ball(0.5));
    world.step();
    world
        .bodies
        .get_mut(body)
        .unwrap()
        .add_force(Vector::splat(f32::MAX), true);
    check(&world).unwrap();
    world.step();
    assert!(!world.bodies[body].is_enabled());
    assert!(world.physics_pipeline.quarantine().bodies().contains(&body));
    assert!(world.bodies[body].pos.position.is_finite());
    assert!(world.bodies[body].vels.is_finite());
    unchanged_and_replay(&world);
}

#[test]
fn stored_body_numerics_prepays_raw_vacancies_and_record_work_and_iteration_policy() {
    let (mut world, body, _) = scene();
    let used = check(&world).unwrap();
    let tight = StoredBodyNumericLimits {
        max_work: used,
        ..limits()
    };
    validate_stored_body_numerics(&world.bodies, &world.colliders, tight).unwrap();
    assert_eq!(
        validate_stored_body_numerics(
            &world.bodies,
            &world.colliders,
            StoredBodyNumericLimits {
                max_work: used - 1,
                ..limits()
            }
        ),
        Err(StoredBodyNumericError::WorkLimit)
    );
    world.bodies.bodies.reserve(1024);
    assert_eq!(
        validate_stored_body_numerics(&world.bodies, &world.colliders, tight),
        Err(StoredBodyNumericError::WorkLimit)
    );
    world
        .bodies
        .get_mut(body)
        .unwrap()
        .set_additional_solver_iterations(33);
    assert_eq!(check(&world), Err(StoredBodyNumericError::Iterations));
    let relaxed = StoredBodyNumericLimits {
        max_additional_solver_iterations: 33,
        ..limits()
    };
    validate_stored_body_numerics(&world.bodies, &world.colliders, relaxed).unwrap();
}

#[test]
fn stored_body_numerics_distinguishes_rank_deficiency_rounding_and_indefinite_tensors() {
    for scale in [1.0e-30, 1.0, 1.0e30] {
        let rank_one = AngularInertia::new(scale, -scale, 0.0, scale, 0.0, 0.0);
        assert!(inertia(&rank_one));
        let rank_two = AngularInertia::new(scale, 0.0, 0.0, scale, 0.0, 0.0);
        assert!(inertia(&rank_two));
        let roundoff =
            AngularInertia::new(scale, -scale * (1.0 + f32::EPSILON), 0.0, scale, 0.0, 0.0);
        assert!(inertia(&roundoff));
        let indefinite = AngularInertia::new(scale, -scale * 1.1, 0.0, scale, 0.0, 0.0);
        assert!(!inertia(&indefinite));
    }
    assert!(inertia(&AngularInertia::zero()));
    assert!(!inertia(&AngularInertia::new(
        -1.0, 0.0, 0.0, 1.0, 0.0, 1.0
    )));
}

#[test]
fn stored_body_numerics_supported_kinds_empty_storage_and_unsupported_soft_markers_are_separate() {
    let mut world = PhysicsWorld::new();
    check(&world).unwrap();
    for builder in [
        RigidBodyBuilder::fixed(),
        RigidBodyBuilder::dynamic(),
        RigidBodyBuilder::kinematic_position_based(),
        RigidBodyBuilder::kinematic_velocity_based(),
    ] {
        world.insert(
            builder.translation(Vector::new(20.0 * world.bodies.len() as f32, 5.0, 0.0)),
            ColliderBuilder::ball(0.5).density(0.0),
        );
    }
    unchanged_and_replay(&world);
    let handle = world.bodies.iter().next().unwrap().0;
    world.bodies.get_mut_internal(handle).unwrap().soft_cluster = 0;
    assert_eq!(check(&world), Err(StoredBodyNumericError::UnsupportedBody));
    assert_eq!(
        validate_stored_body_numerics(
            &world.bodies,
            &world.colliders,
            StoredBodyNumericLimits {
                max_work: 0,
                ..limits()
            }
        ),
        Err(StoredBodyNumericError::WorkLimit)
    );
}
