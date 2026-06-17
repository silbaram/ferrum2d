use super::*;

#[test]
fn move_and_slide_stops_at_solid_collider() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let wall = spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, false);

    let result = PhysicsSystem::move_and_slide(
        &mut world,
        mover,
        Velocity { vx: 30.0, vy: 0.0 },
        CollisionMask::ENEMY,
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, Some(wall));
    assert!(result.blocked_x);
    assert!(!result.blocked_y);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 10.0, y: 0.0 })
    );
}

#[test]
fn move_and_slide_with_tilemap_stops_at_solid_tile() {
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

    let result = PhysicsSystem::move_and_slide_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 20.0, vy: 0.0 },
        CollisionMask::ENEMY,
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert_eq!(result.last_hit, None);
    assert!(result.blocked_x);
    assert!(!result.blocked_y);
    let transform = world.transform(mover).unwrap();
    assert!((transform.x - 8.0).abs() < 0.01);
    assert!((transform.y - 5.0).abs() < 0.01);
}

#[test]
fn move_and_slide_with_tilemap_passes_nonblocking_hd2d_tile() {
    let mut world = World::default();
    let tilemap = single_nonblocking_hd2d_tilemap();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        5.0,
        CollisionLayer::Player,
        true,
        2.0,
        2.0,
    );

    let result = PhysicsSystem::move_and_slide_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 20.0, vy: 0.0 },
        CollisionMask::ENEMY,
        4,
    );

    assert_eq!(result.hit_count, 0);
    assert!(!result.blocked_x);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 20.0, y: 5.0 })
    );
}

#[test]
fn move_and_slide_with_tilemap_and_counters_records_tile_hit() {
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
    let mut counters = PhysicsCounters::default();

    PhysicsSystem::move_and_slide_with_tilemap_and_counters(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 20.0, vy: 0.0 },
        CollisionMask::ENEMY,
        4,
        &mut counters,
    );

    assert_eq!(counters.kinematic_moves, 1);
    assert_eq!(counters.kinematic_hits, 1);
    assert_eq!(counters.kinematic_entity_hits, 0);
    assert_eq!(counters.kinematic_tile_hits, 1);
    assert!(counters.tile_candidate_checks > 0);
}

#[test]
fn move_and_slide_counters_use_swept_entity_candidates() {
    let mut world = World::default();
    let tilemap = Tilemap::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let wall = spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, false);
    for i in 0..64 {
        spawn_kinematic_body(
            &mut world,
            1_000.0 + i as f32 * 20.0,
            1_000.0,
            CollisionLayer::Enemy,
            false,
        );
    }
    let mut counters = PhysicsCounters::default();

    let result = PhysicsSystem::move_and_slide_with_tilemap_and_counters(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 30.0, vy: 0.0 },
        CollisionMask::ENEMY,
        4,
        &mut counters,
    );

    assert_eq!(result.last_hit, Some(wall));
    assert_eq!(counters.kinematic_entity_hits, 1);
    assert_eq!(counters.solid_candidate_checks, 1);
}

#[test]
fn move_and_slide_preserves_tangent_motion() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, false);

    let result = PhysicsSystem::move_and_slide(
        &mut world,
        mover,
        Velocity { vx: 30.0, vy: 9.0 },
        CollisionMask::ENEMY,
        4,
    );

    assert_eq!(result.hit_count, 1);
    assert!(result.blocked_x);
    let transform = world.transform(mover).unwrap();
    assert!((transform.x - 10.0).abs() < 0.01);
    assert!((transform.y - 9.0).abs() < 0.01);
}

#[test]
fn move_and_slide_ignores_trigger_colliders() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, true);

    let result = PhysicsSystem::move_and_slide(
        &mut world,
        mover,
        Velocity { vx: 30.0, vy: 0.0 },
        CollisionMask::ENEMY,
        4,
    );

    assert_eq!(result.hit_count, 0);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 30.0, y: 0.0 })
    );
}

#[test]
fn move_and_slide_ignores_disabled_colliders() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let wall = spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, false);
    let wall_collider = world.collider(wall).unwrap().with_enabled(false);
    world.set_aabb_collider(wall, wall_collider);

    let result = PhysicsSystem::move_and_slide(
        &mut world,
        mover,
        Velocity { vx: 30.0, vy: 0.0 },
        CollisionMask::ENEMY,
        4,
    );

    assert_eq!(result.hit_count, 0);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 30.0, y: 0.0 })
    );
}
