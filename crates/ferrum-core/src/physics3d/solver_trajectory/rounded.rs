//! Exact finite image of the existing interval-local f32 kernel parameter.
//! A monotone rounding map whose endpoints are equal/adjacent f32 values has
//! no third possible output anywhere in the interval. We enumerate that whole
//! image, including conservative cross-products for independent anchor time.
//! This is not a sampled endpoint interpolation or a different motion curve.
use super::{Curve, Kernel, ShapeMotion, Time, TrajectoryError, Work};
use rapier3d::parry::query::sweep_toi::ToiProxy;
use rapier3d::prelude as rp;

pub(super) use output::native_box_face_cast;
mod common_phase;
mod common_timeline;
mod correlated_linear;
mod finite_image;
mod integrated_linear;
pub(super) use common_timeline::{
    certificate as timeline_certificate, separated as timeline_separated,
};
pub(super) use integrated_linear::{
    cardinal_box_capsule_prefix, monotone_capsules_separated, parallel_capsules_stable_existing,
    separated as integrated_linear_separated, FacePrefix,
};
pub(super) use output::cardinal_box_ball_separated;
pub(super) use output::fixed_box_capsule_edge_prefix;
pub(in crate::physics3d) use output::straight_primitive_bounds;
pub(in crate::physics3d) use output::tight_face_fits;
/// Advance only through consecutive intervals with a complete moving-face
/// certificate. A failed test only limits the next partition.
#[allow(clippy::too_many_arguments)]
pub(super) fn rotating_box_ball_prefix(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    normal: rp::Vector,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    let moving = if sa.as_cuboid().is_some() && sb.as_ball().is_some() && b.is_fixed_axis_aligned()
    {
        a
    } else if sb.as_cuboid().is_some() && sa.as_ball().is_some() && a.is_fixed_axis_aligned() {
        b
    } else {
        return Ok(None);
    };
    if !moving.is_single_axis_spin()
        || moving.local_center != rp::Vector::ZERO
        || moving.local_pose != rp::Pose::IDENTITY
        || !matches!(moving.curve, Curve::Integrated(k) if k.native.linear_velocity != rp::Vector::ZERO)
    {
        return Ok(None);
    }
    let prove = |from, to, work: &mut Work| {
        let mut cache = AxisCache::new(a, sa, b, sb, from, to, clearance);
        rotating_box_ball_face_separated(&mut cache, normal, work)
    };
    if prove(start, end, work)? {
        return Ok(Some(end));
    }
    let mut frontier = start;
    let mut unknown = end;
    for _ in 0..26 {
        work.charge(8)?;
        let next = frontier + (unknown - frontier) * 0.5;
        if next <= frontier || next >= unknown || unknown - frontier <= tolerance / 16. {
            break;
        }
        if prove(frontier, next, work)? {
            frontier = next;
        } else {
            unknown = next;
        }
    }
    Ok((frontier > start).then_some(frontier))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn vertical_capsule_separated(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::axial_capsule_separated(
        output::Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        normal,
        work,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn shared_planar_capsule_hit(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<super::CastHit>, TrajectoryError> {
    const MAX_PROOF_WORK: u64 = 2 * 1024 * 1024;
    let available = work.limit - work.used;
    let mut proof = Work {
        used: 0,
        limit: available.min(MAX_PROOF_WORK),
    };
    let result = output::shared_planar_capsule_sweep(
        output::Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        tolerance,
        &mut proof,
    );
    work.charge(proof.used)?;
    match result {
        Err(TrajectoryError::WorkLimit) if available >= MAX_PROOF_WORK => Ok(None),
        result => result,
    }
}

pub(super) fn upright_capsule_motion(motion: ShapeMotion) -> bool {
    motion.is_fixed_axis_aligned()
        || (motion.local_pose == rp::Pose::IDENTITY
            && motion.local_center == rp::Vector::ZERO
            && match motion.curve {
                Curve::Integrated(k) => {
                    k.native.angular_velocity == rp::Vector::ZERO
                        && k.native.motion.start.rotation == rp::Rotation::IDENTITY
                        && k.native.motion.end.rotation == rp::Rotation::IDENTITY
                }
                Curve::Anchored { rotation, .. } => rotation == rp::Rotation::IDENTITY,
                _ => false,
            })
}

/// Stream the moving-face proof, then visit each original collider pose
/// in the short intervals where the smooth projection is inconclusive.
#[allow(clippy::too_many_arguments)]
pub(super) fn planar_capsule_sweep(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    from: Time,
    end: Time,
    margin: f32,
    normal: rp::Vector,
    tolerance: Time,
    first_cell_proved: bool,
    work: &mut Work,
) -> Result<super::IntervalCertificate, TrajectoryError> {
    use super::IntervalCertificate::*;
    let upright = |shape: &dyn rp::Shape, motion: ShapeMotion| {
        let Some(capsule) = shape.as_capsule() else {
            return false;
        };
        let [a, b] = [capsule.segment.a, capsule.segment.b];
        a.x == 0.
            && b.x == 0.
            && a.z == 0.
            && b.z == 0.
            && a.y != b.y
            && upright_capsule_motion(motion)
    };
    let rotating = |shape: &dyn rp::Shape, motion: ShapeMotion| {
        shape.as_cuboid().is_some()
            && motion.local_center == rp::Vector::ZERO
            && motion.local_pose == rp::Pose::IDENTITY
            && matches!(motion.curve, Curve::Integrated(k)
                if k.native.linear_velocity == rp::Vector::ZERO
                    && k.native.angular_velocity.x == 0.
                    && k.native.angular_velocity.y == 0.
                    && k.native.angular_velocity.z >= 0.
                    && [k.native.motion.start.rotation, k.native.motion.end.rotation]
                        .into_iter().all(|q| q.x == 0. && q.y == 0. && q.w > q.z && q.z > 0.))
    };
    let stationary_pair = super::constant_pose(a.curve).is_some()
        && super::constant_pose(b.curve).is_some()
        && ((sa.as_cuboid().is_some() && upright(sb, b))
            || (sb.as_cuboid().is_some() && upright(sa, a)));
    let box_motion = if stationary_pair || (rotating(sa, a) && upright(sb, b)) {
        a
    } else if rotating(sb, b) && upright(sa, a) {
        b
    } else {
        return Ok(Unproven);
    };
    let zero_spin =
        matches!(box_motion.curve, Curve::Integrated(k) if k.native.angular_velocity.z == 0.);
    const MAX_ROUNDS: usize = 128;
    let mut pending = [0.; 49];
    let mut count = 0;
    let mut start = from;
    let mut upper = end;
    // Use a fixed price ceiling so replay with the exact measured work takes
    // the same path. Every visit, including a declined proof, stays metered.
    const MAX_PROOF_WORK: u64 = 8 * 1024 * 1024;
    let available = work.limit - work.used;
    let mut proof = Work {
        used: 0,
        limit: available.min(MAX_PROOF_WORK),
    };
    let result = (|| {
        if stationary_pair {
            return common_timeline::planar_capsule_image(
                a, sa, b, sb, from, end, margin, false, &mut proof,
            );
        }
        for _ in 0..MAX_ROUNDS {
            let work = &mut proof;
            work.charge(32)?;
            let mut cache = AxisCache::new(a, sa, b, sb, start, upper, margin);
            let mut separated = output::rotating_box_capsule_separated(&mut cache, normal, work)?;
            if !separated && (zero_spin || upper - start <= tolerance * 4.) {
                match common_timeline::planar_capsule_image(
                    a,
                    sa,
                    b,
                    sb,
                    start,
                    upper,
                    margin,
                    first_cell_proved || start > from,
                    work,
                )? {
                    Hit(hit) if hit.hit_time - hit.safe_time <= tolerance => return Ok(Hit(hit)),
                    Separated => separated = true,
                    _ => return Ok(Unproven),
                }
            }
            if separated {
                if count == 0 {
                    return Ok(Separated);
                }
                start = upper;
                count -= 1;
                upper = pending[count];
            } else {
                let mid = start + (upper - start) * 0.5;
                if mid <= start || mid >= upper || count == pending.len() {
                    return Ok(Unproven);
                }
                pending[count] = upper;
                count += 1;
                upper = mid;
            }
        }
        Ok(Unproven)
    })();
    work.charge(proof.used)?;
    match result {
        Err(TrajectoryError::WorkLimit) if available >= MAX_PROOF_WORK => Ok(Unproven),
        result => result,
    }
}

pub(super) use output::{
    rotating_box_ball_face_separated, rotating_box_capsule_separated,
    rotating_capsule_ball_separated, rotating_cardinal_box_face_separated,
};
mod output;
pub(super) use output::anchored_capsule_face_separated;
pub(super) use output::rounded_box_extents;
pub(in crate::physics3d) use output::static_signed_support_lower;
pub(super) mod stationary;
#[cfg(test)]
pub(super) use output::initial_support_clearance;
pub(in crate::physics3d) use output::normal_action_range;
pub(super) use output::signed_face_support;
pub(super) use output::{initial_capsule_cell, PlanarCell};
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d) fn offset_box_ball_separated(
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
    output::offset_box_ball_separated(
        output::Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        normal,
        work,
    )
}

pub(super) use output::{
    closed_plane_cached, fixed_support_capsule_separated, initial_support_allowances,
    native_clear_static_eligible, ramp_capsule_separated, rounded_cap_edge_separated,
    rounded_cap_plane_witness, rounded_capsule_pair_separated, whole_bounds, AxisCache,
};

pub(super) fn linear_com_addition_invisible(
    curve: Curve,
    rate: rp::Vector,
    start: Time,
    end: Time,
    max_addition_seconds: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::linear_com_addition_invisible(curve, rate, start, end, max_addition_seconds, work)
}

#[derive(Clone, Copy)]
struct Parameter {
    values: [f32; 2],
    len: usize,
}
impl Parameter {
    fn singleton(value: f32) -> Self {
        Self {
            values: [value; 2],
            len: 1,
        }
    }
    fn image(lo: f32, hi: f32) -> Option<Self> {
        if !lo.is_finite() || !hi.is_finite() || lo > hi {
            return None;
        }
        if lo == hi {
            Some(Self::singleton(lo))
        } else if lo.next_up() == hi {
            Some(Self {
                values: [lo, hi],
                len: 2,
            })
        } else {
            None
        }
    }
}
struct Image {
    curve: Curve,
    primary: Parameter,
    relative: Parameter,
    // Only Image::new owns the complete actual input image. The collapsed
    // output representative in complete() deliberately has no phase label.
    input_interval: Option<(Time, Time)>,
}
impl Image {
    fn new(curve: Curve, start: Time, end: Time) -> Option<Self> {
        let (from, to) = curve.times();
        if start < from || end > to || start > end {
            return None;
        }
        let one = Parameter::singleton(0.);
        let (primary, relative) = match curve {
            Curve::Constant { .. } => (one, one),
            Curve::Integrated(kernel) => (
                Parameter::image(kernel.local_delta(start), kernel.local_delta(end))?,
                one,
            ),
            Curve::Anchored { carrier, .. } => (
                Parameter::image(carrier.local_delta(start), carrier.local_delta(end))?,
                Parameter::image(
                    ((start - carrier.domain.start).clamp(0., carrier.domain.duration())) as f32,
                    ((end - carrier.domain.start).clamp(0., carrier.domain.duration())) as f32,
                )?,
            ),
            Curve::Ccd {
                start_time,
                end_time,
                ..
            } => {
                let span = end_time - start_time;
                if span <= 0. {
                    return None;
                }
                (
                    Parameter::image(
                        ((start - start_time) / span).clamp(0., 1.) as f32,
                        ((end - start_time) / span).clamp(0., 1.) as f32,
                    )?,
                    one,
                )
            }
        };
        Some(Self {
            curve,
            primary,
            relative,
            input_interval: Some((start, end)),
        })
    }
    fn complete(
        curve: Curve,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        if let Some(image) = Self::new(curve, start, end) {
            return Ok(Some(image));
        }
        let Some((low, high)) = linear_pose_range(curve, start, end, work)? else {
            return Ok(None);
        };
        if low.translation.to_array().map(f32::to_bits)
            != high.translation.to_array().map(f32::to_bits)
        {
            return Ok(None);
        }
        let Curve::Integrated(kernel) = curve else {
            return Ok(None);
        };
        Ok(Some(Self {
            curve,
            primary: Parameter::singleton(kernel.local_delta(start)),
            relative: Parameter::singleton(0.),
            input_interval: None,
        }))
    }
    fn len(&self) -> usize {
        self.primary.len * self.relative.len
    }
    fn poses(&self, motion: ShapeMotion) -> Result<Poses, TrajectoryError> {
        let mut out = Poses {
            values: [rp::Pose::IDENTITY; 4],
            len: 0,
        };
        for &parameter in &self.primary.values[..self.primary.len] {
            for &relative in &self.relative.values[..self.relative.len] {
                let com = match self.curve {
                    Curve::Constant { pose, .. } => pose,
                    Curve::Integrated(kernel) => {
                        kernel.native.position_at_integration_time(parameter)
                    }
                    Curve::Anchored {
                        carrier,
                        anchor,
                        offset,
                        linear_velocity,
                        rotation,
                    } => {
                        let pose = carrier.native.position_at_integration_time(parameter);
                        rp::Pose::from_parts(
                            pose.translation
                                + pose.rotation * anchor
                                + offset
                                + linear_velocity * relative,
                            rotation,
                        )
                    }
                    Curve::Ccd { sweep, .. } => sweep
                        .transform_at(parameter)
                        .prepend_translation(sweep.local_center),
                };
                let pose = com.prepend_translation(-motion.local_center) * motion.local_pose;
                if !pose.is_finite() {
                    return Err(TrajectoryError::NonFinite);
                }
                out.values[out.len] = pose;
                out.len += 1;
            }
        }
        Ok(out)
    }
}
// On zero-angular Integrated motion, every translation coordinate is a
// monotone original f32 multiply/add. This range is valid only when the stored
// endpoint and normalized-interior rotations agree bit-for-bit. Anchored
// cancellation and angular motion deliberately have no such range proof.
fn linear_pose_range(
    curve: Curve,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<(rp::Pose, rp::Pose)>, TrajectoryError> {
    let (from, to) = curve.times();
    if start < from || end > to || start > end {
        return Ok(None);
    }
    if let Curve::Constant { pose, .. } = curve {
        return Ok(Some((pose, pose)));
    }
    let Curve::Integrated(kernel) = curve else {
        return Ok(None);
    };
    if kernel.native.angular_velocity != rp::Vector::ZERO {
        return Ok(None);
    }
    work.charge(384)?;
    let (lo, hi) = (kernel.local_delta(start), kernel.local_delta(end));
    if !lo.is_finite() || !hi.is_finite() || lo > hi {
        return Ok(None);
    }
    let translation_at =
        |dt| kernel.native.motion.start.translation + kernel.native.linear_velocity * dt;
    let low = kernel.native.position_at_integration_time(lo);
    let high = kernel.native.position_at_integration_time(hi);
    let bits = |v: rp::Vector| v.to_array().map(f32::to_bits);
    if bits(low.translation) != bits(translation_at(lo))
        || bits(high.translation) != bits(translation_at(hi))
        || low.rotation.to_array().map(f32::to_bits) != high.rotation.to_array().map(f32::to_bits)
    {
        return Ok(None);
    }
    let interior_lo = if lo <= 0. { f32::from_bits(1) } else { lo };
    let interior_hi = if hi >= kernel.native.integration_seconds {
        kernel.native.integration_seconds.next_down()
    } else {
        hi
    };
    if interior_lo <= interior_hi {
        let interior = kernel.native.position_at_integration_time(interior_lo);
        if interior.rotation.to_array().map(f32::to_bits)
            != low.rotation.to_array().map(f32::to_bits)
        {
            return Ok(None);
        }
    }
    Ok(Some((low, high)))
}

struct Poses {
    values: [rp::Pose; 4],
    len: usize,
}

// Outward-rounded scalar bounds over the *actual* f32 transformed vertices.
// Rounding here protects the support certificate; it is not collision slop.
#[derive(Clone, Copy)]
struct Bound {
    lo: f64,
    hi: f64,
}
impl Bound {
    fn exact(x: f64) -> Self {
        Self { lo: x, hi: x }
    }
    fn finite(self) -> bool {
        self.lo.is_finite() && self.hi.is_finite()
    }
    fn is_exact(self, value: f64) -> bool {
        self.lo == value && self.hi == value
    }
    fn add(self, other: Self) -> Self {
        if self.finite() && other.finite() {
            if self.is_exact(0.) {
                return other;
            }
            if other.is_exact(0.) {
                return self;
            }
            if self.lo == self.hi && other.lo == other.hi && self.lo == -other.lo {
                return Self::exact(0.);
            }
        }
        Self {
            lo: (self.lo + other.lo).next_down(),
            hi: (self.hi + other.hi).next_up(),
        }
    }
    fn sub(self, other: Self) -> Self {
        let finite = self.finite() && other.finite();
        let exact = |a: f64, b: f64| {
            finite
                && (a == b
                    || a == 0.
                    || b == 0.
                    // Sterbenz subtraction, including gradual underflow.
                    // Doubling is exact or overflows above every finite
                    // comparison operand; it cannot round the ratio inward.
                    || (a.is_sign_positive() == b.is_sign_positive()
                        && a.abs() <= b.abs() * 2.
                        && b.abs() <= a.abs() * 2.))
        };
        let lo = self.lo - other.hi;
        let hi = self.hi - other.lo;
        Self {
            lo: if exact(self.lo, other.hi) {
                lo
            } else {
                lo.next_down()
            },
            hi: if exact(self.hi, other.lo) {
                hi
            } else {
                hi.next_up()
            },
        }
    }
    fn mul(self, other: Self) -> Self {
        if self.finite() && other.finite() {
            if self.is_exact(0.) || other.is_exact(0.) {
                return Self::exact(0.);
            }
            if self.is_exact(1.) {
                return other;
            }
            if other.is_exact(1.) {
                return self;
            }
            if self.is_exact(-1.) {
                return Self {
                    lo: -other.hi,
                    hi: -other.lo,
                };
            }
            if other.is_exact(-1.) {
                return Self {
                    lo: -self.hi,
                    hi: -self.lo,
                };
            }
        }
        let terms = [
            self.lo * other.lo,
            self.lo * other.hi,
            self.hi * other.lo,
            self.hi * other.hi,
        ];
        Self {
            lo: terms.into_iter().fold(f64::INFINITY, f64::min).next_down(),
            hi: terms
                .into_iter()
                .fold(f64::NEG_INFINITY, f64::max)
                .next_up(),
        }
    }
    fn sqrt(self) -> Self {
        // This is an exact real interval identity, not a rounded Native dot
        // result being snapped to a unit norm. Other roots remain outward.
        if self.is_exact(1.) {
            return self;
        }
        Self {
            lo: self.lo.sqrt().next_down(),
            hi: self.hi.sqrt().next_up(),
        }
    }
}
fn dot(point: rp::Vector, axis: rp::Vector) -> Bound {
    let mut result = Bound::exact(0.);
    for (a, b) in point.to_array().into_iter().zip(axis.to_array()) {
        result = result.add(Bound::exact(f64::from(a)).mul(Bound::exact(f64::from(b))));
    }
    result
}

pub(super) fn has_stationary_anchor(a: ShapeMotion, b: ShapeMotion) -> bool {
    has_rigid_anchor(a, b)
        && [a, b].into_iter().any(|motion| {
            matches!(motion.curve, Curve::Integrated(k)
                if k.native.linear_velocity == rp::Vector::ZERO
                    && k.native.angular_velocity == rp::Vector::ZERO
                    && (k.native.motion.start.rotation.z != 0.
                        || k.native.motion.end.rotation.z != 0.))
        })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let mut axes = super::SeparationAxes::single(normal);
    let mut cache = AxisCache::new(a, shape_a, b, shape_b, start, end, clearance);
    if separated_cached(0, work, &mut axes, &mut cache)? {
        return Ok(true);
    }
    if output::corotating_separated(cache.context(), work)? {
        return Ok(true);
    }
    timeline_separated(a, shape_a, b, shape_b, start, end, clearance, work)
}

pub(super) fn moving_face_separated(
    cache: &AxisCache<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::moving_face_separated(cache.context(), work)
}
pub(super) fn has_rigid_anchor(a: ShapeMotion, b: ShapeMotion) -> bool {
    [(a, b), (b, a)].into_iter().any(|(anchor_motion, owner)| {
        let Curve::Integrated(owner) = owner.curve else {
            return false;
        };
        let spin = owner.native.angular_velocity;
        let follows_axis = |drift: rp::Vector| {
            drift == rp::Vector::ZERO
                || (drift.is_finite()
                    && (0..3).any(|axis| {
                        spin[axis] != 0.
                            && (0..3).all(|i| i == axis || (spin[i] == 0. && drift[i] == 0.))
                    }))
        };
        matches!(anchor_motion.curve, Curve::Anchored { carrier, anchor, linear_velocity, .. }
            if carrier.native.motion.body == owner.native.motion.body
                && anchor != rp::Vector::ZERO && follows_axis(linear_velocity))
    })
}

pub(super) fn corotating_separated(
    cache: &AxisCache<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::corotating_separated(cache.context(), work)
}

pub(super) fn fixed_wall_overlap(
    cache: &AxisCache<'_>,
    at: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::fixed_wall_overlap(cache.context(), at, work)
}
pub(super) fn fixed_wall_time_hint(cache: &AxisCache<'_>) -> Option<Time> {
    output::fixed_wall_time_hint(cache.context())
}

pub(super) fn planar_rotating_box_separated(
    cache: &AxisCache<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::planar_rotating_box_separated(cache.context(), work)
}

pub(super) fn corotating_projected_prefix(
    cache: &AxisCache<'_>,
    work: &mut Work,
) -> Result<super::IntervalCertificate, TrajectoryError> {
    output::corotating_projected_prefix(cache.context(), work)
}
/// Called only after the original complete separation sequence declined.
pub(super) fn exact_box_separated(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::exact_box_separated_cached(cache, normal, work)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn shared_normal_complete(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    output::shared_normal_complete(
        output::Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        normal,
        work,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn shared_normal_prefix(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    output::shared_normal_prefix(
        output::Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        normal,
        work,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn nearby_rotating_conflict(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    normal: rp::Vector,
    prior: Time,
    work: &mut Work,
    confirm: impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Time>, TrajectoryError> {
    output::nearby_rotating_conflict(
        output::Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        normal,
        prior,
        work,
        confirm,
    )
}

pub(super) fn staggered_prefix(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    normal: rp::Vector,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    output::staggered_prefix(
        output::Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        normal,
        tolerance,
        work,
    )
}

/// Complete correlated support for the focused translation cases that
/// would otherwise revisit many independent rounded position ranges.
pub(super) fn early_common_product(
    cache: &AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<bool>, TrajectoryError> {
    let context = cache.context();
    if !output::early_common_product_applicable(context) {
        return Ok(None);
    }
    work.charge(1)?;
    output::common_product_separated(context, normal, work).map(Some)
}

/// Reuse only directions already admitted by the original <=14-axis owner.
/// Existing successes, including exact_box, have already had first refusal.
pub(super) fn common_product_separated(
    cache: &AxisCache<'_>,
    axes: &super::SeparationAxes,
    primary_checked: bool,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if !output::common_product_applicable(cache.context()) {
        return Ok(false);
    }
    for axis in &axes.values[usize::from(primary_checked)..axes.len] {
        work.charge(1)?; // actual existing direction metadata visit
        if output::common_product_separated(cache.context(), axis.normal, work)? {
            return Ok(true);
        }
    }
    Ok(false)
}

pub(super) fn separated_cached(
    index: usize,
    work: &mut Work,
    axes: &mut super::SeparationAxes,
    cache: &mut AxisCache<'_>,
) -> Result<bool, TrajectoryError> {
    separated_cached_observed(index, work, axes, cache, None)
        .map(|proof| matches!(proof, super::IntervalCertificate::Separated))
}

fn native_output_point<'a>(
    normal: rp::Vector,
    cache: &mut AxisCache<'_>,
    observe_point: &mut Option<&mut super::PointObserver<'a>>,
    work: &mut Work,
) -> Result<Option<super::IntervalCertificate>, TrajectoryError> {
    if observe_point.is_none() || !cache.point_probe_available() {
        return Ok(None);
    }
    let output::Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = cache.context();
    let Some(time) =
        integrated_linear::native_output_probe(a, sa, b, sb, normal, start, end, clearance, work)?
    else {
        return Ok(None);
    };
    // Share the original one-nomination interval bound, including an invalid
    // clock inverse or an actual observed absence. No lower-support counter
    // is itself a collision and no preceding prefix is invented here.
    cache.take_point_probe();
    if time.is_finite() && time > start && time < end {
        if let Some(observe) = observe_point.as_mut() {
            if let Some(contact) = observe(time, work)? {
                return Ok(Some(super::IntervalCertificate::Point { time, contact }));
            }
        }
    }
    Ok(None)
}

pub(super) fn separated_cached_observed(
    index: usize,
    work: &mut Work,
    axes: &mut super::SeparationAxes,
    cache: &mut AxisCache<'_>,
    mut observe_point: Option<&mut super::PointObserver<'_>>,
) -> Result<super::IntervalCertificate, TrajectoryError> {
    let output::Context {
        a,
        sa: shape_a,
        b,
        sb: shape_b,
        start,
        end,
        clearance,
    } = cache.context();
    let normal = axes.values[index].normal;
    // The original ball query has two different radius-subtraction graphs.
    // Avoid the older ideal plane/linear shortcuts even when the entire
    // parameter image is finite; output checks both graphs or every leaf.
    if shape_a.as_ball().is_some() && shape_b.as_ball().is_some() {
        return output::separated_cached(index, work, axes, cache).map(|clear| {
            if clear {
                super::IntervalCertificate::Separated
            } else {
                super::IntervalCertificate::Unproven
            }
        });
    }
    let separated = match cache.finite_image.separated(normal, work)? {
        Some(true) => true,
        Some(false) => {
            if let Some(point) = native_output_point(normal, cache, &mut observe_point, work)? {
                return Ok(point);
            }
            output::shared_normal_separated(cache.context(), normal, work)?
        }
        None => {
            if observe_point.is_some() && cache.point_probe_available() {
                let proof = correlated_linear::certificate(cache.context(), normal, work)?;
                if proof.separated {
                    return Ok(super::IntervalCertificate::Separated);
                }
                if let Some(time) = proof.probe {
                    // One nomination at most is consumed in this immutable
                    // interval, even when it is invalid or not a real hit.
                    // A lower-support counter is not a collision observation.
                    cache.take_point_probe();
                    if time.is_finite() && time > start && time < end {
                        if let Some(observe) = observe_point.as_mut() {
                            if let Some(contact) = observe(time, work)? {
                                return Ok(super::IntervalCertificate::Point { time, contact });
                            }
                        }
                    }
                }
            } else if correlated_linear::separated(cache.context(), normal, work)? {
                return Ok(super::IntervalCertificate::Separated);
            }
            if let Some(point) = native_output_point(normal, cache, &mut observe_point, work)? {
                return Ok(point);
            }
            if output::separated_cached(index, work, axes, cache)? {
                true
            } else {
                linear_separated(a, shape_a, b, shape_b, normal, start, end, clearance, work)?
            }
        }
    };
    Ok(if separated {
        super::IntervalCertificate::Separated
    } else {
        super::IntervalCertificate::Unproven
    })
}

#[allow(clippy::too_many_arguments)]
fn linear_separated(
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
    let (Some(ca), Some(cb)) = (
        linear_pose_range(a.curve, start, end, work)?,
        linear_pose_range(b.curve, start, end, work)?,
    ) else {
        return Ok(false);
    };
    let pa = ToiProxy::from_shape(sa).ok_or(TrajectoryError::UnsupportedShape)?;
    let pb = ToiProxy::from_shape(sb).ok_or(TrajectoryError::UnsupportedShape)?;
    let cost = pa
        .points()
        .len()
        .checked_mul(if pa.radius > 0. { 1024 } else { 128 })
        .and_then(|a| {
            pb.points()
                .len()
                .checked_mul(if pb.radius > 0. { 1024 } else { 128 })
                .and_then(|b| a.checked_add(b))
        })
        .and_then(|n| n.checked_add(256))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(cost).map_err(|_| TrajectoryError::WorkLimit)?)?;
    let shape_poses = |m: ShapeMotion, (lo, hi): (rp::Pose, rp::Pose)| {
        (
            lo.prepend_translation(-m.local_center) * m.local_pose,
            hi.prepend_translation(-m.local_center) * m.local_pose,
        )
    };
    let (a0, a1) = shape_poses(a, ca);
    let (b0, b1) = shape_poses(b, cb);
    if !a0.is_finite() || !a1.is_finite() || !b0.is_finite() || !b1.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    // With fixed rotation, prepend/local-pose/vertex transforms are constant
    // multiplies plus componentwise adds. Therefore each resulting world
    // coordinate is monotone in that same COM coordinate. Endpoint min/max
    // encloses *all* intermediate rounded world vertices, not an interpolant.
    let mut upper = f64::NEG_INFINITY;
    let mut lower = f64::INFINITY;
    for &point in pa.points() {
        let Some(bound) = output::full_projection(a0, a1, point, pa.radius, normal) else {
            return Ok(false);
        };
        upper = upper.max(bound.hi);
    }
    for &point in pb.points() {
        let Some(bound) = output::full_projection(b0, b1, point, pb.radius, normal) else {
            return Ok(false);
        };
        lower = lower.min(bound.lo);
    }
    let norm2 = dot(normal, normal);
    if norm2.lo <= 0. || !norm2.hi.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let norm = norm2.sqrt();
    // Each point already includes both original radius interpretations.
    let radius = Bound::exact(f64::from(clearance)).mul(norm);
    let gap = Bound::exact(lower).sub(Bound::exact(upper)).sub(radius).lo;
    if !gap.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    Ok(gap >= 0.)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::solver_trajectory::{Domain, Kernel};
    fn anchored() -> ShapeMotion {
        let domain = Domain::new(0., 0.03125).unwrap();
        let native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            0.015625,
            rp::Pose::IDENTITY,
            rp::Vector::X,
            rp::Vector::Z * 4.,
        )
        .unwrap();
        ShapeMotion {
            curve: Curve::Anchored {
                carrier: Kernel::from_native(native, domain).unwrap(),
                anchor: rp::Vector::Y,
                offset: rp::Vector::Z,
                linear_velocity: rp::Vector::new(0.3, 0.2, 0.1),
                rotation: rp::Rotation::IDENTITY,
            },
            local_center: rp::Vector::new(0.015625, 0.03125, 0.03),
            local_pose: rp::Pose::from_translation(rp::Vector::new(0.05, 0.04, 0.03)),
        }
    }
    #[test]
    fn anchor_image_covers_carrier_and_relative_rounding_cartesian_without_sampling_a_curve() {
        let motion = anchored();
        let parameter = 0.0078125_f32;
        let boundary = (f64::from(parameter) + f64::from(parameter.next_up())) * 0.5 * 2.;
        let start = boundary.next_down();
        let end = boundary.next_up();
        let image = Image::new(motion.curve, start, end).unwrap();
        assert_eq!(image.primary.len, 2);
        assert_eq!(image.relative.len, 2);
        assert_eq!(image.len(), 4);
        let states = image.poses(motion).unwrap();
        for time in [start, boundary, end] {
            assert!(states.values[..states.len].contains(&motion.pose(time)));
        }
        // Arbitrary endpoints over the whole arc never create a finite-image
        // certificate: the original parameter has far more than two outputs.
        assert!(Image::new(motion.curve, 0., 0.03125).is_none());
    }
    #[test]
    fn original_stored_endpoint_constant_and_ccd_branches_are_in_the_image() {
        let anchored = anchored();
        let Curve::Anchored { carrier, .. } = anchored.curve else {
            unreachable!()
        };
        let sweep = rapier3d::parry::query::sweep_toi::Sweep::from_poses(
            &carrier.native.motion.start,
            &carrier.native.motion.end,
            rp::Vector::new(0.1, 0.2, 0.3),
        );
        for curve in [
            Curve::Integrated(carrier),
            anchored.curve,
            Curve::Constant {
                pose: rp::Pose::IDENTITY,
                start_time: 0.,
                end_time: 0.03125,
            },
            Curve::Ccd {
                sweep,
                start_time: 0.,
                end_time: 0.03125,
            },
        ] {
            let motion = ShapeMotion { curve, ..anchored };
            for (start, end) in [(0., 0_f64.next_up()), (0.03125_f64.next_down(), 0.03125)] {
                let image = Image::new(curve, start, end).unwrap();
                let states = image.poses(motion).unwrap();
                assert!(states.values[..states.len].contains(&motion.pose(start)));
                assert!(states.values[..states.len].contains(&motion.pose(end)));
            }
        }
    }
    #[test]
    fn finite_image_support_checks_both_curves_and_precharges_exact_work() {
        let a = anchored();
        let parameter = 0.0078125_f32;
        let boundary = (f64::from(parameter) + f64::from(parameter.next_up())) * 0.5 * 2.;
        let (start, end) = (boundary.next_down(), boundary.next_up());
        let b = ShapeMotion {
            curve: Curve::Constant {
                pose: rp::Pose::from_translation(rp::Vector::X * 10.),
                start_time: start,
                end_time: end,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let shape = rp::SharedShape::ball(0.25);
        let original = postcard::to_allocvec(&(a, b)).unwrap();
        let mut measured = Work {
            used: 0,
            limit: u64::MAX,
        };
        assert!(separated(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            rp::Vector::X,
            start,
            end,
            0.,
            &mut measured
        )
        .unwrap());
        assert!(separated(
            b,
            shape.as_ref(),
            a,
            shape.as_ref(),
            -rp::Vector::X,
            start,
            end,
            0.,
            &mut Work {
                used: 0,
                limit: measured.used
            }
        )
        .unwrap());
        assert_eq!(
            separated(
                a,
                shape.as_ref(),
                b,
                shape.as_ref(),
                rp::Vector::X,
                start,
                end,
                0.,
                &mut Work {
                    used: 0,
                    limit: measured.used - 1
                }
            ),
            Err(TrajectoryError::WorkLimit)
        );
        let overlap = ShapeMotion {
            curve: Curve::Constant {
                pose: a.pose(start),
                start_time: start,
                end_time: end,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        assert!(!separated(
            a,
            shape.as_ref(),
            overlap,
            shape.as_ref(),
            rp::Vector::X,
            start,
            end,
            0.,
            &mut Work {
                used: 0,
                limit: u64::MAX
            }
        )
        .unwrap());
        assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), original);
    }
    #[test]
    fn recorded_adjacent_native_states_use_original_full_shape_predicate_and_exact_budget() {
        let end = f64::from(0.009_075_622_f32);
        let domain = Domain::new(end * 35. / 36., end).unwrap();
        let native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            f32::from_bits(0x39842c5f),
            rp::Pose::from_parts(
                rp::Vector::ZERO,
                rp::Rotation::from_xyzw(0., 0., 0.175_554_41, 0.984_469_7),
            ),
            rp::Vector::ZERO,
            rp::Vector::Z * 40.,
        )
        .unwrap();
        let a = ShapeMotion {
            curve: Curve::Integrated(Kernel::from_native(native, domain).unwrap()),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let b = ShapeMotion {
            curve: Curve::Constant {
                pose: rp::Pose::from_translation(rp::Vector::new(1.2, 1., 0.)),
                start_time: domain.start,
                end_time: domain.end,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let (start, end) = (
            f64::from_bits(0x3f8237bf774baa32),
            f64::from_bits(0x3f8237bf774baa33),
        );
        let states = Image::new(a.curve, start, end).unwrap().poses(a).unwrap();
        assert_eq!(states.len, 2);
        let bar = rp::SharedShape::cuboid(2., 0.025, 0.1);
        let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
        for pose in &states.values[..states.len] {
            let c = super::super::leaf_contact(
                pose,
                bar.as_ref(),
                &b.pose(start),
                capsule.as_ref(),
                &mut Work {
                    used: 0,
                    limit: u64::MAX,
                },
            )
            .unwrap();
            assert!(c.dist > 0.01);
        }
        // The leaf witness is clear at both instants, but the original
        // rounded full shapes independently contain these contact points.
        // Each vector was selected on the recorded, unchanged pose image.
        let witnesses = [
            ([0x3fb16baf, 0x3ccccccd, 0], [0x3db25a49, 0xbef7fb9f, 0]),
            ([0x3fb16c8e, 0x3ccccccd, 0], [0x3db266ba, 0xbef7fa77, 0]),
        ];
        let half = bar.as_cuboid().unwrap().half_extents;
        let radius = capsule.as_capsule().unwrap().radius;
        let center = capsule.as_capsule().unwrap().segment.a;
        let squared_distance = |p: rp::Vector, q: rp::Vector| {
            (0..3).fold(Bound::exact(0.), |sum, i| {
                let delta = Bound::exact(f64::from(p[i])).sub(Bound::exact(f64::from(q[i])));
                sum.add(delta.mul(delta))
            })
        };
        let skin = 0.01_f32;
        for (at, (box_bits, capsule_bits)) in [start, end].into_iter().zip(witnesses) {
            let box_point = rp::Vector::from_array(box_bits.map(f32::from_bits));
            let cap_point = rp::Vector::from_array(capsule_bits.map(f32::from_bits));
            assert!(box_point.abs().cmple(half).all());
            assert!(squared_distance(cap_point, center).hi < f64::from(radius).powi(2));
            assert!(
                squared_distance(a.pose(at) * box_point, b.pose(at) * cap_point).hi
                    < f64::from(skin).powi(2)
            );
        }
        let before = postcard::to_allocvec(&(a, b)).unwrap();
        let axis = a.pose(start).rotation * rp::Vector::Y;
        let clear_control = ShapeMotion {
            curve: Curve::Constant {
                pose: b.pose(start).prepend_translation(rp::Vector::Y * 0.0005),
                start_time: domain.start,
                end_time: domain.end,
            },
            ..b
        };
        for (target, expected) in [(b, false), (clear_control, true)] {
            let query = |work: &mut Work| {
                separated(
                    a,
                    bar.as_ref(),
                    target,
                    capsule.as_ref(),
                    axis,
                    start,
                    end,
                    skin,
                    work,
                )
            };
            let mut measured = Work {
                used: 0,
                limit: u64::MAX,
            };
            assert_eq!(query(&mut measured).unwrap(), expected);
            assert_eq!(
                query(&mut Work {
                    used: 0,
                    limit: measured.used
                })
                .unwrap(),
                expected
            );
            assert_eq!(
                query(&mut Work {
                    used: 0,
                    limit: measured.used - 1
                }),
                Err(TrajectoryError::WorkLimit)
            );
        }
        assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
    }
    fn original_landing_kernel() -> super::super::Kernel {
        let h = f32::from_bits(0x3b888889);
        let duration = f64::from(4_f32 * h);
        let domain = Domain::new(duration * 3. / 4., duration).unwrap();
        let mut native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            h,
            rp::Pose::from_translation(rp::Vector::new(0., f32::from_bits(0x3f68f70e), 0.)),
            rp::Vector::new(0., f32::from_bits(0xbbc467ff), 0.),
            rp::Vector::ZERO,
        )
        .unwrap();
        native.motion.start_time = 3_f32 * h;
        native.motion.end_time = 4_f32 * h;
        Kernel::from_native(native, domain).unwrap()
    }
    #[test]
    fn linear_translation_plateau_is_singleton_for_many_original_physical_parameters() {
        let kernel = original_landing_kernel();
        let center = (f64::from(kernel.native.motion.start.translation.y) - f64::from(0.91_f32))
            / -f64::from(kernel.native.linear_velocity.y);
        let logical = |physical| {
            kernel.domain.start
                + physical * kernel.domain.duration() / f64::from(kernel.native.integration_seconds)
        };
        let (start, end) = (logical(center + 3.6e-6), logical(center + 4.4e-6));
        let (lo, hi) = (kernel.local_delta(start), kernel.local_delta(end));
        assert!(hi.to_bits() - lo.to_bits() > 1000);
        let curve = Curve::Integrated(kernel);
        assert!(Image::new(curve, start, end).is_none());
        let mut work = Work {
            used: 0,
            limit: u64::MAX,
        };
        let image = Image::complete(curve, start, end, &mut work)
            .unwrap()
            .unwrap();
        assert_eq!(image.len(), 1);
        let motion = ShapeMotion {
            curve,
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let poses = image.poses(motion).unwrap();
        assert_eq!(poses.values[0], motion.pose(start));
        assert_eq!(poses.values[0], motion.pose(end));
        let mut dt = lo;
        // This regression enumerates the recorded small input window; the
        // production proof uses monotonicity, with no parameter sampling loop.
        while dt <= hi {
            assert_eq!(
                kernel.native.position_at_integration_time(dt),
                poses.values[0]
            );
            dt = dt.next_up();
        }
    }
    #[test]
    fn zero_angular_singleton_does_not_assume_stored_and_interior_rotations_match() {
        let mut native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            1.,
            rp::Pose::from_parts(
                rp::Vector::ZERO,
                rp::Rotation::from_xyzw(0., 0., 0., 1.000002),
            ),
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap();
        // Endpoint equality alone is insufficient for this private malformed
        // kernel: the original zero-angular interior still normalizes q.
        native.motion.end = native.motion.start;
        let kernel = Kernel::from_native(native, Domain::new(0., 1.).unwrap()).unwrap();
        assert!(Image::complete(
            Curve::Integrated(kernel),
            0.,
            1.,
            &mut Work {
                used: 0,
                limit: u64::MAX
            }
        )
        .unwrap()
        .is_none());
        let anchored = Curve::Anchored {
            carrier: Kernel::from_velocity(
                rp::RigidBodyHandle::invalid(),
                Domain::new(0., 1.).unwrap(),
                rp::Pose::IDENTITY,
                rp::Vector::X,
                rp::Vector::ZERO,
            )
            .unwrap(),
            anchor: rp::Vector::ZERO,
            offset: rp::Vector::ZERO,
            linear_velocity: -rp::Vector::X,
            rotation: rp::Rotation::IDENTITY,
        };
        assert_eq!(anchored.com_pose(0.), anchored.com_pose(1.));
        assert!(Image::complete(
            anchored,
            0.,
            1.,
            &mut Work {
                used: 0,
                limit: u64::MAX
            }
        )
        .unwrap()
        .is_none());
        let mut rotating = kernel;
        rotating.native.angular_velocity = rp::Vector::Y;
        assert!(Image::complete(
            Curve::Integrated(rotating),
            0.,
            1.,
            &mut Work {
                used: 0,
                limit: u64::MAX
            }
        )
        .unwrap()
        .is_none());
    }
    #[test]
    fn original_landing_curve_keeps_skin_hit_and_finishes_inside_original_32m_work() {
        let kernel = original_landing_kernel();
        let a = ShapeMotion {
            curve: Curve::Constant {
                pose: rp::Pose::from_translation(-rp::Vector::Y * 0.1),
                start_time: kernel.domain.start,
                end_time: kernel.domain.end,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let b = ShapeMotion {
            curve: Curve::Integrated(kernel),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
        let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
        let before = postcard::to_allocvec(&(a, b)).unwrap();
        let tolerance =
            f64::from((kernel.native.motion.end_time - kernel.native.motion.start_time) * 1e-6);
        let mut work = Work {
            used: 0,
            limit: 32 * 1024 * 1024,
        };
        let hit = super::super::cast_full_shapes_policy(
            a,
            floor.as_ref(),
            b,
            capsule.as_ref(),
            kernel.domain.start,
            kernel.domain.end,
            0.01,
            tolerance,
            &mut work,
            true,
        )
        .unwrap()
        .unwrap();
        assert!(hit.safe_time < hit.hit_time);
        assert!(hit.hit_time - hit.safe_time <= tolerance);
        assert!(hit.contact.dist <= 0.01);
        assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
    }
    #[test]
    fn recorded_walk_uses_coordinate_plateau_without_ignoring_horizontal_motion_or_wall() {
        let h = f32::from_bits(0x3b888889);
        let domain = Domain::new(0., f64::from(h)).unwrap();
        let native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            h,
            rp::Pose::from_translation(rp::Vector::Y * 0.91),
            rp::Vector::new(2., f32::from_bits(0xba4c5fff), 0.),
            rp::Vector::ZERO,
        )
        .unwrap();
        let moving = ShapeMotion {
            curve: Curve::Integrated(Kernel::from_native(native, domain).unwrap()),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let floor = ShapeMotion {
            curve: Curve::Constant {
                pose: rp::Pose::from_translation(-rp::Vector::Y * 0.1),
                start_time: domain.start,
                end_time: domain.end,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
        let ground = rp::SharedShape::cuboid(20., 0.1, 20.);
        let (start, end) = (0.000027, 0.000035);
        assert_ne!(
            moving.pose(start).translation.x,
            moving.pose(end).translation.x
        );
        assert_eq!(
            moving.pose(start).translation.y,
            moving.pose(end).translation.y
        );
        assert!(Image::complete(
            moving.curve,
            start,
            end,
            &mut Work {
                used: 0,
                limit: u64::MAX
            }
        )
        .unwrap()
        .is_none());
        let original = postcard::to_allocvec(&(floor, moving)).unwrap();
        let mut measured = Work {
            used: 0,
            limit: u64::MAX,
        };
        assert!(linear_separated(
            floor,
            ground.as_ref(),
            moving,
            capsule.as_ref(),
            rp::Vector::Y,
            start,
            end,
            0.01,
            &mut measured
        )
        .unwrap());
        assert!(linear_separated(
            floor,
            ground.as_ref(),
            moving,
            capsule.as_ref(),
            rp::Vector::Y,
            start,
            end,
            0.01,
            &mut Work {
                used: 0,
                limit: measured.used
            }
        )
        .unwrap());
        assert_eq!(
            linear_separated(
                floor,
                ground.as_ref(),
                moving,
                capsule.as_ref(),
                rp::Vector::Y,
                start,
                end,
                0.01,
                &mut Work {
                    used: 0,
                    limit: measured.used - 1
                }
            ),
            Err(TrajectoryError::WorkLimit)
        );
        let wall = ShapeMotion {
            curve: Curve::Constant {
                pose: rp::Pose::from_translation(rp::Vector::new(0.4, 0.91, 0.)),
                start_time: domain.start,
                end_time: domain.end,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let wall_shape = rp::SharedShape::cuboid(0.01, 1., 1.);
        assert!(!linear_separated(
            moving,
            capsule.as_ref(),
            wall,
            wall_shape.as_ref(),
            rp::Vector::X,
            start,
            end,
            0.01,
            &mut Work {
                used: 0,
                limit: u64::MAX
            }
        )
        .unwrap());
        let tolerance = f64::from(h * 1e-6);
        let hit = super::super::cast_full_shapes_policy(
            floor,
            ground.as_ref(),
            moving,
            capsule.as_ref(),
            domain.start,
            domain.end,
            0.01,
            tolerance,
            &mut Work {
                used: 0,
                limit: 32 * 1024 * 1024,
            },
            true,
        )
        .unwrap()
        .unwrap();
        assert!(hit.contact.dist <= 0.01 && hit.hit_time - hit.safe_time <= tolerance);
        assert_eq!(postcard::to_allocvec(&(floor, moving)).unwrap(), original);
    }

    #[test]
    fn exact_finite_bound_identities_keep_ranges_without_correlating_independent_inputs() {
        for range in [
            Bound { lo: -2., hi: 3. },
            Bound {
                lo: f64::from_bits(1),
                hi: f64::MIN_POSITIVE,
            },
            Bound {
                lo: -f64::MAX,
                hi: f64::MAX,
            },
        ] {
            for result in [
                range.add(Bound::exact(0.)),
                Bound::exact(-0.).add(range),
                range.mul(Bound::exact(1.)),
                Bound::exact(1.).mul(range),
            ] {
                assert_eq!(result.lo.to_bits(), range.lo.to_bits());
                assert_eq!(result.hi.to_bits(), range.hi.to_bits());
            }
            for result in [range.mul(Bound::exact(-1.)), Bound::exact(-1.).mul(range)] {
                assert_eq!(result.lo, -range.hi);
                assert_eq!(result.hi, -range.lo);
            }
            assert!(range.mul(Bound::exact(0.)).is_exact(0.));
        }
        for x in [
            f64::from_bits(1),
            f64::MIN_POSITIVE,
            1.,
            f64::MAX,
            -f64::MAX,
        ] {
            assert!(Bound::exact(x).add(Bound::exact(-x)).is_exact(0.));
        }
        let independent = Bound { lo: 1., hi: 2. };
        let difference = independent.sub(independent);
        assert_eq!((difference.lo, difference.hi), (-1., 1.));
        let sum = independent.add(Bound { lo: -2., hi: -1. });
        assert!(sum.lo < 0. && sum.hi > 0.);
        // Infinite endpoints must not enable a zero-product identity.
        assert!(!Bound::exact(0.)
            .mul(Bound::exact(f64::INFINITY))
            .is_exact(0.));
    }

    #[test]
    fn exact_sterbenz_endpoint_differences_close_nonzero_gaps_and_keep_other_ops_outward() {
        for (a, b) in [
            (2., 1.),
            (-2., -1.),
            (f64::MAX, f64::MAX * 0.5),
            (f64::from_bits(3), f64::from_bits(2)),
            (f64::MIN_POSITIVE, f64::MIN_POSITIVE * 0.5),
        ] {
            let result = Bound::exact(a).sub(Bound::exact(b));
            assert!(result.is_exact(a - b));
        }
        assert!(Bound::exact(2.)
            .sub(Bound::exact(1.))
            .sub(Bound::exact(1.))
            .is_exact(0.));
        let tiny = 2_f64.powi(-54);
        let difference = Bound::exact(1.).sub(Bound::exact(tiny));
        assert_eq!(difference.lo, (1_f64 - tiny).next_down());
        assert_eq!(difference.hi, (1_f64 - tiny).next_up());
        let sum = Bound::exact(1.).add(Bound::exact(tiny));
        assert_eq!(sum.lo, (1_f64 + tiny).next_down());
        assert_eq!(sum.hi, (1_f64 + tiny).next_up());
        let product = Bound::exact(0.5).mul(Bound::exact(0.5));
        assert_eq!(product.lo, 0.25_f64.next_down());
        assert_eq!(product.hi, 0.25_f64.next_up());
        let overflow = Bound::exact(f64::MAX).add(Bound::exact(f64::MAX));
        assert!(!overflow.finite());
    }

    #[test]
    fn only_exact_real_unit_norm_is_preserved_without_expanding_its_square_root() {
        for axis in [rp::Vector::X, rp::Vector::Y, -rp::Vector::Z] {
            let squared = dot(axis, axis);
            assert!(squared.is_exact(1.));
            assert!(squared.sqrt().is_exact(1.));
        }
        let almost_unit = rp::Vector::new(1., 2_f32.powi(-20), 0.);
        assert_eq!(almost_unit.length_squared(), 1.);
        let squared = dot(almost_unit, almost_unit);
        assert!(!squared.is_exact(1.));
        assert!(squared.hi > 1. && squared.sqrt().hi > 1.);
        assert_eq!(Bound::exact(2.).sqrt().lo, 2_f64.sqrt().next_down());
        assert_eq!(Bound::exact(2.).sqrt().hi, 2_f64.sqrt().next_up());
    }
}
