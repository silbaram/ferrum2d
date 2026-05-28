use super::convex_polygon::{invert_raycast_hit_normal, shape_cast_circle_convex_polygon};
use super::oriented_box::{shape_cast_oriented_box_aabb, shape_cast_oriented_box_circle};
use super::segment::{shape_cast_moving_segment_aabb, shape_cast_moving_segment_circle};
use super::*;

pub(super) fn shape_cast_capsule_convex_polygon(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) || !convex_polygon_is_valid(target_vertices) {
        return None;
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_circle_convex_polygon(start, radius, motion, target_vertices),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_circle_convex_polygon(end, radius, motion, target_vertices),
    );
    for index in 0..target_vertices.len() {
        let edge_start = target_vertices[index];
        let edge_end = target_vertices[(index + 1) % target_vertices.len()];
        update_nearest_hit(
            &mut best,
            shape_cast_moving_segment_capsule_side(
                start, end, motion, edge_start, edge_end, radius,
            ),
        );
        update_nearest_hit(
            &mut best,
            shape_cast_moving_segment_circle(
                start,
                end,
                motion.unit_x,
                motion.unit_y,
                motion.max_distance,
                edge_start,
                radius,
            ),
        );
    }
    best
}

pub(super) fn shape_cast_convex_polygon_capsule(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let reverse_motion = ShapeCastMotion {
        unit_x: -motion.unit_x,
        unit_y: -motion.unit_y,
        max_distance: motion.max_distance,
    };
    let hit =
        shape_cast_capsule_convex_polygon(start, end, radius, reverse_motion, moving_vertices)?;
    Some(invert_raycast_hit_normal(hit))
}

pub(super) fn shape_cast_capsule_oriented_box(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        target.half_width,
        target.half_height,
    )?;
    let local_motion = oriented_box_local_motion(target, motion);
    let local_hit = shape_cast_capsule_aabb(
        oriented_box_local_point(target, start),
        oriented_box_local_point(target, end),
        radius,
        local_motion.unit_x,
        local_motion.unit_y,
        motion.max_distance,
        local_bounds,
    )?;
    Some(oriented_box_world_hit(target, local_hit))
}

pub(super) fn shape_cast_capsule_aabb(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let mut best = None;
    let vertical_strip = AabbBounds {
        min_x: bounds.min_x - radius,
        min_y: bounds.min_y,
        max_x: bounds.max_x + radius,
        max_y: bounds.max_y,
    };
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_aabb(start, end, unit_x, unit_y, max_distance, vertical_strip),
    );

    let horizontal_strip = AabbBounds {
        min_x: bounds.min_x,
        min_y: bounds.min_y - radius,
        max_x: bounds.max_x,
        max_y: bounds.max_y + radius,
    };
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_aabb(start, end, unit_x, unit_y, max_distance, horizontal_strip),
    );

    for corner in aabb_corners(bounds) {
        update_nearest_hit(
            &mut best,
            shape_cast_moving_segment_circle(
                start,
                end,
                unit_x,
                unit_y,
                max_distance,
                corner,
                radius,
            ),
        );
    }
    best
}

pub(super) fn shape_cast_aabb_capsule(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(capsule_radius) {
        return None;
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_aabb_circle(
            reference,
            bounds,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            capsule_start,
            capsule_radius,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_aabb_circle(
            reference,
            bounds,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            capsule_end,
            capsule_radius,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_aabb_capsule_side(
            reference,
            bounds,
            motion,
            capsule_start,
            capsule_end,
            capsule_radius,
        ),
    );
    best
}

pub(super) fn shape_cast_circle_capsule(
    center: Transform2D,
    circle_radius: f32,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(circle_radius) || !is_valid_radius(capsule_radius) {
        return None;
    }
    raycast_capsule(
        center,
        motion.unit_x,
        motion.unit_y,
        motion.max_distance,
        capsule_start,
        capsule_end,
        circle_radius + capsule_radius,
    )
}

pub(super) fn shape_cast_oriented_box_capsule(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(capsule_radius) {
        return None;
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_oriented_box_circle(oriented_box, motion, capsule_start, capsule_radius),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_oriented_box_circle(oriented_box, motion, capsule_end, capsule_radius),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_oriented_box_capsule_side(
            oriented_box,
            motion,
            capsule_start,
            capsule_end,
            capsule_radius,
        ),
    );
    best
}

pub(super) fn shape_cast_capsule_capsule(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target_start: Transform2D,
    target_end: Transform2D,
    target_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) || !is_valid_radius(target_radius) {
        return None;
    }

    let radius_sum = radius + target_radius;
    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_circle(
            start,
            end,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            target_start,
            radius_sum,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_circle(
            start,
            end,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            target_end,
            radius_sum,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_capsule_side(
            start,
            end,
            motion,
            target_start,
            target_end,
            radius_sum,
        ),
    );
    best
}

pub(super) fn shape_cast_aabb_capsule_side(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    let frame = segment_frame(capsule_start, capsule_end)?;
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let local_oriented_box = oriented_box_geometry(
        segment_frame_local_point(frame, reference),
        half_width,
        half_height,
        (-frame.axis_y).atan2(frame.axis_x),
    )?;
    let local_hit = shape_cast_oriented_box_aabb(
        local_oriented_box,
        segment_frame_local_motion(frame, motion),
        capsule_side_bounds(frame.length, capsule_radius),
    )?;
    Some(segment_frame_world_hit(frame, local_hit))
}

pub(super) fn shape_cast_oriented_box_capsule_side(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    let frame = segment_frame(capsule_start, capsule_end)?;
    let local_axis_x_x =
        oriented_box.axis_x_x * frame.axis_x + oriented_box.axis_x_y * frame.axis_y;
    let local_axis_x_y =
        oriented_box.axis_x_x * frame.normal_x + oriented_box.axis_x_y * frame.normal_y;
    let local_oriented_box = oriented_box_geometry(
        segment_frame_local_point(frame, oriented_box.center),
        oriented_box.half_width,
        oriented_box.half_height,
        local_axis_x_y.atan2(local_axis_x_x),
    )?;
    let local_hit = shape_cast_oriented_box_aabb(
        local_oriented_box,
        segment_frame_local_motion(frame, motion),
        capsule_side_bounds(frame.length, capsule_radius),
    )?;
    Some(segment_frame_world_hit(frame, local_hit))
}

pub(super) fn shape_cast_moving_segment_capsule_side(
    start: Transform2D,
    end: Transform2D,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let frame = segment_frame(capsule_start, capsule_end)?;
    let local_start = segment_frame_local_point(frame, start);
    let local_end = segment_frame_local_point(frame, end);
    let local_motion = segment_frame_local_motion(frame, motion);
    let local_hit = shape_cast_moving_segment_aabb(
        local_start,
        local_end,
        local_motion.unit_x,
        local_motion.unit_y,
        local_motion.max_distance,
        capsule_side_bounds(frame.length, radius),
    )?;
    Some(segment_frame_world_hit(frame, local_hit))
}
