use super::*;
use crate::physics3d::solver_trajectory::{
    cast_full_shapes_policy, contacts_full_shapes_with_manifold, leaf_contact, Domain, Kernel,
};

const LEFT: Time = 0.004186710356407266;
const RIGHT: Time = 0.004186710356407281;
const SKIN: f32 = 0.01;
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
fn recorded() -> (
    ShapeMotion,
    rp::SharedShape,
    ShapeMotion,
    rp::SharedShape,
    Kernel,
) {
    // C85 raw547/548: actual depth48 frontier, not the projected-zero candidate.
    let d = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let mut k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        d,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.0032724752, 0., 0.99999464),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    k.native.motion.start_time = 0.004166667;
    k.native.motion.end_time = 0.008333334;
    let a = motion(Curve::Integrated(k));
    let b = motion(Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::new(0.99997854, 1.0100001, -0.0065449155),
        offset: rp::Vector::new(6.431341e-5, 1.7881393e-7, 0.0065446342),
        linear_velocity: rp::Vector::new(0., -0.022303263, 0.),
        rotation: rp::Rotation::IDENTITY,
    });
    (
        a,
        rp::SharedShape::cuboid(3., 0.1, 3.),
        b,
        rp::SharedShape::capsule_y(0.5, 0.4),
        k,
    )
}
fn bits(c: Contact) -> Vec<u32> {
    [c.point1, c.point2, c.normal1, c.normal2]
        .into_iter()
        .flat_map(|p| p.to_array().map(f32::to_bits))
        .chain([c.dist.to_bits(), c.subshape1, c.subshape2])
        .collect()
}

#[test]
fn c85_rotating_frontier_has_an_original_world_contact_and_chronological_cast() {
    let (a, sa, b, sb, k) = recorded();
    let before = crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap();
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let pa = a.pose(RIGHT);
    let pb = b.pose(RIGHT);
    assert_eq!(k.local_delta(LEFT).to_bits(), 0x37a82307);
    assert_eq!(k.local_delta(RIGHT).to_bits(), 0x37a82308);
    let native = leaf_contact(&pa, sa.as_ref(), &pb, sb.as_ref(), &mut work()).unwrap();
    assert_eq!(native.dist, 0.010000028_f32);
    assert!(native.dist > SKIN);
    // Preserve the original producer's rotated negative and all Native bits.
    assert!(pair.at(a, b, RIGHT, SKIN, &mut work()).unwrap().is_none());
    assert!(pair
        .normal_axis_at(a, b, LEFT, SKIN, &mut work())
        .unwrap()
        .is_none());
    let mut budget = work();
    let witness = pair
        .normal_axis_at(a, b, RIGHT, SKIN, &mut budget)
        .unwrap()
        .unwrap();
    let price = budget.used;
    assert_eq!(price, 4000);
    assert!(witness.strict && witness.contact.dist < SKIN);
    assert_eq!(witness.contact.normal1, rp::Vector::Y);
    assert_eq!(witness.contact.normal2, -rp::Vector::Y);
    let core = pb * sb.as_capsule().unwrap().segment.a;
    assert_eq!(core.y.to_bits(), 0x3ed1eb86);
    assert_eq!(witness.contact.point1.y.to_bits(), 0x32c00000);
    assert!(distance_upper(witness.contact.point2, core) <= f64::from(0.4_f32));
    assert!(gap_upper(distance_upper(witness.contact.point1, core), 0.4) < f64::from(SKIN));
    // Both complete cones: the box normal graph is independent of X/Z and
    // nondecreasing in every closed normal slab value, not just these faces.
    assert!(pb.translation.y + 0.5 >= core.y);
    for p in [-0.1_f32, -0.05, 0., 0.05, 0.1] {
        assert!((pa * rp::Vector::new(2., p, -2.)).y <= witness.contact.point1.y);
    }
    let reverse = Pair::new(sb.as_ref(), sa.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let flipped = reverse
        .normal_axis_at(b, a, RIGHT, SKIN, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(bits(flipped.contact), bits(witness.contact.flipped()));
    for allowance in [price, price - 1] {
        let mut w = Work {
            used: 73,
            limit: 73 + allowance,
        };
        let result = pair.normal_axis_at(a, b, RIGHT, SKIN, &mut w);
        if allowance == price {
            assert_eq!(
                bits(result.unwrap().unwrap().contact),
                bits(witness.contact)
            );
            assert_eq!(w.used, 73 + price);
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    let tolerance = f64::from((k.native.motion.end_time - k.native.motion.start_time) * 1e-6);
    let tiny = cast_full_shapes_policy(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        LEFT,
        RIGHT,
        SKIN,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .unwrap();
    // The contract is an admitted prefix and an actual contact bracket, not
    // the caller's arbitrary endpoints. C87's exact first-cell walker found
    // an adjacent bracket strictly inside this original recorded interval.
    assert!(
        tiny.safe_time >= LEFT
            && tiny.hit_time <= RIGHT
            && tiny.safe_time.next_up().to_bits() == tiny.hit_time.to_bits()
            && tiny.hit_time - tiny.safe_time <= tolerance,
        "tiny safe={:.18e} hit={:.18e} input=[{LEFT:.18e},{RIGHT:.18e}] tolerance={tolerance:.18e}",
        tiny.safe_time,
        tiny.hit_time,
    );
    let actual = pair
        .normal_axis_at(a, b, tiny.hit_time, SKIN, &mut work())
        .unwrap()
        .expect("actual strict original geometry at the returned time");
    let actual_core = b.pose(tiny.hit_time) * sb.as_capsule().unwrap().segment.a;
    assert!(actual.strict);
    assert!(
        gap_upper(
            distance_upper(actual.contact.point1, actual_core),
            sb.as_capsule().unwrap().radius
        ) < f64::from(SKIN)
    );
    assert!(
        cast_full_shapes_policy(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            LEFT,
            tiny.safe_time,
            SKIN,
            tolerance,
            &mut work(),
            true,
        )
        .unwrap()
        .is_none(),
        "the complete original LEFT-to-safe prefix must be clear"
    );
    assert!(tiny.contact.dist <= SKIN);
    let mut full_work = work();
    let full = cast_full_shapes_policy(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        k.domain.start,
        k.domain.end,
        SKIN,
        tolerance,
        &mut full_work,
        true,
    )
    .unwrap()
    .unwrap();
    assert!(full.safe_time >= k.domain.start && full.hit_time > full.safe_time);
    assert!(
        full.safe_time <= RIGHT && full.hit_time <= k.domain.end
            && full.hit_time - full.safe_time <= tolerance,
        "actual safe={:.18e} hit={:.18e} known_strict_right={RIGHT:.18e} width={:.18e} tolerance={tolerance:.18e} work={}/{}",
        full.safe_time, full.hit_time, full.hit_time - full.safe_time, full_work.used, full_work.limit,
    );
    // RIGHT is an independently known contact inside the bracket, not a
    // timestamp supplied to this full-domain query. C88 preserved its prefix
    // before RIGHT and returned another strict point within the original tol.
    let actual_full = pair
        .normal_axis_at(a, b, full.hit_time, SKIN, &mut work())
        .unwrap()
        .expect("actual strict geometry at the full query's returned hit");
    let full_core = b.pose(full.hit_time) * sb.as_capsule().unwrap().segment.a;
    assert!(actual_full.strict);
    assert!(
        gap_upper(
            distance_upper(actual_full.contact.point1, full_core),
            sb.as_capsule().unwrap().radius
        ) < f64::from(SKIN)
    );
    assert!(
        cast_full_shapes_policy(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            k.domain.start,
            full.safe_time,
            SKIN,
            tolerance,
            &mut work(),
            true,
        )
        .unwrap()
        .is_none(),
        "the complete original domain-start-to-safe prefix must be clear"
    );
    assert!(full.contact.dist <= SKIN);
    assert!(
        full_work.used < 14_737_963,
        "original whole query reached depth48 after this cost"
    );
    for with_manifold in [false, true] {
        let mut storage = rapier3d::parry::query::ContactManifold::<(), ()>::new();
        let mut manifold = with_manifold.then_some(&mut storage);
        let mut contacts = Vec::new();
        contacts_full_shapes_with_manifold(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            RIGHT,
            SKIN,
            &mut work(),
            &mut manifold,
            &mut |c, ia, ib, _| {
                assert_eq!((c.subshape1, c.subshape2), (ia, ib));
                assert!(c.dist <= SKIN && c.normal1.y > 0.);
                contacts.push(c);
                Ok(())
            },
        )
        .unwrap();
        assert!(!contacts.is_empty());
    }
    assert_eq!(
        bits(native),
        bits(leaf_contact(&pa, sa.as_ref(), &pb, sb.as_ref(), &mut work()).unwrap())
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap(),
        before
    );
}

#[test]
fn rotating_normal_axis_keeps_scalar_prices_cones_radius_and_native_priority() {
    let (a, sa, b, sb, k) = recorded();
    let pair = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let pa = a.pose(RIGHT);
    let pb = b.pose(RIGHT);
    for change in 0..4 {
        let mut box_pose = pa;
        let mut cap_pose = pb;
        match change {
            0 => box_pose.rotation.x = f32::from_bits(1),
            1 => box_pose.rotation = rp::Rotation::from_xyzw(0., 0.8, 0., 0.6), // S<0
            2 => cap_pose.rotation = rp::Rotation::from_rotation_y(0.01),
            _ => cap_pose.translation.y += 1.,
        }
        assert!(pair
            .normal_axis_poses(&box_pose, &cap_pose, SKIN, &mut work())
            .unwrap()
            .is_none());
    }
    let wrong = rp::SharedShape::capsule_x(0.5, 0.4);
    let wrong = Pair::new(sa.as_ref(), wrong.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    assert!(wrong
        .normal_axis_poses(&pa, &pb, SKIN, &mut work())
        .unwrap()
        .is_none());
    // A valid corner-near two-point distance does not authorize a face row.
    // The original tangent nominee lies outside the slab, so no Y-only
    // ground/impulse normal may be emitted by this optional face producer.
    let clipped_core = pa * rp::Vector::new(3.001, 0.1, 0.);
    let clipped_cap = rp::Pose::from_translation(clipped_core + rp::Vector::Y * 0.9);
    let core = clipped_cap * sb.as_capsule().unwrap().segment.a;
    let face_point = pa * rp::Vector::new(3., 0.1, 0.);
    assert!(gap_upper(distance_upper(face_point, core), 0.4) < f64::from(SKIN));
    assert!((pa.inverse() * core).x > sa.as_cuboid().unwrap().half_extents.x);
    assert!(pair
        .normal_axis_poses(&pa, &clipped_cap, SKIN, &mut work())
        .unwrap()
        .is_none());

    // q-conjugate nomination can land on +half while C is behind that face.
    // A genuine two-point witness alone must not create an inward normal.
    let bs = rp::SharedShape::cuboid(1., 1., 1.);
    let cs = rp::SharedShape::capsule_y(0.25, 0.5);
    let inward = Pair::new(bs.as_ref(), cs.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let box_pose =
        rp::Pose::from_parts(rp::Vector::ZERO, rp::Rotation::from_xyzw(0., 0.25, 0., 1.5));
    let cap_pose = rp::Pose::from_translation(rp::Vector::Y * 1.5);
    assert!(
        gap_upper(
            distance_upper(box_pose * rp::Vector::Y, cap_pose * (rp::Vector::Y * 0.25)),
            0.5
        ) < 1.
    );
    assert!(inward
        .normal_axis_poses(&box_pose, &cap_pose, 1., &mut work())
        .unwrap()
        .is_none());
    // Reversed endpoint order must reject the upper core and use the lower.
    let reversed_segment = rp::SharedShape::capsule(rp::Vector::Y * 0.5, rp::Vector::Y * -0.5, 0.4);
    let endpoints = Pair::new(sa.as_ref(), reversed_segment.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let w = endpoints
        .normal_axis_poses(&pa, &pb, SKIN, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(w.contact.normal1, rp::Vector::Y);
    assert!(distance_upper(w.contact.point2, pb * (rp::Vector::Y * -0.5)) <= f64::from(0.4_f32));
    // Equality remains non-strict, and the original real radius stays intact.
    let zero = rp::SharedShape::cuboid(0., 0., 0.);
    let ball = rp::SharedShape::capsule_y(0., 0.5);
    let equal = Pair::new(zero.as_ref(), ball.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let origin = rp::Pose::from_parts(rp::Vector::ZERO, rp::Rotation::from_xyzw(0., 0.5, 0., 1.));
    let cap = rp::Pose::from_translation(rp::Vector::Y * 0.625);
    let e = equal
        .normal_axis_poses(&origin, &cap, 0.125, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(e.contact.dist, 0.125);
    assert!(!e.strict);
    assert!(equal
        .normal_axis_poses(&origin, &cap, 0.125_f32.next_down(), &mut work())
        .unwrap()
        .is_none());
    assert!(pair
        .normal_axis_poses(&pa, &pb, -0.1, &mut work())
        .unwrap()
        .is_none());
    assert!(matches!(
        pair.normal_axis_at(a, b, k.domain.end.next_up(), SKIN, &mut work()),
        Err(TrajectoryError::InvalidTime)
    ));
    assert!(matches!(
        pair.normal_axis_poses(&pa, &pb, f32::NEG_INFINITY, &mut work()),
        Err(TrajectoryError::NonFinite)
    ));
    // Old scalar inputs never enter or pay for the new producer.
    let scalar = motion(Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: 0.,
        end_time: 1.,
    });
    let mut no_work = Work { used: 7, limit: 7 };
    assert!(pair
        .normal_axis_at(scalar, scalar, 0.5, SKIN, &mut no_work)
        .unwrap()
        .is_none());
    assert_eq!(no_work.used, 7);
    // A known strict midpoint upper may not be replaced by a later right
    // endpoint merely because this valid interval already fits the tolerance.
    // The old tolerance branch returned end despite having paid for this point.
    let h = 1e-6_f32;
    let end = f64::from(h);
    let plane = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
        start_time: 0.,
        end_time: end,
    });
    let approaching = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(7, 0),
            Domain::new(0., end).unwrap(),
            h,
            rp::Pose::from_translation(rp::Vector::new(0., 0.910002, 0.)),
            rp::Vector::new(0., -5., 0.),
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    let mid = end * 0.5;
    let check = Pair::new(sa.as_ref(), sb.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    assert!(
        check
            .at(plane, approaching, mid, SKIN, &mut work())
            .unwrap()
            .unwrap()
            .strict
    );
    let midpoint_hit = cast_full_shapes_policy(
        plane,
        sa.as_ref(),
        approaching,
        sb.as_ref(),
        0.,
        end,
        SKIN,
        end,
        &mut work(),
        false,
    )
    .unwrap()
    .unwrap();
    assert!(
        midpoint_hit.hit_time <= mid && midpoint_hit.hit_time - midpoint_hit.safe_time <= end,
        "known midpoint={mid:.18e} actual safe={:.18e} hit={:.18e} tolerance={end:.18e}",
        midpoint_hit.safe_time,
        midpoint_hit.hit_time
    );

    // Original Native initial contact/data has precedence over the supplement.
    let native_cap = rp::Pose::from_translation(pb.translation - rp::Vector::Y * 0.001);
    let ca = motion(Curve::Constant {
        pose: pa,
        start_time: 0.,
        end_time: 1.,
    });
    let cb = motion(Curve::Constant {
        pose: native_cap,
        start_time: 0.,
        end_time: 1.,
    });
    let native = leaf_contact(&pa, sa.as_ref(), &native_cap, sb.as_ref(), &mut work()).unwrap();
    assert!(native.dist < SKIN);
    let hit = cast_full_shapes_policy(
        ca,
        sa.as_ref(),
        cb,
        sb.as_ref(),
        0.,
        1.,
        SKIN,
        1e-6,
        &mut work(),
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!((hit.safe_time, hit.hit_time), (0., 0.));
    assert_eq!(bits(hit.contact), bits(native));
}

#[test]
fn signed_slab_support_preserves_the_seventieth_tick_fourth_contact_and_rows() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.7913551, 0., 0.61135685),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.79335153, 0., 0.6087639]
    );
    let a = motion(Curve::Integrated(carrier));
    let b = motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.9833917, 1.0100002, -0.006389484),
        offset: rp::Vector::new(0.018699288, 0., -0.004813075),
        linear_velocity: rp::Vector::new(0., -1.1622905e-5, 0.),
        rotation: rp::Rotation::IDENTITY,
    });
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let sa = cuboid.as_ref();
    let sb = capsule.as_ref();
    let safe = 0.012624322196643332_f64;
    let hit = safe.next_up();
    assert_eq!(carrier.local_delta(safe).to_bits(), 956_456_015);
    assert_eq!(carrier.local_delta(hit).to_bits(), 956_456_016);
    let pa = a.pose(hit);
    let pb = b.pose(hit);
    assert!(leaf_contact(&pa, sa, &pb, sb, &mut work()).unwrap().dist > SKIN);
    let pair = Pair::new(sa, sb, &mut work()).unwrap().unwrap();
    assert!(pair
        .signed_normal_axis_poses(&a.pose(safe), &b.pose(safe), SKIN, &mut work())
        .unwrap()
        .is_none());
    let witness = pair
        .signed_normal_axis_poses(&pa, &pb, SKIN, &mut work())
        .unwrap()
        .unwrap();
    assert!(witness.strict && witness.contact.dist < SKIN);
    assert_eq!(witness.contact.normal1, rp::Vector::Y);
    assert!(witness.contact.point1.y > (pa * (rp::Vector::Y * 0.1)).y);
    let core = pb * sb.as_capsule().unwrap().segment.a;
    assert!(distance_upper(witness.contact.point2, core) <= f64::from(0.4_f32));
    let reversed = Pair::new(sb, sa, &mut work()).unwrap().unwrap();
    let flipped = reversed
        .signed_normal_axis_poses(&pb, &pa, SKIN, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(bits(flipped.contact), bits(witness.contact.flipped()));
    let mut budget = Work {
        used: 0,
        limit: 3_200_000,
    };
    let cast = cast_full_shapes_policy(
        a,
        sa,
        b,
        sb,
        domain.start,
        domain.end,
        SKIN,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut budget,
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!((cast.safe_time, cast.hit_time), (safe, hit));
    assert_eq!(bits(cast.contact), bits(witness.contact));

    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        rotation,
        ..
    } = b.curve
    else {
        unreachable!();
    };
    let stationary = motion(Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity: rp::Vector::ZERO,
        rotation,
    });
    let mut remainder = Work {
        used: 0,
        limit: 500_000,
    };
    let repeated = cast_full_shapes_policy(
        a,
        sa,
        stationary,
        sb,
        safe,
        domain.end,
        SKIN,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut remainder,
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!((repeated.safe_time, repeated.hit_time), (safe, hit));
    assert_eq!(bits(repeated.contact), bits(witness.contact));

    let mut rows = Vec::new();
    contacts_full_shapes_with_manifold(
        a,
        sa,
        b,
        sb,
        hit,
        SKIN,
        &mut budget,
        &mut None,
        &mut |contact, _, _, _| {
            rows.push(bits(contact));
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(rows, [bits(witness.contact)]);
}
