//! Reusable Rust-only collector for actual solver intervals and accepted CCD overrides.
use super::solver_trajectory::Domain;
use super::solver_trajectory::Time;
use rapier3d::pipeline::{SolverBodyIntegration, SolverBodyMotion};
use rapier3d::prelude as rp;

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub(super) struct MotionTrace {
    pub enabled: bool,
    pub motions: Vec<SolverBodyMotion>,
    pub clamps: Vec<ClampMotion>,
    // Integration laws are tick-local scratch. Completed projectile observations
    // retain their existing serialized schema; character consumers must finish
    // before this scratch is reset at the next backend pass.
    #[serde(skip)]
    pub integrations: Vec<SolverBodyIntegration>,
    #[serde(skip)]
    pub accepted_clamps: Vec<AcceptedClamp>,
    #[serde(skip)]
    pub integration_capacity_failed: bool,
    #[serde(skip)]
    pub actual: Vec<AcceptedCurve>,
    next_time: f32,
    pass_start: f32,
    pass_duration: f32,
    // Proof-only observation of real completed pass domains. Production keeps
    // only its scalar actual clock and the already bounded accepted curves.
    #[cfg(test)]
    #[serde(skip)]
    pub precise_passes: Vec<Domain>,
    #[serde(skip)]
    actual_next_time: Time,
    #[serde(skip)]
    actual_pass_start: Time,
    #[serde(skip)]
    actual_step_start: Time,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(super) struct ClampMotion {
    pub body: rp::RigidBodyHandle,
    pub start_time: f32,
    pub end_time: f32,
    pub start: rp::Pose,
    pub end: rp::Pose,
    pub fraction: f32,
    order: usize,
}

/// Independent hard bound for new transient exact-path observations. The
/// bound is checked before a fallible reserve; it is not an RSS guarantee.
const MAX_EXACT_INTERVALS: usize = 1 << 20;

#[derive(Debug)]
pub(super) struct AcceptedClamp {
    pub body: rp::RigidBodyHandle,
    pub start_time: Time,
    pub end_time: Time,
    pub sweep: rapier3d::parry::query::sweep_toi::Sweep,
    pub fraction: f32,
    pub full_end_time: Time,
    order: usize,
}

/// An accepted domain of one original kernel curve. Keeping the original
/// domain avoids changing nlerp/anchored time laws when a prefix is retained.
#[derive(Clone, Copy, Debug)]
pub(super) struct AcceptedCurve {
    pub body: rp::RigidBodyHandle,
    pub curve: super::solver_trajectory::Curve,
    pub start_time: Time,
    pub end_time: Time,
}

impl MotionTrace {
    pub fn reset(&mut self, enabled: bool) {
        self.enabled = enabled;
        self.motions.clear();
        self.clamps.clear();
        self.integrations.clear();
        self.actual.clear();
        #[cfg(test)]
        self.precise_passes.clear();
        self.accepted_clamps.clear();
        self.integration_capacity_failed = false;
        self.next_time = 0.0;
        self.actual_next_time = 0.0;
        self.actual_pass_start = 0.0;
        self.actual_step_start = 0.0;
    }

    pub fn begin_pass(&mut self, duration: f32) {
        self.begin_precise_pass(duration, f64::from(duration));
    }

    /// Completed native pass only; old observer labels retain their original
    /// f32 offset while actual curve clocks keep the private tick-local Time.
    pub fn begin_precise_pass(&mut self, observer_duration: f32, actual_duration: Time) {
        self.begin_precise_domain(
            observer_duration,
            Domain {
                start: self.actual_next_time,
                end: self.actual_next_time + actual_duration,
            },
        );
    }

    pub fn begin_precise_domain(&mut self, observer_duration: f32, domain: Domain) {
        self.pass_start = self.next_time;
        self.pass_duration = observer_duration;
        self.next_time += observer_duration;
        if self.actual_next_time == 0. {
            self.actual_step_start = domain.start;
        }
        self.actual_pass_start = domain.start;
        self.actual_next_time = domain.end;
        #[cfg(test)]
        {
            if self.precise_passes.len() >= MAX_EXACT_INTERVALS
                || self.precise_passes.try_reserve(1).is_err()
            {
                self.integration_capacity_failed = true;
                return;
            }
            self.precise_passes.push(Domain {
                start: self.actual_pass_start,
                end: self.actual_next_time,
            });
        }
    }

    pub fn precise_domain(&self) -> Domain {
        Domain {
            start: self.actual_step_start,
            end: self.actual_next_time,
        }
    }

    #[cfg(test)]
    pub fn precise_elapsed(&self) -> Time {
        self.actual_next_time
    }

    pub fn record(&mut self, mut motion: SolverBodyMotion) {
        motion.start_time += self.pass_start;
        motion.end_time += self.pass_start;
        self.motions.push(motion);
    }

    pub fn record_integration(&mut self, integration: SolverBodyIntegration) {
        self.record_integration_bounded(integration, MAX_EXACT_INTERVALS);
    }

    fn record_integration_bounded(&mut self, mut integration: SolverBodyIntegration, limit: usize) {
        self.record(integration.motion);
        if self.integration_capacity_failed {
            return;
        }
        if self.integrations.len() >= limit || self.integrations.try_reserve(1).is_err() {
            self.integration_capacity_failed = true;
            return;
        }
        integration.motion.start_time += self.pass_start;
        integration.motion.end_time += self.pass_start;
        self.integrations.push(integration);
    }

    #[cfg(test)]
    pub fn record_curve(&mut self, mut actual: AcceptedCurve) {
        actual.start_time += self.actual_pass_start;
        actual.end_time += self.actual_pass_start;
        actual.curve = actual.curve.shifted(self.actual_pass_start);
        self.record_global_curve(actual);
    }

    pub fn record_global_curve(&mut self, actual: AcceptedCurve) {
        if self.integration_capacity_failed {
            return;
        }
        if self.actual.len() >= MAX_EXACT_INTERVALS || self.actual.try_reserve(1).is_err() {
            self.integration_capacity_failed = true;
            return;
        }
        self.actual.push(actual);
    }

    pub fn accepted_clamp(
        &mut self,
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        sweep: &rapier3d::parry::query::sweep_toi::Sweep,
        fraction: f32,
    ) {
        // Preserve the old record and callback count exactly. The original
        // input poses are the same endpoints used by the backend's writeback.
        self.clamp(body, start, end, fraction);
        if self.integration_capacity_failed {
            return;
        }
        if self.accepted_clamps.len() == MAX_EXACT_INTERVALS
            || self.accepted_clamps.try_reserve(1).is_err()
        {
            self.integration_capacity_failed = true;
            return;
        }
        self.accepted_clamps.push(AcceptedClamp {
            body,
            start_time: self.actual_pass_start,
            end_time: self.actual_next_time,
            sweep: *sweep,
            fraction,
            full_end_time: self.actual_next_time,
            order: self.accepted_clamps.len(),
        });
    }

    pub fn clamp(
        &mut self,
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        fraction: f32,
    ) {
        self.clamps.push(ClampMotion {
            body,
            start_time: self.pass_start,
            end_time: self.pass_start + self.pass_duration,
            start,
            end,
            fraction,
            order: self.clamps.len(),
        });
    }

    pub fn sort(&mut self) {
        self.actual.sort_unstable_by(|a, b| {
            a.body
                .into_raw_parts()
                .cmp(&b.body.into_raw_parts())
                .then(a.start_time.total_cmp(&b.start_time))
                .then(a.end_time.total_cmp(&b.end_time))
        });
        self.integrations.sort_unstable_by(|a, b| {
            a.motion
                .body
                .into_raw_parts()
                .cmp(&b.motion.body.into_raw_parts())
                .then(a.motion.start_time.total_cmp(&b.motion.start_time))
                .then(a.motion.end_time.total_cmp(&b.motion.end_time))
        });
        self.accepted_clamps.sort_unstable_by(|a, b| {
            a.body
                .into_raw_parts()
                .cmp(&b.body.into_raw_parts())
                .then(a.start_time.total_cmp(&b.start_time))
                .then(a.order.cmp(&b.order))
        });
        self.accepted_clamps.dedup_by(|later, previous| {
            if later.body == previous.body && later.start_time == previous.start_time {
                // A repeated clamp rebuilds its Sweep from the shortened end.
                // Its parameter spans the previous accepted prefix duration.
                previous.end_time = previous.start_time
                    + (previous.end_time - previous.start_time) * f64::from(previous.fraction);
                previous.sweep = later.sweep;
                previous.fraction = later.fraction;
                true
            } else {
                false
            }
        });
        self.motions.sort_unstable_by(|a, b| {
            a.body
                .into_raw_parts()
                .cmp(&b.body.into_raw_parts())
                .then(a.start_time.total_cmp(&b.start_time))
                .then(a.end_time.total_cmp(&b.end_time))
        });
        self.clamps.sort_unstable_by(|a, b| {
            a.body
                .into_raw_parts()
                .cmp(&b.body.into_raw_parts())
                .then(a.start_time.total_cmp(&b.start_time))
                .then(a.order.cmp(&b.order))
        });
        self.clamps.dedup_by(|later, previous| {
            if later.body == previous.body && later.start_time == previous.start_time {
                previous.fraction *= later.fraction;
                previous.end = later.end;
                true
            } else {
                false
            }
        });
    }
}

#[cfg(test)]
mod tests;
