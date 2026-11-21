use super::*;
use crate::physics3d::solver_trajectory::{Domain, Kernel};

fn budget() -> Work {
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
fn integrated(
    start: rp::Pose,
    velocity: rp::Vector,
    angular: rp::Vector,
    domain: Domain,
    h: f32,
) -> ShapeMotion {
    let native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
        rp::RigidBodyHandle::invalid(),
        0.,
        h,
        start,
        velocity,
        angular,
    )
    .unwrap();
    motion(Curve::Integrated(
        Kernel::from_native(native, domain).unwrap(),
    ))
}
fn stationary(pose: rp::Pose, start: Time, end: Time) -> ShapeMotion {
    motion(Curve::Constant {
        pose,
        start_time: start,
        end_time: end,
    })
}

#[test]
fn lossless_native_outputs_compress_millions_of_dt_inputs_without_sampling() {
    let d = Domain::new(0., 0.03125).unwrap();
    let a = integrated(
        rp::Pose::from_translation(rp::Vector::X * 65536.),
        rp::Vector::X * 0.000001,
        rp::Vector::ZERO,
        d,
        0.03125,
    );
    let b = integrated(
        rp::Pose::from_translation(rp::Vector::X * 65537.),
        rp::Vector::X * 0.000001,
        rp::Vector::ZERO,
        d,
        0.03125,
    );
    assert!(Image::new(a.curve, d.start, d.end).is_none());
    let model = Model::new(a.curve, d.start, d.end).unwrap();
    assert!(model.compressed);
    assert_eq!(model.change_bound(d.start, d.end).unwrap(), 2);
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let source = postcard::to_allocvec(&(a, b)).unwrap();
    assert!(separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        d.start,
        d.end,
        0.01,
        &mut budget()
    )
    .unwrap());
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), source);
}

#[test]
fn different_domains_and_physical_h_share_actual_time_not_independent_cartesian_poses() {
    let a = integrated(
        rp::Pose::from_translation(rp::Vector::X * 65536.),
        rp::Vector::X * 16.,
        rp::Vector::ZERO,
        Domain::new(0., 0.0625).unwrap(),
        0.03125,
    );
    let b = integrated(
        rp::Pose::from_translation(rp::Vector::X * 65_536.516),
        rp::Vector::X * 16.,
        rp::Vector::ZERO,
        Domain::new(0., 0.125).unwrap(),
        0.0625,
    );
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let wrong = super::super::super::leaf_contact(
        &a.pose(0.0625),
        shape.as_ref(),
        &b.pose(0.),
        shape.as_ref(),
        &mut budget(),
    )
    .unwrap();
    assert!(
        wrong.dist < 0.,
        "an unreachable cross-time pair really overlaps"
    );
    let mut count = 0;
    assert!(
        visit(a.curve, b.curve, 0., 0.0625, &mut budget(), |at, work| {
            count += 1;
            let c = super::super::super::leaf_contact(
                &a.pose(at),
                shape.as_ref(),
                &b.pose(at),
                shape.as_ref(),
                work,
            )?;
            assert_eq!(c.dist, 0.015625);
            Ok(true)
        })
        .unwrap()
    );
    assert!(count > 2 && count <= MAX_STATES);
    assert!(separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        0.,
        0.0625,
        0.01,
        &mut budget()
    )
    .unwrap());
}

#[test]
fn ordered_first_change_matches_exhaustive_f64_cells_and_preserves_signed_zero() {
    let input = 0.0078125_f32;
    let boundary = (f64::from(input) + f64::from(input.next_up())) * 0.5;
    let from = Time::from_bits(boundary.to_bits() - 8);
    let to = Time::from_bits(boundary.to_bits() + 8);
    let a = integrated(
        rp::Pose::IDENTITY,
        rp::Vector::X * 1024.,
        rp::Vector::Z * 4.,
        Domain::new(0., 0.03125).unwrap(),
        0.03125,
    );
    let b = motion(Curve::Anchored {
        carrier: match a.curve {
            Curve::Integrated(k) => k,
            _ => unreachable!(),
        },
        anchor: rp::Vector::new(0.25, 0.5, 0.),
        offset: rp::Vector::X,
        linear_velocity: rp::Vector::Y * 3.,
        rotation: rp::Rotation::IDENTITY,
    });
    let ma = Model::new(a.curve, from, to).unwrap();
    let mb = Model::new(b.curve, from, to).unwrap();
    let mut all = Vec::new();
    for bits in order64(from)..=order64(to) {
        let at = time(bits);
        let key = state(ma, mb, at, &mut budget()).unwrap();
        if all.last().is_none_or(|(_, old)| *old != key) {
            all.push((bits, key));
        }
    }
    let mut actual = Vec::new();
    assert!(
        visit(a.curve, b.curve, from, to, &mut budget(), |at, work| {
            actual.push((order64(at), state(ma, mb, at, work)?));
            Ok(true)
        })
        .unwrap()
    );
    assert_eq!(
        actual.iter().map(|(t, _)| *t).collect::<Vec<_>>(),
        all.iter().map(|(t, _)| *t).collect::<Vec<_>>()
    );
    for (bits, key) in actual {
        assert!(all.iter().any(|v| v.0 == bits && v.1 == key));
    }
    assert!(order64(-0.) < order64(0.));
    assert_eq!(time(order64(-0.)).to_bits(), (-0_f64).to_bits());
    assert_eq!(time(order64(0.)).to_bits(), 0_f64.to_bits());
    let zero = stationary(rp::Pose::IDENTITY, -1., 1.);
    assert!(
        visit(zero.curve, zero.curve, -0., 0., &mut budget(), |_, _| Ok(
            true
        ))
        .unwrap()
    );
}

#[test]
fn stored_normalization_ccd_and_anchored_relative_branches_keep_original_pose_bits() {
    let c = std::f32::consts::FRAC_1_SQRT_2
        .next_up()
        .next_up()
        .next_up();
    let a = integrated(
        rp::Pose::from_parts(rp::Vector::ZERO, rp::Rotation::from_xyzw(0., 0., c, c)),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        Domain::new(0., 0.03125).unwrap(),
        0.03125,
    );
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    assert!(!same_pose(a.pose(0.), a.pose(0.01)));
    let mut branches = Vec::new();
    assert!(
        visit(a.curve, a.curve, 0., 0.03125, &mut budget(), |at, _| {
            branches.push((at, a.pose(at)));
            Ok(true)
        })
        .unwrap()
    );
    assert_eq!(branches.len(), 3);
    assert!(same_pose(branches[0].1, a.pose(0.)));
    assert!(same_pose(branches[1].1, a.pose(0.01)));
    assert!(same_pose(branches[2].1, a.pose(0.03125)));
    let anchored = motion(Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::X,
        offset: rp::Vector::Y,
        linear_velocity: rp::Vector::new(0.000001, -0.000002, 0.),
        rotation: rp::Rotation::IDENTITY,
    });
    let ccd = motion(Curve::Ccd {
        sweep: rapier3d::parry::query::sweep_toi::Sweep::from_poses(
            &k.native.motion.start,
            &k.native.motion.end,
            rp::Vector::ZERO,
        ),
        start_time: 0.,
        end_time: 0.03125,
    });
    for curve in [a.curve, anchored.curve, ccd.curve] {
        let m = Model::new(curve, 0., 0.03125).unwrap();
        for (from, to) in [(0., 0_f64.next_up()), (0.03125_f64.next_down(), 0.03125)] {
            let mut seen = Vec::new();
            assert!(visit(curve, a.curve, from, to, &mut budget(), |at, _| {
                seen.push((m.key(at)?, curve.com_pose(at)));
                Ok(true)
            })
            .unwrap());
            for at in [from, to] {
                let key = m.key(at).unwrap();
                assert!(seen
                    .iter()
                    .any(|(old, p)| *old == key && same_pose(*p, curve.com_pose(at))));
            }
        }
    }
    // The logical relative term remains visible even when the carrier itself
    // has no representable translation and a different physical h.
    assert_ne!(
        Model::new(anchored.curve, 0., 0.03125)
            .unwrap()
            .relative(0.),
        Model::new(anchored.curve, 0., 0.03125)
            .unwrap()
            .relative(0.03125)
    );
}

#[test]
fn cancellation_guard_large_state_guard_and_strict_contact_never_approve_a_prefix() {
    let q = rp::Rotation::from_xyzw(0.25, 0.5, -0.25, 0.75).normalize();
    let a = integrated(
        rp::Pose::from_parts(rp::Vector::ZERO, q),
        rp::Vector::X,
        rp::Vector::new(1., 2., 3.),
        Domain::new(0., 0.03125).unwrap(),
        0.03125,
    );
    let m = Model::new(a.curve, 0., 0.03125).unwrap();
    assert!(!m.compressed);
    let mut calls = 0;
    assert!(
        !visit(a.curve, a.curve, 0., 0.03125, &mut budget(), |_, _| {
            calls += 1;
            Ok(true)
        })
        .unwrap()
    );
    assert_eq!(calls, 0);
    let shape = rp::SharedShape::ball(0.25);
    let fixed = stationary(rp::Pose::IDENTITY, 0., 1.);
    for x in [0.5, 0.5_f32.next_down(), 0.5_f32.next_up()] {
        let b = stationary(rp::Pose::from_translation(rp::Vector::X * x), 0., 1.);
        let c = super::super::super::leaf_contact(
            &fixed.pose(0.),
            shape.as_ref(),
            &b.pose(0.),
            shape.as_ref(),
            &mut budget(),
        )
        .unwrap();
        assert_eq!(
            separated(
                fixed,
                shape.as_ref(),
                b,
                shape.as_ref(),
                0.,
                1.,
                0.,
                &mut budget()
            )
            .unwrap(),
            c.dist > 0.
        );
        let cast = super::super::super::cast(
            fixed,
            shape.as_ref(),
            b,
            shape.as_ref(),
            0.,
            1.,
            0.,
            1e-6,
            &mut budget(),
        )
        .unwrap();
        if x < 0.5 {
            assert!(cast.is_some(), "a real inward overlap remains a strict hit");
        } else if x == 0.5 {
            assert!(
                cast.is_none(),
                "the original full-interval closed nonpenetration proof is retained"
            );
            assert!(super::super::super::cast(
                fixed,
                shape.as_ref(),
                b,
                shape.as_ref(),
                0.,
                1.,
                2_f32.powi(-17),
                1e-6,
                &mut budget(),
            )
            .unwrap()
            .is_some());
        }
    }
    // Original closed support can accept exact nonpenetration; this optional
    // query proof remains strict and never weakens the inclusive hit predicate.
    let touching = stationary(rp::Pose::from_translation(rp::Vector::X * 0.5), 0., 1.);
    assert!(fixed
        .separated(
            shape.as_ref(),
            touching,
            shape.as_ref(),
            rp::Vector::X,
            0.,
            1.,
            0.,
            &mut budget()
        )
        .unwrap());
}

#[test]
fn near_contact_rotating_box_fixture_uses_complete_reachable_outputs_and_exact_budget() {
    let d = f64::from(0.1_f32);
    let h = 0.025_f32;
    let first = integrated(
        rp::Pose::IDENTITY,
        rp::Vector::ZERO,
        rp::Vector::Z * (std::f32::consts::FRAC_PI_4 / 0.1),
        Domain::new(0., d / 4.).unwrap(),
        h,
    );
    let a = integrated(
        first.pose(d / 4.),
        rp::Vector::ZERO,
        rp::Vector::Z * (std::f32::consts::FRAC_PI_4 / 0.1),
        Domain::new(d / 4., d / 2.).unwrap(),
        h,
    );
    let (from, to) = (0.046371939741727916, 0.0463721624587938);
    let middle = (from + to) * 0.5;
    let face = a.pose(middle) * rp::Vector::new(1.5, 0.025, 0.);
    let n = (a.pose(middle).rotation * rp::Vector::Y).normalize();
    let center = face + n * (0.25 + 2_f32.powi(-20)) + rp::Vector::Y * 0.25;
    let velocity = a.point_velocity(middle, center - rp::Vector::Y * 0.25);
    let b = integrated(
        rp::Pose::from_translation(center - velocity * middle as f32),
        velocity,
        rp::Vector::ZERO,
        Domain::new(0., d).unwrap(),
        0.1,
    );
    assert!(Image::new(a.curve, from, to).is_none());
    assert!(Image::new(b.curve, from, to).is_none());
    let box_shape = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    for at in [from, middle, to] {
        let c = super::super::super::leaf_contact(
            &a.pose(at),
            box_shape.as_ref(),
            &b.pose(at),
            capsule.as_ref(),
            &mut budget(),
        )
        .unwrap();
        assert!(c.dist > 0. && c.dist < 0.00001, "{c:?}");
    }
    let source = postcard::to_allocvec(&(a, b)).unwrap();
    let mut measured = budget();
    assert!(separated(
        a,
        box_shape.as_ref(),
        b,
        capsule.as_ref(),
        from,
        to,
        0.,
        &mut measured
    )
    .unwrap());
    let required = measured.used;
    assert!(required < 32 * 1024 * 1024);
    assert!(separated(
        a,
        box_shape.as_ref(),
        b,
        capsule.as_ref(),
        from,
        to,
        0.,
        &mut Work {
            used: 0,
            limit: required
        }
    )
    .unwrap());
    assert_eq!(
        separated(
            a,
            box_shape.as_ref(),
            b,
            capsule.as_ref(),
            from,
            to,
            0.,
            &mut Work {
                used: 0,
                limit: required - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert!(super::super::super::cast(
        a,
        box_shape.as_ref(),
        b,
        capsule.as_ref(),
        from,
        to,
        0.,
        1e-7,
        &mut budget()
    )
    .unwrap()
    .is_none());
    let inward = match b.curve {
        Curve::Integrated(k) => integrated(
            rp::Pose::from_parts(
                k.native.motion.start.translation - n * 0.001,
                k.native.motion.start.rotation,
            ),
            k.native.linear_velocity,
            k.native.angular_velocity,
            k.domain,
            k.native.integration_seconds,
        ),
        _ => unreachable!(),
    };
    assert!(!separated(
        a,
        box_shape.as_ref(),
        inward,
        capsule.as_ref(),
        from,
        to,
        0.,
        &mut budget()
    )
    .unwrap());
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), source);
}

#[test]
fn recorded_rotated_ceiling_interval_matches_all_original_f32_input_poses() {
    use rapier3d::parry::shape::SupportMap;

    // C26 tagged source, no pose/shape/time/velocity/tolerance tuning. The
    // oracle enumerates the whole Native F32 input image (about 59k values),
    // independently of the output-key first-change walk and its small guard.
    let q = rp::Rotation::from_xyzw(0.14254111, 0.044875253, 0.29692122, 0.9431363);
    let d = 0.0017500000540167093;
    let a = stationary(
        rp::Pose::from_parts(rp::Vector::new(-0.60737026, 0.86901397, 0.32796702), q),
        0.,
        d,
    );
    let b = integrated(
        rp::Pose::from_parts(rp::Vector::new(-0.27900147, 0.39919007, 0.15065487), q),
        rp::Vector::new(0.084647104, -0.121108115, 0.4776737),
        rp::Vector::ZERO,
        Domain::new(0., d).unwrap(),
        0.00175,
    );
    let (from, to) = (9.506225879363228e-6, 9.559631642730437e-6);
    let sa = rp::SharedShape::cuboid(4., 0.1, 4.);
    let sb = rp::SharedShape::capsule_y(0.25, 0.25);
    let Curve::Integrated(k) = b.curve else {
        unreachable!()
    };
    let lo = k.local_delta(from).to_bits();
    let hi = k.local_delta(to).to_bits();
    assert!(hi - lo > MAX_STATES as u32);
    let mut poses = Vec::new();
    for bits in lo..=hi {
        let pose = k
            .native
            .position_at_integration_time(f32::from_bits(bits))
            .prepend_translation(-b.local_center)
            * b.local_pose;
        if poses.last().is_none_or(|old| !same_pose(*old, pose)) {
            poses.push(pose);
        }
    }
    assert_eq!(poses.len(), 2);
    let box_pose = a.pose(from);
    let mut oracle_work = budget();
    let mut minimum = f32::INFINITY;
    for pose in &poses {
        let contact = super::super::super::leaf_contact(
            &box_pose,
            sa.as_ref(),
            pose,
            sb.as_ref(),
            &mut oracle_work,
        )
        .unwrap();
        assert!(contact.dist > 0., "{pose:?} {contact:?}");
        minimum = minimum.min(contact.dist);
    }

    // The rounded local support reaches the box at the first pose even
    // though the Native core query reports a positive distance for both.
    let box_point =
        rp::Vector::from_array([0xb7c57747, 0xbdcccccd, 0x382afa4d].map(f32::from_bits));
    let offset = rp::Vector::from_array([0xb7c521de, 0x3e7fffff, 0x3816feb5].map(f32::from_bits));
    let half = sa.as_cuboid().unwrap().half_extents;
    let capsule = sb.as_capsule().unwrap();
    let radius = f64::from(capsule.radius);
    assert!(box_point.abs().cmple(half).all());
    assert_eq!(box_point.y, -half.y);
    assert!(super::super::dot(offset, offset).hi < radius * radius);
    // The endpoint addition rounds 0.25 + next_down(0.25) to 0.5.
    let capsule_point = capsule.segment.b + offset;
    assert_eq!(capsule_point.y, 0.5);
    let point_bits = |point: rp::Vector| point.to_array().map(f32::to_bits);
    let world = [0xbf0d7ac4, 0x3f4a6a70, 0x3e98cef4];
    assert_eq!(point_bits(box_pose.transform_point(box_point)), world);
    assert_eq!(point_bits(poses[0].transform_point(capsule_point)), world);
    assert_eq!(
        point_bits(poses[0].transform_point(capsule.local_support_point(offset))),
        world
    );

    let source = postcard::to_allocvec(&(a, b)).unwrap();
    assert!(matches!(
        certificate(a, sa.as_ref(), b, sb.as_ref(), from, to, 0., &mut budget()).unwrap(),
        IntervalCertificate::Unproven
    ));
    eprintln!(
        "A34_RECORDED_ROTATED_CEILING raw_inputs={} pose_outputs={} min={minimum} certified=false",
        hi - lo + 1,
        poses.len()
    );
    let mut denied = Work { used: 0, limit: 0 };
    assert_eq!(
        separated(a, sa.as_ref(), b, sb.as_ref(), from, to, 0., &mut denied),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(denied.used, 0);
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), source);
}

#[test]
fn monotone_raw_zero_crossing_and_last_key_never_revisit_an_earlier_state() {
    let q = rp::Rotation::from_rotation_z(-0.125);
    let a = integrated(
        rp::Pose::from_parts(rp::Vector::ZERO, q),
        rp::Vector::new(1., -1., 0.),
        rp::Vector::Z * 8.,
        Domain::new(0., 0.03125).unwrap(),
        0.03125,
    );
    let center = (-2. * f64::from(q.z) / (8. * f64::from(q.w))) as f32;
    let lo = f32::from_bits(center.to_bits() - 8);
    let hi = f32::from_bits(center.to_bits() + 8);
    let model = Model::new(a.curve, f64::from(lo), f64::from(hi)).unwrap();
    assert!(model.compressed);
    let mut keys = Vec::new();
    let mut poses = Vec::new();
    for bits in lo.to_bits()..=hi.to_bits() {
        let at = f64::from(f32::from_bits(bits));
        keys.push(model.key(at).unwrap());
        poses.push(a.pose(at));
    }
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    assert!(raw(k, lo)[5] < 0. && raw(k, hi)[5] > 0.);
    for field in 1..8 {
        let first = order32(f32::from_bits(keys[0][field]));
        let last = order32(f32::from_bits(keys.last().unwrap()[field]));
        for adjacent in keys.windows(2) {
            let x = order32(f32::from_bits(adjacent[0][field]));
            let y = order32(f32::from_bits(adjacent[1][field]));
            assert!(if first <= last { x <= y } else { x >= y });
        }
    }
    for i in 0..keys.len() {
        for j in i..keys.len() {
            if keys[i] == keys[j] {
                assert!(same_pose(poses[i], poses[j]));
                assert!(keys[i..=j].iter().all(|key| *key == keys[i]));
            }
        }
    }
    let mut reached = Vec::new();
    assert!(visit(
        a.curve,
        a.curve,
        f64::from(lo),
        f64::from(hi),
        &mut budget(),
        |at, _| {
            reached.push(model.key(at)?);
            Ok(true)
        }
    )
    .unwrap());
    let mut expected = Vec::new();
    for key in keys {
        if expected.last() != Some(&key) {
            expected.push(key);
        }
    }
    assert_eq!(reached.len(), expected.len());
    assert!(reached.iter().zip(expected).all(|(a, b)| *a == b));
}

#[test]
fn complete_prefix_first_contact_is_a_native_witness_and_predecessor_not_a_sampled_toi() {
    let d = f64::from(0.1_f32);
    let a = stationary(rp::Pose::IDENTITY, 0., d);
    let b = integrated(
        rp::Pose::from_translation(rp::Vector::X),
        -rp::Vector::X * 5.,
        rp::Vector::ZERO,
        Domain::new(0., d).unwrap(),
        0.1,
    );
    let t = 0.098_f32;
    let (from, to) = (
        f64::from(f32::from_bits(t.to_bits() - 4)),
        f64::from(f32::from_bits(t.to_bits() + 4)),
    );
    let shape = rp::SharedShape::ball(0.25);
    let source = postcard::to_allocvec(&(a, b)).unwrap();
    let IntervalCertificate::Hit(candidate) = certificate(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        from,
        to,
        0.01,
        &mut budget(),
    )
    .unwrap() else {
        panic!("complete positive prefix reaches the first real margin violation")
    };
    assert!(candidate.hit_time > from && candidate.hit_time < to);
    assert_eq!(
        order64(candidate.safe_time) + 1,
        order64(candidate.hit_time)
    );
    let left = super::super::super::leaf_contact(
        &a.pose(candidate.safe_time),
        shape.as_ref(),
        &b.pose(candidate.safe_time),
        shape.as_ref(),
        &mut budget(),
    )
    .unwrap();
    let right = super::super::super::leaf_contact(
        &a.pose(candidate.hit_time),
        shape.as_ref(),
        &b.pose(candidate.hit_time),
        shape.as_ref(),
        &mut budget(),
    )
    .unwrap();
    assert!(left.dist > 0.01 && right.dist <= 0.01);
    assert_eq!(right.dist.to_bits(), candidate.contact.dist.to_bits());
    assert_eq!(
        right.point1.to_array().map(f32::to_bits),
        candidate.contact.point1.to_array().map(f32::to_bits)
    );
    let mut measured = budget();
    let hit = super::super::super::cast(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        from,
        to,
        0.01,
        1e-7,
        &mut measured,
    )
    .unwrap()
    .unwrap();
    assert_eq!(hit.safe_time.to_bits(), candidate.safe_time.to_bits());
    assert_eq!(hit.hit_time.to_bits(), candidate.hit_time.to_bits());
    assert!(hit.hit_time - hit.safe_time <= 1e-7);
    let exact = super::super::super::cast(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        from,
        to,
        0.01,
        1e-7,
        &mut Work {
            used: 0,
            limit: measured.used,
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(exact.hit_time.to_bits(), hit.hit_time.to_bits());
    assert_eq!(
        super::super::super::cast(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            from,
            to,
            0.01,
            1e-7,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        )
        .unwrap_err(),
        TrajectoryError::WorkLimit
    );
    assert!(matches!(
        certificate(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            hit.hit_time,
            to,
            0.01,
            &mut budget()
        )
        .unwrap(),
        IntervalCertificate::Unproven
    ));
    let tiny = (hit.hit_time - hit.safe_time) * 0.5;
    assert!(super::super::super::cast(a,shape.as_ref(),b,shape.as_ref(),from,to,0.01,tiny,&mut budget()).is_err(),"no original search or exact-state outcome may approve a bracket wider than the requested tolerance");
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), source);
}

#[test]
fn first_state_contact_and_closed_touch_keep_original_outgoing_and_nonpenetration_policy() {
    let d = f64::from(0.1_f32);
    let shape = rp::SharedShape::ball(0.25);
    let a = stationary(rp::Pose::IDENTITY, 0., d);
    let outgoing = integrated(
        rp::Pose::from_translation(rp::Vector::X * 0.5),
        rp::Vector::X,
        rp::Vector::ZERO,
        Domain::new(0., d).unwrap(),
        0.1,
    );
    let end = f64::from(f32::from_bits(0.1_f32.to_bits() - 4));
    let touching = integrated(
        rp::Pose::from_translation(rp::Vector::X),
        -rp::Vector::X * 5.,
        rp::Vector::ZERO,
        Domain::new(0., d).unwrap(),
        0.1,
    );
    assert!(matches!(
        certificate(
            a,
            shape.as_ref(),
            outgoing,
            shape.as_ref(),
            0.,
            f64::from(f32::from_bits(1)),
            0.,
            &mut budget()
        )
        .unwrap(),
        IntervalCertificate::Unproven
    ));
    assert!(super::super::super::cast(
        a,
        shape.as_ref(),
        outgoing,
        shape.as_ref(),
        0.,
        d,
        0.,
        1e-7,
        &mut budget()
    )
    .unwrap()
    .is_none());
    // The exact walker can nominate an inclusive zero witness at the end,
    // while the original closed whole-support proof refutes a penetration.
    assert!(matches!(
        certificate(
            a,
            shape.as_ref(),
            touching,
            shape.as_ref(),
            end,
            d,
            0.,
            &mut budget()
        )
        .unwrap(),
        IntervalCertificate::Hit(_)
    ));
    assert!(super::super::super::cast(
        a,
        shape.as_ref(),
        touching,
        shape.as_ref(),
        end,
        d,
        0.,
        1e-7,
        &mut budget()
    )
    .unwrap()
    .is_none());
    let inward = integrated(
        rp::Pose::from_translation(rp::Vector::X * 0.5_f32.next_down()),
        -rp::Vector::X,
        rp::Vector::ZERO,
        Domain::new(0., d).unwrap(),
        0.1,
    );
    let hit = super::super::super::cast(
        a,
        shape.as_ref(),
        inward,
        shape.as_ref(),
        0.,
        d,
        0.,
        1e-7,
        &mut budget(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(hit.safe_time, 0.);
    assert_eq!(hit.hit_time, 0.);
    assert!(hit.contact.dist < 0.);
}
