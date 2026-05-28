use super::*;

pub(super) fn aabb_aabb_contact_manifold_points(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let a_bounds = AabbBounds::from_transform(at, ac);
    let b_bounds = AabbBounds::from_transform(bt, bc);
    let a_center = ac.center(at);
    if contact.normal_x != 0.0 {
        let min_y = a_bounds.min_y.max(b_bounds.min_y);
        let max_y = a_bounds.max_y.min(b_bounds.max_y);
        let face_x = a_center.x + contact.normal_x * ac.half_width;
        two_or_one_contact_manifold_points(face_x, min_y, face_x, max_y, contact.penetration)
    } else {
        let min_x = a_bounds.min_x.max(b_bounds.min_x);
        let max_x = a_bounds.max_x.min(b_bounds.max_x);
        let face_y = a_center.y + contact.normal_y * ac.half_height;
        two_or_one_contact_manifold_points(min_x, face_y, max_x, face_y, contact.penetration)
    }
}

pub(super) fn aabb_circle_contact_manifold_points(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = aabb_reference_face(AabbBounds::from_transform(at, ac), contact)?;
    circle_face_contact_manifold_points(face, bc.center(bt), bc.radius, contact)
}

pub(super) fn aabb_capsule_contact_manifold_points(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let bounds = AabbBounds::from_transform(at, ac);
    if let Some((x0, y0, x1, y1)) =
        aabb_capsule_side_contact_segment(bounds, bc.start(bt), bc.end(bt), contact)
    {
        return two_or_one_contact_manifold_points(x0, y0, x1, y1, contact.penetration);
    }
    if let Some(points) = aabb_capsule_arc_clipped_contact_manifold_points(
        bounds,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }
    if let Some(points) = aabb_capsule_endpoint_contact_manifold_points(
        bounds,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }

    let (point_x, point_y) = aabb_capsule_contact_point(at, ac, bt, bc, contact);
    single_contact_manifold_point(point_x, point_y, contact.penetration)
}

pub(super) fn aabb_capsule_side_contact_segment(
    bounds: AabbBounds,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    contact: AabbContact,
) -> Option<(f32, f32, f32, f32)> {
    if contact.normal_x.abs() >= 1.0 - RAY_EPSILON
        && (capsule_start.x - capsule_end.x).abs() <= RAY_EPSILON
    {
        let min_y = capsule_start.y.min(capsule_end.y).max(bounds.min_y);
        let max_y = capsule_start.y.max(capsule_end.y).min(bounds.max_y);
        if max_y - min_y <= RAY_EPSILON {
            return None;
        }
        let face_x = if contact.normal_x > 0.0 {
            bounds.max_x
        } else {
            bounds.min_x
        };
        return Some((face_x, min_y, face_x, max_y));
    }

    if contact.normal_y.abs() >= 1.0 - RAY_EPSILON
        && (capsule_start.y - capsule_end.y).abs() <= RAY_EPSILON
    {
        let min_x = capsule_start.x.min(capsule_end.x).max(bounds.min_x);
        let max_x = capsule_start.x.max(capsule_end.x).min(bounds.max_x);
        if max_x - min_x <= RAY_EPSILON {
            return None;
        }
        let face_y = if contact.normal_y > 0.0 {
            bounds.max_y
        } else {
            bounds.min_y
        };
        return Some((min_x, face_y, max_x, face_y));
    }

    None
}

pub(super) fn aabb_capsule_arc_clipped_contact_manifold_points(
    bounds: AabbBounds,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = aabb_reference_face(bounds, contact)?;
    capsule_face_arc_clipped_contact_manifold_points(
        face,
        capsule_start,
        capsule_end,
        capsule_radius,
    )
}

fn aabb_reference_face(bounds: AabbBounds, contact: AabbContact) -> Option<ContactFace> {
    if !bounds.min_x.is_finite()
        || !bounds.min_y.is_finite()
        || !bounds.max_x.is_finite()
        || !bounds.max_y.is_finite()
        || bounds.max_x < bounds.min_x
        || bounds.max_y < bounds.min_y
        || !contact.normal_x.is_finite()
        || !contact.normal_y.is_finite()
        || contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y
            <= RAY_EPSILON * RAY_EPSILON
    {
        return None;
    }

    let center = aabb_center(bounds);
    if contact.normal_x.abs() >= contact.normal_y.abs() {
        let sign = if contact.normal_x >= 0.0 { 1.0 } else { -1.0 };
        let x = if sign > 0.0 {
            bounds.max_x
        } else {
            bounds.min_x
        };
        Some(ContactFace {
            center: Transform2D { x, y: center.y },
            normal: Velocity { vx: sign, vy: 0.0 },
            tangent: Velocity { vx: 0.0, vy: 1.0 },
            tangent_extent: (bounds.max_y - bounds.min_y) * 0.5,
        })
    } else {
        let sign = if contact.normal_y >= 0.0 { 1.0 } else { -1.0 };
        let y = if sign > 0.0 {
            bounds.max_y
        } else {
            bounds.min_y
        };
        Some(ContactFace {
            center: Transform2D { x: center.x, y },
            normal: Velocity { vx: 0.0, vy: sign },
            tangent: Velocity { vx: 1.0, vy: 0.0 },
            tangent_extent: (bounds.max_x - bounds.min_x) * 0.5,
        })
    }
}

pub(super) fn aabb_capsule_endpoint_contact_manifold_points(
    bounds: AabbBounds,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_aabb_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        bounds,
        capsule_start,
        capsule_radius,
        contact,
    );
    append_aabb_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        bounds,
        capsule_end,
        capsule_radius,
        contact,
    );
    (point_count > 0).then_some((points, point_count))
}

fn append_aabb_capsule_endpoint_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    bounds: AabbBounds,
    capsule_center: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) {
    if !is_valid_radius(capsule_radius) {
        return;
    }
    let closest = closest_point_on_aabb(capsule_center, bounds);
    let distance_squared = point_distance_squared(capsule_center, closest);
    if distance_squared > capsule_radius * capsule_radius + RAY_EPSILON {
        return;
    }

    let inside = bounds.contains_point(capsule_center);
    let point = if inside {
        Transform2D {
            x: capsule_center.x - contact.normal_x * capsule_radius,
            y: capsule_center.y - contact.normal_y * capsule_radius,
        }
    } else {
        closest
    };
    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: point.x,
            point_y: point.y,
            penetration: contact.penetration,
        },
    );
}
