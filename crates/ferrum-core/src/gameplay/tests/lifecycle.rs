use super::*;

#[test]
fn lifetime_helpers_tick_and_detect_expiry() {
    let mut world = World::default();
    let bullet = world.spawn_bullet_with_lifetime(0.0, 0.0, 0.0, 0.0, 1, 0.5);
    let bullet_index = bullet.id as usize;

    assert_eq!(tick_lifetime(&mut world, bullet_index, 0.25), Some(0.25));
    assert!(!has_expired_lifetime(&world, bullet_index));
    assert_eq!(tick_lifetime(&mut world, bullet_index, 0.25), Some(0.0));
    assert!(has_expired_lifetime(&world, bullet_index));
}

#[test]
fn lifetime_system_ticks_all_lifetimes_and_queues_expired_entities() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(0.0, 0.0, 1);
    let actor = world.spawn_entity();
    let persistent = world.spawn_entity();
    world.set_gameplay_lifetime(enemy, 0.25);
    world.set_gameplay_lifetime(actor, 0.5);
    world.set_gameplay_lifetime(persistent, 1.0);

    let mut pending = Vec::new();
    assert_eq!(run_lifetime_system(&mut world, 0.5, &mut pending), 2);
    assert_eq!(pending, vec![enemy, actor]);
    assert_eq!(world.gameplay_lifetime(persistent), Some(0.5));
}

#[test]
fn marked_despawn_queues_once() {
    let mut world = World::default();
    let entity = world.spawn_enemy(0.0, 0.0, 1);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    assert!(queue_marked_despawn(
        &world,
        entity.id as usize,
        &mut marked,
        &mut pending,
    ));
    assert!(!queue_marked_despawn(
        &world,
        entity.id as usize,
        &mut marked,
        &mut pending,
    ));
    assert_eq!(pending, vec![entity]);
}
