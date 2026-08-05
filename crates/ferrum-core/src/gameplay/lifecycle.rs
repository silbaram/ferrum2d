use super::*;

pub(crate) fn tick_lifetime(
    world: &mut World,
    entity_index: usize,
    delta_seconds: f32,
) -> Option<f32> {
    world.tick_gameplay_lifetime_at(entity_index, delta_seconds)
}

pub(crate) fn has_expired_lifetime(world: &World, entity_index: usize) -> bool {
    world
        .gameplay_lifetime_at(entity_index)
        .is_some_and(|time_left| time_left <= 0.0)
}

pub(crate) fn run_lifetime_system(
    world: &mut World,
    delta_seconds: f32,
    pending_despawn: &mut Vec<Entity>,
) -> usize {
    let mut expired_count = 0;
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let entity_index = world.alive_indices()[alive_position];
        tick_lifetime(world, entity_index, delta_seconds);
        if has_expired_lifetime(world, entity_index) {
            queue_despawn(world, entity_index, pending_despawn);
            expired_count += 1;
        }
    }
    expired_count
}

pub(crate) fn queue_despawn(world: &World, entity_index: usize, pending_despawn: &mut Vec<Entity>) {
    if let Some(entity) = entity_at(world, entity_index) {
        pending_despawn.push(entity);
    }
}

pub(crate) fn queue_marked_despawn(
    world: &World,
    entity_index: usize,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> bool {
    let Some(marked) = marked_for_despawn.get_mut(entity_index) else {
        return false;
    };
    if *marked {
        return false;
    }
    let Some(entity) = entity_at(world, entity_index) else {
        return false;
    };
    *marked = true;
    pending_despawn.push(entity);
    true
}

pub(in crate::gameplay) fn entity_at(world: &World, entity_index: usize) -> Option<Entity> {
    world.entity_at_index(entity_index)
}
