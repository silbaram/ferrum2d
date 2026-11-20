use super::*;
use crate::physics3d::solver_trajectory::Domain;
fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn integrated(start: rp::Pose, v: rp::Vector, omega: rp::Vector, h: f32) -> Kernel {
    Kernel::from_velocity(
        rp::RigidBodyHandle::invalid(),
        Domain::new(0., f64::from(h)).unwrap(),
        start,
        v,
        omega,
    )
    .unwrap()
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}

#[test]
fn tight_oblique_face_checks_the_entire_translation_and_finite_footprint() {
    let rotation = rp::Rotation::from_rotation_z(0.61) * rp::Rotation::from_rotation_x(0.3);
    let up = rotation * rp::Vector::Y;
    let side = rotation * rp::Vector::Z;
    let h = 0.025;
    let face = motion(Curve::Constant {
        pose: rp::Pose::from_rotation(rotation),
        start_time: 0.,
        end_time: f64::from(h),
    });
    let cube = rp::SharedShape::cuboid(4., 0.1, 4.);
    let cap = rp::SharedShape::capsule_y(0.25, 0.25);
    let fits = |height, velocity, omega| {
        let k = integrated(
            rp::Pose::from_parts(up * height, rotation),
            velocity,
            omega,
            h,
        );
        tight_face_fits(
            face,
            cube.as_ref(),
            motion(Curve::Integrated(k)),
            cap.as_ref(),
            up,
            1e-6,
            &mut work(),
        )
        .unwrap()
    };
    for sign in [-1., 1.] {
        assert!(fits(sign * 0.6, side * 0.5, rp::Vector::ZERO));
        assert!(!fits(sign * 0.5999, side, rp::Vector::ZERO));
        assert!(!fits(sign * 0.61, -up * sign * 60., rp::Vector::ZERO));
        assert!(!fits(sign * 0.6, side * 160., rp::Vector::ZERO));
        assert!(!fits(sign * 0.6, side, rp::Vector::X));
    }
}

fn capsules(inward: bool) -> (ShapeMotion, rp::SharedShape, ShapeMotion, rp::Vector) {
    let q = rp::Rotation::from_rotation_y(1.1);
    let axis = rp::Vector::new(0.6, 0., 0.8);
    let a = motion(Curve::Integrated(integrated(
        rp::Pose::from_rotation(q),
        rp::Vector::Y * 0.1 + if inward { axis * 0.2 } else { rp::Vector::ZERO },
        rp::Vector::ZERO,
        0.025,
    )));
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_parts(axis * 0.5101, q),
        start_time: 0.,
        end_time: 0.025,
    });
    (a, rp::SharedShape::capsule_y(0.25, 0.25), b, axis)
}
fn shaped(m: ShapeMotion) -> Frames {
    let (start, end) = m.curve.times();
    let mut f = frames(m.curve, start, end, &mut work()).unwrap().unwrap();
    f.shape(m);
    f
}

#[test]
fn spinning_box_tip_and_translating_capsule_side_respect_the_actual_gap() {
    let body = rp::RigidBodyHandle::invalid();
    let bar = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            body,
            Domain::new(f64::from(0.05_f32), 0.07500000111758709).unwrap(),
            0.025,
            rp::Pose::from_rotation(rp::Rotation::from_xyzw(0., 0., 0.68046236, 0.73278314)),
            rp::Vector::ZERO,
            rp::Vector::Z * 31.415928,
        )
        .unwrap(),
    ));
    let cube = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let start = 0.06144589126954949;
    let end = 0.06144609812357235;
    for side in [1., -1.] {
        for shift in [0., 0.0001] {
            let cap = motion(Curve::Integrated(integrated(
                rp::Pose::from_translation(
                    rp::Vector::new(2.7493668 + shift, 1.8200017, 0.) * side,
                ),
                rp::Vector::new(-58.254494, -2.7778431e-5, 0.) * side,
                rp::Vector::ZERO,
                0.1,
            )));
            let tip = bar.pose(start) * (rp::Vector::new(2., 0.025, 0.) * side);
            let center = cap.pose(start).translation;
            // The tip projects inside the cylindrical part on both sides.
            assert!((center.y - tip.y).abs() < 0.25);
            let gap = (f64::from(center.x) - f64::from(tip.x)).abs() - 0.25;
            assert_eq!(gap > 0., shift == 0.);
            assert!(gap < 0.00001);
            assert_eq!(f64::from(gap as f32), gap);
            for (a, sa, b, sb, n) in [
                (bar, &cube, cap, &capsule, -side),
                (cap, &capsule, bar, &cube, side),
            ] {
                for margin in [0., gap.max(0.) as f32, 0.00001] {
                    let mut cache =
                        AxisCache::new(a, sa.as_ref(), b, sb.as_ref(), start, end, margin);
                    assert_eq!(
                        super::super::rotating_box_capsule_separated(
                            &mut cache,
                            rp::Vector::X * n,
                            &mut work()
                        )
                        .unwrap(),
                        shift == 0. && margin == 0.
                    );
                }
            }
        }
    }
}

#[test]
fn complete_capsule_ball_support_removes_rotated_cube_width_without_losing_real_contact() {
    let (a, shape, b, axis) = capsules(false);
    let fa = shaped(a);
    let fb = shaped(b);
    let pa = project(fa.values[0].full_point(rp::Vector::ZERO, 0.25), axis).unwrap();
    let pb = project(fb.values[0].full_point(rp::Vector::ZERO, 0.25), axis).unwrap();
    assert!(
        pb.lo - pa.hi < 0.01,
        "the rotated cube cannot prove this original gap"
    );
    assert!(separated(
        &fa,
        shape.as_ref(),
        &fb,
        shape.as_ref(),
        axis,
        0.01,
        &mut work()
    )
    .unwrap());
    assert!(super::super::separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        axis,
        0.,
        0.025,
        0.01,
        &mut work()
    )
    .unwrap());
    let (inward, shape, target, axis) = capsules(true);
    assert!(!separated(
        &shaped(inward),
        shape.as_ref(),
        &shaped(target),
        shape.as_ref(),
        axis,
        0.01,
        &mut work()
    )
    .unwrap());
    assert!(super::super::super::super::cast(
        inward,
        shape.as_ref(),
        target,
        shape.as_ref(),
        0.,
        0.025,
        0.01,
        1e-6,
        &mut work()
    )
    .unwrap()
    .is_some());
}

#[test]
fn error_enclosure_contains_original_f32_full_ball_and_interior_core_outputs() {
    let points = [
        rp::Vector::new(-0.5, -0.3, 0.2),
        rp::Vector::new(0.8, 0.4, -0.6),
    ];
    let radius = 0.25;
    let axes = [rp::Vector::X, rp::Vector::Y, rp::Vector::new(0.6, -0.8, 0.)];
    let qs = [
        rp::Rotation::from_rotation_y(1.1),
        rp::Rotation::from_xyzw(0., 0., 0., 1.0001),
        rp::Rotation::from_rotation_z(0.0001),
    ];
    let shifts = [
        rp::Vector::ZERO,
        rp::Vector::new(985., -0.1, 0.),
        rp::Vector::splat(10_000.),
    ];
    let directions = [
        [1., 0., 0.],
        [-1., 0., 0.],
        [0., 1., 0.],
        [0., -1., 0.],
        [0., 0., 1.],
        [0., 0., -1.],
    ];
    for q in qs {
        for translation in shifts {
            for axis in axes {
                let frame = Frame::exact(rp::Pose::from_parts(translation, q));
                let bound = projection(
                    frame,
                    &points,
                    radius,
                    axis,
                    radial_scale(frame, axis).unwrap(),
                )
                .unwrap();
                for t in [0., 0.1, 0.5, 0.9, 1.] {
                    for direction in directions {
                        // The probes check the implementation against Native scalar
                        // evaluation; the certificate itself encloses the entire hull
                        // and every real ball direction, not just these test points.
                        let local = rp::Vector::from_array(std::array::from_fn(|i| {
                            let core =
                                f64::from(points[0][i]) * (1. - t) + f64::from(points[1][i]) * t;
                            (core + f64::from(radius) * direction[i]) as f32
                        }));
                        let actual = rp::Pose::from_parts(translation, q) * local;
                        let value = super::super::super::dot(actual, axis);
                        assert!(bound.lo<=value.lo && bound.hi>=value.hi,
                "q={q:?} T={translation:?} t={t} dir={direction:?} bound=[{},{}] value=[{},{}]",bound.lo,bound.hi,value.lo,value.hi);
                    }
                }
            }
        }
    }
    // Keep zero/subnormal and the maximum finite F32 spacing in the error
    // primitive's domain without inventing a larger physical clearance.
    assert_eq!(
        half_ulp(Float::exact(0.)),
        f64::from(f32::from_bits(1)) * 0.5
    );
    assert!(half_ulp(Float::exact(f32::MAX)).is_finite());
    assert!(!Value::local(f32::MAX, f32::MAX).finite());
}

#[test]
fn nonunit_quaternion_and_negative_clearance_do_not_open_a_false_support_gap() {
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let q = rp::Rotation::from_xyzw(0., 0., 0., 1.01);
    let a = motion(Curve::Constant {
        pose: rp::Pose::from_rotation(q),
        start_time: 0.,
        end_time: 0.025,
    });
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_parts(rp::Vector::X * 0.5101, q),
        start_time: 0.,
        end_time: 0.025,
    });
    // Ignoring ||q||² would leave an ideal world-radius gap > .01. The
    // original nonunit pose maps the full local radius farther than that.
    let point_a = a.pose(0.) * (rp::Vector::X * 0.25);
    let point_b = b.pose(0.) * (-rp::Vector::X * 0.25);
    assert!((point_b - point_a).x < 0.01);
    assert!(!separated(
        &shaped(a),
        shape.as_ref(),
        &shaped(b),
        shape.as_ref(),
        rp::Vector::X,
        0.01,
        &mut work()
    )
    .unwrap());
    // Negative clearance uses its full signed norm interval. Worsening a
    // real overlap is never turned into a nonpenetration certificate.
    let c = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * 0.49),
        start_time: 0.,
        end_time: 0.025,
    });
    assert!(!separated(
        &shaped(a),
        shape.as_ref(),
        &shaped(c),
        shape.as_ref(),
        rp::Vector::X,
        -0.001,
        &mut work()
    )
    .unwrap());
}

#[test]
fn tight_support_precharges_original_work_and_preserves_wire_and_frame_census() {
    let (a, shape, b, axis) = capsules(false);
    let fa = shaped(a);
    let fb = shaped(b);
    let before = crate::checkpoint_codec::encode(&(a, b, &shape)).unwrap();
    let mut measured = work();
    assert!(separated(
        &fa,
        shape.as_ref(),
        &fb,
        shape.as_ref(),
        axis,
        0.01,
        &mut measured
    )
    .unwrap());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(separated(
        &fa,
        shape.as_ref(),
        &fb,
        shape.as_ref(),
        axis,
        0.01,
        &mut exact
    )
    .unwrap());
    assert_eq!(exact.used, measured.used);
    assert_eq!(
        separated(
            &fa,
            shape.as_ref(),
            &fb,
            shape.as_ref(),
            axis,
            0.01,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &shape)).unwrap(),
        before
    );
    // Signed-zero/raw-normalization frame multiplicity is not an execution
    // multiplier: one full Cartesian union includes every original frame.
    let merged = union(&fa);
    for frame in &fa.values[..fa.len] {
        for (range, source) in merged.translation.into_iter().zip(frame.translation) {
            assert!(range.lo <= source.lo && range.hi >= source.hi);
        }
        for (range, source) in merged
            .rotation
            .components
            .into_iter()
            .zip(frame.rotation.components)
        {
            assert!(range.lo <= source.lo && range.hi >= source.hi);
        }
    }
    assert!(merged.rotation.exact.is_none());
}

#[test]
fn add_sub_nearest_candidate_bound_contains_sign_swaps_and_subnormals() {
    let tiny = 2_f32.powi(-40);
    let large = Float::span(1., 1_f32.next_up());
    let small = Float::span(tiny, tiny * 2.);
    for (a, b) in [(large, small), (small, large)] {
        for op in [Op::Add, Op::Subtract] {
            let output = match op {
                Op::Add => a.add(b),
                Op::Subtract => a.sub(b),
                Op::Multiply => unreachable!(),
            };
            let bound = rounding(a, b, output, op);
            assert_eq!(bound, f64::from(tiny * 2.));
            assert!(bound < half_ulp(output));
            // These selected dyadics have an exactly representable F64 sum;
            // compare Native RN F32 against the real operation, not a bound
            // computed by reusing the implementation's candidate argument.
            for x in [a.lo, a.hi] {
                for y in [b.lo, b.hi] {
                    let (rounded, real) = match op {
                        Op::Add => (x + y, f64::from(x) + f64::from(y)),
                        Op::Subtract => (x - y, f64::from(x) - f64::from(y)),
                        Op::Multiply => unreachable!(),
                    };
                    assert!((f64::from(rounded) - real).abs() <= bound);
                }
            }
        }
    }
    let subnormal = Float::span(f32::from_bits(1), f32::from_bits(2));
    assert_eq!(
        rounding(large, subnormal, large.add(subnormal), Op::Add),
        f64::from(f32::from_bits(2))
    );
    let overflowing = Float::span(f32::MAX.next_down(), f32::MAX);
    assert!(rounding(
        overflowing,
        overflowing,
        overflowing.add(overflowing),
        Op::Add
    )
    .is_infinite());
    // The candidate proof applies only to represented add/sub operands.
    let x = Float::span(1.0e20, 1.0e20_f32.next_up());
    let y = Float::span(1.0e-10, 2.0e-10);
    assert_eq!(rounding(x, y, x.mul(y), Op::Multiply), half_ulp(x.mul(y)));
}

#[test]
fn candidate_bound_keeps_initial_real_domain_error_and_original_fast_paths() {
    let tiny = 2_f32.powi(-40);
    let input = Value::local(1., tiny);
    assert_eq!(input.error, half_ulp(input.actual));
    assert!(input.error > f64::from(tiny));
    let a = Float::span(1., 2.);
    assert_eq!(rounding(a, Float::ZERO, a.add(Float::ZERO), Op::Add), 0.);
    assert_eq!(
        rounding(a, Float::exact(-1.), a.mul(Float::exact(-1.)), Op::Multiply),
        0.
    );
    let x = Float::exact(1.);
    let y = Float::exact(tiny);
    // Preserve the original singleton outward-measured branch, rather than
    // silently applying the new candidate tightening to real input error.
    let v = Bound::exact(f64::from(x.lo)).add(Bound::exact(f64::from(y.lo)));
    let rounded = f64::from(x.add(y).lo);
    let measured = (rounded - v.lo).abs().max((rounded - v.hi).abs()).next_up();
    assert_eq!(rounding(x, y, x.add(y), Op::Add), measured);
}

#[test]
fn tiny_actual_operands_tighten_full_ball_projection_without_changing_the_point_law() {
    let tiny = 2_f32.powi(-40);
    let small = 2_f32.powi(-30);
    let frame = Frame {
        translation: [Float::ZERO, Float::span(tiny, tiny * 2.), Float::ZERO],
        rotation: Quaternion {
            components: [
                Float::span(small, small * 2.),
                Float::ZERO,
                Float::ZERO,
                Float::exact(1.),
            ],
            exact: None,
        },
    };
    let points = [rp::Vector::ZERO];
    let radius = 0.25;
    let axis = rp::Vector::Y;
    let bound = projection(
        frame,
        &points,
        radius,
        axis,
        radial_scale(frame, axis).unwrap(),
    )
    .unwrap();
    assert!(
        bound.hi < f64::from(radius) + 2.0e-8,
        "projection upper {}",
        bound.hi
    );
    for x in [small, small * 1.5, small * 2.] {
        for y in [tiny, tiny * 2.] {
            let pose =
                rp::Pose::from_parts(rp::Vector::Y * y, rp::Rotation::from_xyzw(x, 0., 0., 1.));
            for p in [rp::Vector::X, rp::Vector::Y, rp::Vector::Z, -rp::Vector::Y] {
                let point = pose * (p * radius);
                assert!(f64::from(point.y) >= bound.lo && f64::from(point.y) <= bound.hi);
            }
        }
    }
}

#[test]
fn ideal_only_cached_transform_keeps_every_original_outward_bound_bit() {
    let (a, shape, b, _) = capsules(false);
    let fa = shaped(a);
    let fb = shaped(b);
    let proxy = ToiProxy::from_shape(shape.as_ref()).unwrap();
    for frames in [&fa, &fb] {
        let frame = union(frames);
        let cached = IdealTransform::new(frame);
        for &p in proxy
            .points()
            .iter()
            .chain([rp::Vector::new(1000., -0.02, 0.03)].iter())
        {
            let original = transform(frame, p.to_array().map(|x| Value::input(Float::exact(x))));
            let current = cached.point(p);
            for (old, new) in original.into_iter().zip(current) {
                assert_eq!(old.ideal.lo.to_bits(), new.lo.to_bits());
                assert_eq!(old.ideal.hi.to_bits(), new.hi.to_bits());
            }
        }
    }
}

#[test]
fn batched_axes_match_original_single_axis_support_and_precharge_only_actual_shared_work() {
    use crate::physics3d::solver_trajectory::SeparationAxes;
    let (a, shape, b, normal) = capsules(false);
    let fa = shaped(a);
    let fb = shaped(b);
    let pa = ToiProxy::from_shape(shape.as_ref()).unwrap();
    let pb = ToiProxy::from_shape(shape.as_ref()).unwrap();
    let normals = [rp::Vector::X, rp::Vector::Z, normal];
    for clearance in [0.01, -0.001] {
        let mut axes = SeparationAxes::single(normals[0]);
        for n in normals.iter().skip(1) {
            axes.push(*n).unwrap();
        }
        let mut legacy_total = 0;
        let mut legacy_first = 0;
        for (i, axis) in axes.values[..axes.len].iter().enumerate() {
            let mut old = work();
            let expected = separated_reference(
                &fa,
                shape.as_ref(),
                &fb,
                shape.as_ref(),
                axis.normal,
                clearance,
                &mut old,
            )
            .unwrap();
            legacy_total += old.used;
            if i == 0 {
                legacy_first = old.used;
            }
            // Reserve the old mathematical result in the slot only as a
            // test oracle; the batch resets and computes every result anew.
            assert_eq!(expected, axis.normal == normal);
        }
        let mut actual = work();
        separated_axes(
            &fa,
            &pa,
            &fb,
            &pb,
            &mut axes.values[..axes.len],
            clearance,
            &mut actual,
        )
        .unwrap();
        for axis in &axes.values[..axes.len] {
            let expected = separated_reference(
                &fa,
                shape.as_ref(),
                &fb,
                shape.as_ref(),
                axis.normal,
                clearance,
                &mut work(),
            )
            .unwrap();
            assert_eq!(axis.full_support, Some(expected));
        }
        assert!(actual.used < legacy_total);
        assert!(
            actual.used <= legacy_first,
            "even preparing later axes must fit the former first full-support price"
        );
        let mut exact = Work {
            used: 0,
            limit: actual.used,
        };
        separated_axes(
            &fa,
            &pa,
            &fb,
            &pb,
            &mut axes.values[..axes.len],
            clearance,
            &mut exact,
        )
        .unwrap();
        assert_eq!(exact.used, actual.used);
        assert_eq!(
            separated_axes(
                &fa,
                &pa,
                &fb,
                &pb,
                &mut axes.values[..axes.len],
                clearance,
                &mut Work {
                    used: 0,
                    limit: actual.used - 1
                }
            ),
            Err(TrajectoryError::WorkLimit)
        );
    }
}

#[test]
fn box_sphere_eight_axis_batch_fits_old_first_axis_price_and_keeps_all_original_points() {
    use crate::physics3d::solver_trajectory::{AxisSource, SeparationAxes};
    let a = ShapeMotion {
        curve: Curve::Integrated(integrated(
            rp::Pose::from_rotation(rp::Rotation::from_rotation_z(-0.0005)),
            rp::Vector::ZERO,
            rp::Vector::Z * 0.01,
            0.025,
        )),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::from_translation(rp::Vector::X * 1000.),
    };
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::new(957., -0.1, 0.)),
        start_time: 0.,
        end_time: 0.025,
    });
    let sa = rp::SharedShape::cuboid(100., 0.02, 0.02);
    let sb = rp::SharedShape::ball(0.015);
    let fa = shaped(a);
    let fb = shaped(b);
    let mut axes = SeparationAxes::single(rp::Vector::new(0.00051174307, 1., 0.).normalize());
    axes.source = Some(AxisSource {
        a,
        b,
        box_a: true,
        box_b: false,
        start: 0.,
        right: Some(rp::Vector::Y),
    });
    let mut metadata = work();
    axes.ensure_all(&mut metadata).unwrap();
    assert_eq!(axes.len, 8);
    assert_eq!(metadata.used, 6);
    let pa = ToiProxy::from_shape(sa.as_ref()).unwrap();
    let pb = ToiProxy::from_shape(sb.as_ref()).unwrap();
    assert_eq!(pa.points().len(), 8);
    assert_eq!(pb.points().len(), 1);
    let original = crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap();
    let mut old = work();
    let first = separated_reference(
        &fa,
        sa.as_ref(),
        &fb,
        sb.as_ref(),
        axes.values[0].normal,
        0.005,
        &mut old,
    )
    .unwrap();
    let mut batch = work();
    separated_axes(
        &fa,
        &pa,
        &fb,
        &pb,
        &mut axes.values[..axes.len],
        0.005,
        &mut batch,
    )
    .unwrap();
    assert_eq!(axes.values[0].full_support, Some(first));
    assert!(batch.used + metadata.used <= old.used);
    for axis in &axes.values[..axes.len] {
        let expected = separated_reference(
            &fa,
            sa.as_ref(),
            &fb,
            sb.as_ref(),
            axis.normal,
            0.005,
            &mut work(),
        )
        .unwrap();
        assert_eq!(axis.full_support, Some(expected));
    }
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap(),
        original
    );
}
