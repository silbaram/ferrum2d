use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct RaycastBoundsHit {
    pub(super) distance: f32,
    pub(super) normal_x: f32,
    pub(super) normal_y: f32,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct ShapeCastMotion {
    pub(super) unit_x: f32,
    pub(super) unit_y: f32,
    pub(super) max_distance: f32,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct MovingAxisEntryExit {
    pub(super) entry: f32,
    pub(super) exit: f32,
    pub(super) normal_x: f32,
    pub(super) normal_y: f32,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct SegmentFrame {
    pub(super) origin: Transform2D,
    pub(super) axis_x: f32,
    pub(super) axis_y: f32,
    pub(super) normal_x: f32,
    pub(super) normal_y: f32,
    pub(super) length: f32,
}

pub(super) fn previous_transform(
    transform: Transform2D,
    velocity: Velocity,
    delta: f32,
) -> Transform2D {
    Transform2D {
        x: transform.x - velocity.vx * delta,
        y: transform.y - velocity.vy * delta,
    }
}

pub(super) fn raycast_shape(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Option<RaycastBoundsHit> {
    match shape {
        ColliderShapeRef::Aabb(collider) => raycast_bounds(
            origin,
            unit_x,
            unit_y,
            max_distance,
            AabbBounds::from_transform(transform, collider),
        ),
        ColliderShapeRef::Circle(collider) => raycast_circle(
            origin,
            unit_x,
            unit_y,
            max_distance,
            collider.center(transform),
            collider.radius,
        ),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => raycast_oriented_box(
            origin,
            unit_x,
            unit_y,
            max_distance,
            oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            )?,
        ),
        ColliderShapeRef::Capsule(collider) => raycast_capsule(
            origin,
            unit_x,
            unit_y,
            max_distance,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => raycast_edge(
            origin,
            unit_x,
            unit_y,
            max_distance,
            collider.start(transform),
            collider.end(transform),
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)?;
            raycast_convex_polygon(
                origin,
                unit_x,
                unit_y,
                max_distance,
                &vertices[..vertex_count],
            )
        }
    }
}

pub(super) fn project_aabb_onto_axis(bounds: AabbBounds, axis_x: f32, axis_y: f32) -> (f32, f32) {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for corner in aabb_corners(bounds) {
        let projection = corner.x * axis_x + corner.y * axis_y;
        min = min.min(projection);
        max = max.max(projection);
    }
    (min, max)
}

pub(super) fn moving_axis_entry_exit(
    moving_min: f32,
    moving_max: f32,
    velocity: f32,
    target_min: f32,
    target_max: f32,
    axis_x: f32,
    axis_y: f32,
) -> Option<MovingAxisEntryExit> {
    if velocity.abs() <= RAY_EPSILON {
        return (moving_max >= target_min && moving_min <= target_max).then_some(
            MovingAxisEntryExit {
                entry: f32::NEG_INFINITY,
                exit: f32::INFINITY,
                normal_x: 0.0,
                normal_y: 0.0,
            },
        );
    }

    if velocity > 0.0 {
        Some(MovingAxisEntryExit {
            entry: (target_min - moving_max) / velocity,
            exit: (target_max - moving_min) / velocity,
            normal_x: -axis_x,
            normal_y: -axis_y,
        })
    } else {
        Some(MovingAxisEntryExit {
            entry: (target_max - moving_min) / velocity,
            exit: (target_min - moving_max) / velocity,
            normal_x: axis_x,
            normal_y: axis_y,
        })
    }
}

pub(super) fn intersect_value_interval(
    entry: &mut f32,
    exit: &mut f32,
    value: f32,
    delta: f32,
    min: f32,
    max: f32,
) -> Option<()> {
    if delta.abs() <= RAY_EPSILON {
        return (value >= min && value <= max).then_some(());
    }

    let t1 = (min - value) / delta;
    let t2 = (max - value) / delta;
    *entry = entry.max(t1.min(t2));
    *exit = exit.min(t1.max(t2));
    (*entry <= *exit).then_some(())
}

pub(super) fn segment_frame(start: Transform2D, end: Transform2D) -> Option<SegmentFrame> {
    if !start.x.is_finite() || !start.y.is_finite() || !end.x.is_finite() || !end.y.is_finite() {
        return None;
    }
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if length <= RAY_EPSILON {
        return None;
    }

    let axis_x = segment_x / length;
    let axis_y = segment_y / length;
    Some(SegmentFrame {
        origin: start,
        axis_x,
        axis_y,
        normal_x: -axis_y,
        normal_y: axis_x,
        length,
    })
}

pub(super) fn segment_frame_local_point(frame: SegmentFrame, point: Transform2D) -> Transform2D {
    let dx = point.x - frame.origin.x;
    let dy = point.y - frame.origin.y;
    Transform2D {
        x: dx * frame.axis_x + dy * frame.axis_y,
        y: dx * frame.normal_x + dy * frame.normal_y,
    }
}

pub(super) fn segment_frame_local_motion(
    frame: SegmentFrame,
    motion: ShapeCastMotion,
) -> ShapeCastMotion {
    ShapeCastMotion {
        unit_x: motion.unit_x * frame.axis_x + motion.unit_y * frame.axis_y,
        unit_y: motion.unit_x * frame.normal_x + motion.unit_y * frame.normal_y,
        max_distance: motion.max_distance,
    }
}

pub(super) fn segment_frame_world_hit(
    frame: SegmentFrame,
    hit: RaycastBoundsHit,
) -> RaycastBoundsHit {
    RaycastBoundsHit {
        distance: hit.distance,
        normal_x: hit.normal_x * frame.axis_x + hit.normal_y * frame.normal_x,
        normal_y: hit.normal_x * frame.axis_y + hit.normal_y * frame.normal_y,
    }
}

pub(super) fn shape_cast_aabb_circle(
    reference: Transform2D,
    bounds: AabbBounds,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    circle_center: Transform2D,
    circle_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(circle_radius) {
        return None;
    }
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let mut best: Option<RaycastBoundsHit> = None;

    let vertical_strip = AabbBounds {
        min_x: circle_center.x - half_width - circle_radius,
        min_y: circle_center.y - half_height,
        max_x: circle_center.x + half_width + circle_radius,
        max_y: circle_center.y + half_height,
    };
    update_nearest_hit(
        &mut best,
        raycast_bounds(reference, unit_x, unit_y, max_distance, vertical_strip),
    );

    let horizontal_strip = AabbBounds {
        min_x: circle_center.x - half_width,
        min_y: circle_center.y - half_height - circle_radius,
        max_x: circle_center.x + half_width,
        max_y: circle_center.y + half_height + circle_radius,
    };
    update_nearest_hit(
        &mut best,
        raycast_bounds(reference, unit_x, unit_y, max_distance, horizontal_strip),
    );

    for corner_x in [circle_center.x - half_width, circle_center.x + half_width] {
        for corner_y in [circle_center.y - half_height, circle_center.y + half_height] {
            update_nearest_hit(
                &mut best,
                raycast_circle(
                    reference,
                    unit_x,
                    unit_y,
                    max_distance,
                    Transform2D {
                        x: corner_x,
                        y: corner_y,
                    },
                    circle_radius,
                ),
            );
        }
    }

    best
}

pub(super) fn update_nearest_hit(
    best: &mut Option<RaycastBoundsHit>,
    next: Option<RaycastBoundsHit>,
) {
    let Some(next) = next else {
        return;
    };
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.normal_x.total_cmp(&current.normal_x))
            .then_with(|| next.normal_y.total_cmp(&current.normal_y))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

pub(super) fn raycast_bounds(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    if bounds.contains_point(origin) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let x = ray_axis_entry_exit(origin.x, unit_x, bounds.min_x, bounds.max_x)?;
    let y = ray_axis_entry_exit(origin.y, unit_y, bounds.min_y, bounds.max_y)?;
    let entry = x.entry.max(y.entry);
    let exit = x.exit.min(y.exit);
    if entry > exit || exit < 0.0 || entry > max_distance {
        return None;
    }

    let distance = entry.max(0.0);
    let (normal_x, normal_y) = if x.entry > y.entry {
        (x.normal, 0.0)
    } else if y.entry > x.entry {
        (0.0, y.normal)
    } else if unit_x.abs() >= unit_y.abs() {
        (x.normal, 0.0)
    } else {
        (0.0, y.normal)
    };

    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

pub(super) fn raycast_oriented_box(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    oriented_box: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let local_origin = oriented_box_local_point(oriented_box, origin);
    let local_unit_x = unit_x * oriented_box.axis_x_x + unit_y * oriented_box.axis_x_y;
    let local_unit_y = unit_x * oriented_box.axis_y_x + unit_y * oriented_box.axis_y_y;
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let hit = raycast_bounds(
        local_origin,
        local_unit_x,
        local_unit_y,
        max_distance,
        local_bounds,
    )?;
    Some(RaycastBoundsHit {
        distance: hit.distance,
        normal_x: hit.normal_x * oriented_box.axis_x_x + hit.normal_y * oriented_box.axis_y_x,
        normal_y: hit.normal_x * oriented_box.axis_x_y + hit.normal_y * oriented_box.axis_y_y,
    })
}

pub(super) fn raycast_circle(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }
    if circle_contains_point(center, radius, origin) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let origin_to_center_x = origin.x - center.x;
    let origin_to_center_y = origin.y - center.y;
    let projection = origin_to_center_x * unit_x + origin_to_center_y * unit_y;
    let center_distance_squared =
        origin_to_center_x * origin_to_center_x + origin_to_center_y * origin_to_center_y;
    let discriminant = projection * projection - center_distance_squared + radius * radius;
    if discriminant < 0.0 {
        return None;
    }

    let distance = -projection - discriminant.sqrt();
    if distance < 0.0 || distance > max_distance {
        return None;
    }
    let point_x = origin.x + unit_x * distance;
    let point_y = origin.y + unit_y * distance;
    let normal_x = (point_x - center.x) / radius;
    let normal_y = (point_y - center.y) / radius;
    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

pub(super) fn raycast_capsule(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius)
        || !origin.x.is_finite()
        || !origin.y.is_finite()
        || !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
    {
        return None;
    }
    if point_segment_distance_squared(origin, start, end) <= radius * radius {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        raycast_circle(origin, unit_x, unit_y, max_distance, start, radius),
    );
    update_nearest_hit(
        &mut best,
        raycast_circle(origin, unit_x, unit_y, max_distance, end, radius),
    );
    update_nearest_hit(
        &mut best,
        raycast_capsule_side(origin, unit_x, unit_y, max_distance, start, end, radius),
    );
    best
}

pub(super) fn raycast_edge(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    start: Transform2D,
    end: Transform2D,
) -> Option<RaycastBoundsHit> {
    if !origin.x.is_finite()
        || !origin.y.is_finite()
        || !unit_x.is_finite()
        || !unit_y.is_finite()
        || !max_distance.is_finite()
        || max_distance < 0.0
        || !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
    {
        return None;
    }
    if point_segment_distance_squared(origin, start, end)
        <= EDGE_COLLIDER_RADIUS * EDGE_COLLIDER_RADIUS
    {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let edge_x = end.x - start.x;
    let edge_y = end.y - start.y;
    let edge_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
    if edge_length <= RAY_EPSILON {
        return None;
    }

    let denominator = unit_x * edge_y - unit_y * edge_x;
    if denominator.abs() <= RAY_EPSILON {
        return None;
    }

    let origin_to_start_x = start.x - origin.x;
    let origin_to_start_y = start.y - origin.y;
    let distance = (origin_to_start_x * edge_y - origin_to_start_y * edge_x) / denominator;
    let edge_fraction = (origin_to_start_x * unit_y - origin_to_start_y * unit_x) / denominator;
    if distance < 0.0
        || distance > max_distance
        || !(-RAY_EPSILON..=1.0 + RAY_EPSILON).contains(&edge_fraction)
    {
        return None;
    }

    let mut normal_x = edge_y / edge_length;
    let mut normal_y = -edge_x / edge_length;
    if normal_x * unit_x + normal_y * unit_y > 0.0 {
        normal_x = -normal_x;
        normal_y = -normal_y;
    }
    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

pub(super) fn raycast_convex_polygon(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !origin.x.is_finite()
        || !origin.y.is_finite()
        || !unit_x.is_finite()
        || !unit_y.is_finite()
        || !max_distance.is_finite()
        || max_distance < 0.0
        || !convex_polygon_is_valid(vertices)
    {
        return None;
    }
    if convex_polygon_contains_point(vertices, origin) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let is_ccw = convex_polygon_signed_area(vertices) > 0.0;
    let mut best = None;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        let denominator = unit_x * edge_y - unit_y * edge_x;
        if denominator.abs() <= RAY_EPSILON {
            continue;
        }

        let origin_to_start_x = start.x - origin.x;
        let origin_to_start_y = start.y - origin.y;
        let distance = (origin_to_start_x * edge_y - origin_to_start_y * edge_x) / denominator;
        let edge_fraction = (origin_to_start_x * unit_y - origin_to_start_y * unit_x) / denominator;
        if distance < 0.0
            || distance > max_distance
            || !(-RAY_EPSILON..=1.0 + RAY_EPSILON).contains(&edge_fraction)
        {
            continue;
        }

        let edge_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
        if edge_length <= RAY_EPSILON {
            continue;
        }
        let (mut normal_x, mut normal_y) = if is_ccw {
            (edge_y / edge_length, -edge_x / edge_length)
        } else {
            (-edge_y / edge_length, edge_x / edge_length)
        };
        if normal_x * unit_x + normal_y * unit_y > 0.0 {
            normal_x = -normal_x;
            normal_y = -normal_y;
        }
        update_nearest_hit(
            &mut best,
            Some(RaycastBoundsHit {
                distance,
                normal_x,
                normal_y,
            }),
        );
    }

    best
}

pub(super) fn convex_polygon_signed_area(vertices: &[Transform2D]) -> f32 {
    let mut area = 0.0;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        area += start.x * end.y - start.y * end.x;
    }
    area * 0.5
}

pub(super) fn raycast_capsule_side(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    start: Transform2D,
    end: Transform2D,
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
    let origin_x = origin.x - start.x;
    let origin_y = origin.y - start.y;
    let segment_projection = origin_x * axis_x + origin_y * axis_y;
    let segment_projection_delta = unit_x * axis_x + unit_y * axis_y;
    let normal_projection = origin_x * normal_axis_x + origin_y * normal_axis_y;
    let normal_projection_delta = unit_x * normal_axis_x + unit_y * normal_axis_y;

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
        let scale = normal_projection_at_hit.signum();
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
