use super::*;

pub(super) fn shape_cast_aabb_oriented_box(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let moving = oriented_box_geometry(reference, half_width, half_height, 0.0)?;
    shape_cast_oriented_box_oriented_box(moving, motion, target)
}

pub(super) fn shape_cast_circle_oriented_box(
    center: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_center = oriented_box_local_point(target, center);
    let (local_unit_x, local_unit_y) =
        oriented_box_local_vector(target, motion.unit_x, motion.unit_y);
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        target.half_width,
        target.half_height,
    )?;
    let local_hit = raycast_bounds(
        local_center,
        local_unit_x,
        local_unit_y,
        motion.max_distance,
        inflate_bounds(local_bounds, radius, radius),
    )?;
    Some(oriented_box_world_hit(target, local_hit))
}

pub(super) fn shape_cast_oriented_box_oriented_box(
    moving: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let local_center = oriented_box_local_point(target, moving.center);
    let (local_axis_x_x, local_axis_x_y) =
        oriented_box_local_vector(target, moving.axis_x_x, moving.axis_x_y);
    let local_moving = oriented_box_geometry(
        local_center,
        moving.half_width,
        moving.half_height,
        local_axis_x_y.atan2(local_axis_x_x),
    )?;
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        target.half_width,
        target.half_height,
    )?;
    let local_hit = shape_cast_oriented_box_aabb(
        local_moving,
        oriented_box_local_motion(target, motion),
        local_bounds,
    )?;
    Some(oriented_box_world_hit(target, local_hit))
}

pub(super) fn shape_cast_oriented_box_aabb(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let mut entry = 0.0;
    let mut exit = motion.max_distance;
    let mut normal_x = 0.0;
    let mut normal_y = 0.0;

    for axis in [
        (oriented_box.axis_x_x, oriented_box.axis_x_y),
        (oriented_box.axis_y_x, oriented_box.axis_y_y),
        (1.0, 0.0),
        (0.0, 1.0),
    ] {
        let moving_center = oriented_box.center.x * axis.0 + oriented_box.center.y * axis.1;
        let moving_radius = oriented_box_projection_radius(oriented_box, axis.0, axis.1);
        let (target_min, target_max) = project_aabb_onto_axis(bounds, axis.0, axis.1);
        let velocity = motion.unit_x * axis.0 + motion.unit_y * axis.1;
        let axis_hit = moving_axis_entry_exit(
            moving_center - moving_radius,
            moving_center + moving_radius,
            velocity,
            target_min,
            target_max,
            axis.0,
            axis.1,
        )?;
        if axis_hit.entry > entry {
            entry = axis_hit.entry;
            normal_x = axis_hit.normal_x;
            normal_y = axis_hit.normal_y;
        }
        exit = exit.min(axis_hit.exit);
        if entry > exit || exit < 0.0 || entry > motion.max_distance {
            return None;
        }
    }

    Some(RaycastBoundsHit {
        distance: entry.max(0.0),
        normal_x,
        normal_y,
    })
}

pub(super) fn shape_cast_oriented_box_circle(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    circle_center: Transform2D,
    circle_radius: f32,
) -> Option<RaycastBoundsHit> {
    let dx = circle_center.x - oriented_box.center.x;
    let dy = circle_center.y - oriented_box.center.y;
    let local_circle_center = Transform2D {
        x: dx * oriented_box.axis_x_x + dy * oriented_box.axis_x_y,
        y: dx * oriented_box.axis_y_x + dy * oriented_box.axis_y_y,
    };
    let local_unit_x =
        motion.unit_x * oriented_box.axis_x_x + motion.unit_y * oriented_box.axis_x_y;
    let local_unit_y =
        motion.unit_x * oriented_box.axis_y_x + motion.unit_y * oriented_box.axis_y_y;
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let local_hit = shape_cast_aabb_circle(
        Transform2D { x: 0.0, y: 0.0 },
        local_bounds,
        local_unit_x,
        local_unit_y,
        motion.max_distance,
        local_circle_center,
        circle_radius,
    )?;

    Some(RaycastBoundsHit {
        distance: local_hit.distance,
        normal_x: local_hit.normal_x * oriented_box.axis_x_x
            + local_hit.normal_y * oriented_box.axis_y_x,
        normal_y: local_hit.normal_x * oriented_box.axis_x_y
            + local_hit.normal_y * oriented_box.axis_y_y,
    })
}
