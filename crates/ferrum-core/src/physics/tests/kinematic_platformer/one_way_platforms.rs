use super::*;

#[test]
fn move_and_slide_with_one_way_platforms_lands_from_above() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let result = PhysicsSystem::move_and_slide_with_one_way_platforms(
        &mut world,
        mover,
        Velocity { vx: 0.0, vy: 20.0 },
        CollisionMask::WALL,
        OneWayPlatformConfig::new(CollisionMask::WALL),
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, Some(platform));
    assert!(result.blocked_y);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 0.0, y: 10.0 })
    );
}

#[test]
fn move_and_slide_with_one_way_platforms_blocks_touching_top() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let result = PhysicsSystem::move_and_slide_with_one_way_platforms(
        &mut world,
        mover,
        Velocity { vx: 8.0, vy: 6.0 },
        CollisionMask::WALL,
        OneWayPlatformConfig::new(CollisionMask::WALL),
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, Some(platform));
    assert!(result.blocked_y);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 8.0, y: 10.0 })
    );
}

#[test]
fn move_and_slide_with_one_way_platforms_ignores_from_below_and_sides() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 30.0, CollisionLayer::Player, true);
    spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let upward_result = PhysicsSystem::move_and_slide_with_one_way_platforms(
        &mut world,
        mover,
        Velocity { vx: 0.0, vy: -20.0 },
        CollisionMask::WALL,
        OneWayPlatformConfig::new(CollisionMask::WALL),
        4,
    );

    assert_eq!(upward_result.hit_count, 0);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 0.0, y: 10.0 })
    );

    world.set_transform(mover, Transform2D { x: 0.0, y: 20.0 });
    let side_result = PhysicsSystem::move_and_slide_with_one_way_platforms(
        &mut world,
        mover,
        Velocity { vx: 30.0, vy: 0.0 },
        CollisionMask::WALL,
        OneWayPlatformConfig::new(CollisionMask::WALL),
        4,
    );

    assert_eq!(side_result.hit_count, 0);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 30.0, y: 20.0 })
    );
}

#[test]
fn move_and_slide_with_one_way_platforms_keeps_other_solids_two_way() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 32.0, CollisionLayer::Player, true);
    let ceiling = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Enemy, false);

    let result = PhysicsSystem::move_and_slide_with_one_way_platforms(
        &mut world,
        mover,
        Velocity { vx: 0.0, vy: -20.0 },
        CollisionMask::ENEMY.union(CollisionMask::WALL),
        OneWayPlatformConfig::new(CollisionMask::WALL),
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, Some(ceiling));
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 0.0, y: 30.0 })
    );
}

#[test]
fn move_and_slide_with_tilemap_and_one_way_platforms_keeps_tiles_solid() {
    let mut world = World::default();
    let tilemap = single_wall_tilemap();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        5.0,
        CollisionLayer::Player,
        true,
        2.0,
        2.0,
    );

    let result = PhysicsSystem::move_and_slide_with_tilemap_and_one_way_platforms(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 20.0, vy: 0.0 },
        CollisionMask::WALL,
        OneWayPlatformConfig::new(CollisionMask::WALL),
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, None);
    assert!(result.blocked_x);
    assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 5.0 }));
}

#[test]
fn move_and_slide_with_tilemap_lands_on_one_way_tile_from_above() {
    let mut world = World::default();
    let tilemap = single_one_way_tilemap();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        5.0,
        -2.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );

    let result = PhysicsSystem::move_and_slide_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 0.0, vy: 10.0 },
        CollisionMask::WALL,
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, None);
    assert!(result.blocked_y);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 5.0, y: -1.0 })
    );
}

#[test]
fn move_and_slide_with_tilemap_ignores_one_way_tile_from_below_and_sides() {
    let mut world = World::default();
    let tilemap = single_one_way_tilemap();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        5.0,
        12.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );

    let upward_result = PhysicsSystem::move_and_slide_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 0.0, vy: -10.0 },
        CollisionMask::WALL,
        4,
    );

    assert_eq!(upward_result.hit_count, 0);
    assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 2.0 }));

    world.set_transform(mover, Transform2D { x: -2.0, y: 5.0 });
    let side_result = PhysicsSystem::move_and_slide_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 10.0, vy: 0.0 },
        CollisionMask::WALL,
        4,
    );

    assert_eq!(side_result.hit_count, 0);
    assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 5.0 }));
}
