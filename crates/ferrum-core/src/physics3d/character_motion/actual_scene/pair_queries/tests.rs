use super::*;
use crate::physics3d::solver_trajectory::{Domain, Kernel};
use crate::physics3d::{
    world::native_id, BodyDesc, BodyId, BodyKind, ColliderDesc, PhysicsWorld3d, Pose, Shape,
    WorldConfig,
};
use std::cell::Cell;

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}

fn body(w: &mut PhysicsWorld3d, kind: BodyKind, position: [f32; 3], shape: Shape) -> BodyId {
    w.create_body(
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

fn spheres() -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let a = body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    let b = body(
        &mut w,
        BodyKind::KinematicPosition,
        [1.5, 1.5, 0.],
        Shape::Sphere { radius: 1. },
    );
    (w, a, b)
}

fn kernel_for(w: &PhysicsWorld3d, id: BodyId, velocity: rp::Vector) -> Kernel {
    Kernel::from_velocity(
        native_id(id),
        Domain::new(0., 1.).unwrap(),
        *w.backend.bodies[native_id(id)].position(),
        velocity,
        rp::Vector::ZERO,
    )
    .unwrap()
}

fn prepare(
    w: &PhysicsWorld3d,
    scene: &mut Scratch,
    memo: &mut PairQueries<'_>,
    tracks: &[BodyTrajectory],
    start: Time,
    end: Time,
    work: &mut Work,
) {
    let scratch = memo
        .fit_for_scene(1 << 20, w.backend.colliders.len(), work)
        .unwrap();
    scene
        .prepare(
            &w.backend.bodies,
            &w.backend.colliders,
            tracks,
            &w.characters,
            start,
            end,
            scratch,
            work,
        )
        .unwrap();
}

#[allow(clippy::too_many_arguments)]
fn query(
    w: &PhysicsWorld3d,
    scene: &Scratch,
    memo: &mut PairQueries<'_>,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    enabled: bool,
    work: &mut Work,
    casts: &Cell<usize>,
    failures: &Cell<usize>,
) -> Result<Option<Hit>, TrajectoryError> {
    scene.first_hit_memoized_policy(
        &w.backend.colliders,
        &w.contact_policies,
        start,
        end,
        clearance,
        tolerance,
        work,
        &|_, _| enabled,
        &|_, _| super::super::PairClearance::Distance(clearance),
        &|_| false,
        &mut |_, _, event, _| {
            match event {
                QueryEvent::Cast => casts.set(casts.get() + 1),
                QueryEvent::Failure => failures.set(failures.get() + 1),
            }
            Ok(())
        },
        memo,
        None,
        0.,
        &[],
    )
}

fn hit_bytes(hit: &Option<Hit>) -> Vec<u8> {
    postcard::to_allocvec(&hit.map(|hit| {
        let c = hit.cast.contact;
        (
            hit.a.collider.into_raw_parts(),
            hit.b.collider.into_raw_parts(),
            hit.cast.safe_time.to_bits(),
            hit.cast.hit_time.to_bits(),
            c.point1.to_array().map(f32::to_bits),
            c.point2.to_array().map(f32::to_bits),
            c.normal1.to_array().map(f32::to_bits),
            c.normal2.to_array().map(f32::to_bits),
            c.dist.to_bits(),
            hit.cast.subshape_a,
            hit.cast.subshape_b,
        )
    }))
    .unwrap()
}

fn memo_bytes(memo: &PairQueries<'_>) -> Vec<u8> {
    postcard::to_allocvec(
        &memo
            .entries
            .iter()
            .map(|entry| {
                (
                    entry.a.motion,
                    entry.b.motion,
                    entry.start,
                    entry.end,
                    entry.clearance,
                    entry.tolerance,
                    entry.allow_existing,
                    entry.hit.map(|h| {
                        (
                            h.safe_time.to_bits(),
                            h.hit_time.to_bits(),
                            h.contact.dist.to_bits(),
                        )
                    }),
                )
            })
            .collect::<Vec<_>>(),
    )
    .unwrap()
}

#[test]
fn strict_proposal_reuses_proved_clear_pair_at_a_different_tolerance() {
    let (w, _, moving) = spheres();
    let colliders = &w.backend.colliders;
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    let (clearance, tolerance) = (0.01, 1e-6);
    let mut tracks = [BodyTrajectory {
        body: native_id(moving),
        curve: Curve::Integrated(kernel_for(&w, moving, rp::Vector::new(-1., -1., 0.))),
    }];
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let hit = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        clearance,
        tolerance,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .unwrap();
    assert_eq!(casts.get(), 1);
    let (start, end) = (0.025, 0.75);
    tracks[0].curve = Curve::Integrated(kernel_for(&w, moving, rp::Vector::ZERO));
    prepare(&w, &mut scene, &mut memo, &tracks, start, end, &mut work());
    let [a, b] = scene.colliders[..] else {
        panic!("expected one candidate pair");
    };
    assert_eq!((a.collider, b.collider), (hit.a.collider, hit.b.collider));
    let proof = solver_trajectory::cast_full_shapes_policy_coverage(
        a.motion,
        colliders[a.collider].shape(),
        b.motion,
        colliders[b.collider].shape(),
        start,
        end,
        clearance,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap();
    assert!(proof.hit.is_none() && proof.strictly_clear_start && !proof.reused);

    let previous = memo_bytes(&memo);
    let reserved = memo.bytes().unwrap();
    for rejected in [
        solver_trajectory::CastCoverage {
            strictly_clear_start: false,
            ..proof
        },
        solver_trajectory::CastCoverage {
            reused: true,
            ..proof
        },
        solver_trajectory::CastCoverage {
            hit: Some(hit.cast),
            ..proof
        },
    ] {
        memo.remember_strict_proposal(
            colliders,
            a,
            b,
            start,
            end,
            clearance,
            tolerance,
            rejected,
            &mut work(),
        )
        .unwrap();
    }
    memo.remember_strict_proposal(
        colliders,
        b,
        a,
        start,
        end,
        clearance,
        tolerance,
        proof,
        &mut work(),
    )
    .unwrap();
    assert_eq!(memo_bytes(&memo), previous);
    assert!(matches!(
        memo.lookup(
            &hit.a,
            &hit.b,
            0.,
            1.,
            clearance,
            tolerance,
            true,
            &mut work()
        )
        .unwrap(),
        Lookup::Reuse(Some(_))
    ));

    memo.remember_strict_proposal(
        colliders,
        a,
        b,
        start,
        end,
        clearance,
        tolerance,
        proof,
        &mut work(),
    )
    .unwrap();
    assert_eq!(memo.entries.len(), 1);
    assert_eq!(memo.bytes().unwrap(), reserved);
    assert!(query(
        &w,
        &scene,
        &mut memo,
        start,
        end,
        clearance,
        2e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .is_none());
    assert_eq!(
        casts.get(),
        1,
        "the scene skipped an already proved complete cast"
    );
    assert_eq!(failures.get(), 0);

    let mut changed = b;
    changed.motion.local_pose.translation.y += 0.125;
    assert!(matches!(
        memo.lookup(&a, &changed, start, end, clearance, 2e-6, true, &mut work())
            .unwrap(),
        Lookup::Miss(_)
    ));
    assert!(matches!(
        memo.lookup(
            &hit.a,
            &hit.b,
            start,
            end,
            clearance,
            2e-6,
            true,
            &mut work()
        )
        .unwrap(),
        Lookup::Miss(_)
    ));
    for (from, until) in [(start, 0.875), (0.125, end)] {
        assert!(matches!(
            memo.lookup(&a, &b, from, until, clearance, 2e-6, true, &mut work())
                .unwrap(),
            Lookup::Miss(_)
        ));
    }
}

#[test]
fn exact_and_strict_same_pose_subinterval_queries_reuse_only_the_original_coverage() {
    let (w, _, b) = spheres();
    let source = kernel_for(&w, b, rp::Vector::ZERO);
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(source),
    }];
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    let before = w.capture_snapshot().unwrap();
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let first = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert!(first.is_none());
    assert_eq!(casts.get(), 1);
    assert_eq!(memo.entries.len(), 1);
    assert!(memo.entries[0].strict_start.is_some());
    let repeated = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert_eq!(hit_bytes(&first), hit_bytes(&repeated));
    prepare(&w, &mut scene, &mut memo, &tracks, 0.25, 0.75, &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.25,
        0.75,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures
    )
    .unwrap()
    .is_none());
    assert_eq!(
        casts.get(),
        1,
        "neither reuse is an executed geometric Cast"
    );
    assert_eq!(memo.hits, 2);
    assert_eq!(failures.get(), 0);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn same_safe_pose_and_rate_but_changed_phase_and_later_collision_are_real_cache_misses() {
    let (w, _, b) = spheres();
    let original = kernel_for(&w, b, rp::Vector::X * 0.1);
    let mut phase = kernel_for(&w, b, rp::Vector::X * 0.1);
    phase = Kernel::from_velocity(
        native_id(b),
        phase.domain,
        rp::Pose::from_translation(rp::Vector::new(4., 1.5, 0.)),
        phase.native.linear_velocity,
        rp::Vector::ZERO,
    )
    .unwrap();
    let changed = Curve::Anchored {
        carrier: phase,
        anchor: rp::Vector::ZERO,
        offset: -rp::Vector::X * 2.5,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    assert!(pose(
        Curve::Integrated(original).com_pose(0.),
        changed.com_pose(0.)
    ));
    let shape_motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    assert_eq!(
        shape_motion(Curve::Integrated(original)).linear_angular_velocity(0.),
        shape_motion(changed).linear_angular_velocity(0.)
    );
    assert!(!pose(
        Curve::Integrated(original).com_pose(0.25),
        changed.com_pose(0.25)
    ));
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    let mut tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(original),
    }];
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures
    )
    .unwrap()
    .is_none());
    tracks[0].curve = changed;
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures
    )
    .unwrap()
    .is_none());
    assert_eq!(
        casts.get(),
        2,
        "same instantaneous state is not a curve key"
    );
    tracks[0].curve = Curve::Integrated(kernel_for(&w, b, rp::Vector::new(-1., -1., 0.)));
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let hit = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .unwrap();
    assert!(hit.cast.hit_time < 1. && hit.cast.contact.dist <= 0.01);
    assert_eq!(casts.get(), 3);
    assert_eq!(memo.hits, 0);
}

#[test]
fn new_grazing_start_or_initial_policy_cannot_inherit_a_strict_old_prefix() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    let b = body(
        &mut w,
        BodyKind::KinematicPosition,
        [3., 0., 0.],
        Shape::Sphere { radius: 1. },
    );
    let original = kernel_for(&w, b, -rp::Vector::X * 0.9375);
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(original),
    }];
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let old = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.0625,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert!(
        old.is_none(),
        "the original closed nonpenetration certificate covers the endpoint"
    );
    let entry = memo.entries[0];
    assert!(entry.strict_start.is_some());
    assert!(matches!(
        memo.lookup(&entry.a, &entry.b, 1., 1., 0.0625, 1e-6, true, &mut work())
            .unwrap(),
        Lookup::Recheck(_, _)
    ));
    assert!(matches!(
        memo.lookup(&entry.a, &entry.b, 0., 1., 0.0625, 1e-6, false, &mut work())
            .unwrap(),
        Lookup::Miss(_)
    ));
    let ca = &w.backend.colliders[entry.a.collider];
    let cb = &w.backend.colliders[entry.b.collider];
    for existing in [false, true] {
        let direct = solver_trajectory::cast_full_shapes_policy(
            entry.a.motion,
            ca.shape(),
            entry.b.motion,
            cb.shape(),
            1.,
            1.,
            0.0625,
            1e-6,
            &mut work(),
            existing,
        )
        .unwrap();
        let observed = solver_trajectory::cast_full_shapes_policy_reusing(
            entry.a.motion,
            ca.shape(),
            entry.b.motion,
            cb.shape(),
            1.,
            1.,
            0.0625,
            1e-6,
            &mut work(),
            existing,
            Some(solver_trajectory::StrictPrefix::Clear),
        )
        .unwrap();
        assert!(
            !observed.reused,
            "grazing reruns the original initial policy"
        );
        assert!(
            !observed.strictly_clear_start,
            "equality does not pass left>clearance"
        );
        let key = |hit: Option<CastHit>| {
            hit.map(|hit| {
                (
                    hit.safe_time.to_bits(),
                    hit.hit_time.to_bits(),
                    hit.contact.dist.to_bits(),
                )
            })
        };
        assert_eq!(key(direct), key(observed.hit));
    }
    assert_eq!(memo.hits, 0);
}

#[test]
fn eligibility_clearance_tolerance_generation_and_context_owners_remain_authoritative() {
    let (w, _, b) = spheres();
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel_for(&w, b, rp::Vector::ZERO)),
    }];
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let _ = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        false,
        &mut work(),
        &casts,
        &failures
    )
    .unwrap()
    .is_none());
    assert_eq!(casts.get(), 1);
    assert_eq!(memo.hits, 0, "disabled pair gates run before memo lookup");
    let _ = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.02,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    let _ = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.02,
        2e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert_eq!(casts.get(), 3);
    let old = scene.colliders[1].collider;
    let (index, generation) = old.into_raw_parts();
    scene.colliders[1].collider = rp::ColliderHandle::from_raw_parts(index, generation + 1);
    assert_eq!(
        query(
            &w,
            &scene,
            &mut memo,
            0.,
            1.,
            0.02,
            2e-6,
            true,
            &mut work(),
            &casts,
            &failures
        )
        .err(),
        Some(TrajectoryError::InvalidReference)
    );
    scene.colliders[1].collider = old;
    let (other, _, _) = spheres();
    assert_eq!(
        scene
            .first_hit_memoized_policy(
                &other.backend.colliders,
                &other.contact_policies,
                0.,
                1.,
                0.01,
                1e-6,
                &mut work(),
                &|_, _| true,
                &|_, _| super::super::PairClearance::Distance(0.01),
                &|_| false,
                &mut |_, _, _, _| Ok(()),
                &mut memo,
                None,
                0.,
                &[],
            )
            .err(),
        Some(TrajectoryError::InvalidReference)
    );
    let fresh =
        PairQueries::new(&other.backend.colliders, &other.contact_policies, 0., 1.).unwrap();
    assert!(fresh.entries.is_empty());
}

#[test]
fn exact_one_below_work_and_scratch_release_never_publish_a_partial_cache_or_world() {
    let (w, _, b) = spheres();
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel_for(&w, b, rp::Vector::ZERO)),
    }];
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let original = w.capture_snapshot().unwrap();
    let mut measured = work();
    let _ = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut measured,
        &casts,
        &failures,
    )
    .unwrap();
    let mut fresh = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    fresh
        .fit_for_scene(1 << 20, w.backend.colliders.len(), &mut work())
        .unwrap();
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    let _ = query(
        &w, &scene, &mut fresh, 0., 1., 0.01, 1e-6, true, &mut exact, &casts, &failures,
    )
    .unwrap();
    assert_eq!(exact.used, measured.used);
    assert_eq!(memo_bytes(&memo), memo_bytes(&fresh));
    let mut short_memo =
        PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    short_memo
        .fit_for_scene(1 << 20, w.backend.colliders.len(), &mut work())
        .unwrap();
    let mut short = Work {
        used: 0,
        limit: measured.used - 1,
    };
    assert_eq!(
        query(
            &w,
            &scene,
            &mut short_memo,
            0.,
            1.,
            0.01,
            1e-6,
            true,
            &mut short,
            &casts,
            &failures
        )
        .err(),
        Some(TrajectoryError::WorkLimit)
    );
    assert!(
        short_memo.entries.is_empty(),
        "failed admission installs no result"
    );
    assert_eq!(
        failures.get(),
        0,
        "memo admission is not a geometric Failure"
    );
    let before = memo_bytes(&memo);
    assert_eq!(
        query(
            &w,
            &scene,
            &mut memo,
            0.,
            1.,
            0.01,
            1e-6,
            true,
            &mut Work { used: 0, limit: 0 },
            &casts,
            &failures
        )
        .err(),
        Some(TrajectoryError::WorkLimit)
    );
    assert_eq!(memo_bytes(&memo), before);
    let old_pose = scene.colliders[1].motion.local_pose;
    scene.colliders[1].motion.local_pose.translation.x = f32::NAN;
    let expected = scene
        .first_hit_policy(
            &w.backend.colliders,
            &w.contact_policies,
            0.,
            1.,
            0.01,
            1e-6,
            &mut work(),
            &|_, _| true,
            &|_, _| 0.01,
        )
        .err()
        .unwrap();
    assert_eq!(
        query(
            &w,
            &scene,
            &mut memo,
            0.,
            1.,
            0.01,
            1e-6,
            true,
            &mut work(),
            &casts,
            &failures
        )
        .err(),
        Some(expected)
    );
    assert_eq!(
        memo_bytes(&memo),
        before,
        "geometry errors do not install a partial entry"
    );
    scene.colliders[1].motion.local_pose = old_pose;
    let available = Scratch::required_bytes(w.backend.colliders.len()).unwrap()
        + std::mem::size_of::<Entry>()
        - 1;
    memo.fit_for_scene(available, w.backend.colliders.len(), &mut work())
        .unwrap();
    assert!(memo.entries.is_empty() && memo.bytes().unwrap() == 0);
    query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert!(
        memo.entries.is_empty(),
        "insufficient optional cache backing keeps the original query path"
    );
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        original.encoded_bytes()
    );
}

#[test]
fn bounded_scratch_eviction_and_zero_slot_fallback_preserve_all_real_pairs() {
    let (mut w, _, _) = spheres();
    body(
        &mut w,
        BodyKind::Fixed,
        [-1.5, 1.5, 0.],
        Shape::Sphere { radius: 1. },
    );
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let scene_bytes = Scratch::required_bytes(w.backend.colliders.len()).unwrap();
    let allowed = scene_bytes + std::mem::size_of::<Entry>();
    let budget = memo
        .fit_for_scene(allowed, w.backend.colliders.len(), &mut work())
        .unwrap();
    // The only nonfixed body is stationary, so its original Constant producer
    // is admissible without an authored trajectory, just like Scene::prepare.
    scene
        .prepare(
            &w.backend.bodies,
            &w.backend.colliders,
            &[],
            &w.characters,
            0.,
            1.,
            budget,
            &mut work(),
        )
        .unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    for _ in 0..2 {
        assert!(query(
            &w,
            &scene,
            &mut memo,
            0.,
            1.,
            0.01,
            1e-6,
            true,
            &mut work(),
            &casts,
            &failures
        )
        .unwrap()
        .is_none());
        assert_eq!(memo.entries.len(), 1);
        assert!(memo.bytes().unwrap() <= std::mem::size_of::<Entry>());
    }
    assert_eq!(
        casts.get(),
        4,
        "eviction changes performance, never drops a pair"
    );
    memo.fit_for_scene(allowed - 1, w.backend.colliders.len(), &mut work())
        .unwrap();
    assert!(memo.entries.is_empty());
    assert_eq!(memo.bytes().unwrap(), 0);
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.01,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures
    )
    .unwrap()
    .is_none());
    assert_eq!(casts.get(), 6);
    assert_eq!(failures.get(), 0);
}

#[test]
fn curved_source_hit_cache_keeps_original_bracket_witness_and_physical_time_bits() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let a = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0.; 3],
        Shape::Box {
            half_extents: [2., 0.025, 0.1],
        },
    );
    let b = body(
        &mut w,
        BodyKind::KinematicPosition,
        [1.2, 1.3, 0.],
        Shape::Capsule {
            half_height: 0.25,
            radius: 0.25,
        },
    );
    let (start, safe, end) = (
        0.010243964269977602,
        0.013498650759231557,
        0.013658619026636802,
    );
    let a_curve = Kernel::from_velocity_seconds(
        native_id(a),
        Domain::new(start, end).unwrap(),
        0.0034146549,
        rp::Pose::from_parts(
            rp::Vector::ZERO,
            rp::Rotation::from_xyzw(0., 0., 0.20313798, 0.9791501),
        ),
        rp::Vector::ZERO,
        rp::Vector::Z * 40.,
    )
    .unwrap();
    let b_curve = Kernel::from_velocity(
        native_id(b),
        Domain::new(safe, end).unwrap(),
        *w.backend.bodies[native_id(b)].position(),
        -rp::Vector::X * 121.719086,
        rp::Vector::ZERO,
    )
    .unwrap();
    let tracks = [
        BodyTrajectory {
            body: native_id(a),
            curve: Curve::Integrated(a_curve),
        },
        BodyTrajectory {
            body: native_id(b),
            curve: Curve::Integrated(b_curve),
        },
    ];
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, safe, end).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    prepare(&w, &mut scene, &mut memo, &tracks, safe, end, &mut work());
    let first = query(
        &w,
        &scene,
        &mut memo,
        safe,
        end,
        0.01,
        1e-8,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert!(first.is_some());
    let repeated = query(
        &w,
        &scene,
        &mut memo,
        safe,
        end,
        0.01,
        1e-8,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert_eq!(hit_bytes(&first), hit_bytes(&repeated));
    assert_eq!(casts.get(), 1);
    assert_eq!(memo.hits, 1);
    assert_eq!(
        a_curve.native.integration_seconds.to_bits(),
        0.0034146549_f32.to_bits()
    );
}

#[test]
fn forty_independent_moving_entries_keep_all_twenty_real_stops_and_checked_full_tick_replay() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let mut movers = Vec::new();
    let create = |w: &mut PhysicsWorld3d, kind, position, shape| {
        w.create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position,
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(shape),
        )
        .unwrap()
    };
    for i in 0..20 {
        let y = i as f32 * 10.;
        let a = create(
            &mut w,
            BodyKind::KinematicPosition,
            [0., y, 0.],
            Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            },
        );
        w.enable_character(a, crate::physics3d::CharacterConfig::default())
            .unwrap();
        create(
            &mut w,
            BodyKind::Fixed,
            [-1., y, 0.],
            Shape::Box {
                half_extents: [0.25, 2., 5.],
            },
        );
        let m = create(
            &mut w,
            BodyKind::KinematicPosition,
            [3. + i as f32 * 0.1, y, 0.],
            Shape::Box {
                half_extents: [0.25, 2., 5.],
            },
        );
        w.set_kinematic_target(
            m,
            Pose {
                position: [-3., y, 0.],
                ..Default::default()
            },
        )
        .unwrap();
        movers.push((a, m));
    }
    let original = w.capture_snapshot().unwrap();
    w.step_checked().unwrap();
    assert_eq!(
        w.actual_motion_completed_time(),
        f64::from(w.config.step_seconds)
    );
    assert_eq!(w.step_statistics().kinematic_character_stops, 20);
    for (a, m) in movers {
        assert!((w.body_state(m).unwrap().pose.position[0] - 0.02).abs() < 0.02);
        assert!((w.body_state(a).unwrap().pose.position[0] + 0.49).abs() < 0.02);
        assert!(
            !w.character_state(a)
                .unwrap()
                .moving_obstacle_iteration_limit
        );
    }
    assert!(
        w.saved_motion_proof_work().used
            <= crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK
    );
    let accepted = w.capture_snapshot().unwrap();
    w.restore_snapshot(&original).unwrap();
    w.step_checked().unwrap();
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        accepted.encoded_bytes()
    );
}

#[test]
fn shortened_strict_query_preserves_the_verified_first_hit_and_its_witness() {
    let (w, _, moving) = spheres();
    let tracks = [BodyTrajectory {
        body: native_id(moving),
        curve: Curve::Integrated(kernel_for(&w, moving, -rp::Vector::X)),
    }];
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    let (margin, tolerance) = (0.01, 1e-6);
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let original = query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        margin,
        tolerance,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    let hit = original.unwrap().cast;
    assert!(0. < hit.safe_time && hit.safe_time < hit.hit_time);
    let mid = hit.safe_time * 0.5;
    let entry = memo.entries[0];
    assert!(matches!(
        memo.lookup(
            &entry.a,
            &entry.b,
            mid,
            hit.hit_time,
            margin,
            tolerance,
            true,
            &mut work()
        )
        .unwrap(),
        Lookup::Recheck(_, solver_trajectory::StrictPrefix::Hit(_))
    ));
    // A bracket cut through its interior supplies no witness for the new end.
    assert!(matches!(
        memo.lookup(
            &entry.a,
            &entry.b,
            mid,
            hit.safe_time.midpoint(hit.hit_time),
            margin,
            tolerance,
            true,
            &mut work()
        )
        .unwrap(),
        Lookup::Miss(_)
    ));
    prepare(
        &w,
        &mut scene,
        &mut memo,
        &tracks,
        mid,
        hit.hit_time,
        &mut work(),
    );
    let cropped = query(
        &w,
        &scene,
        &mut memo,
        mid,
        hit.hit_time,
        margin,
        tolerance,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert_eq!(hit_bytes(&original), hit_bytes(&cropped));
    assert_eq!((casts.get(), failures.get(), memo.hits), (2, 0, 1));
}

#[test]
fn changed_start_rechecks_original_strict_leaf_before_reusing_a_clear_prefix() {
    let (w, _, b) = spheres();
    let source = kernel_for(&w, b, rp::Vector::X * 0.1);
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(source),
    }];
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let original = w.capture_snapshot().unwrap();
    let mut full = work();
    assert!(
        query(&w, &scene, &mut memo, 0., 1., 0.01, 1e-6, true, &mut full, &casts, &failures)
            .unwrap()
            .is_none()
    );
    assert_eq!(memo.entries.len(), 1);
    assert!(!pose(
        source.position_at_time(0.),
        source.position_at_time(0.25)
    ));
    let original_entry = memo_bytes(&memo);
    prepare(&w, &mut scene, &mut memo, &tracks, 0.25, 0.75, &mut work());
    let mut narrow = work();
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.25,
        0.75,
        0.01,
        1e-6,
        true,
        &mut narrow,
        &casts,
        &failures
    )
    .unwrap()
    .is_none());
    assert_eq!(
        casts.get(),
        2,
        "the new-start leaf executes in the original cast"
    );
    assert_eq!(memo.hits, 1);
    assert_eq!(failures.get(), 0);
    assert!(
        narrow.used < full.used,
        "no interval certificate is repeated"
    );
    assert_eq!(
        memo_bytes(&memo),
        original_entry,
        "retain the wider certificate"
    );
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        original.encoded_bytes()
    );
}

#[test]
fn stationary_rebased_native_clocks_reuse_complete_geometry_without_hiding_interior_changes() {
    let (w, _, b) = spheres();
    let original = kernel_for(&w, b, rp::Vector::ZERO);
    let rebased = Kernel::from_velocity_seconds(
        native_id(b),
        Domain::new(0.25, 1.).unwrap(),
        0.375,
        original.native.motion.start,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    assert_ne!(
        original.domain.start.to_bits(),
        rebased.domain.start.to_bits()
    );
    assert_ne!(
        original.native.integration_seconds.to_bits(),
        rebased.native.integration_seconds.to_bits()
    );
    let snapshot = w.capture_snapshot().unwrap();
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    let mut tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(original),
    }];
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.05,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .is_none());
    assert_eq!(casts.get(), 1);
    tracks[0].curve = Curve::Integrated(rebased);
    prepare(&w, &mut scene, &mut memo, &tracks, 0.25, 1., &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.25,
        1.,
        0.05,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .is_none());
    assert_eq!(
        casts.get(),
        1,
        "a different zero-rate clock must reuse the proved geometry"
    );
    assert_eq!(failures.get(), 0);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );

    // Equal stored endpoints cannot certify a nonzero-rate interior.
    for angular in [false, true] {
        let mut changed = rebased;
        if angular {
            changed.native.angular_velocity.y = 1e-6;
        } else {
            changed.native.linear_velocity.x = f32::from_bits(1);
        }
        assert!(!curve(
            Curve::Integrated(original),
            Curve::Integrated(changed)
        ));
    }
    let mut signed_zero = rebased;
    signed_zero.native.motion.start.translation.z = -0.;
    signed_zero.native.motion.end.translation.z = -0.;
    assert!(constant_pose(Curve::Integrated(signed_zero)).is_none());
    let mut renormalizes = rebased;
    renormalizes.native.motion.start.rotation = rp::Rotation::from_xyzw(0., 0., 0., 1.0000001);
    renormalizes.native.motion.end = renormalizes.native.motion.start;
    assert!(constant_pose(Curve::Integrated(renormalizes)).is_none());

    // With no represented positive interior dt, only the two original stored
    // branches exist. The endpoint distinction is still checked independently.
    let mut smallest = signed_zero;
    smallest.native.integration_seconds = f32::from_bits(1);
    assert!(constant_pose(Curve::Integrated(smallest)).is_some());
    smallest.native.motion.end.translation.z = 0.;
    assert!(constant_pose(Curve::Integrated(smallest)).is_none());
}

#[test]
fn unchanged_existing_contact_initial_inputs_reuse_only_the_complete_covered_prefix() {
    let (w, _, b) = spheres();
    let original = kernel_for(&w, b, rp::Vector::ZERO);
    let rebased = Kernel::from_velocity_seconds(
        native_id(b),
        Domain::new(0.25, 1.).unwrap(),
        0.375,
        original.native.motion.start,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let snapshot = w.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    let mut tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(original),
    }];
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        0.2,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .is_none());
    assert_eq!(casts.get(), 1);
    assert!(
        memo.entries
            .iter()
            .any(|e| e.hit.is_none() && e.strict_start.is_none()),
        "exercise an original non-strict initial contact band"
    );
    tracks[0].curve = Curve::Integrated(rebased);
    prepare(&w, &mut scene, &mut memo, &tracks, 0.25, 0.75, &mut work());
    let cached = query(
        &w,
        &scene,
        &mut memo,
        0.25,
        0.75,
        0.2,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap();
    assert!(cached.is_none());
    assert_eq!(
        casts.get(),
        1,
        "same initial band and complete subset need no new cast"
    );
    let mut fresh = PairQueries::new(&w.backend.colliders, &w.contact_policies, 0., 1.).unwrap();
    prepare(&w, &mut scene, &mut fresh, &tracks, 0.25, 0.75, &mut work());
    let cold = query(
        &w,
        &scene,
        &mut fresh,
        0.25,
        0.75,
        0.2,
        1e-6,
        true,
        &mut work(),
        &Cell::new(0),
        &failures,
    )
    .unwrap();
    assert_eq!(hit_bytes(&cached), hit_bytes(&cold));

    // Same safe pose with inward input is an original full query, never an
    // inherited existing-contact exemption or an unsupported clear result.
    tracks[0].curve = Curve::Integrated(
        Kernel::from_velocity_seconds(
            native_id(b),
            Domain::new(0.25, 1.).unwrap(),
            0.375,
            original.native.motion.start,
            -rp::Vector::X,
            rp::Vector::ZERO,
        )
        .unwrap(),
    );
    prepare(&w, &mut scene, &mut memo, &tracks, 0.25, 0.75, &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.25,
        0.75,
        0.2,
        1e-6,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .is_some());
    assert_eq!(casts.get(), 2);
    assert_eq!(failures.get(), 0);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes().to_vec(),
        snapshot
    );
}

#[test]
fn existing_response_proof_reuses_only_matching_policy_and_initial_inputs() {
    let (w, _, moving) = spheres();
    let colliders = &w.backend.colliders;
    let mut scene = Scratch::default();
    let mut memo = PairQueries::new(colliders, &w.contact_policies, 0., 1.).unwrap();
    let (casts, failures) = (Cell::new(0), Cell::new(0));
    let (clearance, tolerance) = (0.2, 1e-6);
    let mut tracks = [BodyTrajectory {
        body: native_id(moving),
        curve: Curve::Integrated(kernel_for(&w, moving, -rp::Vector::X)),
    }];
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        clearance,
        tolerance,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .is_some());

    tracks[0].curve = Curve::Integrated(kernel_for(&w, moving, rp::Vector::ZERO));
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    let [a, b] = scene.colliders[..] else {
        panic!("expected one pair");
    };
    let coverage = solver_trajectory::cast_full_shapes_policy_coverage(
        a.motion,
        colliders[a.collider].shape(),
        b.motion,
        colliders[b.collider].shape(),
        0.,
        1.,
        clearance,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap();
    assert!(coverage.hit.is_none() && !coverage.strictly_clear_start && !coverage.reused);
    memo.remember_existing_proposal(
        colliders,
        a,
        b,
        0.,
        1.,
        clearance,
        tolerance,
        coverage,
        &mut work(),
    )
    .unwrap();
    assert!(matches!(
        memo.lookup(&a, &b, 0.25, 0.75, clearance, tolerance, true, &mut work())
            .unwrap(),
        Lookup::Reuse(None)
    ));
    for (clearance, tolerance, policy) in [
        (clearance.next_up(), tolerance, true),
        (clearance, tolerance.next_up(), true),
        (clearance, tolerance, false),
    ] {
        assert!(matches!(
            memo.lookup(
                &a,
                &b,
                0.25,
                0.75,
                clearance,
                tolerance,
                policy,
                &mut work()
            )
            .unwrap(),
            Lookup::Miss(_)
        ));
    }
    tracks[0].curve = Curve::Integrated(kernel_for(&w, moving, -rp::Vector::X));
    prepare(&w, &mut scene, &mut memo, &tracks, 0., 1., &mut work());
    assert!(query(
        &w,
        &scene,
        &mut memo,
        0.,
        1.,
        clearance,
        tolerance,
        true,
        &mut work(),
        &casts,
        &failures,
    )
    .unwrap()
    .is_some());
    assert_eq!(casts.get(), 2);
    assert_eq!(failures.get(), 0);
}
