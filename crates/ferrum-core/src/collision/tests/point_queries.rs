use super::*;

#[test]
fn point_query_returns_matching_mask_hits() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(10.0, 10.0, 0);
    world.spawn_bullet(80.0, 80.0, 0.0, 0.0, 0);

    let hits = CollisionSystem::point_query(
        &world,
        Transform2D { x: 10.0, y: 10.0 },
        CollisionMask::ENEMY,
    );

    assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
}

#[test]
fn point_query_respects_aabb_collider_offset() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.colliders[enemy.id as usize] = Some(collider(2.0, 2.0).with_offset(10.0, 0.0));

    let hits = CollisionSystem::point_query(
        &world,
        Transform2D { x: 10.0, y: 0.0 },
        CollisionMask::ENEMY,
    );
    let misses =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
    assert!(misses.is_empty());
}

#[test]
fn disabled_aabb_collider_is_excluded_from_pairs_and_queries() {
    let mut world = World::default();
    let disabled = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_body(
        &mut world,
        8.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(disabled, collider(5.0, 5.0).with_enabled(false));

    let hits =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert!(CollisionSystem::build_pairs(&world).is_empty());
    assert!(hits.is_empty());
}

#[test]
fn point_query_respects_circle_shape() {
    let mut world = World::default();
    spawn_custom_circle(
        &mut world,
        10.0,
        10.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::point_query(
        &world,
        Transform2D { x: 14.0, y: 14.0 },
        CollisionMask::ENEMY,
    );

    assert!(hits.is_empty());
}

#[test]
fn point_query_respects_circle_collider_offset() {
    let mut world = World::default();
    let enemy = spawn_custom_circle(
        &mut world,
        0.0,
        0.0,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_circle_collider(enemy, circle(3.0).with_offset(8.0, 0.0));

    let hits =
        CollisionSystem::point_query(&world, Transform2D { x: 8.0, y: 0.0 }, CollisionMask::ENEMY);
    let misses =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
    assert!(misses.is_empty());
}

#[test]
fn disabled_circle_collider_is_excluded_from_queries() {
    let mut world = World::default();
    let enemy = spawn_custom_circle(
        &mut world,
        0.0,
        0.0,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_circle_collider(enemy, circle(3.0).with_enabled(false));

    let hits =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert!(hits.is_empty());
}

#[test]
fn point_query_respects_oriented_box_collider_offset_and_rotation() {
    let mut world = World::default();
    let enemy = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4).with_offset(8.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::point_query(
        &world,
        Transform2D { x: 10.0, y: 2.0 },
        CollisionMask::ENEMY,
    );
    let misses =
        CollisionSystem::point_query(&world, Transform2D { x: 8.0, y: 3.0 }, CollisionMask::ENEMY);

    assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
    assert!(misses.is_empty());
}

#[test]
fn disabled_oriented_box_collider_is_excluded_from_pairs_and_queries() {
    let mut world = World::default();
    let disabled = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(4.0, 1.0, 0.0).with_enabled(false),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert!(!world.oriented_box_collider(disabled).unwrap().enabled);
    assert!(CollisionSystem::build_pairs(&world).is_empty());
    assert!(hits.is_empty());
}

#[test]
fn point_query_respects_capsule_collider_offset() {
    let mut world = World::default();
    let enemy = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-4.0, 0.0, 4.0, 0.0, 1.0).with_offset(8.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::point_query(
        &world,
        Transform2D { x: 8.0, y: 0.75 },
        CollisionMask::ENEMY,
    );
    let misses =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
    assert!(misses.is_empty());
}

#[test]
fn disabled_capsule_collider_is_excluded_from_pairs_and_queries() {
    let mut world = World::default();
    let disabled = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-4.0, 0.0, 4.0, 0.0, 1.0).with_enabled(false),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_body(
        &mut world,
        7.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert!(!world.capsule_collider(disabled).unwrap().enabled);
    assert!(CollisionSystem::build_pairs(&world).is_empty());
    assert!(hits.is_empty());
}

#[test]
fn point_query_respects_convex_polygon_collider_offset_and_rotation() {
    let mut world = World::default();
    let enemy = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-4.0, -1.0), (4.0, -1.0), (4.0, 1.0), (-4.0, 1.0)])
            .with_offset(8.0, 0.0)
            .with_rotation(core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::point_query(
        &world,
        Transform2D { x: 10.0, y: 2.0 },
        CollisionMask::ENEMY,
    );
    let misses =
        CollisionSystem::point_query(&world, Transform2D { x: 8.0, y: 3.0 }, CollisionMask::ENEMY);

    assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
    assert!(misses.is_empty());
}

#[test]
fn disabled_convex_polygon_collider_is_excluded_from_pairs_and_queries() {
    let mut world = World::default();
    let disabled = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-4.0, -1.0), (4.0, -1.0), (4.0, 1.0), (-4.0, 1.0)])
            .with_enabled(false),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_body(
        &mut world,
        7.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits =
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY);

    assert!(!world.convex_polygon_collider(disabled).unwrap().enabled);
    assert!(CollisionSystem::build_pairs(&world).is_empty());
    assert!(hits.is_empty());
}
