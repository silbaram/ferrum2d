//! Full local-ball support with an error enclosure for the original scalar
//! F32 point graph. The radius uses a Euclidean bound; a coordinate cube is
//! used only to bound arithmetic error, never as the support radius.
use super::*;

mod native_box_face;
pub(in crate::physics3d::solver_trajectory) use native_box_face::native_box_face_cast;
mod anchored_capsule_face;
mod tight_face;
pub(in crate::physics3d::solver_trajectory) use anchored_capsule_face::separated as anchored_capsule_face_separated;
pub(in crate::physics3d) use tight_face::tight_face_fits;
mod common_product;
pub(super) use common_product::{
    applicable as common_product_applicable, early_applicable as early_common_product_applicable,
    separated as common_product_separated, staggered_prefix,
};
mod axial_capsule;
pub(in crate::physics3d::solver_trajectory) use axial_capsule::fixed_wall_rider_separated;
pub(super) use axial_capsule::separated as axial_capsule_separated;
mod planar_capsule;
mod shared_planar_capsule;
pub(in crate::physics3d::solver_trajectory) use planar_capsule::initial_capsule_cell;
pub(in crate::physics3d::solver_trajectory) use planar_capsule::{planar_capsule_cell, PlanarCell};
pub(super) use shared_planar_capsule::sweep as shared_planar_capsule_sweep;
mod rotating_box_ball;
pub(super) use rotating_box_ball::{
    offset_separated, rotating_box_ball_face, rotating_box_capsule_face,
};
mod exact_box;
pub(super) use exact_box::{
    ramp_capsule_separated, separated as exact_box_separated,
    strict_static as exact_box_strict_static,
};
pub(in crate::physics3d::solver_trajectory) use exact_box::{
    rounded_cap_edge_separated, rounded_cap_plane_witness, rounded_capsule_pair_separated,
};
mod capsule;
mod capsule_ball;
pub(super) use capsule::capsule_separation;
pub(super) use capsule_ball::separated as capsule_ball_separated;
mod corotating;
pub(in crate::physics3d::solver_trajectory::rounded) use corotating::projected_prefix as corotating_projected_prefix;
pub(in crate::physics3d::solver_trajectory::rounded) use corotating::{
    moving_face_separated, separated as corotating_separated,
};

#[derive(Clone, Copy)]
struct Value {
    actual: Float,
    ideal: Bound,
    error: f64,
}
fn upper_add(a: f64, b: f64) -> f64 {
    if a == 0. {
        b
    } else if b == 0. {
        a
    } else {
        (a + b).next_up()
    }
}
fn upper_mul(a: f64, b: f64) -> f64 {
    if a == 0. || b == 0. {
        0.
    } else {
        (a * b).next_up()
    }
}
fn magnitude(v: Bound) -> f64 {
    v.lo.abs().max(v.hi.abs())
}
fn negate(v: Bound) -> Bound {
    Bound {
        lo: -v.hi,
        hi: -v.lo,
    }
}
fn singleton(v: Float) -> bool {
    v.lo.to_bits() == v.hi.to_bits()
}
fn exact_value(v: Float, x: f32) -> bool {
    v.lo == x && v.hi == x
}

pub(super) use rotating_box_ball::{
    fixed_wall_overlap, fixed_wall_separated as planar_rotating_box_separated, fixed_wall_time_hint,
};

pub(super) fn half_ulp(v: Float) -> f64 {
    if !v.finite() {
        return f64::INFINITY;
    }
    let x = v.lo.abs().max(v.hi.abs());
    let next = x.next_up();
    let spacing = if next.is_finite() {
        f64::from(next) - f64::from(x)
    } else {
        f64::from(x) - f64::from(x.next_down())
    };
    spacing * 0.5
}
#[derive(Clone, Copy)]
pub(super) enum Op {
    Add,
    Subtract,
    Multiply,
}
pub(super) fn rounding(a: Float, b: Float, output: Float, op: Op) -> f64 {
    if !a.finite() || !b.finite() || !output.finite() {
        return f64::INFINITY;
    }
    let exact = match op {
        Op::Add => exact_value(a, 0.) || exact_value(b, 0.),
        Op::Subtract => exact_value(b, 0.) || (singleton(a) && singleton(b) && a.lo == b.lo),
        Op::Multiply => [0., 1., -1.]
            .into_iter()
            .any(|v| exact_value(a, v) || exact_value(b, v)),
    };
    if exact {
        return 0.;
    }
    if singleton(a) && singleton(b) {
        // Bound the real operation on the actual operands. This measures
        // constant coefficient rounding more tightly than a blanket ULP.
        let x = Bound::exact(f64::from(a.lo));
        let y = Bound::exact(f64::from(b.lo));
        let value = match op {
            Op::Add => x.add(y),
            Op::Subtract => x.add(negate(y)),
            Op::Multiply => x.mul(y),
        };
        let rounded = f64::from(output.lo);
        return (rounded - value.lo)
            .abs()
            .max((rounded - value.hi).abs())
            .next_up();
    }
    // Every finite nearest-rounded F32 result has error <= half of the
    // largest output binade spacing. This also covers subnormal/zero output.
    let result = half_ulp(output);
    match op {
        Op::Add | Op::Subtract => {
            // Actual operands are represented F32 values. For x+y the
            // candidates x and y are each representable (x and -y for
            // subtraction), so nearest rounding also has error <= |y|
            // and <= |x|. Take suprema over the complete operand ranges.
            // This is not valid for multiplication or initial real local p+u.
            let a_max = f64::from(a.lo.abs().max(a.hi.abs()));
            let b_max = f64::from(b.lo.abs().max(b.hi.abs()));
            result.min(a_max).min(b_max)
        }
        Op::Multiply => result,
    }
}
impl Value {
    fn input(actual: Float) -> Self {
        Self {
            actual,
            ideal: Bound {
                lo: f64::from(actual.lo),
                hi: f64::from(actual.hi),
            },
            error: 0.,
        }
    }
    fn local(point: f32, radius: f32) -> Self {
        if radius == 0. {
            return Self::input(Float::exact(point));
        }
        let actual = Float::span(point - radius, point + radius);
        Self {
            actual,
            ideal: Bound::exact(f64::from(point)).add(Bound {
                lo: -f64::from(radius),
                hi: f64::from(radius),
            }),
            error: half_ulp(actual),
        }
    }
    fn add(self, b: Self) -> Self {
        let actual = self.actual.add(b.actual);
        Self {
            actual,
            ideal: self.ideal.add(b.ideal),
            error: upper_add(
                upper_add(self.error, b.error),
                rounding(self.actual, b.actual, actual, Op::Add),
            ),
        }
    }
    fn sub(self, b: Self) -> Self {
        let actual = self.actual.sub(b.actual);
        Self {
            actual,
            ideal: self.ideal.add(negate(b.ideal)),
            error: upper_add(
                upper_add(self.error, b.error),
                rounding(self.actual, b.actual, actual, Op::Subtract),
            ),
        }
    }
    fn mul(self, b: Self) -> Self {
        let actual = self.actual.mul(b.actual);
        let propagated = upper_add(
            upper_add(
                upper_mul(magnitude(self.ideal), b.error),
                upper_mul(magnitude(b.ideal), self.error),
            ),
            upper_mul(self.error, b.error),
        );
        Self {
            actual,
            ideal: self.ideal.mul(b.ideal),
            error: upper_add(
                propagated,
                rounding(self.actual, b.actual, actual, Op::Multiply),
            ),
        }
    }
    fn finite(self) -> bool {
        self.actual.finite()
            && self.ideal.lo.is_finite()
            && self.ideal.hi.is_finite()
            && self.error.is_finite()
    }
}
fn transform(frame: Frame, v: [Value; 3]) -> [Value; 3] {
    let q = frame.rotation.components.map(Value::input);
    let two = Value::input(Float::exact(2.));
    // Exactly the original scalar Quat::mul_vec3 association, with a separate
    // ideal-real interval and arithmetic-error ledger for each operation.
    let b2 = q[0].mul(q[0]).add(q[1].mul(q[1])).add(q[2].mul(q[2]));
    let scale = q[3].mul(q[3]).sub(b2);
    let dot = v[0].mul(q[0]).add(v[1].mul(q[1])).add(v[2].mul(q[2]));
    let twice_dot = dot.mul(two);
    let twice_w = q[3].mul(two);
    let cross = [
        q[1].mul(v[2]).sub(v[1].mul(q[2])),
        q[2].mul(v[0]).sub(v[2].mul(q[0])),
        q[0].mul(v[1]).sub(v[0].mul(q[1])),
    ];
    std::array::from_fn(|i| {
        v[i].mul(scale)
            .add(q[i].mul(twice_dot))
            .add(cross[i].mul(twice_w))
            .add(Value::input(frame.translation[i]))
    })
}
#[cfg(test)]
fn radial_scale(frame: Frame, axis: rp::Vector) -> Option<f64> {
    let q = frame.rotation.components;
    let mut squared = Bound::exact(0.);
    for v in q {
        let max = f64::from(v.lo.abs().max(v.hi.abs()));
        squared = squared.add(Bound::exact(max).mul(Bound::exact(max)));
    }
    let norm = super::super::dot(axis, axis);
    if !squared.hi.is_finite() || !norm.hi.is_finite() || norm.lo <= 0. {
        return None;
    }
    // The exact-real quaternion-vector map is conformal with scale ||q||²,
    // even for a rounded, nonunit stored quaternion. max(1,scale) also covers
    // the world-radius geometric interpretation. No unit-q assumption.
    Some(upper_mul(squared.hi.max(1.), norm.hi.sqrt().next_up()))
}
fn local_hull(points: &[rp::Vector], radius: f32) -> [Value; 3] {
    std::array::from_fn(|i| {
        let lo = points.iter().map(|p| p[i]).fold(f32::INFINITY, f32::min);
        let hi = points
            .iter()
            .map(|p| p[i])
            .fold(f32::NEG_INFINITY, f32::max);
        if lo.to_bits() == hi.to_bits() && radius == 0. {
            return Value::input(Float::exact(lo));
        }
        let actual = Float::span(lo - radius, hi + radius);
        Value {
            actual,
            ideal: Bound {
                lo: f64::from(lo),
                hi: f64::from(hi),
            }
            .add(Bound {
                lo: -f64::from(radius),
                hi: f64::from(radius),
            }),
            error: half_ulp(actual),
        }
    })
}
#[cfg(test)]
fn projection(
    frame: Frame,
    points: &[rp::Vector],
    radius: f32,
    axis: rp::Vector,
    scale: f64,
) -> Option<Bound> {
    // Only the exact-real support center uses vertex extremality. Arithmetic
    // error is bounded over the entire coordinate hull, including every real
    // convex combination and radius direction, not just vertex arithmetic.
    let core = transform(frame, local_hull(points, 0.));
    let full = transform(frame, local_hull(points, radius));
    if core.iter().chain(&full).any(|v| !v.finite()) {
        return None;
    }
    let mut error = 0.;
    for (i, n) in axis.to_array().into_iter().enumerate() {
        let world = core[i].add(Value::local(0., radius));
        if !world.finite() {
            return None;
        }
        error = upper_add(
            error,
            upper_mul(f64::from(n).abs(), full[i].error.max(world.error)),
        );
    }
    let mut lower = f64::INFINITY;
    let mut upper = f64::NEG_INFINITY;
    for &p in points {
        let center = transform(frame, p.to_array().map(|x| Value::input(Float::exact(x))));
        if center.iter().any(|v| !v.finite()) {
            return None;
        }
        let mut value = Bound::exact(0.);
        for (v, n) in center.into_iter().zip(axis.to_array()) {
            value = value.add(v.ideal.mul(Bound::exact(f64::from(n))));
        }
        lower = lower.min(value.lo);
        upper = upper.max(value.hi);
    }
    let margin = upper_add(upper_mul(f64::from(radius), scale), error);
    let result = Bound {
        lo: (lower - margin).next_down(),
        hi: (upper + margin).next_up(),
    };
    (result.lo.is_finite() && result.hi.is_finite()).then_some(result)
}
fn union(frames: &Frames) -> Frame {
    // A full componentwise Cartesian enclosure of every existing frame,
    // not a new pose sample. Only the support proof consumes this union;
    // exact original images and endpoint branches remain stored separately.
    let merge = |values: &[Float]| {
        let mut lo = f32::INFINITY;
        let mut hi = f32::NEG_INFINITY;
        for v in values {
            lo = lo.min(v.lo);
            hi = hi.max(v.hi);
        }
        Float::span(lo, hi)
    };
    Frame {
        translation: std::array::from_fn(|i| {
            let mut fields = [Float::ZERO; MAX_FRAMES];
            for (v, f) in fields.iter_mut().zip(&frames.values[..frames.len]) {
                *v = f.translation[i];
            }
            merge(&fields[..frames.len])
        }),
        rotation: Quaternion {
            components: std::array::from_fn(|i| {
                let mut fields = [Float::ZERO; MAX_FRAMES];
                for (v, f) in fields.iter_mut().zip(&frames.values[..frames.len]) {
                    *v = f.rotation.components[i];
                }
                merge(&fields[..frames.len])
            }),
            exact: None,
        },
    }
}
// The original Value transform computed F32/error fields for each core
// vertex although only its ideal Bound was consumed. Cache the same Bound
// coefficients once and stream exactly that association for each point.
struct IdealTransform {
    q: [Bound; 4],
    scale: Bound,
    twice_w: Bound,
    translation: [Bound; 3],
}
impl IdealTransform {
    fn new(frame: Frame) -> Self {
        let q = frame.rotation.components.map(|v| Bound {
            lo: f64::from(v.lo),
            hi: f64::from(v.hi),
        });
        let b2 = q[0].mul(q[0]).add(q[1].mul(q[1])).add(q[2].mul(q[2]));
        let scale = q[3].mul(q[3]).add(negate(b2));
        Self {
            q,
            scale,
            twice_w: q[3].mul(Bound::exact(2.)),
            translation: frame.translation.map(|v| Bound {
                lo: f64::from(v.lo),
                hi: f64::from(v.hi),
            }),
        }
    }
    fn point(&self, p: rp::Vector) -> [Bound; 3] {
        let q = self.q;
        let v = p.to_array().map(|v| Bound::exact(f64::from(v)));
        let dot = v[0].mul(q[0]).add(v[1].mul(q[1])).add(v[2].mul(q[2]));
        let twice_dot = dot.mul(Bound::exact(2.));
        let cross = [
            q[1].mul(v[2]).add(negate(v[1].mul(q[2]))),
            q[2].mul(v[0]).add(negate(v[2].mul(q[0]))),
            q[0].mul(v[1]).add(negate(v[0].mul(q[1]))),
        ];
        std::array::from_fn(|i| {
            v[i].mul(self.scale)
                .add(q[i].mul(twice_dot))
                .add(cross[i].mul(self.twice_w))
                .add(self.translation[i])
        })
    }
}
fn norm_squared_upper(q: [Float; 4]) -> f64 {
    q.into_iter().fold(0., |sum, q| {
        let q = f64::from(q.lo.abs().max(q.hi.abs()));
        upper_add(sum, upper_mul(q, q))
    })
}

fn pure_axis_native_norm_upper(
    motion: ShapeMotion,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    let Curve::Integrated(k) = motion.curve else {
        return Ok(None);
    };
    let angular = k.native.angular_velocity;
    let q = k.native.motion.start.rotation.to_array().map(Float::exact);
    let combined = angular
        .to_array()
        .into_iter()
        .zip(q)
        .filter(|(w, v)| *w != 0. || v.lo != 0.)
        .count();
    if motion.local_pose.rotation != rp::Rotation::IDENTITY || combined > 1 {
        return Ok(None);
    }
    work.charge(512)?;
    let delta = Float::span(k.local_delta(start), k.local_delta(end));
    let hang = mul(angular, delta.mul(Float::exact(0.5)));
    let raw = product([hang[0], hang[1], hang[2], Float::exact(1.)], q);
    if raw.iter().any(|v| !v.finite()) {
        return Ok(None);
    }
    let a = raw.map(Value::input);
    let length2 = a[0]
        .mul(a[0])
        .add(a[1].mul(a[1]))
        .add(a[2].mul(a[2]))
        .add(a[3].mul(a[3]));
    if !length2.finite() || length2.actual.lo < 0.25 || length2.actual.hi > 4. {
        return Ok(None);
    }
    let root = Float::span(length2.actual.lo.sqrt(), length2.actual.hi.sqrt());
    let inverse = Float::span(root.hi.recip(), root.lo.recip());
    let root_error = half_ulp(root);
    let root_hi = f64::from(root.hi);
    let root_lo = f64::from(root.lo);
    // S is the exact squared norm of the original raw F32 components.
    // For the rounded square root f, S <= f² + dot_error + 2*f*e + e².
    let deficit = upper_add(
        length2.error,
        upper_add(
            upper_mul(2. * root_hi, root_error),
            upper_mul(root_error, root_error),
        ),
    );
    let squared = upper_add(1., (deficit / (root_lo * root_lo)).next_up());
    // Bound the original F32 reciprocal relative to 1/f, then each rounded
    // component product relative to that shared rounded reciprocal.
    let reciprocal = upper_add(1., upper_mul(half_ulp(inverse), root_hi));
    let mut normalized = upper_mul(squared, upper_mul(reciprocal, reciprocal));
    for input in raw {
        let output = input.mul(inverse);
        let e = rounding(input, inverse, output, Op::Multiply);
        let component = upper_mul(
            f64::from(input.lo.abs().max(input.hi.abs())),
            f64::from(inverse.hi),
        );
        normalized = upper_add(
            normalized,
            upper_add(upper_mul(2. * component, e), upper_mul(e, e)),
        );
    }
    let stored = [k.native.motion.start, k.native.motion.end]
        .map(|pose| norm_squared_upper(pose.rotation.to_array().map(Float::exact)));
    Ok(Some(normalized.max(stored[0]).max(stored[1])))
}

// Each fixed box coordinate is monotone under identity rotation. For
// the sphere, bound the entire rounded rotated local sphere before adding
// its center, and keep the independent real world radius in F64.
#[allow(clippy::too_many_arguments)]
pub(super) fn cardinal_box_ball(
    frames: &Frames,
    cuboid: &rp::Cuboid,
    ball_frames: &Frames,
    ball: &rp::Ball,
    motion: (ShapeMotion, Time, Time),
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(512 + (frames.len + ball_frames.len) as u64 * 64)?;
    if frames.len == 0
        || ball_frames.len == 0
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() < 0.
        || !ball.radius.is_finite()
        || ball.radius < 0.
    {
        return Ok(false);
    }
    let box_frame = union(frames);
    let q = box_frame.rotation.components;
    if (0..3).any(|i| !exact_value(q[i], 0.)) || !exact_value(q[3], 1.) {
        return Ok(false);
    }
    let ball_frame = union(ball_frames);
    work.charge(1536)?;
    let local = transform(
        Frame {
            translation: [Float::ZERO; 3],
            ..ball_frame
        },
        [Value::local(0., ball.radius); 3],
    );
    if local.iter().any(|v| !v.finite()) {
        return Ok(false);
    }
    let mut s = norm_squared_upper(ball_frame.rotation.components);
    if let Some(tight) = pure_axis_native_norm_upper(motion.0, motion.1, motion.2, work)? {
        s = s.min(tight);
    }
    let radius = upper_mul(s, f64::from(ball.radius));
    let margin = Bound::exact(f64::from(clearance));
    let mut clear = false;
    for (i, extent) in local.iter().enumerate() {
        let limit = upper_add(radius, extent.error);
        let mut rounded_extent = limit as f32;
        if f64::from(rounded_extent) > limit {
            rounded_extent = rounded_extent.next_down();
        }
        let cap = ball_frame.translation[i];
        let cube = box_frame.translation[i];
        let core = Float::span(
            cube.lo - cuboid.half_extents[i],
            cube.hi + cuboid.half_extents[i],
        );
        let actual = Float::span(cap.lo - rounded_extent, cap.hi + rounded_extent);
        if !core.finite() || !actual.finite() {
            return Ok(false);
        }
        let low = real_float_sum(cap.lo, -ball.radius)
            .lo
            .min(f64::from(actual.lo));
        let high = real_float_sum(cap.hi, ball.radius)
            .hi
            .max(f64::from(actual.hi));
        let finite_max = f64::from(f32::MAX);
        if low < -finite_max || high > finite_max || !low.is_finite() || !high.is_finite() {
            return Ok(false);
        }
        let right = Bound::exact(low)
            .sub(Bound::exact(f64::from(core.hi)))
            .sub(margin)
            .lo;
        let left = Bound::exact(f64::from(core.lo))
            .sub(Bound::exact(high))
            .sub(margin)
            .lo;
        clear |= right > 0. || left > 0.;
    }
    Ok(clear)
}

/// The original coarse and tight per-coordinate support for exactly identity
/// rotation, preadmitted by the static two-point primitive caller.
pub(super) fn static_cardinal_ranges(
    translation: rp::Vector,
    points: [rp::Vector; 2],
    radius: f32,
    work: &mut Work,
) -> Result<Option<[[Bound; 3]; 2]>, TrajectoryError> {
    work.charge(1024)?;
    let input = exact_vector(translation);
    let core = local_hull(&points, 0.);
    let full = local_hull(&points, radius);
    let one = Value::input(Float::exact(1.));
    let radius_scale = upper_mul(1., 1_f64.next_up());
    let mut coarse = [Bound::exact(0.); 3];
    let mut tight = coarse;
    for i in 0..3 {
        let position = Value::input(input[i]);
        // The original identity quaternion still multiplies by 1, which
        // propagates a nonzero local error through the outward error ledger.
        // Its two additive zero terms have no numeric or error contribution.
        let core_ledger = core[i].mul(one).add(position);
        let full_ledger = full[i].mul(one).add(position);
        let world_ledger = core_ledger.add(Value::local(0., radius));
        let actual_world = world_radius_range(core_ledger.actual, radius);
        if !core_ledger.finite()
            || !full_ledger.finite()
            || !world_ledger.finite()
            || !actual_world.finite()
        {
            return Ok(None);
        }
        coarse[i] = Bound {
            lo: f64::from(full_ledger.actual.lo.min(actual_world.lo)),
            hi: f64::from(full_ledger.actual.hi.max(actual_world.hi)),
        };
        let error = upper_mul(1., full_ledger.error.max(world_ledger.error));
        let margin = upper_add(upper_mul(f64::from(radius), radius_scale), error);
        // Use each extreme original vertex separately. Adding the translation
        // to their interval would lose the exact singleton cancellation case.
        let origin = position.ideal;
        let lower = Bound::exact(core[i].ideal.lo).add(origin).lo;
        let upper = Bound::exact(core[i].ideal.hi).add(origin).hi;
        tight[i] = Bound {
            lo: (lower - margin).next_down(),
            hi: (upper + margin).next_up(),
        };
    }
    Ok(Some([coarse, tight]))
}

struct Cloud<'a> {
    points: &'a [rp::Vector],
    radius: f32,
    error: [f64; 3],
    scale: f64,
    ideal: IdealTransform,
}
fn prepare_cloud<'a>(
    frames: &Frames,
    proxy: &'a ToiProxy<'_>,
    work: &mut Work,
) -> Result<Option<Cloud<'a>>, TrajectoryError> {
    let points = u64::try_from(proxy.points().len()).map_err(|_| TrajectoryError::WorkLimit)?;
    let cost = points
        .checked_mul(512)
        .and_then(|v| v.checked_add(4096 + (frames.len as u64) * 32))
        .ok_or(TrajectoryError::WorkLimit)?;
    // Prepay both local-hull scans and the one later ideal transform before
    // visiting any original point. The following axis charge covers only
    // the additional per-axis projections, with no deferred point work.
    work.charge(cost)?;
    let frame = union(frames);
    let core = transform(frame, local_hull(proxy.points(), 0.));
    let full = transform(frame, local_hull(proxy.points(), proxy.radius));
    if core.iter().chain(&full).any(|v| !v.finite()) {
        return Ok(None);
    }
    let mut error = [0.; 3];
    for i in 0..3 {
        let world = core[i].add(Value::local(0., proxy.radius));
        if !world.finite() {
            return Ok(None);
        }
        error[i] = full[i].error.max(world.error);
    }
    let mut squared = Bound::exact(0.);
    for v in frame.rotation.components {
        let max = f64::from(v.lo.abs().max(v.hi.abs()));
        squared = squared.add(Bound::exact(max).mul(Bound::exact(max)));
    }
    if !squared.hi.is_finite() {
        return Ok(None);
    }
    Ok(Some(Cloud {
        points: proxy.points(),
        radius: proxy.radius,
        error,
        scale: squared.hi.max(1.),
        ideal: IdealTransform::new(frame),
    }))
}
fn unavailable(axes: &mut [super::super::super::SeparationAxis]) {
    for axis in axes {
        axis.full_support = Some(false);
    }
}
pub(super) fn separated_axes(
    a: &Frames,
    pa: &ToiProxy<'_>,
    b: &Frames,
    pb: &ToiProxy<'_>,
    axes: &mut [super::super::super::SeparationAxis],
    clearance: f32,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    projection_ranges(a, pa, b, pb, axes, clearance, work).map(|_| ())
}

/// Complete numeric projection, independent of whether any axis separates.
/// False invalidates every numeric range for consumers, even when a prefix of
/// a cloud has already left finite fields in the caller's private scratch.
/// True means every cloud/radius/error projection completed; it is not a
/// separation result. False may leave ephemeral partial numeric fields, which
/// callers must not consume even when they are finite.
pub(super) fn projection_ranges(
    a: &Frames,
    pa: &ToiProxy<'_>,
    b: &Frames,
    pb: &ToiProxy<'_>,
    axes: &mut [super::super::super::SeparationAxis],
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if pa.radius == 0. && pb.radius == 0. {
        unavailable(axes);
        return Ok(false);
    }
    let Some(ca) = prepare_cloud(a, pa, work)? else {
        unavailable(axes);
        return Ok(false);
    };
    let Some(cb) = prepare_cloud(b, pb, work)? else {
        unavailable(axes);
        return Ok(false);
    };
    // No transformed-point buffer: each original point is transformed once,
    // then its identical Bound dot is accumulated in the bounded axis slots.
    // The cloud charge already covers all hull/ideal point work. Each axis
    // adds 64 per dot and 128 per cloud for normal/error/radius projection.
    // Work precedes every axis/point loop.
    for cloud in [&ca, &cb] {
        let points = u64::try_from(cloud.points.len()).map_err(|_| TrajectoryError::WorkLimit)?;
        let count = u64::try_from(axes.len()).map_err(|_| TrajectoryError::WorkLimit)?;
        let cost = points
            .checked_mul(64)
            .and_then(|dot| dot.checked_add(128))
            .and_then(|axis| axis.checked_mul(count))
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(cost)?;
    }
    for axis in axes.iter_mut() {
        axis.upper = f64::NEG_INFINITY;
        axis.lower = f64::INFINITY;
        axis.full_support = None;
    }
    let mut complete = true;
    for (cloud, is_a) in [(&ca, true), (&cb, false)] {
        for &p in cloud.points {
            if !p.is_finite() {
                unavailable(axes);
                return Ok(false);
            }
            let point = cloud.ideal.point(p);
            if point.iter().any(|v| !v.lo.is_finite() || !v.hi.is_finite()) {
                unavailable(axes);
                return Ok(false);
            }
            for axis in axes.iter_mut() {
                let mut value = Bound::exact(0.);
                for (v, n) in point.into_iter().zip(axis.normal.to_array()) {
                    value = value.add(v.mul(Bound::exact(f64::from(n))));
                }
                if is_a {
                    axis.upper = axis.upper.max(value.hi);
                } else {
                    axis.lower = axis.lower.min(value.lo);
                }
            }
        }
        for axis in axes.iter_mut() {
            let norm = super::super::dot(axis.normal, axis.normal);
            if norm.lo <= 0. || !norm.hi.is_finite() {
                axis.full_support = Some(false);
                complete = false;
                continue;
            }
            let scale = upper_mul(cloud.scale, norm.hi.sqrt().next_up());
            let mut error = 0.;
            for (n, e) in axis.normal.to_array().into_iter().zip(cloud.error) {
                error = upper_add(error, upper_mul(f64::from(n).abs(), e));
            }
            let margin = upper_add(upper_mul(f64::from(cloud.radius), scale), error);
            if is_a {
                axis.upper = (axis.upper + margin).next_up();
            } else {
                axis.lower = (axis.lower - margin).next_down();
            }
            if !axis.upper.is_finite() && is_a || !axis.lower.is_finite() && !is_a {
                axis.full_support = Some(false);
                complete = false;
            }
        }
    }
    for axis in axes {
        if axis.full_support == Some(false) {
            continue;
        }
        let n = super::super::dot(axis.normal, axis.normal);
        if n.lo <= 0. || !n.hi.is_finite() {
            axis.full_support = Some(false);
            complete = false;
            continue;
        }
        let norm = Bound {
            lo: n.lo.sqrt().next_down(),
            hi: n.hi.sqrt().next_up(),
        };
        let margin = Bound::exact(f64::from(clearance)).mul(norm).hi;
        axis.full_support =
            Some(((axis.lower - axis.upper).next_down() - margin).next_down() >= 0.);
    }
    Ok(complete)
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    a: &Frames,
    sa: &dyn rp::Shape,
    b: &Frames,
    sb: &dyn rp::Shape,
    axis: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if sa.as_ball().is_some() && sb.as_ball().is_some() {
        return Ok(false);
    }
    let pa = ToiProxy::from_shape(sa).ok_or(TrajectoryError::UnsupportedShape)?;
    let pb = ToiProxy::from_shape(sb).ok_or(TrajectoryError::UnsupportedShape)?;
    let mut axes = super::super::super::SeparationAxes::single(axis);
    separated_axes(
        a,
        &pa,
        b,
        &pb,
        &mut axes.values[..axes.len],
        clearance,
        work,
    )?;
    Ok(axes.values[0].full_support.unwrap_or(false))
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn separated_reference(
    a: &Frames,
    sa: &dyn rp::Shape,
    b: &Frames,
    sb: &dyn rp::Shape,
    axis: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if sa.as_ball().is_some() && sb.as_ball().is_some() {
        return Ok(false);
    }
    let pa = ToiProxy::from_shape(sa).ok_or(TrajectoryError::UnsupportedShape)?;
    let pb = ToiProxy::from_shape(sb).ok_or(TrajectoryError::UnsupportedShape)?;
    if pa.radius == 0. && pb.radius == 0. {
        return Ok(false);
    }
    let mut upper = f64::NEG_INFINITY;
    let mut lower = f64::INFINITY;
    for (frames, proxy, is_a) in [(a, &pa, true), (b, &pb, false)] {
        let visits = u64::try_from(proxy.points().len()).map_err(|_| TrajectoryError::WorkLimit)?;
        let cost = visits
            .checked_mul(1536)
            .and_then(|v| v.checked_add(4096))
            .and_then(|v| v.checked_add((frames.len as u64) * 32))
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(cost)?;
        let frame = union(frames);
        let Some(scale) = radial_scale(frame, axis) else {
            return Ok(false);
        };
        let Some(bound) = projection(frame, proxy.points(), proxy.radius, axis, scale) else {
            return Ok(false);
        };
        if is_a {
            upper = upper.max(bound.hi);
        } else {
            lower = lower.min(bound.lo);
        }
    }
    let n = super::super::dot(axis, axis);
    if n.lo <= 0. || !n.hi.is_finite() {
        return Ok(false);
    }
    // Existing-overlap/nonworsening certificates may have negative
    // clearance. Multiply the full norm interval, not just its upper end.
    let norm = Bound {
        lo: n.lo.sqrt().next_down(),
        hi: n.hi.sqrt().next_up(),
    };
    let margin = Bound::exact(f64::from(clearance)).mul(norm).hi;
    Ok(((lower - upper).next_down() - margin).next_down() >= 0.)
}

#[cfg(test)]
mod tests;
