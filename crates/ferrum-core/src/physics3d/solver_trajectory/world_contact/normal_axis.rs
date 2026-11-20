//! Positive Contact with a complete normal-axis cone, after the old producer.
//! A pure-axis box uses its outer face for a positive scale and a certified
//! slab maximum for a negative scale. An exact-qI axial capsule endpoint
//! supplies the other support. The actual two-point distance proves contact.
use super::*;
use crate::physics3d::solver_trajectory::{rounded, Curve};

fn scalar_motion(m: ShapeMotion) -> bool {
    if scalar_rotation(m.local_pose.rotation).is_none() {
        return false;
    }
    match m.curve {
        Curve::Constant { pose, .. } => scalar_rotation(pose.rotation).is_some(),
        Curve::Anchored { rotation, .. } => scalar_rotation(rotation).is_some(),
        Curve::Integrated(k) => {
            k.native.angular_velocity == rp::Vector::ZERO
                && scalar_rotation(k.native.motion.start.rotation).is_some()
                && scalar_rotation(k.native.motion.end.rotation).is_some()
        }
        Curve::Ccd { .. } => false,
    }
}

pub(super) fn at(
    pair: &Pair<'_>,
    a: ShapeMotion,
    b: ShapeMotion,
    time: Time,
    margin: f32,
    work: &mut Work,
) -> Result<Option<Witness>, TrajectoryError> {
    if !margin.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    // No old scalar success/decline pays for this separate rotating producer.
    // Only its optional eligibility is inferred; absence has no NoHit authority.
    let PairKind::BoxCapsule(p) = &pair.kind else {
        return Ok(None);
    };
    let box_motion = if p.flipped { b } else { a };
    if margin < 0. || scalar_motion(box_motion) {
        return Ok(None);
    }
    validate_interval(a, b, time, time, work)?;
    work.charge(512)?; // actual original shape poses, only once for this request
    poses(pair, &a.pose(time), &b.pose(time), margin, work)
}

pub(super) fn poses(
    pair: &Pair<'_>,
    a: &rp::Pose,
    b: &rp::Pose,
    margin: f32,
    work: &mut Work,
) -> Result<Option<Witness>, TrajectoryError> {
    poses_with_scale::<false>(pair, a, b, margin, work)
}

pub(super) fn signed_poses(
    pair: &Pair<'_>,
    a: &rp::Pose,
    b: &rp::Pose,
    margin: f32,
    work: &mut Work,
) -> Result<Option<Witness>, TrajectoryError> {
    poses_with_scale::<true>(pair, a, b, margin, work)
}

fn poses_with_scale<const SIGNED: bool>(
    pair: &Pair<'_>,
    a: &rp::Pose,
    b: &rp::Pose,
    margin: f32,
    work: &mut Work,
) -> Result<Option<Witness>, TrajectoryError> {
    if !margin.is_finite() || !a.is_finite() || !b.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if margin < 0. {
        return Ok(None);
    }
    let PairKind::BoxCapsule(pair) = &pair.kind else {
        return Ok(None);
    };
    let (box_pose, cap_pose) = if pair.flipped { (b, a) } else { (a, b) };
    // Preserve the original scalar producer and its Work exactly, including
    // its cone-negative controls. This API supplements rotations only.
    if scalar_rotation(box_pose.rotation).is_some() {
        return Ok(None);
    }
    if !SIGNED {
        work.charge(128)?; // original positive observer's numeric headers
    }
    if cap_pose.rotation.to_array().map(f32::to_bits)
        != rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
    {
        return Ok(None);
    }
    let q = box_pose.rotation;
    let vector = rp::Vector::new(q.x, q.y, q.z);
    let Some(axis) = (0..3).find(|&i| vector[i] != 0.) else {
        return Ok(None);
    };
    if (0..3).any(|i| i != axis && vector[i] != 0.) || pair.segment_axis.is_some_and(|i| i != axis)
    {
        return Ok(None);
    }
    let scale = q.w * q.w - vector.dot(vector); // original scalar graph
    if !scale.is_finite() || if SIGNED { scale >= 0. } else { scale <= 0. } {
        return Ok(None);
    }
    let half = pair.cuboid.half_extents;
    let support = if SIGNED {
        work.charge(128)?;
        let Some((support, _)) =
            rounded::signed_face_support(half[axis], vector[axis], scale, work)?
        else {
            return Ok(None);
        };
        support
    } else {
        half[axis]
    };
    // The complete corner check covers finiteness of the tangent operations.
    // For the signed normal slab, the support proof bounds the extra interior
    // values. The normal output is independent of both tangent coordinates.
    work.charge(8 * 128)?;
    for i in 0..8 {
        let local = rp::Vector::from_array(std::array::from_fn(|axis| {
            if i & (1 << axis) == 0 {
                -pair.cuboid.half_extents[axis]
            } else {
                pair.cuboid.half_extents[axis]
            }
        }));
        if !(box_pose * local).is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
    }
    // With positive scale both normal terms are nondecreasing, so the
    // outer face supports the whole slab. Each rounded term is odd before
    // world translation. The signed maximum therefore gives the opposite
    // support by negating its local coordinate.
    work.charge(2 * 128)?;
    let cores = [
        cap_pose * pair.capsule.segment.a,
        cap_pose * pair.capsule.segment.b,
    ];
    if cores.iter().any(|v| !v.is_finite()) {
        return Err(TrajectoryError::NonFinite);
    }
    for (index, &core) in cores.iter().enumerate() {
        work.charge(2048)?; // original nominee/forward, cone, distance and ball
        let nominee = box_pose.inverse() * core;
        if !nominee.is_finite() {
            continue;
        }
        // This producer owns a face-normal contact, never a corner/edge
        // response. Both original inverse-nominated tangent coordinates must
        // already be inside their closed slabs: no tangent may be clamped.
        // No tolerance or a unit/conjugate-is-inverse premise is introduced.
        if (0..3).any(|i| i != axis && (nominee[i] < -half[i] || nominee[i] > half[i])) {
            continue;
        }
        let mut local = nominee.clamp(-half, half);
        if !local.is_finite() || local.cmplt(-half).any() || local.cmpgt(half).any() {
            continue;
        }
        let sign = if local[axis] == half[axis] {
            1.
        } else if local[axis] == -half[axis] {
            -1.
        } else {
            continue;
        };
        local[axis] = sign * support;
        let point = box_pose * local;
        if !point.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if (sign > 0. && core[axis] <= point[axis]) || (sign < 0. && core[axis] >= point[axis]) {
            continue;
        }
        let mut normal = rp::Vector::ZERO;
        normal[axis] = sign;
        let other = cores[1 - index][axis];
        if (sign > 0. && other < core[axis]) || (sign < 0. && other > core[axis]) {
            continue; // selected core supports -normal for the WHOLE segment
        }
        let upper = gap_upper(distance_upper(point, core), pair.capsule.radius);
        if !upper.is_finite() || upper > f64::from(margin) {
            continue;
        }
        let Some(ball) = ball_point(core, -normal, pair.capsule.radius) else {
            continue;
        };
        let mut distance = upper as f32;
        if f64::from(distance) < upper {
            distance = distance.next_up()
        }
        if !distance.is_finite() || distance > margin {
            continue;
        }
        let mut contact = Contact::new(point, ball, normal, -normal, distance);
        if pair.flipped {
            contact.flip()
        }
        return Ok(Some(Witness {
            contact,
            strict: upper < f64::from(margin),
        }));
    }
    Ok(None)
}

#[cfg(test)]
mod tests;
