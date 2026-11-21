use super::*;

#[test]
fn stationary_support_keeps_independent_boxes_in_the_native_solver() {
    let mut bodies = rp::RigidBodySet::new();
    let floor = bodies.insert(rp::RigidBodyBuilder::kinematic_position_based());
    let crate_body = bodies.insert(rp::RigidBodyBuilder::dynamic());
    let trajectory = |body, role, rate| {
        let kernel = Kernel::from_velocity(
            body,
            Domain::new(0., 1.).unwrap(),
            rp::Pose::IDENTITY,
            rate,
            rp::Vector::ZERO,
        )
        .unwrap();
        ColliderTrajectory {
            collider: rp::ColliderHandle::invalid(),
            parent: Some(body),
            role,
            motion: ShapeMotion {
                curve: Curve::Integrated(kernel),
                local_center: rp::Vector::ZERO,
                local_pose: rp::Pose::IDENTITY,
            },
            bounds: rapier3d::parry::bounding_volume::Aabb::new(rp::Vector::ZERO, rp::Vector::ZERO),
            sensor: false,
        }
    };
    let stationary = trajectory(floor, Role::Prescribed, rp::Vector::ZERO);
    let moving = trajectory(floor, Role::Prescribed, rp::Vector::Y);
    let cube = trajectory(crate_body, Role::Dynamic, rp::Vector::ZERO);
    let mut scratch = BackendMotionScratch::default();
    scratch.mixed.push(identity(floor));
    assert!(!scratch.eligible(&stationary, &cube, &bodies, true));
    assert!(!scratch.eligible(&cube, &stationary, &bodies, true));
    assert!(scratch.eligible(&moving, &cube, &bodies, true));
    bodies[crate_body].enable_ccd(true);
    assert!(scratch.eligible(&stationary, &cube, &bodies, true));
    bodies[crate_body].enable_ccd(false);
    scratch.mixed.push(identity(crate_body));
    assert!(scratch.eligible(&stationary, &cube, &bodies, true));
}

#[test]
fn a_virtual_pressure_retry_keeps_an_independent_driver_and_row() {
    let mut bodies = rp::RigidBodySet::new();
    let mut scratch = BackendMotionScratch {
        separate_virtual_components: true,
        ..Default::default()
    };
    let work = &mut Work {
        used: 0,
        limit: super::super::trajectory::MAX_PROOF_WORK,
    };
    let domain = Domain::new(0., 1.).unwrap();
    let mut moving = |origin, rate, actor| {
        let body =
            bodies.insert(rp::RigidBodyBuilder::kinematic_velocity_based().translation(origin));
        let kernel = Kernel::from_velocity(
            body,
            domain,
            rp::Pose::from_translation(origin),
            rate,
            rp::Vector::ZERO,
        )
        .unwrap();
        let mut entry = momentum_tests::entry(body, kernel);
        entry.momentum_before = rate;
        scratch.entries.push(entry);
        let body_id = identity(body);
        scratch.participants.push(Participant {
            body: body_id,
            pose: kernel.position_at_time(0.5),
            linear_velocity: rate,
            angular_velocity: rp::Vector::ZERO,
            mass: MassPolicy::Native,
        });
        if actor {
            scratch.character_values.push((body_id, rate));
        }
        ColliderTrajectory {
            collider: rp::ColliderHandle::invalid(),
            parent: Some(body),
            role: if actor {
                Role::Character(body_id)
            } else {
                Role::Prescribed
            },
            motion: ShapeMotion {
                curve: Curve::Integrated(kernel),
                local_center: rp::Vector::ZERO,
                local_pose: rp::Pose::IDENTITY,
            },
            bounds: rapier3d::parry::bounding_volume::Aabb::new(rp::Vector::ZERO, rp::Vector::ZERO),
            sensor: false,
        }
    };
    let a = moving(rp::Vector::ZERO, rp::Vector::ZERO, true);
    let first_rate = rp::Vector::X * -2.;
    let driver = moving(rp::Vector::X, first_rate, false);
    let b = moving(rp::Vector::Y * 10., rp::Vector::ZERO, true);
    let other_rate = rp::Vector::X * -3.;
    let independent = moving(rp::Vector::new(1., 10., 0.), other_rate, false);
    let wall = ColliderTrajectory {
        parent: Some(bodies.insert(rp::RigidBodyBuilder::fixed())),
        role: Role::Fixed,
        motion: ShapeMotion {
            curve: Curve::Constant {
                pose: rp::Pose::IDENTITY,
                start_time: domain.start,
                end_time: domain.end,
            },
            ..a.motion
        },
        ..a
    };
    let contact = |normal| {
        rapier3d::parry::query::Contact::new(
            rp::Vector::ZERO,
            rp::Vector::ZERO,
            normal,
            -normal,
            0.,
        )
    };
    scratch.contacts.extend([
        actual_scene::ContactSample {
            a,
            b: wall,
            contact: contact(-rp::Vector::X),
        },
        actual_scene::ContactSample {
            a,
            b: driver,
            contact: contact(rp::Vector::X),
        },
        actual_scene::ContactSample {
            a: b,
            b: independent,
            contact: contact(rp::Vector::X),
        },
    ]);
    scratch.character_rows.extend([
        actual_rows::Row {
            a: 0,
            b: None,
            normal: rp::Vector::X,
            velocity: rp::Vector::ZERO,
        },
        actual_rows::Row {
            a: 0,
            b: None,
            normal: -rp::Vector::X,
            velocity: first_rate,
        },
        actual_rows::Row {
            a: 1,
            b: None,
            normal: -rp::Vector::X,
            velocity: other_rate,
        },
    ]);
    // The complete point census precedes the virtual solver's retry and has
    // already admitted the reusable component scratch.
    scratch.promotions.reserve(bodies.len());
    let time: Time = 0.5;
    let hit = actual_scene::Hit {
        a,
        b: wall,
        cast: crate::physics3d::solver_trajectory::CastHit {
            safe_time: time,
            hit_time: time.next_up(),
            contact: contact(-rp::Vector::X),
            subshape_a: 0,
            subshape_b: 0,
        },
    };
    let previous = scratch.entries[3].curve.com_pose(domain.end);
    assert!(scratch
        .stop_pressure_kinematics(time, hit, 0., &bodies, false, work)
        .unwrap());
    assert_eq!(scratch.entries[1].stopped_at, Some(time));
    assert_eq!(scratch.participants[1].linear_velocity, rp::Vector::ZERO);
    assert_eq!(scratch.character_rows[1].velocity, rp::Vector::ZERO);
    assert_eq!(scratch.entries[3].stopped_at, None);
    assert_eq!(scratch.entries[3].curve.com_pose(domain.end), previous);
    assert_eq!(scratch.participants[3].linear_velocity, other_rate);
    assert_eq!(scratch.character_rows[2].velocity, other_rate);
    // One fixed wall can constrain both actors without linking the selected
    // character's response to the independent driver.
    scratch.contacts.push(actual_scene::ContactSample {
        a: b,
        b: wall,
        contact: contact(-rp::Vector::X),
    });
    assert!(scratch
        .isolate_virtual_hit_component(hit, &bodies, work)
        .unwrap());
    assert_eq!(
        scratch.promotions,
        [
            identity(a.parent.unwrap()),
            identity(driver.parent.unwrap())
        ]
    );
    assert_eq!(scratch.contacts.len(), 2);
    assert!(scratch
        .contacts
        .iter()
        .all(|sample| sample.a.parent == a.parent));
}

struct Context {
    rapier: rp::PhysicsWorld,
    values: Vec<SolverMotionBody>,
    writes: usize,
    domain: Domain,
    observer_start: f32,
    observer_end: f32,
}
impl SolverMotionContext for Context {
    fn bodies(&self) -> &rp::RigidBodySet {
        &self.rapier.bodies
    }
    fn colliders(&self) -> &rp::ColliderSet {
        &self.rapier.colliders
    }
    fn start_time(&self) -> f32 {
        self.observer_start
    }
    fn end_time(&self) -> f32 {
        self.observer_end
    }
    fn precise_start_time(&self) -> Time {
        self.domain.start
    }
    fn precise_end_time(&self) -> Time {
        self.domain.end
    }
    fn is_last_interval(&self) -> bool {
        true
    }
    fn prescribed_motion_resolved(&self, index: usize) -> Option<bool> {
        self.values.get(index).map(|_| false)
    }
    fn body_count(&self) -> usize {
        self.values.len()
    }
    fn body(&self, index: usize) -> Option<SolverMotionBody> {
        self.values.get(index).copied()
    }
    fn write_body(
        &mut self,
        index: usize,
        value: SolverMotionBody,
    ) -> Result<(), rapier3d::pipeline::SolverMotionWriteError> {
        self.write_bodies(&[(index, value)])
    }
    fn write_bodies(
        &mut self,
        values: &[(usize, SolverMotionBody)],
    ) -> Result<(), rapier3d::pipeline::SolverMotionWriteError> {
        use rapier3d::pipeline::SolverMotionWriteError as E;
        for &(index, value) in values {
            if self.values.get(index).map(|v| v.handle) != Some(value.handle) {
                return Err(E::Index);
            }
            if !value.end.is_finite()
                || !value.linear_velocity.is_finite()
                || !value.angular_velocity.is_finite()
            {
                return Err(E::NonFinite);
            }
        }
        for &(index, value) in values {
            self.values[index] = value;
        }
        self.writes += 1;
        Ok(())
    }
}

fn fixture(target_x: f32, sleeping: bool) -> (Context, SolverBodyIntegration) {
    let mut world = rp::PhysicsWorld::new();
    let (moving, _) = world.insert(
        rp::RigidBodyBuilder::dynamic()
            .translation(rp::Vector::new(-2., 0., 0.))
            .ccd_enabled(true)
            .can_sleep(false)
            .angvel(rp::Vector::Z * 0.1),
        rp::ColliderBuilder::ball(0.25),
    );
    let target = if sleeping {
        rp::RigidBodyBuilder::dynamic().sleeping(true)
    } else {
        rp::RigidBodyBuilder::fixed()
    };
    world.insert(
        target.translation(rp::Vector::X * target_x),
        rp::ColliderBuilder::ball(0.25),
    );
    let body = &world.bodies[moving];
    let start = body
        .position()
        .prepend_translation(body.local_center_of_mass());
    let proposal = SolverBodyIntegration::from_velocity(
        moving,
        0.,
        1.,
        start,
        rp::Vector::X * 4.,
        rp::Vector::Z * 0.1,
    )
    .unwrap();
    let value = SolverMotionBody {
        handle: moving,
        end: proposal.motion.end,
        linear_velocity: proposal.linear_velocity,
        angular_velocity: proposal.angular_velocity,
        keep_integrated_endpoint: false,
    };
    (
        Context {
            rapier: world,
            values: vec![value],
            writes: 0,
            domain: Domain::new(0., 1.).unwrap(),
            observer_start: 0.,
            observer_end: 1.,
        },
        proposal,
    )
}

fn run(
    context: &mut Context,
    proposal: SolverBodyIntegration,
    scratch: &mut BackendMotionScratch,
) -> SolverMotionDecision {
    let collector = EventCollector::new(8);
    let characters = BTreeMap::new();
    let policies = ContactPolicies::default();
    let events = BackendEvents {
        collector: &collector,
        characters: &characters,
        policies: &policies,
        scratch: Mutex::new(scratch),
        max_scratch: usize::MAX,
        restitution_threshold: 1.,
        controller_seconds: 1.,
        logical_domain: Domain::new(0., 1.).unwrap(),
        continuous: true,
        contact_error: 0.001,
        path_clearance: 0.0001,
        has_sensors: false,
    };
    events.handle_solver_body_proposal(proposal);
    events.resolve_solver_motion(context)
}

#[test]
fn complete_actual_no_hit_batch_preserves_native_metadata_and_endpoint_bits() {
    let (mut context, proposal) = fixture(20., false);
    let source = crate::checkpoint_codec::encode(&context.rapier).unwrap();
    let original = context.values[0];
    let mut scratch = BackendMotionScratch::default();
    assert_eq!(
        run(&mut context, proposal, &mut scratch),
        SolverMotionDecision::Approved
    );
    assert_eq!(context.writes, 1);
    assert_eq!(
        original.end.translation.to_array().map(f32::to_bits),
        context.values[0]
            .end
            .translation
            .to_array()
            .map(f32::to_bits)
    );
    assert_eq!(
        original.end.rotation.to_array().map(f32::to_bits),
        context.values[0].end.rotation.to_array().map(f32::to_bits)
    );
    assert_eq!(
        source,
        crate::checkpoint_codec::encode(&context.rapier).unwrap()
    );
    assert_eq!(scratch.accepted.len(), 1);
}

#[test]
fn malformed_actual_proposal_never_reaches_atomic_publication() {
    let (mut context, mut proposal) = fixture(20., false);
    let source = crate::checkpoint_codec::encode(&context.rapier).unwrap();
    proposal.linear_velocity.x = f32::NAN;
    let mut scratch = BackendMotionScratch::default();
    assert_eq!(
        run(&mut context, proposal, &mut scratch),
        SolverMotionDecision::Rejected
    );
    assert_eq!(context.writes, 0);
    assert_eq!(
        source,
        crate::checkpoint_codec::encode(&context.rapier).unwrap()
    );
}

#[test]
fn real_sleeping_hit_requests_join_without_publishing_or_waking() {
    let (mut context, proposal) = fixture(0., true);
    let source = crate::checkpoint_codec::encode(&context.rapier).unwrap();
    let mut scratch = BackendMotionScratch::default();
    // This unit exercises the mixed finite path; pure Native CCD is pending
    // until the final plan and is covered separately below.
    scratch.affected.push(identity(proposal.motion.body));
    scratch.prepare_mixed().unwrap();
    assert_eq!(
        run(&mut context, proposal, &mut scratch),
        SolverMotionDecision::NeedsWakeJoin
    );
    assert_eq!(context.writes, 0);
    let join = scratch.wake_join.unwrap();
    assert!(context.rapier.bodies[join.body].is_sleeping());
    assert!(join.safe_time <= join.hit_time && join.hit_time > 0.);
    assert_eq!(
        source,
        crate::checkpoint_codec::encode(&context.rapier).unwrap()
    );
}

#[test]
fn ratio_projection_rejects_new_penetration_before_any_body_write() {
    let (context, _) = fixture(0., false);
    let moving = context.values[0].handle;
    let before = crate::checkpoint_codec::encode(&context.rapier).unwrap();
    let mut scratch = BackendMotionScratch::default();
    let policies = ContactPolicies::default();
    let blocked = rp::Pose::from_translation(rp::Vector::new(-0.1, 0., 0.));
    assert_eq!(
        admit_ratio_positions(
            &context.rapier.bodies,
            &context.rapier.colliders,
            &policies,
            &[(moving, blocked)],
            0.001,
            &mut scratch
        ),
        Err(TrajectoryError::Unresolved)
    );
    let clear = rp::Pose::from_translation(rp::Vector::new(-3., 0., 0.));
    assert_eq!(
        admit_ratio_positions(
            &context.rapier.bodies,
            &context.rapier.colliders,
            &policies,
            &[(moving, clear)],
            0.001,
            &mut scratch
        ),
        Ok(())
    );
    assert_eq!(
        before,
        crate::checkpoint_codec::encode(&context.rapier).unwrap()
    );
}

#[test]
fn rejected_uncommitted_slice_has_no_published_motion_trace() {
    let (mut context, proposal) = fixture(20., false);
    let collector = EventCollector::new(8);
    collector.2.lock().unwrap().reset(true);
    let mut scratch = BackendMotionScratch::default();
    let characters = BTreeMap::new();
    let policies = ContactPolicies::default();
    {
        let events = BackendEvents {
            collector: &collector,
            characters: &characters,
            policies: &policies,
            scratch: Mutex::new(&mut scratch),
            max_scratch: usize::MAX,
            restitution_threshold: 1.,
            controller_seconds: 1.,
            logical_domain: Domain::new(0., 1.).unwrap(),
            continuous: true,
            contact_error: 0.001,
            path_clearance: 0.0001,
            has_sensors: false,
        };
        events.handle_body_motion_pass_started(1.);
        events.handle_solver_body_proposal(proposal);
        assert_eq!(
            events.resolve_solver_motion(&mut context),
            SolverMotionDecision::Approved
        );
    }
    scratch.finish_trace(
        &collector,
        &context.rapier.bodies,
        &context.rapier.colliders,
        0.,
    );
    assert!(collector.2.lock().unwrap().motions.is_empty());
    scratch.finish_trace(
        &collector,
        &context.rapier.bodies,
        &context.rapier.colliders,
        1.,
    );
    let trace = collector.2.lock().unwrap();
    assert_eq!(trace.motions.len(), 1);
    assert_eq!(trace.actual.len(), 1);
}

#[test]
fn automatic_authority_includes_all_enabled_native_dynamic_origins() {
    use crate::physics3d::{BodyDesc, ColliderDesc, Pose, Shape, WorldConfig};
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let sphere = world
        .create_body(
            BodyDesc {
                ccd: true,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
    assert!(
        world.backend_motion_enabled(),
        "a concentric sphere can have non-chord force/constraint kernels"
    );
    let mut offset = ColliderDesc::new(Shape::Sphere { radius: 0.1 });
    offset.pose = Pose {
        position: [1., 0., 0.],
        ..Pose::default()
    };
    offset.density = 0.;
    world.add_collider(sphere, offset).unwrap();
    assert!(
        world.backend_motion_enabled(),
        "offset sphere can rotate under a new contact impulse"
    );
    let mut box_world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    box_world
        .create_body(
            BodyDesc {
                ccd: true,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap();
    assert!(
        box_world.backend_motion_enabled(),
        "initial omega0 does not exclude a motor/solver-created turn"
    );
}

#[test]
fn prediction_extra_cadence_never_changes_actual_backend_base_parameters() {
    use crate::physics3d::{BodyDesc, ColliderDesc, Shape, WorldConfig};
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let body = world
        .create_body(
            BodyDesc {
                ccd: true,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap();
    let native = crate::physics3d::world::native_id(body);
    world.backend.bodies[native].set_additional_solver_iterations(32);
    world.backend.bodies[native].set_additional_pgs_iterations(32);
    let before = crate::checkpoint_codec::encode(&world.backend.integration_parameters).unwrap();
    let (base, passes) = world.backend_pass_schedule();
    let (prediction, predicted_passes) = world.kinematic_prediction_schedule();
    assert_eq!(passes, predicted_passes);
    assert_eq!(
        prediction.num_solver_iterations,
        base.num_solver_iterations + 32
    );
    assert_eq!(
        prediction.num_internal_pgs_iterations,
        base.num_internal_pgs_iterations + 32
    );
    assert_eq!(
        before,
        crate::checkpoint_codec::encode(&world.backend.integration_parameters).unwrap()
    );
}

#[test]
fn actual_motion_classification_preserves_valid_source_and_committed_prefix() {
    use crate::physics3d::{PhysicsError, PhysicsWorld3d, WorldConfig};

    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let before = world.capture_snapshot().unwrap();
    world.character_motion.backend_motion.committed_seconds = 0.003;
    for (error, expected) in [
        (TrajectoryError::Unresolved, PhysicsError::UnresolvedMotion),
        (TrajectoryError::WorkLimit, PhysicsError::CapacityExceeded),
        (
            TrajectoryError::UnsupportedShape,
            PhysicsError::UnsupportedShape,
        ),
        (TrajectoryError::InvalidTime, PhysicsError::InvalidBody),
        (TrajectoryError::InvalidReference, PhysicsError::InvalidBody),
        (
            TrajectoryError::MissingBodyMotion,
            PhysicsError::InvalidBody,
        ),
        (TrajectoryError::NonFinite, PhysicsError::InvalidBody),
    ] {
        world.character_motion.backend_motion.fail(error);
        assert_eq!(world.actual_motion_result(), Err(expected));
        assert_eq!(world.character_motion.backend_motion.error(), Some(error));
        assert_eq!(world.actual_motion_completed_seconds(), 0.003);
        assert_eq!(
            before.encoded_bytes(),
            world.capture_snapshot().unwrap().encoded_bytes()
        );
    }
    assert_eq!(
        PhysicsError::UnresolvedMotion.to_string(),
        "actual motion could not be certified or resolved"
    );
    world.clear_actual_motion_outcome();
    assert_eq!(world.actual_motion_result(), Ok(()));
    assert_eq!(world.actual_motion_completed_seconds(), 0.);
    assert_eq!(
        before.encoded_bytes(),
        world.capture_snapshot().unwrap().encoded_bytes()
    );
}

#[test]
fn physics_error_append_preserves_existing_native_codec_discriminants() {
    use crate::{engine::UnifiedPhysicsError, physics3d::PhysicsError};

    // Existing serialized error identities are part of the private native
    // checkpoint payload. Appending must not renumber any previous identity.
    let errors = [
        PhysicsError::InvalidConfig,
        PhysicsError::InvalidBody,
        PhysicsError::LockedRotation,
        PhysicsError::InvalidCollider,
        PhysicsError::InvalidQuery,
        PhysicsError::OutOfPlane,
        PhysicsError::StaleBody,
        PhysicsError::StaleCollider,
        PhysicsError::CapacityExceeded,
        PhysicsError::WrongBodyKind,
        PhysicsError::UnsupportedShape,
        PhysicsError::InvalidCharacter,
        PhysicsError::NotCharacter,
        PhysicsError::CharacterControlled,
        PhysicsError::InvalidJoint,
        PhysicsError::StaleJoint,
        PhysicsError::UnresolvedMotion,
    ];
    for (ordinal, error) in errors.into_iter().enumerate() {
        let ordinal = u8::try_from(ordinal).unwrap();
        let bytes = postcard::to_allocvec(&error).unwrap();
        assert_eq!(bytes, [ordinal]);
        assert_eq!(postcard::from_bytes::<PhysicsError>(&bytes).unwrap(), error);
        let unified = UnifiedPhysicsError::Physics(error);
        let wrapped = postcard::to_allocvec(&unified).unwrap();
        assert_eq!(wrapped, [10, ordinal]);
        assert_eq!(
            postcard::from_bytes::<UnifiedPhysicsError>(&wrapped).unwrap(),
            unified
        );
    }
}

#[test]
fn committed_character_feedback_does_not_reapply_a_previous_backend_pass_impulse() {
    use crate::physics3d::{
        BodyDesc, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Shape, WorldConfig,
    };
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(
            actor,
            CharacterConfig {
                push_mass: 10.,
                ..Default::default()
            },
        )
        .unwrap();
    world.refresh_queries();
    world.step_characters();
    let mut scratch = BackendMotionScratch::default();
    let dt = world.config.step_seconds;
    world.prepare_backend_motion(&mut scratch, dt).unwrap();
    scratch.origins[0].velocity_delta = rp::Vector::Y * 2.;
    for expected_delta in [rp::Vector::Y * 2., rp::Vector::ZERO] {
        scratch
            .finish_feedback(&world.characters, &world.backend.bodies)
            .unwrap();
        assert_eq!(scratch.feedback[0].velocity_delta, expected_delta);
        world
            .publish_backend_motion_feedback(&scratch.feedback, dt)
            .unwrap();
        scratch.commit_feedback();
        scratch.reset(); // The next backend pass retains the accepted ledger.
        assert_eq!(world.characters[&actor].external_velocity, [0., 2., 0.]);
    }
    scratch.origins[0].velocity_delta += rp::Vector::X * 3.;
    scratch
        .finish_feedback(&world.characters, &world.backend.bodies)
        .unwrap();
    world
        .publish_backend_motion_feedback(&scratch.feedback, dt)
        .unwrap();
    assert_eq!(world.characters[&actor].external_velocity, [3., 2., 0.]);
}

#[test]
fn precise_first_hit_keeps_a_real_sub_observer_ulp_bracket_without_publication() {
    let (mut context, original) = fixture(0., true);
    let duration = Time::from(0.0002521006_f32);
    let start = Time::from(0.009_f32) - duration * 0.375;
    let domain = Domain::new(start, start + duration).unwrap();
    let proposal = Kernel::from_velocity(
        original.motion.body,
        domain,
        original.motion.start,
        rp::Vector::X * (4. / duration as f32),
        original.angular_velocity,
    )
    .unwrap()
    .native;
    context.domain = domain;
    context.observer_start = proposal.motion.start_time;
    context.observer_end = proposal.motion.end_time;
    context.values[0].end = proposal.motion.end;
    context.values[0].linear_velocity = proposal.linear_velocity;
    context.values[0].angular_velocity = proposal.angular_velocity;
    let before = crate::checkpoint_codec::encode(&context.rapier).unwrap();
    let mut scratch = BackendMotionScratch::default();
    // This unit exercises the mixed finite path; pure Native CCD is pending
    // until the final plan and is covered separately below.
    scratch.affected.push(identity(proposal.motion.body));
    scratch.prepare_mixed().unwrap();
    assert_eq!(
        run(&mut context, proposal, &mut scratch),
        SolverMotionDecision::NeedsWakeJoin
    );
    let hit = scratch.wake_join.unwrap();
    assert!(hit.safe_time < hit.hit_time, "{hit:?}");
    assert!(hit.hit_time - hit.safe_time <= duration * 1e-6, "{hit:?}");
    assert_eq!(hit.safe_time as f32, hit.hit_time as f32, "{hit:?}");
    assert_eq!(context.writes, 0);
    assert!(context.rapier.bodies[hit.body].is_sleeping());
    assert_eq!(
        before,
        crate::checkpoint_codec::encode(&context.rapier).unwrap()
    );
}

#[test]
fn precise_native_duration_rejects_zero_underflow_before_input_consumption() {
    assert_eq!(native_duration(Time::from(0.007_f32)), Ok(0.007));
    assert_eq!(
        native_duration(Time::from(f32::MIN_POSITIVE)),
        Ok(f32::MIN_POSITIVE)
    );
    for seconds in [0., -0., -1., 1e-300, Time::NAN, Time::INFINITY] {
        assert_eq!(native_duration(seconds), Err(TrajectoryError::InvalidTime));
    }
}

#[test]
fn precise_carrier_stop_reaches_path_limit_before_f32_progress_rounding() {
    use crate::physics3d::{
        character::CharacterPreview, BodyDesc, BodyKind, CharacterConfig, CharacterInput,
        ColliderDesc, ColliderRef, KinematicPath, PhysicsWorld3d, Pose, Shape, WorldConfig,
    };
    let mut world = PhysicsWorld3d::new(WorldConfig {
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let support = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.1, 2.],
            }),
        )
        .unwrap();
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0., 0.61, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(actor, CharacterConfig::default())
        .unwrap();
    let collider = world.collider_ids(support).unwrap().next().unwrap();
    let runtime = world.characters.get_mut(&actor).unwrap();
    runtime.state.grounded = true;
    runtime.state.ground = Some(ColliderRef {
        body: support,
        collider,
        sensor: false,
    });
    runtime.carry_fraction = 1.;
    let saved = CharacterPreview {
        id: actor,
        state: runtime.state.clone(),
        input: CharacterInput::default(),
        external_velocity: [0.; 3],
        pending_impulse: [0.; 3],
        contact_velocity: [0.; 3],
    };
    let target = Pose {
        position: [1., 0., 0.],
        ..Default::default()
    };
    world.set_kinematic_target(support, target).unwrap();
    let duration = Time::from(world.config.step_seconds);
    let stop = duration.next_down();
    world
        .character_motion
        .backend_motion
        .stops
        .push((support, stop));
    let paths = [KinematicPath {
        body: support,
        sweep_sensors: false,
        knots: vec![(1., target)],
    }];
    let limit = world.limit_kinematic_paths(&paths, &[None], std::slice::from_ref(&saved));
    assert!(limit.fraction < 1.);
    assert_eq!(limit.fraction, stop / duration);
    assert_eq!(limit.fraction as f32, 1.);
    assert_eq!(limit.mask, 1);

    world.character_motion.backend_motion.stops.clear();
    world.characters.get_mut(&actor).unwrap().carry_fraction = 0.;
    assert!(!world.actual_path_is_guarded(support));
    assert_eq!(
        world
            .limit_kinematic_paths(&paths, &[None], std::slice::from_ref(&saved))
            .fraction,
        0.
    );
    world.configure_actual_paths(&paths).unwrap();
    assert!(world.actual_path_is_guarded(support));
    assert!(!world.actual_path_is_guarded(actor));
    let guarded = world.limit_kinematic_paths(&paths, &[None], std::slice::from_ref(&saved));
    assert_eq!(guarded.fraction, 1.);
    assert_eq!(guarded.mask, 0);
    world.end_backend_motion_tick();
    assert!(!world.actual_path_is_guarded(support));
}

#[test]
fn precise_trace_retains_original_native_observer_context_label_bits() {
    let (mut context, original) = fixture(20., false);
    let duration = 0.01_f32;
    let h = duration / 36.;
    let observer_start = h * 35.;
    let observer_end = h * 36.;
    let domain = Domain::new(Time::from(duration) * 35. / 36., Time::from(duration)).unwrap();
    assert_ne!((domain.start as f32).to_bits(), observer_start.to_bits());
    let mut proposal = SolverBodyIntegration::from_velocity(
        original.motion.body,
        0.,
        h,
        original.motion.start,
        original.linear_velocity,
        original.angular_velocity,
    )
    .unwrap();
    proposal.motion.start_time = observer_start;
    proposal.motion.end_time = observer_end;
    context.domain = domain;
    context.observer_start = observer_start;
    context.observer_end = observer_end;
    context.values[0].end = proposal.motion.end;
    context.values[0].linear_velocity = proposal.linear_velocity;
    context.values[0].angular_velocity = proposal.angular_velocity;
    let collector = EventCollector::new(8);
    collector.2.lock().unwrap().reset(true);
    let mut scratch = BackendMotionScratch::default();
    let characters = BTreeMap::new();
    let policies = ContactPolicies::default();
    {
        let events = BackendEvents {
            collector: &collector,
            characters: &characters,
            policies: &policies,
            scratch: Mutex::new(&mut scratch),
            max_scratch: usize::MAX,
            restitution_threshold: 1.,
            controller_seconds: duration,
            logical_domain: Domain::new(0., Time::from(duration)).unwrap(),
            continuous: true,
            contact_error: 0.001,
            path_clearance: 0.0001,
            has_sensors: false,
        };
        events.handle_body_motion_pass_started(duration);
        events.handle_solver_body_proposal(proposal);
        assert_eq!(
            events.resolve_solver_motion(&mut context),
            SolverMotionDecision::Approved
        );
    }
    scratch.finish_trace(
        &collector,
        &context.rapier.bodies,
        &context.rapier.colliders,
        Time::from(duration),
    );
    let trace = collector.2.lock().unwrap();
    assert_eq!(trace.motions.len(), 1);
    assert_eq!(trace.actual.len(), 1);
    assert_eq!(
        trace.motions[0].start_time.to_bits(),
        observer_start.to_bits()
    );
    assert_eq!(trace.motions[0].end_time.to_bits(), observer_end.to_bits());
    assert_eq!(trace.actual[0].start_time.to_bits(), domain.start.to_bits());
    assert_eq!(trace.actual[0].end_time.to_bits(), domain.end.to_bits());
}

#[test]
fn final_native_plan_failure_keeps_private_motion_and_impulses_unpublished() {
    let (mut context, proposal) = fixture(20., false);
    let raw = crate::checkpoint_codec::encode(&context.rapier).unwrap();
    let collector = EventCollector::new(8);
    collector.2.lock().unwrap().reset(true);
    let mut scratch = BackendMotionScratch::default();
    let characters = BTreeMap::new();
    let policies = ContactPolicies::default();
    let mut plan = rp::SolverCcdPlan::default();
    {
        let events = BackendEvents {
            collector: &collector,
            characters: &characters,
            policies: &policies,
            scratch: Mutex::new(&mut scratch),
            max_scratch: usize::MAX,
            restitution_threshold: 1.,
            controller_seconds: 1.,
            logical_domain: Domain::new(0., 1.).unwrap(),
            continuous: true,
            contact_error: 0.001,
            path_clearance: 0.0001,
            has_sensors: false,
        };
        events.handle_body_motion_pass_started(1.);
        events.handle_solver_body_proposal(proposal);
        assert_eq!(
            events.resolve_solver_motion(&mut context),
            SolverMotionDecision::Approved
        );
        assert_eq!(context.writes, 1); // Private solver view, not world writeback.
        events.scratch.lock().unwrap().used = super::super::trajectory::MAX_PROOF_WORK;
        let params = rp::IntegrationParameters {
            dt: 1.,
            ..Default::default()
        };
        assert_eq!(
            events.plan_solver_ccd(&context, &params, &mut plan),
            SolverMotionDecision::Rejected
        );
    }
    assert_eq!(scratch.error(), Some(TrajectoryError::WorkLimit));
    assert!(!plan.covered && plan.clamps.is_empty() && plan.crossings.is_empty());
    assert_eq!(
        raw,
        crate::checkpoint_codec::encode(&context.rapier).unwrap()
    );
    scratch.finish_trace(
        &collector,
        &context.rapier.bodies,
        &context.rapier.colliders,
        0.,
    );
    assert!(collector.2.lock().unwrap().actual.is_empty());
    assert!(collector.1.lock().unwrap().contacts.is_empty());
}
