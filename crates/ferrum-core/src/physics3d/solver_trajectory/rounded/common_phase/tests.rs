use super::*;
use crate::physics3d::solver_trajectory::{Domain, ShapeMotion, TrajectoryError, Work};
use rapier3d::prelude as rp;
fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn curve(start: rp::Vector, velocity: rp::Vector) -> Curve {
    Curve::Integrated(
        Kernel::from_velocity(
            rp::RigidBodyHandle::invalid(),
            Domain::new(0., 1.).unwrap(),
            rp::Pose::from_translation(start),
            velocity,
            rp::Vector::ZERO,
        )
        .unwrap(),
    )
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn phase_curve(start: rp::Vector) -> Curve {
    Curve::Integrated(
        Kernel::from_velocity(
            rp::RigidBodyHandle::invalid(),
            Domain::new(0., f64::from(0.1_f32)).unwrap(),
            rp::Pose::from_translation(start),
            rp::Vector::X,
            rp::Vector::ZERO,
        )
        .unwrap(),
    )
}
fn interval() -> (Time, Time) {
    (
        f64::from(0.00390625_f32),
        f64::from(0.00390625_f32.next_up()),
    )
}

#[test]
fn actual_shared_phase_removes_only_impossible_cross_time_fullshape_pairs() {
    let a = motion(phase_curve(rp::Vector::X * 65536.));
    let b = motion(phase_curve(rp::Vector::X * (65536. + 0.515625)));
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let (start, end) = interval();
    let ia = Image::new(a.curve, start, end).unwrap();
    let ib = Image::new(b.curve, start, end).unwrap();
    assert_eq!((ia.primary.len, ib.primary.len), (2, 2));
    let actual = pairs(&ia, &ib).unwrap();
    assert_eq!(&actual.values[..actual.len], &[(0, 0), (1, 1)]);
    let pa = ia.poses(a).unwrap();
    let pb = ib.poses(b).unwrap();
    let contact = |x, y| {
        crate::physics3d::solver_trajectory::leaf_contact(
            &pa.values[x],
            shape.as_ref(),
            &pb.values[y],
            shape.as_ref(),
            &mut work(),
        )
        .unwrap()
    };
    assert_eq!(contact(1, 0).dist, 0.0078125);
    for &(x, y) in &actual.values[..actual.len] {
        assert_eq!(contact(x, y).dist, 0.015625);
    }
    let bytes = crate::checkpoint_codec::encode(&(a, b, &shape)).unwrap();
    let mut measured = work();
    assert!(super::super::separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        rp::Vector::X,
        start,
        end,
        0.01,
        &mut measured
    )
    .unwrap());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(super::super::separated(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        rp::Vector::X,
        start,
        end,
        0.01,
        &mut exact
    )
    .unwrap());
    assert_eq!(exact.used, measured.used);
    assert_eq!(
        super::super::separated(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            rp::Vector::X,
            start,
            end,
            0.01,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    let inward = motion(phase_curve(rp::Vector::X * (65536. + 0.484375)));
    assert!(!super::super::separated(
        a,
        shape.as_ref(),
        inward,
        shape.as_ref(),
        rp::Vector::X,
        start,
        end,
        0.01,
        &mut work()
    )
    .unwrap());
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &shape)).unwrap(),
        bytes
    );
}

#[test]
fn anchored_relative_input_is_shared_separately_without_zipping_it_with_native_dt() {
    let Curve::Integrated(carrier) = phase_curve(rp::Vector::X * 65536.) else {
        unreachable!()
    };
    let anchored = |anchor| Curve::Anchored {
        carrier,
        anchor,
        offset: rp::Vector::ZERO,
        linear_velocity: rp::Vector::Z,
        rotation: rp::Rotation::IDENTITY,
    };
    let (start, end) = interval();
    let a = Image::new(anchored(rp::Vector::ZERO), start, end).unwrap();
    let b = Image::new(anchored(rp::Vector::X * 0.515625), start, end).unwrap();
    assert_eq!(
        (a.primary.len, a.relative.len, b.primary.len, b.relative.len),
        (2, 2, 2, 2)
    );
    let both = pairs(&a, &b).unwrap();
    assert_eq!(&both.values[..both.len], &[(0, 0), (1, 1), (2, 2), (3, 3)]);
    // Both native/relative combinations (low,high) and (high,low) remain.
    // Equal endpoint counts alone never establish equality of those maps.
    let integrated = Image::new(Curve::Integrated(carrier), start, end).unwrap();
    let mixed = pairs(&integrated, &b).unwrap();
    assert_eq!(
        &mixed.values[..mixed.len],
        &[(0, 0), (0, 1), (1, 2), (1, 3)]
    );
}

#[test]
fn different_clock_keys_and_compressed_output_representatives_never_acquire_phase_identity() {
    let (start, end) = interval();
    let a = Image::new(curve(rp::Vector::ZERO, rp::Vector::X), start, end).unwrap();
    let mut b = Image::new(curve(rp::Vector::Y, rp::Vector::X), start, end).unwrap();
    let original = b.curve;
    let Curve::Integrated(mut k) = b.curve else {
        unreachable!()
    };
    k.native.integration_seconds = k.native.integration_seconds.next_up();
    b.curve = Curve::Integrated(k);
    assert!(pairs(&a, &b).is_none());
    let Curve::Integrated(mut k) = original else {
        unreachable!()
    };
    k.domain.start = k.domain.start.next_up();
    b.curve = Curve::Integrated(k);
    assert!(pairs(&a, &b).is_none());
    b.curve = original;
    b.input_interval = Some((start.next_up(), end));
    assert!(pairs(&a, &b).is_none());
    let constant = curve(rp::Vector::Y, rp::Vector::ZERO);
    assert!(Image::new(constant, 0.1, 0.9).is_none());
    let compressed = Image::complete(constant, 0.1, 0.9, &mut work())
        .unwrap()
        .unwrap();
    assert!(compressed.input_interval.is_none());
    assert!(pairs(&compressed, &compressed).is_none());
}

#[test]
fn exact_unit_axis_closed_finite_and_linear_support_keep_radius_and_inward_controls() {
    let a = motion(Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: 0.,
        end_time: 1.,
    });
    let ground = rp::SharedShape::cuboid(0.25, 4., 4.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let closed = motion(curve(rp::Vector::X * 0.5, rp::Vector::ZERO));
    assert!(super::super::separated(
        a,
        ground.as_ref(),
        closed,
        capsule.as_ref(),
        rp::Vector::X,
        0.,
        1.,
        0.,
        &mut work()
    )
    .unwrap());
    let tangent = motion(curve(rp::Vector::X * 0.5, rp::Vector::Z * 0.125));
    assert!(super::super::linear_separated(
        a,
        ground.as_ref(),
        tangent,
        capsule.as_ref(),
        rp::Vector::X,
        0.,
        1.,
        0.,
        &mut work()
    )
    .unwrap());
    let inward = motion(curve(
        rp::Vector::X * 0.5,
        rp::Vector::new(-0.125, 0., 0.125),
    ));
    assert!(!super::super::linear_separated(
        a,
        ground.as_ref(),
        inward,
        capsule.as_ref(),
        rp::Vector::X,
        0.,
        1.,
        0.,
        &mut work()
    )
    .unwrap());
    assert!(!super::super::linear_separated(
        a,
        ground.as_ref(),
        tangent,
        capsule.as_ref(),
        rp::Vector::X,
        0.,
        1.,
        0.01,
        &mut work()
    )
    .unwrap());
}

#[test]
fn finite_and_linear_shortcuts_cover_stored_over_norm_and_world_radius_under_norm() {
    let base = std::f32::consts::FRAC_1_SQRT_2;
    let high = base.next_up().next_up().next_up();
    let q_over = rp::Rotation::from_xyzw(0., 0., high, high);
    let q_under = rp::Rotation::from_xyzw(0., 0., base, base);
    let ground = rp::SharedShape::cuboid(0.25, 4., 4.);
    let a = motion(Curve::Constant {
        pose: rp::Pose::from_translation(-rp::Vector::X * 0.25),
        start_time: 0.,
        end_time: 1.,
    });
    let sphere = rp::SharedShape::ball(0.5);
    let capsule = rp::SharedShape::capsule_z(0.25, 0.5);
    for (q, shape, penetrating) in [(q_under, &sphere, false), (q_over, &capsule, true)] {
        let pose = rp::Pose::from_parts(rp::Vector::X * 0.5, q);
        let b = motion(Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 1.,
        });
        let original = crate::checkpoint_codec::encode(&(a, b, shape)).unwrap();
        let enclosure =
            super::super::output::full_projection(pose, pose, rp::Vector::ZERO, 0.5, rp::Vector::X)
                .unwrap();
        let local = pose * (rp::Vector::Y * 0.5);
        if penetrating {
            assert!(local.x < 0. && enclosure.lo <= f64::from(local.x));
        } else {
            assert!(
                enclosure.lo <= 0.,
                "the original world radius cannot shrink with q"
            );
        }
        let contact = crate::physics3d::solver_trajectory::leaf_contact(
            &a.pose(0.),
            ground.as_ref(),
            &pose,
            shape.as_ref(),
            &mut work(),
        )
        .unwrap();
        if penetrating {
            assert!(contact.dist < 0.);
        } else {
            assert_eq!(contact.dist, 0.);
        }
        for clearance in [0., 2_f32.powi(-27)] {
            let expected = !penetrating && clearance == 0.;
            assert_eq!(
                super::super::separated(
                    a,
                    ground.as_ref(),
                    b,
                    shape.as_ref(),
                    rp::Vector::X,
                    0.,
                    1.,
                    clearance,
                    &mut work()
                )
                .unwrap(),
                expected
            );
            assert_eq!(
                super::super::linear_separated(
                    a,
                    ground.as_ref(),
                    b,
                    shape.as_ref(),
                    rp::Vector::X,
                    0.,
                    1.,
                    clearance,
                    &mut work()
                )
                .unwrap(),
                expected
            );
        }
        assert_eq!(
            crate::checkpoint_codec::encode(&(a, b, shape)).unwrap(),
            original
        );
    }
}

#[test]
fn full_projection_rejects_nonfinite_or_nonconstant_rotation_ranges() {
    let identity = rp::Pose::IDENTITY;
    let bad = rp::Pose::from_translation(rp::Vector::new(f32::NAN, 0., 0.));
    assert!(super::super::output::full_projection(
        bad,
        identity,
        rp::Vector::ZERO,
        0.25,
        rp::Vector::X
    )
    .is_none());
    let rotating = rp::Pose::from_rotation(rp::Rotation::from_rotation_z(0.1));
    assert!(super::super::output::full_projection(
        identity,
        rotating,
        rp::Vector::ZERO,
        0.25,
        rp::Vector::X
    )
    .is_none());
}
