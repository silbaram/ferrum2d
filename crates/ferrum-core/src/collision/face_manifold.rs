use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct TangentInterval {
    pub(super) min: f32,
    pub(super) max: f32,
}

pub(super) fn circle_face_contact_manifold_points(
    face: ContactFace,
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(radius)
        || !center.x.is_finite()
        || !center.y.is_finite()
        || !face.center.x.is_finite()
        || !face.center.y.is_finite()
        || !face.normal.vx.is_finite()
        || !face.normal.vy.is_finite()
        || !face.tangent.vx.is_finite()
        || !face.tangent.vy.is_finite()
        || !face.tangent_extent.is_finite()
        || face.tangent_extent <= RAY_EPSILON
        || !contact.penetration.is_finite()
    {
        return None;
    }

    let normal_length =
        (contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y).sqrt();
    if !normal_length.is_finite() || normal_length <= RAY_EPSILON {
        return None;
    }

    let contact_normal = Velocity {
        vx: contact.normal_x / normal_length,
        vy: contact.normal_y / normal_length,
    };
    if dot_velocity(face.normal, contact_normal) < 1.0 - RAY_EPSILON {
        return None;
    }

    let center_tangent = point_tangent_projection(center, face);
    if center_tangent < -face.tangent_extent - RAY_EPSILON
        || center_tangent > face.tangent_extent + RAY_EPSILON
    {
        return None;
    }

    let normal_distance = point_normal_projection(center, face).abs();
    if !normal_distance.is_finite() || normal_distance > radius + RAY_EPSILON {
        return None;
    }

    let tangent_radius = (radius * radius - normal_distance * normal_distance)
        .max(0.0)
        .sqrt();
    let min = (center_tangent - tangent_radius).max(-face.tangent_extent);
    let max = (center_tangent + tangent_radius).min(face.tangent_extent);
    if max - min <= RAY_EPSILON {
        return None;
    }

    let first = contact_face_point(face, min);
    let second = contact_face_point(face, max);
    Some(two_or_one_contact_manifold_points(
        first.x,
        first.y,
        second.x,
        second.y,
        contact.penetration,
    ))
}

pub(super) fn point_tangent_projection(point: Transform2D, face: ContactFace) -> f32 {
    (point.x - face.center.x) * face.tangent.vx + (point.y - face.center.y) * face.tangent.vy
}

pub(super) fn contact_face_point(face: ContactFace, tangent_projection: f32) -> Transform2D {
    Transform2D {
        x: face.center.x + face.tangent.vx * tangent_projection,
        y: face.center.y + face.tangent.vy * tangent_projection,
    }
}

pub(super) fn capsule_face_arc_clipped_contact_manifold_points(
    face: ContactFace,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let interval = capsule_face_tangent_interval(face, start, end, radius)?;
    let min = interval.min.max(-face.tangent_extent);
    let max = interval.max.min(face.tangent_extent);
    if max - min <= RAY_EPSILON {
        return None;
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_capsule_face_arc_clipped_contact_point(
        &mut points,
        &mut point_count,
        face,
        start,
        end,
        radius,
        min,
    );
    append_capsule_face_arc_clipped_contact_point(
        &mut points,
        &mut point_count,
        face,
        start,
        end,
        radius,
        max,
    );
    (point_count > 0).then_some((points, point_count))
}

pub(super) fn capsule_face_tangent_interval(
    face: ContactFace,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<TangentInterval> {
    if !is_valid_radius(radius)
        || !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
        || !face.center.x.is_finite()
        || !face.center.y.is_finite()
        || !face.normal.vx.is_finite()
        || !face.normal.vy.is_finite()
        || !face.tangent.vx.is_finite()
        || !face.tangent.vy.is_finite()
        || !face.tangent_extent.is_finite()
        || face.tangent_extent <= RAY_EPSILON
    {
        return None;
    }

    let start_t = point_tangent_projection(start, face);
    let start_n = point_normal_projection(start, face);
    let end_t = point_tangent_projection(end, face);
    let end_n = point_normal_projection(end, face);
    let mut interval = None;
    append_capsule_endpoint_face_tangent_interval(&mut interval, start_t, start_n, radius);
    append_capsule_endpoint_face_tangent_interval(&mut interval, end_t, end_n, radius);
    append_capsule_side_face_tangent_interval(
        &mut interval,
        start_t,
        start_n,
        end_t,
        end_n,
        radius,
    );
    interval
}

fn point_normal_projection(point: Transform2D, face: ContactFace) -> f32 {
    (point.x - face.center.x) * face.normal.vx + (point.y - face.center.y) * face.normal.vy
}

fn append_capsule_endpoint_face_tangent_interval(
    interval: &mut Option<TangentInterval>,
    tangent: f32,
    normal: f32,
    radius: f32,
) {
    let normal_distance = normal.abs();
    if normal_distance > radius + RAY_EPSILON {
        return;
    }

    let tangent_radius = (radius * radius - normal_distance * normal_distance)
        .max(0.0)
        .sqrt();
    append_tangent_interval(interval, tangent - tangent_radius, tangent + tangent_radius);
}

fn append_capsule_side_face_tangent_interval(
    interval: &mut Option<TangentInterval>,
    start_t: f32,
    start_n: f32,
    end_t: f32,
    end_n: f32,
    radius: f32,
) {
    let delta_t = end_t - start_t;
    let delta_n = end_n - start_n;
    let length_squared = delta_t * delta_t + delta_n * delta_n;
    if length_squared <= RAY_EPSILON * RAY_EPSILON || !length_squared.is_finite() {
        return;
    }

    let mut min = f32::NEG_INFINITY;
    let mut max = f32::INFINITY;
    if delta_t.abs() > RAY_EPSILON {
        let projection_start = start_t + start_n * delta_n / delta_t;
        let projection_end = start_t + (length_squared + start_n * delta_n) / delta_t;
        min = min.max(projection_start.min(projection_end));
        max = max.min(projection_start.max(projection_end));
    } else {
        let projection = -start_n * delta_n / length_squared;
        if !projection.is_finite() || !(0.0..=1.0).contains(&projection) {
            return;
        }
    }

    let length = length_squared.sqrt();
    if delta_n.abs() > RAY_EPSILON {
        let center = start_t - start_n * delta_t / delta_n;
        let span = radius * length / delta_n.abs();
        min = min.max(center - span);
        max = max.min(center + span);
    } else if start_n.abs() > radius + RAY_EPSILON {
        return;
    }

    append_tangent_interval(interval, min, max);
}

fn append_tangent_interval(interval: &mut Option<TangentInterval>, min: f32, max: f32) {
    if !min.is_finite() || !max.is_finite() {
        return;
    }
    let (min, max) = if min <= max { (min, max) } else { (max, min) };
    if max - min <= RAY_EPSILON {
        return;
    }

    if let Some(existing) = interval {
        existing.min = existing.min.min(min);
        existing.max = existing.max.max(max);
    } else {
        *interval = Some(TangentInterval { min, max });
    }
}

fn append_capsule_face_arc_clipped_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    face: ContactFace,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    tangent_projection: f32,
) {
    let point = contact_face_point(face, tangent_projection);
    let distance_squared = point_segment_distance_squared(point, start, end);
    if distance_squared > radius * radius + RAY_EPSILON {
        return;
    }

    let penetration = (radius - distance_squared.sqrt()).max(0.0);
    if penetration <= RAY_EPSILON {
        return;
    }

    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: point.x,
            point_y: point.y,
            penetration,
        },
    );
}

pub(super) fn clip_segment_to_face_tangent_interval(
    first: Transform2D,
    second: Transform2D,
    face_center: Transform2D,
    tangent: Velocity,
    tangent_extent: f32,
) -> Option<(Transform2D, Transform2D)> {
    if !tangent_extent.is_finite() || tangent_extent < 0.0 {
        return None;
    }

    let first_projection =
        (first.x - face_center.x) * tangent.vx + (first.y - face_center.y) * tangent.vy;
    let second_projection =
        (second.x - face_center.x) * tangent.vx + (second.y - face_center.y) * tangent.vy;
    let delta = second_projection - first_projection;
    let min = -tangent_extent;
    let max = tangent_extent;

    if delta.abs() <= RAY_EPSILON {
        return (first_projection >= min - RAY_EPSILON && first_projection <= max + RAY_EPSILON)
            .then_some((first, second));
    }

    let mut entry: f32 = 0.0;
    let mut exit: f32 = 1.0;
    if delta > 0.0 {
        entry = entry.max((min - first_projection) / delta);
        exit = exit.min((max - first_projection) / delta);
    } else {
        entry = entry.max((max - first_projection) / delta);
        exit = exit.min((min - first_projection) / delta);
    }
    if entry > exit || exit < 0.0 || entry > 1.0 {
        return None;
    }

    Some((
        lerp_transform(first, second, entry.clamp(0.0, 1.0)),
        lerp_transform(first, second, exit.clamp(0.0, 1.0)),
    ))
}

fn lerp_transform(first: Transform2D, second: Transform2D, t: f32) -> Transform2D {
    Transform2D {
        x: first.x + (second.x - first.x) * t,
        y: first.y + (second.y - first.y) * t,
    }
}

pub(super) fn append_face_clipped_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    reference: ContactFace,
    point: Transform2D,
) {
    let separation = (point.x - reference.center.x) * reference.normal.vx
        + (point.y - reference.center.y) * reference.normal.vy;
    if !separation.is_finite() || separation > RAY_EPSILON {
        return;
    }

    let projected = Transform2D {
        x: point.x - reference.normal.vx * separation,
        y: point.y - reference.normal.vy * separation,
    };
    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: projected.x,
            point_y: projected.y,
            penetration: (-separation).max(0.0),
        },
    );
}
