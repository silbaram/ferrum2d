use super::*;

pub(crate) fn movement_navigation_target_identity(
    target: MovementTarget,
) -> MovementNavigationTargetIdentity {
    match target {
        MovementTarget::PrimaryActor => MovementNavigationTargetIdentity::PrimaryActor,
        MovementTarget::NearestPrimaryActor => {
            MovementNavigationTargetIdentity::NearestPrimaryActor
        }
        MovementTarget::NearestEnemy => MovementNavigationTargetIdentity::NearestEnemy,
        MovementTarget::NearestLayer(layer) => {
            MovementNavigationTargetIdentity::NearestLayer(layer)
        }
        MovementTarget::NearestFaction(faction_id) => {
            MovementNavigationTargetIdentity::NearestFaction(faction_id)
        }
        MovementTarget::NearestTag(tag_id) => MovementNavigationTargetIdentity::NearestTag(tag_id),
        MovementTarget::Entity(entity) => MovementNavigationTargetIdentity::Entity(entity),
    }
}

pub(crate) fn tick_movement_navigation_targets(
    caches: &mut [Option<MovementNavigationTargetCache>],
    delta_seconds: f32,
) {
    let elapsed = delta_seconds.max(0.0);
    if elapsed <= 0.0 {
        return;
    }
    for cache in caches.iter_mut().flatten() {
        cache.remaining_seconds = (cache.remaining_seconds - elapsed).max(0.0);
    }
}

pub(crate) fn resolve_movement_navigation_target<F>(
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    source: MovementNavigationSource,
    target_identity: MovementNavigationTargetIdentity,
    target_transform: Transform2D,
    repath_interval_seconds: f32,
    reached_distance_squared: f32,
    mut resolve_waypoint: F,
) -> Transform2D
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    if source.index >= caches.len() {
        caches.resize(source.index + 1, None);
    }

    let cached_target = caches[source.index]
        .filter(|cache| {
            cache.generation == source.generation
                && cache.target_identity == target_identity
                && cache.remaining_seconds > 0.0
                && !has_reached_movement_navigation_target(
                    source.transform,
                    cache.target,
                    reached_distance_squared,
                )
        })
        .map(|cache| cache.target);
    if let Some(target) = cached_target {
        return target;
    }

    let target = resolve_waypoint(source.transform, target_transform).unwrap_or(target_transform);
    caches[source.index] = Some(MovementNavigationTargetCache {
        generation: source.generation,
        target_identity,
        target,
        remaining_seconds: repath_interval_seconds.max(0.0),
    });
    target
}

pub(in crate::gameplay) fn movement_target_transform_from(
    world: &World,
    primary_actor_transform: Option<Transform2D>,
    source_transform: Transform2D,
    target: MovementTarget,
) -> Option<Transform2D> {
    match target {
        MovementTarget::PrimaryActor | MovementTarget::NearestPrimaryActor => {
            primary_actor_transform
        }
        MovementTarget::NearestEnemy => {
            nearest_layer_transform(world, source_transform, CollisionLayer::Enemy)
        }
        MovementTarget::NearestLayer(layer) => {
            nearest_layer_transform(world, source_transform, layer)
        }
        MovementTarget::NearestFaction(faction_id) => {
            nearest_faction_transform(world, source_transform, faction_id)
        }
        MovementTarget::NearestTag(tag_id) => {
            nearest_tag_transform(world, source_transform, tag_id)
        }
        MovementTarget::Entity(entity) => world.transform(entity),
    }
}

pub(in crate::gameplay) fn nearest_layer_transform(
    world: &World,
    source_transform: Transform2D,
    layer: CollisionLayer,
) -> Option<Transform2D> {
    let mut nearest = None;
    let mut nearest_distance_squared = f32::INFINITY;
    for &index in world.alive_indices() {
        if world.collider_layer_at(index) != Some(layer) {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let dx = transform.x - source_transform.x;
        let dy = transform.y - source_transform.y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= 0.0001 || distance_squared >= nearest_distance_squared {
            continue;
        }
        nearest = Some(transform);
        nearest_distance_squared = distance_squared;
    }
    nearest
}

pub(in crate::gameplay) fn nearest_faction_transform(
    world: &World,
    source_transform: Transform2D,
    faction_id: u32,
) -> Option<Transform2D> {
    GameplayFaction::new(faction_id, 0)?;
    let mut nearest = None;
    let mut nearest_distance_squared = f32::INFINITY;
    for &index in world.gameplay_faction_indices(faction_id) {
        let Some(faction) = world.gameplay_faction_at_index(index) else {
            continue;
        };
        if faction.faction_id != faction_id {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let dx = transform.x - source_transform.x;
        let dy = transform.y - source_transform.y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= 0.0001 || distance_squared >= nearest_distance_squared {
            continue;
        }
        nearest = Some(transform);
        nearest_distance_squared = distance_squared;
    }
    nearest
}

pub(in crate::gameplay) fn nearest_tag_transform(
    world: &World,
    source_transform: Transform2D,
    tag_id: u32,
) -> Option<Transform2D> {
    if tag_id > crate::components::gameplay::GAMEPLAY_TAG_MAX_ID {
        return None;
    }
    let mut nearest = None;
    let mut nearest_distance_squared = f32::INFINITY;
    for &index in world.gameplay_tag_indices(tag_id) {
        let Some(tags) = world.gameplay_tags_at_index(index) else {
            continue;
        };
        if !tags.contains(tag_id) {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let dx = transform.x - source_transform.x;
        let dy = transform.y - source_transform.y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= 0.0001 || distance_squared >= nearest_distance_squared {
            continue;
        }
        nearest = Some(transform);
        nearest_distance_squared = distance_squared;
    }
    nearest
}

pub(in crate::gameplay) fn has_reached_movement_navigation_target(
    from: Transform2D,
    to: Transform2D,
    reached_distance_squared: f32,
) -> bool {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    dx * dx + dy * dy <= reached_distance_squared.max(0.0)
}
