use super::*;

pub(super) fn oriented_box_oriented_box_contact_manifold_points(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let Some((reference, incident)) = oriented_box_reference_incident_faces(
        a,
        b,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    ) else {
        let point = oriented_box_oriented_box_contact_point(a, b, contact);
        return single_contact_manifold_point(point.x, point.y, contact.penetration);
    };

    let Some((first, second)) = clip_segment_to_face_tangent_interval(
        incident.0,
        incident.1,
        reference.center,
        reference.tangent,
        reference.tangent_extent,
    ) else {
        let point = oriented_box_oriented_box_contact_point(a, b, contact);
        return single_contact_manifold_point(point.x, point.y, contact.penetration);
    };

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, first);
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, second);
    if point_count > 0 {
        (points, point_count)
    } else {
        let point = oriented_box_oriented_box_contact_point(a, b, contact);
        single_contact_manifold_point(point.x, point.y, contact.penetration)
    }
}

pub(super) fn oriented_box_circle_contact_manifold_points(
    oriented_box: OrientedBoxGeometry,
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = oriented_box_reference_face(
        oriented_box,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    circle_face_contact_manifold_points(face, center, radius, contact)
}

fn oriented_box_reference_incident_faces(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    normal: Velocity,
) -> Option<(ContactFace, (Transform2D, Transform2D))> {
    if !normal.vx.is_finite() || !normal.vy.is_finite() {
        return None;
    }

    let a_alignment = oriented_box_axis_alignment(a, normal);
    let b_alignment = oriented_box_axis_alignment(b, normal);
    if a_alignment + RAY_EPSILON >= b_alignment {
        let reference = oriented_box_reference_face(a, normal)?;
        let incident = oriented_box_incident_face_segment(b, reference.normal)?;
        Some((reference, incident))
    } else {
        let reference_normal = Velocity {
            vx: -normal.vx,
            vy: -normal.vy,
        };
        let reference = oriented_box_reference_face(b, reference_normal)?;
        let incident = oriented_box_incident_face_segment(a, reference.normal)?;
        Some((reference, incident))
    }
}

fn oriented_box_axis_alignment(oriented_box: OrientedBoxGeometry, normal: Velocity) -> f32 {
    let x = normal.vx * oriented_box.axis_x_x + normal.vy * oriented_box.axis_x_y;
    let y = normal.vx * oriented_box.axis_y_x + normal.vy * oriented_box.axis_y_y;
    x.abs().max(y.abs())
}

fn oriented_box_reference_face(
    oriented_box: OrientedBoxGeometry,
    outward_normal: Velocity,
) -> Option<ContactFace> {
    let local_x =
        outward_normal.vx * oriented_box.axis_x_x + outward_normal.vy * oriented_box.axis_x_y;
    let local_y =
        outward_normal.vx * oriented_box.axis_y_x + outward_normal.vy * oriented_box.axis_y_y;
    if !local_x.is_finite() || !local_y.is_finite() {
        return None;
    }

    if local_x.abs() >= local_y.abs() {
        let sign = if local_x >= 0.0 { 1.0 } else { -1.0 };
        let normal = Velocity {
            vx: oriented_box.axis_x_x * sign,
            vy: oriented_box.axis_x_y * sign,
        };
        Some(ContactFace {
            center: oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width * sign,
                    y: 0.0,
                },
            ),
            normal,
            tangent: Velocity {
                vx: oriented_box.axis_y_x,
                vy: oriented_box.axis_y_y,
            },
            tangent_extent: oriented_box.half_height,
        })
    } else {
        let sign = if local_y >= 0.0 { 1.0 } else { -1.0 };
        let normal = Velocity {
            vx: oriented_box.axis_y_x * sign,
            vy: oriented_box.axis_y_y * sign,
        };
        Some(ContactFace {
            center: oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: 0.0,
                    y: oriented_box.half_height * sign,
                },
            ),
            normal,
            tangent: Velocity {
                vx: oriented_box.axis_x_x,
                vy: oriented_box.axis_x_y,
            },
            tangent_extent: oriented_box.half_width,
        })
    }
}

fn oriented_box_incident_face_segment(
    oriented_box: OrientedBoxGeometry,
    reference_normal: Velocity,
) -> Option<(Transform2D, Transform2D)> {
    let local_x =
        reference_normal.vx * oriented_box.axis_x_x + reference_normal.vy * oriented_box.axis_x_y;
    let local_y =
        reference_normal.vx * oriented_box.axis_y_x + reference_normal.vy * oriented_box.axis_y_y;
    if !local_x.is_finite() || !local_y.is_finite() {
        return None;
    }

    if local_x.abs() >= local_y.abs() {
        let sign = if local_x >= 0.0 { -1.0 } else { 1.0 };
        Some((
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width * sign,
                    y: -oriented_box.half_height,
                },
            ),
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width * sign,
                    y: oriented_box.half_height,
                },
            ),
        ))
    } else {
        let sign = if local_y >= 0.0 { -1.0 } else { 1.0 };
        Some((
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: -oriented_box.half_width,
                    y: oriented_box.half_height * sign,
                },
            ),
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width,
                    y: oriented_box.half_height * sign,
                },
            ),
        ))
    }
}

pub(super) fn oriented_box_capsule_contact_manifold_points(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let Some(local_bounds) = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    ) else {
        let point = oriented_box_capsule_contact_point(oriented_box, start, end, radius, contact);
        return single_contact_manifold_point(point.x, point.y, contact.penetration);
    };

    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let (local_normal_x, local_normal_y) =
        oriented_box_local_vector(oriented_box, contact.normal_x, contact.normal_y);
    let local_contact = AabbContact {
        normal_x: local_normal_x,
        normal_y: local_normal_y,
        penetration: contact.penetration,
    };

    if let Some((x0, y0, x1, y1)) =
        aabb_capsule_side_contact_segment(local_bounds, local_start, local_end, local_contact)
    {
        let first = oriented_box_world_point(oriented_box, Transform2D { x: x0, y: y0 });
        let second = oriented_box_world_point(oriented_box, Transform2D { x: x1, y: y1 });
        return two_or_one_contact_manifold_points(
            first.x,
            first.y,
            second.x,
            second.y,
            contact.penetration,
        );
    }

    if let Some((points, point_count)) = aabb_capsule_arc_clipped_contact_manifold_points(
        local_bounds,
        local_start,
        local_end,
        radius,
        local_contact,
    ) {
        return oriented_box_world_contact_manifold_points(oriented_box, points, point_count);
    }

    if let Some((points, point_count)) = aabb_capsule_endpoint_contact_manifold_points(
        local_bounds,
        local_start,
        local_end,
        radius,
        local_contact,
    ) {
        return oriented_box_world_contact_manifold_points(oriented_box, points, point_count);
    }

    let point = oriented_box_capsule_contact_point(oriented_box, start, end, radius, contact);
    single_contact_manifold_point(point.x, point.y, contact.penetration)
}

fn oriented_box_world_contact_manifold_points(
    oriented_box: OrientedBoxGeometry,
    points: [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: u32,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let mut world_points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let count = (point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS);
    for index in 0..count {
        let point = oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: points[index].point_x,
                y: points[index].point_y,
            },
        );
        world_points[index] = CollisionContactPoint {
            point_x: point.x,
            point_y: point.y,
            penetration: points[index].penetration,
        };
    }
    (world_points, count as u32)
}
