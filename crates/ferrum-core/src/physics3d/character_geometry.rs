//! Exact capsule-axis contacts avoid noisy support-map normals between controllers.
use rapier3d::parry::query::{details::closest_points_segment_segment_with_locations, Contact};
use rapier3d::prelude as rp;
pub(super) fn contact(
    first: &rp::Collider,
    first_pose: &rp::Pose,
    second: &rp::Collider,
    second_pose: &rp::Pose,
    margin: f32,
) -> Option<Contact> {
    // Character registration and collider edits enforce a single solid capsule.
    let a = first
        .shape()
        .as_capsule()
        .expect("registered character collider is a capsule");
    let b = second
        .shape()
        .as_capsule()
        .expect("registered character collider is a capsule");
    let relative = first_pose.inverse() * second_pose;
    let (la, lb) = closest_points_segment_segment_with_locations(&relative, &a.segment, &b.segment);
    let pa = a.segment.point_at(&la);
    let pb = relative * b.segment.point_at(&lb);
    let delta = pb - pa;
    let distance = delta.length();
    let gap = distance - a.radius - b.radius;
    if gap > margin {
        return None;
    }
    let normal = first_pose.rotation * delta.try_normalize().unwrap_or(rp::Vector::X);
    Some(Contact::new(
        first_pose * pa + normal * a.radius,
        first_pose * pb - normal * b.radius,
        normal,
        -normal,
        gap,
    ))
}

/// Exact character-capsule/cuboid contact when the capsule lies beyond one face
/// plane and its whole footprint is strictly inside that face. The face is then
/// the closest box feature for every ball of the capsule, so the distance is the
/// capsule's support along the face normal. `None` leaves edges, corners and
/// penetration to the general query; `Some(None)` is a certain miss.
pub(super) fn capsule_box_face_contact(
    target: &dyn rp::Shape,
    target_pose: &rp::Pose,
    character: &dyn rp::Shape,
    character_pose: &rp::Pose,
    prediction: f32,
) -> Option<Option<Contact>> {
    let relative = target_pose.inv_mul(character_pose);
    let Some((gap, normal, true)) =
        super::character_query::capsule_box_plane(target, character, &relative, rp::Vector::ZERO)
    else {
        return None;
    };
    // `capsule_box_plane` only returns finite gaps.
    if gap <= 0.0 {
        return None;
    }
    if gap > prediction {
        return Some(None);
    }
    let (half, capsule) = (target.as_cuboid()?.half_extents, character.as_capsule()?);
    let axis = (0..3).find(|&axis| normal[axis] != 0.0)?;
    let (a, b) = (relative * capsule.segment.a, relative * capsule.segment.b);
    // The ball nearest the face; a segment parallel to it touches along its length.
    let centre = match (a[axis] * normal[axis]).total_cmp(&(b[axis] * normal[axis])) {
        std::cmp::Ordering::Less => a,
        std::cmp::Ordering::Greater => b,
        std::cmp::Ordering::Equal => (a + b) * 0.5,
    };
    let mut on_face = centre;
    on_face[axis] = normal[axis] * half[axis];
    let normal1 = target_pose.rotation * normal;
    Some(Some(Contact::new(
        target_pose * on_face,
        target_pose * (centre - normal * capsule.radius),
        normal1,
        -normal1,
        gap,
    )))
}

/// Recover an exact box face normal when a noisy witness lies inside that face.
/// Edge/corner contacts keep their geometric normal and remain free to slide.
pub(super) fn target_normal(
    collider: &rp::Collider,
    pose: &rp::Pose,
    point: rp::Vector,
    normal: rp::Vector,
) -> rp::Vector {
    let Some(cuboid) = collider.shape().as_cuboid() else {
        return normal;
    };
    let local = pose.inverse_transform_point(point);
    let half = cuboid.half_extents;
    let epsilon = 1.0e-4 * half.min_element().max(0.001);
    for axis in 0..3 {
        if (local[axis].abs() - half[axis]).abs() <= epsilon
            && (0..3)
                .filter(|&other| other != axis)
                .all(|other| local[other].abs() < half[other] - epsilon * 4.0)
        {
            let mut face = rp::Vector::ZERO;
            face[axis] = local[axis].signum();
            let face = pose.rotation * face;
            if face.dot(normal) > 0.99 {
                return face;
            }
        }
    }
    normal
}

/// A positive gap and a capsule footprint inside a single cuboid face
/// identify the closest face even if the cast's witness is slightly off it.
pub(super) fn collision_normal(
    target: &rp::Collider,
    shape: &dyn rp::Shape,
    collision: &rapier3d::control::CharacterCollision,
) -> rp::Vector {
    let pose = target.position();
    if let Some((gap, axis, true)) = super::character_query::capsule_box_plane(
        target.shape(),
        shape,
        &pose.inv_mul(&collision.character_pos),
        rp::Vector::ZERO,
    ) {
        if gap >= 0. {
            return pose.rotation * axis;
        }
    }
    target_normal(target, pose, collision.hit.witness1, collision.hit.normal1)
}

/// A controller response is spanned by input, up, and actual surface normals.
/// Remove numerical components outside that space before crowd contacts can amplify them.
pub(super) fn stabilize_translation<'a>(
    world: &rp::PhysicsWorld,
    shape: &dyn rp::Shape,
    collisions: impl IntoIterator<Item = &'a rapier3d::control::CharacterCollision>,
    up: rp::Vector,
    desired: rp::Vector,
    translation: rp::Vector,
) -> rp::Vector {
    let mut basis = [rp::Vector::ZERO; 3];
    let mut count = 0;
    let normals = collisions.into_iter().filter_map(|hit| {
        world
            .colliders
            .get(hit.handle)
            .map(|c| collision_normal(c, shape, hit))
    });
    for mut axis in [up, desired].into_iter().chain(normals) {
        if let Some(normalized) = axis.try_normalize() {
            axis = normalized;
        } else {
            continue;
        }
        for base in &basis[..count] {
            axis -= *base * axis.dot(*base);
        }
        if axis.length_squared() > 1.0e-8 {
            basis[count] = axis.normalize();
            count += 1;
            if count == 3 {
                return translation;
            }
        }
    }
    basis[..count]
        .iter()
        .fold(rp::Vector::ZERO, |projected, n| {
            projected + *n * n.dot(translation)
        })
}

/// Closest distance between segments `p1q1` and `p2q2` (Ericson 5.1.9).
pub(super) fn segment_distance(p1: [f64; 3], q1: [f64; 3], p2: [f64; 3], q2: [f64; 3]) -> f64 {
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let at = |p: [f64; 3], d: [f64; 3], t: f64| [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
    let (d1, d2, r) = (sub(q1, p1), sub(q2, p2), sub(p1, p2));
    let (a, e, f) = (dot(d1, d1), dot(d2, d2), dot(d2, r));
    const TINY: f64 = 1.0e-18;
    let (s, t) = if a <= TINY && e <= TINY {
        (0.0, 0.0)
    } else if a <= TINY {
        (0.0, (f / e).clamp(0.0, 1.0))
    } else {
        let c = dot(d1, r);
        if e <= TINY {
            ((-c / a).clamp(0.0, 1.0), 0.0)
        } else {
            let b = dot(d1, d2);
            let denom = a * e - b * b;
            let s = if denom > 0.0 {
                ((b * f - c * e) / denom).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let t = (b * s + f) / e;
            if t < 0.0 {
                ((-c / a).clamp(0.0, 1.0), 0.0)
            } else if t > 1.0 {
                (((b - c) / a).clamp(0.0, 1.0), 1.0)
            } else {
                (s, t)
            }
        }
    };
    let delta = sub(at(p1, d1, s), at(p2, d2, t));
    dot(delta, delta).sqrt()
}

/// Smallest distance between segment `b0b1` and segment `a0a1` swept along
/// `sweep` (a parallelogram). `|a0 + s(a1-a0) + τ sweep - b0 - t(b1-b0)|²`
/// is convex over the unit cube: its minimum is an interior root (distance 0)
/// or lies on one of six faces, each a segment-segment distance.
pub(super) fn swept_segment_distance(
    a0: [f64; 3],
    a1: [f64; 3],
    sweep: [f64; 3],
    b0: [f64; 3],
    b1: [f64; 3],
) -> f64 {
    let add = |a: [f64; 3], b: [f64; 3]| [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let (da, db) = (sub(a1, a0), sub(b1, b0));
    let neg_db = sub([0.0; 3], db);
    // Interior: s da + τ sweep - t db = b0 - a0 by Cramer's rule.
    let det = dot(da, cross(sweep, neg_db));
    let scale = dot(da, da).sqrt() * dot(sweep, sweep).sqrt() * dot(db, db).sqrt();
    if det.abs() > scale * 1.0e-9 {
        let c = sub(b0, a0);
        let s = dot(c, cross(sweep, neg_db)) / det;
        let tau = dot(da, cross(c, neg_db)) / det;
        let t = dot(da, cross(sweep, c)) / det;
        if [s, tau, t].iter().all(|v| (0.0..=1.0).contains(v)) {
            return 0.0;
        }
    }
    let swept_end = add(a0, sweep);
    [
        segment_distance(a0, swept_end, b0, b1),
        segment_distance(a1, add(a1, sweep), b0, b1),
        segment_distance(a0, a1, b0, b1),
        segment_distance(swept_end, add(a1, sweep), b0, b1),
        segment_distance(a0, a1, b0, sub(b0, sweep)),
        segment_distance(a0, a1, b1, sub(b1, sweep)),
    ]
    .into_iter()
    .fold(f64::INFINITY, f64::min)
}
