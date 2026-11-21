use super::*;
use crate::physics3d::{
    world::native_id, BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Shape, WorldConfig,
};
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
struct Fixture {
    world: PhysicsWorld3d,
    carrier: Kernel,
    original: Curve,
    actor: ColliderTrajectory,
    platform: ColliderTrajectory,
    safe: Time,
}
impl Fixture {
    fn phase(&self, cells: u32) -> Curve {
        let Curve::Anchored {
            carrier,
            mut anchor,
            offset,
            linear_velocity,
            rotation,
        } = self.original
        else {
            unreachable!()
        };
        anchor.y = f32::from_bits(anchor.y.to_bits() + cells);
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        }
    }
    fn prepare(&self, work: &mut Work) -> Result<FullFuture<'_>, TrajectoryError> {
        FullFuture::new(
            self.actor,
            self.original,
            self.platform,
            self.platform.motion.curve,
            &self.world.backend.colliders,
            self.carrier,
            self.safe,
            self.carrier.domain.end,
            0.01,
            false,
            work,
        )
    }
}
fn fixture() -> Fixture {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let platform = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                can_sleep: false,
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
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    let native = SolverBodyIntegration {
        motion: rapier3d::pipeline::SolverBodyMotion {
            body: native_id(platform),
            start_time: 0.014249997,
            end_time: 0.018999996,
            start: rp::Pose::from_translation(rp::Vector::new(0.14249997, -0.100000136, 0.)),
            end: rp::Pose::from_translation(rp::Vector::new(0.18999995, -0.10000018, 0.)),
        },
        integration_seconds: 0.004749999,
        linear_velocity: rp::Vector::new(10., -9.380261e-6, 0.),
        angular_velocity: rp::Vector::ZERO,
    };
    let carrier = Kernel::from_native(
        native,
        Domain::new(0.01424999674782157, 0.018999995663762093).unwrap(),
    )
    .unwrap();
    let original = Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.9999944, f32::from_bits(0x3dcc845c), 2.9802322e-6),
        offset: rp::Vector::new(5.6028366e-6, 0.51013815, -2.9802322e-6),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let trajectory = |id, curve, role| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion: ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let a = trajectory(actor, original, Role::Character(actor));
    let p = trajectory(platform, Curve::Integrated(carrier), Role::Dynamic);
    Fixture {
        world,
        carrier,
        original,
        actor: a,
        platform: p,
        safe: 0.015441418681002492,
    }
}

#[test]
fn local_improvement_keeps_original_phase_priority_and_requires_whole_pair_policy() {
    let f = fixture();
    let before = f.world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut shared = work();
    let future = f.prepare(&mut shared).unwrap();
    let known_hit = 0.015441423207049092;
    let bad = f.phase(1);
    let good = f.phase(5);
    for candidate in [bad, good] {
        assert!(same_pose(
            candidate.com_pose(f.safe),
            f.original.com_pose(f.safe)
        ));
        assert_eq!(
            curve_velocity(candidate, known_hit).unwrap(),
            curve_velocity(f.original, known_hit).unwrap()
        );
        for time in [f.safe, known_hit, f.carrier.domain.end] {
            for axis in [0, 2] {
                assert_eq!(
                    candidate.com_pose(time).translation[axis].to_bits(),
                    f.original.com_pose(time).translation[axis].to_bits()
                );
            }
        }
    }
    let old = gap(
        f.actor,
        f.original,
        f.platform,
        f.platform.motion.curve,
        &f.world.backend.colliders,
        known_hit,
        0.01,
        &mut shared,
    )
    .unwrap()
    .unwrap();
    let local = gap(
        f.actor,
        bad,
        f.platform,
        f.platform.motion.curve,
        &f.world.backend.colliders,
        known_hit,
        0.01,
        &mut shared,
    )
    .unwrap()
    .unwrap();
    assert!(
        local >= 0.01 && local > old,
        "first local screen really passes"
    );
    // Strict and permitted-existing policies are separate observations. The
    // selector must use the same latter authority as the real scene consumer;
    // a strict hit is not by itself an unsafe permitted-existing suffix.
    assert!(future
        .query(bad, future.end, false, &mut shared)
        .unwrap()
        .hit
        .is_some());
    assert!(
        future
            .query(good, future.end, false, &mut shared)
            .unwrap()
            .hit
            .is_none(),
        "independent existing +5 strict whole-shape control"
    );
    let mut expected = None;
    let mut selected = None;
    for candidate in [bad, good] {
        let permitted = future
            .query(candidate, future.end, true, &mut shared)
            .unwrap()
            .hit
            .is_none();
        let accepted = future.accepts(candidate, &mut shared).unwrap();
        assert_eq!(accepted, permitted);
        if expected.is_none() && permitted {
            expected = Some(candidate);
        }
        if selected.is_none() && accepted {
            selected = Some(candidate);
        }
    }
    assert!(
        selected.is_some(),
        "original +5 full-shape suffix remains available"
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&selected).unwrap(),
        crate::checkpoint_codec::encode(&expected).unwrap()
    );
    assert_eq!(f.world.capture_snapshot().unwrap().encoded_bytes(), before);
}

#[test]
fn permitted_existing_policy_keeps_real_initial_inward_and_future_penetration_hits() {
    let f = fixture();
    let carrier = Kernel::from_velocity_seconds(
        f.carrier.native.motion.body,
        Domain::new(0., 1.).unwrap(),
        1.,
        rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let surface = Curve::Integrated(carrier);
    let before = f.world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    for (height, existing) in [(0.52, false), (0.505, true)] {
        let original = Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::Y * height),
            start_time: 0.,
            end_time: 1.,
        };
        let future = FullFuture::new(
            f.actor,
            original,
            f.platform,
            surface,
            &f.world.backend.colliders,
            carrier,
            0.,
            1.,
            0.01,
            false,
            &mut work(),
        )
        .unwrap();
        let input = crate::checkpoint_codec::encode(&(carrier, original, surface)).unwrap();
        // Measure the original full leaf directly, in the encountered platform
        // A / actor B order. NoHit or coverage metadata is not a gap getter.
        let native = solver_trajectory::leaf_contact(
            &future.other.pose(0.),
            future.other_shape,
            &future.actor.pose(0.),
            future.actor_shape,
            &mut work(),
        )
        .unwrap();
        assert!(
            native.dist > 0.,
            "both original full shapes really have a positive gap"
        );
        assert_eq!(native.dist <= 0.01, existing);
        let initial = future.query(original, 0., false, &mut work()).unwrap();
        assert_eq!(initial.hit.is_some(), existing);
        assert!(!initial.strictly_clear_start && !initial.reused);
        if existing {
            assert_eq!(initial.hit.unwrap().hit_time.to_bits(), 0_f64.to_bits());
        } else {
            // The .52 full shapes are genuinely clear, but AABB gross skip
            // observed no leaf. That NoHit carries no observed strict prefix.
            assert!(initial.hit.is_none() && native.dist > 0.01);
        }
        assert!(future.accepts(original, &mut work()).unwrap());
        let inward = Curve::Integrated(
            Kernel::from_velocity_seconds(
                f.actor.parent.unwrap(),
                Domain::new(0., 1.).unwrap(),
                1.,
                original.com_pose(0.),
                -rp::Vector::Y * 0.1,
                rp::Vector::ZERO,
            )
            .unwrap(),
        );
        assert!(same_pose(inward.com_pose(0.), original.com_pose(0.)));
        let collision = future
            .query(inward, future.end, true, &mut work())
            .unwrap()
            .hit
            .expect("actual initial inward or later full-shape collision");
        if existing {
            assert_eq!(collision.hit_time.to_bits(), 0_f64.to_bits());
        } else {
            assert!(collision.hit_time > 0. && collision.hit_time <= future.end);
        }
        assert!(!future.accepts(inward, &mut work()).unwrap());
        assert_eq!(
            crate::checkpoint_codec::encode(&(carrier, original, surface)).unwrap(),
            input
        );
    }
    assert_eq!(f.world.capture_snapshot().unwrap().encoded_bytes(), before);
}

#[test]
fn whole_future_exact_quota_and_invalid_owner_keep_world_and_curves_unpublished() {
    let f = fixture();
    let original = crate::checkpoint_codec::encode(&(f.carrier, f.original)).unwrap();
    let before = f.world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let run =
        |w: &mut Work| -> Result<bool, TrajectoryError> { f.prepare(w)?.accepts(f.phase(5), w) };
    let mut measured = work();
    assert!(run(&mut measured).unwrap());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(run(&mut exact).unwrap());
    assert_eq!(exact.used, measured.used);
    assert!(matches!(
        run(&mut Work {
            used: 0,
            limit: measured.used - 1
        }),
        Err(TrajectoryError::WorkLimit)
    ));
    let mut invalid = f.actor;
    invalid.collider = rp::ColliderHandle::from_raw_parts(u32::MAX, 0);
    assert!(matches!(
        FullFuture::new(
            invalid,
            f.original,
            f.platform,
            f.platform.motion.curve,
            &f.world.backend.colliders,
            f.carrier,
            f.safe,
            f.carrier.domain.end,
            0.01,
            false,
            &mut work()
        ),
        Err(TrajectoryError::InvalidReference)
    ));
    assert_eq!(f.world.capture_snapshot().unwrap().encoded_bytes(), before);
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.carrier, f.original)).unwrap(),
        original
    );
}

#[test]
fn rotating_conflict_hint_rechecks_each_candidate_at_its_own_margin() {
    let domain = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let carrier = Kernel::from_native(
        SolverBodyIntegration {
            motion: rapier3d::pipeline::SolverBodyMotion {
                body: rp::RigidBodyHandle::from_raw_parts(0, 0),
                start_time: 0.004166667,
                end_time: 0.008333334,
                start: rp::Pose::from_parts(
                    rp::Vector::new(0., -0.1, 0.),
                    rp::Rotation::from_xyzw(0., 0.09475959, 0., 0.99550015),
                ),
                end: rp::Pose::from_parts(
                    rp::Vector::new(0., -0.1, 0.),
                    rp::Rotation::from_xyzw(0., 0.09801684, 0., 0.9951848),
                ),
            },
            integration_seconds: 0.004166667,
            linear_velocity: rp::Vector::ZERO,
            angular_velocity: rp::Vector::new(0., 1.5707964, 0.),
        },
        domain,
    )
    .unwrap();
    let phase = |anchor_y, offset_y| Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.99818134, anchor_y, -0.006525323),
        offset: rp::Vector::new(0.0012536049, offset_y, 0.0064118207),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let offset = -1.1920929e-7_f32;
    let previous = phase(1.0100003, offset);
    let alias = phase(1.0100003, offset.next_up());
    let clear = phase(0.1_f32.next_down(), 0.9100003);

    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let future = FullFuture {
        actor: motion(previous),
        other: motion(Curve::Integrated(carrier)),
        actor_shape: capsule.as_ref(),
        other_shape: cuboid.as_ref(),
        start: 0.00417571491061608,
        end: domain.end,
        clearance: 0.01,
        tolerance: f64::from(
            (carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6,
        ),
        actor_first: false,
    };

    let mut hint = None;
    let mut initial = work();
    assert!(!future
        .coverage_with_conflict_hint(previous, &mut hint, &mut initial)
        .unwrap()
        .is_some());
    assert_eq!(hint, Some(0.007782061235047878));
    assert!(initial.used > 1_000_000);

    let mut repeat = Work {
        used: 0,
        limit: 100_000,
    };
    assert!(!future
        .coverage_with_conflict_hint(alias, &mut hint, &mut repeat)
        .unwrap()
        .is_some());
    assert!(!future.accepts(alias, &mut work()).unwrap());

    // The same time gives no conflict for the real surface reference.
    // A missing conflict still requires the full pair query to accept.
    let before = repeat.used;
    assert!(future
        .coverage_with_conflict_hint(clear, &mut hint, &mut repeat)
        .unwrap()
        .is_some());
    assert!(future.accepts(clear, &mut work()).unwrap());
    assert!(repeat.used > before);
    assert_eq!(hint, Some(0.007782061235047878));
}

#[test]
fn nearby_rotating_hint_checks_a_distinct_candidates_real_contact() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.43934986, 0., 0.89831597),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    carrier.native.motion.start_time = 0.012500001;
    carrier.native.motion.end_time = 0.016666668;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.44228727, 0., 0.8968735]
    );
    let candidate = |axis, offset_y| Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.9915769, axis, -0.019429952),
        offset: rp::Vector::new(0.015487134, offset_y, 0.011804342),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let previous = candidate(1.0100003, -1.1920929e-7);
    let distinct = candidate(1.0100001, 1.1920929e-7);
    let clear = candidate(1.0100006, 2.3841858e-7);
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let future = FullFuture {
        actor: motion(previous),
        other: motion(Curve::Integrated(carrier)),
        actor_shape: capsule.as_ref(),
        other_shape: cuboid.as_ref(),
        start: 0.012535841882709065,
        end: domain.end,
        clearance: 0.01,
        tolerance: f64::from(
            (carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6,
        ),
        actor_first: false,
    };
    let check_at = |candidate, time| {
        let (a, sa, b, sb) = future.ordered_motions(candidate);
        solver_trajectory::rotating_support_conflict(
            a,
            sa,
            b,
            sb,
            future.start,
            future.end,
            future.clearance,
            Some(time),
            &mut work(),
        )
        .unwrap()
    };
    let initial = 0.013370306900469586;
    assert_eq!(check_at(previous, initial), Some(initial));
    let mut hint = Some(initial);
    let mut charged = Work {
        used: 0,
        limit: 100_000,
    };
    assert!(!future
        .coverage_with_conflict_hint(distinct, &mut hint, &mut charged)
        .unwrap()
        .is_some());
    let at = hint.unwrap();
    assert!(at > initial && at - initial < 2e-6);
    assert_eq!(check_at(distinct, at), Some(at));
    assert!(!future.accepts(distinct, &mut work()).unwrap());

    // A miss only submits the candidate to the unchanged full cast.
    let mut hint = Some(initial);
    let mut charged = Work {
        used: 0,
        limit: 200_000,
    };
    assert!(future
        .coverage_with_conflict_hint(clear, &mut hint, &mut charged)
        .unwrap()
        .is_some());
    assert_eq!(hint, Some(initial));
    assert!(future.accepts(clear, &mut work()).unwrap());
}

#[test]
fn extended_signed_conflict_checks_the_sixty_ninth_tick_response() {
    let domain = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.7791994, 0., 0.62677616),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.78124636, 0., 0.6242229]
    );
    let phase = |height, offset_y| Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.98377055, height, 0.006484285),
        offset: rp::Vector::new(0.006302625, offset_y, -0.0013175607),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let original = phase(1.0100002, -1.1920929e-7);
    let recontacting = phase(1.0100001, 1.1920929e-7);
    let clear = phase(0.1_f32.next_down(), 0.910_000_2);
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let future = FullFuture {
        actor: motion(original),
        other: motion(Curve::Integrated(carrier)),
        actor_shape: capsule.as_ref(),
        other_shape: cuboid.as_ref(),
        start: 0.004166969587672042,
        end: domain.end,
        clearance: 0.01,
        tolerance: f64::from(
            (carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6,
        ),
        actor_first: false,
    };
    assert!(same_pose(
        original.com_pose(future.start),
        clear.com_pose(future.start)
    ));
    let previous = phase(1.0100003, -2.3841858e-7);
    let mut hint = None;
    let mut shared = Work {
        used: 0,
        limit: 500_000,
    };
    assert!(!future
        .coverage_with_conflict_hint(previous, &mut hint, &mut shared)
        .unwrap()
        .is_some());
    assert_eq!(hint, Some(0.007291742722880912));
    assert!(!future
        .coverage_with_conflict_hint(recontacting, &mut hint, &mut shared)
        .unwrap()
        .is_some());
    let contact = hint.expect("the signed prefix supplies a confirmed second contact");
    assert!(contact > future.start + (future.end - future.start) / 512.);
    assert!(contact < future.start + (future.end - future.start) / 128.);
    let (a, sa, b, sb) = future.ordered_motions(recontacting);
    assert_eq!(
        solver_trajectory::rotating_support_conflict(
            a,
            sa,
            b,
            sb,
            future.start,
            future.end,
            future.clearance,
            Some(contact),
            &mut shared,
        )
        .unwrap(),
        Some(contact),
    );
    let coverage = future.query(clear, future.end, false, &mut shared).unwrap();
    assert!(coverage.strictly_clear_start && coverage.hit.is_none());
}
