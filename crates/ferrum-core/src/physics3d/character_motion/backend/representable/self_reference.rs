//! An immutable own Native kernel may be a geometric clock, never a support.
//! Its body identity is not resolved back through the live entries. The Kernel
//! is a value, so this does not introduce recursive curve evaluation or carry.
use super::*;

// Fixed original Native branch validation and the three rotation bit checks.
// Map membership has its separate bounded logarithmic visit allowance below.
const KERNEL_WORK: u64 = 256;

pub(super) fn kernel(
    entry: Entry,
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    safe: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<Kernel>, TrajectoryError> {
    work.charge(KERNEL_WORK + u64::from(usize::BITS - characters.len().max(1).leading_zeros()))?;
    if !safe.is_finite() || !end.is_finite() || safe > end {
        return Err(TrajectoryError::InvalidTime);
    }
    if entry.support.is_some() || !characters.contains_key(&identity(entry.value.handle)) {
        return Ok(None);
    }
    let original = match entry.curve {
        Curve::Integrated(kernel) => kernel,
        // Preserve the same immutable clock when a later collision revisits
        // an already geometric own-reference. No live self entry is followed.
        Curve::Anchored { carrier, .. } => carrier,
        _ => return Ok(None),
    };
    Kernel::from_native(original.native, original.domain)?;
    if original.native.motion.body != entry.value.handle
        || original.native.angular_velocity != rp::Vector::ZERO
        || original.domain.start > safe
        || original.domain.end < end
    {
        return Ok(None);
    }
    let safe_pose = entry.curve.com_pose(safe);
    if !safe_pose.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let rotation = original
        .native
        .motion
        .start
        .rotation
        .to_array()
        .map(f32::to_bits);
    if original
        .native
        .motion
        .end
        .rotation
        .to_array()
        .map(f32::to_bits)
        != rotation
        || safe_pose.rotation.to_array().map(f32::to_bits) != rotation
    {
        return Ok(None);
    }
    // For omega=0 every positive interior Native integration uses the same
    // signed-zero quaternion product and normalization. There are only these
    // branches, not a sampling assumption about arbitrary rotation. A one-ULP
    // physical duration may have no positive interior represented F32 at all.
    let dt = original.native.integration_seconds.next_down();
    if dt > 0. {
        let interior = original.native.position_at_integration_time(dt);
        if !interior.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if interior.rotation.to_array().map(f32::to_bits) != rotation {
            return Ok(None);
        }
    }
    Ok(Some(original))
}

/// These are adjacent inverse-add cells for one coordinate at a time, not a
/// total-rate grid. The caller admits each actually visited inverse slot.
/// Every candidate keeps the same safe pose and the measured total rate; the
/// original exact rows, hit improvement and later full guards still decide.
pub(super) struct Offsets {
    pub values: [Option<rp::Vector>; 28],
    pub len: usize,
}

pub(super) fn offsets(
    base: rp::Vector,
    relative: rp::Vector,
    target: rp::Vector,
    initial: rp::Vector,
) -> Offsets {
    let mut values = [None; 28];
    values[0] = Some(initial);
    for axis in 0..3 {
        for (slot, value) in offset_cells(base[axis], relative[axis], target[axis])
            .into_iter()
            .enumerate()
        {
            values[1 + axis * 9 + slot] = value.map(|value| {
                let mut next = initial;
                next[axis] = value;
                next
            });
        }
    }
    Offsets { values, len: 28 }
}

#[cfg(test)]
mod tests;
