use super::*;
use crate::physics3d::solver_trajectory::{
    cast, cast_policy_impl, certified_separation, contacts_full_shapes,
    contacts_full_shapes_measured, contacts_full_shapes_with_manifold, leaf_contact, Curve, Domain,
    Kernel,
};

const SKIN: f32 = 0.01;
const START: Time = 0.004166689235716169;
const END: Time = 0.004199241146124251;
const MID: Time = 0.0041829651909202105;
const TOL: Time = 4.1666670114182125e-9;

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn constant(pose: rp::Pose) -> ShapeMotion {
    motion(Curve::Constant {
        pose,
        start_time: 0.,
        end_time: 1.,
    })
}
fn recorded_down() -> (ShapeMotion, rp::SharedShape, ShapeMotion, rp::SharedShape) {
    // C57 original rejected joint candidate, raw933. Preserve its actual
    // physical h, logical origin, Native labels and original scalar grouping.
    let h = 0.004166667_f32;
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0.004166666883975267, 0.008333333767950535).unwrap(),
        h,
        rp::Pose::from_translation(rp::Vector::Y * 0.35833335),
        rp::Vector::Y * -2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    carrier.native.motion.start_time = h;
    carrier.native.motion.end_time = h + h;
    (
        motion(Curve::Integrated(carrier)),
        rp::SharedShape::cuboid(3., 0.1, 3.),
        motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::Y * 1.0016665,
            offset: rp::Vector::Y * 0.008333445,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        }),
        rp::SharedShape::capsule_y(0.5, 0.4),
    )
}
fn bits(contact: Contact) -> Vec<u32> {
    [
        contact.point1,
        contact.point2,
        contact.normal1,
        contact.normal2,
    ]
    .into_iter()
    .flat_map(|v| v.to_array().map(f32::to_bits))
    .chain([contact.dist.to_bits(), contact.subshape1, contact.subshape2])
    .collect()
}

#[test]
fn original_down_midpoint_has_a_real_radius_witness_in_both_operand_orders() {
    let (a, sa, b, sb) = recorded_down();
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    let pa = a.pose(MID);
    let pb = b.pose(MID);
    assert_eq!(pa.translation.y.to_bits(), 0x3eb77332);
    assert_eq!(pb.translation.y.to_bits(), 0x3faf247a);
    // Do not reassociate pose*point with a subsequent scalar multiplication.
    let point = pa * (rp::Vector::Y * 0.1);
    let core = pb * (rp::Vector::Y * -0.5);
    assert_eq!(point.y.to_bits(), 0x3eeaa665);
    assert_eq!(core.y.to_bits(), 0x3f5e48f4);
    assert!((distance_upper(point, core) - f64::from(0.4_f32)).next_up() < f64::from(SKIN));
    let native = leaf_contact(&pa, sa.as_ref(), &pb, sb.as_ref(), &mut work()).unwrap();
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let hit = pair.poses(&pa, &pb, SKIN, &mut work()).unwrap().unwrap();
    assert!(hit.strict && hit.contact.dist < SKIN);
    assert_eq!(hit.contact.point1, point);
    assert_eq!(hit.contact.normal1, rp::Vector::Y);
    assert!(distance_upper(hit.contact.point2, core) <= f64::from(0.4_f32));
    let reverse = Pair::new(sb.as_ref(), sa.as_ref(), &mut work())
        .unwrap()
        .unwrap()
        .poses(&pb, &pa, SKIN, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(bits(reverse.contact), bits(hit.contact.flipped()));
    // The public plain Native query remains bit-for-bit its own observation.
    assert_eq!(
        bits(native),
        bits(leaf_contact(&pa, sa.as_ref(), &pb, sb.as_ref(), &mut work()).unwrap())
    );
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

#[test]
fn interior_positive_cue_keeps_the_original_earliest_prefix_and_time_tolerance() {
    let (a, sa, b, sb) = recorded_down();
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    assert!(pair.at(a, b, START, SKIN, &mut work()).unwrap().is_none());
    assert!(pair.at(a, b, END, SKIN, &mut work()).unwrap().is_none());
    assert!(
        pair.at(a, b, MID, SKIN, &mut work())
            .unwrap()
            .unwrap()
            .strict
    );
    let mut initial = None;
    let mut charged = work();
    let hit = cast_policy_impl(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        START,
        END,
        SKIN,
        TOL,
        &mut charged,
        true,
        &mut initial,
        None,
        None,
    )
    .unwrap()
    .unwrap();
    assert_eq!(initial, Some(true));
    assert!(START < hit.safe_time && hit.safe_time < hit.hit_time);
    assert!(hit.hit_time <= MID && hit.hit_time - hit.safe_time <= TOL);
    assert!(hit.contact.dist <= SKIN);
    assert!(certified_separation(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        rp::Vector::Y,
        START,
        hit.safe_time,
        SKIN,
        &mut work()
    )
    .unwrap());
    let native = leaf_contact(
        &a.pose(hit.hit_time),
        sa.as_ref(),
        &b.pose(hit.hit_time),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(
        native.dist <= SKIN
            || pair
                .at(a, b, hit.hit_time, SKIN, &mut work())
                .unwrap()
                .is_some()
    );
    assert!(charged.used < charged.limit);
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
}

#[test]
fn selected_start_contact_reaches_both_response_censuses_without_rewriting_native() {
    // Independent original recorded-stair collider pose, not an inverse pose
    // substituted for the original scalar Box graph.
    let sa = rp::SharedShape::cuboid(0.5, 0.1, 2.);
    let sb = rp::SharedShape::capsule_y(0.5, 0.4);
    let a = constant(rp::Pose::from_translation(rp::Vector::new(1.5, 0.1, 0.)));
    let b = constant(rp::Pose::from_translation(rp::Vector::new(
        0.65435594,
        0.9205225,
        -3.079389e-6,
    )));
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let native = leaf_contact(
        &a.pose(0.),
        sa.as_ref(),
        &b.pose(0.),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(native.dist.to_bits(), 0.010000011_f32.to_bits());
    let witness = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap()
        .at(a, b, 0., SKIN, &mut work())
        .unwrap()
        .unwrap();
    assert!(witness.strict);
    let hit = cast(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        0.,
        0.,
        SKIN,
        TOL,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!((hit.safe_time, hit.hit_time), (0., 0.));
    assert_eq!(bits(hit.contact), bits(witness.contact));
    for with_manifold in [false, true] {
        let mut storage = rapier3d::parry::query::ContactManifold::<(), ()>::new();
        let mut manifold = with_manifold.then_some(&mut storage);
        let mut contacts = Vec::new();
        contacts_full_shapes_with_manifold(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            0.,
            SKIN,
            &mut work(),
            &mut manifold,
            &mut |c, ia, ib, _| {
                assert!(c.dist <= SKIN && c.point1.is_finite() && c.point2.is_finite());
                assert_eq!((c.subshape1, c.subshape2), (ia, ib));
                contacts.push(c);
                Ok(())
            },
        )
        .unwrap();
        assert!(
            !contacts.is_empty(),
            "both real response consumers must observe the same contact"
        );
    }
    // representable::gap enumerates with bounding-sphere distance, while the
    // actual pair skin stays narrow. Native is inside the broad radius but
    // outside skin; a second full Native query is neither needed nor allowed.
    for reversed in [false, true] {
        let (a, sa, b, sb) = if reversed {
            (b, sb.as_ref(), a, sa.as_ref())
        } else {
            (a, sa.as_ref(), b, sb.as_ref())
        };
        let broad = 4.;
        assert!(native.dist > SKIN && native.dist < broad);
        let mut legacy = work();
        let mut old_gap = f32::INFINITY;
        contacts_full_shapes(a, sa, b, sb, 0., broad, &mut legacy, &mut |c, _, _, _| {
            old_gap = old_gap.min(c.dist);
            Ok(())
        })
        .unwrap();
        assert_eq!(old_gap, native.dist, "the existing broad API is unchanged");
        let mut measured = work();
        let mut gap = f32::INFINITY;
        contacts_full_shapes_measured(
            a,
            sa,
            b,
            sb,
            0.,
            broad,
            SKIN,
            &mut measured,
            &mut |c, _, _, _| {
                gap = gap.min(c.dist);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(gap, witness.contact.dist);
        assert!(gap < SKIN);
        let mut supplement = work();
        Pair::new(sa, sb, &mut supplement)
            .unwrap()
            .unwrap()
            .poses(&a.pose(0.), &b.pose(0.), SKIN, &mut supplement)
            .unwrap()
            .unwrap();
        assert_eq!(
            measured.used,
            legacy.used + supplement.used + 1,
            "one original Native census plus the admitted supplemental point"
        );
        let mut short = Work {
            used: 0,
            limit: measured.used - 1,
        };
        let mut emitted = false;
        assert_eq!(
            contacts_full_shapes_measured(
                a,
                sa,
                b,
                sb,
                0.,
                broad,
                SKIN,
                &mut short,
                &mut |_, _, _, _| {
                    emitted = true;
                    Ok(())
                }
            ),
            Err(TrajectoryError::WorkLimit)
        );
        assert!(
            !emitted,
            "the denied supplemental observation publishes no row"
        );
        let mut inside = work();
        let mut gap = f32::INFINITY;
        contacts_full_shapes_measured(
            a,
            sa,
            b,
            sb,
            0.,
            broad,
            native.dist,
            &mut inside,
            &mut |c, _, _, _| {
                gap = gap.min(c.dist);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(
            gap, native.dist,
            "an actually-inside Native contact remains first"
        );
        assert_eq!(inside.used, legacy.used + 1);
    }
    assert_eq!(
        bits(native),
        bits(
            leaf_contact(
                &a.pose(0.),
                sa.as_ref(),
                &b.pose(0.),
                sb.as_ref(),
                &mut work()
            )
            .unwrap()
        )
    );
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
}

#[test]
fn c49_requested_skin_does_not_replace_the_smaller_original_selected_margin() {
    let h = 0.025_f32;
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., f64::from(h)).unwrap(),
        h,
        rp::Pose::from_translation(rp::Vector::Y * -0.033326734),
        rp::Vector::Y * 2.,
        rp::Vector::Z * 2.,
    )
    .unwrap();
    let a = motion(Curve::Integrated(carrier));
    let b = motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::ZERO,
        offset: rp::Vector::Y * 1.01,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    });
    let sa = rp::SharedShape::cuboid(3., 0.1, 3.);
    let sb = rp::SharedShape::capsule_y(0.5, 0.4);
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let time = 4.834942591711022e-5;
    assert!(pair
        .at(a, b, time, 0.009999943, &mut work())
        .unwrap()
        .is_none());
    // A concrete original local point remains outside selected but inside
    // requested skin. A rotated normal cone is deliberately not certified by
    // this optional Contact helper; the original C49 cast is unchanged.
    let point = a.pose(time) * rp::Vector::new(0.00003852466, 0.1, 0.);
    let core = b.pose(time) * (rp::Vector::Y * -0.5);
    let upper = gap_upper(distance_upper(point, core), 0.4);
    assert!(upper > f64::from(0.009999943_f32) && upper < f64::from(SKIN));
    assert!(pair.at(a, b, time, SKIN, &mut work()).unwrap().is_none());
    let far = constant(rp::Pose::from_translation(rp::Vector::Y * 5.));
    assert!(pair.at(a, far, time, SKIN, &mut work()).unwrap().is_none());
}

#[test]
fn nonunit_pose_real_radius_erasure_zero_and_ineligible_inputs_keep_their_authority() {
    let sa = rp::SharedShape::cuboid(1., 1., 1.);
    let sb = rp::SharedShape::capsule_y(0.25, 0.5);
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let pa = rp::Pose::from_parts(rp::Vector::ZERO, rp::Rotation::from_xyzw(0., 0., 0., 2.));
    let pb = rp::Pose::from_translation(rp::Vector::Y * 4.75);
    let witness = pair.poses(&pa, &pb, 0., &mut work()).unwrap().unwrap();
    assert!(witness.contact.dist <= 0.);
    assert_eq!(witness.contact.point1.y, 4.);
    assert!(pair.poses(&pa, &pb, -0.01, &mut work()).unwrap().is_none());
    // B59 source counter: conjugate nomination finds a valid +corner
    // point but C-P points inward. Existence alone cannot publish its normal.
    let q = rp::Rotation::from_xyzw(0., 0., 0., 1_f32.next_up());
    let pa = rp::Pose::from_parts(rp::Vector::ZERO, q);
    let pb = rp::Pose::from_translation(rp::Vector::new(1_f32.next_up(), 1_f32.next_up(), 0.));
    let box_shape = rp::SharedShape::cuboid(1., 1., 2_f32.powi(-10));
    let cap_shape = rp::SharedShape::capsule_y(0., 2_f32.powi(-24));
    let check = Pair::new(box_shape.as_ref(), cap_shape.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let original_point = pa * rp::Vector::new(1., 1., 0.);
    assert!(
        gap_upper(
            distance_upper(original_point, pb.translation),
            2_f32.powi(-24)
        ) < f64::from(1.2e-7_f32)
    );
    assert!(check
        .poses(&pa, &pb, 1.2e-7, &mut work())
        .unwrap()
        .is_none());
    // Free-axis RN roundtrip must not become a tangential response component.
    let pb = rp::Pose::from_translation(rp::Vector::new(0.25, 1.5, 0.));
    assert!(pair.poses(&pa, &pb, 1e-5, &mut work()).unwrap().is_none());
    // The upper endpoint is in range but is not the capsule's -n support.
    // It is skipped; the second original endpoint supplies the actual row.
    let cap_shape = rp::SharedShape::capsule(rp::Vector::Y * 0.25, rp::Vector::Y * -0.25, 0.25);
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let check = Pair::new(box_shape.as_ref(), cap_shape.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let pb = rp::Pose::from_translation(rp::Vector::Y * 1.5);
    let actual = check
        .poses(&rp::Pose::IDENTITY, &pb, 1.1, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(actual.contact.point2.y, 1.);
    assert_eq!(actual.contact.dist, 0.5);
    let pa = rp::Pose::from_translation(rp::Vector::Y * 8191.5);
    let pb = rp::Pose::from_translation(rp::Vector::new(1. + 2_f32.powi(-13), 8192., 0.));
    let sa = rp::SharedShape::cuboid(1., 0.5, 1.);
    let sb = rp::SharedShape::capsule_z(0.25, 2_f32.powi(-12));
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(8192_f32 - 2_f32.powi(-12), 8192.);
    assert!(
        pair.poses(&pa, &pb, 0., &mut work())
            .unwrap()
            .unwrap()
            .strict
    );
    let radius_zero = rp::SharedShape::capsule_y(0.25, 0.);
    assert!(Pair::new(sa.as_ref(), radius_zero.as_ref(), &mut work())
        .unwrap()
        .is_none());
    let ball = rp::SharedShape::ball(0.5);
    assert!(Pair::new(sa.as_ref(), ball.as_ref(), &mut work())
        .unwrap()
        .is_none());
    let invalid = rp::Pose::from_translation(rp::Vector::splat(f32::INFINITY));
    assert_eq!(
        pair.poses(&pa, &invalid, SKIN, &mut work()).unwrap_err(),
        TrajectoryError::NonFinite
    );
    assert_eq!(
        pair.poses(&pa, &pb, f32::NEG_INFINITY, &mut work())
            .unwrap_err(),
        TrajectoryError::NonFinite
    );
    let a = constant(pa);
    let b = constant(pb);
    for (start, end) in [(Time::NAN, 1.), (0., Time::NAN), (-1., 0.), (0., 2.)] {
        assert_eq!(
            validate_interval(a, b, start, end, &mut work()),
            Err(TrajectoryError::InvalidTime)
        );
    }
    assert_eq!(
        pair.at(a, b, Time::NAN, SKIN, &mut work()).unwrap_err(),
        TrajectoryError::InvalidTime
    );
    // A Native-outside/world-inside Constant must not publish an invalid start.
    let sa = rp::SharedShape::cuboid(0.5, 0.1, 2.);
    let sb = rp::SharedShape::capsule_y(0.5, 0.4);
    let a = constant(rp::Pose::from_translation(rp::Vector::new(1.5, 0.1, 0.)));
    let b = constant(rp::Pose::from_translation(rp::Vector::new(
        0.65435594,
        0.9205225,
        -3.079389e-6,
    )));
    for (start, end) in [(Time::NAN, 1.), (0., Time::NAN), (-1., 0.), (0., 2.)] {
        assert_eq!(
            cast(
                a,
                sa.as_ref(),
                b,
                sb.as_ref(),
                start,
                end,
                SKIN,
                TOL,
                &mut work()
            )
            .unwrap_err(),
            TrajectoryError::InvalidTime
        );
    }
}

#[test]
fn exact_work_and_one_below_publish_no_partial_witness_or_mutated_input_bytes() {
    // Exact subtraction outside Sterbenz and both signs of the TwoSum
    // residual retain the smallest justified directed upper, without snapping.
    assert_eq!(gap_upper(0.75, 0.25), 0.5);
    assert_eq!(gap_upper(0.5, 0.5).to_bits(), 0_f64.to_bits());
    assert_eq!(gap_upper(1., 2_f32.powi(-55)), 1.);
    assert_eq!(gap_upper(1., 3. * 2_f32.powi(-55)), 1.);
    let min = f32::from_bits(1);
    assert_eq!(gap_upper(f64::from(min) * 2., min), f64::from(min));
    let (a, sa, b, sb) = recorded_down();
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    let run = |w: &mut Work| {
        Pair::new(sa.as_ref(), sb.as_ref(), w)?
            .unwrap()
            .at(a, b, MID, SKIN, w)
    };
    let mut measured = work();
    let expected = run(&mut measured).unwrap().unwrap();
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert_eq!(
        bits(run(&mut exact).unwrap().unwrap().contact),
        bits(expected.contact)
    );
    assert_eq!(exact.used, exact.limit);
    let mut short = Work {
        used: 0,
        limit: measured.used - 1,
    };
    assert_eq!(run(&mut short).unwrap_err(), TrajectoryError::WorkLimit);
    assert!(short.used < measured.used);
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

const CHAIN_LEFT: Time = 0.09999969024261368;
const CHAIN_MID: Time = 0.09999971408422059;
const CHAIN_RIGHT: Time = 0.0999997379258275;

fn recorded_free_chain_pair() -> (ShapeMotion, rp::SharedShape, ShapeMotion, rp::SharedShape) {
    // C74 raw60: the actual Capsule2 -> Capsule1 query. Distinct velocities
    // and stored endpoints share the original domain and physical h only.
    let domain = Domain::new(0.07500000111758709, 0.10000000149011612).unwrap();
    let make = |body, start, end, velocity| {
        let mut k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(body, 0),
            domain,
            0.025,
            rp::Pose::from_translation(rp::Vector::X * start),
            rp::Vector::X * velocity,
            rp::Vector::ZERO,
        )
        .unwrap();
        assert_eq!(k.native.motion.end.translation.x.to_bits(), end);
        k.native.motion.start_time = 0.075;
        k.native.motion.end_time = 0.1;
        motion(Curve::Integrated(
            Kernel::from_native(k.native, domain).unwrap(),
        ))
    };
    (
        make(
            2,
            f32::from_bits(0xc11e5c1f),
            0xc1487ad4,
            f32::from_bits(0xc2d2998a),
        ),
        rp::SharedShape::capsule_y(0.25, 0.25),
        make(
            1,
            f32::from_bits(0xc1143d68),
            0xc14051e0,
            f32::from_bits(0xc2dc6658),
        ),
        rp::SharedShape::capsule_y(0.25, 0.25),
    )
}

fn original_capsule_ball_core(
    pose: rp::Pose,
    capsule: &rapier3d::parry::shape::Capsule,
    point: rp::Vector,
) -> rp::Vector {
    // A nominated surface point must belong to a real ball on the original
    // closed axial segment, not to a sphere inferred from its output normal.
    let lo = capsule.segment.a.min(capsule.segment.b);
    let hi = capsule.segment.a.max(capsule.segment.b);
    let local = (pose.inverse() * point).clamp(lo, hi);
    assert!(local.cmpge(lo).all() && local.cmple(hi).all());
    let core = pose * local;
    assert!(distance_upper(point, core) <= f64::from(capsule.radius));
    core
}

#[test]
fn recorded_free_chain_capsule_pair_has_an_actual_positive_midpoint_and_original_prefix() {
    let (a, sa, b, sb) = recorded_free_chain_pair();
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    for (time, ax, bx, gap) in [
        (CHAIN_LEFT, 0xc1487ab2, 0xc14051bc, 0.010000228881835938),
        (CHAIN_MID, 0xc1487ab4, 0xc14051bf, 0.009999275207519531),
        (CHAIN_RIGHT, 0xc1487ab7, 0xc14051c2, 0.009999275207519531),
    ] {
        let pa = a.pose(time);
        let pb = b.pose(time);
        assert_eq!(pa.translation.x.to_bits(), ax);
        assert_eq!(pb.translation.x.to_bits(), bx);
        // Exact dyadic scalar gap of two original core points and real radii.
        let ca = pa * sa.as_capsule().unwrap().segment.a;
        let cb = pb * sb.as_capsule().unwrap().segment.a;
        assert_eq!(distance_upper(ca, cb) - 0.25 - 0.25, gap);
        let observation = pair.at(a, b, time, SKIN, &mut work()).unwrap();
        if time == CHAIN_LEFT {
            assert!(observation.is_none());
        } else {
            let witness = observation.unwrap();
            assert!(witness.strict && witness.contact.dist < SKIN);
            assert_eq!(f64::from(witness.contact.dist), gap);
            assert_eq!(witness.contact.normal1, rp::Vector::X);
            assert_eq!(witness.contact.normal2, -rp::Vector::X);
            assert_eq!(
                (witness.contact.subshape1, witness.contact.subshape2),
                (0, 0)
            );
            let ca =
                original_capsule_ball_core(pa, sa.as_capsule().unwrap(), witness.contact.point1);
            let cb =
                original_capsule_ball_core(pb, sb.as_capsule().unwrap(), witness.contact.point2);
            for point in [
                sa.as_capsule().unwrap().segment.a,
                sa.as_capsule().unwrap().segment.b,
            ] {
                assert!((pa * point - ca).dot(witness.contact.normal1) <= 0.);
            }
            for point in [
                sb.as_capsule().unwrap().segment.a,
                sb.as_capsule().unwrap().segment.b,
            ] {
                assert!((pb * point - cb).dot(witness.contact.normal1) >= 0.);
            }
            let reverse = Pair::new(sb.as_ref(), sa.as_ref(), &mut work())
                .unwrap()
                .unwrap()
                .at(b, a, time, SKIN, &mut work())
                .unwrap()
                .unwrap();
            assert_eq!(bits(reverse.contact), bits(witness.contact.flipped()));
        }
    }
    // Positive observations carry no cached time authority, nor any NoHit
    // authority for an earlier point or an unvisited interval.
    assert!(pair
        .at(a, b, CHAIN_LEFT, SKIN, &mut work())
        .unwrap()
        .is_none());
    let tolerance = f64::from((0.1_f32 - 0.075_f32) * 1e-6_f32);
    assert_eq!(tolerance, 2.4999998515795596e-8);
    let cast = |w: &mut Work| {
        crate::physics3d::solver_trajectory::cast_full_shapes_policy(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            CHAIN_LEFT,
            CHAIN_RIGHT,
            SKIN,
            tolerance,
            w,
            false,
        )
    };
    let mut charged = work();
    let hit = cast(&mut charged).unwrap().unwrap();
    assert!(hit.safe_time >= CHAIN_LEFT && hit.safe_time < hit.hit_time);
    assert!(hit.hit_time <= CHAIN_MID && hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= SKIN);
    assert!(pair
        .at(a, b, hit.safe_time, SKIN, &mut work())
        .unwrap()
        .is_none_or(|w| !w.strict));
    let native = leaf_contact(
        &a.pose(hit.hit_time),
        sa.as_ref(),
        &b.pose(hit.hit_time),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    if native.dist <= SKIN {
        assert_eq!(
            bits(hit.contact),
            bits(native),
            "original Native contact remains first"
        );
    } else {
        assert!(
            pair.at(a, b, hit.hit_time, SKIN, &mut work())
                .unwrap()
                .unwrap()
                .strict
        );
    }
    for limit in [charged.used, charged.used - 1] {
        let result = cast(&mut Work { used: 0, limit });
        if limit == charged.used {
            let exact = result.unwrap().unwrap();
            assert_eq!(
                (exact.safe_time.to_bits(), exact.hit_time.to_bits()),
                (hit.safe_time.to_bits(), hit.hit_time.to_bits())
            );
            assert_eq!(bits(exact.contact), bits(hit.contact));
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

#[test]
fn capsule_pair_positive_observer_preserves_selected_margin_membership_eligibility_and_exact_work()
{
    let (a, sa, b, sb) = recorded_free_chain_pair();
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    let run = |w: &mut Work| {
        Pair::new(sa.as_ref(), sb.as_ref(), w)?
            .unwrap()
            .at(a, b, CHAIN_MID, SKIN, w)
    };
    let mut charged = work();
    let expected = run(&mut charged).unwrap().unwrap();
    assert_eq!(charged.used, 64 + 128 + 32 + 512 + 640 + 2048);
    for limit in [charged.used, charged.used - 1] {
        let result = run(&mut Work { used: 0, limit });
        if limit == charged.used {
            assert_eq!(
                bits(result.unwrap().unwrap().contact),
                bits(expected.contact)
            );
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let equality = f32::from_bits(0x3c23d400);
    let equal = pair
        .at(a, b, CHAIN_MID, equality, &mut work())
        .unwrap()
        .unwrap();
    assert!(!equal.strict && equal.contact.dist == equality);
    for margin in [equality.next_down(), 0., -SKIN] {
        assert!(pair
            .at(a, b, CHAIN_MID, margin, &mut work())
            .unwrap()
            .is_none());
    }
    let native = leaf_contact(
        &a.pose(CHAIN_MID),
        sa.as_ref(),
        &b.pose(CHAIN_MID),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(native.dist <= SKIN);
    let mut initially_clear = None;
    let initial = cast_policy_impl(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        CHAIN_MID,
        CHAIN_MID,
        SKIN,
        TOL,
        &mut work(),
        false,
        &mut initially_clear,
        None,
        None,
    )
    .unwrap()
    .unwrap();
    assert_eq!(initially_clear, Some(false));
    assert_eq!(
        (initial.safe_time.to_bits(), initial.hit_time.to_bits()),
        (CHAIN_MID.to_bits(), CHAIN_MID.to_bits())
    );
    assert_eq!(bits(initial.contact), bits(native));
    for reversed in [false, true] {
        let (a, sa, b, sb) = if reversed {
            (b, sb.as_ref(), a, sa.as_ref())
        } else {
            (a, sa.as_ref(), b, sb.as_ref())
        };
        let native =
            leaf_contact(&a.pose(CHAIN_MID), sa, &b.pose(CHAIN_MID), sb, &mut work()).unwrap();
        assert!(native.dist <= SKIN);
        for with_manifold in [false, true] {
            let mut storage = rapier3d::parry::query::ContactManifold::<(), ()>::new();
            let mut manifold = with_manifold.then_some(&mut storage);
            let mut contacts = Vec::new();
            contacts_full_shapes_with_manifold(
                a,
                sa,
                b,
                sb,
                CHAIN_MID,
                SKIN,
                &mut work(),
                &mut manifold,
                &mut |contact, ia, ib, work| {
                    work.charge(1)?;
                    assert_eq!((ia, ib), (0, 0));
                    assert_eq!((contact.subshape1, contact.subshape2), (ia, ib));
                    assert!(contact.dist <= SKIN);
                    assert_eq!(
                        contact.normal1,
                        if reversed {
                            -rp::Vector::X
                        } else {
                            rp::Vector::X
                        }
                    );
                    assert_eq!(contact.normal2, -contact.normal1);
                    original_capsule_ball_core(
                        a.pose(CHAIN_MID),
                        sa.as_capsule().unwrap(),
                        contact.point1,
                    );
                    original_capsule_ball_core(
                        b.pose(CHAIN_MID),
                        sb.as_capsule().unwrap(),
                        contact.point2,
                    );
                    contacts.push(contact);
                    Ok(())
                },
            )
            .unwrap();
            assert!(
                !contacts.is_empty(),
                "the same original contact reaches the response census"
            );
            if !with_manifold {
                assert_eq!(contacts.len(), 1);
                assert_eq!(
                    bits(contacts[0]),
                    bits(native),
                    "Native-inside census stays first"
                );
            }
        }
    }
    let pa = a.pose(CHAIN_MID);
    let mut pb = b.pose(CHAIN_MID);
    pb.translation.x += 4.;
    assert!(pair.poses(&pa, &pb, SKIN, &mut work()).unwrap().is_none());
    let mut far_poses = work();
    assert!(pair
        .poses(&pa, &pb, SKIN, &mut far_poses)
        .unwrap()
        .is_none());
    assert_eq!(far_poses.used, 128 + 512 + 256);
    for limit in [far_poses.used, far_poses.used - 1] {
        let result = pair.poses(&pa, &pb, SKIN, &mut Work { used: 0, limit });
        if limit == far_poses.used {
            assert!(result.unwrap().is_none());
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    let far = constant(pb);
    let far_at = |work: &mut Work| {
        Pair::new(sa.as_ref(), sb.as_ref(), work)?
            .unwrap()
            .at(a, far, CHAIN_MID, SKIN, work)
    };
    let mut far_work = work();
    assert!(far_at(&mut far_work).unwrap().is_none());
    assert_eq!(far_work.used, 64 + 128 + 32 + 512 + 896);
    assert_eq!(far_work.used, 1632);
    for limit in [far_work.used, far_work.used - 1] {
        let result = far_at(&mut Work { used: 0, limit });
        if limit == far_work.used {
            assert!(result.unwrap().is_none());
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    pb = b.pose(CHAIN_MID);
    pb.rotation = rp::Rotation::from_xyzw(0., 0., 0.125, 1.);
    assert!(pair.poses(&pa, &pb, SKIN, &mut work()).unwrap().is_none());
    let cross_axis = rp::SharedShape::capsule_x(0.25, 0.25);
    assert!(Pair::new(sa.as_ref(), cross_axis.as_ref(), &mut work())
        .unwrap()
        .is_none());
    assert_eq!(
        pair.at(a, b, Time::NAN, SKIN, &mut work()).unwrap_err(),
        TrajectoryError::InvalidTime
    );
    assert_eq!(
        pair.at(a, b, CHAIN_MID, f32::NAN, &mut work()).unwrap_err(),
        TrajectoryError::NonFinite
    );

    // Unequal segment lengths/heights still use valid axial projection, not
    // a hardcoded pair of equal-height endpoint coordinates.
    let short = rp::SharedShape::capsule_y(0.25, 0.25);
    let long = rp::SharedShape::capsule_y(0.75, 0.125);
    let pa = rp::Pose::IDENTITY;
    let pb = rp::Pose::from_translation(rp::Vector::new(0.38, 0.375, 0.));
    let projected = Pair::new(short.as_ref(), long.as_ref(), &mut work())
        .unwrap()
        .unwrap()
        .poses(&pa, &pb, SKIN, &mut work())
        .unwrap()
        .unwrap();
    assert!(projected.strict && projected.contact.normal1 == rp::Vector::X);
    original_capsule_ball_core(pa, short.as_capsule().unwrap(), projected.contact.point1);
    original_capsule_ball_core(pb, long.as_capsule().unwrap(), projected.contact.point2);
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

#[test]
fn original_c76_integrated_rn_contact_is_not_refuted_by_the_ideal_equal_velocity_gap() {
    let domain = Domain::new(0.09999988228082479, 0.10000000149011612).unwrap();
    let h = f32::from_bits(0x34000000);
    let make = |body, x, end| {
        let k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(body, 0),
            domain,
            h,
            rp::Pose::from_translation(rp::Vector::new(f32::from_bits(x), 0., 0.19999976)),
            rp::Vector::new(-60., 0., 2.),
            rp::Vector::ZERO,
        )
        .unwrap();
        assert_eq!(k.native.integration_seconds.to_bits(), 0x34000000);
        assert_eq!(k.native.motion.start_time.to_bits(), 0_f32.to_bits());
        assert_eq!(k.native.motion.end_time.to_bits(), h.to_bits());
        assert_eq!(k.native.motion.end.translation.x.to_bits(), end);
        assert_eq!(
            k.native.motion.end.translation.z.to_bits(),
            0.2_f32.to_bits()
        );
        motion(Curve::Integrated(k))
    };
    // C76 Spatial response2: operand A is actor1, B is actor0. Their identical
    // raw velocities do not make differently rounded absolute COMs affine.
    let a = make(1, 0xc080a3ca, 0xc080a3d9);
    let b = make(0, 0xc060a3bc, 0xc060a3da);
    let sa = rp::SharedShape::capsule_y(0.25, 0.25);
    let sb = rp::SharedShape::capsule_y(0.25, 0.25);
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    let time = Time::from_bits(0x3fb999989ffff240);
    for m in [a, b] {
        let Curve::Integrated(k) = m.curve else {
            unreachable!()
        };
        assert_eq!(k.local_delta(time).to_bits(), 0x337ffff3);
        assert_eq!(k.local_delta(time.next_down()).to_bits(), 0x337ffff2);
    }
    let pa = a.pose(time);
    let pb = b.pose(time);
    assert_eq!(pa.translation.x.to_bits(), 0xc080a3d1);
    assert_eq!(pb.translation.x.to_bits(), 0xc060a3cb);
    assert_eq!(pa.translation.z.to_bits(), 0x3e4cccc5);
    assert_eq!(pb.translation.z.to_bits(), 0x3e4cccc5);
    let ca = pa * sa.as_capsule().unwrap().segment.a;
    let cb = pb * sb.as_capsule().unwrap().segment.a;
    assert_eq!((ca.y, cb.y), (-0.25, -0.25));
    let gap = gap_upper(gap_upper(distance_upper(ca, cb), 0.25), 0.25);
    assert_eq!(gap, 41943_f64 / 4194304.);
    assert!(gap < f64::from(SKIN));
    // All quantities below are exact dyadic integers on the 2^-30 grid.
    // This independently proves an actual point contact, never sampled NoHit.
    let dx = (f64::from(cb.x) - f64::from(ca.x)) * 2_f64.powi(30);
    let reach = (0.25 + 0.25 + f64::from(SKIN)) * 2_f64.powi(30);
    assert_eq!(dx, 547_608_320.);
    assert_eq!(reach, 547_608_330.);
    assert!((dx as u128).pow(2) < (reach as u128).pow(2));
    let point_a = ca + rp::Vector::X * 0.25;
    let point_b = cb - rp::Vector::X * 0.25;
    assert_eq!(distance_upper(point_a, ca), 0.25);
    assert_eq!(distance_upper(point_b, cb), 0.25);
    original_capsule_ball_core(pa, sa.as_capsule().unwrap(), point_a);
    original_capsule_ball_core(pb, sb.as_capsule().unwrap(), point_b);
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    assert!(
        pair.at(a, b, time, SKIN, &mut work())
            .unwrap()
            .unwrap()
            .strict
    );

    let ideal = f64::from(b.pose(domain.start).translation.x)
        - f64::from(a.pose(domain.start).translation.x)
        - 0.25
        - 0.25;
    assert_eq!(ideal, 0.010000228881835938);
    assert!(ideal > f64::from(SKIN));
    // The old real-affine relative translation cancels v*t and reports this
    // ideal constant gap, which is not an enclosure of the actual RN graph.
    assert!(!a
        .analytic_separated(
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::X,
            domain.start,
            domain.end,
            SKIN,
            &mut work()
        )
        .unwrap());
    assert!(!a
        .separated(
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::X,
            domain.start,
            domain.end,
            SKIN,
            &mut work()
        )
        .unwrap());
    let native_start = leaf_contact(
        &a.pose(domain.start),
        sa.as_ref(),
        &b.pose(domain.start),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(native_start.dist > SKIN);
    let initial = crate::physics3d::solver_trajectory::rounded::initial_support_allowances(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        native_start.normal1,
        domain.start,
        &mut work(),
    )
    .unwrap();
    assert!(
        initial.geometry > SKIN,
        "this is not an existing-contact allowance"
    );
    let tolerance = f64::from((0.1_f32 - 0.075_f32) * 1e-6_f32);
    assert_eq!(tolerance, 2.4999998515795596e-8);
    let mut charged = work();
    let hit = crate::physics3d::solver_trajectory::cast_full_shapes_policy(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        domain.start,
        domain.end,
        SKIN,
        tolerance,
        &mut charged,
        true,
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time >= domain.start && hit.safe_time < time);
    assert!(hit.safe_time < hit.hit_time && hit.hit_time <= domain.end);
    assert!(hit.hit_time - hit.safe_time <= tolerance && hit.hit_time <= time + tolerance);
    assert!(hit.contact.dist <= SKIN);
    assert!(pair
        .at(a, b, hit.safe_time, SKIN, &mut work())
        .unwrap()
        .is_none_or(|w| !w.strict));
    let native_hit = leaf_contact(
        &a.pose(hit.hit_time),
        sa.as_ref(),
        &b.pose(hit.hit_time),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    if native_hit.dist <= SKIN {
        assert_eq!(bits(hit.contact), bits(native_hit));
    }
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

#[test]
fn rounded_capsule_pair_finds_contact_inside_adjacent_output_cells() {
    let shape = rp::SharedShape::capsule_y(0.5, 0.25);
    let PairKind::Capsules(pair) = Pair::new(shape.as_ref(), shape.as_ref(), &mut work())
        .unwrap()
        .unwrap()
        .kind
    else {
        panic!("expected parallel capsules");
    };
    let a = rp::Pose::from_translation(rp::Vector::new(
        f32::from_bits(0x4042_a4fc),
        0.76,
        f32::from_bits(0xbe26_693b),
    ));
    let b = rp::Pose::from_translation(rp::Vector::new(
        f32::from_bits(0x4043_6770),
        0.76,
        f32::from_bits(0x3eb1_d801),
    ));
    let mut previous = b;
    previous.translation.z = b.translation.z.next_up();

    assert!(
        rounded_capsules::at(&pair, &a, &previous, SKIN, true, &mut work())
            .unwrap()
            .is_none()
    );
    assert!(
        rounded_capsules::at(&pair, &a, &b, SKIN, false, &mut work())
            .unwrap()
            .is_none()
    );
    let witness = rounded_capsules::at(&pair, &a, &b, SKIN, true, &mut work())
        .unwrap()
        .unwrap();
    assert!(witness.strict);
    assert!(distance_upper(witness.contact.point1, witness.contact.point2) < f64::from(SKIN));
    assert_eq!(witness.contact.normal1.y, 0.);
}

#[test]
fn capsule_cast_brackets_adjacent_rounded_contact_at_original_times() {
    let first_start = 0.003_048_390_550_570_538_6;
    let end = f64::from(0.004_166_667_f32);
    let make_motion = |id, start, seconds, origin, velocity| {
        motion(Curve::Integrated(
            Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::from_raw_parts(id, 0),
                Domain::new(start, end).unwrap(),
                seconds,
                rp::Pose::from_translation(rp::Vector::from_array(origin)),
                rp::Vector::from_array(velocity),
                rp::Vector::ZERO,
            )
            .unwrap(),
        ))
    };
    let a = make_motion(
        1,
        0.,
        0.004_166_667,
        [3.041_328_2, 0.760_095_36, -0.162_115_2],
        [-0.002_217_292_6, 0., -0.104_724_16],
    );
    let b = make_motion(
        5,
        first_start,
        0.001_118_276_4,
        [3.051_864_4, 0.760_071_04, 0.348_025_98],
        [1.815_756_6, -0.022_370_273, -0.925_626_2],
    );
    let left: Time = 0.003_777_473_920_866_323;
    let right = left.next_up();
    let shape = rp::SharedShape::capsule_y(0.5, 0.25);
    let a_bits = a.pose(right).translation.to_array().map(f32::to_bits);
    assert_eq!([a_bits[0], a_bits[2]], [0x4042_a4fc, 0xbe26_693b]);
    assert_eq!(
        b.pose(left).translation.z,
        b.pose(right).translation.z.next_up()
    );
    let shape = shape.as_ref();
    let hit = cast(a, shape, b, shape, left, right, SKIN, TOL, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!([hit.safe_time, hit.hit_time], [left, right]);
    assert!(hit.contact.dist <= SKIN);
}

#[test]
fn cardinal_capsule_poles_keep_the_closed_margin_in_both_orders() {
    let radius = 0.4;
    let shape = rp::SharedShape::capsule_y(0.5, radius);
    let PairKind::Capsules(pair) = Pair::new(shape.as_ref(), shape.as_ref(), &mut work())
        .unwrap()
        .unwrap()
        .kind
    else {
        panic!("expected parallel capsules");
    };
    // Adjacent X outputs from the following-group cast. The real world
    // radii are still too far apart; only the transformed local poles touch.
    let a = rp::Pose::from_translation(rp::Vector::new(f32::from_bits(0x4028_51d0), 0.9100932, 0.));
    let b =
        rp::Pose::from_translation(rp::Vector::new(f32::from_bits(0x405c_28db), 0.91009027, 0.));
    let mut previous = a;
    previous.translation.x = a.translation.x.next_down();
    let pole_a = a.translation.x + radius;
    let pole_b = b.translation.x - radius;
    let gap = pole_b - pole_a;
    assert!(
        f64::from(b.translation.x) - f64::from(a.translation.x) - 2. * f64::from(radius)
            > f64::from(SKIN)
    );
    assert!(gap < SKIN);
    assert!(pole_b - (previous.translation.x + radius) > SKIN);
    for reverse in [false, true] {
        let at = |actor, margin| {
            let (first, second) = if reverse { (&b, actor) } else { (actor, &b) };
            rounded_capsules::at(&pair, first, second, margin, false, &mut work()).unwrap()
        };
        assert!(at(&previous, SKIN).is_none());
        assert!(at(&a, gap.next_down()).is_none());
        for (margin, strict) in [(SKIN, true), (gap, false)] {
            let witness = at(&a, margin).unwrap();
            assert_eq!(witness.strict, strict);
            let contact = if reverse {
                witness.contact.flipped()
            } else {
                witness.contact
            };
            assert_eq!(contact.dist, gap);
            assert_eq!(contact.normal1, rp::Vector::X);
            assert_eq!((contact.point1.x, contact.point2.x), (pole_a, pole_b));
            assert_eq!(contact.point1.y, contact.point2.y);
            assert_eq!((contact.point1.z, contact.point2.z), (0., 0.));
        }
    }
}
