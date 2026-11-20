use super::*;
use crate::physics3d::solver_trajectory::Domain;
use rapier3d::pipeline::SolverBodyIntegration;

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn integrated(start: rp::Pose, v: rp::Vector, omega: rp::Vector, h: f32) -> Kernel {
    Kernel::from_native(
        SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            h,
            start,
            v,
            omega,
        )
        .unwrap(),
        Domain::new(0., f64::from(h)).unwrap(),
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
fn contains(frames: &Frames, p: rp::Pose) -> bool {
    frames.values[..frames.len].iter().any(|f| {
        f.rotation
            .components
            .iter()
            .zip(p.rotation.to_array())
            .all(|(r, q)| q.total_cmp(&r.lo).is_ge() && q.total_cmp(&r.hi).is_le())
            && f.translation
                .iter()
                .zip(p.translation.to_array())
                .all(|(r, p)| p >= r.lo && p <= r.hi)
    })
}

#[test]
fn recorded_joint_carrier_plateau_has_complete_output_without_adjacent_dt_parameters() {
    // C13 raw depth48 failure: stored carrier and rider at tick6, unchanged
    // original shapes/skin/kernel, interval [0, 1.4802974433703992e-17].
    let k = integrated(
        rp::Pose::from_translation(rp::Vector::new(0.16666667, -0.20833333, 0.)),
        rp::Vector::new(1.9999998, 0.4999995, 0.),
        rp::Vector::ZERO,
        0.004166667,
    );
    let a = motion(Curve::Integrated(k));
    let b = motion(Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::new(0.0833333, 1.16, 0.),
        offset: rp::Vector::ZERO,
        linear_velocity: rp::Vector::new(0.9999999, 0., 0.),
        rotation: rp::Rotation::IDENTITY,
    });
    let sa = rp::SharedShape::cuboid(10., 0.25, 10.);
    let sb = rp::SharedShape::capsule_y(0.5, 0.4);
    let end = 1.4802974433703992e-17;
    assert!(super::super::Image::new(a.curve, 0., end).is_none());
    assert!(super::super::Image::new(b.curve, 0., end).is_none());
    let initial = super::super::super::leaf_contact(
        &a.pose(0.),
        sa.as_ref(),
        &b.pose(0.),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(initial.dist.to_bits(), 0.010000005_f32.to_bits());
    assert!(initial.dist > 0.01);
    let original = crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap();
    // The complete output image preserves the original Native predicate,
    // but that predicate is not the full-world real-radius clearance oracle.
    // Root's independent exact-RN32 source witness is reproduced from the
    // original local points below, without the new production helper.
    let cuboid = sa.as_cuboid().unwrap();
    let capsule = sb.as_capsule().unwrap();
    let Curve::Anchored { anchor, .. } = b.curve else {
        unreachable!()
    };
    let local_point = rp::Vector::new(anchor.x, cuboid.half_extents.y, 0.);
    assert!(local_point.cmpge(-cuboid.half_extents).all());
    assert!(local_point.cmple(cuboid.half_extents).all());
    for at in [0., end] {
        let pa = a.pose(at);
        let pb = b.pose(at);
        let native =
            super::super::super::leaf_contact(&pa, sa.as_ref(), &pb, sb.as_ref(), &mut work())
                .unwrap();
        assert_eq!(native.dist.to_bits(), initial.dist.to_bits());
        for (left, right) in [
            (native.point1, initial.point1),
            (native.point2, initial.point2),
            (native.normal1, initial.normal1),
            (native.normal2, initial.normal2),
        ] {
            assert_eq!(
                left.to_array().map(f32::to_bits),
                right.to_array().map(f32::to_bits)
            );
        }
        let point = pa * local_point;
        let core = pb * capsule.segment.a;
        assert_eq!(
            point.to_array().map(f32::to_bits),
            [0x3e7f_fffe, 0x3d2a_aaac, 0]
        );
        assert_eq!(
            core.to_array().map(f32::to_bits),
            [0x3e7f_fffe, 0x3ee7_40da, 0]
        );
        assert_eq!(point.x.to_bits(), core.x.to_bits());
        assert_eq!(point.z.to_bits(), core.z.to_bits());
        // This exact dyadic difference has an exactly representable square:
        // numerator < 2^53 and denominator 2^52. Independent outward squared
        // comparison proves a point in the original box is inside r+skin.
        let dy = f64::from(core.y) - f64::from(point.y);
        assert_eq!(dy, 0.409_999_981_522_560_1);
        let squared = dy * dy;
        assert_eq!(squared, 757_055_029_124_689_f64 / 4_503_599_627_370_496_f64);
        let radius = f64::from(capsule.radius);
        let threshold_lower = (radius + f64::from(0.01_f32)).next_down();
        assert!(squared.next_up() < (threshold_lower * threshold_lower).next_down());
        // Sterbenz applies to these positive operands; the real gap is exact.
        assert!(dy <= 2. * radius && radius <= 2. * dy);
        let real_gap = dy - radius;
        assert_eq!(real_gap, 0.009_999_975_562_095_642);
        assert!(real_gap < f64::from(0.01_f32));
    }
    let mut measured = work();
    assert!(!separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        rp::Vector::Y,
        0.,
        end,
        0.01,
        &mut measured
    )
    .unwrap());
    let fa = frames(a.curve, 0., end, &mut work()).unwrap().unwrap();
    let fb = frames(b.curve, 0., end, &mut work()).unwrap().unwrap();
    assert_eq!(poses(&fa, &mut work()).unwrap().unwrap().len, 1);
    assert_eq!(poses(&fb, &mut work()).unwrap().unwrap().len, 1);
    assert!(contains(&fa, a.curve.com_pose(end)) && contains(&fb, b.curve.com_pose(end)));
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(!separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        rp::Vector::Y,
        0.,
        end,
        0.01,
        &mut exact
    )
    .unwrap());
    assert_eq!(exact.used, measured.used);
    assert_eq!(
        separated(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::Y,
            0.,
            end,
            0.01,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap(),
        original
    );
    // Strict query must report the independently witnessed original real
    // contact at the start. A Native-only clear image grants no world NoHit.
    let hit = super::super::super::cast(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        0.,
        end,
        0.01,
        4.1666670114182125e-9,
        &mut work(),
    )
    .unwrap()
    .expect("the original real-radius contact exists at the unchanged start");
    assert_eq!(hit.safe_time.to_bits(), 0_f64.to_bits());
    assert_eq!(hit.hit_time.to_bits(), 0_f64.to_bits());
    assert!(hit.contact.dist < 0.01);
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap(),
        original
    );
}

#[test]
fn tangent_output_can_have_many_values_while_the_complete_normal_projection_is_constant() {
    let k = integrated(
        rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        0.007,
    );
    let a = motion(Curve::Integrated(k));
    let b = motion(Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::new(0., 0.8601, 0.),
        offset: rp::Vector::ZERO,
        linear_velocity: rp::Vector::X,
        rotation: rp::Rotation::IDENTITY,
    });
    let sa = rp::SharedShape::cuboid(20., 0.1, 20.);
    let sb = rp::SharedShape::capsule_y(0.5, 0.25);
    let end = k.domain.end;
    let fb = frames(b.curve, 0., end, &mut work()).unwrap().unwrap();
    assert!(poses(&fb, &mut work()).unwrap().is_none());
    assert!(fb.values[..fb.len]
        .iter()
        .all(|f| f.translation[1].lo.to_bits() == f.translation[1].hi.to_bits()));
    assert!(separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        rp::Vector::Y,
        0.,
        end,
        0.01,
        &mut work()
    )
    .unwrap());
    // A real normal descent across the original skin must not inherit that
    // proof merely because its endpoints have the same orientation.
    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        rotation,
        ..
    } = b.curve
    else {
        unreachable!()
    };
    let falling = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor,
            offset,
            rotation,
            linear_velocity: rp::Vector::new(1., -1., 0.),
        },
        ..b
    };
    assert!(!separated(
        a,
        sa.as_ref(),
        falling,
        sb.as_ref(),
        rp::Vector::Y,
        0.,
        end,
        0.01,
        &mut work()
    )
    .unwrap());
}

#[test]
fn output_image_keeps_stored_and_normalized_interior_rotations_as_distinct_branches() {
    let q = rp::Rotation::from_xyzw(0., 0., 0.17696935, 0.98421645);
    let k = integrated(
        rp::Pose::from_parts(rp::Vector::ZERO, q),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        0.022729555,
    );
    let end = 8.0751601476358e-17;
    assert_ne!(
        k.native.motion.start.rotation.to_array().map(f32::to_bits),
        k.position_at_time(end)
            .rotation
            .to_array()
            .map(f32::to_bits)
    );
    let complete = kernel(k, 0., end, &mut work()).unwrap().unwrap();
    let all = poses(&complete, &mut work()).unwrap().unwrap();
    assert_eq!(all.len, 2);
    assert!(contains(&complete, k.position_at_time(0.)));
    assert!(contains(&complete, k.position_at_time(end)));
    // Logical interior can round its physical dt all the way to h: retain the
    // stored endpoint rather than silently normalizing it a second time.
    let end_frames = kernel(k, k.domain.end.next_down(), k.domain.end, &mut work())
        .unwrap()
        .unwrap();
    assert!(contains(&end_frames, k.native.motion.end));
}

#[test]
fn every_original_f32_dt_in_a_large_input_image_is_covered_by_constant_outputs() {
    let lo = 0.001_f32;
    let hi = f32::from_bits(lo.to_bits() + 1024);
    let k = integrated(
        rp::Pose::from_translation(rp::Vector::splat(1000.)),
        rp::Vector::splat(0.001),
        rp::Vector::ZERO,
        0.01,
    );
    let start = f64::from(lo);
    let end = f64::from(hi);
    assert!(super::super::Parameter::image(k.local_delta(start), k.local_delta(end)).is_none());
    let complete = kernel(k, start, end, &mut work()).unwrap().unwrap();
    for bits in lo.to_bits()..=hi.to_bits() {
        assert!(contains(
            &complete,
            k.native.position_at_integration_time(f32::from_bits(bits))
        ));
    }
    assert_eq!(poses(&complete, &mut work()).unwrap().unwrap().len, 1);
}

#[test]
fn anchored_local_frames_and_ccd_use_original_noncommuting_operation_order() {
    let k = integrated(
        rp::Pose::from_parts(
            rp::Vector::new(7., 8., 9.),
            rp::Rotation::from_rotation_z(0.7),
        ),
        rp::Vector::new(0.3, 0.4, 0.5),
        rp::Vector::Z * 2.,
        0.01,
    );
    let start = 0.003_f32;
    let end = start.next_up();
    let a = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::new(0.7, 0.8, 0.9),
            offset: rp::Vector::new(0.1, 0.2, 0.3),
            linear_velocity: rp::Vector::new(-0.4, 0.5, 0.6),
            rotation: rp::Rotation::from_rotation_y(0.4),
        },
        local_center: rp::Vector::new(0.01, 0.02, 0.03),
        local_pose: rp::Pose::from_parts(
            rp::Vector::new(0.4, 0.3, 0.2),
            rp::Rotation::from_rotation_x(0.2),
        ),
    };
    let sweep = rapier3d::parry::query::sweep_toi::Sweep::from_poses(
        &k.native.motion.start,
        &k.native.motion.end,
        rp::Vector::new(0.1, 0.2, 0.3),
    );
    let b = ShapeMotion {
        curve: Curve::Ccd {
            sweep,
            start_time: 0.,
            end_time: k.domain.end,
        },
        ..a
    };
    for m in [a, b] {
        let Some(mut output) =
            frames(m.curve, f64::from(start), f64::from(end), &mut work()).unwrap()
        else {
            // A wide raw quaternion Cartesian is intentionally a fallback.
            // Pin the same check to a true complete singleton output instead.
            let t = f64::from(start);
            let mut output = frames(m.curve, t, t, &mut work()).unwrap().unwrap();
            output.shape(m);
            assert!(contains(&output, m.pose(t)));
            continue;
        };
        output.shape(m);
        for t in [
            f64::from(start),
            f64::from(start) + (f64::from(end) - f64::from(start)) * 0.5,
            f64::from(end),
        ] {
            assert!(contains(&output, m.pose(t)));
            for v in [rp::Vector::ZERO, rp::Vector::new(0.2, -0.3, 0.4)] {
                let point = m.pose(t) * v;
                assert!(output.values[..output.len].iter().any(|f| f
                    .point(v)
                    .iter()
                    .zip(point.to_array())
                    .all(|(r, p)| p >= r.lo && p <= r.hi)));
            }
        }
    }
}

#[test]
fn cross_zero_images_fallback_without_omitting_either_zero_bit_pattern() {
    let tiny = f32::from_bits(1);
    for (lo, hi) in [(-tiny, 0.), (-0., tiny)] {
        let input = Float::span(lo, hi);
        assert!(input.image().is_none());
        let mut raw = Frames::new();
        assert!(raw
            .normalized(
                [input, Float::ZERO, Float::ZERO, Float::exact(1.)],
                [Float::ZERO; 3],
                rp::Rotation::IDENTITY,
                &mut work()
            )
            .unwrap());
        assert!(poses(&raw, &mut work()).unwrap().is_none());
        let mut translated = Frames::new();
        translated
            .push(Frame {
                translation: [input, Float::ZERO, Float::ZERO],
                rotation: Quaternion::exact(rp::Rotation::IDENTITY),
            })
            .unwrap();
        assert!(poses(&translated, &mut work()).unwrap().is_none());
    }
    for (lo, hi) in [(-tiny, -0.), (-0., 0.), (0., tiny)] {
        let image = Float::span(lo, hi).image().unwrap();
        assert_eq!(image.len, 2);
        assert_eq!(image.values[0].to_bits(), lo.to_bits());
        assert_eq!(image.values[1].to_bits(), hi.to_bits());
    }
}

#[test]
fn radial_support_encloses_original_local_radius_then_actual_nonunit_rotation_output() {
    // Original stored q from C13: native normalization changes its bits.
    // R(q,localRadius) cannot be replaced by an ideal world radius r.
    let q = rp::Rotation::from_xyzw(0., 0., 0.17696935, 0.98421645);
    let frame = Frame::exact(rp::Pose::from_parts(rp::Vector::new(7., 8., 9.), q));
    let radius = 0.4;
    for point in [rp::Vector::ZERO, rp::Vector::Y * 0.5, -rp::Vector::Y * 0.5] {
        let range = frame.full_point(point, radius);
        for axis in [
            rp::Vector::X,
            -rp::Vector::X,
            rp::Vector::Y,
            -rp::Vector::Y,
            rp::Vector::Z,
            -rp::Vector::Z,
            rp::Vector::new(1., 1., 1.).normalize(),
        ] {
            let actual = q * (point + axis * radius) + rp::Vector::new(7., 8., 9.);
            assert!(range
                .iter()
                .zip(actual.to_array())
                .all(|(r, p)| p >= r.lo && p <= r.hi));
        }
    }
    // A true overlap is not made safe by the larger conservative enclosure.
    let a = motion(Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: 0.,
        end_time: 0.01,
    });
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_rotation(q),
        start_time: 0.,
        end_time: 0.01,
    });
    let sphere = rp::SharedShape::ball(radius);
    assert!(!separated(
        a,
        sphere.as_ref(),
        b,
        sphere.as_ref(),
        rp::Vector::X,
        0.,
        0.01,
        0.01,
        &mut work()
    )
    .unwrap());
}

fn incoming_kernel() -> Kernel {
    integrated(
        rp::Pose::from_parts(
            rp::Vector::new(0.50999486, 0., 0.),
            rp::Rotation::from_xyzw(0., 7.016773e-7, -1.6851584e-13, 1.),
        ),
        rp::Vector::new(-5.066886, 0., 0.),
        rp::Vector::new(0., 1.3650216, -3.2782555e-7),
        0.0127497455_f64 as f32,
    )
}

#[test]
fn recorded_incoming_many_raw_outputs_share_proven_native_norm_and_support_only_bounds() {
    let k = incoming_kernel();
    let lo = 3.6769133e-5_f64 as f32;
    let hi = 3.69636787e-5_f64 as f32;
    let original = crate::checkpoint_codec::encode(&k).unwrap();
    let complete = kernel(k, f64::from(lo), f64::from(hi), &mut work())
        .unwrap()
        .unwrap();
    assert!(complete.values[..complete.len]
        .iter()
        .any(|f| f.rotation.exact.is_none()));
    // All these actual raw states have the same native F32 norm² although
    // there are tens of thousands of distinct dt/raw-quaternion states.
    assert!(hi.to_bits() - lo.to_bits() > 1024);
    for bits in lo.to_bits()..=hi.to_bits() {
        let dt = f32::from_bits(bits);
        let hang = k.native.angular_velocity * (dt * 0.5);
        let raw =
            rp::Rotation::from_xyzw(hang.x, hang.y, hang.z, 1.) * k.native.motion.start.rotation;
        assert_eq!(raw.length_squared().to_bits(), 1_f32.to_bits());
        assert!(contains(
            &complete,
            k.native.position_at_integration_time(dt)
        ));
    }
    assert!(poses(&complete, &mut work()).unwrap().is_none());
    // The support consumer is active without pretending that the bounded
    // quaternion is one of finitely enumerated exact pose states.
    let a = motion(Curve::Integrated(k));
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * 3.),
        start_time: k.domain.start,
        end_time: k.domain.end,
    });
    let cube = rp::SharedShape::cuboid(0.25, 0.25, 0.25);
    let mut measured = work();
    assert!(separated(
        a,
        cube.as_ref(),
        b,
        cube.as_ref(),
        rp::Vector::X,
        f64::from(lo),
        f64::from(hi),
        0.01,
        &mut measured
    )
    .unwrap());
    assert!(separated(
        a,
        cube.as_ref(),
        b,
        cube.as_ref(),
        rp::Vector::X,
        f64::from(lo),
        f64::from(hi),
        0.01,
        &mut Work {
            used: 0,
            limit: measured.used
        }
    )
    .unwrap());
    assert_eq!(
        separated(
            a,
            cube.as_ref(),
            b,
            cube.as_ref(),
            rp::Vector::X,
            f64::from(lo),
            f64::from(hi),
            0.01,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(crate::checkpoint_codec::encode(&k).unwrap(), original);
}

#[test]
fn singleton_norm_rejects_variable_nonfinite_zero_and_nonmatching_sample_norms() {
    let cases = [
        (
            [
                Float::span(0.1, 0.2),
                Float::ZERO,
                Float::ZERO,
                Float::exact(1.),
            ],
            rp::Rotation::from_xyzw(0.1, 0., 0., 1.),
        ),
        (
            [
                Float::exact(f32::NAN),
                Float::ZERO,
                Float::ZERO,
                Float::exact(1.),
            ],
            rp::Rotation::IDENTITY,
        ),
        (
            [
                Float::exact(f32::MAX),
                Float::ZERO,
                Float::ZERO,
                Float::exact(1.),
            ],
            rp::Rotation::IDENTITY,
        ),
        ([Float::ZERO; 4], rp::Rotation::from_xyzw(0., 0., 0., 0.)),
        (
            [
                Float::span(0.00001, 0.00002),
                Float::ZERO,
                Float::ZERO,
                Float::exact(1.),
            ],
            rp::Rotation::IDENTITY,
        ),
    ];
    for (raw, sample) in cases {
        let mut out = Frames::new();
        assert!(!out
            .singleton_norm(raw, [Float::ZERO; 3], sample, &mut work())
            .unwrap());
        assert_eq!(out.len, 0);
    }
}

#[test]
fn bounded_normalization_uses_original_physical_dt_with_distinct_logical_domain_and_stored_endpoints(
) {
    let mut k = incoming_kernel();
    let h = f64::from(k.native.integration_seconds);
    k.domain = Domain::new(0.03125, 0.03125 + h * 2.).unwrap();
    let physical = [3.6769133e-5_f64, 3.69636787e-5_f64];
    let logical = physical.map(|dt| k.domain.start + (dt / h) * k.domain.duration());
    let f = kernel(k, logical[0], logical[1], &mut work())
        .unwrap()
        .unwrap();
    assert!(f.values[..f.len].iter().any(|q| q.rotation.exact.is_none()));
    for t in [
        logical[0],
        logical[0] + (logical[1] - logical[0]) * 0.5,
        logical[1],
    ] {
        assert!(contains(&f, k.position_at_time(t)));
    }
    let begin = kernel(k, k.domain.start, k.domain.start, &mut work())
        .unwrap()
        .unwrap();
    let end = kernel(k, k.domain.end, k.domain.end, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(
        crate::checkpoint_codec::encode(&poses(&begin, &mut work()).unwrap().unwrap().values[0])
            .unwrap(),
        crate::checkpoint_codec::encode(&k.native.motion.start).unwrap()
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&poses(&end, &mut work()).unwrap().unwrap().values[0])
            .unwrap(),
        crate::checkpoint_codec::encode(&k.native.motion.end).unwrap()
    );
}

#[test]
fn world_scalar_ball_support_has_no_rotated_cube_floor_and_checks_native_fallback() {
    let q = rp::Rotation::from_rotation_z(0.7);
    let k = integrated(
        rp::Pose::from_rotation(q),
        rp::Vector::Z,
        rp::Vector::ZERO,
        0.001,
    );
    let a = motion(Curve::Integrated(k));
    let axis = rp::Vector::new(0.6, 0.8, 0.);
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_parts(axis * 0.211, q),
        start_time: 0.,
        end_time: k.domain.end,
    });
    let ball = rp::SharedShape::ball(0.1);
    let mut fa = frames(a.curve, 0., k.domain.end, &mut work())
        .unwrap()
        .unwrap();
    fa.shape(a);
    let mut fb = frames(b.curve, 0., k.domain.end, &mut work())
        .unwrap()
        .unwrap();
    fb.shape(b);
    assert!(poses(&fa, &mut work()).unwrap().is_none());
    // Cube overlap does not shrink with the time interval. Both original
    // balls nevertheless have >skin gap, even with many tangent outputs.
    let cube_a = project(fa.values[0].full_point(rp::Vector::ZERO, 0.1), axis).unwrap();
    let cube_b = project(fb.values[0].full_point(rp::Vector::ZERO, 0.1), axis).unwrap();
    assert!(cube_b.lo - cube_a.hi < 0.01);
    assert!(
        radial::world_scalar(&fa, ball.as_ref(), &fb, ball.as_ref(), 0.01, &mut work()).unwrap()
    );
    assert!(separated(
        a,
        ball.as_ref(),
        b,
        ball.as_ref(),
        axis,
        0.,
        k.domain.end,
        0.01,
        &mut work()
    )
    .unwrap());
    // Do not assume that the native fallback's relative metric equals the
    // primary world-scalar metric for a rounded nonunit stored quaternion.
    let small_q = rp::Rotation::from_xyzw(0., 0., 0., 0.9999999);
    let c = motion(Curve::Constant {
        pose: rp::Pose::from_rotation(small_q),
        start_time: 0.,
        end_time: 0.01,
    });
    let d = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * 0.21000001),
        start_time: 0.,
        end_time: 0.01,
    });
    let primary = super::super::super::leaf_contact(
        &c.pose(0.),
        ball.as_ref(),
        &d.pose(0.),
        ball.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(primary.dist > 0.01);
    let fc = frames(c.curve, 0., 0.01, &mut work()).unwrap().unwrap();
    let fd = frames(d.curve, 0., 0.01, &mut work()).unwrap().unwrap();
    assert!(
        !radial::world_scalar(&fc, ball.as_ref(), &fd, ball.as_ref(), 0.01, &mut work()).unwrap()
    );
}

fn oblique_face_pair(
    normal_velocity: f32,
) -> (ShapeMotion, rp::SharedShape, ShapeMotion, rp::SharedShape) {
    let q = rp::Rotation::from_rotation_y(0.5);
    let n = (q * rp::Vector::X).normalize();
    let box_motion = motion(Curve::Constant {
        pose: rp::Pose::from_rotation(q),
        start_time: 0.,
        end_time: 0.001,
    });
    let capsule_motion = motion(Curve::Integrated(integrated(
        rp::Pose::from_translation(n * 1.2601),
        rp::Vector::Y + n * normal_velocity,
        rp::Vector::ZERO,
        0.001,
    )));
    (
        box_motion,
        rp::SharedShape::cuboid(1., 1., 1.),
        capsule_motion,
        rp::SharedShape::capsule_y(0.25, 0.25),
    )
}

#[test]
fn oblique_local_radius_uses_all_proven_face_normals_and_preserves_real_skin_crossing() {
    let (a, sa, b, sb) = oblique_face_pair(0.);
    let mut fa = frames(a.curve, 0., 0.001, &mut work()).unwrap().unwrap();
    fa.shape(a);
    let mut fb = frames(b.curve, 0., 0.001, &mut work()).unwrap().unwrap();
    fb.shape(b);
    assert!(poses(&fb, &mut work()).unwrap().is_none());
    let n = (a.pose(0.).rotation * rp::Vector::X).normalize();
    assert!(radial::local_face(&fa, sa.as_ref(), &fb, sb.as_ref(), 0.01, &mut work()).unwrap());
    assert!(separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        n,
        0.,
        0.001,
        0.01,
        &mut work()
    )
    .unwrap());
    for t in [0., 0.0005, 0.001] {
        let c = super::super::super::leaf_contact(
            &a.pose(t),
            sa.as_ref(),
            &b.pose(t),
            sb.as_ref(),
            &mut work(),
        )
        .unwrap();
        assert!(c.dist > 0.01);
    }
    let (a, sa, b, sb) = oblique_face_pair(-1.);
    let mut fa = frames(a.curve, 0., 0.001, &mut work()).unwrap().unwrap();
    fa.shape(a);
    let mut fb = frames(b.curve, 0., 0.001, &mut work()).unwrap().unwrap();
    fb.shape(b);
    assert!(!radial::local_face(&fa, sa.as_ref(), &fb, sb.as_ref(), 0.01, &mut work()).unwrap());
    assert!(!separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        n,
        0.,
        0.001,
        0.01,
        &mut work()
    )
    .unwrap());
}

#[test]
fn radial_graph_certificate_precharges_exact_work_and_keeps_original_codec_bytes() {
    let (a, sa, b, sb) = oblique_face_pair(0.);
    let original = crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap();
    let n = (a.pose(0.).rotation * rp::Vector::X).normalize();
    let mut measured = work();
    assert!(separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        n,
        0.,
        0.001,
        0.01,
        &mut measured
    )
    .unwrap());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(separated(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        n,
        0.,
        0.001,
        0.01,
        &mut exact
    )
    .unwrap());
    assert_eq!(exact.used, measured.used);
    assert_eq!(
        separated(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            n,
            0.,
            0.001,
            0.01,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap(),
        original
    );
}

#[test]
fn sequential_world_radius_rounding_cannot_fall_through_to_cube_clearance() {
    // The exact plane gap is 2^-16, but sequential F32 radius subtraction
    // gives zero. A positive clearance below that ideal gap must still hit.
    // At clearance zero this same nonnegative image is a valid closed-set
    // certificate, exactly like the original initial-touch/outgoing policy.
    let ra = 2_f32.powi(-11);
    let rb = 2_f32.powi(13);
    let clearance = 2_f32.powi(-17);
    let a = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * -(ra + 2_f32.powi(-16))),
        start_time: 0.,
        end_time: 0.01,
    });
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * rb),
        start_time: 0.,
        end_time: 0.01,
    });
    let sa = rp::SharedShape::ball(ra);
    let sb = rp::SharedShape::ball(rb);
    let delta = b.pose(0.).translation - a.pose(0.).translation;
    assert!(delta.length() - (ra + rb) > clearance);
    assert_eq!((delta.length() - ra) - rb, 0.);
    let actual = super::super::super::leaf_contact(
        &a.pose(0.),
        sa.as_ref(),
        &b.pose(0.),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(actual.dist, 0.);
    let mut fa = frames(a.curve, 0., 0.01, &mut work()).unwrap().unwrap();
    let mut fb = frames(b.curve, 0., 0.01, &mut work()).unwrap().unwrap();
    fa.shape(a);
    fb.shape(b);
    let ca = project(fa.values[0].full_point(rp::Vector::ZERO, ra), rp::Vector::X).unwrap();
    let cb = project(fb.values[0].full_point(rp::Vector::ZERO, rb), rp::Vector::X).unwrap();
    assert!(
        cb.lo - ca.hi > f64::from(clearance),
        "old ideal cube-plane proof would accept"
    );
    for margin in [clearance, 0.] {
        let nonpenetrating = margin == 0.;
        assert_eq!(
            radial::world_scalar(&fa, sa.as_ref(), &fb, sb.as_ref(), margin, &mut work()).unwrap(),
            nonpenetrating
        );
        assert_eq!(
            separated(
                a,
                sa.as_ref(),
                b,
                sb.as_ref(),
                rp::Vector::X,
                0.,
                0.01,
                margin,
                &mut work()
            )
            .unwrap(),
            nonpenetrating
        );
        assert_eq!(
            a.separated(
                sa.as_ref(),
                b,
                sb.as_ref(),
                rp::Vector::X,
                0.,
                0.01,
                margin,
                &mut work()
            )
            .unwrap(),
            nonpenetrating
        );
        let hit = super::super::super::cast(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            0.,
            0.01,
            margin,
            1e-8,
            &mut work(),
        )
        .unwrap();
        if nonpenetrating {
            assert!(hit.is_none());
        } else {
            let hit = hit.expect("original primary distance is inside positive clearance");
            assert_eq!(hit.hit_time, 0.);
            assert_eq!(hit.contact.dist, actual.dist);
        }
    }
}

#[test]
fn variable_norm_complete_range_uses_original_normalize_without_claiming_exact_poses() {
    let raw = [
        Float::span(-0.02, 0.03),
        Float::span(0.01, 0.02),
        Float::span(-0.004, 0.005),
        Float::span(0.99, 1.01),
    ];
    assert!(raw.map(Float::image).iter().any(Option::is_none));
    let sample = rp::Rotation::from_array(raw.map(|x| x.lo));
    let mut fast = Frames::new();
    assert!(!fast
        .singleton_norm(raw, [Float::ZERO; 3], sample, &mut work())
        .unwrap());
    let mut output = Frames::new();
    assert!(output
        .normalized(raw, [Float::ZERO; 3], sample, &mut work())
        .unwrap());
    assert_eq!(output.len, 1);
    assert!(output.values[0].rotation.exact.is_none());
    assert!(poses(&output, &mut work()).unwrap().is_none());
    // Cartesian test inputs exercise sign, squared-norm and native rounding
    // changes. Safety uses the complete monotone expression bound, not these
    // test probes or an assumption that their norms happen to be identical.
    let xs = [-0.02, -0., 0., 0.01, 0.03];
    let ys = [0.01, 0.015, 0.02];
    let zs = [-0.004, -0., 0., 0.001, 0.005];
    let ws = [0.99, 1., 1.01];
    for x in xs {
        for y in ys {
            for z in zs {
                for w in ws {
                    let actual = rp::Rotation::from_xyzw(x, y, z, w).normalize();
                    assert!(output.values[0]
                        .rotation
                        .components
                        .iter()
                        .zip(actual.to_array())
                        .all(|(r, v)| v >= r.lo && v <= r.hi));
                }
            }
        }
    }
    for invalid in [
        [Float::ZERO; 4],
        [Float::span(-1., 1.); 4],
        [
            Float::exact(f32::MAX),
            Float::ZERO,
            Float::ZERO,
            Float::exact(1.),
        ],
        [
            Float::exact(f32::NAN),
            Float::ZERO,
            Float::ZERO,
            Float::exact(1.),
        ],
    ] {
        let mut rejected = Frames::new();
        assert!(!rejected
            .normalization_range(invalid, [Float::ZERO; 3], &mut work())
            .unwrap());
        assert_eq!(rejected.len, 0);
    }
}

#[test]
fn variable_norm_range_is_precharged_and_keeps_original_native_payload() {
    let k = incoming_kernel();
    let before = crate::checkpoint_codec::encode(&k).unwrap();
    let raw = [
        Float::span(-0.02, 0.03),
        Float::span(0.01, 0.02),
        Float::span(-0.004, 0.005),
        Float::span(0.99, 1.01),
    ];
    let mut measured = work();
    assert!(Frames::new()
        .normalization_range(raw, [Float::ZERO; 3], &mut measured)
        .unwrap());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(Frames::new()
        .normalization_range(raw, [Float::ZERO; 3], &mut exact)
        .unwrap());
    assert_eq!(exact.used, measured.used);
    let mut rejected = Frames::new();
    assert_eq!(
        rejected.normalization_range(
            raw,
            [Float::ZERO; 3],
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(rejected.len, 0);
    assert_eq!(crate::checkpoint_codec::encode(&k).unwrap(), before);
}

#[test]
fn variable_norm_frame_range_certifies_far_ball_sleep_path_and_rotating_offset() {
    let k = integrated(
        rp::Pose::from_translation(rp::Vector::X * -2.),
        rp::Vector::X * 4.,
        rp::Vector::Z * 0.1,
        1.,
    );
    let a = motion(Curve::Integrated(k));
    let b = motion(Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: 0.,
        end_time: 1.,
    });
    let ball = rp::SharedShape::ball(0.25);
    // Same original rotating Native law as the sleeping-body unit. Its
    // complete raw norm varies over this far-away prefix; no first hit may
    // be invented and no Frame-cap rejection is needed to certify the gap.
    let output = frames(a.curve, 0., 0.25, &mut work()).unwrap().unwrap();
    assert!(output.values[..output.len]
        .iter()
        .any(|f| f.rotation.exact.is_none()));
    assert!(a
        .separated(
            ball.as_ref(),
            b,
            ball.as_ref(),
            rp::Vector::X,
            0.,
            0.25,
            0.,
            &mut work()
        )
        .unwrap());
    let hit = super::super::super::cast(
        a,
        ball.as_ref(),
        b,
        ball.as_ref(),
        0.,
        1.,
        0.,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .expect("real later sleeping-body contact");
    assert!(hit.safe_time > 0.25 && hit.hit_time < 0.5);
    let angle = -std::f32::consts::FRAC_PI_8;
    let k = integrated(
        rp::Pose::from_rotation(rp::Rotation::from_rotation_z(angle)),
        rp::Vector::ZERO,
        rp::Vector::Z * (std::f32::consts::FRAC_PI_4 / 0.1),
        0.025,
    );
    let offset = ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::from_translation(rp::Vector::X * 2.),
    };
    let target = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * 2.035),
        start_time: 0.,
        end_time: k.domain.end,
    });
    let small = rp::SharedShape::ball(0.05);
    let fixed = rp::SharedShape::ball(0.015);
    // Original offset/COM and stored endpoint branches stay in the graph.
    // This interval is comfortably before contact while many normalized
    // quaternion values occur; it must have a full interval certificate.
    assert!(offset
        .separated(
            small.as_ref(),
            target,
            fixed.as_ref(),
            rp::Vector::Y,
            0.,
            0.001,
            0.005,
            &mut work()
        )
        .unwrap());
}

#[test]
fn linear_addition_rounding_cells_cover_binades_sign_zero_subnormal_and_maximum() {
    let constant = |x| Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * x),
        start_time: 0.,
        end_time: 1.,
    };
    let half_min = f64::from(f32::from_bits(1)) * 0.5;
    for range in [
        Float::span(-0., 0.),
        Float::span(-1., 1.),
        Float::exact(f32::from_bits(1)),
        Float::exact(f32::MIN_POSITIVE),
    ] {
        assert_eq!(minimum_half_cell(range), Some(half_min));
    }
    for x in [1., -1.] {
        assert_eq!(minimum_half_cell(Float::exact(x)), Some(2_f64.powi(-25)));
        assert!(linear_com_addition_invisible(
            constant(x),
            rp::Vector::X * 2_f32.powi(-26),
            0.,
            1.,
            1.,
            &mut work()
        )
        .unwrap());
        // The lower adjacent gap at +/-1 is half the upper binade gap.
        // Strictness rejects the tie without relying on the base LSB parity.
        assert!(!linear_com_addition_invisible(
            constant(x),
            rp::Vector::X * 2_f32.powi(-25),
            0.,
            1.,
            1.,
            &mut work()
        )
        .unwrap());
    }
    assert_eq!(
        minimum_half_cell(Float::exact(1_f32.next_up())),
        Some(2_f64.powi(-24))
    );
    for x in [0., -0., f32::MIN_POSITIVE, -f32::MIN_POSITIVE] {
        assert!(!linear_com_addition_invisible(
            constant(x),
            rp::Vector::X * f32::from_bits(1),
            0.,
            1.,
            1.,
            &mut work()
        )
        .unwrap());
        assert!(linear_com_addition_invisible(
            constant(x),
            rp::Vector::ZERO,
            0.,
            1.,
            1.,
            &mut work()
        )
        .unwrap());
    }
    // Numeric zero is deliberately different from a safe-pose bit gate.
    assert_ne!((-0_f32 + 0_f32).to_bits(), (-0_f32).to_bits());
    assert!(linear_com_addition_invisible(
        constant(0.),
        rp::Vector::X * f32::from_bits(1),
        0.,
        1.,
        0.25,
        &mut work()
    )
    .unwrap());
    for x in [f32::MAX, -f32::MAX] {
        let spacing = f64::from(f32::MAX) - f64::from(f32::MAX.next_down());
        assert_eq!(minimum_half_cell(Float::exact(x)), Some(spacing * 0.5));
        assert!(linear_com_addition_invisible(
            constant(x),
            rp::Vector::X * 2_f32.powi(102),
            0.,
            1.,
            1.,
            &mut work()
        )
        .unwrap());
    }
}

#[test]
fn linear_addition_checks_complete_com_range_and_the_separate_elapsed_bound() {
    let k = integrated(
        rp::Pose::from_translation(rp::Vector::X),
        rp::Vector::X * -2.,
        rp::Vector::ZERO,
        1.,
    );
    let rate = rp::Vector::X * 2_f32.powi(-27);
    for t in [0., 1.] {
        let x = k.position_at_time(t).translation.x;
        assert_eq!(
            x + rate.x,
            x,
            "two endpoint checks would miss the zero crossing"
        );
    }
    assert!(!super::super::super::linear_com_addition_invisible(
        Curve::Integrated(k),
        rate,
        0.,
        1.,
        1.,
        &mut work()
    )
    .unwrap());
    let mut carrier = integrated(
        rp::Pose::from_translation(rp::Vector::X),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        0.01,
    );
    carrier.domain = Domain::new(0., 1.).unwrap();
    let anchored = Curve::Anchored {
        carrier,
        anchor: rp::Vector::ZERO,
        offset: rp::Vector::ZERO,
        linear_velocity: rp::Vector::Y * 0.1,
        rotation: rp::Rotation::IDENTITY,
    };
    // The existing curve's logical relative dt is one second, independent of
    // its Native .01 physical kernel. Only the supplied *added term* bound
    // changes the conclusion. Caller must supply the correct elapsed bound.
    let rate = rp::Vector::X * 2_f32.powi(-26);
    assert!(linear_com_addition_invisible(anchored, rate, 0., 1., 1., &mut work()).unwrap());
    assert!(!linear_com_addition_invisible(anchored, rate, 0., 1., 2., &mut work()).unwrap());
    assert!(linear_com_addition_invisible(anchored, rate, 0., 1., 0., &mut work()).unwrap());
    // An exact F64 product can be below the cell boundary while the actual
    // native F32 multiplication rounds up to that boundary. Keep strict
    // rejection at the rounded delta, never just the exact real product.
    let cell = 2_f32.powi(-25);
    let up_rate = cell.next_up();
    let elapsed = 1_f32.next_down().next_down();
    assert!(f64::from(up_rate) * f64::from(elapsed) < f64::from(cell));
    assert_eq!((up_rate * elapsed).to_bits(), cell.to_bits());
    assert!(!linear_com_addition_invisible(
        anchored,
        rp::Vector::X * up_rate,
        0.,
        1.,
        elapsed,
        &mut work()
    )
    .unwrap());
    let too_large = rp::Vector::X * 2_f32.powi(-25);
    assert!(linear_com_addition_invisible(
        anchored,
        too_large,
        0.,
        1.,
        carrier.native.integration_seconds,
        &mut work()
    )
    .unwrap());
    assert!(!linear_com_addition_invisible(
        anchored,
        too_large,
        0.,
        1.,
        carrier.domain.duration() as f32,
        &mut work()
    )
    .unwrap());
}

#[test]
fn c19_logged_rotating_side_reference_only_proves_invisible_post_add_not_support_lifetime() {
    let native = SolverBodyIntegration {
        motion: rapier3d::pipeline::SolverBodyMotion {
            body: rp::RigidBodyHandle::from_raw_parts(0, 0),
            start_time: 0.,
            end_time: 0.025,
            start: rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
            end: rp::Pose::from_parts(
                rp::Vector::new(0., -0.1, 0.),
                rp::Rotation::from_xyzw(-3.436501e-12, 0.024992192, -6.907454e-11, 0.9996877),
            ),
        },
        integration_seconds: 0.025,
        linear_velocity: rp::Vector::new(0., -7.3886794e-9, 0.),
        angular_velocity: rp::Vector::new(-2.7500596e-10, 2., -5.5276894e-9),
    };
    let domain = Domain::new(0., 0.02500000037252903).unwrap();
    let carrier = Kernel::from_native(native, domain).unwrap();
    // Exact logged actor was already a SideRef. This is not an invented
    // earlier real-support anchor, which the original log did not retain.
    let actor = Curve::Anchored {
        carrier,
        anchor: rp::Vector::ZERO,
        offset: rp::Vector::new(1., 0.61, 0.),
        linear_velocity: rp::Vector::new(0., -5.527689e-9, 0.),
        rotation: rp::Rotation::IDENTITY,
    };
    let physical = rp::Vector::new(5.9610165e-6, -1.2805685e-8, -1.9999888);
    let geometric_y = -1.2916368e-8_f32;
    let rate = rp::Vector::Y * (physical.y - geometric_y);
    assert!(rate.y > 0.);
    let bound = native.integration_seconds.max(domain.duration() as f32);
    let before = crate::checkpoint_codec::encode(&(actor, physical, rate)).unwrap();
    assert!(super::super::super::linear_com_addition_invisible(
        actor,
        rate,
        domain.start,
        domain.end,
        bound,
        &mut work()
    )
    .unwrap());
    // A physical-velocity Integrated candidate is explicitly derived using
    // the original Native kernel law, rather than called the logged curve.
    let candidate = Kernel::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        domain,
        actor.com_pose(domain.start),
        physical,
        rp::Vector::ZERO,
    )
    .unwrap();
    assert!(linear_com_addition_invisible(
        Curve::Integrated(candidate),
        rate,
        domain.start,
        domain.end,
        bound,
        &mut work()
    )
    .unwrap());
    for t in [
        domain.start,
        domain.start + domain.duration() * 0.5,
        domain.end,
    ] {
        let base = actor.com_pose(t).translation;
        let shifted = base + rate * ((t - domain.start) as f32);
        assert_eq!(base, shifted);
    }
    assert!(!linear_com_addition_invisible(
        actor,
        rp::Vector::Y * 0.01,
        domain.start,
        domain.end,
        bound,
        &mut work()
    )
    .unwrap());
    assert_eq!(
        crate::checkpoint_codec::encode(&(actor, physical, rate)).unwrap(),
        before
    );
}

#[test]
fn linear_addition_precharges_work_and_rejects_invalid_time_and_nonfinite_terms() {
    let curve = Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X),
        start_time: 0.,
        end_time: 1.,
    };
    let rate = rp::Vector::X * 2_f32.powi(-26);
    let mut measured = work();
    assert!(linear_com_addition_invisible(curve, rate, 0., 1., 1., &mut measured).unwrap());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(linear_com_addition_invisible(curve, rate, 0., 1., 1., &mut exact).unwrap());
    assert_eq!(exact.used, measured.used);
    assert_eq!(
        linear_com_addition_invisible(
            curve,
            rate,
            0.,
            1.,
            1.,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    for bound in [-1., f32::INFINITY, f32::NAN] {
        assert_eq!(
            linear_com_addition_invisible(curve, rate, 0., 1., bound, &mut work()),
            Err(TrajectoryError::InvalidTime)
        );
    }
    assert_eq!(
        linear_com_addition_invisible(curve, rate, 1., 0., 1., &mut work()),
        Err(TrajectoryError::InvalidTime)
    );
    assert_eq!(
        linear_com_addition_invisible(curve, rate, 0., 2., 1., &mut work()),
        Err(TrajectoryError::InvalidTime)
    );
    assert_eq!(
        linear_com_addition_invisible(curve, rp::Vector::splat(f32::NAN), 0., 1., 1., &mut work()),
        Err(TrajectoryError::NonFinite)
    );
    assert_eq!(
        linear_com_addition_invisible(
            curve,
            rp::Vector::splat(f32::MAX),
            0.,
            1.,
            f32::MAX,
            &mut work()
        ),
        Err(TrajectoryError::NonFinite)
    );
}

#[test]
fn interval_cache_is_lazy_and_does_not_consume_a_future_axis_error() {
    use crate::physics3d::solver_trajectory::{AxisSource, SeparationAxes};
    let a = motion(Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: 0.,
        end_time: 1.,
    });
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::X * 3.),
        start_time: 0.,
        end_time: 1.,
    });
    let sa = rp::SharedShape::cuboid(0.1, 0.1, 0.1);
    let sb = rp::SharedShape::ball(0.1);
    let mut axes = SeparationAxes::single(rp::Vector::X);
    axes.source = Some(AxisSource {
        a,
        b,
        box_a: true,
        box_b: false,
        start: 0.,
        right: Some(rp::Vector::splat(f32::NAN)),
    });
    let mut cache = AxisCache::new(a, sa.as_ref(), b, sb.as_ref(), 0., 1., 0.01);
    assert!(super::super::separated_cached(0, &mut work(), &mut axes, &mut cache).unwrap());
    assert!(
        !cache.attempted,
        "the original finite-parameter proof needs no output cache"
    );
    assert!(!cache.support_done);
    assert!(
        axes.source.is_some(),
        "a cheap earlier proof must not resolve future faces"
    );
    // An interval-local immutable context is bound when constructed; a
    // separate request gets its own original bounds and caller ledger.
    let mut fresh = AxisCache::new(a, sa.as_ref(), b, sb.as_ref(), 0.25, 0.5, 0.01);
    let mut second = SeparationAxes::single(rp::Vector::X);
    assert!(super::super::separated_cached(0, &mut work(), &mut second, &mut fresh).unwrap());
    assert!(!fresh.attempted);
}

#[test]
fn batched_full_support_defers_future_invalid_normal_until_its_original_stage() {
    use crate::physics3d::solver_trajectory::{AxisSource, SeparationAxes};
    let q = rp::Rotation::from_rotation_y(1.1);
    let normal = rp::Vector::new(0.6, 0., 0.8);
    let a = motion(Curve::Integrated(integrated(
        rp::Pose::from_rotation(q),
        rp::Vector::Y * 0.1,
        rp::Vector::ZERO,
        0.025,
    )));
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_parts(normal * 0.5101, q),
        start_time: 0.,
        end_time: 0.025,
    });
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let mut axes = SeparationAxes::single(normal);
    axes.source = Some(AxisSource {
        a,
        b,
        box_a: false,
        box_b: false,
        start: 0.,
        right: Some(rp::Vector::ZERO),
    });
    let mut cache = AxisCache::new(a, shape.as_ref(), b, shape.as_ref(), 0., 0.025, 0.01);
    assert!(separated_cached(0, &mut work(), &mut axes, &mut cache).unwrap());
    assert!(cache.support_done);
    assert_eq!(axes.len, 2);
    assert_eq!(axes.values[0].full_support, Some(true));
    assert_eq!(axes.values[1].full_support, Some(false));
    // Computing a future axis's projection cannot publish its error before
    // an earlier successful proof. Reaching that axis still checks the
    // original cube/normal stage and propagates its original typed error.
    assert_eq!(
        separated_cached(1, &mut work(), &mut axes, &mut cache),
        Err(TrajectoryError::NonFinite)
    );
}

#[test]
fn exact_unit_axis_closed_support_needs_no_complete_pose_image_or_future_proof() {
    // A real dyadic gap of one: top(A)=1 and bottom(B)=2. Tangential
    // translation has many original F32 outputs, so endpoint-pose equality
    // or a complete finite pose census cannot establish this whole interval.
    let a = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::Y * 0.5),
        start_time: 0.,
        end_time: 1.,
    });
    let b = motion(Curve::Integrated(integrated(
        rp::Pose::from_translation(rp::Vector::Y * 2.5),
        rp::Vector::X * 0.125,
        rp::Vector::ZERO,
        1.,
    )));
    let floor = rp::SharedShape::cuboid(4., 0.5, 4.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let bytes = crate::checkpoint_codec::encode(&(a, b, &floor, &capsule)).unwrap();
    assert!(super::super::Image::new(b.curve, 0., 1.).is_none());
    let mut original_frames = frames(b.curve, 0., 1., &mut work()).unwrap().unwrap();
    original_frames.shape(b);
    assert!(poses(&original_frames, &mut work()).unwrap().is_none());
    let mut cache = AxisCache::new(a, floor.as_ref(), b, capsule.as_ref(), 0., 1., 1.);
    let mut axes = super::super::super::SeparationAxes::single(rp::Vector::Y);
    let mut measured = work();
    assert!(separated_cached(0, &mut measured, &mut axes, &mut cache).unwrap());
    assert!(cache.attempted && !cache.support_done && cache.face.is_none());
    assert!(super::super::super::cast_full_shapes_policy(
        a,
        floor.as_ref(),
        b,
        capsule.as_ref(),
        0.,
        1.,
        1.,
        1e-6,
        &mut work(),
        true,
    )
    .unwrap()
    .is_none());
    // The ordinary cast may also refute an initial closed query witness
    // using a complete nonnegative support certificate for its whole domain.
    assert!(super::super::super::cast_full_shapes(
        a,
        floor.as_ref(),
        b,
        capsule.as_ref(),
        0.,
        1.,
        1.,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .is_none());
    for t in [0., 0.125, 0.5, 1.] {
        let contact = super::super::super::leaf_contact(
            &a.pose(t),
            floor.as_ref(),
            &b.pose(t),
            capsule.as_ref(),
            &mut work(),
        )
        .unwrap();
        assert_eq!(contact.dist, 1.);
        assert_eq!(contact.normal1, rp::Vector::Y);
    }
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(separated(
        a,
        floor.as_ref(),
        b,
        capsule.as_ref(),
        rp::Vector::Y,
        0.,
        1.,
        1.,
        &mut exact
    )
    .unwrap());
    assert_eq!(exact.used, measured.used);
    assert_eq!(
        separated(
            a,
            floor.as_ref(),
            b,
            capsule.as_ref(),
            rp::Vector::Y,
            0.,
            1.,
            1.,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &floor, &capsule)).unwrap(),
        bytes
    );
}

#[test]
fn exact_closed_cube_still_rejects_inward_positive_radius_and_larger_clearance() {
    let a = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::Y * 0.5),
        start_time: 0.,
        end_time: 1.,
    });
    let floor = rp::SharedShape::cuboid(4., 0.5, 4.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    for vy in [0., -0.125] {
        let b = motion(Curve::Integrated(integrated(
            rp::Pose::from_translation(rp::Vector::Y * 2.5),
            rp::Vector::new(0.125, vy, 0.),
            rp::Vector::ZERO,
            1.,
        )));
        let clearance = if vy == 0. { 1_f32.next_up() } else { 1. };
        assert!(!separated(
            a,
            floor.as_ref(),
            b,
            capsule.as_ref(),
            rp::Vector::Y,
            0.,
            1.,
            clearance,
            &mut work()
        )
        .unwrap());
        let end_contact = super::super::super::leaf_contact(
            &a.pose(1.),
            floor.as_ref(),
            &b.pose(1.),
            capsule.as_ref(),
            &mut work(),
        )
        .unwrap();
        assert!(end_contact.dist < clearance);
        if vy < 0. {
            let hit = super::super::super::cast_full_shapes_policy(
                a,
                floor.as_ref(),
                b,
                capsule.as_ref(),
                0.,
                1.,
                clearance,
                1e-6,
                &mut work(),
                true,
            )
            .unwrap()
            .unwrap();
            assert_eq!((hit.safe_time, hit.hit_time), (0., 0.));
        }
    }
}

#[test]
fn normalized_nonunit_ball_cube_keeps_original_world_radius_and_closed_overlap_policy() {
    let c = std::f32::consts::FRAC_1_SQRT_2;
    let high = c.next_up().next_up().next_up();
    let stored = rp::Rotation::from_xyzw(0., 0., high, high);
    assert!((stored.length_squared() - 1.).abs() < 1e-5);
    let floor = rp::SharedShape::cuboid(4., 4., 0.25);
    let sphere = rp::SharedShape::ball(0.5);
    let a = motion(Curve::Constant {
        pose: rp::Pose::from_translation(-rp::Vector::Z * 0.25),
        start_time: 0.,
        end_time: 1.,
    });
    let (start, end) = (0.1, 0.9);
    for (z, clearance, expected_gap, closed) in [
        (0.5, 2_f32.powi(-27), 0., false),
        (0.5, 0., 0., true),
        (0.5_f32.next_down(), 0., -2_f32.powi(-25), false),
    ] {
        // Original Native zero-omega integration normalizes the admitted
        // stored q into (0,0,c,c). Tangential X prevents the bounded pose census.
        assert!(crate::physics3d::types::valid_pose(
            crate::physics3d::Pose {
                position: [0., 0., z],
                rotation: stored.to_array(),
            }
        ));
        let k = integrated(
            rp::Pose::from_parts(rp::Vector::Z * z, stored),
            rp::Vector::X,
            rp::Vector::ZERO,
            1.,
        );
        let b = motion(Curve::Integrated(k));
        let source = crate::checkpoint_codec::encode(&(a, b, &floor, &sphere)).unwrap();
        assert_eq!(k.native.motion.start.rotation.to_array(), stored.to_array());
        for t in [start, 0.5, end] {
            let pose = b.pose(t);
            assert_eq!(pose.rotation.z.to_bits(), c.to_bits());
            assert_eq!(pose.rotation.w.to_bits(), c.to_bits());
            assert!(pose.rotation.length_squared() < 1.);
            let contact = super::super::super::leaf_contact(
                &a.pose(t),
                floor.as_ref(),
                &pose,
                sphere.as_ref(),
                &mut work(),
            )
            .unwrap();
            assert_eq!(contact.dist.to_bits(), expected_gap.to_bits());
        }
        assert!(
            super::super::Image::complete(b.curve, start, end, &mut work())
                .unwrap()
                .is_none()
        );
        let mut image = frames(b.curve, start, end, &mut work()).unwrap().unwrap();
        image.shape(b);
        assert!(poses(&image, &mut work()).unwrap().is_none());
        for frame in &image.values[..image.len] {
            let local_only = add(
                rotate(frame.rotation.components, [Float::span(-0.5, 0.5); 3]),
                frame.translation,
            );
            let old_lower = project(local_only, rp::Vector::Z).unwrap().lo;
            if z == 0.5 {
                assert_eq!(old_lower, f64::from(2_f32.powi(-25)));
                assert!(old_lower > f64::from(2_f32.powi(-27)));
            } else {
                assert_eq!(old_lower, 0.);
            }
            // Original world-radius path has a lower point at expected_gap;
            // the union cannot silently replace it with the shrunken radius.
            let complete = frame.full_point(rp::Vector::ZERO, 0.5);
            assert!(complete[2].lo <= expected_gap);
        }
        assert_eq!(
            separated(
                a,
                floor.as_ref(),
                b,
                sphere.as_ref(),
                rp::Vector::Z,
                start,
                end,
                clearance,
                &mut work()
            )
            .unwrap(),
            closed
        );
        assert_eq!(
            a.separated(
                floor.as_ref(),
                b,
                sphere.as_ref(),
                rp::Vector::Z,
                start,
                end,
                clearance,
                &mut work()
            )
            .unwrap(),
            closed
        );
        let hit = super::super::super::cast(
            a,
            floor.as_ref(),
            b,
            sphere.as_ref(),
            start,
            end,
            clearance,
            1e-6,
            &mut work(),
        )
        .unwrap();
        if closed {
            assert!(hit.is_none());
        } else {
            let hit = hit.expect("actual world-radius shape is inside the original margin");
            assert_eq!((hit.safe_time, hit.hit_time), (start, start));
            assert_eq!(hit.contact.dist.to_bits(), expected_gap.to_bits());
        }
        assert_eq!(
            crate::checkpoint_codec::encode(&(a, b, &floor, &sphere)).unwrap(),
            source
        );
    }
}

#[test]
fn real_world_radius_extent_survives_native_and_f64_sum_rounding_without_widening_exact_gaps() {
    let exact = world_radius_range(Float::exact(2.25), 0.25);
    assert_eq!((exact.lo, exact.hi), (2., 2.5));
    let native_lost = world_radius_range(Float::exact(8192.), 2_f32.powi(-12));
    assert_eq!(8192_f32 - 2_f32.powi(-12), 8192.);
    assert_eq!(8192_f32 + 2_f32.powi(-12), 8192.);
    assert_eq!(native_lost.lo, 8192_f32.next_down());
    assert_eq!(native_lost.hi, 8192_f32.next_up());
    let tiny = f32::from_bits(1);
    assert_eq!(8192_f64 + f64::from(tiny), 8192.);
    assert_eq!(8192_f64 - f64::from(tiny), 8192.);
    let unrounded = real_float_sum(8192., tiny);
    assert!(unrounded.lo < 8192. && unrounded.hi > 8192.);
    let f64_lost = world_radius_range(Float::exact(8192.), tiny);
    assert_eq!(f64_lost.lo, 8192_f32.next_down());
    assert_eq!(f64_lost.hi, 8192_f32.next_up());
    for (core, radius) in [
        (Float::exact(f32::NAN), 0.5),
        (Float::exact(1.), f32::INFINITY),
        (Float::exact(f32::MAX), f32::MAX),
    ] {
        assert!(!world_radius_range(core, radius).finite());
    }
}

#[test]
fn world_radius_overlap_smaller_than_one_coordinate_ulp_is_not_a_closed_certificate() {
    let c = std::f32::consts::FRAC_1_SQRT_2
        .next_up()
        .next_up()
        .next_up();
    let stored = rp::Rotation::from_xyzw(0., 0., c, c);
    let a = motion(Curve::Constant {
        pose: rp::Pose::from_translation(rp::Vector::Z * 8191.5),
        start_time: 0.,
        end_time: 1.,
    });
    let b = motion(Curve::Integrated(integrated(
        rp::Pose::from_parts(rp::Vector::Z * 8192., stored),
        rp::Vector::X,
        rp::Vector::ZERO,
        1.,
    )));
    let radius = 2_f32.powi(-12);
    let floor = rp::SharedShape::cuboid(4., 4., 0.5);
    let sphere = rp::SharedShape::ball(radius);
    let (start, end) = (0.1, 0.9);
    let source = crate::checkpoint_codec::encode(&(a, b, &floor, &sphere)).unwrap();
    assert!(
        super::super::Image::complete(b.curve, start, end, &mut work())
            .unwrap()
            .is_none()
    );
    let mut image = frames(b.curve, start, end, &mut work()).unwrap().unwrap();
    image.shape(b);
    assert!(poses(&image, &mut work()).unwrap().is_none());
    for frame in &image.values[..image.len] {
        let local = add(
            rotate(frame.rotation.components, [Float::span(-radius, radius); 3]),
            frame.translation,
        );
        let rounded_world = add(
            frame.point(rp::Vector::ZERO),
            [Float::span(-radius, radius); 3],
        );
        assert_eq!((local[2].lo, local[2].hi), (8192., 8192.));
        assert_eq!((rounded_world[2].lo, rounded_world[2].hi), (8192., 8192.));
        assert!(frame.full_point(rp::Vector::ZERO, radius)[2].lo < 8192.);
    }
    for t in [start, 0.5, end] {
        let contact = super::super::super::leaf_contact(
            &a.pose(t),
            floor.as_ref(),
            &b.pose(t),
            sphere.as_ref(),
            &mut work(),
        )
        .unwrap();
        assert_eq!(contact.dist, -radius);
    }
    assert!(!separated(
        a,
        floor.as_ref(),
        b,
        sphere.as_ref(),
        rp::Vector::Z,
        start,
        end,
        0.,
        &mut work()
    )
    .unwrap());
    assert!(!a
        .separated(
            floor.as_ref(),
            b,
            sphere.as_ref(),
            rp::Vector::Z,
            start,
            end,
            0.,
            &mut work()
        )
        .unwrap());
    let hit = super::super::super::cast(
        a,
        floor.as_ref(),
        b,
        sphere.as_ref(),
        start,
        end,
        0.,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!((hit.safe_time, hit.hit_time), (start, start));
    assert_eq!(hit.contact.dist, -radius);
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &floor, &sphere)).unwrap(),
        source
    );
}
