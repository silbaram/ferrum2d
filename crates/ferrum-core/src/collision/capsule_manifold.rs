use super::*;

pub(super) fn capsule_circle_contact_manifold_points(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = capsule_circle_side_contact_face(ac.start(at), ac.end(at), ac.radius, contact)?;
    circle_face_contact_manifold_points(face, bc.center(bt), bc.radius, contact)
}

fn capsule_circle_side_contact_face(
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) -> Option<ContactFace> {
    if !is_valid_radius(capsule_radius)
        || !contact.normal_x.is_finite()
        || !contact.normal_y.is_finite()
    {
        return None;
    }

    let frame = segment_frame(capsule_start, capsule_end)?;
    let normal_length =
        (contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y).sqrt();
    if !normal_length.is_finite() || normal_length <= RAY_EPSILON {
        return None;
    }

    let contact_normal = Velocity {
        vx: contact.normal_x / normal_length,
        vy: contact.normal_y / normal_length,
    };
    let axis = Velocity {
        vx: frame.axis_x,
        vy: frame.axis_y,
    };
    if dot_velocity(axis, contact_normal).abs() > RAY_EPSILON {
        return None;
    }

    let frame_normal = Velocity {
        vx: frame.normal_x,
        vy: frame.normal_y,
    };
    let side_alignment = dot_velocity(frame_normal, contact_normal);
    if side_alignment.abs() < 1.0 - RAY_EPSILON {
        return None;
    }

    let normal = if side_alignment >= 0.0 {
        frame_normal
    } else {
        Velocity {
            vx: -frame_normal.vx,
            vy: -frame_normal.vy,
        }
    };
    let side_center = segment_frame_world_point(frame, frame.length * 0.5, 0.0);
    Some(ContactFace {
        center: Transform2D {
            x: side_center.x + normal.vx * capsule_radius,
            y: side_center.y + normal.vy * capsule_radius,
        },
        normal,
        tangent: axis,
        tangent_extent: frame.length * 0.5,
    })
}

pub(super) fn capsule_capsule_contact_manifold_points(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    if let Some((first, second)) = capsule_capsule_side_contact_segment(
        ac.start(at),
        ac.end(at),
        ac.radius,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return two_or_one_contact_manifold_points(
            first.x,
            first.y,
            second.x,
            second.y,
            contact.penetration,
        );
    }
    if let Some(points) = capsule_capsule_curve_contact_manifold_points(
        ac.start(at),
        ac.end(at),
        ac.radius,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }
    if let Some(points) = capsule_capsule_endpoint_contact_manifold_points(
        ac.start(at),
        ac.end(at),
        ac.radius,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }

    let (point_x, point_y) = capsule_capsule_contact_point(at, ac, bt, bc, contact);
    single_contact_manifold_point(point_x, point_y, contact.penetration)
}

fn capsule_capsule_side_contact_segment(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) -> Option<(Transform2D, Transform2D)> {
    let frame = segment_frame(a_start, a_end)?;
    let b_start_local = segment_frame_local_point(frame, b_start);
    let b_end_local = segment_frame_local_point(frame, b_end);
    if (b_start_local.y - b_end_local.y).abs() > RAY_EPSILON {
        return None;
    }

    let normal_axis_dot = contact.normal_x * frame.axis_x + contact.normal_y * frame.axis_y;
    let normal_side_dot = contact.normal_x * frame.normal_x + contact.normal_y * frame.normal_y;
    if normal_axis_dot.abs() > RAY_EPSILON || normal_side_dot.abs() < 1.0 - RAY_EPSILON {
        return None;
    }

    let b_min_x = b_start_local.x.min(b_end_local.x);
    let b_max_x = b_start_local.x.max(b_end_local.x);
    let min_x = 0.0_f32.max(b_min_x);
    let max_x = frame.length.min(b_max_x);
    if max_x - min_x <= RAY_EPSILON {
        return None;
    }

    let first = capsule_capsule_side_contact_point_at(
        frame,
        b_start_local.y,
        min_x,
        a_radius,
        b_radius,
        contact,
    );
    let second = capsule_capsule_side_contact_point_at(
        frame,
        b_start_local.y,
        max_x,
        a_radius,
        b_radius,
        contact,
    );
    Some((first, second))
}

fn capsule_capsule_curve_contact_manifold_points(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return None;
    }
    if !segments_intersect(a_start, a_end, b_start, b_end) {
        return None;
    }

    let intersection = segment_intersection_point(a_start, a_end, b_start, b_end)?;
    let normal_length =
        (contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y).sqrt();
    if !normal_length.is_finite() || normal_length <= RAY_EPSILON {
        return None;
    }

    let normal = Velocity {
        vx: contact.normal_x / normal_length,
        vy: contact.normal_y / normal_length,
    };
    let tangent = Velocity {
        vx: -normal.vy,
        vy: normal.vx,
    };
    let contact_line = ContactFace {
        center: intersection,
        normal,
        tangent,
        tangent_extent: 1.0,
    };
    let a_interval = capsule_face_tangent_interval(contact_line, a_start, a_end, a_radius)?;
    let b_interval = capsule_face_tangent_interval(contact_line, b_start, b_end, b_radius)?;
    let min = a_interval.min.max(b_interval.min);
    let max = a_interval.max.min(b_interval.max);
    if max - min <= RAY_EPSILON {
        return None;
    }

    let first = contact_face_point(contact_line, min);
    let second = contact_face_point(contact_line, max);
    Some(two_or_one_contact_manifold_points(
        first.x,
        first.y,
        second.x,
        second.y,
        contact.penetration,
    ))
}

fn capsule_capsule_endpoint_contact_manifold_points(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return None;
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        closest_point_on_segment(b_start, a_start, a_end),
        a_radius,
        b_start,
        b_radius,
        contact,
    );
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        closest_point_on_segment(b_end, a_start, a_end),
        a_radius,
        b_end,
        b_radius,
        contact,
    );
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        a_start,
        a_radius,
        closest_point_on_segment(a_start, b_start, b_end),
        b_radius,
        contact,
    );
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        a_end,
        a_radius,
        closest_point_on_segment(a_end, b_start, b_end),
        b_radius,
        contact,
    );
    (point_count > 0).then_some((points, point_count))
}

fn append_capsule_capsule_endpoint_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    a_center: Transform2D,
    a_radius: f32,
    b_center: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) {
    let distance_squared = point_distance_squared(a_center, b_center);
    let radius_sum = a_radius + b_radius;
    if distance_squared > radius_sum * radius_sum + RAY_EPSILON {
        return;
    }

    let a_surface = Transform2D {
        x: a_center.x + contact.normal_x * a_radius,
        y: a_center.y + contact.normal_y * a_radius,
    };
    let b_surface = Transform2D {
        x: b_center.x - contact.normal_x * b_radius,
        y: b_center.y - contact.normal_y * b_radius,
    };
    let distance = distance_squared.sqrt();
    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: (a_surface.x + b_surface.x) * 0.5,
            point_y: (a_surface.y + b_surface.y) * 0.5,
            penetration: (radius_sum - distance).max(0.0),
        },
    );
}

fn capsule_capsule_side_contact_point_at(
    frame: SegmentFrame,
    b_local_y: f32,
    x: f32,
    a_radius: f32,
    b_radius: f32,
    contact: AabbContact,
) -> Transform2D {
    let a_center = segment_frame_world_point(frame, x, 0.0);
    let b_center = segment_frame_world_point(frame, x, b_local_y);
    let a_surface = Transform2D {
        x: a_center.x + contact.normal_x * a_radius,
        y: a_center.y + contact.normal_y * a_radius,
    };
    let b_surface = Transform2D {
        x: b_center.x - contact.normal_x * b_radius,
        y: b_center.y - contact.normal_y * b_radius,
    };
    Transform2D {
        x: (a_surface.x + b_surface.x) * 0.5,
        y: (a_surface.y + b_surface.y) * 0.5,
    }
}

fn segment_frame_world_point(frame: SegmentFrame, x: f32, y: f32) -> Transform2D {
    Transform2D {
        x: frame.origin.x + frame.axis_x * x + frame.normal_x * y,
        y: frame.origin.y + frame.axis_y * x + frame.normal_y * y,
    }
}
