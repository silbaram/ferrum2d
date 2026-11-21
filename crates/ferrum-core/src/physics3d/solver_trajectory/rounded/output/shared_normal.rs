//! A sufficient full-support plane for a shared same-axis rotating carrier.
//! The original rounded scale S is common. Only delta(anchor-half)*C survives,
//! where C=S+2*q_axis^2; no unit-quaternion or endpoint-only argument is used.
use super::*;
mod independent;
mod normal_cells;
mod normalized_action;
pub(in crate::physics3d::solver_trajectory::rounded) use normal_cells::nearby_rotating_conflict;
pub(in crate::physics3d::solver_trajectory) use normalized_action::signed_face_support;

pub(in crate::physics3d::solver_trajectory::rounded) fn clear_prefix(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    let shared = normal_cells::prefix(context, normal, work)?;
    if shared.is_some() {
        return Ok(shared);
    }
    independent::prefix(context, normal, work)
}

pub(in crate::physics3d::solver_trajectory::rounded) fn complete_separation(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if normal_cells::complete_separation(context, normal, work)? {
        return Ok(true);
    }
    independent::separated(context, normal, work)
}

fn represented_upper(action: Bound) -> f32 {
    let upper = action.hi as f32;
    if f64::from(upper) > action.hi {
        upper.next_down()
    } else {
        upper
    }
}

/// The represented output range of one positive coordinate along a
/// pure-axis Native rotation, including the saved endpoint poses.
pub(in crate::physics3d) fn normal_action_range(
    kernel: Kernel,
    axis: usize,
    start: Time,
    end: Time,
    coordinate: f32,
    work: &mut Work,
) -> Result<Option<[f32; 2]>, TrajectoryError> {
    let Some(bound) = normalized_action::action_bounds(kernel, axis, start, end, coordinate, work)?
    else {
        return Ok(None);
    };
    Ok(represented_action_range(bound))
}

fn represented_action_range(bound: Bound) -> Option<[f32; 2]> {
    let mut lower = bound.lo as f32;
    if f64::from(lower) < bound.lo {
        lower = lower.next_up();
    }
    let upper = represented_upper(bound);
    (lower.is_finite() && upper.is_finite() && lower <= upper).then_some([lower, upper])
}

fn capsule_clears(
    top: f32,
    center: f32,
    core: f32,
    pole: f32,
    radius: f32,
    clearance: f32,
) -> bool {
    let top = Bound::exact(f64::from(top));
    let world_core = Bound::exact(f64::from(center + core));
    let local_pole = Bound::exact(f64::from(center + pole));
    let world = world_core.sub(Bound::exact(f64::from(radius))).sub(top);
    let local = local_pole.sub(top);
    world.finite()
        && local.finite()
        && world.lo > f64::from(clearance)
        && local.lo > f64::from(clearance)
}

fn same_rotation_clock(a: Kernel, b: Kernel) -> bool {
    a.domain.start.to_bits() == b.domain.start.to_bits()
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && a.native.integration_seconds.to_bits() == b.native.integration_seconds.to_bits()
        && a.native.motion.start_time.to_bits() == b.native.motion.start_time.to_bits()
        && a.native.motion.end_time.to_bits() == b.native.motion.end_time.to_bits()
        && a.native.motion.start.rotation.to_array().map(f32::to_bits)
            == b.native.motion.start.rotation.to_array().map(f32::to_bits)
        && a.native.motion.end.rotation.to_array().map(f32::to_bits)
            == b.native.motion.end.rotation.to_array().map(f32::to_bits)
        && a.native.angular_velocity.to_array().map(f32::to_bits)
            == b.native.angular_velocity.to_array().map(f32::to_bits)
}

fn same_kernel(a: Kernel, b: Kernel) -> bool {
    a.native.motion.body == b.native.motion.body
        && same_rotation_clock(a, b)
        && a.native
            .motion
            .start
            .translation
            .to_array()
            .map(f32::to_bits)
            == b.native
                .motion
                .start
                .translation
                .to_array()
                .map(f32::to_bits)
        && a.native.motion.end.translation.to_array().map(f32::to_bits)
            == b.native.motion.end.translation.to_array().map(f32::to_bits)
        && a.native.linear_velocity.to_array().map(f32::to_bits)
            == b.native.linear_velocity.to_array().map(f32::to_bits)
}
fn qi(q: rp::Rotation) -> bool {
    q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
}
fn local_identity(m: ShapeMotion) -> bool {
    m.local_center == rp::Vector::ZERO
        && m.local_pose.translation == rp::Vector::ZERO
        && qi(m.local_pose.rotation)
}
fn bound(v: Float) -> Bound {
    Bound {
        lo: f64::from(v.lo),
        hi: f64::from(v.hi),
    }
}
fn square(v: Float) -> Bound {
    let lo = if v.lo <= 0. && v.hi >= 0. {
        0.
    } else {
        v.lo.abs().min(v.hi.abs())
    };
    let hi = v.lo.abs().max(v.hi.abs());
    Bound {
        lo: Bound::exact(f64::from(lo))
            .mul(Bound::exact(f64::from(lo)))
            .lo
            .max(0.),
        hi: Bound::exact(f64::from(hi))
            .mul(Bound::exact(f64::from(hi)))
            .hi,
    }
}
fn rounding(v: Float) -> Option<f64> {
    if !v.finite() {
        return None;
    }
    let m = v.lo.abs().max(v.hi.abs());
    let next = m.next_up();
    let spacing = if next.is_finite() {
        f64::from(next) - f64::from(m)
    } else {
        f64::from(m) - f64::from(m.next_down())
    };
    Some(spacing * 0.5)
}
fn sum(a: f64, b: f64) -> f64 {
    Bound::exact(a).add(Bound::exact(b)).hi
}

// Original normal rotation graph: RN(p*S + q*RN(2*RN(p*q))).
// Other quaternion coordinates are numeric zero, so their normal cross/dot
// terms add only zeros. Positive anchor/half keep their scalar signs fixed.
// For the *whole box* p ranges over [-half,+half], including interior points.
fn action(p: Float, q: Float, scale: Float) -> Option<(Float, f64)> {
    let dot = p.mul(q);
    let twice = dot.mul(Float::exact(2.));
    let first = p.mul(scale);
    let second = q.mul(twice);
    let result = first.add(second);
    if !twice.finite() {
        return None;
    } // finite F32 times2 is exact, even subnormal
    let dot_error = Bound::exact(rounding(dot)?)
        .mul(Bound::exact(2. * f64::from(q.lo.abs().max(q.hi.abs()))))
        .hi;
    let error = sum(
        sum(rounding(first)?, dot_error),
        sum(rounding(second)?, rounding(result)?),
    );
    error.is_finite().then_some((result, error))
}

// One positive normal binade. Its ULP is the exact common grid used below.
fn binade(v: Float) -> Option<(f64, f64, f64)> {
    if !v.finite() || v.lo <= 0. {
        return None;
    }
    let exponent = (v.lo.to_bits() >> 23) & 255;
    if exponent == 0 || exponent >= 254 || ((v.hi.to_bits() >> 23) & 255) != exponent {
        return None;
    }
    let low = f32::from_bits(exponent << 23);
    Some((
        f64::from(low.next_up()) - f64::from(low),
        f64::from(low),
        2. * f64::from(low),
    ))
}

// Prove a common RN product gap without visiting every scale. For a scale
// K / 2^24, split the half product H*K / 2^24 into a small periodic term
// and its drift. Each residue class is a complete enclosure; lower and
// upper rounding envelopes include both sides of exact ties.
fn modular_product_gap(
    scale: Float,
    spacing: f64,
    half: f32,
    anchor: f32,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    work.charge(512)?;
    let units = |p| f64::from(p) / spacing;
    let h = units(half);
    let a = units(anchor);
    let limit = f64::from(1_u32 << 24);
    if scale.lo < 0.5
        || scale.hi >= 1.
        || !scale.finite()
        || h.fract() != 0.
        || a.fract() != 0.
        || h < limit * 0.5
        || a >= limit
        || a <= h
    {
        return Ok(None);
    }
    let h = h as i64;
    let limit = i64::from(1_u32 << 24);
    let significand = |s: f32| i64::from((1 << 23) | (s.to_bits() & 0x7f_ffff));
    let low = significand(scale.lo);
    let high = significand(scale.hi);
    let (mut numerator, mut denominator, mut residual) = (1, 1, h - limit);
    for d in 2..=16 {
        work.charge(32)?;
        let c = (d * h + limit / 2) / limit;
        let r = d * h - c * limit;
        if r.abs() * denominator < residual.abs() * d {
            (numerator, denominator, residual) = (c, d, r);
        }
    }
    let exact = |v: i64| Bound::exact(v as f64);
    let (mut gap, half_unit) = (f64::INFINITY, Bound::exact(0.5));
    let fraction = |n, d| {
        let value = n as f64 / d as f64;
        Bound {
            lo: value.next_down(),
            hi: value.next_up(),
        }
    };
    for residue in 0..denominator {
        work.charge(128)?;
        let first = low + (residue - low).rem_euclid(denominator);
        let last = high - (high - residue).rem_euclid(denominator);
        if first > last {
            continue;
        }
        let indices = Bound {
            lo: exact(first).lo,
            hi: exact(last).hi,
        };
        let phase = fraction((numerator * residue) % denominator, denominator)
            .add(fraction(residual, denominator * limit).mul(indices));
        let shift = indices.mul(exact(a as i64 - h)).mul(fraction(1, limit));
        let upper = phase.add(half_unit).hi.floor();
        let lower = phase.add(shift).sub(half_unit).lo.ceil();
        gap = gap.min(lower - upper);
    }
    Ok(gap.is_finite().then_some(gap))
}

// A strict lower real difference of n spacings survives both roundings
// as an output gap of at least n steps on the common lattice. Equality
// can land on two ties, so use only integers strictly below the bound.
fn rounded_gap_steps(delta: Bound, spacing: f64) -> f64 {
    let units = delta.mul(Bound::exact(spacing.recip()));
    if units.finite() {
        (units.lo.ceil() - 1.).max(0.)
    } else {
        0.
    }
}

fn second_product_gap(q: Float, half: f32, anchor: f32) -> f64 {
    let magnitude = if q.hi < 0. {
        Float::span(-q.hi, -q.lo)
    } else {
        q
    };
    if magnitude.lo <= 0. {
        return 0.;
    }
    let dot = Float::span(half, anchor).mul(magnitude);
    let Some((dot_ulp, _, _)) = binade(dot) else {
        return 0.;
    };
    let dot_difference = Bound::exact(f64::from(anchor))
        .sub(Bound::exact(f64::from(half)))
        .mul(bound(magnitude));
    let dot_steps = rounded_gap_steps(dot_difference, dot_ulp);
    // Doubling finite dot outputs is exact. The resulting second product
    // has its own rounded lattice, possibly finer than the first product.
    let second = dot.mul(Float::exact(2.)).mul(magnitude);
    let Some((second_ulp, _, _)) = binade(second) else {
        return 0.;
    };
    let difference =
        Bound::exact(2. * dot_steps * dot_ulp).mul(Bound::exact(f64::from(magnitude.lo)));
    rounded_gap_steps(difference, second_ulp) * second_ulp
}

fn continuous_second_increase(q: Float, half: f32, anchor: f32) -> bool {
    let h_dot = Float::exact(half).mul(q);
    let a_dot = Float::exact(anchor).mul(q);
    let h_twice = h_dot.mul(Float::exact(2.));
    let a_twice = a_dot.mul(Float::exact(2.));
    let h_second = q.mul(h_twice);
    let a_second = q.mul(a_twice);
    let (Some(h_error), Some(a_error), Some(h_last), Some(a_last)) = (
        rounding(h_dot),
        rounding(a_dot),
        rounding(h_second),
        rounding(a_second),
    ) else {
        return false;
    };
    if !h_twice.finite() || !a_twice.finite() {
        return false;
    }
    let error = Bound::exact(sum(h_error, a_error))
        .mul(Bound::exact(2. * f64::from(q.lo.abs().max(q.hi.abs()))))
        .add(Bound::exact(sum(h_last, a_last)));
    let delta = Bound::exact(f64::from(anchor))
        .sub(Bound::exact(f64::from(half)))
        .mul(Bound::exact(2.))
        .mul(square(q))
        .sub(error);
    delta.finite() && delta.lo > 0.
}

#[allow(clippy::too_many_arguments)]
fn lattice_phase(
    q: Float,
    scale: Float,
    translation: Float,
    product: Float,
    half: f32,
    anchor: f32,
    offset: f32,
    core: f32,
    radius: f32,
    clearance: f32,
    motion: Option<(Kernel, usize, Time, Time)>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    // Only the original zero normal-relative expression. Existing successful
    // envelopes above pay no new work; gravity and moving normal terms decline.
    if product.lo != 0. || product.hi != 0. {
        return Ok(false);
    }
    work.charge(512)?;
    if scale.lo <= 0.
        || translation.lo.to_bits() != translation.hi.to_bits()
        || translation.lo >= 0.
        || anchor <= half
    {
        return Ok(false);
    }
    let first_h = Float::exact(half).mul(scale);
    let first_a = Float::exact(anchor).mul(scale);
    let Some((ulp, _, _)) = binade(first_h) else {
        return Ok(false);
    };
    if binade(first_a).is_none_or(|v| v.0 != ulp) {
        return Ok(false);
    }
    // Both actual first products lie on this output grid. Their real input
    // difference is (anchor-half)*S; two half-ULPs cost at most one grid step.
    // A strict lower > one step therefore proves an ACTUAL >=two-step gap.
    let first_delta = Bound::exact(f64::from(anchor))
        .sub(Bound::exact(f64::from(half)))
        .mul(bound(scale));
    let difference = first_delta.sub(Bound::exact(ulp));
    if !difference.finite() {
        return Ok(false);
    }
    let clear = |step, bounds, work: &mut Work| {
        lattice_shift(
            q,
            scale,
            translation,
            half,
            offset,
            core,
            radius,
            clearance,
            step,
            bounds,
            work,
        )
    };
    let low = scale.lo.to_bits();
    let high = scale.hi.to_bits();
    let bounded_image = high
        .checked_sub(low)
        .and_then(|v| v.checked_add(1))
        .is_some_and(|n| n <= 256);
    let mut minimum = None;
    if difference.lo <= ulp && bounded_image {
        let mut gap = f64::INFINITY;
        for bits in low..=high {
            work.charge(128)?;
            let scalar = f32::from_bits(bits);
            let h = half * scalar;
            let a = anchor * scalar;
            if !h.is_finite() || !a.is_finite() {
                return Ok(false);
            }
            gap = gap.min((f64::from(a) - f64::from(h)) / ulp);
            if gap < 2. {
                // This is a partial scan. Only monotonicity remains
                // established over the complete image.
                gap = 0.;
                break;
            }
        }
        minimum = Some(gap);
    }
    if (difference.lo > ulp || minimum.is_some_and(|gap| gap >= 2.)) && clear(2. * ulp, None, work)?
    {
        return Ok(true);
    }
    // Keep the existing two-ULP proof and its successful price first. For
    // larger deltas, use the complete finite image of S or its residue bounds.
    work.charge(512)?;
    let minimum = if let Some(gap) = minimum {
        gap
    } else if bounded_image {
        let mut gap = f64::INFINITY;
        for bits in low..=high {
            work.charge(128)?;
            let s = f32::from_bits(bits);
            let h = half * s;
            let a = anchor * s;
            if !h.is_finite() || !a.is_finite() {
                return Ok(false);
            }
            gap = gap.min((f64::from(a) - f64::from(h)) / ulp);
        }
        gap
    } else {
        // The residue proof requires the same spacing for the first
        // products and the input coordinates. The analytic gap below
        // remains usable when those spacings differ.
        modular_product_gap(scale, ulp, half, anchor, work)?.unwrap_or(0.)
    };
    if !minimum.is_finite() || minimum.fract() != 0. {
        return Ok(false);
    }
    // Keep the first-product proof and its odd-tie guard ahead of
    // the more precise sum of both rounded product gaps.
    let first_only =
        if minimum >= 2. && (minimum % 2. == 0. || continuous_second_increase(q, half, anchor)) {
            minimum
        } else {
            0.
        };
    if first_only > 2. && clear(first_only * ulp, None, work)? {
        return Ok(true);
    }
    let combined_gap = |work: &mut Work| {
        work.charge(256)?;
        let first = rounded_gap_steps(first_delta, ulp).max(minimum) * ulp;
        let second = second_product_gap(q, half, anchor);
        Ok::<_, TrajectoryError>(Bound::exact(first).add(Bound::exact(second)))
    };
    let gap = if first_only == 0. {
        let gap = combined_gap(work)?;
        if !gap.finite() || gap.lo <= 0. {
            return Ok(false);
        }
        Some(gap)
    } else {
        None
    };
    let Some((carrier, axis, start, end)) = motion else {
        return Ok(false);
    };
    let Some(action) = normalized_action::action_bounds(carrier, axis, start, end, half, work)?
    else {
        return Ok(false);
    };
    if first_only > 0. && clear(first_only * ulp, Some(action), work)? {
        return Ok(true);
    }
    let gap = match gap {
        Some(gap) => gap,
        None => combined_gap(work)?,
    };
    let steps = rounded_gap_steps(gap, ulp);
    if steps > first_only && clear(steps * ulp, Some(action), work)? {
        return Ok(true);
    }
    action_image_clears(
        action,
        ActionGap::BeforeFinalRound(gap),
        translation.lo,
        offset,
        core,
        radius,
        clearance,
        work,
    )
}

// The same complete original BoxTop lattice and both original radius graphs,
// at an independently established action gap. First try uses exactly 2 ULP;
// larger even shifts preserve parity, odd shifts require the strict-term proof.
#[allow(clippy::too_many_arguments)]
fn lattice_shift(
    q: Float,
    scale: Float,
    translation: Float,
    half: f32,
    offset: f32,
    core: f32,
    radius: f32,
    clearance: f32,
    step: f64,
    normal_action: Option<Bound>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let first_h = Float::exact(half).mul(scale);
    let Some((ulp, bin_low, bin_high)) = binade(first_h) else {
        return Ok(false);
    };
    let second_h = q.mul(Float::exact(half).mul(q).mul(Float::exact(2.)));
    let pre = bound(first_h).add(bound(second_h));
    let Some((g, _)) = action(Float::exact(half), q, scale) else {
        return Ok(false);
    };
    if !pre.finite()
        || pre.lo < bin_low
        || Bound::exact(pre.hi).add(Bound::exact(step)).hi > bin_high - ulp
        || f64::from(first_h.hi) + step > bin_high - ulp
        || binade(g).is_none_or(|v| v.0 != ulp)
    {
        return Ok(false);
    }
    // For each fixed original q, q*RN(2*RN(p*q)) is nondecreasing in p,
    // including negative q (both multiplies reverse order together). Thus
    // the second term cannot undo the first product's increase.
    // The admitted shift preserves ties-even, or its strict second-term
    // increment removes the only adverse odd-shift tie. Hence the actual
    // action gap is at least step in this complete binade, for ALL times.
    let actual = normal_action.map_or(bound(g), |n| Bound {
        lo: f64::from(g.lo).max(n.lo),
        hi: f64::from(g.hi).min(n.hi),
    });
    let t = f64::from(translation.lo);
    let magnitude = -t;
    if !actual.finite()
        || actual.lo < magnitude * 0.5
        || actual.add(Bound::exact(step)).hi > magnitude * 2.
    {
        return Ok(false);
    }
    // Sterbenz makes T+g and T+(g+step) exact. Every original action output
    // is on the common grid. Restrict visits to points inside both bounds.
    let t_units = t / ulp;
    let coordinates = actual.add(Bound::exact(t));
    let low = (coordinates.lo / ulp).ceil();
    let high = (coordinates.hi / ulp).floor();
    if [t_units, low, high]
        .into_iter()
        .any(|v| !v.is_finite() || v.abs() > (1_u64 << 52) as f64 || v.fract() != 0.)
        || high < low
        || high - low + 1. > 256.
    {
        return Ok(false);
    }
    let pole = core - radius; // retain the original local RN radius graph
    if !pole.is_finite() {
        return Ok(false);
    }
    for units in low as i64..=high as i64 {
        work.charge(256)?; // actual complete lattice support/dual-radius visit
        let box_value = units as f64 * ulp;
        let shifted = box_value + step;
        let lower = shifted as f32;
        if !lower.is_finite() || f64::from(lower) != shifted {
            return Ok(false);
        }
        let com = lower + offset;
        let world_core = com + core;
        let local_pole = com + pole;
        if !com.is_finite() || !world_core.is_finite() || !local_pole.is_finite() {
            return Ok(false);
        }
        let world = Bound::exact(f64::from(world_core))
            .sub(Bound::exact(f64::from(radius)))
            .sub(Bound::exact(box_value));
        let local = Bound::exact(f64::from(local_pole)).sub(Bound::exact(box_value));
        if !world.finite()
            || !local.finite()
            || world.lo <= f64::from(clearance)
            || local.lo <= f64::from(clearance)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

#[derive(Clone, Copy)]
enum ActionGap {
    Rounded(Bound),
    BeforeFinalRound(Bound),
}

impl ActionGap {
    fn anchor_floor(self, face: f32) -> Option<f32> {
        let (lower, delta) = match self {
            Self::Rounded(delta) => (f64::from(face), delta),
            Self::BeforeFinalRound(delta) => {
                // RN(face_input) == face implies face_input is no lower
                // than this midpoint, including ties and binade boundaries.
                let midpoint = (f64::from(face.next_down()) + f64::from(face)) * 0.5;
                (midpoint, delta)
            }
        };
        // RN of a lower real bound is no greater than the actual
        // represented anchor action.
        let bound = Bound::exact(lower).add(delta);
        bound.finite().then_some(bound.lo as f32)
    }
}

#[allow(clippy::too_many_arguments)]
fn action_image_clears(
    action: Bound,
    gap: ActionGap,
    translation: f32,
    offset: f32,
    core: f32,
    radius: f32,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let mut first = action.lo as f32;
    if f64::from(first) < action.lo {
        first = first.next_up();
    }
    let last = represented_upper(action);
    if !action.finite() || first <= 0. || !last.is_finite() || first > last {
        return Ok(false);
    }
    let (low, high) = (first.to_bits(), last.to_bits());
    if high - low >= 256 {
        return Ok(false);
    }
    let pole = core - radius;
    for bits in low..=high {
        work.charge(256)?;
        let box_action = f32::from_bits(bits);
        let Some(anchor_floor) = gap.anchor_floor(box_action) else {
            return Ok(false);
        };
        let top = box_action + translation;
        let center = (translation + anchor_floor) + offset;
        if !capsule_clears(top, center, core, pole, radius, clearance) {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(in crate::physics3d::solver_trajectory::rounded) fn separated(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    let (bm, cuboid, cm, capsule, n) = if let (Some(x), Some(y)) = (sa.as_cuboid(), sb.as_capsule())
    {
        (a, x, b, y, normal)
    } else if let (Some(x), Some(y)) = (sb.as_cuboid(), sa.as_capsule()) {
        (b, x, a, y, -normal)
    } else {
        return Ok(false);
    };
    let (
        Curve::Integrated(k),
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: relative,
            rotation,
        },
    ) = (bm.curve, cm.curve)
    else {
        return Ok(false);
    };
    // Existing finite-image and qI scalar successes/prices keep precedence.
    if k.native.angular_velocity == rp::Vector::ZERO {
        return Ok(false);
    }
    let Some(axis) = (0..3).find(|&i| n[i] == 1.) else {
        return Ok(false);
    };
    if (0..3).any(|i| i != axis && n[i] != 0.) {
        return Ok(false);
    }
    work.charge(512)?;
    if !start.is_finite() || !end.is_finite() || start > end {
        return Err(TrajectoryError::InvalidTime);
    }
    if !clearance.is_finite() || !n.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if !same_kernel(k, carrier)
        || !local_identity(bm)
        || !local_identity(cm)
        || !qi(rotation)
        || !anchor.is_finite()
        || !offset.is_finite()
        || !relative.is_finite()
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() <= 0.
        || !capsule.segment.a.is_finite()
        || !capsule.segment.b.is_finite()
        || !capsule.radius.is_finite()
        || capsule.radius < 0.
        || anchor[axis] <= 0.
        || (0..3).any(|i| {
            i != axis
                && (k.native.angular_velocity[i] != 0.
                    || k.native.motion.start.rotation.to_array()[i] != 0.
                    || k.native.motion.end.rotation.to_array()[i] != 0.)
        })
        || start < k.domain.start
        || end > k.domain.end
    {
        return Ok(false);
    }
    Kernel::from_native(k.native, k.domain)?;
    let seconds = Float::span(
        (start - k.domain.start).clamp(0., k.domain.duration()) as f32,
        (end - k.domain.start).clamp(0., k.domain.duration()) as f32,
    );
    if !seconds.finite() {
        return Ok(false);
    } // preserve original ZERO*Inf fallback
    let product = Float::exact(relative[axis]).mul(seconds);
    if !product.finite() {
        return Ok(false);
    }
    // A separating projection cannot hide overflow in another coordinate or
    // in the original local/world radius interpretations. Reuse old admission.
    for (motion, shape) in [(a, sa), (b, sb)] {
        let bounds = motion.bounds(shape, start, end, work)?;
        if !bounds.mins.is_finite() || !bounds.maxs.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
    }
    let Some(phases) = frames(Curve::Integrated(k), start, end, work)? else {
        return Ok(false);
    };
    let half = cuboid.half_extents[axis];
    let core = capsule.segment.a[axis].min(capsule.segment.b[axis]);
    let pole = core - capsule.radius; // original local RN radius graph
    if !pole.is_finite() {
        return Ok(false);
    }
    for frame in &phases.values[..phases.len] {
        work.charge(2048)?; // actual scalar phase, coefficient and two radius proofs
        let q = frame.rotation.components;
        if q.iter().any(|v| !v.finite())
            || (0..3).any(|i| i != axis && (q[i].lo != 0. || q[i].hi != 0.))
        {
            return Ok(false);
        }
        let b2 = q[0].mul(q[0]).add(q[1].mul(q[1])).add(q[2].mul(q[2]));
        let scale = q[3].mul(q[3]).sub(b2);
        let coefficient = bound(scale).add(square(q[axis]).mul(Bound::exact(2.)));
        if !scale.finite() || !coefficient.finite() || coefficient.lo <= 0. {
            return Ok(false);
        }
        let (Some((all_box, box_error)), Some((actor_action, actor_error))) = (
            action(Float::span(-half, half), q[axis], scale),
            action(Float::exact(anchor[axis]), q[axis], scale),
        ) else {
            return Ok(false);
        };
        let t = frame.translation[axis];
        let box_point = t.add(all_box);
        let first = t.add(actor_action);
        let second = first.add(Float::exact(offset[axis]));
        let com = second.add(product);
        let world_core = com.add(Float::exact(core));
        let local_pole = com.add(Float::exact(pole));
        let (Some(ebox), Some(efirst), Some(eoffset), Some(efinal), Some(eworld), Some(elocal)) = (
            rounding(box_point),
            rounding(first),
            rounding(second),
            if product.lo == 0. && product.hi == 0. {
                Some(0.)
            } else {
                rounding(com)
            },
            if core == 0. {
                Some(0.)
            } else {
                rounding(world_core)
            },
            if pole == 0. {
                Some(0.)
            } else {
                rounding(local_pole)
            },
        ) else {
            return Ok(false);
        };
        // The actual shared T cancels. All original p<=half are enclosed by
        // positive C, so only delta(anchor-half)*C remains, plus RN errors.
        let delta = Bound::exact(f64::from(anchor[axis]))
            .sub(Bound::exact(f64::from(half)))
            .mul(coefficient);
        let base = delta
            .add(Bound::exact(f64::from(offset[axis])))
            .add(Bound::exact(f64::from(product.lo)));
        let common = sum(
            sum(actor_error, box_error),
            sum(ebox, sum(efirst, sum(eoffset, efinal))),
        );
        let world = base
            .add(Bound::exact(f64::from(core)))
            .sub(Bound::exact(f64::from(capsule.radius)))
            .sub(Bound::exact(sum(common, eworld)));
        let local = base
            .add(Bound::exact(f64::from(pole)))
            .sub(Bound::exact(sum(common, elocal)));
        if !world.finite()
            || !local.finite()
            || world.lo <= f64::from(clearance)
            || local.lo <= f64::from(clearance)
        {
            if anchor[axis] <= half {
                // A nonnegative scale preserves monotonicity from all
                // points in the slab to its positive face. The relative
                // position and translation here are fixed on this frame.
                if scale.lo < 0.
                    || t.lo.to_bits() != t.hi.to_bits()
                    || product.lo != 0.
                    || product.hi != 0.
                {
                    return Ok(false);
                }
                let Some(box_action) =
                    normalized_action::action_bounds(k, axis, start, end, half, work)?
                else {
                    return Ok(false);
                };
                let gap = delta.sub(Bound::exact(sum(actor_error, box_error)));
                if !action_image_clears(
                    box_action,
                    ActionGap::Rounded(gap),
                    t.lo,
                    offset[axis],
                    core,
                    capsule.radius,
                    clearance,
                    work,
                )? {
                    return Ok(false);
                }
            } else if !lattice_phase(
                q[axis],
                scale,
                t,
                product,
                half,
                anchor[axis],
                offset[axis],
                core,
                capsule.radius,
                clearance,
                Some((k, axis, start, end)),
                work,
            )? {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests;
