use super::*;

pub(super) fn is_valid_delta(delta: f32) -> bool {
    delta.is_finite() && delta > 0.0
}

pub(super) fn query_shape_is_valid(shape: CollisionQueryShape) -> bool {
    match shape {
        CollisionQueryShape::Aabb(bounds) => {
            bounds.min_x.is_finite()
                && bounds.min_y.is_finite()
                && bounds.max_x.is_finite()
                && bounds.max_y.is_finite()
                && bounds.min_x <= bounds.max_x
                && bounds.min_y <= bounds.max_y
        }
        CollisionQueryShape::Circle { center, radius } => {
            center.x.is_finite() && center.y.is_finite() && is_valid_radius(radius)
        }
        CollisionQueryShape::OrientedBox {
            center,
            half_width,
            half_height,
            rotation_radians,
        } => {
            center.x.is_finite()
                && center.y.is_finite()
                && is_valid_half_extent(half_width)
                && is_valid_half_extent(half_height)
                && rotation_radians.is_finite()
        }
        CollisionQueryShape::Capsule { start, end, radius } => {
            start.x.is_finite()
                && start.y.is_finite()
                && end.x.is_finite()
                && end.y.is_finite()
                && is_valid_radius(radius)
        }
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => convex_polygon_vertices(&vertices, vertex_count)
            .map(convex_polygon_is_valid)
            .unwrap_or(false),
    }
}

pub(super) fn is_valid_radius(radius: f32) -> bool {
    radius.is_finite() && radius > 0.0
}

pub(super) fn capsule_collider_is_valid(collider: CapsuleCollider) -> bool {
    collider.start_x.is_finite()
        && collider.start_y.is_finite()
        && collider.end_x.is_finite()
        && collider.end_y.is_finite()
        && collider.offset_x.is_finite()
        && collider.offset_y.is_finite()
        && is_valid_radius(collider.radius)
}

pub(super) fn edge_collider_is_valid(collider: EdgeCollider) -> bool {
    if !collider.start_x.is_finite()
        || !collider.start_y.is_finite()
        || !collider.end_x.is_finite()
        || !collider.end_y.is_finite()
        || !collider.offset_x.is_finite()
        || !collider.offset_y.is_finite()
    {
        return false;
    }

    let dx = collider.end_x - collider.start_x;
    let dy = collider.end_y - collider.start_y;
    dx * dx + dy * dy > RAY_EPSILON * RAY_EPSILON
}

pub(super) fn convex_polygon_collider_is_valid(collider: ConvexPolygonCollider) -> bool {
    collider.offset_x.is_finite()
        && collider.offset_y.is_finite()
        && collider.rotation_radians.is_finite()
        && convex_polygon_vertices(&collider.vertices, collider.vertex_count)
            .map(convex_polygon_is_valid)
            .unwrap_or(false)
}

pub(super) fn is_valid_half_extent(half_extent: f32) -> bool {
    half_extent.is_finite() && half_extent > 0.0
}
