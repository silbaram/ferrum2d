use super::*;
use crate::prelude::*;
use parry::query::{
    ContactManifoldsWorkspace, DefaultQueryDispatcher, PersistentQueryDispatcher,
    TypedWorkspaceData, validate_stored_contact_workspace,
};
use parry::utils::{Array2, hashmap::HashMap};
use serde::{Deserialize, Serialize};

fn limits() -> StoredWorkspaceLimits {
    StoredWorkspaceLimits {
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn shapes() -> [(SharedShape, SharedShape); 5] {
    let ball = SharedShape::ball(0.3);
    let mesh = SharedShape::trimesh(
        vec![
            Vector::new(-1.0, 0.0, -1.0),
            Vector::new(-1.0, 0.0, 1.0),
            Vector::new(1.0, 0.0, -1.0),
            Vector::new(1.0, 0.0, 1.0),
            Vector::new(20.0, 0.0, 20.0),
            Vector::new(20.0, 0.0, 21.0),
            Vector::new(21.0, 0.0, 20.0),
        ],
        vec![[0, 1, 2], [1, 3, 2], [4, 5, 6]],
    )
    .unwrap();
    let heightfield =
        SharedShape::heightfield(Array2::repeat(3, 3, 0.0), Vector::new(4.0, 1.0, 4.0));
    let compound = SharedShape::compound(vec![
        (Pose::translation(-0.2, 0.0, 0.0), ball.clone()),
        (Pose::translation(0.2, 0.0, 0.0), ball.clone()),
    ]);
    [
        (mesh, ball.clone()),
        (heightfield.clone(), ball.clone()),
        (heightfield, compound.clone()),
        (compound.clone(), compound.clone()),
        (compound, ball),
    ]
}
fn query(
    a: &dyn parry::shape::Shape,
    b: &dyn parry::shape::Shape,
    pos: Pose,
    m: &mut Vec<ContactManifold>,
    w: &mut Option<ContactManifoldsWorkspace>,
) {
    DefaultQueryDispatcher
        .contact_manifolds(&pos, a, b, 0.01, m, w)
        .unwrap();
}
fn cache(
    tag: usize,
    flipped: bool,
) -> (
    SharedShape,
    SharedShape,
    Vec<ContactManifold>,
    ContactManifoldsWorkspace,
) {
    let (mut a, mut b) = shapes()[tag].clone();
    if flipped {
        core::mem::swap(&mut a, &mut b);
    }
    let (mut m, mut w) = (Vec::new(), None);
    query(&*a, &*b, Pose::IDENTITY, &mut m, &mut w);
    assert!(!m.is_empty());
    let actual = match w.as_ref().unwrap().0.as_typed_workspace_data() {
        TypedWorkspaceData::TriMeshShapeContactManifoldsWorkspace(_) => 0,
        TypedWorkspaceData::HeightfieldShapeContactManifoldsWorkspace(_) => 1,
        TypedWorkspaceData::HeightfieldCompositeShapeContactManifoldsWorkspace(_) => 2,
        TypedWorkspaceData::CompositeShapeCompositeShapeContactManifoldsWorkspace(_) => 3,
        TypedWorkspaceData::CompositeShapeShapeContactManifoldsWorkspace(_) => 4,
        _ => unreachable!(),
    };
    assert_eq!(actual, tag);
    (a, b, m, w.unwrap())
}
fn validate(
    m: &[ContactManifold],
    w: &ContactManifoldsWorkspace,
    a: &dyn parry::shape::Shape,
    b: &dyn parry::shape::Shape,
) -> Result<StoredWorkspaceUsage, StoredWorkspaceError> {
    validate_stored_contact_workspace(w, m, Some((a, b)), limits())
}
#[derive(Clone, Serialize, Deserialize)]
struct Detector {
    manifold_id: usize,
    timestamp: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Map1 {
    timestamp: bool,
    sub_detectors: HashMap<u32, Detector>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Map2 {
    timestamp: bool,
    sub_detectors: HashMap<(u32, u32), Detector>,
}
#[derive(Clone, Serialize, Deserialize)]
enum Wire {
    TriMesh {
        interferences: Vec<u32>,
        local_aabb2: crate::geometry::Aabb,
        old_interferences: Vec<u32>,
    },
    Heightfield(Map1),
    HeightfieldComposite(Map2),
    CompositeComposite(Map2),
    Composite(Map1),
}
fn wire(w: &ContactManifoldsWorkspace) -> Wire {
    let bytes = bincode::serialize(w).unwrap();
    let result: Wire = bincode::deserialize(&bytes).unwrap();
    assert_eq!(bincode::serialize(&result).unwrap(), bytes);
    result
}
fn restore_wire(w: &Wire) -> ContactManifoldsWorkspace {
    bincode::deserialize(&bincode::serialize(w).unwrap()).unwrap()
}
fn guard_rejects(
    m: &[ContactManifold],
    w: &ContactManifoldsWorkspace,
    a: &dyn parry::shape::Shape,
    b: &dyn parry::shape::Shape,
) {
    let before = bincode::serialize(&(m, w)).unwrap();
    assert!(validate(m, w, a, b).is_err());
    assert_eq!(bincode::serialize(&(m, w)).unwrap(), before);
    // Corrupt fixtures only run the safe guard, never dispatcher/solver.
}

#[test]
fn stored_workspaces_five_producers_flipped_empty_reuse_and_query_continuation() {
    for tag in 0..5 {
        for flipped in [false, true] {
            let (a, b, mut m, w) = cache(tag, flipped);
            validate(&m, &w, &*a, &*b).unwrap();
            let before = bincode::serialize(&(&m, &w)).unwrap();
            let (mut restored_m, restored_w): (Vec<ContactManifold>, ContactManifoldsWorkspace) =
                bincode::deserialize(&before).unwrap();
            assert_eq!(
                bincode::serialize(&(&restored_m, &restored_w)).unwrap(),
                before
            );
            let mut w = Some(w);
            let mut restored_w = Some(restored_w);
            for step in 1..=6 {
                let pos = Pose::translation(step as f32 * 0.001, 0.0, 0.0);
                query(&*a, &*b, pos, &mut m, &mut w);
                query(&*a, &*b, pos, &mut restored_m, &mut restored_w);
                validate(&m, w.as_ref().unwrap(), &*a, &*b).unwrap();
                assert_eq!(
                    bincode::serialize(&(&m, &w)).unwrap(),
                    bincode::serialize(&(&restored_m, &restored_w)).unwrap(),
                    "tag{tag} flip{flipped} step{step}"
                );
            }
            query(&*a, &*b, Pose::translation(0.0, 100.0, 0.0), &mut m, &mut w);
            assert!(m.is_empty());
            validate(&m, w.as_ref().unwrap(), &*a, &*b).unwrap();
        }
    }
}

#[test]
fn stored_workspaces_map_timestamps_indices_bijections_and_owners_reject_without_execution() {
    for tag in 1..5 {
        for flipped in [false, true] {
            for case in 0..8 {
                let (a, b, mut m, w) = cache(tag, flipped);
                let mut raw = wire(&w);
                match &mut raw {
                    Wire::Heightfield(value) | Wire::Composite(value) => {
                        assert!(value.sub_detectors.len() > 1);
                        match case {
                            0 => {
                                value.sub_detectors.values_mut().next().unwrap().manifold_id =
                                    usize::MAX
                            }
                            1 => {
                                for v in value.sub_detectors.values_mut() {
                                    v.manifold_id = 0;
                                }
                            }
                            2 => {
                                value.sub_detectors.values_mut().next().unwrap().timestamp =
                                    !value.timestamp
                            }
                            3 => {
                                let (&key, v) = value.sub_detectors.iter().next().unwrap();
                                let v = v.clone();
                                value.sub_detectors.retain(|k, _| *k != key);
                                value.sub_detectors.insert(key + 10_000, v);
                            }
                            4 => {
                                let key = *value.sub_detectors.keys().next().unwrap();
                                value.sub_detectors.retain(|k, _| *k != key);
                            }
                            5 => m.push(m[0].clone()),
                            6 => m[0].subshape1 = u32::MAX,
                            7 => m[0].set_subshape_pos1(Some(Pose::translation(99.0, 0.0, 0.0))),
                            _ => unreachable!(),
                        }
                    }
                    Wire::HeightfieldComposite(value) | Wire::CompositeComposite(value) => {
                        assert!(value.sub_detectors.len() > 1);
                        match case {
                            0 => {
                                value.sub_detectors.values_mut().next().unwrap().manifold_id =
                                    usize::MAX
                            }
                            1 => {
                                for v in value.sub_detectors.values_mut() {
                                    v.manifold_id = 0;
                                }
                            }
                            2 => {
                                value.sub_detectors.values_mut().next().unwrap().timestamp =
                                    !value.timestamp
                            }
                            3 => {
                                let (&key, v) = value.sub_detectors.iter().next().unwrap();
                                let v = v.clone();
                                value.sub_detectors.retain(|k, _| *k != key);
                                value.sub_detectors.insert((key.0 + 10_000, key.1), v);
                            }
                            4 => {
                                let key = *value.sub_detectors.keys().next().unwrap();
                                value.sub_detectors.retain(|k, _| *k != key);
                            }
                            5 => m.push(m[0].clone()),
                            6 => m[0].subshape1 = u32::MAX,
                            7 => m[0].set_subshape_pos1(Some(Pose::translation(99.0, 0.0, 0.0))),
                            _ => unreachable!(),
                        }
                    }
                    _ => unreachable!(),
                }
                guard_rejects(&m, &restore_wire(&raw), &*a, &*b);
            }
        }
    }
}

#[test]
fn stored_workspaces_trimesh_aabb_vectors_rows_and_complete_leaf_membership() {
    for flipped in [false, true] {
        for case in 0..10 {
            let (a, b, mut m, w) = cache(0, flipped);
            let mut raw = wire(&w);
            let Wire::TriMesh {
                interferences,
                local_aabb2,
                old_interferences,
            } = &mut raw
            else {
                unreachable!()
            };
            assert_eq!(interferences.len(), 2);
            match case {
                0 => old_interferences.push(0),
                1 => {
                    interferences.pop();
                }
                2 => {
                    interferences[0] = u32::MAX;
                    if flipped {
                        m[0].subshape2 = u32::MAX;
                    } else {
                        m[0].subshape1 = u32::MAX;
                    }
                }
                3 => {
                    interferences.push(interferences[0]);
                    m.push(m[0].clone());
                }
                4 => local_aabb2.mins.x = f32::NAN,
                5 => {
                    local_aabb2.mins.x = 1.0;
                    local_aabb2.maxs.x = -1.0;
                }
                6 => *local_aabb2 = crate::geometry::Aabb::new_invalid(),
                7 => {
                    interferences.pop();
                    m.pop();
                }
                8 => {
                    interferences.push(2);
                    let mut added = m[0].clone();
                    if flipped {
                        added.subshape2 = 2;
                    } else {
                        added.subshape1 = 2;
                    }
                    m.push(added);
                }
                9 => m[0].set_subshape_pos1(Some(Pose::translation(10.0, 0.0, 0.0))),
                _ => unreachable!(),
            }
            guard_rejects(&m, &restore_wire(&raw), &*a, &*b);
        }
    }
}

#[test]
fn stored_workspaces_trimesh_empty_invalid_aabb_and_unsorted_history_are_preserved() {
    let (a, b, mut m, w) = cache(0, false);
    let mut raw = wire(&w);
    let Wire::TriMesh { interferences, .. } = &mut raw else {
        unreachable!()
    };
    interferences.reverse();
    m.reverse();
    let w = restore_wire(&raw);
    let bytes = bincode::serialize(&(&m, &w)).unwrap();
    validate(&m, &w, &*a, &*b).unwrap();
    assert_eq!(bincode::serialize(&(&m, &w)).unwrap(), bytes);
    let raw = Wire::TriMesh {
        interferences: Vec::new(),
        local_aabb2: crate::geometry::Aabb::new_invalid(),
        old_interferences: Vec::new(),
    };
    validate(&[], &restore_wire(&raw), &*a, &*b).unwrap();
}

#[test]
fn stored_workspaces_actual_budget_capacity_and_scratch_are_precharged() {
    for tag in 0..5 {
        let (a, b, mut m, w) = cache(tag, false);
        let usage = validate(&m, &w, &*a, &*b).unwrap();
        let exact = StoredWorkspaceLimits {
            max_work: usage.work,
            max_scratch_bytes: usage.scratch_bytes,
        };
        assert_eq!(
            validate_stored_contact_workspace(&w, &m, Some((&*a, &*b)), exact),
            Ok(usage)
        );
        assert_eq!(
            validate_stored_contact_workspace(
                &w,
                &m,
                Some((&*a, &*b)),
                StoredWorkspaceLimits {
                    max_work: usage.work - 1,
                    ..exact
                }
            ),
            Err(StoredWorkspaceError::WorkLimit)
        );
        assert!(usage.scratch_bytes > 0);
        assert_eq!(
            validate_stored_contact_workspace(
                &w,
                &m,
                Some((&*a, &*b)),
                StoredWorkspaceLimits {
                    max_scratch_bytes: usage.scratch_bytes - 1,
                    ..exact
                }
            ),
            Err(StoredWorkspaceError::ScratchLimit)
        );
        let mut w = Some(w);
        query(&*a, &*b, Pose::translation(0.0, 100.0, 0.0), &mut m, &mut w);
        assert!(m.is_empty());
        let usage = validate(&m, w.as_ref().unwrap(), &*a, &*b).unwrap();
        assert!(
            usage.work > 0,
            "actual map capacity retained after producer removals is charged"
        );
    }
}

fn world_scene(tag: usize, flipped: bool) -> (PhysicsWorld, RigidBodyHandle, ColliderHandle) {
    let mut world = PhysicsWorld::new();
    let (mut fixed, moving) = shapes()[tag].clone();
    if tag == 3 || tag == 4 {
        fixed = SharedShape::compound(vec![
            (
                Pose::translation(-1.0, -0.5, 0.0),
                SharedShape::cuboid(1.0, 0.5, 1.0),
            ),
            (
                Pose::translation(1.0, -0.5, 0.0),
                SharedShape::cuboid(1.0, 0.5, 1.0),
            ),
        ]);
    }
    let (body, collider);
    if flipped {
        (body, collider) = world.insert(
            RigidBodyBuilder::dynamic().translation(Vector::new(0.0, 0.3, 0.0)),
            ColliderBuilder::new(moving),
        );
        world.insert(RigidBodyBuilder::fixed(), ColliderBuilder::new(fixed));
    } else {
        world.insert(RigidBodyBuilder::fixed(), ColliderBuilder::new(fixed));
        (body, collider) = world.insert(
            RigidBodyBuilder::dynamic().translation(Vector::new(0.0, 0.3, 0.0)),
            ColliderBuilder::new(moving),
        );
    }
    for _ in 0..4 {
        world.step();
    }
    assert!(
        world
            .narrow_phase
            .contact_pairs()
            .any(|pair| pair.rigid().unwrap().workspace.is_some())
    );
    (world, body, collider)
}
#[test]
fn stored_workspaces_rigid_sleep_recycle_flipped_and_pending_shape_continuation() {
    for tag in 0..5 {
        for flipped in [false, true] {
            let (mut world, body, collider) = world_scene(tag, flipped);
            for _ in 0..360 {
                world.step();
                validate_stored_contact_workspaces(&world, limits()).unwrap();
            }
            assert!(world.bodies[body].is_sleeping(), "tag{tag} flip{flipped}");
            assert!(
                world.narrow_phase.contact_pairs().any(|pair| pair
                    .rigid()
                    .unwrap()
                    .recycle_state
                    .is_some()),
                "actual recycling history tag{tag} flip{flipped}"
            );
            let bytes = bincode::serialize(&world).unwrap();
            let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
            validate_stored_contact_workspaces(&restored, limits()).unwrap();
            assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
            for _ in 0..6 {
                world.step();
                restored.step();
                validate_stored_contact_workspaces(&world, limits()).unwrap();
                assert_eq!(
                    bincode::serialize(&world).unwrap(),
                    bincode::serialize(&restored).unwrap()
                );
            }
            world
                .colliders
                .get_mut(collider)
                .unwrap()
                .set_shape(SharedShape::ball(0.25));
            let before = bincode::serialize(&world).unwrap();
            validate_stored_contact_workspaces(&world, limits()).unwrap();
            assert_eq!(bincode::serialize(&world).unwrap(), before);
            let mut restored: PhysicsWorld = bincode::deserialize(&before).unwrap();
            for _ in 0..6 {
                world.step();
                restored.step();
                validate_stored_contact_workspaces(&world, limits()).unwrap();
                assert_eq!(
                    bincode::serialize(&world).unwrap(),
                    bincode::serialize(&restored).unwrap()
                );
            }
        }
    }
}

#[test]
fn stored_workspaces_capture_side_guard_rejects_unsupported_vendor_variant_without_query() {
    let (mut world, _, _) = world_scene(4, false);
    let pair = world.narrow_phase.contact_graph.graph.edges[0]
        .weight
        .rigid_mut()
        .unwrap();
    pair.workspace = Some(ContactManifoldsWorkspace::from(
        parry::query::details::VoxelsShapeContactManifoldsWorkspace::<2>::new(),
    ));
    let before = bincode::serialize(&world).unwrap();
    assert_eq!(
        validate_stored_contact_workspaces(&world, limits()),
        Err(StoredWorkspaceError::Unsupported)
    );
    assert_eq!(bincode::serialize(&world).unwrap(), before);
}

#[test]
fn stored_workspaces_compound_pose_padding_is_not_physical_equality() {
    let (a, b, mut m, w) = cache(4, false);
    for manifold in &mut m {
        let mut pose = *manifold.subshape_pos1().unwrap();
        pose.padding = u32::MAX;
        manifold.set_subshape_pos1(Some(pose));
    }
    let bytes = bincode::serialize(&(&m, &w)).unwrap();
    validate(&m, &w, &*a, &*b).unwrap();
    assert_eq!(bincode::serialize(&(&m, &w)).unwrap(), bytes);
}

#[test]
fn stored_workspaces_context_reset_preserves_actual_old_internal_history() {
    let replacement = SharedShape::ball(0.2);
    for tag in 0..5 {
        for flipped in [false, true] {
            let (_, _, m, w) = cache(tag, flipped);
            let bytes = bincode::serialize(&(&m, &w)).unwrap();
            assert_eq!(
                validate(&m, &w, &*replacement, &*replacement),
                Err(StoredWorkspaceError::Context)
            );
            validate_stored_contact_workspace(&w, &m, None, limits()).unwrap();
            assert_eq!(bincode::serialize(&(&m, &w)).unwrap(), bytes);
        }
    }
}

#[derive(Clone)]
struct Custom;
impl parry::query::WorkspaceData for Custom {
    fn as_typed_workspace_data(&self) -> TypedWorkspaceData<'_> {
        TypedWorkspaceData::Custom
    }
    fn clone_dyn(&self) -> Box<dyn parry::query::WorkspaceData> {
        Box::new(self.clone())
    }
}
#[test]
fn stored_workspaces_all_unsupported_workspace_kinds_stop_before_geometry() {
    let (_, _, m, _) = cache(4, false);
    let variants = [
        ContactManifoldsWorkspace::from(
            parry::query::details::VoxelsShapeContactManifoldsWorkspace::<2>::new(),
        ),
        ContactManifoldsWorkspace::from(
            parry::query::details::VoxelsShapeContactManifoldsWorkspace::<3>::new(),
        ),
        ContactManifoldsWorkspace::from(
            parry::query::details::VoxelsShapeContactManifoldsWorkspace::<4>::new(),
        ),
        ContactManifoldsWorkspace::from(Custom),
    ];
    for w in variants {
        assert_eq!(
            validate_stored_contact_workspace(&w, &m, None, limits()),
            Err(StoredWorkspaceError::Unsupported)
        );
    }
}

#[test]
fn stored_workspaces_supported_shape_context_matrix_includes_abstract_heightfield_side() {
    let mut hole =
        parry::shape::HeightField::new(Array2::repeat(3, 3, 0.0), Vector::new(4.0, 1.0, 4.0));
    hole.set_cell_status(
        0,
        0,
        parry::shape::HeightFieldCellStatus::LEFT_TRIANGLE_REMOVED,
    );
    let hull = SharedShape::convex_hull(&[
        Vector::new(-0.3, -0.3, -0.3),
        Vector::new(0.3, -0.3, -0.3),
        Vector::new(-0.3, 0.3, -0.3),
        Vector::new(0.3, 0.3, -0.3),
        Vector::new(-0.3, -0.3, 0.3),
        Vector::new(0.3, -0.3, 0.3),
        Vector::new(-0.3, 0.3, 0.3),
        Vector::new(0.3, 0.3, 0.3),
    ])
    .unwrap();
    let pool = [
        SharedShape::ball(0.3),
        SharedShape::cuboid(0.3, 0.3, 0.3),
        SharedShape::capsule_y(0.1, 0.3),
        hull,
        shapes()[0].0.clone(),
        shapes()[1].0.clone(),
        SharedShape::new(hole),
        shapes()[4].0.clone(),
    ];
    let mut checked = 0;
    for (i, a) in pool.iter().enumerate() {
        for (j, b) in pool.iter().enumerate() {
            let (mut m, mut w) = (Vec::new(), None);
            query(&**a, &**b, Pose::IDENTITY, &mut m, &mut w);
            if let Some(w) = w {
                let result = validate(&m, &w, &**a, &**b);
                assert!(result.is_ok(), "normal pair{i}/{j}: {result:?}");
                checked += 1;
            }
        }
    }
    std::eprintln!("WORKSPACE_MATRIX actual_workspace_pairs={checked}");
    assert!(checked > 0);
}

#[test]
fn stored_workspaces_pending_removals_keep_all_five_caches_and_exact_generation_history() {
    let mut cases = 0;
    for tag in 0..5 {
        for flipped in [false, true] {
            for side in 0..3 {
                for reuse in [false, true] {
                    let (mut world, _, moving) = world_scene(tag, flipped);
                    let pair = world.narrow_phase.contact_pairs().next().unwrap();
                    let fixed = if pair.collider1 == moving {
                        pair.collider2
                    } else {
                        pair.collider1
                    };
                    let removed = match side {
                        0 => vec![moving],
                        1 => vec![fixed],
                        _ => vec![moving, fixed],
                    };
                    for &collider in &removed {
                        world.remove_collider(collider).unwrap();
                    }
                    if reuse {
                        let fresh = world.insert_collider(
                            ColliderBuilder::ball(0.1).translation(Vector::new(100.0, 100.0, 0.0)),
                            None,
                        );
                        assert_eq!(
                            fresh.into_raw_parts().0,
                            removed.last().unwrap().into_raw_parts().0
                        );
                        assert_ne!(
                            fresh.into_raw_parts().1,
                            removed.last().unwrap().into_raw_parts().1
                        );
                    }
                    crate::geometry::validate_stored_references(
                        &world,
                        crate::geometry::stored_references::tests::limits(),
                    )
                    .unwrap();
                    let bytes = bincode::serialize(&world).unwrap();
                    let usage = validate_stored_contact_workspaces(&world, limits()).unwrap();
                    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
                    let exact = StoredWorkspaceLimits {
                        max_work: usage.work,
                        max_scratch_bytes: usage.scratch_bytes,
                    };
                    assert_eq!(validate_stored_contact_workspaces(&world, exact), Ok(usage));
                    assert_eq!(
                        validate_stored_contact_workspaces(
                            &world,
                            StoredWorkspaceLimits {
                                max_work: usage.work - 1,
                                ..exact
                            }
                        ),
                        Err(StoredWorkspaceError::WorkLimit)
                    );
                    assert!(usage.scratch_bytes > 0);
                    assert_eq!(
                        validate_stored_contact_workspaces(
                            &world,
                            StoredWorkspaceLimits {
                                max_scratch_bytes: usage.scratch_bytes - 1,
                                ..exact
                            }
                        ),
                        Err(StoredWorkspaceError::ScratchLimit)
                    );
                    let mut wrong: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
                    wrong.colliders.removed_colliders.clear();
                    assert_eq!(
                        validate_stored_contact_workspaces(&wrong, limits()),
                        Err(StoredWorkspaceError::Context)
                    );
                    let mut wrong: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
                    for handle in &mut wrong.colliders.removed_colliders {
                        let (slot, generation) = handle.into_raw_parts();
                        *handle = ColliderHandle::from_raw_parts(slot, generation.wrapping_add(2));
                    }
                    assert_eq!(
                        validate_stored_contact_workspaces(&wrong, limits()),
                        Err(StoredWorkspaceError::Context)
                    );
                    // Invalid queue fixtures only visit validators; they never step/query.
                    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
                    for _ in 0..6 {
                        world.step();
                        restored.step();
                        validate_stored_contact_workspaces(&world, limits()).unwrap();
                        assert_eq!(
                            bincode::serialize(&world).unwrap(),
                            bincode::serialize(&restored).unwrap()
                        );
                    }
                    cases += 1;
                }
            }
        }
    }
    std::eprintln!("PENDING_REMOVAL_WORKSPACES cases={cases}");
}

#[test]
fn stored_workspaces_pending_removal_still_rejects_corrupt_cache_and_precharges_queue() {
    for tag in 0..5 {
        for flipped in [false, true] {
            let (mut world, _, collider) = world_scene(tag, flipped);
            world.remove_collider(collider).unwrap();
            validate_stored_contact_workspaces(&world, limits()).unwrap();
            let PairContacts::Rigid(pair) = &mut world.narrow_phase.contact_graph.graph.edges[0]
                .weight
                .contacts
            else {
                unreachable!()
            };
            let mut raw = wire(pair.workspace.as_ref().unwrap());
            match &mut raw {
                Wire::TriMesh {
                    old_interferences, ..
                } => old_interferences.push(0),
                Wire::Heightfield(map) | Wire::Composite(map) => {
                    map.sub_detectors.values_mut().next().unwrap().manifold_id =
                        pair.manifolds.len()
                }
                Wire::HeightfieldComposite(map) | Wire::CompositeComposite(map) => {
                    map.sub_detectors.values_mut().next().unwrap().manifold_id =
                        pair.manifolds.len()
                }
            }
            pair.workspace = Some(restore_wire(&raw));
            let bytes = bincode::serialize(&world).unwrap();
            let result = validate_stored_contact_workspaces(&world, limits());
            assert!(
                matches!(
                    result,
                    Err(StoredWorkspaceError::Interferences | StoredWorkspaceError::ManifoldIndex)
                ),
                "tag{tag} flip{flipped}: {result:?}"
            );
            assert_eq!(bincode::serialize(&world).unwrap(), bytes);
            // Corrupted cache only visits the guard, never a query or solver.
        }
    }
    let mut world = PhysicsWorld::new();
    let collider = world.insert_collider(ColliderBuilder::ball(1.0), None);
    world.remove_collider(collider).unwrap();
    let bytes = bincode::serialize(&world).unwrap();
    assert_eq!(
        validate_stored_contact_workspaces(
            &world,
            StoredWorkspaceLimits {
                max_work: 1,
                max_scratch_bytes: usize::MAX
            }
        ),
        Err(StoredWorkspaceError::WorkLimit)
    );
    assert_eq!(
        validate_stored_contact_workspaces(
            &world,
            StoredWorkspaceLimits {
                max_work: 2,
                max_scratch_bytes: 0
            }
        ),
        Err(StoredWorkspaceError::ScratchLimit)
    );
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);

    let mut world = PhysicsWorld::new();
    for _ in 0..8 {
        let collider = world.insert_collider(ColliderBuilder::ball(1.0), None);
        world.remove_collider(collider).unwrap();
    }
    // Eight queue scans/initializations plus 8 * ceil(log2(8)) sort levels.
    let exact = StoredWorkspaceLimits {
        max_work: 40,
        max_scratch_bytes: 8 * size_of::<ColliderHandle>(),
    };
    assert_eq!(
        validate_stored_contact_workspaces(&world, exact),
        Ok(StoredWorkspaceUsage {
            work: exact.max_work,
            scratch_bytes: exact.max_scratch_bytes
        })
    );
    assert_eq!(
        validate_stored_contact_workspaces(
            &world,
            StoredWorkspaceLimits {
                max_work: 39,
                ..exact
            }
        ),
        Err(StoredWorkspaceError::WorkLimit)
    );
    assert_eq!(
        validate_stored_contact_workspaces(
            &world,
            StoredWorkspaceLimits {
                max_scratch_bytes: exact.max_scratch_bytes - 1,
                ..exact
            }
        ),
        Err(StoredWorkspaceError::ScratchLimit)
    );
}
