use super::*;
use crate::prelude::*;
fn limits() -> StoredIslandLimits {
    StoredIslandLimits {
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn check(world: &PhysicsWorld) -> Result<usize> {
    validate_stored_islands(world, limits())
}
fn world() -> (PhysicsWorld, RigidBodyHandle, RigidBodyHandle) {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    let a = world.insert_body(RigidBodyBuilder::dynamic().can_sleep(false));
    let b = world.insert_body(
        RigidBodyBuilder::dynamic()
            .can_sleep(false)
            .translation(Vector::X),
    );
    world.step();
    (world, a, b)
}
fn unchanged_and_replay(world: &mut PhysicsWorld) {
    let bytes = bincode::serialize(&*world).unwrap();
    check(world).unwrap();
    assert_eq!(bincode::serialize(&*world).unwrap(), bytes);
    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    check(&restored).unwrap();
    for _ in 0..6 {
        world.step();
        restored.step();
        check(world).unwrap();
        check(&restored).unwrap();
        assert_eq!(
            bincode::serialize(&*world).unwrap(),
            bincode::serialize(&restored).unwrap()
        );
    }
}

#[test]
fn stored_islands_pending_joint_events_keep_immediate_wire_and_original_continuation() {
    let (mut world, a, b) = world();
    let joint = world.insert_impulse_joint(a, b, FixedJointBuilder::new().local_anchor1(Vector::X));
    assert!(!world.impulse_joints.island_events.is_empty());
    let bytes = bincode::serialize(&world).unwrap();
    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    assert_eq!(
        restored.impulse_joints.island_events.len(),
        world.impulse_joints.island_events.len()
    );
    assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    check(&world).unwrap();
    check(&restored).unwrap();
    for _ in 0..6 {
        world.step();
        restored.step();
        assert_eq!(
            bincode::serialize(&world).unwrap(),
            bincode::serialize(&restored).unwrap()
        );
        check(&restored).unwrap();
    }
    assert!(
        restored
            .islands
            .persistent
            .joint_link_locs
            .contains_key(&JointLinkKey::Impulse(joint))
    );
}
#[test]
fn stored_islands_sleeping_mapping_is_checked_before_remove() {
    let mut world = PhysicsWorld::new();
    let body = world.insert_body(RigidBodyBuilder::dynamic().sleeping(true));
    world.step();
    unchanged_and_replay(&mut world);
    world
        .bodies
        .get_mut_internal(body)
        .unwrap()
        .ids
        .active_set_id = u32::MAX;
    let bytes = bincode::serialize(&world).unwrap();
    let restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    assert_eq!(check(&restored), Err(StoredIslandError::ActiveMapping));
    assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
}
#[test]
fn stored_islands_rejects_membership_locations_free_slots_and_generations() {
    let (world, _, _) = world();
    let mut bad = world.islands.clone();
    let id = bad.awake_island.unwrap();
    bad.free_islands.push(id);
    let mut candidate = world;
    candidate.islands = bad;
    assert_eq!(check(&candidate), Err(StoredIslandError::FreeList));
    let (mut candidate, a, _) = self::world();
    candidate
        .bodies
        .get_mut_internal(a)
        .unwrap()
        .ids
        .island_index = u32::MAX;
    assert_eq!(check(&candidate), Err(StoredIslandError::PersistentMapping));
    let (mut candidate, a, _) = self::world();
    let id = candidate.bodies[a].ids.island_id;
    candidate
        .islands
        .persistent
        .islands
        .get_mut(id as usize)
        .unwrap()
        .bodies[0] =
        RigidBodyHandle::from_raw_parts(a.into_raw_parts().0, a.into_raw_parts().1 + 1);
    assert_eq!(check(&candidate), Err(StoredIslandError::PersistentMapping));
    let _ = a;
}
#[test]
fn stored_islands_joint_locations_and_pending_event_generation_are_checked() {
    let (mut world, a, b) = world();
    let joint = world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    world.step();
    let key = JointLinkKey::Impulse(joint);
    world
        .islands
        .persistent
        .joint_link_locs
        .insert(key, (u32::MAX, 0));
    assert_eq!(check(&world), Err(StoredIslandError::JointLink));
    let (mut world, a, b) = self::world();
    let joint = world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    world.impulse_joints.island_events[0] = ImpulseJointIslandEvent::Link {
        handle: ImpulseJointHandle::from_raw_parts(
            joint.into_raw_parts().0,
            joint.into_raw_parts().1 + 1,
        ),
        body1: a,
        body2: b,
    };
    assert_eq!(check(&world), Err(StoredIslandError::Event));
}
#[test]
fn stored_islands_create_remove_reuse_and_stale_closed_edits_are_preserved() {
    let (mut world, a, b) = world();
    let old = world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    world.remove_impulse_joint(old).unwrap();
    let new = world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    assert_eq!(old.into_raw_parts().0, new.into_raw_parts().0);
    assert_ne!(old.into_raw_parts().1, new.into_raw_parts().1);
    unchanged_and_replay(&mut world);
    world.step();
    world.remove_body(b).unwrap();
    let fresh = world.insert_body(RigidBodyBuilder::dynamic());
    assert_eq!(fresh.into_raw_parts().0, b.into_raw_parts().0);
    unchanged_and_replay(&mut world);
}
#[test]
fn stored_islands_pending_modified_joint_flags_are_persisted_exactly() {
    let (mut world, a, b) = world();
    let joint = world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    world.step();
    world
        .impulse_joints
        .get_mut(joint, false)
        .unwrap()
        .data
        .set_enabled(false);
    let (dirty, all, _) = world.impulse_joints.stored_island_edits();
    assert!(!dirty.is_empty());
    assert!(!all);
    unchanged_and_replay(&mut world);
    for (_, joint) in world.impulse_joints.iter_mut() {
        joint.data.set_enabled(true);
    }
    assert!(world.impulse_joints.stored_island_edits().1);
    unchanged_and_replay(&mut world);
}
#[test]
fn stored_islands_pending_type_disable_and_sleep_wake_keep_history() {
    let (mut world, a, b) = world();
    world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    world.step();
    world
        .bodies
        .get_mut(a)
        .unwrap()
        .set_body_type(RigidBodyType::Fixed, false);
    unchanged_and_replay(&mut world);
    world.step();
    unchanged_and_replay(&mut world);
    world
        .bodies
        .get_mut(a)
        .unwrap()
        .set_body_type(RigidBodyType::Dynamic, true);
    unchanged_and_replay(&mut world);
    world.step();
    world.bodies.get_mut(b).unwrap().sleep();
    unchanged_and_replay(&mut world);
    world.step();
    world.islands.wake_up(&mut world.bodies, b, true);
    unchanged_and_replay(&mut world);
    world.bodies.get_mut(b).unwrap().set_enabled(false);
    unchanged_and_replay(&mut world);
    world.step();
    unchanged_and_replay(&mut world);
}
#[test]
fn stored_islands_contact_location_and_cyclic_connectivity_are_not_confused() {
    let mut world = PhysicsWorld::new();
    let ground = world.insert_body(RigidBodyBuilder::fixed());
    world.insert_collider(
        ColliderBuilder::cuboid(5.0, 0.5, 5.0).translation(-Vector::Y * 0.5),
        Some(ground),
    );
    let (a, _) = world.insert(
        RigidBodyBuilder::dynamic().translation(Vector::Y * 0.5),
        ColliderBuilder::ball(0.5),
    );
    let (b, _) = world.insert(
        RigidBodyBuilder::dynamic().translation(Vector::new(0.8, 0.5, 0.0)),
        ColliderBuilder::ball(0.5),
    );
    world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    world.step();
    unchanged_and_replay(&mut world);
    let id = world.bodies[a].ids.island_id;
    let island = world
        .islands
        .persistent
        .islands
        .get_mut(id as usize)
        .unwrap();
    assert!(!island.contact_links.is_empty());
    island.contact_links[0].edge_id = u32::MAX;
    assert_eq!(check(&world), Err(StoredIslandError::ContactLink));
}
#[test]
fn stored_islands_budget_and_scheduler_history_are_preserved_without_repair() {
    let (mut world, _, _) = world();
    let used = check(&world).unwrap();
    validate_stored_islands(
        &world,
        StoredIslandLimits {
            max_work: used,
            ..limits()
        },
    )
    .unwrap();
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: used - 1,
                ..limits()
            }
        ),
        Err(StoredIslandError::WorkLimit)
    );
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_scratch_bytes: 0,
                ..limits()
            }
        ),
        Err(StoredIslandError::ScratchLimit)
    );
    world.islands.persistent.split_island = Some(u32::MAX);
    unchanged_and_replay(&mut world);
}

#[test]
fn stored_islands_rewire_preserves_ordered_old_and_new_endpoints() {
    let (mut world, a, b) = world();
    let c = world.insert_body(
        RigidBodyBuilder::dynamic()
            .can_sleep(false)
            .translation(Vector::Y),
    );
    world.step();
    let joint = world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    world.step();
    world.impulse_joints.set_bodies(joint, a, c, false).unwrap();
    assert!(
        matches!(world.impulse_joints.island_events.as_slice(),[ImpulseJointIslandEvent::Unlink{handle:old},ImpulseJointIslandEvent::Link{handle:new,body1,body2}] if *old==joint && *new==joint && *body1==a && *body2==c)
    );
    unchanged_and_replay(&mut world);
}
#[test]
fn stored_islands_connectivity_cycles_and_duplicate_free_slots_are_distinct() {
    let (mut world, a, b) = world();
    let c = world.insert_body(RigidBodyBuilder::dynamic().can_sleep(false));
    for (a, b) in [(a, b), (b, c), (c, a)] {
        world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    }
    world.step();
    unchanged_and_replay(&mut world);
    let free = *world.islands.persistent.free_islands.first().unwrap();
    world.islands.persistent.free_islands.push(free);
    assert_eq!(check(&world), Err(StoredIslandError::FreeList));
}
