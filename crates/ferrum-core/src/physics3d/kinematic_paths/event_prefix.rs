//! Recheck a selected event against the backend pass schedule actually committed.
//! No backend step or repeated character/native impulse solve occurs here.
use super::{KinematicPath, PathScratch, PhysicsWorld3d};
use crate::physics3d::motion_time::Time;
use crate::physics3d::world::native_id;
use rapier3d::prelude as rp;

/// A fixed bound on extra controller previews; each preview's queries retain
/// their existing contact/timeline bounds and are recorded in step diagnostics.
pub(super) const MAX_REFINEMENTS: usize = 32;
pub(super) struct PrefixEvent {
    /// Normalized fixed-tick fraction, not seconds.
    pub impact: Time,
    pub mask: u16,
    pub character_stops: usize,
    pub dynamic: bool,
}
impl PhysicsWorld3d {
    pub(super) fn needs_prefix_recheck(&self) -> bool {
        self.backend.bodies.iter().any(|(_, b)| {
            b.is_enabled()
                && b.body_type() == rp::RigidBodyType::KinematicVelocityBased
                && b.angvel() != rp::Vector::ZERO
        })
    }

    /// `start`/`impact` are normalized tick fractions; `tick_dt` is in seconds.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn refine_prefix_event(
        &mut self,
        paths: &[KinematicPath],
        scratch: &mut PathScratch,
        start: Time,
        impact: Time,
        tick_dt: Time,
        mask: u16,
        character_stops: usize,
        dynamic: bool,
        dynamic_allowed: bool,
        allowance: usize,
    ) -> PrefixEvent {
        let mut event = PrefixEvent {
            impact,
            mask,
            character_stops,
            dynamic,
        };
        // Keep the previously selected event until a new prefix either reaches
        // it safely or identifies an earlier obstruction. The original solve
        // already published any touching dynamic impulse exactly once.
        let mut pending = std::mem::take(&mut scratch.pending_stops);
        let mut candidate = Vec::new();
        for _ in 0..allowance.min(MAX_REFINEMENTS) {
            self.backend.integration_parameters.dt =
                match crate::physics3d::motion_time::native_duration(
                    tick_dt * (event.impact - start),
                ) {
                    Ok(seconds) => seconds,
                    Err(error) => {
                        self.character_motion.backend_motion.fail(error);
                        scratch.pending_stops = pending;
                        return event;
                    }
                };
            self.set_path_targets(paths, scratch, event.impact);
            self.refresh_queries();
            self.preview_characters(&mut scratch.preview);
            self.refresh_path_motion_queries();
            let mut limit = self.limit_kinematic_paths(paths, &scratch.stopped, &scratch.preview);
            // Reuse both stop lists across iterations. The last accepted set
            // stays intact until the new candidate is checked.
            let fraction =
                self.character_stops(&scratch.preview, &scratch.stopped_bodies, &mut candidate);
            if !candidate.is_empty() {
                if fraction < limit.fraction {
                    limit.mask = 0;
                    limit.others.clear();
                    limit.fraction = fraction;
                } else if fraction > limit.fraction {
                    candidate.clear();
                }
            }
            let mut next_character_stops = candidate.len();
            for other in &limit.others {
                if !candidate.contains(other) {
                    candidate.push(*other);
                }
            }
            // The native contact solve was performed before refinement. Do not
            // count its cached visits again as newly executed controller work.
            for r in self.characters.values_mut() {
                r.state.character_coupling_iterations = r
                    .state
                    .character_coupling_iterations
                    .saturating_sub(r.dynamic_iterations);
            }
            self.record_path_queries(limit.casts, limit.failures, !scratch.preview.is_empty());
            let dynamic_fraction = if dynamic_allowed {
                self.limit_character_dynamic_motion()
            } else {
                1.0
            };
            let next_dynamic = dynamic_fraction < limit.fraction;
            if next_dynamic {
                limit.fraction = dynamic_fraction;
                limit.mask = 0;
                candidate.clear();
                next_character_stops = 0;
            }
            self.restore_character_preview(&scratch.preview);
            if limit.mask == 0 && candidate.is_empty() && !next_dynamic {
                // This duration has no earlier obstruction under its own actual
                // schedule. Commit it and the previous obstruction's stop set.
                scratch.pending_stops = pending;
                return event;
            }
            let next = start + (event.impact - start) * limit.fraction;
            if !next.is_finite() || next >= event.impact {
                // Exact end contact is safe only at fraction one; no tolerance
                // enlargement turns a non-progressing earlier event into success.
                if limit.fraction == 1.0 {
                    scratch.pending_stops = pending;
                    return event;
                }
                break;
            }
            std::mem::swap(&mut pending, &mut candidate);
            event = PrefixEvent {
                impact: next,
                mask: limit.mask,
                character_stops: next_character_stops,
                dynamic: next_dynamic,
            };
            if next <= start {
                scratch.pending_stops = pending;
                return event;
            }
        }
        // Existing unsupported-query policy rejects prescribed movement at the
        // current time, records the failure, and still consumes the fixed clock.
        scratch.pending_stops = pending;
        self.record_path_queries(0, 1, false);
        for (id, b) in self.backend.bodies.iter() {
            if b.is_enabled()
                && b.body_type() == rp::RigidBodyType::KinematicVelocityBased
                && b.angvel() != rp::Vector::ZERO
            {
                let (slot, generation) = id.into_raw_parts();
                let id = crate::physics3d::BodyId { slot, generation };
                if !scratch.pending_stops.contains(&id) {
                    scratch.pending_stops.push(id);
                }
            }
        }
        // All entries use the same visible character-stop failure path.
        event.character_stops = scratch.pending_stops.len();
        event.impact = start;
        event.dynamic = false;
        debug_assert!(scratch.pending_stops.iter().all(|id| self
            .backend
            .bodies
            .get(native_id(*id))
            .is_some()));
        event
    }
}

#[cfg(test)]
mod tests;
