use super::*;

#[test]
fn carry_moving_platform_moves_grounded_rider_by_platform_delta() {
    let mut world = World::default();
    let rider = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let result = PhysicsSystem::carry_moving_platform(
        &mut world,
        rider,
        MovingPlatformCarryConfig::new(
            platform,
            Velocity { vx: 6.0, vy: 0.0 },
            1.0,
            CollisionMask::WALL,
            4,
        ),
    )
    .expect("rider standing on platform should be carried");

    assert_eq!(result.hit_count, 0);
    assert_eq!(
        world.transform(rider),
        Some(Transform2D { x: 6.0, y: 10.0 })
    );
}

#[test]
fn carry_moving_platform_does_not_apply_rotation_carry_by_default() {
    let mut world = World::default();
    let rider = spawn_kinematic_body(&mut world, 10.0, 10.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        20.0,
        CollisionLayer::Wall,
        false,
        20.0,
        5.0,
    );

    let result = PhysicsSystem::carry_moving_platform(
        &mut world,
        rider,
        MovingPlatformCarryConfig::new(
            platform,
            Velocity { vx: 0.0, vy: 0.0 },
            1.0,
            CollisionMask::WALL,
            4,
        ),
    )
    .expect("rider standing on platform should run the carry path");

    assert_eq!(result.hit_count, 0);
    assert_eq!(
        world.transform(rider),
        Some(Transform2D { x: 10.0, y: 10.0 })
    );
}

#[test]
fn carry_moving_platform_with_rotation_carry_moves_rider_around_platform_origin() {
    let mut world = World::default();
    let rider = spawn_kinematic_body(&mut world, 10.0, 10.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        20.0,
        CollisionLayer::Wall,
        false,
        20.0,
        5.0,
    );

    let result = PhysicsSystem::carry_moving_platform_with_rotation_carry(
        &mut world,
        rider,
        MovingPlatformCarryConfig::new(
            platform,
            Velocity { vx: 0.0, vy: 0.0 },
            1.0,
            CollisionMask::WALL,
            4,
        ),
        MovingPlatformRotationCarryConfig::new(
            Transform2D { x: 0.0, y: 20.0 },
            -std::f32::consts::FRAC_PI_2,
        ),
    )
    .expect("rider standing on platform should inherit opt-in rotation carry");

    assert_eq!(result.hit_count, 0);
    assert!(
        (result.requested.vx + 20.0).abs() < 0.001,
        "rotation carry should contribute horizontal displacement, got {:?}",
        result.requested
    );
    assert!(
        result.requested.vy.abs() < 0.001,
        "rotation carry should preserve rider height in this fixture, got {:?}",
        result.requested
    );
    let transform = world.transform(rider).unwrap();
    assert!(
        (transform.x + 10.0).abs() < 0.001 && (transform.y - 10.0).abs() < 0.001,
        "rider should move with the platform rotation arc, got {transform:?}"
    );
}

#[test]
fn carry_moving_platform_returns_none_when_rider_is_not_on_platform() {
    let mut world = World::default();
    let rider = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let result = PhysicsSystem::carry_moving_platform(
        &mut world,
        rider,
        MovingPlatformCarryConfig::new(
            platform,
            Velocity { vx: 6.0, vy: 0.0 },
            1.0,
            CollisionMask::WALL,
            4,
        ),
    );

    assert!(result.is_none());
    assert_eq!(world.transform(rider), Some(Transform2D { x: 0.0, y: 0.0 }));
}

#[test]
fn carry_moving_platform_respects_other_solid_colliders() {
    let mut world = World::default();
    let rider = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);
    let wall = spawn_kinematic_body(&mut world, 20.0, 10.0, CollisionLayer::Enemy, false);

    let result = PhysicsSystem::carry_moving_platform(
        &mut world,
        rider,
        MovingPlatformCarryConfig::new(
            platform,
            Velocity { vx: 30.0, vy: 0.0 },
            1.0,
            CollisionMask::WALL.union(CollisionMask::ENEMY),
            4,
        ),
    )
    .expect("rider should be carried until another solid blocks it");

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, Some(wall));
    assert!(result.blocked_x);
    assert_eq!(
        world.transform(rider),
        Some(Transform2D { x: 10.0, y: 10.0 })
    );
}

#[test]
fn carry_moving_platform_with_tilemap_respects_tile_obstacles() {
    let mut world = World::default();
    let tilemap = single_wall_tilemap();
    let rider = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        5.0,
        CollisionLayer::Player,
        true,
        2.0,
        2.0,
    );
    let platform = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        10.0,
        CollisionLayer::Wall,
        false,
        5.0,
        3.0,
    );

    let result = PhysicsSystem::carry_moving_platform_with_tilemap(
        &mut world,
        &tilemap,
        rider,
        MovingPlatformCarryConfig::new(
            platform,
            Velocity { vx: 20.0, vy: 0.0 },
            1.0,
            CollisionMask::WALL,
            4,
        ),
    )
    .expect("rider should be carried until a tile obstacle blocks it");

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, None);
    assert!(result.blocked_x);
    assert_eq!(world.transform(rider), Some(Transform2D { x: 8.0, y: 5.0 }));
}
