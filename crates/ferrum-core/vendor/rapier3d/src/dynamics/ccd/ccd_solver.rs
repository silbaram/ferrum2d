// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
use crate::alloc_prelude::*;
use crate::dynamics::{IntegrationParameters, IslandManager, RigidBodySet, SoftBodySet};
use crate::geometry::{
    BroadPhaseBvh, Collider, ColliderHandle, ColliderSet, CollisionEvent, NarrowPhase,
};
use crate::math::{Real, Vector};
use crate::parry::bounding_volume::Aabb;
use crate::pipeline::{EventHandler, PhysicsHooks, QueryFilter};
use crate::prelude::{ActiveEvents, CollisionEventFlags};
use parry::query::sweep_toi::Sweep;

use super::sweeps::{
    collect_fixed_targets, collect_soft_targets, is_bullet, map_bodies_parallel,
    post_solve_ccd_active, sweep_fast_body, BodyContinuousResult, CcdTargets, MotionSource,
    PseudoHitMode,
};

/// Continuous Collision Detection solver preventing fast objects from tunneling:
/// after the solver, bodies that moved more than half their thinnest extent sweep their colliders
/// and `next_position` is clamped to the earliest impact — velocities untouched, no re-solve; the
/// residual approach resolves next step via speculative contacts.
///
/// Fast dynamic bodies sweep against fixed colliders and soft-body meshes; `ccd_enabled` makes a
/// bullet that also sweeps kinematic/dynamic bodies (never other bullets); mesh-like colliders are
/// never the moving shape; compounds sweep per convex child; `max_ccd_substeps = 0` disables CCD.
#[derive(Clone, Default)]
#[cfg_attr(feature = "serde-serialize", derive(Serialize, Deserialize))]
pub struct CCDSolver {
    /// Ferrum2D transient diagnostics, explicitly reset by the caller per backend step.
    #[cfg_attr(feature = "serde-serialize", serde(skip))]
    diagnostics: CcdDiagnostics,
    #[cfg_attr(feature = "serde-serialize", serde(skip))]
    diagnostic_limit: usize,
    /// Cached fixed-target list for the non-bullet sweep pass: the AABB loosening it was built
    /// with; `None` past [`FIXED_TARGETS_LIST_MAX`] (sweep queries the full BVH). Invalidated by
    /// the scene-change flag — re-scanning every collider each step dominated CCD on large scenes.
    #[cfg_attr(feature = "serde-serialize", serde(skip))]
    fixed_targets_cache: Option<FixedTargetsCache>,
}

/// One position clamp actually applied by CCD, not a contact impulse.
#[derive(Clone, Copy, Debug)]
pub struct CcdClamp {
    /// Collider on the fast body.
    pub moving: ColliderHandle,
    /// Collider that limited motion.
    pub target: ColliderHandle,
    /// Fraction of this individual sweep interval, in (0, 1).
    pub fraction: Real,
    /// Duration of this sweep interval in seconds.
    pub sweep_seconds: Real,
    /// World-space CCD witness point.
    pub point: Vector,
    /// Unit world-space separating axis from target toward moving shape.
    pub normal: Vector,
}

/// Ferrum2D CCD counters, accumulated until explicitly reset. Not serialized.
#[derive(Clone, Default, Debug)]
pub struct CcdDiagnostics {
    /// Collider pair cast calls used to select a CCD time interval.
    pub prediction_checks: usize,
    /// Collider pair cast calls made on the solved motion (sensors included).
    pub clamp_checks: usize,
    /// Number of body position clamps applied, before report truncation.
    pub clamped_bodies: usize,
    /// Omitted clamp records; does not affect motion or counts.
    pub dropped: usize,
    /// Bounded clamp evidence in solver order.
    pub clamps: Vec<CcdClamp>,
}

/// The AABB loosening the cached fixed-target list was built with, paired with the list
/// itself — `None` past [`FIXED_TARGETS_LIST_MAX`], where the sweep queries the full BVH.
type FixedTargetsCache = (Real, Option<Vec<(ColliderHandle, Aabb)>>);

impl CCDSolver {
    /// Initializes a new CCD solver
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets the independent bound on transient CCD clamp observations. Zero disables
    /// detailed records, while work/clamp counts remain available.
    pub fn set_diagnostic_limit(&mut self, limit: usize) {
        self.diagnostic_limit = limit;
        self.reset_diagnostics();
    }

    /// Reserve the configured bounded observation buffer before solver writes.
    /// Opted-in callers charge this layout request to their explicit scratch
    /// budget. Failure changes no body, velocity, force or diagnostic count.
    pub fn try_reserve_diagnostics(&mut self) -> Result<(), alloc::collections::TryReserveError> {
        self.diagnostics.clamps.try_reserve(
            self.diagnostic_limit
                .saturating_sub(self.diagnostics.clamps.len()),
        )
    }

    /// Clears observations and counts while retaining allocated storage and cache state.
    pub fn reset_diagnostics(&mut self) {
        self.diagnostics.prediction_checks = 0;
        self.diagnostics.clamp_checks = 0;
        self.diagnostics.clamped_bodies = 0;
        self.diagnostics.dropped = 0;
        self.diagnostics.clamps.clear();
    }

    /// Transient counts/evidence since the last explicit reset.
    pub fn diagnostics(&self) -> &CcdDiagnostics {
        &self.diagnostics
    }

    /// Discards the cached fixed-target list used by the non-bullet continuous pass.
    /// This must be called any time the fixed targets change. If using the physics pipeline,
    /// it is called for you. If not, it must be called manually.
    pub fn invalidate_fixed_targets_cache(&mut self) {
        self.fixed_targets_cache = None;
    }

    /// Updates the set of bodies that needs CCD to be resolved.
    ///
    /// Returns `true` if any rigid-body must have CCD resolved.
    pub fn update_ccd_active_flags(
        &self,
        islands: &IslandManager,
        bodies: &mut RigidBodySet,
        colliders: &ColliderSet,
        dt: Real,
        include_forces: bool,
    ) -> bool {
        let mut ccd_active = false;

        for handle in islands.active_bodies() {
            let rb = bodies.index_mut_internal(handle);

            // Default tier: every fast dynamic body is a CCD origin. `ccd_enabled`
            // no longer gates *activation*, only the sweep *scope* (fixed-only vs all bodies),
            // applied later during pair selection.
            if rb.is_soft_frame() {
                // A cluster proxy's pose is derived from its particles: it is never swept.
                rb.ccd.ccd_active = false;
            } else if rb.is_dynamic() {
                let moving_fast = if include_forces {
                    // Pre-solve (substep splitter): `next_position` isn't solved yet, use the
                    // current velocity with forces, like `find_first_impact`. The last solved
                    // motion (`ccd_vels`) is stale, or zero on a body's first step.
                    rb.ccd.is_moving_fast(
                        dt,
                        &rb.vels,
                        Some((&rb.forces, &rb.mprops)),
                        rb.mprops.max_extent(),
                    )
                } else {
                    // Post-solve: the fast-body criterion on the actual solved motion.
                    post_solve_ccd_active(rb, colliders, &rb.pos, &rb.ccd_vels, dt)
                };
                rb.ccd.ccd_active = moving_fast;
                ccd_active = ccd_active || moving_fast;
            }
        }

        ccd_active
    }

    /// Find the first time a CCD-active body has a non-sensor collider hitting another
    /// non-sensor collider, for the multi-substep splitter.
    ///
    /// Returns the impact time in `[0, dt)` if any.
    #[profiling::function]
    #[allow(clippy::too_many_arguments)]
    pub fn find_first_impact(
        &mut self,
        dt: Real, // NOTE: this doesn’t necessarily match the `params.dt`.
        params: &IntegrationParameters,
        islands: &IslandManager,
        bodies: &RigidBodySet,
        colliders: &ColliderSet,
        broad_phase: &mut BroadPhaseBvh,
        narrow_phase: &NarrowPhase,
        hooks: &dyn PhysicsHooks,
    ) -> Option<Real> {
        // NOTE: broad-phase AABBs are NOT enlarged to the swept volumes: only the fast body's
        // query box is swept (per collider, below); targets keep their regular fat AABBs.
        // Swept AABBs written into the tree would leak into the next step (pair explosion).
        let query_pipeline = broad_phase.as_query_pipeline(
            narrow_phase.query_dispatcher(),
            bodies,
            colliders,
            QueryFilter::default(),
        );
        let (bvh, dispatcher) = (query_pipeline.bvh, query_pipeline.dispatcher);

        let linear_slop = params.allowed_linear_error();
        let fast_bodies: Vec<_> = islands
            .active_bodies()
            .filter(|h| bodies[*h].ccd.ccd_active)
            .collect();

        let results = map_bodies_parallel(&fast_bodies, hooks, |handle, hooks| {
            let rb1 = &bodies[handle];
            // `next_position` isn't solved yet: sweep to the forces/velocities integration.
            let predicted_body_pos =
                rb1.pos
                    .integrate_forces_and_velocities(dt, &rb1.forces, &rb1.vels, &rb1.mprops);
            sweep_fast_body(
                handle,
                bodies,
                colliders,
                predicted_body_pos,
                CcdTargets::FullBvh(bvh),
                dispatcher,
                hooks,
                dt,
                linear_slop,
                PseudoHitMode::Ignore,
                MotionSource::Predicted,
            )
        });

        let mut min_fraction: Real = 1.0;
        for result in results {
            self.diagnostics.prediction_checks = self
                .diagnostics
                .prediction_checks
                .saturating_add(result.checks);
            min_fraction = min_fraction.min(result.fraction);
        }
        (min_fraction < 1.0).then_some(min_fraction * dt)
    }

    /// Runs the continuous-collision pass on all fast bodies and clamps their `next_position`
    /// to their earliest time of impact: non-bullets sweep the automatic targets (fixed
    /// colliders and soft-body collision meshes) first, then bullets sweep every (possibly
    /// already clamped) body; velocities are never modified. Sensor
    /// crossings the narrow phase would miss entirely emit paired `Started`/`Stopped`
    /// intersection events.
    #[profiling::function]
    #[allow(clippy::too_many_arguments)]
    pub fn solve_continuous(
        &mut self,
        params: &IntegrationParameters,
        islands: &IslandManager,
        bodies: &mut RigidBodySet,
        colliders: &ColliderSet,
        soft_bodies: &SoftBodySet,
        broad_phase: &mut BroadPhaseBvh,
        narrow_phase: &NarrowPhase,
        hooks: &dyn PhysicsHooks,
        events: &dyn EventHandler,
    ) {
        let dt = params.dt;
        let linear_slop = params.allowed_linear_error();

        // NOTE: broad-phase AABBs are NOT enlarged to the swept volumes: only the fast body's
        // query box is swept; stationary targets keep their fat AABBs. Swept AABBs in
        // the tree leak into the next step's broad phase (pair explosion, ~2x narrow-phase cost).
        let (non_bullets, bullets): (Vec<_>, Vec<_>) = islands
            .active_bodies()
            .filter(|h| bodies[*h].ccd.ccd_active)
            .partition(|h| !is_bullet(&bodies[*h]));

        let mut all_results = Vec::new();

        // Pass 1: fast non-bullet bodies vs fixed targets (all targets are stationary, so
        // the bodies are independent and can run in parallel).
        {
            let query_pipeline = broad_phase.as_query_pipeline(
                narrow_phase.query_dispatcher(),
                bodies,
                colliders,
                QueryFilter::default(),
            );
            let (bvh, dispatcher) = (query_pipeline.bvh, query_pipeline.dispatcher);
            // Non-bullet fast bodies only hit fixed targets: sweep against the (small) cached
            // fixed-collider list instead of the full BVH.
            let prediction = params.prediction_distance();
            let cache_valid = self
                .fixed_targets_cache
                .as_ref()
                .is_some_and(|(p, _)| *p == prediction);
            if !cache_valid {
                self.fixed_targets_cache = Some((
                    prediction,
                    collect_fixed_targets(bodies, colliders, prediction),
                ));
            }
            // Soft-body meshes deform every step without any scene change, so they are
            // gathered fresh (one AABB per mesh, not a collider scan).
            let soft = collect_soft_targets(soft_bodies, colliders, prediction);
            let targets = match &self.fixed_targets_cache.as_ref().unwrap().1 {
                Some(fixed) => CcdTargets::Lists { fixed, soft: &soft },
                None => CcdTargets::FullBvh(bvh),
            };
            let results = map_bodies_parallel(&non_bullets, hooks, |handle, hooks| {
                sweep_fast_body(
                    handle,
                    bodies,
                    colliders,
                    bodies[handle].pos.next_position,
                    targets,
                    dispatcher,
                    hooks,
                    dt,
                    linear_slop,
                    PseudoHitMode::Record,
                    MotionSource::Solved,
                )
            });
            all_results.extend(results);
        }
        Self::apply_clamps(bodies, &all_results, events);

        // Pass 2: bullets vs everything except other bullets. Targets read the (already
        // clamped) `next_position` from pass 1 (deferred bullet stage).
        if !bullets.is_empty() {
            let bullet_results = {
                let query_pipeline = broad_phase.as_query_pipeline(
                    narrow_phase.query_dispatcher(),
                    bodies,
                    colliders,
                    QueryFilter::default(),
                );
                let (bvh, dispatcher) = (query_pipeline.bvh, query_pipeline.dispatcher);
                map_bodies_parallel(&bullets, hooks, |handle, hooks| {
                    sweep_fast_body(
                        handle,
                        bodies,
                        colliders,
                        bodies[handle].pos.next_position,
                        CcdTargets::FullBvh(bvh),
                        dispatcher,
                        hooks,
                        dt,
                        linear_slop,
                        PseudoHitMode::Record,
                        MotionSource::Solved,
                    )
                })
            };
            Self::apply_clamps(bodies, &bullet_results, events);
            all_results.extend(bullet_results);
        }

        for result in &all_results {
            self.diagnostics.clamp_checks =
                self.diagnostics.clamp_checks.saturating_add(result.checks);
            if result.fraction < 1.0 {
                self.diagnostics.clamped_bodies = self.diagnostics.clamped_bodies.saturating_add(1);
                if let Some(hit) = result.solid_hit {
                    if self.diagnostics.clamps.len() < self.diagnostic_limit {
                        self.diagnostics.clamps.push(CcdClamp {
                            moving: hit.moving,
                            target: hit.target,
                            fraction: hit.impact.fraction,
                            sweep_seconds: dt,
                            point: hit.impact.point,
                            normal: hit.impact.normal,
                        });
                    } else {
                        self.diagnostics.dropped = self.diagnostics.dropped.saturating_add(1);
                    }
                }
            }
        }

        // Emit intersection events for sensor crossings that happened strictly before each
        // body's final solid impact and that the narrow phase would never observe (no
        // overlap at either the start or the clamped end pose).
        for result in &all_results {
            for hit in &result.pseudo_hits {
                if hit.fraction >= result.fraction {
                    // The body stops before reaching this sensor.
                    continue;
                }

                let co1 = &colliders[hit.ch1];
                let co2 = &colliders[hit.ch2];

                if !co1.is_sensor() && !co2.is_sensor() {
                    // TODO: this happens if we found a TOI between two non-sensor
                    //       colliders with mismatching solver_flags. It is not clear
                    //       what we should do in this case: we could report a
                    //       contact started/contact stopped event for example. But in
                    //       that case, what contact pair should be pass to these events?
                    // For now we just ignore this special case. Let's wait for an actual
                    // use-case to come up before we determine what we want to do here.
                    continue;
                }

                let next_pose = |co: &Collider| match co.parent.as_ref() {
                    Some(parent) => bodies[parent.handle].pos.next_position * parent.pos_wrt_parent,
                    None => co.pos.0,
                };

                let prev_pos12 = co1.pos.inv_mul(&co2.pos);
                let next_pos12 = next_pose(co1).inv_mul(&next_pose(co2));

                let dispatcher = narrow_phase.query_dispatcher();
                let intersect_before = dispatcher
                    .intersection_test(&prev_pos12, co1.shape.as_ref(), co2.shape.as_ref())
                    .is_ok_and(|hit| hit.intersecting);
                let intersect_after = dispatcher
                    .intersection_test(&next_pos12, co1.shape.as_ref(), co2.shape.as_ref())
                    .is_ok_and(|hit| hit.intersecting);

                if !intersect_before
                    && !intersect_after
                    && (co1.flags.active_events | co2.flags.active_events)
                        .contains(ActiveEvents::COLLISION_EVENTS)
                {
                    // Emit one intersection-started and one intersection-stopped event.
                    events.handle_collision_event(
                        bodies,
                        colliders,
                        CollisionEvent::Started(hit.ch1, hit.ch2, CollisionEventFlags::SENSOR),
                        None,
                    );
                    events.handle_collision_event(
                        bodies,
                        colliders,
                        CollisionEvent::Stopped(hit.ch1, hit.ch2, CollisionEventFlags::SENSOR),
                        None,
                    );
                }
            }
        }
    }

    /// Apply a complete prevalidated Core CCD plan at the original post-solve
    /// phase. This performs no query, reserve, solve, force or velocity update.
    pub(crate) fn apply_prepared(
        &mut self,
        plan: &crate::pipeline::SolverCcdPlan,
        dt: Real,
        logical_start: f64,
        logical_end: f64,
        bodies: &mut RigidBodySet,
        colliders: &ColliderSet,
        events: &dyn EventHandler,
    ) {
        let logical_duration = logical_end - logical_start;
        self.diagnostics.clamp_checks = self.diagnostics.clamp_checks.saturating_add(plan.checks);
        for row in &plan.clamps {
            // The pre-writeback barrier verified identity/geometry and reserved
            // diagnostics; no producer changes bodies between those phases.
            let rb = bodies.index_mut_internal(row.body);
            let center = rb.mprops.local_mprops.local_com;
            let start = rb.pos.position.prepend_translation(center);
            rb.pos.next_position = row.end.prepend_translation(-center);
            self.diagnostics.clamped_bodies = self.diagnostics.clamped_bodies.saturating_add(1);
            if self.diagnostics.clamps.len() < self.diagnostic_limit
                && self.diagnostics.clamps.len() < self.diagnostics.clamps.capacity()
            {
                self.diagnostics.clamps.push(CcdClamp {
                    moving: row.moving,
                    target: row.target,
                    fraction: ((row.cutoff_time - logical_start) / logical_duration) as Real,
                    sweep_seconds: dt,
                    point: row.point,
                    normal: row.normal,
                });
            } else {
                self.diagnostics.dropped = self.diagnostics.dropped.saturating_add(1);
            }
            if events.wants_body_motion() {
                events.handle_prepared_ccd_clamp(
                    row.body,
                    start,
                    row.end,
                    row.cutoff_time - logical_start,
                    logical_duration,
                );
            }
        }
        // Crossings were preflighted with the complete clipped path. Core's
        // committed-slice trace is their single publisher; never emit twice.
        let _ = colliders;
    }

    /// Clamps each impacted body's `next_position` to the interpolated pose at its impact
    /// fraction. Pose only — velocities are preserved.
    fn apply_clamps(
        bodies: &mut RigidBodySet,
        results: &[BodyContinuousResult],
        events: &dyn EventHandler,
    ) {
        let observe_motion = events.wants_body_motion();
        for result in results {
            if result.fraction < 1.0 {
                let rb = bodies.index_mut_internal(result.handle);
                let sweep = Sweep::from_poses(
                    &rb.pos.position,
                    &rb.pos.next_position,
                    rb.mprops.local_mprops.local_com,
                );
                rb.pos.next_position = sweep.transform_at(result.fraction);
                if observe_motion {
                    let center = rb.mprops.local_mprops.local_com;
                    events.handle_body_motion_clamped(
                        result.handle,
                        rb.pos.position.prepend_translation(center),
                        rb.pos.next_position.prepend_translation(center),
                        &sweep,
                        result.fraction,
                    );
                }
            }
        }
    }
}
