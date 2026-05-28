use super::*;

pub(super) fn shape_cast_moving_segment_aabb(
    start: Transform2D,
    end: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let segment_length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if segment_length <= RAY_EPSILON {
        return raycast_bounds(start, unit_x, unit_y, max_distance, bounds);
    }

    let axis_x = -segment_y / segment_length;
    let axis_y = segment_x / segment_length;
    let mut entry = 0.0;
    let mut exit = max_distance;
    let mut normal_x = 0.0;
    let mut normal_y = 0.0;

    for axis in [(1.0, 0.0), (0.0, 1.0), (axis_x, axis_y)] {
        let segment_a = start.x * axis.0 + start.y * axis.1;
        let segment_b = end.x * axis.0 + end.y * axis.1;
        let segment_min = segment_a.min(segment_b);
        let segment_max = segment_a.max(segment_b);
        let (bounds_min, bounds_max) = project_aabb_onto_axis(bounds, axis.0, axis.1);
        let velocity = unit_x * axis.0 + unit_y * axis.1;
        let axis_hit = moving_axis_entry_exit(
            segment_min,
            segment_max,
            velocity,
            bounds_min,
            bounds_max,
            axis.0,
            axis.1,
        )?;
        if axis_hit.entry > entry {
            entry = axis_hit.entry;
            normal_x = axis_hit.normal_x;
            normal_y = axis_hit.normal_y;
        }
        exit = exit.min(axis_hit.exit);
        if entry > exit || exit < 0.0 || entry > max_distance {
            return None;
        }
    }

    Some(RaycastBoundsHit {
        distance: entry.max(0.0),
        normal_x,
        normal_y,
    })
}

pub(super) fn shape_cast_moving_segment_circle(
    start: Transform2D,
    end: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    circle_center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }
    let mut best = None;
    update_nearest_hit(
        &mut best,
        raycast_circle(start, unit_x, unit_y, max_distance, circle_center, radius),
    );
    update_nearest_hit(
        &mut best,
        raycast_circle(end, unit_x, unit_y, max_distance, circle_center, radius),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_segment_side_circle(
            start,
            end,
            unit_x,
            unit_y,
            max_distance,
            circle_center,
            radius,
        ),
    );
    best
}

fn shape_cast_segment_side_circle(
    start: Transform2D,
    end: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    circle_center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let segment_length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if segment_length <= RAY_EPSILON {
        return None;
    }

    let axis_x = segment_x / segment_length;
    let axis_y = segment_y / segment_length;
    let normal_axis_x = -axis_y;
    let normal_axis_y = axis_x;
    let center_x = circle_center.x - start.x;
    let center_y = circle_center.y - start.y;
    let segment_projection = center_x * axis_x + center_y * axis_y;
    let segment_projection_delta = -(unit_x * axis_x + unit_y * axis_y);
    let normal_projection = center_x * normal_axis_x + center_y * normal_axis_y;
    let normal_projection_delta = -(unit_x * normal_axis_x + unit_y * normal_axis_y);

    let mut entry = 0.0;
    let mut exit = max_distance;
    intersect_value_interval(
        &mut entry,
        &mut exit,
        segment_projection,
        segment_projection_delta,
        0.0,
        segment_length,
    )?;
    intersect_value_interval(
        &mut entry,
        &mut exit,
        normal_projection,
        normal_projection_delta,
        -radius,
        radius,
    )?;
    if entry > max_distance || exit < 0.0 {
        return None;
    }

    let distance = entry.max(0.0);
    let normal_projection_at_hit = normal_projection + normal_projection_delta * distance;
    let (normal_x, normal_y) = if normal_projection_at_hit.abs() > RAY_EPSILON {
        let scale = -normal_projection_at_hit.signum();
        (normal_axis_x * scale, normal_axis_y * scale)
    } else {
        (-unit_x, -unit_y)
    };
    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}
