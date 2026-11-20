//! Normal producer regression: removed collider raw slot reused before broad phase.
use super::*;
use rapier3d::prelude as rp;

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
fn native_diagnostic(world: &PhysicsWorld3d) -> String {
    format!(
        "reference={:?}",
        rp::validate_stored_references(
            &world.backend,
            rp::StoredReferenceLimits {
                max_work: 128 * 1024 * 1024,
                max_scratch_bytes: 64 * 1024 * 1024
            }
        )
    )
}
// Read-only projection of the actual persistent BroadPhase wire, used solely
// to localize a normal producer regression without exposing vendor internals.
#[derive(serde::Deserialize)]
struct SavedBroadPhaseProbe {
    _tree: rapier3d::parry::partitioning::Bvh,
    pairs: Vec<((rp::ColliderHandle, rp::ColliderHandle), u32)>,
    pair_adjacency: SavedAdjacencyProbe,
    _prev_updated_leaves: Vec<u32>,
    pending_set_aabb: Vec<rp::ColliderHandle>,
    _changes_since_optimize: u32,
    _reinsert_leaf_updates: bool,
    _frame_index: u32,
    _optimization_strategy: rapier3d::geometry::BvhOptimizationStrategy,
    _adaptive_change_detection_margin: bool,
}
#[derive(serde::Deserialize)]
struct SavedAdjacencyProbe {
    data: Vec<(u32, Vec<rp::ColliderHandle>)>,
}
fn assert_current_graph(world: &PhysicsWorld3d) {
    rp::validate_stored_references(
        &world.backend,
        rp::StoredReferenceLimits {
            max_work: 128 * 1024 * 1024,
            max_scratch_bytes: 64 * 1024 * 1024,
        },
    )
    .unwrap();
    let wire = postcard::to_allocvec(&world.backend.broad_phase).unwrap();
    let saved: SavedBroadPhaseProbe = postcard::from_bytes(&wire).unwrap();
    let mut expected = Vec::new();
    for &((a, b), _) in &saved.pairs {
        assert!(world.backend.colliders.contains(a));
        assert!(world.backend.colliders.contains(b));
        expected.push((a.into_raw_parts(), b.into_raw_parts()));
        expected.push((b.into_raw_parts(), a.into_raw_parts()));
    }
    let mut actual = Vec::new();
    for (slot, (generation, others)) in saved.pair_adjacency.data.iter().enumerate() {
        if others.is_empty() {
            continue;
        }
        let raw = (slot as u32, *generation);
        assert!(world
            .backend
            .colliders
            .contains(rp::ColliderHandle::from_raw_parts(raw.0, raw.1)));
        actual.extend(others.iter().map(|other| (raw, other.into_raw_parts())));
    }
    expected.sort_unstable();
    actual.sort_unstable();
    assert_eq!(actual, expected);
    let mut active = Vec::new();
    world.active_collision_pairs(&mut active);
    for pair in active {
        for side in [pair.first, pair.second] {
            assert!(world
                .backend
                .colliders
                .contains(rp::ColliderHandle::from_raw_parts(
                    side.collider.slot,
                    side.collider.generation
                )));
        }
    }
}

fn broad_phase_probe(world: &PhysicsWorld3d) {
    let wire = postcard::to_allocvec(&world.backend.broad_phase).unwrap();
    let saved: SavedBroadPhaseProbe = postcard::from_bytes(&wire).unwrap();
    let adjacency_count: usize = saved.pair_adjacency.data.iter().map(|(_, v)| v.len()).sum();
    let pairs: Vec<_> = saved
        .pairs
        .iter()
        .map(|((a, b), stamp)| (a.into_raw_parts(), b.into_raw_parts(), stamp))
        .collect();
    let adjacency: Vec<_> = saved
        .pair_adjacency
        .data
        .iter()
        .enumerate()
        .map(|(slot, (generation, others))| {
            (
                slot,
                generation,
                others
                    .iter()
                    .map(|h| h.into_raw_parts())
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    let pending: Vec<_> = saved
        .pending_set_aabb
        .iter()
        .map(|h| h.into_raw_parts())
        .collect();
    let removed: Vec<_> = world
        .backend
        .colliders
        .clone()
        .take_removed()
        .iter()
        .map(|h| h.into_raw_parts())
        .collect();
    println!("BROAD_PHASE_PROBE pair_count={} adjacency_count={} pairs={pairs:?} adjacency={adjacency:?} pending={pending:?} removed={removed:?}", saved.pairs.len(), adjacency_count);
}

#[test]
fn file_shape_alias_no_alias_source_remove_add_collider_next_step_probe() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    body(
        &mut world,
        BodyKind::Fixed,
        0.0,
        -0.5,
        Shape::Box {
            half_extents: [20.0, 0.5, 20.0],
        },
    );
    body(
        &mut world,
        BodyKind::Dynamic,
        0.0,
        0.39,
        Shape::Sphere { radius: 0.4 },
    );
    let (actor, old) = body(
        &mut world,
        BodyKind::Dynamic,
        0.0,
        1.18,
        Shape::Sphere { radius: 0.4 },
    );
    for _ in 0..4 {
        world.step();
    }
    world.capture_snapshot().unwrap();
    world.remove_collider(old).unwrap();
    let new = world
        .add_collider(actor, ColliderDesc::new(Shape::Sphere { radius: 0.4 }))
        .unwrap();
    assert_eq!(new.slot, old.slot);
    assert!(new.generation > old.generation);
    world.capture_snapshot().unwrap();
    let pending = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&pending).unwrap();
    // No capture/restore sidecar API or vendor alias setter is called here.
    world.step();
    restored.step();
    let result = world.capture_snapshot();
    println!(
        "NO_ALIAS_SOURCE_NEXT_STEP result={:?}; {}",
        result.as_ref().map(|_| ()),
        native_diagnostic(&world)
    );
    broad_phase_probe(&world);
    assert!(
        result.is_ok(),
        "normal Core remove/add next step must capture"
    );
    for tick in 0..6 {
        if tick != 0 {
            world.step();
            restored.step();
        }
        assert_current_graph(&world);
        assert_current_graph(&restored);
        let mut active = Vec::new();
        world.active_collision_pairs(&mut active);
        assert!(active
            .iter()
            .any(|pair| pair.first.collider == new || pair.second.collider == new));
        assert!(active
            .iter()
            .all(|pair| pair.first.collider != old && pair.second.collider != old));
        let ray = RayCast {
            origin: [0.0, 3.0, 0.0],
            direction: [0.0, -1.0, 0.0],
            max_distance: 10.0,
            solid: true,
        };
        let hit = world.cast_ray(&ray, &QueryFilter::default()).unwrap();
        assert_eq!(hit.as_ref().unwrap().target.collider, new);
        assert_eq!(
            hit,
            restored.cast_ray(&ray, &QueryFilter::default()).unwrap()
        );
        let mut original_events = Vec::new();
        let mut restored_events = Vec::new();
        world.drain_collision_events(&mut original_events);
        restored.drain_collision_events(&mut restored_events);
        assert_eq!(original_events, restored_events);
        if tick == 0 {
            assert!(original_events
                .iter()
                .any(|event| event.phase == CollisionPhase::Exit
                    && event.removed
                    && (event.first.collider == old || event.second.collider == old)));
            assert!(original_events
                .iter()
                .any(|event| event.phase == CollisionPhase::Enter
                    && (event.first.collider == new || event.second.collider == new)));
        }
        let a = world.capture_snapshot().unwrap();
        let b = restored.capture_snapshot().unwrap();
        assert_eq!(a.encoded_bytes(), b.encoded_bytes());
        let roundtrip = PhysicsWorld3d::from_snapshot(&a).unwrap();
        assert_eq!(
            a.encoded_bytes(),
            roundtrip.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

fn append_record(output: &mut Vec<u8>, bytes: &[u8]) {
    output.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    output.extend_from_slice(bytes);
}
fn prospective_broad_phase(world: &PhysicsWorld3d) -> Vec<u8> {
    // Drive an owned clone only, to record exact broad-phase Add/Delete sequence
    // and bytes without changing the live Core fixture or running a solver twice.
    let mut colliders = world.backend.colliders.clone();
    let modified = colliders.take_modified();
    let removed = colliders.take_removed();
    let mut broad = world.backend.broad_phase.clone();
    let mut events = Vec::new();
    broad.update(
        &world.backend.integration_parameters,
        &colliders,
        &world.backend.bodies,
        &modified,
        &removed,
        &mut events,
    );
    let events: Vec<_> = events
        .into_iter()
        .map(|event| {
            let (kind, pair) = match event {
                rp::BroadPhasePairEvent::AddPair(pair) => (0u8, pair),
                rp::BroadPhasePairEvent::DeletePair(pair) => (1u8, pair),
            };
            (
                kind,
                pair.collider1.into_raw_parts(),
                pair.collider2.into_raw_parts(),
            )
        })
        .collect();
    postcard::to_allocvec(&(broad, events)).unwrap()
}

#[test]
fn file_shape_alias_broad_phase_nonreuse_preserves_legacy_order_and_bytes() {
    let mut output = Vec::new();
    for space in [Space::PlanarXy, Space::Spatial] {
        for scenario in 0..6 {
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
            let (_, first) = body(
                &mut world,
                BodyKind::Dynamic,
                0.0,
                0.39,
                Shape::Sphere { radius: 0.4 },
            );
            let (actor, last) = body(
                &mut world,
                BodyKind::Dynamic,
                0.0,
                1.18,
                Shape::Sphere { radius: 0.4 },
            );
            for _ in 0..4 {
                world.step();
            }
            match scenario {
                0 => (),
                1 => {
                    world.remove_collider(last).unwrap();
                }
                2 => {
                    world.remove_collider(last).unwrap();
                    world.step();
                    world
                        .add_collider(actor, ColliderDesc::new(Shape::Sphere { radius: 0.4 }))
                        .unwrap();
                }
                3 => {
                    world
                        .backend
                        .colliders
                        .get_mut(rp::ColliderHandle::from_raw_parts(
                            last.slot,
                            last.generation,
                        ))
                        .unwrap()
                        .set_enabled(false);
                }
                4 => {
                    body(
                        &mut world,
                        BodyKind::Dynamic,
                        0.0,
                        1.95,
                        Shape::Sphere { radius: 0.4 },
                    );
                }
                5 => {
                    world.remove_collider(first).unwrap();
                    world.remove_collider(last).unwrap();
                }
                _ => unreachable!(),
            }
            for tick in 0..6 {
                append_record(&mut output, &prospective_broad_phase(&world));
                world.step();
                let snapshot = world.capture_snapshot().unwrap();
                append_record(
                    &mut output,
                    &postcard::to_allocvec(&world.backend.broad_phase).unwrap(),
                );
                let mut events = Vec::new();
                world.drain_collision_events(&mut events);
                append_record(&mut output, &postcard::to_allocvec(&events).unwrap());
                if scenario == 3 && tick == 2 {
                    world
                        .backend
                        .colliders
                        .get_mut(rp::ColliderHandle::from_raw_parts(
                            last.slot,
                            last.generation,
                        ))
                        .unwrap()
                        .set_enabled(true);
                }
                // Normal bytes remain decodable as well; the alias sidecar is unused.
                PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
            }
        }
    }
    assert_eq!(
        output,
        include_bytes!("broad_phase_nonreuse_golden.postcard")
    );
}

#[test]
fn file_shape_alias_broad_phase_repeated_generations_and_two_removed_neighbors() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for sensor in [false, true] {
            for repetitions in [1, 3] {
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
                let (a, mut ca) = body(
                    &mut world,
                    BodyKind::Dynamic,
                    0.0,
                    0.39,
                    Shape::Sphere { radius: 0.4 },
                );
                let (b, mut cb) = body(
                    &mut world,
                    BodyKind::Dynamic,
                    0.0,
                    1.18,
                    Shape::Sphere { radius: 0.4 },
                );
                for _ in 0..4 {
                    world.step();
                }
                for _ in 0..repetitions {
                    for (owner, id) in [(a, &mut ca), (b, &mut cb)] {
                        let old = *id;
                        world.remove_collider(old).unwrap();
                        let mut desc = ColliderDesc::new(Shape::Sphere { radius: 0.4 });
                        desc.sensor = sensor;
                        *id = world.add_collider(owner, desc).unwrap();
                        assert_eq!(id.slot, old.slot);
                        assert!(id.generation > old.generation);
                    }
                }
                let pending = world.capture_snapshot().unwrap();
                let mut restored = PhysicsWorld3d::from_snapshot(&pending).unwrap();
                for _ in 0..6 {
                    world.step();
                    restored.step();
                    assert_current_graph(&world);
                    assert_current_graph(&restored);
                    assert_eq!(
                        world.capture_snapshot().unwrap().encoded_bytes(),
                        restored.capture_snapshot().unwrap().encoded_bytes()
                    );
                }
            }
        }
    }
}
