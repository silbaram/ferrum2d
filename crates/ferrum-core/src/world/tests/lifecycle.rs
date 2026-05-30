use super::*;

#[test]
fn entity_ids_increment_and_generation_changes_on_despawn() {
    let mut world = World::default();
    let first = world.spawn_entity();
    let second = world.spawn_entity();

    assert_eq!(first.id, 0);
    assert_eq!(first.generation, 0);
    assert_eq!(second.id, 1);
    assert_eq!(second.generation, 0);
    assert_eq!(world.alive_count(), 2);
    assert_eq!(world.alive_indices(), &[0, 1]);

    world.despawn(first);

    assert!(!world.alive[first.id as usize]);
    assert_eq!(world.generations[first.id as usize], 1);
    assert_eq!(world.alive_count(), 1);
    assert_eq!(world.alive_indices(), &[1]);
}

#[test]
fn despawned_entity_slots_are_reused_with_new_generation() {
    let mut world = World::default();
    let first = world.spawn_entity();
    world.despawn(first);

    let reused = world.spawn_entity();

    assert_eq!(reused.id, first.id);
    assert_eq!(reused.generation, first.generation + 1);
    assert!(world.alive[reused.id as usize]);
    assert_eq!(world.alive_count(), 1);
    assert_eq!(world.alive_indices(), &[reused.id as usize]);
}

#[test]
fn invalid_despawn_does_not_change_alive_count() {
    let mut world = World::default();
    let entity = world.spawn_entity();

    world.despawn(Entity {
        id: entity.id,
        generation: entity.generation + 1,
    });

    assert!(world.alive[entity.id as usize]);
    assert_eq!(world.alive_count(), 1);
    assert_eq!(world.alive_indices(), &[entity.id as usize]);
}

#[test]
fn alive_indices_remain_dense_after_multiple_despawns() {
    let mut world = World::default();
    let first = world.spawn_entity();
    let second = world.spawn_entity();
    let third = world.spawn_entity();

    world.despawn(second);

    assert_eq!(world.alive_count(), 2);
    assert_eq!(world.alive_indices(), &[0, 2]);

    world.despawn(third);

    assert_eq!(world.alive_count(), 1);
    assert_eq!(world.alive_indices(), &[0]);

    world.despawn(first);

    assert_eq!(world.alive_count(), 0);
    assert_eq!(world.alive_indices(), &[]);
}

#[test]
fn transform_update_applies_velocity() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let index = entity.id as usize;
    world.transforms[index] = Some(Transform2D { x: 2.0, y: 4.0 });
    world.velocities[index] = Some(Velocity { vx: 10.0, vy: -6.0 });

    world.update(0.5);

    assert_eq!(
        world.transforms[index],
        Some(Transform2D { x: 7.0, y: 1.0 })
    );
}
