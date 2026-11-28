//! Native work counts and CCD observations, independent of geometric queries.
use super::events::collider_ref;
use super::motion_time::Domain;
use super::world::native_id;
use super::{BodyId, ColliderRef, PhysicsWorld3d};

/// Last completed fixed tick's measurements. Work counts sum backend/CCD passes;
/// body/island gauges describe the final state. No timing or estimated row counts.
#[repr(C)]
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct StepStatistics {
    /// Distinct prescribed bodies stopped by capsule constraints during this tick.
    pub kinematic_character_stops: u32,
    /// Prescribed path collider-pair casts, separate from backend CCD work.
    pub kinematic_path_casts: u32,
    /// Unsupported prescribed-path casts or nonconverging event-prefix previews;
    /// affected paths stop conservatively while the accepted clock is consumed.
    pub kinematic_path_failures: u32,
    /// Distinct prescribed paths stopped by an obstacle or a blocked rider.
    pub kinematic_path_stops: u32,
    /// Controller previews for prescribed motion limits, without consuming input or pushing bodies.
    pub character_preview_passes: u32,
    /// Pair casts done by controller previews, excluded from accepted character state counts.
    pub character_preview_pair_casts: u32,
    /// Capsule-pair contact queries in previews, counted once per pair query.
    pub character_preview_pair_contacts: u32,
    /// Participant visits to coupled constraint rows during previews (two for a pair row).
    pub character_preview_coupling_visits: u32,
    /// Preview participants reaching a coupled solver or timeline work limit.
    pub character_preview_coupling_limits: u32,
    /// Relative moving-obstacle pair queries performed by controller previews.
    pub character_preview_obstacle_casts: u32,
    /// Geometric contact queries at sweep starts and contact refreshes in previews.
    pub character_preview_obstacle_contacts: u32,
    /// Unsupported sweep/contact queries encountered by controller previews.
    pub character_preview_obstacle_failures: u32,
    /// Calls into the backend pipeline (one normally; several for joint substeps).
    pub backend_steps: u32,
    /// Native CCD substeps, zero when CCD did not activate.
    pub ccd_substeps: u32,
    /// Contact points submitted to the native solver, summed across pipeline/CCD passes.
    pub solver_contacts: u32,
    /// Contact manifolds plus impulse joints submitted to the native solver.
    pub solver_constraints: u32,
    /// Cached narrow-phase contact pairs at the final backend pass (including non-touching pairs).
    pub tracked_contact_pairs: u32,
    /// Enabled dynamic bodies, including sleeping bodies.
    pub dynamic_bodies: u32,
    /// Enabled dynamic bodies with at least one nonzero inverse angular inertia axis.
    pub angular_bodies: u32,
    /// Enabled dynamic bodies asleep at the end of the tick.
    pub sleeping_bodies: u32,
    /// Dynamic bodies sleeping at tick start and awake at tick end.
    /// Authored wakes before `step` are not counted.
    pub bodies_woken: u32,
    /// Dynamic bodies awake at tick start and sleeping at tick end.
    pub bodies_put_to_sleep: u32,
    /// Persistent native islands of enabled dynamic/kinematic bodies at tick end.
    pub islands: u32,
    /// Island members, including kinematic bodies and sleeping bodies.
    pub island_bodies: u32,
    /// Islands with at least one awake member.
    pub active_islands: u32,
    /// Islands with every member sleeping.
    pub sleeping_islands: u32,
    /// Largest persistent island's enabled member count.
    pub largest_island_bodies: u32,
    /// Joints broken by native force/torque limits during this tick.
    pub broken_joints: u32,
    /// CCD collider-pair casts used to choose time slices (before solving).
    pub ccd_prediction_checks: u32,
    /// CCD collider-pair casts on solved motion, including sensors.
    /// Compound child casts and GJK iterations are not separate checks here.
    pub ccd_clamp_checks: u32,
    /// Actual CCD body pose clamps, before observation truncation.
    /// These do not imply a velocity impulse.
    pub ccd_clamps: u32,
    /// Clamp observations omitted by the tick's `max_events` capacity.
    pub ccd_clamps_dropped: u32,
}

/// A position clamp applied by CCD. Coordinates come from the CCD cast itself.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CcdClamp {
    /// Swept moving collider and its body generation.
    pub moving: ColliderRef,
    /// Collider that limited motion and its body generation.
    pub target: ColliderRef,
    /// Fraction of the individual sweep interval (not of the whole fixed tick).
    pub fraction: f32,
    /// Duration of that individual interval in seconds.
    pub sweep_seconds: f32,
    /// World-space witness from CCD.
    pub point: [f32; 3],
    /// World-space separating axis from target toward moving shape.
    pub normal: [f32; 3],
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub(super) struct Statistics {
    step: StepStatistics,
    clamps: Vec<CcdClamp>,
    sleeping_before: Vec<(BodyId, bool)>,
    islands: Vec<(u32, bool)>,
    joints_before: usize,
}
fn count(n: usize) -> u32 {
    n.min(u32::MAX as usize) as u32
}

impl Statistics {
    pub(super) fn stage_step(&mut self, prior: &mut Self) {
        // Keep an empty, already reserved CCD buffer on the live side.
        prior.clamps.clear();
        if self.clamps.is_empty() && self.clamps.capacity() > prior.clamps.capacity() {
            std::mem::swap(&mut self.clamps, &mut prior.clamps);
        }
        std::mem::swap(self, prior);
    }
}

impl PhysicsWorld3d {
    pub(super) fn record_character_stop(&mut self) {
        self.statistics.step.kinematic_character_stops = self
            .statistics
            .step
            .kinematic_character_stops
            .saturating_add(1);
    }

    pub(super) fn record_path_queries(&mut self, casts: u32, failures: u32, preview: bool) {
        let s = &mut self.statistics.step;
        s.kinematic_path_casts = s.kinematic_path_casts.saturating_add(casts);
        s.kinematic_path_failures = s.kinematic_path_failures.saturating_add(failures);
        if !preview {
            return;
        }
        s.character_preview_passes = s.character_preview_passes.saturating_add(1);
        // The controller records each pair query on both participants.
        let participants = self.characters.values().fold(0usize, |sum, runtime| {
            sum.saturating_add(runtime.state.character_pair_casts)
        });
        s.character_preview_pair_casts = s
            .character_preview_pair_casts
            .saturating_add(count(participants / 2));
        let pair_contacts = self.characters.values().fold(0usize, |sum, r| {
            sum.saturating_add(r.state.character_pair_contact_checks)
        });
        s.character_preview_pair_contacts = s
            .character_preview_pair_contacts
            .saturating_add(count(pair_contacts / 2));
        for runtime in self.characters.values() {
            s.character_preview_coupling_visits = s
                .character_preview_coupling_visits
                .saturating_add(count(runtime.state.character_coupling_iterations));
            s.character_preview_coupling_limits = s
                .character_preview_coupling_limits
                .saturating_add(u32::from(runtime.state.character_coupling_iteration_limit));
            s.character_preview_obstacle_contacts = s
                .character_preview_obstacle_contacts
                .saturating_add(count(runtime.state.moving_obstacle_contact_checks));
            s.character_preview_obstacle_failures =
                s.character_preview_obstacle_failures.saturating_add(count(
                    runtime
                        .state
                        .failed_moving_obstacle_casts
                        .saturating_add(runtime.state.failed_moving_obstacle_contacts),
                ));
            s.character_preview_obstacle_casts = s
                .character_preview_obstacle_casts
                .saturating_add(count(runtime.state.moving_obstacle_casts));
        }
    }
    pub(super) fn record_path_stop(&mut self) {
        self.statistics.step.kinematic_path_stops =
            self.statistics.step.kinematic_path_stops.saturating_add(1);
    }

    /// Last completed native fixed tick's work counts and body/island gauges.
    pub fn step_statistics(&self) -> StepStatistics {
        self.statistics.step
    }

    /// Last tick's bounded CCD clamps, independent of collision lifecycle/impulses.
    /// Geometry queries and repeated reads do not change this stream.
    pub fn ccd_clamps(&self) -> &[CcdClamp] {
        &self.statistics.clamps
    }

    pub(super) fn begin_statistics(&mut self) {
        let s = &mut self.statistics;
        s.step = StepStatistics::default();
        s.clamps.clear();
        s.sleeping_before.clear();
        s.joints_before = self.joints.len();
        s.sleeping_before.extend(
            self.backend
                .bodies
                .iter()
                .filter(|(_, b)| b.is_enabled() && b.is_dynamic())
                .map(|(h, b)| {
                    let (slot, generation) = h.into_raw_parts();
                    (BodyId { slot, generation }, b.is_sleeping())
                }),
        );
    }

    pub(super) fn step_backend(
        &mut self,
        controller_seconds: f32,
        logical_domain: Option<Domain>,
    ) -> bool {
        let motion_proof = logical_domain.is_some();
        self.events
            .2
            .get_mut()
            .unwrap_or_else(|p| p.into_inner())
            .reset(self.step_motion.enabled && motion_proof);
        self.backend.ccd_solver.reset_diagnostics();
        let mut approved = true;
        if let Some(logical_domain) = logical_domain {
            let mut scratch = std::mem::take(&mut self.character_motion.backend_motion);
            let mut ran_backend = false;
            let diagnostics_ready = (|| {
                // These persistent output buffers retain their existing
                // max_events bound, independent of geometry/timeline scratch.
                self.config
                    .max_events
                    .checked_mul(
                        std::mem::size_of::<rapier3d::dynamics::CcdClamp>()
                            + std::mem::size_of::<CcdClamp>(),
                    )
                    .ok_or(super::solver_trajectory::TrajectoryError::WorkLimit)?;
                let native = usize::from(
                    self.backend.ccd_solver.diagnostics().clamps.capacity()
                        < self.config.max_events,
                );
                let core = usize::from(self.statistics.clamps.capacity() < self.config.max_events);
                let records = self
                    .config
                    .max_events
                    .checked_mul(native + core)
                    .ok_or(super::solver_trajectory::TrajectoryError::WorkLimit)?;
                scratch.prepare_diagnostic_work(records)?;
                self.backend
                    .ccd_solver
                    .try_reserve_diagnostics()
                    .map_err(|_| super::solver_trajectory::TrajectoryError::WorkLimit)?;
                self.statistics
                    .clamps
                    .try_reserve_exact(
                        self.config
                            .max_events
                            .saturating_sub(self.statistics.clamps.len()),
                    )
                    .map_err(|_| super::solver_trajectory::TrajectoryError::WorkLimit)?;
                Ok(())
            })();
            match diagnostics_ready
                .and_then(|()| self.prepare_backend_motion(&mut scratch, controller_seconds))
            {
                Ok(max_scratch) => {
                    let events = super::character_motion::backend::BackendEvents {
                        collector: &self.events,
                        characters: &self.characters,
                        policies: &self.contact_policies,
                        scratch: std::sync::Mutex::new(&mut scratch),
                        max_scratch,
                        restitution_threshold: self.config.solver.restitution_velocity_threshold,
                        controller_seconds,
                        logical_domain,
                        continuous: self.config.solver.continuous,
                        contact_error: self.backend.integration_parameters.allowed_linear_error(),
                        path_clearance: 0.0001 * self.config.length_unit,
                        has_sensors: self
                            .backend
                            .colliders
                            .iter()
                            .any(|(_, c)| c.is_enabled() && c.is_sensor()),
                    };
                    ran_backend = true;
                    self.backend
                        .step_with_events(&self.contact_policies, &events);
                }
                Err(error) => scratch.fail(error),
            }
            approved = ran_backend
                && scratch.error().is_none()
                && !scratch.needs_promotion()
                && scratch.wake_join.is_none()
                && self.backend.physics_pipeline.solver_motion_decision()
                    == rapier3d::pipeline::SolverMotionDecision::Approved;
            let committed = if ran_backend {
                self.backend.physics_pipeline.solver_motion_committed_time()
            } else {
                0.
            };
            if !approved && ran_backend {
                scratch.reject_current_pass();
            }
            #[cfg(test)]
            if std::thread::current().name().is_some_and(|name| {
                [
                    "engine::unified_physics::platform_blocking_tests::external_squeeze_stops_the_engine_body_and_accumulates_work_across_ticks",
                    "physics3d::character_squeeze_tests::squeeze_substeps_preserve_force_targets_and_original_motion_time",
                    "physics3d::character_squeeze_tests::squeeze_events_preserve_unrelated_jump_input_and_full_tick_translation",
                    "physics3d::character_dynamic_tests::finite_character_crate_and_fixed_wall_share_the_accepted_stop",
                ]
                .contains(&name)
            }) {
                eprintln!(
                    "C34_NATIVE_CREDIT case={:?} tick_seconds={} controller_seconds={controller_seconds} native_dt={} before={} committed={committed} after={} ran={ran_backend} approved={approved} raw={:?} promote={} wake={:?} decision={:?} ccd_substeps={} recorded_backend_steps={}",
                    std::thread::current().name(),
                    self.config.step_seconds,
                    self.backend.integration_parameters.dt,
                    scratch.committed_seconds,
                    if committed > 0. { committed } else { scratch.committed_seconds },
                    scratch.error(),
                    scratch.needs_promotion(),
                    scratch.wake_join,
                    self.backend.physics_pipeline.solver_motion_decision(),
                    self.backend.physics_pipeline.counters.ccd.num_substeps,
                    self.statistics.step.backend_steps,
                );
            }
            // This is the same absolute domain end used by every accepted
            // kernel/proof/impulse/trace, not a sum of rounded physical dt.
            if committed > 0. {
                scratch.committed_seconds = committed;
            }
            if let Err(error) = scratch.publish_impulses(&self.events) {
                scratch.fail(error);
                approved = false;
            }
            scratch.finish_trace(
                &self.events,
                &self.backend.bodies,
                &self.backend.colliders,
                committed,
            );
            match scratch.finish_feedback(&self.characters, &self.backend.bodies) {
                Ok(()) => {
                    if let Err(error) =
                        self.publish_backend_motion_feedback(&scratch.feedback, controller_seconds)
                    {
                        scratch.fail(error);
                        approved = false;
                    } else {
                        scratch.commit_feedback();
                    }
                }
                Err(error) => {
                    scratch.fail(error);
                    approved = false;
                }
            }
            let (casts, failures) = scratch.path_query_counts();
            self.statistics.step.kinematic_path_casts = self
                .statistics
                .step
                .kinematic_path_casts
                .saturating_add(casts);
            self.statistics.step.kinematic_path_failures = self
                .statistics
                .step
                .kinematic_path_failures
                .saturating_add(failures);
            self.character_motion.backend_motion = scratch;
            if !ran_backend {
                return false;
            }
        } else {
            self.backend
                .step_with_events(&self.contact_policies, &self.events);
            self.character_motion.backend_motion.committed_seconds +=
                f64::from(self.backend.integration_parameters.dt);
        }
        let s = &mut self.statistics.step;
        let counters = &self.backend.physics_pipeline.counters;
        s.backend_steps = s.backend_steps.saturating_add(1);
        s.ccd_substeps = s
            .ccd_substeps
            .saturating_add(count(counters.ccd.num_substeps));
        s.solver_contacts = s
            .solver_contacts
            .saturating_add(count(counters.solver.ncontacts));
        s.solver_constraints = s
            .solver_constraints
            .saturating_add(count(counters.solver.nconstraints));
        s.tracked_contact_pairs = count(counters.cd.ncontact_pairs);
        let ccd = self.backend.ccd_solver.diagnostics();
        s.ccd_prediction_checks = s
            .ccd_prediction_checks
            .saturating_add(count(ccd.prediction_checks));
        s.ccd_clamp_checks = s.ccd_clamp_checks.saturating_add(count(ccd.clamp_checks));
        s.ccd_clamps = s.ccd_clamps.saturating_add(count(ccd.clamped_bodies));
        s.ccd_clamps_dropped = s.ccd_clamps_dropped.saturating_add(count(ccd.dropped));
        for hit in &ccd.clamps {
            if self.statistics.clamps.len() == self.config.max_events {
                s.ccd_clamps_dropped = s.ccd_clamps_dropped.saturating_add(1);
                continue;
            }
            let (Some(moving), Some(target)) = (
                self.backend
                    .colliders
                    .get(hit.moving)
                    .and_then(|c| collider_ref(hit.moving, c)),
                self.backend
                    .colliders
                    .get(hit.target)
                    .and_then(|c| collider_ref(hit.target, c)),
            ) else {
                continue;
            };
            self.statistics.clamps.push(CcdClamp {
                moving,
                target,
                fraction: hit.fraction,
                sweep_seconds: hit.sweep_seconds,
                point: hit.point.into(),
                normal: hit.normal.into(),
            });
        }
        approved
    }

    pub(super) fn finish_statistics(&mut self) {
        let state = &mut self.statistics;
        let s = &mut state.step;
        s.broken_joints = count(state.joints_before.saturating_sub(self.joints.len()));
        for &(id, was_sleeping) in &state.sleeping_before {
            if let Some(b) = self.backend.bodies.get(native_id(id)) {
                s.bodies_woken += u32::from(was_sleeping && !b.is_sleeping());
                s.bodies_put_to_sleep += u32::from(!was_sleeping && b.is_sleeping());
            }
        }
        state.islands.clear();
        for (h, b) in self
            .backend
            .bodies
            .iter()
            .filter(|(_, b)| b.is_enabled() && !b.is_fixed())
        {
            if b.is_dynamic() {
                s.dynamic_bodies += 1;
                s.sleeping_bodies += u32::from(b.is_sleeping());
                let inertia = &b.mass_properties().effective_world_inv_inertia;
                s.angular_bodies +=
                    u32::from(inertia.m11 > 0.0 || inertia.m22 > 0.0 || inertia.m33 > 0.0);
            }
            if let Some(id) = self
                .backend
                .islands
                .persistent_island_of(&self.backend.bodies, h)
            {
                state.islands.push((id, b.is_sleeping()));
            }
        }
        state.islands.sort_unstable_by_key(|&(id, _)| id);
        s.island_bodies = count(state.islands.len());
        let mut cursor = 0;
        while cursor < state.islands.len() {
            let start = cursor;
            let id = state.islands[cursor].0;
            let mut sleeping = true;
            while cursor < state.islands.len() && state.islands[cursor].0 == id {
                sleeping &= state.islands[cursor].1;
                cursor += 1;
            }
            s.islands += 1;
            s.sleeping_islands += u32::from(sleeping);
            s.active_islands += u32::from(!sleeping);
            s.largest_island_bodies = s.largest_island_bodies.max(count(cursor - start));
        }
    }
}
