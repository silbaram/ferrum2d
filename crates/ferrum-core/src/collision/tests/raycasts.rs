use super::*;

#[test]
fn raycast_returns_nearest_hit_with_surface_normal() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(20.0, 10.0, 0);
    world.spawn_enemy(60.0, 10.0, 0);

    let hit = CollisionSystem::raycast(
        &world,
        Transform2D { x: 0.0, y: 10.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .unwrap();

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 8.0).abs() < 0.01);
    assert!((hit.point_x - 8.0).abs() < 0.01);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn raycast_returns_lower_entity_id_for_equal_distance_hits() {
    let mut world = World::default();
    let first = spawn_custom_body(
        &mut world,
        20.0,
        -4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_body(
        &mut world,
        20.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::raycast(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("raycast should hit one of the tied enemies");

    assert!(first.id < second.id);
    assert_eq!(hit.entity, first);
    assert!((hit.distance - 15.0).abs() < 0.01);
}

#[test]
fn raycast_returns_circle_hit_with_surface_normal() {
    let mut world = World::default();
    let enemy = spawn_custom_circle(
        &mut world,
        20.0,
        10.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::raycast(
        &world,
        Transform2D { x: 0.0, y: 10.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .unwrap();

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 16.0).abs() < 0.01);
    assert!((hit.point_x - 16.0).abs() < 0.01);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn raycast_returns_capsule_side_hit_with_surface_normal() {
    let mut world = World::default();
    let enemy = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::raycast(
        &world,
        Transform2D { x: 0.0, y: 4.0 },
        Velocity { vx: 0.0, vy: -1.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .unwrap();

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 3.0).abs() < 0.01);
    assert!((hit.point_x - 0.0).abs() < 0.01);
    assert!((hit.point_y - 1.0).abs() < 0.01);
    assert_eq!(hit.normal_x, 0.0);
    assert_eq!(hit.normal_y, 1.0);
}

#[test]
fn raycast_returns_edge_hit_with_surface_normal() {
    let mut world = World::default();
    let enemy = spawn_custom_edge(
        &mut world,
        0.0,
        0.0,
        edge(-5.0, 0.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::raycast(
        &world,
        Transform2D { x: 0.0, y: 4.0 },
        Velocity { vx: 0.0, vy: -1.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .unwrap();

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 4.0).abs() < 0.01);
    assert!((hit.point_x - 0.0).abs() < 0.01);
    assert!((hit.point_y - 0.0).abs() < 0.01);
    assert_eq!(hit.normal_x, 0.0);
    assert_eq!(hit.normal_y, 1.0);
}

#[test]
fn segment_cast_returns_edge_hit() {
    let mut world = World::default();
    let enemy = spawn_custom_edge(
        &mut world,
        0.0,
        0.0,
        edge(-5.0, 0.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::segment_cast(
        &world,
        Transform2D { x: 0.0, y: 4.0 },
        Transform2D { x: 0.0, y: -4.0 },
        CollisionMask::ENEMY,
    )
    .unwrap();

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 4.0).abs() < 0.01);
    assert!((hit.point_y - 0.0).abs() < 0.01);
    assert_eq!(hit.normal_x, 0.0);
    assert_eq!(hit.normal_y, 1.0);
}

#[test]
fn segment_cast_returns_lower_entity_id_for_equal_distance_hits() {
    let mut world = World::default();
    let first = spawn_custom_body(
        &mut world,
        20.0,
        -4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_body(
        &mut world,
        20.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::segment_cast(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        Transform2D { x: 40.0, y: 0.0 },
        CollisionMask::ENEMY,
    )
    .expect("segment cast should hit one of the tied enemies");

    assert!(first.id < second.id);
    assert_eq!(hit.entity, first);
    assert!((hit.distance - 15.0).abs() < 0.01);
}

#[test]
fn raycast_returns_oriented_box_hit_with_surface_normal() {
    let mut world = World::default();
    let enemy = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::raycast(
        &world,
        Transform2D { x: 0.0, y: 6.0 },
        Velocity { vx: 0.0, vy: -1.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .unwrap();

    assert_eq!(hit.entity, enemy);
    assert!(hit.distance > 1.0);
    assert!(hit.distance < 6.0);
    assert!(hit.point_y < 6.0);
    assert!(hit.normal_y > 0.0);
}

#[test]
fn raycast_returns_convex_polygon_hit_with_surface_normal() {
    let mut world = World::default();
    let enemy = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::raycast(
        &world,
        Transform2D { x: -6.0, y: 0.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .unwrap();

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 4.0).abs() < 0.01);
    assert!((hit.point_x + 2.0).abs() < 0.01);
    assert!((hit.point_y - 0.0).abs() < 0.01);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn segment_cast_limits_hits_to_segment_endpoints() {
    let mut world = World::default();
    let near = spawn_custom_circle(
        &mut world,
        20.0,
        0.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_body(
        &mut world,
        40.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::segment_cast_all(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        Transform2D { x: 30.0, y: 0.0 },
        CollisionMask::ENEMY,
    );
    let hit = CollisionSystem::segment_cast(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        Transform2D { x: 30.0, y: 0.0 },
        CollisionMask::ENEMY,
    )
    .expect("segment cast should hit near circle");

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].entity, near);
    assert_eq!(hit.entity, near);
    assert!((hit.distance - 16.0).abs() < 0.01);
    assert!((hit.point_x - 16.0).abs() < 0.01);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn segment_cast_all_sorts_hits_by_distance() {
    let mut world = World::default();
    let far = spawn_custom_circle(
        &mut world,
        40.0,
        0.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let near = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::segment_cast_all(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        Transform2D { x: 60.0, y: 0.0 },
        CollisionMask::ENEMY,
    );

    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].entity, near);
    assert_eq!(hits[1].entity, far);
    assert!(hits[0].distance < hits[1].distance);
}

#[test]
fn segment_cast_rejects_invalid_or_zero_length_segment() {
    let mut world = World::default();
    world.spawn_enemy(10.0, 0.0, 0);

    assert!(CollisionSystem::segment_cast(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        Transform2D { x: 0.0, y: 0.0 },
        CollisionMask::ENEMY,
    )
    .is_none());
    assert!(CollisionSystem::segment_cast_all(
        &world,
        Transform2D {
            x: f32::NAN,
            y: 0.0,
        },
        Transform2D { x: 20.0, y: 0.0 },
        CollisionMask::ENEMY,
    )
    .is_empty());
}
