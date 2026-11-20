//! A memo belongs to one borrowed, immutable Native response context. It is
//! dropped before that context's body publication, never retained by World.
//! Source handles alone are not keys: every original geometric operation input
//! is compared, including the independent time maps of anchored expressions.
use super::bounds_cache::ShapeKey;
use super::*;

const MAX_ENTRIES: usize = 64;
const MAX_REPLAY_ENTRIES: usize = 128;

#[derive(Clone, Copy)]
struct Entry {
    a: ColliderTrajectory,
    b: ColliderTrajectory,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    allow_existing: bool,
    strict_proposal: bool,
    hit: Option<CastHit>,
    strict_start: Option<(rp::Pose, rp::Pose)>,
}

pub(super) enum Lookup {
    Reuse(Option<CastHit>),
    Miss(Option<usize>),
    Recheck(Option<usize>, super::solver_trajectory::StrictPrefix),
}

#[derive(Default)]
pub(in crate::physics3d::character_motion) struct ReplayPairs {
    scope: Option<super::solver_trajectory::Domain>,
    entries: Vec<(Entry, [ShapeKey; 2])>,
}

impl ReplayPairs {
    pub fn bytes(&self) -> usize {
        self.entries.capacity() * std::mem::size_of::<(Entry, [ShapeKey; 2])>()
    }
}

pub(in crate::physics3d::character_motion) struct PairQueries<'a> {
    colliders: &'a rp::ColliderSet,
    policies: &'a ContactPolicies,
    scope: super::solver_trajectory::Domain,
    entries: Vec<Entry>,
    available_bytes: usize,
    reserve_hint: usize,
    replace: usize,
    #[cfg(test)]
    pub hits: usize,
}

pub(super) fn vector(a: rp::Vector, b: rp::Vector) -> bool {
    a.to_array().map(f32::to_bits) == b.to_array().map(f32::to_bits)
}

use super::solver_trajectory::constant_pose;
pub(super) use super::solver_trajectory::same_pose_bits as pose;

fn kernel(a: super::solver_trajectory::Kernel, b: super::solver_trajectory::Kernel) -> bool {
    let (a_native, b_native) = (a.native, b.native);
    a.domain.start.to_bits() == b.domain.start.to_bits()
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && a_native.motion.body == b_native.motion.body
        && a_native.motion.start_time.to_bits() == b_native.motion.start_time.to_bits()
        && a_native.motion.end_time.to_bits() == b_native.motion.end_time.to_bits()
        && pose(a_native.motion.start, b_native.motion.start)
        && pose(a_native.motion.end, b_native.motion.end)
        && a_native.integration_seconds.to_bits() == b_native.integration_seconds.to_bits()
        && vector(a_native.linear_velocity, b_native.linear_velocity)
        && vector(a_native.angular_velocity, b_native.angular_velocity)
}

pub(super) fn curve(a: Curve, b: Curve) -> bool {
    let same = match (a, b) {
        (Curve::Integrated(a), Curve::Integrated(b)) => kernel(a, b),
        (Curve::Constant { pose: a, .. }, Curve::Constant { pose: b, .. }) => {
            // These domain annotations validate admission but do not occur in
            // the constant pose expression. Both contain the requested query.
            pose(a, b)
        }
        (
            Curve::Anchored {
                carrier: a,
                anchor: aa,
                offset: ao,
                linear_velocity: av,
                rotation: aq,
            },
            Curve::Anchored {
                carrier: b,
                anchor: ba,
                offset: bo,
                linear_velocity: bv,
                rotation: bq,
            },
        ) => {
            kernel(a, b)
                && vector(aa, ba)
                && vector(ao, bo)
                && vector(av, bv)
                && aq.to_array().map(f32::to_bits) == bq.to_array().map(f32::to_bits)
        }
        // Leave the historical CCD law on its original path. No missing field
        // of that expression is silently treated as equal by this optional memo.
        _ => false,
    };
    same || match (constant_pose(a), constant_pose(b)) {
        (Some(a), Some(b)) => pose(a, b),
        _ => false,
    }
}

fn same_attachment(a: &ColliderTrajectory, b: &ColliderTrajectory) -> bool {
    a.collider == b.collider
        && a.parent == b.parent
        && a.role == b.role
        && a.sensor == b.sensor
        && vector(a.motion.local_center, b.motion.local_center)
        && pose(a.motion.local_pose, b.motion.local_pose)
}

fn covers(motion: ShapeMotion, start: Time, end: Time) -> bool {
    let (lo, hi) = motion.curve.times();
    lo.is_finite() && hi.is_finite() && lo <= start && hi >= end
}

fn motion(a: &ColliderTrajectory, b: &ColliderTrajectory, start: Time, end: Time) -> bool {
    same_attachment(a, b)
        && covers(a.motion, start, end)
        && covers(b.motion, start, end)
        && curve(a.motion.curve, b.motion.curve)
}

// Reusing an existing-contact band requires the original initial policy
// inputs, not just an included time interval. For zero-angular expressions,
// equal COM pose and linear/angular velocity bits reproduce every original
// shape pose, leaf contact, static support allowance and point-rate operation.
// This is checked only after the immutable shape/local/context keys matched.
fn same_existing_initial(
    entry: &Entry,
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if entry.start >= entry.end || start >= end {
        return Ok(false);
    }
    work.charge(1024)?; // four original COM/velocity expressions and exact bit keys
    for (old, new) in [(&entry.a, a), (&entry.b, b)] {
        let old_pose = old.motion.curve.com_pose(entry.start);
        let new_pose = new.motion.curve.com_pose(start);
        if !old_pose.is_finite() || !new_pose.is_finite() || !pose(old_pose, new_pose) {
            return Ok(false);
        }
        let (old_linear, old_angular) = old.motion.linear_angular_velocity(entry.start);
        let (new_linear, new_angular) = new.motion.linear_angular_velocity(start);
        if !old_linear.is_finite()
            || !new_linear.is_finite()
            || old_angular != rp::Vector::ZERO
            || new_angular != rp::Vector::ZERO
            || !vector(old_linear, new_linear)
            || !vector(old_angular, new_angular)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

impl<'a> PairQueries<'a> {
    pub fn new(
        colliders: &'a rp::ColliderSet,
        policies: &'a ContactPolicies,
        start: Time,
        end: Time,
    ) -> Result<Self, TrajectoryError> {
        let scope = super::solver_trajectory::Domain::new(start, end)?;
        if start >= end {
            return Err(TrajectoryError::InvalidTime);
        }
        Ok(Self {
            colliders,
            policies,
            scope,
            entries: Vec::new(),
            available_bytes: 0,
            reserve_hint: 0,
            replace: 0,
            #[cfg(test)]
            hits: 0,
        })
    }

    pub fn set_reserve_hint(&mut self, hint: usize) {
        self.reserve_hint = hint.min(MAX_ENTRIES);
    }

    pub fn observed_pairs(&self) -> usize {
        self.entries.len()
    }

    pub fn fit_for_scene(
        &mut self,
        total_bytes: usize,
        count: usize,
        work: &mut Work,
    ) -> Result<usize, TrajectoryError> {
        self.available_bytes = total_bytes
            .checked_sub(Scratch::required_bytes(count)?)
            .ok_or(TrajectoryError::WorkLimit)?;
        if self.bytes()? > self.available_bytes {
            // Entries are Copy/no-drop values. Release the optional backing
            // before another owner's retained scratch can exceed the bound.
            work.charge(4)?;
            self.entries = Vec::new();
            self.replace = 0;
        }
        total_bytes
            .checked_sub(self.bytes()?)
            .ok_or(TrajectoryError::WorkLimit)
    }

    fn shape_keys(&self, entry: &Entry) -> Option<[ShapeKey; 2]> {
        Some([
            ShapeKey::of(self.colliders.get(entry.a.collider)?.shape())?,
            ShapeKey::of(self.colliders.get(entry.b.collider)?.shape())?,
        ])
    }

    fn matches_replay(&self, replay: &ReplayPairs) -> bool {
        replay.scope.is_some_and(|scope| {
            scope.start.to_bits() == self.scope.start.to_bits()
                && scope.end.to_bits() == self.scope.end.to_bits()
        })
    }

    /// Restore same-clock primitive proofs whose shapes still have the
    /// original bits. Lookup rechecks motion, interval and policy.
    pub fn restore_scan(
        &mut self,
        replay: &ReplayPairs,
        start: Time,
        work: &mut Work,
    ) -> Result<usize, TrajectoryError> {
        if !self.matches_replay(replay) {
            return Ok(0);
        }
        let old = self.bytes()?;
        let maximum = (self.available_bytes / std::mem::size_of::<Entry>()).min(MAX_ENTRIES);
        work.charge(4 * replay.entries.len() as u64)?;
        for (entry, shapes) in &replay.entries {
            if entry.start.to_bits() != start.to_bits() {
                continue;
            }
            work.charge(128 + 4 * self.entries.len() as u64)?;
            if self.shape_keys(entry) != Some(*shapes) {
                continue;
            }
            let pair = (entry.a.collider, entry.b.collider);
            if let Some(slot) = self
                .entries
                .iter_mut()
                .find(|current| (current.a.collider, current.b.collider) == pair)
            {
                *slot = *entry;
            } else if self.entries.len() < maximum {
                if self.entries.len() == self.entries.capacity() {
                    let slots = (self.entries.capacity().max(1) * 2).min(maximum);
                    let price = (slots + self.entries.len()) * std::mem::size_of::<Entry>();
                    work.charge(price as u64)?;
                    self.entries
                        .try_reserve_exact(slots - self.entries.len())
                        .map_err(|_| TrajectoryError::WorkLimit)?;
                }
                if self.bytes()? > self.available_bytes {
                    self.entries = Vec::new();
                    return Ok(0);
                }
                self.entries.push(*entry);
            }
        }
        Ok(self.bytes()? - old)
    }

    /// Preserve a bounded set of exact scans across a rollback-promotion.
    /// The backing comes from the same transient scene allowance.
    pub fn remember_scan(
        &self,
        replay: &mut ReplayPairs,
        start: Time,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        if replay.scope.is_some() && !self.matches_replay(replay) {
            return Ok(());
        }
        let available = self.available_bytes.saturating_sub(self.bytes()?);
        let old = replay.bytes();
        let item = std::mem::size_of::<(Entry, [ShapeKey; 2])>();
        let maximum = (replay.entries.capacity() + available / item).min(MAX_REPLAY_ENTRIES);
        work.charge(8 * self.entries.len() as u64)?;
        for entry in &self.entries {
            if replay.entries.len() == maximum {
                break;
            }
            if entry.start.to_bits() != start.to_bits()
                || entry.a.sensor
                || entry.b.sensor
                || entry.strict_proposal
            {
                continue;
            }
            work.charge(128)?;
            let mut duplicate = false;
            for (prior, _) in &replay.entries {
                work.charge(4)?;
                if (prior.a.collider, prior.b.collider) == (entry.a.collider, entry.b.collider)
                    && prior.start.to_bits() == entry.start.to_bits()
                    && prior.end.to_bits() == entry.end.to_bits()
                {
                    duplicate = true;
                    break;
                }
            }
            if duplicate {
                continue;
            }
            let Some(shapes) = self.shape_keys(entry) else {
                continue;
            };
            if replay.entries.len() == replay.entries.capacity() {
                let slots = (replay.entries.capacity().max(1) * 2).min(maximum);
                let price = ((slots + replay.entries.len()) * item) as u64;
                if price > work.limit - work.used {
                    // The current cast result is already complete. Keep the
                    // existing replay proofs and leave the response its budget.
                    break;
                }
                work.charge(price)?;
                replay
                    .entries
                    .try_reserve_exact(slots - replay.entries.len())
                    .map_err(|_| TrajectoryError::WorkLimit)?;
                if replay.bytes().saturating_sub(old) > available {
                    *replay = ReplayPairs::default();
                    return Ok(());
                }
            }
            replay.entries.push((*entry, shapes));
            replay.scope = Some(self.scope);
        }
        Ok(())
    }

    pub fn finish_scan(&self, replay: &mut ReplayPairs) {
        if self.matches_replay(replay) {
            *replay = ReplayPairs::default();
        }
    }

    fn bytes(&self) -> Result<usize, TrajectoryError> {
        self.entries
            .capacity()
            .checked_mul(std::mem::size_of::<Entry>())
            .ok_or(TrajectoryError::WorkLimit)
    }

    #[cfg(test)]
    pub fn diagnostics(&self) -> (usize, usize, usize) {
        (
            self.hits,
            self.entries.len(),
            self.entries.capacity() * std::mem::size_of::<Entry>(),
        )
    }

    pub(super) fn bound_to(&self, colliders: &rp::ColliderSet, policies: &ContactPolicies) -> bool {
        // Compare safe borrowed owners; no stored/dereferenced raw pointer or
        // widened Native alias contract is introduced.
        std::ptr::eq(self.colliders, colliders) && std::ptr::eq(self.policies, policies)
    }

    /// Transfer the finite response's strict full-interval clearance proof
    /// into the existing slot for its hit pair, within this Native context.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::physics3d::character_motion) fn remember_strict_proposal(
        &mut self,
        colliders: &rp::ColliderSet,
        a: ColliderTrajectory,
        b: ColliderTrajectory,
        start: Time,
        end: Time,
        clearance: f32,
        tolerance: Time,
        result: solver_trajectory::CastCoverage,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        self.remember_response_proposal(
            colliders, a, b, start, end, clearance, tolerance, result, false, work,
        )
    }

    /// Transfer a complete proof from the actual existing-contact policy.
    /// Future lookups still require that policy, tolerance and initial inputs.
    #[allow(clippy::too_many_arguments)]
    pub(in crate::physics3d::character_motion) fn remember_existing_proposal(
        &mut self,
        colliders: &rp::ColliderSet,
        a: ColliderTrajectory,
        b: ColliderTrajectory,
        start: Time,
        end: Time,
        clearance: f32,
        tolerance: Time,
        result: solver_trajectory::CastCoverage,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        self.remember_response_proposal(
            colliders, a, b, start, end, clearance, tolerance, result, true, work,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn remember_response_proposal(
        &mut self,
        colliders: &rp::ColliderSet,
        a: ColliderTrajectory,
        b: ColliderTrajectory,
        start: Time,
        end: Time,
        clearance: f32,
        tolerance: Time,
        result: solver_trajectory::CastCoverage,
        allow_existing_proof: bool,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        if !std::ptr::eq(self.colliders, colliders)
            || result.hit.is_some()
            || (!result.strictly_clear_start && !allow_existing_proof)
            || result.reused
            || !start.is_finite()
            || !end.is_finite()
            || start >= end
            || start < self.scope.start
            || end > self.scope.end
            || !clearance.is_finite()
            || clearance < 0.
            || !tolerance.is_finite()
            || tolerance <= 0.
            || matches!(a.motion.curve, Curve::Ccd { .. })
            || matches!(b.motion.curve, Curve::Ccd { .. })
        {
            return Ok(());
        }

        work.charge(self.entries.len() as u64 * 4 + 64)?;
        if let Some(entry) = self
            .entries
            .iter_mut()
            .find(|entry| (entry.a.collider, entry.b.collider) == (a.collider, b.collider))
        {
            work.charge(512)?;
            if entry.hit.is_some()
                && entry.allow_existing
                && entry.clearance.to_bits() == clearance.to_bits()
                && start >= entry.start
                && same_attachment(&entry.a, &a)
                && same_attachment(&entry.b, &b)
                && covers(a.motion, start, end)
                && covers(b.motion, start, end)
            {
                work.charge(256)?;
                let strict_start = if result.strictly_clear_start {
                    Some((
                        a.motion.metered_pose(start, work)?,
                        b.motion.metered_pose(start, work)?,
                    ))
                } else {
                    None
                };
                *entry = Entry {
                    a,
                    b,
                    start,
                    end,
                    clearance,
                    tolerance,
                    allow_existing: true,
                    strict_proposal: result.strictly_clear_start,
                    hit: None,
                    strict_start,
                };
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn lookup(
        &mut self,
        a: &ColliderTrajectory,
        b: &ColliderTrajectory,
        start: Time,
        end: Time,
        clearance: f32,
        tolerance: Time,
        allow_existing: bool,
        work: &mut Work,
    ) -> Result<Lookup, TrajectoryError> {
        if !start.is_finite()
            || !end.is_finite()
            || end < start
            || start < self.scope.start
            || end > self.scope.end
            || !clearance.is_finite()
            || clearance < 0.
            || !tolerance.is_finite()
            || tolerance <= 0.
        {
            return Err(TrajectoryError::InvalidTime);
        }
        work.charge(self.entries.len() as u64 * 4 + 64)?;
        for (index, entry) in self.entries.iter().enumerate() {
            if (entry.a.collider, entry.b.collider) != (a.collider, b.collider) {
                continue;
            }
            work.charge(512)?;
            let exact =
                start.to_bits() == entry.start.to_bits() && end.to_bits() == entry.end.to_bits();
            // Time tolerance only controls the cut of a hit bracket. The
            // strict proposal cleared this entire interval at the requested
            // margin and with the same observed initial leaf inputs.
            let same_tolerance = entry.tolerance.to_bits() == tolerance.to_bits()
                || (entry.strict_proposal && exact);
            if entry.clearance.to_bits() != clearance.to_bits()
                || !same_tolerance
                || entry.allow_existing != allow_existing
            {
                return Ok(Lookup::Miss(Some(index)));
            }
            if !motion(&entry.a, a, start, end) || !motion(&entry.b, b, start, end) {
                if allow_existing && entry.strict_start.is_some() {
                    if let Some(hit) = entry.hit.filter(|hit| {
                        hit.safe_time.to_bits() == start.to_bits()
                            && hit.hit_time == start.next_up()
                            && hit.hit_time <= end
                    }) {
                        if let Some(prefix) = self.adjacent_prefix(entry, a, b, hit, end, work)? {
                            return Ok(Lookup::Recheck(Some(index), prefix));
                        }
                    }
                }
                return Ok(Lookup::Miss(Some(index)));
            }
            let coverage_end = entry.hit.map_or(entry.end, |hit| hit.safe_time);
            // Set inclusion alone is insufficient: an initial closed contact
            // may reset its effective margin/outgoing policy. Same pose bits
            // reproduce the observed strict original leaf predicates exactly.
            let prefix = if !exact && start >= entry.start && end <= coverage_end {
                if let Some((old_a, old_b)) = entry.strict_start {
                    start.to_bits() == entry.start.to_bits()
                        || (pose(a.motion.metered_pose(start, work)?, old_a)
                            && pose(b.motion.metered_pose(start, work)?, old_b))
                } else {
                    // The old non-strict initial band is reusable only when
                    // all its original static geometry/rate inputs are equal.
                    // A changed or rotating initial state still takes the
                    // original full cast; a missing witness is never clearance.
                    same_existing_initial(entry, a, b, start, end, work)?
                }
            } else {
                false
            };
            if exact || prefix {
                #[cfg(test)]
                {
                    self.hits += 1;
                }
                return Ok(Lookup::Reuse(if exact { entry.hit } else { None }));
            }
            // A changed initial pose is not a strict-start proof. Carry only
            // the old covered interval to the original cast, which reexecutes
            // its initial leaf and consumes this token only for left>clearance.
            if entry.strict_start.is_some() && start >= entry.start && end <= coverage_end {
                return Ok(Lookup::Recheck(
                    Some(index),
                    super::solver_trajectory::StrictPrefix::Clear,
                ));
            }
            // The new interval still contains the complete original first-hit
            // bracket. The path, primitive attachments and margin match, so
            // the earlier proof covers the shortened prefix up to safe_time.
            // The new start must pass its own Native and existing-contact policy.
            if let Some(hit) = entry.hit.filter(|hit| {
                entry.strict_start.is_some()
                    && start >= entry.start
                    && start <= hit.safe_time
                    && hit.hit_time <= end
                    && hit.hit_time > hit.safe_time
                    && hit.hit_time - hit.safe_time <= tolerance
            }) {
                return Ok(Lookup::Recheck(
                    Some(index),
                    solver_trajectory::StrictPrefix::Hit(hit),
                ));
            }
            return Ok(Lookup::Miss(Some(index)));
        }
        Ok(Lookup::Miss(None))
    }

    fn adjacent_prefix(
        &self,
        old: &Entry,
        a: &ColliderTrajectory,
        b: &ColliderTrajectory,
        hit: CastHit,
        end: Time,
        work: &mut Work,
    ) -> Result<Option<solver_trajectory::StrictPrefix>, TrajectoryError> {
        let spinning = |m: ShapeMotion| matches!(m.curve, Curve::Integrated(k) if k.native.angular_velocity != rp::Vector::ZERO);
        if !matches!(
            (a.role, b.role),
            (Role::Prescribed, Role::Character(_)) | (Role::Character(_), Role::Prescribed)
        ) || a.sensor
            || b.sensor
            || !same_attachment(&old.a, a)
            || !same_attachment(&old.b, b)
            || !covers(a.motion, hit.safe_time, end)
            || !covers(b.motion, hit.safe_time, end)
        {
            return Ok(None);
        }
        work.charge(1152)?; // both original pose pairs and exact shape admission.
        let a_shape = self
            .colliders
            .get(a.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        let b_shape = self
            .colliders
            .get(b.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        if !((a_shape.as_cuboid().is_some() && b_shape.as_capsule().is_some())
            || (b_shape.as_cuboid().is_some() && a_shape.as_capsule().is_some()))
        {
            return Ok(None);
        }
        let same_pair_at = |time| {
            pose(a.motion.pose(time), old.a.motion.pose(time))
                && pose(b.motion.pose(time), old.b.motion.pose(time))
        };
        if !same_pair_at(hit.safe_time) {
            return Ok(None);
        }
        // A changed endpoint invalidates the hit, but its unchanged safe pose
        // still certifies the first equal-pose cell at the original margin.
        // The original cast rechecks its Native start before using either.
        if same_pair_at(hit.hit_time) {
            Ok(Some(solver_trajectory::StrictPrefix::Hit(hit)))
        } else if spinning(a.motion) || spinning(b.motion) {
            Ok(Some(solver_trajectory::StrictPrefix::FirstCell))
        } else {
            Ok(None)
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn store(
        &mut self,
        slot: Option<usize>,
        a: ColliderTrajectory,
        b: ColliderTrajectory,
        start: Time,
        end: Time,
        clearance: f32,
        tolerance: Time,
        allow_existing: bool,
        result: super::solver_trajectory::CastCoverage,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        if result.reused {
            // Retain the wider original coverage, not its narrowed consumer.
            #[cfg(test)]
            {
                self.hits += 1;
            }
            return Ok(());
        }
        let maximum = (self.available_bytes / std::mem::size_of::<Entry>()).min(MAX_ENTRIES);
        if maximum == 0
            || matches!(a.motion.curve, Curve::Ccd { .. })
            || matches!(b.motion.curve, Curve::Ccd { .. })
        {
            return Ok(());
        }
        if slot.is_none()
            && self.entries.len() < maximum
            && self.entries.len() == self.entries.capacity()
        {
            let capacity = if self.entries.capacity() == 0 {
                // A previous context supplies a size hint, never geometry. Keep
                // geometric growth if the initial reservation would consume a
                // significant fraction of the remaining tick allowance.
                let hint = self.reserve_hint.min(maximum);
                if hint * std::mem::size_of::<Entry>() <= (work.limit - work.used) as usize / 16 {
                    hint.max(1)
                } else {
                    1
                }
            } else {
                self.entries.capacity() * 2
            };
            let capacity = capacity.min(maximum);
            // Geometric growth, including the copied old entries, is admitted
            // before allocation. This is logical work, not a CPU/RSS promise.
            let price = (capacity + self.entries.len())
                .checked_mul(std::mem::size_of::<Entry>())
                .ok_or(TrajectoryError::WorkLimit)?;
            work.charge(u64::try_from(price).map_err(|_| TrajectoryError::WorkLimit)?)?;
            self.entries
                .try_reserve_exact(capacity - self.entries.len())
                .map_err(|_| TrajectoryError::WorkLimit)?;
            if self.bytes()? > self.available_bytes {
                return Err(TrajectoryError::WorkLimit);
            }
        }
        work.charge(256)?;
        let strict_start = if result.strictly_clear_start {
            Some((
                a.motion.metered_pose(start, work)?,
                b.motion.metered_pose(start, work)?,
            ))
        } else {
            None
        };
        let value = Entry {
            a,
            b,
            start,
            end,
            clearance,
            tolerance,
            allow_existing,
            strict_proposal: false,
            hit: result.hit,
            strict_start,
        };
        if let Some(index) = slot {
            *self
                .entries
                .get_mut(index)
                .ok_or(TrajectoryError::InvalidReference)? = value;
        } else if self.entries.len() < maximum {
            self.entries.push(value);
        } else {
            let index = self.replace % self.entries.len();
            self.entries[index] = value;
            self.replace = (index + 1) % self.entries.len();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
