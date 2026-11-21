//! Full runtime copy, including render history, native ownership and pending observations.
use super::World;

#[cfg(test)]
#[test]
fn runtime_checkpoint_world_preserves_joint_removal_capacity_and_native_ownership() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let joint = world.add_distance_joint(crate::components::DistanceJoint::new(a, b, 1.));
    world.unified_physics_entities.insert((a.id, a.generation));
    let mut restored = super::persistence::copy_for_test(&world);
    assert!(restored.is_unified_physics_index(a.id as usize));
    // Removing into an initially empty free list must keep its preallocated space.
    restored.clear_distance_joint(joint).unwrap();
    world.clear_distance_joint(joint).unwrap();
    assert_eq!(
        world.add_distance_joint(crate::components::DistanceJoint::new(a, b, 2.)),
        restored.add_distance_joint(crate::components::DistanceJoint::new(a, b, 2.))
    );
    assert_eq!(world.snapshot(), restored.snapshot());
}
