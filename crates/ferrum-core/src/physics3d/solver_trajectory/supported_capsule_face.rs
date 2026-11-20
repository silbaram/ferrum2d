//! Closed support planes for a translating upright capsule and a rotating box.
//! A native contact nominates a plane. The original full shapes and both
//! radius paths still have to clear that plane over every closed subinterval.
use super::*;

pub(super) fn box_motion(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
) -> Option<ShapeMotion> {
    let (cube, cap) = if sa.as_cuboid().is_some() && sb.as_capsule().is_some() {
        (a, b)
    } else if sb.as_cuboid().is_some() && sa.as_capsule().is_some() {
        (b, a)
    } else {
        return None;
    };
    let (
        Curve::Integrated(k),
        Curve::Anchored {
            carrier,
            linear_velocity,
            rotation,
            ..
        },
    ) = (cube.curve, cap.curve)
    else {
        return None;
    };
    (k.native
        .angular_velocity
        .to_array()
        .into_iter()
        .filter(|v| *v != 0.)
        .count()
        >= 2
        && carrier.has_identity_orientation()
        && carrier.native.linear_velocity == rp::Vector::ZERO
        && carrier.native.motion.start.translation == carrier.native.motion.end.translation
        && rotation == rp::Rotation::IDENTITY
        && linear_velocity != rp::Vector::ZERO
        && [cube, cap]
            .into_iter()
            .all(|m| m.local_pose == rp::Pose::IDENTITY && m.local_center == rp::Vector::ZERO))
    .then_some(cube)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn prefix(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    if box_motion(a, sa, b, sb).is_none() {
        return Ok(None);
    }
    if clearance <= 0. || start >= end {
        return Ok(None);
    }
    // Extend the optional proof only after a new contiguous prefix has cleared.
    // All visits debit the original scene ledger and leave room for its general cast.
    const CHUNK: u64 = 768 * 1024;
    let allowance = work.limit.saturating_sub(work.used);
    let mut trial = Work {
        used: 0,
        limit: allowance.min(CHUNK),
    };
    let ceiling = (allowance / 2).min(8 * CHUNK);
    let mut through = start;
    let mut credited = start;
    let proof = (|| {
        let poses = [
            a.metered_pose(end, &mut trial)?,
            b.metered_pose(end, &mut trial)?,
        ];
        let contact = leaf_contact(&poses[0], sa, &poses[1], sb, &mut trial)?;
        if !contact.dist.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let touches_end = contact.dist <= clearance;
        const MAX_DEPTH: usize = 10;
        let mut stack = [(start, end, 0); MAX_DEPTH + 1];
        let mut len = 1;
        // Right then left on the stack makes every accepted interval
        // contiguous with through. A later clear piece cannot skip a gap.
        while len != 0 {
            len -= 1;
            let (lo, hi, depth) = stack[len];
            if through > credited && trial.limit - trial.used < CHUNK / 8 && trial.limit < ceiling {
                trial.limit = (trial.limit + CHUNK).min(ceiling);
                credited = through;
            }
            let cache = rounded::AxisCache::new(a, sa, b, sb, lo, hi, clearance);
            let mid = lo + (hi - lo) * 0.5;
            if !(touches_end && hi == end)
                && rounded::anchored_capsule_face_separated(&cache, normal, &mut trial)?
            {
                through = hi;
                continue;
            }
            if depth == MAX_DEPTH || mid <= lo || mid >= hi {
                break;
            }
            stack[len] = (mid, hi, depth + 1);
            stack[len + 1] = (lo, mid, depth + 1);
            len += 2;
        }
        Ok(())
    })();
    work.charge(trial.used)?;
    match proof {
        Ok(()) | Err(TrajectoryError::WorkLimit) => Ok((through > start).then_some(through)),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilted_box_and_supported_capsule_require_a_complete_clear_prefix() {
        let domain = Domain::new(0.011865238470757988, 0.014265953003329529).unwrap();
        let fixed = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            domain,
            0.0024007144,
            rp::Pose::translation(0., -0.1, 0.),
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap();
        let k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(1, 0),
            domain,
            0.0024007144,
            rp::Pose::from_parts(
                rp::Vector::new(-10.000415, 0.3103684, 0.47297874),
                rp::Rotation::from_xyzw(0.14418122, -0.00029934334, 0.000029546452, 0.9895513),
            ),
            rp::Vector::new(0.0027288306, -0.018532261, 0.72467107),
            rp::Vector::new(2.1212215, -0.030987598, 0.01618062),
        )
        .unwrap();
        let motion = |curve| ShapeMotion {
            curve,
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let cap = rp::Capsule::new_y(0.25, 0.25);
        let cube = rp::Cuboid::new(rp::Vector::new(0.08, 0.3, 0.08));
        for (speed, complete) in [(0.4068697, true), (2., false)] {
            let a = motion(Curve::Anchored {
                carrier: fixed,
                anchor: rp::Vector::new(-10., 0.6097955, 0.10300407),
                offset: rp::Vector::ZERO,
                linear_velocity: rp::Vector::new(0.000041821837, 0., speed),
                rotation: rp::Rotation::IDENTITY,
            });
            let b = motion(Curve::Integrated(k));
            let mut work = Work {
                used: 0,
                limit: 1 << 20,
            };
            let contact = leaf_contact(
                &a.pose(domain.start),
                &cap,
                &b.pose(domain.start),
                &cube,
                &mut work,
            )
            .unwrap();
            assert!(contact.dist > 0.01);
            let through = prefix(
                a,
                &cap,
                b,
                &cube,
                contact.normal1,
                domain.start,
                domain.end,
                0.01,
                &mut work,
            )
            .unwrap();
            assert_eq!(through == Some(domain.end), complete);
            let right = leaf_contact(
                &a.pose(domain.end),
                &cap,
                &b.pose(domain.end),
                &cube,
                &mut work,
            )
            .unwrap();
            assert_eq!(right.dist > 0.01, complete);
        }
    }
}
