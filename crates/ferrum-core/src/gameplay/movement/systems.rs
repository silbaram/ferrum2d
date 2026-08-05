use super::*;

pub(in crate::gameplay) fn apply_movement_pattern_with_navigation<F>(
    world: &mut World,
    entity_index: usize,
    player_transform: Option<Transform2D>,
    pattern: MovementPattern,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    resolve_waypoint: &mut F,
) -> MovementPatternApplication
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    match apply_scene_neutral_movement_pattern(world, entity_index, player_transform, pattern) {
        MovementPatternApplication::Applied => MovementPatternApplication::Applied,
        MovementPatternApplication::Unsupported => MovementPatternApplication::Unsupported,
        MovementPatternApplication::DeferredChase {
            target,
            target_transform,
            speed,
        } => {
            let Some(transform) = world.transforms.get(entity_index).and_then(|value| *value)
            else {
                return MovementPatternApplication::Unsupported;
            };
            let Some(source_entity) = world.entity_at_index(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            let source = MovementNavigationSource {
                index: entity_index,
                generation: source_entity.generation,
                transform,
            };
            let target = resolve_movement_navigation_target(
                caches,
                source,
                movement_navigation_target_identity(target),
                target_transform,
                navigation_policy.repath_interval_seconds,
                navigation_policy.reached_distance_squared,
                resolve_waypoint,
            );
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity_toward(source.transform, target, speed));
            MovementPatternApplication::Applied
        }
    }
}

#[cfg(test)]
pub(crate) fn run_movement_pattern_with_navigation_system<F>(
    world: &mut World,
    entity: Entity,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    resolve_waypoint: F,
) -> MovementPatternApplication
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    let entity_index = entity.id as usize;
    if !world.is_current_entity(entity) {
        return MovementPatternApplication::Unsupported;
    }
    let Some(pattern) = world.movement_pattern(entity) else {
        return MovementPatternApplication::Unsupported;
    };
    let mut resolve_waypoint = resolve_waypoint;
    apply_movement_pattern_with_navigation(
        world,
        entity_index,
        player_transform,
        pattern,
        caches,
        navigation_policy,
        &mut resolve_waypoint,
    )
}

#[cfg(test)]
pub(crate) fn run_movement_pattern_with_navigation_or_fallback_system<F>(
    world: &mut World,
    entity: Entity,
    player_transform: Option<Transform2D>,
    fallback_pattern: MovementPattern,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    resolve_waypoint: F,
) -> MovementPatternApplication
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    let entity_index = entity.id as usize;
    if !world.is_current_entity(entity) {
        return MovementPatternApplication::Unsupported;
    }
    let authored_pattern = world.movement_pattern(entity);
    let mut resolve_waypoint = resolve_waypoint;
    let application = if authored_pattern.is_some() {
        run_movement_pattern_with_navigation_system(
            world,
            entity,
            player_transform,
            caches,
            navigation_policy,
            &mut resolve_waypoint,
        )
    } else {
        MovementPatternApplication::Unsupported
    };
    if application == MovementPatternApplication::Unsupported {
        apply_movement_pattern_with_navigation(
            world,
            entity_index,
            player_transform,
            fallback_pattern,
            caches,
            navigation_policy,
            &mut resolve_waypoint,
        )
    } else {
        application
    }
}

#[allow(clippy::too_many_arguments)]
pub(in crate::gameplay) fn movement_pattern_with_navigation_batch_system_impl<
    F,
    I,
    P,
    U,
    const COLLECT_STATS: bool,
>(
    world: &mut World,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    mut include_entity: I,
    mut fallback_pattern: P,
    mut on_unsupported: U,
    mut resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    I: FnMut(&World, usize) -> bool,
    P: FnMut(&World, usize) -> MovementPattern,
    U: FnMut(&mut World, usize),
{
    let mut stats = MovementPatternBatchRunStats::default();
    // Keep this as a private helper: callback hooks may update per-entity
    // components only. Structural mutation belongs in phase-bound command
    // buffers so the alive snapshot stays stable for this scan.
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let entity_index = world.alive_indices()[alive_position];
        if !include_entity(world, entity_index) {
            continue;
        }
        if COLLECT_STATS {
            stats.candidates += 1;
        }
        let mut application =
            if let Some(authored_pattern) = world.movement_pattern_at_index(entity_index) {
                apply_movement_pattern_with_navigation(
                    world,
                    entity_index,
                    player_transform,
                    authored_pattern,
                    caches,
                    navigation_policy,
                    &mut resolve_waypoint,
                )
            } else {
                MovementPatternApplication::Unsupported
            };
        if application == MovementPatternApplication::Unsupported {
            let fallback_pattern = fallback_pattern(world, entity_index);
            application = apply_movement_pattern_with_navigation(
                world,
                entity_index,
                player_transform,
                fallback_pattern,
                caches,
                navigation_policy,
                &mut resolve_waypoint,
            );
        }
        if application == MovementPatternApplication::Applied {
            if COLLECT_STATS {
                stats.applied += 1;
            }
        } else {
            if COLLECT_STATS {
                stats.unsupported += 1;
            }
            on_unsupported(world, entity_index);
        }
    }
    stats
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(in crate::gameplay) fn run_movement_pattern_with_navigation_batch_system<F, I, P, U>(
    world: &mut World,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    include_entity: I,
    fallback_pattern: P,
    on_unsupported: U,
    resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    I: FnMut(&World, usize) -> bool,
    P: FnMut(&World, usize) -> MovementPattern,
    U: FnMut(&mut World, usize),
{
    movement_pattern_with_navigation_batch_system_impl::<F, I, P, U, true>(
        world,
        player_transform,
        caches,
        navigation_policy,
        include_entity,
        fallback_pattern,
        on_unsupported,
        resolve_waypoint,
    )
}

pub(crate) fn apply_layer_movement_pattern_with_navigation_batch_system<F, P>(
    world: &mut World,
    layer: CollisionLayer,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    fallback_pattern: P,
    resolve_waypoint: F,
) where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    P: FnMut(&World, usize) -> MovementPattern,
{
    movement_pattern_with_navigation_batch_system_impl::<_, _, _, _, false>(
        world,
        player_transform,
        caches,
        navigation_policy,
        |world, entity_index| {
            world.collider_layer_at(entity_index) == Some(layer)
                && world.transforms[entity_index].is_some()
        },
        fallback_pattern,
        |world, entity_index| {
            world.velocities[entity_index] = Some(Velocity::default());
        },
        resolve_waypoint,
    );
}

pub(crate) fn apply_layer_movement_pattern_phase<F>(
    world: &mut World,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    config: LayerMovementPatternPhaseConfig,
    resolve_waypoint: F,
) where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    apply_layer_movement_pattern_with_navigation_batch_system(
        world,
        config.layer,
        config.player_transform,
        caches,
        config.navigation_policy,
        |_, _| config.fallback_pattern,
        resolve_waypoint,
    );
}

#[cfg(test)]
pub(crate) fn run_layer_movement_pattern_with_navigation_batch_system<F, P>(
    world: &mut World,
    layer: CollisionLayer,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    fallback_pattern: P,
    resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    P: FnMut(&World, usize) -> MovementPattern,
{
    movement_pattern_with_navigation_batch_system_impl::<_, _, _, _, true>(
        world,
        player_transform,
        caches,
        navigation_policy,
        |world, entity_index| {
            world.collider_layer_at(entity_index) == Some(layer)
                && world.transforms[entity_index].is_some()
        },
        fallback_pattern,
        |world, entity_index| {
            world.velocities[entity_index] = Some(Velocity::default());
        },
        resolve_waypoint,
    )
}

#[cfg(test)]
pub(crate) fn run_layer_movement_pattern_phase<F>(
    world: &mut World,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    config: LayerMovementPatternPhaseConfig,
    resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    run_layer_movement_pattern_with_navigation_batch_system(
        world,
        config.layer,
        config.player_transform,
        caches,
        config.navigation_policy,
        |_, _| config.fallback_pattern,
        resolve_waypoint,
    )
}

pub(in crate::gameplay) fn apply_topdown_input_movement(
    world: &mut World,
    entity_index: usize,
    input: InputState,
    default_speed: f32,
) -> MovementPatternApplication {
    let speed = match world.movement_pattern_at_index(entity_index) {
        Some(MovementPattern::TopdownInput { speed }) => speed,
        _ => default_speed,
    };
    let Some(slot) = world.velocities.get_mut(entity_index) else {
        return MovementPatternApplication::Unsupported;
    };
    *slot = Some(topdown_input_velocity(input, speed));
    MovementPatternApplication::Applied
}

#[cfg(test)]
pub(crate) fn run_topdown_input_movement_system(
    world: &mut World,
    entity: Entity,
    input: InputState,
    default_speed: f32,
) -> MovementPatternApplication {
    apply_topdown_input_movement_phase(
        world,
        TopdownInputMovementPhaseConfig {
            entity,
            input: FrameInputSnapshot::current_only(input),
            default_speed,
        },
    )
}

pub(crate) fn apply_topdown_input_movement_phase(
    world: &mut World,
    config: TopdownInputMovementPhaseConfig,
) -> MovementPatternApplication {
    let entity = config.entity;
    let entity_index = entity.id as usize;
    if !world.is_current_entity(entity) {
        return MovementPatternApplication::Unsupported;
    }
    apply_topdown_input_movement(
        world,
        entity_index,
        config.input.current,
        config.default_speed,
    )
}
