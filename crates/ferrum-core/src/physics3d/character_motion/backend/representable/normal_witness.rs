//! Real-support geometry phases for identity and pure normal-axis rotation. Original physical support and
//! carrier Kernel remain immutable; only the normal anchor/offset add chain
//! changes. The original witness candidates retain precedence.
use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn propose(
    carrier: Kernel,
    old_anchor: rp::Vector,
    old_offset: rp::Vector,
    relative: rp::Vector,
    rotation: rp::Rotation,
    axis: usize,
    witness: rp::Vector,
    witness_time: Time,
    safe: Time,
    probe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    accept: &mut impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    work.charge(512)?;
    if carrier.native.angular_velocity != rp::Vector::ZERO {
        return Ok(None);
    }
    let identity = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
    if carrier
        .native
        .motion
        .start
        .rotation
        .to_array()
        .map(f32::to_bits)
        != identity
        || carrier
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
    // For omega=0 every positive interior Native integration has the same
    // quaternion expression. Stored endpoints are separate exhaustive branches.
    let dt = carrier.native.integration_seconds.next_down();
    if dt > 0.
        && carrier
            .native
            .position_at_integration_time(dt)
            .rotation
            .to_array()
            .map(f32::to_bits)
            != identity
    {
        return Ok(None);
    }
    if !witness.is_finite() || !skin.is_finite() || skin < 0. {
        return Err(TrajectoryError::NonFinite);
    }
    let old = Curve::Anchored {
        carrier,
        anchor: old_anchor,
        offset: old_offset,
        linear_velocity: relative,
        rotation,
    };
    let safe_pose = old.com_pose(safe);
    let witness_coordinate = (witness - carrier.position_at_time(witness_time).translation)[axis];
    if !witness_coordinate.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let old_action = rp::Rotation::IDENTITY * old_anchor;
    let translation = carrier.position_at_time(safe).translation;
    let product =
        relative * ((safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32);
    // Common Native translation, with both constant actions handled by the
    // shared two-add guard. Carrier movement is not counted as a correction.
    let correction = ground_rate::CorrectionRange::from_curve(
        carrier,
        rp::Vector::ZERO,
        rotation,
        safe,
        end,
        axis,
        work,
    )?;
    let mut visited = [None; 4];
    for phase in 0..4 {
        let coordinate = if phase == 0 {
            witness_coordinate
        } else {
            // A witness at a coarse intermediate binade can preserve the
            // first safe pose yet recontact at the next carrier RN cell.
            // Half-cancellation around the original Native start COM offers
            // adjacent finer add phases without rebuilding its time kernel.
            // This is a proposal parameter, never a physical support anchor.
            work.charge(256)?;
            neighbors(-carrier.native.motion.start.translation[axis] * 0.5)[phase - 1]
        };
        if !coordinate.is_finite()
            || visited[..phase]
                .iter()
                .flatten()
                .any(|old: &f32| old.to_bits() == coordinate.to_bits())
        {
            continue;
        }
        visited[phase] = Some(coordinate);
        let mut anchor = old_anchor;
        anchor[axis] = coordinate;
        let new_action = rp::Rotation::IDENTITY * anchor;
        if (0..3).any(|i| i != axis && old_action[i].to_bits() != new_action[i].to_bits()) {
            continue;
        }
        let base = translation + new_action;
        let offsets = offset_cells(base[axis], product[axis], safe_pose.translation[axis]);
        for value in offsets.into_iter().flatten() {
            // Charge only an actually visited descriptor, before its guard/pose
            // arithmetic. An ineligible identity never reserves unvisited slots.
            work.charge(1280)?;
            let mut offset = old_offset;
            offset[axis] = value;
            if !correction
                .difference_split(
                    old_action[axis],
                    old_offset[axis],
                    new_action[axis],
                    value,
                    relative[axis],
                    relative[axis],
                )
                .is_some_and(|d| d <= f64::from(skin))
            {
                continue;
            }
            let candidate = Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity: relative,
                rotation,
            };
            if same_reference(candidate, old) || !same_pose(candidate.com_pose(safe), safe_pose) {
                continue;
            }
            if accept(candidate, work)? {
                return Ok(Some(Proposal {
                    curve: candidate,
                    rate: curve_velocity(candidate, probe)?.0,
                }));
            }
        }
    }
    // Keep every original phase/callback ahead of this optional inverse. A
    // previously successful proposal pays no new reservation or probe cost.
    const MAX_OFFSET_SEEDS: usize = 4 * 9;
    work.charge((std::mem::size_of::<[u32; MAX_OFFSET_SEEDS]>() + 64) as u64)?;
    if !translation.is_finite()
        || !product.is_finite()
        || !old_anchor.is_finite()
        || !old_offset.is_finite()
        || !safe_pose.translation.is_finite()
    {
        return Ok(None);
    }
    let mut seen = [0_u32; MAX_OFFSET_SEEDS];
    let mut seen_len = 0;
    for coordinate in visited.into_iter().flatten() {
        work.charge(512)?;
        let mut seed_anchor = old_anchor;
        seed_anchor[axis] = coordinate;
        let seed_action = rp::Rotation::IDENTITY * seed_anchor;
        if (0..3).any(|i| i != axis && old_action[i].to_bits() != seed_action[i].to_bits()) {
            continue;
        }
        let base = translation + seed_action;
        // These are exactly the original 3x3 offset nominations. Do not use
        // offset_cells' old-anchor fit filter: the new anchor is the unknown,
        // so an offset rejected at the seed anchor can have a valid preimage.
        for before in neighbors(safe_pose.translation[axis] - product[axis]) {
            for value in neighbors(before - base[axis]) {
                work.charge(1)?;
                if !value.is_finite() {
                    continue;
                }
                let bits = value.to_bits();
                let mut duplicate = false;
                for previous in &seen[..seen_len] {
                    work.charge(1)?;
                    if *previous == bits {
                        duplicate = true;
                        break;
                    }
                }
                if duplicate {
                    continue;
                }
                if seen_len == seen.len() {
                    return Err(TrajectoryError::WorkLimit);
                }
                seen[seen_len] = bits;
                seen_len += 1;
                let mut offset = old_offset;
                offset[axis] = value;
                let Some(bounds) = anchor_preimage(
                    translation,
                    old_anchor,
                    offset,
                    product,
                    safe_pose.translation[axis],
                    axis,
                    work,
                )?
                else {
                    continue;
                };
                for (end_index, coordinate) in bounds.into_iter().enumerate() {
                    if end_index == 1 && coordinate.to_bits() == bounds[0].to_bits() {
                        continue;
                    }
                    work.charge(1280)?;
                    let mut anchor = old_anchor;
                    anchor[axis] = coordinate;
                    let action = rp::Rotation::IDENTITY * anchor;
                    if (0..3).any(|i| i != axis && old_action[i].to_bits() != action[i].to_bits()) {
                        continue;
                    }
                    if !correction
                        .difference_split(
                            old_action[axis],
                            old_offset[axis],
                            action[axis],
                            value,
                            relative[axis],
                            relative[axis],
                        )
                        .is_some_and(|d| d <= f64::from(skin))
                    {
                        continue;
                    }
                    let candidate = Curve::Anchored {
                        carrier,
                        anchor,
                        offset,
                        linear_velocity: relative,
                        rotation,
                    };
                    if same_reference(candidate, old)
                        || !same_pose(candidate.com_pose(safe), safe_pose)
                    {
                        continue;
                    }
                    // This inverse only proposes a descriptor. The unchanged
                    // caller still checks actual rate/rows/hit improvement and
                    // the original full pair future before any scene staging.
                    if accept(candidate, work)? {
                        return Ok(Some(Proposal {
                            curve: candidate,
                            rate: curve_velocity(candidate, probe)?.0,
                        }));
                    }
                }
            }
        }
    }
    Ok(None)
}

// Total-order keys for the complete finite F32 domain, including both zeros.
fn ordered(value: f32) -> u32 {
    let bits = value.to_bits();
    if bits & 0x80000000 != 0 {
        !bits
    } else {
        bits ^ 0x80000000
    }
}
fn from_ordered(value: u32) -> f32 {
    f32::from_bits(if value & 0x80000000 != 0 {
        value ^ 0x80000000
    } else {
        !value
    })
}

/// Full finite-anchor preimage for the *identity* original scalar add chain.
/// For nonzero finite coordinates I*anchor is numeric identity; +0 maps to +0
/// and -0 maps to either zero, preserving total order. The following RN adds
/// with fixed finite operands are nondecreasing, including overflow end rays.
/// No quaternion, coefficient or clock is reconstructed in another precision.
fn anchor_preimage(
    translation: rp::Vector,
    anchor: rp::Vector,
    offset: rp::Vector,
    product: rp::Vector,
    target: f32,
    axis: usize,
    work: &mut Work,
) -> Result<Option<[f32; 2]>, TrajectoryError> {
    work.charge(64)?;
    if axis >= 3
        || !translation.is_finite()
        || !anchor.is_finite()
        || !offset.is_finite()
        || !product.is_finite()
        || !target.is_finite()
    {
        return Ok(None);
    }
    const FIRST: u32 = 0x00800000; // -MAX, inclusive
    const END: u32 = 0xff800000; // +MAX.next total-order key, exclusive
    let target_key = ordered(target);
    let mut forward = |key: u32| -> Result<Option<f32>, TrajectoryError> {
        work.charge(128)?;
        let mut actual = anchor;
        actual[axis] = from_ordered(key);
        let result = ((translation + rp::Rotation::IDENTITY * actual) + offset) + product;
        let value = result[axis];
        // With the finite premises the only possible nonfinite outputs are
        // +/-Inf, valid monotone search sentinels. Unexpected NaN declines.
        Ok((!value.is_nan()).then_some(value))
    };
    let (mut low, mut high) = (FIRST, END);
    for _ in 0..32 {
        if low == high {
            break;
        }
        let middle = low + (high - low) / 2;
        let Some(value) = forward(middle)? else {
            return Ok(None);
        };
        if ordered(value) < target_key {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    let first = low;
    if first == END {
        return Ok(None);
    }
    high = END;
    for _ in 0..32 {
        if low == high {
            break;
        }
        let middle = low + (high - low) / 2;
        let Some(value) = forward(middle)? else {
            return Ok(None);
        };
        if ordered(value) <= target_key {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    let last = low - 1;
    if last < first {
        return Ok(None);
    }
    let Some(value) = forward(first)? else {
        return Ok(None);
    };
    if value.to_bits() != target.to_bits() {
        return Ok(None);
    }
    if last != first {
        let Some(value) = forward(last)? else {
            return Ok(None);
        };
        if value.to_bits() != target.to_bits() {
            return Ok(None);
        }
    }
    Ok(Some([from_ordered(first), from_ordered(last)]))
}

/// Exact original case only: at most32 lines, no new geometric evaluation.
#[cfg(test)]
pub(super) fn rotating_trace(stage: &str, values: std::fmt::Arguments<'_>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    const CASE: &str =
        "physics3d::character_tests::rotating_platform_preserves_radius_over_a_full_turn";
    let thread = std::thread::current();
    if thread.name() != Some(CASE) {
        return;
    }
    static LINES: AtomicUsize = AtomicUsize::new(0);
    if let Ok(sequence) = LINES.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
        (n < 32).then_some(n + 1)
    }) {
        eprintln!(
            "B82_ROTATING_PHASE case={:?} seq={sequence} stage={stage} {values}",
            thread.name()
        );
    }
}

/// One real-support phase in the original same-axis rotation graph. The
/// physical support anchor is not read or changed here. A callback must still
/// validate exact rate/rows/hit improvement and the original whole pair future.
#[allow(clippy::too_many_arguments)]
pub(super) fn propose_rotating(
    carrier: Kernel,
    old_anchor: rp::Vector,
    old_offset: rp::Vector,
    relative: rp::Vector,
    rotation: rp::Rotation,
    axis: usize,
    witness: rp::Vector,
    witness_time: Time,
    safe: Time,
    probe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    accept: &mut impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    rotating_phase_core::<false>(
        carrier,
        old_anchor,
        old_offset,
        relative,
        rotation,
        axis,
        witness,
        witness_time,
        safe,
        probe,
        end,
        skin,
        work,
        accept,
    )
}

/// Rebased normal phase only after the original zero-tangent producer failed.
/// All existing offset/product tangent operations stay in their original order.
#[allow(clippy::too_many_arguments)]
pub(super) fn propose_rotating_rebased(
    carrier: Kernel,
    old_anchor: rp::Vector,
    old_offset: rp::Vector,
    relative: rp::Vector,
    rotation: rp::Rotation,
    axis: usize,
    witness: rp::Vector,
    witness_time: Time,
    safe: Time,
    probe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    accept: &mut impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    if axis >= 3 {
        return Err(TrajectoryError::InvalidTime);
    }
    if carrier.native.angular_velocity == rp::Vector::ZERO
        || !(0..3)
            .any(|i| i != axis && (old_offset[i].to_bits() != 0 || relative[i].to_bits() != 0))
    {
        return Ok(None);
    }
    rotating_phase_core::<true>(
        carrier,
        old_anchor,
        old_offset,
        relative,
        rotation,
        axis,
        witness,
        witness_time,
        safe,
        probe,
        end,
        skin,
        work,
        accept,
    )
}

#[allow(clippy::too_many_arguments)]
fn rotating_phase_core<const REBASED: bool>(
    carrier: Kernel,
    old_anchor: rp::Vector,
    old_offset: rp::Vector,
    relative: rp::Vector,
    rotation: rp::Rotation,
    axis: usize,
    witness: rp::Vector,
    witness_time: Time,
    safe: Time,
    probe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    accept: &mut impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    // Preserve the identity candidate sequence and every original price.
    if carrier.native.angular_velocity == rp::Vector::ZERO {
        return Ok(None);
    }
    work.charge(512)?;
    Kernel::from_native(carrier.native, carrier.domain)?;
    if rotation.to_array().map(f32::to_bits) != rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
    {
        return Ok(None);
    }
    if axis >= 3
        || !safe.is_finite()
        || !end.is_finite()
        || safe >= end
        || safe < carrier.domain.start
        || end > carrier.domain.end
        || !witness_time.is_finite()
        || witness_time < safe
        || witness_time > end
        || !probe.is_finite()
        || probe < safe
        || probe > end
    {
        return Err(TrajectoryError::InvalidTime);
    }
    if !old_anchor.is_finite()
        || !old_offset.is_finite()
        || !relative.is_finite()
        || !witness.is_finite()
        || !skin.is_finite()
        || skin < 0.
    {
        return Err(TrajectoryError::NonFinite);
    }
    // q/omega have only this normal axis. Normal-anchor changes leave the
    // numeric tangent rotation outputs unchanged. Any possible difference of
    // zero signs is removed by the FIRST RN(+0 + R_t): the original carrier's
    // stored start/end tangent translations and tangent velocity are +0.
    // Then both descriptors add the SAME arbitrary finite tangent offset and
    // the SAME RN(relative_t * logical_dt), in the original order. Thus every
    // tangent COM bit is identical, not merely its ideal algebraic sum.
    // const false retains the original producer's narrower zero-only contract.
    for i in 0..3 {
        if i != axis
            && (carrier.native.angular_velocity[i] != 0.
                || carrier.native.motion.start.rotation.to_array()[i] != 0.
                || carrier.native.motion.end.rotation.to_array()[i] != 0.
                || carrier.native.linear_velocity[i].to_bits() != 0
                || carrier.native.motion.start.translation[i].to_bits() != 0
                || carrier.native.motion.end.translation[i].to_bits() != 0
                || (!REBASED && (old_offset[i].to_bits() != 0 || relative[i].to_bits() != 0)))
        {
            return Ok(None);
        }
    }
    let old = Curve::Anchored {
        carrier,
        anchor: old_anchor,
        offset: old_offset,
        linear_velocity: relative,
        rotation,
    };
    let safe_pose = old.com_pose(safe);
    let at_witness = carrier.position_at_time(witness_time);
    let coordinate = (witness - at_witness.translation)[axis];
    if !coordinate.is_finite() || !safe_pose.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    // A positive same-sign normal action keeps every zero tangent product's
    // sign consistent as well. Other geometry retains the original fallback.
    if coordinate <= 0. || old_anchor[axis] <= 0. {
        return Ok(None);
    }
    let mut anchor = old_anchor;
    anchor[axis] = coordinate;
    if coordinate.to_bits() == old_anchor[axis].to_bits() {
        return Ok(None);
    }
    // Remove translation only in a private proof value. This preserves the
    // original quaternion multiplication/normalize graph, stored rotations,
    // physical h and logical Domain. It is not a new integration authority.
    let mut rotation_only = carrier;
    rotation_only.native.motion.start.translation = rp::Vector::ZERO;
    rotation_only.native.motion.end.translation = rp::Vector::ZERO;
    rotation_only.native.linear_velocity = rp::Vector::ZERO;
    let action_range = |coordinate: f32, work: &mut Work| {
        let mut normal_anchor = rp::Vector::ZERO;
        normal_anchor[axis] = coordinate;
        let point = crate::physics3d::solver_trajectory::ShapeMotion {
            curve: Curve::Anchored {
                carrier: rotation_only,
                anchor: normal_anchor,
                offset: rp::Vector::ZERO,
                linear_velocity: rp::Vector::ZERO,
                rotation: rp::Rotation::IDENTITY,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        point
            .bounds(&rapier3d::parry::shape::Ball::new(0.), safe, end, work)
            .map(|b| [b.mins[axis], b.maxs[axis]])
    };
    let old_action = action_range(old_anchor[axis], work)?;
    let new_action = action_range(coordinate, work)?;
    #[cfg(test)]
    rotating_trace("complete-action-bounds", format_args!(
        "safe={safe:.18e} hit={witness_time:.18e} end={end:.18e} axis={axis} anchor={old_anchor:?} old_offset={old_offset:?} coordinate={coordinate} old_action={old_action:?} new_action={new_action:?} work={}", work.used));
    if old_action[0] <= 0. || new_action[0] <= 0. {
        return Ok(None);
    }
    let correction = ground_rate::CorrectionRange::from_curve(
        carrier,
        rp::Vector::ZERO,
        rotation,
        safe,
        end,
        axis,
        work,
    )?;
    let base = carrier.position_at_time(safe);
    let base = base.translation + base.rotation * anchor;
    let product =
        relative * ((safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32);
    let offsets = offset_cells(base[axis], product[axis], safe_pose.translation[axis]);
    let mut witness_retries = offsets.map(|_| None);
    for (index, offset) in offsets.into_iter().enumerate() {
        let Some(value) = offset else { continue };
        work.charge(1280)?;
        let amplitude = correction.difference_actions(
            old_action,
            old_offset[axis],
            new_action,
            value,
            relative[axis],
        );
        #[cfg(test)]
        rotating_trace(
            "normal-amplitude",
            format_args!(
                "anchor={coordinate} offset={value} bound={amplitude:?} skin={skin} work={}",
                work.used
            ),
        );
        if !amplitude.is_some_and(|distance| distance <= f64::from(skin)) {
            witness_retries[index] = Some(value);
            continue;
        }
        let mut offset = old_offset;
        offset[axis] = value;
        let candidate = Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: relative,
            rotation,
        };
        if same_reference(candidate, old) || !same_pose(candidate.com_pose(safe), safe_pose) {
            continue;
        }
        if accept(candidate, work)? {
            return Ok(Some(Proposal {
                curve: candidate,
                rate: curve_velocity(candidate, witness_time)?.0,
            }));
        }
    }
    // This optional phase is for the already projected stationary normal.
    // Downward/upward canonical motion keeps its original candidate sequence.
    if relative[axis] != 0. {
        return Ok(None);
    }
    let q = at_witness.rotation.to_array();
    if q[3] * q[3] < q[axis] * q[axis] {
        // The positive-scale anchor inverse below is unavailable on this
        // branch. Try nearby original coordinates through the forward pose
        // check and the same displacement/whole-future gates.
        let range = |coordinate, work: &mut Work| {
            crate::physics3d::solver_trajectory::normal_action_range(
                carrier, axis, safe, end, coordinate, work,
            )
        };
        if let Some(old_bounds) = range(old_anchor[axis], work)? {
            let safe_carrier = carrier.position_at_time(safe);
            let mut try_phase = |coordinate,
                                 value,
                                 work: &mut Work|
             -> Result<Option<Proposal>, TrajectoryError> {
                work.charge(1280)?;
                let mut anchor = old_anchor;
                let mut offset = old_offset;
                anchor[axis] = coordinate;
                offset[axis] = value;
                let candidate = Curve::Anchored {
                    carrier,
                    anchor,
                    offset,
                    linear_velocity: relative,
                    rotation,
                };
                if same_reference(candidate, old) || !same_pose(candidate.com_pose(safe), safe_pose)
                {
                    return Ok(None);
                }
                let Some(bounds) = range(coordinate, work)? else {
                    return Ok(None);
                };
                if !correction
                    .difference_actions(old_bounds, old_offset[axis], bounds, value, relative[axis])
                    .is_some_and(|distance| distance <= f64::from(skin))
                    || !accept(candidate, work)?
                {
                    return Ok(None);
                }
                Ok(Some(Proposal {
                    curve: candidate,
                    rate: curve_velocity(candidate, witness_time)?.0,
                }))
            };
            let neighbor = coordinate.next_up();
            let pair = neighbor.next_up();
            let denied_witness = witness_retries
                .iter()
                .any(Option::is_some)
                .then_some(coordinate);
            for coordinate in denied_witness
                .into_iter()
                .chain([neighbor, pair, pair.next_up()])
            {
                work.charge(512)?;
                if !coordinate.is_finite() {
                    continue;
                }
                let mut anchor = old_anchor;
                anchor[axis] = coordinate;
                let base = safe_carrier.translation + safe_carrier.rotation * anchor;
                for value in offset_cells(base[axis], product[axis], safe_pose.translation[axis])
                    .into_iter()
                    .flatten()
                {
                    if denied_witness == Some(coordinate) && !witness_retries.contains(&Some(value))
                    {
                        continue;
                    }
                    if let Some(proposal) = try_phase(coordinate, value, work)? {
                        return Ok(Some(proposal));
                    }
                }
            }

            // A one-step offset change can move the fitting anchor by
            // several steps on a different F32 grid. Estimate each cell's
            // upper edge from the local ideal slope. The signed F32 action
            // can have interior reversals, so only the forward safe-pose
            // comparison may admit a nearby coordinate.
            work.charge(512)?;
            let q = safe_carrier.rotation.to_array();
            let axial = f64::from(q[axis]);
            let scale = q[3] * q[3] - q[axis] * q[axis];
            let slope = f64::from(scale) + 2. * axial * axial;
            if slope.is_finite() && slope > 0. {
                let target = safe_pose.translation[axis];
                let upper = (f64::from(target) + f64::from(target.next_up())) * 0.5;
                let seed = (target - product[axis]) - base[axis];
                let mut offsets = [seed; 2];
                const OFFSET_STEPS: usize = 8;
                for _ in 0..OFFSET_STEPS {
                    offsets = [offsets[0].next_up(), offsets[1].next_down()];
                    for value in offsets {
                        work.charge(128)?;
                        let action =
                            upper - f64::from(value) - f64::from(safe_carrier.translation[axis]);
                        let estimate = (action / slope) as f32;
                        if !estimate.is_finite() || estimate <= 0. {
                            continue;
                        }
                        const SEARCH_STEPS: u32 = 4;
                        let key = estimate.to_bits();
                        let first = key.saturating_sub(SEARCH_STEPS).max(1);
                        let last = (key + SEARCH_STEPS).min(f32::MAX.to_bits());
                        for bits in (first..=last).rev() {
                            if let Some(proposal) = try_phase(f32::from_bits(bits), value, work)? {
                                return Ok(Some(proposal));
                            }
                        }
                    }
                }
            }
        }
    }
    // Keep all original witness candidates and their successful prices first.
    // At fixed offset, the entire positive-anchor preimage of the represented
    // safe coordinate can span several F32 values. The witness is only one
    // member and may recontact later even though another endpoint does not.
    work.charge(128 + std::mem::size_of::<[u32; 9]>() as u64)?;
    let safe_carrier = carrier.position_at_time(safe);
    let mut seen = [0_u32; 9];
    let mut preimage_retries = [[None; 2]; 9];
    let mut seen_len = 0;
    for before in neighbors(safe_pose.translation[axis] - product[axis])
        .into_iter()
        .rev()
    {
        // Reuse the original raw offset seeds, without filtering against the
        // single witness anchor: here the anchor is the unknown inverse.
        for value in neighbors(before - base[axis]).into_iter().rev() {
            work.charge(1)?;
            if !value.is_finite() {
                continue;
            }
            let mut duplicate = false;
            for previous in &seen[..seen_len] {
                work.charge(1)?;
                if *previous == value.to_bits() {
                    duplicate = true;
                    break;
                }
            }
            if duplicate {
                continue;
            }
            seen[seen_len] = value.to_bits();
            seen_len += 1;
            let mut offset = old_offset;
            offset[axis] = value;
            let Some(bounds) = rotating_anchor_preimage(
                safe_carrier,
                old_anchor,
                offset,
                product,
                safe_pose.translation[axis],
                axis,
                work,
            )?
            else {
                continue;
            };
            // The upper endpoint precedes the lower only in this new optional
            // sequence. Neither endpoint is a motion or separation authority.
            for (slot, coordinate) in bounds.into_iter().rev().enumerate() {
                if coordinate <= 0.
                    || coordinate.to_bits() == anchor[axis].to_bits()
                    || (slot == 1 && coordinate.to_bits() == bounds[1].to_bits())
                {
                    continue;
                }
                work.charge(1280)?;
                let new_action = action_range(coordinate, work)?;
                if new_action[0] <= 0. {
                    continue;
                }
                if !correction
                    .difference_actions(
                        old_action,
                        old_offset[axis],
                        new_action,
                        value,
                        relative[axis],
                    )
                    .is_some_and(|distance| distance <= f64::from(skin))
                {
                    preimage_retries[seen_len - 1][slot] = Some((coordinate, value));
                    continue;
                }
                let mut anchor = old_anchor;
                anchor[axis] = coordinate;
                let candidate = Curve::Anchored {
                    carrier,
                    anchor,
                    offset,
                    linear_velocity: relative,
                    rotation,
                };
                if same_reference(candidate, old) || !same_pose(candidate.com_pose(safe), safe_pose)
                {
                    continue;
                }
                if accept(candidate, work)? {
                    return Ok(Some(Proposal {
                        curve: candidate,
                        rate: curve_velocity(candidate, witness_time)?.0,
                    }));
                }
            }
        }
    }
    // Preserve both legacy sequences. Retry only candidates excluded by
    // the broad correction bound, in the same witness/preimage order.
    let mut retries = witness_retries
        .into_iter()
        .flatten()
        .map(|value| (anchor[axis], value))
        .chain(preimage_retries.into_iter().flatten().flatten())
        .peekable();
    if retries.peek().is_none() {
        return Ok(None);
    }
    let range = |coordinate, work: &mut Work| {
        crate::physics3d::solver_trajectory::normal_action_range(
            carrier, axis, safe, end, coordinate, work,
        )
    };
    let Some(old_action) = range(old_anchor[axis], work)? else {
        return Ok(None);
    };
    if old_action[0] <= 0. {
        return Ok(None);
    }
    let mut previous_range = None;
    for (coordinate, value) in retries {
        work.charge(1280)?;
        let bits = coordinate.to_bits();
        let new_action = match previous_range {
            Some((previous, action)) if previous == bits => action,
            _ => {
                let action = range(coordinate, work)?;
                previous_range = Some((bits, action));
                action
            }
        };
        let Some(new_action) = new_action else {
            continue;
        };
        if new_action[0] <= 0. {
            continue;
        }
        let distance = correction.difference_actions(
            old_action,
            old_offset[axis],
            new_action,
            value,
            relative[axis],
        );
        #[cfg(test)]
        rotating_trace(
            "refined-normal-amplitude",
            format_args!(
                "anchor={coordinate} offset={value} bound={distance:?} skin={skin} work={}",
                work.used,
            ),
        );
        if !distance.is_some_and(|distance| distance <= f64::from(skin)) {
            continue;
        }
        let mut anchor = old_anchor;
        anchor[axis] = coordinate;
        let mut offset = old_offset;
        offset[axis] = value;
        let candidate = Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: relative,
            rotation,
        };
        if same_reference(candidate, old) || !same_pose(candidate.com_pose(safe), safe_pose) {
            continue;
        }
        if accept(candidate, work)? {
            return Ok(Some(Proposal {
                curve: candidate,
                rate: curve_velocity(candidate, witness_time)?.0,
            }));
        }
    }
    Ok(None)
}

/// The original pure-axis normal action is monotone for nonnegative anchors
/// when S=RN(w*w-dot(b,b))>0. Its two terms are RN(p*S) and
/// RN(q*RN(2*RN(p*q))); the latter is nondecreasing even for q<0.
/// The normal cross term is zero and uses only the unchanged finite tangents.
/// Finite p may overflow the action to +Inf, a valid search sentinel. This
/// proves a safe scalar inverse only; all seven pose bits and the whole-future
/// callback are independently checked before the descriptor is selected.
#[allow(clippy::too_many_arguments)]
fn rotating_anchor_preimage(
    pose: rp::Pose,
    anchor: rp::Vector,
    offset: rp::Vector,
    product: rp::Vector,
    target: f32,
    axis: usize,
    work: &mut Work,
) -> Result<Option<[f32; 2]>, TrajectoryError> {
    work.charge(128)?;
    if axis >= 3
        || !pose.is_finite()
        || !anchor.is_finite()
        || !offset.is_finite()
        || !product.is_finite()
        || !target.is_finite()
    {
        return Ok(None);
    }
    let q = pose.rotation.to_array();
    if (0..3).any(|i| i != axis && q[i] != 0.) {
        return Ok(None);
    }
    let b = rp::Vector::new(q[0], q[1], q[2]);
    let scale = q[3] * q[3] - b.dot(b);
    if !scale.is_finite() || scale <= 0. {
        return Ok(None);
    }
    const END: u32 = 0x7f800000; // +MAX successor, exclusive
    let mut forward = |bits: u32| -> Result<Option<f32>, TrajectoryError> {
        work.charge(128)?;
        let mut actual = anchor;
        actual[axis] = f32::from_bits(bits);
        let value = (((pose.translation + pose.rotation * actual) + offset) + product)[axis];
        Ok((!value.is_nan()).then_some(value))
    };
    let target_key = ordered(target);
    let mut bounds = [0_u32; 2];
    for (side, bound) in bounds.iter_mut().enumerate() {
        let (mut low, mut high) = (0_u32, END);
        for _ in 0..32 {
            if low == high {
                break;
            }
            let middle = low + (high - low) / 2;
            let Some(value) = forward(middle)? else {
                return Ok(None);
            };
            if ordered(value) < target_key || (side == 1 && ordered(value) == target_key) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        if side == 0 {
            *bound = low;
        } else {
            if low == 0 {
                return Ok(None);
            }
            *bound = low - 1;
        }
    }
    if bounds[0] > bounds[1] || bounds[1] >= END {
        return Ok(None);
    }
    for bound in bounds {
        if !forward(bound)?.is_some_and(|value| value.to_bits() == target.to_bits()) {
            return Ok(None);
        }
    }
    Ok(Some(bounds.map(f32::from_bits)))
}

// A stationary character can keep its safe pose while following the rounding
// of a pure-axis box face. This anchor provides a normal-coordinate expression
// only. It has zero analytic rate and never attaches a physical support.
#[allow(clippy::too_many_arguments)]
fn stationary_face_phase(
    own: Kernel,
    carrier: Kernel,
    normal: rp::Vector,
    half: f32,
    safe: Time,
    probe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    mut accept: impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    let Some(axis) = normal_phase_axis(carrier, normal, work)? else {
        return Ok(None);
    };
    let pose = own.native.motion.start;
    let base = carrier.native.motion.start.translation;
    let identity = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
    if normal[axis] != 1.
        || !(half.is_finite() && half > 0. && skin.is_finite() && skin > 0.)
        || !(carrier.domain.start <= safe && safe.next_up() == probe && probe <= end)
        || end > carrier.domain.end
        || safe < own.domain.start
        || end > own.domain.end
        || pose.rotation.to_array().map(f32::to_bits) != identity
        || !same_pose(pose, own.native.motion.end)
        || own.native.linear_velocity.to_array().map(f32::to_bits) != [0; 3]
        || own.native.angular_velocity.to_array().map(f32::to_bits) != [0; 3]
        || carrier.native.angular_velocity[axis] == 0.
        || carrier.native.linear_velocity.to_array().map(f32::to_bits) != [0; 3]
        || base.to_array().map(f32::to_bits)
            != carrier
                .native
                .motion
                .end
                .translation
                .to_array()
                .map(f32::to_bits)
        || (0..3).any(|i| {
            i != axis
                && (base[i].to_bits() != 0 || pose.translation[i].to_bits() == (-0.0_f32).to_bits())
        })
    {
        return Ok(None);
    }
    let at_safe = carrier.position_at_time(safe);
    let mut coordinate = half;
    for _ in 0..4 {
        work.charge(512)?;
        coordinate = coordinate.next_up();
        if !coordinate.is_finite() {
            break;
        }
        let mut anchor = rp::Vector::ZERO;
        anchor[axis] = coordinate;
        let center = (at_safe.translation + at_safe.rotation * anchor)[axis];
        let mut action = None;
        for value in offset_cells(center, 0., pose.translation[axis])
            .into_iter()
            .flatten()
        {
            work.charge(256)?;
            let mut offset = pose.translation;
            offset[axis] = value;
            let candidate = Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity: rp::Vector::ZERO,
                rotation: pose.rotation,
            };
            if !same_pose(candidate.com_pose(safe), pose)
                || candidate.com_pose(probe).translation[axis] <= pose.translation[axis]
            {
                continue;
            }
            if action.is_none() {
                action = crate::physics3d::solver_trajectory::normal_action_range(
                    carrier, axis, safe, end, coordinate, work,
                )?;
            }
            let Some([lo, hi]) = action else { break };
            // Tangent terms are all +0 before adding the preserved offset, so
            // this directed normal bound covers the entire displacement.
            let distance = [lo, hi]
                .into_iter()
                .map(|x| {
                    let reached = (base[axis] + x) + value;
                    (f64::from(reached) - f64::from(pose.translation[axis]))
                        .abs()
                        .next_up()
                })
                .fold(0., f64::max);
            if distance <= f64::from(skin) && accept(candidate, work)? {
                return Ok(Some(Proposal {
                    curve: candidate,
                    rate: rp::Vector::ZERO,
                }));
            }
        }
    }
    Ok(None)
}

/// A paired F32 face expression for an otherwise fixed represented capsule.
/// Move only the evaluation frame by adjacent translation values. The real
/// platform, its rotation clock, and both physical point rates stay unchanged.
#[allow(clippy::too_many_arguments)]
fn translated_face_phase(
    own: Kernel,
    carrier: Kernel,
    normal: rp::Vector,
    half: f32,
    rate: rp::Vector,
    safe: Time,
    probe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    mut accept: impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    let Some(axis) = normal_phase_axis(carrier, normal, work)? else {
        return Ok(None);
    };
    let rotation = rp::Rotation::IDENTITY;
    let height = carrier.native.motion.start.translation[axis];
    let pose = own.native.motion.start;
    if normal[axis] != 1.
        || !(half.is_finite() && half > 0. && skin.is_finite() && skin > 0.)
        || !height.is_finite()
        || !rate.is_finite()
        || !(carrier.domain.start <= safe && safe.next_up() == probe && probe <= end)
        || end > carrier.domain.end
        || safe < own.domain.start
        || end > own.domain.end
        || own.native.angular_velocity != rp::Vector::ZERO
        || !same_pose(rp::Pose::from_parts(pose.translation, rotation), pose)
        || !same_pose(pose, own.native.motion.end)
        || (0..3).any(|i| {
            i != axis
                && (carrier.native.linear_velocity[i] != 0.
                    || carrier.native.motion.start.translation[i].to_bits() != 0
                    || carrier.native.motion.end.translation[i].to_bits() != 0
                    || own.native.linear_velocity[i] != 0.
                    || rate[i] != 0.
                    || pose.translation[i].to_bits() == (-0.0_f32).to_bits())
        })
    {
        return Ok(None);
    }
    let last = own.native.integration_seconds.next_down();
    let carrier_last = carrier.native.integration_seconds.next_down();
    if !same_pose(pose, own.native.position_at_integration_time(last)) {
        return Ok(None);
    }
    let Some(relative) = fit_relative(carrier.linear_velocity_at_time(), rate) else {
        return Ok(None);
    };
    let elapsed = (safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
    let product = relative * elapsed;
    let mut fit = |frame: Kernel, coordinate, work: &mut Work| {
        work.charge(512)?;
        let mut anchor = rp::Vector::ZERO;
        anchor[axis] = coordinate;
        let at = frame.position_at_time(safe);
        let base = (at.translation + at.rotation * anchor)[axis];
        for value in offset_cells(base, product[axis], pose.translation[axis])
            .into_iter()
            .flatten()
        {
            work.charge(256)?;
            let mut offset = pose.translation;
            offset[axis] = value;
            let candidate = Curve::Anchored {
                carrier: frame,
                anchor,
                offset,
                linear_velocity: relative,
                rotation,
            };
            if !same_pose(candidate.com_pose(safe), pose)
                || candidate.com_pose(probe).translation[axis] <= pose.translation[axis]
            {
                continue;
            }
            let point = crate::physics3d::solver_trajectory::ShapeMotion {
                curve: candidate,
                local_center: rp::Vector::ZERO,
                local_pose: rp::Pose::IDENTITY,
            };
            let bounds = point.bounds(&rapier3d::parry::shape::Ball::new(0.), safe, end, work)?;
            let distance = [bounds.mins[axis], bounds.maxs[axis]]
                .into_iter()
                .map(|value| {
                    (f64::from(value) - f64::from(pose.translation[axis]))
                        .abs()
                        .next_up()
                })
                .fold(0., f64::max);
            if distance <= f64::from(skin) && accept(candidate, work)? {
                return Ok(Some(Proposal {
                    curve: candidate,
                    rate,
                }));
            }
        }
        Ok::<_, TrajectoryError>(None)
    };
    let fixed_height = height.to_bits() == carrier.native.motion.end.translation[axis].to_bits()
        && height.to_bits()
            == carrier
                .native
                .position_at_integration_time(carrier_last)
                .translation[axis]
                .to_bits();
    if fixed_height {
        for translated in [height.next_up(), height.next_down()] {
            work.charge(256)?;
            let mut frame = carrier;
            frame.native.motion.body = own.native.motion.body;
            frame.native.motion.start.translation[axis] = translated;
            frame.native.motion.end.translation[axis] = translated;
            if !translated.is_finite()
                || frame
                    .native
                    .position_at_integration_time(carrier_last)
                    .translation[axis]
                    .to_bits()
                    != translated.to_bits()
            {
                continue;
            }
            if let Some(phase) = fit(frame, half, work)? {
                return Ok(Some(phase));
            }
        }
    }
    let q = carrier.position_at_time(probe).rotation.to_array();
    if q[3] * q[3] < q[axis] * q[axis] {
        // A rounded point just inside the face can have a different
        // normal phase. Keep the original rotating clock and vertical
        // movement while testing those same near-face coordinates.
        const INWARD_POINTS: usize = 32;
        const OUTWARD_POINTS: usize = 8;
        let mut inside = half;
        let mut outside = half;
        for step in 0..INWARD_POINTS {
            inside = inside.next_down();
            if inside > 0. {
                if let Some(phase) = fit(carrier, inside, work)? {
                    return Ok(Some(phase));
                }
            }
            if step < OUTWARD_POINTS {
                outside = outside.next_up();
                if outside.is_finite() {
                    if let Some(phase) = fit(carrier, outside, work)? {
                        return Ok(Some(phase));
                    }
                }
            }
        }
    }
    Ok(None)
}

// A small original normal rate can leave every represented COM bit fixed.
// Retain its analytic rate and look for an exact safe-height inverse around
// the rotating face. The carrier supplies geometry only, never support.
#[allow(clippy::too_many_arguments)]
fn representably_still_face_phase(
    own: Kernel,
    carrier: Kernel,
    normal: rp::Vector,
    half: f32,
    safe: Time,
    probe: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
    mut accept: impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Proposal>, TrajectoryError> {
    let Some(axis) = normal_phase_axis(carrier, normal, work)? else {
        return Ok(None);
    };
    let pose = own.native.motion.start;
    let identity = rp::Rotation::IDENTITY;
    if normal[axis] != 1.
        || !(half.is_finite() && half > 0. && skin.is_finite() && skin > 0.)
        || !(carrier.domain.start <= safe && safe.next_up() == probe && probe <= end)
        || end > carrier.domain.end
        || safe < own.domain.start
        || end > own.domain.end
        || pose.rotation.to_array().map(f32::to_bits) != identity.to_array().map(f32::to_bits)
        || own.native.angular_velocity != rp::Vector::ZERO
        || carrier.native.angular_velocity[axis] == 0.
        || (0..3).any(|i| {
            i != axis
                && (own.native.linear_velocity[i] != 0.
                    || carrier.native.linear_velocity[i] != 0.
                    || carrier.native.motion.start.translation[i].to_bits() != 0
                    || carrier.native.motion.end.translation[i].to_bits() != 0
                    || pose.translation[i].to_bits() == (-0.0_f32).to_bits())
        })
    {
        return Ok(None);
    }
    // Original linear translation is monotone before the saved endpoint.
    // Checking its last interior pose and the saved endpoint covers all
    // represented inputs, including a small rate that never changes position.
    let interior_end = own
        .native
        .position_at_integration_time(own.native.integration_seconds.next_down());
    if !same_pose(pose, interior_end) || !same_pose(pose, own.native.motion.end) {
        return Ok(None);
    }
    let rate = own.linear_velocity_at_time();
    let Some(relative) = fit_relative(carrier.linear_velocity_at_time(), rate) else {
        return Ok(None);
    };
    let base = carrier.position_at_time(safe);
    let elapsed = (safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
    let product = relative * elapsed;
    let mut anchor = rp::Vector::ZERO;
    anchor[axis] = half;
    let seed = (pose.translation[axis] - product[axis])
        - (base.translation + base.rotation * anchor)[axis];
    const MAX_OFFSET_STEPS: usize = 128;
    for increase in [true, false] {
        let mut value = seed;
        for _ in 0..MAX_OFFSET_STEPS {
            value = if increase {
                value.next_up()
            } else {
                value.next_down()
            };
            work.charge(128)?;
            let mut offset = pose.translation;
            offset[axis] = value;
            let Some([_, upper]) = rotating_anchor_preimage(
                base,
                anchor,
                offset,
                product,
                pose.translation[axis],
                axis,
                work,
            )?
            else {
                continue;
            };
            let mut fitted = anchor;
            fitted[axis] = upper;
            let candidate = Curve::Anchored {
                carrier,
                anchor: fitted,
                offset,
                linear_velocity: relative,
                rotation: pose.rotation,
            };
            if !same_pose(candidate.com_pose(safe), pose)
                || candidate.com_pose(probe).translation[axis] <= pose.translation[axis]
                || curve_velocity(candidate, probe)?
                    .0
                    .to_array()
                    .map(f32::to_bits)
                    != rate.to_array().map(f32::to_bits)
            {
                continue;
            }
            let point = crate::physics3d::solver_trajectory::ShapeMotion {
                curve: candidate,
                local_center: rp::Vector::ZERO,
                local_pose: rp::Pose::IDENTITY,
            };
            let bounds = point.bounds(&rapier3d::parry::shape::Ball::new(0.), safe, end, work)?;
            let distance = [bounds.mins[axis], bounds.maxs[axis]]
                .into_iter()
                .map(|value| {
                    (f64::from(value) - f64::from(pose.translation[axis]))
                        .abs()
                        .next_up()
                })
                .fold(0., f64::max);
            if distance <= f64::from(skin) && accept(candidate, work)? {
                return Ok(Some(Proposal {
                    curve: candidate,
                    rate,
                }));
            }
        }
    }
    Ok(None)
}

impl BackendMotionScratch {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::physics3d::character_motion::backend) fn stationary_face_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        rebased: Option<Kernel>,
        planar: bool,
        work: &mut Work,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        let entry = self.entries[index];
        if !self.rows.is_empty()
            || hit.cast.safe_time != safe
            || hit.cast.hit_time != safe.next_up()
            || !(hit.cast.contact.dist > 0.)
        {
            return Ok(None);
        }
        let own = match (rebased, entry.curve) {
            (Some(own), _) | (None, Curve::Integrated(own)) => own,
            _ => return Ok(None),
        };
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
        if face.role != Role::Prescribed || actor.sensor || face.sensor {
            return Ok(None);
        }
        let Curve::Integrated(carrier) = face.motion.curve else {
            return Ok(None);
        };
        let Some(axis) = coordinate_normal_axis(normal) else {
            return Ok(None);
        };
        work.charge(256)?;
        if !characters
            .get(&id)
            .is_some_and(|r| r.config.push_mass == 0.)
            || [actor.motion, face.motion].iter().any(|m| {
                m.local_center != rp::Vector::ZERO || !same_pose(m.local_pose, rp::Pose::IDENTITY)
            })
            || (planar && axis == 2)
            || bodies[entry.value.handle].locked_axes().intersects(
                [
                    rp::LockedAxes::TRANSLATION_LOCKED_X,
                    rp::LockedAxes::TRANSLATION_LOCKED_Y,
                    rp::LockedAxes::TRANSLATION_LOCKED_Z,
                ][axis],
            )
        {
            return Ok(None);
        }
        let Some(box_shape) = colliders[face.collider].shape().as_cuboid() else {
            return Ok(None);
        };
        if colliders[actor.collider].shape().as_capsule().is_none() {
            return Ok(None);
        }
        let clearance = effective_pair_clearance(characters, &self.origins, &actor, &face);
        if hit.cast.contact.dist >= clearance {
            return Ok(None);
        }
        let future = full_future::FullFuture::new(
            actor,
            entry.curve,
            face,
            face.motion.curve,
            colliders,
            carrier,
            safe,
            end,
            clearance,
            actor.collider == hit.a.collider,
            work,
        )?;
        let mut rejected_times = [None; 4];
        if geometry != rp::Vector::ZERO {
            work.charge(std::mem::size_of::<full_future::RejectedTimes>() as u64)?;
        }
        let mut check = |candidate: Curve, target: rp::Vector, work: &mut Work| {
            let (rate, angular) = curve_velocity(candidate, hit.cast.hit_time)?;
            if rate.to_array().map(f32::to_bits) != target.to_array().map(f32::to_bits)
                || angular != rp::Vector::ZERO
                || !self.proposal_rows_feasible_impl(Some((id, rate)), Some(work))?
            {
                return Ok(false);
            }
            if !gap(
                actor,
                candidate,
                face,
                face.motion.curve,
                colliders,
                hit.cast.hit_time,
                clearance,
                work,
            )?
            .is_some_and(|gap| gap >= clearance && gap > hit.cast.contact.dist)
            {
                return Ok(false);
            }
            if target == rp::Vector::ZERO {
                future.accepts_strict_recording(
                    candidate,
                    (actor, face),
                    colliders,
                    memo.as_deref_mut(),
                    work,
                )
            } else {
                future.accepts_rotating_recording_with_hints(
                    candidate,
                    (actor, face),
                    colliders,
                    memo.as_deref_mut(),
                    false,
                    &mut rejected_times,
                    work,
                )
            }
        };
        let mut accept = |candidate, work: &mut Work| check(candidate, geometry, work);
        let phase = translated_face_phase(
            own,
            carrier,
            normal,
            box_shape.half_extents[axis],
            geometry,
            safe,
            hit.cast.hit_time,
            end,
            clearance,
            work,
            &mut accept,
        )?;
        if phase.is_some() || rebased.is_some() {
            return Ok(phase);
        }
        if geometry == rp::Vector::ZERO {
            return stationary_face_phase(
                own,
                carrier,
                normal,
                box_shape.half_extents[axis],
                safe,
                hit.cast.hit_time,
                end,
                clearance,
                work,
                &mut accept,
            );
        }
        let phase = representably_still_face_phase(
            own,
            carrier,
            normal,
            box_shape.half_extents[axis],
            safe,
            hit.cast.hit_time,
            end,
            clearance,
            work,
            accept,
        )?;
        let height = carrier.native.motion.start.translation[axis];
        let final_height = carrier.native.motion.end.translation[axis];
        let q = carrier.position_at_time(safe).rotation.to_array();
        if phase.is_some()
            || geometry[axis] <= 0.
            || carrier.native.linear_velocity[axis] == 0.
            || (height != final_height
                && height.min(final_height).next_up() != height.max(final_height))
            || q[axis].abs() <= q[3].abs()
        {
            return Ok(phase);
        }

        // The first clear phase can still recontact in the following
        // rounding cell. Unilaterally separating geometry can keep the
        // exact safe pose while preserving physical velocity and the skin.
        for count in [2, 1, 4, 8] {
            work.charge(128)?;
            let gain = (f64::from(clearance) * f64::from(count) / (16. * (end - safe))) as f32;
            let mut target = geometry;
            target[axis] += gain;
            if !target.is_finite() || target[axis] <= geometry[axis] {
                continue;
            }
            if let Some(phase) = translated_face_phase(
                own,
                carrier,
                normal,
                box_shape.half_extents[axis],
                target,
                safe,
                hit.cast.hit_time,
                end,
                clearance,
                work,
                |candidate, work| check(candidate, target, work),
            )? {
                return Ok(Some(phase));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests;
