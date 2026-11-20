use super::super::contact_workspaces as admission;
use super::*;
use rapier3d::parry::{query::ContactManifoldsWorkspace, utils::hashmap::HashMap};
use serde::{Deserialize, Serialize};

fn shapes() -> [(Shape, Shape); 5] {
    let ball = Shape::Sphere { radius: 0.3 };
    let mesh = Shape::TriangleMesh {
        vertices: vec![
            [-1.0, 0.0, -1.0],
            [-1.0, 0.0, 1.0],
            [1.0, 0.0, -1.0],
            [1.0, 0.0, 1.0],
        ],
        triangles: vec![[0, 1, 2], [1, 3, 2]],
    };
    let heightfield = Shape::Heightfield {
        rows: 3,
        columns: 3,
        heights: vec![0.0; 9],
        size: [4.0, 4.0],
    };
    let compound = Shape::Compound {
        parts: vec![
            ShapePart {
                pose: Pose {
                    position: [-0.2, 0.0, 0.0],
                    ..Pose::default()
                },
                shape: ball.clone(),
            },
            ShapePart {
                pose: Pose {
                    position: [0.2, 0.0, 0.0],
                    ..Pose::default()
                },
                shape: ball.clone(),
            },
        ],
    };
    let floor = Shape::Compound {
        parts: vec![
            ShapePart {
                pose: Pose {
                    position: [-1.0, -0.5, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Box {
                    half_extents: [1.0, 0.5, 1.0],
                },
            },
            ShapePart {
                pose: Pose {
                    position: [1.0, -0.5, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Box {
                    half_extents: [1.0, 0.5, 1.0],
                },
            },
        ],
    };
    [
        (mesh, ball.clone()),
        (heightfield.clone(), ball.clone()),
        (heightfield, compound.clone()),
        (floor.clone(), compound),
        (floor, ball),
    ]
}
fn scene(tag: usize, flipped: bool) -> (PhysicsWorld3d, BodyId) {
    let (fixed, moving) = shapes()[tag].clone();
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let dynamic;
    if flipped {
        dynamic = body(&mut world, BodyKind::Dynamic, [0.0, 0.3, 0.0], moving);
        body(&mut world, BodyKind::Fixed, [0.0; 3], fixed);
    } else {
        body(&mut world, BodyKind::Fixed, [0.0; 3], fixed);
        dynamic = body(&mut world, BodyKind::Dynamic, [0.0, 0.3, 0.0], moving);
    }
    step(&mut world, 4);
    world.capture_snapshot().unwrap();
    (world, dynamic)
}
#[derive(Serialize, Deserialize)]
struct Recycle {
    pos12: rp::Pose,
    rot1: rp::Rotation,
    rot2: rp::Rotation,
    max_extent: f32,
    max_drift: f32,
}
#[derive(Serialize, Deserialize)]
struct Rigid {
    manifolds: Vec<rp::ContactManifold>,
    solver_clusters: Vec<rp::ContactManifold>,
    solver_color: u8,
    solver_color_bodies: [u32; 2],
    workspace: Option<ContactManifoldsWorkspace>,
    recycle_state: Option<Recycle>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Detector {
    manifold_id: usize,
    timestamp: bool,
}
#[derive(Serialize, Deserialize)]
struct Map1 {
    timestamp: bool,
    sub_detectors: HashMap<u32, Detector>,
}
#[derive(Serialize, Deserialize)]
struct Map2 {
    timestamp: bool,
    sub_detectors: HashMap<(u32, u32), Detector>,
}
#[derive(Serialize, Deserialize)]
enum Wire {
    TriMesh {
        interferences: Vec<u32>,
        local_aabb2: rp::Aabb,
        old_interferences: Vec<u32>,
    },
    Heightfield(Map1),
    HeightfieldComposite(Map2),
    CompositeComposite(Map2),
    Composite(Map1),
}
fn alter(world: &mut PhysicsWorld3d, case: usize) {
    let mut pair = world
        .backend
        .narrow_phase
        .contact_pairs()
        .next()
        .unwrap()
        .clone();
    let needle = postcard::to_allocvec(&pair).unwrap();
    let data = postcard::to_allocvec(pair.rigid().unwrap()).unwrap();
    let mut rigid: Rigid = postcard::from_bytes(&data).unwrap();
    assert!(
        rigid.recycle_state.is_some(),
        "actual recycling state must be present"
    );
    assert_eq!(
        postcard::to_allocvec(&rigid).unwrap(),
        data,
        "exact actual RigidPairContacts wire fixture"
    );
    if case == 3 {
        rigid.workspace = Some(ContactManifoldsWorkspace::from(
            rapier3d::parry::query::details::VoxelsShapeContactManifoldsWorkspace::<2>::new(),
        ));
    } else {
        let bytes = postcard::to_allocvec(rigid.workspace.as_ref().unwrap()).unwrap();
        let mut wire: Wire = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(postcard::to_allocvec(&wire).unwrap(), bytes);
        match &mut wire {
            Wire::TriMesh {
                interferences,
                local_aabb2,
                old_interferences,
            } => match case {
                0 => old_interferences.push(0),
                1 => local_aabb2.mins.x = f32::NAN,
                2 => interferences[0] = u32::MAX,
                _ => unreachable!(),
            },
            Wire::Heightfield(value) | Wire::Composite(value) => match case {
                0 => value.sub_detectors.values_mut().next().unwrap().manifold_id = usize::MAX,
                1 => value.sub_detectors.values_mut().next().unwrap().timestamp = !value.timestamp,
                2 => {
                    let (&key, v) = value.sub_detectors.iter().next().unwrap();
                    let v = v.clone();
                    value.sub_detectors.retain(|k, _| *k != key);
                    value.sub_detectors.insert(key + 10_000, v);
                }
                _ => unreachable!(),
            },
            Wire::HeightfieldComposite(value) | Wire::CompositeComposite(value) => match case {
                0 => value.sub_detectors.values_mut().next().unwrap().manifold_id = usize::MAX,
                1 => value.sub_detectors.values_mut().next().unwrap().timestamp = !value.timestamp,
                2 => {
                    let (&key, v) = value.sub_detectors.iter().next().unwrap();
                    let v = v.clone();
                    value.sub_detectors.retain(|k, _| *k != key);
                    value.sub_detectors.insert((key.0 + 10_000, key.1), v);
                }
                _ => unreachable!(),
            },
        }
        rigid.workspace =
            Some(postcard::from_bytes(&postcard::to_allocvec(&wire).unwrap()).unwrap());
    }
    pair.contacts = rp::PairContacts::Rigid(
        postcard::from_bytes(&postcard::to_allocvec(&rigid).unwrap()).unwrap(),
    );
    let replacement = postcard::to_allocvec(&pair).unwrap();
    let mut raw = postcard::to_allocvec(&world.backend.narrow_phase).unwrap();
    let positions: Vec<_> = raw
        .windows(needle.len())
        .enumerate()
        .filter_map(|(i, bytes)| (bytes == needle).then_some(i))
        .collect();
    assert_eq!(positions.len(), 1);
    let at = positions[0];
    raw.splice(at..at + needle.len(), replacement);
    world.backend.narrow_phase = if case == 3 {
        // A known tiny vendor-only fixture: generic Serde intentionally still
        // supports Voxels. The Ferrum decode tag boundary would reject it before
        // construction, so use generic Serde only to test cold capture symmetry.
        postcard::from_bytes(&raw).unwrap()
    } else {
        crate::checkpoint_decode::with_limits(&raw, crate::checkpoint_decode::Limits::default())
            .unwrap()
            .0
    };
    assert_eq!(
        postcard::to_allocvec(&world.backend.narrow_phase).unwrap(),
        raw
    );
}
fn unchecked(world: &PhysicsWorld3d, header: &PhysicsSnapshot) -> PhysicsSnapshot {
    let raw = postcard::to_allocvec(&Capture { world }).unwrap();
    let mut bad = header.clone();
    bad.bytes.truncate(HEADER);
    bad.bytes.extend_from_slice(&raw);
    bad.bytes[20..24].copy_from_slice(&(raw.len() as u32).to_le_bytes());
    bad.bytes[24..28].copy_from_slice(&crc(&raw).to_le_bytes());
    assert!(bad.payload().is_ok());
    bad
}

#[test]
fn native_contact_workspaces_invalid_cache_and_unsupported_capture_reject_before_commit() {
    let mut count = 0;
    for tag in 0..5 {
        for flipped in [false, true] {
            for case in 0..4 {
                let (mut world, _) = scene(tag, flipped);
                let good = world.capture_snapshot().unwrap();
                let mut live = PhysicsWorld3d::from_snapshot(&good).unwrap();
                alter(&mut world, case);
                rp::validate_stored_references(&world.backend, REFERENCE_LIMITS).unwrap();
                islands::validate(&world.backend).unwrap();
                super::super::contact_numerics::validate(&world.backend).unwrap();
                let raw = postcard::to_allocvec(&Capture { world: &world }).unwrap();
                let bad = unchecked(&world, &good);
                assert_eq!(
                    world.capture_snapshot().unwrap_err(),
                    PhysicsSnapshotError::InvalidState,
                    "tag{tag} flip{flipped} case{case}"
                );
                assert!(matches!(
                    PhysicsWorld3d::from_snapshot(&bad),
                    Err(PhysicsSnapshotError::InvalidState)
                ));
                assert_eq!(
                    live.restore_snapshot(&bad),
                    Err(PhysicsSnapshotError::InvalidState)
                );
                assert_eq!(
                    postcard::to_allocvec(&Capture { world: &world }).unwrap(),
                    raw
                );
                assert_eq!(
                    live.capture_snapshot().unwrap().encoded_bytes(),
                    good.encoded_bytes()
                );
                count += 1;
                // Never step/query a corrupted cache.
            }
        }
    }
    eprintln!("WORKSPACE_CORE rejections={count} corrupt_steps=0");
}

#[test]
fn native_contact_workspaces_actual_five_flipped_sleep_and_pending_shape_replay() {
    for tag in 0..5 {
        for flipped in [false, true] {
            let (mut world, dynamic) = scene(tag, flipped);
            step(&mut world, 360);
            assert!(world.body_state(dynamic).unwrap().sleeping);
            let good = world.capture_snapshot().unwrap();
            let mut restored = PhysicsWorld3d::from_snapshot(&good).unwrap();
            same(&world, &restored, &[dynamic]);
            for _ in 0..6 {
                world.step();
                restored.step();
                same(&world, &restored, &[dynamic]);
            }
            let id = world.collider_ids(dynamic).unwrap().next().unwrap();
            world
                .update_collider(id, ColliderDesc::new(Shape::Sphere { radius: 0.25 }))
                .unwrap();
            let before = world.capture_snapshot().unwrap();
            let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
            same(&world, &restored, &[dynamic]);
            for _ in 0..6 {
                world.step();
                restored.step();
                same(&world, &restored, &[dynamic]);
                events(&mut world, &mut restored);
            }
        }
    }
}

#[test]
fn native_contact_workspaces_budget_failures_map_to_capacity_and_keep_exact_bytes() {
    for tag in 0..5 {
        let (world, _) = scene(tag, false);
        let before = world.capture_snapshot().unwrap();
        let used =
            rp::validate_stored_contact_workspaces(&world.backend, admission::LIMITS).unwrap();
        let exact = rp::StoredWorkspaceLimits {
            max_work: used.work,
            max_scratch_bytes: used.scratch_bytes,
        };
        admission::validate_with_limits(&world.backend, exact).unwrap();
        for limit in [
            rp::StoredWorkspaceLimits {
                max_work: used.work - 1,
                ..exact
            },
            rp::StoredWorkspaceLimits {
                max_scratch_bytes: used.scratch_bytes - 1,
                ..exact
            },
        ] {
            assert_eq!(
                admission::validate_with_limits(&world.backend, limit),
                Err(PhysicsSnapshotError::Capacity)
            );
            assert_eq!(
                world.capture_snapshot().unwrap().encoded_bytes(),
                before.encoded_bytes()
            );
        }
    }
}
