//! Read-only pair approval of a safe-fitting real-support phase. This does
//! not replace the caller's later whole-scene/endpoint checks or publish state.
use super::*;
use crate::physics3d::solver_trajectory::{self, ShapeMotion};

pub(super) type RejectedTimes = [Option<Time>; 4];

pub(super) struct FullFuture<'a> {
    actor: ShapeMotion,
    other: ShapeMotion,
    actor_shape: &'a dyn rp::Shape,
    other_shape: &'a dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    actor_first: bool,
}
impl<'a> FullFuture<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn new(
        actor: ColliderTrajectory,
        original: Curve,
        other: ColliderTrajectory,
        other_curve: Curve,
        colliders: &'a rp::ColliderSet,
        carrier: Kernel,
        start: Time,
        end: Time,
        clearance: f32,
        actor_first: bool,
        work: &mut Work,
    ) -> Result<Self, TrajectoryError> {
        work.charge(128)?;
        let actor_shape = colliders
            .get(actor.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        let other_shape = colliders
            .get(other.collider)
            .ok_or(TrajectoryError::InvalidReference)?
            .shape();
        let actor = ShapeMotion {
            curve: original,
            ..actor.motion
        };
        let other = ShapeMotion {
            curve: other_curve,
            ..other.motion
        };
        // Same original observer-label arithmetic as the Native context's
        // scene query. Logical start/end remain Time; h/domain are never reset.
        let tolerance = Time::from(
            ((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6)
                .max(f32::MIN_POSITIVE),
        );
        if !start.is_finite()
            || !end.is_finite()
            || start > end
            || !clearance.is_finite()
            || clearance < 0.
            || !tolerance.is_finite()
            || tolerance <= 0.
        {
            return Err(TrajectoryError::InvalidTime);
        }
        Ok(Self {
            actor,
            other,
            actor_shape,
            other_shape,
            start,
            end,
            clearance,
            tolerance,
            actor_first,
        })
    }
    fn ordered_motions(
        &self,
        candidate: Curve,
    ) -> (
        ShapeMotion,
        &'a dyn rp::Shape,
        ShapeMotion,
        &'a dyn rp::Shape,
    ) {
        let actor = ShapeMotion {
            curve: candidate,
            ..self.actor
        };
        // Preserve the encountered a/b operand order and the original shapes.
        if self.actor_first {
            (actor, self.actor_shape, self.other, self.other_shape)
        } else {
            (self.other, self.other_shape, actor, self.actor_shape)
        }
    }

    fn query(
        &self,
        candidate: Curve,
        end: Time,
        allow_existing: bool,
        work: &mut Work,
    ) -> Result<solver_trajectory::CastCoverage, TrajectoryError> {
        let (a, sa, b, sb) = self.ordered_motions(candidate);
        #[cfg(test)]
        let work_before = work.used;
        solver_trajectory::cast_full_shapes_policy_coverage(
            a,
            sa,
            b,
            sb,
            self.start,
            end,
            self.clearance,
            self.tolerance,
            work,
            allow_existing,
        )
        .inspect_err(|_error| {
            #[cfg(test)]
            if matches!(
                std::thread::current().name(),
                Some("physics3d::character_tests::elevator_support_is_evaluated_after_the_platform_moves")
            ) {
                eprintln!(
                    "C71_FULL_FUTURE_QUERY_ERR case={:?} error={_error:?} candidate={candidate:?} motion_a={a:?} motion_b={b:?} self_start={:?} self_end={:?} query_end={end:?} requested_clearance={:?} tolerance={:?} allow_existing={allow_existing} work_before={work_before} work_after={}",
                    std::thread::current().name(),
                    self.start,
                    self.end,
                    self.clearance,
                    self.tolerance,
                    work.used,
                );
            }
        })
    }

    pub(super) fn accepts_recording(
        &self,
        candidate: Curve,
        pair: (ColliderTrajectory, ColliderTrajectory),
        colliders: &rp::ColliderSet,
        memo: Option<&mut actual_scene::PairQueries<'_>>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        self.query_recording(candidate, pair, colliders, memo, true, None, work)
    }

    pub(super) fn accepts_existing_side_recording(
        &self,
        candidate: Curve,
        pair: (ColliderTrajectory, ColliderTrajectory),
        colliders: &rp::ColliderSet,
        memo: Option<&mut actual_scene::PairQueries<'_>>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let result = self.query(candidate, self.end, true, work)?;
        if result.hit.is_some() {
            return Ok(false);
        }
        if let Some(memo) = memo {
            let (a, b) = self.proposal_motions(candidate, pair);
            memo.remember_existing_proposal(
                colliders,
                a,
                b,
                self.start,
                self.end,
                self.clearance,
                self.tolerance,
                result,
                work,
            )?;
        }
        Ok(true)
    }

    pub(super) fn accepts_strict_recording(
        &self,
        candidate: Curve,
        pair: (ColliderTrajectory, ColliderTrajectory),
        colliders: &rp::ColliderSet,
        memo: Option<&mut actual_scene::PairQueries<'_>>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        self.query_recording(candidate, pair, colliders, memo, false, None, work)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn accepts_rotating_recording_with_hints(
        &self,
        candidate: Curve,
        pair: (ColliderTrajectory, ColliderTrajectory),
        colliders: &rp::ColliderSet,
        memo: Option<&mut actual_scene::PairQueries<'_>>,
        allow_existing: bool,
        rejected_times: &mut RejectedTimes,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let (a, sa, b, sb) = self.ordered_motions(candidate);
        // A prior conflict provides a time only. Recheck the actual poses
        // and selected clearance of this candidate before rejecting it.
        for at in rejected_times.iter().flatten().copied() {
            if solver_trajectory::rotating_support_conflict(
                a,
                sa,
                b,
                sb,
                self.start,
                self.end,
                self.clearance,
                Some(at),
                work,
            )?
            .is_some()
            {
                return Ok(false);
            }
        }
        if allow_existing
            && solver_trajectory::rotating_support_conflict(
                a,
                sa,
                b,
                sb,
                self.start,
                self.end,
                self.clearance,
                None,
                work,
            )?
            .is_some()
        {
            return Ok(false);
        }
        self.query_recording(
            candidate,
            pair,
            colliders,
            memo,
            allow_existing,
            Some(rejected_times),
            work,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn query_recording(
        &self,
        candidate: Curve,
        pair: (ColliderTrajectory, ColliderTrajectory),
        colliders: &rp::ColliderSet,
        memo: Option<&mut actual_scene::PairQueries<'_>>,
        allow_existing: bool,
        rejected_times: Option<&mut RejectedTimes>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let result = self.query(candidate, self.end, allow_existing, work)?;
        if let (Some(times), Some(hit)) = (rejected_times, result.hit) {
            let at = hit.hit_time;
            if self.start < at && at < self.end && !times.contains(&Some(at)) {
                times.rotate_right(1);
                times[0] = Some(at);
            }
        }
        if !allow_existing && (!result.strictly_clear_start || result.hit.is_some()) {
            return Ok(false);
        }
        if let Some(memo) = memo {
            self.record_coverage(candidate, pair, colliders, memo, result, work)?;
        }
        Ok(result.hit.is_none())
    }

    pub(super) fn record_coverage(
        &self,
        candidate: Curve,
        pair: (ColliderTrajectory, ColliderTrajectory),
        colliders: &rp::ColliderSet,
        memo: &mut actual_scene::PairQueries<'_>,
        result: solver_trajectory::CastCoverage,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        let (a, b) = self.proposal_motions(candidate, pair);
        memo.remember_strict_proposal(
            colliders,
            a,
            b,
            self.start,
            self.end,
            self.clearance,
            self.tolerance,
            result,
            work,
        )
    }

    fn proposal_motions(
        &self,
        candidate: Curve,
        (mut actor, mut other): (ColliderTrajectory, ColliderTrajectory),
    ) -> (ColliderTrajectory, ColliderTrajectory) {
        actor.motion = ShapeMotion {
            curve: candidate,
            ..self.actor
        };
        other.motion = self.other;
        // The memo belongs to the response epoch. The following scene
        // still checks eligibility, filters, ordered pair and both curves.
        if self.actor_first {
            (actor, other)
        } else {
            (other, actor)
        }
    }

    /// Return the original cast's coverage after an optional conflict probe.
    /// A confirmed conflict still rejects the candidate without a full cast.
    pub(super) fn coverage_with_conflict_hint(
        &self,
        candidate: Curve,
        rejected_time: &mut Option<Time>,
        work: &mut Work,
    ) -> Result<Option<solver_trajectory::CastCoverage>, TrajectoryError> {
        let signed_stationary = match candidate {
            Curve::Anchored {
                carrier,
                linear_velocity,
                ..
            } if linear_velocity == rp::Vector::ZERO => {
                let q = carrier.native.motion.start.rotation;
                let axis = rp::Vector::new(q.x, q.y, q.z);
                q.w * q.w < axis.length_squared()
                    && axis
                        .to_array()
                        .into_iter()
                        .filter(|value| *value != 0.)
                        .count()
                        == 1
            }
            _ => false,
        };
        if rejected_time.is_some() || signed_stationary {
            let (a, sa, b, sb) = self.ordered_motions(candidate);
            // The earlier query supplies only a time. This candidate keeps
            // its own Native poses, margin and initial-support policy.
            if let Some(confirmed) = solver_trajectory::rotating_support_conflict(
                a,
                sa,
                b,
                sb,
                self.start,
                self.end,
                self.clearance,
                *rejected_time,
                work,
            )? {
                *rejected_time = Some(confirmed);
                return Ok(None);
            }
        }
        let result = self.query(candidate, self.end, true, work)?;
        let Some(hit) = result.hit else {
            return Ok(Some(result));
        };
        if self.start < hit.hit_time && hit.hit_time < self.end {
            *rejected_time = Some(hit.hit_time);
        }
        Ok(None)
    }

    #[cfg(test)]
    pub(super) fn accepts_rotating(
        &self,
        candidate: Curve,
        pair: (ColliderTrajectory, ColliderTrajectory),
        colliders: &rp::ColliderSet,
        memo: Option<&mut actual_scene::PairQueries<'_>>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let (a, sa, b, sb) = self.ordered_motions(candidate);
        if solver_trajectory::rotating_support_conflict(
            a,
            sa,
            b,
            sb,
            self.start,
            self.end,
            self.clearance,
            None,
            work,
        )?
        .is_some()
        {
            return Ok(false);
        }
        self.accepts_recording(candidate, pair, colliders, memo, work)
    }

    pub(super) fn accepts(
        &self,
        candidate: Curve,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        // Match the real backend consumer. Initial geometry/margin is the
        // original pair policy's authority, never inferred from leaf.dist.
        // No loop allowance reset or copied proof result. A real future hit
        // rejects only this candidate; typed query/work errors propagate.
        Ok(self.query(candidate, self.end, true, work)?.hit.is_none())
    }
}

#[cfg(test)]
mod tests;
