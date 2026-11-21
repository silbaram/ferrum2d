//! Geometry proposals only. No contact impulse, support or momentum is inferred
//! from an alternative evaluation frame. The caller stages the old safe prefix
//! first and subjects every proposed suffix to the ordinary full-shape scene.
use super::*;

mod angular_rate;
mod finite_phase;
mod full_future;
mod ground_rate;
mod normal_witness;
mod self_reference;

/// A geometric proposal has its own measured rate. It never substitutes for
/// Participant velocity, impulse or the immutable controller momentum ledger.
#[derive(Clone, Copy)]
pub(super) struct Proposal {
    pub curve: Curve,
    pub rate: rp::Vector,
}

fn same_pose(a: rp::Pose, b: rp::Pose) -> bool {
    a.translation.to_array().map(f32::to_bits) == b.translation.to_array().map(f32::to_bits)
        && a.rotation.to_array().map(f32::to_bits) == b.rotation.to_array().map(f32::to_bits)
}

pub(super) fn same_kernel(a: Kernel, b: Kernel) -> bool {
    a.domain.start == b.domain.start
        && a.domain.end == b.domain.end
        && a.native.motion.body == b.native.motion.body
        && a.native.motion.start_time.to_bits() == b.native.motion.start_time.to_bits()
        && a.native.motion.end_time.to_bits() == b.native.motion.end_time.to_bits()
        && same_pose(a.native.motion.start, b.native.motion.start)
        && same_pose(a.native.motion.end, b.native.motion.end)
        && a.native.integration_seconds.to_bits() == b.native.integration_seconds.to_bits()
        && a.native.linear_velocity == b.native.linear_velocity
        && a.native.angular_velocity == b.native.angular_velocity
}

fn same_reference(a: Curve, b: Curve) -> bool {
    match (a, b) {
        (
            Curve::Anchored {
                carrier: ca,
                anchor: aa,
                offset: oa,
                linear_velocity: va,
                rotation: ra,
            },
            Curve::Anchored {
                carrier: cb,
                anchor: ab,
                offset: ob,
                linear_velocity: vb,
                rotation: rb,
            },
        ) => {
            same_kernel(ca, cb)
                && aa == ab
                && oa == ob
                && va == vb
                && ra.to_array().map(f32::to_bits) == rb.to_array().map(f32::to_bits)
        }
        _ => false,
    }
}

/// A nonzero side reference is only a constant inverse-fitting parameter.
/// For zero angular velocity every positive interior physical dt computes the
/// same signed-zero identity product and normalization in the original Native
/// kernel. Compare that one interior branch and both stored endpoint actions;
/// this is a finite branch proof, not sampled angular-motion certification.
fn constant_reference_action(
    carrier: Kernel,
    anchor: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(1)?;
    if anchor == rp::Vector::ZERO {
        return Ok(true);
    }
    work.charge(256)?;
    if carrier.native.angular_velocity != rp::Vector::ZERO {
        return Ok(false);
    }
    let action = carrier.native.motion.start.rotation * anchor;
    let same = |v: rp::Vector| -> Result<bool, TrajectoryError> {
        if !v.is_finite() || !action.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(v.to_array().map(f32::to_bits) == action.to_array().map(f32::to_bits))
    };
    if !same(carrier.native.motion.end.rotation * anchor)? {
        return Ok(false);
    }
    let dt = carrier.native.integration_seconds.next_down();
    if dt > 0. && !same(carrier.native.position_at_integration_time(dt).rotation * anchor)? {
        return Ok(false);
    }
    Ok(true)
}

fn neighbors(value: f32) -> [f32; 3] {
    [value, value.next_up(), value.next_down()]
}

/// A real support may change its geometry phase on a coordinate normal
/// without changing any tangent term of the original scalar quaternion action.
/// Both stored endpoints and every integrated interior must keep the same
/// quaternion/omega axis. This is not permission for an angular SideRef.
fn coordinate_normal_axis(normal: rp::Vector) -> Option<usize> {
    let mut axis = None;
    for i in 0..3 {
        if normal[i] != 0. {
            if axis.is_some() {
                return None;
            }
            axis = Some(i);
        }
    }
    axis
}

pub(super) fn normal_phase_axis(
    carrier: Kernel,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<usize>, TrajectoryError> {
    work.charge(128)?;
    if !normal.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let mut axis = None;
    for i in 0..3 {
        if normal[i] != 0. {
            if axis.is_some() {
                return Ok(None);
            }
            axis = Some(i);
        }
    }
    let Some(axis) = axis else { return Ok(None) };
    let omega = carrier.native.angular_velocity;
    let start = carrier.native.motion.start.rotation.to_array();
    let end = carrier.native.motion.end.rotation.to_array();
    // Original normalized-Euler multiplication of same-axis quaternions keeps
    // perpendicular components numerically zero. Normalization only rescales
    // those components. In Quat*Vector, changing anchor[axis] then affects only
    // that output coordinate, even when the norm is not bit-exactly one.
    if (0..3).any(|i| i != axis && (omega[i] != 0. || start[i] != 0. || end[i] != 0.)) {
        return Ok(None);
    }
    Ok(Some(axis))
}

/// All bounded adjacent inverse cells for one original F32 add chain. The
/// values are candidates only; safe bits, rows and full geometry still decide.
fn offset_cells(base: f32, relative: f32, target: f32) -> [Option<f32>; 9] {
    let mut result = [None; 9];
    let mut count = 0;
    for before in neighbors(target - relative) {
        for value in neighbors(before - base) {
            if value.is_finite()
                && (base + value + relative).to_bits() == target.to_bits()
                && !result[..count]
                    .iter()
                    .flatten()
                    .any(|v: &f32| v.to_bits() == value.to_bits())
            {
                result[count] = Some(value);
                count += 1;
            }
        }
    }
    result
}

fn outward_offset(
    base: f32,
    relative: f32,
    target: f32,
    seed: f32,
    sign: f32,
    work: &mut Work,
) -> Result<f32, TrajectoryError> {
    let ordered = |v: f32| {
        let bits = v.to_bits();
        if v.is_sign_negative() {
            !bits
        } else {
            bits ^ 0x8000_0000
        }
    };
    let value = |key: u32| {
        f32::from_bits(if key >> 31 == 0 {
            !key
        } else {
            key ^ 0x8000_0000
        })
    };
    let mut low = ordered(seed * sign);
    let mut high = ordered(f32::MAX);
    // A small offset can have many representations in the same world
    // coordinate cell. The two rounded additions remain monotone.
    while low < high {
        work.charge(24)?;
        let middle = low + (high - low).div_ceil(2);
        let offset = value(middle) * sign;
        if (base + offset + relative).to_bits() == target.to_bits() {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    Ok(value(low) * sign)
}

/// Fit the original F32 expression `(base + offset) + relative_dt` at exactly
/// one admitted pose. Neighbors are the adjacent rounding cells of each inverse
/// operation, not an expanded geometric tolerance. Failure leaves the old path.
pub(super) fn fit_offset(
    base: rp::Vector,
    relative_dt: rp::Vector,
    target: rp::Vector,
) -> Option<rp::Vector> {
    let mut output = rp::Vector::ZERO;
    for axis in 0..3 {
        let mut fitted = None;
        for before_relative in neighbors(target[axis] - relative_dt[axis]) {
            for offset in neighbors(before_relative - base[axis]) {
                if offset.is_finite()
                    && ((base[axis] + offset) + relative_dt[axis]).to_bits()
                        == target[axis].to_bits()
                {
                    fitted = Some(offset);
                    break;
                }
            }
            if fitted.is_some() {
                break;
            }
        }
        output[axis] = fitted?;
    }
    Some(output)
}

/// Preserve the geometry solver's actual total velocity, including F32 addition
/// order in ShapeMotion. A cancellation that has no exact inverse is rejected.
fn fit_relative(base: rp::Vector, target: rp::Vector) -> Option<rp::Vector> {
    let mut output = rp::Vector::ZERO;
    for axis in 0..3 {
        output[axis] = neighbors(target[axis] - base[axis])
            .into_iter()
            .find(|relative| {
                relative.is_finite() && (base[axis] + relative).to_bits() == target[axis].to_bits()
            })?;
    }
    Some(output)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn gap(
    actor: ColliderTrajectory,
    actor_curve: Curve,
    other: ColliderTrajectory,
    other_curve: Curve,
    colliders: &rp::ColliderSet,
    time: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    work.charge(8)?;
    let a = colliders
        .get(actor.collider)
        .ok_or(TrajectoryError::InvalidReference)?;
    let b = colliders
        .get(other.collider)
        .ok_or(TrajectoryError::InvalidReference)?;
    // A measurement radius from the original complete shape bounds. It does
    // not replace the pair's clearance or approve a point as a whole interval.
    let distance = a.shape().compute_local_bounding_sphere().radius
        + b.shape().compute_local_bounding_sphere().radius
        + clearance;
    if !distance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let mut value: Option<f32> = None;
    crate::physics3d::solver_trajectory::contacts_full_shapes_measured(
        crate::physics3d::solver_trajectory::ShapeMotion {
            curve: actor_curve,
            ..actor.motion
        },
        a.shape(),
        crate::physics3d::solver_trajectory::ShapeMotion {
            curve: other_curve,
            ..other.motion
        },
        b.shape(),
        time,
        distance,
        clearance,
        work,
        &mut |contact, _, _, work| {
            work.charge(5)?;
            if !contact.dist.is_finite()
                || !contact.normal1.is_finite()
                || !contact.point1.is_finite()
                || !contact.point2.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            value = Some(value.map_or(contact.dist, |old| old.min(contact.dist)));
            Ok(())
        },
    )?;
    Ok(value)
}

/// Translation-only correlation with an actual Native kernel. The zero local
/// anchor deliberately contributes no rotational carry. Its offset is fitted
/// at the admitted safe pose, while the Native kernel/domain/h remain intact.
fn translation_reference(
    carrier: Kernel,
    pose: rp::Pose,
    geometry: rp::Vector,
    time: Time,
) -> Option<Curve> {
    let relative = fit_relative(carrier.linear_velocity_at_time(), geometry)?;
    let relative_dt =
        relative * (time - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
    let offset = fit_offset(
        carrier.position_at_time(time).translation,
        relative_dt,
        pose.translation,
    )?;
    let curve = Curve::Anchored {
        carrier,
        anchor: rp::Vector::ZERO,
        offset,
        linear_velocity: relative,
        rotation: pose.rotation,
    };
    (same_pose(curve.com_pose(time), pose)
        && curve_velocity(curve, time).ok() == Some((geometry, rp::Vector::ZERO)))
    .then_some(curve)
}

// One immutable geometric clock value, never a support/live peer dependency.
// Matching displacement operations are proved explicitly, not inferred from
// equal logical velocities or from two endpoints' sampled agreement.
struct PeerClock {
    carrier: Kernel,
    safe: Time,
    safe_pose: rp::Pose,
    axis: usize,
    own_origin: f32,
    peer_origin: f32,
    own_range: [f32; 2],
    peer_range: [f32; 2],
}
impl PeerClock {
    fn new(
        own: Kernel,
        peer: Kernel,
        axis: usize,
        safe: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        work.charge(512)?;
        if !safe.is_finite() || !end.is_finite() || safe >= end {
            return Err(TrajectoryError::InvalidTime);
        }
        Kernel::from_native(own.native, own.domain)?;
        Kernel::from_native(peer.native, peer.domain)?;
        if axis >= 3
            || own.domain.start.to_bits() != peer.domain.start.to_bits()
            || own.domain.end.to_bits() != peer.domain.end.to_bits()
            || own.native.integration_seconds.to_bits() != peer.native.integration_seconds.to_bits()
            || own.native.motion.start_time.to_bits() != peer.native.motion.start_time.to_bits()
            || own.native.motion.end_time.to_bits() != peer.native.motion.end_time.to_bits()
            || own.native.linear_velocity.to_array().map(f32::to_bits)
                != peer.native.linear_velocity.to_array().map(f32::to_bits)
            || own.native.angular_velocity != rp::Vector::ZERO
            || peer.native.angular_velocity != rp::Vector::ZERO
            || safe < own.domain.start
            || end > own.domain.end
            || !((end - peer.domain.start).clamp(0., peer.domain.duration()) as f32).is_finite()
        {
            return Ok(None);
        }
        let identity = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
        for kernel in [own, peer] {
            if kernel
                .native
                .motion
                .start
                .rotation
                .to_array()
                .map(f32::to_bits)
                != identity
                || kernel
                    .native
                    .motion
                    .end
                    .rotation
                    .to_array()
                    .map(f32::to_bits)
                    != identity
            {
                return Ok(None);
            }
            let dt = kernel.native.integration_seconds.next_down();
            if dt > 0.
                && kernel
                    .native
                    .position_at_integration_time(dt)
                    .rotation
                    .to_array()
                    .map(f32::to_bits)
                    != identity
            {
                return Ok(None);
            }
            // Stored0/h are exhaustive separate branches. Only this exact
            // endpoint agreement makes the common original RN(v*dt) law valid
            // there too; no Native clamped endpoint is presumed affine.
            let expected = kernel.native.motion.start.translation
                + kernel.native.linear_velocity * kernel.native.integration_seconds;
            if !expected.is_finite()
                || expected.to_array().map(f32::to_bits)
                    != kernel
                        .native
                        .motion
                        .end
                        .translation
                        .to_array()
                        .map(f32::to_bits)
            {
                return Ok(None);
            }
        }
        for i in 0..3 {
            if i != axis
                && (own.native.motion.start.translation[i].to_bits()
                    != peer.native.motion.start.translation[i].to_bits()
                    || own.native.motion.end.translation[i].to_bits()
                        != peer.native.motion.end.translation[i].to_bits()
                    || own.native.motion.start.translation[i].to_bits() == 0x8000_0000
                    || own.native.motion.end.translation[i].to_bits() == 0x8000_0000
                    || own.native.linear_velocity[i].to_bits() == 0x8000_0000)
            {
                return Ok(None);
            }
        }
        // Identical tangent origins and original displacement operands prove
        // whole-time tangent bits. Excluding stored/raw -0 prevents the new
        // numerical +0 terms from changing an original signed-zero branch.
        let safe_pose = own.position_at_time(safe);
        let own_end = own.position_at_time(end);
        let peer_safe = peer.position_at_time(safe);
        let peer_end = peer.position_at_time(end);
        if [safe_pose, own_end, peer_safe, peer_end]
            .iter()
            .any(|pose| !pose.is_finite())
        {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(Some(Self {
            carrier: peer,
            safe,
            safe_pose,
            axis,
            own_origin: own.native.motion.start.translation[axis],
            peer_origin: peer.native.motion.start.translation[axis],
            own_range: [safe_pose.translation[axis], own_end.translation[axis]],
            peer_range: [peer_safe.translation[axis], peer_end.translation[axis]],
        }))
    }

    fn candidate(
        &self,
        offset: f32,
        skin: f32,
        work: &mut Work,
    ) -> Result<Option<Curve>, TrajectoryError> {
        work.charge(1280)?;
        if !offset.is_finite() || !skin.is_finite() || skin < 0. {
            return Ok(None);
        }
        let new_range = self.peer_range.map(|v| v + offset);
        let Some(own_error) = ground_rate::CorrectionRange::half_ulp(self.own_range) else {
            return Ok(None);
        };
        let Some(peer_error) = ground_rate::CorrectionRange::half_ulp(self.peer_range) else {
            return Ok(None);
        };
        let Some(add_error) = ground_rate::CorrectionRange::half_ulp(new_range) else {
            return Ok(None);
        };
        // Both independent Native calls execute exactly the same represented
        // P(t). Cancel that common operand, not two independent moving COM
        // envelopes: new-old=(peerT0+offset-ownT0)+ePeer+eAdd-eOwn.
        let low = ((f64::from(self.peer_origin) + f64::from(offset)).next_down()
            - f64::from(self.own_origin))
        .next_down();
        let high = ((f64::from(self.peer_origin) + f64::from(offset)).next_up()
            - f64::from(self.own_origin))
        .next_up();
        let error = ground_rate::CorrectionRange::up_add(
            own_error,
            ground_rate::CorrectionRange::up_add(peer_error, add_error),
        );
        let bound = ground_rate::CorrectionRange::up_add(low.abs().max(high.abs()), error);
        if !bound.is_finite() || bound > f64::from(skin) {
            return Ok(None);
        }
        let mut values = rp::Vector::ZERO;
        values[self.axis] = offset;
        let candidate = Curve::Anchored {
            carrier: self.carrier,
            anchor: rp::Vector::ZERO,
            offset: values,
            linear_velocity: rp::Vector::ZERO,
            rotation: self.safe_pose.rotation,
        };
        Ok(same_pose(candidate.com_pose(self.safe), self.safe_pose).then_some(candidate))
    }
}

impl BackendMotionScratch {
    /// Evaluate a bounded Cartesian set of the adjacent rounding cells of the
    /// original velocity inverse. The actual Curve derivative, not a carry
    /// recomposition or a physical participant, supplies the geometric rate.
    #[allow(clippy::too_many_arguments)]
    fn reference_proposal(
        &self,
        index: usize,
        carrier: Kernel,
        anchor: rp::Vector,
        old: Curve,
        target: rp::Vector,
        safe: Time,
        rate_time: Time,
        allow_rate_change: bool,
        locked: rp::Vector,
        normal: rp::Vector,
        work: &mut Work,
        accept: &mut impl FnMut(Proposal, &mut Work) -> Result<bool, TrajectoryError>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        self.reference_proposal_core(
            index,
            carrier,
            anchor,
            old,
            target,
            safe,
            rate_time,
            allow_rate_change,
            locked,
            normal,
            false,
            work,
            accept,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn reference_proposal_core(
        &self,
        index: usize,
        carrier: Kernel,
        anchor: rp::Vector,
        old: Curve,
        target: rp::Vector,
        safe: Time,
        rate_time: Time,
        allow_rate_change: bool,
        locked: rp::Vector,
        normal: rp::Vector,
        own_offsets: bool,
        work: &mut Work,
        accept: &mut impl FnMut(Proposal, &mut Work) -> Result<bool, TrajectoryError>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        // Normal feasibility/nonpenetration cannot authorize new tangent
        // transport. Nonzero side anchors must have constant actual rotational
        // action, including stored-vs-normalized zero-omega branches.
        if !constant_reference_action(carrier, anchor, work)? {
            return Ok(None);
        }
        // The first relative cell pays for the fixed preparation and its
        // first offset slot, even if the center is nonfinite or fitting fails.
        work.charge(1024)?;
        let pose = old.com_pose(safe);
        let at = carrier.position_at_time(rate_time);
        let angular = carrier
            .angular_velocity_at_time(rate_time)
            .cross(at.rotation * anchor);
        let center = (target - angular) - carrier.linear_velocity_at_time();
        if !center.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if !own_offsets
            && target == rp::Vector::ZERO
            && center == rp::Vector::ZERO
            && carrier.domain.duration() <= 0.5
            && pose
                .translation
                .to_array()
                .into_iter()
                .all(|v| v.to_bits() != (-0.0_f32).to_bits())
        {
            work.charge(512)?;
            if solver_trajectory::constant_pose(old).is_some()
                && solver_trajectory::constant_pose(Curve::Integrated(carrier)).is_some()
            {
                // Exact stationary kernels plus subnormal neighboring rates
                // can yield only the same fitted pose throughout the original
                // interval. A new descriptor alone cannot improve this hit.
                return Ok(None);
            }
        }
        let mut cell_count = [3; 3];
        if !own_offsets
            && carrier.native.angular_velocity == rp::Vector::ZERO
            && carrier.native.motion.start.rotation == rp::Rotation::IDENTITY
            && carrier.native.motion.end.rotation == rp::Rotation::IDENTITY
            && carrier.domain.duration() <= 0.5
            && carrier
                .linear_velocity_at_time()
                .to_array()
                .map(f32::to_bits)
                == target.to_array().map(f32::to_bits)
        {
            if let Some(axis) = coordinate_normal_axis(normal) {
                let tangent_static = target[axis] != 0.
                    && (0..3).filter(|&i| i != axis).all(|i| {
                        target[i].to_bits() == 0
                            && center[i].to_bits() == 0
                            && pose.translation[i].to_bits() != (-0.0_f32).to_bits()
                            && carrier.native.motion.start.translation[i].to_bits()
                                != (-0.0_f32).to_bits()
                            && carrier.native.motion.start.translation[i].to_bits()
                                == carrier.native.motion.end.translation[i].to_bits()
                    });
                if tangent_static {
                    work.charge(64 + self.character_rows.len() as u64 * 8)?;
                    let body = self.participants[index].body;
                    if let Ok(slot) = self.character_values.binary_search_by_key(&body, |v| v.0) {
                        if self.character_rows.iter().all(|row| {
                            (row.a != slot && row.b != Some(slot))
                                || coordinate_normal_axis(row.normal) == Some(axis)
                        }) {
                            // Neighboring zero tangential rates are subnormal.
                            // Across this original duration their products
                            // round to signed zero. Static tangent coordinates
                            // and cardinal rows leave the same fitting cells
                            // as the first zero-tangent candidate.
                            for (i, count) in cell_count.iter_mut().enumerate() {
                                if i != axis {
                                    *count = 1;
                                }
                            }
                        }
                    }
                }
            }
        }
        let mut first_relative = true;
        for &x in &neighbors(center.x)[..cell_count[0]] {
            for &y in &neighbors(center.y)[..cell_count[1]] {
                for &z in &neighbors(center.z)[..cell_count[2]] {
                    if first_relative {
                        first_relative = false;
                    } else {
                        work.charge(1024)?;
                    }
                    let relative = rp::Vector::new(x, y, z);
                    if !relative.is_finite() {
                        continue;
                    }
                    let base = carrier.position_at_time(safe);
                    let relative_dt = relative
                        * (safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
                    let Some(offset) = fit_offset(
                        base.translation + base.rotation * anchor,
                        relative_dt,
                        pose.translation,
                    ) else {
                        continue;
                    };
                    let offsets = if own_offsets {
                        self_reference::offsets(
                            base.translation + base.rotation * anchor,
                            relative_dt,
                            pose.translation,
                            offset,
                        )
                    } else {
                        // Keep the original external donor's ten slots/order.
                        let mut values = [None; 28];
                        values[0] = Some(offset);
                        if let Some(axis) = coordinate_normal_axis(normal) {
                            for (slot, value) in offset_cells(
                                (base.translation + base.rotation * anchor)[axis],
                                relative_dt[axis],
                                pose.translation[axis],
                            )
                            .into_iter()
                            .enumerate()
                            {
                                values[slot + 1] = value.map(|value| {
                                    let mut next = offset;
                                    next[axis] = value;
                                    next
                                });
                            }
                        }
                        self_reference::Offsets { values, len: 10 }
                    };
                    for (offset_index, offset) in
                        offsets.values[..offsets.len].iter().copied().enumerate()
                    {
                        // Raw None/duplicate slots still execute a visit. Slot0
                        // reuses this relative cell's admission above.
                        if offset_index > 0 {
                            work.charge(1024)?;
                        }
                        let Some(offset) = offset else { continue };
                        if offsets.values[..offset_index]
                            .iter()
                            .flatten()
                            .any(|prior| {
                                prior.to_array().map(f32::to_bits)
                                    == offset.to_array().map(f32::to_bits)
                            })
                        {
                            continue;
                        }
                        let curve = Curve::Anchored {
                            carrier,
                            anchor,
                            offset,
                            linear_velocity: relative,
                            rotation: pose.rotation,
                        };
                        if same_reference(curve, old) || !same_pose(curve.com_pose(safe), pose) {
                            continue;
                        }
                        // A different descriptor whose observed future poses
                        // are all identical is not useful continuation evidence.
                        // These points screen proposals only; they never approve
                        // an interval or replace the subsequent full-shape proof.
                        let end = carrier.domain.end;
                        let probes = [rate_time, end, safe + (end - safe) * 0.5];
                        if !probes
                            .into_iter()
                            .any(|t| t > safe && !same_pose(curve.com_pose(t), old.com_pose(t)))
                        {
                            continue;
                        }
                        let (rate, rotation) = curve_velocity(curve, rate_time)?;
                        if rotation != rp::Vector::ZERO || (!allow_rate_change && rate != target) {
                            continue;
                        }
                        let delta = rate - target;
                        let body = &self.participants[index];
                        if !delta.is_finite() {
                            return Err(TrajectoryError::NonFinite);
                        }
                        if (delta * locked) != rp::Vector::ZERO {
                            continue;
                        }
                        if !self.proposal_rows_feasible_impl(
                            Some((body.body, rate)),
                            Some(&mut *work),
                        )? {
                            continue;
                        }
                        let proposal = Proposal { curve, rate };
                        // Keep searching the original inverse cells when the first
                        // safe-fitting descriptor does not improve the real hit.
                        if accept(proposal, work)? {
                            return Ok(Some(proposal));
                        }
                    }
                }
            }
        }
        Ok(None)
    }

    fn proposal_rows_feasible(
        &self,
        replacement: Option<(BodyId, rp::Vector)>,
    ) -> Result<bool, TrajectoryError> {
        // Existing callers already admitted this row walk at their boundary.
        self.proposal_rows_feasible_impl(replacement, None)
    }

    fn proposal_rows_feasible_impl(
        &self,
        replacement: Option<(BodyId, rp::Vector)>,
        mut work: Option<&mut Work>,
    ) -> Result<bool, TrajectoryError> {
        for row in &self.character_rows {
            if let Some(work) = work.as_deref_mut() {
                work.charge(16)?;
            }
            let value = |i: usize| {
                self.character_values
                    .get(i)
                    .map(|&(body, value)| {
                        replacement.filter(|r| r.0 == body).map_or(value, |r| r.1)
                    })
                    .ok_or(TrajectoryError::InvalidReference)
            };
            let target = match row.b {
                Some(b) => value(b)?,
                None => row.velocity,
            };
            let along = (value(row.a)? - target).dot(row.normal);
            if !along.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            if along < 0. {
                return Ok(false);
            }
        }
        Ok(true)
    }

    /// Use the prescribed face's actual additive phase for a newly matched
    /// side rate. The original safe pose, rate and all response rows must
    /// agree before the ordinary full-shape query can certify the suffix.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn native_side_face_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        planar: bool,
        work: &mut Work,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        let entry = self.entries[index];
        let (actor, face, normal) = if hit.a.parent == Some(entry.value.handle) {
            (hit.a, hit.b, -hit.cast.contact.normal1)
        } else if hit.b.parent == Some(entry.value.handle) {
            (hit.b, hit.a, hit.cast.contact.normal1)
        } else {
            return Ok(None);
        };
        let Role::Character(id) = actor.role else {
            return Ok(None);
        };
        let Some(axis) = coordinate_normal_axis(normal) else {
            return Ok(None);
        };
        let Some(driver) = self.entry_index(face.parent) else {
            return Ok(None);
        };
        let Curve::Integrated(carrier) = self.entries[driver].curve else {
            return Ok(None);
        };
        let Curve::Integrated(incoming) = face.motion.curve else {
            return Ok(None);
        };
        let pose = entry.curve.com_pose(time);
        if face.role != Role::Prescribed
            || actor.sensor
            || face.sensor
            || !characters
                .get(&id)
                .is_some_and(|r| r.config.push_mass == 0.)
            || hit.cast.hit_time < time
            || hit.cast.contact.dist <= 0.
            || normal[axis].abs() != 1.
            || (planar && axis == 2)
            || carrier.domain.start > time
            || carrier.domain.end < end
            || carrier.native.angular_velocity != rp::Vector::ZERO
            || carrier.native.motion.start.rotation != rp::Rotation::IDENTITY
            || carrier.native.motion.end.rotation != rp::Rotation::IDENTITY
            || pose.rotation != rp::Rotation::IDENTITY
            || geometry[axis] * normal[axis] <= 0.
            || geometry[axis].to_bits() != carrier.linear_velocity_at_time()[axis].to_bits()
            || [actor.motion, face.motion].iter().any(|m| {
                m.local_center != rp::Vector::ZERO || !same_pose(m.local_pose, rp::Pose::IDENTITY)
            })
            || bodies[entry.value.handle].locked_axes().intersects(
                [
                    rp::LockedAxes::TRANSLATION_LOCKED_X,
                    rp::LockedAxes::TRANSLATION_LOCKED_Y,
                    rp::LockedAxes::TRANSLATION_LOCKED_Z,
                ][axis],
            )
            || !same_kernel(carrier, incoming)
        {
            return Ok(None);
        }
        let (Some(cuboid), Some(capsule)) = (
            colliders[face.collider].shape().as_cuboid(),
            colliders[actor.collider].shape().as_capsule(),
        ) else {
            return Ok(None);
        };
        let normal_sign = normal[axis];
        let core = [capsule.segment.a[axis], capsule.segment.b[axis]]
            .into_iter()
            .min_by(|a, b| (normal_sign * a).total_cmp(&(normal_sign * b)))
            .ok_or(TrajectoryError::InvalidReference)?;
        let face_coordinate = normal_sign * cuboid.half_extents[axis];
        let shape_coordinate = face_coordinate - (core - normal_sign * capsule.radius);
        let at = carrier.position_at_time(time);
        let clearance = effective_pair_clearance(characters, &self.origins, &actor, &face);
        let safe_gap = gap(
            actor,
            entry.curve,
            face,
            face.motion.curve,
            colliders,
            time,
            clearance,
            work,
        )?;
        let existing = safe_gap.filter(|&gap| gap > 0. && gap < clearance);
        let future = full_future::FullFuture::new(
            actor,
            entry.curve,
            face,
            face.motion.curve,
            colliders,
            carrier,
            time,
            end,
            clearance,
            actor.collider == hit.a.collider,
            work,
        )?;
        // Bound optional proposals independently of the scene's original
        // fallback. Every operation still pays from the same global allowance.
        const FACE_PROPOSAL_WORK: u64 = 32 * 1024;
        let starts_in_contact = hit.cast.hit_time == time;
        let already_anchored = matches!(entry.curve, Curve::Anchored { .. });
        let rephase = starts_in_contact || already_anchored;
        // An existing positive contact needs to recover its original
        // support band as well as prove the full rounded side trajectory.
        let proposal_work = if starts_in_contact {
            64 * 1024
        } else {
            FACE_PROPOSAL_WORK
        };
        // Existing policy must establish the original positive support
        // band before attempting a fixed-axis interval certificate.
        let per_candidate_work = if rephase {
            proposal_work
        } else if existing.is_some() {
            28 * 1024
        } else {
            16 * 1024
        };
        let mut trial = Work {
            used: 0,
            limit: work.limit.saturating_sub(work.used).min(proposal_work),
        };
        let relative_seconds =
            (time - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
        let coordinates = if already_anchored && !starts_in_contact {
            [shape_coordinate, face_coordinate]
        } else {
            [face_coordinate, shape_coordinate]
        };
        let mut attempt = || {
            for fit_drift in [false, true] {
                for coordinate in coordinates {
                    let mut anchor = rp::Vector::ZERO;
                    anchor[axis] = coordinate;
                    if !constant_reference_action(carrier, anchor, &mut trial)? {
                        continue;
                    }
                    let base = at.translation + at.rotation * anchor;
                    let mut rate = geometry;
                    if fit_drift {
                        // The F32 face offset may have a coarser grid than
                        // the actor's safe coordinate. An outward residual
                        // supplies that missing bit through the original clock.
                        let seed = pose.translation[axis] - base[axis];
                        let residual = pose.translation[axis] - (base[axis] + seed);
                        if relative_seconds <= 0. || residual * normal_sign <= 0. {
                            continue;
                        }
                        rate[axis] += residual / relative_seconds;
                        let quantum = (f64::from(seed.next_up()) - f64::from(seed))
                            .max(f64::from(seed) - f64::from(seed.next_down()));
                        let gain = f64::from(rate[axis]) - f64::from(geometry[axis]);
                        if !gain.is_finite()
                            || gain * f64::from(normal_sign) <= 0.
                            || gain.abs() * (end - time) > quantum
                        {
                            continue;
                        }
                    }
                    trial.charge(256)?;
                    // Match the normal phase while preserving every
                    // tangential velocity in the original response.
                    let Some(relative) = fit_relative(carrier.linear_velocity_at_time(), rate)
                    else {
                        continue;
                    };
                    let relative_dt = relative * relative_seconds;
                    let Some(offset) = fit_offset(base, relative_dt, pose.translation) else {
                        continue;
                    };
                    if !self.proposal_rows_feasible_impl(Some((id, rate)), Some(&mut trial))? {
                        continue;
                    }
                    let outward = rephase
                        .then(|| {
                            outward_offset(
                                base[axis],
                                relative_dt[axis],
                                pose.translation[axis],
                                offset[axis],
                                normal_sign,
                                &mut trial,
                            )
                        })
                        .transpose()?;
                    let candidates =
                        offset_cells(base[axis], relative_dt[axis], pose.translation[axis]);
                    for value in outward.into_iter().chain(
                        candidates
                            .into_iter()
                            .flatten()
                            .filter(|v| Some(v.to_bits()) != outward.map(f32::to_bits)),
                    ) {
                        trial.charge(256)?;
                        let mut offset = offset;
                        offset[axis] = value;
                        let candidate = Curve::Anchored {
                            carrier,
                            anchor,
                            offset,
                            linear_velocity: relative,
                            rotation: pose.rotation,
                        };
                        if same_reference(candidate, entry.curve)
                            || !same_pose(candidate.com_pose(time), pose)
                            || curve_velocity(candidate, hit.cast.hit_time)?
                                .0
                                .to_array()
                                .map(f32::to_bits)
                                != rate.to_array().map(f32::to_bits)
                            || (!starts_in_contact
                                && !gap(
                                    actor,
                                    candidate,
                                    face,
                                    face.motion.curve,
                                    colliders,
                                    hit.cast.hit_time,
                                    clearance,
                                    &mut trial,
                                )?
                                .is_some_and(|next| {
                                    next >= existing.unwrap_or(clearance)
                                        && next > hit.cast.contact.dist
                                }))
                        {
                            continue;
                        }
                        // Preserve an opportunity to test the other exact
                        // fit when generic geometry declines one descriptor.
                        let mut proof = Work {
                            used: 0,
                            limit: trial
                                .limit
                                .saturating_sub(trial.used)
                                .min(per_candidate_work),
                        };
                        let result = if existing.is_some() {
                            future.accepts_existing_side_recording(
                                candidate,
                                (actor, face),
                                colliders,
                                memo.as_deref_mut(),
                                &mut proof,
                            )
                        } else {
                            future.accepts_strict_recording(
                                candidate,
                                (actor, face),
                                colliders,
                                memo.as_deref_mut(),
                                &mut proof,
                            )
                        };
                        trial.charge(proof.used)?;
                        match result {
                            Ok(true) => {
                                return Ok(Some(Proposal {
                                    curve: candidate,
                                    rate,
                                }))
                            }
                            Ok(false) | Err(TrajectoryError::WorkLimit) => {}
                            Err(error) => return Err(error),
                        }
                    }
                }
            }
            Ok(None)
        };
        let result = attempt();
        work.charge(trial.used)?;
        match result {
            Err(TrajectoryError::WorkLimit) => Ok(None),
            other => other,
        }
    }

    pub(super) fn verify_selected_geometry_rows(
        &self,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        work.charge(
            (self.character_rows.len() as u64)
                .checked_mul(16)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        if !self.proposal_rows_feasible(None)? {
            return Err(TrajectoryError::Unresolved);
        }
        Ok(())
    }

    /// Retain an admitted geometry-only driver expression instead of rebuilding
    /// it from the intermediate fresh-row virtual participant. This is neither
    /// a new free plan nor contact history: a current, validated driver row and
    /// the complete simultaneous row set remain mandatory.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn retain_driver_phase(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        projected: rp::Vector,
        previous_rate: (rp::Vector, rp::Vector),
        planar: bool,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let entry = self.entries[index];
        let Curve::Anchored {
            carrier,
            anchor,
            rotation,
            ..
        } = entry.curve
        else {
            return Ok(false);
        };
        // Ordinary supports, finite momentum, own clocks and peer clocks keep
        // their original lifecycle. No new cost is added to those paths.
        if entry.support.is_some() || carrier.native.motion.body == entry.value.handle {
            return Ok(false);
        }
        work.charge(512)?;
        let id = identity(entry.value.handle);
        if !characters.get(&id).is_some_and(|r| r.config.push_mass == 0.)
            || ![hit.a, hit.b].iter().all(|c| {
                matches!(c.role, Role::Character(body) if characters.get(&body).is_some_and(|r| r.config.push_mass == 0.))
                    && !c.sensor
                    && colliders.get(c.collider).is_some_and(|v| v.shape().as_capsule().is_some())
            })
            || ![hit.a.parent, hit.b.parent].contains(&Some(entry.value.handle))
            || !projected.is_finite()
            || !previous_rate.0.is_finite()
            || previous_rate.1 != rp::Vector::ZERO
            || self.participants[index].angular_velocity != rp::Vector::ZERO
            || anchor != rp::Vector::ZERO
            || rotation.to_array().map(f32::to_bits) != rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
            || carrier.native.motion.start.rotation.to_array().map(f32::to_bits) != rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
            || carrier.native.motion.end.rotation.to_array().map(f32::to_bits) != rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
            || carrier.native.angular_velocity.to_array().map(f32::to_bits) != [0; 3]
        {
            return Ok(false);
        }
        let value = self
            .character_values
            .binary_search_by_key(&id, |v| v.0)
            .map_err(|_| TrajectoryError::InvalidReference)?;
        if self.character_carry[value] != rp::Vector::ZERO {
            return Ok(false);
        }
        let Some(driver) = self.entry_index(Some(carrier.native.motion.body)) else {
            return Ok(false);
        };
        let Curve::Integrated(current) = self.entries[driver].curve else {
            return Ok(false);
        };
        if characters.contains_key(&identity(carrier.native.motion.body))
            || self.entries[driver].stopped_at.is_some()
            || !bodies
                .get(carrier.native.motion.body)
                .is_some_and(|b| b.is_enabled() && b.is_kinematic())
            || !same_kernel(current, carrier)
            || current.domain.start.to_bits() != carrier.domain.start.to_bits()
            || current.domain.end.to_bits() != carrier.domain.end.to_bits()
            || current.native.linear_velocity.to_array().map(f32::to_bits)
                != carrier.native.linear_velocity.to_array().map(f32::to_bits)
            || current.native.angular_velocity.to_array().map(f32::to_bits)
                != carrier.native.angular_velocity.to_array().map(f32::to_bits)
        {
            return Ok(false);
        }
        let canonical = self.geometry_after_carrier_response(
            entry,
            safe,
            hit.cast.hit_time,
            end,
            bodies,
            work,
        )?;
        let flags = bodies
            .get(entry.value.handle)
            .ok_or(TrajectoryError::InvalidReference)?
            .locked_axes();
        for axis in 0..3 {
            if previous_rate.0[axis].to_bits() != projected[axis].to_bits()
                && (previous_rate.0[axis].to_bits() != canonical[axis].to_bits()
                    || [
                        rp::LockedAxes::TRANSLATION_LOCKED_X,
                        rp::LockedAxes::TRANSLATION_LOCKED_Y,
                        rp::LockedAxes::TRANSLATION_LOCKED_Z,
                    ][axis]
                        .intersects(flags)
                    || (planar && axis == 2))
            {
                return Ok(false);
            }
        }
        let mut driver_axis = None;
        for sample in self.contacts.iter().chain(
            self.active_contacts
                .iter()
                .filter(|v| v.visible)
                .map(|v| &v.sample),
        ) {
            work.charge(32)?;
            let other = if sample.a.parent == Some(entry.value.handle) {
                sample.b
            } else if sample.b.parent == Some(entry.value.handle) {
                sample.a
            } else {
                continue;
            };
            if other.sensor
                || other.role != Role::Prescribed
                || other.parent != Some(carrier.native.motion.body)
            {
                continue;
            }
            let Curve::Integrated(observed) = other.motion.curve else {
                continue;
            };
            if !same_kernel(observed, carrier) {
                continue;
            }
            let Some(axis) = coordinate_normal_axis(sample.contact.normal1) else {
                continue;
            };
            if sample.contact.normal1[axis].abs() != 1.
                || previous_rate.0[axis].to_bits() != projected[axis].to_bits()
            {
                continue;
            }
            driver_axis = Some(axis);
            break;
        }
        if driver_axis.is_none() {
            return Ok(false);
        }
        // Replacing only this one rate must satisfy every current/visible
        // active row exactly. The old safe pose, h/Domain and full future curve
        // are kept byte-for-byte; the outer scene/endpoint proof still runs.
        self.proposal_rows_feasible_impl(Some((id, previous_rate.0)), Some(work))
    }

    /// Return a proposal, never an admission. The real support remains the
    /// existing support handle; a translation reference has support=None.
    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn representable_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        work: &mut Work,
        planar: bool,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        self.representable_suffix_reusing(
            index, hit, time, end, bodies, colliders, characters, geometry, work, planar, None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn representable_suffix_reusing(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        work: &mut Work,
        planar: bool,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        let original = self.original_representable_suffix(
            index,
            hit,
            time,
            end,
            bodies,
            colliders,
            characters,
            geometry,
            work,
            planar,
            memo.as_deref_mut(),
        )?;
        if original.is_some() {
            return Ok(original);
        }
        if self.entries[index].support.is_none() {
            let finite = self.finite_suffix(
                index,
                hit,
                time,
                end,
                bodies,
                colliders,
                characters,
                geometry,
                work,
                planar,
                memo.as_deref_mut(),
            )?;
            if finite.is_some() {
                return Ok(finite);
            }
            return self.stationary_face_suffix(
                index, hit, time, end, bodies, colliders, characters, geometry, None, planar, work,
                memo,
            );
        }
        self.ground_rate_suffix(
            index, hit, time, end, bodies, colliders, characters, geometry, work, planar,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn original_representable_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        work: &mut Work,
        planar: bool,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        work.charge(
            64 + 3 * u64::from(
                usize::BITS
                    - self
                        .entries
                        .len()
                        .max(characters.len())
                        .max(1)
                        .leading_zeros(),
            ),
        )?;
        let entry = self.entries[index];
        let id = identity(entry.value.handle);
        if !characters.contains_key(&id) {
            return Ok(None);
        }
        if entry.support.is_none() {
            if let Curve::Anchored {
                carrier,
                anchor,
                linear_velocity,
                ..
            } = entry.curve
            {
                if let Some(driver) = self.entry_index(Some(carrier.native.motion.body)) {
                    // Only the new external Character clock form is an
                    // immutable value reference. It is neither live support
                    // nor an instruction to follow that peer's later rebase.
                    // Existing own clocks and external Native donors keep
                    // their original update/stop branches below.
                    let peer_form = carrier.native.motion.body != entry.value.handle
                        && anchor == rp::Vector::ZERO
                        && linear_velocity == rp::Vector::ZERO;
                    let immutable_peer = if peer_form {
                        work.charge(u64::from(
                            usize::BITS - characters.len().max(1).leading_zeros(),
                        ))?;
                        characters.contains_key(&identity(carrier.native.motion.body))
                    } else {
                        false
                    };
                    if !immutable_peer {
                        match self.entries[driver].curve {
                            Curve::Integrated(current) if !same_kernel(current, carrier) => {
                                work.charge(384)?;
                                return Ok(translation_reference(
                                    current,
                                    entry.curve.com_pose(time),
                                    geometry,
                                    time,
                                )
                                .map(|curve| Proposal {
                                    curve,
                                    rate: geometry,
                                }));
                            }
                            Curve::Constant { .. } => {
                                // A stopped driver no longer supplies a Native
                                // moving frame. Preserve the safe pose and the
                                // canonical geometry rate, without a stale link.
                                work.charge(384)?;
                                let pose = entry.curve.com_pose(time);
                                let next = if geometry == rp::Vector::ZERO {
                                    Curve::Constant {
                                        pose,
                                        start_time: time,
                                        end_time: end,
                                    }
                                } else {
                                    Curve::Integrated(Kernel::from_velocity(
                                        entry.value.handle,
                                        Domain::new(time, end)?,
                                        pose,
                                        geometry,
                                        rp::Vector::ZERO,
                                    )?)
                                };
                                return Ok(Some(Proposal {
                                    curve: next,
                                    rate: curve_velocity(next, hit.cast.hit_time)?.0,
                                }));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        let (actor, other, normal) = if hit.a.parent == Some(entry.value.handle) {
            (hit.a, hit.b, -hit.cast.contact.normal1)
        } else if hit.b.parent == Some(entry.value.handle) {
            (hit.b, hit.a, hit.cast.contact.normal1)
        } else {
            return Ok(None);
        };
        if actor.sensor
            || other.sensor
            || self.participants[index].angular_velocity != rp::Vector::ZERO
        {
            return Ok(None);
        }
        let clearance = effective_pair_clearance(characters, &self.origins, &actor, &other);
        let other_curve = self
            .entry_index(other.parent)
            .map_or(other.motion.curve, |i| self.entries[i].curve);
        if entry.support.is_some() {
            // Keep the original real support/kernel. Angular phase fitting is
            // limited to a structurally normal-only parameter; its physical
            // point-rate remains the immutable support anchor in the caller.
            let Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            } = entry.curve
            else {
                return Ok(None);
            };
            let Some(driver) = self.entry_index(entry.support) else {
                return Ok(None);
            };
            let Curve::Integrated(current) = self.entries[driver].curve else {
                return Ok(None);
            };
            let normal_axis = normal_phase_axis(carrier, normal, work)?;
            if other.parent != entry.support
                || !same_kernel(carrier, current)
                || (carrier.native.angular_velocity != rp::Vector::ZERO && normal_axis.is_none())
                || curve_velocity(entry.curve, hit.cast.hit_time)?.0 != geometry
                || self
                    .retained_support_suffix(
                        index,
                        time,
                        hit.cast.hit_time,
                        bodies,
                        characters,
                        work,
                    )?
                    .is_none()
            {
                return Ok(None);
            }
            let Some(old_gap) = gap(
                actor,
                entry.curve,
                other,
                other_curve,
                colliders,
                hit.cast.hit_time,
                clearance,
                work,
            )?
            else {
                return Ok(None);
            };
            let probe = if hit.cast.hit_time > time {
                hit.cast.hit_time
            } else {
                end
            };
            let old_probe = if probe == hit.cast.hit_time {
                old_gap
            } else {
                let Some(gap) = gap(
                    actor,
                    entry.curve,
                    other,
                    other_curve,
                    colliders,
                    probe,
                    clearance,
                    work,
                )?
                else {
                    return Ok(None);
                };
                gap
            };
            let required = if hit.cast.hit_time > time {
                clearance
            } else {
                old_gap
            };
            let deficit = clearance - old_gap;
            if !deficit.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            if deficit <= 0. {
                return Ok(None);
            }
            // One immutable pair/clock preparation. A hit-improving phase
            // still has to preserve the complete pair future before selection.
            let future = full_future::FullFuture::new(
                actor,
                entry.curve,
                other,
                other_curve,
                colliders,
                carrier,
                time,
                end,
                clearance,
                actor.collider == hit.a.collider,
                work,
            )?;
            let ordinary =
                |work: &mut Work, mut memo: Option<&mut actual_scene::PairQueries<'_>>| {
                    work.charge(6 * 12 * 512)?;
                    let local = carrier
                        .position_at_time(hit.cast.hit_time)
                        .rotation
                        .conjugate()
                        * normal;
                    let axis = (0..3)
                        .max_by(|&a, &b| local[a].abs().total_cmp(&local[b].abs()))
                        .ok_or(TrajectoryError::InvalidReference)?;
                    let gain = local[axis];
                    if !gain.is_finite() || gain == 0. {
                        return Ok(None);
                    }
                    let center = anchor[axis] + deficit / gain;
                    let safe_pose = entry.curve.com_pose(time);
                    let anchors = [
                        anchor[axis],
                        anchor[axis].next_up(),
                        anchor[axis].next_down(),
                        center,
                        center.next_up(),
                        center.next_down(),
                    ];
                    // Preserve the existing anchor-only inverse when it succeeds.
                    // Joint offset cells remain the same bounded fallback set: do not
                    // let the first anchor's new offset preempt another anchor's
                    // original-offset candidate or its established descriptor contract.
                    let rotating = carrier.native.angular_velocity != rp::Vector::ZERO;
                    let mut rejected_time = None;
                    for joint_offset in [false, true] {
                        for (index, &coordinate) in anchors.iter().enumerate() {
                            // A deficit can round back to the old anchor. Preserve the
                            // earlier occurrence and skip only identical descriptors.
                            if !coordinate.is_finite()
                                || anchors[..index]
                                    .iter()
                                    .any(|previous| previous.to_bits() == coordinate.to_bits())
                            {
                                continue;
                            }
                            let mut anchor = anchor;
                            anchor[axis] = coordinate;
                            let original_offset = offset.to_array().map(f32::to_bits);
                            let mut offsets = [None; 12];
                            if joint_offset {
                                let base = carrier.position_at_time(time);
                                let relative_dt = linear_velocity
                                    * (time - carrier.domain.start)
                                        .clamp(0., carrier.domain.duration())
                                        as f32;
                                offsets[1] = fit_offset(
                                    base.translation + base.rotation * anchor,
                                    relative_dt,
                                    safe_pose.translation,
                                );
                                if let Some(normal_axis) = normal_axis {
                                    let base = base.translation + base.rotation * anchor;
                                    for (slot, value) in offset_cells(
                                        base[normal_axis],
                                        relative_dt[normal_axis],
                                        safe_pose.translation[normal_axis],
                                    )
                                    .into_iter()
                                    .enumerate()
                                    {
                                        offsets[slot + 2] = value.map(|value| {
                                            let mut next = offset;
                                            next[normal_axis] = value;
                                            next
                                        });
                                    }
                                }
                            } else {
                                offsets[0] = Some(offset);
                            }
                            for (index, &offset) in offsets.iter().enumerate() {
                                let Some(offset) = offset else { continue };
                                let bits = offset.to_array().map(f32::to_bits);
                                if (joint_offset && bits == original_offset)
                                    || offsets[..index].iter().flatten().any(|previous| {
                                        previous.to_array().map(f32::to_bits) == bits
                                    })
                                {
                                    continue;
                                }
                                // For angular support the tangential descriptor terms
                                // must remain exactly the original ones. Re-fitting an
                                // unrelated coordinate would authorize new free motion.
                                if rotating
                                    && (0..3).any(|i| {
                                        Some(i) != normal_axis && bits[i] != original_offset[i]
                                    })
                                {
                                    continue;
                                }
                                let candidate = Curve::Anchored {
                                    carrier,
                                    anchor,
                                    offset,
                                    linear_velocity,
                                    rotation,
                                };
                                if same_reference(candidate, entry.curve)
                                    || !same_pose(candidate.com_pose(time), safe_pose)
                                    || curve_velocity(candidate, hit.cast.hit_time)?
                                        != curve_velocity(entry.curve, hit.cast.hit_time)?
                                {
                                    continue;
                                }
                                // At hit==safe the point cannot change. A better actual
                                // future pose is only a proposal screen; full interval and
                                // final endpoint admission remain mandatory below caller.
                                if gap(
                                    actor,
                                    candidate,
                                    other,
                                    other_curve,
                                    colliders,
                                    probe,
                                    clearance,
                                    work,
                                )?
                                .is_some_and(|g| g >= required && g > old_probe)
                                {
                                    if rotating {
                                        let Some(coverage) = future.coverage_with_conflict_hint(
                                            candidate,
                                            &mut rejected_time,
                                            work,
                                        )?
                                        else {
                                            continue;
                                        };
                                        if let Some(memo) = memo.as_deref_mut() {
                                            future.record_coverage(
                                                candidate,
                                                (actor, other),
                                                colliders,
                                                memo,
                                                coverage,
                                                work,
                                            )?;
                                        }
                                    } else if !future.accepts(candidate, work)? {
                                        continue;
                                    }
                                    return Ok(Some(Proposal {
                                        curve: candidate,
                                        rate: geometry,
                                    }));
                                }
                            }
                        }
                    }
                    Ok(None)
                };
            let face = |work: &mut Work, mut memo: Option<&mut actual_scene::PairQueries<'_>>| {
                // The surface witness only supplies a normal evaluation phase.
                // All original rate/pose/rows and full-pair checks still apply.
                let runtime = characters
                    .get(&id)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let up = rp::Vector::from(runtime.config.up);
                let Some(axis) = coordinate_normal_axis(up) else {
                    return Ok(None);
                };
                if up[axis].abs() != 1. || normal_axis != Some(axis) || normal[axis] != up[axis] {
                    return Ok(None);
                }
                let flags = bodies
                    .get(entry.value.handle)
                    .ok_or(TrajectoryError::InvalidReference)?
                    .locked_axes();
                let locks = [
                    flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_X),
                    flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Y),
                    planar || flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Z),
                ];
                if locks[axis] {
                    return Ok(None);
                }
                let origin = self
                    .origins
                    .binary_search_by_key(&id, |o| o.body)
                    .map_err(|_| TrajectoryError::InvalidReference)?;
                if self.origins[origin].relative_plan.dot(up) > 0. {
                    return Ok(None);
                }
                let rows = u64::try_from(self.character_rows.len())
                    .map_err(|_| TrajectoryError::WorkLimit)?;
                let row_cost = rows.checked_mul(16).ok_or(TrajectoryError::WorkLimit)?;
                let point = if actor.collider == hit.a.collider {
                    hit.cast.contact.point2
                } else {
                    hit.cast.contact.point1
                };
                #[cfg(test)]
            normal_witness::rotating_trace("original-six-declined", format_args!(
                "safe={time:.18e} hit={:.18e} probe={probe:.18e} gap={old_gap} probe_gap={old_probe} required={required} axis={axis} normal_axis={normal_axis:?} geometry={geometry:?} work={}", hit.cast.hit_time, work.used));
                work.charge(std::mem::size_of::<full_future::RejectedTimes>() as u64)?;
                let mut rejected_times = [None; 4];
                let mut accept = |candidate: Curve, work: &mut Work| {
                    let (rate, angular) = curve_velocity(candidate, hit.cast.hit_time)?;
                    if rate.to_array().map(f32::to_bits) != geometry.to_array().map(f32::to_bits)
                        || angular != rp::Vector::ZERO
                    {
                        return Ok(false);
                    }
                    // The row walk happens only for this eligible descriptor.
                    work.charge(row_cost)?;
                    if !self.proposal_rows_feasible(Some((id, rate)))?
                        || same_pose(candidate.com_pose(probe), entry.curve.com_pose(probe))
                    {
                        return Ok(false);
                    }
                    let next = gap(
                        actor,
                        candidate,
                        other,
                        other_curve,
                        colliders,
                        probe,
                        clearance,
                        work,
                    )?;
                    #[cfg(test)]
                normal_witness::rotating_trace("callback-gap", format_args!(
                    "probe={probe:.18e} next={next:?} old={old_probe} required={required} work={}", work.used));
                    if !next.is_some_and(|g| g >= required && g > old_probe) {
                        return Ok(false);
                    }
                    if carrier.native.angular_velocity == rp::Vector::ZERO {
                        future.accepts(candidate, work)
                    } else {
                        future.accepts_rotating_recording_with_hints(
                            candidate,
                            (actor, other),
                            colliders,
                            memo.as_deref_mut(),
                            true,
                            &mut rejected_times,
                            work,
                        )
                    }
                };
                let original = normal_witness::propose(
                    carrier,
                    anchor,
                    offset,
                    linear_velocity,
                    rotation,
                    axis,
                    point,
                    hit.cast.hit_time,
                    time,
                    probe,
                    end,
                    clearance,
                    work,
                    &mut accept,
                )?;
                if original.is_some() {
                    return Ok(original);
                }
                let original = normal_witness::propose_rotating(
                    carrier,
                    anchor,
                    offset,
                    linear_velocity,
                    rotation,
                    axis,
                    point,
                    hit.cast.hit_time,
                    time,
                    probe,
                    end,
                    clearance,
                    work,
                    &mut accept,
                )?;
                if original.is_some() {
                    return Ok(original);
                }
                normal_witness::propose_rotating_rebased(
                    carrier,
                    anchor,
                    offset,
                    linear_velocity,
                    rotation,
                    axis,
                    point,
                    hit.cast.hit_time,
                    time,
                    probe,
                    end,
                    clearance,
                    work,
                    &mut accept,
                )
            };
            // Near the end of a pure-axis turn, COM-height inverse
            // candidates can span a much denser axial grid than the
            // normal face itself. Both paths retain the same full checks.
            let position_rotation = carrier.native.angular_velocity != rp::Vector::ZERO
                && bodies[carrier.native.motion.body].body_type()
                    == rp::RigidBodyType::KinematicPositionBased;
            let prefer_face = carrier.native.linear_velocity == rp::Vector::ZERO
                && (position_rotation
                    || (linear_velocity == rp::Vector::ZERO
                        && normal_axis.is_some_and(|axis| {
                            let q = carrier.native.motion.start.rotation.to_array();
                            q[axis] != 0.
                                && 64. * q[axis].abs() < q[3].abs()
                                && q[axis] * q[3] * carrier.native.angular_velocity[axis] < 0.
                        })));
            if prefer_face {
                let candidate = face(work, memo.as_deref_mut())?;
                return if candidate.is_some() {
                    Ok(candidate)
                } else {
                    ordinary(work, memo)
                };
            }
            let candidate = ordinary(work, memo.as_deref_mut())?;
            return if candidate.is_some() {
                Ok(candidate)
            } else {
                face(work, memo)
            };
        }
        // A native surface may provide an evaluation frame without being a
        // support. Across a capsule pair only an existing native reference can
        // propagate; no character kernel is promoted into a physical carrier.
        let driver = match other_curve {
            Curve::Integrated(k) if !matches!(other.role, Role::Character(_)) => Some((k, None)),
            Curve::Anchored {
                carrier, anchor, ..
            } => self
                .entry_index(Some(carrier.native.motion.body))
                .and_then(|i| match self.entries[i].curve {
                    Curve::Integrated(k) if same_kernel(k, carrier) => Some((k, Some(anchor))),
                    _ => None,
                }),
            _ => None,
        };
        let own_reference = driver.is_none();
        let driver = if own_reference {
            self_reference::kernel(entry, characters, time, end, work)?.map(|kernel| (kernel, None))
        } else {
            driver
        };
        let Some((carrier, inherited_anchor)) = driver else {
            return Ok(None);
        };
        if carrier.domain.start > time || carrier.domain.end < end {
            return Ok(None);
        }
        let at = carrier.position_at_time(hit.cast.hit_time);
        let point = if actor.collider == hit.a.collider {
            hit.cast.contact.point2
        } else {
            hit.cast.contact.point1
        };
        let contact_anchor =
            inherited_anchor.unwrap_or_else(|| at.rotation.conjugate() * (point - at.translation));
        if !contact_anchor.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let flags = bodies[entry.value.handle].locked_axes();
        let locked = rp::Vector::new(
            if flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_X) {
                1.
            } else {
                0.
            },
            if flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Y) {
                1.
            } else {
                0.
            },
            if planar || flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Z) {
                1.
            } else {
                0.
            },
        );
        // Exact total-rate inverses take precedence. The existing full-shape
        // screen is inside candidate enumeration so a rejected first inverse
        // cannot silently discard the other representable cells.
        let old_gap = if hit.cast.hit_time > time {
            gap(
                actor,
                entry.curve,
                other,
                other_curve,
                colliders,
                hit.cast.hit_time,
                clearance,
                work,
            )?
        } else {
            None
        };
        for allow_rate_change in [false, true] {
            // An own clock changes only evaluation phase. It must preserve
            // the exact total geometric rate, including all free tangents.
            if own_reference && allow_rate_change {
                continue;
            }
            for anchor in [rp::Vector::ZERO, contact_anchor] {
                let mut accept = |proposal: Proposal, work: &mut Work| {
                    if own_reference
                        && proposal.rate.to_array().map(f32::to_bits)
                            != geometry.to_array().map(f32::to_bits)
                    {
                        return Ok(false);
                    }
                    if hit.cast.hit_time <= time {
                        return Ok(true);
                    }
                    let next = gap(
                        actor,
                        proposal.curve,
                        other,
                        other_curve,
                        colliders,
                        hit.cast.hit_time,
                        clearance,
                        work,
                    )?;
                    Ok(old_gap
                        .zip(next)
                        .is_some_and(|(old, next)| next >= clearance && next > old))
                };
                let proposal = if own_reference {
                    self.reference_proposal_core(
                        index,
                        carrier,
                        anchor,
                        entry.curve,
                        geometry,
                        time,
                        hit.cast.hit_time,
                        allow_rate_change,
                        locked,
                        normal,
                        true,
                        work,
                        &mut accept,
                    )?
                } else {
                    self.reference_proposal(
                        index,
                        carrier,
                        anchor,
                        entry.curve,
                        geometry,
                        time,
                        hit.cast.hit_time,
                        allow_rate_change,
                        locked,
                        normal,
                        work,
                        &mut accept,
                    )?
                };
                if let Some(proposal) = proposal {
                    return Ok(Some(proposal));
                }
            }
        }
        if let Some(axis) = coordinate_normal_axis(normal) {
            if let Some(old) = old_gap.filter(|&old| old < clearance && locked[axis] == 0.) {
                let proposal = self.finite_anchored_half_cell(
                    entry,
                    (actor, other),
                    other_curve,
                    hit,
                    time,
                    end,
                    axis,
                    geometry,
                    clearance,
                    old,
                    characters,
                    colliders,
                    memo,
                    work,
                )?;
                if proposal.is_some() {
                    return Ok(proposal);
                }
            }
        }
        self.peer_clock_suffix(
            index,
            actor,
            other,
            other_curve,
            normal,
            hit,
            time,
            end,
            bodies,
            colliders,
            geometry,
            clearance,
            old_gap,
            work,
            planar,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn peer_clock_suffix(
        &self,
        index: usize,
        actor: ColliderTrajectory,
        other: ColliderTrajectory,
        other_curve: Curve,
        normal: rp::Vector,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        geometry: rp::Vector,
        clearance: f32,
        old_gap: Option<f32>,
        work: &mut Work,
        planar: bool,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        let entry = self.entries[index];
        if entry.support.is_some()
            || !matches!(other.role, Role::Character(_))
            || hit.cast.hit_time <= safe
        {
            return Ok(None);
        }
        let (Curve::Integrated(own), Curve::Integrated(peer)) = (entry.curve, other_curve) else {
            return Ok(None);
        };
        let Some(axis) = coordinate_normal_axis(normal) else {
            return Ok(None);
        };
        work.charge(64 + u64::from(usize::BITS - self.entries.len().max(1).leading_zeros()))?;
        let Some(peer_index) = self.entry_index(other.parent) else {
            return Ok(None);
        };
        if self.entries[peer_index].support.is_some()
            || own.native.motion.body != entry.value.handle
            || other.parent != Some(peer.native.motion.body)
        {
            return Ok(None);
        }
        let actor_shape = colliders
            .get(actor.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        let other_shape = colliders
            .get(other.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        if actor_shape.as_capsule().is_none() || other_shape.as_capsule().is_none() {
            return Ok(None);
        }
        let flags = bodies
            .get(entry.value.handle)
            .ok_or(TrajectoryError::InvalidReference)?
            .locked_axes();
        let locks = [
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_X),
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Y),
            planar || flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Z),
        ];
        if locks[axis] {
            return Ok(None);
        }
        let Some(clock) = PeerClock::new(own, peer, axis, safe, end, work)? else {
            return Ok(None);
        };
        if peer.linear_velocity_at_time().to_array().map(f32::to_bits)
            != geometry.to_array().map(f32::to_bits)
        {
            return Ok(None);
        }
        let Some(old_gap) = old_gap else {
            return Ok(None);
        };
        let future = full_future::FullFuture::new(
            actor,
            entry.curve,
            other,
            other_curve,
            colliders,
            own,
            safe,
            end,
            clearance,
            actor.collider == hit.a.collider,
            work,
        )?;
        work.charge(128)?;
        let offsets = offset_cells(clock.peer_range[0], 0., clock.safe_pose.translation[axis]);
        let row_cost = u64::try_from(self.character_rows.len())
            .ok()
            .and_then(|n| n.checked_mul(16))
            .ok_or(TrajectoryError::WorkLimit)?;
        for (slot, offset) in offsets.into_iter().enumerate() {
            work.charge(1)?;
            let Some(offset) = offset else { continue };
            if offsets[..slot]
                .iter()
                .flatten()
                .any(|old| old.to_bits() == offset.to_bits())
            {
                continue;
            }
            let Some(candidate) = clock.candidate(offset, clearance, work)? else {
                continue;
            };
            let (rate, angular) = curve_velocity(candidate, hit.cast.hit_time)?;
            if angular != rp::Vector::ZERO
                || rate.to_array().map(f32::to_bits) != geometry.to_array().map(f32::to_bits)
            {
                continue;
            }
            work.charge(row_cost)?;
            if !self.proposal_rows_feasible(Some((identity(entry.value.handle), rate)))? {
                continue;
            }
            if gap(
                actor,
                candidate,
                other,
                other_curve,
                colliders,
                hit.cast.hit_time,
                clearance,
                work,
            )?
            .is_some_and(|next| next >= clearance && next > old_gap)
                && future.accepts(candidate, work)?
            {
                return Ok(Some(Proposal {
                    curve: candidate,
                    rate,
                }));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_reference_retains_nonzero_clock_safe_bits_and_authoritative_world_rate() {
        let body = rp::RigidBodyHandle::from_raw_parts(0, 0);
        let domain = Domain::new(0.013, 0.037).unwrap();
        let carrier = Kernel::from_velocity(
            body,
            domain,
            rp::Pose::from_translation(rp::Vector::new(0.125, -0.1, 0.)),
            rp::Vector::new(2., -0.125, 0.25),
            rp::Vector::Y * 0.7,
        )
        .unwrap();
        let time = 0.019;
        let relative = rp::Vector::new(-1., 0.125, -0.25);
        let authored_offset = rp::Vector::Y * 0.6;
        let pose = rp::Pose::from_translation(
            carrier.position_at_time(time).translation
                + authored_offset
                + relative * (time - domain.start) as f32,
        );
        let geometry = carrier.linear_velocity_at_time() + relative;
        let proposed = translation_reference(carrier, pose, geometry, time)
            .expect("finite inverse rounding cells");
        assert!(same_pose(proposed.com_pose(time), pose));
        assert_eq!(
            curve_velocity(proposed, time).unwrap(),
            (geometry, rp::Vector::ZERO)
        );
        let Curve::Anchored {
            carrier: retained,
            anchor,
            offset,
            linear_velocity,
            ..
        } = proposed
        else {
            panic!("translation reference");
        };
        assert!(same_kernel(carrier, retained));
        assert_eq!(anchor, rp::Vector::ZERO);
        let expected = carrier.position_at_time(domain.end).translation
            + offset
            + linear_velocity * domain.duration() as f32;
        assert_eq!(proposed.com_pose(domain.end).translation, expected);
        assert!(proposed.com_pose(domain.end).translation.x > pose.translation.x);
        assert_eq!(carrier.domain.start, domain.start);
        assert_eq!(carrier.domain.end, domain.end);
        let replacement = Kernel::from_velocity(
            body,
            domain,
            carrier.native.motion.start,
            rp::Vector::ZERO,
            carrier.native.angular_velocity,
        )
        .unwrap();
        let next = translation_reference(
            replacement,
            proposed.com_pose(time),
            rp::Vector::NEG_X,
            time,
        )
        .unwrap();
        assert!(same_pose(next.com_pose(time), proposed.com_pose(time)));
        assert_eq!(
            curve_velocity(next, time).unwrap(),
            (rp::Vector::NEG_X, rp::Vector::ZERO)
        );
        assert!(next.com_pose(domain.end).translation.x < pose.translation.x);
    }

    #[test]
    fn reference_fitting_rejects_nonfinite_or_unrepresentable_cancellation() {
        assert!(fit_relative(
            rp::Vector::splat(f32::MAX),
            rp::Vector::splat(f32::MIN_POSITIVE)
        )
        .is_none());
        assert!(fit_offset(
            rp::Vector::splat(f32::NAN),
            rp::Vector::ZERO,
            rp::Vector::ZERO
        )
        .is_none());
    }

    #[test]
    fn adjacent_geometric_rate_is_explicitly_feasible_without_changing_finite_momentum() {
        let id = BodyId {
            slot: 0,
            generation: 0,
        };
        let native = crate::physics3d::world::native_id(id);
        let domain = Domain::new(0., f64::from(0.025_f32)).unwrap();
        let base = rp::Vector::Y * -1.2895234e-7;
        let target = rp::Vector::Y * 1.2895232e-7;
        assert!(
            fit_relative(base, target).is_none(),
            "recorded two-adjacent target is not in this F32 sum image"
        );
        let carrier =
            Kernel::from_velocity(native, domain, rp::Pose::IDENTITY, base, rp::Vector::ZERO)
                .unwrap();
        let pose = rp::Pose::from_translation(rp::Vector::new(0.25, 0., 0.25));
        let old = Curve::Integrated(
            Kernel::from_velocity(native, domain, pose, target, rp::Vector::ZERO).unwrap(),
        );
        let mut scratch = BackendMotionScratch::default();
        let physical = rp::Vector::new(3., 2., -1.);
        scratch.participants.push(Participant {
            body: id,
            pose,
            linear_velocity: physical,
            angular_velocity: rp::Vector::ZERO,
            mass: MassPolicy::Character(10.),
        });
        scratch.character_values.push((id, target));
        scratch.character_rows.push(actual_rows::Row {
            a: 0,
            b: None,
            normal: rp::Vector::Y,
            velocity: target,
        });
        let mut work = Work {
            used: 0,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        };
        assert!(scratch
            .reference_proposal(
                0,
                carrier,
                rp::Vector::ZERO,
                old,
                target,
                0.,
                0.,
                false,
                rp::Vector::ZERO,
                rp::Vector::Y,
                &mut work,
                &mut |_, _| Ok(true),
            )
            .unwrap()
            .is_none());
        let start = work.used;
        let proposal = scratch
            .reference_proposal(
                0,
                carrier,
                rp::Vector::ZERO,
                old,
                target,
                0.,
                0.,
                true,
                rp::Vector::ZERO,
                rp::Vector::Y,
                &mut work,
                &mut |_, _| Ok(true),
            )
            .unwrap()
            .expect("one adjacent actual geometric rate obeys the original plane");
        assert!(same_pose(proposal.curve.com_pose(0.), pose));
        assert_ne!(proposal.rate, target);
        assert_eq!(proposal.rate, curve_velocity(proposal.curve, 0.).unwrap().0);
        assert!((proposal.rate - target).dot(rp::Vector::Y) >= 0.);
        assert_eq!(scratch.participants[0].linear_velocity, physical);
        assert_eq!(
            scratch.character_values[0].1, target,
            "proposal is read-only until caller installs it"
        );
        assert!(scratch.row_impulses.is_empty());
        let mut below = Work {
            used: 0,
            limit: work.used - start - 1,
        };
        assert!(matches!(
            scratch.reference_proposal(
                0,
                carrier,
                rp::Vector::ZERO,
                old,
                target,
                0.,
                0.,
                true,
                rp::Vector::ZERO,
                rp::Vector::Y,
                &mut below,
                &mut |_, _| Ok(true),
            ),
            Err(TrajectoryError::WorkLimit)
        ));
        assert_eq!(scratch.participants[0].linear_velocity, physical);
        // A locked axis cannot take this virtual rate, and two opposite exact
        // planes require the unreachable original target. Neither is relaxed.
        assert!(scratch
            .reference_proposal(
                0,
                carrier,
                rp::Vector::ZERO,
                old,
                target,
                0.,
                0.,
                true,
                rp::Vector::Y,
                rp::Vector::Y,
                &mut work,
                &mut |_, _| Ok(true),
            )
            .unwrap()
            .is_none());
        scratch.character_rows.push(actual_rows::Row {
            a: 0,
            b: None,
            normal: rp::Vector::NEG_Y,
            velocity: target,
        });
        assert!(scratch
            .reference_proposal(
                0,
                carrier,
                rp::Vector::ZERO,
                old,
                target,
                0.,
                0.,
                true,
                rp::Vector::ZERO,
                rp::Vector::Y,
                &mut work,
                &mut |_, _| Ok(true),
            )
            .unwrap()
            .is_none());
        scratch.verify_selected_geometry_rows(&mut work).unwrap();
        scratch.character_values[0].1 = proposal.rate;
        assert_eq!(
            scratch.verify_selected_geometry_rows(&mut work),
            Err(TrajectoryError::Unresolved)
        );
    }

    #[test]
    fn rotating_x_face_cannot_create_uncommanded_tangent_motion_from_a_side_reference() {
        let id = BodyId {
            slot: 0,
            generation: 0,
        };
        let carrier_id = rp::RigidBodyHandle::from_raw_parts(1, 0);
        let domain = Domain::new(0., f64::from(0.025_f32)).unwrap();
        let carrier = Kernel::from_velocity(
            carrier_id,
            domain,
            rp::Pose::IDENTITY,
            rp::Vector::ZERO,
            rp::Vector::X * 2.,
        )
        .unwrap();
        let point = rp::Vector::new(0.25, 0.25, 0.);
        let pose = rp::Pose::from_translation(rp::Vector::new(0.51, 0.5, 0.));
        let target = rp::Vector::ZERO;
        let old = Curve::Constant {
            pose,
            start_time: domain.start,
            end_time: domain.end,
        };
        let relative = -carrier.angular_velocity_at_time(0.).cross(point);
        let offset = fit_offset(point, rp::Vector::ZERO, pose.translation).unwrap();
        let invalid = Curve::Anchored {
            carrier,
            anchor: point,
            offset,
            linear_velocity: relative,
            rotation: pose.rotation,
        };
        assert!(same_pose(invalid.com_pose(0.), pose));
        assert_eq!(
            curve_velocity(invalid, 0.).unwrap(),
            (target, rp::Vector::ZERO)
        );
        let finish = invalid.com_pose(domain.end);
        assert_eq!(finish.translation.x.to_bits(), pose.translation.x.to_bits());
        assert!(finish.translation.y - pose.translation.y < -0.0001);
        assert!(finish.translation.z.abs() > 0.000001);
        // This actual full Box/Capsule curve is nonpenetrating for the whole
        // interval. That geometric fact does not authorize tangent acceleration.
        // Clearance zero here explicitly tests physical nonpenetration, not a
        // replacement for the unchanged runtime character skin policy.
        let wall = rp::SharedShape::cuboid(0.25, 10., 10.);
        let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
        let motion = |curve| crate::physics3d::solver_trajectory::ShapeMotion {
            curve,
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let mut work = Work {
            used: 0,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        };
        assert!(motion(Curve::Integrated(carrier))
            .separated(
                wall.as_ref(),
                motion(invalid),
                capsule.as_ref(),
                rp::Vector::X,
                0.,
                domain.end,
                0.,
                &mut work
            )
            .unwrap());
        assert!(crate::physics3d::solver_trajectory::cast_full_shapes(
            motion(Curve::Integrated(carrier)),
            wall.as_ref(),
            motion(invalid),
            capsule.as_ref(),
            0.,
            domain.end,
            0.,
            f64::from(0.025_f32 * 1e-6),
            &mut work
        )
        .unwrap()
        .is_none());
        let mut scratch = BackendMotionScratch::default();
        scratch.participants.push(Participant {
            body: id,
            pose,
            linear_velocity: target,
            angular_velocity: target,
            mass: MassPolicy::Character(10.),
        });
        scratch.character_values.push((id, target));
        scratch.character_rows.push(actual_rows::Row {
            a: 0,
            b: None,
            normal: rp::Vector::X,
            velocity: target,
        });
        assert!(scratch.proposal_rows_feasible(Some((id, target))).unwrap());
        for allow_rate_change in [false, true] {
            assert!(scratch
                .reference_proposal(
                    0,
                    carrier,
                    point,
                    old,
                    target,
                    0.,
                    0.,
                    allow_rate_change,
                    rp::Vector::ZERO,
                    rp::Vector::X,
                    &mut work,
                    &mut |_, _| Ok(true),
                )
                .unwrap()
                .is_none());
        }
        let q = rp::Rotation::from_xyzw(0., 0., 0.17696935, 0.98421645);
        let zero_omega = Kernel::from_velocity(
            carrier_id,
            domain,
            rp::Pose::from_parts(rp::Vector::ZERO, q),
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap();
        let far_point = rp::Vector::X * 1.0e6;
        assert_ne!(
            (zero_omega.native.motion.start.rotation * far_point)
                .to_array()
                .map(f32::to_bits),
            (zero_omega
                .native
                .position_at_integration_time(0.0125)
                .rotation
                * far_point)
                .to_array()
                .map(f32::to_bits),
            "the original zero-omega normalization branch moves this finite point"
        );
        assert!(!constant_reference_action(zero_omega, far_point, &mut work).unwrap());
        assert!(scratch
            .reference_proposal(
                0,
                zero_omega,
                far_point,
                old,
                target,
                0.,
                0.,
                true,
                rp::Vector::ZERO,
                rp::Vector::X,
                &mut work,
                &mut |_, _| Ok(true),
            )
            .unwrap()
            .is_none());
        let identity = Kernel::from_velocity(
            carrier_id,
            domain,
            rp::Pose::IDENTITY,
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap();
        assert!(constant_reference_action(identity, point, &mut work).unwrap());
        let translation = translation_reference(carrier, pose, target, 0.).unwrap();
        assert!(same_pose(translation.com_pose(domain.end), pose));
        assert_eq!(
            curve_velocity(translation, domain.end).unwrap(),
            (target, rp::Vector::ZERO)
        );
        assert_eq!(scratch.participants[0].linear_velocity, target);
        assert_eq!(scratch.character_values[0].1, target);
        assert!(scratch.row_impulses.is_empty());
    }

    #[test]
    fn support_normal_phase_keeps_tangent_terms_for_original_same_axis_kernel() {
        let domain = Domain::new(0.013, 0.037).unwrap();
        let carrier = Kernel::from_velocity(
            rp::RigidBodyHandle::from_raw_parts(1, 0),
            domain,
            rp::Pose::from_parts(
                rp::Vector::new(0.25, 0.1, -0.25),
                rp::Rotation::from_rotation_y(0.3),
            ),
            rp::Vector::new(1., -1e-7, -0.5),
            rp::Vector::Y * 2.,
        )
        .unwrap();
        let mut work = Work {
            used: 0,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        };
        assert_eq!(
            normal_phase_axis(carrier, rp::Vector::Y, &mut work).unwrap(),
            Some(1)
        );
        let old_anchor = rp::Vector::new(0.75, 0.1, -0.25);
        let next_anchor = rp::Vector::new(old_anchor.x, old_anchor.y.next_up(), old_anchor.z);
        let offset = rp::Vector::new(0.125, 0.5, -0.125);
        let relative = rp::Vector::new(-0.5, 0., 0.25);
        let old = Curve::Anchored {
            carrier,
            anchor: old_anchor,
            offset,
            linear_velocity: relative,
            rotation: rp::Rotation::IDENTITY,
        };
        let next = Curve::Anchored {
            carrier,
            anchor: next_anchor,
            offset,
            linear_velocity: relative,
            rotation: rp::Rotation::IDENTITY,
        };
        // Structural eligibility above is the proof. These original scalar
        // outputs are independent controls over interior/stored branch changes.
        for n in 0..=256 {
            let time = domain.start + domain.duration() * f64::from(n) / 256.;
            let a = old.com_pose(time);
            let b = next.com_pose(time);
            assert_eq!(a.translation.x.to_bits(), b.translation.x.to_bits());
            assert_eq!(a.translation.z.to_bits(), b.translation.z.to_bits());
            assert_eq!(
                a.rotation.to_array().map(f32::to_bits),
                b.rotation.to_array().map(f32::to_bits)
            );
            assert_eq!(
                curve_velocity(old, time).unwrap(),
                curve_velocity(next, time).unwrap()
            );
        }
        assert_eq!(
            normal_phase_axis(carrier, rp::Vector::X, &mut work).unwrap(),
            None
        );
        assert_eq!(
            normal_phase_axis(carrier, rp::Vector::new(0.1, 1., 0.), &mut work).unwrap(),
            None
        );
        let tilted = Kernel::from_velocity(
            carrier.native.motion.body,
            domain,
            rp::Pose::from_parts(rp::Vector::ZERO, rp::Rotation::from_rotation_x(0.2)),
            rp::Vector::ZERO,
            rp::Vector::Y * 2.,
        )
        .unwrap();
        assert_eq!(
            normal_phase_axis(tilted, rp::Vector::Y, &mut work).unwrap(),
            None
        );
        assert!(
            !constant_reference_action(carrier, old_anchor, &mut work).unwrap(),
            "a real-support normal phase does not authorize an angular SideRef"
        );
    }

    #[test]
    fn safe_fitting_search_keeps_later_inverse_cells_after_a_rejected_first_candidate() {
        let id = BodyId {
            slot: 0,
            generation: 0,
        };
        let domain = Domain::new(0., f64::from(0.025_f32)).unwrap();
        let base = rp::Vector::Y * -1.2895234e-7;
        let target = rp::Vector::Y * 1.2895232e-7;
        let carrier = Kernel::from_velocity(
            crate::physics3d::world::native_id(id),
            domain,
            rp::Pose::IDENTITY,
            base,
            rp::Vector::ZERO,
        )
        .unwrap();
        let pose = rp::Pose::from_translation(rp::Vector::new(0.25, 0., 0.25));
        let old = Curve::Integrated(
            Kernel::from_velocity(
                carrier.native.motion.body,
                domain,
                pose,
                target,
                rp::Vector::ZERO,
            )
            .unwrap(),
        );
        let physical = rp::Vector::new(3., 2., -1.);
        let mut scratch = BackendMotionScratch::default();
        scratch.participants.push(Participant {
            body: id,
            pose,
            linear_velocity: physical,
            angular_velocity: rp::Vector::ZERO,
            mass: MassPolicy::Character(10.),
        });
        scratch.character_values.push((id, target));
        scratch.character_rows.push(actual_rows::Row {
            a: 0,
            b: None,
            normal: rp::Vector::Y,
            velocity: target,
        });
        let mut work = Work {
            used: 0,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        };
        let mut visited = 0;
        let found = scratch
            .reference_proposal(
                0,
                carrier,
                rp::Vector::ZERO,
                old,
                target,
                0.,
                0.,
                true,
                rp::Vector::ZERO,
                rp::Vector::Y,
                &mut work,
                &mut |candidate, _| {
                    assert!(same_pose(candidate.curve.com_pose(0.), pose));
                    assert!((candidate.rate - target).dot(rp::Vector::Y) >= 0.);
                    visited += 1;
                    Ok(visited == 2)
                },
            )
            .unwrap()
            .expect("rejecting the first inverse must not discard the remaining cells");
        assert_eq!(visited, 2);
        assert_eq!(found.rate, curve_velocity(found.curve, 0.).unwrap().0);
        assert_eq!(scratch.participants[0].linear_velocity, physical);
        assert_eq!(scratch.character_values, [(id, target)]);
        assert!(scratch.row_impulses.is_empty());
        let cells = offset_cells(1., -1., 0.);
        assert!(cells.iter().flatten().count() > 1);
        for value in cells.into_iter().flatten() {
            assert_eq!((1. + value - 1.).to_bits(), 0.0_f32.to_bits());
        }
    }
}

#[cfg(test)]
mod work_tests;

#[cfg(test)]
mod peer_phase_tests {
    use super::*;

    fn clocks() -> (Kernel, Kernel) {
        let domain = Domain::new(0.09999988228091575, 0.10000000149011612).unwrap();
        let make = |slot, x| {
            Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::from_raw_parts(slot, 0),
                domain,
                f32::from_bits(0x33fffff3),
                rp::Pose::from_translation(rp::Vector::new(x, 0., 0.19999976)),
                rp::Vector::new(-60., 0., 2.),
                rp::Vector::ZERO,
            )
            .unwrap()
        };
        // Own is right Character0; the donor is left Character1.
        (make(0, -3.5099936), make(1, -4.019994))
    }
    fn work() -> Work {
        Work {
            used: 0,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        }
    }

    #[test]
    fn peer_native_phase_keeps_recorded_safe_tangents_rate_and_complete_pair_future() {
        let (own, peer) = clocks();
        let safe = 0.09999992698436588;
        let hit = 0.09999994188551593;
        let end = own.domain.end;
        let before = postcard::to_allocvec(&(own, peer)).unwrap();
        let run = |work: &mut Work| {
            let clock = PeerClock::new(own, peer, 0, safe, end, work)?.unwrap();
            let offset = clock.safe_pose.translation.x - clock.peer_range[0];
            assert_eq!(offset.to_bits(), 0x3f028f64);
            clock.candidate(offset, 0.01, work)
        };
        let mut proof = work();
        let candidate = run(&mut proof).unwrap().unwrap();
        assert_eq!(proof.used, 512 + 1280);
        for limit in [proof.used, proof.used - 1] {
            let result = run(&mut Work { used: 0, limit });
            if limit == proof.used {
                assert!(same_reference(result.unwrap().unwrap(), candidate));
            } else {
                assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
            }
        }
        assert!(same_pose(
            candidate.com_pose(safe),
            own.position_at_time(safe)
        ));
        let Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            ..
        } = candidate
        else {
            panic!("immutable peer clock phase");
        };
        assert!(same_kernel(carrier, peer));
        assert_ne!(carrier.native.motion.body, own.native.motion.body);
        assert_eq!(anchor, rp::Vector::ZERO);
        assert_eq!(linear_velocity, rp::Vector::ZERO);
        assert_eq!([offset.y.to_bits(), offset.z.to_bits()], [0, 0]);
        assert_eq!(
            curve_velocity(candidate, hit).unwrap(),
            (rp::Vector::new(-60., 0., 2.), rp::Vector::ZERO)
        );
        // Whole tangent equality follows from the identical original clocks,
        // velocities and tangent origins above; these are branch controls.
        for time in [own.domain.start, safe, hit, end] {
            let old = own.position_at_time(time);
            let new = candidate.com_pose(time);
            assert_eq!(
                [new.translation.y.to_bits(), new.translation.z.to_bits()],
                [old.translation.y.to_bits(), old.translation.z.to_bits()]
            );
            assert_eq!(
                new.rotation.to_array().map(f32::to_bits),
                old.rotation.to_array().map(f32::to_bits)
            );
        }
        let left = peer.position_at_time(hit).translation.x;
        assert_eq!(left.to_bits(), 0xc080a3d1);
        assert_eq!(
            own.position_at_time(hit).translation.x.to_bits(),
            0xc060a3cb
        );
        assert_eq!(candidate.com_pose(hit).translation.x.to_bits(), 0xc060a3c9);
        let old_gap = f64::from(own.position_at_time(hit).translation.x) - f64::from(left) - 0.5;
        let new_gap = f64::from(candidate.com_pose(hit).translation.x) - f64::from(left) - 0.5;
        assert_eq!(old_gap, 0.009999990463256836);
        assert_eq!(new_gap, 0.010000467300415039);
        assert!(old_gap < f64::from(0.01_f32) && new_gap > f64::from(0.01_f32));
        // All left X are on2^-21 and the offset on2^-22; the complete new
        // right range stays in the finer output binade. Thus every add is
        // exact there, as are both local .25 poles and real radii.
        assert!(peer.position_at_time(end).translation.x < -4.);
        assert!(candidate.com_pose(end).translation.x > -4.);
        assert_eq!(f64::from(offset.x) - 0.5, new_gap);
        let shape = rp::SharedShape::capsule_y(0.25, 0.25);
        let motion = |curve| crate::physics3d::solver_trajectory::ShapeMotion {
            curve,
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let tolerance =
            f64::from((own.native.motion.end_time - own.native.motion.start_time) * 1e-6_f32);
        let cast = |work: &mut Work| {
            crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
                motion(Curve::Integrated(peer)),
                shape.as_ref(),
                motion(candidate),
                shape.as_ref(),
                safe,
                end,
                0.01,
                tolerance,
                work,
                true,
            )
        };
        let mut query = work();
        assert!(cast(&mut query).unwrap().hit.is_none());
        for limit in [query.used, query.used - 1] {
            let result = cast(&mut Work { used: 0, limit });
            if limit == query.used {
                assert!(result.unwrap().hit.is_none());
            } else {
                assert_eq!(result.err().unwrap(), TrajectoryError::WorkLimit);
            }
        }
        let original = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
            motion(Curve::Integrated(peer)),
            shape.as_ref(),
            motion(Curve::Integrated(own)),
            shape.as_ref(),
            hit,
            end,
            0.01,
            tolerance,
            &mut work(),
            false,
        )
        .unwrap()
        .hit
        .expect("original strict world contact");
        assert_eq!(original.safe_time.to_bits(), hit.to_bits());
        assert_eq!(original.hit_time.to_bits(), hit.to_bits());
        assert_eq!(postcard::to_allocvec(&(own, peer)).unwrap(), before);
    }

    #[test]
    fn peer_phase_requires_original_clock_stored_branches_and_bounded_normal_roundoff() {
        let (own, peer) = clocks();
        let safe = 0.09999992698436588;
        let end = own.domain.end;
        for invalid in 0..4 {
            let mut other = peer;
            match invalid {
                0 => other.domain.end = other.domain.end.next_up(),
                1 => {
                    other.native.motion.end.translation.x =
                        other.native.motion.end.translation.x.next_up()
                }
                2 => {
                    other.native.motion.start.translation.z =
                        other.native.motion.start.translation.z.next_up();
                    other.native.motion.end.translation = other.native.motion.start.translation
                        + other.native.linear_velocity * other.native.integration_seconds;
                }
                _ => other.native.motion.end.rotation = rp::Rotation::from_rotation_z(0.1),
            }
            assert!(PeerClock::new(own, other, 0, safe, end, &mut work())
                .unwrap()
                .is_none());
        }
        // Small coefficients must not authorize a whole large-coordinate
        // F32 jump beyond skin, even if its safe pose can initially fit.
        let mut large_own = own;
        let mut large_peer = peer;
        for kernel in [&mut large_own, &mut large_peer] {
            kernel.native.motion.start.translation.x = 524_288.;
            kernel.native.motion.end.translation = kernel.native.motion.start.translation
                + kernel.native.linear_velocity * kernel.native.integration_seconds;
        }
        let clock = PeerClock::new(large_own, large_peer, 0, safe, end, &mut work())
            .unwrap()
            .unwrap();
        assert!(clock.candidate(0.01, 0.01, &mut work()).unwrap().is_none());
        assert!(clock
            .candidate(f32::INFINITY, 0.01, &mut work())
            .unwrap()
            .is_none());
        let mut different_tangent = peer;
        different_tangent.native.linear_velocity.z = 3.;
        different_tangent.native.motion.end.translation =
            different_tangent.native.motion.start.translation
                + different_tangent.native.linear_velocity
                    * different_tangent.native.integration_seconds;
        assert!(
            PeerClock::new(own, different_tangent, 0, safe, end, &mut work())
                .unwrap()
                .is_none()
        );
    }
}
