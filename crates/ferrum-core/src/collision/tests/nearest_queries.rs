use super::*;

#[test]
fn nearest_body_query_returns_nearest_aabb_surface() {
    let mut world = World::default();
    let near = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
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

    let hit = CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("nearest query should hit enemy");

    assert_eq!(hit.entity, near);
    assert!((hit.distance - 15.0).abs() < 0.01);
    assert!((hit.point_x - 15.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
}

#[test]
fn nearest_body_query_supports_circle_shape_and_mask() {
    let mut world = World::default();
    world.spawn_enemy(4.0, 0.0, 0);
    let circle_entity = spawn_custom_circle(
        &mut world,
        20.0,
        0.0,
        4.0,
        CollisionMask::bit(8).expect("bit index is valid"),
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        100.0,
        CollisionMask::bit(8).expect("bit index is valid"),
    )
    .expect("nearest query should hit custom circle");

    assert_eq!(hit.entity, circle_entity);
    assert!((hit.distance - 16.0).abs() < 0.01);
    assert!((hit.point_x - 16.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
}

#[test]
fn nearest_body_query_supports_capsule_shape() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 0.0, y: 4.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("nearest query should hit capsule");

    assert_eq!(hit.entity, capsule_entity);
    assert!((hit.distance - 3.0).abs() < 0.01);
    assert!((hit.point_x - 0.0).abs() < 0.01);
    assert!((hit.point_y - 1.0).abs() < 0.01);
}

#[test]
fn nearest_body_query_supports_oriented_box_shape() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 0.0, y: 5.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("nearest query should hit oriented box");

    assert_eq!(hit.entity, oriented_entity);
    assert!(hit.distance > 1.0);
    assert!(hit.distance < 5.0);
    assert!(hit.point_y < 5.0);
}

#[test]
fn nearest_body_query_supports_convex_polygon_shape() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 0.0, y: 4.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("nearest query should hit convex polygon");

    assert_eq!(hit.entity, polygon_entity);
    assert!((hit.distance - 3.0).abs() < 0.01);
    assert!((hit.point_x - 0.0).abs() < 0.01);
    assert!((hit.point_y - 1.0).abs() < 0.01);
}

#[test]
fn nearest_body_query_reports_zero_when_point_is_inside_body() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 20.0, y: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("nearest query should hit containing body");

    assert_eq!(hit.entity, enemy);
    assert_eq!(hit.distance, 0.0);
    assert_eq!(hit.point_x, 20.0);
    assert_eq!(hit.point_y, 0.0);
}

#[test]
fn nearest_body_query_rejects_invalid_input_and_max_distance_misses() {
    let mut world = World::default();
    spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    assert!(CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        10.0,
        CollisionMask::ENEMY,
    )
    .is_none());
    assert!(CollisionSystem::nearest_body_query(
        &world,
        Transform2D {
            x: f32::NAN,
            y: 0.0,
        },
        100.0,
        CollisionMask::ENEMY,
    )
    .is_none());
    assert!(CollisionSystem::nearest_body_query(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        -1.0,
        CollisionMask::ENEMY,
    )
    .is_none());
}
