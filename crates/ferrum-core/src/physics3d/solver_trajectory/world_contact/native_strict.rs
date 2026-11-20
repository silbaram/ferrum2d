//! A positive existence marker that keeps the caller's original Native Contact.
//!
//! Arbitrary original rotations are allowed because no new normal cone or
//! response point is published. One transformed closed-box point and one actual
//! capsule core endpoint suffice to refute whole-interval separation strictly
//! above their real ball gap. A failed nominee proves no clearance.
use super::{
    distance_upper, gap_upper, scalar_rotation, validate_interval, Pair, PairKind, ShapeMotion,
    Time, TrajectoryError, Work,
};

pub(super) fn at(
    pair: &Pair<'_>,
    a: ShapeMotion,
    b: ShapeMotion,
    time: Time,
    margin: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if !margin.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    validate_interval(a, b, time, time, work)?;
    if margin < 0. {
        return Ok(false);
    }
    let PairKind::BoxCapsule(pair) = &pair.kind else {
        return Ok(false);
    };
    work.charge(576)?; // two actual pose graphs and fixed numeric headers.
    let pa = a.pose(time);
    let pb = b.pose(time);
    if !pa.is_finite() || !pb.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let (box_pose, cap_pose) = if pair.flipped { (&pb, &pa) } else { (&pa, &pb) };
    // The existing scalar producer already handles its stronger cone/contact
    // contract. This marker supplements only the rotated case it declines.
    if scalar_rotation(box_pose.rotation).is_some() && scalar_rotation(cap_pose.rotation).is_some()
    {
        return Ok(false);
    }
    for endpoint in [pair.capsule.segment.a, pair.capsule.segment.b] {
        // Original endpoint, approximate inverse nominee, closed clamp,
        // original forward graph, and directed real-radius gap arithmetic.
        // Fixed two nominees, no sampling, allocation, or hidden query.
        work.charge(2048)?;
        let core = cap_pose * endpoint;
        if !core.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let nominee = box_pose.inverse() * core;
        if !nominee.is_finite() {
            continue;
        }
        let local = nominee.clamp(-pair.cuboid.half_extents, pair.cuboid.half_extents);
        if !local.is_finite()
            || local.cmplt(-pair.cuboid.half_extents).any()
            || local.cmpgt(pair.cuboid.half_extents).any()
        {
            continue;
        }
        // A unit quaternion and an exact inverse are not proof premises:
        // only the admitted local point's actual forward image is measured.
        let point = box_pose * local;
        if !point.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let upper = gap_upper(distance_upper(point, core), pair.capsule.radius);
        if upper.is_finite() && upper < f64::from(margin) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests;
