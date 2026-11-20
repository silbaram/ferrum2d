//! One response's geometry-only skin restoration. No correction enters the
//! canonical input, physical Participant, Native driver, J or geometry-credit
//! ledger. At the next response the existing canonical reconstruction expires
//! it. Only the current Anchored suffix records its actually measured rate.
use super::*;

const RATE_CELLS: usize = 3;
const OFFSET_CELLS: usize = 10;
const MAX_CANDIDATES: usize = RATE_CELLS * OFFSET_CELLS;

fn cardinal(up: rp::Vector) -> Option<(usize, bool)> {
    let axis = coordinate_normal_axis(up)?;
    (up[axis].abs() == 1.).then_some((axis, up[axis] > 0.))
}

/// Adjacent rate descriptors at the next represented outgoing COM cell. These
/// F64 operations only propose inputs; original safe/rate/rows/full-shape
/// consumers below decide validity. A scalar threshold is never a certificate.
fn rate_cells(base: f32, current: f32, seconds: f32, positive: bool) -> Option<[f32; RATE_CELLS]> {
    if !base.is_finite() || !current.is_finite() || !seconds.is_finite() || seconds <= 0. {
        return None;
    }
    let next = if positive {
        current.next_up()
    } else {
        current.next_down()
    };
    if !next.is_finite() {
        return None;
    }
    let midpoint = (f64::from(current) + f64::from(next)) * 0.5;
    let center = ((midpoint - f64::from(base)) / f64::from(seconds)) as f32;
    if !center.is_finite() {
        return None;
    }
    Some(if positive {
        [center, center.next_up(), center.next_down()]
    } else {
        [center, center.next_down(), center.next_up()]
    })
}

/// A common carrier+anchor input range. Carrier motion is never subtracted as
/// two independent envelopes: it cancels algebraically, and this range is used
/// only for the original RN operation's possible cell widths.
#[derive(Clone, Copy)]
pub(super) struct CorrectionRange {
    base: [f32; 2],
    seconds: [f32; 2],
}
impl CorrectionRange {
    pub(super) fn from_curve(
        carrier: Kernel,
        anchor: rp::Vector,
        rotation: rp::Rotation,
        safe: Time,
        end: Time,
        axis: usize,
        work: &mut Work,
    ) -> Result<Self, TrajectoryError> {
        work.charge(128)?;
        let point = crate::physics3d::solver_trajectory::ShapeMotion {
            curve: Curve::Anchored {
                carrier,
                anchor,
                offset: rp::Vector::ZERO,
                linear_velocity: rp::Vector::ZERO,
                rotation,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        // Stack point shape; no allocation or new allowance. bounds accounts
        // for every original F32 pose branch and charges this same ledger.
        let bounds = point.bounds(&rapier3d::parry::shape::Ball::new(0.), safe, end, work)?;
        Ok(Self {
            base: [bounds.mins[axis], bounds.maxs[axis]],
            seconds: [
                (safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32,
                (end - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32,
            ],
        })
    }
    fn add(a: [f32; 2], b: [f32; 2]) -> Option<[f32; 2]> {
        let result = [a[0] + b[0], a[1] + b[1]];
        result.iter().all(|v| v.is_finite()).then_some(result)
    }
    fn product(self, rate: f32) -> Option<[f32; 2]> {
        let a = rate * self.seconds[0];
        let b = rate * self.seconds[1];
        (a.is_finite() && b.is_finite()).then_some([a.min(b), a.max(b)])
    }
    pub(super) fn half_ulp(values: [f32; 2]) -> Option<f64> {
        let magnitude = values[0].abs().max(values[1].abs());
        if !magnitude.is_finite() {
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
    pub(super) fn up_add(a: f64, b: f64) -> f64 {
        if a == 0. {
            b
        } else if b == 0. {
            a
        } else {
            (a + b).next_up()
        }
    }
    // For actual F32 B(t), O and V this bounds
    // RN(RN(B+O1)+RN(V1*t)) - RN(RN(B+O0)+RN(V0*t)).
    // B cancels from the ideal difference. Only its possible post-add
    // magnitudes enter the uniform RN error bounds; original whole-D seconds
    // (not remaining duration) multiply each rate, with their common t kept.
    pub(super) fn difference(
        self,
        old_offset: f32,
        new_offset: f32,
        old_rate: f32,
        new_rate: f32,
    ) -> Option<f64> {
        if !old_offset.is_finite()
            || !new_offset.is_finite()
            || !old_rate.is_finite()
            || !new_rate.is_finite()
        {
            return None;
        }
        if old_offset.to_bits() == new_offset.to_bits() && old_rate.to_bits() == new_rate.to_bits()
        {
            return Some(0.);
        }
        let old_add = Self::add(self.base, [old_offset; 2])?;
        let new_add = Self::add(self.base, [new_offset; 2])?;
        let old_product = self.product(old_rate)?;
        let new_product = self.product(new_rate)?;
        let old_final = Self::add(old_add, old_product)?;
        let new_final = Self::add(new_add, new_product)?;
        let interval = |a: f32, b: f32| {
            let d = f64::from(b) - f64::from(a);
            if a == b {
                [0., 0.]
            } else {
                [d.next_down(), d.next_up()]
            }
        };
        let offset = interval(old_offset, new_offset);
        let rate = interval(old_rate, new_rate);
        let products = [
            rate[0] * f64::from(self.seconds[0]),
            rate[0] * f64::from(self.seconds[1]),
            rate[1] * f64::from(self.seconds[0]),
            rate[1] * f64::from(self.seconds[1]),
        ];
        let lo = (offset[0]
            + products
                .into_iter()
                .fold(f64::INFINITY, f64::min)
                .next_down())
        .next_down();
        let hi = (offset[1]
            + products
                .into_iter()
                .fold(f64::NEG_INFINITY, f64::max)
                .next_up())
        .next_up();
        let mut bound = lo.abs().max(hi.abs());
        // The first add is exactly the same operation when offset is unchanged.
        if old_offset.to_bits() != new_offset.to_bits() {
            bound = Self::up_add(
                bound,
                Self::up_add(Self::half_ulp(old_add)?, Self::half_ulp(new_add)?),
            );
        }
        if old_rate.to_bits() != new_rate.to_bits() {
            bound = Self::up_add(
                bound,
                Self::up_add(Self::half_ulp(old_product)?, Self::half_ulp(new_product)?),
            );
        }
        bound = Self::up_add(
            bound,
            Self::up_add(Self::half_ulp(old_final)?, Self::half_ulp(new_final)?),
        );
        bound.is_finite().then_some(bound)
    }
    /// Original RN(T + action(t)) + offset + common-product difference.
    /// The two complete action images may be conservatively independent;
    /// common carrier T and the identical represented relative product cancel
    /// before the original post-add rounding errors are bounded.
    pub(super) fn difference_actions(
        self,
        old_action: [f32; 2],
        old_offset: f32,
        new_action: [f32; 2],
        new_offset: f32,
        rate: f32,
    ) -> Option<f64> {
        if old_action.iter().chain(&new_action).any(|v| !v.is_finite())
            || old_action[0] > old_action[1]
            || new_action[0] > new_action[1]
            || !old_offset.is_finite()
            || !new_offset.is_finite()
        {
            return None;
        }
        let old_first = Self::add(self.base, old_action)?;
        let new_first = Self::add(self.base, new_action)?;
        let old_second = Self::add(old_first, [old_offset; 2])?;
        let new_second = Self::add(new_first, [new_offset; 2])?;
        let product = self.product(rate)?;
        let old_final = Self::add(old_second, product)?;
        let new_final = Self::add(new_second, product)?;
        let offset = f64::from(new_offset) - f64::from(old_offset);
        let lo = ((f64::from(new_action[0]) - f64::from(old_action[1])).next_down()
            + offset.next_down())
        .next_down();
        let hi = ((f64::from(new_action[1]) - f64::from(old_action[0])).next_up()
            + offset.next_up())
        .next_up();
        let mut distance = lo.abs().max(hi.abs());
        // Same represented T/product are not charged as two independent
        // displacements. Only these six original RN output cells can differ.
        for range in [
            old_first, new_first, old_second, new_second, old_final, new_final,
        ] {
            distance = Self::up_add(distance, Self::half_ulp(range)?);
        }
        distance.is_finite().then_some(distance)
    }

    /// A constant identity action may split its normal offset over two
    /// original RN adds. Reuse the one-add bound above through a rounded
    /// coefficient fold, then enclose both exact graph differences. Shared
    /// carrier motion cancels; only coefficient residuals and RN cells remain.
    pub(super) fn difference_split(
        self,
        old_anchor: f32,
        old_offset: f32,
        new_anchor: f32,
        new_offset: f32,
        old_rate: f32,
        new_rate: f32,
    ) -> Option<f64> {
        let collapse = |anchor: f32, offset: f32, rate: f32| -> Option<(f32, f64)> {
            if !anchor.is_finite() || !offset.is_finite() {
                return None;
            }
            let folded = anchor + offset;
            if !folded.is_finite() {
                return None;
            }
            let sum = f64::from(anchor) + f64::from(offset);
            // F64 outward endpoints also cover a tiny F32 operand lost in
            // the widened sum. No RN32 reassociation is assumed exact.
            let fold_error = (sum.next_down() - f64::from(folded))
                .abs()
                .max((sum.next_up() - f64::from(folded)).abs())
                .next_up();
            let first = Self::add(self.base, [anchor; 2])?;
            let second = Self::add(first, [offset; 2])?;
            let collapsed = Self::add(self.base, [folded; 2])?;
            let product = self.product(rate)?;
            let final_original = Self::add(second, product)?;
            let final_collapsed = Self::add(collapsed, product)?;
            let mut error = fold_error;
            for range in [first, second, collapsed, final_original, final_collapsed] {
                error = Self::up_add(error, Self::half_ulp(range)?);
            }
            error.is_finite().then_some((folded, error))
        };
        let (old, old_error) = collapse(old_anchor, old_offset, old_rate)?;
        let (new, new_error) = collapse(new_anchor, new_offset, new_rate)?;
        let distance = Self::up_add(
            self.difference(old, new, old_rate, new_rate)?,
            Self::up_add(old_error, new_error),
        );
        distance.is_finite().then_some(distance)
    }
}

impl BackendMotionScratch {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn ground_rate_suffix(
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
        let census = self
            .entries
            .len()
            .max(characters.len())
            .max(self.origins.len())
            .max(1);
        work.charge(512 + 4 * u64::from(usize::BITS - census.leading_zeros()))?;
        let entry = self
            .entries
            .get(index)
            .ok_or(TrajectoryError::InvalidReference)?;
        let id = identity(entry.value.handle);
        let Some(runtime) = characters.get(&id) else {
            return Ok(None);
        };
        let Some(support) = entry.support else {
            return Ok(None);
        };
        let Some((axis, positive)) = cardinal(rp::Vector::from(runtime.config.up)) else {
            return Ok(None);
        };
        let participant = self
            .participants
            .get(index)
            .ok_or(TrajectoryError::InvalidReference)?;
        let body = bodies
            .get(entry.value.handle)
            .ok_or(TrajectoryError::InvalidReference)?;
        let flags = body.locked_axes();
        let locks = [
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_X),
            flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Y),
            planar || flags.contains(rp::LockedAxes::TRANSLATION_LOCKED_Z),
        ];
        if locks[axis]
            || participant.angular_velocity != rp::Vector::ZERO
            || !safe.is_finite()
            || !end.is_finite()
            || hit.cast.hit_time <= safe
            || hit.cast.hit_time > end
        {
            return Ok(None);
        }
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
        let Some(driver) = self.entry_index(Some(support)) else {
            return Ok(None);
        };
        let Curve::Integrated(current) = self.entries[driver].curve else {
            return Ok(None);
        };
        if !same_kernel(carrier, current)
            || carrier.domain.start > safe
            || carrier.domain.end < end
            || curve_velocity(entry.curve, hit.cast.hit_time)?
                .0
                .to_array()
                .map(f32::to_bits)
                != geometry.to_array().map(f32::to_bits)
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
        if actor.sensor
            || other.sensor
            || other.parent != Some(support)
            || matches!(other.role, Role::Character(_))
        {
            return Ok(None);
        }
        let origin = self
            .origins
            .binary_search_by_key(&id, |v| v.body)
            .map_err(|_| TrajectoryError::InvalidReference)?;
        // Canonical upward intent is not a rounding defect. The unchanged
        // original lifetime check below separately retains slope, jump,
        // one-way/contact and actual physical separation/invisibility policy.
        let up = rp::Vector::from(runtime.config.up);
        if self.origins[origin].relative_plan.dot(up) > 0.
            || self
                .retained_support_suffix(index, safe, hit.cast.hit_time, bodies, characters, work)?
                .is_none()
        {
            return Ok(None);
        }
        self.verify_selected_geometry_rows(work)?;
        let clearance = effective_pair_clearance(characters, &self.origins, &actor, &other);
        let Some(old) = gap(
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
        if old <= 0. || old >= clearance {
            return Ok(None);
        }
        let future = full_future::FullFuture::new(
            actor,
            entry.curve,
            other,
            self.entries[driver].curve,
            colliders,
            carrier,
            safe,
            end,
            clearance,
            actor.collider == hit.a.collider,
            work,
        )?;
        let safe_pose = entry.curve.com_pose(safe);
        let old_hit = entry.curve.com_pose(hit.cast.hit_time);
        let without_up = Curve::Anchored {
            carrier,
            anchor,
            offset,
            rotation,
            linear_velocity: {
                let mut v = linear_velocity;
                v[axis] = 0.;
                v
            },
        };
        let seconds = (safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
        let Some(rates) = rate_cells(
            without_up.com_pose(safe).translation[axis],
            safe_pose.translation[axis],
            seconds,
            positive,
        ) else {
            return Ok(None);
        };
        // A near-start rate-cell descriptor is only a hint. It may not add
        // more than one original skin of normal displacement anywhere on the
        // remaining actual F32 curve, including a large-coordinate cell jump.
        let correction =
            CorrectionRange::from_curve(carrier, anchor, rotation, safe, end, axis, work)?;
        let row_cost = u64::try_from(self.character_rows.len())
            .map_err(|_| TrajectoryError::WorkLimit)?
            .checked_mul(16)
            .and_then(|n| n.checked_add(1024 + 256))
            .and_then(|n| n.checked_mul(MAX_CANDIDATES as u64))
            .ok_or(TrajectoryError::WorkLimit)?;
        // All fixed descriptor/inverse/pose/rate/row work is admitted before
        // enumeration. Every full-shape gap query charges the same Work again.
        work.charge(row_cost)?;
        for rate in rates {
            if !rate.is_finite()
                || if positive {
                    rate <= linear_velocity[axis]
                } else {
                    rate >= linear_velocity[axis]
                }
            {
                continue;
            }
            let mut relative = linear_velocity;
            relative[axis] = rate;
            let base = carrier.position_at_time(safe);
            let base = base.translation + base.rotation * anchor;
            let relative_dt = relative
                * ((safe - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32);
            let mut offsets = [None; OFFSET_CELLS];
            offsets[0] = Some(offset[axis]);
            offsets[1..].copy_from_slice(&offset_cells(
                base[axis],
                relative_dt[axis],
                safe_pose.translation[axis],
            ));
            for (slot, value) in offsets.iter().copied().enumerate() {
                let Some(value) = value else { continue };
                if offsets[..slot]
                    .iter()
                    .flatten()
                    .any(|prior| prior.to_bits() == value.to_bits())
                {
                    continue;
                }
                if !value.is_finite() {
                    continue;
                }
                let mut fitted = offset;
                fitted[axis] = value;
                if !correction
                    .difference(offset[axis], value, linear_velocity[axis], rate)
                    .is_some_and(|distance| distance <= f64::from(runtime.config.skin_width))
                {
                    continue;
                }
                let candidate = Curve::Anchored {
                    carrier,
                    anchor,
                    offset: fitted,
                    linear_velocity: relative,
                    rotation,
                };
                if !same_pose(candidate.com_pose(safe), safe_pose) {
                    continue;
                }
                let (actual, angular) = curve_velocity(candidate, hit.cast.hit_time)?;
                if angular != rp::Vector::ZERO
                    || (0..3).any(|i| i != axis && actual[i].to_bits() != geometry[i].to_bits())
                    || if positive {
                        actual[axis] <= geometry[axis]
                    } else {
                        actual[axis] >= geometry[axis]
                    }
                    || !self.proposal_rows_feasible(Some((id, actual)))?
                    || same_pose(candidate.com_pose(hit.cast.hit_time), old_hit)
                {
                    continue;
                }
                if gap(
                    actor,
                    candidate,
                    other,
                    self.entries[driver].curve,
                    colliders,
                    hit.cast.hit_time,
                    clearance,
                    work,
                )?
                .is_some_and(|v| v >= clearance && v > old)
                    && future.accepts(candidate, work)?
                {
                    return Ok(Some(Proposal {
                        curve: candidate,
                        rate: actual,
                    }));
                }
            }
        }
        // A stationary real support can lose a rounded face cell before
        // changing the rate of the COM-height anchor could help. A new
        // normal-only phase can first preserve the safe pose and then
        // open the gap with a small geometric rate.
        let q = carrier.native.motion.start.rotation.to_array();
        let raw_normal = if actor.collider == hit.a.collider {
            -hit.cast.contact.normal1
        } else {
            hit.cast.contact.normal1
        };
        let pure = normal_phase_axis(carrier, raw_normal, work)? == Some(axis)
            && raw_normal[axis].signum() == up[axis]
            && (0..3).all(|i| {
                i == axis
                    || (carrier.native.linear_velocity[i].to_bits() == 0
                        && carrier.native.motion.start.translation[i].to_bits() == 0
                        && carrier.native.motion.end.translation[i].to_bits() == 0)
            });
        if bodies[support].body_type() != rp::RigidBodyType::KinematicPositionBased
            || !positive
            || !pure
            || q[3] * q[3] >= q[axis] * q[axis]
            || linear_velocity[axis] != 0.
            || carrier.native.linear_velocity != rp::Vector::ZERO
            || other.motion.local_center != rp::Vector::ZERO
            || !same_pose(other.motion.local_pose, rp::Pose::IDENTITY)
            || rotation.to_array().map(f32::to_bits)
                != rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
        {
            return Ok(None);
        }
        let Some(half) = colliders
            .get(other.collider)
            .and_then(|collider| collider.shape().as_cuboid())
            .map(|shape| shape.half_extents[axis])
        else {
            return Ok(None);
        };
        let bounds = |coordinate, work: &mut Work| {
            crate::physics3d::solver_trajectory::normal_action_range(
                carrier, axis, safe, end, coordinate, work,
            )
        };
        let Some(old_action) = bounds(anchor[axis], work)? else {
            return Ok(None);
        };
        let phase_range = CorrectionRange::from_curve(
            carrier,
            rp::Vector::ZERO,
            rotation,
            safe,
            end,
            axis,
            work,
        )?;
        let carrier_at_safe = carrier.position_at_time(safe);
        let rate_scale = runtime.config.skin_width / (16. * (end - safe) as f32);
        // Start at the authored face, then visit its adjacent F32 coordinates.
        // The nearest safe inverse can share either side of the face lattice.
        for distance in 0_u32..=64 {
            for coordinate in [
                f32::from_bits(half.to_bits().saturating_sub(distance)),
                f32::from_bits(half.to_bits().saturating_add(distance)),
            ]
            .into_iter()
            .take(if distance == 0 { 1 } else { 2 })
            {
                if !coordinate.is_finite() || coordinate <= 0. {
                    continue;
                }
                work.charge(512)?;
                let mut phase_anchor = anchor;
                phase_anchor[axis] = coordinate;
                let point = carrier_at_safe.translation + carrier_at_safe.rotation * phase_anchor;
                let Some(new_action) = bounds(coordinate, work)? else {
                    continue;
                };
                let rate_range = CorrectionRange::from_curve(
                    carrier,
                    phase_anchor,
                    rotation,
                    safe,
                    end,
                    axis,
                    work,
                )?;
                for scale in [1., 2., 4., 8.] {
                    let rate = rate_scale * scale;
                    if !rate.is_finite() || rate <= 0. {
                        continue;
                    }
                    let mut relative = linear_velocity;
                    relative[axis] = rate;
                    for value in
                        offset_cells(point[axis], rate * seconds, safe_pose.translation[axis])
                            .into_iter()
                            .flatten()
                    {
                        work.charge(256 + self.character_rows.len() as u64 * 16)?;
                        let Some(displacement) = phase_range.difference_actions(
                            old_action,
                            offset[axis],
                            new_action,
                            value,
                            0.,
                        ) else {
                            continue;
                        };
                        let Some(lift) = rate_range.difference(value, value, 0., rate) else {
                            continue;
                        };
                        if CorrectionRange::up_add(displacement, lift)
                            > f64::from(runtime.config.skin_width)
                        {
                            continue;
                        }
                        let mut fitted = offset;
                        fitted[axis] = value;
                        let candidate = Curve::Anchored {
                            carrier,
                            anchor: phase_anchor,
                            offset: fitted,
                            linear_velocity: relative,
                            rotation,
                        };
                        let (actual, angular) = curve_velocity(candidate, hit.cast.hit_time)?;
                        if !same_pose(candidate.com_pose(safe), safe_pose)
                            || angular != rp::Vector::ZERO
                            || actual[axis] <= geometry[axis]
                            || (0..3)
                                .any(|i| i != axis && actual[i].to_bits() != geometry[i].to_bits())
                            || !self.proposal_rows_feasible(Some((id, actual)))?
                        {
                            continue;
                        }
                        if gap(
                            actor,
                            candidate,
                            other,
                            self.entries[driver].curve,
                            colliders,
                            hit.cast.hit_time,
                            clearance,
                            work,
                        )?
                        .is_some_and(|value| value >= clearance && value > old)
                            && future.accepts(candidate, work)?
                        {
                            return Ok(Some(Proposal {
                                curve: candidate,
                                rate: actual,
                            }));
                        }
                    }
                }
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests;
