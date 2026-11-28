use super::*;
use crate::physics3d::{
    character_motion::backend::BackendEvents, solver_trajectory::Domain, BodyDesc, BodyKind,
    ColliderDesc, Pose, QueryFilter, Shape, WorldConfig,
};
use rapier3d::pipeline::{SolverBodyIntegration, SolverMotionContext, SolverMotionDecision};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

// No production rejection hook: every real proposal/first CCD slice is
// delegated to the normal Core resolver. Only this test adapter rejects the
// selected later physical CCD pass before its private body writeback.
struct RejectPass<'a> {
    inner: BackendEvents<'a>,
    pass: AtomicUsize,
    approved: AtomicUsize,
    rejected: AtomicUsize,
    reject_at: usize,
}
impl rp::EventHandler for RejectPass<'_> {
    fn wants_body_motion(&self) -> bool {
        true
    }
    fn resolves_solver_motion(&self) -> bool {
        true
    }
    fn solver_motion_step_domain(&self, duration: f32) -> (f64, f64) {
        self.inner.solver_motion_step_domain(duration)
    }
    fn handle_body_motion_pass_domain_started(&self, duration: f32, start: f64, end: f64) {
        self.pass.fetch_add(1, Ordering::Relaxed);
        self.inner
            .handle_body_motion_pass_domain_started(duration, start, end);
    }
    fn handle_solver_body_proposal(&self, value: SolverBodyIntegration) {
        self.inner.handle_solver_body_proposal(value);
    }
    fn resolve_solver_motion(&self, context: &mut dyn SolverMotionContext) -> SolverMotionDecision {
        if self.pass.load(Ordering::Relaxed) == self.reject_at {
            self.rejected.fetch_add(1, Ordering::Relaxed);
            SolverMotionDecision::Rejected
        } else {
            let decision = self.inner.resolve_solver_motion(context);
            if decision == SolverMotionDecision::Approved {
                self.approved.fetch_add(1, Ordering::Relaxed);
            }
            decision
        }
    }
    fn plan_solver_ccd(
        &self,
        context: &dyn SolverMotionContext,
        params: &rp::IntegrationParameters,
        plan: &mut rp::SolverCcdPlan,
    ) -> SolverMotionDecision {
        self.inner.plan_solver_ccd(context, params, plan)
    }
    fn handle_prepared_ccd_clamp(
        &self,
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        cutoff: f64,
        duration: f64,
    ) {
        self.inner
            .handle_prepared_ccd_clamp(body, start, end, cutoff, duration);
    }
    fn handle_collision_event(
        &self,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        event: rp::CollisionEvent,
        pair: Option<&rp::ContactPair>,
    ) {
        self.inner
            .handle_collision_event(bodies, colliders, event, pair);
    }
    fn handle_contact_force_event(
        &self,
        dt: f32,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        pair: &rp::ContactPair,
        force: f32,
    ) {
        self.inner
            .handle_contact_force_event(dt, bodies, colliders, pair, force);
    }
    fn handle_soft_body_tear_event(
        &self,
        bodies: &rapier3d::dynamics::SoftBodySet,
        event: &rapier3d::dynamics::SoftBodyTearEvent,
    ) {
        self.inner.handle_soft_body_tear_event(bodies, event);
    }
}

fn fixture(speed: f32, wall: bool, spin: f32) -> (PhysicsWorld3d, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let body = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                linear_velocity: [speed, 0., 0.],
                angular_velocity: [0., 0., spin],
                can_sleep: false,
                ccd: true,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        )
        .unwrap();
    w.backend
        .bodies
        .get_mut(native_id(body))
        .unwrap()
        .set_allow_fast_rotation(true);
    if wall {
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2., 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 2., 2.],
            }),
        )
        .unwrap();
    }
    w.backend.integration_parameters.max_ccd_substeps = 4;
    w.force_character_motion_proof();
    w.set_step_motion_enabled(true);
    w.refresh_queries();
    w.begin_fixed_step();
    (w, body)
}

fn reject_pipeline(
    w: &mut PhysicsWorld3d,
    domain: Domain,
    reject_at: usize,
) -> (usize, usize, usize) {
    w.events.2.get_mut().unwrap().reset(true);
    w.backend.ccd_solver.reset_diagnostics();
    w.backend.ccd_solver.try_reserve_diagnostics().unwrap();
    let h = w.backend.integration_parameters.dt;
    let mut scratch = std::mem::take(&mut w.character_motion.backend_motion);
    let max_scratch = w.prepare_backend_motion(&mut scratch, h).unwrap();
    let counts;
    {
        let adapter = RejectPass {
            inner: BackendEvents {
                collector: &w.events,
                characters: &w.characters,
                policies: &w.contact_policies,
                scratch: Mutex::new(&mut scratch),
                max_scratch,
                restitution_threshold: w.config.solver.restitution_velocity_threshold,
                controller_seconds: h,
                logical_domain: domain,
                continuous: w.config.solver.continuous,
                contact_error: w.backend.integration_parameters.allowed_linear_error(),
                path_clearance: 0.0001 * w.config.length_unit,
                has_sensors: false,
            },
            pass: AtomicUsize::new(0),
            approved: AtomicUsize::new(0),
            rejected: AtomicUsize::new(0),
            reject_at,
        };
        w.backend.step_with_events(&w.contact_policies, &adapter);
        counts = (
            adapter.pass.load(Ordering::Relaxed),
            adapter.approved.load(Ordering::Relaxed),
            adapter.rejected.load(Ordering::Relaxed),
        );
    }
    assert_eq!(
        w.backend.physics_pipeline.solver_motion_decision(),
        SolverMotionDecision::Rejected
    );
    let committed = w.backend.physics_pipeline.solver_motion_committed_time();
    // Same source contract as step_backend on a rejected later slice. This
    // test driver bypasses only its fixed EventHandler construction, not the
    // actual Native pipeline or Core proposal/trace implementation.
    scratch.reject_current_pass();
    if committed > 0. {
        scratch.committed_seconds = committed;
    }
    scratch.finish_trace(
        &w.events,
        &w.backend.bodies,
        &w.backend.colliders,
        committed,
    );
    w.character_motion.backend_motion = scratch;
    counts
}

const ORIGIN: Time = Time::from_bits(0x3f7b_4fb3_5f68_e9e2);

#[test]
fn actual_later_ccd_rejection_preserves_approved_prefix_before_trace_reset_and_retry() {
    let (mut w, body) = fixture(80., true, 80.);
    let native_parameters = w.backend.integration_parameters;
    let tick = Time::from(w.config.step_seconds);
    assert_ne!(((ORIGIN / tick) * tick).to_bits(), ORIGIN.to_bits());
    w.backend.integration_parameters.dt = ORIGIN as f32;
    assert!(w.step_backend(ORIGIN as f32, Domain::new(0., ORIGIN).unwrap()));
    w.record_step_motion_segment(ORIGIN / tick);
    w.advance_planar_angles(ORIGIN as f32);
    assert_eq!(w.actual_motion_completed_time().to_bits(), ORIGIN.to_bits());
    let native = native_id(body);
    let warm = w.step_motion.test_exact_segments(native);
    assert!(!warm.is_empty());
    let before_angle = w.planar_rotation(body).unwrap();
    let q = w.backend.bodies[native].rotation();
    let before_wrapped = 2. * f64::from(q.z).atan2(f64::from(q.w));
    let before = w.actual_motion_completed_time();
    let requested = (tick - before) as f32;
    w.backend.integration_parameters.dt = requested;
    let domain = w.joint_motion_domain(before / tick, 1.).unwrap();
    assert_eq!(domain.start.to_bits(), before.to_bits());
    let counts = reject_pipeline(&mut w, domain, 2);
    assert_eq!(
        counts.0, 2,
        "one Native pipeline reached its real second CCD slice"
    );
    assert!(counts.1 > 0 && counts.2 == 1);
    let after = w.actual_motion_completed_time();
    let physical = w.backend.physics_pipeline.solver_motion_committed_seconds();
    assert!(after > before && after < tick);
    assert!(physical > 0. && physical < requested);
    let q = w.backend.bodies[native].rotation();
    let wrapped = 2. * f64::from(q.z).atan2(f64::from(q.w));
    let short = crate::physics3d::planar_angle::wrap(wrapped - before_wrapped);
    let spin = f64::from(w.backend.bodies[native].angvel().z);
    let expected = before_angle
        + short
        + ((spin * f64::from(physical) - short) / std::f64::consts::TAU).round()
            * std::f64::consts::TAU;
    let wrong_full = before_angle
        + short
        + ((spin * f64::from(requested) - short) / std::f64::consts::TAU).round()
            * std::f64::consts::TAU;
    assert_ne!(
        expected.to_bits(),
        wrong_full.to_bits(),
        "the full unapproved Native duration must not advance planar turns"
    );
    let stats = w.step_statistics();
    w.record_committed_backend_prefix(before);
    assert_eq!(
        w.planar_rotation(body).unwrap().to_bits(),
        expected.to_bits()
    );
    assert_eq!(
        w.step_statistics(),
        stats,
        "capture runs no additional Native step"
    );
    let prefix = w.step_motion.test_exact_segments(native);
    assert!(prefix.len() > warm.len());
    assert_eq!(prefix.last().unwrap().2.to_bits(), after.to_bits());
    assert_eq!(prefix.last().unwrap().4.to_bits(), (after / tick).to_bits());
    assert!(prefix.iter().any(|r| r.1 >= before && r.2 <= after));
    let saved_prefix = postcard::to_allocvec(&prefix).unwrap();
    w.backend.integration_parameters.dt = (tick - after) as f32;
    w.step_with_joints(after / tick, 1.);
    assert_eq!(w.actual_motion_completed_time().to_bits(), tick.to_bits());
    let all = w.step_motion.test_exact_segments(native);
    assert_eq!(
        postcard::to_allocvec(&all[..prefix.len()]).unwrap(),
        saved_prefix
    );
    assert!(all.windows(2).all(|p| p[0].2 == p[1].1 && p[0].4 == p[1].3));
    assert_eq!(all[prefix.len()].1.to_bits(), after.to_bits());
    assert_eq!(all[prefix.len()].3.to_bits(), (after / tick).to_bits());
    assert!(
        all[prefix.len()].3 > 0.,
        "suffix is never relabeled as tick-zero motion"
    );
    assert_eq!(all.last().unwrap().2.to_bits(), tick.to_bits());
    assert_eq!(all.last().unwrap().4, 1.);
    // This test drives the physical intervals manually. Complete the same
    // lifecycle as step_kinematic_tick before the public cold boundary: its
    // transient remaining dt is restored before finish_fixed_step.
    assert_ne!(w.backend.integration_parameters.dt, native_parameters.dt);
    w.backend.integration_parameters.dt = native_parameters.dt;
    assert_eq!(w.backend.integration_parameters, native_parameters);
    w.finish_fixed_step();
    let mut hits = Vec::new();
    assert_eq!(
        w.sweep_step_motion(
            &Shape::Sphere { radius: 0.01 },
            Pose {
                position: [-10., 10., 0.],
                ..Default::default()
            },
            [0.; 3],
            &QueryFilter::default(),
            &mut hits,
            8
        ),
        Ok(false)
    );
    let saved = w.capture_snapshot().unwrap();
    let restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    assert_eq!(
        postcard::to_allocvec(&restored.step_motion.test_exact_segments(native)).unwrap(),
        postcard::to_allocvec(&all).unwrap()
    );
}

#[test]
fn zero_ccd_credit_rejection_preserves_existing_capture_and_planar_metadata() {
    let (mut w, body) = fixture(80., true, 3.);
    let tick = Time::from(w.config.step_seconds);
    w.backend.integration_parameters.dt = ORIGIN as f32;
    w.step_with_joints(0., ORIGIN / tick);
    let before = w.actual_motion_completed_time();
    let source =
        postcard::to_allocvec(&w.step_motion.test_exact_segments(native_id(body))).unwrap();
    let angle = w.planar_rotation(body).unwrap();
    w.backend.integration_parameters.dt = (tick - before) as f32;
    let counts = reject_pipeline(&mut w, Domain::new(before, tick).unwrap(), 1);
    assert_eq!(counts, (1, 0, 1));
    assert_eq!(
        w.backend.physics_pipeline.solver_motion_committed_seconds(),
        0.
    );
    assert_eq!(w.actual_motion_completed_time().to_bits(), before.to_bits());
    w.record_committed_backend_prefix(before);
    assert_eq!(w.planar_rotation(body).unwrap().to_bits(), angle.to_bits());
    assert_eq!(
        postcard::to_allocvec(&w.step_motion.test_exact_segments(native_id(body))).unwrap(),
        source
    );
}

#[test]
fn producer_uses_committed_origin_bits_and_preserves_legacy_fraction_start_policy() {
    let (mut w, body) = fixture(2., false, 3.);
    let tick = Time::from(w.config.step_seconds);
    w.backend.integration_parameters.dt = ORIGIN as f32;
    assert!(w.step_backend(ORIGIN as f32, Domain::new(0., ORIGIN).unwrap()));
    w.record_step_motion_segment(ORIGIN / tick);
    w.advance_planar_angles(ORIGIN as f32);
    assert_eq!(w.actual_motion_completed_time().to_bits(), ORIGIN.to_bits());
    assert_ne!(((ORIGIN / tick) * tick).to_bits(), ORIGIN.to_bits());
    w.backend.integration_parameters.dt = (tick - ORIGIN) as f32;
    w.step_with_joints(ORIGIN / tick, 1.);
    let rows = w.step_motion.test_exact_segments(native_id(body));
    assert!(rows.windows(2).all(|p| p[0].2 == p[1].1));
    assert!(rows.iter().any(|r| r.1.to_bits() == ORIGIN.to_bits()));
    assert_eq!(rows.last().unwrap().2.to_bits(), tick.to_bits());
    let mut legacy = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    assert!(!legacy.backend_motion_enabled());
    legacy.character_motion.backend_motion.committed_seconds = ORIGIN;
    assert_eq!(
        legacy
            .joint_motion_domain(ORIGIN / tick, 1.)
            .unwrap()
            .start
            .to_bits(),
        ((ORIGIN / tick) * tick).to_bits()
    );
}
