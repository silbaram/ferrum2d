use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct OrientedBoxGeometry {
    pub(super) center: Transform2D,
    pub(super) half_width: f32,
    pub(super) half_height: f32,
    pub(super) axis_x_x: f32,
    pub(super) axis_x_y: f32,
    pub(super) axis_y_x: f32,
    pub(super) axis_y_y: f32,
}
pub(super) fn aabb_as_oriented_box(bounds: AabbBounds) -> Option<OrientedBoxGeometry> {
    oriented_box_geometry(
        aabb_center(bounds),
        (bounds.max_x - bounds.min_x) * 0.5,
        (bounds.max_y - bounds.min_y) * 0.5,
        0.0,
    )
}

pub(super) fn oriented_box_geometry(
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> Option<OrientedBoxGeometry> {
    if !center.x.is_finite()
        || !center.y.is_finite()
        || !is_valid_half_extent(half_width)
        || !is_valid_half_extent(half_height)
        || !rotation_radians.is_finite()
    {
        return None;
    }
    let (sin, cos) = rotation_radians.sin_cos();
    Some(OrientedBoxGeometry {
        center,
        half_width,
        half_height,
        axis_x_x: cos,
        axis_x_y: sin,
        axis_y_x: -sin,
        axis_y_y: cos,
    })
}

pub(super) fn oriented_box_local_point(
    oriented_box: OrientedBoxGeometry,
    point: Transform2D,
) -> Transform2D {
    let dx = point.x - oriented_box.center.x;
    let dy = point.y - oriented_box.center.y;
    Transform2D {
        x: dx * oriented_box.axis_x_x + dy * oriented_box.axis_x_y,
        y: dx * oriented_box.axis_y_x + dy * oriented_box.axis_y_y,
    }
}

pub(super) fn oriented_box_world_point(
    oriented_box: OrientedBoxGeometry,
    local_point: Transform2D,
) -> Transform2D {
    Transform2D {
        x: oriented_box.center.x
            + local_point.x * oriented_box.axis_x_x
            + local_point.y * oriented_box.axis_y_x,
        y: oriented_box.center.y
            + local_point.x * oriented_box.axis_x_y
            + local_point.y * oriented_box.axis_y_y,
    }
}

pub(super) fn oriented_box_local_vector(
    oriented_box: OrientedBoxGeometry,
    vector_x: f32,
    vector_y: f32,
) -> (f32, f32) {
    (
        vector_x * oriented_box.axis_x_x + vector_y * oriented_box.axis_x_y,
        vector_x * oriented_box.axis_y_x + vector_y * oriented_box.axis_y_y,
    )
}

pub(super) fn oriented_box_world_vector(
    oriented_box: OrientedBoxGeometry,
    local_x: f32,
    local_y: f32,
) -> (f32, f32) {
    (
        local_x * oriented_box.axis_x_x + local_y * oriented_box.axis_y_x,
        local_x * oriented_box.axis_x_y + local_y * oriented_box.axis_y_y,
    )
}

pub(super) fn oriented_box_local_motion(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
) -> ShapeCastMotion {
    let (unit_x, unit_y) = oriented_box_local_vector(oriented_box, motion.unit_x, motion.unit_y);
    ShapeCastMotion {
        unit_x,
        unit_y,
        max_distance: motion.max_distance,
    }
}

pub(super) fn oriented_box_world_hit(
    oriented_box: OrientedBoxGeometry,
    hit: RaycastBoundsHit,
) -> RaycastBoundsHit {
    let (normal_x, normal_y) = oriented_box_world_vector(oriented_box, hit.normal_x, hit.normal_y);
    RaycastBoundsHit {
        distance: hit.distance,
        normal_x,
        normal_y,
    }
}

pub(super) fn nearest_point_on_oriented_box(
    point: Transform2D,
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> Option<(f32, f32, f32)> {
    let oriented_box = oriented_box_geometry(center, half_width, half_height, rotation_radians)?;
    let local_point = oriented_box_local_point(oriented_box, point);
    let closest_local = Transform2D {
        x: local_point
            .x
            .clamp(-oriented_box.half_width, oriented_box.half_width),
        y: local_point
            .y
            .clamp(-oriented_box.half_height, oriented_box.half_height),
    };
    if closest_local == local_point {
        return Some((0.0, point.x, point.y));
    }

    let closest = oriented_box_world_point(oriented_box, closest_local);
    let dx = point.x - closest.x;
    let dy = point.y - closest.y;
    let distance = (dx * dx + dy * dy).sqrt();
    distance
        .is_finite()
        .then_some((distance, closest.x, closest.y))
}
