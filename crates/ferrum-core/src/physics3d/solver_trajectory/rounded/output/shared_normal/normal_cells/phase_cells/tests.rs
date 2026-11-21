use super::*;
use crate::physics3d::solver_trajectory::{
    rounded::output::Context, Curve, Domain, Kernel, ShapeMotion,
};
use rapier3d::prelude as rp;

#[test]
fn signed_face_bound_includes_a_rounded_interior_maximum() {
    let y = f32::from_bits(0x3f5a_f0ec);
    let w = f32::from_bits(0x3f04_ab01);
    let scale = w * w - y * y;
    let half = 0.1_f32;
    let face = action(half, y, scale);
    let interior = action(half.next_down(), y, scale);
    assert!(interior > face);
    assert_eq!(
        normalized_action::signed_face_upper(
            half,
            y,
            scale,
            &mut Work {
                used: 0,
                limit: 1024
            }
        ),
        Ok(Some(interior)),
    );
}

fn sixty_first_tick_carrier() -> Kernel {
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.7117178, 0., 0.7024656),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.7140128, 0., 0.7001327]
    );
    carrier
}

#[test]
fn signed_rotation_preserves_the_sixty_first_tick_moving_contact() {
    let carrier = sixty_first_tick_carrier();
    let domain = carrier.domain;
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.98577476, 1.0100002, 3.689551e-5),
            offset: rp::Vector::new(0.012903251, -1.1920929e-7, -8.3744526e-5),
            linear_velocity: rp::Vector::new(0., -0.007017272, 0.),
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let budget = || Work {
        used: 0,
        limit: 3_000_000,
    };
    let mut work = budget();
    let hit = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        a,
        cuboid.as_ref(),
        b,
        capsule.as_ref(),
        domain.start,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        true,
    )
    .unwrap()
    .hit
    .expect("the moving capsule reaches the original signed face");
    let safe = 0.00834607475417215_f64;
    assert_eq!(hit.safe_time.to_bits(), safe.to_bits());
    assert_eq!(hit.hit_time.to_bits(), safe.next_up().to_bits());
    let pair = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        cuboid.as_ref(),
        capsule.as_ref(),
        &mut budget(),
    )
    .unwrap()
    .unwrap();
    assert!(!pair
        .native_strict_at(a, b, hit.safe_time, 0.01, &mut budget())
        .unwrap());
    assert!(pair
        .native_strict_at(a, b, hit.hit_time, 0.01, &mut budget())
        .unwrap());
}

#[test]
fn signed_moving_prefix_reaches_the_seventieth_tick_contact() {
    use crate::physics3d::solver_trajectory::{
        cast_full_shapes_policy_coverage, world_contact::Pair,
    };
    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.7853151, 0., 0.6190963),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.7873368, 0., 0.6165231]
    );
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9834539, 1.0100002, 0.012920588),
            offset: rp::Vector::new(0., 5.9604645e-8, 0.),
            linear_velocity: rp::Vector::new(0., -1.1622905e-5, 0.),
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let sa = box_shape.as_ref();
    let sb = capsule.as_ref();
    let mut work = Work {
        used: 0,
        limit: 16_000_000,
    };
    let hit = cast_full_shapes_policy_coverage(
        a,
        sa,
        b,
        sb,
        domain.start,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap()
    .hit
    .expect("the first strict contact is reached on the original logical clock");
    assert_eq!(hit.safe_time.next_up(), hit.hit_time);
    assert_eq!(carrier.local_delta(hit.hit_time).to_bits(), 992_507_403);
    let pair = Pair::new(sa, sb, &mut work).unwrap().unwrap();
    assert!(!pair
        .native_strict_at(a, b, hit.safe_time, 0.01, &mut work)
        .unwrap());
    assert!(pair
        .native_strict_at(a, b, hit.hit_time, 0.01, &mut work)
        .unwrap());
}

#[test]
fn signed_physical_states_reject_the_seventieth_tick_stationary_candidate() {
    use crate::physics3d::solver_trajectory::{
        cast_full_shapes_policy_coverage, rotating_support_conflict, world_contact::Pair,
    };
    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.7853151, 0., 0.6190963),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.7873368, 0., 0.6165231]
    );
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let phase = |height, offset| ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9834539, height, 0.012920588),
            offset: rp::Vector::new(0., offset, 0.),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let sa = box_shape.as_ref();
    let sb = capsule.as_ref();
    let start = 0.0025705123553052545;
    let original = phase(1.0100002, 0.);
    let rejected = phase(1.0100001, 1.1920929e-7);
    let clear = phase(0.1, 0.910_000_1);
    assert_eq!(original.pose(start), rejected.pose(start));
    assert_eq!(original.pose(start), clear.pose(start));
    let mut work = Work {
        used: 0,
        limit: 10_000_000,
    };
    let at = rotating_support_conflict(
        a, sa, rejected, sb, start, domain.end, 0.01, None, &mut work,
    )
    .unwrap()
    .expect("a later rotation state certifies the real recontact");
    assert!((0.0028..0.0030).contains(&at));
    assert!(work.used < 2_500_000);
    let pair = Pair::new(sa, sb, &mut work).unwrap().unwrap();
    assert!(pair
        .native_strict_at(a, rejected, at, 0.01, &mut work)
        .unwrap());
    let coverage = cast_full_shapes_policy_coverage(
        a,
        sa,
        clear,
        sb,
        start,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap();
    assert!(coverage.strictly_clear_start && coverage.hit.is_none());
    assert!(work.used < 3_000_000);
}

#[test]
fn signed_stationary_response_checks_both_recontact_and_the_saved_end() {
    use crate::physics3d::solver_trajectory::{
        cast_full_shapes_policy_coverage, rotating_support_conflict, world_contact::Pair,
    };

    let carrier = sixty_first_tick_carrier();
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let motion = |height| ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.98577476, height, 3.689551e-5),
            offset: rp::Vector::new(0.012903251, 0.91, -8.3744526e-5),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let start = 0.008346243971118383;
    let end = carrier.domain.end;
    let sa = box_shape.as_ref();
    let sb = capsule.as_ref();
    let mut probe_work = Work {
        used: 0,
        limit: 300_000,
    };
    let rejected = motion(0.1);
    let at =
        rotating_support_conflict(a, sa, rejected, sb, start, end, 0.01, None, &mut probe_work)
            .unwrap()
            .expect("the original response recontacts before the first coarse probe");
    assert!(at < start + (end - start) / 512.);
    let pair = Pair::new(sa, sb, &mut probe_work).unwrap().unwrap();
    assert!(pair
        .native_strict_at(a, rejected, at, 0.01, &mut probe_work)
        .unwrap());
    let accepted = motion(0.1_f32.next_up().next_up());
    assert_eq!(accepted.pose(start), rejected.pose(start));
    let mut work = Work {
        used: 0,
        limit: 12_000_000,
    };
    let clear = cast_full_shapes_policy_coverage(
        a,
        sa,
        accepted,
        sb,
        start,
        end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap();
    assert!(clear.strictly_clear_start && clear.hit.is_none());
}

#[test]
fn shared_signed_face_clears_the_sixty_first_tick_fourth_integration() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.7140128, 0., 0.7001327),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.98566943, 0.1_f32.next_up(), -0.0064141587),
            offset: rp::Vector::new(0.019350994, 0.91_f32.next_up(), -0.0003156662),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 500_000,
    };
    let coverage = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        a,
        cuboid.as_ref(),
        b,
        capsule.as_ref(),
        0.012500160083909861,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap();
    assert!(coverage.strictly_clear_start && coverage.hit.is_none());
}

#[test]
fn signed_interior_recontact_leaves_work_to_clear_the_sixty_seventh_tick_response() {
    use crate::physics3d::solver_trajectory::{
        cast_full_shapes_policy_coverage, rotating_support_conflict, world_contact::Pair,
    };
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.7667433, 0., 0.64195377),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.76884, 0., 0.63944125]
    );
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let motion = |height, phase| ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9841504, height, -0.0063976496),
            offset: rp::Vector::new(0.019033939, phase, -0.0033337474),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let sa = box_shape.as_ref();
    let sb = capsule.as_ref();
    let start = 0.012500887292702599;
    let end = domain.end;
    let mut work = Work {
        used: 0,
        limit: 390_000,
    };
    let first = motion(1.0100002, 0.);
    let second = motion(1.01, 2.3841858e-7);
    let first_hit = rotating_support_conflict(a, sa, first, sb, start, end, 0.01, None, &mut work)
        .unwrap()
        .expect("first candidate recontacts near the quarter probe");
    let second_hit = rotating_support_conflict(
        a,
        sa,
        second,
        sb,
        start,
        end,
        0.01,
        Some(first_hit),
        &mut work,
    )
    .unwrap()
    .expect("a different rotation cell rejects the neighboring candidate");
    assert_ne!(first_hit, second_hit);
    let pair = Pair::new(sa, sb, &mut work).unwrap().unwrap();
    assert!(pair
        .native_strict_at(a, first, first_hit, 0.01, &mut work)
        .unwrap());
    assert!(pair
        .native_strict_at(a, second, second_hit, 0.01, &mut work)
        .unwrap());

    let safe = motion(0.1_f32.next_down(), 0.910_000_3);
    assert_eq!(safe.pose(start), first.pose(start));
    let coverage = cast_full_shapes_policy_coverage(
        a,
        sa,
        safe,
        sb,
        start,
        end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap();
    assert!(coverage.strictly_clear_start && coverage.hit.is_none());
}

#[test]
fn shared_signed_face_clears_the_sixty_eighth_tick_response() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.77508056, 0., 0.6318625),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.77714413, 0., 0.6293227]
    );
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9838976, 0.1, -0.006395012),
            offset: rp::Vector::new(0.018935382, 0.9100001, -0.0038297176),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 500_000,
    };
    let coverage = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        a,
        cuboid.as_ref(),
        b,
        capsule.as_ref(),
        0.012500049608766162,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap();
    assert!(coverage.strictly_clear_start && coverage.hit.is_none());
}

#[test]
fn verified_rounding_transitions_clear_the_recorded_sixth_tick_response() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.07519603, 0., 0.9971688),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a: motion(Curve::Integrated(carrier)),
        sa: cuboid.as_ref(),
        b: motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.99839526, 1.0100003, -0.019600049),
            offset: rp::Vector::new(0.0031303763, -1.7881393e-7, 0.019355357),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        }),
        sb: capsule.as_ref(),
        start: 0.012528764048511219,
        end: domain.end,
        clearance: 0.01,
    };
    let mut work = Work {
        used: 0,
        limit: 8_000_000,
    };
    assert_eq!(
        super::super::prefix(context, rp::Vector::Y, &mut work),
        Ok(Some(domain.end))
    );
    assert!(work.used < 7_000_000, "work={}", work.used);
    let tighter = super::super::prefix(
        Context {
            clearance: 0.01000005,
            ..context
        },
        rp::Vector::Y,
        &mut Work {
            used: 0,
            limit: 8_000_000,
        },
    )
    .unwrap();
    assert!(tighter.is_none_or(|time| time < domain.end));
}

#[test]
fn verified_logical_transitions_include_the_recorded_seventh_tick_motion() {
    let domain = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.081720814, 0., 0.9966553),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a: motion(Curve::Integrated(carrier)),
        sa: cuboid.as_ref(),
        b: motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9984378, 1.0100002, -0.006528124),
            offset: rp::Vector::new(0.0010855794, 0., 0.0064440668),
            linear_velocity: rp::Vector::new(0., -0.0007210155, 0.),
            rotation: rp::Rotation::IDENTITY,
        }),
        sb: capsule.as_ref(),
        start: domain.start,
        end: domain.end,
        clearance: 0.01,
    };
    let mut work = Work {
        used: 0,
        limit: 2_000_000,
    };
    let clear = super::super::prefix(context, rp::Vector::Y, &mut work)
        .unwrap()
        .unwrap();
    assert!(
        clear > 0.0043365563446712205 && clear < context.end,
        "time={clear}"
    );
    assert!(work.used < 1_500_000, "work={}", work.used);
}

#[test]
fn grouped_normalization_preserves_the_fourteenth_tick_contact_boundary() {
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.17579573, 0., 0.9844267),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.1790163, 0., 0.98384607]
    );
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a: motion(Curve::Integrated(carrier)),
        sa: cuboid.as_ref(),
        b: motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.99653673, 1.0100005, -0.013030738),
            offset: rp::Vector::new(0.0045951605, -2.3841858e-7, 0.012209535),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        }),
        sb: capsule.as_ref(),
        start: 0.008337949625229156,
        end: domain.end,
        clearance: 0.01,
    };
    let mut work = Work {
        used: 0,
        limit: 5_500_000,
    };
    let result = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        context.a,
        context.sa,
        context.b,
        context.sb,
        context.start,
        context.end,
        context.clearance,
        f64::from(carrier.native.integration_seconds * 1e-6),
        &mut work,
        true,
    )
    .unwrap();
    let hit = result
        .hit
        .expect("the actual world radius crosses the margin");
    assert_eq!(hit.safe_time, 0.010268996993545443);
    assert_eq!(hit.hit_time, hit.safe_time.next_up());
    assert!(work.used < 5_000_000, "work={}", work.used);
}

#[test]
fn fixed_scalar_image_preserves_the_fortieth_tick_first_contact() {
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.4943197, 0., 0.86928016),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.49716178, 0., 0.86765784]
    );
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a: motion(Curve::Integrated(carrier)),
        sa: cuboid.as_ref(),
        b: motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9904946, 1.0100003, -0.012918562),
            offset: rp::Vector::new(0.0111861825, -1.7881393e-7, 0.006557286),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        }),
        sb: capsule.as_ref(),
        start: 0.00833932089631162,
        end: domain.end,
        clearance: 0.01,
    };
    let budget = || Work {
        used: 0,
        limit: 13_000_000,
    };
    let safe = 0.010876936023123562_f64;
    let mut measured = budget();
    let cast = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        context.a,
        context.sa,
        context.b,
        context.sb,
        context.start,
        context.end,
        context.clearance,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut measured,
        true,
    )
    .unwrap()
    .hit
    .expect("the complete prefix still precedes a real world contact");
    assert_eq!(cast.safe_time.to_bits(), safe.to_bits());
    assert_eq!(cast.hit_time.to_bits(), safe.next_up().to_bits());
    assert!(measured.used < 6_500_000, "work={}", measured.used);
    let pair = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        context.sa,
        context.sb,
        &mut budget(),
    )
    .unwrap()
    .unwrap();
    assert!(pair
        .native_strict_at(
            context.a,
            context.b,
            cast.hit_time,
            context.clearance,
            &mut budget(),
        )
        .unwrap());
}

#[test]
fn stationary_scalar_images_clear_the_fortieth_tick_fourth_integration() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.49716178, 0., 0.86765784),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.4999985, 0., 0.8660262]
    );
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a: motion(Curve::Integrated(carrier)),
        sa: cuboid.as_ref(),
        b: motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.99030393, 1.0100003, -0.019399196),
            offset: rp::Vector::new(0.016873628, -1.7881393e-7, 0.009669721),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        }),
        sb: capsule.as_ref(),
        start: 0.012509979199876396,
        end: domain.end,
        clearance: 0.01,
    };
    let mut work = Work {
        used: 0,
        limit: 9_500_000,
    };
    let cast = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        context.a,
        context.sa,
        context.b,
        context.sb,
        context.start,
        context.end,
        context.clearance,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        true,
    )
    .unwrap();
    assert!(cast.hit.is_none());
    assert!(cast.strictly_clear_start);
    assert!(work.used < 9_000_000, "work={}", work.used);
}

#[test]
fn common_carrier_translation_keeps_the_third_position_driven_tick_contact() {
    use crate::physics3d::solver_trajectory::{cast_full_shapes_policy_coverage, rounded};
    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.02617695, 0., 0.99965733),
        ),
        rp::Vector::Y * 8.940696e-7,
        rp::Vector::Y * 1.5707965,
    )
    .unwrap();
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.029448163, 0., 0.9995663]
    );
    assert_eq!(carrier.native.motion.end.translation.y, -0.099999994);
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.99948645, 1.0100002, 2.4177134e-6),
            offset: rp::Vector::new(-5.9604645e-8, 5.9604645e-8, 7.450581e-9),
            linear_velocity: rp::Vector::Y * -0.0073735816,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let sa = cuboid.as_ref();
    let sb = capsule.as_ref();
    let mut work = Work {
        used: 0,
        limit: 7_000_000,
    };
    let cast = cast_full_shapes_policy_coverage(
        a,
        sa,
        b,
        sb,
        domain.start,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap()
    .hit
    .expect("the independently rounded translation retains the first contact");
    assert_eq!(cast.safe_time.next_up(), cast.hit_time);
    assert_eq!(carrier.local_delta(cast.hit_time).to_bits(), 941_175_234);
    assert!(cast.contact.dist <= 0.01);
    let core = b.pose(cast.hit_time) * sb.as_capsule().unwrap().segment.a;
    assert!(cast.contact.point2.distance(core) <= 0.4);
    let whole = super::super::translation_range(carrier, 1, domain.start, domain.end).unwrap();
    let before_contact =
        super::super::translation_range(carrier, 1, domain.start, cast.hit_time).unwrap();
    assert_eq!([whole.lo, whole.hi], [-0.1, -0.099999994]);
    assert_eq!([before_contact.lo, before_contact.hi], [-0.1; 2]);
    assert_eq!(
        rounded::shared_normal_prefix(
            a,
            sa,
            b,
            sb,
            domain.start,
            cast.hit_time,
            0.01,
            rp::Vector::Y,
            &mut Work {
                used: 0,
                limit: 7_000_000
            },
        )
        .unwrap(),
        Some(cast.safe_time)
    );

    let continuation = Domain::new(cast.safe_time, domain.end).unwrap();
    let independent = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        continuation,
        0.0041301423,
        rp::Pose::from_translation(rp::Vector::new(0.99811393, 0.9100002, -0.052363936)),
        rp::Vector::new(-0.08225308, 8.940697e-7, -1.5678335),
        rp::Vector::ZERO,
    )
    .unwrap();
    assert_eq!(
        independent.native.motion.end.translation,
        rp::Vector::new(0.9977742, 0.9100002, -0.05883931)
    );
    let capsule = ShapeMotion {
        curve: Curve::Integrated(independent),
        ..b
    };
    let mut suffix = Work {
        used: 0,
        limit: 200_000,
    };
    let coverage = cast_full_shapes_policy_coverage(
        a,
        sa,
        capsule,
        sb,
        continuation.start,
        continuation.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut suffix,
        false,
    )
    .unwrap();
    assert!(coverage.strictly_clear_start && coverage.hit.is_none());
}

#[test]
fn signed_face_rounding_cells_clear_three_seventy_third_tick_responses() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;
    let shape_a = rp::SharedShape::cuboid(3., 0.1, 3.);
    let shape_b = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 1_000_000,
    };
    for (start, end, safe, q, anchor, offset) in [
        (
            0.,
            0.004166666883975267,
            6.097431821672216e-7,
            [0.80901515, 0.58778775],
            rp::Vector::new(0.9826957, 0.099999994, 0.012913883),
            rp::Vector::new(-5.9604645e-8, 0.9100001, -1.7881393e-7),
        ),
        (
            0.004166666883975267,
            0.008333333767950535,
            0.004166666883975267,
            [0.8109344, 0.5851372],
            rp::Vector::new(0.9827595, 0.099999994, 0.0064819157),
            rp::Vector::new(0.006124079, 0.9100001, -0.001967132),
        ),
        (
            0.008333333767950535,
            0.012500000651925802,
            0.008339913381632867,
            [0.8128448, 0.5824802],
            rp::Vector::new(0.9827384, 0.09999999, 4.9591064e-5),
            rp::Vector::new(0.012208253, 0.9100002, -0.004054606),
        ),
    ] {
        let domain = Domain::new(start, end).unwrap();
        let mut carrier = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            domain,
            0.004166667,
            rp::Pose::from_parts(
                rp::Vector::new(0., -0.1, 0.),
                rp::Rotation::from_xyzw(0., q[0], 0., q[1]),
            ),
            rp::Vector::ZERO,
            rp::Vector::Y * 1.5707964,
        )
        .unwrap();
        carrier.native.motion.start_time = domain.start as f32;
        carrier.native.motion.end_time = domain.end as f32;
        let a = ShapeMotion {
            curve: Curve::Integrated(carrier),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let b = ShapeMotion {
            curve: Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity: rp::Vector::ZERO,
                rotation: rp::Rotation::IDENTITY,
            },
            ..a
        };
        let cast = cast_full_shapes_policy_coverage(
            a,
            shape_a.as_ref(),
            b,
            shape_b.as_ref(),
            safe,
            end,
            0.01,
            f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
            &mut work,
            false,
        )
        .unwrap_or_else(|error| panic!("recorded time {safe}: {error:?}, {work:?}"));
        assert!(
            cast.strictly_clear_start && cast.hit.is_none(),
            "recorded time {safe}"
        );
    }
}

#[test]
fn signed_slabs_clear_the_seventy_ninth_tick_independent_capsule() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.85772693, 0., 0.5141057),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.85940474, 0., 0.51129603]
    );
    let start = 0.01250007446067869;
    let own = Kernel::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(start, domain.end).unwrap(),
        rp::Pose::from_translation(rp::Vector::new(-0.45108446, 0.9100001, -0.87129754)),
        rp::Vector::new(-1.3544556, 1.8626451e-9, 0.7352966),
        rp::Vector::ZERO,
    )
    .unwrap();
    assert_eq!(
        own.native.motion.end.translation,
        rp::Vector::new(-0.45672792, 0.9100001, -0.86823386)
    );
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let a = motion(Curve::Integrated(carrier));
    let b = motion(Curve::Integrated(own));
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 500_000,
    };
    let cast = cast_full_shapes_policy_coverage(
        a,
        cuboid.as_ref(),
        b,
        capsule.as_ref(),
        start,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap();
    assert!(cast.strictly_clear_start && cast.hit.is_none());
}

#[test]
fn coupled_scalar_images_cover_the_recorded_eighty_first_tick_response() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;

    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.8692776, 0., 0.49432424),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.8708906, 0., 0.49147692]
    );

    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let start = 0.008359241087418921;
    let offset_y = 0.9099998_f32;
    let cast = |height| {
        let b = ShapeMotion {
            curve: Curve::Anchored {
                carrier,
                anchor: rp::Vector::new(0.98074085, 0.10000027, 5.814433e-5),
                offset: rp::Vector::new(0.011075944, height, -0.0064908266),
                linear_velocity: rp::Vector::ZERO,
                rotation: rp::Rotation::IDENTITY,
            },
            ..a
        };
        let mut work = Work {
            used: 0,
            limit: 12_000_000,
        };
        cast_full_shapes_policy_coverage(
            a,
            cuboid.as_ref(),
            b,
            capsule.as_ref(),
            start,
            domain.end,
            0.01,
            f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
            &mut work,
            false,
        )
        .unwrap()
    };
    let coverage = cast(offset_y);
    assert!(coverage.strictly_clear_start && coverage.hit.is_none());
    assert!(cast(offset_y.next_down()).hit.is_some());
}

#[test]
fn signed_height_envelope_covers_the_eighty_first_tick_fourth_integration() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;

    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.8708906, 0., 0.49147692),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.8724943, 0., 0.4886243]
    );
    let carrier_motion = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let actor_motion = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.98063624, 0.10000001, -0.006359935),
            offset: rp::Vector::new(0.016516, 0.9100001, -0.009897828),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..carrier_motion
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 500_000,
    };
    let cast = cast_full_shapes_policy_coverage(
        carrier_motion,
        cuboid.as_ref(),
        actor_motion,
        capsule.as_ref(),
        0.012500501717369161,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        false,
    )
    .unwrap();
    assert!(cast.strictly_clear_start && cast.hit.is_none());
}

#[test]
fn signed_slab_covers_the_recorded_ninety_third_tick_response() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;

    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.933579, 0., 0.35837168),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    let platform = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let actor = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9776777, 0.1, 0.012870312),
            offset: rp::Vector::new(1.1920929e-7, 0.9100001, 1.1920929e-7),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..platform
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 12_000_000,
    };
    let result = cast_full_shapes_policy_coverage(
        platform,
        cuboid.as_ref(),
        actor,
        capsule.as_ref(),
        6.096777482866854e-8,
        domain.end,
        0.01,
        f64::from(carrier.native.integration_seconds * 1e-6),
        &mut work,
        true,
    )
    .unwrap();
    assert!(result.strictly_clear_start && result.hit.is_none());
}

#[test]
fn independent_fixed_height_capsule_finds_first_signed_slab_contact() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;

    let start = 1.497872801792255e-6;
    let end = 0.004166666883975267;
    let mut platform = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., end).unwrap(),
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.78531694, 0., 0.61909395),
        ),
        rp::Vector::Y * 8.940696e-7,
        rp::Vector::Y * 1.5708036,
    )
    .unwrap();
    platform.native.motion.end_time = end as f32;
    let mut actor = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(start, end).unwrap(),
        0.004165169,
        rp::Pose::from_translation(rp::Vector::new(-0.117192306, 0.91, -0.9914802)),
        rp::Vector::new(-1.5574206, 8.940697e-7, 0.18408628),
        rp::Vector::ZERO,
    )
    .unwrap();
    actor.native.motion.start_time = 0.;
    actor.native.motion.end_time = 0.004165169;
    let motion = |kernel| ShapeMotion {
        curve: Curve::Integrated(kernel),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 600_000,
    };
    let result = cast_full_shapes_policy_coverage(
        motion(platform),
        cuboid.as_ref(),
        motion(actor),
        capsule.as_ref(),
        start,
        end,
        0.01,
        f64::from(platform.native.integration_seconds * 1e-6),
        &mut work,
        true,
    )
    .unwrap();
    let hit = result.hit.expect("first signed slab contact");
    assert!(result.strictly_clear_start);
    assert_eq!(hit.safe_time, 3.333974632369063e-6);
    assert_eq!(hit.hit_time, hit.safe_time.next_up());
    assert!(hit.contact.dist < 0.01);
}

#[test]
fn repeated_signed_projections_clear_the_recorded_one_hundred_third_tick() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;

    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.9723689, 0., 0.23344965),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.end_time = domain.end as f32;
    let platform = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let actor = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.97516775, 0.09999998, 0.012848258),
            offset: rp::Vector::new(0., 0.9100001, 2.9802322e-8),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..platform
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 12_000_000,
    };
    let result = cast_full_shapes_policy_coverage(
        platform,
        cuboid.as_ref(),
        actor,
        capsule.as_ref(),
        1.9414322878219532e-6,
        domain.end,
        0.01,
        f64::from(carrier.native.integration_seconds * 1e-6),
        &mut work,
        true,
    )
    .unwrap();
    assert!(result.strictly_clear_start && result.hit.is_none());
}

#[test]
fn independent_fixed_height_capsule_clears_the_recorded_eightieth_tick_suffix() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;

    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.09999999, 0.),
            rp::Rotation::from_xyzw(0., 0.8627344, 0., 0.5056574),
        ),
        rp::Vector::Y * 1.3411044e-6,
        rp::Vector::Y * 1.5708035,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    let actor = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::new(-0.34552833, 0.9100001, -0.9371136)),
        rp::Vector::Y * 1.3411045e-6,
        rp::Vector::ZERO,
    )
    .unwrap();
    let motion = |kernel| ShapeMotion {
        curve: Curve::Integrated(kernel),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 12_000_000,
    };
    let result = cast_full_shapes_policy_coverage(
        motion(carrier),
        cuboid.as_ref(),
        motion(actor),
        capsule.as_ref(),
        domain.start,
        domain.end,
        0.01,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut work,
        true,
    )
    .unwrap();
    assert!(result.strictly_clear_start && result.hit.is_none());
}

#[test]
fn fixed_raw_axis_checks_all_factor_cells_near_a_half_turn() {
    let kernel = sixty_first_tick_carrier();
    let projection = NormalProjection {
        kernel,
        axis: 1,
        half: 0.1,
        anchor: 0.1,
        offset: 0.,
        velocity: 0.,
        core: -0.5,
        pole: -0.9,
        radius: 0.4,
        clearance: 0.01,
        translation: Float::exact(-0.1),
        reference_height: None,
    };
    let first = RawEndpoint {
        input: 0,
        axial: 0.99306846,
        scalar: 0.115,
    };
    let last = RawEndpoint {
        scalar: f32::from_bits(first.scalar.to_bits() + 384),
        ..first
    };
    let range = RawRange { first, last };
    assert_ne!(Phase::new(first).factor, Phase::new(last).factor);
    let image = ProjectedImages {
        projection: &projection,
        face_mask: u32::MAX,
        upper_center: None,
        fixed_center: Some(0.910001),
    };
    let mut raw = Work {
        used: 0,
        limit: 25_000,
    };
    let mut cells = raw;
    assert!(image
        .clear_fixed_axial(range, u32::MAX, None, &mut raw)
        .unwrap()
        .is_some());
    assert!(image
        .clear_axial_scale_cells(range, MAX_COUPLED_GROUP, None, &mut cells)
        .unwrap()
        .is_some());
    assert!(cells.used < raw.used);
    let conflict = ProjectedImages {
        fixed_center: Some(0.909999),
        ..image
    };
    assert!(conflict
        .clear_fixed_axial(range, u32::MAX, None, &mut raw)
        .unwrap()
        .is_none());
    assert!(conflict
        .clear_axial_scale_cells(range, MAX_COUPLED_GROUP, None, &mut cells)
        .unwrap()
        .is_none());
}

#[test]
fn exact_axial_clock_proves_both_sides_of_scalar_zero() {
    let mut kernel = sixty_first_tick_carrier();
    let h = kernel.native.integration_seconds;
    kernel.native.motion.start.rotation = rp::Rotation::from_xyzw(0., 1., 0., 5.2686964e-6);
    kernel.native.angular_velocity = rp::Vector::Y * 1.5707964;
    let projection = NormalProjection {
        kernel,
        axis: 1,
        half: 0.1,
        anchor: 1.01,
        offset: 2e-6,
        velocity: 0.,
        core: -0.5,
        pole: -0.9,
        radius: 0.4,
        clearance: 0.01,
        translation: Float::exact(-0.1),
        reference_height: None,
    };
    let start = u64::from((4e-6_f32).to_bits());
    let end = u64::from(h.next_down().to_bits());
    assert!(sample(&projection, Clock::Physical, start).phase.raw.scalar > 0.);
    assert!(sample(&projection, Clock::Physical, end).phase.raw.scalar < 0.);
    let mut work = Work {
        used: 0,
        limit: 1_500_000,
    };
    let mut checked = None;
    assert_eq!(
        scan_dominant_axis(
            &projection,
            Clock::Physical,
            start,
            end,
            None,
            &mut checked,
            &mut work
        ),
        Ok(Some(true)),
    );
    assert_eq!(checked, Some(end));

    let mut checked = None;
    let conflict = NormalProjection {
        offset: -2e-6,
        ..projection
    };
    assert_eq!(
        scan_dominant_axis(
            &conflict,
            Clock::Physical,
            start,
            end,
            None,
            &mut checked,
            &mut work
        ),
        Ok(Some(false)),
    );
    assert_eq!(checked, None);
}

#[test]
fn independent_fixed_height_uses_the_signed_raw_clock_after_half_turn() {
    use crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage;

    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let platform = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.99785894, 0., -0.06540316),
        ),
        rp::Vector::Y * 4.470348e-7,
        rp::Vector::Y * 1.5708017,
    )
    .unwrap();
    let start = 8.407874247495782e-6;
    let rider_domain = Domain::new(start, domain.end).unwrap();
    let rider = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        rider_domain,
        0.004158259,
        rp::Pose::from_translation(rp::Vector::new(-1.0037112, 0.910001, -0.16558589)),
        rp::Vector::new(-0.26010257, 4.4703484e-7, 1.5766313),
        rp::Vector::ZERO,
    )
    .unwrap();
    let shape = |kernel| ShapeMotion {
        curve: Curve::Integrated(kernel),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a: shape(platform),
        sa: cuboid.as_ref(),
        b: shape(rider),
        sb: capsule.as_ref(),
        start,
        end: domain.end,
        clearance: 0.01,
    };
    let mut work = Work {
        used: 0,
        limit: 12_000_000,
    };
    assert_eq!(
        super::super::independent::prefix(context, rp::Vector::Y, &mut work),
        Ok(Some(domain.end)),
    );
    let result = cast_full_shapes_policy_coverage(
        context.a,
        context.sa,
        context.b,
        context.sb,
        start,
        domain.end,
        0.01,
        f64::from(platform.native.integration_seconds * 1e-6),
        &mut work,
        true,
    )
    .unwrap();
    assert!(result.strictly_clear_start && result.hit.is_none());
}

#[test]
fn signed_face_lattice_encloses_the_original_rounded_addition() {
    let half = 0.1_f32;
    // The recorded negative-scale binades and their adjacent rotations.
    let axial = 0.90399224_f32;
    let scalar = -0.427549_f32;
    for y in [axial.next_down(), axial, axial.next_up()] {
        for w in [scalar.next_down(), scalar, scalar.next_up()] {
            let scale = w * w - y * y;
            let spacing =
                normalized_action::signed_sum_spacing(half, Float::exact(y), Float::exact(scale))
                    .unwrap();
            let first = half * scale;
            let second = y * ((half * y) * 2.);
            let sum = f64::from(first) + f64::from(second);
            let rounded = action(half, y, scale);
            let bounds = normalized_action::signed_sum_in_output_cell(rounded, spacing).unwrap();
            assert!(bounds.lo <= sum && sum <= bounds.hi);
            assert_eq!(sum / spacing, (sum / spacing).trunc());
            assert_eq!(
                normalized_action::signed_face_ceiling(rounded, 0.),
                Some(rounded)
            );
        }
    }
}

#[test]
fn reversed_grid_encloses_actual_raw_rotation_pairs() {
    use std::collections::BTreeSet;

    let domain = Domain::new(0., 0.004166667).unwrap();
    let omega = 1.5707964_f32;
    for (y, w, angular) in [
        (0.88192457_f32, -0.4713906_f32, omega),
        (-0.88192457_f32, 0.4713906_f32, omega),
        (0.49_f32, -0.8717224_f32, omega),
        (0.50000757_f32, -0.8660211_f32, omega),
    ] {
        let carrier = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            domain,
            0.004166667,
            rp::Pose::from_parts(rp::Vector::ZERO, rp::Rotation::from_xyzw(0., y, 0., w)),
            rp::Vector::ZERO,
            rp::Vector::Y * angular,
        )
        .unwrap();
        let h = carrier.native.integration_seconds;
        let first = RawEndpoint::new(carrier, 1, 0);
        let last = RawEndpoint::new(carrier, 1, h.to_bits());
        let axial = first.axial.abs();
        let scalar = first.scalar.abs();
        let ratio = f64::from(axial) / f64::from(scalar);
        let angular_step = angular.abs() * (h * 0.5);
        let half_ulp = |value: f32| (f64::from(value.next_up()) - f64::from(value)) * 0.5;
        let y_rounding = (half_ulp(axial) + half_ulp(angular_step * scalar)).next_up();
        let allowance =
            ((y_rounding * ratio.next_up()).next_up() + half_ulp(angular_step * axial)).next_up();
        let grid = ReversedRawGrid::new(
            axial,
            scalar,
            last,
            [ratio.next_down(), ratio.next_up()],
            allowance,
        )
        .unwrap();

        let mut visited = BTreeSet::new();
        for index in 0..=65_536 {
            let dt = h * (index as f32 / 65_536.);
            let raw = RawEndpoint::new(carrier, 1, dt.to_bits());
            let (lower, upper) = grid.bounds(raw.axial.abs().to_bits(), scalar, last.scalar.abs());
            assert!(
                lower <= raw.scalar.abs() && raw.scalar.abs() <= upper,
                "angle {y}/{w} dt {dt}: {lower} <= {} <= {upper}",
                raw.scalar.abs()
            );
            visited.insert(raw.axial.abs().to_bits());
        }
        assert!(visited.len() > 20_000);
    }
}

#[test]
fn fixed_scalar_blocks_cover_the_recorded_231st_tick_response() {
    let domain = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.12729101, 0., -0.9918654),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    let projection = NormalProjection {
        kernel,
        axis: 1,
        half: 0.1,
        anchor: 1.01,
        offset: 2.9802322e-7,
        velocity: 0.,
        core: -0.5,
        pole: -0.9,
        radius: 0.4,
        clearance: 0.01,
        translation: Float::exact(-0.1),
        reference_height: None,
    };
    let raw_start = kernel.local_delta(0.007139417924918).to_bits();
    let raw_end = kernel.native.integration_seconds.next_down().to_bits();
    let first = RawEndpoint::new(kernel, 1, raw_start);
    let last = RawEndpoint::new(kernel, 1, raw_end);
    let image = ProjectedImages {
        projection: &projection,
        face_mask: 1,
        upper_center: None,
        fixed_center: None,
    };
    let mut remaining = MAX_RANGES as u32 * MAX_IMAGES;
    let mut work = Work {
        used: 0,
        limit: 3_000_000,
    };
    let proved = reversed_scalar_image(&image, first, last, &mut remaining, &mut work).unwrap();
    assert_eq!(proved, Some(last.scalar.abs()));
}
