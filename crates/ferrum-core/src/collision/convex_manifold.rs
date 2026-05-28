use super::*;

pub(super) fn convex_polygon_contact_manifold_points(
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    match (a, b) {
        (
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
            ConvexContactGeometry::Circle { center, radius },
        ) => convex_polygon_circle_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            center,
            radius,
            contact,
        ),
        (
            ConvexContactGeometry::Circle { center, radius },
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
        ) => convex_polygon_circle_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            center,
            radius,
            invert_contact(contact),
        ),
        (
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
            ConvexContactGeometry::Capsule {
                start, end, radius, ..
            },
        ) => convex_polygon_capsule_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            start,
            end,
            radius,
            contact,
        ),
        (
            ConvexContactGeometry::Capsule {
                start, end, radius, ..
            },
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
        ) => convex_polygon_capsule_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            start,
            end,
            radius,
            invert_contact(contact),
        ),
        (
            ConvexContactGeometry::Polygon {
                vertices: a_vertices,
                vertex_count: a_vertex_count,
                ..
            },
            ConvexContactGeometry::Polygon {
                vertices: b_vertices,
                vertex_count: b_vertex_count,
                ..
            },
        ) => convex_polygon_polygon_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&a_vertices, a_vertex_count)?,
            convex_contact_polygon_vertices_slice(&b_vertices, b_vertex_count)?,
            contact,
        ),
        _ => None,
    }
}

fn convex_contact_polygon_vertices_slice(
    vertices: &[Transform2D; MAX_CONVEX_POLYGON_VERTICES],
    vertex_count: usize,
) -> Option<&[Transform2D]> {
    if vertex_count > MAX_CONVEX_POLYGON_VERTICES {
        return None;
    }
    let vertices = &vertices[..vertex_count];
    convex_polygon_is_valid(vertices).then_some(vertices)
}

fn convex_polygon_polygon_contact_manifold_points(
    a_vertices: &[Transform2D],
    b_vertices: &[Transform2D],
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let (reference, incident) = convex_polygon_reference_incident_faces(
        a_vertices,
        b_vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    let (first, second) = clip_segment_to_face_tangent_interval(
        incident.0,
        incident.1,
        reference.center,
        reference.tangent,
        reference.tangent_extent,
    )?;

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, first);
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, second);
    (point_count > 0).then_some((points, point_count))
}

fn convex_polygon_circle_contact_manifold_points(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if let Some(points) =
        convex_polygon_circle_face_contact_manifold_points(vertices, center, radius, contact)
    {
        return Some(points);
    }

    let point = convex_polygon_round_contact_point(vertices, center, radius, contact)?;
    Some(single_contact_manifold_point(
        point.point_x,
        point.point_y,
        point.penetration,
    ))
}

fn convex_polygon_circle_face_contact_manifold_points(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = convex_polygon_reference_face(
        vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    circle_face_contact_manifold_points(face, center, radius, contact)
}

fn convex_polygon_capsule_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if let Some(points) =
        convex_polygon_capsule_side_contact_manifold_points(vertices, start, end, contact)
    {
        return Some(points);
    }
    if let Some(points) = convex_polygon_capsule_arc_clipped_contact_manifold_points(
        vertices, start, end, radius, contact,
    ) {
        return Some(points);
    }
    if let Some(points) = convex_polygon_capsule_endpoint_contact_manifold_points(
        vertices, start, end, radius, contact,
    ) {
        return Some(points);
    }

    let point = convex_shape_contact_point(
        ConvexContactGeometry::Polygon {
            vertices: convex_contact_polygon_array(vertices)?,
            vertex_count: vertices.len(),
            center: convex_polygon_centroid(vertices),
        },
        ConvexContactGeometry::Capsule {
            start,
            end,
            radius,
            center: Transform2D {
                x: (start.x + end.x) * 0.5,
                y: (start.y + end.y) * 0.5,
            },
        },
        contact,
    );
    Some(single_contact_manifold_point(
        point.x,
        point.y,
        contact.penetration,
    ))
}

fn convex_polygon_capsule_arc_clipped_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let reference = convex_polygon_reference_face(
        vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    capsule_face_arc_clipped_contact_manifold_points(reference, start, end, radius)
}

fn convex_polygon_capsule_side_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let reference = convex_polygon_reference_face(
        vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let segment_length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if !segment_length.is_finite() || segment_length <= RAY_EPSILON {
        return None;
    }

    let axis = Velocity {
        vx: segment_x / segment_length,
        vy: segment_y / segment_length,
    };
    let tangent_alignment = dot_velocity(axis, reference.tangent).abs();
    let normal_alignment = dot_velocity(axis, reference.normal).abs();
    if tangent_alignment < 1.0 - RAY_EPSILON || normal_alignment > RAY_EPSILON {
        return None;
    }

    let start_tangent = point_tangent_projection(start, reference);
    let end_tangent = point_tangent_projection(end, reference);
    let min_tangent = start_tangent
        .min(end_tangent)
        .max(-reference.tangent_extent);
    let max_tangent = start_tangent.max(end_tangent).min(reference.tangent_extent);
    if max_tangent - min_tangent <= RAY_EPSILON {
        return None;
    }

    let first = contact_face_point(reference, min_tangent);
    let second = contact_face_point(reference, max_tangent);
    Some(two_or_one_contact_manifold_points(
        first.x,
        first.y,
        second.x,
        second.y,
        contact.penetration,
    ))
}

fn convex_polygon_capsule_endpoint_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(radius) {
        return None;
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_convex_polygon_round_contact_point(
        &mut points,
        &mut point_count,
        vertices,
        start,
        radius,
        contact,
    );
    append_convex_polygon_round_contact_point(
        &mut points,
        &mut point_count,
        vertices,
        end,
        radius,
        contact,
    );
    (point_count > 0).then_some((points, point_count))
}

fn append_convex_polygon_round_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) {
    if let Some(point) = convex_polygon_round_contact_point(vertices, center, radius, contact) {
        append_contact_manifold_point_by_depth(points, point_count, point);
    }
}

fn convex_polygon_round_contact_point(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<CollisionContactPoint> {
    if !is_valid_radius(radius) || !convex_polygon_is_valid(vertices) {
        return None;
    }

    if convex_polygon_contains_point(vertices, center) {
        return Some(CollisionContactPoint {
            point_x: center.x - contact.normal_x * radius,
            point_y: center.y - contact.normal_y * radius,
            penetration: contact.penetration,
        });
    }

    let (distance, point_x, point_y) = nearest_point_on_convex_polygon(center, vertices)?;
    if distance > radius + RAY_EPSILON {
        return None;
    }

    Some(CollisionContactPoint {
        point_x,
        point_y,
        penetration: (radius - distance).max(0.0),
    })
}

fn convex_contact_polygon_array(
    vertices: &[Transform2D],
) -> Option<[Transform2D; MAX_CONVEX_POLYGON_VERTICES]> {
    if !convex_polygon_is_valid(vertices) {
        return None;
    }

    let mut copied = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, vertex) in vertices.iter().copied().enumerate() {
        copied[index] = vertex;
    }
    Some(copied)
}

fn convex_polygon_reference_incident_faces(
    a_vertices: &[Transform2D],
    b_vertices: &[Transform2D],
    normal: Velocity,
) -> Option<(ContactFace, (Transform2D, Transform2D))> {
    if !normal.vx.is_finite() || !normal.vy.is_finite() {
        return None;
    }

    let a_alignment = convex_polygon_face_alignment(a_vertices, normal)?;
    let reference_normal = Velocity {
        vx: -normal.vx,
        vy: -normal.vy,
    };
    let b_alignment = convex_polygon_face_alignment(b_vertices, reference_normal)?;
    if a_alignment + RAY_EPSILON >= b_alignment {
        let reference = convex_polygon_reference_face(a_vertices, normal)?;
        let incident = convex_polygon_incident_face_segment(b_vertices, reference.normal)?;
        Some((reference, incident))
    } else {
        let reference = convex_polygon_reference_face(b_vertices, reference_normal)?;
        let incident = convex_polygon_incident_face_segment(a_vertices, reference.normal)?;
        Some((reference, incident))
    }
}

fn convex_polygon_face_alignment(vertices: &[Transform2D], normal: Velocity) -> Option<f32> {
    let mut best = f32::NEG_INFINITY;
    for index in 0..vertices.len() {
        let face = convex_polygon_contact_face(vertices, index)?;
        best = best.max(dot_velocity(face.normal, normal));
    }
    best.is_finite().then_some(best)
}

fn convex_polygon_reference_face(
    vertices: &[Transform2D],
    outward_normal: Velocity,
) -> Option<ContactFace> {
    let mut best_face = None;
    let mut best_alignment = f32::NEG_INFINITY;
    for index in 0..vertices.len() {
        let face = convex_polygon_contact_face(vertices, index)?;
        let alignment = dot_velocity(face.normal, outward_normal);
        if alignment > best_alignment {
            best_alignment = alignment;
            best_face = Some(face);
        }
    }
    best_face
}

fn convex_polygon_incident_face_segment(
    vertices: &[Transform2D],
    reference_normal: Velocity,
) -> Option<(Transform2D, Transform2D)> {
    let mut best_index = None;
    let mut best_alignment = f32::INFINITY;
    for index in 0..vertices.len() {
        let face = convex_polygon_contact_face(vertices, index)?;
        let alignment = dot_velocity(face.normal, reference_normal);
        if alignment < best_alignment {
            best_alignment = alignment;
            best_index = Some(index);
        }
    }
    let index = best_index?;
    Some((vertices[index], vertices[(index + 1) % vertices.len()]))
}

fn convex_polygon_contact_face(vertices: &[Transform2D], index: usize) -> Option<ContactFace> {
    if !convex_polygon_is_valid(vertices) || index >= vertices.len() {
        return None;
    }

    let start = vertices[index];
    let end = vertices[(index + 1) % vertices.len()];
    let edge_x = end.x - start.x;
    let edge_y = end.y - start.y;
    let edge_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
    if edge_length <= RAY_EPSILON || !edge_length.is_finite() {
        return None;
    }

    let tangent = Velocity {
        vx: edge_x / edge_length,
        vy: edge_y / edge_length,
    };
    let is_counter_clockwise = convex_polygon_signed_area(vertices) > 0.0;
    let normal = if is_counter_clockwise {
        Velocity {
            vx: tangent.vy,
            vy: -tangent.vx,
        }
    } else {
        Velocity {
            vx: -tangent.vy,
            vy: tangent.vx,
        }
    };

    Some(ContactFace {
        center: Transform2D {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        },
        normal,
        tangent,
        tangent_extent: edge_length * 0.5,
    })
}
