use super::*;

pub(super) fn two_or_one_contact_manifold_points(
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    penetration: f32,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    if !x0.is_finite()
        || !y0.is_finite()
        || !x1.is_finite()
        || !y1.is_finite()
        || !penetration.is_finite()
    {
        return empty_contact_manifold_points();
    }

    let dx = x1 - x0;
    let dy = y1 - y0;
    if dx * dx + dy * dy <= RAY_EPSILON * RAY_EPSILON {
        return single_contact_manifold_point((x0 + x1) * 0.5, (y0 + y1) * 0.5, penetration);
    }

    (
        [
            CollisionContactPoint {
                point_x: x0,
                point_y: y0,
                penetration,
            },
            CollisionContactPoint {
                point_x: x1,
                point_y: y1,
                penetration,
            },
        ],
        2,
    )
}

pub(super) fn single_contact_manifold_point(
    point_x: f32,
    point_y: f32,
    penetration: f32,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    if !point_x.is_finite() || !point_y.is_finite() || !penetration.is_finite() {
        return empty_contact_manifold_points();
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    points[0] = CollisionContactPoint {
        point_x,
        point_y,
        penetration,
    };
    (points, 1)
}

pub(super) fn append_contact_manifold_point_by_depth(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    point: CollisionContactPoint,
) {
    if !point.point_x.is_finite() || !point.point_y.is_finite() || !point.penetration.is_finite() {
        return;
    }
    let duplicate = points[..(*point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS)]
        .iter()
        .any(|existing| {
            let dx = existing.point_x - point.point_x;
            let dy = existing.point_y - point.point_y;
            dx * dx + dy * dy <= RAY_EPSILON * RAY_EPSILON
        });
    if duplicate {
        return;
    }

    let count = (*point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS);
    if count < MAX_COLLISION_MANIFOLD_POINTS {
        points[count] = point;
        *point_count = (count + 1) as u32;
    } else if point.penetration > points[MAX_COLLISION_MANIFOLD_POINTS - 1].penetration {
        points[MAX_COLLISION_MANIFOLD_POINTS - 1] = point;
    } else {
        return;
    }

    let count = (*point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS);
    points[..count].sort_by(|a, b| b.penetration.total_cmp(&a.penetration));
}

pub(super) fn empty_contact_manifold_points(
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    ([empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS], 0)
}

pub(super) const fn empty_contact_point() -> CollisionContactPoint {
    CollisionContactPoint {
        point_x: 0.0,
        point_y: 0.0,
        penetration: 0.0,
    }
}
