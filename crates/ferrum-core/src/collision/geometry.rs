use super::*;

pub(super) fn point_aabb_distance_squared(point: Transform2D, bounds: AabbBounds) -> f32 {
    let dx = if point.x < bounds.min_x {
        bounds.min_x - point.x
    } else if point.x > bounds.max_x {
        point.x - bounds.max_x
    } else {
        0.0
    };
    let dy = if point.y < bounds.min_y {
        bounds.min_y - point.y
    } else if point.y > bounds.max_y {
        point.y - bounds.max_y
    } else {
        0.0
    };
    dx * dx + dy * dy
}

pub(super) fn segment_intersects_aabb(
    start: Transform2D,
    end: Transform2D,
    bounds: AabbBounds,
) -> bool {
    if bounds.contains_point(start) || bounds.contains_point(end) {
        return true;
    }
    let Some((direction, max_distance)) = segment_direction_and_distance(start, end) else {
        return false;
    };
    raycast_bounds(
        start,
        direction.vx / max_distance,
        direction.vy / max_distance,
        max_distance,
        bounds,
    )
    .is_some()
}

pub(super) fn point_segment_distance_squared(
    point: Transform2D,
    start: Transform2D,
    end: Transform2D,
) -> f32 {
    let closest = closest_point_on_segment(point, start, end);
    let dx = point.x - closest.x;
    let dy = point.y - closest.y;
    dx * dx + dy * dy
}

pub(super) fn closest_point_on_segment(
    point: Transform2D,
    start: Transform2D,
    end: Transform2D,
) -> Transform2D {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let length_squared = segment_x * segment_x + segment_y * segment_y;
    if length_squared <= RAY_EPSILON * RAY_EPSILON {
        return start;
    }

    let point_x = point.x - start.x;
    let point_y = point.y - start.y;
    let t = ((point_x * segment_x + point_y * segment_y) / length_squared).clamp(0.0, 1.0);
    Transform2D {
        x: start.x + segment_x * t,
        y: start.y + segment_y * t,
    }
}

pub(super) fn closest_segment_aabb_pair(
    start: Transform2D,
    end: Transform2D,
    bounds: AabbBounds,
) -> ClosestPointPair {
    if bounds.contains_point(start) {
        return closest_point_pair(start, start);
    }
    if bounds.contains_point(end) {
        return closest_point_pair(end, end);
    }
    if let Some(point) = segment_aabb_intersection_point(start, end, bounds) {
        return closest_point_pair(point, point);
    }

    let mut closest = closest_point_pair(start, closest_point_on_aabb(start, bounds));
    closest = closer_point_pair(
        closest,
        closest_point_pair(end, closest_point_on_aabb(end, bounds)),
    );

    for corner in aabb_corners(bounds) {
        let segment_point = closest_point_on_segment(corner, start, end);
        closest = closer_point_pair(closest, closest_point_pair(segment_point, corner));
    }

    closest
}

fn segment_aabb_intersection_point(
    start: Transform2D,
    end: Transform2D,
    bounds: AabbBounds,
) -> Option<Transform2D> {
    let (direction, max_distance) = segment_direction_and_distance(start, end)?;
    let unit_x = direction.vx / max_distance;
    let unit_y = direction.vy / max_distance;
    let hit = raycast_bounds(start, unit_x, unit_y, max_distance, bounds)?;
    Some(Transform2D {
        x: start.x + unit_x * hit.distance,
        y: start.y + unit_y * hit.distance,
    })
}

pub(super) fn closest_point_on_aabb(point: Transform2D, bounds: AabbBounds) -> Transform2D {
    Transform2D {
        x: point.x.clamp(bounds.min_x, bounds.max_x),
        y: point.y.clamp(bounds.min_y, bounds.max_y),
    }
}

pub(super) fn capsule_aabb_reference_point(
    start: Transform2D,
    end: Transform2D,
    bounds: AabbBounds,
) -> Transform2D {
    closest_point_on_aabb(
        closest_point_on_segment(aabb_center(bounds), start, end),
        bounds,
    )
}

pub(super) fn aabb_center(bounds: AabbBounds) -> Transform2D {
    Transform2D {
        x: (bounds.min_x + bounds.max_x) * 0.5,
        y: (bounds.min_y + bounds.max_y) * 0.5,
    }
}

pub(super) fn nearest_aabb_face(point: Transform2D, bounds: AabbBounds) -> (f32, f32, f32) {
    let point = closest_point_on_aabb(point, bounds);
    let left = point.x - bounds.min_x;
    let right = bounds.max_x - point.x;
    let down = point.y - bounds.min_y;
    let up = bounds.max_y - point.y;

    if left <= right && left <= down && left <= up {
        (-1.0, 0.0, left)
    } else if right <= down && right <= up {
        (1.0, 0.0, right)
    } else if down <= up {
        (0.0, -1.0, down)
    } else {
        (0.0, 1.0, up)
    }
}

pub(super) fn fallback_contact_normal(a_center: Transform2D, b_center: Transform2D) -> (f32, f32) {
    let dx = b_center.x - a_center.x;
    let dy = b_center.y - a_center.y;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared <= RAY_EPSILON * RAY_EPSILON {
        return (1.0, 0.0);
    }

    let distance = distance_squared.sqrt();
    (dx / distance, dy / distance)
}

pub(super) fn closest_points_on_segments(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> ClosestPointPair {
    if segments_intersect(a_start, a_end, b_start, b_end) {
        if let Some(point) = segment_intersection_point(a_start, a_end, b_start, b_end) {
            return closest_point_pair(point, point);
        }
    }

    let mut closest =
        closest_point_pair(a_start, closest_point_on_segment(a_start, b_start, b_end));
    closest = closer_point_pair(
        closest,
        closest_point_pair(a_end, closest_point_on_segment(a_end, b_start, b_end)),
    );
    closest = closer_point_pair(
        closest,
        closest_point_pair(closest_point_on_segment(b_start, a_start, a_end), b_start),
    );
    closer_point_pair(
        closest,
        closest_point_pair(closest_point_on_segment(b_end, a_start, a_end), b_end),
    )
}

pub(super) fn segment_intersection_point(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> Option<Transform2D> {
    let rx = a_end.x - a_start.x;
    let ry = a_end.y - a_start.y;
    let sx = b_end.x - b_start.x;
    let sy = b_end.y - b_start.y;
    let denominator = rx * sy - ry * sx;
    if denominator.abs() <= RAY_EPSILON {
        return None;
    }

    let qpx = b_start.x - a_start.x;
    let qpy = b_start.y - a_start.y;
    let t = (qpx * sy - qpy * sx) / denominator;
    Some(Transform2D {
        x: a_start.x + rx * t,
        y: a_start.y + ry * t,
    })
}

fn closest_point_pair(a: Transform2D, b: Transform2D) -> ClosestPointPair {
    ClosestPointPair {
        a,
        b,
        distance_squared: point_distance_squared(a, b),
    }
}

fn closer_point_pair(a: ClosestPointPair, b: ClosestPointPair) -> ClosestPointPair {
    if b.distance_squared < a.distance_squared {
        b
    } else {
        a
    }
}

pub(super) fn segment_segment_distance_squared(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> f32 {
    if segments_intersect(a_start, a_end, b_start, b_end) {
        return 0.0;
    }

    point_segment_distance_squared(a_start, b_start, b_end)
        .min(point_segment_distance_squared(a_end, b_start, b_end))
        .min(point_segment_distance_squared(b_start, a_start, a_end))
        .min(point_segment_distance_squared(b_end, a_start, a_end))
}

pub(super) fn segments_intersect(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> bool {
    let a_length_squared = point_distance_squared(a_start, a_end);
    let b_length_squared = point_distance_squared(b_start, b_end);
    if a_length_squared <= RAY_EPSILON * RAY_EPSILON {
        return point_segment_distance_squared(a_start, b_start, b_end)
            <= RAY_EPSILON * RAY_EPSILON;
    }
    if b_length_squared <= RAY_EPSILON * RAY_EPSILON {
        return point_segment_distance_squared(b_start, a_start, a_end)
            <= RAY_EPSILON * RAY_EPSILON;
    }

    let ab_cross_c = cross_points(a_start, a_end, b_start);
    let ab_cross_d = cross_points(a_start, a_end, b_end);
    let cd_cross_a = cross_points(b_start, b_end, a_start);
    let cd_cross_b = cross_points(b_start, b_end, a_end);

    if ab_cross_c.abs() <= RAY_EPSILON && point_on_segment(b_start, a_start, a_end) {
        return true;
    }
    if ab_cross_d.abs() <= RAY_EPSILON && point_on_segment(b_end, a_start, a_end) {
        return true;
    }
    if cd_cross_a.abs() <= RAY_EPSILON && point_on_segment(a_start, b_start, b_end) {
        return true;
    }
    if cd_cross_b.abs() <= RAY_EPSILON && point_on_segment(a_end, b_start, b_end) {
        return true;
    }

    (ab_cross_c > 0.0) != (ab_cross_d > 0.0) && (cd_cross_a > 0.0) != (cd_cross_b > 0.0)
}

fn point_on_segment(point: Transform2D, start: Transform2D, end: Transform2D) -> bool {
    point.x >= start.x.min(end.x) - RAY_EPSILON
        && point.x <= start.x.max(end.x) + RAY_EPSILON
        && point.y >= start.y.min(end.y) - RAY_EPSILON
        && point.y <= start.y.max(end.y) + RAY_EPSILON
}

pub(super) fn cross_points(origin: Transform2D, a: Transform2D, b: Transform2D) -> f32 {
    let ax = a.x - origin.x;
    let ay = a.y - origin.y;
    let bx = b.x - origin.x;
    let by = b.y - origin.y;
    ax * by - ay * bx
}

pub(super) fn point_distance_squared(a: Transform2D, b: Transform2D) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    dx * dx + dy * dy
}

pub(super) fn ray_axis_entry_exit(
    start: f32,
    direction: f32,
    min: f32,
    max: f32,
) -> Option<AxisEntryExit> {
    if direction.abs() <= RAY_EPSILON {
        return (start >= min && start <= max).then_some(AxisEntryExit {
            entry: f32::NEG_INFINITY,
            exit: f32::INFINITY,
            normal: 0.0,
        });
    }
    let t1 = (min - start) / direction;
    let t2 = (max - start) / direction;
    if t1 <= t2 {
        Some(AxisEntryExit {
            entry: t1,
            exit: t2,
            normal: -1.0,
        })
    } else {
        Some(AxisEntryExit {
            entry: t2,
            exit: t1,
            normal: 1.0,
        })
    }
}

pub(super) fn normalized_direction(direction: Velocity) -> Option<(f32, f32)> {
    if !direction.vx.is_finite() || !direction.vy.is_finite() {
        return None;
    }
    let length = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    if length <= RAY_EPSILON {
        None
    } else {
        Some((direction.vx / length, direction.vy / length))
    }
}

pub(super) fn segment_direction_and_distance(
    start: Transform2D,
    end: Transform2D,
) -> Option<(Velocity, f32)> {
    if !start.x.is_finite() || !start.y.is_finite() || !end.x.is_finite() || !end.y.is_finite() {
        return None;
    }
    let direction = Velocity {
        vx: end.x - start.x,
        vy: end.y - start.y,
    };
    let max_distance = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    (max_distance > RAY_EPSILON).then_some((direction, max_distance))
}

pub(super) fn axis_entry_exit(start: f32, delta: f32, min: f32, max: f32) -> Option<AxisEntryExit> {
    if delta.abs() <= SWEPT_EPSILON {
        return (start >= min && start <= max).then_some(AxisEntryExit {
            entry: f32::NEG_INFINITY,
            exit: f32::INFINITY,
            normal: 0.0,
        });
    }
    let t1 = (min - start) / delta;
    let t2 = (max - start) / delta;
    if t1 <= t2 {
        Some(AxisEntryExit {
            entry: t1,
            exit: t2,
            normal: 1.0,
        })
    } else {
        Some(AxisEntryExit {
            entry: t2,
            exit: t1,
            normal: -1.0,
        })
    }
}
