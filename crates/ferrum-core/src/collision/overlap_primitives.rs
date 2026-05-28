use super::*;

pub(super) fn circle_contains_point(center: Transform2D, radius: f32, point: Transform2D) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let dx = point.x - center.x;
    let dy = point.y - center.y;
    dx * dx + dy * dy <= radius * radius
}

pub(super) fn circles_overlap(
    a: Transform2D,
    a_radius: f32,
    b: Transform2D,
    b_radius: f32,
) -> bool {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return false;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let radius_sum = a_radius + b_radius;
    dx * dx + dy * dy <= radius_sum * radius_sum
}

pub(super) fn aabb_overlaps_circle(
    at: Transform2D,
    ac: AabbCollider,
    center: Transform2D,
    radius: f32,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let bounds = AabbBounds::from_transform(at, ac);
    circle_overlaps_aabb(center, radius, bounds)
}

pub(super) fn circle_overlaps_aabb(center: Transform2D, radius: f32, bounds: AabbBounds) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let closest_x = center.x.clamp(bounds.min_x, bounds.max_x);
    let closest_y = center.y.clamp(bounds.min_y, bounds.max_y);
    let dx = center.x - closest_x;
    let dy = center.y - closest_y;
    dx * dx + dy * dy <= radius * radius
}

pub(super) fn capsule_overlaps_aabb(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    bounds: AabbBounds,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    if segment_intersects_aabb(start, end, bounds) {
        return true;
    }

    let radius_squared = radius * radius;
    if point_aabb_distance_squared(start, bounds) <= radius_squared
        || point_aabb_distance_squared(end, bounds) <= radius_squared
    {
        return true;
    }

    for corner in aabb_corners(bounds) {
        if point_segment_distance_squared(corner, start, end) <= radius_squared {
            return true;
        }
    }
    false
}

pub(super) fn capsule_overlaps_circle(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    circle_center: Transform2D,
    circle_radius: f32,
) -> bool {
    if !is_valid_radius(radius) || !is_valid_radius(circle_radius) {
        return false;
    }
    let radius_sum = radius + circle_radius;
    point_segment_distance_squared(circle_center, start, end) <= radius_sum * radius_sum
}

pub(super) fn capsules_overlap(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
) -> bool {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return false;
    }
    let radius_sum = a_radius + b_radius;
    segment_segment_distance_squared(a_start, a_end, b_start, b_end) <= radius_sum * radius_sum
}
