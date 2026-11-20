//! Translation phase proposals for an otherwise unchanged passive suffix.
//! The encountered driver's original h/Domain supplies only a time map. An own
//! immutable, zero-omega Kernel and zero local anchor add no angular transport,
//! support, momentum or stop authority. Original scene queries still approve
//! every consumed prefix and the final endpoint before any body publication.
use super::*;

// Zero origin, then each unlocked coordinate's two adjacent binade frames in
// both directions. Each has three start/add-offset inverse cells. These are
// proposals, never repeated steps from one failed output to another distance.
const MAX_PHASES: usize = 13;
const INVERSE_CELLS: usize = 3;
const ADMISSION_WORK: u64 = 256;
const RATE_WORK: u64 = 128;
const PHASE_WORK: u64 = 128;
const CANDIDATE_WORK: u64 = 1024;

fn bits(v: rp::Vector) -> [u32; 3] {
    v.to_array().map(f32::to_bits)
}

fn same_pose(a: rp::Pose, b: rp::Pose) -> bool {
    bits(a.translation) == bits(b.translation)
        && a.rotation.to_array().map(f32::to_bits) == b.rotation.to_array().map(f32::to_bits)
}

fn neighbors(value: f32) -> [f32; INVERSE_CELLS] {
    [value, value.next_up(), value.next_down()]
}

fn inverse_rate(target: rp::Vector, scale: f32) -> Option<rp::Vector> {
    if !target.is_finite() || !scale.is_finite() || scale <= 0. {
        return None;
    }
    let mut raw = rp::Vector::ZERO;
    for axis in 0..3 {
        raw[axis] = neighbors(target[axis] / scale).into_iter().find(|value| {
            value.is_finite() && (value * scale).to_bits() == target[axis].to_bits()
        })?;
    }
    Some(raw)
}

/// Alternative origins of the same linear expression, chosen from adjacent
/// binades rather than a world distance or collision tolerance. Overflowing
/// frames are absent. Actual inverse fitting and safe bits, not this selection,
/// decide whether any descriptor can be considered by the full-shape observer.
fn origins(value: f32, product: f32) -> [Option<f32>; 4] {
    if !value.is_finite() || !product.is_finite() {
        return [None; 4];
    }
    let magnitude = value.abs().max(product.abs());
    let exponent = (magnitude.to_bits() >> 23) & 0xff;
    let mut result = [None; 4];
    if !magnitude.is_finite() || magnitude == 0. {
        return result;
    }
    for (index, exponent) in [exponent + 1, exponent + 2].into_iter().enumerate() {
        if exponent < 0xff {
            let frame = f32::from_bits(exponent << 23);
            result[index * 2] = Some(frame);
            result[index * 2 + 1] = Some(-frame);
        }
    }
    result
}

fn fixed_rotation(
    curve: Curve,
    rotation: rp::Rotation,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(256)?;
    let (kernel, fixed) = match curve {
        Curve::Integrated(kernel) => (kernel, None),
        Curve::Anchored {
            carrier, rotation, ..
        } => (carrier, Some(rotation)),
        _ => return Ok(false),
    };
    if kernel.native.angular_velocity != rp::Vector::ZERO {
        return Ok(false);
    }
    let expected = rotation.to_array().map(f32::to_bits);
    if fixed.is_some_and(|q| q.to_array().map(f32::to_bits) != expected)
        || kernel
            .native
            .motion
            .start
            .rotation
            .to_array()
            .map(f32::to_bits)
            != expected
        || kernel
            .native
            .motion
            .end
            .rotation
            .to_array()
            .map(f32::to_bits)
            != expected
    {
        return Ok(false);
    }
    // For omega=0 every positive interior dt takes the same original signed-
    // zero quaternion product and normalization. Stored endpoints stay separate.
    let dt = kernel.native.integration_seconds.next_down();
    Ok(dt <= 0.
        || kernel
            .native
            .position_at_integration_time(dt)
            .rotation
            .to_array()
            .map(f32::to_bits)
            == expected)
}

/// Enumerate bounded original F32 expressions, not a sampled motion proof.
/// The accepted Kernel keeps the complete source clock; its consumer clips
/// history at safe. Only an observer that subsequently performs the original
/// full-shape query may select a candidate from this private enumeration.
#[allow(clippy::too_many_arguments)]
fn propose(
    handle: rp::RigidBodyHandle,
    source: Kernel,
    pose: rp::Pose,
    target: rp::Vector,
    safe: Time,
    end: Time,
    locked: [bool; 3],
    work: &mut Work,
    accept: &mut impl FnMut(Curve, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Curve>, TrajectoryError> {
    work.charge(ADMISSION_WORK)?;
    if !safe.is_finite() || !end.is_finite() || end <= safe {
        return Err(TrajectoryError::InvalidTime);
    }
    Kernel::from_native(source.native, source.domain)?;
    if !pose.is_finite() || !target.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if source.domain.start > safe
        || source.domain.end < end
        || target == rp::Vector::ZERO
        || locked
            .iter()
            .enumerate()
            .any(|(axis, &locked)| locked && target[axis] != 0.)
    {
        return Ok(None);
    }
    work.charge(RATE_WORK)?;
    let scale = (f64::from(source.native.integration_seconds) / source.domain.duration()) as f32;
    let Some(raw) = inverse_rate(target, scale) else {
        return Ok(None);
    };
    // This is exactly the source's original logical -> physical F32 time map.
    // No F64 velocity-product reconstruction or shifted post-proof curve exists.
    let product = raw * source.local_delta(safe);
    if !product.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let mut phases = [(None, 0.); MAX_PHASES];
    let mut count = 1;
    for axis in 0..3 {
        if locked[axis] || raw[axis] == 0. {
            continue;
        }
        for origin in origins(pose.translation[axis], product[axis])
            .into_iter()
            .flatten()
        {
            phases[count] = (Some(axis), origin);
            count += 1;
        }
    }
    for &(axis, origin) in &phases[..count] {
        work.charge(PHASE_WORK)?;
        let mut initial = -product;
        let center = axis.map_or(0., |axis| origin - product[axis]);
        let cells = if axis.is_some() { INVERSE_CELLS } else { 1 };
        for value in neighbors(center).into_iter().take(cells) {
            work.charge(CANDIDATE_WORK)?;
            if let Some(axis) = axis {
                initial[axis] = value;
            }
            if !initial.is_finite() {
                continue;
            }
            let carrier = match Kernel::from_velocity_seconds(
                handle,
                source.domain,
                source.native.integration_seconds,
                rp::Pose::from_parts(initial, pose.rotation),
                raw,
                rp::Vector::ZERO,
            ) {
                Ok(carrier) => carrier,
                // A finite input may have no finite alternative evaluation
                // frame. Reject that proposal, never a source query's error.
                Err(TrajectoryError::NonFinite) => continue,
                Err(error) => return Err(error),
            };
            let base = carrier.position_at_time(safe).translation;
            let center = axis.map_or(0., |axis| pose.translation[axis] - base[axis]);
            for value in neighbors(center).into_iter().take(cells) {
                work.charge(256)?;
                let mut offset = pose.translation;
                if let Some(axis) = axis {
                    offset[axis] = value;
                }
                let candidate = Curve::Anchored {
                    carrier,
                    anchor: rp::Vector::ZERO,
                    offset,
                    linear_velocity: rp::Vector::ZERO,
                    rotation: pose.rotation,
                };
                if !same_pose(candidate.com_pose(safe), pose)
                    || bits(curve_velocity(candidate, safe)?.0) != bits(target)
                    || curve_velocity(candidate, safe)?.1 != rp::Vector::ZERO
                    || locked.iter().enumerate().any(|(axis, &locked)| {
                        locked
                            && candidate.com_pose(end).translation[axis].to_bits()
                                != pose.translation[axis].to_bits()
                    })
                {
                    continue;
                }
                if accept(candidate, work)? {
                    return Ok(Some(candidate));
                }
            }
        }
    }
    Ok(None)
}

impl BackendMotionScratch {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn clock_phase_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        planar: bool,
        work: &mut Work,
    ) -> Result<Option<representable::Proposal>, TrajectoryError> {
        let lookup = usize::BITS
            - characters
                .len()
                .max(self.entries.len())
                .max(1)
                .leading_zeros();
        work.charge(64 + 3 * u64::from(lookup))?;
        let entry = self
            .entries
            .get(index)
            .ok_or(TrajectoryError::InvalidReference)?;
        let id = identity(entry.value.handle);
        let participant = self
            .participants
            .get(index)
            .ok_or(TrajectoryError::InvalidReference)?;
        if entry.support.is_some()
            || !characters
                .get(&id)
                .is_some_and(|r| r.config.push_mass == 0.)
            || participant.angular_velocity != rp::Vector::ZERO
            || hit.cast.hit_time <= safe
        {
            return Ok(None);
        }
        let (actor, other) = if hit.a.parent == Some(entry.value.handle) {
            (hit.a, hit.b)
        } else if hit.b.parent == Some(entry.value.handle) {
            (hit.b, hit.a)
        } else {
            return Ok(None);
        };
        if actor.sensor || other.sensor || other.role != Role::Prescribed {
            return Ok(None);
        }
        let driver = self
            .entry_index(other.parent)
            .ok_or(TrajectoryError::InvalidReference)?;
        let Curve::Integrated(clock) = self.entries[driver].curve else {
            return Ok(None);
        };
        if clock.native.motion.body != self.entries[driver].value.handle {
            return Err(TrajectoryError::InvalidReference);
        }
        let driver_body = bodies
            .get(self.entries[driver].value.handle)
            .ok_or(TrajectoryError::InvalidReference)?;
        if driver_body.body_type() != rp::RigidBodyType::KinematicVelocityBased
            || clock.native.angular_velocity == rp::Vector::ZERO
        {
            return Ok(None);
        }
        let pose = entry.curve.com_pose(safe);
        if !fixed_rotation(entry.curve, pose.rotation, work)? {
            return Ok(None);
        }
        self.verify_selected_geometry_rows(work)?;
        let body = bodies
            .get(entry.value.handle)
            .ok_or(TrajectoryError::InvalidReference)?;
        let flags = body.locked_axes();
        let locked = [
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_X),
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Y),
            planar || flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Z),
        ];
        let clearance = effective_pair_clearance(characters, &self.origins, &actor, &other);
        let Some(old) = representable::gap(
            actor,
            entry.curve,
            other,
            self.entries[driver].curve,
            colliders,
            hit.cast.hit_time,
            clearance,
            work,
        )?
        else {
            return Ok(None);
        };
        let candidate = propose(
            entry.value.handle,
            clock,
            pose,
            geometry,
            safe,
            end,
            locked,
            work,
            &mut |candidate, work| {
                work.charge(512)?;
                if same_pose(
                    candidate.com_pose(hit.cast.hit_time),
                    entry.curve.com_pose(hit.cast.hit_time),
                ) {
                    return Ok(false);
                }
                let next = representable::gap(
                    actor,
                    candidate,
                    other,
                    self.entries[driver].curve,
                    colliders,
                    hit.cast.hit_time,
                    clearance,
                    work,
                )?;
                Ok(next.is_some_and(|next| next >= clearance && next > old))
            },
        )?;
        Ok(candidate.map(|curve| representable::Proposal {
            curve,
            rate: geometry,
        }))
    }
}

#[cfg(test)]
mod tests;
