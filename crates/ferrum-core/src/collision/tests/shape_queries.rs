use super::*;

#[test]
fn shape_query_supports_aabb_shape() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(20.0, 20.0, 0);
    world.spawn_bullet(80.0, 80.0, 0.0, 0.0, 0);
    let bounds = AabbBounds::from_center(Transform2D { x: 20.0, y: 20.0 }, 4.0, 4.0)
        .expect("query bounds are valid");

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Aabb(bounds),
        CollisionMask::ENEMY,
    );

    assert_eq!(hits, vec![ShapeQueryHit { entity: enemy }]);
}

#[test]
fn shape_query_supports_circle_shape() {
    let mut world = World::default();
    let circle_entity = spawn_custom_circle(
        &mut world,
        10.0,
        10.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        18.0,
        10.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 10.0, y: 10.0 },
            radius: 6.0,
        },
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![
            ShapeQueryHit {
                entity: circle_entity
            },
            ShapeQueryHit {
                entity: aabb_entity
            }
        ]
    );
}

#[test]
fn shape_query_supports_oriented_box_shape() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        6.0,
        6.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
    let circle_entity = spawn_custom_circle(
        &mut world,
        -6.0,
        -6.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        0.0,
        6.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 0.0 },
            half_width: 10.0,
            half_height: 1.0,
            rotation_radians: core::f32::consts::FRAC_PI_4,
        },
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![
            ShapeQueryHit {
                entity: aabb_entity
            },
            ShapeQueryHit {
                entity: circle_entity
            }
        ]
    );
}

#[test]
fn shape_query_supports_capsule_shape() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        1.4,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
    let circle_entity = spawn_custom_circle(
        &mut world,
        6.0,
        2.2,
        1.3,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        0.0,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: -8.0, y: 0.0 },
            end: Transform2D { x: 8.0, y: 0.0 },
            radius: 1.0,
        },
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![
            ShapeQueryHit {
                entity: aabb_entity
            },
            ShapeQueryHit {
                entity: circle_entity
            }
        ]
    );
}

#[test]
fn shape_query_supports_convex_polygon_shape() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
    let circle_entity = spawn_custom_circle(
        &mut world,
        4.0,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        0.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let hits = CollisionSystem::shape_query(
        &world,
        convex_polygon(&[(-2.0, -1.0), (5.0, -1.0), (5.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![
            ShapeQueryHit {
                entity: aabb_entity
            },
            ShapeQueryHit {
                entity: circle_entity
            }
        ]
    );
}

#[test]
fn shape_query_supports_convex_polygon_against_stored_oriented_box_and_capsule() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        6.0,
        0.0,
        oriented_box(1.0, 1.0, core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        -5.0,
        0.0,
        capsule(-1.0, 0.0, 1.0, 0.0, 0.5),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        0.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let hits = CollisionSystem::shape_query(
        &world,
        convex_polygon(&[(-7.0, -1.0), (7.0, -1.0), (7.0, 1.0), (-7.0, 1.0)]),
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![
            ShapeQueryHit {
                entity: oriented_entity
            },
            ShapeQueryHit {
                entity: capsule_entity
            }
        ]
    );
}

#[test]
fn shape_query_supports_stored_convex_polygon_colliders() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        4.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let rotated_polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        -4.0,
        0.0,
        convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)])
            .with_rotation(core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_convex_polygon(
        &mut world,
        0.0,
        8.0,
        convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let circle_hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 6.0, y: 0.0 },
            radius: 0.5,
        },
        CollisionMask::ENEMY,
    );
    let aabb_hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Aabb(
            AabbBounds::from_center(Transform2D { x: -4.0, y: 1.8 }, 0.5, 0.5)
                .expect("query bounds are valid"),
        ),
        CollisionMask::ENEMY,
    );

    assert_eq!(
        circle_hits,
        vec![ShapeQueryHit {
            entity: polygon_entity
        }]
    );
    assert_eq!(
        aabb_hits,
        vec![ShapeQueryHit {
            entity: rotated_polygon_entity
        }]
    );
}

#[test]
fn shape_query_supports_oriented_box_against_stored_capsule() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 0.0, y: 1.2 },
            half_width: 4.0,
            half_height: 0.25,
            rotation_radians: 0.0,
        },
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![ShapeQueryHit {
            entity: capsule_entity
        }]
    );
}

#[test]
fn shape_query_supports_stored_oriented_box_colliders() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(5.0, 1.0, core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let oriented_hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 4.0, y: 4.0 },
            half_width: 1.0,
            half_height: 1.0,
            rotation_radians: core::f32::consts::FRAC_PI_4,
        },
        CollisionMask::ENEMY,
    );
    let capsule_hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: -4.0, y: -4.0 },
            end: Transform2D { x: -2.0, y: -2.0 },
            radius: 0.75,
        },
        CollisionMask::ENEMY,
    );

    assert_eq!(
        oriented_hits,
        vec![ShapeQueryHit {
            entity: oriented_entity
        }]
    );
    assert_eq!(
        capsule_hits,
        vec![ShapeQueryHit {
            entity: oriented_entity
        }]
    );
}

#[test]
fn shape_query_supports_capsule_against_stored_capsule() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 6.0, y: -2.0 },
            end: Transform2D { x: 6.0, y: 2.0 },
            radius: 0.5,
        },
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![ShapeQueryHit {
            entity: capsule_entity
        }]
    );
}

#[test]
fn shape_query_supports_zero_length_capsule_as_circle() {
    let mut world = World::default();
    let hit = spawn_custom_circle(
        &mut world,
        3.0,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        5.2,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: 0.0 },
            end: Transform2D { x: 0.0, y: 0.0 },
            radius: 2.1,
        },
        CollisionMask::ENEMY,
    );

    assert_eq!(hits, vec![ShapeQueryHit { entity: hit }]);
}

#[test]
fn shape_query_rejects_invalid_circle_shape() {
    let mut world = World::default();
    world.spawn_enemy(10.0, 10.0, 0);

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: 10.0, y: 10.0 },
            radius: 0.0,
        },
        CollisionMask::ENEMY,
    );

    assert!(hits.is_empty());
}

#[test]
fn shape_query_rejects_invalid_oriented_box_shape() {
    let mut world = World::default();
    world.spawn_enemy(10.0, 10.0, 0);

    let hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 10.0, y: 10.0 },
            half_width: 0.0,
            half_height: 2.0,
            rotation_radians: 0.0,
        },
        CollisionMask::ENEMY,
    );
    let nan_rotation_hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::OrientedBox {
            center: Transform2D { x: 10.0, y: 10.0 },
            half_width: 2.0,
            half_height: 2.0,
            rotation_radians: f32::NAN,
        },
        CollisionMask::ENEMY,
    );

    assert!(hits.is_empty());
    assert!(nan_rotation_hits.is_empty());
}

#[test]
fn shape_query_rejects_invalid_capsule_shape() {
    let mut world = World::default();
    world.spawn_enemy(10.0, 10.0, 0);

    let zero_radius_hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D { x: 0.0, y: 0.0 },
            end: Transform2D { x: 10.0, y: 0.0 },
            radius: 0.0,
        },
        CollisionMask::ENEMY,
    );
    let nan_endpoint_hits = CollisionSystem::shape_query(
        &world,
        CollisionQueryShape::Capsule {
            start: Transform2D {
                x: f32::NAN,
                y: 0.0,
            },
            end: Transform2D { x: 10.0, y: 0.0 },
            radius: 1.0,
        },
        CollisionMask::ENEMY,
    );

    assert!(zero_radius_hits.is_empty());
    assert!(nan_endpoint_hits.is_empty());
}

#[test]
fn shape_query_rejects_invalid_convex_polygon_shape() {
    let mut world = World::default();
    world.spawn_enemy(0.0, 0.0, 0);

    let too_few_vertices = CollisionSystem::shape_query(
        &world,
        convex_polygon(&[(0.0, 0.0), (1.0, 0.0)]),
        CollisionMask::ENEMY,
    );
    let concave_vertices = CollisionSystem::shape_query(
        &world,
        convex_polygon(&[(0.0, 0.0), (2.0, 0.0), (1.0, 0.5), (2.0, 2.0), (0.0, 2.0)]),
        CollisionMask::ENEMY,
    );
    let non_finite_vertex = CollisionSystem::shape_query(
        &world,
        convex_polygon(&[(0.0, 0.0), (1.0, 0.0), (f32::NAN, 1.0)]),
        CollisionMask::ENEMY,
    );

    assert!(too_few_vertices.is_empty());
    assert!(concave_vertices.is_empty());
    assert!(non_finite_vertex.is_empty());
}
