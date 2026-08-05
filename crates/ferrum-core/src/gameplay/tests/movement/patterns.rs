use super::*;

#[test]
fn evaluate_movement_pattern_resolves_common_velocity_patterns() {
    let world = World::default();
    let transform = Transform2D { x: 0.0, y: 0.0 };

    assert_eq!(
        evaluate_movement_pattern(&world, None, transform, None, MovementPattern::Static),
        Some(MovementPatternEvaluation::Velocity(Velocity::default())),
    );
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::Linear { vx: 3.0, vy: -4.0 },
        ),
        Some(MovementPatternEvaluation::Velocity(Velocity {
            vx: 3.0,
            vy: -4.0
        })),
    );
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::Oscillate {
                origin_x: 0.0,
                origin_y: 0.0,
                amplitude_x: 10.0,
                amplitude_y: 0.0,
                phase_speed: 1.0,
            },
        ),
        None,
    );
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::PlatformerInput {
                horizontal_speed: 210.0,
                gravity: 900.0,
                jump_speed: 420.0,
                max_fall_speed: 760.0,
                ground_probe_distance: 2.0,
                step_offset: 12.0,
                coyote_time_seconds: 0.08,
                jump_buffer_seconds: 0.10,
            },
        ),
        None,
    );
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::MoveToPoint {
                x: 0.0,
                y: 10.0,
                speed: 5.0,
            },
        ),
        Some(MovementPatternEvaluation::Velocity(Velocity {
            vx: 0.0,
            vy: 5.0
        })),
    );
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::TopdownInput { speed: 5.0 },
        ),
        None,
    );
}

#[test]
fn default_movement_pattern_builds_common_enemy_fallback_patterns() {
    let base = DefaultMovementPatternConfig {
        kind: DefaultMovementPatternKind::ChasePlayer,
        speed: 7.0,
        world_width: 200.0,
        world_height: 120.0,
        orbit_radius: 32.0,
        orbit_radial_band: 6.0,
    };

    assert_eq!(
        default_movement_pattern(base),
        MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: 7.0,
        },
    );
    assert_eq!(
        default_movement_pattern(DefaultMovementPatternConfig {
            kind: DefaultMovementPatternKind::MoveToWorldCenter,
            ..base
        }),
        MovementPattern::MoveToPoint {
            x: 100.0,
            y: 60.0,
            speed: 7.0,
        },
    );
    assert_eq!(
        default_movement_pattern(DefaultMovementPatternConfig {
            kind: DefaultMovementPatternKind::Static,
            ..base
        }),
        MovementPattern::Static,
    );
    assert_eq!(
        default_movement_pattern(DefaultMovementPatternConfig {
            kind: DefaultMovementPatternKind::OrbitPlayer,
            ..base
        }),
        MovementPattern::Orbit {
            target: MovementTarget::PrimaryActor,
            speed: 7.0,
            radius: 32.0,
            radial_band: 6.0,
        },
    );
}

#[test]
fn layer_movement_phase_config_with_default_fallback_builds_common_contract() {
    let navigation_policy = MovementNavigationPolicy {
        repath_interval_seconds: 0.5,
        reached_distance_squared: 4.0,
    };
    let player_transform = Some(Transform2D { x: 12.0, y: 34.0 });

    assert_eq!(
        layer_movement_pattern_phase_config_with_default_fallback(
            LayerMovementPatternDefaultFallbackConfig {
                layer: CollisionLayer::Enemy,
                player_transform,
                navigation_policy,
                fallback: DefaultMovementPatternConfig {
                    kind: DefaultMovementPatternKind::OrbitPlayer,
                    speed: 7.0,
                    world_width: 200.0,
                    world_height: 120.0,
                    orbit_radius: 32.0,
                    orbit_radial_band: 6.0,
                },
            },
        ),
        LayerMovementPatternPhaseConfig {
            layer: CollisionLayer::Enemy,
            player_transform,
            navigation_policy,
            fallback_pattern: MovementPattern::Orbit {
                target: MovementTarget::PrimaryActor,
                speed: 7.0,
                radius: 32.0,
                radial_band: 6.0,
            },
        },
    );
}

#[test]
fn evaluate_movement_pattern_resolves_targets_without_scene_navigation() {
    use crate::components::gameplay::{GameplayFaction, GameplayTags, GAMEPLAY_FACTION_ENEMY};

    let mut world = World::default();
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 24.0, y: 8.0 });
    let transform = Transform2D { x: 4.0, y: 8.0 };

    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::Chase {
                target: MovementTarget::Entity(target),
                speed: 7.0,
            },
        ),
        Some(MovementPatternEvaluation::Chase {
            target: MovementTarget::Entity(target),
            target_transform: Transform2D { x: 24.0, y: 8.0 },
            speed: 7.0,
        }),
    );

    assert_eq!(
        evaluate_movement_pattern(
            &world,
            Some(Transform2D { x: 30.0, y: 8.0 }),
            transform,
            None,
            MovementPattern::Chase {
                target: MovementTarget::NearestPrimaryActor,
                speed: 9.0,
            },
        ),
        Some(MovementPatternEvaluation::Chase {
            target: MovementTarget::NearestPrimaryActor,
            target_transform: Transform2D { x: 30.0, y: 8.0 },
            speed: 9.0,
        }),
    );

    let _source_enemy = world.spawn_enemy(4.0, 8.0, 0);
    let _far_enemy = world.spawn_enemy(40.0, 8.0, 0);
    let _near_enemy = world.spawn_enemy(8.0, 8.0, 0);
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            Some(Velocity { vx: 1.0, vy: 0.0 }),
            MovementPattern::SeekTarget {
                target: MovementTarget::NearestEnemy,
                speed: 12.0,
                turn_rate: 0.5,
            },
        ),
        Some(MovementPatternEvaluation::SeekTarget {
            target_transform: Transform2D { x: 8.0, y: 8.0 },
            current_velocity: Velocity { vx: 1.0, vy: 0.0 },
            speed: 12.0,
            turn_rate: 0.5,
        }),
    );

    let _near_bullet = world.spawn_bullet(6.0, 8.0, 0.0, 0.0, 0);
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::Chase {
                target: MovementTarget::NearestLayer(CollisionLayer::Bullet),
                speed: 10.0,
            },
        ),
        Some(MovementPatternEvaluation::Chase {
            target: MovementTarget::NearestLayer(CollisionLayer::Bullet),
            target_transform: Transform2D { x: 6.0, y: 8.0 },
            speed: 10.0,
        }),
    );

    let far_faction = world.spawn_entity();
    world.set_transform(far_faction, Transform2D { x: 32.0, y: 8.0 });
    world.set_gameplay_faction(
        far_faction,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
    );
    let near_faction = world.spawn_entity();
    world.set_transform(near_faction, Transform2D { x: 7.0, y: 8.0 });
    world.set_gameplay_faction(
        near_faction,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
    );
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::Chase {
                target: MovementTarget::NearestFaction(GAMEPLAY_FACTION_ENEMY),
                speed: 11.0,
            },
        ),
        Some(MovementPatternEvaluation::Chase {
            target: MovementTarget::NearestFaction(GAMEPLAY_FACTION_ENEMY),
            target_transform: Transform2D { x: 7.0, y: 8.0 },
            speed: 11.0,
        }),
    );

    let near_untagged = world.spawn_entity();
    world.set_transform(near_untagged, Transform2D { x: 5.0, y: 8.0 });
    let far_tagged = world.spawn_entity();
    world.set_transform(far_tagged, Transform2D { x: 34.0, y: 8.0 });
    world.set_gameplay_tags(far_tagged, GameplayTags::new(1 << 5).unwrap());
    let near_tagged = world.spawn_entity();
    world.set_transform(near_tagged, Transform2D { x: 9.0, y: 8.0 });
    world.set_gameplay_tags(near_tagged, GameplayTags::new(1 << 5).unwrap());
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::Chase {
                target: MovementTarget::NearestTag(5),
                speed: 13.0,
            },
        ),
        Some(MovementPatternEvaluation::Chase {
            target: MovementTarget::NearestTag(5),
            target_transform: Transform2D { x: 9.0, y: 8.0 },
            speed: 13.0,
        }),
    );

    world.despawn(target);
    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            None,
            MovementPattern::Chase {
                target: MovementTarget::Entity(target),
                speed: 7.0,
            },
        ),
        Some(MovementPatternEvaluation::Velocity(Velocity::default())),
    );
}

#[test]
fn evaluate_movement_pattern_handles_seek_target_and_accelerate_variants() {
    let mut world = World::default();
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
    let transform = Transform2D { x: 0.0, y: 0.0 };

    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            Some(Velocity { vx: 4.0, vy: 0.0 }),
            MovementPattern::SeekTarget {
                target: MovementTarget::Entity(target),
                speed: 10.0,
                turn_rate: 2.0,
            },
        ),
        Some(MovementPatternEvaluation::SeekTarget {
            target_transform: Transform2D { x: 10.0, y: 0.0 },
            current_velocity: Velocity { vx: 4.0, vy: 0.0 },
            speed: 10.0,
            turn_rate: 1.0,
        }),
    );

    assert_eq!(
        evaluate_movement_pattern(
            &world,
            None,
            transform,
            Some(Velocity { vx: 1.0, vy: 1.0 }),
            MovementPattern::Accelerate {
                acceleration_x: 2.0,
                acceleration_y: 2.0,
                max_speed: 10.0,
            },
        ),
        Some(MovementPatternEvaluation::Accelerate {
            current_velocity: Velocity { vx: 1.0, vy: 1.0 },
            acceleration_x: 2.0,
            acceleration_y: 2.0,
            max_speed: 10.0,
        }),
    );
}
