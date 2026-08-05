use super::*;

#[test]
fn movement_navigation_target_cache_reuses_until_repath_interval() {
    let mut caches = Vec::new();
    let source = MovementNavigationSource {
        index: 2,
        generation: 7,
        transform: Transform2D { x: 0.0, y: 0.0 },
    };
    let target = Transform2D { x: 20.0, y: 0.0 };
    let waypoint = Transform2D { x: 0.0, y: 10.0 };
    let mut resolve_count = 0;

    assert_eq!(
        resolve_movement_navigation_target(
            &mut caches,
            source,
            MovementNavigationTargetIdentity::PrimaryActor,
            target,
            0.25,
            4.0,
            |_, _| {
                resolve_count += 1;
                Some(waypoint)
            },
        ),
        waypoint,
    );
    tick_movement_navigation_targets(&mut caches, 0.1);
    assert_eq!(
        resolve_movement_navigation_target(
            &mut caches,
            source,
            MovementNavigationTargetIdentity::PrimaryActor,
            target,
            0.25,
            4.0,
            |_, _| {
                resolve_count += 1;
                None
            },
        ),
        waypoint,
    );
    assert_eq!(resolve_count, 1);

    tick_movement_navigation_targets(&mut caches, 0.25);
    assert_eq!(
        resolve_movement_navigation_target(
            &mut caches,
            source,
            MovementNavigationTargetIdentity::PrimaryActor,
            target,
            0.25,
            4.0,
            |_, _| {
                resolve_count += 1;
                None
            },
        ),
        target,
    );
    assert_eq!(resolve_count, 2);
}

#[test]
fn movement_navigation_target_cache_separates_identity_generation_and_reached_target() {
    let source = MovementNavigationSource {
        index: 1,
        generation: 3,
        transform: Transform2D { x: 0.0, y: 0.0 },
    };
    let target = Transform2D { x: 20.0, y: 0.0 };
    let waypoint = Transform2D { x: 0.0, y: 10.0 };
    let mut caches = vec![None; 2];
    caches[1] = Some(MovementNavigationTargetCache {
        generation: 3,
        target_identity: MovementNavigationTargetIdentity::PrimaryActor,
        target: waypoint,
        remaining_seconds: 0.25,
    });

    assert_eq!(
        resolve_movement_navigation_target(
            &mut caches,
            source,
            MovementNavigationTargetIdentity::Entity(Entity {
                id: 9,
                generation: 1,
            }),
            target,
            0.25,
            4.0,
            |_, _| None,
        ),
        target,
    );

    caches[1] = Some(MovementNavigationTargetCache {
        generation: 99,
        target_identity: MovementNavigationTargetIdentity::PrimaryActor,
        target: waypoint,
        remaining_seconds: 0.25,
    });
    assert_eq!(
        resolve_movement_navigation_target(
            &mut caches,
            source,
            MovementNavigationTargetIdentity::PrimaryActor,
            target,
            0.25,
            4.0,
            |_, _| None,
        ),
        target,
    );

    caches[1] = Some(MovementNavigationTargetCache {
        generation: 3,
        target_identity: MovementNavigationTargetIdentity::PrimaryActor,
        target: Transform2D { x: 1.0, y: 1.0 },
        remaining_seconds: 0.25,
    });
    assert_eq!(
        resolve_movement_navigation_target(
            &mut caches,
            source,
            MovementNavigationTargetIdentity::PrimaryActor,
            target,
            0.25,
            4.0,
            |_, _| None,
        ),
        target,
    );
}

#[test]
fn apply_scene_neutral_movement_pattern_writes_velocity_or_defers_chase() {
    let mut world = World::default();
    let actor = world.spawn_entity();
    world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
    let target = world.spawn_entity();
    world.set_transform(target, Transform2D { x: 4.0, y: 0.0 });

    assert_eq!(
        apply_scene_neutral_movement_pattern(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::MoveToPoint {
                x: 0.0,
                y: 10.0,
                speed: 5.0,
            },
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 0.0, vy: 5.0 }),);

    assert_eq!(
        apply_scene_neutral_movement_pattern(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::SeekTarget {
                target: MovementTarget::Entity(target),
                speed: 10.0,
                turn_rate: 0.25,
            },
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 2.5, vy: 3.75 }),);

    assert_eq!(
        apply_scene_neutral_movement_pattern(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::Accelerate {
                acceleration_x: 1.0,
                acceleration_y: 0.0,
                max_speed: 10.0,
            },
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 3.5, vy: 3.75 }),);

    world.set_velocity(actor, Velocity::default());
    assert_eq!(
        apply_scene_neutral_movement_pattern(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::Accelerate {
                acceleration_x: 10.0,
                acceleration_y: 0.0,
                max_speed: 5.0,
            },
        ),
        MovementPatternApplication::Applied,
    );
    assert_eq!(world.velocity(actor), Some(Velocity { vx: 5.0, vy: 0.0 }),);

    world.set_velocity(actor, Velocity::default());
    assert_eq!(
        apply_scene_neutral_movement_pattern(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::Chase {
                target: MovementTarget::Entity(target),
                speed: 8.0,
            },
        ),
        MovementPatternApplication::DeferredChase {
            target: MovementTarget::Entity(target),
            target_transform: Transform2D { x: 4.0, y: 0.0 },
            speed: 8.0,
        },
    );

    assert_eq!(
        apply_scene_neutral_movement_pattern(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::TopdownInput { speed: 8.0 },
        ),
        MovementPatternApplication::Unsupported,
    );
}
