//! Partition the original positive F32 integration deltas into rows with a
//! single represented pivot coefficient. Every translation and quaternion
//! component in a row is evaluated on that row's physical time interval.
use super::*;

#[derive(Clone, Copy)]
struct PivotClock {
    start: f32,
    omega: f32,
    w: f32,
}

impl PivotClock {
    fn raw(self, dt: f32) -> f32 {
        self.start + ((dt * 0.5) * self.omega) * self.w
    }

    fn certify(k: Kernel, dt: Float, pivot: usize) -> Option<Self> {
        let q = k.native.motion.start.rotation.to_array();
        let omega = k.native.angular_velocity.to_array();
        let clock = Self {
            start: q[pivot],
            omega: omega[pivot],
            w: q[3],
        };
        let moving = Float::span(clock.raw(dt.lo), clock.raw(dt.hi));
        if !moving.finite()
            || moving.lo == 0.
            || moving.lo.signum() != moving.hi.signum()
            || moving.lo.to_bits().abs_diff(moving.hi.to_bits()) >= 4096
            || clock.omega == 0.
            || clock.w == 0.
        {
            return None;
        }
        let step = dt.mul(Float::exact(0.5));
        // product(increment, q) adds the three vector terms in x,y,z order.
        // The two off-axis products can be removed only when both additions
        // round to their original accumulator throughout the full interval.
        for (i, &axis_omega) in omega.iter().enumerate() {
            if i == pivot {
                continue;
            }
            let other = 3 - i - pivot;
            let term = step
                .mul(Float::exact(axis_omega))
                .mul(Float::exact(q[other]));
            let accumulator = if i < pivot {
                Float::exact(q[pivot])
            } else {
                moving
            };
            if !term.finite()
                || f64::from(term.lo.abs().max(term.hi.abs())) >= minimum_half_cell(accumulator)?
            {
                return None;
            }
        }
        Some(clock)
    }

    fn last_key(
        self,
        first: u32,
        last: u32,
        value: f32,
        work: &mut Work,
    ) -> Result<u32, TrajectoryError> {
        // RN multiplication and addition by constants are monotone. Invert
        // the next midpoint approximately, then check its real F32 neighbors.
        // A larger discrepancy merely takes the bounded scalar binary search.
        let next = if self.omega.is_sign_negative() == self.w.is_sign_negative() {
            value.next_up()
        } else {
            value.next_down()
        };
        let boundary = ((f64::from(value) + f64::from(next)) * 0.5 - f64::from(self.start))
            / (0.5 * f64::from(self.omega) * f64::from(self.w));
        let guess = (boundary as f32).to_bits().clamp(first, last);
        let mut lo = first;
        let mut hi = last;
        for key in [
            guess,
            guess.saturating_sub(1).max(first),
            guess.saturating_add(1).min(last),
        ] {
            work.charge(4)?;
            if self.raw(f32::from_bits(key)) == value {
                lo = lo.max(key);
                if key == last || self.raw(f32::from_bits(key + 1)) != value {
                    return Ok(key);
                }
            } else {
                hi = hi.min(key - 1);
            }
        }
        while lo < hi {
            work.charge(4)?;
            let mid = lo + (hi - lo).div_ceil(2);
            if self.raw(f32::from_bits(mid)) == value {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        Ok(lo)
    }
}

fn factors(raw: [Float; 4]) -> Option<Small> {
    let low = rp::Rotation::from_array(raw.map(|x| {
        if x.lo <= 0. && x.hi >= 0. {
            0.
        } else {
            x.lo.abs().min(x.hi.abs())
        }
    }));
    let high = rp::Rotation::from_array(raw.map(|x| x.lo.abs().max(x.hi.abs())));
    // All four original rounded squares and sums are monotone in magnitude.
    // Evaluate the Native reciprocal-length operation on their extrema.
    let lo = high.length_recip();
    let hi = low.length_recip();
    if !lo.is_finite() || lo <= 0. || !hi.is_finite() || lo > hi {
        return None;
    }
    Float::span(lo, hi).image()
}

/// Recover a logical sample of the row's first physical input. The center
/// of the F32 cell is usually representable. Absolute-time rounding or
/// clipping can instead put it next to a context boundary. Never label a row
/// with a sample of some other physical input.
fn logical_sample(k: Kernel, first: f32, start: Time, end: Time) -> Option<Time> {
    let inverse = k.domain.start
        + (f64::from(first) / f64::from(k.native.integration_seconds)) * k.domain.duration();
    let estimate = inverse.clamp(start, end);
    [
        estimate,
        estimate.next_down(),
        estimate.next_up(),
        start,
        end,
    ]
    .into_iter()
    .find(|&t| t >= start && t <= end && k.local_delta(t).to_bits() == first.to_bits())
}

pub(super) fn rows(
    context: Context<'_>,
    pivot: usize,
    work: &mut Work,
    mut accept: impl FnMut(Time, Frame, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<bool, TrajectoryError> {
    let (cube, target) = if context.sa.as_cuboid().is_some() && context.sb.as_ball().is_some() {
        (context.a, context.b)
    } else if context.sb.as_cuboid().is_some() && context.sa.as_ball().is_some() {
        (context.b, context.a)
    } else {
        return Ok(false);
    };
    let Curve::Integrated(k) = cube.curve else {
        return Ok(false);
    };
    let Curve::Constant {
        start_time,
        end_time,
        ..
    } = target.curve
    else {
        return Ok(false);
    };
    if pivot >= 3
        || cube.local_center != rp::Vector::ZERO
        || cube.local_pose != rp::Pose::IDENTITY
        || !context.start.is_finite()
        || !context.end.is_finite()
        || context.start > context.end
        || context.start < k.domain.start
        || context.end > k.domain.end
        || context.start < start_time
        || context.end > end_time
    {
        return Ok(false);
    }
    work.charge(128)?;
    let lo = k.local_delta(context.start);
    let hi = k.local_delta(context.end);
    let h = k.native.integration_seconds;
    if !lo.is_finite() || !hi.is_finite() || lo > hi || !h.is_finite() || h <= 0. {
        return Ok(false);
    }
    if lo == 0.
        && !accept(
            context.start,
            Frame::exact(k.native.motion.start).shape(cube),
            work,
        )?
    {
        return Ok(false);
    }
    let dt = Float {
        lo: lo.max(f32::from_bits(1)),
        hi: hi.min(h.next_down()),
    };
    if dt.lo <= dt.hi {
        let Some(clock) = PivotClock::certify(k, dt, pivot) else {
            return Ok(false);
        };
        let q = k.native.motion.start.rotation.to_array().map(Float::exact);
        let mut key = dt.lo.to_bits();
        let end = dt.hi.to_bits();
        while key <= end {
            work.charge(96)?;
            let first = f32::from_bits(key);
            work.charge(8)?;
            let Some(sample) = logical_sample(k, first, context.start, context.end) else {
                return Ok(false);
            };
            let value = clock.raw(first);
            let last = clock.last_key(key, end, value, work)?;
            let times = Float::span(first, f32::from_bits(last));
            let translation = add(
                exact_vector(k.native.motion.start.translation),
                mul(k.native.linear_velocity, times),
            );
            let turn = mul(k.native.angular_velocity, times.mul(Float::exact(0.5)));
            let mut raw = product([turn[0], turn[1], turn[2], Float::exact(1.)], q);
            raw[pivot] = Float::exact(value);
            if !translation.iter().chain(&raw).all(|r| r.finite()) {
                return Ok(false);
            }
            let Some(ws) = raw[3].image() else {
                return Ok(false);
            };
            for &w in &ws.values[..ws.len] {
                raw[3] = Float::exact(w);
                let Some(scales) = factors(raw) else {
                    return Ok(false);
                };
                for &f in &scales.values[..scales.len] {
                    work.charge(48)?;
                    let rotation = Quaternion {
                        components: raw.map(|v| v.mul(Float::exact(f))),
                        exact: None,
                    };
                    let frame = Frame {
                        translation,
                        rotation,
                    }
                    .shape(cube);
                    if !frame.rotation.finite()
                        || !frame.translation.iter().all(|r| r.finite())
                        || !singleton(frame.rotation.components[pivot])
                        || !singleton(frame.rotation.components[3])
                        || !accept(sample, frame, work)?
                    {
                        return Ok(false);
                    }
                }
            }
            key = last + 1;
        }
    }
    if hi >= h
        && !accept(
            context.end,
            Frame::exact(k.native.motion.end).shape(cube),
            work,
        )?
    {
        return Ok(false);
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::solver_trajectory::Domain;

    fn recorded() -> Kernel {
        let mut start = rp::Pose::IDENTITY;
        start.translation = rp::Vector::new(-6.323483e-8, -5.72106e-6, 1.10511595e-16);
        start.rotation =
            rp::Rotation::from_xyzw(-5.6676626e-16, -1.1787213e-16, -0.011305821, 0.9999361);
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::invalid(),
            Domain::new(0., 0.05).unwrap(),
            0.025,
            start,
            rp::Vector::new(-0.034592994, -3.9369435, 9.094946e-11),
            rp::Vector::new(-1.0443716e-9, -5.691466e-10, 1.979719),
        )
        .unwrap()
    }

    fn visit(
        k: Kernel,
        start: f64,
        end: f64,
        inspect: impl FnMut(Time, Frame, &mut Work) -> Result<bool, TrajectoryError>,
    ) -> bool {
        let cube = rp::Cuboid::new(rp::Vector::new(2., 0.025, 0.1));
        let sphere = rp::Ball::new(0.015);
        let motion = |curve| ShapeMotion {
            curve,
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let ctx = Context {
            a: motion(Curve::Integrated(k)),
            sa: &cube,
            b: motion(Curve::Constant {
                pose: rp::Pose::IDENTITY,
                start_time: k.domain.start,
                end_time: k.domain.end,
            }),
            sb: &sphere,
            start,
            end,
            clearance: 0.005,
        };
        rows(
            ctx,
            2,
            &mut Work {
                used: 0,
                limit: 900_000,
            },
            inspect,
        )
        .unwrap()
    }

    #[test]
    fn clock_rows_cover_original_normalization_jump_and_endpoint_branches() {
        // The fifth SDK tick changes its normalizer in this window. Logical
        // time is twice the physical duration, so no absolute time is a dt.
        let mut k = recorded();
        let logical =
            |dt: f32| f64::from(dt) / f64::from(k.native.integration_seconds) * k.domain.duration();
        let mut frames = Vec::new();
        assert!(visit(k, 0., logical(3e-6), |sample, frame, _| {
            assert!(sample >= 0. && sample <= logical(3e-6));
            assert!(sample == 0. || k.local_delta(sample) > 0.);
            assert!(
                singleton(frame.rotation.components[2]) && singleton(frame.rotation.components[3])
            );
            frames.push(frame);
            Ok(true)
        }));
        assert!((2000..4096).contains(&frames.len()));
        let contains = |point: rp::Pose| {
            frames.iter().any(|f| {
                f.rotation
                    .components
                    .into_iter()
                    .chain(f.translation)
                    .zip(
                        point
                            .rotation
                            .to_array()
                            .into_iter()
                            .chain(point.translation.to_array()),
                    )
                    .all(|(interval, v)| interval.lo <= v && v <= interval.hi)
            })
        };
        for i in 0..=256 {
            let t = logical(3e-6) * f64::from(i) / 256.;
            assert!(contains(k.position_at_time(t)));
        }
        let at = 2.63882e-6f32.to_bits();
        for key in at - 128..=at + 128 {
            let time = logical(f32::from_bits(key));
            assert!(contains(k.position_at_time(time)));
        }
        // The stored endpoint is a separate branch, even if its output differs
        // from the interior formula.
        k.native.motion.end.translation.x += 4.;
        let mut endpoint = false;
        assert!(visit(
            k,
            logical(k.native.integration_seconds.next_down()),
            k.domain.end,
            |sample, f, _| {
                if f.translation[0].lo == k.native.motion.end.translation.x {
                    assert_eq!(sample, k.domain.end);
                }
                endpoint |= f.translation[0].lo == k.native.motion.end.translation.x;
                Ok(true)
            }
        ));
        assert!(endpoint);
        assert!(!visit(k, 0., logical(3e-6), |_, _, _| Ok(false)));
    }

    #[test]
    fn significant_off_axis_products_cannot_be_dropped_from_the_clock() {
        let mut k = recorded();
        k.native.motion.start.rotation = rp::Rotation::from_xyzw(0.5, 0.5, 0.5, 0.5);
        k.native.angular_velocity = rp::Vector::new(0.25, -0.3, 1.);
        assert!(PivotClock::certify(k, Float::span(1e-3, 1.01e-3), 2).is_none());
    }
}
