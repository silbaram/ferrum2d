use super::*;
use crate::physics3d::solver_trajectory::{leaf_contact, Domain, IntervalCertificate};

const SKIN: f32 = 0.01;
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn motion(pose: rp::Pose) -> ShapeMotion {
    ShapeMotion {
        curve: Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn frames(pose: rp::Pose) -> Frames {
    let mut result = Frames::new();
    result.values[0] = Frame::exact(pose);
    result.len = 1;
    result
}
struct Alias {
    poses: [rp::Pose; 2],
    sa: rp::SharedShape,
    sb: rp::SharedShape,
}
fn recorded_alias() -> Alias {
    // Original C49 elevator safe pose: retain the original physical h and
    // both F32 point laws. Native gap is above skin, real-world radius is not.
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
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        ..motion(rp::Pose::IDENTITY)
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::Y * 1.01,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..motion(rp::Pose::IDENTITY)
    };
    let at = 3.303401058474264e-6;
    Alias {
        poses: [a.pose(at), b.pose(at)],
        sa: rp::SharedShape::cuboid(3., 0.1, 3.),
        sb: rp::SharedShape::capsule_y(0.5, 0.4),
    }
}

#[test]
fn signed_negative_lower_and_unavailable_partial_are_distinct_for_negative_margins() {
    let sa = rp::SharedShape::cuboid(0.25, 0.25, 0.25);
    let sb = rp::SharedShape::ball(0.25);
    let a = rp::Pose::IDENTITY;
    let b = rp::Pose::from_translation(rp::Vector::X * 0.45);
    let lower =
        static_signed_support_lower(&a, sa.as_ref(), &b, sb.as_ref(), rp::Vector::X, &mut work())
            .unwrap()
            .unwrap();
    assert!(lower < -0.04);
    assert!(!native_clear_static_eligible(
        &a,
        sa.as_ref(),
        &b,
        sb.as_ref(),
        rp::Vector::X,
        -0.025,
        &mut work()
    )
    .unwrap());
    let original = initial_support_allowances(
        motion(a),
        sa.as_ref(),
        motion(b),
        sb.as_ref(),
        rp::Vector::X,
        0.,
        &mut work(),
    )
    .unwrap();
    assert_eq!(
        original.geometry.to_bits(),
        floor_f32(lower).unwrap().to_bits()
    );
    assert_eq!(
        original.noninward_stability.to_bits(),
        original.geometry.to_bits()
    );

    let unsupported = rp::SharedShape::halfspace(rp::Vector::Y);
    assert_eq!(
        static_signed_support_lower(
            &a,
            unsupported.as_ref(),
            &b,
            sb.as_ref(),
            rp::Vector::X,
            &mut work()
        )
        .unwrap(),
        None
    );
    assert!(!native_clear_static_eligible(
        &a,
        unsupported.as_ref(),
        &b,
        sb.as_ref(),
        rp::Vector::X,
        -1.,
        &mut work()
    )
    .unwrap());
    // projection_ranges can leave finite ephemeral fields after a failed
    // projection. Its explicit complete flag, never those values, is authority.
    let proxy = ToiProxy::from_shape(sb.as_ref()).unwrap();
    let mut axes = [crate::physics3d::solver_trajectory::SeparationAxis::EMPTY];
    axes[0].normal = rp::Vector::ZERO;
    assert!(!support::projection_ranges(
        &frames(a),
        &proxy,
        &frames(b),
        &proxy,
        &mut axes,
        0.,
        &mut work()
    )
    .unwrap());
    assert!(axes[0].lower.is_finite() && axes[0].upper.is_finite());
    assert_eq!(
        static_signed_support_lower(
            &a,
            sb.as_ref(),
            &b,
            sb.as_ref(),
            rp::Vector::ZERO,
            &mut work()
        ),
        Err(TrajectoryError::NonFinite)
    );
}

#[test]
fn static_collider_pose_bits_match_original_allowance_and_exact_shared_work_without_recomposition()
{
    let sa = rp::SharedShape::cuboid(0.25, 0.5, 0.75);
    let sb = rp::SharedShape::capsule_y(0.25, 0.125);
    let q = rp::Rotation::from_xyzw(-0., 0., 0.70710677, 0.70710677);
    let a = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_parts(rp::Vector::new(-0., 0.25, 0.5), q),
            start_time: 0.,
            end_time: 0.,
        },
        local_center: rp::Vector::new(0.125, -0.25, 0.5),
        local_pose: rp::Pose::from_translation(rp::Vector::new(0.25, 0.125, -0.25)),
    };
    let mut b = motion(rp::Pose::from_translation(rp::Vector::Y * 2.));
    b.curve = Curve::Constant {
        pose: b.curve.com_pose(0.),
        start_time: 0.,
        end_time: 0.,
    };
    let poses = [a.pose(0.), b.pose(0.)];
    let bytes = postcard::to_allocvec(&(a, b, poses)).unwrap();
    let mut original_work = work();
    original_work.used = 17;
    let original = initial_support_clearance(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        rp::Vector::Y,
        0.,
        &mut original_work,
    )
    .unwrap();
    let mut measured = work();
    measured.used = 17;
    let result = static_signed_support_lower(
        &poses[0],
        sa.as_ref(),
        &poses[1],
        sb.as_ref(),
        rp::Vector::Y,
        &mut measured,
    )
    .unwrap()
    .unwrap();
    assert_eq!(floor_f32(result).unwrap().to_bits(), original.to_bits());
    assert_eq!(measured.used, original_work.used);
    let mut exact = Work {
        used: 17,
        limit: measured.used,
    };
    assert_eq!(
        static_signed_support_lower(
            &poses[0],
            sa.as_ref(),
            &poses[1],
            sb.as_ref(),
            rp::Vector::Y,
            &mut exact
        )
        .unwrap(),
        Some(result)
    );
    assert_eq!(exact.used, exact.limit);
    let mut below = Work {
        used: 17,
        limit: measured.used - 1,
    };
    assert_eq!(
        static_signed_support_lower(
            &poses[0],
            sa.as_ref(),
            &poses[1],
            sb.as_ref(),
            rp::Vector::Y,
            &mut below
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(postcard::to_allocvec(&(a, b, poses)).unwrap(), bytes);
}

#[test]
fn recorded_world_radius_inside_native_outside_declines_all_native_only_pose_image_certificates() {
    let pair = recorded_alias();
    let [pa, pb] = pair.poses;
    let original = leaf_contact(&pa, pair.sa.as_ref(), &pb, pair.sb.as_ref(), &mut work()).unwrap();
    assert_eq!(original.dist.to_bits(), 0.010000005_f32.to_bits());
    assert!(original.dist > SKIN);
    let lower = static_signed_support_lower(
        &pa,
        pair.sa.as_ref(),
        &pb,
        pair.sb.as_ref(),
        original.normal1,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(lower > 0. && lower <= f64::from(SKIN));
    let a = motion(pa);
    let b = motion(pb);
    let bytes = postcard::to_allocvec(&(a, b)).unwrap();
    assert!(matches!(
        super::super::super::common_timeline::certificate(
            a,
            pair.sa.as_ref(),
            b,
            pair.sb.as_ref(),
            0.,
            1.,
            SKIN,
            &mut work()
        )
        .unwrap(),
        IntervalCertificate::Unproven
    ));
    let mut image = super::super::query_image::Cache::default();
    assert_eq!(
        image
            .clear(
                &frames(pa),
                pair.sa.as_ref(),
                &frames(pb),
                pair.sb.as_ref(),
                SKIN,
                &mut work()
            )
            .unwrap(),
        None
    );
    let mut finite = super::super::super::finite_image::Cache::new(Context {
        a,
        sa: pair.sa.as_ref(),
        b,
        sb: pair.sb.as_ref(),
        start: 0.,
        end: 1.,
        clearance: SKIN,
    });
    assert_eq!(
        finite.separated(original.normal1, &mut work()).unwrap(),
        None
    );
    // Unavailable must reach the original full-range output/support stage;
    // it must not be returned as the original Native-contact false result.
    let mut axes = crate::physics3d::solver_trajectory::SeparationAxes::single(original.normal1);
    let mut fallback = AxisCache::new(a, pair.sa.as_ref(), b, pair.sb.as_ref(), 0., 1., SKIN);
    assert!(
        !super::super::super::separated_cached(0, &mut work(), &mut axes, &mut fallback).unwrap()
    );
    assert!(fallback.attempted && fallback.support_done);
    assert_eq!(
        fallback.face, None,
        "the positive world radius requires the whole-shape support stage"
    );
    // A genuine original Native contact keeps false, rather than unavailable,
    // and retains the original finite-image short-circuit order.
    let mut inside = pb;
    inside.translation.y -= 0.05;
    let contact = leaf_contact(
        &pa,
        pair.sa.as_ref(),
        &inside,
        pair.sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(contact.dist <= SKIN);
    assert_eq!(
        super::super::query_image::Cache::default()
            .clear(
                &frames(pa),
                pair.sa.as_ref(),
                &frames(inside),
                pair.sb.as_ref(),
                SKIN,
                &mut work()
            )
            .unwrap(),
        Some(false)
    );
    let mut native = super::super::super::finite_image::Cache::new(Context {
        a,
        sa: pair.sa.as_ref(),
        b: motion(inside),
        sb: pair.sb.as_ref(),
        start: 0.,
        end: 1.,
        clearance: SKIN,
    });
    assert_eq!(
        native.separated(contact.normal1, &mut work()).unwrap(),
        Some(false)
    );
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), bytes);
}

#[test]
fn genuinely_clear_static_images_remain_complete_and_zero_radius_predicate_adds_no_work() {
    let mut pair = recorded_alias();
    pair.poses[1].translation.y += 0.05;
    let [pa, pb] = pair.poses;
    let original = leaf_contact(&pa, pair.sa.as_ref(), &pb, pair.sb.as_ref(), &mut work()).unwrap();
    assert!(original.dist > SKIN);
    assert!(
        static_signed_support_lower(
            &pa,
            pair.sa.as_ref(),
            &pb,
            pair.sb.as_ref(),
            original.normal1,
            &mut work()
        )
        .unwrap()
        .unwrap()
            > f64::from(SKIN)
    );
    assert!(matches!(
        super::super::super::common_timeline::certificate(
            motion(pa),
            pair.sa.as_ref(),
            motion(pb),
            pair.sb.as_ref(),
            0.,
            1.,
            SKIN,
            &mut work()
        )
        .unwrap(),
        IntervalCertificate::Separated
    ));
    assert_eq!(
        super::super::query_image::Cache::default()
            .clear(
                &frames(pa),
                pair.sa.as_ref(),
                &frames(pb),
                pair.sb.as_ref(),
                SKIN,
                &mut work()
            )
            .unwrap(),
        Some(true)
    );
    let mut cheap = work();
    assert!(native_clear_static_eligible(
        &pa,
        pair.sa.as_ref(),
        &pb,
        pair.sb.as_ref(),
        original.normal1,
        SKIN,
        &mut cheap
    )
    .unwrap());
    assert_eq!(original.normal1.abs(), rp::Vector::Y);
    assert_eq!(cheap.used, 768);
    assert!(
        cheap.used < 29504,
        "do not prepare unused tight static clouds for obvious separation"
    );
    let mut oblique = work();
    assert!(native_clear_static_eligible(
        &pa,
        pair.sa.as_ref(),
        &pb,
        pair.sb.as_ref(),
        original.normal1 + rp::Vector::X * 0.001,
        SKIN,
        &mut oblique
    )
    .unwrap());
    assert_eq!(oblique.used, 8 * 128 + 2 * 1024 + 256);
    let box_shape = rp::SharedShape::cuboid(0.25, 0.25, 0.25);
    let mut unchanged = Work {
        used: 17,
        limit: 17,
    };
    assert!(native_clear_static_eligible(
        &pa,
        box_shape.as_ref(),
        &pb,
        box_shape.as_ref(),
        original.normal1,
        SKIN,
        &mut unchanged
    )
    .unwrap());
    assert_eq!(unchanged.used, 17);
}

#[test]
fn aligned_box_capsule_keeps_complete_signed_and_stability_projection_bits() {
    let directions = [
        rp::Vector::X,
        -rp::Vector::X,
        rp::Vector::Y,
        -rp::Vector::Y,
        rp::Vector::Z,
        -rp::Vector::Z,
    ];
    for scale in [f32::MIN_POSITIVE, 1., 64., 1.0e20_f32] {
        let cube = rp::SharedShape::cuboid(0.25 * scale, 0.5 * scale, 0.75 * scale);
        let capsule = rp::SharedShape::capsule(
            rp::Vector::new(-0.25, -0.25, 0.) * scale,
            rp::Vector::new(0.25, 0.25, -0.) * scale,
            0.125 * scale,
        );
        let mut observed = [false; 3];
        for &normal in &directions {
            let axis = normal.abs();
            let half = axis.dot(cube.as_cuboid().unwrap().half_extents);
            let extent = half + axis.dot(rp::Vector::new(0.25, 0.25, 0.) * scale) + 0.125 * scale;
            let origin = if scale == 1. {
                rp::Vector::new(-0., 0., -0.)
            } else {
                rp::Vector::new(-0.125, 0.03125, -0.0625) * scale
            };
            for offset in [
                0.,
                extent.next_down(),
                extent,
                extent.next_up(),
                2. * extent,
            ] {
                let cube_pose = rp::Pose::from_translation(origin);
                let capsule_pose = rp::Pose::from_translation(origin + normal * offset);
                for (poses, sa, sb, axis) in [
                    (
                        [cube_pose, capsule_pose],
                        cube.as_ref(),
                        capsule.as_ref(),
                        normal,
                    ),
                    (
                        [capsule_pose, cube_pose],
                        capsule.as_ref(),
                        cube.as_ref(),
                        -normal,
                    ),
                ] {
                    let mut original = work();
                    let raw = project_static(
                        poses,
                        sa,
                        sb,
                        &ToiProxy::from_shape(sa).unwrap(),
                        &ToiProxy::from_shape(sb).unwrap(),
                        axis,
                        7,
                        &mut original,
                        true,
                    )
                    .unwrap();
                    let mut reduced = work();
                    let (pa, pb, count) = admit(poses, sa, sb, axis, &mut reduced, true).unwrap();
                    assert_eq!([pa.points().len(), pb.points().len()], [2, 2]);
                    let projection =
                        project_static(poses, sa, sb, &pa, &pb, axis, count, &mut reduced, true)
                            .unwrap();
                    assert_eq!(
                        projection.signed_lower.to_bits(),
                        raw.signed_lower.to_bits()
                    );
                    assert_eq!(
                        projection.noninward_lower.to_bits(),
                        raw.noninward_lower.to_bits()
                    );
                    let mut scalar_work = work();
                    let scalar =
                        project_cardinal_static(poses, sa, sb, axis, &mut scalar_work, true)
                            .unwrap()
                            .unwrap();
                    assert_eq!(scalar.signed_lower.to_bits(), raw.signed_lower.to_bits());
                    assert_eq!(
                        scalar.noninward_lower.to_bits(),
                        raw.noninward_lower.to_bits()
                    );
                    assert!(scalar_work.used < reduced.used);
                    let exact = static_signed_support_lower(
                        &poses[0],
                        sa,
                        &poses[1],
                        sb,
                        axis,
                        &mut work(),
                    )
                    .unwrap()
                    .unwrap();
                    assert_eq!(exact.to_bits(), raw.signed_lower.to_bits());
                    let allowance = initial_support_allowances(
                        motion(poses[0]),
                        sa,
                        motion(poses[1]),
                        sb,
                        axis,
                        0.,
                        &mut work(),
                    )
                    .unwrap();
                    let geometry = floor_f32(raw.signed_lower).unwrap();
                    let stability = if geometry <= 0. {
                        geometry
                    } else {
                        floor_f32(raw.noninward_lower.max(0.)).unwrap()
                    };
                    assert_eq!(allowance.geometry.to_bits(), geometry.to_bits());
                    assert_eq!(allowance.noninward_stability.to_bits(), stability.to_bits());
                    observed[0] |= exact < 0.;
                    observed[1] |= exact == 0.;
                    observed[2] |= exact > 0.;
                }
            }
        }
        assert!(observed[0] && observed[2]);
        if scale == 1. {
            assert!(observed[1]);
        }
    }
}

#[test]
fn aligned_box_capsule_admits_only_the_projections_it_evaluates() {
    let box_shape = rp::SharedShape::cuboid(0.25, 0.5, 0.75);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.125);
    let a = rp::Pose::IDENTITY;
    let b = rp::Pose::from_translation(rp::Vector::Y * 0.875_f32.next_up());
    let normal = rp::Vector::Y;
    let (sa, sb) = (box_shape.as_ref(), capsule.as_ref());
    let mut measured = work();
    let signed = static_signed_support_lower(&a, sa, &b, sb, normal, &mut measured).unwrap();
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert_eq!(
        static_signed_support_lower(&a, sa, &b, sb, normal, &mut exact),
        Ok(signed),
    );
    assert_eq!(exact.used, exact.limit);
    let mut below = Work {
        used: 0,
        limit: exact.limit - 1,
    };
    assert_eq!(
        static_signed_support_lower(&a, sa, &b, sb, normal, &mut below),
        Err(TrajectoryError::WorkLimit),
    );

    let mut original = work();
    let (pa, pb, count) = admit(
        [a, b],
        sa,
        sb,
        rp::Vector::new(1., 1., 0.),
        &mut original,
        false,
    )
    .unwrap();
    assert_eq!([pa.points().len(), pb.points().len()], [8, 2]);
    project_static(
        [a, b],
        sa,
        sb,
        &pa,
        &pb,
        normal,
        count,
        &mut original,
        false,
    )
    .unwrap();
    assert_eq!(measured.used, 512 + 1024 + 2 * 1024);
    assert!(original.used + 512 - measured.used > 9216);

    let mut rotated = a;
    rotated.rotation = rp::Rotation::from_rotation_z(0.001);
    assert!(cardinal_box_proxy([rotated, b], sa, sb, normal).is_none());
}

#[test]
fn scalar_cardinal_fallback_preserves_recorded_rounded_world_alias() {
    let pair = recorded_alias();
    let [a, mut b] = pair.poses;
    let sb = pair.sb.as_ref();
    let sa = pair.sa.as_ref();
    for y in [
        b.translation.y.next_down(),
        b.translation.y,
        b.translation.y.next_up(),
    ] {
        b.translation.y = y;
        let normal = rp::Vector::Y;
        let raw = project_static(
            [a, b],
            sa,
            sb,
            &ToiProxy::from_shape(sa).unwrap(),
            &ToiProxy::from_shape(sb).unwrap(),
            normal,
            7,
            &mut work(),
            true,
        )
        .unwrap();
        let specialized = project_cardinal_static([a, b], sa, sb, normal, &mut work(), true)
            .unwrap()
            .unwrap();
        assert_eq!(
            specialized.signed_lower.to_bits(),
            raw.signed_lower.to_bits()
        );
        assert_eq!(
            specialized.noninward_lower.to_bits(),
            raw.noninward_lower.to_bits()
        );
    }
}
