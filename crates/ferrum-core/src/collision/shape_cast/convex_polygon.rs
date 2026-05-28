use super::*;

pub(super) fn shape_cast_aabb_convex_polygon(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let moving_bounds = AabbBounds::from_center(reference, half_width, half_height)?;
    let moving_vertices = aabb_bounds_vertices(moving_bounds);
    shape_cast_convex_polygon_convex_polygon(&moving_vertices, motion, target_vertices)
}

pub(super) fn shape_cast_circle_convex_polygon(
    center: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) || !convex_polygon_is_valid(target_vertices) {
        return None;
    }

    let mut best = None;
    for index in 0..target_vertices.len() {
        let start = target_vertices[index];
        let end = target_vertices[(index + 1) % target_vertices.len()];
        update_nearest_hit(
            &mut best,
            raycast_capsule(
                center,
                motion.unit_x,
                motion.unit_y,
                motion.max_distance,
                start,
                end,
                radius,
            ),
        );
    }
    best
}

pub(super) fn shape_cast_oriented_box_convex_polygon(
    moving: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    let moving_vertices = oriented_box_vertices(moving);
    shape_cast_convex_polygon_convex_polygon(&moving_vertices, motion, target_vertices)
}

pub(super) fn shape_cast_convex_polygon_aabb(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    target_bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let target_vertices = aabb_bounds_vertices(target_bounds);
    shape_cast_convex_polygon_convex_polygon(moving_vertices, motion, &target_vertices)
}

pub(super) fn shape_cast_convex_polygon_circle(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let reverse_motion = ShapeCastMotion {
        unit_x: -motion.unit_x,
        unit_y: -motion.unit_y,
        max_distance: motion.max_distance,
    };
    let hit = shape_cast_circle_convex_polygon(center, radius, reverse_motion, moving_vertices)?;
    Some(invert_raycast_hit_normal(hit))
}

pub(super) fn shape_cast_convex_polygon_oriented_box(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let target_vertices = oriented_box_vertices(target);
    shape_cast_convex_polygon_convex_polygon(moving_vertices, motion, &target_vertices)
}

pub(super) fn shape_cast_convex_polygon_convex_polygon(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !convex_polygon_is_valid(moving_vertices) || !convex_polygon_is_valid(target_vertices) {
        return None;
    }
    if convex_polygons_overlap(moving_vertices, target_vertices) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let mut entry = 0.0;
    let mut exit = motion.max_distance;
    let mut normal_x = 0.0;
    let mut normal_y = 0.0;

    shape_cast_convex_polygon_axes(
        moving_vertices,
        moving_vertices,
        target_vertices,
        motion,
        &mut entry,
        &mut exit,
        &mut normal_x,
        &mut normal_y,
    )?;
    shape_cast_convex_polygon_axes(
        target_vertices,
        moving_vertices,
        target_vertices,
        motion,
        &mut entry,
        &mut exit,
        &mut normal_x,
        &mut normal_y,
    )?;

    if entry > exit || exit < 0.0 || entry > motion.max_distance {
        return None;
    }

    Some(RaycastBoundsHit {
        distance: entry.max(0.0),
        normal_x,
        normal_y,
    })
}

pub(super) fn invert_raycast_hit_normal(hit: RaycastBoundsHit) -> RaycastBoundsHit {
    RaycastBoundsHit {
        distance: hit.distance,
        normal_x: -hit.normal_x,
        normal_y: -hit.normal_y,
    }
}

#[allow(clippy::too_many_arguments)]
fn shape_cast_convex_polygon_axes(
    axis_source: &[Transform2D],
    moving_vertices: &[Transform2D],
    target_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    entry: &mut f32,
    exit: &mut f32,
    normal_x: &mut f32,
    normal_y: &mut f32,
) -> Option<()> {
    for index in 0..axis_source.len() {
        let start = axis_source[index];
        let end = axis_source[(index + 1) % axis_source.len()];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        let axis_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
        if axis_length <= RAY_EPSILON {
            continue;
        }
        let axis_x = -edge_y / axis_length;
        let axis_y = edge_x / axis_length;
        let (moving_min, moving_max) = project_vertices(moving_vertices, axis_x, axis_y);
        let (target_min, target_max) = project_vertices(target_vertices, axis_x, axis_y);
        let velocity = motion.unit_x * axis_x + motion.unit_y * axis_y;
        let axis_hit = moving_axis_entry_exit(
            moving_min, moving_max, velocity, target_min, target_max, axis_x, axis_y,
        )?;
        if axis_hit.entry > *entry {
            *entry = axis_hit.entry;
            *normal_x = axis_hit.normal_x;
            *normal_y = axis_hit.normal_y;
        }
        *exit = (*exit).min(axis_hit.exit);
        if *entry > *exit || *exit < 0.0 || *entry > motion.max_distance {
            return None;
        }
    }
    Some(())
}
