//! Native work counts and CCD observations, independent of geometric queries.
use super::events::collider_ref;
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
    /// Unsupported moving-obstacle casts, which stop the path conservatively.
    pub kinematic_path_failures: u32,
    /// Distinct prescribed paths stopped by an obstacle or a blocked rider.
    pub kinematic_path_stops: u32,
    /// Reserved v1 diagnostic. Always zero.
    pub character_preview_passes: u32,
    /// Reserved v1 diagnostic. Always zero.
    pub character_preview_pair_casts: u32,
    /// Reserved v1 diagnostic. Always zero.
    pub character_preview_pair_contacts: u32,
    /// Reserved v1 diagnostic. Always zero.
    pub character_preview_coupling_visits: u32,
    /// Reserved v1 diagnostic. Always zero.
    pub character_preview_coupling_limits: u32,
    /// Reserved v1 diagnostic. Always zero.
    pub character_preview_obstacle_casts: u32,
    /// Reserved v1 diagnostic. Always zero.
    pub character_preview_obstacle_contacts: u32,
    /// Reserved v1 diagnostic. Always zero.
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

impl StepStatistics {
    pub(crate) fn reserved_diagnostics_are_zero(self) -> bool {
        [
            self.character_preview_passes,
            self.character_preview_pair_casts,
            self.character_preview_pair_contacts,
            self.character_preview_coupling_visits,
            self.character_preview_coupling_limits,
            self.character_preview_obstacle_casts,
            self.character_preview_obstacle_contacts,
            self.character_preview_obstacle_failures,
        ]
        .into_iter()
        .all(|value| value == 0)
    }
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

impl PhysicsWorld3d {
    pub(super) fn record_character_stop(&mut self) {
        self.statistics.step.kinematic_character_stops = self
            .statistics
            .step
            .kinematic_character_stops
            .saturating_add(1);
    }

    pub(super) fn record_path_queries(&mut self, casts: u32, failures: u32) {
        let s = &mut self.statistics.step;
        s.kinematic_path_casts = s.kinematic_path_casts.saturating_add(casts);
        s.kinematic_path_failures = s.kinematic_path_failures.saturating_add(failures);
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

    pub(super) fn step_backend(&mut self) {
        self.backend.ccd_solver.reset_diagnostics();
        self.backend
            .step_with_events(&self.contact_policies, &self.events);
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
