//! Whole-interval cardinal support for the original qI translation graph.
//! The common variable is actual represented Native dt, not ideal F64 time.
//! Its affine relative part cancels before outward RN errors are subtracted.
use super::{Bound, Curve, Kernel, ShapeMotion, Time, ToiProxy, TrajectoryError, Work};
use rapier3d::prelude as rp;
mod anchored_face;
mod mixed_clock_faces;
mod native_output_cells;
mod parallel_capsules;
pub(in crate::physics3d::solver_trajectory) use parallel_capsules::stable_existing as parallel_capsules_stable_existing;
mod shared_clock_faces;
mod shared_translation_support;

pub(in crate::physics3d::solver_trajectory) enum FacePrefix {
    Separated,
    Through(Time),
    Boundary {
        safe_time: Time,
        hit_time: Time,
        witness: Option<rapier3d::parry::query::Contact>,
    },
}

enum FaceSearch {
    Clear,
    Boundary(u64, u64),
    Incomplete(u64),
}

fn first_closed_face_cell<T: PartialEq>(
    start: Time,
    end: Time,
    limit: usize,
    face_at: impl Fn(Time) -> T,
    face_end: impl Fn(Time, Time, &mut Work) -> Result<Option<u64>, TrajectoryError>,
    clear_at: impl Fn(Time, &mut Work) -> Result<bool, TrajectoryError>,
    work: &mut Work,
) -> Result<FaceSearch, TrajectoryError> {
    let mut first = start.to_bits();
    let end = end.to_bits();
    // Limit discovery work even when the suffix has a large face image. The
    // first genuine boundary can be much earlier than the rest of that image.
    for _ in 0..limit {
        work.charge(24)?;
        let face = face_at(Time::from_bits(first));
        let hinted = face_end(Time::from_bits(first), Time::from_bits(end), work)?;
        let mut equal = hinted.unwrap_or(first);
        let mut last = hinted.unwrap_or(end);
        while equal < last {
            let mid = equal + (last - equal).div_ceil(2);
            work.charge(24)?;
            if face_at(Time::from_bits(mid)) == face {
                equal = mid;
            } else {
                last = mid - 1;
            }
        }
        // Each caller fixes the rounded addends that can otherwise make the
        // gap nonmonotone. The remaining capsule supports are monotone here.
        if first > start.to_bits() && !clear_at(Time::from_bits(first), work)? {
            return Ok(FaceSearch::Boundary(first - 1, first));
        }
        if equal > first && !clear_at(Time::from_bits(equal), work)? {
            return Ok(FaceSearch::Boundary(first, equal));
        }
        if equal == end {
            return Ok(FaceSearch::Clear);
        }
        first = equal + 1;
    }
    Ok(FaceSearch::Incomplete(first - 1))
}

/// Axis translation has a monotone rounded gap. Both shapes retain their
/// original integration parameter and both original capsule radius paths.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn cardinal_box_capsule_prefix(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<FacePrefix>, TrajectoryError> {
    use rapier3d::parry::query::Contact;
    let (cube, cap, box_shape, capsule, normal, flipped) =
        if let (Some(cube), Some(cap)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, b, cube, cap, normal, false)
        } else if let (Some(cap), Some(cube)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, a, cube, cap, -normal, true)
        } else {
            return Ok(None);
        };
    if matches!(cap.curve, Curve::Anchored { .. }) {
        return anchored_face::prefix(
            cube, cap, box_shape, capsule, normal, start, end, clearance, tolerance, work,
        );
    }
    let rate = |motion: ShapeMotion| match motion.curve {
        Curve::Integrated(kernel) if kernel.native.angular_velocity == rp::Vector::ZERO => {
            Some(kernel.native.linear_velocity)
        }
        Curve::Constant { .. } => Some(rp::Vector::ZERO),
        _ => None,
    };
    let (Some(box_rate), Some(cap_rate)) = (rate(cube), rate(cap)) else {
        return Ok(None);
    };
    let relative = cap_rate - box_rate;
    // The prefix is proved on the selected face axis. Tangential
    // translation only matters when checking a finite contact witness.
    let axis = normal.abs().max_position();
    if !relative.is_finite()
        || (box_rate[axis] == 0. && cap_rate[axis] == 0.)
        || normal[axis].abs() < 0.99
        || start.is_sign_negative()
        || !box_shape.half_extents.is_finite()
        || box_shape.half_extents.min_element() < 0.
        || !capsule.segment.a.is_finite()
        || !capsule.segment.b.is_finite()
        || !capsule.radius.is_finite()
        || capsule.radius < 0.
    {
        return Ok(None);
    }
    let sign = normal[axis].signum();
    let (Some(cube_source), Some(cap_source)) = (
        Source::new(cube, start, end, work)?,
        Source::new(cap, start, end, work)?,
    ) else {
        return Ok(None);
    };
    let core_local = if sign * capsule.segment.a[axis] <= sign * capsule.segment.b[axis] {
        capsule.segment.a
    } else {
        capsule.segment.b
    };
    let face_local = sign * box_shape.half_extents[axis];
    let radius = capsule.radius;
    let position = |s: Source, at: Time| {
        s.clock.map_or(s.origin[axis], |k| {
            s.origin[axis] + s.velocity[axis] * k.local_delta(at)
        })
    };
    let clear_at = |at, work: &mut Work| {
        work.charge(48)?;
        let face = position(cube_source, at) + face_local;
        let center = position(cap_source, at);
        let local = center + (core_local[axis] - sign * radius);
        let core = center + core_local[axis];
        // Both lower expressions have a fixed association and directed
        // rounding, which preserves their ordering within a rounded cell.
        let local_gap = (f64::from(sign * local) - f64::from(sign * face)).next_down();
        let world_gap = ((f64::from(sign * core) - f64::from(radius)).next_down()
            - f64::from(sign * face))
        .next_down();
        Ok::<_, TrajectoryError>(
            local_gap.is_finite()
                && world_gap.is_finite()
                && local_gap > f64::from(clearance)
                && world_gap > f64::from(clearance),
        )
    };
    if !clear_at(start, work)? {
        return Ok(None);
    }
    let same_direction = box_rate[axis] != 0.
        && cap_rate[axis] != 0.
        && box_rate[axis].is_sign_negative() == cap_rate[axis].is_sign_negative();
    let (mut low, mut high) = if same_direction {
        if correlated_face_separated(
            cube_source,
            cap_source,
            axis,
            sign,
            face_local,
            core_local[axis],
            radius,
            start,
            end,
            clearance,
            work,
        )? {
            return Ok(Some(FacePrefix::Separated));
        }
        if mixed_clock_faces::separated(
            cube_source,
            cap_source,
            axis,
            sign,
            face_local,
            core_local[axis],
            radius,
            start,
            end,
            clearance,
            work,
        )? {
            return Ok(Some(FacePrefix::Separated));
        }
        let face_at = |at| position(cube_source, at) + face_local;
        let [first, last] = [face_at(start), face_at(end)];
        // The original rounded coordinate is monotone across zero, too.
        // Both signs of zero represent the same geometric cell.
        if !first.is_finite() || !last.is_finite() {
            return Ok(None);
        }
        const CELL_LIMIT: usize = 256;
        let common = cube_source
            .clock
            .zip(cap_source.clock)
            .is_some_and(|(a, b)| same_clock(a, b));
        let face_end = |from, to, work: &mut Work| {
            shared_clock_faces::face_end(cube_source, axis, face_local, from, to, work)
        };
        let initial_cells = if common { 8 } else { 1024 };
        let mut search =
            first_closed_face_cell(start, end, initial_cells, face_at, face_end, clear_at, work)?;
        if let FaceSearch::Incomplete(last_clear) = search {
            if common {
                let covered = Time::from_bits(last_clear);
                search = match shared_clock_faces::first(
                    cube_source,
                    cap_source,
                    axis,
                    sign,
                    face_local,
                    core_local[axis],
                    radius,
                    covered,
                    end,
                    clearance,
                    work,
                )? {
                    Some(result) => result,
                    None => first_closed_face_cell(
                        covered,
                        end,
                        CELL_LIMIT - initial_cells + 1,
                        face_at,
                        face_end,
                        clear_at,
                        work,
                    )?,
                };
            }
        }
        match search {
            FaceSearch::Clear => return Ok(Some(FacePrefix::Separated)),
            FaceSearch::Boundary(low, high) => (low, high),
            FaceSearch::Incomplete(last) => {
                return Ok(Some(FacePrefix::Through(Time::from_bits(last))))
            }
        }
    } else {
        if clear_at(end, work)? {
            return Ok(Some(FacePrefix::Separated));
        }
        if sign * relative[axis] >= 0. {
            return Ok(None);
        }
        (start.to_bits(), end.to_bits())
    };
    while high - low > 1 {
        let mid = low + (high - low) / 2;
        if clear_at(Time::from_bits(mid), work)? {
            low = mid;
        } else {
            high = mid;
        }
    }
    let safe = Time::from_bits(low);
    let at = Time::from_bits(high);
    if at - safe > tolerance {
        return Ok(None);
    }
    let boundary = |witness| {
        Ok(Some(FacePrefix::Boundary {
            safe_time: safe,
            hit_time: at,
            witness,
        }))
    };
    work.charge(640)?;
    let pa = cube.pose(at);
    let pb = cap.pose(at);
    let mut local = core_local;
    local[axis] -= sign * radius;
    let point2 = pb * local;
    let mut box_local = point2 - pa.translation;
    box_local[axis] = face_local;
    if !box_local.is_finite() || !box_local.abs().cmple(box_shape.half_extents).all() {
        return boundary(None);
    }
    let point1 = pa * box_local;
    let gap = (f64::from(sign * point2[axis]) - f64::from(sign * point1[axis])).next_up();
    if !point1.is_finite()
        || !point2.is_finite()
        || !(0. < gap && gap < f64::from(clearance))
        || (0..3).any(|i| i != axis && point1[i] != point2[i])
    {
        return boundary(None);
    }
    let dist = gap as f32;
    let dist = if f64::from(dist) < gap {
        dist.next_up()
    } else {
        dist
    };
    let mut n = rp::Vector::ZERO;
    n[axis] = sign;
    let contact = Contact::new(point1, point2, n, -n, dist);
    let contact = if flipped { contact.flipped() } else { contact };
    boundary(Some(contact))
}

#[allow(clippy::too_many_arguments)]
fn correlated_face_separated(
    cube: Source,
    cap: Source,
    axis: usize,
    sign: f32,
    face: f32,
    core: f32,
    radius: f32,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(768)?;
    let f = |v: f32| Bound::exact(f64::from(v));
    let affine = |source: Source| -> Option<(Bound, Bound, f64)> {
        let clock = source.clock?;
        let duration = clock.domain.duration();
        if !duration.is_normal() || duration <= 0. {
            return None;
        }
        let h = clock.native.integration_seconds;
        let inverse = 1. / duration;
        let rate = f(source.velocity[axis]).mul(f(h)).mul(Bound {
            lo: inverse.next_down(),
            hi: inverse.next_up(),
        });
        let value = f(source.origin[axis])
            .add(rate.mul(Bound::exact(start).sub(Bound::exact(clock.domain.start))));
        let dt = [clock.local_delta(start), clock.local_delta(end)];
        // The original F64 subtraction/divide/multiply all operate on a
        // clamped [0,h] mapping. Bound those roundings before the final F32
        // conversion and the original product/add graph.
        let clock_error = up_add(half_ulp(dt)?, 8. * f64::EPSILON * f64::from(h));
        let error = up_add(
            (clock_error * f64::from(source.velocity[axis]).abs()).next_up(),
            source.translation_error(axis, dt)?,
        );
        Some((value, rate, error))
    };
    let (Some((a, av, ea)), Some((b, bv, eb))) = (affine(cube), affine(cap)) else {
        return Ok(false);
    };
    let span = Bound {
        lo: 0.,
        hi: Bound::exact(end).sub(Bound::exact(start)).hi,
    };
    // Combine the two clocks on the same observer time before taking the
    // range. Separate COM envelopes would lose the common translation.
    let com = b.sub(a).add(bv.sub(av).mul(span)).mul(f(sign));
    let local = core - sign * radius;
    let (Some(face_error), Some(core_error), Some(local_error)) = (
        cube.point_error(axis, face),
        cap.point_error(axis, core),
        cap.point_error(axis, local),
    ) else {
        return Ok(false);
    };
    let remaining = com.sub(Bound::exact(up_add(up_add(ea, eb), face_error)));
    let world = remaining
        .add(f(core * sign))
        .sub(f(face * sign))
        .sub(f(radius))
        .sub(Bound::exact(core_error));
    let local = remaining
        .add(f(local * sign))
        .sub(f(face * sign))
        .sub(Bound::exact(local_error));
    // Each original support stays in its monotone endpoint range and can
    // only occupy multiples of its finest represented step. Round the lower
    // bound up to the first attainable grid value, keeping the real radius
    // as its own exact dyadic operand in the world graph.
    let face_grid = support_grid(cube, axis, face);
    let world_grid = face_grid.min(support_grid(cap, axis, core));
    let world_grid = quantum(radius).map_or(world_grid, |q| world_grid.min(q));
    let local_grid = face_grid.min(support_grid(cap, axis, core - sign * radius));
    Ok(grid_clear(world, world_grid, clearance) && grid_clear(local, local_grid, clearance))
}

fn support_grid(source: Source, axis: usize, point: f32) -> i32 {
    let [a, b] = source.com.map(|v| v[axis] + point);
    if !a.is_finite()
        || !b.is_finite()
        || a == 0.
        || b == 0.
        || a.is_sign_negative() != b.is_sign_negative()
    {
        -149
    } else {
        grid(a.abs().min(b.abs()))
    }
}

fn grid_clear(bound: Bound, exponent: i32, clearance: f32) -> bool {
    let step = 2_f64.powi(exponent);
    let lower = (bound.lo / step).ceil() * step;
    bound.finite() && lower.is_finite() && lower > f64::from(clearance)
}

#[derive(Clone, Copy)]
struct Source {
    clock: Option<Kernel>,
    origin: rp::Vector,
    velocity: rp::Vector,
    com: [rp::Vector; 2],
}
impl Source {
    fn new(
        motion: ShapeMotion,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        Self::from_motion(motion, start, end, true, work)
    }

    fn from_motion(
        motion: ShapeMotion,
        start: Time,
        end: Time,
        require_identity: bool,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        work.charge(256)?;
        let (from, to) = motion.curve.times();
        if !from.is_finite()
            || !to.is_finite()
            || from > to
            || !(to - from).is_finite()
            || start < from
            || end > to
            || (from == to && !matches!(motion.curve, Curve::Constant { .. }))
        {
            return Err(TrajectoryError::InvalidTime);
        }
        let identity = |q: rp::Rotation| {
            q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
        };
        if motion.local_center != rp::Vector::ZERO
            || motion.local_pose.translation != rp::Vector::ZERO
            || !identity(motion.local_pose.rotation)
        {
            return Ok(None);
        }
        let (clock, origin, velocity) = match motion.curve {
            Curve::Integrated(k) => {
                Kernel::from_native(k.native, k.domain)?;
                if require_identity
                    && (k.native.angular_velocity.to_array().map(f32::to_bits) != [0; 3]
                        || !identity(k.native.motion.start.rotation)
                        || !identity(k.native.motion.end.rotation))
                {
                    return Ok(None);
                }
                // This is a branch identity, not endpoint interpolation:
                // stored h must equal the original RN(T0 + RN(v*h)) graph.
                let expected = k.native.motion.start.translation
                    + k.native.linear_velocity * k.native.integration_seconds;
                if !expected.is_finite()
                    || expected.to_array().map(f32::to_bits)
                        != k.native.motion.end.translation.to_array().map(f32::to_bits)
                    || start < k.domain.start
                    || end > k.domain.end
                {
                    return Ok(None);
                }
                (
                    Some(k),
                    k.native.motion.start.translation,
                    k.native.linear_velocity,
                )
            }
            Curve::Constant { pose, .. } if pose.is_finite() && identity(pose.rotation) => {
                (None, pose.translation, rp::Vector::ZERO)
            }
            _ => return Ok(None),
        };
        let com = [motion.pose(start).translation, motion.pose(end).translation];
        Ok(com.iter().all(|v| v.is_finite()).then_some(Self {
            clock,
            origin,
            velocity,
            com,
        }))
    }

    fn translation_error(self, axis: usize, dt: [f32; 2]) -> Option<f64> {
        let v = self.velocity[axis];
        if self.clock.is_none() || v == 0. {
            return Some(0.);
        }
        let product = dt.map(|u| v * u);
        let multiplication = if v == 1. || v == -1. {
            0.
        } else {
            half_ulp(product)?
        };
        Some(up_add(
            multiplication,
            add_error(product, self.origin[axis])?,
        ))
    }

    fn point_error(self, axis: usize, point: f32) -> Option<f64> {
        add_error(self.com.map(|v| v[axis]), point)
    }
}

// The caller already enclosed the rotated box in this local direction. It
// only needs the original translation graph to compare that cardinal face.
#[allow(clippy::too_many_arguments)]
pub(super) fn bounded_rotating_face(
    cube: ShapeMotion,
    cap: ShapeMotion,
    axis: usize,
    sign: f32,
    face: f32,
    capsule: &rp::Capsule,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (Some(cube), Some(cap)) = (
        Source::from_motion(cube, start, end, false, work)?,
        Source::new(cap, start, end, work)?,
    ) else {
        return Ok(false);
    };
    if !capsule.segment.a.is_finite()
        || !capsule.segment.b.is_finite()
        || !capsule.radius.is_finite()
        || capsule.radius <= 0.
    {
        return Ok(false);
    }
    let core = if sign > 0. {
        capsule.segment.a[axis].min(capsule.segment.b[axis])
    } else {
        capsule.segment.a[axis].max(capsule.segment.b[axis])
    };
    correlated_face_separated(
        cube,
        cap,
        axis,
        sign,
        face,
        core,
        capsule.radius,
        start,
        end,
        clearance,
        work,
    )
}

fn same_clock(a: Kernel, b: Kernel) -> bool {
    same_local_delta(a, b)
        && a.native.motion.start_time.to_bits() == b.native.motion.start_time.to_bits()
        && a.native.motion.end_time.to_bits() == b.native.motion.end_time.to_bits()
}

// Kernel::local_delta uses the domain and integration seconds. The Native
// event labels can differ after a rebase without changing either operand.
fn same_local_delta(a: Kernel, b: Kernel) -> bool {
    a.domain.start.to_bits() == b.domain.start.to_bits()
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && a.native.integration_seconds.to_bits() == b.native.integration_seconds.to_bits()
}

/// Project B's COM minus A's COM with their shared Native integration time.
/// Keep the independent RN32 product/addition errors on both translations.
pub(in crate::physics3d::solver_trajectory::rounded) fn shared_yaw_capsule_centers(
    a: ShapeMotion,
    b: ShapeMotion,
    normal: rp::Vector,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<Bound>, TrajectoryError> {
    let (Curve::Integrated(ka), Curve::Integrated(kb)) = (a.curve, b.curve) else {
        return Ok(None);
    };
    if !same_local_delta(ka, kb)
        || [ka, kb].into_iter().any(|k| {
            k.native.angular_velocity != rp::Vector::ZERO
                || k.native.motion.start.rotation.x != 0.
                || k.native.motion.start.rotation.z != 0.
                || k.native.motion.start.rotation.y == 0.
        })
    {
        return Ok(None);
    }
    let (Some(a), Some(b)) = (
        Source::from_motion(a, start, end, false, work)?,
        Source::from_motion(b, start, end, false, work)?,
    ) else {
        return Ok(None);
    };
    work.charge(512)?;
    let dt = [ka.local_delta(start), ka.local_delta(end)];
    let exact = |x: f32| Bound::exact(f64::from(x));
    let mut origin = Bound::exact(0.);
    let mut rate = Bound::exact(0.);
    let mut error = Bound::exact(0.);
    for i in 0..3 {
        let (Some(ea), Some(eb)) = (a.translation_error(i, dt), b.translation_error(i, dt)) else {
            return Ok(None);
        };
        origin = origin.add(
            exact(b.origin[i])
                .sub(exact(a.origin[i]))
                .mul(exact(normal[i])),
        );
        rate = rate.add(
            exact(b.velocity[i])
                .sub(exact(a.velocity[i]))
                .mul(exact(normal[i])),
        );
        error = error.add(Bound::exact(up_add(ea, eb)).mul(exact(normal[i].abs())));
    }
    let gap = origin
        .add(rate.mul(Bound {
            lo: f64::from(dt[0]),
            hi: f64::from(dt[1]),
        }))
        .add(Bound {
            lo: -error.hi,
            hi: error.hi,
        });
    Ok(gap.finite().then_some(gap))
}
fn up_add(a: f64, b: f64) -> f64 {
    Bound::exact(a).add(Bound::exact(b)).hi
}
fn half_ulp(values: [f32; 2]) -> Option<f64> {
    let magnitude = values[0].abs().max(values[1].abs());
    if values.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let next = magnitude.next_up();
    let spacing = if next.is_finite() {
        f64::from(next) - f64::from(magnitude)
    } else {
        f64::from(magnitude) - f64::from(magnitude.next_down())
    };
    Some(spacing * 0.5)
}
fn grid(value: f32) -> i32 {
    let exponent = (value.to_bits() & 0x7fff_ffff) >> 23;
    if exponent == 0 {
        -149
    } else {
        exponent as i32 - 150
    }
}
fn quantum(value: f32) -> Option<i32> {
    let bits = value.to_bits() & 0x7fff_ffff;
    if bits == 0 || bits >> 23 == 255 {
        return None;
    }
    let significand = if bits >> 23 == 0 {
        bits
    } else {
        (bits & 0x7f_ffff) | 0x80_0000
    };
    Some(grid(value) + significand.trailing_zeros() as i32)
}
fn add_error(input: [f32; 2], value: f32) -> Option<f64> {
    if !value.is_finite() || input.iter().any(|v| !v.is_finite()) {
        return None;
    }
    if value == 0. || input.iter().all(|&v| v == 0.) {
        return Some(0.);
    }
    let output = input.map(|v| v + value);
    let rounding = half_ulp(output)?;
    let max_output = output[0].abs().max(output[1].abs());
    // Every represented input in a same-sign range lies on the finest grid
    // at its smallest magnitude. A singleton has its exact dyadic quantum.
    // If both operands are on the coarsest possible output grid, their finite
    // sum is representable: no per-point error is invented for exact poles.
    let input_grid = if input[0].to_bits() == input[1].to_bits() {
        quantum(input[0])
    } else if input[0].is_sign_negative() == input[1].is_sign_negative() {
        Some(grid(input[0].abs().min(input[1].abs())))
    } else {
        None
    };
    let exact = input_grid.is_some_and(|q| q >= grid(max_output))
        && quantum(value).is_some_and(|q| q >= grid(max_output));
    Some(if exact { 0. } else { rounding })
}

fn hull(proxy: &ToiProxy<'_>, work: &mut Work) -> Result<Option<[rp::Vector; 2]>, TrajectoryError> {
    if !proxy.radius.is_finite() || proxy.radius < 0. || proxy.points().is_empty() {
        return Ok(None);
    }
    let mut lo = rp::Vector::splat(f32::INFINITY);
    let mut hi = rp::Vector::splat(f32::NEG_INFINITY);
    for &point in proxy.points() {
        work.charge(64)?;
        if !point.is_finite() {
            return Ok(None);
        }
        lo = lo.min(point);
        hi = hi.max(point);
    }
    Ok(Some([lo, hi]))
}
fn finite_shape(source: Source, hull: [rp::Vector; 2], radius: f32) -> bool {
    for axis in 0..3 {
        let poles = [hull[0][axis] - radius, hull[1][axis] + radius];
        if poles.iter().any(|p| !p.is_finite()) {
            return false;
        }
        for com in source.com {
            for point in [hull[0][axis], hull[1][axis], poles[0], poles[1]] {
                if !(com[axis] + point).is_finite() {
                    return false;
                }
            }
            let low = Bound::exact(f64::from(com[axis] + hull[0][axis]))
                .sub(Bound::exact(f64::from(radius)));
            let high = Bound::exact(f64::from(com[axis] + hull[1][axis]))
                .add(Bound::exact(f64::from(radius)));
            if !low.finite()
                || !high.finite()
                || low.lo < -f64::from(f32::MAX)
                || high.hi > f64::from(f32::MAX)
            {
                return false;
            }
        }
    }
    true
}

/// Bound two nearly equal Native products by using the same rounded output
/// of the leading body. The proof applies to both the local pole and the
/// real radius about the original world core.
fn shared_com_grid_prefix(
    trailing: Source,
    leading: Source,
    dt: [f32; 2],
    axis: usize,
    radius: f32,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let a0 = trailing.origin[axis];
    let b0 = leading.origin[axis];
    let va = trailing.velocity[axis];
    let vb = leading.velocity[axis];
    let r = f64::from(radius);
    let large_binade = 2. * r..4. * r;
    let (Some(a), Some(b)) = (trailing.clock, leading.clock) else {
        return Ok(false);
    };
    if !same_clock(a, b)
        || vb <= 0.
        || va < vb
        || radius <= 0.
        || !(radius * 0.5).is_normal()
        || radius.to_bits() & 0x7f_ffff != 0
        || !(0.5 * r..r).contains(&f64::from(a0))
        || !large_binade.contains(&f64::from(b0))
        || !leading
            .com
            .iter()
            .all(|com| large_binade.contains(&f64::from(com[axis])))
    {
        return Ok(false);
    }
    work.charge(256)?; // fixed grid qualification and the two product error bounds
    let unit = (f64::from(radius.next_up()) - r) * 0.5;
    if a0.to_bits() & 1 != 0 {
        return Ok(false);
    }
    // T = RN(b0 + PB) and D = T - b0 lie on the 4U grid. Thus
    // PB <= D + 2U, including ties. The two original rounded products
    // differ by at most (va - vb) * dt + their two rounding bounds.
    let (Some(ea), Some(eb)) = (half_ulp(dt.map(|t| va * t)), half_ulp(dt.map(|t| vb * t))) else {
        return Ok(false);
    };
    let exact_drift = Bound::exact(f64::from(va))
        .sub(Bound::exact(f64::from(vb)))
        .mul(Bound::exact(f64::from(dt[1])));
    let drift = if va.to_bits() == vb.to_bits() {
        // These are the same product expression with identical v and
        // identical mapped dt. Its rounding cancels exactly.
        Bound::exact(0.)
    } else {
        exact_drift.add(Bound::exact(ea)).add(Bound::exact(eb))
    };
    if !drift.finite() {
        return Ok(false);
    }
    let end_shift = f64::from(leading.com[1][axis]) - f64::from(b0);
    if f64::from(trailing.com[1][axis]) >= r {
        // The capsule can move across the next COM binade. If A0 is
        // already on grid 4U, a0+D+4U and its +r pole are exactly
        // represented on both sides. Since PA <= D+2U+drift < D+4U,
        // rounding cannot exceed that upper bound.
        let maximum = f64::from(a0) + end_shift + 4. * unit;
        if a0.to_bits() & 3 != 0 || maximum >= 2. * r || drift.hi >= 1.5 * unit {
            return Ok(false);
        }
        let gap = Bound::exact(f64::from(b0))
            .sub(Bound::exact(f64::from(a0)))
            .sub(Bound::exact(2. * r + 4. * unit));
        return Ok(gap.lo > f64::from(clearance));
    }
    if drift.hi > unit * 0.5 {
        work.charge(256)?;
        let displacement = leading.com.map(|c| f64::from(c[axis]) - f64::from(b0));
        // For D on the 4U grid, both product caps D+2U and D+2.5U
        // are exact under these binades. D+2.5U is an even index
        // on every spacing <= U/4. Its upper midpoint rounds down.
        let caps = displacement.map(|d| d + 2.5 * unit);
        if unit * 0.25 < f64::from(f32::from_bits(1)) || caps[1] >= r * 0.25 {
            return Ok(false);
        }
        // The upper midpoint of the B cap is at most U/2 below
        // the upper midpoint of the A cap: A's spacing is no finer.
        // When the exact A product and all its cap midpoints share
        // a lattice, the next larger exact product is a full step away.
        if exact_drift.hi > unit * 0.5 {
            let Some(rate_grid) = quantum(va) else {
                return Ok(false);
            };
            let step = 2_f64.powi(grid(dt[0]) + rate_grid);
            let first_cap = caps[0] as f32;
            let first_half = (f64::from(first_cap.next_up()) - f64::from(first_cap)) * 0.5;
            if step > unit * 0.5 || step > first_half || exact_drift.hi >= unit * 0.5 + step {
                return Ok(false);
            }
        }
    }
    // a0 + D + 2U is an even point on the U grid. The exact pre-add
    // a0 + PA is at most the next midpoint, so RN rounds down to that
    // point or below. The candidate and its +r pole both fit their
    // binades and the latter is exact on the 2U grid. T - r is exact too.
    // These widened values are sums of fewer than 28 significant bits.
    let maximum = f64::from(a0) + end_shift + 2. * unit;
    if maximum >= r {
        return Ok(false);
    }
    let gap = Bound::exact(f64::from(b0))
        .sub(Bound::exact(f64::from(a0)))
        .sub(Bound::exact(2. * r))
        .sub(Bound::exact(2. * unit));
    Ok(gap.lo > f64::from(clearance))
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn separated(
    a: ShapeMotion,
    pa: &ToiProxy<'_>,
    b: ShapeMotion,
    pb: &ToiProxy<'_>,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(128)?;
    if !start.is_finite()
        || !end.is_finite()
        || start > end
        || !(end - start).is_finite()
        || !clearance.is_finite()
        || !normal.is_finite()
    {
        return Err(TrajectoryError::InvalidTime);
    }
    let Some(axis) = (0..3).find(|&i| normal[i] == 1. || normal[i] == -1.) else {
        return parallel_capsules::separated(a, pa, b, pb, start, end, clearance, work);
    };
    if (0..3).any(|i| i != axis && normal[i] != 0.) {
        return Ok(false);
    }
    let Some(source_a) = Source::new(a, start, end, work)? else {
        return Ok(false);
    };
    let Some(source_b) = Source::new(b, start, end, work)? else {
        return Ok(false);
    };
    let clock = match (source_a.clock, source_b.clock) {
        (Some(x), Some(y)) if same_local_delta(x, y) => x,
        (Some(x), None) | (None, Some(x)) => x,
        _ => return parallel_capsules::separated(a, pa, b, pb, start, end, clearance, work),
    };
    let (a, b) = (source_a, source_b);
    let dt = [clock.local_delta(start), clock.local_delta(end)];
    let Some(ha) = hull(pa, work)? else {
        return Ok(false);
    };
    let Some(hb) = hull(pb, work)? else {
        return Ok(false);
    };
    work.charge(512)?; // full XYZ finiteness and the two fixed RN ledgers.
    if !finite_shape(a, ha, pa.radius) || !finite_shape(b, hb, pb.radius) {
        return Ok(false);
    }
    let sign = normal[axis];
    let (point_a, point_b) = if sign > 0. {
        (ha[1][axis], hb[0][axis])
    } else {
        (ha[0][axis], hb[1][axis])
    };
    if shared_translation_support::separated(
        a, b, axis, sign, point_a, point_b, pa.radius, pb.radius, clearance, work,
    )? {
        return Ok(true);
    }
    let local_a = point_a + sign * pa.radius;
    let local_b = point_b - sign * pb.radius;
    let (Some(ea), Some(eb), Some(wa), Some(wb), Some(la), Some(lb)) = (
        a.translation_error(axis, dt),
        b.translation_error(axis, dt),
        a.point_error(axis, point_a),
        b.point_error(axis, point_b),
        a.point_error(axis, local_a),
        b.point_error(axis, local_b),
    ) else {
        return Ok(false);
    };
    let translation = Bound::exact(f64::from(b.origin[axis] * sign))
        .sub(Bound::exact(f64::from(a.origin[axis] * sign)))
        .add(
            Bound::exact(f64::from(b.velocity[axis] * sign))
                .sub(Bound::exact(f64::from(a.velocity[axis] * sign)))
                .mul(Bound {
                    lo: f64::from(dt[0]),
                    hi: f64::from(dt[1]),
                }),
        );
    let world = translation
        .add(Bound::exact(f64::from(point_b * sign)))
        .sub(Bound::exact(f64::from(point_a * sign)))
        .sub(Bound::exact(f64::from(pa.radius)))
        .sub(Bound::exact(f64::from(pb.radius)))
        .sub(Bound::exact(up_add(up_add(ea, eb), up_add(wa, wb))));
    let local = translation
        .add(Bound::exact(f64::from(local_b * sign)))
        .sub(Bound::exact(f64::from(local_a * sign)))
        .sub(Bound::exact(up_add(up_add(ea, eb), up_add(la, lb))));
    if world.finite()
        && local.finite()
        && world.lo > f64::from(clearance)
        && local.lo > f64::from(clearance)
    {
        return Ok(true);
    }
    if pa.radius > 0. && pb.radius > 0. && world.finite() && world.lo > f64::from(clearance) {
        work.charge(64)?;
        let step = support_grid(a, axis, local_a).min(support_grid(b, axis, local_b));
        if grid_clear(local, step, clearance) {
            return Ok(true);
        }
    }
    if point_a == 0. && point_b == 0. && pa.radius.to_bits() == pb.radius.to_bits() {
        let (trailing, leading) = if sign > 0. { (a, b) } else { (b, a) };
        if shared_com_grid_prefix(trailing, leading, dt, axis, pa.radius, clearance, work)? {
            return Ok(true);
        }
    }
    if shared_dt_image(
        a, b, dt, axis, sign, point_a, point_b, pa.radius, pb.radius, clearance, work,
    )? {
        return Ok(true);
    }
    // Retain the original input-image cap and its standalone prices. This
    // independent, complete output partition only supplements larger images.
    if a.clock.is_none()
        || b.clock.is_none()
        || dt[1]
            .to_bits()
            .checked_sub(dt[0].to_bits())
            .is_none_or(|span| span < 256)
    {
        return Ok(false);
    }
    native_output_cells::separated(
        a, b, dt, axis, sign, point_a, point_b, pa.radius, pb.radius, clearance, work,
    )
}

/// Nominate one actual-time observation from a failed scalar output cell.
/// This never certifies contact: the caller must re-evaluate its original
/// immutable pair with the existing strict world-point observer.
#[allow(clippy::too_many_arguments)]
pub(super) fn native_output_probe(
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
    if sa.as_capsule().is_none() || sb.as_capsule().is_none() || clearance < 0. {
        return Ok(None);
    }
    let Some(axis) = (0..3).find(|&i| normal[i] == 1. || normal[i] == -1.) else {
        return Ok(None);
    };
    if (0..3).any(|i| i != axis && normal[i] != 0.) {
        return Ok(None);
    }
    work.charge(128)?;
    let Some(a) = Source::new(a, start, end, work)? else {
        return Ok(None);
    };
    let Some(b) = Source::new(b, start, end, work)? else {
        return Ok(None);
    };
    let (Some(clock), Some(peer)) = (a.clock, b.clock) else {
        return Ok(None);
    };
    if !same_clock(clock, peer) {
        return Ok(None);
    }
    let dt = [clock.local_delta(start), clock.local_delta(end)];
    if dt[1]
        .to_bits()
        .checked_sub(dt[0].to_bits())
        .is_none_or(|n| n < 256)
    {
        return Ok(None);
    }
    let (Some(pa), Some(pb)) = (ToiProxy::from_shape(sa), ToiProxy::from_shape(sb)) else {
        return Ok(None);
    };
    let Some(ha) = hull(&pa, work)? else {
        return Ok(None);
    };
    let Some(hb) = hull(&pb, work)? else {
        return Ok(None);
    };
    work.charge(512)?;
    if !finite_shape(a, ha, pa.radius) || !finite_shape(b, hb, pb.radius) {
        return Ok(None);
    }
    let sign = normal[axis];
    let (point_a, point_b) = if sign > 0. {
        (ha[1][axis], hb[0][axis])
    } else {
        (ha[0][axis], hb[1][axis])
    };
    let proof = native_output_cells::certificate(
        a, b, dt, axis, sign, point_a, point_b, pa.radius, pb.radius, clearance, work,
    )?;
    let native_output_cells::Certificate::Counter(key) = proof else {
        return Ok(None);
    };
    // Inverting the clock is merely a nominee. The original pose(time) and
    // real-radius strict observer below own all contact/prefix authority.
    Ok(Some(
        clock.domain.start
            + f64::from(f32::from_bits(key)) / f64::from(clock.native.integration_seconds)
                * clock.domain.duration(),
    ))
}

/// Complete common input image, not independent endpoint pose combinations.
/// Only the already qualified shared-clock Integrated graphs are eligible.
#[allow(clippy::too_many_arguments)]
fn shared_dt_image(
    a: Source,
    b: Source,
    dt: [f32; 2],
    axis: usize,
    sign: f32,
    point_a: f32,
    point_b: f32,
    radius_a: f32,
    radius_b: f32,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if a.clock.is_none() || b.clock.is_none() {
        return Ok(false);
    }
    work.charge(64)?; // complete finite input-key census, before the attempt.
                      // Native local_delta is nonnegative and monotone. Include every represented
                      // F32 value between its actual endpoints, even values no Time can reach.
                      // A larger image uses the original proof/search; the optional cap is fixed.
    if dt.iter().any(|v| !v.is_finite() || v.is_sign_negative()) || dt[0] > dt[1] {
        return Ok(false);
    }
    let low = dt[0].to_bits();
    let high = dt[1].to_bits();
    let Some(count) = high.checked_sub(low).and_then(|n| n.checked_add(1)) else {
        return Ok(false);
    };
    if count > 256 {
        return Ok(false);
    }
    let local_a = point_a + sign * radius_a;
    let local_b = point_b - sign * radius_b;
    for key in low..=high {
        work.charge(256)?; // actual two Native scalar graphs and both supports.
        let u = f32::from_bits(key);
        let ta = a.origin[axis] + a.velocity[axis] * u;
        let tb = b.origin[axis] + b.velocity[axis] * u;
        let world = Bound::exact(f64::from((tb + point_b) * sign))
            .sub(Bound::exact(f64::from((ta + point_a) * sign)))
            .sub(Bound::exact(f64::from(radius_a)))
            .sub(Bound::exact(f64::from(radius_b)));
        let local = Bound::exact(f64::from((tb + local_b) * sign))
            .sub(Bound::exact(f64::from((ta + local_a) * sign)));
        if !world.finite()
            || !local.finite()
            || world.lo <= f64::from(clearance)
            || local.lo <= f64::from(clearance)
        {
            // A lower counter is not a contact or a sampled NoHit. Retain the
            // original chronological/positive-observation fallback unchanged.
            return Ok(false);
        }
    }
    Ok(true)
}

fn monotone_range(
    motion: ShapeMotion,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<[rp::Vector; 2]>, TrajectoryError> {
    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity: relative,
        rotation,
    } = motion.curve
    else {
        return Ok(Source::new(motion, start, end, work)?.map(|v| v.com));
    };
    work.charge(256)?;
    Kernel::from_native(carrier.native, carrier.domain)?;
    if start < carrier.domain.start || end > carrier.domain.end {
        return Err(TrajectoryError::InvalidTime);
    }
    let identity = |q: rp::Rotation| {
        q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
    };
    if !identity(rotation)
        || !identity(carrier.native.motion.start.rotation)
        || !identity(carrier.native.motion.end.rotation)
        || !identity(motion.local_pose.rotation)
        || carrier.native.angular_velocity.to_array().map(f32::to_bits) != [0; 3]
        || motion.local_center != rp::Vector::ZERO
        || motion.local_pose.translation != rp::Vector::ZERO
        || !anchor.is_finite()
        || !offset.is_finite()
        || !relative.is_finite()
    {
        return Ok(None);
    }
    // Native dt and logical elapsed are different maps. Each is monotone in
    // the same Time. Only common directions make their final RN sum monotone;
    // opposing carrier/relative coordinates retain the original fallback.
    for axis in 0..3 {
        let native = carrier.native.linear_velocity[axis];
        if (native < 0. && relative[axis] > 0.) || (native > 0. && relative[axis] < 0.) {
            return Ok(None);
        }
    }
    let expected = carrier.native.motion.start.translation
        + carrier.native.linear_velocity * carrier.native.integration_seconds;
    if !expected.is_finite()
        || expected.to_array().map(f32::to_bits)
            != carrier
                .native
                .motion
                .end
                .translation
                .to_array()
                .map(f32::to_bits)
        || !((end - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32).is_finite()
    {
        return Ok(None);
    }
    // Use the original nested add/rotation/product graph at both endpoints.
    // qI keeps R*anchor constant on stored and interior branches. Componentwise
    // RN additions preserve the already proved common monotonic direction.
    let poses = [motion.pose(start), motion.pose(end)];
    if poses.iter().any(|p| !p.is_finite()) {
        return Ok(None);
    }
    Ok(Some(poses.map(|p| p.translation)))
}

/// Independent coordinate extrema, used only for optional qI capsule pairs.
/// There is no assumed common clock or cancellation between the two motions.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn monotone_capsules_separated(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (Some(ca), Some(cb)) = (sa.as_capsule(), sb.as_capsule()) else {
        return Ok(false);
    };
    // Keep all original Box/Capsule correlated/scalar successes and prices.
    work.charge(128)?;
    if !start.is_finite() || !end.is_finite() || start > end || !(end - start).is_finite() {
        return Err(TrajectoryError::InvalidTime);
    }
    if !normal.is_finite() || !clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let Some(axis) = (0..3).find(|&i| normal[i] == 1. || normal[i] == -1.) else {
        let [pa, pb] = [ca, cb].map(|c| ToiProxy::from_array([c.segment.a, c.segment.b], c.radius));
        return parallel_capsules::separated(a, &pa, b, &pb, start, end, clearance, work);
    };
    if (0..3).any(|i| i != axis && normal[i] != 0.) {
        return Ok(false);
    }
    let Some(ac) = monotone_range(a, start, end, work)? else {
        return Ok(false);
    };
    let Some(bc) = monotone_range(b, start, end, work)? else {
        return Ok(false);
    };
    let mut hulls = [[rp::Vector::ZERO; 2]; 2];
    for (index, capsule) in [ca, cb].into_iter().enumerate() {
        if !capsule.radius.is_finite() || capsule.radius < 0. {
            return Ok(false);
        }
        let mut lo = rp::Vector::splat(f32::INFINITY);
        let mut hi = rp::Vector::splat(f32::NEG_INFINITY);
        for point in [capsule.segment.a, capsule.segment.b] {
            work.charge(64)?;
            if !point.is_finite() {
                return Ok(false);
            }
            lo = lo.min(point);
            hi = hi.max(point);
        }
        hulls[index] = [lo, hi];
    }
    work.charge(512)?; // full XYZ/radius finiteness and fixed cardinal proof.
    for (com, hull, radius) in [(ac, hulls[0], ca.radius), (bc, hulls[1], cb.radius)] {
        if !finite_shape(
            Source {
                clock: None,
                origin: rp::Vector::ZERO,
                velocity: rp::Vector::ZERO,
                com,
            },
            hull,
            radius,
        ) {
            return Ok(false);
        }
    }
    let sign = normal[axis];
    let (ah, al, bh, bl) = (
        ac[0][axis].max(ac[1][axis]),
        ac[0][axis].min(ac[1][axis]),
        bc[0][axis].max(bc[1][axis]),
        bc[0][axis].min(bc[1][axis]),
    );
    let (at, ap, bt, bp) = if sign > 0. {
        (ah, hulls[0][1][axis], bl, hulls[1][0][axis])
    } else {
        (al, hulls[0][0][axis], bh, hulls[1][1][axis])
    };
    // RN world core plus original real sphere and the original local RN pole
    // are independent full-support interpretations; both must strictly clear.
    let world = Bound::exact(f64::from((bt + bp) * sign))
        .sub(Bound::exact(f64::from((at + ap) * sign)))
        .sub(Bound::exact(f64::from(ca.radius)))
        .sub(Bound::exact(f64::from(cb.radius)));
    let local = Bound::exact(f64::from((bt + (bp - sign * cb.radius)) * sign)).sub(Bound::exact(
        f64::from((at + (ap + sign * ca.radius)) * sign),
    ));
    if world.finite()
        && local.finite()
        && world.lo > f64::from(clearance)
        && local.lo > f64::from(clearance)
    {
        return Ok(true);
    }
    // Independent extrema may belong to different times on the same carrier.
    // Compare the two capsules at a common Native delta in that case.
    if let (
        Curve::Anchored {
            carrier: x,
            linear_velocity: vx,
            ..
        },
        Curve::Anchored {
            carrier: y,
            linear_velocity: vy,
            ..
        },
    ) = (a.curve, b.curve)
    {
        if x.native.motion.body == y.native.motion.body
            && same_clock(x, y)
            && vx == rp::Vector::ZERO
            && vy == rp::Vector::ZERO
        {
            let [pa, pb] =
                [ca, cb].map(|c| ToiProxy::from_array([c.segment.a, c.segment.b], c.radius));
            return parallel_capsules::separated(a, &pa, b, &pb, start, end, clearance, work);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests;
