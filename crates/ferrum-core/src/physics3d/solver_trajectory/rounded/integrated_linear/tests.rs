use super::*;

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn motion(k: Kernel) -> ShapeMotion {
    ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn kernel(
    body: u32,
    domain: [Time; 2],
    h: f32,
    start: rp::Vector,
    v: rp::Vector,
    labels: [f32; 2],
) -> Kernel {
    let mut k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(body, 0),
        super::super::super::Domain::new(domain[0], domain[1]).unwrap(),
        h,
        rp::Pose::from_translation(start),
        v,
        rp::Vector::ZERO,
    )
    .unwrap();
    k.native.motion.start_time = labels[0];
    k.native.motion.end_time = labels[1];
    Kernel::from_native(k.native, k.domain).unwrap()
}

#[test]
fn cardinal_capsules_use_their_output_grid_across_equivalent_and_rebased_clocks() {
    let end = f64::from(0.05_f32);
    let start = f64::from(0.025_f32);
    let rebased = 0.025_000_059_977_172_025;
    let make = |id, from, seconds, x, labels| {
        motion(kernel(
            id,
            [from, end],
            seconds,
            rp::Vector::new(x, 0., 0.),
            rp::Vector::X,
            labels,
        ))
    };
    let a = make(2, start, 0.025, 1.045, [0.025, 0.05]);
    let b = make(3, start, 0.025, 1.555, [0., 0.025]);
    let c = make(1, start, 0.025, 0.534_999_97, [0.025, 0.05]);
    let d = make(2, rebased, 0.024_999_94, 1.045, [0., 0.024_999_94]);
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let proxy = ToiProxy::from_shape(shape.as_ref()).unwrap();
    for (a, b, start, margin) in [
        (a, b, start, 0.009_999_87),
        (c, d, rebased, 0.009_999_840_5),
    ] {
        for (a, b, normal) in [(a, b, rp::Vector::X), (b, a, -rp::Vector::X)] {
            let mut limited = Work {
                used: 0,
                limit: 16 * 1024,
            };
            assert!(separated(
                a,
                &proxy,
                b,
                &proxy,
                normal,
                start,
                end,
                margin,
                &mut limited
            )
            .unwrap());
            assert!(!separated(
                a,
                &proxy,
                b,
                &proxy,
                normal,
                start,
                end,
                0.010_001,
                &mut work()
            )
            .unwrap());
        }
    }
}

#[test]
fn rotating_box_keeps_a_cardinal_face_bound_only_while_its_outputs_fit() {
    use crate::physics3d::solver_trajectory::rounded::{
        rotating_cardinal_box_face_separated, AxisCache,
    };
    let [start, end] = [0., f64::from(0.025_f32)];
    let domain = super::super::super::Domain::new(start, end).unwrap();
    let a = motion(kernel(
        7,
        [start, end],
        0.025,
        rp::Vector::new(3.57, 0., 0.),
        rp::Vector::X,
        [0., 0.025],
    ));
    let cap = rp::SharedShape::capsule_y(0.25, 0.25);
    let cube = rp::SharedShape::cuboid(0.25, 1., 1.);
    for (angular, expected) in [(1.192_092_9e-7, true), (0.1, false)] {
        let b = motion(
            Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::from_raw_parts(8, 0),
                domain,
                0.025,
                rp::Pose::from_translation(rp::Vector::new(4.08, 0., 0.)),
                rp::Vector::X * 1.000_000_1,
                rp::Vector::Z * angular,
            )
            .unwrap(),
        );
        let mut cache =
            AxisCache::new(a, cap.as_ref(), b, cube.as_ref(), start, end, 0.009_999_632);
        assert_eq!(
            rotating_cardinal_box_face_separated(&mut cache, rp::Vector::X, &mut work()).unwrap(),
            expected
        );
    }
}

struct Case {
    a: ShapeMotion,
    b: ShapeMotion,
    sa: rp::SharedShape,
    sb: rp::SharedShape,
    interval: [Time; 2],
    used: u64,
}
fn recorded() -> [Case; 3] {
    let cap = || rp::SharedShape::capsule_y(0.25, 0.25);
    let free = [0.05000000074505806, 0.07500000111758709];
    let wall = [0.03705015553058098, 0.04940020737410798];
    let tangent = [0.07500000111758709, 0.10000000149011612];
    [
        Case {
            a: motion(kernel(
                0,
                free,
                0.025,
                rp::Vector::new(-5.7549944, 0., 0.),
                rp::Vector::new(-115.099884, 0., 0.),
                [0.05, 0.075],
            )),
            b: motion(kernel(
                8,
                free,
                0.025,
                rp::Vector::new(-4., 0., 0.),
                rp::Vector::new(-140., 0., 0.),
                [0.05, 0.075],
            )),
            sa: cap(),
            sb: rp::SharedShape::cuboid(0.25, 2., 5.),
            interval: free,
            used: 18_084_853,
        },
        Case {
            a: motion(kernel(
                5,
                wall,
                0.012350052,
                rp::Vector::new(-6.852514, 0., 0.),
                rp::Vector::new(-50.00017, 0., 0.),
                [0.037050154, 0.049400207],
            )),
            b: motion(kernel(
                4,
                wall,
                0.012350052,
                rp::Vector::new(-6.2200136, 0., 0.),
                rp::Vector::new(-59.919163, 0., 0.),
                [0.037050154, 0.049400207],
            )),
            sa: cap(),
            sb: cap(),
            interval: [0.049110166864681504, 0.0492066469553543],
            used: 9_373_562,
        },
        Case {
            a: motion(kernel(
                1,
                tangent,
                0.025,
                rp::Vector::new(-3.2649982, 0., 0.15),
                rp::Vector::new(-30.199976, 0., 2.),
                [0.075, 0.1],
            )),
            b: motion(kernel(
                0,
                tangent,
                0.025,
                rp::Vector::new(-2.6324983, 0., 0.15),
                rp::Vector::new(-35.099976, 0., 2.),
                [0.075, 0.1],
            )),
            sa: cap(),
            sb: cap(),
            // Whole approaching prefix, including the original failed cell.
            interval: [tangent[0], 0.09999809414145489],
            used: 24_667_690,
        },
    ]
}

#[test]
fn recorded_c77_far_and_approaching_pairs_use_complete_native_dt_with_linear_work() {
    for c in recorded() {
        let before = postcard::to_allocvec(&(c.a, c.b, &c.sa, &c.sb)).unwrap();
        let pa = ToiProxy::from_shape(c.sa.as_ref()).unwrap();
        let pb = ToiProxy::from_shape(c.sb.as_ref()).unwrap();
        let call = |w: &mut Work| {
            separated(
                c.a,
                &pa,
                c.b,
                &pb,
                rp::Vector::X,
                c.interval[0],
                c.interval[1],
                0.01,
                w,
            )
        };
        let mut measured = work();
        assert!(call(&mut measured).unwrap());
        let expected = 128 + 2 * 256 + 512 + 64 * (pa.points().len() + pb.points().len()) as u64;
        assert_eq!(measured.used, expected);
        // Both directions prove the same complete cardinal full-shape gap.
        assert!(separated(
            c.b,
            &pb,
            c.a,
            &pa,
            -rp::Vector::X,
            c.interval[0],
            c.interval[1],
            0.01,
            &mut work()
        )
        .unwrap());
        for limit in [c.used + expected, c.used + expected - 1] {
            let mut w = Work {
                used: c.used,
                limit,
            };
            let result = call(&mut w);
            if limit == c.used + expected {
                assert!(result.unwrap());
                assert_eq!(w.used, limit);
            } else {
                assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
            }
        }
        let mut actual = work();
        assert!(c
            .a
            .analytic_separated(
                c.sa.as_ref(),
                c.b,
                c.sb.as_ref(),
                rp::Vector::X,
                c.interval[0],
                c.interval[1],
                0.01,
                &mut actual
            )
            .unwrap());
        assert_eq!(actual.used, 1 + expected);
        assert_eq!(
            postcard::to_allocvec(&(c.a, c.b, &c.sa, &c.sb)).unwrap(),
            before
        );
    }
    // A fixed Constant keeps its original pose, not an invented Native clock.
    let a = motion(kernel(
        0,
        [0., 1.],
        1.,
        rp::Vector::X * -2.,
        rp::Vector::X,
        [0., 1.],
    ));
    let b = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::IDENTITY,
            start_time: 0.,
            end_time: 1.,
        },
        ..a
    };
    let sa = rp::SharedShape::capsule_y(0.25, 0.25);
    let sb = rp::SharedShape::cuboid(0.25, 2., 5.);
    assert!(separated(
        a,
        &ToiProxy::from_shape(sa.as_ref()).unwrap(),
        b,
        &ToiProxy::from_shape(sb.as_ref()).unwrap(),
        rp::Vector::X,
        0.,
        1.,
        0.01,
        &mut work()
    )
    .unwrap());
}

#[test]
fn integrated_rn_errors_keep_the_c76_real_contact_and_clock_radius_boundaries() {
    let d = [0.09999988228082479, 0.10000000149011612];
    let a = motion(kernel(
        1,
        d,
        f32::from_bits(0x34000000),
        rp::Vector::new(-4.019994, 0., 0.19999976),
        rp::Vector::new(-60., 0., 2.),
        [0., f32::from_bits(0x34000000)],
    ));
    let b = motion(kernel(
        0,
        d,
        f32::from_bits(0x34000000),
        rp::Vector::new(-3.5099936, 0., 0.19999976),
        rp::Vector::new(-60., 0., 2.),
        [0., f32::from_bits(0x34000000)],
    ));
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let proxy = ToiProxy::from_shape(shape.as_ref()).unwrap();
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let t = Time::from_bits(0x3fb999989ffff240);
    assert_eq!(a.pose(t).translation.x.to_bits(), 0xc080a3d1);
    assert_eq!(b.pose(t).translation.x.to_bits(), 0xc060a3cb);
    assert_eq!(
        f64::from(b.pose(t).translation.x) - f64::from(a.pose(t).translation.x) - 0.5,
        0.009999990463256836
    );
    // Equal ideal velocities do not cancel either body's independent RN COM
    // shell. In particular they cannot refute this original actual contact.
    assert!(!separated(
        a,
        &proxy,
        b,
        &proxy,
        rp::Vector::X,
        d[0],
        d[1],
        0.01,
        &mut work()
    )
    .unwrap());
    assert_eq!(
        add_error([1., 1_f32.next_up()], 2_f32.powi(-24)),
        Some(2_f64.powi(-24))
    );
    assert_eq!(add_error([-7.5, -7.], 0.25), Some(0.));
    assert_eq!(half_ulp([0., f32::from_bits(1)]), Some(2_f64.powi(-150)));
    assert!(add_error([f32::MAX; 2], f32::MAX).is_none());

    for invalid in 0..4 {
        let mut changed = b;
        let Curve::Integrated(k) = &mut changed.curve else {
            unreachable!()
        };
        match invalid {
            0 => k.domain.end = k.domain.end.next_up(),
            1 => k.native.motion.end.translation.x = k.native.motion.end.translation.x.next_up(),
            2 => k.native.motion.start.rotation = rp::Rotation::from_rotation_z(0.1),
            _ => changed.local_pose.translation.x = 0.125,
        }
        assert!(!separated(
            a,
            &proxy,
            changed,
            &proxy,
            rp::Vector::X,
            d[0],
            d[1],
            0.01,
            &mut work()
        )
        .unwrap());
    }
    assert!(!separated(
        a,
        &proxy,
        b,
        &proxy,
        rp::Vector::new(1., 1e-6, 0.),
        d[0],
        d[1],
        0.01,
        &mut work()
    )
    .unwrap());
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
    // The local RN pole loses a small radius at8192. Its actual real world
    // radius remains part of the independent world bound, even under qI.
    let a = motion(kernel(
        2,
        [0., 1.],
        1.,
        rp::Vector::X * 8191.5,
        rp::Vector::ZERO,
        [0., 1.],
    ));
    let b = motion(kernel(
        3,
        [0., 1.],
        1.,
        rp::Vector::X * 8192.,
        rp::Vector::ZERO,
        [0., 1.],
    ));
    let sa = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let sb = rp::SharedShape::capsule_y(0.25, 2_f32.powi(-12));
    assert_eq!(8192_f32 - 2_f32.powi(-12), 8192.);
    assert!(!separated(
        a,
        &ToiProxy::from_shape(sa.as_ref()).unwrap(),
        b,
        &ToiProxy::from_shape(sb.as_ref()).unwrap(),
        rp::Vector::X,
        0.,
        1.,
        0.,
        &mut work()
    )
    .unwrap());
}

fn recorded_c78_mixed_clock_pair() -> (ShapeMotion, ShapeMotion, rp::SharedShape) {
    let domain = [0.07500000111758709, 0.10000000149011612];
    let suffix = [0.09999989997595549, domain[1]];
    let carrier = kernel(
        2,
        domain,
        0.025,
        rp::Vector::new(-1.5, 0., 0.),
        rp::Vector::new(-60., 0., 0.),
        [0.075, 0.1],
    );
    let a = motion(kernel(
        1,
        suffix,
        1.0151416e-7,
        rp::Vector::new(-4.0199947, 0., 0.19999981),
        rp::Vector::new(0., 0., 2.),
        [0., 1.0151416e-7],
    ));
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::ZERO,
            offset: rp::Vector::new(-0.5100002, 0., 0.15),
            linear_velocity: rp::Vector::new(0., 0., 2.),
            rotation: rp::Rotation::IDENTITY,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    (a, b, rp::SharedShape::capsule_y(0.25, 0.25))
}

#[test]
fn accepted_capsule_pair_can_be_checked_at_the_cropped_start_pose() {
    let start = f64::from(0.008_333_334_f32);
    let end = f64::from(0.012_500_001_f32);
    let dt = 0.004_166_667;
    let make = |body, position, velocity| {
        motion(kernel(body, [start, end], dt, position, velocity, [0., dt]))
    };
    let a = make(
        5,
        rp::Vector::new(3.057_004_7, 0.760_000_05, 0.346_559_55),
        rp::Vector::new(0.869_486_87, -0.022_370_273, -0.500_021_93),
    );
    let b = make(
        4,
        rp::Vector::new(3.520_070_3, 0.76, 0.132_853_17),
        rp::Vector::new(0.907_058_66, 0., -0.418_610_72),
    );
    let shape = rp::SharedShape::capsule_y(0.5, 0.25);
    let check = |b, accepted| {
        parallel_capsules_stable_existing(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            start,
            start,
            0.01,
            accepted,
            &mut work(),
        )
        .unwrap()
    };
    assert!(check(b, true));
    assert!(!check(b, false));
    let inward = make(4, b.pose(start).translation, rp::Vector::ZERO);
    assert!(!check(inward, true));
}

#[test]
fn following_capsules_with_different_clocks_require_an_existing_noninward_contact() {
    let end = 0.016_666_667_535_901_07;
    let start = 0.016_666_656_732_594_168;
    let a = motion(kernel(
        4,
        [0.016_666_552_300_627_45, end],
        1.152_352_74e-7,
        rp::Vector::new(3.439_993, 0.910_090_27, 0.),
        rp::Vector::new(20., -0.006_149_875_5, 0.),
        [0., 1.152_352_74e-7],
    ));
    let shape = rp::SharedShape::capsule_y(0.5, 0.4);
    let x = 4.249_995_f32;
    let check = |position, seconds, accepted| {
        let b = motion(kernel(
            5,
            [start, end],
            seconds,
            rp::Vector::new(position, 0.910_088_8, 0.),
            rp::Vector::new(20., -0.006_129_510_2, 0.),
            [0., seconds],
        ));
        parallel_capsules_stable_existing(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            start,
            end,
            0.01,
            accepted,
            &mut work(),
        )
        .unwrap()
    };
    let seconds = 1.080_330_7e-8;
    for accepted in [false, true] {
        assert!(check(x, seconds, accepted));
        // One translation cell farther apart removes the strict starting contact.
        assert!(!check(x.next_up(), seconds, accepted));
        // Identical Native X velocities now approach in world time.
        assert!(!check(x, seconds * 0.5, accepted));
    }
}

#[test]
fn recorded_c78_mixed_clock_capsules_certify_only_the_complete_clear_prefix() {
    let (a, b, shape) = recorded_c78_mixed_clock_pair();
    let (start, end) = a.curve.times();
    let clear_end = start + (end - start) / 16.;
    let before = postcard::to_allocvec(&(a, b, &shape)).unwrap();
    assert_eq!(a.pose(start).translation.x, -4.0199947);
    assert_eq!(b.pose(start).translation.x.to_bits(), 0xc060a3be);
    assert_eq!(b.pose(clear_end).translation.x.to_bits(), 0xc060a3c0);
    assert_eq!(
        f64::from(b.pose(clear_end).translation.x)
            - f64::from(a.pose(clear_end).translation.x)
            - 0.5,
        0.010000228881835938
    );
    let call = |w: &mut Work| {
        monotone_capsules_separated(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            rp::Vector::X,
            start,
            clear_end,
            0.01,
            w,
        )
    };
    let mut charged = work();
    assert!(call(&mut charged).unwrap());
    assert_eq!(charged.used, 1408);
    assert!(monotone_capsules_separated(
        b,
        shape.as_ref(),
        a,
        shape.as_ref(),
        -rp::Vector::X,
        start,
        clear_end,
        0.01,
        &mut work()
    )
    .unwrap());
    for limit in [1408, 1407] {
        let mut w = Work {
            used: 24_000_000,
            limit: 24_000_000 + limit,
        };
        let result = call(&mut w);
        if limit == 1408 {
            assert!(result.unwrap());
            assert_eq!(w.used, w.limit);
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    // The early analytic hook uses the same full-shape authority, before the
    // expensive rounded/image paths. Different clocks are never identified.
    let mut parent = work();
    assert!(a
        .analytic_separated(
            shape.as_ref(),
            b,
            shape.as_ref(),
            rp::Vector::X,
            start,
            clear_end,
            0.01,
            &mut parent
        )
        .unwrap());
    assert_eq!(parent.used, 1409);
    assert!(!monotone_capsules_separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        rp::Vector::X,
        start,
        end,
        0.01,
        &mut work()
    )
    .unwrap());
    let pair = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        shape.as_ref(),
        shape.as_ref(),
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(pair.at(a, b, start, 0.01, &mut work()).unwrap().is_none());
    let middle = start + (end - start) / 2.;
    assert!(
        pair.at(a, b, middle, 0.01, &mut work())
            .unwrap()
            .unwrap()
            .strict
    );
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let tolerance = f64::from((k.native.motion.end_time - k.native.motion.start_time) * 1e-6);
    let hit = crate::physics3d::solver_trajectory::cast_full_shapes_policy(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        start,
        middle,
        0.01,
        tolerance,
        &mut work(),
        false,
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time >= start && hit.safe_time < hit.hit_time);
    assert!(hit.hit_time <= middle && hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= 0.01);
    assert_eq!(postcard::to_allocvec(&(a, b, &shape)).unwrap(), before);
}

#[test]
fn shared_carrier_capsules_keep_attachment_rounding_at_interior_contact() {
    let carrier = kernel(
        0,
        [0., 1.],
        1.,
        rp::Vector::X * 16_777_218.,
        rp::Vector::X * 4.,
        [0., 1.],
    );
    let rider = |anchor_x: f32| ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::X * anchor_x,
            offset: rp::Vector::X * -16_777_216.,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..motion(carrier)
    };
    let (a, b) = (rider(0.), rider(1.));
    let centers = |t| [a.pose(t).translation.x, b.pose(t).translation.x];
    assert_eq!(centers(0.), [2., 4.]);
    assert_eq!(centers(0.5), [4., 4.]);
    assert_eq!(centers(1.), [6., 8.]);

    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    assert!(!monotone_capsules_separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        rp::Vector::X,
        0.,
        1.,
        0.01,
        &mut work(),
    )
    .unwrap());
}

#[test]
fn parallel_riders_require_representable_relative_time_even_at_zero_speed() {
    let end = f64::from(f32::MAX) * 2.;
    let carrier = kernel(0, [0., end], 1., rp::Vector::ZERO, rp::Vector::X, [0., 1.]);
    let rider = |anchor| ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..motion(carrier)
    };
    let (a, b) = (rider(rp::Vector::ZERO), rider(rp::Vector::new(2., 0., 2.)));
    assert!(!b.pose(end).translation.is_finite());
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let direction = rp::Vector::new(1., 0., 1.).normalize();
    assert!(!monotone_capsules_separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        direction,
        0.,
        end,
        0.01,
        &mut work(),
    )
    .unwrap());
}

#[test]
fn monotone_capsule_bounds_preserve_opposed_rate_stored_radius_and_old_prices() {
    let (a, b, shape) = recorded_c78_mixed_clock_pair();
    let (start, end) = a.curve.times();
    let clear_end = start + (end - start) / 16.;
    for invalid in 0..4 {
        let mut changed = b;
        let Curve::Anchored {
            carrier,
            linear_velocity,
            rotation,
            ..
        } = &mut changed.curve
        else {
            unreachable!()
        };
        match invalid {
            0 => linear_velocity.x = 1., // opposes original carrier -60
            1 => carrier.native.motion.end.translation.y = f32::from_bits(1),
            2 => *rotation = rp::Rotation::from_rotation_z(0.01),
            _ => carrier.native.angular_velocity.z = 0.01,
        }
        assert!(!monotone_capsules_separated(
            a,
            shape.as_ref(),
            changed,
            shape.as_ref(),
            rp::Vector::X,
            start,
            clear_end,
            0.01,
            &mut work()
        )
        .unwrap());
    }
    assert!(!monotone_capsules_separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        rp::Vector::new(1., 1e-6, 0.),
        start,
        clear_end,
        0.01,
        &mut work()
    )
    .unwrap());
    // Existing Box/Capsule scalar proofs receive no new work or authority.
    let cuboid = rp::SharedShape::cuboid(0.25, 2., 5.);
    let mut excluded = Work {
        used: 91,
        limit: 91,
    };
    assert!(!monotone_capsules_separated(
        a,
        shape.as_ref(),
        b,
        cuboid.as_ref(),
        rp::Vector::X,
        start,
        clear_end,
        0.01,
        &mut excluded
    )
    .unwrap());
    assert_eq!(excluded.used, 91);
    // Opposing RN terms can have equal endpoints and a different interior.
    // No endpoint inference is allowed for that original F32 graph.
    let carrier = kernel(
        4,
        [0., 1.],
        1.,
        rp::Vector::new(16777216., 0., 0.),
        rp::Vector::new(8., 0., 0.),
        [0., 1.],
    );
    let opposite = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(-16777216., 0., 0.),
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::new(-8., 0., 0.),
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    assert_eq!(
        opposite.pose(0.).translation.x,
        opposite.pose(1.).translation.x
    );
    assert_ne!(
        opposite.pose(0.125).translation.x,
        opposite.pose(0.).translation.x
    );
    assert!(monotone_range(opposite, 0., 1., &mut work())
        .unwrap()
        .is_none());
    // Local pole erasure does not remove the original real world radius.
    let carrier = kernel(
        5,
        [0., 1.],
        1.,
        rp::Vector::new(8192., 0., 0.),
        rp::Vector::ZERO,
        [0., 1.],
    );
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::ZERO,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let a = motion(kernel(
        6,
        [0., 1.],
        1.,
        rp::Vector::new(8191.5, 0., 0.),
        rp::Vector::ZERO,
        [0., 1.],
    ));
    let sa = rp::SharedShape::capsule_y(0.25, 0.5);
    let sb = rp::SharedShape::capsule_y(0.25, 2_f32.powi(-12));
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    assert!(!monotone_capsules_separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        rp::Vector::X,
        0.,
        1.,
        -0.0001,
        &mut work()
    )
    .unwrap());
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

fn recorded_c79_first_free_pair() -> (ShapeMotion, ShapeMotion, rp::SharedShape, rp::SharedShape) {
    let d = [0.07500000111758709, 0.10000000149011612];
    let a = motion(kernel(
        0,
        d,
        0.025,
        rp::Vector::new(-8.632492, 0., 0.),
        rp::Vector::new(-115.099884, 0., 0.),
        [0.075, 0.1],
    ));
    let b = motion(kernel(
        8,
        d,
        0.025,
        rp::Vector::new(-7.5, 0., 0.),
        rp::Vector::new(-140., 0., 0.),
        [0.075, 0.1],
    ));
    (
        a,
        b,
        rp::SharedShape::capsule_y(0.25, 0.25),
        rp::SharedShape::cuboid(0.25, 2., 5.),
    )
}
fn represented_time(k: Kernel, bits: u32) -> Time {
    let u = f32::from_bits(bits);
    let t = k.domain.start
        + (f64::from(u) / f64::from(k.native.integration_seconds))
            * (k.domain.end - k.domain.start);
    assert_eq!(k.local_delta(t).to_bits(), bits);
    t
}

#[test]
fn shared_com_grid_clears_recorded_early_prefix_and_declines_late_local_contact() {
    let interval = [0.05000000074505806, 0.07500000111758709];
    let labels = [0.05, 0.075];
    let trailing = kernel(
        0,
        interval,
        0.025,
        rp::Vector::new(0.14999998, 0., -1.0047272e-16),
        rp::Vector::new(3., 0., 0.),
        labels,
    );
    let leading = kernel(
        1,
        interval,
        0.025,
        rp::Vector::new(0.66, 6.447616e-9, 8.596824e-9),
        rp::Vector::new(2.9999995, 1.2895232e-7, 1.7193648e-7),
        labels,
    );
    let a = motion(trailing);
    let b = motion(leading);
    let radius = 0.25;
    let capsule = rp::SharedShape::capsule_y(0.25, radius);
    let proxy = ToiProxy::from_shape(capsule.as_ref()).unwrap();
    let early = represented_time(trailing, 0.01_f32.to_bits());
    let clearance = 0.01;
    let call = |work: &mut Work| {
        separated(
            a,
            &proxy,
            b,
            &proxy,
            rp::Vector::X,
            interval[0],
            early,
            clearance,
            work,
        )
    };
    let mut measured = work();
    assert!(call(&mut measured).unwrap());
    assert!(measured.used < 2_000);
    let mut insufficient = Work {
        limit: measured.used - 1,
        ..work()
    };
    assert_eq!(call(&mut insufficient), Err(TrajectoryError::WorkLimit));
    assert!(separated(
        b,
        &proxy,
        a,
        &proxy,
        -rp::Vector::X,
        interval[0],
        early,
        clearance,
        &mut work()
    )
    .unwrap());

    for (from, until) in [(0_f32, 0.015_f32), (0.015625, 0.0195)] {
        let mut bounded = work();
        assert!(separated(
            a,
            &proxy,
            b,
            &proxy,
            rp::Vector::X,
            represented_time(trailing, from.to_bits()),
            represented_time(trailing, until.to_bits()),
            clearance,
            &mut bounded,
        )
        .unwrap());
        assert!(bounded.used < 2_500);
    }

    // The same Native pair later admits a local pole inside the requested
    // clearance. Its world radius alone would incorrectly clear the pair.
    let late_dt = 0.01955_f32;
    let late = represented_time(trailing, late_dt.to_bits());
    let ax = a.pose(late).translation.x;
    let bx = b.pose(late).translation.x;
    assert!(f64::from(bx) - f64::from(ax) - 2. * f64::from(radius) > f64::from(clearance));
    assert!(f64::from(bx - radius) - f64::from(ax + radius) < f64::from(clearance));
    let a = Source::new(a, interval[0], late, &mut work())
        .unwrap()
        .unwrap();
    let b = Source::new(b, interval[0], late, &mut work())
        .unwrap()
        .unwrap();
    assert!(
        !shared_com_grid_prefix(a, b, [0., late_dt], 0, radius, clearance, &mut work()).unwrap()
    );
}

#[test]
fn recorded_c79_first_free_cast_uses_the_complete_shared_native_dt_image() {
    let (a, b, sa, sb) = recorded_c79_first_free_pair();
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let pa = ToiProxy::from_shape(sa.as_ref()).unwrap();
    let pb = ToiProxy::from_shape(sb.as_ref()).unwrap();
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    let lo = 0x3ccc_cbd2;
    let hi = 0x3ccc_cbe5;
    let start = represented_time(k, lo);
    let end = represented_time(k, hi);
    // All represented inputs, including the nonmonotone relative RN gap,
    // rather than endpoint interpolation or independent-body Cartesian images.
    for key in lo..=hi {
        let time = represented_time(k, key);
        let u = f32::from_bits(key);
        let actual_a = -8.632492_f32 + -115.099884_f32 * u;
        let actual_b = -7.5_f32 + -140_f32 * u;
        assert_eq!(a.pose(time).translation.x.to_bits(), actual_a.to_bits());
        assert_eq!(b.pose(time).translation.x.to_bits(), actual_b.to_bits());
        assert!(f64::from(actual_b) - f64::from(actual_a) - 0.5 > f64::from(0.01_f32));
    }
    let call = |w: &mut Work| separated(a, &pa, b, &pb, rp::Vector::X, start, end, 0.01, w);
    let mut measured = work();
    assert!(call(&mut measured).unwrap());
    let expected = 1792 + 64 + 256 * u64::from(hi - lo + 1);
    assert_eq!(measured.used, expected); // old affine did not prove this prefix
    assert!(separated(
        b,
        &pb,
        a,
        &pa,
        -rp::Vector::X,
        start,
        end,
        0.01,
        &mut work()
    )
    .unwrap());
    for limit in [expected, expected - 1] {
        let result = call(&mut Work {
            used: 17_000_000,
            limit: 17_000_000 + limit,
        });
        if limit == expected {
            assert!(result.unwrap());
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    // Original complete query and original observer-label tolerance. The new
    // clear proof has no Hit authority and cannot discard the actual later hit.
    let tolerance = f64::from((k.native.motion.end_time - k.native.motion.start_time) * 1e-6);
    assert_eq!(tolerance, 2.4999998515795596e-8);
    let mut full = work();
    let hit = crate::physics3d::solver_trajectory::cast_full_shapes_policy(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        k.domain.start,
        k.domain.end,
        0.01,
        tolerance,
        &mut full,
        false,
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time >= k.domain.start && hit.safe_time < hit.hit_time);
    assert!(hit.hit_time <= represented_time(k, 0x3ccc_cbe6));
    assert!(hit.hit_time - hit.safe_time <= tolerance && hit.contact.dist <= 0.01);
    assert!(
        full.used < 13_913_234,
        "original whole scene first query cost, not a new allowance"
    );
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

#[test]
fn shared_native_dt_image_retains_interior_contacts_clock_gates_and_fixed_cap() {
    let (a, b, sa, sb) = recorded_c79_first_free_pair();
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let pa = ToiProxy::from_shape(sa.as_ref()).unwrap();
    let pb = ToiProxy::from_shape(sb.as_ref()).unwrap();
    let before = postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap();
    let lo = 0x3ccc_cbe5;
    let hi = 0x3ccc_cbe7;
    let start = represented_time(k, lo);
    let middle = represented_time(k, lo + 1);
    let end = represented_time(k, hi);
    for (time, clear) in [(start, true), (middle, false), (end, true)] {
        let gap =
            f64::from(b.pose(time).translation.x) - f64::from(a.pose(time).translation.x) - 0.5;
        assert_eq!(gap > f64::from(0.01_f32), clear);
    }
    assert!(!separated(a, &pa, b, &pb, rp::Vector::X, start, end, 0.01, &mut work()).unwrap());
    let witness = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        sa.as_ref(),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap()
    .unwrap()
    .at(a, b, middle, 0.01, &mut work())
    .unwrap()
    .unwrap();
    assert!(witness.strict && witness.contact.dist < 0.01);
    // The census is a fixed optional image cap, not permission to omit inputs.
    let source_a = Source::new(a, start, end, &mut work()).unwrap().unwrap();
    let source_b = Source::new(b, start, end, &mut work()).unwrap().unwrap();
    let mut capped = work();
    assert!(!shared_dt_image(
        source_a,
        source_b,
        [f32::from_bits(lo - 256), f32::from_bits(hi)],
        0,
        1.,
        0.,
        -0.25,
        0.25,
        0.,
        0.01,
        &mut capped
    )
    .unwrap());
    assert_eq!(capped.used, 64);
    for change in 0..3 {
        let mut changed = b;
        let Curve::Integrated(peer) = &mut changed.curve else {
            unreachable!()
        };
        match change {
            0 => peer.domain.start = peer.domain.start.next_down(),
            1 => peer.native.integration_seconds = peer.native.integration_seconds.next_up(),
            _ => {
                peer.native.motion.end.translation.x =
                    peer.native.motion.end.translation.x.next_up()
            }
        }
        assert!(!separated(
            a,
            &pa,
            changed,
            &pb,
            rp::Vector::X,
            start,
            end,
            0.01,
            &mut work()
        )
        .unwrap());
    }
    // Far A78 success still returns before the new census or image visits.
    let c = recorded().into_iter().next().unwrap();
    let cpa = ToiProxy::from_shape(c.sa.as_ref()).unwrap();
    let cpb = ToiProxy::from_shape(c.sb.as_ref()).unwrap();
    let mut far = work();
    assert!(separated(
        c.a,
        &cpa,
        c.b,
        &cpb,
        rp::Vector::X,
        c.interval[0],
        c.interval[1],
        0.01,
        &mut far
    )
    .unwrap());
    assert_eq!(far.used, 1792);
    assert_eq!(postcard::to_allocvec(&(a, b, &sa, &sb)).unwrap(), before);
}

#[test]
fn fixed_native_cardinal_certificate_precedes_noisy_axis_image_work() {
    let (a, b, sa, sb) = recorded_c79_first_free_pair();
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let start = represented_time(k, 0x3ccc_cbd2);
    let end = represented_time(k, 0x3ccc_cbe5);
    // An independent fixed X support proof is valid even when a supplied
    // witness direction has a small tangent component. It is never installed
    // as a new contact normal or substituted into the original leaf query.
    let original = rp::Vector::new(1., 1e-5, 0.);
    let before = postcard::to_allocvec(&(a, b, &sa, &sb, original)).unwrap();
    let mut failed_axis = work();
    assert!(!a
        .analytic_separated(
            sa.as_ref(),
            b,
            sb.as_ref(),
            original,
            start,
            end,
            0.01,
            &mut failed_axis
        )
        .unwrap());
    assert_eq!(failed_axis.used, 129);
    let call = |w: &mut Work| {
        crate::physics3d::solver_trajectory::certified_separation_axes_only(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            original,
            None,
            start,
            end,
            0.01,
            w,
        )
    };
    let mut measured = work();
    assert!(call(&mut measured).unwrap());
    // Original failed analytic129 + new bounded header64 + fixed X analytic1
    // + original complete shared-image proof6976. No rounded leaf/image query.
    assert_eq!(measured.used, 7170);
    for limit in [7170, 7169] {
        let result = call(&mut Work {
            used: 21_000_000,
            limit: 21_000_000 + limit,
        });
        if limit == 7170 {
            assert!(result.unwrap());
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    // The original cardinal first-axis success retains its exact old price.
    let mut original_axis = work();
    assert!(
        crate::physics3d::solver_trajectory::certified_separation_axes_only(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::X,
            None,
            start,
            end,
            0.01,
            &mut original_axis
        )
        .unwrap()
    );
    assert_eq!(original_axis.used, 6977);
    assert_eq!(
        postcard::to_allocvec(&(a, b, &sa, &sb, original)).unwrap(),
        before
    );
}

#[test]
fn fixed_native_cardinals_keep_real_contacts_selected_margin_and_original_normals() {
    let (a, b, sa, sb) = recorded_c79_first_free_pair();
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let start = represented_time(k, 0x3ccc_cbe5);
    let middle = represented_time(k, 0x3ccc_cbe6);
    let end = represented_time(k, 0x3ccc_cbe7);
    let original = rp::Vector::new(1., -1e-5, 0.);
    let before = postcard::to_allocvec(&(a, b, &sa, &sb, original)).unwrap();
    let native_before = crate::physics3d::solver_trajectory::leaf_contact(
        &a.pose(middle),
        sa.as_ref(),
        &b.pose(middle),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    let native_bytes = postcard::to_allocvec(&(
        native_before.point1,
        native_before.point2,
        native_before.normal1,
        native_before.normal2,
        native_before.dist,
        native_before.subshape1,
        native_before.subshape2,
    ))
    .unwrap();
    assert!(
        !crate::physics3d::solver_trajectory::certified_native_cardinals(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            original,
            start,
            end,
            0.01,
            &mut work()
        )
        .unwrap()
    );
    let witness = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        sa.as_ref(),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap()
    .unwrap()
    .at(a, b, middle, 0.01, &mut work())
    .unwrap()
    .unwrap();
    assert!(witness.strict && witness.contact.dist < 0.01);
    // Selected margin is an input, not a shell widened by the new direction.
    assert!(
        crate::physics3d::solver_trajectory::certified_native_cardinals(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            original,
            start,
            end,
            0.009,
            &mut work()
        )
        .unwrap()
    );
    let native_after = crate::physics3d::solver_trajectory::leaf_contact(
        &a.pose(middle),
        sa.as_ref(),
        &b.pose(middle),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(
        postcard::to_allocvec(&(
            native_after.point1,
            native_after.point2,
            native_after.normal1,
            native_after.normal2,
            native_after.dist,
            native_after.subshape1,
            native_after.subshape2,
        ))
        .unwrap(),
        native_bytes
    );
    // No repeated fixed-direction work is attached to an already-cardinal
    // request, nor to the existing Anchored Box/Capsule scalar path.
    let mut excluded = Work {
        used: 80,
        limit: 80,
    };
    assert!(
        !crate::physics3d::solver_trajectory::certified_native_cardinals(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::X,
            start,
            end,
            0.01,
            &mut excluded
        )
        .unwrap()
    );
    let (_, anchored, capsule) = recorded_c78_mixed_clock_pair();
    assert!(
        !crate::physics3d::solver_trajectory::certified_native_cardinals(
            anchored,
            capsule.as_ref(),
            b,
            sb.as_ref(),
            original,
            start,
            end,
            0.01,
            &mut excluded
        )
        .unwrap()
    );
    assert_eq!(excluded.used, 80);
    assert_eq!(
        postcard::to_allocvec(&(a, b, &sa, &sb, original)).unwrap(),
        before
    );
}

#[test]
fn output_counter_nomination_requires_original_clock_and_actual_strict_world_observation() {
    let d = [0.07500000111758709, 0.10000000149011612];
    let a = motion(kernel(
        2,
        d,
        0.025,
        rp::Vector::X * -9.8974905,
        rp::Vector::X * -105.29988,
        [0.075, 0.1],
    ));
    let b = motion(kernel(
        1,
        d,
        0.025,
        rp::Vector::X * -9.264992,
        rp::Vector::X * -110.19989,
        [0.075, 0.1],
    ));
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let interval = [d[1] - 1e-6, 0.09999970439821482];
    let before = postcard::to_allocvec(&(a, b, &capsule)).unwrap();
    let call = |w: &mut Work| {
        native_output_probe(
            a,
            capsule.as_ref(),
            b,
            capsule.as_ref(),
            rp::Vector::X,
            interval[0],
            interval[1],
            0.01,
            w,
        )
    };
    let mut paid = work();
    let time = call(&mut paid)
        .unwrap()
        .expect("recorded late-cell counter nomination");
    assert!(time > interval[0] && time < interval[1]);
    // Neither a lower support nor an inverted Native clock is contact data.
    // Only the unchanged full pair's actual strict world observer approves it.
    let witness = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        capsule.as_ref(),
        capsule.as_ref(),
        &mut work(),
    )
    .unwrap()
    .unwrap()
    .at(a, b, time, 0.01, &mut work())
    .unwrap()
    .unwrap();
    assert!(witness.strict && witness.contact.dist < 0.01);
    for limit in [paid.used, paid.used - 1] {
        let result = call(&mut Work { used: 0, limit });
        if limit == paid.used {
            assert_eq!(result.unwrap().unwrap().to_bits(), time.to_bits());
        } else {
            assert_eq!(result, Err(TrajectoryError::WorkLimit));
        }
    }
    let mut changed = b;
    let Curve::Integrated(k) = &mut changed.curve else {
        unreachable!()
    };
    k.native.motion.start_time = k.native.motion.start_time.next_up();
    assert!(native_output_probe(
        a,
        capsule.as_ref(),
        changed,
        capsule.as_ref(),
        rp::Vector::X,
        interval[0],
        interval[1],
        0.01,
        &mut work()
    )
    .unwrap()
    .is_none());
    assert!(native_output_probe(
        a,
        capsule.as_ref(),
        b,
        capsule.as_ref(),
        rp::Vector::new(1., 0., 1e-5),
        interval[0],
        interval[1],
        0.01,
        &mut work()
    )
    .unwrap()
    .is_none());
    assert_eq!(postcard::to_allocvec(&(a, b, &capsule)).unwrap(), before);
}

#[test]
fn identical_rounded_face_anchor_preserves_skin_over_the_full_moving_interval() {
    let times = [0.0496668755089626, 0.04987324798141055];
    let h = 0.00020637247;
    let driver = kernel(
        5,
        times,
        h,
        rp::Vector::new(0.070320606, 10., 0.),
        rp::Vector::X * -61.000088,
        [0., h],
    );
    let start = 0.049718337512496436;
    let wall = rp::SharedShape::cuboid(0.25, 2., 5.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let prove = |offset, tangent, limit| {
        let mut actor = motion(driver);
        actor.curve = Curve::Anchored {
            carrier: driver,
            anchor: -rp::Vector::X * 0.25,
            offset: rp::Vector::X * offset,
            linear_velocity: rp::Vector::Y * tangent,
            rotation: rp::Rotation::IDENTITY,
        };
        let proof = cardinal_box_capsule_prefix(
            actor,
            capsule.as_ref(),
            motion(driver),
            wall.as_ref(),
            rp::Vector::X,
            start,
            times[1],
            0.01,
            2.1e-10,
            &mut Work { used: 0, limit },
        )
        .unwrap();
        (
            actor.pose(start),
            matches!(proof, Some(FacePrefix::Separated)),
        )
    };
    for tangent in [0., -0.125] {
        let (outward, clear) = prove(-0.26000002, tangent, 2048);
        let (inward, other_clear) = prove(-0.26, tangent, 32 * 1024);
        assert_eq!(outward, inward);
        assert!(clear);
        assert!(!other_clear);
    }
}

#[test]
fn shifted_elevator_anchor_preserves_clearance_over_the_full_rounded_face_range() {
    let h = 1. / 240.;
    let times = [0., f64::from(h)];
    let driver = kernel(
        1,
        times,
        h,
        rp::Vector::Y * 7.450581e-9,
        rp::Vector::Y * 1.9999998,
        [0., h],
    );
    let floor = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let actor = |height| ShapeMotion {
        curve: Curve::Anchored {
            carrier: driver,
            anchor: rp::Vector::Y * height,
            offset: rp::Vector::Y * 0.51,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..motion(driver)
    };
    let clear = actor(0.100000046);
    let recontacts = actor(0.1_f32.next_up());
    assert_eq!(clear.pose(0.), recontacts.pose(0.));
    for (actor, expected) in [(clear, true), (recontacts, false)] {
        for (a, sa, b, sb, normal) in [
            (
                motion(driver),
                floor.as_ref(),
                actor,
                capsule.as_ref(),
                rp::Vector::Y,
            ),
            (
                actor,
                capsule.as_ref(),
                motion(driver),
                floor.as_ref(),
                -rp::Vector::Y,
            ),
        ] {
            let proof = cardinal_box_capsule_prefix(
                a,
                sa,
                b,
                sb,
                normal,
                times[0],
                times[1],
                0.01,
                f64::from(h * 1e-6),
                &mut Work {
                    used: 0,
                    limit: 16 * 1024,
                },
            )
            .unwrap();
            assert_eq!(matches!(proof, Some(FacePrefix::Separated)), expected);
        }
    }
}

#[test]
fn walking_rider_on_diagonal_platform_finds_first_world_radius_skin_crossing() {
    let domain = [0.012500000651925802, 0.01666666753590107];
    let h = 0.004166667;
    let box_shape = rp::SharedShape::cuboid(10., 0.25, 10.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    for (y, vertical) in [(0.006249994, 0.4999995), (0.008333325, -0.4999995)] {
        let driver = kernel(
            0,
            domain,
            h,
            rp::Vector::new(1.025, y, 0.),
            rp::Vector::new(1.999998, vertical, 0.),
            [0., h],
        );
        for offset in [1.163125_f32, 1.163125_f32.next_up()] {
            let actor = ShapeMotion {
                curve: Curve::Anchored {
                    carrier: driver,
                    anchor: rp::Vector::new(0.5125017, -0.0031249675, 0.),
                    offset: rp::Vector::new(2.9335638e-8, offset, 0.),
                    linear_velocity: rp::Vector::X * 0.9999999,
                    rotation: rp::Rotation::IDENTITY,
                },
                ..motion(driver)
            };
            let prove = |end| {
                cardinal_box_capsule_prefix(
                    actor,
                    capsule.as_ref(),
                    motion(driver),
                    box_shape.as_ref(),
                    -rp::Vector::Y,
                    domain[0],
                    end,
                    0.01,
                    f64::from(h * 1e-6),
                    &mut work(),
                )
                .unwrap()
            };
            if offset > 1.163125 {
                assert!(matches!(prove(domain[1]), Some(FacePrefix::Separated)));
                continue;
            }
            let Some(FacePrefix::Boundary {
                safe_time,
                hit_time,
                ..
            }) = prove(domain[1])
            else {
                panic!("missing original crossing for {vertical}")
            };
            let gaps = |time| {
                let face = f64::from(motion(driver).pose(time).translation.y + 0.25);
                let center = actor.pose(time).translation.y;
                [
                    f64::from(center - 0.5) - f64::from(0.4_f32) - face,
                    f64::from(center + (-0.5 - 0.4_f32)) - face,
                ]
            };
            assert_eq!(safe_time.next_up(), hit_time);
            assert!(gaps(safe_time).into_iter().all(|v| v > f64::from(0.01_f32)));
            let [world, local] = gaps(hit_time);
            assert!(world <= f64::from(0.01_f32) && local > f64::from(0.01_f32));
            assert!(matches!(prove(safe_time), Some(FacePrefix::Separated)));
        }
    }
}

#[test]
fn parallel_capsule_side_distinguishes_anchored_rounding_phases_and_finite_edges() {
    let times = [0.0092999994244113, 0.011499999164184097];
    let h = 0.0021999998;
    let driver = kernel(
        1,
        times,
        h,
        rp::Vector::X * 1.22,
        rp::Vector::X * 50.,
        [0., h],
    );
    let cube = rp::SharedShape::cuboid(0.25, 0.25, 0.25);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let safe = 0.010100001044229007;
    let actor = |anchor: f32, offset: f32, tangent| ShapeMotion {
        curve: Curve::Anchored {
            carrier: driver,
            anchor: rp::Vector::X * anchor,
            offset: rp::Vector::new(offset, 0., tangent),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..motion(driver)
    };
    let check = |cap: ShapeMotion| {
        cardinal_box_capsule_prefix(
            cap,
            capsule.as_ref(),
            motion(driver),
            cube.as_ref(),
            rp::Vector::X,
            safe,
            times[1],
            0.01,
            f64::from(h * 1e-6),
            &mut Work {
                used: 0,
                limit: 64 * 1024,
            },
        )
        .unwrap()
    };
    let old = actor(0., -0.51000005, 0.);
    let shifted = actor(2_f32.powi(-24), f32::from_bits(0xbf028f5f), 0.);
    assert_eq!(old.pose(safe), shifted.pose(safe));
    assert!(matches!(check(shifted), Some(FacePrefix::Separated)));
    let Some(FacePrefix::Boundary {
        safe_time,
        hit_time,
        ..
    }) = check(old)
    else {
        panic!("expected an interior side crossing")
    };
    let gaps = |at| {
        let center = old.pose(at).translation.x;
        let face = f64::from(motion(driver).pose(at).translation.x - 0.25);
        [
            face - f64::from(center + 0.25),
            face - (f64::from(center) + 0.25),
        ]
    };
    assert_eq!(safe_time.next_up(), hit_time);
    assert!(gaps(safe_time).into_iter().all(|v| v > f64::from(0.01f32)));
    let [local, world] = gaps(hit_time);
    assert!(local < f64::from(0.01f32) && world > f64::from(0.01f32));
    assert!(matches!(check(actor(0.,-0.51000005,1.)),Some(FacePrefix::Through(t)) if t==safe_time));
}
