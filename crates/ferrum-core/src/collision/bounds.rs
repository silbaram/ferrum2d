use super::*;

pub(crate) fn collider_bounds(transform: Transform2D, shape: ColliderShapeRef) -> AabbBounds {
    match shape {
        ColliderShapeRef::Aabb(collider) => AabbBounds::from_transform(transform, collider),
        ColliderShapeRef::Circle(collider) => AabbBounds::from_circle(transform, collider),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => oriented_box_bounds(
            collider.center(transform),
            collider.half_width,
            collider.half_height,
            rotation_radians,
        ),
        ColliderShapeRef::Capsule(collider) => capsule_bounds(
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => {
            edge_bounds(collider.start(transform), collider.end(transform))
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return AabbBounds {
                    min_x: transform.x,
                    min_y: transform.y,
                    max_x: transform.x,
                    max_y: transform.y,
                };
            };
            convex_polygon_bounds(&vertices[..vertex_count])
        }
    }
}

fn query_shape_bounds(shape: CollisionQueryShape) -> AabbBounds {
    match shape {
        CollisionQueryShape::Aabb(bounds) => bounds,
        CollisionQueryShape::Circle { center, radius } => AabbBounds {
            min_x: center.x - radius,
            min_y: center.y - radius,
            max_x: center.x + radius,
            max_y: center.y + radius,
        },
        CollisionQueryShape::OrientedBox {
            center,
            half_width,
            half_height,
            rotation_radians,
        } => oriented_box_bounds(center, half_width, half_height, rotation_radians),
        CollisionQueryShape::Capsule { start, end, radius } => AabbBounds {
            min_x: start.x.min(end.x) - radius,
            min_y: start.y.min(end.y) - radius,
            max_x: start.x.max(end.x) + radius,
            max_y: start.y.max(end.y) + radius,
        },
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => convex_polygon_vertices(&vertices, vertex_count)
            .map(convex_polygon_bounds)
            .unwrap_or(AabbBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 0.0,
                max_y: 0.0,
            }),
    }
}

pub(super) fn query_shape_sweep_bounds(shape: CollisionQueryShape, dx: f32, dy: f32) -> AabbBounds {
    let bounds = query_shape_bounds(shape);
    AabbBounds {
        min_x: bounds.min_x.min(bounds.min_x + dx),
        min_y: bounds.min_y.min(bounds.min_y + dy),
        max_x: bounds.max_x.max(bounds.max_x + dx),
        max_y: bounds.max_y.max(bounds.max_y + dy),
    }
}

pub(super) fn query_aabb_half_extents(bounds: AabbBounds) -> (f32, f32) {
    (
        (bounds.max_x - bounds.min_x) * 0.5,
        (bounds.max_y - bounds.min_y) * 0.5,
    )
}

fn convex_polygon_bounds(vertices: &[Transform2D]) -> AabbBounds {
    let mut bounds = AabbBounds {
        min_x: vertices[0].x,
        min_y: vertices[0].y,
        max_x: vertices[0].x,
        max_y: vertices[0].y,
    };
    for vertex in &vertices[1..] {
        bounds.min_x = bounds.min_x.min(vertex.x);
        bounds.min_y = bounds.min_y.min(vertex.y);
        bounds.max_x = bounds.max_x.max(vertex.x);
        bounds.max_y = bounds.max_y.max(vertex.y);
    }
    bounds
}

pub(super) fn aabb_bounds_vertices(bounds: AabbBounds) -> [Transform2D; 4] {
    [
        Transform2D {
            x: bounds.min_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.max_y,
        },
        Transform2D {
            x: bounds.min_x,
            y: bounds.max_y,
        },
    ]
}

fn capsule_bounds(start: Transform2D, end: Transform2D, radius: f32) -> AabbBounds {
    AabbBounds {
        min_x: start.x.min(end.x) - radius,
        min_y: start.y.min(end.y) - radius,
        max_x: start.x.max(end.x) + radius,
        max_y: start.y.max(end.y) + radius,
    }
}

fn edge_bounds(start: Transform2D, end: Transform2D) -> AabbBounds {
    capsule_bounds(start, end, EDGE_COLLIDER_RADIUS)
}

pub(super) fn aabb_corners(bounds: AabbBounds) -> [Transform2D; 4] {
    [
        Transform2D {
            x: bounds.min_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.max_y,
        },
        Transform2D {
            x: bounds.min_x,
            y: bounds.max_y,
        },
    ]
}

fn oriented_box_bounds(
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> AabbBounds {
    let Some(oriented_box) =
        oriented_box_geometry(center, half_width, half_height, rotation_radians)
    else {
        return AabbBounds {
            min_x: center.x,
            min_y: center.y,
            max_x: center.x,
            max_y: center.y,
        };
    };
    let extent_x =
        oriented_box.axis_x_x.abs() * half_width + oriented_box.axis_y_x.abs() * half_height;
    let extent_y =
        oriented_box.axis_x_y.abs() * half_width + oriented_box.axis_y_y.abs() * half_height;
    AabbBounds {
        min_x: center.x - extent_x,
        min_y: center.y - extent_y,
        max_x: center.x + extent_x,
        max_y: center.y + extent_y,
    }
}

pub(super) fn capsule_side_bounds(length: f32, radius: f32) -> AabbBounds {
    AabbBounds {
        min_x: 0.0,
        min_y: -radius,
        max_x: length,
        max_y: radius,
    }
}

pub(super) fn inflate_bounds(bounds: AabbBounds, x: f32, y: f32) -> AabbBounds {
    AabbBounds {
        min_x: bounds.min_x - x,
        min_y: bounds.min_y - y,
        max_x: bounds.max_x + x,
        max_y: bounds.max_y + y,
    }
}
