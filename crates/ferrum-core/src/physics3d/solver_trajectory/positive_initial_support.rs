//! Reconcile a noisy initially-clear Native witness with the original positive
//! full-shape support margin. This only selects existing-contact search; the
//! original chronological whole-interval cast still decides the result.
use super::*;

/// A fixed face or edge can keep a positive support gap while its rounded
/// translations remain inside the measured cell band.
#[allow(clippy::too_many_arguments)]
pub(super) fn fixed_ramp_stable(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    left: rapier3d::parry::query::Contact,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if clearance <= 0.
        || left.dist <= 0.
        || start >= end
        || left
            .normal1
            .to_array()
            .into_iter()
            .filter(|&v| v != 0.)
            .count()
            != 2
    {
        return Ok(false);
    }
    let normal = left.normal1;
    let qualifies = |hull: ShapeMotion, cap: ShapeMotion| {
        matches!(hull.curve, Curve::Constant { .. })
            && matches!(cap.curve, Curve::Integrated(k) if k.has_identity_orientation())
    };
    let has_edge = |shape: &dyn rp::Shape| {
        feature_contact::RampFaces::from_shape(shape).is_some() || shape.as_cuboid().is_some()
    };
    if !((has_edge(sa) && sb.as_capsule().is_some() && qualifies(a, b))
        || (has_edge(sb) && sa.as_capsule().is_some() && qualifies(b, a)))
    {
        return Ok(false);
    }
    let mut trial = Work {
        used: 0,
        limit: (work.limit - work.used).min(256 * 1024),
    };
    let attempt = (|| {
        trial.charge(1024)?;
        let relative = b.point_velocity(start, left.point2) - a.point_velocity(start, left.point1);
        let rate = relative.dot(normal);
        if !rate.is_finite() {
            return Ok(false);
        }
        if rate < 0. && left.dist > clearance {
            // A rounded tangential proposal can land one represented rate
            // inward. Only consider the measured support band when a single
            // outward step in the dominant component reaches tangency.
            let axis = normal.abs().max_position();
            let mut next = relative;
            next[axis] = if normal[axis] > 0. {
                next[axis].next_up()
            } else {
                next[axis].next_down()
            };
            if !next.is_finite() || next.dot(normal) < 0. {
                return Ok(false);
            }
        }
        let initial = rounded::initial_support_allowances(a, sa, b, sb, normal, start, &mut trial)?;
        let margin = initial.noninward_stability;
        let band = (f64::from(initial.geometry) - f64::from(margin)).next_down();
        let difference = (f64::from(left.dist) - f64::from(clearance)).next_up();
        let observed_overlap = (f64::from(clearance) - f64::from(left.dist)).next_up();
        // A confirmed in-skin witness can keep its existing support when
        // the inward travel fits the measured band and the whole sweep clears it.
        if margin <= 0.
            || margin >= clearance
            || difference > band
            || (rate < 0. && observed_overlap > band)
            || (f64::from(-rate) * (end - start)).next_up() > band
        {
            return Ok(false);
        }
        let mut cache = rounded::AxisCache::new(a, sa, b, sb, start, end, margin);
        rounded::fixed_support_capsule_separated(&mut cache, normal, &mut trial)
    })();
    work.charge(trial.used)?;
    match attempt {
        Err(TrajectoryError::WorkLimit) => Ok(false),
        other => other,
    }
}

/// A travelling face and its attached capsule can begin just above the
/// requested margin, inside the original translation-cell uncertainty.
/// Reuse that measured band only after proving the complete pair interval.
#[allow(clippy::too_many_arguments)]
pub(super) fn shared_face_stable(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    left: rapier3d::parry::query::Contact,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if clearance <= 0. || left.dist <= clearance {
        return Ok(false);
    }
    let axis = left.normal1.abs().max_position();
    if left.normal1[axis].abs() != 1. || (0..3).any(|i| i != axis && left.normal1[i] != 0.) {
        return Ok(false);
    }
    let axial = |cap: &rp::Capsule| {
        cap.segment.a[axis] != cap.segment.b[axis]
            && (0..3).all(|i| i == axis || cap.segment.a[i] == cap.segment.b[i])
    };
    let qualifies = |cube: ShapeMotion, cap: ShapeMotion| {
        matches!((cube.curve, cap.curve), (Curve::Integrated(driver),
            Curve::Anchored { carrier, linear_velocity, .. })
            if carrier.native.motion.body == driver.native.motion.body
                && driver.native.angular_velocity == rp::Vector::ZERO
                && linear_velocity.dot(left.normal1) == 0.)
    };
    if !((sa.as_cuboid().is_some() && sb.as_capsule().is_some_and(axial) && qualifies(a, b))
        || (sb.as_cuboid().is_some() && sa.as_capsule().is_some_and(axial) && qualifies(b, a)))
    {
        return Ok(false);
    }
    let mut trial = Work {
        used: 0,
        limit: (work.limit - work.used).min(64 * 1024),
    };
    let attempt = (|| {
        let initial =
            rounded::initial_support_allowances(a, sa, b, sb, left.normal1, start, &mut trial)?;
        let margin = initial.noninward_stability;
        if initial.geometry <= clearance
            || margin <= 0.
            || margin >= clearance
            || !same_cell_margin(left.dist, clearance, margin, clearance)
        {
            return Ok(false);
        }
        Ok(matches!(
            rounded::cardinal_box_capsule_prefix(
                a,
                sa,
                b,
                sb,
                left.normal1,
                start,
                end,
                margin,
                tolerance,
                &mut trial
            )?,
            Some(rounded::FacePrefix::Separated)
        ))
    })();
    work.charge(trial.used)?;
    match attempt {
        Err(TrajectoryError::WorkLimit) => Ok(false),
        other => other,
    }
}

/// An actual witness at the start can establish existing-contact ownership
/// even when the Native core estimate is outside the original clearance.
#[allow(clippy::too_many_arguments)]
pub(super) fn witnessed_allowance(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    hit: CastHit,
    work: &mut Work,
) -> Result<Option<(f32, f32)>, TrajectoryError> {
    let supported_box = |motion: ShapeMotion| {
        motion.is_single_axis_spin()
            || constant_pose(motion.curve).is_some()
            || matches!(motion.curve, Curve::Integrated(k)
                if k.native.angular_velocity == rp::Vector::ZERO
                    && k.native.linear_velocity == rp::Vector::ZERO
                    && [k.native.motion.start.rotation, k.native.motion.end.rotation]
                        .into_iter().all(|q| q.x == 0. && q.y == 0. && q.z > 0. && q.w > q.z))
    };
    let box_capsule = (sa.as_cuboid().is_some()
        && supported_box(a)
        && sb.as_capsule().is_some()
        && rounded::upright_capsule_motion(b))
        || (sb.as_cuboid().is_some()
            && supported_box(b)
            && sa.as_capsule().is_some()
            && rounded::upright_capsule_motion(a));
    if !box_capsule || hit.safe_time != start || hit.hit_time != start || hit.contact.dist <= 0. {
        return Ok(None);
    }
    work.charge(1024)?;
    let contact = hit.contact;
    let rate = (b.point_velocity(start, contact.point2) - a.point_velocity(start, contact.point1))
        .dot(contact.normal1);
    if !rate.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if rate < 0. {
        return Ok(None);
    }
    let values = rounded::initial_support_allowances(a, sa, b, sb, contact.normal1, start, work)?;
    let geometry = values.geometry.min(contact.dist);
    Ok((geometry > 0.).then_some((geometry, values.noninward_stability.min(geometry))))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn allowance(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<Option<(f32, f32)>, TrajectoryError> {
    // This is a real additional leaf query, on the original shapes/pose graph
    // and shared ledger. No old point result or separate quota is reused.
    let left = leaf_contact(&a.pose(start), shape_a, &b.pose(start), shape_b, work)?;
    if !left.dist.is_finite()
        || !left.normal1.is_finite()
        || !left.point1.is_finite()
        || !left.point2.is_finite()
    {
        return Err(TrajectoryError::NonFinite);
    }
    if left.dist <= clearance {
        return Ok(None);
    }
    let initial =
        rounded::initial_support_allowances(a, shape_a, b, shape_b, left.normal1, start, work)?;
    if initial.geometry <= 0. || initial.geometry > clearance {
        return Ok(None);
    }
    // A loose positive support lower bound alone cannot reinterpret a genuinely
    // clear Native start. Restrict the two original graph results to the same
    // already measured F32 translation-cell ambiguity band.
    work.charge(1024)?;
    if !same_cell_margin(
        left.dist,
        initial.geometry,
        initial.noninward_stability,
        clearance,
    ) {
        return Ok(None);
    }
    // The original witness rate chooses eligibility, never future safety.
    let rate = (b.point_velocity(start, left.point2) - a.point_velocity(start, left.point1))
        .dot(left.normal1);
    if !rate.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    Ok((rate >= 0.).then_some((initial.geometry, initial.noninward_stability)))
}

fn same_cell_margin(native: f32, geometry: f32, stability: f32, clearance: f32) -> bool {
    if !native.is_finite()
        || !geometry.is_finite()
        || !stability.is_finite()
        || !clearance.is_finite()
        || geometry <= 0.
        || geometry > clearance
        || stability < 0.
        || stability > geometry
    {
        return false;
    }
    // The directed bounds remain conservative even when the F32 inputs have
    // widely separated exponents. An ambiguous equality declines the retry.
    let band = (f64::from(geometry) - f64::from(stability)).next_down();
    let discrepancy = (f64::from(native) - f64::from(geometry)).next_up();
    band.is_finite() && discrepancy.is_finite() && discrepancy >= 0. && discrepancy <= band
}

#[cfg(test)]
mod tests;
