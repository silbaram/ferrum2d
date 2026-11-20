//! Complete reachable original F32 state tuples driven by the same F64 time.
//! The representatives label full rounding cells, never sampled no-hit times.
use super::*;
use crate::physics3d::solver_trajectory::{CastHit, IntervalCertificate, Kernel};

// This bounds this optional proof attempt only. A larger image keeps every
// original shape/query route; it is neither a collision nor an unsupported case.
const MAX_STATES: u64 = 256;
const KEY: usize = 11;
#[derive(Clone, Copy, PartialEq, Eq)]
struct State([[u32; KEY]; 2]);
#[derive(Clone, Copy)]
struct Model {
    curve: Curve,
    compressed: bool,
    translation_only: bool,
    ignore_translation_z: bool,
}
fn order32(x: f32) -> u32 {
    let bits = x.to_bits();
    if bits >> 31 == 0 {
        bits ^ (1 << 31)
    } else {
        !bits
    }
}
fn order64(x: Time) -> u64 {
    let bits = x.to_bits();
    if bits >> 63 == 0 {
        bits ^ (1 << 63)
    } else {
        !bits
    }
}
fn time(bits: u64) -> Time {
    Time::from_bits(if bits >> 63 == 0 {
        !bits
    } else {
        bits ^ (1 << 63)
    })
}
fn changes(a: f32, b: f32) -> Result<u64, TrajectoryError> {
    if !a.is_finite() || !b.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    Ok(u64::from(order32(a).abs_diff(order32(b))))
}
fn one_direction(values: [f64; 3]) -> bool {
    values.iter().all(|v| *v >= 0.) || values.iter().all(|v| *v <= 0.)
}
fn monotone_raw(k: Kernel) -> bool {
    let [x, y, z, w] = k.native.motion.start.rotation.to_array().map(f64::from);
    let [a, b, c] = k.native.angular_velocity.to_array().map(f64::from);
    // Signs only, never coefficients used to reconstruct a Native value.
    // Widened F32 products cannot underflow/overflow F64. Each original raw
    // quaternion coordinate is monotone if all of its variable terms agree.
    [
        [a * w, b * z, -c * y],
        [-a * z, b * w, c * x],
        [a * y, -b * x, c * w],
        [-a * x, -b * y, -c * z],
    ]
    .into_iter()
    .all(one_direction)
}
fn raw(k: Kernel, dt: f32) -> [f32; 7] {
    // Same scalar-math vector product and original Quat multiplication as
    // integrate_linearized. No coefficient expansion, FMA, normalization
    // replacement or alternate pose is evaluated here.
    let half = k.native.angular_velocity * (dt * 0.5);
    let q = rp::Rotation::from_xyzw(half.x, half.y, half.z, 1.) * k.native.motion.start.rotation;
    let p = k.native.motion.start.translation + k.native.linear_velocity * dt;
    [p.x, p.y, p.z, q.x, q.y, q.z, q.w]
}
impl Model {
    fn new(curve: Curve, start: Time, end: Time) -> Result<Self, TrajectoryError> {
        let (from, to) = curve.times();
        if !from.is_finite() || !to.is_finite() || from > to || start < from || end > to {
            return Err(TrajectoryError::InvalidTime);
        }
        let compressed = match curve {
            Curve::Integrated(k) | Curve::Anchored { carrier: k, .. } => {
                Kernel::from_native(k.native, k.domain)?;
                monotone_raw(k)
            }
            Curve::Constant { pose, .. } => {
                if !pose.is_finite() {
                    return Err(TrajectoryError::NonFinite);
                }
                false
            }
            Curve::Ccd { .. } => {
                if to <= from || !(to - from).is_finite() {
                    return Err(TrajectoryError::InvalidTime);
                }
                false
            }
        };
        let curve = if let Some(pose) = super::super::constant_pose(curve) {
            Curve::Constant {
                pose,
                start_time: from,
                end_time: to,
            }
        } else {
            curve
        };
        let translation_only = matches!(curve, Curve::Integrated(k)
            if k.native.angular_velocity.to_array().map(f32::to_bits) == [0; 3]);
        Ok(Self {
            curve,
            compressed,
            translation_only,
            ignore_translation_z: false,
        })
    }
    fn kernel(self) -> Option<Kernel> {
        match self.curve {
            Curve::Integrated(k) | Curve::Anchored { carrier: k, .. } => Some(k),
            Curve::Constant { .. } | Curve::Ccd { .. } => None,
        }
    }
    fn relative(self, at: Time) -> Option<[f32; 3]> {
        let Curve::Anchored {
            carrier,
            linear_velocity,
            ..
        } = self.curve
        else {
            return None;
        };
        let dt = (at - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
        Some((linear_velocity * dt).to_array())
    }
    fn raw_key(self, k: Kernel, dt: f32) -> [f32; 7] {
        if self.translation_only {
            // The raw rotation has identical bits at every nonnegative
            // physical input. It cannot change the interior time key.
            let p = k.native.motion.start.translation + k.native.linear_velocity * dt;
            [
                p.x,
                p.y,
                if self.ignore_translation_z { 0. } else { p.z },
                0.,
                0.,
                0.,
                0.,
            ]
        } else {
            raw(k, dt)
        }
    }
    fn metered_key(self, at: Time, work: &mut Work) -> Result<[u32; KEY], TrajectoryError> {
        // Charge only the original operations evaluated by this key. A fixed
        // rotation skips its quaternion graph and an invariant pose has no clock.
        let cost = if matches!(self.curve, Curve::Constant { .. }) {
            8
        } else if self.translation_only {
            32
        } else {
            64
        };
        work.charge(cost)?;
        self.key(at)
    }
    fn key(self, at: Time) -> Result<[u32; KEY], TrajectoryError> {
        let mut result = [0; KEY];
        if let Some(k) = self.kernel() {
            let dt = k.local_delta(at);
            if !dt.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            // Both logical-time and Native physical-dt endpoint branches
            // retain their original stored poses, independently of raw q.
            if at <= k.domain.start || dt <= 0. {
                result[0] = 0;
            } else if at >= k.domain.end || dt >= k.native.integration_seconds {
                result[0] = 2;
            } else {
                result[0] = 1;
                if self.compressed {
                    let values = self.raw_key(k, dt);
                    if values.iter().any(|v| !v.is_finite()) {
                        return Err(TrajectoryError::NonFinite);
                    }
                    for (slot, value) in result[1..8].iter_mut().zip(values) {
                        *slot = value.to_bits();
                    }
                } else {
                    // Opposite-sign terms may cancel/wobble after rounding.
                    // The original monotone physical-dt input is still lossless.
                    result[1] = dt.to_bits();
                }
            }
        } else if let Curve::Ccd {
            start_time,
            end_time,
            ..
        } = self.curve
        {
            let t = ((at - start_time) / (end_time - start_time)).clamp(0., 1.) as f32;
            if !t.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            result[0] = t.to_bits();
        }
        if let Some(relative) = self.relative(at) {
            if relative.iter().any(|v| !v.is_finite()) {
                return Err(TrajectoryError::NonFinite);
            }
            for (slot, value) in result[8..].iter_mut().zip(relative) {
                *slot = value.to_bits();
            }
        }
        Ok(result)
    }
    fn change_bound(self, start: Time, end: Time) -> Result<u64, TrajectoryError> {
        let mut count = 0u64;
        if let Some(k) = self.kernel() {
            // Count every possible interior output plus two stored-branch
            // transitions. Interior extrema need not themselves be reachable;
            // a larger census only declines this optional proof sooner.
            let lo = k.local_delta(start).max(f32::from_bits(1));
            let hi = k
                .local_delta(end)
                .min(k.native.integration_seconds.next_down());
            count = 2;
            if lo <= hi {
                let input_changes = changes(lo, hi)?;
                if self.compressed {
                    let mut output_changes = 0;
                    for (a, b) in self.raw_key(k, lo).into_iter().zip(self.raw_key(k, hi)) {
                        output_changes += changes(a, b)?;
                    }
                    // One represented physical-dt input has exactly one raw
                    // output tuple. Near zero a single input increment may
                    // jump many output ULPs; neither bound requires filling
                    // those unattained output values with fictitious states.
                    count += output_changes.min(input_changes);
                } else {
                    count += input_changes;
                }
            }
        } else if let Curve::Ccd {
            start_time,
            end_time,
            ..
        } = self.curve
        {
            let input = |t: Time| ((t - start_time) / (end_time - start_time)).clamp(0., 1.) as f32;
            count += changes(input(start), input(end))?;
        }
        if let (Some(a), Some(b)) = (self.relative(start), self.relative(end)) {
            let mut output_changes = 0;
            for (a, b) in a.into_iter().zip(b) {
                output_changes += changes(a, b)?;
            }
            let Curve::Anchored { carrier, .. } = self.curve else {
                return Err(TrajectoryError::InvalidReference);
            };
            let input =
                |t: Time| (t - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
            count += output_changes.min(changes(input(start), input(end))?);
        }
        Ok(count)
    }
}
fn state(a: Model, b: Model, at: Time, work: &mut Work) -> Result<State, TrajectoryError> {
    Ok(State([a.metered_key(at, work)?, b.metered_key(at, work)?]))
}
fn visit(
    a: Curve,
    b: Curve,
    start: Time,
    end: Time,
    work: &mut Work,
    accept: impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<bool, TrajectoryError> {
    if !start.is_finite() || !end.is_finite() || start > end || !(end - start).is_finite() {
        return Err(TrajectoryError::InvalidTime);
    }
    work.charge(1024)?;
    let (a, b) = (Model::new(a, start, end)?, Model::new(b, start, end)?);
    visit_models(a, b, start, end, work, accept)
}

fn visit_models(
    a: Model,
    b: Model,
    start: Time,
    end: Time,
    work: &mut Work,
    mut accept: impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<bool, TrajectoryError> {
    if 1 + a.change_bound(start, end)? + b.change_bound(start, end)? > MAX_STATES {
        return Ok(false);
    }
    let (mut current, until) = (
        order64(start).min(order64(end)),
        order64(start).max(order64(end)),
    );
    let mut key = state(a, b, time(current), work)?;
    let last = state(a, b, time(until), work)?;
    for _ in 0..MAX_STATES {
        // Every accepted representative owns a complete same-state time
        // cell. If a callback fails, no prefix is reported as the whole proof.
        if !accept(time(current), work)? {
            return Ok(false);
        }
        if key == last {
            return Ok(true);
        }
        let (mut low, mut high) = (current + 1, until);
        // Same-key is a prefix: branch tags never return, and within a
        // branch every included coordinate has one proven monotone direction.
        while low < high {
            let middle = low + (high - low) / 2;
            let at = time(middle);
            if a.metered_key(at, work)? == key.0[0] && b.metered_key(at, work)? == key.0[1] {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        current = low;
        key = state(a, b, time(current), work)?;
    }
    // Guard exhaustion is never a collision or partial successful proof.
    Ok(false)
}
fn same_pose(a: rp::Pose, b: rp::Pose) -> bool {
    a.translation.to_array().map(f32::to_bits) == b.translation.to_array().map(f32::to_bits)
        && a.rotation.to_array().map(f32::to_bits) == b.rotation.to_array().map(f32::to_bits)
}
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn separated(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    certificate(a, sa, b, sb, start, end, clearance, work)
        .map(|proof| matches!(proof, IntervalCertificate::Separated))
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn certificate(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<IntervalCertificate, TrajectoryError> {
    if !clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let mut previous = None;
    let mut found = None;
    let complete = visit(a.curve, b.curve, start, end, work, |at, work| {
        work.charge(256)?;
        let pair = (a.pose(at), b.pose(at));
        if !pair.0.is_finite() || !pair.1.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if previous.is_some_and(|old: (rp::Pose, rp::Pose)| {
            same_pose(old.0, pair.0) && same_pose(old.1, pair.1)
        }) {
            return Ok(true);
        }
        let contact = super::super::leaf_contact(&pair.0, sa, &pair.1, sb, work)?;
        if !contact.dist.is_finite()
            || !contact.point1.is_finite()
            || !contact.point2.is_finite()
            || !contact.normal1.is_finite()
        {
            return Err(TrajectoryError::NonFinite);
        }
        if contact.dist <= clearance {
            // A first-state contact gives no newly proved prefix and cannot
            // bypass the original outgoing/initial-contact policy. Otherwise
            // every earlier cell was queried clear and the predecessor is
            // the last representable Time in that certified prefix.
            if previous.is_some() && at > start {
                found = Some(CastHit {
                    safe_time: time(order64(at) - 1),
                    hit_time: at,
                    contact,
                    subshape_a: 0,
                    subshape_b: 0,
                });
            }
            return Ok(false);
        }
        if !super::native_clear_static_eligible(
            &pair.0,
            sa,
            &pair.1,
            sb,
            contact.normal1,
            clearance,
            work,
        )? {
            // The original Native/complete world-clear successes above retain
            // their priority and prices. This is one ACTUAL reachable time,
            // not a Cartesian output pose or a lower-support nomination.
            // A strict world contact may close the already proved prefix;
            // absence cannot establish NoHit or bypass the initial policy.
            let box_capsule = (sa.as_cuboid().is_some() && sb.as_capsule().is_some())
                || (sb.as_cuboid().is_some() && sa.as_capsule().is_some());
            if box_capsule && previous.is_some() && at > start {
                if let Some(observer) = super::super::world_contact::Pair::new(sa, sb, work)? {
                    if let Some(witness) =
                        observer.normal_axis_poses(&pair.0, &pair.1, clearance, work)?
                    {
                        if witness.strict {
                            found = Some(CastHit {
                                safe_time: time(order64(at) - 1),
                                hit_time: at,
                                contact: witness.contact,
                                subshape_a: 0,
                                subshape_b: 0,
                            });
                        }
                    }
                }
            }
            return Ok(false);
        }
        previous = Some(pair);
        Ok(true)
    })?;
    Ok(if complete {
        IntervalCertificate::Separated
    } else if let Some(hit) = found {
        IntervalCertificate::Hit(hit)
    } else {
        IntervalCertificate::Unproven
    })
}

/// Visit the complete original raw pose image of a bounded time interval.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn planar_capsule_image(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    start_proved: bool,
    work: &mut Work,
) -> Result<IntervalCertificate, TrajectoryError> {
    use super::output::{planar_capsule_cell, PlanarCell};
    let (cube, cap, half, capsule, flipped) =
        if let (Some(box_shape), Some(cap_shape)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, b, box_shape.half_extents, cap_shape, false)
        } else if let (Some(cap_shape), Some(box_shape)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, a, box_shape.half_extents, cap_shape, true)
        } else {
            return Ok(IntervalCertificate::Unproven);
        };
    if !super::upright_capsule_motion(cap)
        || !matches!(cube.curve, Curve::Integrated(k) if k.native.linear_velocity == rp::Vector::ZERO)
            && super::super::constant_pose(cube.curve).is_none()
    {
        return Ok(IntervalCertificate::Unproven);
    }
    let mut hit = None;
    let mut previous = None;
    let complete = visit(a.curve, b.curve, start, end, work, |at, work| {
        work.charge(256)?;
        let pose = cube.pose(at);
        let target = cap.pose(at);
        if (start_proved && at == start)
            || previous.is_some_and(|(old_cube, old_cap)| {
                same_pose(old_cube, pose) && same_pose(old_cap, target)
            })
        {
            previous = Some((pose, target));
            return Ok(true);
        }
        let (pa, pb) = if flipped {
            (target, pose)
        } else {
            (pose, target)
        };
        let native = super::super::leaf_contact(&pa, sa, &pb, sb, work)?;
        let result = planar_capsule_cell(pose, half, target, capsule, clearance, work)?;
        match result {
            PlanarCell::Separated if native.dist > clearance => {
                previous = Some((pose, target));
                Ok(true)
            }
            PlanarCell::Hit(contact) => {
                let contact = if native.dist <= clearance {
                    native
                } else if flipped {
                    contact.flipped()
                } else {
                    contact
                };
                hit = Some(CastHit {
                    safe_time: if at == start {
                        start
                    } else {
                        time(order64(at) - 1)
                    },
                    hit_time: at,
                    contact,
                    subshape_a: 0,
                    subshape_b: 0,
                });
                Ok(false)
            }
            _ => Ok(false),
        }
    })?;
    Ok(if complete {
        IntervalCertificate::Separated
    } else if let Some(hit) = hit {
        IntervalCertificate::Hit(hit)
    } else {
        IntervalCertificate::Unproven
    })
}

/// Only the box's original raw phases can change a verified co-rotating
/// pair's full XY output. The carrier client checks all independent Z inputs.
#[allow(clippy::too_many_arguments)]
pub(super) fn projected_capsule_prefix(
    cube: ShapeMotion,
    half: rp::Vector,
    cap: ShapeMotion,
    capsule: &rp::Capsule,
    start: Time,
    end: Time,
    clearance: f32,
    flipped: bool,
    work: &mut Work,
) -> Result<IntervalCertificate, TrajectoryError> {
    use super::output::{initial_capsule_cell, PlanarCell};
    work.charge(1024)?;
    let a = Model::new(cube.curve, start, end)?;
    let b = if matches!(cap.curve, Curve::Anchored { anchor, .. } if anchor != rp::Vector::ZERO) {
        Model::new(
            Curve::Constant {
                pose: rp::Pose::IDENTITY,
                start_time: start,
                end_time: end,
            },
            start,
            end,
        )?
    } else {
        let mut model = Model::new(cap.curve, start, end)?;
        // The admitted zero anchor has no rotation or relative contribution.
        // Its own carrier's rounded XY translations can still change.
        if matches!(cap.curve, Curve::Anchored { anchor, .. } if anchor == rp::Vector::ZERO) {
            model.translation_only = true;
        }
        if !(model.translation_only && model.compressed) {
            return Ok(IntervalCertificate::Unproven);
        }
        model.ignore_translation_z = true;
        model
    };
    let mut hit = None;
    let complete = visit_models(a, b, start, end, work, |at, work| {
        work.charge(256)?;
        let a = cube.pose(at);
        let b = cap.pose(at);
        match initial_capsule_cell(a, half, b, capsule, clearance, work)? {
            PlanarCell::Separated => Ok(true),
            PlanarCell::Hit(contact) => {
                hit = Some(CastHit {
                    safe_time: if at == start {
                        start
                    } else {
                        time(order64(at) - 1)
                    },
                    hit_time: at,
                    contact: if flipped { contact.flipped() } else { contact },
                    subshape_a: 0,
                    subshape_b: 0,
                });
                Ok(false)
            }
            PlanarCell::Unknown => Ok(false),
        }
    })?;
    Ok(if complete {
        IntervalCertificate::Separated
    } else if let Some(hit) = hit {
        IntervalCertificate::Hit(hit)
    } else {
        IntervalCertificate::Unproven
    })
}

#[cfg(test)]
mod tests;
