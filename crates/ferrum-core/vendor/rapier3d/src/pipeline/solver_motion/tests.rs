use super::*;
use crate::pipeline::{EventHandler, SolverBodyIntegration, SolverBodyMotion};
use crate::prelude::*;
use std::sync::Mutex;

#[derive(Default)]
struct Observe {
    intervals: Mutex<Vec<SolverBodyIntegration>>,
    legacy: Mutex<Vec<SolverBodyMotion>>,
    resolve: bool,
    visits: Mutex<usize>,
}
impl EventHandler for Observe {
    fn wants_body_motion(&self) -> bool {
        true
    }
    fn resolves_solver_motion(&self) -> bool {
        self.resolve
    }
    fn handle_solver_body_integration(&self, interval: SolverBodyIntegration) {
        self.intervals.lock().unwrap().push(interval);
        self.handle_solver_body_motion(interval.motion);
    }
    fn handle_solver_body_motion(&self, motion: SolverBodyMotion) {
        self.legacy.lock().unwrap().push(motion);
    }
    fn resolve_solver_motion(
        &self,
        context: &mut dyn SolverMotionContext,
    ) -> crate::pipeline::SolverMotionDecision {
        *self.visits.lock().unwrap() += 1;
        assert!(context.end_time() > context.start_time());
        for i in 0..context.body_count() {
            let before = context.body(i).unwrap();
            assert!(before.end.is_finite());
            assert!(context.bodies().contains(before.handle));
        }

        crate::pipeline::SolverMotionDecision::Approved
    }
    fn handle_collision_event(
        &self,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: CollisionEvent,
        _: Option<&ContactPair>,
    ) {
    }
    fn handle_contact_force_event(
        &self,
        _: Real,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: &ContactPair,
        _: Real,
    ) {
    }
    fn handle_soft_body_tear_event(&self, _: &SoftBodySet, _: &SoftBodyTearEvent) {}
}

fn world() -> (PhysicsWorld, RigidBodyHandle) {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    world.integration_parameters.dt = 0.037;
    let (body, _) = world.insert(
        RigidBodyBuilder::kinematic_velocity_based()
            .linvel(Vector::new(0.3, -0.2, 0.1))
            .angvel(Vector::new(0.0, 0.0, 40.0))
            .angular_damping(7.0),
        ColliderBuilder::cuboid(2.0, 0.025, 0.1),
    );
    (world, body)
}

#[test]
fn exact_kinematic_visitor_matches_backend_every_interval_and_keeps_legacy_endpoint_events() {
    let (mut world, body) = world();
    let mut predicted = Vec::new();
    let end =
        world.bodies[body].visit_kinematic_motion(body, &world.integration_parameters, 1, |m| {
            predicted.push(m)
        });
    let events = Observe::default();
    world.step_with_events(&(), &events);
    let actual = events.intervals.lock().unwrap();
    let actual: Vec<_> = actual.iter().filter(|m| m.motion.body == body).collect();
    assert_eq!(
        actual.len(),
        world.integration_parameters.num_solver_iterations
    );
    assert_eq!(actual.len(), predicted.len());
    for (a, b) in actual.iter().zip(&predicted) {
        assert_eq!(a.motion.start, b.motion.start);
        assert_eq!(a.motion.end, b.motion.end);
        assert_eq!(a.motion.start_time, b.motion.start_time);
        assert_eq!(a.motion.end_time, b.motion.end_time);
        assert_eq!(a.integration_seconds, b.integration_seconds);
        assert_eq!(a.linear_velocity, b.linear_velocity);
        assert_eq!(a.angular_velocity, b.angular_velocity);
        let time = a.motion.start_time + (a.motion.end_time - a.motion.start_time) * 0.37;
        let mut expected = a.motion.start;
        RigidBodyVelocity {
            linvel: a.linear_velocity,
            angvel: a.angular_velocity,
        }
        .integrate_linearized(
            a.integration_seconds
                * ((time - a.motion.start_time) / (a.motion.end_time - a.motion.start_time)),
            &mut expected.translation,
            &mut expected.rotation,
        );
        assert_eq!(a.position_at_time(time), expected);
        assert_eq!(a.position_at_time(a.motion.start_time), a.motion.start);
        assert_eq!(a.position_at_time(a.motion.end_time), a.motion.end);
    }
    assert_eq!(*world.bodies[body].position(), end);
    assert_eq!(events.legacy.lock().unwrap().len(), actual.len());
}

#[test]
fn opt_in_noop_approval_keeps_solver_force_pose_velocity_and_wire_exact() {
    let (mut a, body_a) = world();
    let (mut b, body_b) = world();
    let (dynamic_a, _) = a.insert(
        RigidBodyBuilder::dynamic().translation(Vector::new(20.0, 0.0, 0.0)),
        ColliderBuilder::ball(0.25),
    );
    let (dynamic_b, _) = b.insert(
        RigidBodyBuilder::dynamic().translation(Vector::new(20.0, 0.0, 0.0)),
        ColliderBuilder::ball(0.25),
    );
    a.bodies[dynamic_a].add_force(Vector::new(4.0, -3.0, 2.0), true);
    b.bodies[dynamic_b].add_force(Vector::new(4.0, -3.0, 2.0), true);
    let ordinary = Observe::default();
    let approval = Observe {
        resolve: true,
        ..Default::default()
    };
    for _ in 0..6 {
        a.step_with_events(&(), &ordinary);
        b.step_with_events(&(), &approval);
        assert_eq!(a.bodies[body_a].position(), b.bodies[body_b].position());
        assert_eq!(
            a.bodies[dynamic_a].position(),
            b.bodies[dynamic_b].position()
        );
        assert_eq!(a.bodies[dynamic_a].linvel(), b.bodies[dynamic_b].linvel());
        assert_eq!(
            a.bodies[dynamic_a].user_force(),
            b.bodies[dynamic_b].user_force()
        );
        // This is backend state serialization, not a new checkpoint schema.
        assert_eq!(
            bincode::serialize(&a).unwrap(),
            bincode::serialize(&b).unwrap()
        );
    }
    assert!(*approval.visits.lock().unwrap() > 0);
    assert_eq!(*ordinary.visits.lock().unwrap(), 0);
}

struct Controlled {
    body: RigidBodyHandle,
    visits: Mutex<usize>,
    before: Mutex<Vec<Pose>>,
}
impl EventHandler for Controlled {
    fn wants_body_motion(&self) -> bool {
        true
    }
    fn resolves_solver_motion(&self) -> bool {
        true
    }
    fn resolve_solver_motion(
        &self,
        context: &mut dyn SolverMotionContext,
    ) -> crate::pipeline::SolverMotionDecision {
        for index in 0..context.body_count() {
            let mut value = context.body(index).unwrap();
            if value.handle != self.body {
                continue;
            }
            let original = value;
            let invalid = SolverMotionBody {
                handle: RigidBodyHandle::invalid(),
                ..value
            };
            assert_eq!(
                context.write_body(index, invalid),
                Err(SolverMotionWriteError::Index)
            );
            assert_eq!(context.body(index).unwrap().end, original.end);
            let invalid = SolverMotionBody {
                linear_velocity: Vector::splat(Real::NAN),
                ..value
            };
            assert_eq!(
                context.write_body(index, invalid),
                Err(SolverMotionWriteError::NonFinite)
            );
            assert_eq!(context.body(index).unwrap().end, original.end);
            let invalid = SolverMotionBody {
                end: Pose::from_parts(value.end.translation, Rotation::from_xyzw(0., 0., 0., 0.)),
                ..value
            };
            assert_eq!(
                context.write_body(index, invalid),
                Err(SolverMotionWriteError::InvalidRotation)
            );
            assert_eq!(context.body(index).unwrap().end, original.end);
            self.before.lock().unwrap().push(value.end);
            value.end.translation.x = 0.;
            value.linear_velocity.x = 0.;
            context.write_body(index, value).unwrap();
            *self.visits.lock().unwrap() += 1;
        }

        crate::pipeline::SolverMotionDecision::Approved
    }
    fn handle_collision_event(
        &self,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: CollisionEvent,
        _: Option<&ContactPair>,
    ) {
    }
    fn handle_contact_force_event(
        &self,
        _: Real,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: &ContactPair,
        _: Real,
    ) {
    }
    fn handle_soft_body_tear_event(&self, _: &SoftBodySet, _: &SoftBodyTearEvent) {}
}

#[test]
fn exclusive_approval_changes_next_substep_and_prescribed_writeback_without_reintegrating() {
    for position in [false, true] {
        let mut world = PhysicsWorld::new();
        world.gravity = Vector::ZERO;
        world.integration_parameters.dt = 0.1;
        world.integration_parameters.max_ccd_substeps = 0;
        let builder = if position {
            RigidBodyBuilder::kinematic_position_based()
        } else {
            RigidBodyBuilder::kinematic_velocity_based().linvel(Vector::X * 10.)
        };
        let (body, _) = world.insert(builder, ColliderBuilder::ball(0.25));
        if position {
            world.bodies[body].set_next_kinematic_translation(Vector::X);
        }
        let events = Controlled {
            body,
            visits: Mutex::new(0),
            before: Mutex::new(Vec::new()),
        };
        world.step_with_events(&(), &events);
        assert_eq!(world.bodies[body].translation().x, 0.);
        assert_eq!(world.bodies[body].linvel().x, 0.);
        let poses = events.before.lock().unwrap();
        assert_eq!(
            poses.len(),
            world.integration_parameters.num_solver_iterations
        );
        assert!(poses[0].translation.x > 0.);
        assert!(poses[1..].iter().all(|p| p.translation.x == 0.));
        assert_eq!(*events.visits.lock().unwrap(), poses.len());
    }
}

#[derive(Default)]
struct AtomicBatch {
    visits: Mutex<usize>,
}
impl EventHandler for AtomicBatch {
    fn wants_body_motion(&self) -> bool {
        true
    }
    fn resolves_solver_motion(&self) -> bool {
        true
    }
    fn resolve_solver_motion(
        &self,
        context: &mut dyn SolverMotionContext,
    ) -> crate::pipeline::SolverMotionDecision {
        assert!(context.body_count() >= 2);
        let first = context.body(0).unwrap();
        let second = context.body(1).unwrap();
        let changed = SolverMotionBody {
            end: Pose::from_translation(Vector::splat(123.)),
            ..first
        };
        let invalid = SolverMotionBody {
            end: Pose::from_parts(second.end.translation, Rotation::from_xyzw(0., 0., 0., 0.)),
            ..second
        };
        assert_eq!(
            context.write_bodies(&[(0, changed), (1, invalid)]),
            Err(SolverMotionWriteError::InvalidRotation)
        );
        assert_eq!(context.body(0).unwrap().end, first.end);
        assert_eq!(context.body(1).unwrap().end, second.end);
        assert_eq!(
            context.write_bodies(&[(0, changed), (0, first)]),
            Err(SolverMotionWriteError::IndexOrder)
        );
        assert_eq!(context.body(0).unwrap().end, first.end);
        context.write_bodies(&[(0, first), (1, second)]).unwrap();
        *self.visits.lock().unwrap() += 1;

        crate::pipeline::SolverMotionDecision::Approved
    }
    fn handle_collision_event(
        &self,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: CollisionEvent,
        _: Option<&ContactPair>,
    ) {
    }
    fn handle_contact_force_event(
        &self,
        _: Real,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: &ContactPair,
        _: Real,
    ) {
    }
    fn handle_soft_body_tear_event(&self, _: &SoftBodySet, _: &SoftBodyTearEvent) {}
}
#[test]
fn solver_motion_batch_rejects_late_bad_quaternion_without_publishing_earlier_rows() {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    for x in [0., 20.] {
        world.insert(
            RigidBodyBuilder::kinematic_velocity_based()
                .translation(Vector::X * x)
                .linvel(Vector::Y),
            ColliderBuilder::ball(0.25),
        );
    }
    let events = AtomicBatch::default();
    world.step_with_events(&(), &events);
    assert!(*events.visits.lock().unwrap() > 0);
    assert!(
        world
            .bodies
            .iter()
            .all(|(_, b)| b.translation().x == 0. || b.translation().x == 20.)
    );
}

#[derive(Default)]
struct Clock {
    intervals: Mutex<Vec<(Real, Real, usize)>>,
}
impl EventHandler for Clock {
    fn wants_body_motion(&self) -> bool {
        true
    }
    fn resolves_solver_motion(&self) -> bool {
        true
    }
    fn resolve_solver_motion(
        &self,
        context: &mut dyn SolverMotionContext,
    ) -> crate::pipeline::SolverMotionDecision {
        self.intervals.lock().unwrap().push((
            context.start_time(),
            context.end_time(),
            context.body_count(),
        ));

        crate::pipeline::SolverMotionDecision::Approved
    }
    fn handle_collision_event(
        &self,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: CollisionEvent,
        _: Option<&ContactPair>,
    ) {
    }
    fn handle_contact_force_event(
        &self,
        _: Real,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: &ContactPair,
        _: Real,
    ) {
    }
    fn handle_soft_body_tear_event(&self, _: &SoftBodySet, _: &SoftBodyTearEvent) {}
}
#[test]
fn continuous_approval_uses_one_clock_without_rejecting_admitted_additional_tuning() {
    for base in [4, 32] {
        let mut world = PhysicsWorld::new();
        world.gravity = Vector::ZERO;
        world.integration_parameters.num_solver_iterations = base;
        world.integration_parameters.max_ccd_substeps = 0;
        let mut bodies = Vec::new();
        for (x, extra, pgs) in [(0., 0, 0), (10., 7, 3), (20., 32, 32)] {
            let (id, _) = world.insert(
                RigidBodyBuilder::dynamic()
                    .translation(Vector::X * x)
                    .linvel(Vector::Y)
                    .additional_solver_iterations(extra)
                    .additional_pgs_iterations(pgs),
                ColliderBuilder::ball(0.25),
            );
            bodies.push((id, extra, pgs));
        }
        let events = Clock::default();
        world.step_with_events(&(), &events);
        let intervals = events.intervals.lock().unwrap();
        assert_eq!(intervals.len(), base + 32);
        assert!(intervals.iter().all(|(_, _, n)| *n == 3));
        assert_eq!(intervals[0].0, 0.);
        for pair in intervals.windows(2) {
            assert_eq!(pair[0].1, pair[1].0);
        }
        assert_eq!(
            intervals.last().unwrap().1,
            (base + 32) as Real * (world.integration_parameters.dt / (base + 32) as Real)
        );
        for (id, extra, pgs) in bodies {
            assert_eq!(world.bodies[id].additional_solver_iterations(), extra);
            assert_eq!(world.bodies[id].additional_pgs_iterations(), pgs);
        }
    }
}

struct Reject {
    decision: SolverMotionDecision,
    calls: Mutex<usize>,
}
impl EventHandler for Reject {
    fn resolves_solver_motion(&self) -> bool {
        true
    }
    fn resolve_solver_motion(&self, ctx: &mut dyn SolverMotionContext) -> SolverMotionDecision {
        // Even a valid temporary replacement must remain private on rejection.
        if let Some(mut value) = ctx.body(0) {
            value.end.translation += Vector::splat(123.);
            ctx.write_bodies(&[(0, value)]).unwrap();
        }
        *self.calls.lock().unwrap() += 1;
        self.decision
    }
    fn handle_collision_event(
        &self,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: CollisionEvent,
        _: Option<&ContactPair>,
    ) {
    }
    fn handle_contact_force_event(
        &self,
        _: Real,
        _: &RigidBodySet,
        _: &ColliderSet,
        _: &ContactPair,
        _: Real,
    ) {
    }
    fn handle_soft_body_tear_event(&self, _: &SoftBodySet, _: &SoftBodyTearEvent) {}
}
#[test]
fn rejected_or_pending_wake_interval_never_publishes_solver_or_kinematic_next_poses() {
    for decision in [
        SolverMotionDecision::Rejected,
        SolverMotionDecision::NeedsWakeJoin,
    ] {
        let mut world = PhysicsWorld::new();
        world.gravity = Vector::Y * -9.81;
        world.integration_parameters.dt = 0.1;
        world.integration_parameters.max_ccd_substeps = 0;
        let (dynamic, _) = world.insert(
            RigidBodyBuilder::dynamic().linvel(Vector::X),
            ColliderBuilder::ball(0.25),
        );
        let (kinematic, _) = world.insert(
            RigidBodyBuilder::kinematic_position_based().translation(Vector::X * 20.),
            ColliderBuilder::ball(0.25),
        );
        world.bodies[dynamic].add_force(Vector::Z * 2., true);
        world.bodies[kinematic].set_next_kinematic_translation(Vector::X * 21.);
        let before = *world.bodies[dynamic].position();
        let before_kinematic = *world.bodies[kinematic].position();
        let velocity = world.bodies[dynamic].linvel();
        let force = world.bodies[dynamic].user_force();
        let events = Reject {
            decision,
            calls: Mutex::new(0),
        };
        world.step_with_events(&(), &events);
        assert_eq!(*events.calls.lock().unwrap(), 1);
        assert_eq!(world.physics_pipeline.solver_motion_decision(), decision);
        assert_eq!(world.physics_pipeline.solver_motion_committed_seconds(), 0.);
        assert_eq!(*world.bodies[dynamic].position(), before);
        assert_eq!(*world.bodies[kinematic].position(), before_kinematic);
        assert_eq!(world.bodies[dynamic].linvel(), velocity);
        assert_eq!(world.bodies[dynamic].user_force(), force);
        // This test intentionally does not assert whole-world byte rollback:
        // island/user-change/sleep bookkeeping preceded the approval barrier.
    }
}

#[test]
fn local_motion_credit_returns_position_kinematic_interpolation_velocity_after_zero_time_rejection()
{
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    world.integration_parameters.max_ccd_substeps = 0;
    world.integration_parameters.dt = 0.1;
    let (body, _) = world.insert(
        RigidBodyBuilder::kinematic_position_based(),
        ColliderBuilder::ball(0.25),
    );
    world.bodies[body].set_next_kinematic_translation(Vector::X);
    let target = *world.bodies[body].next_position();
    let velocity = world.bodies[body].linvel();
    let activation = *world.bodies[body].activation();
    let credit = world.bodies[body].motion_credit();
    world.bodies.try_reserve_motion_credit_returns(1).unwrap();
    world.step_with_events(
        &(),
        &Reject {
            decision: SolverMotionDecision::Rejected,
            calls: Mutex::new(0),
        },
    );
    assert_eq!(world.physics_pipeline.solver_motion_committed_seconds(), 0.);
    assert_ne!(world.bodies[body].linvel(), velocity);
    world.bodies[body].return_motion_credit(&credit);
    assert_eq!(world.bodies[body].linvel(), velocity);
    assert_eq!(*world.bodies[body].next_position(), target);
    assert_eq!(*world.bodies[body].activation(), activation);
}
