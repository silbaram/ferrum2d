//! Early planar cuboid rotations with an upright capsule on the same COM.
//!
//! Once both Y output binades are known, the common translation can be
//! represented by one lattice period. Rounding ties belong to that period.
use super::*;
use crate::physics3d::solver_trajectory::CastHit;
use rapier3d::parry::{
    query::Contact,
    shape::{Capsule, Cuboid},
};

const MAX_TILT_INPUT: f32 = 1. / 8192.;
const TANGENT_SPLIT: f32 = 1. / 2048.;
const MAX_PHASES: usize = 64;
const MAX_FACE_LEVELS: usize = 32;
const MAX_SEARCH_STEPS: usize = 48;

struct Pair {
    carrier: Kernel,
    half: rp::Vector,
    offset: f32,
    core: f32,
    radius: f32,
    swapped: bool,
}

fn identity(q: rp::Rotation) -> bool {
    q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
}

fn operands(context: Context<'_>) -> Option<Pair> {
    let (box_motion, cuboid, cap_motion, capsule): (_, &Cuboid, _, &Capsule) =
        if let (Some(cuboid), Some(capsule)) = (context.sa.as_cuboid(), context.sb.as_capsule()) {
            (context.a, cuboid, context.b, capsule)
        } else {
            (
                context.b,
                context.sb.as_cuboid()?,
                context.a,
                context.sa.as_capsule()?,
            )
        };
    let (
        Curve::Integrated(carrier),
        Curve::Anchored {
            carrier: cap_carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        },
    ) = (box_motion.curve, cap_motion.curve)
    else {
        return None;
    };
    let a = carrier.native;
    let b = cap_carrier.native;
    let pure_y = |v: rp::Vector| v.x == 0. && v.z == 0. && v.y.is_finite();
    if anchor != rp::Vector::ZERO
        || linear_velocity != rp::Vector::ZERO
        || !identity(rotation)
        || ![box_motion, cap_motion].into_iter().all(|motion| {
            motion.local_center == rp::Vector::ZERO
                && motion.local_pose.translation == rp::Vector::ZERO
                && identity(motion.local_pose.rotation)
        })
        || !pure_y(a.motion.start.translation)
        || !pure_y(a.motion.end.translation)
        || !pure_y(a.linear_velocity)
        || a.motion.start.translation.to_array().map(f32::to_bits)
            != b.motion.start.translation.to_array().map(f32::to_bits)
        || a.motion.end.translation.to_array().map(f32::to_bits)
            != b.motion.end.translation.to_array().map(f32::to_bits)
        || a.linear_velocity.to_array().map(f32::to_bits)
            != b.linear_velocity.to_array().map(f32::to_bits)
        || carrier.domain.start.to_bits() != cap_carrier.domain.start.to_bits()
        || carrier.domain.end.to_bits() != cap_carrier.domain.end.to_bits()
        || a.motion.start_time.to_bits() != b.motion.start_time.to_bits()
        || a.motion.end_time.to_bits() != b.motion.end_time.to_bits()
        || a.integration_seconds.to_bits() != b.integration_seconds.to_bits()
        || !identity(a.motion.start.rotation)
        || !a.angular_velocity.is_finite()
        || a.angular_velocity.x != 0.
        || a.angular_velocity.y != 0.
        || a.angular_velocity.z <= 0.
        || !pure_y(offset)
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() <= 0.
        || cuboid.half_extents.max_element() > 1_048_576.
        || cuboid.half_extents.x <= TANGENT_SPLIT
        || ![capsule.segment.a, capsule.segment.b]
            .into_iter()
            .all(pure_y)
        || !capsule.radius.is_finite()
        || capsule.radius <= 0.
        || capsule.radius > 1_048_576.
        || capsule.segment.a.y.abs().max(capsule.segment.b.y.abs()) > 1_048_576.
    {
        return None;
    }
    // The capsule anchor is exactly zero. Its carrier rotation cannot change
    // the finite represented center, but both translations must use one clock.
    if !b.motion.start.rotation.is_finite()
        || !b.motion.end.rotation.is_finite()
        || !b.angular_velocity.is_finite()
        || a.angular_velocity.to_array().map(f32::to_bits)
            != b.angular_velocity.to_array().map(f32::to_bits)
        || a.motion.start.rotation.to_array().map(f32::to_bits)
            != b.motion.start.rotation.to_array().map(f32::to_bits)
        || a.motion.end.rotation.to_array().map(f32::to_bits)
            != b.motion.end.rotation.to_array().map(f32::to_bits)
    {
        return None;
    }
    Some(Pair {
        carrier,
        half: cuboid.half_extents,
        offset: offset.y,
        core: capsule.segment.a.y.min(capsule.segment.b.y),
        radius: capsule.radius,
        swapped: context.sa.as_capsule().is_some(),
    })
}

fn step(range: Float) -> Option<f64> {
    if !range.finite() || range.lo.is_sign_negative() != range.hi.is_sign_negative() {
        return None;
    }
    let low = range.lo.abs().min(range.hi.abs());
    let high = range.lo.abs().max(range.hi.abs());
    if !low.is_normal() || low.to_bits() >> 23 != high.to_bits() >> 23 {
        return None;
    }
    let spacing = f64::from(low.next_up()) - f64::from(low);
    spacing.is_finite().then_some(spacing)
}

fn sterbenz(a: Float, b: f32) -> bool {
    a.lo > 0.
        && b < 0.
        && f64::from(a.lo) * 2. >= f64::from(-b)
        && f64::from(a.hi) <= f64::from(-b) * 2.
}

fn top(t: f32, y: f32, z: f32, x: f32) -> f32 {
    // Scalar glam Quat::mul_vec3 with (0, 0, z, 1), where RN(1-z*z)=1.
    (y + (z * x) * 2.) + t
}

fn tangent(y: f32, z: f32, x: f32) -> f32 {
    x - (z * y) * 2.
}

fn first_at_height(t: f32, y: f32, z: f32, level: f32) -> f32 {
    let (mut low, mut high) = (0, TANGENT_SPLIT.to_bits());
    while low < high {
        let middle = low + (high - low) / 2;
        if top(t, y, z, f32::from_bits(middle)) < level {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    f32::from_bits(low)
}

fn square(value: Bound) -> Bound {
    if value.lo >= 0. {
        value.mul(value)
    } else if value.hi <= 0. {
        let value = negate(value);
        value.mul(value)
    } else {
        Bound {
            lo: 0.,
            hi: upper_mul(magnitude(value), magnitude(value)),
        }
    }
}

fn delta(a: f32, b: f32) -> Bound {
    Bound::exact(f64::from(a)).sub(Bound::exact(f64::from(b)))
}

fn farther_than(x: f64, y: Bound, radius: Bound) -> bool {
    y.lo >= 0. && square(Bound::exact(x)).add(square(y)).lo >= square(radius).hi
}

fn squared_distance(a: rp::Vector, b: rp::Vector) -> Bound {
    a.to_array()
        .into_iter()
        .zip(b.to_array())
        .fold(Bound::exact(0.), |sum, (a, b)| sum.add(square(delta(a, b))))
}

fn admitted_tilt(k: Kernel, time: Time) -> Option<f32> {
    let dt = k.local_delta(time);
    let tilt = k.native.angular_velocity.z * (dt * 0.5);
    // A physical input can round to saved h before its logical endpoint.
    // That branch uses the stored pose instead of this rotation expression.
    (dt < k.native.integration_seconds && tilt <= MAX_TILT_INPUT).then_some(tilt)
}

impl Pair {
    fn phase_is_clear(
        &self,
        translation: f32,
        center: Float,
        tilt: f32,
        margin: f32,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let y = self.half.y;
        let c = translation + self.offset;
        let core = c + self.core;
        let r = f64::from(self.radius);
        let margin = f64::from(margin);
        let reach = Bound::exact(r).add(Bound::exact(margin));
        let lo = top(translation, y, tilt, 0.);
        let hi = top(translation, y, tilt, TANGENT_SPLIT);
        let pole = self.core - self.radius;
        // When a rounded capsule level lies high enough, all points in that
        // level and subsequent levels are clear by vertical distance alone.
        // The range near its southern pole uses the exact post-add graph.
        if delta(core, lo).lo < reach.hi || delta(c + pole, lo).lo < margin {
            return Ok(false);
        }
        let mut level = lo;
        for _ in 0..MAX_FACE_LEVELS {
            work.charge(512)?;
            let x = if level == lo {
                0.
            } else {
                work.charge(1024)?; // at most 31 original rounded comparisons
                tangent(y, tilt, first_at_height(translation, y, tilt, level)).max(0.)
            };
            if !farther_than(f64::from(x), delta(core, level), reach) {
                return Ok(false);
            }
            let mut local = pole;
            for _ in 0..MAX_FACE_LEVELS {
                work.charge(256)?;
                if !sterbenz(center, local) {
                    return Ok(false);
                }
                let vertical = delta(c + local, level);
                if vertical.lo >= margin {
                    break;
                }
                let next = local.next_up();
                let highest_radius_y = Bound::exact(f64::from(local))
                    .add(Bound::exact(f64::from(next)))
                    .mul(Bound::exact(0.5))
                    .sub(Bound::exact(f64::from(self.core)));
                if highest_radius_y.hi >= 0. {
                    return Ok(false);
                }
                // A local point at this rounded level is inside the original
                // ball. Use the highest possible radius input Y to cover the
                // complete lateral interval, including ties at both ends.
                let lateral2 = square(Bound::exact(r)).sub(square(highest_radius_y));
                if !lateral2.finite() {
                    return Ok(false);
                }
                // Monotonic RN of the real lateral upper bound also covers
                // the original rounded capsule-local X coordinate.
                let lateral = lateral2.hi.max(0.).sqrt().next_up() as f32;
                let horizontal = Bound::exact(f64::from(x))
                    .sub(Bound::exact(f64::from(lateral)))
                    .lo
                    .max(0.);
                if !farther_than(horizontal, vertical, Bound::exact(margin)) {
                    return Ok(false);
                }
                local = next;
            }
            if !sterbenz(center, local) || delta(c + local, level).lo < margin {
                return Ok(false);
            }
            if level == hi {
                return Ok(true);
            }
            level = level.next_up();
        }
        Ok(false)
    }

    fn far_slabs_clear(
        &self,
        translation: Float,
        center: Float,
        relative: f64,
        top_spacing: f64,
        tilt: f32,
        margin: f32,
    ) -> bool {
        let r = f64::from(self.radius);
        let k = Bound::exact(f64::from(TANGENT_SPLIT));
        let s = Bound::exact(2. * f64::from(tilt));
        let span = Float::span(0., self.half.x * tilt);
        let x_error = half_ulp(Float::span(0., self.half.x));
        let y_error = upper_add(2. * half_ulp(span), top_spacing);
        let x_shift = f64::from((self.half.y * tilt) * 2.);
        let norm = Bound::exact(1.).add(square(k)).sqrt();
        let lower = Bound::exact(relative)
            .add(Bound::exact(f64::from(self.core)))
            .sub(Bound::exact(f64::from(self.half.y)))
            .add(k.sub(s).mul(Bound::exact(f64::from(TANGENT_SPLIT))))
            .sub(k.mul(Bound::exact(upper_add(x_shift, x_error))))
            .sub(Bound::exact(y_error));
        let local = Float::exact(self.core).add(Float::span(-self.radius, self.radius));
        let radial_x_error = upper_mul(k.hi, half_ulp(Float::span(-self.radius, self.radius)));
        let local_error = upper_add(
            radial_x_error,
            upper_add(half_ulp(local), half_ulp(center.add(local))),
        );
        let requested = Bound::exact(r)
            .add(Bound::exact(f64::from(margin)))
            .mul(norm)
            .add(Bound::exact(local_error));
        translation.finite() && x_shift <= f64::from(TANGENT_SPLIT) && lower.lo >= requested.hi
    }
}

pub(super) fn separated(context: Context<'_>, work: &mut Work) -> Result<bool, TrajectoryError> {
    let Some(pair) = operands(context) else {
        return Ok(false);
    };
    let k = pair.carrier;
    Kernel::from_native(k.native, k.domain)?;
    if context.start < k.domain.start
        || context.end >= k.domain.end
        || context.start > context.end
        || !context.clearance.is_finite()
        || context.clearance < 0.
    {
        return Ok(false);
    }
    let Some(tilt) = admitted_tilt(k, context.end) else {
        return Ok(false);
    };
    if tilt <= 0. {
        return Ok(false);
    }
    // Below this limit the original quaternion normalization computes one
    // exactly. The rounded quadratic term also leaves the diagonal at one.
    // Validate the represented translation binades before using their grids.
    work.charge(1024)?;
    let translation = Float::span(
        k.position_at_time(context.start).translation.y,
        k.position_at_time(context.end).translation.y,
    );
    let center = translation.add(Float::exact(pair.offset));
    let local_top = Float::span(pair.half.y, top(0., pair.half.y, tilt, pair.half.x));
    let world_top = translation.add(local_top);
    let (Some(t_step), Some(c_step), Some(top_step)) =
        (step(translation), step(center), step(world_top))
    else {
        return Ok(false);
    };
    if step(local_top) != Some(top_step)
        || !sterbenz(center, pair.core)
        || !sterbenz(center, pair.core - pair.radius)
        || world_top.lo <= 0.
        || (center.lo + pair.core).partial_cmp(&world_top.hi) != Some(std::cmp::Ordering::Greater)
        || center.lo + (pair.core - pair.radius) <= world_top.hi
        || c_step < t_step
        || top_step < t_step
    {
        return Ok(false);
    }
    // A two-step shift preserves nearest-even tie parity in each output
    // binade. Within the shorter box phase, the least C-T is the earliest
    // possible vertical contact because the lower cap adds are exact.
    let period = 2. * c_step.max(top_step) / t_step;
    if period > MAX_PHASES as f64 {
        return Ok(false);
    }
    let stride = (2. * top_step / t_step) as usize;
    let mut phases = [None::<(f64, f32)>; MAX_PHASES];
    for i in 0..period as usize {
        let t = (f64::from(translation.lo) + i as f64 * t_step) as f32;
        if t > translation.hi {
            break;
        }
        work.charge(64)?;
        let relative = f64::from(t + pair.offset) - f64::from(t);
        let slot = &mut phases[i % stride];
        if slot.is_none_or(|(prior, _)| relative < prior) {
            *slot = Some((relative, t));
        }
    }
    for (relative, t) in phases.into_iter().flatten() {
        work.charge(1024)?;
        if !pair.far_slabs_clear(
            translation,
            center,
            relative,
            top_step,
            tilt,
            context.clearance,
        ) || !pair.phase_is_clear(t, center, tilt, context.clearance, work)?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn strict_at(
    context: Context<'_>,
    pair: &Pair,
    at: Time,
    work: &mut Work,
) -> Result<Option<Contact>, TrajectoryError> {
    work.charge(1024)?;
    let (pa, pb) = if pair.swapped {
        (context.b.pose(at), context.a.pose(at))
    } else {
        (context.a.pose(at), context.b.pose(at))
    };
    let y = pair.half.y;
    let t = pa.translation.y;
    let Some(z) = admitted_tilt(pair.carrier, at) else {
        return Ok(None);
    };
    if z <= 0. || !pa.is_finite() || !pb.is_finite() {
        return Ok(None);
    }
    let core = pb * (rp::Vector::Y * pair.core);
    let lo = top(t, y, z, 0.);
    let hi = top(t, y, z, TANGENT_SPLIT);
    let x_zero = (z * y) * 2.;
    let margin = f64::from(context.clearance);
    let mut best: Option<(f64, rp::Vector)> = None;
    let mut level = lo;
    for _ in 0..MAX_FACE_LEVELS {
        work.charge(2048)?;
        let x = first_at_height(t, y, z, level).max(x_zero);
        if x > TANGENT_SPLIT {
            return Ok(None);
        }
        // Use the original pose, not the scalar search approximation, for
        // both endpoints of this claimed world-radius witness.
        let point = pa * rp::Vector::new(x, y, 0.);
        if !point.is_finite() || core.y <= point.y {
            return Ok(None);
        }
        let upper = squared_distance(core, point)
            .sqrt()
            .sub(Bound::exact(f64::from(pair.radius)))
            .hi;
        if upper < margin && best.is_none_or(|(prior, _)| upper < prior) {
            best = Some((upper, point));
        }
        if level == hi {
            break;
        }
        level = level.next_up();
    }
    let Some((upper, point)) = best else {
        return Ok(None);
    };
    let Some(normal) = (core - point).try_normalize() else {
        return Ok(None);
    };
    // This rounded display point is admitted inside the original real ball.
    // Its distance is reported from the directed real geometry above.
    let radius_squared = square(Bound::exact(f64::from(pair.radius))).lo;
    let Some(ball) = [pair.radius, pair.radius.next_down()]
        .into_iter()
        .map(|r| core - normal * r)
        .find(|&p| p.is_finite() && squared_distance(core, p).hi <= radius_squared)
    else {
        return Ok(None);
    };
    let mut dist = upper as f32;
    if f64::from(dist) < upper {
        dist = dist.next_up();
    }
    let contact = Contact::new(point, ball, normal, -normal, dist);
    Ok(Some(if pair.swapped {
        contact.flipped()
    } else {
        contact
    }))
}

/// Admit a chronological prefix, then independently check original closed
/// box points at the trailing edges of a bounded number of translation cells.
/// Failure to produce a verified hit leaves the ordinary cast unchanged.
pub(in crate::physics3d::solver_trajectory::rounded::output) fn sweep(
    context: Context<'_>,
    time_tolerance: Time,
    work: &mut Work,
) -> Result<Option<CastHit>, TrajectoryError> {
    let Some(pair) = operands(context) else {
        return Ok(None);
    };
    let k = pair.carrier;
    Kernel::from_native(k.native, k.domain)?;
    if !context.start.is_finite()
        || !context.end.is_finite()
        || context.start.is_sign_negative()
        || context.start < k.domain.start
        || context.end > k.domain.end
        || context.end <= context.start
        || !context.clearance.is_finite()
        || context.clearance < 0.
        || !time_tolerance.is_finite()
        || time_tolerance <= 0.
    {
        return Ok(None);
    }
    let mut upper = context.end.min(k.domain.end.next_down());
    for _ in 0..MAX_SEARCH_STEPS {
        work.charge(64)?;
        if admitted_tilt(k, upper).is_some() {
            break;
        }
        upper = context.start + (upper - context.start) * 0.5;
    }
    if upper <= context.start || admitted_tilt(k, upper).is_none() {
        return Ok(None);
    }
    let mut safe = context.start;
    let mut limit = upper;
    for _ in 0..MAX_SEARCH_STEPS {
        work.charge(64)?;
        let middle = safe + (limit - safe) * 0.5;
        if middle <= safe || middle >= limit || limit - safe <= time_tolerance / 64. {
            break;
        }
        let prefix = Context {
            start: safe,
            end: middle,
            ..context
        };
        if separated(prefix, work)? {
            safe = middle;
        } else {
            limit = middle;
        }
    }
    if safe <= context.start {
        return Ok(None);
    }
    let mut end = upper.min(safe + time_tolerance);
    if end - safe > time_tolerance {
        end = end.next_down();
    }
    let translation = |key| k.position_at_time(Time::from_bits(key)).translation.y;
    let mut cursor = safe.next_up().to_bits();
    for _ in 0..MAX_PHASES {
        let last = end.to_bits();
        if cursor > last {
            break;
        }
        work.charge(512)?;
        let first_value = translation(cursor);
        let mut edge = last;
        if first_value != translation(last) {
            let (mut low, mut high) = (cursor + 1, last);
            while low < high {
                work.charge(128)?;
                let middle = low + (high - low) / 2;
                if translation(middle) == first_value {
                    low = middle + 1;
                } else {
                    high = middle;
                }
            }
            edge = low - 1;
        }
        let at = Time::from_bits(edge);
        if let Some(contact) = strict_at(context, &pair, at, work)? {
            return Ok(Some(CastHit {
                safe_time: safe,
                hit_time: at,
                contact,
                subshape_a: 0,
                subshape_b: 0,
            }));
        }
        cursor = edge + 1;
    }
    Ok(None)
}
