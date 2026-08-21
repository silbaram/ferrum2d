use super::*;
use crate::components::Rotation2D;

const EPSILON: f32 = 0.00001;
const BODY_TRANSFORM: Transform2D = Transform2D { x: 10.0, y: 20.0 };
const BODY_ROTATION: f32 = core::f32::consts::FRAC_PI_2;

#[test]
fn canonical_body_local_world_transform_matches_public_typescript_vectors() {
    let geometry = oriented_box_geometry(BODY_TRANSFORM, 1.0, 1.0, BODY_ROTATION)
        .expect("canonical transform is finite");
    let world = oriented_box_world_point(geometry, Transform2D { x: 2.0, y: -3.0 });
    assert_point(world, 13.0, 22.0);
    assert_point(oriented_box_local_point(geometry, world), 2.0, -3.0);
}

#[test]
fn canonical_collider_reference_points_match_public_typescript_vectors() {
    let aabb = collider(4.0, 6.0).with_offset(3.0, -2.0);
    let bounds = AabbBounds::from_transform(BODY_TRANSFORM, aabb);
    assert_points(
        &aabb_corners(bounds),
        &[(9.0, 12.0), (17.0, 12.0), (17.0, 24.0), (9.0, 24.0)],
    );
    assert_point(aabb.center(BODY_TRANSFORM), 13.0, 18.0);

    let circle = circle(5.0).with_offset(3.0, -2.0);
    assert_point(circle.center(BODY_TRANSFORM), 13.0, 18.0);

    let capsule = capsule(-4.0, 0.0, 4.0, 0.0, 2.0).with_offset(3.0, -2.0);
    assert_point(capsule.start(BODY_TRANSFORM), 9.0, 18.0);
    assert_point(capsule.end(BODY_TRANSFORM), 17.0, 18.0);
    assert_point(capsule.center(BODY_TRANSFORM), 13.0, 18.0);

    let mut oriented_world = World::default();
    let oriented_entity = oriented_world.spawn_entity();
    oriented_world.set_transform(oriented_entity, BODY_TRANSFORM);
    oriented_world.set_rotation(
        oriented_entity,
        Rotation2D {
            radians: BODY_ROTATION,
        },
    );
    oriented_world.set_oriented_box_collider(
        oriented_entity,
        oriented_box(4.0, 6.0, BODY_ROTATION).with_offset(3.0, -2.0),
    );
    let ColliderShapeRef::OrientedBox(oriented_collider, total_rotation) =
        collider_shape(&oriented_world, oriented_entity.id as usize)
            .expect("canonical oriented box is valid")
    else {
        panic!("canonical collider must remain an oriented box");
    };
    let oriented_geometry = oriented_box_geometry(
        oriented_collider.center(BODY_TRANSFORM),
        oriented_collider.half_width,
        oriented_collider.half_height,
        total_rotation,
    )
    .expect("canonical oriented box geometry is finite");
    assert_points(
        &oriented_box_vertices(oriented_geometry),
        &[(17.0, 24.0), (9.0, 24.0), (9.0, 12.0), (17.0, 12.0)],
    );
    assert_point(oriented_collider.center(BODY_TRANSFORM), 13.0, 18.0);

    let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    vertices[0] = Transform2D { x: -2.0, y: -1.0 };
    vertices[1] = Transform2D { x: 3.0, y: -1.0 };
    vertices[2] = Transform2D { x: 0.0, y: 4.0 };
    let polygon = ConvexPolygonCollider::new(vertices, 3, false, CollisionLayer::Enemy)
        .with_offset(3.0, -2.0)
        .with_rotation(BODY_ROTATION);
    let mut polygon_world = World::default();
    let polygon_entity = polygon_world.spawn_entity();
    polygon_world.set_transform(polygon_entity, BODY_TRANSFORM);
    polygon_world.set_rotation(
        polygon_entity,
        Rotation2D {
            radians: BODY_ROTATION,
        },
    );
    polygon_world.set_convex_polygon_collider(polygon_entity, polygon);
    let ColliderShapeRef::ConvexPolygon(polygon_collider, total_rotation) =
        collider_shape(&polygon_world, polygon_entity.id as usize)
            .expect("canonical convex polygon is valid")
    else {
        panic!("canonical collider must remain a convex polygon");
    };
    let (world_vertices, vertex_count) =
        convex_polygon_collider_vertices_slice(BODY_TRANSFORM, polygon_collider, total_rotation)
            .expect("canonical convex polygon geometry is finite");
    assert_points(
        &world_vertices[..vertex_count],
        &[(15.0, 19.0), (10.0, 19.0), (13.0, 14.0)],
    );
    assert_point(
        convex_polygon_collider_centroid(BODY_TRANSFORM, polygon_collider, total_rotation)
            .expect("canonical convex polygon centroid is finite"),
        12.0 + 2.0 / 3.0,
        17.0 + 1.0 / 3.0,
    );
}

#[test]
fn non_finite_body_rotation_falls_back_to_zero_for_collider_geometry() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_transform(entity, BODY_TRANSFORM);
    world.set_rotation(entity, Rotation2D { radians: f32::NAN });
    world.set_oriented_box_collider(entity, oriented_box(4.0, 6.0, 0.0).with_offset(3.0, -2.0));

    let ColliderShapeRef::OrientedBox(collider, total_rotation) =
        collider_shape(&world, entity.id as usize).expect("canonical oriented box is valid")
    else {
        panic!("canonical collider must remain an oriented box");
    };
    assert_eq!(total_rotation, 0.0);
    let geometry = oriented_box_geometry(
        collider.center(BODY_TRANSFORM),
        collider.half_width,
        collider.half_height,
        total_rotation,
    )
    .expect("fallback oriented box geometry is finite");
    assert_points(
        &oriented_box_vertices(geometry),
        &[(9.0, 12.0), (17.0, 12.0), (17.0, 24.0), (9.0, 24.0)],
    );

    let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    vertices[0] = Transform2D { x: -2.0, y: -1.0 };
    vertices[1] = Transform2D { x: 3.0, y: -1.0 };
    vertices[2] = Transform2D { x: 0.0, y: 4.0 };
    let polygon = ConvexPolygonCollider::new(vertices, 3, false, CollisionLayer::Enemy)
        .with_offset(3.0, -2.0)
        .with_rotation(0.0);
    let polygon_entity = world.spawn_entity();
    world.set_transform(polygon_entity, BODY_TRANSFORM);
    world.set_rotation(polygon_entity, Rotation2D { radians: f32::NAN });
    world.set_convex_polygon_collider(polygon_entity, polygon);

    let ColliderShapeRef::ConvexPolygon(polygon_collider, total_rotation) =
        collider_shape(&world, polygon_entity.id as usize)
            .expect("canonical convex polygon is valid")
    else {
        panic!("canonical collider must remain a convex polygon");
    };
    assert_eq!(total_rotation, 0.0);
    let (world_vertices, vertex_count) =
        convex_polygon_collider_vertices_slice(BODY_TRANSFORM, polygon_collider, total_rotation)
            .expect("fallback convex polygon geometry is finite");
    assert_points(
        &world_vertices[..vertex_count],
        &[(11.0, 17.0), (16.0, 17.0), (13.0, 22.0)],
    );
}

fn assert_points(actual: &[Transform2D], expected: &[(f32, f32)]) {
    assert_eq!(actual.len(), expected.len());
    for (point, (x, y)) in actual.iter().zip(expected.iter().copied()) {
        assert_point(*point, x, y);
    }
}

fn assert_point(actual: Transform2D, expected_x: f32, expected_y: f32) {
    assert!(
        (actual.x - expected_x).abs() <= EPSILON,
        "expected x={expected_x}, received {}",
        actual.x
    );
    assert!(
        (actual.y - expected_y).abs() <= EPSILON,
        "expected y={expected_y}, received {}",
        actual.y
    );
}
