use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) enum ConvexContactGeometry {
    Polygon {
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: usize,
        center: Transform2D,
    },
    Circle {
        center: Transform2D,
        radius: f32,
    },
    Capsule {
        start: Transform2D,
        end: Transform2D,
        radius: f32,
        center: Transform2D,
    },
}

pub(super) fn convex_shape_contact_from_shapes(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
) -> Option<AabbContact> {
    let a = convex_contact_geometry_from_shape(at, ac)?;
    let b = convex_contact_geometry_from_shape(bt, bc)?;
    convex_shape_contact(a, b)
}

pub(super) fn convex_contact_geometry_from_shape(
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Option<ConvexContactGeometry> {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            if !collider.enabled {
                return None;
            }
            convex_contact_polygon_from_slice(&aabb_bounds_vertices(AabbBounds::from_transform(
                transform, collider,
            )))
        }
        ColliderShapeRef::Circle(collider) => {
            if !collider.enabled || !is_valid_radius(collider.radius) {
                return None;
            }
            Some(ConvexContactGeometry::Circle {
                center: collider.center(transform),
                radius: collider.radius,
            })
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let oriented_box = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            )?;
            convex_contact_polygon_from_slice(&oriented_box_vertices(oriented_box))
        }
        ColliderShapeRef::Capsule(collider) => {
            if !collider.enabled || !capsule_collider_is_valid(collider) {
                return None;
            }
            Some(ConvexContactGeometry::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: collider.radius,
                center: collider.center(transform),
            })
        }
        ColliderShapeRef::Edge(collider) => {
            if !collider.enabled || !edge_collider_is_valid(collider) {
                return None;
            }
            Some(ConvexContactGeometry::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: EDGE_COLLIDER_RADIUS,
                center: collider.center(transform),
            })
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)?;
            Some(ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                center: convex_polygon_centroid(&vertices[..vertex_count]),
            })
        }
    }
}

fn convex_contact_polygon_from_slice(vertices: &[Transform2D]) -> Option<ConvexContactGeometry> {
    if !convex_polygon_is_valid(vertices) {
        return None;
    }

    let mut copied = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, vertex) in vertices.iter().copied().enumerate() {
        copied[index] = vertex;
    }
    Some(ConvexContactGeometry::Polygon {
        vertices: copied,
        vertex_count: vertices.len(),
        center: convex_polygon_centroid(vertices),
    })
}

fn convex_shape_contact(a: ConvexContactGeometry, b: ConvexContactGeometry) -> Option<AabbContact> {
    let mut best_contact = AabbContact {
        normal_x: 0.0,
        normal_y: 0.0,
        penetration: f32::INFINITY,
    };
    let mut has_axis = false;

    if !convex_contact_polygon_axes(a, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_polygon_axes(b, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_capsule_axis(a, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_capsule_axis(b, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_round_feature_axes(a, b, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_round_feature_axes(b, a, a, b, &mut best_contact, &mut has_axis)?
    {
        return None;
    }

    if !has_axis {
        let a_center = convex_contact_geometry_center(a);
        let b_center = convex_contact_geometry_center(b);
        if !convex_contact_axis(
            a,
            b,
            b_center.x - a_center.x,
            b_center.y - a_center.y,
            &mut best_contact,
            &mut has_axis,
        )? {
            return None;
        }
    }

    has_axis.then_some(best_contact)
}

fn convex_contact_polygon_axes(
    axis_source: ConvexContactGeometry,
    a: ConvexContactGeometry,
    other: ConvexContactGeometry,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    let ConvexContactGeometry::Polygon {
        vertices,
        vertex_count,
        ..
    } = axis_source
    else {
        return Some(true);
    };

    for index in 0..vertex_count {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertex_count];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        if !convex_contact_axis(a, other, -edge_y, edge_x, best_contact, has_axis)? {
            return Some(false);
        }
    }
    Some(true)
}

fn convex_contact_capsule_axis(
    axis_source: ConvexContactGeometry,
    a: ConvexContactGeometry,
    other: ConvexContactGeometry,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    let ConvexContactGeometry::Capsule { start, end, .. } = axis_source else {
        return Some(true);
    };

    let axis_x = -(end.y - start.y);
    let axis_y = end.x - start.x;
    convex_contact_axis(a, other, axis_x, axis_y, best_contact, has_axis)
}

fn convex_contact_round_feature_axes(
    axis_source: ConvexContactGeometry,
    other: ConvexContactGeometry,
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    let ConvexContactGeometry::Polygon {
        vertices,
        vertex_count,
        ..
    } = other
    else {
        return Some(true);
    };

    match axis_source {
        ConvexContactGeometry::Circle { center, .. } => {
            for vertex in &vertices[..vertex_count] {
                if !convex_contact_axis(
                    a,
                    b,
                    center.x - vertex.x,
                    center.y - vertex.y,
                    best_contact,
                    has_axis,
                )? {
                    return Some(false);
                }
            }
        }
        ConvexContactGeometry::Capsule { start, end, .. } => {
            for endpoint in [start, end] {
                for vertex in &vertices[..vertex_count] {
                    if !convex_contact_axis(
                        a,
                        b,
                        endpoint.x - vertex.x,
                        endpoint.y - vertex.y,
                        best_contact,
                        has_axis,
                    )? {
                        return Some(false);
                    }
                }
            }
        }
        ConvexContactGeometry::Polygon { .. } => {}
    }

    Some(true)
}

fn convex_contact_axis(
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    axis_x: f32,
    axis_y: f32,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    if !axis_x.is_finite() || !axis_y.is_finite() {
        return Some(true);
    }
    let axis_length_squared = axis_x * axis_x + axis_y * axis_y;
    if axis_length_squared <= RAY_EPSILON * RAY_EPSILON {
        return Some(true);
    }

    let inv_axis_length = axis_length_squared.sqrt().recip();
    let mut unit_x = axis_x * inv_axis_length;
    let mut unit_y = axis_y * inv_axis_length;
    let a_center = convex_contact_geometry_center(a);
    let b_center = convex_contact_geometry_center(b);
    let center_projection = (b_center.x - a_center.x) * unit_x + (b_center.y - a_center.y) * unit_y;
    if center_projection < 0.0 {
        unit_x = -unit_x;
        unit_y = -unit_y;
    }

    let (a_min, a_max) = convex_contact_geometry_project(a, unit_x, unit_y)?;
    let (b_min, b_max) = convex_contact_geometry_project(b, unit_x, unit_y)?;
    let penetration = a_max.min(b_max) - a_min.max(b_min);
    if !penetration.is_finite() || penetration <= 0.0 {
        return Some(false);
    }

    if penetration < best_contact.penetration {
        *best_contact = AabbContact {
            normal_x: unit_x,
            normal_y: unit_y,
            penetration,
        };
    }
    *has_axis = true;
    Some(true)
}

fn convex_contact_geometry_project(
    geometry: ConvexContactGeometry,
    axis_x: f32,
    axis_y: f32,
) -> Option<(f32, f32)> {
    match geometry {
        ConvexContactGeometry::Polygon {
            vertices,
            vertex_count,
            ..
        } => {
            if vertex_count == 0 || vertex_count > MAX_CONVEX_POLYGON_VERTICES {
                return None;
            }
            Some(project_vertices(&vertices[..vertex_count], axis_x, axis_y))
        }
        ConvexContactGeometry::Circle { center, radius } => {
            if !center.x.is_finite() || !center.y.is_finite() || !is_valid_radius(radius) {
                return None;
            }
            let center_projection = center.x * axis_x + center.y * axis_y;
            Some((center_projection - radius, center_projection + radius))
        }
        ConvexContactGeometry::Capsule {
            start, end, radius, ..
        } => {
            if !start.x.is_finite()
                || !start.y.is_finite()
                || !end.x.is_finite()
                || !end.y.is_finite()
                || !is_valid_radius(radius)
            {
                return None;
            }
            let start_projection = start.x * axis_x + start.y * axis_y;
            let end_projection = end.x * axis_x + end.y * axis_y;
            Some((
                start_projection.min(end_projection) - radius,
                start_projection.max(end_projection) + radius,
            ))
        }
    }
}

fn convex_contact_geometry_center(geometry: ConvexContactGeometry) -> Transform2D {
    match geometry {
        ConvexContactGeometry::Polygon { center, .. }
        | ConvexContactGeometry::Circle { center, .. }
        | ConvexContactGeometry::Capsule { center, .. } => center,
    }
}

pub(super) fn convex_shape_contact_point(
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    contact: AabbContact,
) -> Transform2D {
    let a_support = convex_contact_support_point(a, contact.normal_x, contact.normal_y);
    let b_support = convex_contact_support_point(b, -contact.normal_x, -contact.normal_y);
    match (a_support, b_support) {
        (Some(a_point), Some(b_point)) => Transform2D {
            x: (a_point.x + b_point.x) * 0.5,
            y: (a_point.y + b_point.y) * 0.5,
        },
        (Some(point), None) | (None, Some(point)) => point,
        (None, None) => {
            let a_center = convex_contact_geometry_center(a);
            let b_center = convex_contact_geometry_center(b);
            Transform2D {
                x: (a_center.x + b_center.x) * 0.5,
                y: (a_center.y + b_center.y) * 0.5,
            }
        }
    }
}

fn convex_contact_support_point(
    geometry: ConvexContactGeometry,
    direction_x: f32,
    direction_y: f32,
) -> Option<Transform2D> {
    if !direction_x.is_finite() || !direction_y.is_finite() {
        return None;
    }
    let length_squared = direction_x * direction_x + direction_y * direction_y;
    if length_squared <= RAY_EPSILON * RAY_EPSILON {
        return Some(convex_contact_geometry_center(geometry));
    }
    let inv_length = length_squared.sqrt().recip();
    let direction_x = direction_x * inv_length;
    let direction_y = direction_y * inv_length;

    match geometry {
        ConvexContactGeometry::Polygon {
            vertices,
            vertex_count,
            ..
        } => polygon_support_point(&vertices[..vertex_count], direction_x, direction_y),
        ConvexContactGeometry::Circle { center, radius } => {
            is_valid_radius(radius).then_some(Transform2D {
                x: center.x + direction_x * radius,
                y: center.y + direction_y * radius,
            })
        }
        ConvexContactGeometry::Capsule {
            start, end, radius, ..
        } => {
            if !is_valid_radius(radius) {
                return None;
            }
            let start_projection = start.x * direction_x + start.y * direction_y;
            let end_projection = end.x * direction_x + end.y * direction_y;
            let endpoint = if (start_projection - end_projection).abs() <= RAY_EPSILON {
                Transform2D {
                    x: (start.x + end.x) * 0.5,
                    y: (start.y + end.y) * 0.5,
                }
            } else if start_projection > end_projection {
                start
            } else {
                end
            };
            Some(Transform2D {
                x: endpoint.x + direction_x * radius,
                y: endpoint.y + direction_y * radius,
            })
        }
    }
}

fn polygon_support_point(
    vertices: &[Transform2D],
    direction_x: f32,
    direction_y: f32,
) -> Option<Transform2D> {
    let first = vertices.first().copied()?;
    let mut max_projection = first.x * direction_x + first.y * direction_y;
    for vertex in &vertices[1..] {
        let projection = vertex.x * direction_x + vertex.y * direction_y;
        if projection > max_projection {
            max_projection = projection;
        }
    }

    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut count = 0;
    for vertex in vertices {
        let projection = vertex.x * direction_x + vertex.y * direction_y;
        if (projection - max_projection).abs() <= RAY_EPSILON {
            sum_x += vertex.x;
            sum_y += vertex.y;
            count += 1;
        }
    }

    (count > 0).then_some(Transform2D {
        x: sum_x / count as f32,
        y: sum_y / count as f32,
    })
}
