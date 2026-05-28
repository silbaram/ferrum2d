use super::*;

#[test]
fn shape_cast_returns_nearest_aabb_hit() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
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
    let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
        .expect("shape cast bounds are valid");

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Aabb(bounds),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("shape cast should hit nearest enemy");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 13.0).abs() < 0.01);
    assert!((hit.point_x - 13.0).abs() < 0.01);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_returns_lower_entity_id_for_equal_distance_hits() {
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
    let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
        .expect("shape cast bounds are valid");

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Aabb(bounds),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("shape cast should hit one of the tied enemies");

    assert!(first.id < second.id);
    assert_eq!(hit.entity, first);
    assert!((hit.distance - 13.0).abs() < 0.01);
}

#[test]
fn shape_cast_supports_circle_shape_against_aabb() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 3.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("circle shape cast should hit aabb enemy");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 12.0).abs() < 0.01);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_aabb_shape_against_circle() {
    let mut world = World::default();
    let enemy = spawn_custom_circle(
        &mut world,
        20.0,
        0.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 5.0, 5.0)
        .expect("shape cast bounds are valid");

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Aabb(bounds),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("aabb shape cast should hit circle enemy");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 11.0).abs() < 0.01);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_oriented_box_shape_against_aabb() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let axis = std::f32::consts::FRAC_1_SQRT_2;
    let expected_distance = 15.0 - (4.0 * axis + 2.0 * axis);

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 0.0 },
            half_width: 4.0,
            half_height: 2.0,
            rotation_radians: std::f32::consts::FRAC_PI_4,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("oriented box shape cast should hit aabb enemy");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - expected_distance).abs() < 0.01);
    assert!((hit.point_x - expected_distance).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_oriented_box_shape_against_circle() {
    let mut world = World::default();
    let axis = std::f32::consts::FRAC_1_SQRT_2;
    let enemy = spawn_custom_circle(
        &mut world,
        20.0 * axis,
        20.0 * axis,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 0.0 },
            half_width: 4.0,
            half_height: 2.0,
            rotation_radians: std::f32::consts::FRAC_PI_4,
        },
        Velocity { vx: axis, vy: axis },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("oriented box shape cast should hit circle enemy");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 13.0).abs() < 0.01);
    assert!((hit.point_x - 13.0 * axis).abs() < 0.01);
    assert!((hit.point_y - 13.0 * axis).abs() < 0.01);
    assert!((hit.normal_x + axis).abs() < 0.01);
    assert!((hit.normal_y + axis).abs() < 0.01);
}

#[test]
fn shape_cast_supports_aabb_shape_against_stored_oriented_box() {
    let mut world = World::default();
    let enemy = spawn_custom_oriented_box(
        &mut world,
        20.0,
        0.0,
        oriented_box(5.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
        .expect("shape cast bounds are valid");

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Aabb(bounds),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("aabb shape cast should hit stored oriented box");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 13.0).abs() < 0.01);
    assert!((hit.point_x - 13.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_circle_shape_against_stored_oriented_box() {
    let mut world = World::default();
    let axis = std::f32::consts::FRAC_1_SQRT_2;
    let enemy = spawn_custom_oriented_box(
        &mut world,
        20.0,
        0.0,
        oriented_box(4.0, 2.0, std::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("circle shape cast should hit stored oriented box");

    assert_eq!(hit.entity, enemy);
    assert!(hit.distance > 15.0 && hit.distance < 16.0);
    assert!((hit.point_x - hit.distance).abs() < 0.01);
    assert!((hit.normal_x + axis).abs() < 0.01);
    assert!((hit.normal_y - axis).abs() < 0.01);
}

#[test]
fn shape_cast_supports_oriented_box_shape_against_stored_oriented_box() {
    let mut world = World::default();
    let enemy = spawn_custom_oriented_box(
        &mut world,
        20.0,
        0.0,
        oriented_box(5.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let axis = std::f32::consts::FRAC_1_SQRT_2;
    let expected_distance = 15.0 - (4.0 * axis + 2.0 * axis);

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 0.0 },
            half_width: 4.0,
            half_height: 2.0,
            rotation_radians: std::f32::consts::FRAC_PI_4,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("oriented box shape cast should hit stored oriented box");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - expected_distance).abs() < 0.01);
    assert!((hit.point_x - expected_distance).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_capsule_shape_against_stored_oriented_box() {
    let mut world = World::default();
    let enemy = spawn_custom_oriented_box(
        &mut world,
        20.0,
        0.0,
        oriented_box(5.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: -2.0 },
            end: Transform2D { x: 0.0, y: 2.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("capsule shape cast should hit stored oriented box");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 14.0).abs() < 0.01);
    assert!((hit.point_x - 14.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_capsule_shape_against_aabb() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: -2.0 },
            end: Transform2D { x: 0.0, y: 2.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("capsule shape cast should hit aabb enemy");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 14.0).abs() < 0.01);
    assert!((hit.point_x - 14.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_capsule_shape_against_circle() {
    let mut world = World::default();
    let enemy = spawn_custom_circle(
        &mut world,
        20.0,
        0.0,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: -2.0 },
            end: Transform2D { x: 0.0, y: 2.0 },
            radius: 2.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("capsule shape cast should hit circle enemy");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 15.0).abs() < 0.01);
    assert!((hit.point_x - 15.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_aabb_shape_against_stored_capsule() {
    let mut world = World::default();
    let enemy = spawn_custom_capsule(
        &mut world,
        20.0,
        0.0,
        capsule(0.0, -3.0, 0.0, 3.0, 2.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 1.0, 1.0)
        .expect("shape cast bounds are valid");

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Aabb(bounds),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("aabb shape cast should hit stored capsule");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 17.0).abs() < 0.01);
    assert!((hit.point_x - 17.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert!(hit.normal_y.abs() < 0.01);
}

#[test]
fn shape_cast_supports_circle_shape_against_stored_capsule() {
    let mut world = World::default();
    let enemy = spawn_custom_capsule(
        &mut world,
        20.0,
        0.0,
        capsule(0.0, -3.0, 0.0, 3.0, 2.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("circle shape cast should hit stored capsule");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 17.0).abs() < 0.01);
    assert!((hit.point_x - 17.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_circle_shape_against_stored_edge() {
    let mut world = World::default();
    let enemy = spawn_custom_edge(
        &mut world,
        20.0,
        0.0,
        edge(0.0, -3.0, 0.0, 3.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("circle shape cast should hit stored edge");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 19.0).abs() < 0.01);
    assert!((hit.point_x - 19.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_oriented_box_shape_against_stored_capsule() {
    let mut world = World::default();
    let enemy = spawn_custom_capsule(
        &mut world,
        20.0,
        0.0,
        capsule(0.0, -3.0, 0.0, 3.0, 2.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let axis = std::f32::consts::FRAC_1_SQRT_2;
    let expected_distance = 18.0 - (axis + 2.0 * axis);

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 0.0 },
            half_width: 1.0,
            half_height: 2.0,
            rotation_radians: std::f32::consts::FRAC_PI_4,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("oriented box shape cast should hit stored capsule");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - expected_distance).abs() < 0.01);
    assert!((hit.point_x - expected_distance).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_capsule_shape_against_stored_capsule() {
    let mut world = World::default();
    let enemy = spawn_custom_capsule(
        &mut world,
        20.0,
        0.0,
        capsule(0.0, -3.0, 0.0, 3.0, 2.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: -2.0 },
            end: Transform2D { x: 0.0, y: 2.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("capsule shape cast should hit stored capsule");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 17.0).abs() < 0.01);
    assert!((hit.point_x - 17.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_capsule_shape_against_stored_edge() {
    let mut world = World::default();
    let enemy = spawn_custom_edge(
        &mut world,
        20.0,
        0.0,
        edge(0.0, -3.0, 0.0, 3.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: -2.0 },
            end: Transform2D { x: 0.0, y: 2.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("capsule shape cast should hit stored edge");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 19.0).abs() < 0.01);
    assert!((hit.point_x - 19.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_aabb_shape_against_stored_convex_polygon() {
    let mut world = World::default();
    let enemy = spawn_custom_convex_polygon(
        &mut world,
        20.0,
        0.0,
        convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
        .expect("shape cast bounds are valid");

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Aabb(bounds),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("aabb shape cast should hit stored convex polygon");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 13.0).abs() < 0.01);
    assert!((hit.point_x - 13.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_circle_shape_against_stored_convex_polygon() {
    let mut world = World::default();
    let enemy = spawn_custom_convex_polygon(
        &mut world,
        20.0,
        0.0,
        convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("circle shape cast should hit stored convex polygon");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 14.0).abs() < 0.01);
    assert!((hit.point_x - 14.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_oriented_box_shape_against_stored_convex_polygon() {
    let mut world = World::default();
    let enemy = spawn_custom_convex_polygon(
        &mut world,
        20.0,
        0.0,
        convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let axis = std::f32::consts::FRAC_1_SQRT_2;
    let expected_distance = 15.0 - (4.0 * axis + 2.0 * axis);

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 0.0 },
            half_width: 4.0,
            half_height: 2.0,
            rotation_radians: std::f32::consts::FRAC_PI_4,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("oriented box shape cast should hit stored convex polygon");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - expected_distance).abs() < 0.01);
    assert!((hit.point_x - expected_distance).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_capsule_shape_against_stored_convex_polygon() {
    let mut world = World::default();
    let enemy = spawn_custom_convex_polygon(
        &mut world,
        20.0,
        0.0,
        convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: -2.0 },
            end: Transform2D { x: 0.0, y: 2.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("capsule shape cast should hit stored convex polygon");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 14.0).abs() < 0.01);
    assert!((hit.point_x - 14.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_convex_polygon_shape_against_stored_convex_polygon() {
    let mut world = World::default();
    let enemy = spawn_custom_convex_polygon(
        &mut world,
        20.0,
        0.0,
        convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("convex polygon shape cast should hit stored convex polygon");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 13.0).abs() < 0.01);
    assert!((hit.point_x - 13.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_convex_polygon_shape_against_aabb() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("convex polygon shape cast should hit aabb");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 13.0).abs() < 0.01);
    assert!((hit.point_x - 13.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_convex_polygon_shape_against_circle() {
    let mut world = World::default();
    let enemy = spawn_custom_circle(
        &mut world,
        20.0,
        0.0,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("convex polygon shape cast should hit circle");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 15.0).abs() < 0.01);
    assert!((hit.point_x - 15.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_convex_polygon_shape_against_stored_oriented_box() {
    let mut world = World::default();
    let enemy = spawn_custom_oriented_box(
        &mut world,
        20.0,
        0.0,
        oriented_box(5.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("convex polygon shape cast should hit stored oriented box");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 13.0).abs() < 0.01);
    assert!((hit.point_x - 13.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_convex_polygon_shape_against_stored_capsule() {
    let mut world = World::default();
    let enemy = spawn_custom_capsule(
        &mut world,
        20.0,
        0.0,
        capsule(0.0, -3.0, 0.0, 3.0, 2.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("convex polygon shape cast should hit stored capsule");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 16.0).abs() < 0.01);
    assert!((hit.point_x - 16.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_supports_zero_length_capsule_as_circle() {
    let mut world = World::default();
    let enemy = spawn_custom_body(
        &mut world,
        10.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hit = CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: 0.0 },
            end: Transform2D { x: 0.0, y: 0.0 },
            radius: 2.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .expect("zero-length capsule shape cast should hit like a circle");

    assert_eq!(hit.entity, enemy);
    assert!((hit.distance - 3.0).abs() < 0.01);
    assert!((hit.point_x - 3.0).abs() < 0.01);
    assert_eq!(hit.point_y, 0.0);
    assert_eq!(hit.normal_x, -1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn shape_cast_all_sorts_hits_by_distance() {
    let mut world = World::default();
    let far = spawn_custom_body(
        &mut world,
        40.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let near = spawn_custom_circle(
        &mut world,
        20.0,
        0.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::shape_cast_all(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 2.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    );

    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].entity, near);
    assert_eq!(hits[1].entity, far);
    assert!(hits[0].distance < hits[1].distance);
}

#[test]
fn shape_cast_rejects_invalid_input() {
    let mut world = World::default();
    world.spawn_enemy(10.0, 0.0, 0);

    assert!(CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 0.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .is_none());
    assert!(CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 0.0, y: 0.0 },
            radius: 2.0,
        },
        Velocity { vx: 0.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .is_none());
    assert!(CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D {
                x: f32::NAN,
                y: 0.0,
            },
            end: Transform2D { x: 2.0, y: 0.0 },
            radius: 1.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .is_none());
    assert!(CollisionSystem::shape_cast(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 0.0 },
            half_width: 0.0,
            half_height: 2.0,
            rotation_radians: 0.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        100.0,
        CollisionMask::ENEMY,
    )
    .is_none());
}
