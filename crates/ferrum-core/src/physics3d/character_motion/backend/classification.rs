//! Carry an already selected controller stop's consumer identity into Native.
//!
//! The caller supplies the final `pending_stops` after prefix refinement and
//! before stepping characters or entering Native. These tags do not select a
//! stop, change a path, or excuse any full-shape approval. In particular, a late
//! contact cannot use this helper to skip an unverified earlier Native prefix.
use super::*;

fn tag_bytes(scratch: &BackendMotionScratch, promoted: usize) -> Result<usize, TrajectoryError> {
    [
        scratch.mixed.capacity(),
        scratch.promoted.capacity().max(promoted),
        scratch.promotions.capacity(),
        scratch.affected.capacity(),
        scratch.prescribed_paths.capacity(),
        scratch.sweep_sensor_paths.capacity(),
    ]
    .into_iter()
    .try_fold(0_usize, |total, count| total.checked_add(count))
    .and_then(|count| count.checked_mul(std::mem::size_of::<BodyId>()))
    .ok_or(TrajectoryError::WorkLimit)
}

/// All-or-nothing registration of the existing selected stop set. Unsupported
/// live kinds leave the original fresh-proposal retry policy intact. A stale
/// generational identity is a typed failure, checked even in a mixed-kind set.
pub(super) fn register(
    selected: &[BodyId],
    bodies: &rp::RigidBodySet,
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    scratch: &mut BackendMotionScratch,
    work: &mut Work,
    max_scratch: usize,
) -> Result<bool, TrajectoryError> {
    if let Some(error) = scratch.error {
        return Err(error);
    }
    if selected.is_empty() {
        return Ok(false);
    }
    let target = scratch
        .promoted
        .len()
        .checked_add(selected.len())
        .filter(|n| *n <= MAX_INTERVALS)
        .ok_or(TrajectoryError::WorkLimit)?;
    let lookup = usize::BITS - target.max(characters.len()).max(1).leading_zeros();
    // Both validation passes, duplicate checks, and bounded sorted insertion
    // precede publication and share the current tick's logical Work allowance.
    let visits = (selected.len() as u64)
        .checked_mul(target as u64 + selected.len() as u64 + 32 + 4 * u64::from(lookup))
        .and_then(|n| n.checked_add(target as u64))
        .and_then(|n| n.checked_add(12))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(visits)?;
    let mut compatible = true;
    for &id in selected {
        let body = bodies
            .get(crate::physics3d::world::native_id(id))
            .ok_or(TrajectoryError::InvalidReference)?;
        compatible &= body.is_enabled()
            && body.is_kinematic()
            && !body.is_sleeping()
            && !characters.contains_key(&id);
    }
    if !compatible {
        return Ok(false);
    }
    let mut added = 0_usize;
    for (index, id) in selected.iter().enumerate() {
        if !selected[..index].contains(id) && scratch.promoted.binary_search(id).is_err() {
            added += 1;
        }
    }
    if added == 0 {
        return Ok(true);
    }
    let target = scratch
        .promoted
        .len()
        .checked_add(added)
        .ok_or(TrajectoryError::WorkLimit)?;
    let remaining = scratch.active_remaining(max_scratch)?;
    if tag_bytes(scratch, target)? > remaining {
        return Err(TrajectoryError::WorkLimit);
    }
    scratch
        .promoted
        .try_reserve_exact(target.saturating_sub(scratch.promoted.len()))
        .map_err(|_| TrajectoryError::WorkLimit)?;
    // Reserve may retain more backing than requested. Check the actual combined
    // tag backing before inserting any semantic identity.
    if tag_bytes(scratch, target)? > remaining {
        return Err(TrajectoryError::WorkLimit);
    }
    for &id in selected {
        if let Err(index) = scratch.promoted.binary_search(&id) {
            scratch.promoted.insert(index, id);
        }
    }
    // Do not set/clear promotion_pending: this is a controller-selected input
    // before Native, not a hidden rejected Native call or a late retry waiver.
    Ok(true)
}

impl PhysicsWorld3d {
    /// A coupled controller has already consumed these prescribed motions
    /// when it submits its proposal. Register them before Native inspects any
    /// interval; each actual contact and full prefix is still independently cast.
    pub(in crate::physics3d) fn classify_coupled_drivers(&mut self) -> Result<(), TrajectoryError> {
        if self.characters.len() < 2 {
            return Ok(());
        }
        let max_scratch = self.actual_motion_scratch_bound()?;
        let state = &mut self.character_motion.backend_motion;
        let mut work = Work {
            used: state.used,
            limit: super::super::trajectory::MAX_PROOF_WORK,
        };
        let result = (|| {
            work.charge(self.character_contacts.contact_count() as u64 * 32)?;
            for id in self.character_contacts.moving_drivers(&self.backend) {
                register(
                    &[id],
                    &self.backend.bodies,
                    &self.characters,
                    state,
                    &mut work,
                    max_scratch,
                )?;
            }
            Ok(())
        })();
        state.used = work.used;
        result
    }

    /// `selected` must be the finalized pending stop set of this controller
    /// prefix. Call before step_characters/step_with_joints, never after Native.
    pub(in crate::physics3d) fn classify_preview_stop_consumers(
        &mut self,
        selected: &[BodyId],
    ) -> Result<bool, TrajectoryError> {
        let max_scratch = self.actual_motion_scratch_bound()?;
        let scratch = &mut self.character_motion.backend_motion;
        let mut work = Work {
            used: scratch.used,
            limit: super::super::trajectory::MAX_PROOF_WORK,
        };
        let result = register(
            selected,
            &self.backend.bodies,
            &self.characters,
            scratch,
            &mut work,
            max_scratch,
        );
        scratch.used = work.used;
        #[cfg(test)]
        if std::thread::current().name().is_some_and(|name| {
            [
                "engine::unified_physics::platform_blocking_tests::external_squeeze_stops_the_engine_body_and_accumulates_work_across_ticks",
                "physics3d::character_squeeze_tests::squeeze_substeps_preserve_force_targets_and_original_motion_time",
                "physics3d::character_squeeze_tests::squeeze_events_preserve_unrelated_jump_input_and_full_tick_translation",
            ]
            .contains(&name)
        }) {
            eprintln!(
                "A35_SELECTED_CONSUMERS case={:?} selected_count={} selected={:?} result={result:?} promoted_count={} pending={} used={}/{}",
                std::thread::current().name(),
                selected.len(),
                &selected[..selected.len().min(8)],
                scratch.promoted.len(),
                scratch.promotion_pending,
                work.used,
                work.limit,
            );
        }
        result
    }
}

#[cfg(test)]
mod tests;
