use super::*;

#[test]
fn apply_movement_pattern_with_navigation_resolves_chase_and_writes_velocity() {
    let mut world = World::default();
    let actor = world.spawn_entity();
    world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
    let mut caches = Vec::new();
    let mut resolve_waypoint =
        |_: Transform2D, _: Transform2D| Some(Transform2D { x: 0.0, y: 10.0 });

    assert_eq!(
        apply_movement_pattern_with_navigation(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::Chase {
                target: MovementTarget::Entity(target),
                speed: 5.0,
            },
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            &mut resolve_waypoint,
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 0.0, vy: 5.0 }),);
    assert_eq!(
        caches[actor.id as usize],
        Some(MovementNavigationTargetCache {
            generation: actor.generation,
            target_identity: MovementNavigationTargetIdentity::Entity(target),
            target: Transform2D { x: 0.0, y: 10.0 },
            remaining_seconds: 0.25,
        }),
    );

    let unsupported = apply_movement_pattern_with_navigation(
        &mut world,
        actor.id as usize,
        None,
        MovementPattern::TopdownInput { speed: 5.0 },
        &mut caches,
        MovementNavigationPolicy {
            repath_interval_seconds: 0.25,
            reached_distance_squared: 0.01,
        },
        &mut |_, _| None,
    );
    assert_eq!(unsupported, MovementPatternApplication::Unsupported);
}

#[test]
fn run_movement_pattern_with_navigation_system_checks_entity_generation() {
    let mut world = World::default();
    let actor = world.spawn_entity();
    world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
    let mut caches = Vec::new();
    let policy = MovementNavigationPolicy {
        repath_interval_seconds: 0.25,
        reached_distance_squared: 0.01,
    };
    let pattern = MovementPattern::Chase {
        target: MovementTarget::Entity(target),
        speed: 5.0,
    };
    world.set_movement_pattern(actor, pattern);

    assert_eq!(
        run_movement_pattern_with_navigation_system(
            &mut world,
            actor,
            None,
            &mut caches,
            policy,
            |_, _| Some(Transform2D { x: 0.0, y: 10.0 }),
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 0.0, vy: 5.0 }),);

    let stale_actor = Entity {
        generation: actor.generation + 1,
        ..actor
    };
    let cache_len = caches.len();
    let mut resolver_calls = 0;
    world.set_velocity(actor, Velocity { vx: 3.0, vy: 4.0 });
    assert_eq!(
        run_movement_pattern_with_navigation_system(
            &mut world,
            stale_actor,
            None,
            &mut caches,
            policy,
            |_, _| {
                resolver_calls += 1;
                Some(Transform2D { x: 5.0, y: 0.0 })
            },
        ),
        MovementPatternApplication::Unsupported,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 3.0, vy: 4.0 }),);
    assert_eq!(resolver_calls, 0);
    assert_eq!(caches.len(), cache_len);

    world.despawn(actor);
    assert!(!world.is_alive_index(actor.id as usize));
    resolver_calls = 0;
    assert_eq!(
        run_movement_pattern_with_navigation_system(
            &mut world,
            actor,
            None,
            &mut caches,
            policy,
            |_, _| {
                resolver_calls += 1;
                Some(Transform2D { x: 5.0, y: 0.0 })
            },
        ),
        MovementPatternApplication::Unsupported,
    );
    assert_eq!(resolver_calls, 0);
    assert_eq!(caches.len(), cache_len);
}

#[test]
fn run_movement_pattern_with_navigation_system_ignores_entities_without_pattern() {
    let mut world = World::default();
    let actor = world.spawn_entity();
    world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
    let mut caches = Vec::new();
    let mut resolver_calls = 0;
    world.set_velocity(actor, Velocity { vx: 3.0, vy: 4.0 });

    assert_eq!(
        run_movement_pattern_with_navigation_system(
            &mut world,
            actor,
            None,
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            |_, _| {
                resolver_calls += 1;
                Some(Transform2D { x: 5.0, y: 0.0 })
            },
        ),
        MovementPatternApplication::Unsupported,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 3.0, vy: 4.0 }));
    assert_eq!(resolver_calls, 0);
    assert!(caches.is_empty());
}

#[test]
fn movement_pattern_with_navigation_fallback_uses_fallback_when_pattern_missing_or_unsupported() {
    let mut world = World::default();
    let missing = world.spawn_entity();
    world.set_transform(missing, Transform2D { x: 0.0, y: 0.0 });
    let unsupported = world.spawn_entity();
    world.set_transform(unsupported, Transform2D { x: 0.0, y: 0.0 });
    world.set_movement_pattern(unsupported, MovementPattern::TopdownInput { speed: 999.0 });
    let mut caches = Vec::new();
    let policy = MovementNavigationPolicy {
        repath_interval_seconds: 0.25,
        reached_distance_squared: 0.01,
    };

    assert_eq!(
        run_movement_pattern_with_navigation_or_fallback_system(
            &mut world,
            missing,
            None,
            MovementPattern::Linear { vx: 3.0, vy: 4.0 },
            &mut caches,
            policy,
            |_, _| None,
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(missing), Some(Velocity { vx: 3.0, vy: 4.0 }));

    assert_eq!(
        run_movement_pattern_with_navigation_or_fallback_system(
            &mut world,
            unsupported,
            None,
            MovementPattern::Linear { vx: 5.0, vy: 6.0 },
            &mut caches,
            policy,
            |_, _| None,
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(
        world.velocity(unsupported),
        Some(Velocity { vx: 5.0, vy: 6.0 }),
    );
}

#[test]
fn movement_pattern_with_navigation_fallback_prefers_authored_pattern() {
    let mut world = World::default();
    let actor = world.spawn_entity();
    world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
    world.set_movement_pattern(actor, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
    let mut caches = Vec::new();

    assert_eq!(
        run_movement_pattern_with_navigation_or_fallback_system(
            &mut world,
            actor,
            None,
            MovementPattern::Linear { vx: 5.0, vy: 6.0 },
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            |_, _| None,
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 1.0, vy: 2.0 }));
}

#[test]
fn movement_pattern_with_navigation_fallback_reuses_navigation_resolver() {
    let mut world = World::default();
    let actor = world.spawn_entity();
    world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
    world.set_movement_pattern(actor, MovementPattern::TopdownInput { speed: 999.0 });
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
    let mut caches = Vec::new();
    let mut resolver_calls = 0;

    assert_eq!(
        run_movement_pattern_with_navigation_or_fallback_system(
            &mut world,
            actor,
            None,
            MovementPattern::Chase {
                target: MovementTarget::Entity(target),
                speed: 5.0,
            },
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            |_, _| {
                resolver_calls += 1;
                Some(Transform2D { x: 0.0, y: 10.0 })
            },
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(resolver_calls, 1);
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 0.0, vy: 5.0 }));
}

#[test]
fn movement_pattern_with_navigation_fallback_rejects_stale_or_despawned_entities() {
    let mut world = World::default();
    let actor = world.spawn_entity();
    world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
    world.set_velocity(actor, Velocity { vx: 3.0, vy: 4.0 });
    let mut caches = Vec::new();
    let policy = MovementNavigationPolicy {
        repath_interval_seconds: 0.25,
        reached_distance_squared: 0.01,
    };
    let fallback = MovementPattern::Linear { vx: 5.0, vy: 6.0 };
    let stale_actor = Entity {
        generation: actor.generation + 1,
        ..actor
    };
    let mut resolver_calls = 0;

    assert_eq!(
        run_movement_pattern_with_navigation_or_fallback_system(
            &mut world,
            stale_actor,
            None,
            fallback,
            &mut caches,
            policy,
            |_, _| {
                resolver_calls += 1;
                None
            },
        ),
        MovementPatternApplication::Unsupported,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 3.0, vy: 4.0 }));
    assert_eq!(resolver_calls, 0);
    assert!(caches.is_empty());

    world.despawn(actor);
    assert_eq!(
        run_movement_pattern_with_navigation_or_fallback_system(
            &mut world,
            actor,
            None,
            fallback,
            &mut caches,
            policy,
            |_, _| {
                resolver_calls += 1;
                None
            },
        ),
        MovementPatternApplication::Unsupported,
    );
    assert_eq!(resolver_calls, 0);
    assert!(caches.is_empty());
}

#[test]
fn movement_pattern_with_navigation_batch_filters_and_reports_stats() {
    let mut world = World::default();
    let fallback = world.spawn_entity();
    world.set_transform(fallback, Transform2D { x: 0.0, y: 0.0 });
    let authored = world.spawn_entity();
    world.set_transform(authored, Transform2D { x: 0.0, y: 0.0 });
    world.set_movement_pattern(authored, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
    let no_transform = world.spawn_entity();
    let excluded = world.spawn_entity();
    world.set_transform(excluded, Transform2D { x: 0.0, y: 0.0 });
    let mut caches = Vec::new();
    let mut unsupported = Vec::new();
    let mut fallback_calls = 0;

    let stats = run_movement_pattern_with_navigation_batch_system(
        &mut world,
        None,
        &mut caches,
        MovementNavigationPolicy {
            repath_interval_seconds: 0.25,
            reached_distance_squared: 0.01,
        },
        |_, entity_index| entity_index != excluded.id as usize,
        |_, _| {
            fallback_calls += 1;
            MovementPattern::Linear { vx: 5.0, vy: 6.0 }
        },
        |world, entity_index| {
            unsupported.push(entity_index);
            assert!(world.set_velocity_at_index(entity_index, Velocity::default()));
        },
        |_, _| None,
    );

    assert_eq!(
        stats,
        MovementPatternBatchRunStats {
            candidates: 3,
            applied: 2,
            unsupported: 1,
        },
    );
    assert_eq!(
        world.velocity(fallback),
        Some(Velocity { vx: 5.0, vy: 6.0 })
    );
    assert_eq!(
        world.velocity(authored),
        Some(Velocity { vx: 1.0, vy: 2.0 })
    );
    assert_eq!(world.velocity(no_transform), Some(Velocity::default()));
    assert_eq!(world.velocity(excluded), None);
    assert_eq!(fallback_calls, 2);
    assert_eq!(unsupported, vec![no_transform.id as usize]);
    assert!(caches.is_empty());
}
