use super::*;

const SAFE: Time = 3.303401058474264e-6;
const SKIN: f32 = 0.01;
const TOLERANCE: Time = 2.5e-8;
struct Pair {
    a: ShapeMotion,
    b: ShapeMotion,
    sa: rp::SharedShape,
    sb: rp::SharedShape,
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn recorded() -> Pair {
    // c46 actual elevator, raw lines922-931. Native local rounded radius and
    // world core+radius have different F32 graphs at the very same safe pose.
    let h = 0.004166667_f32;
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., f64::from(h)).unwrap(),
        h,
        rp::Pose::from_translation(rp::Vector::Y * -0.03333334),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    Pair {
        a: motion(Curve::Integrated(carrier)),
        b: motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::Y * 1.01,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        }),
        sa: rp::SharedShape::cuboid(3., 0.1, 3.),
        sb: rp::SharedShape::capsule_y(0.5, 0.4),
    }
}
fn call(
    pair: &Pair,
    start: Time,
    end: Time,
    allow: bool,
    old: bool,
    work: &mut Work,
) -> (Result<Option<CastHit>, TrajectoryError>, Option<bool>) {
    let mut initial = None;
    let result = if old {
        cast_policy_impl(
            pair.a,
            pair.sa.as_ref(),
            pair.b,
            pair.sb.as_ref(),
            start,
            end,
            SKIN,
            TOLERANCE,
            work,
            allow,
            &mut initial,
            None,
            None,
        )
    } else {
        cast_policy_observed(
            pair.a,
            pair.sa.as_ref(),
            pair.b,
            pair.sb.as_ref(),
            start,
            end,
            SKIN,
            TOLERANCE,
            work,
            allow,
            &mut initial,
            None,
        )
    };
    (result, initial)
}
fn same_hit(actual: Option<CastHit>, expected: Option<CastHit>) {
    match (actual, expected) {
        (None, None) => {}
        (Some(a), Some(b)) => {
            assert_eq!(a.safe_time.to_bits(), b.safe_time.to_bits());
            assert_eq!(a.hit_time.to_bits(), b.hit_time.to_bits());
            assert_eq!(a.contact.dist.to_bits(), b.contact.dist.to_bits());
            for (a, b) in [
                (a.contact.point1, b.contact.point1),
                (a.contact.point2, b.contact.point2),
                (a.contact.normal1, b.contact.normal1),
                (a.contact.normal2, b.contact.normal2),
            ] {
                assert_eq!(
                    a.to_array().map(f32::to_bits),
                    b.to_array().map(f32::to_bits)
                );
            }
            assert_eq!((a.subshape_a, a.subshape_b), (b.subshape_a, b.subshape_b));
        }
        (a, b) => panic!("different original hit: {a:?} / {b:?}"),
    }
}
fn margin(pair: &Pair, start: Time) -> (f32, f32) {
    allowance(
        pair.a,
        pair.sa.as_ref(),
        pair.b,
        pair.sb.as_ref(),
        start,
        SKIN,
        &mut work(),
    )
    .unwrap()
    .expect("positive same-cell Native/full-shape ambiguity")
}

#[test]
fn recorded_native_clear_elevator_uses_only_its_measured_positive_cell_band_and_full_future() {
    let p = recorded();
    let end = p.a.curve.times().1;
    let before = postcard::to_allocvec(&(p.a, p.b)).unwrap();
    let left = leaf_contact(
        &p.a.pose(SAFE),
        p.sa.as_ref(),
        &p.b.pose(SAFE),
        p.sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(p.b.pose(SAFE).translation.y.to_bits(), 0x3f7a0742);
    assert_eq!(left.dist.to_bits(), 0.010000005_f32.to_bits());
    assert!(left.dist > SKIN);
    let (geometry, stability) = margin(&p, SAFE);
    assert!(geometry > 0. && geometry <= SKIN);
    assert!(stability >= 0. && stability <= geometry);
    assert!(same_cell_margin(left.dist, geometry, stability, SKIN));
    assert!(
        f64::from(left.dist) - f64::from(geometry) <= f64::from(geometry) - f64::from(stability)
    );
    assert_eq!(
        (p.b.point_velocity(SAFE, left.point2) - p.a.point_velocity(SAFE, left.point1))
            .dot(left.normal1),
        0.
    );
    let (original, original_clear) = call(&p, SAFE, end, true, true, &mut work());
    assert!(original.unwrap().is_some());
    assert_eq!(original_clear, Some(true));
    let (replayed, replayed_clear) = call(&p, SAFE, end, true, false, &mut work());
    assert!(replayed.unwrap().is_none());
    assert_eq!(replayed_clear, Some(false));
    assert!(p
        .a
        .separated(
            p.sa.as_ref(),
            p.b,
            p.sb.as_ref(),
            left.normal1,
            SAFE,
            end,
            stability,
            &mut work()
        )
        .unwrap());
    assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), before);
}

#[test]
fn a_lowered_margin_no_hit_never_becomes_a_strict_prefix_memo() {
    let p = recorded();
    let end = p.a.curve.times().1;
    let coverage = cast_full_shapes_policy_coverage(
        p.a,
        p.sa.as_ref(),
        p.b,
        p.sb.as_ref(),
        SAFE,
        end,
        SKIN,
        TOLERANCE,
        &mut work(),
        true,
    )
    .unwrap();
    assert!(coverage.hit.is_none());
    assert!(!coverage.strictly_clear_start);
    assert!(!coverage.reused);
    // A vertical gap outside skin is a gross AABB NoHit. No leaf was
    // observed, so the original owner does not qualify a strict prefix.
    let skipped = controls(0.92, 0.);
    let outside = cast_full_shapes_policy_coverage(
        skipped.a,
        skipped.sa.as_ref(),
        skipped.b,
        skipped.sb.as_ref(),
        0.,
        0.025,
        SKIN,
        TOLERANCE,
        &mut work(),
        true,
    )
    .unwrap();
    assert!(outside.hit.is_none());
    assert!(!outside.strictly_clear_start && !outside.reused);
    // Keep both original shapes. At this box corner the AABBs overlap but
    // the closest capsule core has offset (.3, .32), length > radius+skin.
    // The actual leaf must be visited before its strict predicate can qualify.
    let clear = Pair {
        b: motion(Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(3.3, 0.82, 0.)),
            start_time: 0.,
            end_time: 0.025,
        }),
        ..skipped
    };
    let source = postcard::to_allocvec(&(clear.a, clear.b)).unwrap();
    let mut budget = work();
    use rapier3d::parry::bounding_volume::BoundingVolume;
    let floor_bounds = clear
        .a
        .bounds(clear.sa.as_ref(), 0., 0.025, &mut budget)
        .unwrap()
        .loosened(SKIN);
    let capsule_bounds = clear
        .b
        .bounds(clear.sb.as_ref(), 0., 0.025, &mut budget)
        .unwrap();
    assert!(floor_bounds.intersects(&capsule_bounds));
    let initial = leaf_contact(
        &clear.a.pose(0.),
        clear.sa.as_ref(),
        &clear.b.pose(0.),
        clear.sb.as_ref(),
        &mut budget,
    )
    .unwrap();
    assert!(initial.dist > SKIN);
    let original = cast_full_shapes_policy_coverage(
        clear.a,
        clear.sa.as_ref(),
        clear.b,
        clear.sb.as_ref(),
        0.,
        0.025,
        SKIN,
        TOLERANCE,
        &mut work(),
        true,
    )
    .unwrap();
    assert!(original.hit.is_none() && original.strictly_clear_start && !original.reused);
    let reused = cast_full_shapes_policy_reusing(
        clear.a,
        clear.sa.as_ref(),
        clear.b,
        clear.sb.as_ref(),
        0.,
        0.025,
        SKIN,
        TOLERANCE,
        &mut work(),
        true,
        Some(StrictPrefix::Clear),
    )
    .unwrap();
    assert!(reused.hit.is_none() && reused.strictly_clear_start && reused.reused);
    assert_eq!(postcard::to_allocvec(&(clear.a, clear.b)).unwrap(), source);
}

#[test]
fn shared_face_band_requires_nonclosing_motion_on_its_original_carrier() {
    let h = 0.025_f32;
    let end = f64::from(h);
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., end).unwrap(),
        h,
        rp::Pose::from_translation(rp::Vector::Y * 0.39),
        rp::Vector::Y * 2.0000005,
        rp::Vector::ZERO,
    )
    .unwrap();
    let floor = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let driver = motion(Curve::Integrated(carrier));
    let rider = |relative| {
        motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::Y * 0.6100001,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::Y * relative,
            rotation: rp::Rotation::IDENTITY,
        })
    };
    let left = leaf_contact(
        &driver.pose(0.),
        floor.as_ref(),
        &rider(0.).pose(0.),
        capsule.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(left.dist > SKIN);
    for (relative, expected) in [(0., true), (-0.00057429075, false)] {
        assert_eq!(
            shared_face_stable(
                driver,
                floor.as_ref(),
                rider(relative),
                capsule.as_ref(),
                left,
                0.,
                end,
                SKIN,
                TOLERANCE,
                &mut work(),
            )
            .unwrap(),
            expected
        );
    }
    let coverage = cast_full_shapes_policy_coverage(
        driver,
        floor.as_ref(),
        rider(0.),
        capsule.as_ref(),
        0.,
        end,
        SKIN,
        TOLERANCE,
        &mut work(),
        true,
    )
    .unwrap();
    assert!(coverage.hit.is_none() && !coverage.strictly_clear_start);
}
fn controls(y: f32, rate: f32) -> Pair {
    Pair {
        a: motion(Curve::Constant {
            pose: rp::Pose::from_translation(-rp::Vector::Y * 0.1),
            start_time: 0.,
            end_time: 0.025,
        }),
        b: motion(Curve::Integrated(
            Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::from_raw_parts(1, 0),
                Domain::new(0., 0.025).unwrap(),
                0.025,
                rp::Pose::from_translation(rp::Vector::Y * y),
                rp::Vector::Y * rate,
                rp::Vector::ZERO,
            )
            .unwrap(),
        )),
        sa: rp::SharedShape::cuboid(3., 0.1, 3.),
        sb: rp::SharedShape::capsule_y(0.5, 0.4),
    }
}

#[test]
fn strict_inward_overlap_and_genuinely_clear_graphs_keep_the_original_hit_policy() {
    let p = recorded();
    let end = p.a.curve.times().1;
    let mut old_work = work();
    let mut new_work = work();
    let (old, old_initial) = call(&p, SAFE, end, false, true, &mut old_work);
    let (new, new_initial) = call(&p, SAFE, end, false, false, &mut new_work);
    same_hit(new.unwrap(), old.unwrap());
    assert_eq!(new_initial, old_initial);
    assert_eq!(new_work.used, old_work.used); // Strict casts execute no added query.
    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        rotation,
        ..
    } = p.b.curve
    else {
        unreachable!()
    };
    let inward = Pair {
        b: motion(Curve::Anchored {
            carrier,
            anchor,
            offset,
            rotation,
            linear_velocity: -rp::Vector::Y * 0.001,
        }),
        ..p
    };
    assert_eq!(inward.b.pose(SAFE).translation.y.to_bits(), 0x3f7a0742);
    assert!(allowance(
        inward.a,
        inward.sa.as_ref(),
        inward.b,
        inward.sb.as_ref(),
        SAFE,
        SKIN,
        &mut work()
    )
    .unwrap()
    .is_none());
    let (old, old_initial) = call(&inward, SAFE, end, true, true, &mut work());
    let (new, new_initial) = call(&inward, SAFE, end, true, false, &mut work());
    same_hit(new.unwrap(), old.unwrap());
    assert_eq!(new_initial, old_initial);
    for (y, rate) in [(0.89, 0.), (0.905, -0.1), (0.92, -1.), (0.92, 0.)] {
        let p = controls(y, rate);
        let mut old_work = work();
        let mut new_work = work();
        let (old, old_initial) = call(&p, 0., 0.025, true, true, &mut old_work);
        let (new, new_initial) = call(&p, 0., 0.025, true, false, &mut new_work);
        same_hit(new.unwrap(), old.unwrap());
        assert_eq!(new_initial, old_initial);
        if y < 0.91 || rate == 0. {
            assert_eq!(new_work.used, old_work.used);
        }
    }
    // A small lower bound by itself is insufficient, including a finite loose
    // support enclosure far from a genuinely-clear Native witness.
    assert!(!same_cell_margin(0.02, 0.009, 0.0089999, SKIN));
    assert!(!same_cell_margin(f32::MAX, f32::MIN_POSITIVE, 0., SKIN));
    assert!(!same_cell_margin(
        0.010000005,
        0.009999976,
        0.009999975,
        SKIN
    ));
    assert!(!same_cell_margin(0.010000005, -0.001, -0.002, SKIN));
    assert!(!same_cell_margin(f32::NAN, 0.009, 0.008, SKIN));
}

#[test]
fn a_same_cell_start_still_reports_a_later_real_rotating_surface_approach() {
    let recorded = recorded();
    let h = 0.025;
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., f64::from(h)).unwrap(),
        h,
        recorded.a.curve.com_pose(SAFE),
        rp::Vector::Y * 2.,
        rp::Vector::Z * 2.,
    )
    .unwrap();
    let p = Pair {
        a: motion(Curve::Integrated(carrier)),
        b: motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::ZERO,
            offset: rp::Vector::Y * 1.01,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        }),
        ..recorded
    };
    let (geometry, stability) = margin(&p, 0.);
    let (result, initial) = call(&p, 0., f64::from(h), true, false, &mut work());
    let hit = result
        .unwrap()
        .expect("real inward rotation must not become NoHit");
    assert_eq!(initial, Some(false));
    assert!(hit.safe_time > 0. && hit.hit_time > hit.safe_time && hit.hit_time < f64::from(h));
    assert!(hit.hit_time - hit.safe_time <= TOLERANCE);
    assert!(hit.contact.dist <= stability && stability <= geometry);
    let native = leaf_contact(
        &p.a.pose(hit.hit_time),
        p.sa.as_ref(),
        &p.b.pose(hit.hit_time),
        p.sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    if native.dist <= stability {
        assert_eq!(hit.contact, native);
    } else {
        // The original rounded box face can approach the real capsule cap
        // before the native leaf projection reports the same distance.
        let capsule = p.sb.as_capsule().unwrap();
        let core = p.b.pose(hit.hit_time) * capsule.segment.a;
        let distance_squared_upper = |a: rp::Vector, b: rp::Vector| {
            (0..3).fold(0_f64, |sum, i| {
                let delta = (f64::from(a[i]) - f64::from(b[i])).abs().next_up();
                (sum + (delta * delta).next_up()).next_up()
            })
        };
        let radius = f64::from(capsule.radius);
        assert!(
            (distance_squared_upper(hit.contact.point1, core)
                .sqrt()
                .next_up()
                - radius)
                .next_up()
                < f64::from(stability)
        );
        assert!(distance_squared_upper(hit.contact.point2, core) <= radius * radius);
    }
}

#[test]
fn exact_shared_work_and_one_below_preserve_source_bytes_without_free_retry() {
    let p = recorded();
    let end = p.a.curve.times().1;
    let before = postcard::to_allocvec(&(p.a, p.b)).unwrap();
    let mut full = work();
    let (result, initial) = call(&p, SAFE, end, true, false, &mut full);
    assert!(result.unwrap().is_none());
    assert_eq!(initial, Some(false));
    let mut original = work();
    assert!(call(&p, SAFE, end, true, true, &mut original)
        .0
        .unwrap()
        .is_some());
    assert!(full.used > original.used);
    let mut exact = Work {
        used: 31,
        limit: 31 + full.used,
    };
    let (result, initial) = call(&p, SAFE, end, true, false, &mut exact);
    assert!(result.unwrap().is_none());
    assert_eq!(initial, Some(false));
    assert_eq!(exact.used, 31 + full.used);
    for available in [original.used, full.used - 1] {
        let mut limited = Work {
            used: 31,
            limit: 31 + available,
        };
        let result = call(&p, SAFE, end, true, false, &mut limited).0;
        assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        assert!(limited.used >= 31 && limited.used <= limited.limit);
        assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), before);
    }
    assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), before);
}
