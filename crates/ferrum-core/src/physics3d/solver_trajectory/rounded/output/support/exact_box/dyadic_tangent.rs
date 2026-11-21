//! An upper support bound for a translating round end against a plane with a power-of-two component ratio.
use super::*;

fn uniform_step(range: Float) -> Option<f64> {
    if !range.finite() || range.lo.is_sign_negative() != range.hi.is_sign_negative() {
        return None;
    }
    let step = grid_step(Float::exact(range.lo));
    [range.lo.next_down(), range.hi.next_up(), range.hi]
        .into_iter()
        .all(|v| v.is_normal() && grid_step(Float::exact(v)) == step)
        .then_some(step)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    motion: ShapeMotion,
    point: rp::Vector,
    radius: f32,
    normal: rp::Vector,
    norm: Bound,
    limit: f64,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(k) = motion.translation_kernel() else {
        return Ok(false);
    };
    let major = normal.abs().max_position();
    let Some(minor) = (0..3).find(|&i| i != major && normal[i] != 0.) else {
        return Ok(false);
    };
    let minor_weight = f64::from(normal[minor].abs());
    let major_weight = f64::from(normal[major].abs());
    let ratio = major_weight / minor_weight;
    // The F32 component range makes every possible power-of-two ratio a
    // finite normal F64. Confirm the quotient exactly reconstructs the input.
    let fraction_mask = (1_u64 << 52) - 1;
    if motion.local_center != rp::Vector::ZERO
        || motion.local_pose != rp::Pose::IDENTITY
        || normal[3 - major - minor] != 0.
        || !ratio.is_normal()
        || ratio.to_bits() & fraction_mask != 0
        || ratio * minor_weight != major_weight
        || !norm.finite()
        || norm.lo <= 0.
    {
        return Ok(false);
    }
    // Work in signed coordinates: upper is toward the plane on both axes.
    let ids = [minor, major];
    let sign = ids.map(|i| normal[i].signum());
    let velocity = ids.map(|i| normal[i].signum() * k.native.linear_velocity[i]);
    if velocity.contains(&0.) || velocity[0].is_sign_negative() == velocity[1].is_sign_negative() {
        return Ok(false);
    }
    work.charge(1024)?;
    let origin = ids.map(|i| normal[i].signum() * k.native.motion.start.translation[i]);
    let f = |v: f32| Bound::exact(f64::from(v));
    let dt = Float::span(k.local_delta(start), k.local_delta(end));
    let product = velocity.map(|v| Float::exact(v).mul(dt));
    let translation: [Float; 2] = std::array::from_fn(|i| product[i].add(Float::exact(origin[i])));
    let Some(step) = uniform_step(translation[1]) else {
        return Ok(false);
    };
    let reference_y = translation[1].lo;
    // For the actual major coordinate Y, Y - half_step <= origin_y + RN(v_y*dt).
    // Substitution before rounding the minor sum gives X <= RN(C - ratio*(Y-ref)).
    // The normal drift keeps its own sign and interval even for non-tangent rates.
    let drift = f(velocity[0])
        .add(f(velocity[1]).mul(Bound::exact(ratio)))
        .mul(Value::input(dt).ideal);
    let product_error = upper_add(half_ulp(product[0]), upper_mul(ratio, half_ulp(product[1])));
    let c = f(origin[0])
        .add(f(origin[1]).sub(f(reference_y)).mul(Bound::exact(ratio)))
        .add(drift)
        .add(Bound::exact(upper_add(ratio * (step * 0.5), product_error)));
    let reference_x = c.hi as f32;
    let dy = f(translation[1].hi).sub(f(reference_y));
    let dx = dy.mul(Bound::exact(-ratio));
    let x_end = (f64::from(reference_x) + dx.lo) as f32;
    let Some(xstep) = uniform_step(Float::span(reference_x, x_end)) else {
        return Ok(false);
    };
    if !c.finite() || ratio * step < 2. * xstep {
        return Ok(false);
    }
    let signed = [reference_x, reference_y];
    let shifts = [ratio * step, step];
    let possible = [Float::span(reference_x, x_end), translation[1]];
    let mut actual = [0.; 3];
    for (j, &i) in ids.iter().enumerate() {
        actual[i] = signed[j] * sign[j];
    }
    let center = dot_value(
        std::array::from_fn(|i| f(actual[i]).add(f(point[i]))),
        normal,
    );
    let reach = f(radius).mul(norm);
    let local = point.to_array().map(|v| Value::local(v, radius));
    let mut errors = [0.; 3];
    for (j, &i) in ids.iter().enumerate() {
        let t = translation[j];
        let world = Float::span(sign[j] * t.lo, sign[j] * t.hi);
        errors[i] = Value::input(world).add(local[i]).error;
    }
    // If any actual rounded local point reaches the plane, its real sphere
    // offset lies in this cap around r*n/|n|. Only these outputs must commute
    // with the two tangent shifts; the world-core graph is checked separately.
    let need = Bound::exact(limit)
        .sub(center)
        .sub(Bound::exact(projected_error(errors, normal)));
    if !need.finite() || need.lo <= 0. {
        return Ok(false);
    }
    let slack = reach.sub(need).hi.max(0.);
    let width = f(radius)
        .mul(Bound::exact(2.))
        .mul(Bound::exact(slack))
        .mul(Bound::exact((1. / norm.lo).next_up()))
        .sqrt();
    if !width.finite() {
        return Ok(false);
    }
    let inv = Bound {
        lo: (1. / norm.hi).next_down(),
        hi: (1. / norm.lo).next_up(),
    };
    for (j, &i) in ids.iter().enumerate() {
        let pole = f(radius).mul(f(normal[i].abs())).mul(inv);
        let near = f(sign[j] * point[i]).add(pole).add(Bound {
            lo: -width.hi,
            hi: width.hi,
        });
        let local_range = Float::span(near.lo as f32, near.hi as f32);
        for local in [local_range, Float::exact(sign[j] * point[i])] {
            let Some(spacing) = uniform_step(possible[j].add(local)) else {
                return Ok(false);
            };
            if shifts[j] < 2. * spacing {
                return Ok(false);
            }
        }
    }
    // Each actual major shift is an integer multiple of its grid. The minor
    // shift has the opposite sign and the exact plane ratio. Even shifts on the admitted
    // binades preserve nearest-even ties in the original F32 additions.
    let world = dot_value(std::array::from_fn(|i| f(actual[i] + point[i])), normal).add(reach);
    if !world.finite() || world.hi >= limit {
        return Ok(false);
    }
    let errors = std::array::from_fn(|i| Value::input(Float::exact(actual[i])).add(local[i]).error);
    if center
        .add(reach)
        .add(Bound::exact(projected_error(errors, normal)))
        .hi
        < limit
    {
        return Ok(true);
    }
    Ok(matches!(
        rounded_cap_projection(
            actual,
            point,
            radius,
            normal,
            limit,
            errors,
            CapQuery::Plane,
            work
        )?,
        CapPlane::Below
    ))
}

#[test]
fn near_tangent_ramp_preserves_separated_prefix_and_true_later_contact() {
    let domain =
        crate::physics3d::solver_trajectory::Domain::new(0., 0.004166666883975267).unwrap();
    let kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::new(0.52072126, 1.2187546, -1.6335289e-5)),
        rp::Vector::new(1.6137348, 0.80677265, 0.),
        rp::Vector::ZERO,
    )
    .unwrap();
    let cap = ShapeMotion {
        curve: Curve::Integrated(kernel),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let inward = rp::Vector::new(1., -2., 0.);
    let norm = Bound::exact(5.).sqrt();
    let limit = -Bound::exact(f64::from(0.01f32)).mul(norm).hi;
    let mut work = Work {
        used: 0,
        limit: 1024 * 1024,
    };
    let solve = |l, h, w: &mut Work| {
        separated(cap, -rp::Vector::Y * 0.5, 0.4, inward, norm, limit, l, h, w).unwrap()
    };
    let lo = 8.138021257764194e-5;
    let hi = 9.765625509317033e-5;
    assert!(solve(domain.start, lo, &mut work));
    assert!(solve(lo, hi, &mut work));
    assert!(!solve(hi, domain.end, &mut work));
    // The original world-space capsule itself reaches the clearance plane.
    let end = cap.pose(domain.end).translation - rp::Vector::Y * 0.5;
    let world_support = dot_value(end.to_array().map(|x| Bound::exact(f64::from(x))), inward)
        .add(Bound::exact(f64::from(0.4f32)).mul(norm));
    assert!(world_support.lo > limit);
}

#[test]
fn tangent_reduction_requires_exact_dyadic_axis_ratio() {
    let domain = crate::physics3d::solver_trajectory::Domain::new(0., 0.004).unwrap();
    let origin = rp::Vector::new(0.55, 1.25, 0.);
    let point = -rp::Vector::Y * 0.5;
    let kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        0.004,
        rp::Pose::from_translation(origin),
        rp::Vector::new(2., 0.5, 0.),
        rp::Vector::ZERO,
    )
    .unwrap();
    let cap = ShapeMotion {
        curve: Curve::Integrated(kernel),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    for (ratio, expected) in [(4.0f32, true), (4.0f32.next_up(), false)] {
        let n = rp::Vector::new(1., -ratio, 0.);
        let norm = Bound::exact(f64::from(ratio).powi(2) + 1.).sqrt();
        let threshold = dot_value(
            (origin + point)
                .to_array()
                .map(|v| Bound::exact(f64::from(v))),
            n,
        )
        .add(Bound::exact(f64::from(0.4f32)).mul(norm))
        .hi + 0.001;
        let mut work = Work {
            used: 0,
            limit: 1024 * 1024,
        };
        assert_eq!(
            separated(
                cap,
                point,
                0.4,
                n,
                norm,
                threshold,
                domain.start,
                domain.end,
                &mut work
            )
            .unwrap(),
            expected
        );
    }
}
