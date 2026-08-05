use super::*;

#[test]
fn layer_movement_pattern_with_navigation_batch_filters_layer_and_transform() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(0.0, 0.0, 1);
    let authored = world.spawn_enemy(0.0, 0.0, 1);
    world.set_movement_pattern(authored, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
    let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let no_transform = world.spawn_enemy(0.0, 0.0, 1);
    assert!(world.clear_transform_for_test(no_transform));
    world.set_velocity(no_transform, Velocity { vx: 7.0, vy: 8.0 });
    let mut caches = Vec::new();
    let mut fallback_calls = 0;

    let stats = run_layer_movement_pattern_with_navigation_batch_system(
        &mut world,
        CollisionLayer::Enemy,
        None,
        &mut caches,
        MovementNavigationPolicy {
            repath_interval_seconds: 0.25,
            reached_distance_squared: 0.01,
        },
        |_, _| {
            fallback_calls += 1;
            MovementPattern::Linear { vx: 5.0, vy: 6.0 }
        },
        |_, _| None,
    );

    assert_eq!(
        stats,
        MovementPatternBatchRunStats {
            candidates: 2,
            applied: 2,
            unsupported: 0,
        },
    );
    assert_eq!(world.velocity(enemy), Some(Velocity { vx: 5.0, vy: 6.0 }));
    assert_eq!(
        world.velocity(authored),
        Some(Velocity { vx: 1.0, vy: 2.0 })
    );
    assert_eq!(world.velocity(bullet), Some(Velocity::default()));
    assert_eq!(
        world.velocity(no_transform),
        Some(Velocity { vx: 7.0, vy: 8.0 }),
    );
    assert_eq!(fallback_calls, 1);
    assert!(caches.is_empty());
}

#[test]
fn layer_movement_pattern_with_navigation_batch_zeros_unsupported_velocity() {
    let mut world = World::default();
    let unsupported = world.spawn_enemy(0.0, 0.0, 1);
    world.set_velocity(unsupported, Velocity { vx: 7.0, vy: 8.0 });
    let mut caches = Vec::new();

    let stats = run_layer_movement_pattern_with_navigation_batch_system(
        &mut world,
        CollisionLayer::Enemy,
        None,
        &mut caches,
        MovementNavigationPolicy {
            repath_interval_seconds: 0.25,
            reached_distance_squared: 0.01,
        },
        |_, _| MovementPattern::TopdownInput { speed: 100.0 },
        |_, _| None,
    );

    assert_eq!(
        stats,
        MovementPatternBatchRunStats {
            candidates: 1,
            applied: 0,
            unsupported: 1,
        },
    );
    assert_eq!(world.velocity(unsupported), Some(Velocity::default()));
    assert!(caches.is_empty());
}

#[test]
fn layer_movement_pattern_phase_config_applies_layer_fallback_contract() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(0.0, 0.0, 1);
    let authored = world.spawn_enemy(0.0, 0.0, 1);
    world.set_movement_pattern(authored, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
    let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let mut caches = Vec::new();

    let stats = run_layer_movement_pattern_phase(
        &mut world,
        &mut caches,
        LayerMovementPatternPhaseConfig {
            layer: CollisionLayer::Enemy,
            player_transform: None,
            navigation_policy: MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            fallback_pattern: MovementPattern::Linear { vx: 5.0, vy: 6.0 },
        },
        |_, _| None,
    );

    assert_eq!(
        stats,
        MovementPatternBatchRunStats {
            candidates: 2,
            applied: 2,
            unsupported: 0,
        },
    );
    assert_eq!(world.velocity(enemy), Some(Velocity { vx: 5.0, vy: 6.0 }));
    assert_eq!(
        world.velocity(authored),
        Some(Velocity { vx: 1.0, vy: 2.0 }),
    );
    assert_eq!(world.velocity(bullet), Some(Velocity::default()));
    assert!(caches.is_empty());
}

#[test]
fn layer_movement_pattern_phase_config_propagates_navigation_inputs() {
    let mut world = World::default();
    let player = world.spawn_player(10.0, 0.0, 1);
    let enemy = world.spawn_enemy(0.0, 0.0, 1);
    let player_transform = world.transform(player);
    let mut caches = Vec::new();
    let config = LayerMovementPatternPhaseConfig {
        layer: CollisionLayer::Enemy,
        player_transform,
        navigation_policy: MovementNavigationPolicy {
            repath_interval_seconds: 0.5,
            reached_distance_squared: 0.01,
        },
        fallback_pattern: MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: 10.0,
        },
    };
    let mut resolver_calls = 0;

    let stats = run_layer_movement_pattern_phase(&mut world, &mut caches, config, |_, _| {
        resolver_calls += 1;
        Some(Transform2D { x: 0.0, y: 5.0 })
    });

    assert_eq!(
        stats,
        MovementPatternBatchRunStats {
            candidates: 1,
            applied: 1,
            unsupported: 0,
        },
    );
    assert_eq!(world.velocity(enemy), Some(Velocity { vx: 0.0, vy: 10.0 }));
    assert_eq!(resolver_calls, 1);

    let stats = run_layer_movement_pattern_phase(&mut world, &mut caches, config, |_, _| {
        resolver_calls += 1;
        Some(Transform2D { x: 10.0, y: 0.0 })
    });

    assert_eq!(
        stats,
        MovementPatternBatchRunStats {
            candidates: 1,
            applied: 1,
            unsupported: 0,
        },
    );
    assert_eq!(world.velocity(enemy), Some(Velocity { vx: 0.0, vy: 10.0 }));
    assert_eq!(resolver_calls, 1);

    tick_movement_navigation_targets(&mut caches, 0.5);
    let stats = run_layer_movement_pattern_phase(&mut world, &mut caches, config, |_, _| {
        resolver_calls += 1;
        Some(Transform2D { x: 10.0, y: 0.0 })
    });

    assert_eq!(
        stats,
        MovementPatternBatchRunStats {
            candidates: 1,
            applied: 1,
            unsupported: 0,
        },
    );
    assert_eq!(world.velocity(enemy), Some(Velocity { vx: 10.0, vy: 0.0 }));
    assert_eq!(resolver_calls, 2);
}
