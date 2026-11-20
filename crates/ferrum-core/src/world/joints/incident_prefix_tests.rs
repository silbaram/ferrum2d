//! Minimal producer regressions, independent of the new storage admission guard.
use crate::components::{DistanceJoint, Transform2D};
use crate::world::World;

fn checkpoint(world: &World) -> Vec<u8> {
    #[derive(serde::Serialize)]
    struct Capture<'a> {
        #[serde(with = "crate::world::persistence::State")]
        world: &'a World,
    }
    crate::checkpoint_codec::encode(&Capture { world }).unwrap()
}
fn copied(world: &World) -> World {
    crate::world::persistence::copy_for_test(world)
}

#[test]
fn retired_max_hole_reset_spawn_joint_codec_continuation_stays_valid() {
    println!(
        "INCIDENT_PRODUCER_BUILD debug_assertions={}",
        cfg!(debug_assertions)
    );
    let mut seed = World::default();
    let retired = seed.spawn_entity();
    seed.spawn_entity();
    // Reachable long-history boundary, seeded through existing private fields;
    // this is not billions of public calls and does not use/repair via validator.
    seed.generations[retired.id as usize] = u32::MAX;
    seed.joint_incident_counts[retired.id as usize].generation = u32::MAX;
    let mut world = copied(&seed); // Actual opaque private codec restoration first.
    world.reset_preserving_gameplay_variables();
    assert_eq!(world.generations, vec![u32::MAX, 1]);
    assert_eq!(world.free_list, vec![1]);
    assert!(world.joint_incident_counts.is_empty());
    let a = world.spawn_entity();
    assert_eq!(a.id, 1);
    let b = world.spawn_entity();
    assert_eq!(b.id, 2);
    let joint = world.add_distance_joint(DistanceJoint::new(a, b, 2.));
    let mut restored = copied(&world);
    restored.despawn(a);
    // Release's old missing incident entries skipped eager joint cleanup. Test
    // real behavior after codec, not merely the new admission guard's opinion.
    assert_eq!(
        restored.distance_joint_count(),
        0,
        "despawn must clear the incident joint after private codec restore"
    );
    assert!(restored.distance_joint(joint).is_none());
    let fresh = restored.spawn_entity();
    assert_eq!(fresh.id, a.id);
    assert_eq!(fresh.generation, a.generation + 1);
    let next = restored.add_distance_joint(DistanceJoint::new(fresh, b, 3.));
    let mut resumed = copied(&restored);
    assert_eq!(checkpoint(&restored), checkpoint(&resumed));
    assert!(resumed.clear_distance_joint(next).is_some());
    resumed.despawn(fresh);
    let after = resumed.spawn_entity();
    assert_eq!(after.id, fresh.id);
    let again = resumed.add_distance_joint(DistanceJoint::new(after, b, 4.));
    let mut final_copy = copied(&resumed);
    assert!(final_copy.clear_distance_joint(again).is_some());
    assert_eq!(final_copy.distance_joint_count(), 0);
}

fn print_payload(stage: &str, world: &World) {
    let bytes = checkpoint(world);
    assert_eq!(&bytes[..8], b"F2DENGN\0");
    // BUILD in the envelope changes for every code delta. Compare the complete
    // World payload below that unchanged 32-byte existing codec envelope.
    let hex = bytes[32..]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    println!("NORMAL_WORLD_PAYLOAD stage={stage} hex={hex}");
}
#[test]
fn ordinary_append_and_reuse_keep_existing_private_payload_bytes() {
    println!(
        "INCIDENT_PRODUCER_BUILD debug_assertions={}",
        cfg!(debug_assertions)
    );
    let mut world = World::default();
    let entities = (0..8).map(|_| world.spawn_entity()).collect::<Vec<_>>();
    for (i, &entity) in entities.iter().enumerate() {
        world.set_transform(entity, Transform2D { x: i as f32, y: 1. });
    }
    world.add_distance_joint(DistanceJoint::new(entities[0], entities[1], 2.));
    print_payload("append8", &world);
    world.despawn(entities[2]);
    let reused = world.spawn_entity();
    assert_eq!(reused.id, 2);
    print_payload("reuse2", &world);
    world.reset_preserving_gameplay_variables();
    for _ in 0..3 {
        world.spawn_entity();
    }
    print_payload("ordinary-reset-prefix3", &world);
}
