use super::*;
use crate::physics3d::{
    solver_trajectory::{self, CastHit, ShapeMotion},
    world::native_id,
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Pose, QueryFilter, Shape,
    Space, WorldConfig,
};

const START: Time = 0.010243964269977602;
const SAFE: Time = 0.013498650759231557;
const HIT: Time = 0.013498650759231559;
const END: Time = 0.013658619026636802;
const H: f32 = 0.0034146549;

fn work() -> Work {
    Work {
        used: 0,
        limit: super::super::super::trajectory::MAX_PROOF_WORK,
    }
}

fn clock(body: rp::RigidBodyHandle) -> Kernel {
    Kernel::from_velocity_seconds(
        body,
        Domain::new(START, END).unwrap(),
        H,
        rp::Pose::from_parts(
            rp::Vector::ZERO,
            rp::Rotation::from_xyzw(0., 0., 0.20313798, 0.9791501),
        ),
        rp::Vector::ZERO,
        rp::Vector::Z * 40.,
    )
    .unwrap()
}

fn pose() -> rp::Pose {
    rp::Pose::from_translation(rp::Vector::new(1.2, 1.3, 0.))
}

fn rate() -> rp::Vector {
    rp::Vector::new(-121.719086, 0., 0.)
}

fn body(world: &mut PhysicsWorld3d, kind: BodyKind, position: [f32; 3], shape: Shape) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position,
                    ..Default::default()
                },
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(shape),
        )
        .unwrap()
}

struct Fixture {
    world: PhysicsWorld3d,
    scratch: BackendMotionScratch,
    actor: BodyId,
    bar: BodyId,
    wall: BodyId,
    hit: actual_scene::Hit,
}

fn fixture() -> Fixture {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let bar = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        Shape::Box {
            half_extents: [2., 0.025, 0.1],
        },
    );
    let actor = body(
        &mut world,
        BodyKind::KinematicPosition,
        [1.2, 1.3, 0.],
        Shape::Capsule {
            half_height: 0.25,
            radius: 0.25,
        },
    );
    world
        .enable_character(
            actor,
            CharacterConfig {
                step_height: 0.,
                snap_distance: 0.,
                ..Default::default()
            },
        )
        .unwrap();
    let wall = body(
        &mut world,
        BodyKind::Fixed,
        [0.89, 1.3, 0.],
        Shape::Box {
            half_extents: [0.05, 0.6, 0.2],
        },
    );
    body(
        &mut world,
        BodyKind::Fixed,
        [1.2, 1.86, 0.],
        Shape::Box {
            half_extents: [0.7, 0.05, 0.2],
        },
    );
    world.refresh_queries();
    let source = clock(native_id(bar));
    assert_eq!(source.local_delta(SAFE).to_bits(), 0x3b55_4c94);
    assert_eq!(source.local_delta(HIT).to_bits(), 0x3b55_4c95);
    let old = Kernel::from_velocity(
        native_id(actor),
        Domain::new(SAFE, END).unwrap(),
        pose(),
        rate(),
        rp::Vector::ZERO,
    )
    .unwrap();
    let mut scratch = BackendMotionScratch::default();
    world.prepare_backend_motion(&mut scratch, H).unwrap();
    scratch
        .entries
        .push(super::super::momentum_tests::entry(native_id(bar), source));
    scratch
        .entries
        .push(super::super::momentum_tests::entry(native_id(actor), old));
    for (id, kernel, linear, angular) in [
        (bar, source, rp::Vector::ZERO, rp::Vector::Z * 40.),
        (actor, old, rate(), rp::Vector::ZERO),
    ] {
        scratch.participants.push(Participant {
            body: id,
            pose: kernel.position_at_time(HIT),
            linear_velocity: linear,
            angular_velocity: angular,
            mass: MassPolicy::Native,
        });
    }
    scratch.character_values.push((actor, rate()));
    for (normal, velocity) in [
        (
            rp::Vector::new(-0.5133874, 0.85815704, 0.),
            rp::Vector::new(-33.10652, 53.011944, 0.),
        ),
        (-rp::Vector::Y, rp::Vector::ZERO),
        (
            rp::Vector::new(-0.51884365, 0.85486925, 0.),
            rp::Vector::new(-32.43307, 53.438133, 0.),
        ),
    ] {
        assert!((rate() - velocity).dot(normal) >= 0.);
        scratch.character_rows.push(actual_rows::Row {
            a: 0,
            b: None,
            normal,
            velocity,
        });
    }
    let trajectory = |id, curve, role| {
        let b = &world.backend.bodies[native_id(id)];
        let collider = b.colliders()[0];
        let c = &world.backend.colliders[collider];
        let motion = ShapeMotion {
            curve,
            local_center: b.local_center_of_mass(),
            local_pose: c.position_wrt_parent().copied().unwrap(),
        };
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion,
            bounds: motion.bounds(c.shape(), SAFE, END, &mut work()).unwrap(),
            sensor: false,
        }
    };
    let a = trajectory(bar, Curve::Integrated(source), Role::Prescribed);
    let b = trajectory(actor, Curve::Integrated(old), Role::Character(actor));
    let mut contact = None;
    solver_trajectory::contacts_full_shapes(
        a.motion,
        world.backend.colliders[a.collider].shape(),
        b.motion,
        world.backend.colliders[b.collider].shape(),
        HIT,
        0.01,
        &mut work(),
        &mut |c, _, _, _| {
            contact = Some(c);
            Ok(())
        },
    )
    .unwrap();
    let contact = contact.expect("recorded actual full-shape bar hit");
    assert!(contact.dist < 0.01);
    let hit = actual_scene::Hit {
        a,
        b,
        cast: CastHit {
            safe_time: SAFE,
            hit_time: HIT,
            contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    };
    Fixture {
        world,
        scratch,
        actor,
        bar,
        wall,
        hit,
    }
}

fn run(f: &Fixture, work: &mut Work) -> Result<Option<representable::Proposal>, TrajectoryError> {
    f.scratch.clock_phase_suffix(
        1,
        f.hit,
        SAFE,
        END,
        &f.world.backend.bodies,
        &f.world.backend.colliders,
        &f.world.characters,
        rate(),
        true,
        work,
    )
}

fn bytes(f: &Fixture) -> Vec<u8> {
    postcard::to_allocvec(&(
        f.scratch
            .entries
            .iter()
            .map(|e| e.curve)
            .collect::<Vec<_>>(),
        f.scratch
            .participants
            .iter()
            .map(|p| (p.linear_velocity, p.angular_velocity))
            .collect::<Vec<_>>(),
        f.scratch
            .entries
            .iter()
            .map(|e| {
                (
                    e.momentum_before,
                    e.velocity_delta,
                    e.geometry_credit,
                    e.support,
                    e.stopped_at,
                )
            })
            .collect::<Vec<_>>(),
    ))
    .unwrap()
}

#[test]
fn recorded_same_clock_phase_improves_the_real_bar_hit_without_any_momentum_or_safe_pose_change() {
    let f = fixture();
    let before = bytes(&f);
    let world = f.world.capture_snapshot().unwrap();
    let proposal = run(&f, &mut work())
        .unwrap()
        .expect("same-rate safe-fitting phase proposal");
    assert!(same_pose(proposal.curve.com_pose(SAFE), pose()));
    assert_eq!(bits(proposal.rate), bits(rate()));
    for time in [SAFE, HIT, END] {
        assert_eq!(
            bits(curve_velocity(proposal.curve, time).unwrap().0),
            bits(rate())
        );
        assert_eq!(
            curve_velocity(proposal.curve, time).unwrap().1,
            rp::Vector::ZERO
        );
    }
    let Curve::Anchored {
        carrier,
        anchor,
        linear_velocity,
        ..
    } = proposal.curve
    else {
        panic!("own translation phase")
    };
    assert_eq!(carrier.native.motion.body, native_id(f.actor));
    assert_eq!(carrier.domain.start.to_bits(), START.to_bits());
    assert_eq!(carrier.domain.end.to_bits(), END.to_bits());
    assert_eq!(carrier.native.integration_seconds.to_bits(), H.to_bits());
    assert_eq!(
        carrier.local_delta(HIT).to_bits(),
        clock(native_id(f.bar)).local_delta(HIT).to_bits()
    );
    assert_eq!(anchor, rp::Vector::ZERO);
    assert_eq!(linear_velocity, rp::Vector::ZERO);
    assert!(
        carrier.domain.start < SAFE,
        "history must be clipped by the original staging consumer"
    );
    assert!(
        representable::gap(
            f.hit.b,
            proposal.curve,
            f.hit.a,
            f.hit.a.motion.curve,
            &f.world.backend.colliders,
            HIT,
            0.01,
            &mut work()
        )
        .unwrap()
        .unwrap()
            >= 0.01
    );
    assert_eq!(bytes(&f), before);
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        world.encoded_bytes()
    );
    assert!(f.scratch.entries.iter().all(|e| e.stopped_at.is_none()));
}

#[test]
fn original_scene_reports_a_rounded_bar_hit_before_the_new_fixed_wall() {
    let f = fixture();
    let proposal = run(&f, &mut work()).unwrap().unwrap();
    let mut scene = actual_scene::Scratch::default();
    let tracks = [
        actual_scene::BodyTrajectory {
            body: native_id(f.bar),
            curve: f.hit.a.motion.curve,
        },
        actual_scene::BodyTrajectory {
            body: native_id(f.actor),
            curve: proposal.curve,
        },
    ];
    let mut ledger = work();
    scene
        .prepare(
            &f.world.backend.bodies,
            &f.world.backend.colliders,
            &tracks,
            &f.world.characters,
            SAFE,
            END,
            1 << 20,
            &mut ledger,
        )
        .unwrap();
    let actor_pair = |a: &ColliderTrajectory, b: &ColliderTrajectory| {
        matches!(a.role, Role::Character(_)) || matches!(b.role, Role::Character(_))
    };
    let hit = scene
        .first_hit_policy(
            &f.world.backend.colliders,
            &f.world.contact_policies,
            SAFE,
            END,
            0.01,
            f64::from(H * 1e-6),
            &mut ledger,
            &actor_pair,
            &|_, _| 0.01,
        )
        .unwrap()
        .expect("original bar face is already within the requested skin");
    assert_eq!(hit.a.parent, Some(native_id(f.bar)));
    assert_eq!(hit.b.parent, Some(native_id(f.actor)));
    assert_eq!(hit.cast.safe_time.to_bits(), SAFE.to_bits());
    assert_eq!(hit.cast.hit_time.to_bits(), SAFE.to_bits());
    let box_point = rp::Vector::from_array([0x3fc8_cd65, 0x3ccc_cccd, 0].map(f32::from_bits));
    let cap_point = rp::Vector::from_array([0x3e03_5cb5, 0xbeed_dd0f, 0].map(f32::from_bits));
    let cube = f.world.backend.colliders[hit.a.collider]
        .shape()
        .as_cuboid()
        .unwrap();
    let capsule = f.world.backend.colliders[hit.b.collider]
        .shape()
        .as_capsule()
        .unwrap();
    let distance_squared_upper = |a: rp::Vector, b: rp::Vector| {
        (0..3).fold(0_f64, |sum, i| {
            let delta = (f64::from(a[i]) - f64::from(b[i])).abs().next_up();
            (sum + (delta * delta).next_up()).next_up()
        })
    };
    assert!(box_point.abs().cmple(cube.half_extents).all());
    assert!(
        distance_squared_upper(cap_point, capsule.segment.a) < f64::from(capsule.radius).powi(2)
    );
    assert!(
        distance_squared_upper(
            hit.a.motion.pose(SAFE) * box_point,
            hit.b.motion.pose(SAFE) * cap_point
        ) < f64::from(0.01_f32).powi(2)
    );

    // With the bar pair omitted, the unchanged actor path still reaches the
    // fixed wall at the original two adjacent represented times.
    let hit = scene
        .first_hit_policy(
            &f.world.backend.colliders,
            &f.world.contact_policies,
            SAFE,
            END,
            0.01,
            f64::from(H * 1e-6),
            &mut work(),
            &|a, b| {
                actor_pair(a, b)
                    && a.parent != Some(native_id(f.bar))
                    && b.parent != Some(native_id(f.bar))
            },
            &|_, _| 0.01,
        )
        .unwrap()
        .expect("actual wall contact after the initial pose");
    assert!(
        [hit.a.parent, hit.b.parent].contains(&Some(native_id(f.wall))),
        "{hit:?}"
    );
    assert_eq!(hit.cast.safe_time.to_bits(), SAFE.to_bits());
    assert_eq!(hit.cast.hit_time.to_bits(), HIT.to_bits());
    assert!(hit.cast.contact.dist <= 0.01);
    assert!(f.scratch.rows.is_empty() && f.scratch.row_impulses.is_empty());
}

#[test]
fn passive_scope_guards_preserve_positive_mass_support_rotating_actors_and_unrelated_pairs() {
    let mut f = fixture();
    let before = bytes(&f);
    f.world
        .characters
        .get_mut(&f.actor)
        .unwrap()
        .config
        .push_mass = 1.;
    assert!(run(&f, &mut work()).unwrap().is_none());
    f.world
        .characters
        .get_mut(&f.actor)
        .unwrap()
        .config
        .push_mass = 0.;
    f.scratch.entries[1].support = Some(native_id(f.bar));
    assert!(run(&f, &mut work()).unwrap().is_none());
    f.scratch.entries[1].support = None;
    f.scratch.participants[1].angular_velocity = rp::Vector::Z;
    assert!(run(&f, &mut work()).unwrap().is_none());
    f.scratch.participants[1].angular_velocity = rp::Vector::ZERO;
    f.hit.a.role = Role::Dynamic;
    assert!(run(&f, &mut work()).unwrap().is_none());
    f.hit.a.role = Role::Prescribed;
    f.hit.a.parent = Some(native_id(f.wall));
    assert_eq!(
        run(&f, &mut work()).err(),
        Some(TrajectoryError::InvalidReference)
    );
    assert_eq!(bytes(&f), before);
}

#[test]
fn inverse_frames_preserve_signed_cells_locked_axes_clock_bits_and_constant_tangents() {
    assert_eq!(origins(f32::NAN, 1.), [None; 4]);
    assert_eq!(origins(1., f32::INFINITY), [None; 4]);
    assert_eq!(origins(f32::MAX, 1.), [None; 4]);
    assert_eq!(
        origins(1.2, -0.4),
        [Some(2.), Some(-2.), Some(4.), Some(-4.)]
    );
    let source = clock(rp::RigidBodyHandle::from_raw_parts(7, 3));
    let mut visited = 0;
    let value = rp::Vector::new(-121.719086, 0.125, 0.);
    let result = propose(
        rp::RigidBodyHandle::from_raw_parts(9, 4),
        source,
        pose(),
        value,
        SAFE,
        END,
        [false, false, true],
        &mut work(),
        &mut |candidate, _| {
            visited += 1;
            assert!(same_pose(candidate.com_pose(SAFE), pose()));
            assert_eq!(bits(curve_velocity(candidate, HIT).unwrap().0), bits(value));
            assert_eq!(
                candidate.com_pose(END).translation.z.to_bits(),
                pose().translation.z.to_bits()
            );
            Ok(false)
        },
    )
    .unwrap();
    assert!(
        result.is_none()
            && visited > 0
            && visited <= 1 + (MAX_PHASES - 1) * INVERSE_CELLS * INVERSE_CELLS
    );
    let mut visited = false;
    assert!(propose(
        rp::RigidBodyHandle::from_raw_parts(9, 4),
        source,
        pose(),
        value,
        SAFE,
        END,
        [true, false, true],
        &mut work(),
        &mut |_, _| {
            visited = true;
            Ok(true)
        }
    )
    .unwrap()
    .is_none());
    assert!(
        !visited,
        "locked nonzero rate never becomes an evaluation-frame waiver"
    );
    let mut q = pose();
    q.rotation = rp::Rotation::from_rotation_z(0.3);
    let rotated = Kernel::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(SAFE, END).unwrap(),
        q,
        rate(),
        rp::Vector::Z,
    )
    .unwrap();
    assert!(!fixed_rotation(Curve::Integrated(rotated), q.rotation, &mut work()).unwrap());
}

#[test]
fn exact_work_one_below_and_callback_errors_keep_proposals_and_original_bytes_unpublished() {
    let f = fixture();
    let before = bytes(&f);
    let mut measured = work();
    let result = run(&f, &mut measured).unwrap().unwrap();
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    let repeated = run(&f, &mut exact).unwrap().unwrap();
    assert_eq!(
        postcard::to_allocvec(&result.curve).unwrap(),
        postcard::to_allocvec(&repeated.curve).unwrap()
    );
    assert_eq!(exact.used, measured.used);
    let mut short = Work {
        used: 0,
        limit: measured.used - 1,
    };
    assert_eq!(run(&f, &mut short).err(), Some(TrajectoryError::WorkLimit));
    let mut calls = 0;
    let result = propose(
        native_id(f.actor),
        clock(native_id(f.bar)),
        pose(),
        rate(),
        SAFE,
        END,
        [false, false, true],
        &mut work(),
        &mut |_, _| {
            calls += 1;
            Err(TrajectoryError::InvalidReference)
        },
    );
    assert_eq!(result.err(), Some(TrajectoryError::InvalidReference));
    assert_eq!(calls, 1);
    assert_eq!(bytes(&f), before);
}

#[test]
fn original_history_is_clipped_at_safe_and_clock_or_nonfinite_inputs_never_waive_admission() {
    let mut f = fixture();
    let proposal = run(&f, &mut work()).unwrap().unwrap();
    f.scratch.accepted.try_reserve_exact(2).unwrap();
    let old = Kernel::from_velocity_seconds(
        native_id(f.actor),
        Domain::new(START, END).unwrap(),
        H,
        pose(),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let original = super::super::momentum_tests::entry(native_id(f.actor), old);
    f.scratch
        .stage_curve(original, START, SAFE, &f.world.backend.bodies, &mut work())
        .unwrap();
    let prefix = f.scratch.accepted[0];
    let preserved =
        postcard::to_allocvec(&(prefix.curve, prefix.start_time, prefix.end_time)).unwrap();
    let mut next = f.scratch.entries[1];
    next.curve = proposal.curve;
    next.domain_start = SAFE;
    f.scratch
        .stage_curve(next, SAFE, END, &f.world.backend.bodies, &mut work())
        .unwrap();
    let saved = f.scratch.accepted[0];
    assert_eq!(
        postcard::to_allocvec(&(saved.curve, saved.start_time, saved.end_time)).unwrap(),
        preserved
    );
    let suffix = f.scratch.accepted[1];
    assert_eq!(suffix.start_time.to_bits(), SAFE.to_bits());
    assert_eq!(suffix.end_time.to_bits(), END.to_bits());
    assert!(suffix.curve.times().0 < suffix.start_time);
    assert_eq!(saved.end_time.to_bits(), suffix.start_time.to_bits());
    let source = clock(native_id(f.bar));
    assert!(propose(
        native_id(f.actor),
        source,
        pose(),
        rate(),
        SAFE,
        END.next_up(),
        [false; 3],
        &mut work(),
        &mut |_, _| Ok(true)
    )
    .unwrap()
    .is_none());
    assert_eq!(
        propose(
            native_id(f.actor),
            source,
            pose(),
            rate(),
            SAFE,
            SAFE,
            [false; 3],
            &mut work(),
            &mut |_, _| Ok(true)
        )
        .err(),
        Some(TrajectoryError::InvalidTime)
    );
    assert_eq!(
        propose(
            native_id(f.actor),
            source,
            pose(),
            rp::Vector::NAN,
            SAFE,
            END,
            [false; 3],
            &mut work(),
            &mut |_, _| Ok(true)
        )
        .err(),
        Some(TrajectoryError::NonFinite)
    );
    assert_eq!(
        inverse_rate(rp::Vector::new(1., -2., 0.5), 2.).unwrap(),
        rp::Vector::new(0.5, -1., 0.25)
    );
}

fn engine_fixture(walls: bool, actor_position: [f32; 3]) -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let bar = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0.; 3],
        Shape::Box {
            half_extents: [2., 0.025, 0.1],
        },
    );
    w.set_velocity(bar, [0.; 3], [0., 0., 40.]).unwrap();
    let actor = body(
        &mut w,
        BodyKind::KinematicPosition,
        actor_position,
        Shape::Capsule {
            half_height: 0.25,
            radius: 0.25,
        },
    );
    w.enable_character(
        actor,
        CharacterConfig {
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    if walls {
        body(
            &mut w,
            BodyKind::Fixed,
            [0.89, 1.3, 0.],
            Shape::Box {
                half_extents: [0.05, 0.6, 0.2],
            },
        );
        body(
            &mut w,
            BodyKind::Fixed,
            [1.2, 1.86, 0.],
            Shape::Box {
                half_extents: [0.7, 0.05, 0.2],
            },
        );
    }
    (w, bar, actor)
}

fn distance(w: &PhysicsWorld3d, a: BodyId, b: BodyId) -> f32 {
    let ca = &w.backend.colliders[w.backend.bodies[native_id(a)].colliders()[0]];
    let cb = &w.backend.colliders[w.backend.bodies[native_id(b)].colliders()[0]];
    rapier3d::parry::query::contact(ca.position(), ca.shape(), cb.position(), cb.shape(), 10.)
        .unwrap()
        .unwrap()
        .dist
}

#[test]
fn engine_event_prefix_keeps_full_credit_real_contact_stop_and_snapshot_continuation() {
    let (mut w, bar, actor) = engine_fixture(true, [1.2, 1.3, 0.]);
    w.set_step_motion_enabled(true);
    let initial = w.capture_snapshot().unwrap();
    w.step_checked().unwrap();
    assert_eq!(
        w.actual_motion_completed_time().to_bits(),
        f64::from(w.config.step_seconds).to_bits()
    );
    let state = w.body_state(bar).unwrap();
    assert!(
        state.pose.rotation[2] > 0.2 && state.pose.rotation[2] < 0.3,
        "{state:?}"
    );
    assert_eq!(state.angular_velocity, [0.; 3]);
    assert_eq!(w.step_statistics().kinematic_character_stops, 1);
    assert_eq!(w.step_statistics().kinematic_path_failures, 0);
    assert!(distance(&w, bar, actor) > 0.);
    let mut out = Vec::new();
    assert_eq!(
        w.sweep_step_motion(
            &Shape::Sphere { radius: 0.01 },
            Pose {
                position: [-10., 10., 0.],
                ..Default::default()
            },
            [0.; 3],
            &QueryFilter::default(),
            &mut out,
            8
        ),
        Ok(false)
    );
    let accepted = w.capture_snapshot().unwrap();
    w.restore_snapshot(&initial).unwrap();
    w.step_checked().unwrap();
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        accepted.encoded_bytes()
    );
    for _ in 0..6 {
        w.step_checked().unwrap();
        assert!(distance(&w, bar, actor) >= 0.);
    }
}

#[test]
fn distant_free_angular_driver_has_no_stop_authority_or_phase_side_effects() {
    let (mut w, bar, actor) = engine_fixture(false, [20., 20., 0.]);
    // This control requests a full 40 rad/s for the unsplit 0.1-second pass.
    // Native's default pi/4 full-pass angular cap is a separate policy from
    // contact stops; opt in through its existing per-body control, rather
    // than mistaking the expected default 7.853982 output for a false stop.
    assert!(!w.backend.bodies[native_id(bar)].is_fast_rotation_allowed());
    w.backend.bodies[native_id(bar)].set_allow_fast_rotation(true);
    let mut native = PhysicsWorld3d::new(w.config.clone()).unwrap();
    let reference = body(
        &mut native,
        BodyKind::KinematicVelocity,
        [0.; 3],
        Shape::Box {
            half_extents: [2., 0.025, 0.1],
        },
    );
    native
        .set_velocity(reference, [0.; 3], [0., 0., 40.])
        .unwrap();
    native.backend.bodies[native_id(reference)].set_allow_fast_rotation(true);
    w.step_checked().unwrap();
    native.step_checked().unwrap();
    assert_eq!(
        w.actual_motion_completed_time().to_bits(),
        f64::from(w.config.step_seconds).to_bits()
    );
    assert_eq!(w.body_state(bar).unwrap().angular_velocity, [0., 0., 40.]);
    assert_eq!(
        native.body_state(reference).unwrap().angular_velocity,
        [0., 0., 40.]
    );
    assert_eq!(
        w.body_state(bar).unwrap(),
        native.body_state(reference).unwrap()
    );
    assert_eq!(w.step_statistics().kinematic_character_stops, 0);
    assert_eq!(w.body_state(actor).unwrap().pose.position, [20., 20., 0.]);
}
