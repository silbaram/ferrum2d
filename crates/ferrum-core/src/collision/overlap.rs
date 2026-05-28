use super::overlap_primitives::{
    aabb_overlaps_circle, capsule_overlaps_aabb, capsule_overlaps_circle, capsules_overlap,
    circle_contains_point, circle_overlaps_aabb, circles_overlap,
};
use super::*;

pub(super) fn collider_contains_point(
    transform: Transform2D,
    shape: ColliderShapeRef,
    point: Transform2D,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            AabbBounds::from_transform(transform, collider).contains_point(point)
        }
        ColliderShapeRef::Circle(collider) => {
            circle_contains_point(collider.center(transform), collider.radius, point)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => oriented_box_contains_point(
            collider.center(transform),
            collider.half_width,
            collider.half_height,
            rotation_radians,
            point,
        ),
        ColliderShapeRef::Capsule(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            point_segment_distance_squared(point, start, end) <= collider.radius * collider.radius
        }
        ColliderShapeRef::Edge(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            point_segment_distance_squared(point, start, end)
                <= EDGE_COLLIDER_RADIUS * EDGE_COLLIDER_RADIUS
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
                .is_some_and(|(vertices, vertex_count)| {
                    convex_polygon_contains_point(&vertices[..vertex_count], point)
                })
        }
    }
}

pub(super) fn collider_overlaps_aabb(
    transform: Transform2D,
    shape: ColliderShapeRef,
    bounds: AabbBounds,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            AabbBounds::from_transform(transform, collider).overlaps(bounds)
        }
        ColliderShapeRef::Circle(collider) => {
            circle_overlaps_aabb(collider.center(transform), collider.radius, bounds)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_box_overlaps_aabb(oriented_box, bounds)
        }
        ColliderShapeRef::Capsule(collider) => capsule_overlaps_aabb(
            collider.start(transform),
            collider.end(transform),
            collider.radius,
            bounds,
        ),
        ColliderShapeRef::Edge(collider) => {
            segment_intersects_aabb(collider.start(transform), collider.end(transform), bounds)
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_aabb(&vertices[..vertex_count], bounds)
        }
    }
}

pub(super) fn collider_overlaps_circle(
    transform: Transform2D,
    shape: ColliderShapeRef,
    center: Transform2D,
    radius: f32,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            aabb_overlaps_circle(transform, collider, center, radius)
        }
        ColliderShapeRef::Circle(collider) => {
            circles_overlap(collider.center(transform), collider.radius, center, radius)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_box_overlaps_circle(oriented_box, center, radius)
        }
        ColliderShapeRef::Capsule(collider) => capsule_overlaps_circle(
            collider.start(transform),
            collider.end(transform),
            collider.radius,
            center,
            radius,
        ),
        ColliderShapeRef::Edge(collider) => {
            let radius_sum = radius + EDGE_COLLIDER_RADIUS;
            point_segment_distance_squared(
                center,
                collider.start(transform),
                collider.end(transform),
            ) <= radius_sum * radius_sum
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_circle(&vertices[..vertex_count], center, radius)
        }
    }
}

fn collider_overlaps_oriented_box(
    transform: Transform2D,
    shape: ColliderShapeRef,
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> bool {
    let Some(query_box) = oriented_box_geometry(center, half_width, half_height, rotation_radians)
    else {
        return false;
    };
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            oriented_box_overlaps_aabb(query_box, AabbBounds::from_transform(transform, collider))
        }
        ColliderShapeRef::Circle(collider) => {
            oriented_box_overlaps_circle(query_box, collider.center(transform), collider.radius)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(collider_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_boxes_overlap(query_box, collider_box)
        }
        ColliderShapeRef::Capsule(collider) => oriented_box_overlaps_capsule(
            query_box,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => oriented_box_overlaps_capsule(
            query_box,
            collider.start(transform),
            collider.end(transform),
            EDGE_COLLIDER_RADIUS,
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_oriented_box(&vertices[..vertex_count], query_box)
        }
    }
}

fn collider_overlaps_capsule(
    transform: Transform2D,
    shape: ColliderShapeRef,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => capsule_overlaps_aabb(
            start,
            end,
            radius,
            AabbBounds::from_transform(transform, collider),
        ),
        ColliderShapeRef::Circle(collider) => capsule_overlaps_circle(
            start,
            end,
            radius,
            collider.center(transform),
            collider.radius,
        ),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_box_overlaps_capsule(oriented_box, start, end, radius)
        }
        ColliderShapeRef::Capsule(collider) => capsules_overlap(
            start,
            end,
            radius,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => capsules_overlap(
            start,
            end,
            radius,
            collider.start(transform),
            collider.end(transform),
            EDGE_COLLIDER_RADIUS,
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_capsule(&vertices[..vertex_count], start, end, radius)
        }
    }
}

fn collider_overlaps_convex_polygon(
    transform: Transform2D,
    shape: ColliderShapeRef,
    vertices: &[Transform2D],
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            convex_polygon_overlaps_aabb(vertices, AabbBounds::from_transform(transform, collider))
        }
        ColliderShapeRef::Circle(collider) => {
            convex_polygon_overlaps_circle(vertices, collider.center(transform), collider.radius)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            convex_polygon_overlaps_oriented_box(vertices, oriented_box)
        }
        ColliderShapeRef::Capsule(collider) => convex_polygon_overlaps_capsule(
            vertices,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => convex_polygon_overlaps_capsule(
            vertices,
            collider.start(transform),
            collider.end(transform),
            EDGE_COLLIDER_RADIUS,
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((collider_vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygons_overlap(vertices, &collider_vertices[..vertex_count])
        }
    }
}

pub(super) fn query_shape_overlaps_collider(
    query_shape: CollisionQueryShape,
    collider_transform: Transform2D,
    collider_shape: ColliderShapeRef,
) -> bool {
    match query_shape {
        CollisionQueryShape::Aabb(bounds) => {
            collider_overlaps_aabb(collider_transform, collider_shape, bounds)
        }
        CollisionQueryShape::Circle { center, radius } => {
            collider_overlaps_circle(collider_transform, collider_shape, center, radius)
        }
        CollisionQueryShape::OrientedBox {
            center,
            half_width,
            half_height,
            rotation_radians,
        } => collider_overlaps_oriented_box(
            collider_transform,
            collider_shape,
            center,
            half_width,
            half_height,
            rotation_radians,
        ),
        CollisionQueryShape::Capsule { start, end, radius } => {
            collider_overlaps_capsule(collider_transform, collider_shape, start, end, radius)
        }
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => {
            let Some(vertices) = convex_polygon_vertices(&vertices, vertex_count) else {
                return false;
            };
            collider_overlaps_convex_polygon(collider_transform, collider_shape, vertices)
        }
    }
}

pub(super) fn shapes_overlap(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
) -> bool {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => shapes_overlap(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
        ),
        (other, ColliderShapeRef::Edge(bc)) => shapes_overlap(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => {
            AabbBounds::from_transform(at, ac).overlaps(AabbBounds::from_transform(bt, bc))
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            aabb_overlaps_circle(at, ac, bc.center(bt), bc.radius)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_overlaps_circle(bt, bc, ac.center(at), ac.radius)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Circle(bc)) => {
            circles_overlap(ac.center(at), ac.radius, bc.center(bt), bc.radius)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_aabb(b_box, AabbBounds::from_transform(at, ac))
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_aabb(a_box, AabbBounds::from_transform(bt, bc))
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_circle(b_box, ac.center(at), ac.radius)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_circle(a_box, bc.center(bt), bc.radius)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_boxes_overlap(a_box, b_box)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => capsule_overlaps_aabb(
            bc.start(bt),
            bc.end(bt),
            bc.radius,
            AabbBounds::from_transform(at, ac),
        ),
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_capsule(a_box, bc.start(bt), bc.end(bt), bc.radius)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_capsule(b_box, ac.start(at), ac.end(at), ac.radius)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => capsule_overlaps_aabb(
            ac.start(at),
            ac.end(at),
            ac.radius,
            AabbBounds::from_transform(bt, bc),
        ),
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(bc)) => capsule_overlaps_circle(
            bc.start(bt),
            bc.end(bt),
            bc.radius,
            ac.center(at),
            ac.radius,
        ),
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => capsule_overlaps_circle(
            ac.start(at),
            ac.end(at),
            ac.radius,
            bc.center(bt),
            bc.radius,
        ),
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => capsules_overlap(
            ac.start(at),
            ac.end(at),
            ac.radius,
            bc.start(bt),
            bc.end(bt),
            bc.radius,
        ),
        (ColliderShapeRef::ConvexPolygon(ac, a_rotation), other) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(at, ac, a_rotation)
            else {
                return false;
            };
            collider_overlaps_convex_polygon(bt, other, &vertices[..vertex_count])
        }
        (other, ColliderShapeRef::ConvexPolygon(bc, b_rotation)) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(bt, bc, b_rotation)
            else {
                return false;
            };
            collider_overlaps_convex_polygon(at, other, &vertices[..vertex_count])
        }
    }
}
