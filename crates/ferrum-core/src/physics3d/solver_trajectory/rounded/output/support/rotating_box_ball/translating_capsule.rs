//! Separation for an upright capsule translating past a planar rotating box.
use super::*;
use crate::physics3d::geometry::same_pose_bits;
use rapier3d::pipeline::SolverBodyIntegration;

// A moving upright capsule and a planar cuboid use the same logical Time
// even if their Native h values differ. In the cuboid's reference axes the
// core projection numerator is cubic in the centered time. Bound that
// polynomial before accounting for the original rounded transforms.
#[derive(Clone, Copy)]
struct LinearTime {
    center: Bound,
    rate: Bound,
}

impl LinearTime {
    fn offset(self, value: f32) -> Self {
        Self {
            center: self.center.add(Bound::exact(f64::from(value))),
            ..self
        }
    }

    fn scale(self, coefficient: Bound) -> Self {
        Self {
            center: self.center.mul(coefficient),
            rate: self.rate.mul(coefficient),
        }
    }

    fn range(self, centered_time: Bound) -> Bound {
        self.center.add(self.rate.mul(centered_time))
    }

    fn product(self, other: Self) -> [Bound; 3] {
        [
            self.center.mul(other.center),
            self.center.mul(other.rate).add(self.rate.mul(other.center)),
            self.rate.mul(other.rate),
        ]
    }
}

// Interior physical dt uses the original subtraction, divide, multiply and
// F32 conversion. Relative dt used by Anchored motion has just subtraction
// and F32 conversion. The F64 operation error fits well within eight unit
// roundoffs of this finite [0,h] range before the final F32 rounding.
fn affine_clock(
    kernel: Kernel,
    from: Time,
    until: Time,
    center: Time,
    physical: bool,
) -> Option<(LinearTime, Value)> {
    let duration = kernel.domain.duration();
    if from < kernel.domain.start || until > kernel.domain.end || !duration.is_normal() {
        return None;
    }
    let h = if physical {
        f64::from(kernel.native.integration_seconds)
    } else {
        duration
    };
    if !h.is_normal() || h <= 0. {
        return None;
    }
    let dt = if physical {
        Float::span(kernel.local_delta(from), kernel.local_delta(until))
    } else {
        Float::span(
            ((from - kernel.domain.start).clamp(0., duration)) as f32,
            ((until - kernel.domain.start).clamp(0., duration)) as f32,
        )
    };
    if !dt.finite() {
        return None;
    }
    let scale = if physical {
        let rate = h / duration;
        if !rate.is_normal() || rate <= 0. {
            return None;
        }
        Bound {
            lo: rate.next_down(),
            hi: rate.next_up(),
        }
    } else {
        Bound::exact(1.)
    };
    let line = LinearTime {
        center: Bound::exact(center)
            .sub(Bound::exact(kernel.domain.start))
            .mul(scale),
        rate: scale,
    };
    let variable = Bound::exact(from).sub(Bound::exact(center)).add(Bound {
        lo: 0.,
        hi: Bound::exact(until).sub(Bound::exact(from)).hi,
    });
    Some((
        line,
        Value {
            ideal: line.range(variable),
            error: upper_add(half_ulp(dt), upper_mul(8. * f64::EPSILON, h)),
            actual: dt,
        },
    ))
}

fn centered_gap(
    normal: [[Bound; 3]; 2],
    norm: [Bound; 3],
    center: [LinearTime; 2],
    extent: Bound,
    u: Bound,
) -> Bound {
    let mut terms = [Bound::exact(0.); 4];
    for (n, x) in normal.into_iter().zip(center) {
        for (i, v) in n.into_iter().enumerate() {
            terms[i] = terms[i].add(v.mul(x.center));
            terms[i + 1] = terms[i + 1].add(v.mul(x.rate));
        }
    }
    for (coefficient, n) in terms.iter_mut().zip(norm) {
        *coefficient = coefficient.sub(n.mul(extent));
    }
    terms
        .into_iter()
        .rev()
        .fold(Bound::exact(0.), |sum, term| sum.mul(u).add(term))
}

// Enclose the original rounded world-X support over short clock intervals.
// The two raw planar quaternion components and the translated capsule X
// are monotone in their own input deltas. Splitting the common logical time
// retains their correlation even when the two native clocks round differently.
#[allow(clippy::too_many_arguments)]
fn corner_side_cells(
    k: Kernel,
    half: rp::Vector,
    cap: Kernel,
    radius: f32,
    clearance: f32,
    mut start: Time,
    mut end: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let origin = k.native.motion.start;
    let omega = k.native.angular_velocity.z;
    let cap_x = |t| {
        cap.native.motion.start.translation.x + cap.native.linear_velocity.x * cap.local_delta(t)
    };
    let raw = |t| {
        let half_angle = omega * (k.local_delta(t) * 0.5);
        rp::Rotation::from_xyzw(0., 0., half_angle, 1.) * origin.rotation
    };
    let mut pending = [0.; 49];
    let mut count = 0;
    for _ in 0..1536 {
        work.charge(192)?;
        let (a, b) = (raw(start), raw(end));
        let z = Float::span(a.z, b.z);
        let w = Float::span(a.w, b.w);
        if !(z.lo > 0. && w.lo > 0.) {
            return Ok(false);
        }
        let reciprocal = Float::span(
            rp::Rotation::from_xyzw(0., 0., z.hi, w.hi).length_recip(),
            rp::Rotation::from_xyzw(0., 0., z.lo, w.lo).length_recip(),
        );
        let (z, w) = (z.mul(reciprocal), w.mul(reciprocal));
        let diag = w.mul(w).sub(z.mul(z));
        let x = Float::span(-half.x, half.x)
            .mul(diag)
            .add(
                Float::span(-half.y, half.y)
                    .mul(z)
                    .mul(w.mul(Float::exact(2.))),
            )
            .add(Float::exact(origin.translation.x));
        let center = Float::span(cap_x(start), cap_x(end));
        if !x.finite() || !center.finite() {
            return Ok(false);
        }
        let f = |x: f32| Bound::exact(f64::from(x));
        let positive = super::super::super::real_float_sum(center.lo, -radius);
        let negative = super::super::super::real_float_sum(center.hi, radius);
        let above = f(center.lo - radius)
            .sub(f(x.hi))
            .lo
            .min(positive.sub(f(x.hi)).lo);
        let below = f(x.lo)
            .sub(f(center.hi + radius))
            .lo
            .min(f(x.lo).sub(negative).lo);
        if above.max(below) > f64::from(clearance) {
            if count == 0 {
                return Ok(true);
            }
            count -= 1;
            start = end;
            end = pending[count];
        } else {
            if a == b && center.lo == center.hi {
                return Ok(false);
            }
            let mid = start + (end - start) * 0.5;
            if mid <= start || mid >= end || count == pending.len() {
                return Ok(false);
            }
            pending[count] = end;
            count += 1;
            end = mid;
        }
    }
    Ok(false)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    context: Context<'_>,
    frames: &Frames,
    cube: &rp::Cuboid,
    capsule: &rp::Capsule,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (box_motion, cap_motion) = if context.sa.as_cuboid().is_some() {
        (context.a, context.b)
    } else {
        (context.b, context.a)
    };
    let Curve::Integrated(box_kernel) = box_motion.curve else {
        return Ok(false);
    };
    let [sx, sy, sz, sw] = box_kernel.native.motion.start.rotation.to_array();
    let omega = box_kernel.native.angular_velocity;
    let box_origin = box_kernel.native.motion.start.translation;
    if sx != 0.
        || sy != 0.
        || omega.x != 0.
        || omega.y != 0.
        || omega.z == 0.
        || box_kernel.native.linear_velocity != rp::Vector::ZERO
        || box_origin != box_kernel.native.motion.end.translation
        || [box_motion, cap_motion].into_iter().any(|motion| {
            motion.local_center != rp::Vector::ZERO || motion.local_pose != rp::Pose::IDENTITY
        })
        || !cube.half_extents.is_finite()
        || cube.half_extents.min_element() < 0.
        || !capsule.radius.is_finite()
        || capsule.radius <= 0.
        || !context.clearance.is_finite()
        || context.clearance < 0.
    {
        return Ok(false);
    }
    let (cap_kernel, initial, speed, offset, physical) = match cap_motion.curve {
        Curve::Integrated(kernel)
            if kernel.native.angular_velocity == rp::Vector::ZERO
                && kernel.native.motion.start.rotation == rp::Rotation::IDENTITY
                && kernel.native.motion.end.rotation == rp::Rotation::IDENTITY =>
        {
            (
                kernel,
                kernel.native.motion.start.translation,
                kernel.native.linear_velocity,
                rp::Vector::ZERO,
                true,
            )
        }
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } if anchor == rp::Vector::ZERO
            && carrier.native.motion.start.translation == rp::Vector::ZERO
            && carrier.native.motion.end.translation == rp::Vector::ZERO
            && carrier.native.linear_velocity == rp::Vector::ZERO
            && rotation == rp::Rotation::IDENTITY =>
        {
            (carrier, offset, linear_velocity, rp::Vector::ZERO, false)
        }
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } if anchor == rp::Vector::ZERO
            && carrier.native.angular_velocity == rp::Vector::ZERO
            && linear_velocity == rp::Vector::ZERO
            && rotation == rp::Rotation::IDENTITY =>
        {
            (
                carrier,
                carrier.native.motion.start.translation,
                carrier.native.linear_velocity,
                offset,
                true,
            )
        }
        _ => return Ok(false),
    };
    if speed == rp::Vector::ZERO
        || physical
            && initial + speed * cap_kernel.native.integration_seconds
                != cap_kernel.native.motion.end.translation
    {
        return Ok(false);
    }
    let [a, b] = [capsule.segment.a, capsule.segment.b];
    if ![a, b]
        .into_iter()
        .all(|p| p.is_finite() && p.x == 0. && p.z == 0.)
    {
        return Ok(false);
    }

    work.charge(4096)?;
    let (from, until) = (context.start, context.end);
    let time = from + (until - from) * 0.5;
    let u = Bound {
        lo: Bound::exact(from).sub(Bound::exact(time)).lo,
        hi: Bound::exact(until).sub(Bound::exact(time)).hi,
    };
    let Some((box_clock, box_dt)) = affine_clock(box_kernel, from, until, time, true) else {
        return Ok(false);
    };
    if box_dt.actual.lo <= 0. {
        return Ok(false);
    }
    let native = box_kernel.native;
    if box_dt.actual.hi >= native.integration_seconds {
        // The h branch returns the recorded pose even at interior logical
        // times that round to h. Admit it only if reexecuting the original
        // full-h integration produces the same pose bits.
        work.charge(256)?;
        let integrated = SolverBodyIntegration::from_velocity(
            native.motion.body,
            0.,
            native.integration_seconds,
            native.motion.start,
            native.linear_velocity,
            native.angular_velocity,
        );
        if !integrated.is_some_and(|row| same_pose_bits(row.motion.end, native.motion.end)) {
            return Ok(false);
        }
    }
    let Some((cap_clock, cap_dt)) = affine_clock(cap_kernel, from, until, time, physical) else {
        return Ok(false);
    };
    let exact = |x: f32| Bound::exact(f64::from(x));
    let value = |x: f32| Value::input(Float::exact(x));
    let scale = exact(omega.z).mul(Bound::exact(0.5));
    let z = box_clock.scale(scale.mul(exact(sw))).offset(sz);
    let w = box_clock.scale(negate(scale.mul(exact(sz)))).offset(sw);
    let angle = value(omega.z).mul(box_dt.mul(value(0.5)));
    let raw_z = value(sz).add(angle.mul(value(sw)));
    let raw_w = value(sw).sub(angle.mul(value(sz)));
    // Both nonzero raw components and every normalization intermediate
    // are normal F32 values. Restrict the magnitude to make that explicit.
    let normal_raw = |r: Float| r.finite() && r.lo >= 1. / 1024. && r.hi <= 4.;
    if !normal_raw(raw_z.actual) || !normal_raw(raw_w.actual) {
        return Ok(false);
    }

    let [za, wa] = [raw_z.actual, raw_w.actual];
    let normalizer = Float::span(
        rp::Rotation::from_xyzw(0., 0., za.hi, wa.hi).length_recip(),
        rp::Rotation::from_xyzw(0., 0., za.lo, wa.lo).length_recip(),
    );
    let error_to_scaled_raw = |r: Value| {
        upper_add(
            upper_mul(f64::from(normalizer.hi), r.error),
            half_ulp(r.actual.mul(normalizer)),
        )
    };
    let phase = upper_add(
        upper_mul(magnitude(w.range(u)), error_to_scaled_raw(raw_z)),
        upper_mul(magnitude(z.range(u)), error_to_scaled_raw(raw_w)),
    );
    let zz = z.product(z);
    let ww = w.product(w);
    let zw = z.product(w);
    let norm = std::array::from_fn(|i| zz[i].add(ww[i]));
    let diagonal = std::array::from_fn(|i| ww[i].sub(zz[i]));
    let spin = zw.map(|v| v.mul(Bound::exact(2.)));
    let norm_range = norm[0].add(norm[1].mul(u)).add(norm[2].mul(u.mul(u)));
    if !norm_range.finite() || norm_range.lo <= 0. || !phase.is_finite() {
        return Ok(false);
    }
    // RN(z*z + w*w), sqrt, reciprocal, and component scaling perturb the
    // squared length by at most (1+u)^4/(1-u)^4, u=2^-24. Use a dyadic
    // upper bound for this ratio. This is never an assumption of a unit q.
    let q_norm_high = Bound::exact(1. + 1. / 1048576.);
    // The off-diagonal coefficient of the actual rotation in reference
    // axes is 2*(wW+zZ)*(wZ-zW)/(w²+z²). The common normalizer cancels
    // in wZ-zW, leaving only the two component rounding errors.
    let phase_loss = q_norm_high
        .mul(Bound::exact((1. / norm_range.lo).next_up()))
        .sqrt()
        .mul(Bound::exact(2.))
        .mul(Bound::exact(phase));

    let hull = cube
        .half_extents
        .to_array()
        .map(|h| Value::input(Float::span(-h, h)));
    let box_output = transform(union(frames), hull);
    if !box_output[..2].iter().all(|v| v.finite()) {
        return Ok(false);
    }
    let cap_center: [Value; 2] = std::array::from_fn(|i| {
        value(initial[i])
            .add(value(speed[i]).mul(cap_dt))
            .add(value(offset[i]))
    });
    let local_hull = local_hull(&[a, b], capsule.radius);
    let cap_round = std::array::from_fn::<_, 2, _>(|i| {
        let span = Float::span(a[i], b[i]);
        let local_error = cap_center[i].add(local_hull[i]).error;
        local_error.max(cap_center[i].add(Value::input(span)).error)
    });
    let scalar_sq = |x: f64| Bound::exact(x).mul(Bound::exact(x));
    let radius_error = scalar_sq(cap_round[0]).add(scalar_sq(cap_round[1])).sqrt();
    let clearance = exact(capsule.radius)
        .add(exact(context.clearance))
        .add(radius_error);
    let delta: [LinearTime; 2] = std::array::from_fn(|i| {
        cap_clock
            .scale(exact(speed[i]))
            .offset(initial[i])
            .offset(offset[i])
            .offset(-box_origin[i])
    });
    let diag_max = magnitude(
        diagonal[0]
            .add(diagonal[1].mul(u))
            .add(diagonal[2].mul(u.mul(u))),
    );
    let spin_max = magnitude(spin[0].add(spin[1].mul(u)).add(spin[2].mul(u.mul(u))));
    let axis_x = [diagonal, spin];
    let axis_y = [spin.map(negate), diagonal];
    let support_extent = |axis: usize| {
        exact(cube.half_extents[axis])
            .mul(q_norm_high)
            .add(exact(cube.half_extents[axis ^ 1]).mul(phase_loss))
    };
    // Subtract the radius before evaluating a single separating plane's
    // polynomial, so all three terms use the norm at the same time.
    for (axis, normal) in [axis_x, axis_y].into_iter().enumerate() {
        let extent = support_extent(axis)
            .add(exact(capsule.radius))
            .add(exact(context.clearance));
        let projected_error = upper_add(
            upper_mul(diag_max, upper_add(box_output[axis].error, cap_round[axis])),
            upper_mul(
                spin_max,
                upper_add(box_output[axis ^ 1].error, cap_round[axis ^ 1]),
            ),
        );
        for directed in [normal, normal.map(|component| component.map(negate))] {
            if [a.y, b.y].into_iter().all(|core| {
                let center = [delta[0], delta[1].offset(core)];
                let gap = centered_gap(directed, norm, center, extent, u);
                gap.finite() && gap.lo > projected_error
            }) {
                return Ok(true);
            }
        }
    }
    let minimal_axis_gap = |axis: usize, normal: [[Bound; 3]; 2]| {
        let other = axis ^ 1;
        let extent = support_extent(axis);
        let rounded_support_error = upper_add(
            upper_mul(diag_max, box_output[axis].error),
            upper_mul(spin_max, box_output[other].error),
        );
        [a.y, b.y]
            .into_iter()
            .map(|core| {
                let center = [delta[0], delta[1].offset(core)];
                let numerator = centered_gap(normal, norm, center, extent, u)
                    .sub(Bound::exact(rounded_support_error));
                if numerator.lo <= 0. {
                    0.
                } else {
                    (numerator.lo / norm_range.hi).next_down().max(0.)
                }
            })
            .fold(f64::INFINITY, f64::min)
    };
    let axis_gap = |axis: usize, positive: [[Bound; 3]; 2]| {
        minimal_axis_gap(axis, positive)
            .max(minimal_axis_gap(axis, positive.map(|p| p.map(negate))))
    };
    let gap_x = axis_gap(0, axis_x);
    let gap_y = axis_gap(1, axis_y);
    let lower_squared = scalar_sq(gap_x).add(scalar_sq(gap_y));
    if lower_squared.finite()
        && clearance.finite()
        && lower_squared.lo > clearance.mul(clearance).hi
    {
        return Ok(true);
    }
    let Curve::Integrated(cap) = cap_motion.curve else {
        return Ok(false);
    };
    if native.motion.end.rotation.z < native.motion.end.rotation.w
        || speed.x.abs() <= speed.y.abs().max(speed.z.abs())
        || !box_output[2].finite()
        || !(0..3).all(|i| {
            let t = value(initial[i]).add(value(speed[i]).mul(cap_dt));
            let core = t.actual.add(Float::span(a[i], b[i]));
            t.add(local_hull[i]).finite() && world_radius_range(core, capsule.radius).finite()
        })
    {
        return Ok(false);
    }
    corner_side_cells(
        box_kernel,
        cube.half_extents,
        cap,
        capsule.radius,
        context.clearance,
        from,
        until,
        work,
    )
}

pub(in crate::physics3d::solver_trajectory::rounded::output) fn fixed_wall_separated(
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(sa) = context.sa.as_cuboid() else {
        return Ok(false);
    };
    let Some(sb) = context.sb.as_cuboid() else {
        return Ok(false);
    };
    let (bar, cube, wall, there) = if matches!(context.a.curve, Curve::Integrated(_)) {
        (context.a, sa, context.b, sb)
    } else {
        (context.b, sb, context.a, sa)
    };
    let (Curve::Integrated(k), Curve::Constant { pose, .. }) = (bar.curve, wall.curve) else {
        return Ok(false);
    };
    let n = k.native;
    let [sx, sy, sz, sw] = n.motion.start.rotation.to_array();
    let omega = n.angular_velocity;
    let origin = n.motion.start.translation;
    if sx != 0.
        || sy != 0.
        || omega.x != 0.
        || omega.y != 0.
        || omega.z == 0.
        || n.linear_velocity != rp::Vector::ZERO
        || origin != n.motion.end.translation
        || pose.rotation != rp::Rotation::IDENTITY
        || [bar, wall]
            .into_iter()
            .any(|m| m.local_center != rp::Vector::ZERO || m.local_pose != rp::Pose::IDENTITY)
        || context.clearance != 0.
        || !cube.half_extents.is_finite()
        || !there.half_extents.is_finite()
        || cube.half_extents.min_element() < 0.
        || there.half_extents.min_element() < 0.
    {
        return Ok(false);
    }
    work.charge(4096)?;
    let (from, until) = (context.start, context.end);
    let center = from + (until - from) * 0.5;
    let u = Bound {
        lo: Bound::exact(from).sub(Bound::exact(center)).lo,
        hi: Bound::exact(until).sub(Bound::exact(center)).hi,
    };
    let Some((clock, dt)) = affine_clock(k, from, until, center, true) else {
        return Ok(false);
    };
    let exact = |x: f32| Bound::exact(f64::from(x));
    let value = |x: f32| Value::input(Float::exact(x));
    let q_norm_high = Bound::exact(1. + 1. / 1048576.);
    let at_start = dt.actual.lo <= 0.;
    if at_start && exact(sz).mul(exact(sz)).add(exact(sw).mul(exact(sw))).hi > q_norm_high.lo {
        return Ok(false);
    }
    if dt.actual.hi >= n.integration_seconds
        && !SolverBodyIntegration::from_velocity(
            n.motion.body,
            0.,
            n.integration_seconds,
            n.motion.start,
            n.linear_velocity,
            n.angular_velocity,
        )
        .is_some_and(|row| same_pose_bits(row.motion.end, n.motion.end))
    {
        return Ok(false);
    }
    let scale = exact(omega.z).mul(Bound::exact(0.5));
    let z = clock.scale(scale.mul(exact(sw))).offset(sz);
    let w = clock.scale(negate(scale.mul(exact(sz)))).offset(sw);
    let angle = value(omega.z).mul(dt.mul(value(0.5)));
    let raw_z = value(sz).add(angle.mul(value(sw)));
    let raw_w = value(sw).sub(angle.mul(value(sz)));
    let normal_raw = |r: Float| r.finite() && r.lo >= 1. / 1024. && r.hi <= 4.;
    if !normal_raw(raw_z.actual) || !normal_raw(raw_w.actual) {
        return Ok(false);
    }
    let [za, wa] = [raw_z.actual, raw_w.actual];
    let mut factor = Float::span(
        rp::Rotation::from_xyzw(0., 0., za.hi, wa.hi).length_recip(),
        rp::Rotation::from_xyzw(0., 0., za.lo, wa.lo).length_recip(),
    );
    if at_start {
        factor = Float::span(factor.lo.min(1.), factor.hi.max(1.));
    }
    let scaled_error = |r: Value| {
        upper_add(
            upper_mul(f64::from(factor.hi), r.error),
            half_ulp(r.actual.mul(factor)),
        )
    };
    let phase = upper_add(
        upper_mul(magnitude(w.range(u)), scaled_error(raw_z)),
        upper_mul(magnitude(z.range(u)), scaled_error(raw_w)),
    );
    let zz = z.product(z);
    let ww = w.product(w);
    let zw = z.product(w);
    let norm = std::array::from_fn(|i| zz[i].add(ww[i]));
    let diagonal = std::array::from_fn(|i| ww[i].sub(zz[i]));
    let spin = zw.map(|x| x.mul(Bound::exact(2.)));
    let range = |p: [Bound; 3]| p[0].add(p[1].mul(u)).add(p[2].mul(u.mul(u)));
    let norm_range = range(norm);
    if !norm_range.finite() || norm_range.lo <= 0. || !phase.is_finite() {
        return Ok(false);
    }
    let phase_loss = q_norm_high
        .mul(Bound::exact((1. / norm_range.lo).next_up()))
        .sqrt()
        .mul(Bound::exact(2.))
        .mul(Bound::exact(phase));
    let Some(frames) = frames(bar.curve, from, until, work)? else {
        return Ok(false);
    };
    if frames.len == 0 {
        return Ok(false);
    }
    let hull = cube
        .half_extents
        .to_array()
        .map(|h| Value::input(Float::span(-h, h)));
    let output = transform(union(&frames), hull);
    if output[..2].iter().any(|v| !v.finite()) {
        return Ok(false);
    }
    let fixed: [Float; 2] = std::array::from_fn(|i| {
        Float::exact(pose.translation[i])
            .add(Float::span(-there.half_extents[i], there.half_extents[i]))
    });
    if fixed.iter().any(|r| !r.finite()) {
        return Ok(false);
    }
    for (axis, normal) in [[diagonal, spin], [spin.map(negate), diagonal]]
        .into_iter()
        .enumerate()
    {
        let extent = exact(cube.half_extents[axis])
            .mul(q_norm_high)
            .add(exact(cube.half_extents[axis ^ 1]).mul(phase_loss))
            .add(exact(context.clearance));
        let loss = upper_add(
            upper_mul(magnitude(range(normal[0])), output[0].error),
            upper_mul(magnitude(range(normal[1])), output[1].error),
        );
        for sense in [normal, normal.map(|p| p.map(negate))] {
            let all = [fixed[0].lo, fixed[0].hi].into_iter().all(|x| {
                [fixed[1].lo, fixed[1].hi].into_iter().all(|y| {
                    let point = [
                        LinearTime {
                            center: exact(x).sub(exact(origin.x)),
                            rate: Bound::exact(0.),
                        },
                        LinearTime {
                            center: exact(y).sub(exact(origin.y)),
                            rate: Bound::exact(0.),
                        },
                    ];
                    let gap = centered_gap(sense, norm, point, extent, u);
                    gap.finite() && gap.lo > loss
                })
            });
            if all {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Nominate the zero of the rotating Y-face against the fixed near
/// corner. The caller must certify the complete earlier prefix and
/// observe a real contact; the analytic estimate owns no geometry.
pub(in crate::physics3d::solver_trajectory::rounded::output) fn fixed_wall_time_hint(
    Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    }: Context<'_>,
) -> Option<Time> {
    let (bar, half, wall, offset) = if matches!(a.curve, Curve::Integrated(_)) {
        (
            a,
            sa.as_cuboid()?.half_extents,
            b,
            sb.as_cuboid()?.half_extents,
        )
    } else {
        (
            b,
            sb.as_cuboid()?.half_extents,
            a,
            sa.as_cuboid()?.half_extents,
        )
    };
    let (Curve::Integrated(k), Curve::Constant { pose, .. }) = (bar.curve, wall.curve) else {
        return None;
    };
    let native = k.native;
    let q = native.motion.start.rotation;
    let omega = native.angular_velocity;
    if clearance != 0.
        || omega.z <= 0.
        || omega.x != 0.
        || omega.y != 0.
        || q.x != 0.
        || q.y != 0.
        || q.z <= 0.
        || q.w <= q.z
        || pose.rotation != rp::Rotation::IDENTITY
        || native.linear_velocity != rp::Vector::ZERO
        || [bar, wall]
            .into_iter()
            .any(|m| m.local_pose != rp::Pose::IDENTITY || m.local_center != rp::Vector::ZERO)
        || half.y <= 0.
        || offset.min_element() < 0.
    {
        return None;
    }
    let corner = pose.translation - native.motion.start.translation;
    let x = f64::from(corner.x) + f64::from(offset.x);
    let y = f64::from(corner.y) - f64::from(offset.y);
    let rho = x.hypot(y);
    if x <= 0. || y <= 0. || rho <= f64::from(half.y) {
        return None;
    }
    let angle =
        y.atan2(x) - (f64::from(half.y) / rho).asin() - 2. * f64::from(q.z).atan2(f64::from(q.w));
    let dt = 2. * (angle * 0.5).tan() / f64::from(omega.z);
    let time = k.domain.start + dt / f64::from(native.integration_seconds) * k.domain.duration();
    (time.is_finite() && start < time && time < end).then_some(time)
}

/// The fixed corner is strictly inside the original scaled box. A
/// positive-volume fixed cuboid therefore overlaps it near that corner.
pub(in crate::physics3d::solver_trajectory::rounded::output) fn fixed_wall_overlap(
    Context { a, sa, b, sb, .. }: Context<'_>,
    at: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (bar, bar_half, wall, wall_half) = if matches!(a.curve, Curve::Integrated(_)) {
        (
            a,
            sa.as_cuboid()
                .ok_or(TrajectoryError::UnsupportedShape)?
                .half_extents,
            b,
            sb.as_cuboid()
                .ok_or(TrajectoryError::UnsupportedShape)?
                .half_extents,
        )
    } else {
        (
            b,
            sb.as_cuboid()
                .ok_or(TrajectoryError::UnsupportedShape)?
                .half_extents,
            a,
            sa.as_cuboid()
                .ok_or(TrajectoryError::UnsupportedShape)?
                .half_extents,
        )
    };
    work.charge(512)?;
    let bar = bar.pose(at);
    let wall = wall.pose(at);
    let q = bar.rotation;
    if !bar.is_finite()
        || !wall.is_finite()
        || !bar_half.is_finite()
        || !wall_half.is_finite()
        || bar_half.min_element() <= 0.
        || wall_half.min_element() <= 0.
        || q.x != 0.
        || q.y != 0.
        || wall.rotation != rp::Rotation::IDENTITY
        || bar.translation.z != wall.translation.z
    {
        return Ok(false);
    }
    let f = |x: f32| Bound::exact(f64::from(x));
    let z = f(q.z);
    let w = f(q.w);
    let zz = z.mul(z);
    let ww = w.mul(w);
    let diag = ww.sub(zz);
    let cross = z.mul(w).mul(Bound::exact(2.));
    let support = ww.add(zz).mul(ww.add(zz));
    let corner = |axis: usize, side: f32| {
        let exact = f(wall.translation[axis]).add(f(side));
        let rounded = f(wall.translation[axis] + side);
        Bound {
            lo: exact.lo.min(rounded.lo),
            hi: exact.hi.max(rounded.hi),
        }
        .sub(f(bar.translation[axis]))
    };
    let x = corner(0, wall_half.x);
    let y = corner(1, -wall_half.y);
    let local_x = diag.mul(x).add(cross.mul(y));
    let local_y = diag.mul(y).sub(cross.mul(x));
    Ok(local_x.finite()
        && local_y.finite()
        && support.finite()
        && magnitude(local_x) < support.mul(f(bar_half.x)).lo
        && magnitude(local_y) < support.mul(f(bar_half.y)).lo)
}
