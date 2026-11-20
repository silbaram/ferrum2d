//! Real shape edits keep collider identity while invalidating old local geometry.
use super::*;
use crate::prelude::*;
use parry::utils::Array2;

fn shapes() -> [SharedShape; 7] {
    let hull = SharedShape::convex_hull(&[
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
    let mesh = SharedShape::trimesh(
        vec![
            Vector::new(-1.0, 0.0, -1.0),
            Vector::new(-1.0, 0.0, 1.0),
            Vector::new(1.0, 0.0, -1.0),
            Vector::new(1.0, 0.0, 1.0),
        ],
        vec![[0, 1, 2], [1, 3, 2]],
    )
    .unwrap();
    let heightfield =
        SharedShape::heightfield(Array2::repeat(3, 3, 0.0), Vector::new(4.0, 1.0, 4.0));
    let compound = SharedShape::compound(vec![
        (
            Pose::translation(-0.5, 0.0, 0.0),
            SharedShape::cuboid(0.5, 0.5, 0.5),
        ),
        (
            Pose::translation(0.5, 0.0, 0.0),
            SharedShape::cuboid(0.5, 0.5, 0.5),
        ),
    ]);
    [
        SharedShape::cuboid(0.5, 0.5, 0.5),
        SharedShape::ball(0.5),
        SharedShape::capsule_y(0.25, 0.25),
        hull,
        mesh,
        heightfield,
        compound,
    ]
}
fn limits() -> crate::geometry::StoredWorkspaceLimits {
    StoredWorkspaceLimits {
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn validate(world: &PhysicsWorld) {
    crate::geometry::validate_stored_references(
        world,
        StoredReferenceLimits {
            max_work: 1_000_000,
            max_scratch_bytes: 1_000_000,
        },
    )
    .unwrap();
    crate::dynamics::validate_stored_islands(
        world,
        StoredIslandLimits {
            max_work: 1_000_000,
            max_scratch_bytes: 1_000_000,
        },
    )
    .unwrap();
    crate::geometry::validate_stored_contact_numerics(
        world,
        StoredContactNumericLimits {
            max_work: 1_000_000,
        },
    )
    .unwrap();
    crate::geometry::validate_stored_contact_workspaces(world, limits()).unwrap();
}
fn world(
    fixed: SharedShape,
    moving: SharedShape,
    fixed_offset: f32,
    flipped: bool,
) -> (
    PhysicsWorld,
    RigidBodyHandle,
    ColliderHandle,
    ColliderHandle,
) {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    let fixed_body = RigidBodyBuilder::fixed();
    let fixed = ColliderBuilder::new(fixed).translation(Vector::new(0.0, fixed_offset, 0.0));
    let moving_body = RigidBodyBuilder::dynamic()
        .can_sleep(false)
        .translation(Vector::new(0.0, 0.5, 0.0));
    let moving = ColliderBuilder::new(moving);
    let (body, moving_collider, fixed_collider);
    if flipped {
        (body, moving_collider) = world.insert(moving_body, moving);
        fixed_collider = world.insert(fixed_body, fixed).1;
    } else {
        fixed_collider = world.insert(fixed_body, fixed).1;
        (body, moving_collider) = world.insert(moving_body, moving);
    }
    for _ in 0..4 {
        world.step();
    }
    validate(&world);
    (world, body, moving_collider, fixed_collider)
}

#[test]
fn shape_edits_compound_shrink_has_no_ghost_impulse_or_second_tick_graph_panic() {
    for flipped in [false, true] {
        let compound = SharedShape::compound(vec![
            (Pose::translation(-0.2, 0.0, 0.0), SharedShape::ball(0.5)),
            (Pose::translation(0.2, 0.0, 0.0), SharedShape::ball(0.5)),
        ]);
        let (mut world, body, collider, _) =
            world(SharedShape::cuboid(5.0, 0.5, 5.0), compound, -0.5, flipped);
        assert_eq!(
            world
                .narrow_phase
                .contact_pairs()
                .next()
                .unwrap()
                .manifolds()
                .len(),
            2
        );
        world
            .colliders
            .get_mut(collider)
            .unwrap()
            .set_shape(SharedShape::ball(0.1));
        world
            .bodies
            .get_mut(body)
            .unwrap()
            .set_linvel(Vector::NEG_Y, true);
        let before = bincode::serialize(&world).unwrap();
        validate(&world);
        assert_eq!(bincode::serialize(&world).unwrap(), before);
        let mut restored: PhysicsWorld = bincode::deserialize(&before).unwrap();
        for tick in 1..=6 {
            world.step();
            restored.step();
            validate(&world);
            validate(&restored);
            let state = &world.bodies[body];
            assert!((state.linvel().y + 1.0).abs() < 1.0e-6);
            assert!(
                (state.translation().y - (0.5 - tick as f32 * world.integration_parameters.dt))
                    .abs()
                    < 2.0e-6
            );
            for pair in world.narrow_phase.contact_pairs() {
                let data = pair.rigid().unwrap();
                assert!(data.workspace.is_none());
                assert_eq!(data.manifolds.len(), 1);
                assert!(data.solver_clusters.is_empty());
                assert!(data.solver_clusters_prev.is_empty());
                let m = &data.manifolds[0];
                assert_eq!((m.subshape1, m.subshape2), (0, 0));
                assert!(m.subshape_poses.is_none());
                assert!(m.data.solver_contacts.is_empty());
                assert_eq!(pair.total_impulse(), Vector::ZERO);
            }
            assert_eq!(
                bincode::serialize(&world).unwrap(),
                bincode::serialize(&restored).unwrap()
            );
        }
    }
}

#[test]
fn shape_edits_seven_static_five_dynamic_matrix_keeps_identity_and_original_continuation() {
    let pool = shapes();
    let moving_types = [0, 1, 2, 3, 6];
    let mut cases = 0;
    for flipped in [false, true] {
        for before in 0..7 {
            for after in 0..7 {
                let offset = if before == 4 || before == 5 {
                    0.0
                } else {
                    -0.5
                };
                let (mut world, body, moving, fixed) = world(
                    pool[before].clone(),
                    SharedShape::ball(0.5),
                    offset,
                    flipped,
                );
                let parent = world.colliders[fixed].parent();
                let c = world.colliders.get_mut(fixed).unwrap();
                c.set_shape(pool[after].clone());
                c.set_position_wrt_parent(Pose::translation(
                    0.0,
                    if after == 4 || after == 5 { 0.0 } else { -0.5 },
                    0.0,
                ));
                let pending = bincode::serialize(&world).unwrap();
                validate(&world);
                assert_eq!(bincode::serialize(&world).unwrap(), pending);
                let mut restored: PhysicsWorld = bincode::deserialize(&pending).unwrap();
                for _ in 0..3 {
                    world.step();
                    restored.step();
                    validate(&world);
                    assert_eq!(world.colliders[fixed].parent(), parent);
                    assert!(world.colliders.contains(moving));
                    assert!(world.bodies.contains(body));
                    assert_eq!(
                        bincode::serialize(&world).unwrap(),
                        bincode::serialize(&restored).unwrap()
                    );
                }
                cases += 1;
            }
        }
        for &before in &moving_types {
            for &after in &moving_types {
                let (mut world, body, moving, fixed) = world(
                    SharedShape::cuboid(5.0, 0.5, 5.0),
                    pool[before].clone(),
                    -0.5,
                    flipped,
                );
                world
                    .colliders
                    .get_mut(moving)
                    .unwrap()
                    .set_shape(pool[after].clone());
                let pending = bincode::serialize(&world).unwrap();
                validate(&world);
                let mut restored: PhysicsWorld = bincode::deserialize(&pending).unwrap();
                for _ in 0..3 {
                    world.step();
                    restored.step();
                    validate(&world);
                    assert_eq!(world.colliders[moving].parent(), Some(body));
                    assert!(world.colliders.contains(fixed));
                    assert_eq!(
                        bincode::serialize(&world).unwrap(),
                        bincode::serialize(&restored).unwrap()
                    );
                }
                cases += 1;
            }
        }
    }
    std::eprintln!("SHAPE_EDIT_MATRIX cases={cases}");
    assert_eq!(cases, 148);
}

#[test]
fn shape_edits_none_context_rejects_stale_roots_but_keeps_empty_and_pending_histories() {
    let a = SharedShape::cuboid(5.0, 0.5, 5.0);
    let b = SharedShape::ball(0.5);
    for case in 0..4 {
        let (mut world, _, _, _) = world(a.clone(), b.clone(), -0.5, false);
        let pair = world.narrow_phase.contact_graph.graph.edges[0]
            .weight
            .rigid_mut()
            .unwrap();
        assert!(pair.workspace.is_none());
        match case {
            0 => pair.manifolds.push(pair.manifolds[0].clone()),
            1 => pair.manifolds[0].subshape1 = 99,
            2 => pair.manifolds[0].set_subshape_pos2(Some(Pose::IDENTITY)),
            3 => pair.manifolds[0].subshape2 = 99,
            _ => unreachable!(),
        }
        let before = bincode::serialize(&world).unwrap();
        assert!(crate::geometry::validate_stored_contact_workspaces(&world, limits()).is_err());
        assert_eq!(bincode::serialize(&world).unwrap(), before);
        // No corrupted fixture is stepped or queried.
    }
    let empty: Vec<ContactManifold> = Vec::new();
    parry::query::validate_stored_contact_manifolds_without_workspace(
        &empty,
        Some((&*a, &*b)),
        limits(),
    )
    .unwrap();
    let mut saved = ContactManifold::new();
    saved.subshape1 = 99;
    saved.set_subshape_pos1(Some(Pose::IDENTITY));
    parry::query::validate_stored_contact_manifolds_without_workspace(&[saved], None, limits())
        .unwrap();
}
