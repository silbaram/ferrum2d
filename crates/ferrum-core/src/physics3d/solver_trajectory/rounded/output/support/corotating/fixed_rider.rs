//! Project a rotating support anchor and its rider's world-space response on
//! one fixed face. The orbit and velocity use the same logical interval;
//! their two Native rounding clocks retain separate error bounds.
use super::*;

fn signed(center: f32, sign: f32) -> Bound {
    Bound::exact(f64::from(sign * center))
}

struct Projection {
    anchor: rp::Vector,
    offset: rp::Vector,
    relative: rp::Vector,
    spin: usize,
    axis: usize,
    sign: f32,
    reference: f32,
}
impl Projection {
    fn lower(&self, rotation: RotationProof, x: Bound, translation: rp::Vector) -> Option<f64> {
        let Projection {
            anchor,
            offset,
            relative,
            spin,
            axis,
            sign,
            reference,
        } = *self;
        let actual = Float::span(x.lo as f32, x.hi as f32);
        let logical = Value {
            actual,
            ideal: x,
            error: half_ulp(actual),
        };
        let part = |v: f32| Value::input(Float::exact(v));
        let point = transformed(
            rotation.actual_q,
            translation.to_array().map(part),
            anchor.to_array().map(part),
        )[axis];
        let output = sum(
            sum(point, part(offset[axis])),
            logical.mul(part(relative[axis])),
        );
        if !output.finite() {
            return None;
        }
        // A pure spin has just two nonzero quaternion components. Keep the common
        // elapsed time when summing its projected orbit and the relative velocity.
        let q = rotation.q[spin];
        let w = rotation.q[3];
        let ww = w.mul(w)?;
        let qq = q.mul(q)?;
        let cross = rp::Vector::AXES[spin].cross(anchor)[axis];
        let orbit = ww
            .sub(qq)
            .scale(signed(anchor[axis], sign))
            .add(w.mul(q)?.scale(signed(cross, sign).mul(Bound::exact(2.))));
        let mut linear = Polynomial::affine(0., signed(relative[axis], sign));
        linear.0[0] = signed(translation[axis], sign)
            .add(signed(offset[axis], sign))
            .sub(Bound::exact(f64::from(reference)));
        let f2 = rotation.factor.mul(rotation.factor);
        let middle = Bound::exact(f2.lo + (f2.hi - f2.lo) * 0.5);
        let span = orbit
            .scale(middle)
            .add(linear)
            .range(x)
            .add(orbit.range(x).mul(f2.sub(middle)));
        if !span.finite() {
            return None;
        }
        let mut lo = span.lo;
        // A second enclosure keeps reciprocal normalization tied to the raw
        // squared norm. Multiply through by the positive norm and bound the
        // resulting cubic over the entire interval, including interior extrema.
        if let Some(scale) = rotation.normalized_scale {
            let norm = ww.add(qq);
            let n = norm.range(x);
            let delta = orbit
                .add(linear.mul(norm)?)
                .range(x)
                .add(orbit.range(x).mul(scale.sub(Bound::exact(1.))));
            if n.finite() && n.lo > 0. && delta.finite() {
                let denom = if delta.lo >= 0. { n.hi } else { n.lo };
                lo = lo.max((delta.lo / denom).next_down());
            }
        }
        let value = Bound::exact(f64::from(reference))
            .add(Bound::exact(lo))
            .sub(Bound::exact(output.error));
        value.finite().then_some(value.lo)
    }

    // In a short slab each positive F32 range can contain only a few values.
    // Enumerate their Cartesian product so multiplying by exactly one stays
    // exact. Every represented value is admitted even when the ranges correlate.
    fn factor_cells(
        &self,
        raw: [Value; 4],
        poly: [Polynomial; 4],
        x: Bound,
        translation: rp::Vector,
        work: &mut Work,
    ) -> Result<Option<f64>, TrajectoryError> {
        let Some(factors) = factor(raw.map(|v| v.actual)).and_then(small_positive_cells) else {
            return Ok(None);
        };
        let mut lower = f64::INFINITY;
        for bits in factors {
            let factor = f32::from_bits(bits);
            let Some(scalars) = small_positive_cells(raw[3].actual.mul(Float::exact(factor)))
            else {
                return Ok(None);
            };
            for bits in scalars {
                work.charge(1024)?;
                let scalar = f32::from_bits(bits);
                let mut q = poly;
                q[3] = Polynomial::constant(scalar);
                q[self.spin] = q[self.spin].scale(Bound::exact(f64::from(factor)));
                let exact = |v| Value::input(Float::exact(v));
                let mut actual_q = [exact(0.); 4];
                actual_q[3] = exact(scalar);
                actual_q[self.spin] = raw[self.spin].mul(exact(factor));
                let rotation = RotationProof {
                    q,
                    actual_q,
                    factor: Bound::exact(1.),
                    normalized_scale: None,
                };
                let Some(value) = self.lower(rotation, x, translation) else {
                    return Ok(None);
                };
                lower = lower.min(value);
            }
        }
        Ok(Some(lower))
    }
}

fn small_positive_cells(range: Float) -> Option<std::ops::RangeInclusive<u32>> {
    if !range.finite() || range.lo <= 0. || range.hi.to_bits().checked_sub(range.lo.to_bits())? > 3
    {
        return None;
    }
    Some(range.lo.to_bits()..=range.hi.to_bits())
}

pub(in crate::physics3d::solver_trajectory::rounded::output::support) fn center_lower_bound(
    context: Context<'_>,
    axis: usize,
    sign: f32,
    reference: f32,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    let Curve::Anchored {
        carrier: k,
        anchor,
        offset,
        linear_velocity: relative,
        ..
    } = context.b.curve
    else {
        return Ok(None);
    };
    let omega = k.native.angular_velocity;
    let q0 = k.native.motion.start.rotation.to_array();
    let qe = k.native.motion.end.rotation.to_array();
    let h = f64::from(k.native.integration_seconds);
    let Some(spin) = (0..3).find(|&i| omega[i] != 0.) else {
        return Ok(None);
    };
    if spin == axis
        || k.native.linear_velocity != rp::Vector::ZERO
        || relative[axis] == 0.
        || (0..3).any(|i| i != spin && (omega[i] != 0. || q0[i] != 0. || qe[i] != 0.))
        || k.domain.duration() != h
        || context.start < k.domain.start
        || context.end > k.domain.end
        || ![anchor, offset, relative].iter().all(|v| v.is_finite())
    {
        return Ok(None);
    }
    let x = Bound {
        lo: (context.start - k.domain.start).clamp(0., h),
        hi: (context.end - k.domain.start).clamp(0., h),
    };
    let physical = Float::span(k.local_delta(context.start), k.local_delta(context.end));
    if !x.finite() || !physical.finite() {
        return Ok(None);
    }
    let mapping = upper_add(upper_mul(h, 2_f64.powi(-53)), (h.next_up() - h) * 0.5);
    let projection = Projection {
        spin,
        axis,
        sign,
        reference,
        anchor,
        offset,
        relative,
    };
    let mut lo = f64::INFINITY;
    for (present, x, pose) in [
        (
            physical.lo <= 0.,
            Bound {
                lo: x.lo,
                hi: x.hi.min(upper_add(mapping, half_ulp(Float::ZERO))),
            },
            k.native.motion.start,
        ),
        (
            physical.hi >= k.native.integration_seconds,
            Bound {
                lo: x.lo.max(
                    (h - upper_add(
                        mapping,
                        half_ulp(Float::exact(k.native.integration_seconds)),
                    ))
                    .next_down(),
                ),
                hi: x.hi,
            },
            k.native.motion.end,
        ),
    ] {
        if present && x.lo <= x.hi {
            work.charge(1024)?;
            let Some(bound) = constant_rotation(pose.rotation)
                .and_then(|r| projection.lower(r, x, pose.translation))
            else {
                return Ok(None);
            };
            lo = lo.min(bound);
        }
    }
    let interior = Float {
        lo: physical.lo.max(f32::from_bits(1)),
        hi: physical.hi.min(k.native.integration_seconds.next_down()),
    };
    if interior.lo <= interior.hi {
        work.charge(4096)?;
        let input = Value {
            actual: interior,
            ideal: x,
            error: upper_add(mapping, half_ulp(interior)),
        };
        let (raw, poly) = raw_rotation(input, omega, spin, q0);
        let Some(mut bound) = rotation_proof(raw, poly)
            .and_then(|r| projection.lower(r, x, k.native.motion.start.translation))
        else {
            return Ok(None);
        };
        if let Some(refined) =
            projection.factor_cells(raw, poly, x, k.native.motion.start.translation, work)?
        {
            bound = bound.max(refined);
        }
        lo = lo.min(bound);
    }
    if !lo.is_finite() {
        return Ok(None);
    }
    // Source centers are represented F32. A proved real lower bound may be
    // rounded up to its first admissible F32, including negative values.
    let center = lo as f32;
    Ok(Some(if f64::from(center) < lo {
        center.next_up()
    } else {
        center
    }))
}
