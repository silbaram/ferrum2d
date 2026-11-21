use super::*;
use crate::math::Vector;
use crate::prelude::{
    ActiveEvents, ColliderBuilder, PhysicsWorld, QueryFilter, Ray, RigidBodyBuilder,
};

pub(crate) fn limits() -> StoredReferenceLimits {
    StoredReferenceLimits {
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}

pub(crate) fn scene() -> PhysicsWorld {
    let mut world = PhysicsWorld::new();
    world.insert(
        RigidBodyBuilder::fixed().translation(Vector::new(0.0, -0.5, 0.0)),
        ColliderBuilder::cuboid(5.0, 0.5, 5.0),
    );
    world.insert(
        RigidBodyBuilder::dynamic().translation(Vector::new(0.0, 0.5, 0.0)),
        ColliderBuilder::ball(0.5)
            .active_events(ActiveEvents::CONTACT_FORCE_EVENTS)
            .contact_force_event_threshold(0.0),
    );
    world.insert_collider(
        ColliderBuilder::ball(0.9)
            .sensor(true)
            .translation(Vector::new(0.2, 0.5, 0.0)),
        None,
    );
    for _ in 0..4 {
        world.step();
    }
    world
}

pub(crate) fn validate(
    world: &PhysicsWorld,
    broad: &BroadPhaseBvh,
    narrow: &NarrowPhase,
    limit: StoredReferenceLimits,
) -> Result<usize, StoredReferenceError> {
    super::validate_parts(world, broad, narrow, limit)
}

#[derive(Debug, PartialEq)]
struct QueryResults {
    pairs: Vec<(ColliderHandle, ColliderHandle)>,
    ray: Option<(ColliderHandle, f32)>,
    without_sensors: Option<(ColliderHandle, f32)>,
}

fn queries(world: &PhysicsWorld) -> QueryResults {
    let pairs = world
        .narrow_phase
        .contact_pairs()
        .map(|pair| (pair.collider1, pair.collider2))
        .collect();
    let ray = Ray::new(Vector::new(0.0, 3.0, 0.0), -Vector::Y);
    QueryResults {
        pairs,
        ray: world.cast_ray(&ray, 100.0, true, QueryFilter::default()),
        without_sensors: world.cast_ray(
            &ray,
            100.0,
            true,
            QueryFilter::default().exclude_sensors(),
        ),
    }
}

#[test]
fn stored_references_valid_world_keeps_bytes_query_order_and_exact_step_continuation() {
    let world = scene();
    let before = bincode::serialize(&world).unwrap();
    let query_before = queries(&world);
    let used = validate_stored_references(&world, limits()).unwrap();
    assert!(used > 0);
    assert_eq!(bincode::serialize(&world).unwrap(), before);
    assert_eq!(queries(&world), query_before);
    let mut expected: PhysicsWorld = bincode::deserialize(&before).unwrap();
    let mut replayed: PhysicsWorld = bincode::deserialize(&before).unwrap();
    validate_stored_references(&replayed, limits()).unwrap();
    for _ in 0..12 {
        expected.step();
        replayed.step();
        assert_eq!(
            bincode::serialize(&replayed).unwrap(),
            bincode::serialize(&expected).unwrap()
        );
    }
}

#[test]
fn stored_references_preserve_pending_collider_remove_and_same_slot_new_generation() {
    let mut world = scene();
    let old = world.colliders.iter().next().unwrap().0;
    world.remove_collider(old).unwrap();
    let fresh = world.insert_collider(
        ColliderBuilder::ball(0.25).translation(Vector::new(3.0, 1.0, 0.0)),
        None,
    );
    assert_eq!(old.into_raw_parts().0, fresh.into_raw_parts().0);
    assert_ne!(old.into_raw_parts().1, fresh.into_raw_parts().1);
    let bytes = bincode::serialize(&world).unwrap();
    validate_stored_references(&world, limits()).unwrap();
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
    let mut wrong_generation: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    wrong_generation.colliders.removed_colliders[0] = ColliderHandle::from_raw_parts(
        old.into_raw_parts().0,
        old.into_raw_parts().1.wrapping_add(2),
    );
    assert!(validate_stored_references(&wrong_generation, limits()).is_err());
    let mut expected: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    world.step();
    expected.step();
    validate_stored_references(&world, limits()).unwrap();
    assert_eq!(
        bincode::serialize(&world).unwrap(),
        bincode::serialize(&expected).unwrap()
    );
    world.colliders.removed_colliders.push(old);
    // The generation itself is admitted as pending, not just a matching slot.
    let before = world.colliders.removed_colliders.len();
    world.colliders.removed_colliders[before - 1] =
        ColliderHandle::from_raw_parts(old.into_raw_parts().0, fresh.into_raw_parts().1);
    assert_eq!(
        validate_stored_references(&world, limits()),
        Err(StoredReferenceError::BodyCollider)
    );
}

#[test]
fn stored_references_body_removal_sleep_wake_and_reparent_are_accepted_without_repair() {
    let mut world = scene();
    let dynamic = world
        .bodies
        .iter()
        .find(|(_, body)| body.is_dynamic())
        .unwrap()
        .0;
    world.bodies.get_mut(dynamic).unwrap().sleep();
    validate_stored_references(&world, limits()).unwrap();
    world.step();
    validate_stored_references(&world, limits()).unwrap();
    world.islands.wake_up(&mut world.bodies, dynamic, true);
    validate_stored_references(&world, limits()).unwrap();
    world.step();
    validate_stored_references(&world, limits()).unwrap();
    world
        .bodies
        .get_mut(dynamic)
        .unwrap()
        .set_body_type(crate::dynamics::RigidBodyType::Fixed, false);
    validate_stored_references(&world, limits()).unwrap();
    world.step();
    validate_stored_references(&world, limits()).unwrap();
    world
        .bodies
        .get_mut(dynamic)
        .unwrap()
        .set_body_type(crate::dynamics::RigidBodyType::Dynamic, true);
    validate_stored_references(&world, limits()).unwrap();
    world.step();
    validate_stored_references(&world, limits()).unwrap();
    let collider = world.bodies[dynamic].colliders()[0];
    world
        .colliders
        .set_parent(collider, None, &mut world.bodies);
    validate_stored_references(&world, limits()).unwrap();
    world.step();
    validate_stored_references(&world, limits()).unwrap();
    world.remove_body(dynamic).unwrap();
    validate_stored_references(&world, limits()).unwrap();
    world.step();
    validate_stored_references(&world, limits()).unwrap();
}

#[test]
fn stored_references_bounds_raw_vacancies_and_fallible_scratch_before_scanning() {
    let mut world = scene();
    world.bodies.bodies.reserve(1024);
    let bytes = bincode::serialize(&world).unwrap();
    let low_work = StoredReferenceLimits {
        max_work: 100,
        ..limits()
    };
    assert_eq!(
        validate_stored_references(&world, low_work),
        Err(StoredReferenceError::WorkLimit)
    );
    let no_scratch = StoredReferenceLimits {
        max_scratch_bytes: 0,
        ..limits()
    };
    assert_eq!(
        validate_stored_references(&world, no_scratch),
        Err(StoredReferenceError::ScratchLimit)
    );
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
}

#[test]
fn stored_references_body_collider_ownership_and_awake_reverse_mapping_are_checked() {
    let mut world = scene();
    let dynamic = world
        .bodies
        .iter()
        .find(|(_, body)| body.is_dynamic())
        .unwrap()
        .0;
    let collider = world.bodies[dynamic].colliders()[0];
    world
        .bodies
        .get_mut_internal(dynamic)
        .unwrap()
        .colliders
        .0
        .push(collider);
    assert_eq!(
        validate_stored_references(&world, limits()),
        Err(StoredReferenceError::BodyCollider)
    );
    world
        .bodies
        .get_mut_internal(dynamic)
        .unwrap()
        .colliders
        .0
        .pop();
    world
        .bodies
        .get_mut_internal(dynamic)
        .unwrap()
        .ids
        .active_set_id = u32::MAX;
    assert_eq!(
        validate_stored_references(&world, limits()),
        Err(StoredReferenceError::SolverGraph)
    );
}

#[test]
fn stored_references_empty_and_pending_insertions_do_not_require_eager_bvh_population() {
    let mut world = PhysicsWorld::new();
    validate_stored_references(&world, limits()).unwrap();
    world.insert(RigidBodyBuilder::dynamic(), ColliderBuilder::ball(0.5));
    validate_stored_references(&world, limits()).unwrap();
    let used = validate_stored_references(&world, limits()).unwrap();
    validate_stored_references(
        &world,
        StoredReferenceLimits {
            max_work: used,
            ..limits()
        },
    )
    .unwrap();
    assert_eq!(
        validate_stored_references(
            &world,
            StoredReferenceLimits {
                max_work: used - 1,
                ..limits()
            }
        ),
        Err(StoredReferenceError::WorkLimit)
    );
}

#[test]
fn stored_references_scratch_admission_precedes_reserve_and_returns_typed_errors() {
    let mut budget = ReferenceBudget {
        remaining: 0,
        scratch: usize::MAX,
    };
    assert_eq!(budget.vector::<u8>(1), Err(StoredReferenceError::WorkLimit));
    let mut budget = ReferenceBudget {
        remaining: 1,
        scratch: 15,
    };
    assert_eq!(
        budget.vector::<u128>(1),
        Err(StoredReferenceError::ScratchLimit)
    );
    let mut budget = ReferenceBudget {
        remaining: usize::MAX,
        scratch: usize::MAX,
    };
    assert_eq!(
        budget.vector::<u128>(usize::MAX),
        Err(StoredReferenceError::ScratchLimit)
    );
    let mut budget = ReferenceBudget {
        remaining: usize::MAX,
        scratch: usize::MAX,
    };
    assert_eq!(
        budget.vector::<u8>(usize::MAX),
        Err(StoredReferenceError::Allocation)
    );
}

#[test]
fn stored_references_contact_lifecycle_flags_and_repeated_interactions_keep_replay() {
    let mut world = scene();
    for index in 0..4 {
        world.insert(
            RigidBodyBuilder::dynamic().translation(Vector::new(
                0.1,
                1.35 + 0.8 * index as f32,
                0.0,
            )),
            ColliderBuilder::ball(0.5),
        );
    }
    let collider = world
        .colliders
        .iter()
        .find(|(_, collider)| collider.is_sensor())
        .unwrap()
        .0;
    for tick in 0..32 {
        if tick % 8 == 0 {
            world
                .colliders
                .get_mut(collider)
                .unwrap()
                .set_enabled(false);
        }
        if tick % 8 == 1 {
            world.colliders.get_mut(collider).unwrap().set_enabled(true);
        }
        if tick % 8 == 2 {
            world.colliders.get_mut(collider).unwrap().set_sensor(false);
        }
        if tick % 8 == 3 {
            world.colliders.get_mut(collider).unwrap().set_sensor(true);
        }
        let bytes = bincode::serialize(&world).unwrap();
        let queries_before = queries(&world);
        validate_stored_references(&world, limits()).unwrap();
        assert_eq!(bincode::serialize(&world).unwrap(), bytes);
        assert_eq!(queries(&world), queries_before);
        let mut expected: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        let mut replayed: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        validate_stored_references(&replayed, limits()).unwrap();
        expected.step();
        replayed.step();
        assert_eq!(
            bincode::serialize(&replayed).unwrap(),
            bincode::serialize(&expected).unwrap()
        );
        world = replayed;
    }
}
