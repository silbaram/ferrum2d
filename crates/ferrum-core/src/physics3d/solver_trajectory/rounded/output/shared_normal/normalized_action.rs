//! A correlated range for the original box-top action under pure-axis rotation.
use super::*;

const MAX_SQUARED_NORMS: u32 = 256;
const EDGE_VALUES: u32 = 8;

/// All points below the returned number of face-adjacent grid values
/// round no higher than the face for any rotation in the supplied range.
pub(super) fn signed_face_tail(half: f32, axial: Float, scale: Float) -> Option<u32> {
    // Each signed product and the final rounded sum are odd in the
    // coordinate up to the sign of zero. Bound the absolute rounding error
    // on one half of the slab to keep opposing terms from sharing a sign.
    let (range, error) = action(Float::span(0., half), axial, scale)?;
    let slope = bound(scale).add(Bound::exact(2.).mul(square(axial)));
    if !range.finite() || !slope.finite() || slope.lo <= 0. {
        return None;
    }
    let mut point = half;
    for count in 1..=EDGE_VALUES {
        point = point.next_down();
        let width = Bound::exact(f64::from(half)).sub(Bound::exact(f64::from(point)));
        // Compare to this rotation's own face, so its coefficient is shared.
        // Each of the two scalar actions can round in the adverse direction.
        if point >= 0. && slope.mul(width).lo > 2. * error {
            return Some(count);
        }
    }
    None
}

pub(super) fn signed_face_mask(
    half: f32,
    axial: Float,
    scale: Float,
    work: &mut Work,
) -> Result<Option<u32>, TrajectoryError> {
    let Some(count) = signed_face_tail(half, axial, scale) else {
        return Ok(None);
    };
    // Interior values whose first product cannot gain more than their
    // second product loses are already covered by the original face.
    let mut mask = 0b11;
    for index in 2..count {
        work.charge(256)?;
        let point = f32::from_bits(half.to_bits() - index);
        let loss = second_product_gap(axial, point, half);
        let gain = signed_first_product_loss(point, half, scale);
        if gain.is_none_or(|gain| gain > loss) {
            mask |= 1 << index;
        }
    }
    Ok(Some(mask))
}

pub(super) fn signed_face_lift(half: f32, axial: Float, scale: Float) -> Option<f64> {
    let nearby = signed_face_tail(half, axial, scale)?;
    let mut point = half;
    let mut lift = 0_f64;
    for _ in 1..nearby {
        point = point.next_down();
        // Both products use the same rotation. A decrease in the second
        // term pays for part of the adverse increase in the first term.
        let first_gain = signed_first_product_loss(point, half, scale)?;
        let second_loss = second_product_gap(axial, point, half);
        let difference = Bound::exact(first_gain).sub(Bound::exact(second_loss));
        lift = lift.max(difference.hi);
    }
    Some(lift)
}

/// Both rounded products lie on binary lattices. Their exact sum lies
/// on the finer of those two lattices, even when the signs differ.
pub(super) fn signed_sum_spacing(point: f32, axial: Float, scale: Float) -> Option<f64> {
    if scale.hi >= 0. {
        return None;
    }
    let axial = if axial.hi < 0. {
        Float::span(-axial.hi, -axial.lo)
    } else {
        axial
    };
    let point = Float::exact(point);
    let first = point.mul(Float::span(-scale.hi, -scale.lo));
    let dot = point.mul(axial);
    let second = axial.mul(dot.mul(Float::exact(2.)));
    Some(binade(first)?.0.min(binade(second)?.0))
}

pub(super) fn signed_sum_in_output_cell(value: f32, spacing: f64) -> Option<Bound> {
    let below = (f64::from(value.next_down()) + f64::from(value)) * 0.5;
    let above = (f64::from(value.next_up()) + f64::from(value)) * 0.5;
    let units = Bound {
        lo: below,
        hi: above,
    }
    .mul(Bound::exact(spacing.recip()));
    if !units.finite() {
        return None;
    }
    // Include ties in both directions. Skipping fractional units is safe
    // because the original sum is an integer multiple of this power of two.
    Some(Bound {
        lo: units.lo.ceil() * spacing,
        hi: units.hi.floor() * spacing,
    })
}

/// Upper F32 output after adding the maximum certified lift to an input
/// that rounded to the represented outside face coordinate.
pub(super) fn signed_face_ceiling(face: f32, lift: f64) -> Option<f32> {
    if lift == 0. {
        return face.is_finite().then_some(face);
    }
    let neighbor = face.next_up();
    if !neighbor.next_up().is_finite() {
        return None;
    }
    let upper = if lift < f64::from(neighbor) - f64::from(face) {
        neighbor
    } else {
        // The largest unrounded sum that can produce `face` is
        // bounded by the midpoint, including either parity at a tie.
        let midpoint = (f64::from(face) + f64::from(neighbor)) * 0.5;
        Bound::exact(midpoint).add(Bound::exact(lift)).hi as f32
    };
    upper.is_finite().then_some(upper)
}

/// Maximum drop in the first rounded product as the point increases.
pub(super) fn signed_first_product_loss(lo: f32, hi: f32, scale: Float) -> Option<f64> {
    if lo == hi {
        return Some(0.);
    }
    let first_product = Float::span(lo, hi).mul(scale);
    let width = Bound::exact(f64::from(hi)).sub(Bound::exact(f64::from(lo)));
    let adverse = Bound::exact(f64::from((-scale.lo).max(0.)));
    let lift = width
        .mul(adverse)
        .add(Bound::exact(2. * rounding(first_product)?));
    if !lift.finite() {
        return None;
    }
    // When both products are on the same F32 grid, their difference is
    // an exact multiple of its spacing. Discard fractional excess.
    let magnitude = Float::span(-first_product.hi, -first_product.lo);
    let upper = if let Some((spacing, _, _)) = binade(magnitude) {
        lift.mul(Bound::exact(spacing.recip())).hi.floor() * spacing
    } else {
        lift.hi
    };
    Some(upper)
}

/// An upper bound on a rounded product difference on one common grid.
fn rounded_gap_upper(delta: Bound, spacing: f64) -> Option<f64> {
    let units = delta
        .mul(Bound::exact(spacing.recip()))
        .add(Bound::exact(1.));
    units.finite().then_some(units.hi.floor() * spacing)
}

/// Upper bound on face minus anchor before the final rounded addition.
/// Both rounded products use the same represented rotation.
pub(super) fn signed_pre_round_action_loss(
    half: f32,
    anchor: f32,
    axial: Float,
    scale: Float,
) -> Option<f64> {
    if scale.hi > 0. {
        return None;
    }
    let magnitude = if axial.hi < 0. {
        Float::span(-axial.hi, -axial.lo)
    } else {
        axial
    };
    let width = Bound::exact(f64::from(half)).sub(Bound::exact(f64::from(anchor)));
    let points = Float::span(anchor, half);
    let dot = points.mul(magnitude);
    let (dot_spacing, _, _) = binade(dot)?;
    let dot_loss = rounded_gap_upper(width.mul(bound(magnitude)), dot_spacing)?;
    // Doubling these represented dot outputs is exact. Bound the original
    // second product's rounding on its own grid.
    let twice = dot.mul(Float::exact(2.));
    let (second_spacing, _, _) = binade(twice.mul(magnitude))?;
    let second_loss = rounded_gap_upper(
        Bound::exact(2. * dot_loss).mul(bound(magnitude)),
        second_spacing,
    )?;
    let adverse = Float::span(-scale.hi, -scale.lo);
    let first_gain = binade(points.mul(adverse)).map_or(0., |(spacing, _, _)| {
        rounded_gap_steps(width.mul(bound(adverse)), spacing) * spacing
    });
    Some(Bound::exact(second_loss).sub(Bound::exact(first_gain)).hi)
}

/// Bound the loss from the original face action to a smaller anchor action
/// measured in the rounded outputs, including both final additions.
pub(super) fn signed_action_loss(
    half: f32,
    anchor: f32,
    axial: Float,
    scale: Float,
) -> Option<f64> {
    let (_, face_error) = action(Float::exact(half), axial, scale)?;
    let (_, anchor_error) = action(Float::exact(anchor), axial, scale)?;
    let width = Bound::exact(f64::from(half)).sub(Bound::exact(f64::from(anchor)));
    let slope = bound(scale).add(Bound::exact(2.).mul(square(axial)));
    let loss = width
        .mul(slope)
        .add(Bound::exact(sum(face_error, anchor_error)));
    loss.finite().then_some(loss.hi.max(0.))
}

/// Whole-slab support for one original rounded rotation with opposing
/// product slopes. The upper face alone can miss an interior F32 maximum.
pub(super) fn signed_face_upper(
    half: f32,
    axial: f32,
    scale: f32,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    Ok(signed_face_support(half, axial, scale, work)?.map(|(_, value)| value))
}

/// An original local coordinate that reaches the certified slab maximum.
pub(in crate::physics3d::solver_trajectory) fn signed_face_support(
    half: f32,
    axial: f32,
    scale: f32,
    work: &mut Work,
) -> Result<Option<(f32, f32)>, TrajectoryError> {
    work.charge(512)?;
    let axial_range = Float::exact(axial);
    let Some((range, error)) = action(Float::span(-half, half), axial_range, Float::exact(scale))
    else {
        return Ok(None);
    };
    let slope = Bound::exact(f64::from(scale)).add(Bound::exact(2.).mul(square(axial_range)));
    if !range.finite() || !slope.finite() || slope.lo <= 0. {
        return Ok(None);
    }
    let mut point = half;
    let mut support = half;
    let mut upper = f32::NEG_INFINITY;
    for _ in 0..EDGE_VALUES {
        if point < -half {
            break;
        }
        let value = normal_cells::point_action(point, axial, scale);
        if value > upper {
            support = point;
            upper = value;
        }
        point = point.next_down();
    }
    // For every remaining coordinate the positive ideal slope puts its
    // maximum at `point`. The absolute rounding envelope covers both signs.
    let rest = slope
        .mul(Bound::exact(f64::from(point)))
        .add(Bound::exact(error));
    let proved = point < -half || (rest.finite() && rest.hi <= f64::from(upper));
    Ok((upper.is_finite() && proved).then_some((support, upper)))
}

fn around(value: Bound, error: f64) -> Bound {
    value.add(Bound {
        lo: -error,
        hi: error,
    })
}

fn square_error(value: Bound, error: f64) -> f64 {
    let error = Bound::exact(error);
    let magnitude = value.lo.abs().max(value.hi.abs());
    Bound::exact(2.)
        .mul(Bound::exact(magnitude))
        .add(error)
        .mul(error)
        .hi
}

fn hull(a: Bound, b: Bound) -> Bound {
    Bound {
        lo: a.lo.min(b.lo),
        hi: a.hi.max(b.hi),
    }
}

struct RawNorm {
    represented: Float,
    rounding: f64,
    component: [Float; 2],
}

fn raw_norm(k: Kernel, axis: usize, dt: Float) -> Option<RawNorm> {
    let initial = k.native.motion.start.rotation.to_array();
    let hang = mul(k.native.angular_velocity, dt.mul(Float::exact(0.5)));
    let raw = product(
        [hang[0], hang[1], hang[2], Float::exact(1.)],
        initial.map(Float::exact),
    );
    let [q0, w0] = [initial[axis], initial[3]].map(Float::exact);
    let u = hang[axis];

    // The real sum of the two squared raw components is
    // (q0² + w0²)(1 + u²), with u the same original represented product.
    // Keep the rounding of each raw component and of the Native norm dot.
    let ideal_q = bound(u).mul(bound(w0)).add(bound(q0));
    let ideal_w = bound(w0).sub(bound(u).mul(bound(q0)));
    let raw_q_error = sum(rounding(u.mul(w0))?, rounding(raw[axis])?);
    let raw_w_error = sum(rounding(u.mul(q0))?, rounding(raw[3])?);
    let raw_error = sum(
        square_error(ideal_q, raw_q_error),
        square_error(ideal_w, raw_w_error),
    );

    let q_sq = raw[axis].mul(raw[axis]);
    let w_sq = raw[3].mul(raw[3]);
    let direct = q_sq.add(w_sq);
    let dot_rounding = sum(sum(rounding(q_sq)?, rounding(w_sq)?), rounding(direct)?);
    let ideal_norm = square(q0)
        .add(square(w0))
        .mul(Bound::exact(1.).add(square(u)));
    let enclosure = around(ideal_norm, sum(raw_error, dot_rounding));
    if !enclosure.finite() {
        return None;
    }
    // Monotone conversion is sufficient here: every norm in the hull is
    // already a represented F32, hence takes itself to itself under RN.
    let represented = Float {
        lo: direct.lo.max(enclosure.lo as f32),
        hi: direct.hi.min(enclosure.hi as f32),
    };
    (represented.finite() && represented.lo > 0. && represented.lo <= represented.hi).then_some(
        RawNorm {
            represented,
            rounding: dot_rounding,
            component: [raw[axis], raw[3]],
        },
    )
}

fn normalized_norm(
    raw: RawNorm,
    work: &mut Work,
) -> Result<Option<(Bound, [Float; 2])>, TrajectoryError> {
    let low = raw.represented.lo.to_bits();
    let high = raw.represented.hi.to_bits();
    let mut product = None;
    let mut factor = Float {
        lo: f32::INFINITY,
        hi: f32::NEG_INFINITY,
    };
    if high - low >= MAX_SQUARED_NORMS {
        // For this range both sqrt(s) and its reciprocal are normal F32
        // values. Each rounded operation has relative error at most u=2^-24,
        // so s * inverse² is between ((1-u)/(1+u))² and its reciprocal.
        if raw.represented.lo < 0.25 || raw.represented.hi > 4. {
            return Ok(None);
        }
        work.charge(256)?;
        factor = Float::span(
            raw.represented.hi.sqrt().recip(),
            raw.represented.lo.sqrt().recip(),
        );
        product = Some(around(Bound::exact(1.), 5. * 2_f64.powi(-24)));
    } else {
        for bits in low..=high {
            work.charge(128)?;
            let squared = f32::from_bits(bits);
            // Native scalar Quat::normalize uses the reciprocal of the rounded
            // F32 square root of this same rounded squared norm.
            let inverse = squared.sqrt().recip();
            if !inverse.is_finite() || inverse <= 0. {
                return Ok(None);
            }
            factor.lo = factor.lo.min(inverse);
            factor.hi = factor.hi.max(inverse);
            let scaled_norm = Bound::exact(f64::from(squared))
                .mul(Bound::exact(f64::from(inverse)))
                .mul(Bound::exact(f64::from(inverse)));
            product = Some(product.map_or(scaled_norm, |prior| hull(prior, scaled_norm)));
        }
    }
    let actual = raw.component.map(|value| value.mul(factor));
    let dot_error = Bound::exact(raw.rounding).mul(square(factor)).hi;
    let mut error = dot_error;
    for (input, actual) in raw.component.into_iter().zip(actual) {
        let Some(rounding) = rounding(actual) else {
            return Ok(None);
        };
        let scaled = bound(input).mul(bound(factor));
        error = sum(error, square_error(scaled, rounding));
    }
    Ok(product.map(|value| (around(value, error), actual)))
}

pub(super) fn interior(
    k: Kernel,
    axis: usize,
    dt: Float,
    half: f32,
    work: &mut Work,
) -> Result<Option<Bound>, TrajectoryError> {
    work.charge(2048)?;
    let Some(raw) = raw_norm(k, axis, dt) else {
        return Ok(None);
    };
    let Some((norm, [q, w])) = normalized_norm(raw, work)? else {
        return Ok(None);
    };
    let q_sq = q.mul(q);
    let w_sq = w.mul(w);
    let scale = w_sq.sub(q_sq);
    let (Some(q_error), Some(w_error), Some(scale_error)) =
        (rounding(q_sq), rounding(w_sq), rounding(scale))
    else {
        return Ok(None);
    };
    let Some((actual, action_error)) = action(Float::exact(half), q, scale) else {
        return Ok(None);
    };
    // S + 2*q² differs from the exact squared norm only by the errors of
    // the original two square operations and their F32 subtraction.
    let coefficient_error = sum(sum(q_error, w_error), scale_error);
    let half = Bound::exact(f64::from(half));
    let error = sum(action_error, half.mul(Bound::exact(coefficient_error)).hi);
    let enclosure = around(half.mul(norm), error);
    let actual = bound(actual);
    let overlap = Bound {
        lo: actual.lo.max(enclosure.lo),
        hi: actual.hi.min(enclosure.hi),
    };
    Ok((enclosure.finite() && overlap.finite() && overlap.lo <= overlap.hi).then_some(overlap))
}

pub(super) fn action_bounds(
    k: Kernel,
    axis: usize,
    start: Time,
    end: Time,
    half: f32,
    work: &mut Work,
) -> Result<Option<Bound>, TrajectoryError> {
    if axis >= 3
        || !start.is_finite()
        || !end.is_finite()
        || start < k.domain.start
        || end > k.domain.end
        || end < start
        || !half.is_finite()
        || half <= 0.
        || (0..3).any(|i| {
            i != axis
                && (k.native.angular_velocity[i] != 0.
                    || k.native.motion.start.rotation.to_array()[i] != 0.
                    || k.native.motion.end.rotation.to_array()[i] != 0.)
        })
    {
        return Ok(None);
    }
    work.charge(512)?;
    let lo = k.local_delta(start);
    let hi = k.local_delta(end);
    let h = k.native.integration_seconds;
    if !lo.is_finite() || !hi.is_finite() || lo > hi || !h.is_finite() || h <= 0. {
        return Ok(None);
    }
    let mut result = None;
    let mut point = rp::Vector::ZERO;
    point[axis] = half;
    for (active, rotation) in [
        (lo <= 0., k.native.motion.start.rotation),
        (hi >= h, k.native.motion.end.rotation),
    ] {
        if active {
            work.charge(128)?;
            let output = (rotation * point)[axis];
            if !output.is_finite() {
                return Ok(None);
            }
            let output = Bound::exact(f64::from(output));
            result = Some(result.map_or(output, |prior| hull(prior, output)));
        }
    }
    let dt = Float {
        lo: lo.max(f32::from_bits(1)),
        hi: hi.min(h.next_down()),
    };
    if dt.lo <= dt.hi {
        let Some(action) = interior(k, axis, dt, half, work)? else {
            return Ok(None);
        };
        result = Some(result.map_or(action, |prior| hull(prior, action)));
    }
    Ok(result)
}
