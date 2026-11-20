use super::*;
use crate::alloc_prelude::*;
use crate::geometry::{NEW_CONTACT_BIT, RigidPairContacts, SolverContact};
use crate::prelude::*;

fn check(world: &PhysicsWorld) -> Result<usize, Error> {
    validate_stored_contact_numerics(
        world,
        StoredContactNumericLimits {
            max_work: 1_000_000,
        },
    )
}
fn scene() -> (PhysicsWorld, RigidBodyHandle) {
    let mut world = PhysicsWorld::new();
    world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.5, 0.0)),
        ColliderBuilder::cuboid(5.0, 0.5, 5.0),
    );
    let (body, _) = world.insert(
        RigidBodyBuilder::dynamic().translation(Vector::new(0.0, 0.5, 0.0)),
        ColliderBuilder::ball(0.5),
    );
    for _ in 0..4 {
        world.step();
    }
    assert!(pair(&mut world).manifolds[0].points.len() == 1);
    assert!(pair(&mut world).manifolds[0].data.solver_contacts.len() == 1);
    check(&world).unwrap();
    (world, body)
}
fn pair(world: &mut PhysicsWorld) -> &mut RigidPairContacts {
    world
        .narrow_phase
        .contact_graph
        .graph
        .edges
        .iter_mut()
        .find_map(|edge| {
            edge.weight
                .rigid_mut()
                .filter(|pair| !pair.manifolds.is_empty())
        })
        .unwrap()
}
fn unchanged(world: &PhysicsWorld) {
    let bytes = bincode::serialize(world).unwrap();
    check(world).unwrap();
    assert_eq!(bytes, bincode::serialize(world).unwrap());
}
fn replay(world: &mut PhysicsWorld) {
    unchanged(world);
    let bytes = bincode::serialize(world).unwrap();
    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    for _ in 0..6 {
        world.step();
        restored.step();
        assert_eq!(
            bincode::serialize(world).unwrap(),
            bincode::serialize(&restored).unwrap()
        );
        unchanged(&restored);
    }
}
fn rejects_without_mutation(world: &PhysicsWorld, expected: Error) {
    let bytes = bincode::serialize(world).unwrap();
    assert_eq!(check(world), Err(expected));
    assert_eq!(bytes, bincode::serialize(world).unwrap());
    // Also prove the physical payload remains present after a real codec round trip.
    // No corrupted fixture is ever passed to step/constraint generation.
    let restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    assert_eq!(check(&restored), Err(expected));
}

#[test]
fn stored_contact_numerics_rejects_point_payloads_in_both_manifold_vectors() {
    type Tamper = fn(&mut Contact);
    let cases: &[Tamper] = &[
        |p| p.local_p1.x = f32::NAN,
        |p| p.local_p2.y = f32::INFINITY,
        |p| p.dist = f32::NEG_INFINITY,
        |p| p.data.impulse = f32::NAN,
        |p| p.data.tangent_impulse.x = f32::INFINITY,
        |p| p.data.warmstart_impulse = f32::NAN,
        |p| p.data.warmstart_tangent_impulse.y = f32::NAN,
        |p| p.data.warmstart_twist_impulse = f32::NEG_INFINITY,
        |p| p.data.warmstart_tangent_world.z = f32::NAN,
        |p| p.data.solver_dp1.x = f32::NAN,
        |p| p.data.solver_dp2.y = f32::INFINITY,
    ];
    for &tamper in cases {
        for clustered in [false, true] {
            let (mut world, _) = scene();
            let pair = pair(&mut world);
            if clustered {
                pair.solver_clusters = pair.manifolds.clone();
            }
            // Original geometric data is checked even when clusters hide it.
            tamper(&mut pair.manifolds[0].points[0]);
            let expected = if !pair.manifolds[0].points[0].local_p1.is_finite()
                || !pair.manifolds[0].points[0].local_p2.is_finite()
                || !pair.manifolds[0].points[0].dist.is_finite()
            {
                Error::ContactPoint
            } else {
                Error::ContactImpulse
            };
            rejects_without_mutation(&world, expected);
        }
        let (mut world, _) = scene();
        let pair = pair(&mut world);
        pair.solver_clusters = pair.manifolds.clone();
        tamper(&mut pair.solver_clusters[0].points[0]);
        assert!(check(&world).is_err());
    }
}

#[test]
fn stored_contact_numerics_rejects_manifold_material_correction_and_pose() {
    type Tamper = fn(&mut ContactManifold);
    let cases: &[(Tamper, Error)] = &[
        (|m| m.local_n1.x = f32::NAN, Error::ManifoldNormal),
        (|m| m.local_n2 = Vector::ZERO, Error::ManifoldNormal),
        (|m| m.data.normal = Vector::X * 2.0, Error::ManifoldNormal),
        (|m| m.data.friction = -1.0, Error::Material),
        (|m| m.data.friction = f32::INFINITY, Error::Material),
        (|m| m.data.restitution = f32::NAN, Error::Material),
        (|m| m.data.restitution = -1.0, Error::Material),
        (
            |m| m.data.contact_correction.enabled = 0.5,
            Error::Correction,
        ),
        (
            |m| m.data.contact_correction.retain_velocity = f32::NAN,
            Error::Correction,
        ),
        (
            |m| m.data.contact_correction.velocity_rate = -1.0,
            Error::Correction,
        ),
        (
            |m| m.data.contact_correction.max_velocity = f32::INFINITY,
            Error::Correction,
        ),
        (
            |m| m.data.contact_correction.position_rate = f32::NAN,
            Error::Correction,
        ),
        (
            |m| m.data.contact_correction.position_slop = -1.0,
            Error::Correction,
        ),
        (
            |m| m.data.contact_correction.velocity_slop = f32::NAN,
            Error::Correction,
        ),
        (
            |m| m.set_subshape_pos1(Some(Pose::from_translation(Vector::splat(f32::NAN)))),
            Error::ManifoldPose,
        ),
        (
            |m| {
                let mut p = Pose::IDENTITY;
                p.rotation = Rotation::from_array([0.0; 4]);
                m.set_subshape_pos2(Some(p));
            },
            Error::ManifoldPose,
        ),
    ];
    for &(tamper, expected) in cases {
        for cluster in [false, true] {
            let (mut world, _) = scene();
            let pair = pair(&mut world);
            if cluster {
                pair.solver_clusters = pair.manifolds.clone();
                tamper(&mut pair.solver_clusters[0]);
            } else {
                tamper(&mut pair.manifolds[0]);
            }
            rejects_without_mutation(&world, expected);
        }
    }
}

#[test]
fn stored_contact_numerics_rejects_solver_fields_and_masked_indices() {
    type Tamper = fn(&mut SolverContact);
    let cases: &[(Tamper, Error)] = &[
        (|c| c.anchor1.x = f32::NAN, Error::SolverContact),
        (|c| c.anchor2.y = f32::INFINITY, Error::SolverContact),
        (|c| c.dist = f32::NAN, Error::SolverContact),
        (
            |c| c.tangent_velocity.z = f32::NEG_INFINITY,
            Error::SolverContact,
        ),
        (|c| c.contact_id = [1], Error::ContactIndex),
        (
            |c| c.contact_id = [NEW_CONTACT_BIT | 1],
            Error::ContactIndex,
        ),
        (|c| c.contact_id = [255], Error::ContactIndex),
        (|c| c.contact_id = [u32::MAX], Error::ContactIndex),
    ];
    for &(tamper, expected) in cases {
        let (mut world, _) = scene();
        tamper(&mut pair(&mut world).manifolds[0].data.solver_contacts[0]);
        rejects_without_mutation(&world, expected);
    }
    let (mut world, _) = scene();
    let manifold = &mut pair(&mut world).manifolds[0];
    let point = manifold.points[0];
    manifold.points.resize(256, point);
    manifold.data.solver_contacts[0].contact_id = [NEW_CONTACT_BIT | 254];
    unchanged(&world); // valid u8 index and NEW history, no artificial 0..3 CID limit.
    pair(&mut world).manifolds[0].data.solver_contacts[0].contact_id = [255];
    rejects_without_mutation(&world, Error::ContactIndex); // in-bounds but reserved sentinel.
}

#[test]
fn stored_contact_numerics_rejects_excess_solver_contacts() {
    let (mut world, _) = scene();
    let manifold = &mut pair(&mut world).manifolds[0];
    let contact = manifold.data.solver_contacts[0];
    manifold.data.solver_contacts.resize(5, contact);
    rejects_without_mutation(&world, Error::SolverContact);
}

#[test]
fn stored_contact_numerics_rejects_recycle_pose_and_drift() {
    type Tamper = fn(&mut crate::geometry::ContactRecycleState);
    let cases: &[Tamper] = &[
        |s| s.pos12.translation.x = f32::NAN,
        |s| s.pos12.rotation = Rotation::from_array([0.0; 4]),
        |s| s.rot1 = Rotation::from_array([0.0, 0.0, 0.0, 2.0]),
        |s| s.rot2 = Rotation::from_array([f32::NAN, 0.0, 0.0, 1.0]),
        |s| s.max_extent = -1.0,
        |s| s.max_extent = f32::INFINITY,
        |s| s.max_drift = f32::NAN,
        |s| s.max_drift = -1.0,
    ];
    for &tamper in cases {
        let (mut world, _) = scene();
        let pair = pair(&mut world);
        let mut state = pair
            .recycle_state
            .unwrap_or(crate::geometry::ContactRecycleState {
                pos12: Pose::IDENTITY,
                rot1: Rotation::IDENTITY,
                rot2: Rotation::IDENTITY,
                max_extent: 1.0,
                max_drift: 0.1,
            });
        tamper(&mut state);
        pair.recycle_state = Some(state);
        rejects_without_mutation(&world, Error::RecycleState);
    }
}

#[test]
fn stored_contact_numerics_precharges_exact_actual_record_budget() {
    let (mut world, _) = scene();
    let work = check(&world).unwrap();
    let bytes = bincode::serialize(&world).unwrap();
    assert_eq!(
        validate_stored_contact_numerics(&world, StoredContactNumericLimits { max_work: work }),
        Ok(work)
    );
    assert_eq!(
        validate_stored_contact_numerics(&world, StoredContactNumericLimits { max_work: work - 1 }),
        Err(Error::WorkLimit)
    );
    assert_eq!(bytes, bincode::serialize(&world).unwrap());
    let manifold = &mut pair(&mut world).manifolds[0];
    manifold.points.resize(10_000, manifold.points[0]);
    manifold.points[0].local_p1.x = f32::NAN;
    assert_eq!(
        validate_stored_contact_numerics(&world, StoredContactNumericLimits { max_work: work }),
        Err(Error::WorkLimit)
    );
    // Count multiplication cannot wrap on either target.
    assert_eq!(
        Budget(usize::MAX).charge(usize::MAX, POINT_WORK),
        Err(Error::WorkLimit)
    );
}

#[test]
fn stored_contact_numerics_only_rejects_empty_solver_lists_in_ready_epochs() {
    let (mut world, _) = scene();
    assert!(world.narrow_phase.solver_graph_valid);
    assert_eq!(
        world.narrow_phase.solver_graph_epoch,
        world.islands.active_set_epoch
    );
    assert!(
        world
            .narrow_phase
            .solver_contact_graph
            .stored_buckets()
            .iter()
            .any(|b| !b.is_empty())
    );
    pair(&mut world).manifolds[0].data.solver_contacts.clear();
    rejects_without_mutation(&world, Error::ReadyGraph);
    world.narrow_phase.solver_graph_epoch = world.islands.active_set_epoch.wrapping_add(1);
    unchanged(&world);
    world.narrow_phase.solver_graph_epoch = world.islands.active_set_epoch;
    world.narrow_phase.solver_graph_mb_epoch =
        world.multibody_joints.topology_epoch.wrapping_add(1);
    unchanged(&world);
    world.narrow_phase.solver_graph_mb_epoch = world.multibody_joints.topology_epoch;
    world.narrow_phase.solver_graph_valid = false;
    unchanged(&world);
}

#[test]
fn stored_contact_numerics_preserves_signed_and_superelastic_history() {
    let (mut world, _) = scene();
    let m = &mut pair(&mut world).manifolds[0];
    let d = &mut m.points[0].data;
    d.impulse = -0.1;
    d.warmstart_impulse = -0.2;
    d.tangent_impulse = crate::math::TangentImpulse::<f32>::new(-0.3, 0.4);
    d.warmstart_tangent_impulse = crate::math::TangentImpulse::<f32>::new(0.5, -0.6);
    d.warmstart_twist_impulse = -0.7;
    d.warmstart_tangent_world = Vector::new(-0.1, 0.2, -0.3);
    m.data.restitution = 1.25;
    m.data.solver_contacts[0].contact_id[0] |= NEW_CONTACT_BIT;
    replay(&mut world);
}

#[test]
fn stored_contact_numerics_accepts_sleep_and_pending_pose_shape_material_changes() {
    let (mut world, body) = scene();
    for _ in 0..180 {
        world.step();
        check(&world).unwrap();
    }
    assert!(world.bodies[body].is_sleeping());
    replay(&mut world);
    world
        .bodies
        .get_mut(body)
        .unwrap()
        .set_position(Pose::from_translation(Vector::new(0.1, 0.6, 0.0)), true);
    let handle = world
        .colliders
        .iter()
        .find(|(_, c)| c.parent() == Some(body))
        .unwrap()
        .0;
    world.colliders.get_mut(handle).unwrap().set_friction(0.7);
    world
        .colliders
        .get_mut(handle)
        .unwrap()
        .set_shape(SharedShape::cuboid(0.4, 0.4, 0.4));
    replay(&mut world);
}

#[test]
fn stored_contact_numerics_empty_and_transient_observations_are_not_repaired() {
    unchanged(&PhysicsWorld::new());
    let (mut world, _) = scene();
    let m = &mut pair(&mut world).manifolds[0];
    m.points[0].data.solved.point = Vector::splat(f32::NAN); // serde-skipped observation.
    m.data.solver_contacts[0].padding = [f32::NAN]; // stored, but unused physical padding.
    unchanged(&world);
    let pair = pair(&mut world);
    pair.manifolds.push(ContactManifold::new()); // inactive zero normals are legitimate.
    unchanged(&world);
}

#[test]
fn stored_contact_numerics_rejects_soft_pair_without_entering_solver() {
    let (mut world, _) = scene();
    world.narrow_phase.contact_graph.graph.edges[0]
        .weight
        .contacts = PairContacts::Soft {
        touching: false,
        candidates: Box::default(),
    };
    rejects_without_mutation(&world, Error::UnsupportedPair);
}

#[test]
fn stored_contact_numerics_supported_shape_producers_preserve_replay() {
    let hull = ColliderBuilder::convex_hull(&[
        Vector::new(-0.5, -0.5, -0.5),
        Vector::new(0.5, -0.5, -0.5),
        Vector::new(-0.5, 0.5, -0.5),
        Vector::new(0.5, 0.5, -0.5),
        Vector::new(-0.5, -0.5, 0.5),
        Vector::new(0.5, -0.5, 0.5),
        Vector::new(-0.5, 0.5, 0.5),
        Vector::new(0.5, 0.5, 0.5),
    ])
    .unwrap();
    let mesh = ColliderBuilder::trimesh(
        vec![
            Vector::new(-2.0, 0.0, -2.0),
            Vector::new(-2.0, 0.0, 2.0),
            Vector::new(2.0, 0.0, -2.0),
            Vector::new(2.0, 0.0, 2.0),
        ],
        vec![[0, 1, 2], [1, 3, 2]],
    )
    .unwrap();
    let shapes = [
        ("box", ColliderBuilder::cuboid(0.5, 0.5, 0.5)),
        ("sphere", ColliderBuilder::ball(0.5)),
        ("capsule", ColliderBuilder::capsule_y(0.5, 0.5)),
        ("hull", hull),
        ("mesh", mesh),
        (
            "heightfield",
            ColliderBuilder::heightfield(
                crate::geometry::Array2::repeat(3, 3, 0.0),
                Vector::new(4.0, 1.0, 4.0),
            ),
        ),
        (
            "compound",
            ColliderBuilder::compound(vec![
                (
                    Pose::from_translation(Vector::new(-0.3, 0.0, 0.0)),
                    SharedShape::cuboid(0.3, 0.5, 0.5),
                ),
                (
                    Pose::from_translation(Vector::new(0.3, 0.0, 0.0)),
                    SharedShape::cuboid(0.3, 0.5, 0.5),
                ),
            ]),
        ),
    ];
    for (name, shape) in shapes {
        for clustering in [false, true] {
            let mut world = PhysicsWorld::new();
            world.integration_parameters.contact_clustering = clustering;
            world.insert(RigidBodyBuilder::fixed(), shape.clone());
            world.insert(
                RigidBodyBuilder::dynamic().translation(Vector::new(0.0, 0.45, 0.0)),
                ColliderBuilder::ball(0.5),
            );
            let mut observed = false;
            for _ in 0..16 {
                world.step();
                observed |= world
                    .narrow_phase
                    .contact_pairs()
                    .any(|p| !p.manifolds().is_empty());
                assert!(
                    check(&world).is_ok(),
                    "shape={name},cluster={clustering}: {:?}",
                    check(&world)
                );
            }
            assert!(observed, "shape={name} must actually generate contacts");
            replay(&mut world);
        }
    }
}

fn near_input_rotation(sign: f32, angle: f32) -> Rotation {
    let q = Rotation::from_rotation_y(angle);
    let scale = (1.0 + sign * 9.0e-6_f32).sqrt();
    let q = Rotation::from_array(q.to_array().map(|x| x * scale));
    let error = (q
        .to_array()
        .iter()
        .map(|&x| f64::from(x) * f64::from(x))
        .sum::<f64>()
        - 1.0)
        .abs();
    assert!(
        error <= 1.0e-5 && error > 8.0e-6,
        "actual input error={error}"
    );
    q
}
#[test]
fn stored_contact_numerics_near_input_rotations_compound_and_recycle() {
    for sign in [-1.0, 1.0] {
        for clustering in [false, true] {
            let rotation = near_input_rotation(sign, 0.7);
            let local_rotation = near_input_rotation(sign, -0.3);
            let sub_rotation = near_input_rotation(sign, 0.4);
            let mut world = PhysicsWorld::new();
            world.integration_parameters.contact_clustering = clustering;
            world.insert(
                RigidBodyBuilder::fixed().pose(Pose {
                    translation: Vector::new(0.0, -0.5, 0.0),
                    rotation,
                    ..Pose::IDENTITY
                }),
                ColliderBuilder::cuboid(5.0, 0.5, 5.0).position(Pose {
                    translation: Vector::ZERO,
                    rotation: local_rotation,
                    ..Pose::IDENTITY
                }),
            );
            let (body, _) = world.insert(
                RigidBodyBuilder::dynamic().pose(Pose {
                    translation: Vector::new(0.0, 0.5, 0.0),
                    rotation,
                    ..Pose::IDENTITY
                }),
                ColliderBuilder::compound(vec![(
                    Pose {
                        translation: Vector::ZERO,
                        rotation: sub_rotation,
                        ..Pose::IDENTITY
                    },
                    SharedShape::cuboid(0.4, 0.5, 0.4),
                )])
                .position(Pose {
                    translation: Vector::ZERO,
                    rotation: local_rotation,
                    ..Pose::IDENTITY
                }),
            );
            let mut recycle = false;
            for _ in 0..240 {
                world.step();
                crate::dynamics::validate_stored_body_numerics(
                    &world.bodies,
                    &world.colliders,
                    crate::dynamics::StoredBodyNumericLimits {
                        max_work: 1_000_000,
                        max_additional_solver_iterations: 32,
                        max_additional_pgs_iterations: 32,
                    },
                )
                .unwrap();
                check(&world).unwrap();
                recycle |= world
                    .narrow_phase
                    .contact_pairs()
                    .any(|pair| pair.rigid().unwrap().recycle_state.is_some());
            }
            assert!(recycle, "the actual recycle producer must run");
            assert!(world.bodies[body].is_sleeping());
            replay(&mut world);
        }
    }
}

#[test]
fn stored_contact_numerics_numeric_policy_boundaries_are_explicit() {
    let mut world = scene().0;
    let m = &mut pair(&mut world).manifolds[0];
    m.data.normal = Vector::X * (1.0 + 0.9e-3_f32).sqrt();
    unchanged(&world);
    pair(&mut world).manifolds[0].data.normal = Vector::X * (1.0 + 1.1e-3_f32).sqrt();
    rejects_without_mutation(&world, Error::ManifoldNormal);
    let mut cached = Pose::IDENTITY;
    cached.rotation = Rotation::from_array([0.0, 0.0, 0.0, (1.0 + 0.9e-4_f32).sqrt()]);
    assert!(pose(cached, CACHED_ROTATION_TOLERANCE));
    cached.rotation = Rotation::from_array([0.0, 0.0, 0.0, (1.0 + 1.1e-4_f32).sqrt()]);
    assert!(!pose(cached, CACHED_ROTATION_TOLERANCE));
}
