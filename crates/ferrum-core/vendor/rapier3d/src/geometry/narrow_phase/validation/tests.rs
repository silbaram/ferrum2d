use super::*;
use crate::alloc_prelude::*;
use crate::dynamics::solver::solver_contact_graph::GraphPos;
use crate::geometry::StoredReferenceLimits;
use crate::geometry::stored_references::tests::{limits, scene, validate};

#[test]
fn stored_references_narrowphase_checks_graph_coarena_and_pair_endpoint_maps() {
    let world = scene();
    let handle = world.narrow_phase.contact_graph.graph.nodes[0].weight;
    let mut bad = world.narrow_phase.clone();
    bad.graph_indices
        .get_mut(handle.0)
        .unwrap()
        .contact_graph_index = NodeIndex::new(999);
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::NarrowPhase)
    );
    let mut bad = world.narrow_phase.clone();
    bad.contact_graph.graph.nodes[0].weight = ColliderHandle::invalid();
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::NarrowPhase)
    );
    let mut bad = world.narrow_phase.clone();
    bad.contact_graph.graph.edges[0].weight.collider1 = ColliderHandle::invalid();
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::NarrowPhase)
    );
}

#[test]
fn stored_references_ready_solver_manifold_positions_and_body_ids_are_checked() {
    let world = scene();
    assert!(world.narrow_phase.solver_graph_valid);
    let mut bad = world.narrow_phase.clone();
    bad.contact_graph.graph.edges[0]
        .weight
        .solver_manifolds_mut()[0]
        .data
        .graph_pos = GraphPos::new(999, 0);
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
    let mut bad = world.narrow_phase.clone();
    bad.contact_graph.graph.edges[0]
        .weight
        .solver_manifolds_mut()[0]
        .data
        .solver_body_ids[0] = 999_999;
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
    let mut bad = world.narrow_phase.clone();
    let data = &mut bad.contact_graph.graph.edges[0]
        .weight
        .solver_manifolds_mut()[0]
        .data;
    let active = data
        .solver_body_ids
        .iter_mut()
        .find(|id| **id != u32::MAX)
        .unwrap();
    *active = u32::MAX;
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
}

#[test]
fn stored_references_invalidated_solver_positions_can_remain_stale_until_rebuild() {
    let mut world = scene();
    world.narrow_phase.solver_graph_valid = false;
    world.narrow_phase.contact_graph.graph.edges[0]
        .weight
        .solver_manifolds_mut()[0]
        .data
        .graph_pos = GraphPos::new(999, 0);
    let before = bincode::serialize(&world).unwrap();
    validate(&world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
    assert_eq!(bincode::serialize(&world).unwrap(), before);
    world.step();
    validate(&world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
}

#[test]
fn stored_references_force_event_inverse_is_checked_even_while_invalidated() {
    let world = scene();
    assert!(!world.narrow_phase.force_event_pairs.is_empty());
    for valid in [false, true] {
        let mut bad = world.narrow_phase.clone();
        bad.force_list_valid = valid;
        bad.force_event_pos[bad.force_event_pairs[0] as usize] = 999;
        assert_eq!(
            validate(&world, &world.broad_phase, &bad, limits()),
            Err(StoredReferenceError::SolverGraph)
        );
    }
}

#[test]
fn stored_references_solver_masks_allow_unused_history_but_reject_missing_owned_bits() {
    let world = scene();
    let rigid = world.narrow_phase.contact_graph.graph.edges[0]
        .weight
        .rigid()
        .unwrap();
    assert!(rigid.solver_color < 128);
    let body = rigid
        .solver_color_bodies
        .iter()
        .copied()
        .find(|id| *id != u32::MAX)
        .unwrap() as usize;
    let mut history = world.narrow_phase.clone();
    history.body_solver_color_masks[body] |= u128::MAX;
    validate(&world, &world.broad_phase, &history, limits()).unwrap();
    let mut bad = world.narrow_phase.clone();
    bad.body_solver_color_masks[body] &= !(1 << rigid.solver_color);
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
}

#[test]
fn stored_references_solver_bucket_entries_and_shape_are_checked_without_repair() {
    use crate::dynamics::solver::solver_contact_graph::ContactRef;
    let world = scene();
    let mut bad = world.narrow_phase.clone();
    let mut buckets: Vec<Vec<ContactRef>> =
        bincode::deserialize(&bincode::serialize(&bad.solver_contact_graph).unwrap()).unwrap();
    let reference = buckets
        .iter_mut()
        .find_map(|bucket| bucket.first_mut())
        .unwrap();
    reference.edge = u32::MAX;
    bad.solver_contact_graph =
        bincode::deserialize(&bincode::serialize(&buckets).unwrap()).unwrap();
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
    bad.solver_graph_valid = false;
    validate(&world, &world.broad_phase, &bad, limits()).unwrap();
    buckets.pop();
    bad.solver_contact_graph =
        bincode::deserialize(&bincode::serialize(&buckets).unwrap()).unwrap();
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
}

#[test]
fn stored_references_raw_coarena_slots_are_budgeted_even_when_all_extra_slots_are_vacant() {
    let world = scene();
    let mut expanded = world.narrow_phase.clone();
    let empty = super::super::ColliderGraphIndices {
        contact_graph_index: NodeIndex::end(),
        intersection_graph_index: NodeIndex::end(),
    };
    let old = Index::from_raw_parts(4096, 0);
    expanded.graph_indices.ensure_element_exist(old, empty);
    expanded.graph_indices.remove(old, empty);
    let work = validate(&world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
    let limited = StoredReferenceLimits {
        max_work: work,
        ..limits()
    };
    assert_eq!(
        validate(&world, &world.broad_phase, &expanded, limited),
        Err(StoredReferenceError::WorkLimit)
    );
    validate(&world, &world.broad_phase, &expanded, limits()).unwrap();
}

fn review_shared_body_scene() -> crate::pipeline::PhysicsWorld {
    use crate::prelude::*;
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.5, 0.0)),
        ColliderBuilder::cuboid(5.0, 0.5, 5.0),
    );
    world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(-0.5, 0.0, 0.0)),
        ColliderBuilder::cuboid(0.5, 5.0, 5.0),
    );
    world.insert(
        RigidBodyBuilder::dynamic()
            .translation(Vector::new(0.5, 0.5, 0.0))
            .can_sleep(false),
        ColliderBuilder::ball(0.5),
    );
    for _ in 0..4 {
        world.step();
    }
    validate(&world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
    world
}

fn review_move_second_pair_into_first_color(narrow: &mut NarrowPhase) -> (usize, usize) {
    use crate::dynamics::solver::solver_contact_graph::ContactRef;
    let mut buckets: Vec<Vec<ContactRef>> =
        bincode::deserialize(&bincode::serialize(&narrow.solver_contact_graph).unwrap()).unwrap();
    let colored: Vec<_> = buckets
        .iter()
        .take(128)
        .enumerate()
        .filter_map(|(color, refs)| refs.first().map(|reference| (color, *reference)))
        .collect();
    assert_eq!(colored.len(), 2);
    let ((target, first), (source, second)) = (colored[0], colored[1]);
    assert_ne!(first.edge, second.edge);
    assert_eq!(buckets[source].len(), 1);
    buckets[source].clear();
    let local = buckets[target].len();
    buckets[target].push(second);
    let data = &mut narrow.contact_graph.graph.edges[second.edge as usize]
        .weight
        .solver_manifolds_mut()[second.manifold as usize]
        .data;
    data.graph_pos = GraphPos::new(target as u16, local as u32);
    data.solver_color = target as u8;
    narrow.solver_contact_graph =
        bincode::deserialize(&bincode::serialize(&buckets).unwrap()).unwrap();
    (first.edge as usize, second.edge as usize)
}

#[cfg(not(feature = "parallel"))]
fn review_assert_pair_recycles(
    world: &crate::pipeline::PhysicsWorld,
    narrow: &mut NarrowPhase,
    edge: usize,
) {
    use super::super::pair_update::{HintsPtr, OUTCOME_RECYCLED, process_pair};
    let params = &world.integration_parameters;
    assert!(narrow.pair_solver_hints[edge] & super::super::PAIR_HINT_COUNT_MASK != 0);
    let hints = HintsPtr(narrow.pair_solver_hints.as_mut_ptr());
    let mut transitions = Vec::new();
    let outcome = process_pair(
        &mut narrow.contact_graph.graph.edges[edge],
        edge as u32,
        params.prediction_distance(),
        params.dt,
        params.contact_clustering,
        params.contact_recycle_distance(),
        &world.bodies,
        &world.colliders,
        &world.impulse_joints,
        &world.multibody_joints,
        &(),
        &*narrow.query_dispatcher,
        &world.narrow_phase.awake_body_mask,
        &hints,
        None,
        &mut transitions,
    );
    assert_eq!(outcome, OUTCOME_RECYCLED);
    assert!(transitions.is_empty());
}

#[test]
fn stored_references_rejects_actual_colored_bucket_alias_with_matching_manifold_inverse() {
    let world = review_shared_body_scene();
    let mut bad = world.narrow_phase.clone();
    let (_, moved) = review_move_second_pair_into_first_color(&mut bad);
    let before = bincode::serialize(&bad.solver_contact_graph).unwrap();
    #[cfg(not(feature = "parallel"))]
    review_assert_pair_recycles(&world, &mut bad, moved);
    assert_eq!(
        bincode::serialize(&bad.solver_contact_graph).unwrap(),
        before
    );
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
}

fn review_removed_slot_scene() -> (
    crate::pipeline::PhysicsWorld,
    ColliderHandle,
    ColliderHandle,
    ColliderHandle,
) {
    use crate::prelude::*;
    let mut world = scene();
    let old = world
        .colliders
        .iter()
        .find(|(_, collider)| collider.is_sensor())
        .unwrap()
        .0;
    let sensor = world.insert_collider(
        ColliderBuilder::ball(0.9)
            .sensor(true)
            .translation(Vector::new(0.3, 0.5, 0.0)),
        None,
    );
    world.step();
    world.remove_collider(old).unwrap();
    world.step();
    let floor = world
        .colliders
        .iter()
        .find(|(_, collider)| {
            collider
                .parent()
                .is_some_and(|parent| world.bodies[parent].is_dynamic())
        })
        .unwrap()
        .0;
    validate(&world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
    (world, old, floor, sensor)
}

#[test]
fn stored_references_rejects_inactive_coarena_alias_in_unknown_generation_queries() {
    let (world, removed, floor, sensor) = review_removed_slot_scene();
    let slot = removed.into_raw_parts().0;
    assert_eq!(
        world.narrow_phase.graph_indices.get_gen(slot),
        Some(u32::MAX)
    );
    assert_eq!(
        world
            .narrow_phase
            .contact_pairs_with_unknown_gen(slot)
            .count(),
        0
    );
    assert_eq!(
        world
            .narrow_phase
            .intersection_pairs_with_unknown_gen(slot)
            .count(),
        0
    );
    let mut bad = world.narrow_phase.clone();
    *bad.graph_indices.get_mut_unknown_gen(slot).unwrap() =
        *bad.graph_indices.get(floor.0).unwrap();
    assert!(bad.contact_pairs_with_unknown_gen(slot).count() > 0);
    let contact = world.narrow_phase.contact_pairs().next().unwrap();
    let other = if contact.collider1 == floor {
        contact.collider2
    } else {
        contact.collider1
    };
    assert!(
        world
            .narrow_phase
            .contact_pair_unknown_gen(slot, other.into_raw_parts().0)
            .is_none()
    );
    assert!(
        bad.contact_pair_unknown_gen(slot, other.into_raw_parts().0)
            .is_some()
    );
    assert!(bad.intersection_pairs_with_unknown_gen(slot).count() > 0);
    assert!(
        bad.intersection_pair_unknown_gen(slot, sensor.into_raw_parts().0)
            .is_some()
    );
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::NarrowPhase)
    );
}

#[test]
fn stored_references_actual_bucket_ownership_is_checked_beyond_forged_pair_mask_history() {
    use crate::prelude::*;
    let mut world = review_shared_body_scene();
    let decoy = world.insert_body(
        RigidBodyBuilder::dynamic()
            .translation(Vector::new(50.0, 0.0, 0.0))
            .can_sleep(false),
    );
    world.step();
    let mut bad = world.narrow_phase.clone();
    let (first, moved) = review_move_second_pair_into_first_color(&mut bad);
    let dynamic = world
        .bodies
        .iter()
        .find(|(handle, body)| body.is_dynamic() && *handle != decoy)
        .unwrap()
        .0;
    let collider = world.bodies[dynamic].colliders()[0];
    // A pending parent change permits historical pair-color mask ownership.
    world
        .colliders
        .get_mut(collider)
        .unwrap()
        .changes
        .insert(crate::geometry::ColliderChanges::PARENT);
    let color = bad.contact_graph.graph.edges[first].weight.solver_color();
    let pair = bad.contact_graph.graph.edges[moved]
        .weight
        .rigid_mut()
        .unwrap();
    pair.solver_color = color;
    pair.solver_color_bodies = [decoy.into_raw_parts().0, u32::MAX];
    bad.body_solver_color_masks
        .resize(decoy.into_raw_parts().0 as usize + 1, 0);
    bad.body_solver_color_masks[decoy.into_raw_parts().0 as usize] |= 1u128 << color;
    assert_ne!(
        bad.contact_graph.graph.edges[first]
            .weight
            .rigid()
            .unwrap()
            .solver_color_bodies,
        bad.contact_graph.graph.edges[moved]
            .weight
            .rigid()
            .unwrap()
            .solver_color_bodies
    );
    // Pair color and persisted masks agree. Both actual manifolds still write
    // the original dynamic body in the same bucket, so that proof is separate.
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
    assert!(!world.bodies.modified_bodies.contains(&dynamic));
    world
        .bodies
        .get_mut_internal(dynamic)
        .unwrap()
        .changes
        .insert(RigidBodyChanges::TYPE);
    assert_eq!(
        validate(&world, &world.broad_phase, &bad, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
}

fn review_check_unchanged_and_replay(world: &crate::pipeline::PhysicsWorld) {
    let before = bincode::serialize(world).unwrap();
    validate(world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
    assert_eq!(bincode::serialize(world).unwrap(), before);
    let mut expected: crate::pipeline::PhysicsWorld = bincode::deserialize(&before).unwrap();
    let mut replayed: crate::pipeline::PhysicsWorld = bincode::deserialize(&before).unwrap();
    validate(
        &replayed,
        &replayed.broad_phase,
        &replayed.narrow_phase,
        limits(),
    )
    .unwrap();
    expected.step();
    replayed.step();
    validate(
        &replayed,
        &replayed.broad_phase,
        &replayed.narrow_phase,
        limits(),
    )
    .unwrap();
    assert_eq!(
        bincode::serialize(&expected).unwrap(),
        bincode::serialize(&replayed).unwrap()
    );
}

#[test]
fn stored_references_colored_recycling_and_epoch_pending_history_are_preserved() {
    use crate::prelude::*;
    let mut world = review_shared_body_scene();
    for _ in 0..4 {
        let mut narrow = world.narrow_phase.clone();
        let before = bincode::serialize(&narrow.solver_contact_graph).unwrap();
        for edge in 0..narrow.contact_graph.graph.edges.len() {
            #[cfg(not(feature = "parallel"))]
            review_assert_pair_recycles(&world, &mut narrow, edge);
        }
        assert_eq!(
            bincode::serialize(&narrow.solver_contact_graph).unwrap(),
            before
        );
        review_check_unchanged_and_replay(&world);
        world.step();
    }
    let added =
        world.insert_body(RigidBodyBuilder::dynamic().translation(Vector::new(50.0, 0.0, 0.0)));
    world.step();
    review_check_unchanged_and_replay(&world);
    world.remove_body(added).unwrap();
    assert_ne!(
        world.narrow_phase.solver_graph_epoch,
        world.islands.active_set_epoch
    );
    review_check_unchanged_and_replay(&world);
    let dynamic = world
        .bodies
        .iter()
        .find(|(_, body)| body.is_dynamic() && !body.colliders().is_empty())
        .unwrap()
        .0;
    world.bodies.get_mut(dynamic).unwrap().sleep();
    review_check_unchanged_and_replay(&world);
    world.step();
    review_check_unchanged_and_replay(&world);
}

#[test]
fn stored_references_shared_kinematic_and_pending_dynamic_type_are_preserved() {
    use crate::prelude::*;
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    let (floor, _) = world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.5, 0.0)),
        ColliderBuilder::cuboid(5.0, 0.5, 5.0),
    );
    for x in [-2.0, 2.0] {
        world.insert(
            RigidBodyBuilder::dynamic()
                .translation(Vector::new(x, 0.5, 0.0))
                .can_sleep(false),
            ColliderBuilder::ball(0.5),
        );
    }
    world.step();
    world
        .bodies
        .get_mut(floor)
        .unwrap()
        .set_body_type(RigidBodyType::KinematicPositionBased, false);
    review_check_unchanged_and_replay(&world);
    world.step();
    review_check_unchanged_and_replay(&world);
    world
        .bodies
        .get_mut(floor)
        .unwrap()
        .set_body_type(RigidBodyType::Fixed, false);
    world.step();
    world
        .bodies
        .get_mut(floor)
        .unwrap()
        .set_body_type(RigidBodyType::Dynamic, true);
    review_check_unchanged_and_replay(&world);
    world.step();
    review_check_unchanged_and_replay(&world);
}

#[test]
fn stored_references_multiple_manifolds_keep_legitimate_overflow_membership() {
    use crate::prelude::*;
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    world.integration_parameters.contact_clustering = false;
    world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.5, 0.0)),
        ColliderBuilder::cuboid(5.0, 0.5, 5.0),
    );
    world.insert(
        RigidBodyBuilder::dynamic()
            .translation(Vector::new(0.0, 0.5, 0.0))
            .can_sleep(false),
        ColliderBuilder::compound(vec![
            (
                Pose::from_translation(Vector::new(-1.0, 0.0, 0.0)),
                SharedShape::ball(0.5),
            ),
            (
                Pose::from_translation(Vector::new(1.0, 0.0, 0.0)),
                SharedShape::ball(0.5),
            ),
        ]),
    );
    world.step();
    let buckets = world.narrow_phase.solver_contact_graph.stored_buckets();
    assert_eq!(buckets[..128].iter().map(Vec::len).sum::<usize>(), 1);
    assert!(!buckets[128].is_empty());
    review_check_unchanged_and_replay(&world);
}

#[test]
fn stored_references_shared_generic_multibody_contacts_are_not_parallel_colors() {
    use crate::prelude::*;
    let mut world = review_shared_body_scene();
    let fixed = world
        .bodies
        .iter()
        .find(|(_, body)| body.is_fixed())
        .unwrap()
        .0;
    let dynamic = world
        .bodies
        .iter()
        .find(|(_, body)| body.is_dynamic())
        .unwrap()
        .0;
    world.insert_multibody_joint(
        fixed,
        dynamic,
        SphericalJointBuilder::new().local_anchor1(Vector::new(0.5, 1.0, 0.0)),
    );
    world.step();
    let generic = &world.narrow_phase.solver_contact_graph.stored_buckets()[129];
    assert!(generic.len() >= 2);
    review_check_unchanged_and_replay(&world);
}

#[test]
fn stored_references_generation_max_live_and_pending_removed_are_distinct_from_inactive() {
    use crate::prelude::*;
    let mut world = PhysicsWorld::new();
    let mut arena = serde_json::to_value(&world.colliders.colliders).unwrap();
    arena["generation"] = serde_json::json!(u32::MAX);
    world.colliders.colliders = serde_json::from_value(arena).unwrap();
    world.gravity = Vector::ZERO;
    world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.5, 0.0)),
        ColliderBuilder::cuboid(5.0, 0.5, 5.0),
    );
    world.insert(
        RigidBodyBuilder::dynamic()
            .translation(Vector::new(0.0, 0.5, 0.0))
            .can_sleep(false),
        ColliderBuilder::ball(0.5),
    );
    let sensor = world.insert_collider(
        ColliderBuilder::ball(0.9)
            .sensor(true)
            .translation(Vector::new(0.2, 0.5, 0.0)),
        None,
    );
    world.step();
    assert_eq!(sensor.into_raw_parts().1, u32::MAX);
    assert_ne!(
        *world.narrow_phase.graph_indices.get(sensor.0).unwrap(),
        super::super::ColliderGraphIndices::invalid()
    );
    review_check_unchanged_and_replay(&world);
    // Build the representable post-removal slot/free-chain fixture directly:
    // generation exhaustion in Arena::remove is a separate numerical contract.
    let mut arena = serde_json::to_value(&world.colliders.colliders).unwrap();
    let previous_head = arena["free_list_head"].clone();
    arena["items"][sensor.into_raw_parts().0 as usize] =
        serde_json::json!({"Free": {"next_free": previous_head}});
    arena["free_list_head"] = serde_json::json!(sensor.into_raw_parts().0);
    arena["len"] = serde_json::json!(world.colliders.len() - 1);
    arena["generation"] = serde_json::json!(0);
    world.colliders.colliders = serde_json::from_value(arena).unwrap();
    world.colliders.removed_colliders.push(sensor);
    review_check_unchanged_and_replay(&world);
    let bytes = bincode::serialize(&world).unwrap();
    validate(&world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
    world.colliders.removed_colliders.clear();
    assert!(validate(&world, &world.broad_phase, &world.narrow_phase, limits()).is_err());
}

#[test]
fn stored_references_actual_bucket_visits_obey_the_exact_work_limit() {
    let world = review_shared_body_scene();
    let bytes = bincode::serialize(&world).unwrap();
    let used = validate(&world, &world.broad_phase, &world.narrow_phase, limits()).unwrap();
    validate(
        &world,
        &world.broad_phase,
        &world.narrow_phase,
        StoredReferenceLimits {
            max_work: used,
            ..limits()
        },
    )
    .unwrap();
    assert_eq!(
        validate(
            &world,
            &world.broad_phase,
            &world.narrow_phase,
            StoredReferenceLimits {
                max_work: used - 1,
                ..limits()
            }
        ),
        Err(StoredReferenceError::WorkLimit)
    );
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
}
