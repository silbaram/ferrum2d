//! A finite character's geometry-only scalar translation frame. Physical
//! participant seeds/J and the dynamic donor's rotation are never replaced.
use super::*;
use crate::physics3d::solver_trajectory::ShapeMotion;
use rapier3d::parry::bounding_volume::Aabb;

fn same_clock(a: Kernel, b: Kernel) -> bool {
    a.domain.start.to_bits() == b.domain.start.to_bits()
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && a.native.integration_seconds.to_bits() == b.native.integration_seconds.to_bits()
        && a.native.motion.start_time.to_bits() == b.native.motion.start_time.to_bits()
        && a.native.motion.end_time.to_bits() == b.native.motion.end_time.to_bits()
}
// Absolute observer labels are not Native integration operands. This separate
// family keeps the original labels while requiring identical physical/local-dt
// maps and identical finite positive observer spans. The old label contract
// below stays first and is never retried after an error.
fn same_span_clock(a: Kernel, b: Kernel) -> bool {
    let span_a = a.native.motion.end_time - a.native.motion.start_time;
    let span_b = b.native.motion.end_time - b.native.motion.start_time;
    !same_clock(a, b)
        && a.domain.start.to_bits() == b.domain.start.to_bits()
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && a.native.integration_seconds.to_bits() == b.native.integration_seconds.to_bits()
        && span_a.is_finite()
        && span_a > 0.
        && span_a.to_bits() == span_b.to_bits()
}
fn stored_translation(k: Kernel) -> bool {
    let end =
        k.native.motion.start.translation + k.native.linear_velocity * k.native.integration_seconds;
    end.is_finite()
        && end.to_array().map(f32::to_bits)
            == k.native.motion.end.translation.to_array().map(f32::to_bits)
}
fn com_bounds(
    curve: Curve,
    safe: Time,
    end: Time,
    work: &mut Work,
) -> Result<Aabb, TrajectoryError> {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
    .bounds(&rapier3d::parry::shape::Ball::new(0.), safe, end, work)
}
fn correction(old: &Aabb, new: &Aabb, axis: usize) -> Option<f64> {
    let lo = (f64::from(new.mins[axis]) - f64::from(old.maxs[axis])).next_down();
    let hi = (f64::from(new.maxs[axis]) - f64::from(old.mins[axis])).next_up();
    let result = lo.abs().max(hi.abs());
    result.is_finite().then_some(result)
}
// Pointwise difference of two actual same-dt RN graphs, not the difference
// of independent COM envelopes. Shared dt cancels only in the ideal linear
// terms; every original product and post-add rounding remains in the ledger.
#[allow(clippy::too_many_arguments)]
fn same_dt_correction(
    own: Kernel,
    carrier: Kernel,
    anchor: f32,
    offset: f32,
    relative: f32,
    axis: usize,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    work.charge(512)?;
    if !same_span_clock(own, carrier) && !same_clock(own, carrier) {
        return Ok(None);
    }
    let qi = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
    if [own, carrier].into_iter().any(|k| {
        k.native.angular_velocity.to_array().map(f32::to_bits) != [0; 3]
            || k.native.motion.start.rotation.to_array().map(f32::to_bits) != qi
            || k.native.motion.end.rotation.to_array().map(f32::to_bits) != qi
            || !stored_translation(k)
    }) {
        return Ok(None);
    }
    let h = own.native.integration_seconds;
    let logical = own.domain.duration() as f32;
    let start_a = own.native.motion.start.translation[axis];
    let start_b = carrier.native.motion.start.translation[axis];
    let va = own.native.linear_velocity[axis];
    let vb = carrier.native.linear_velocity[axis];
    if !logical.is_finite() || anchor.to_bits() != (-start_b).to_bits() {
        return Ok(None);
    }
    let product = |v: f32, seconds: f32| {
        let end = v * seconds;
        [0_f32.min(end), 0_f32.max(end)]
    };
    let add = |a: [f32; 2], b: [f32; 2]| [a[0] + b[0], a[1] + b[1]];
    let pa = product(va, h);
    let pb = product(vb, h);
    let pr = product(relative, logical);
    let ca = add([start_a; 2], pa);
    let cb = add([start_b; 2], pb);
    let anchored = add(cb, [anchor; 2]);
    let shifted = add(anchored, [offset; 2]);
    let result = add(shifted, pr);
    let ranges = [pa, pb, pr, ca, cb, anchored, shifted, result];
    if ranges.iter().flatten().any(|v| !v.is_finite()) {
        return Ok(None);
    }
    let error = |range, exact| {
        if exact {
            Some(0.)
        } else {
            ground_rate::CorrectionRange::half_ulp(range)
        }
    };
    let mut rounding = 0.;
    for value in [
        error(pa, va == 0.),
        error(pb, vb == 0.),
        error(pr, relative == 0.),
        error(ca, start_a == 0. || va == 0.),
        error(cb, start_b == 0. || vb == 0.),
        error(anchored, anchor == 0.),
        error(shifted, offset == 0.),
        error(result, relative == 0.),
    ] {
        let Some(value) = value else { return Ok(None) };
        rounding = ground_rate::CorrectionRange::up_add(rounding, value);
    }
    // start_b + anchor == 0 exactly as reals. Each F32 coefficient is widened
    // before subtraction; next_up/up_add surround even disparate exponents.
    let constant = (f64::from(offset) - f64::from(start_a)).abs().next_up();
    let rate = (f64::from(vb) - f64::from(va)).abs().next_up();
    let motion = (rate * f64::from(h)).next_up();
    let relative = (f64::from(relative).abs() * f64::from(logical)).next_up();
    let total = [constant, motion, relative, rounding]
        .into_iter()
        .fold(0., ground_rate::CorrectionRange::up_add);
    Ok(total.is_finite().then_some(total))
}
impl BackendMotionScratch {
    // The capsule radius and box face are added at different points in their
    // f32 graphs. Moving the common translation by half a cell before fitting
    // the remaining offset can keep the emitting shapes outside the skin.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn finite_anchored_half_cell(
        &self,
        entry: Entry,
        pair: (ColliderTrajectory, ColliderTrajectory),
        other_curve: Curve,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        axis: usize,
        geometry: rp::Vector,
        clearance: f32,
        old_gap: f32,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        colliders: &rp::ColliderSet,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
        work: &mut Work,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        let Curve::Anchored {
            carrier: old_carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } = entry.curve
        else {
            return Ok(None);
        };
        let Curve::Integrated(carrier) = other_curve else {
            return Ok(None);
        };
        let (actor, other) = pair;
        let id = identity(entry.value.handle);
        if other.role != Role::Dynamic
            || Some(carrier.native.motion.body) != other.parent
            || !same_kernel(carrier, old_carrier)
            || !carrier.has_identity_orientation()
            || rotation != rp::Rotation::IDENTITY
            || anchor != rp::Vector::ZERO
            || linear_velocity != rp::Vector::ZERO
            || !characters.get(&id).is_some_and(|r| r.config.push_mass > 0.)
            || colliders[actor.collider].shape().as_capsule().is_none()
            || colliders[other.collider].shape().as_cuboid().is_none()
            || carrier.linear_velocity_at_time() != geometry
        {
            return Ok(None);
        }
        work.charge(512)?;
        let pose = entry.curve.com_pose(safe);
        let base = carrier.position_at_time(safe).translation[axis];
        let Some(half) = ground_rate::CorrectionRange::half_ulp([base; 2]) else {
            return Ok(None);
        };
        let half = half as f32;
        if half == 0. || !self.proposal_rows_feasible_impl(Some((id, geometry)), Some(work))? {
            return Ok(None);
        }
        let correction = ground_rate::CorrectionRange::from_curve(
            carrier, anchor, rotation, safe, end, axis, work,
        )?;
        let future = full_future::FullFuture::new(
            actor,
            entry.curve,
            other,
            other_curve,
            colliders,
            carrier,
            safe,
            end,
            clearance,
            actor.collider == hit.a.collider,
            work,
        )?;
        for shift in [half, -half] {
            let mut anchor = rp::Vector::ZERO;
            anchor[axis] = shift;
            for value in offset_cells(base + shift, 0., pose.translation[axis])
                .into_iter()
                .flatten()
            {
                work.charge(512)?;
                if !correction
                    .difference_split(0., offset[axis], shift, value, 0., 0.)
                    .is_some_and(|distance| distance <= f64::from(clearance))
                {
                    continue;
                }
                let mut fitted = offset;
                fitted[axis] = value;
                let curve = Curve::Anchored {
                    carrier,
                    anchor,
                    offset: fitted,
                    linear_velocity,
                    rotation,
                };
                if same_pose(curve.com_pose(safe), pose)
                    && gap(
                        actor,
                        curve,
                        other,
                        other_curve,
                        colliders,
                        hit.cast.hit_time,
                        clearance,
                        work,
                    )?
                    .is_some_and(|next| next >= clearance && next > old_gap)
                    && future.accepts_recording(
                        curve,
                        pair,
                        colliders,
                        memo.as_deref_mut(),
                        work,
                    )?
                {
                    return Ok(Some(Proposal {
                        curve,
                        rate: geometry,
                    }));
                }
            }
        }
        Ok(None)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn finite_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        work: &mut Work,
        planar: bool,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        let original = self.finite_phase_impl::<false>(
            index,
            hit,
            safe,
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
        self.finite_phase_impl::<true>(
            index, hit, safe, end, bodies, colliders, characters, geometry, work, planar, memo,
        )
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn finite_phase_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        work: &mut Work,
        planar: bool,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        self.finite_phase_impl::<false>(
            index, hit, safe, end, bodies, colliders, characters, geometry, work, planar, None,
        )
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn finite_span_phase_suffix(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        work: &mut Work,
        planar: bool,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        self.finite_phase_impl::<true>(
            index, hit, safe, end, bodies, colliders, characters, geometry, work, planar, None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn finite_phase_impl<const SPAN: bool>(
        &self,
        index: usize,
        hit: actual_scene::Hit,
        safe: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        geometry: rp::Vector,
        work: &mut Work,
        planar: bool,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
    ) -> Result<Option<Proposal>, TrajectoryError> {
        if !safe.is_finite()
            || !end.is_finite()
            || !hit.cast.hit_time.is_finite()
            || safe > end
            || hit.cast.hit_time > end
        {
            return Err(TrajectoryError::InvalidTime);
        }
        let entry = self.entries[index];
        let Curve::Integrated(own) = entry.curve else {
            return Ok(None);
        };
        if entry.support.is_some() {
            return Ok(None);
        }
        let (actor, other, normal) = if hit.a.parent == Some(entry.value.handle) {
            (hit.a, hit.b, -hit.cast.contact.normal1)
        } else if hit.b.parent == Some(entry.value.handle) {
            (hit.b, hit.a, hit.cast.contact.normal1)
        } else {
            return Ok(None);
        };
        if !matches!(other.role, Role::Dynamic) || actor.sensor || other.sensor {
            return Ok(None);
        }
        let census = self.entries.len().max(characters.len()).max(1);
        work.charge(512 + 4 * u64::from(usize::BITS - census.leading_zeros()))?;
        let id = identity(entry.value.handle);
        if !characters.get(&id).is_some_and(|r| r.config.push_mass > 0.)
            || hit.cast.hit_time <= safe
            || !normal.is_finite()
        {
            return Ok(None);
        }
        let sa = colliders
            .get(actor.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        let sb = colliders
            .get(other.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        if sa.as_capsule().is_none() || sb.as_cuboid().is_none() {
            return Ok(None);
        }
        let Some(donor_index) = self.entry_index(other.parent) else {
            return Ok(None);
        };
        let donor_entry = self.entries[donor_index];
        let Curve::Integrated(donor) = donor_entry.curve else {
            return Ok(None);
        };
        Kernel::from_native(own.native, own.domain)?;
        Kernel::from_native(donor.native, donor.domain)?;
        let qi = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
        if own.native.motion.body != entry.value.handle
            || Some(donor.native.motion.body) != other.parent
            || own.native.angular_velocity.to_array().map(f32::to_bits) != [0; 3]
            || own
                .native
                .motion
                .start
                .rotation
                .to_array()
                .map(f32::to_bits)
                != qi
            || own.native.motion.end.rotation.to_array().map(f32::to_bits) != qi
            || !(if SPAN {
                same_span_clock(own, donor)
            } else {
                same_clock(own, donor)
            })
            || !stored_translation(own)
            || !stored_translation(donor)
            || own.domain.start > safe
            || own.domain.end < end
            || !bodies
                .get(donor.native.motion.body)
                .is_some_and(|v| v.is_enabled() && v.is_dynamic())
        {
            return Ok(None);
        }
        let axis = (0..3)
            .max_by(|&a, &b| normal[a].abs().total_cmp(&normal[b].abs()))
            .ok_or(TrajectoryError::InvalidReference)?;
        if normal[axis] == 0. {
            return Ok(None);
        }
        let flags = bodies
            .get(entry.value.handle)
            .ok_or(TrajectoryError::InvalidReference)?
            .locked_axes();
        if [
            rp::LockedAxes::TRANSLATION_LOCKED_X,
            rp::LockedAxes::TRANSLATION_LOCKED_Y,
            rp::LockedAxes::TRANSLATION_LOCKED_Z,
        ][axis]
            .intersects(flags)
            || (planar && axis == 2)
        {
            return Ok(None);
        }
        // A represented Native tangent sum can only retain -0 when its start
        // and product are both -0. Exclude that boundary; all nonzero outputs
        // and +0 are unchanged by the anchored expression's later +0 adds.
        if (0..3).any(|i| {
            i != axis && own.native.motion.start.translation[i].to_bits() == (-0_f32).to_bits()
        }) {
            return Ok(None);
        }
        if own.native.motion.start.translation[axis].to_bits()
            == donor.native.motion.start.translation[axis].to_bits()
            && own.native.motion.end.translation[axis].to_bits()
                == donor.native.motion.end.translation[axis].to_bits()
            && own.native.linear_velocity[axis].to_bits()
                == donor.native.linear_velocity[axis].to_bits()
        {
            return Ok(None);
        }
        // This actor-owned value is a geometric frame, not a physical donor
        // replacement. Its two tangent Native start/end/v graphs and ALL clocks
        // are the actor's original ones. Translation does not depend on q/omega:
        // only the normal RN graph is copied from the actual dynamic source.
        let mut native = own.native;
        native.motion.start.translation[axis] = donor.native.motion.start.translation[axis];
        native.motion.end.translation[axis] = donor.native.motion.end.translation[axis];
        native.linear_velocity[axis] = donor.native.linear_velocity[axis];
        let carrier = Kernel::from_native(native, own.domain)?;
        let Some(relative) = fit_relative(carrier.linear_velocity_at_time(), geometry) else {
            return Ok(None);
        };
        if (0..3).any(|i| i != axis && relative[i].to_bits() != 0) {
            return Ok(None);
        }
        let mut anchor = rp::Vector::ZERO;
        anchor[axis] = -donor.native.motion.start.translation[axis];
        let pose = entry.curve.com_pose(safe);
        let base = carrier.position_at_time(safe);
        let base = base.translation + base.rotation * anchor;
        let product =
            relative * ((safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32);
        let Some(offset) = fit_offset(base, product, pose.translation) else {
            return Ok(None);
        };
        if (0..3).any(|i| i != axis && offset[i].to_bits() != 0) {
            return Ok(None);
        }
        let clearance = effective_pair_clearance(characters, &self.origins, &actor, &other);
        let Some(old) = gap(
            actor,
            entry.curve,
            other,
            donor_entry.curve,
            colliders,
            hit.cast.hit_time,
            clearance,
            work,
        )?
        else {
            return Ok(None);
        };
        let old_bounds = if SPAN {
            None
        } else {
            Some(com_bounds(entry.curve, safe, end, work)?)
        };
        let future = full_future::FullFuture::new(
            actor,
            entry.curve,
            other,
            donor_entry.curve,
            colliders,
            carrier,
            safe,
            end,
            clearance,
            actor.collider == hit.a.collider,
            work,
        )?;
        for value in offset_cells(base[axis], product[axis], pose.translation[axis])
            .into_iter()
            .flatten()
        {
            work.charge(1280)?;
            let mut fitted = offset;
            fitted[axis] = value;
            let curve = Curve::Anchored {
                carrier,
                anchor,
                offset: fitted,
                linear_velocity: relative,
                rotation: pose.rotation,
            };
            if !same_pose(curve.com_pose(safe), pose)
                || curve_velocity(curve, hit.cast.hit_time)?
                    .0
                    .to_array()
                    .map(f32::to_bits)
                    != geometry.to_array().map(f32::to_bits)
                || !self.proposal_rows_feasible_impl(Some((id, geometry)), Some(&mut *work))?
            {
                continue;
            }
            let Some(next) = gap(
                actor,
                curve,
                other,
                donor_entry.curve,
                colliders,
                hit.cast.hit_time,
                clearance,
                work,
            )?
            else {
                continue;
            };
            if next < clearance || next <= old {
                continue;
            }
            let original_within_skin = if let Some(old) = &old_bounds {
                let bounds = com_bounds(curve, safe, end, work)?;
                correction(old, &bounds, axis).is_some_and(|v| v <= f64::from(clearance))
            } else {
                false
            };
            // Independent world ranges count ordinary travel as correction
            // even for equal observer labels. The same-dt bound retains all
            // rounding error in either direction of travel. The old
            // successful route keeps its price.
            if !original_within_skin
                && !same_dt_correction(
                    own,
                    carrier,
                    anchor[axis],
                    fitted[axis],
                    relative[axis],
                    axis,
                    work,
                )?
                .is_some_and(|v| v <= f64::from(clearance))
            {
                continue;
            }
            if future.accepts_recording(
                curve,
                (actor, other),
                colliders,
                memo.as_deref_mut(),
                work,
            )? {
                return Ok(Some(Proposal {
                    curve,
                    rate: geometry,
                }));
            }
        }
        Ok(None)
    }
}
#[cfg(test)]
mod tests;
