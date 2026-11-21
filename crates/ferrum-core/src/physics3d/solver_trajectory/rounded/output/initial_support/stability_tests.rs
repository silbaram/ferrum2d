use super::*;
use crate::physics3d::solver_trajectory::{self, Domain};
const SAFE: Time = 0.00013647079671130768;
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn constant(position: rp::Vector) -> ShapeMotion {
    motion(Curve::Constant {
        pose: rp::Pose::from_translation(position),
        start_time: 0.,
        end_time: 1.,
    })
}

#[test]
fn cell_policy_keeps_actual_static_gap_and_identical_pose_representations() {
    let (a, old, changed, sa, sb) = super::tests::fixture();
    let axis = a.pose(SAFE).rotation * rp::Vector::Y;
    let raw = initial_support_clearance(a, sa.as_ref(), old, sb.as_ref(), axis, SAFE, &mut work())
        .unwrap();
    let mut expected = None;
    for b in [
        old,
        changed,
        ShapeMotion {
            curve: Curve::Constant {
                pose: changed.curve.com_pose(SAFE),
                start_time: 0.,
                end_time: f64::from(0.025_f32),
            },
            ..changed
        },
    ] {
        let values =
            initial_support_allowances(a, sa.as_ref(), b, sb.as_ref(), axis, SAFE, &mut work())
                .unwrap();
        assert_eq!(values.geometry.to_bits(), raw.to_bits());
        assert!(values.noninward_stability >= 0. && values.noninward_stability <= values.geometry);
        if let Some(bits) = expected {
            assert_eq!(values.noninward_stability.to_bits(), bits);
        }
        expected = Some(values.noninward_stability.to_bits());
    }
}

#[test]
fn recorded_elevator_rounding_dip_and_equal_speed_wall_use_original_geometry() {
    let lift_h = 0.004166667_f32;
    let lift = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(0., f64::from(lift_h)).unwrap(),
        lift_h,
        rp::Pose::from_translation(rp::Vector::new(0., -0.033333328, 0.)),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let floor = motion(Curve::Integrated(lift));
    let rider = motion(Curve::Anchored {
        carrier: lift,
        anchor: rp::Vector::Y * 0.60999995,
        offset: rp::Vector::ZERO,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    });
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let cap = rp::SharedShape::capsule_y(0.25, 0.25);
    let before = postcard::to_allocvec(&(floor, rider)).unwrap();
    let values = initial_support_allowances(
        floor,
        box_shape.as_ref(),
        rider,
        cap.as_ref(),
        rp::Vector::Y,
        0.,
        &mut work(),
    )
    .unwrap();
    assert_eq!(values.geometry.to_bits(), 0.009999976_f32.to_bits());
    assert!(values.noninward_stability > 0. && values.noninward_stability <= 0.009999953);
    let leaf = solver_trajectory::leaf_contact(
        &floor.pose(0.),
        box_shape.as_ref(),
        &rider.pose(0.),
        cap.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(leaf.dist.to_bits(), values.geometry.to_bits());

    // The shared lift reaches this represented translation before the end.
    // Floor and rider round their translations separately, so a later pose
    // crosses even the policy's reduced noninward margin.
    let carrier_y = f32::from_bits(0xbccc_ccd0);
    let at = (f64::from(carrier_y) - f64::from(floor.pose(0.).translation.y)) * 0.5;
    assert!(0. < at && at < lift.domain.end);
    let floor_at = floor.pose(at);
    let rider_at = rider.pose(at);
    assert_eq!(floor_at.translation.y.to_bits(), carrier_y.to_bits());
    let half = box_shape.as_cuboid().unwrap().half_extents;
    let capsule = cap.as_capsule().unwrap();
    let point = floor_at * (rp::Vector::Y * half.y);
    let core = rider_at * capsule.segment.a;
    assert_eq!(point.x, core.x);
    assert_eq!(point.z, core.z);
    let gap = f64::from(core.y) - f64::from(point.y) - f64::from(capsule.radius);
    assert_eq!(gap, f64::from(f32::from_bits(0x3c23_d6b8)));
    assert!(gap > 0. && gap < f64::from(values.noninward_stability));

    let tolerance = 2.5e-8;
    let hit = solver_trajectory::cast_full_shapes_policy(
        floor,
        box_shape.as_ref(),
        rider,
        cap.as_ref(),
        0.,
        lift.domain.end,
        0.01,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .expect("original rounded elevator poses cross the policy margin");
    assert!(0. <= hit.safe_time && hit.safe_time <= at);
    assert!(0. < hit.hit_time && hit.safe_time <= hit.hit_time);
    assert!(hit.hit_time <= lift.domain.end);
    assert!(hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= values.noninward_stability);
    assert_eq!(postcard::to_allocvec(&(floor, rider)).unwrap(), before);

    let safe = 0.09999990612268306;
    let end = 0.10000000149011612;
    let actor = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            Domain::new(safe, end).unwrap(),
            9.536743e-8,
            rp::Pose::from_translation(rp::Vector::new(-3.5099943, 0., 0.19999981)),
            rp::Vector::new(-60., 0., 2.),
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    let wall = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(2, 0),
            Domain::new(0.07500000111758709, end).unwrap(),
            0.025,
            rp::Pose::from_translation(rp::Vector::new(-1.5, 0., 0.)),
            rp::Vector::X * -60.,
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    let wall_shape = rp::SharedShape::cuboid(0.25, 2., 5.);
    let before = postcard::to_allocvec(&(actor, wall)).unwrap();
    let values = initial_support_allowances(
        actor,
        cap.as_ref(),
        wall,
        wall_shape.as_ref(),
        rp::Vector::X,
        safe,
        &mut work(),
    )
    .unwrap();
    assert_eq!(values.geometry.to_bits(), 0.00999999_f32.to_bits());
    assert!(values.noninward_stability > 0. && values.noninward_stability <= 0.009999968);
    assert!(solver_trajectory::cast_full_shapes_policy(
        actor,
        cap.as_ref(),
        wall,
        wall_shape.as_ref(),
        safe,
        end,
        0.01,
        2.5e-8,
        &mut work(),
        true,
    )
    .unwrap()
    .is_none());
    let strict = solver_trajectory::cast_full_shapes(
        actor,
        cap.as_ref(),
        wall,
        wall_shape.as_ref(),
        safe,
        end,
        0.01,
        2.5e-8,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(strict.safe_time, safe);
    assert_eq!(strict.hit_time, safe);
    assert_eq!(postcard::to_allocvec(&(actor, wall)).unwrap(), before);
}

#[test]
fn cell_policy_preserves_zero_negative_and_large_coordinate_nonpenetration() {
    for value in [
        0_f32,
        f32::from_bits(1),
        1_f32.next_down(),
        1.,
        1_f32.next_up(),
        f32::MAX,
    ] {
        let width = cell_half(value).unwrap();
        assert!(width.is_finite() && width > 0.);
        assert_eq!(cell_half(-value).unwrap().to_bits(), width.to_bits());
        for adjacent in [value.next_down(), value.next_up()] {
            if adjacent.is_finite() {
                assert!(width >= (f64::from(adjacent) - f64::from(value)).abs() * 0.5);
            }
        }
    }
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        assert_eq!(cell_half(value), Err(TrajectoryError::NonFinite));
    }

    let floor = constant(rp::Vector::ZERO);
    let sa = rp::SharedShape::cuboid(2., 0.5, 2.);
    let sb = rp::SharedShape::capsule_y(0.25, 0.25);
    for y in [1_f32, 1_f32.next_down(), 1_f32.next_up()] {
        let b = constant(rp::Vector::Y * y);
        let values = initial_support_allowances(
            floor,
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::Y,
            0.,
            &mut work(),
        )
        .unwrap();
        assert_eq!(values.geometry.to_bits(), (y - 1.).to_bits());
        if values.geometry <= 0. {
            assert_eq!(
                values.noninward_stability.to_bits(),
                values.geometry.to_bits()
            );
        } else {
            assert!(values.noninward_stability >= 0.);
        }
    }
    let large = constant(rp::Vector::Y * 8192.);
    let ball = rp::SharedShape::ball(0.25);
    let slab = rp::SharedShape::cuboid(2., 0.25, 2.);
    let above = constant(rp::Vector::Y * 8192.5_f32.next_up());
    let values = initial_support_allowances(
        large,
        slab.as_ref(),
        above,
        ball.as_ref(),
        rp::Vector::Y,
        0.,
        &mut work(),
    )
    .unwrap();
    assert!(values.geometry > 0. && values.geometry < 0.01);
    assert!(values.noninward_stability >= 0.);
    assert_eq!(values.noninward_stability, 0.);
    let overlap = constant(rp::Vector::Y * 8192.5_f32.next_down());
    let negative = initial_support_allowances(
        large,
        slab.as_ref(),
        overlap,
        ball.as_ref(),
        rp::Vector::Y,
        0.,
        &mut work(),
    )
    .unwrap();
    assert!(negative.geometry < 0.);
    assert_eq!(
        negative.noninward_stability.to_bits(),
        negative.geometry.to_bits()
    );
    // A coarse-coordinate cell band cannot certify real penetration. The
    // original inward predicate and complete future query retain authority.
    let inward = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            Domain::new(0., 1.).unwrap(),
            1.,
            above.curve.com_pose(0.),
            -rp::Vector::Y,
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    let hit = solver_trajectory::cast_full_shapes_policy(
        large,
        slab.as_ref(),
        inward,
        ball.as_ref(),
        0.,
        1.,
        0.01,
        2.5e-8,
        &mut work(),
        true,
    )
    .unwrap()
    .unwrap();
    assert_eq!(hit.hit_time, 0.);
    let away = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            Domain::new(0., 1.).unwrap(),
            1.,
            above.curve.com_pose(0.),
            rp::Vector::Y,
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    assert!(solver_trajectory::cast_full_shapes_policy(
        large,
        slab.as_ref(),
        away,
        ball.as_ref(),
        0.,
        1.,
        0.01,
        2.5e-8,
        &mut work(),
        true
    )
    .unwrap()
    .is_none());
}

#[test]
fn cell_projection_is_precharged_finite_and_keeps_strict_outside_skin_and_input_bytes() {
    for value in [
        0_f32,
        -0.,
        f32::from_bits(1),
        -f32::from_bits(1),
        1.,
        -1.,
        8192.,
        f32::MAX,
        -f32::MAX,
    ] {
        let half = cell_half(value).unwrap();
        assert!(half.is_finite() && half > 0.);
        for near in [value.next_down(), value.next_up()] {
            if near.is_finite() {
                assert!(half >= (f64::from(near) - f64::from(value)).abs() * 0.5);
            }
        }
    }
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        assert_eq!(cell_half(value), Err(TrajectoryError::NonFinite));
    }
    let (a, _, b, sa, sb) = super::tests::fixture();
    let normal = a.pose(SAFE).rotation * rp::Vector::Y;
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let mut measured = work();
    let first =
        initial_support_allowances(a, sa.as_ref(), b, sb.as_ref(), normal, SAFE, &mut measured)
            .unwrap();
    let exact = initial_support_allowances(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        normal,
        SAFE,
        &mut Work {
            used: 0,
            limit: measured.used,
        },
    )
    .unwrap();
    assert_eq!(first.geometry.to_bits(), exact.geometry.to_bits());
    assert_eq!(
        first.noninward_stability.to_bits(),
        exact.noninward_stability.to_bits()
    );
    assert!(matches!(
        initial_support_allowances(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            normal,
            SAFE,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
    // Left outside the original skin takes the original requested margin;
    // no initial cell policy is eligible, in either strict or resting mode.
    let floor = constant(rp::Vector::new(0., -0.1, 0.));
    let above = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            Domain::new(0., 1.).unwrap(),
            1.,
            rp::Pose::from_translation(rp::Vector::Y * 0.510001),
            rp::Vector::X * 0.125,
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    let native = solver_trajectory::leaf_contact(
        &floor.pose(0.),
        sa.as_ref(),
        &above.pose(0.),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(native.dist > 0.01);
    for allow in [false, true] {
        assert!(solver_trajectory::cast_full_shapes_policy(
            floor,
            sa.as_ref(),
            above,
            sb.as_ref(),
            0.,
            1.,
            0.01,
            2.5e-8,
            &mut work(),
            allow
        )
        .unwrap()
        .is_none());
    }
}
