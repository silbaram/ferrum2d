use super::bounds::aabb_bounds_vertices;
use super::overlap_primitives::capsule_overlaps_aabb;
use super::shape_projection::{
    convex_polygons_overlap, oriented_box_projection_radius, oriented_box_vertices,
};
use super::*;

pub(super) fn convex_polygon_overlaps_aabb(vertices: &[Transform2D], bounds: AabbBounds) -> bool {
    if !bounds.min_x.is_finite()
        || !bounds.min_y.is_finite()
        || !bounds.max_x.is_finite()
        || !bounds.max_y.is_finite()
        || bounds.min_x > bounds.max_x
        || bounds.min_y > bounds.max_y
    {
        return false;
    }
    let aabb_vertices = aabb_bounds_vertices(bounds);
    convex_polygons_overlap(vertices, &aabb_vertices)
}

pub(super) fn convex_polygon_overlaps_circle(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
) -> bool {
    if !center.x.is_finite() || !center.y.is_finite() || !is_valid_radius(radius) {
        return false;
    }
    if convex_polygon_contains_point(vertices, center) {
        return true;
    }

    let radius_squared = radius * radius;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        if point_segment_distance_squared(center, start, end) <= radius_squared {
            return true;
        }
    }
    false
}

pub(super) fn convex_polygon_overlaps_oriented_box(
    vertices: &[Transform2D],
    oriented_box: OrientedBoxGeometry,
) -> bool {
    let box_vertices = oriented_box_vertices(oriented_box);
    convex_polygons_overlap(vertices, &box_vertices)
}

pub(super) fn convex_polygon_overlaps_capsule(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> bool {
    if !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
        || !is_valid_radius(radius)
    {
        return false;
    }
    if convex_polygon_contains_point(vertices, start)
        || convex_polygon_contains_point(vertices, end)
    {
        return true;
    }

    let radius_squared = radius * radius;
    for index in 0..vertices.len() {
        let edge_start = vertices[index];
        let edge_end = vertices[(index + 1) % vertices.len()];
        if segment_segment_distance_squared(start, end, edge_start, edge_end) <= radius_squared {
            return true;
        }
    }
    false
}

pub(super) fn convex_polygon_contains_point(vertices: &[Transform2D], point: Transform2D) -> bool {
    if !point.x.is_finite() || !point.y.is_finite() {
        return false;
    }

    let mut winding = 0.0;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        let cross = cross_points(start, end, point);
        if cross.abs() <= RAY_EPSILON {
            continue;
        }
        if winding == 0.0 {
            winding = cross.signum();
        } else if cross.signum() != winding {
            return false;
        }
    }
    true
}

pub(super) fn oriented_box_overlaps_aabb(
    oriented_box: OrientedBoxGeometry,
    bounds: AabbBounds,
) -> bool {
    let Some(aabb_box) = oriented_box_geometry(
        Transform2D {
            x: (bounds.min_x + bounds.max_x) * 0.5,
            y: (bounds.min_y + bounds.max_y) * 0.5,
        },
        (bounds.max_x - bounds.min_x) * 0.5,
        (bounds.max_y - bounds.min_y) * 0.5,
        0.0,
    ) else {
        return false;
    };
    oriented_boxes_overlap(oriented_box, aabb_box)
}

pub(super) fn oriented_box_overlaps_circle(
    oriented_box: OrientedBoxGeometry,
    circle_center: Transform2D,
    radius: f32,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let dx = circle_center.x - oriented_box.center.x;
    let dy = circle_center.y - oriented_box.center.y;
    let local_x = dx * oriented_box.axis_x_x + dy * oriented_box.axis_x_y;
    let local_y = dx * oriented_box.axis_y_x + dy * oriented_box.axis_y_y;
    let closest_x = local_x.clamp(-oriented_box.half_width, oriented_box.half_width);
    let closest_y = local_y.clamp(-oriented_box.half_height, oriented_box.half_height);
    let separation_x = local_x - closest_x;
    let separation_y = local_y - closest_y;
    separation_x * separation_x + separation_y * separation_y <= radius * radius
}

pub(super) fn oriented_box_overlaps_capsule(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let Some(local_bounds) = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    ) else {
        return false;
    };
    capsule_overlaps_aabb(local_start, local_end, radius, local_bounds)
}

pub(super) fn oriented_box_contains_point(
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
    point: Transform2D,
) -> bool {
    let Some(oriented_box) =
        oriented_box_geometry(center, half_width, half_height, rotation_radians)
    else {
        return false;
    };
    let local_point = oriented_box_local_point(oriented_box, point);
    local_point.x.abs() <= oriented_box.half_width
        && local_point.y.abs() <= oriented_box.half_height
}

pub(super) fn oriented_boxes_overlap(a: OrientedBoxGeometry, b: OrientedBoxGeometry) -> bool {
    !oriented_box_axis_separates(a, b, a.axis_x_x, a.axis_x_y)
        && !oriented_box_axis_separates(a, b, a.axis_y_x, a.axis_y_y)
        && !oriented_box_axis_separates(a, b, b.axis_x_x, b.axis_x_y)
        && !oriented_box_axis_separates(a, b, b.axis_y_x, b.axis_y_y)
}

fn oriented_box_axis_separates(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    axis_x: f32,
    axis_y: f32,
) -> bool {
    let center_dx = b.center.x - a.center.x;
    let center_dy = b.center.y - a.center.y;
    let center_distance = (center_dx * axis_x + center_dy * axis_y).abs();
    let a_radius = oriented_box_projection_radius(a, axis_x, axis_y);
    let b_radius = oriented_box_projection_radius(b, axis_x, axis_y);
    center_distance > a_radius + b_radius
}
