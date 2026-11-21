use super::*;
use crate::physics3d::{
    BodyDesc, BodyId, BodyKind, ColliderDesc, ColliderId, Pose, Shape, ShapePart, Space,
    WorldConfig,
};
use rapier3d::geometry::file_shape_aliases::{Entry, RootLocation};
use rapier3d::{parry::shape::file_aliases as proof, prelude as rp};
use std::sync::Arc;

fn limits() -> Limits {
    Limits {
        max_work: 10_000_000,
        max_scratch_bytes: 16 * 1024 * 1024,
        max_roots: 4096,
        max_compare_bytes: 8 * 1024 * 1024,
    }
}
fn encoded(world: &PhysicsWorld3d) -> Vec<u8> {
    world.capture_snapshot().unwrap().encoded_bytes().to_vec()
}
fn fresh(world: &PhysicsWorld3d) -> PhysicsWorld3d {
    PhysicsWorld3d::from_snapshot(&world.capture_snapshot().unwrap()).unwrap()
}
fn handle(id: ColliderId) -> rp::ColliderHandle {
    rp::ColliderHandle::from_raw_parts(id.slot, id.generation)
}
fn location(id: ColliderId) -> RootLocation {
    RootLocation::Collider {
        slot: id.slot,
        generation: id.generation,
    }
}
fn shared(world: &PhysicsWorld3d, id: ColliderId) -> &rp::SharedShape {
    world
        .backend
        .colliders
        .get(handle(id))
        .unwrap()
        .shared_shape()
}
fn body(
    world: &mut PhysicsWorld3d,
    kind: BodyKind,
    x: f32,
    y: f32,
    shape: Shape,
) -> (BodyId, ColliderId) {
    let id = world
        .create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position: [x, y, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(shape),
        )
        .unwrap();
    let collider = world.collider_ids(id).unwrap().next().unwrap();
    (id, collider)
}
fn install_builder(world: &mut PhysicsWorld3d, ids: &[ColliderId], shape: rp::SharedShape) {
    // Real vendor producer: build(&self) repeatedly clones the builder's Arc.
    let builder = rp::ColliderBuilder::new(shape);
    for &id in ids {
        let built = builder.build();
        world
            .backend
            .colliders
            .get_mut(handle(id))
            .unwrap()
            .set_shape(built.shared_shape().clone());
    }
}
fn compound_desc() -> Shape {
    Shape::Compound {
        parts: [-0.6, 0.6]
            .into_iter()
            .map(|x| ShapePart {
                pose: Pose {
                    position: [x, 0.0, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Sphere { radius: 0.4 },
            })
            .collect(),
    }
}
fn fixture(space: Space) -> (PhysicsWorld3d, Vec<ColliderId>) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space,
        ..WorldConfig::default()
    })
    .unwrap();
    body(
        &mut world,
        BodyKind::Fixed,
        0.0,
        -0.5,
        Shape::Box {
            half_extents: [20.0, 0.5, 20.0],
        },
    );
    let mut ids = Vec::new();
    for (index, x) in [0.0, 0.0, 3.0, 6.0, 9.0, 12.0, 15.0, 18.0]
        .into_iter()
        .enumerate()
    {
        let shape = if (2..=4).contains(&index) {
            compound_desc()
        } else {
            Shape::Sphere {
                radius: if index == 7 { 0.7 } else { 0.4 },
            }
        };
        let kind = if index < 2 {
            BodyKind::Dynamic
        } else {
            BodyKind::Fixed
        };
        ids.push(
            body(
                &mut world,
                kind,
                x,
                if index == 1 { 1.18 } else { 0.39 },
                shape,
            )
            .1,
        );
    }
    for _ in 0..4 {
        world.step();
    }
    assert!(world
        .backend
        .narrow_phase
        .contact_pairs()
        .any(|pair| !pair.solver_manifolds().is_empty()));
    // Keep a real Core revision/query invalidation history as well as warm contacts.
    world
        .update_collider(ids[6], ColliderDesc::new(Shape::Sphere { radius: 0.4 }))
        .unwrap();
    assert!(world.collider_shape_revisions[&ids[6]] > 0);
    let ball = rp::SharedShape::ball(0.4);
    let separate = rp::SharedShape::ball(0.4);
    let compound = rp::SharedShape::compound(vec![
        (rp::Pose::translation(-0.6, 0.0, 0.0), ball.clone()),
        (rp::Pose::translation(0.6, 0.0, 0.0), ball.clone()),
    ]);
    let distinct_compound = rp::SharedShape::compound(vec![
        (rp::Pose::translation(-0.6, 0.0, 0.0), separate.clone()),
        (rp::Pose::translation(0.6, 0.0, 0.0), separate.clone()),
    ]);
    install_builder(&mut world, &ids[0..2], ball);
    install_builder(&mut world, &ids[2..4], compound);
    install_builder(&mut world, &ids[4..5], distinct_compound);
    install_builder(&mut world, &ids[5..6], separate);
    install_builder(&mut world, &ids[6..7], rp::SharedShape::ball(0.4));
    encoded(&world); // Existing native guards admit this actual pending history.
    (world, ids)
}

fn root_shape<'a>(world: &'a PhysicsWorld3d, entry: &Entry) -> &'a rp::SharedShape {
    match entry.location {
        RootLocation::Collider { slot, generation } => world
            .backend
            .colliders
            .get(rp::ColliderHandle::from_raw_parts(slot, generation))
            .unwrap()
            .shared_shape(),
        RootLocation::CompoundChild {
            slot,
            generation,
            index,
        } => {
            &world
                .backend
                .colliders
                .get(rp::ColliderHandle::from_raw_parts(slot, generation))
                .unwrap()
                .shared_shape()
                .as_compound()
                .unwrap()
                .shapes()[index as usize]
                .1
        }
    }
}
fn topology(world: &PhysicsWorld3d, table: &Table) {
    for a in 0..table.roots.len() {
        for b in 0..table.roots.len() {
            assert_eq!(
                Arc::ptr_eq(
                    &root_shape(world, &table.roots[a]).0,
                    &root_shape(world, &table.roots[b]).0
                ),
                table.roots[a].first == table.roots[b].first
            );
        }
    }
    assert_eq!(capture(world, limits()).unwrap().0, *table);
}
fn identities(world: &PhysicsWorld3d) -> Vec<usize> {
    let table = capture(world, limits()).unwrap().0;
    table
        .roots
        .iter()
        .map(|entry| Arc::as_ptr(&root_shape(world, entry).0) as *const () as usize)
        .collect()
}
fn native_diagnostic(world: &PhysicsWorld3d) -> String {
    let reference = rp::validate_stored_references(
        &world.backend,
        rp::StoredReferenceLimits {
            max_work: 128 * 1024 * 1024,
            max_scratch_bytes: 64 * 1024 * 1024,
        },
    );
    if reference.is_err() {
        return format!("reference={reference:?}");
    }
    let islands = rp::validate_stored_islands(
        &world.backend,
        rp::StoredIslandLimits {
            max_work: 128 * 1024 * 1024,
            max_scratch_bytes: 64 * 1024 * 1024,
        },
    );
    if islands.is_err() {
        return format!("islands={islands:?}");
    }
    let numeric = rp::validate_stored_contact_numerics(
        &world.backend,
        rp::StoredContactNumericLimits {
            max_work: 128 * 1024 * 1024,
        },
    );
    if numeric.is_err() {
        return format!("contact_numeric={numeric:?}");
    }
    let workspace = rp::validate_stored_contact_workspaces(
        &world.backend,
        rp::StoredWorkspaceLimits {
            max_work: 128 * 1024 * 1024,
            max_scratch_bytes: 64 * 1024 * 1024,
        },
    );
    if workspace.is_err() {
        return format!("workspace={workspace:?}");
    }
    let body = rp::validate_stored_body_numerics(
        &world.backend.bodies,
        &world.backend.colliders,
        rp::StoredBodyNumericLimits {
            max_work: 128 * 1024 * 1024,
            max_additional_solver_iterations: 32,
            max_additional_pgs_iterations: 32,
        },
    );
    format!("all prior RP guards ok; body={body:?}")
}
fn replay(source: &mut PhysicsWorld3d, restored: &mut PhysicsWorld3d) {
    for tick in 0..6 {
        source.step();
        restored.step();
        let original = source.capture_snapshot().unwrap_or_else(|error| {
            panic!(
                "source tick {tick}: {error:?}; {}",
                native_diagnostic(source)
            )
        });
        let candidate = restored.capture_snapshot().unwrap_or_else(|error| {
            panic!(
                "restored tick {tick}: {error:?}; {}",
                native_diagnostic(restored)
            )
        });
        assert_eq!(original.encoded_bytes(), candidate.encoded_bytes());
    }
}

#[test]
fn file_shape_alias_vendor_roots_children_distinct_equal_and_pending_history_replay() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut source, ids) = fixture(space);
        let before = encoded(&source);
        let (table, capture_usage) = capture(&source, limits()).unwrap();
        assert_eq!(capture_usage.compare_bytes, 0);
        assert_eq!(table.root_count(), 15);
        topology(&source, &table);
        assert!(Arc::ptr_eq(
            &shared(&source, ids[0]).0,
            &shared(&source, ids[1]).0
        ));
        assert!(!Arc::ptr_eq(
            &shared(&source, ids[0]).0,
            &shared(&source, ids[6]).0
        ));
        assert!(Arc::ptr_eq(
            &shared(&source, ids[2]).0,
            &shared(&source, ids[3]).0
        ));
        assert!(!Arc::ptr_eq(
            &shared(&source, ids[2]).0,
            &shared(&source, ids[4]).0
        ));
        let mut restored = fresh(&source);
        let lost = capture(&restored, limits()).unwrap().0;
        assert!(lost
            .roots
            .iter()
            .enumerate()
            .all(|(index, root)| root.first == index as u32));
        let revision = restored.collider_shape_revisions.clone();
        let usage = restore(&mut restored, &table, limits()).unwrap();
        assert!(usage.compare_bytes > 0 && usage.work >= usage.compare_bytes as u64);
        assert_eq!(encoded(&source), before);
        assert_eq!(encoded(&restored), before);
        assert_eq!(restored.collider_shape_revisions, revision);
        topology(&restored, &table);
        // Idempotent restore must not split or clone already correct parents.
        restore(&mut restored, &table, limits()).unwrap();
        topology(&restored, &table);
        replay(&mut source, &mut restored);
    }
}

#[test]
fn file_shape_alias_restored_arc_copy_on_write_matches_source() {
    let (mut source, ids) = fixture(Space::Spatial);
    let table = capture(&source, limits()).unwrap().0;
    let mut restored = fresh(&source);
    restore(&mut restored, &table, limits()).unwrap();
    for world in [&mut source, &mut restored] {
        world
            .backend
            .colliders
            .get_mut(handle(ids[0]))
            .unwrap()
            .shape_mut()
            .as_ball_mut()
            .unwrap()
            .radius = 0.5;
        assert_eq!(shared(world, ids[1]).as_ball().unwrap().radius, 0.4);
        assert!(!Arc::ptr_eq(
            &shared(world, ids[0]).0,
            &shared(world, ids[1]).0
        ));
        world
            .backend
            .colliders
            .get_mut(handle(ids[2]))
            .unwrap()
            .shape_mut()
            .as_compound_mut()
            .unwrap()
            .set_flags(
                rapier3d::parry::shape::CompoundFlags::FIX_INTERNAL_EDGES,
                None,
            );
        assert!(!Arc::ptr_eq(
            &shared(world, ids[2]).0,
            &shared(world, ids[3]).0
        ));
        assert_eq!(
            shared(world, ids[3]).as_compound().unwrap().flags().bits(),
            0
        );
    }
    assert_eq!(encoded(&source), encoded(&restored));
    assert_eq!(
        capture(&source, limits()).unwrap().0,
        capture(&restored, limits()).unwrap().0
    );
    replay(&mut source, &mut restored);
}

fn shapes() -> Vec<rp::SharedShape> {
    let points = [
        rp::Vector::new(0.0, 0.0, 0.0),
        rp::Vector::new(1.0, 0.0, 0.0),
        rp::Vector::new(0.0, 1.0, 0.0),
        rp::Vector::new(0.0, 0.0, 1.0),
    ];
    vec![
        rp::SharedShape::ball(0.4),
        rp::SharedShape::cuboid(0.3, 0.4, 0.5),
        rp::SharedShape::capsule_y(0.3, 0.2),
        rp::SharedShape::convex_hull(&points).unwrap(),
        rp::SharedShape::trimesh(points[..3].to_vec(), vec![[0, 1, 2]]).unwrap(),
        rp::SharedShape::heightfield(
            rapier3d::geometry::Array2::new(2, 2, vec![0.0, 0.1, 0.2, 0.0]),
            rp::Vector::new(2.0, 1.0, 2.0),
        ),
        rp::SharedShape::compound(vec![(rp::Pose::IDENTITY, rp::SharedShape::ball(0.4))]),
    ]
}

#[test]
fn file_shape_alias_all_seven_shapes_roundtrip_and_replay_without_memory_wire_changes() {
    for shape in shapes() {
        let mut source = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        let a = body(
            &mut source,
            BodyKind::Fixed,
            0.0,
            3.0,
            Shape::Sphere { radius: 0.4 },
        )
        .1;
        let b = body(
            &mut source,
            BodyKind::Fixed,
            5.0,
            3.0,
            Shape::Sphere { radius: 0.4 },
        )
        .1;
        install_builder(&mut source, &[a, b], shape);
        source
            .backend
            .colliders
            .get_mut(handle(b))
            .unwrap()
            .set_enabled(false);
        let before = encoded(&source);
        let table = capture(&source, limits()).unwrap().0;
        let mut restored = fresh(&source);
        restore(&mut restored, &table, limits()).unwrap();
        assert_eq!(encoded(&restored), before);
        topology(&restored, &table);
        replay(&mut source, &mut restored);
    }
}

#[test]
fn file_shape_alias_safe_vendor_proof_rejects_different_bits_and_stale_cow_target() {
    let p_limits = proof::Limits {
        max_work: 100000,
        max_scratch_bytes: 100000,
        max_compare_bytes: 100000,
    };
    let a = rp::SharedShape::ball(0.4);
    let b = rp::SharedShape::ball(0.5);
    assert!(matches!(
        proof::EquivalentShape::prepare(&a, &b, &mut proof::Budget::new(p_limits)),
        Err(proof::Error::DifferentValue)
    ));
    let positive = rp::SharedShape::ball(0.0);
    let negative = rp::SharedShape::ball(-0.0);
    assert_eq!(positive.as_ball(), negative.as_ball()); // PartialEq would miss this.
    assert!(matches!(
        proof::EquivalentShape::prepare(&positive, &negative, &mut proof::Budget::new(p_limits)),
        Err(proof::Error::DifferentValue)
    ));
    let b = rp::SharedShape::ball(0.4);
    let token = proof::EquivalentShape::prepare(&a, &b, &mut proof::Budget::new(p_limits)).unwrap();
    let mut target = a.clone();
    target.make_mut().as_ball_mut().unwrap().radius = 0.9;
    assert_eq!(token.apply(&mut target), Err(proof::Error::StaleProof));
    assert_eq!(target.as_ball().unwrap().radius, 0.9);
    // Same geometry with different stored flags/pseudo-normal metadata differs.
    let a = rp::SharedShape::compound(vec![(rp::Pose::IDENTITY, rp::SharedShape::ball(0.4))]);
    let mut b = a.clone();
    b.make_mut().as_compound_mut().unwrap().set_flags(
        rapier3d::parry::shape::CompoundFlags::FIX_INTERNAL_EDGES,
        None,
    );
    assert!(matches!(
        proof::EquivalentShape::prepare(&a, &b, &mut proof::Budget::new(p_limits)),
        Err(proof::Error::DifferentValue)
    ));
}

fn ordinal(table: &Table, id: ColliderId) -> usize {
    table
        .roots
        .iter()
        .position(|row| row.location == location(id))
        .unwrap()
}
fn decoded_table(table: &Table) -> Table {
    crate::checkpoint_codec::decode(&crate::checkpoint_codec::encode(table).unwrap()).unwrap()
}

#[test]
fn file_shape_alias_raw_table_corruptions_reject_before_mutation_or_consumption() {
    let (source, ids) = fixture(Space::Spatial);
    let live_before = encoded(&source);
    let table = capture(&source, limits()).unwrap().0;
    let a = ordinal(&table, ids[0]);
    let b = ordinal(&table, ids[1]);
    let d = ordinal(&table, ids[3]);
    let h = ordinal(&table, ids[7]);
    let mut cases = Vec::new();
    let mut bad = table.clone();
    bad.version = 0;
    cases.push((bad, Error::Version));
    let mut bad = table.clone();
    bad.roots.pop();
    cases.push((bad, Error::RootLocation));
    let mut bad = table.clone();
    bad.roots.push(bad.roots[0]);
    cases.push((bad, Error::RootLocation));
    let mut bad = table.clone();
    bad.roots[a].location = RootLocation::Collider {
        slot: u32::MAX,
        generation: 0,
    };
    cases.push((bad, Error::RootLocation));
    let mut bad = table.clone();
    bad.roots[a].location = RootLocation::Collider {
        slot: ids[0].slot,
        generation: ids[0].generation + 1,
    };
    cases.push((bad, Error::RootLocation));
    let mut bad = table.clone();
    bad.roots[d + 1].location = RootLocation::CompoundChild {
        slot: ids[3].slot,
        generation: ids[3].generation,
        index: u32::MAX,
    };
    cases.push((bad, Error::RootLocation));
    let mut bad = table.clone();
    bad.roots[a].location = RootLocation::CompoundChild {
        slot: ids[0].slot,
        generation: ids[0].generation,
        index: 0,
    };
    cases.push((bad, Error::RootLocation));
    let mut bad = table.clone();
    bad.roots.swap(a, b);
    cases.push((bad, Error::RootLocation));
    let mut bad = table.clone();
    bad.roots[0].first = 1;
    cases.push((bad, Error::Group));
    let mut bad = table.clone();
    bad.roots[a].first = u32::MAX;
    cases.push((bad, Error::Group));
    let mut bad = table.clone();
    bad.roots[d + 1].first = b as u32;
    cases.push((bad, Error::Group));
    let mut bad = table.clone();
    bad.roots[h].first = a as u32;
    cases.push((bad, Error::DifferentValue));
    let mut bad = table.clone();
    bad.roots[d + 1].first = (d + 1) as u32;
    cases.push((bad, Error::ChildTopology));
    let mut bad = table.clone();
    for root in &mut bad.roots {
        if root.first == a as u32 {
            root.first = 0;
        }
    }
    cases.push((bad, Error::DifferentValue));
    assert_eq!(cases.len(), 14);
    for (bad, expected) in cases {
        let input = crate::checkpoint_codec::encode(&bad).unwrap();
        let parsed = decoded_table(&bad);
        let mut candidate = fresh(&source);
        let before = encoded(&candidate);
        let pointers = identities(&candidate);
        assert_eq!(restore(&mut candidate, &parsed, limits()), Err(expected));
        assert_eq!(encoded(&candidate), before);
        assert_eq!(identities(&candidate), pointers);
        assert_eq!(crate::checkpoint_codec::encode(&parsed).unwrap(), input);
        assert_eq!(encoded(&source), live_before);
        // Raw file tables and malformed candidates only reach this guard.
    }
}

#[test]
fn file_shape_alias_candidate_value_and_existing_identity_conflicts_preserve_all_roots() {
    let (mut source, ids) = fixture(Space::Spatial);
    let table = capture(&source, limits()).unwrap().0;
    let mut candidate = fresh(&source);
    candidate
        .backend
        .colliders
        .get_mut(handle(ids[1]))
        .unwrap()
        .set_shape(rp::SharedShape::ball(0.8));
    let before = encoded(&candidate);
    let pointers = identities(&candidate);
    assert_eq!(
        restore(&mut candidate, &table, limits()),
        Err(Error::DifferentValue)
    );
    assert_eq!(encoded(&candidate), before);
    assert_eq!(identities(&candidate), pointers);
    let mut bad = table.clone();
    let b = ordinal(&bad, ids[1]);
    bad.roots[b].first = b as u32;
    let before = encoded(&source);
    assert_eq!(
        restore(&mut source, &bad, limits()),
        Err(Error::ExistingSharing)
    );
    assert_eq!(encoded(&source), before);
    topology(&source, &table);
    let mut candidate = fresh(&source);
    let parent = shared(&candidate, ids[2]).clone(); // Deliberately not fresh/unique.
    let before = encoded(&candidate);
    let pointers = identities(&candidate);
    assert_eq!(
        restore(&mut candidate, &table, limits()),
        Err(Error::ParentNotUnique)
    );
    assert_eq!(encoded(&candidate), before);
    assert_eq!(identities(&candidate), pointers);
    drop(parent);
    restore(&mut candidate, &table, limits()).unwrap();
    topology(&candidate, &table);
}

#[test]
fn file_shape_alias_exact_work_scratch_root_compare_limits_are_precharged_and_readonly() {
    let (source, _) = fixture(Space::Spatial);
    let source_before = encoded(&source);
    let (table, captured) = capture(&source, limits()).unwrap();
    let cap_limits = Limits {
        max_work: captured.work,
        max_scratch_bytes: captured.scratch_bytes,
        max_roots: table.root_count(),
        max_compare_bytes: 0,
    };
    assert_eq!(capture(&source, cap_limits).unwrap().1, captured);
    for bad in [
        Limits {
            max_work: captured.work - 1,
            ..cap_limits
        },
        Limits {
            max_scratch_bytes: captured.scratch_bytes - 1,
            ..cap_limits
        },
        Limits {
            max_roots: table.root_count() - 1,
            ..cap_limits
        },
    ] {
        assert!(capture(&source, bad).unwrap_err().is_resource_limit());
        assert_eq!(encoded(&source), source_before);
    }
    let mut candidate = fresh(&source);
    let usage = restore(&mut candidate, &table, limits()).unwrap();
    assert!(usage.compare_bytes > 0 && usage.work > usage.compare_bytes as u64);
    let exact = Limits {
        max_work: usage.work,
        max_scratch_bytes: usage.scratch_bytes,
        max_roots: table.root_count(),
        max_compare_bytes: usage.compare_bytes,
    };
    let mut candidate = fresh(&source);
    assert_eq!(restore(&mut candidate, &table, exact), Ok(usage));
    for bad in [
        Limits {
            max_work: usage.work - 1,
            ..exact
        },
        Limits {
            max_scratch_bytes: usage.scratch_bytes - 1,
            ..exact
        },
        Limits {
            max_roots: table.root_count() - 1,
            ..exact
        },
        Limits {
            max_compare_bytes: usage.compare_bytes - 1,
            ..exact
        },
        Limits {
            max_work: 0,
            ..exact
        },
    ] {
        let mut candidate = fresh(&source);
        let before = encoded(&candidate);
        let pointers = identities(&candidate);
        assert!(restore(&mut candidate, &table, bad)
            .unwrap_err()
            .is_resource_limit());
        assert_eq!(encoded(&candidate), before);
        assert_eq!(identities(&candidate), pointers);
        assert_eq!(encoded(&source), source_before);
    }
}

#[test]
fn file_shape_alias_pending_removal_generation_reuse_and_empty_census_are_preserved() {
    let empty = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let mut restored_empty = fresh(&empty);
    let (none, _) = capture(
        &empty,
        Limits {
            max_roots: 0,
            ..limits()
        },
    )
    .unwrap();
    assert_eq!(none.root_count(), 0);
    restore(
        &mut restored_empty,
        &none,
        Limits {
            max_roots: 0,
            ..limits()
        },
    )
    .unwrap();
    assert_eq!(encoded(&empty), encoded(&restored_empty));
    let (mut source, ids) = fixture(Space::Spatial);
    let old_table = capture(&source, limits()).unwrap().0;
    let old = ids[1];
    let owner = source.collider_owner(old).unwrap().body;
    source.remove_collider(old).unwrap();
    let new = source
        .add_collider(owner, ColliderDesc::new(Shape::Sphere { radius: 0.4 }))
        .unwrap();
    assert_eq!(new.slot, old.slot);
    assert!(new.generation > old.generation);
    let shared_ball = shared(&source, ids[0]).clone();
    install_builder(&mut source, &[new], shared_ball);
    let table = capture(&source, limits()).unwrap().0;
    assert!(!table
        .roots
        .iter()
        .any(|entry| entry.location == location(old)));
    assert!(table
        .roots
        .iter()
        .any(|entry| entry.location == location(new)));
    let mut restored = fresh(&source);
    let before = encoded(&restored);
    assert_eq!(
        restore(&mut restored, &old_table, limits()),
        Err(Error::RootLocation)
    );
    assert_eq!(encoded(&restored), before);
    restore(&mut restored, &table, limits()).unwrap();
    topology(&restored, &table);
    assert_eq!(encoded(&source), encoded(&restored));
    replay(&mut source, &mut restored);
}

// A public custom Shape can claim a built-in tag and even serialize exactly as
// a Ball. The safe proof must use actual Any downcasts and never its query code.
#[derive(Clone)]
struct SpoofBall(rapier3d::parry::shape::Ball);
impl rapier3d::parry::query::RayCast for SpoofBall {
    fn cast_local_ray_and_get_normal(
        &self,
        _: &rapier3d::parry::query::Ray,
        _: f32,
        _: bool,
    ) -> Option<rapier3d::parry::query::RayIntersection> {
        panic!("guard-only custom query")
    }
}
impl rapier3d::parry::query::PointQuery for SpoofBall {
    fn project_local_point(
        &self,
        _: rp::Vector,
        _: bool,
    ) -> rapier3d::parry::query::PointProjection {
        panic!("guard-only custom query")
    }
    fn project_local_point_and_get_feature(
        &self,
        _: rp::Vector,
    ) -> (
        rapier3d::parry::query::PointProjection,
        rapier3d::parry::shape::FeatureId,
    ) {
        panic!("guard-only custom query")
    }
}
impl rapier3d::parry::shape::Shape for SpoofBall {
    fn compute_local_aabb(&self) -> rapier3d::parry::bounding_volume::Aabb {
        panic!("guard-only custom geometry")
    }
    fn compute_local_bounding_sphere(&self) -> rapier3d::parry::bounding_volume::BoundingSphere {
        panic!("guard-only custom geometry")
    }
    fn clone_dyn(&self) -> Box<dyn rapier3d::parry::shape::Shape> {
        Box::new(self.clone())
    }
    fn scale_dyn(&self, _: rp::Vector, _: u32) -> Option<Box<dyn rapier3d::parry::shape::Shape>> {
        panic!("guard-only custom geometry")
    }
    fn mass_properties(&self, _: f32) -> rapier3d::parry::mass_properties::MassProperties {
        panic!("guard-only custom geometry")
    }
    fn shape_type(&self) -> rapier3d::parry::shape::ShapeType {
        rapier3d::parry::shape::ShapeType::Ball
    }
    fn as_typed_shape(&self) -> rapier3d::parry::shape::TypedShape<'_> {
        rapier3d::parry::shape::TypedShape::Ball(&self.0)
    }
    fn ccd_thickness(&self) -> f32 {
        panic!("guard-only custom geometry")
    }
    fn ccd_angular_thickness(&self) -> f32 {
        panic!("guard-only custom geometry")
    }
}

#[test]
fn file_shape_alias_custom_shape_tag_spoof_cannot_forge_a_same_value_proof() {
    let fake = rp::SharedShape::new(SpoofBall(rapier3d::parry::shape::Ball::new(0.4)));
    let real = rp::SharedShape::ball(0.4);
    assert_eq!(
        postcard::to_allocvec(&fake).unwrap(),
        postcard::to_allocvec(&real).unwrap()
    );
    let mut budget = proof::Budget::new(proof::Limits {
        max_work: 100000,
        max_scratch_bytes: 100000,
        max_compare_bytes: 100000,
    });
    assert!(matches!(
        proof::EquivalentShape::prepare(&fake, &real, &mut budget),
        Err(proof::Error::UnsupportedShape)
    ));
    assert_eq!(budget.usage().compare_bytes, 0);
    // No custom shape ever reaches collider construction, query or simulation.
}

#[test]
fn file_shape_alias_native_wasi_sidecar_golden_has_only_stable_locations_and_ordinals() {
    let mut golden = Vec::new();
    for space in [Space::PlanarXy, Space::Spatial] {
        let (source, _) = fixture(space);
        let (table, _) = capture(&source, limits()).unwrap();
        let encoded = postcard::to_allocvec(&table).unwrap();
        golden.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
        golden.extend_from_slice(&encoded);
        let mut restored = fresh(&source);
        restore(&mut restored, &decoded_table(&table), limits()).unwrap();
        let again = postcard::to_allocvec(&capture(&restored, limits()).unwrap().0).unwrap();
        assert_eq!(encoded, again);
    }
    let hex = golden
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    println!("SHAPE_ALIAS_GOLDEN {hex}");
    assert_eq!(golden.len(), 144);
}
