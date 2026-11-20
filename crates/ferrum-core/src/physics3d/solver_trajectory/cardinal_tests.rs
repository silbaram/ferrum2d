//! Recorded accepted Native input, not a replacement body/curve or normal.
use super::*;
use rapier3d::pipeline::SolverBodyIntegration;

const SAFE: Time = 9.765_625_145_519_152e-5;
const HIT: Time = 9.768_009_331_345_695e-5;
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn recorded() -> (ShapeMotion, ShapeMotion) {
    let h = 0.025_f32;
    let native = SolverBodyIntegration::from_velocity(
        rp::RigidBodyHandle::invalid(),
        0.,
        h,
        rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
        rp::Vector::new(0., -7.388_679_4e-9, 0.),
        rp::Vector::new(-2.750_059_6e-10, 2., -5.527_689_4e-9),
    )
    .unwrap();
    assert_eq!(
        native.motion.end.rotation.to_array(),
        [-3.436_501e-12, 0.024_992_192, -6.907_454e-11, 0.999_687_7],
    );
    let carrier = Kernel::from_native(native, Domain::new(0., f64::from(h)).unwrap()).unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.999_994_4, 0.099_861_83, 2.980_232_2e-6),
            offset: rp::Vector::new(5.602_836_6e-6, 0.510_138_15, -2.980_232_2e-6),
            linear_velocity: rp::Vector::new(0., -3.197_442_3e-14, 0.),
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    (a, b)
}
fn shapes() -> (rp::SharedShape, rp::SharedShape) {
    (
        rp::SharedShape::cuboid(2., 0.1, 2.),
        rp::SharedShape::capsule_y(0.25, 0.25),
    )
}
fn original_axes(
    a: ShapeMotion,
    b: ShapeMotion,
    start: Time,
    normal: rp::Vector,
    right: Option<rp::Vector>,
) -> SeparationAxes {
    let mut axes = SeparationAxes::single(normal);
    axes.source = Some(AxisSource {
        a,
        b,
        box_a: true,
        box_b: false,
        start,
        right,
    });
    axes
}

#[test]
fn recorded_tiny_tilt_has_a_closed_full_f32_cardinal_plane_without_snapping_its_normal() {
    let (a, b) = recorded();
    let (sa, sb) = shapes();
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let initial = leaf_contact(
        &a.pose(0.),
        sa.as_ref(),
        &b.pose(0.),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    let margin = initial_support_clearance(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        initial.normal1,
        0.,
        &mut work(),
    )
    .unwrap()
    .min(0.01);
    assert_eq!(margin.to_bits(), (0.51_f32 - 0.5).to_bits());
    let left = leaf_contact(
        &a.pose(SAFE),
        sa.as_ref(),
        &b.pose(SAFE),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    let right = leaf_contact(
        &a.pose(HIT),
        sa.as_ref(),
        &b.pose(HIT),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_ne!(right.normal1.x, 0.);
    assert_ne!(right.normal1.z, 0.);
    assert_eq!(right.dist.to_bits(), margin.to_bits());
    assert!(left.dist >= margin);

    // Replay only the original first-appearance axes. Their oblique direction
    // is left intact, including the two tiny nonzero witness components.
    let mut old = original_axes(a, b, SAFE, left.normal1, Some(right.normal1));
    let mut cache = rounded::AxisCache::new(a, sa.as_ref(), b, sb.as_ref(), SAFE, HIT, margin);
    let mut ledger = work();
    let mut index = 0;
    loop {
        let normal = old.values[index].normal;
        assert!(!a
            .analytic_separated(
                sa.as_ref(),
                b,
                sb.as_ref(),
                normal,
                SAFE,
                HIT,
                margin,
                &mut ledger
            )
            .unwrap());
        assert!(!rounded::separated_cached(index, &mut ledger, &mut old, &mut cache).unwrap());
        old.ensure_all(&mut ledger).unwrap();
        index += 1;
        if index == old.len {
            break;
        }
    }
    assert!(!old.values[..old.len]
        .iter()
        .any(|v| v.normal == rp::Vector::Y));
    let original_count = old.len;
    old.append_cardinals(&mut ledger).unwrap();
    let cardinal_y = (original_count..old.len)
        .find(|&i| old.values[i].normal == rp::Vector::Y)
        .unwrap();
    assert!(rounded::closed_plane_cached(cardinal_y, &mut ledger, &old, &mut cache).unwrap());
    assert!(old.len <= MAX_SEPARATION_AXES);
    assert!(certified_separation_axes_only(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        left.normal1,
        Some(right.normal1),
        SAFE,
        HIT,
        margin,
        &mut work(),
    )
    .unwrap());
    assert!(certified_separation_axes_only(
        b,
        sb.as_ref(),
        a,
        sa.as_ref(),
        -left.normal1,
        Some(-right.normal1),
        SAFE,
        HIT,
        margin,
        &mut work(),
    )
    .unwrap());
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
}

#[test]
fn cardinal_proof_preserves_strict_skin_initial_margin_and_real_inward_policy() {
    let (a, b) = recorded();
    let (sa, sb) = shapes();
    let tolerance = 2.5e-8;
    // Strict clearance has no initial-resting allowance. Matching the old safe
    // pose below skin does not authorize even the new whole-plane direction.
    let strict = cast_policy(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        0.,
        HIT,
        0.01,
        tolerance,
        &mut work(),
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!(strict.hit_time, 0.);
    assert!(!certified_separation_axes_only(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        rp::Vector::Y,
        None,
        SAFE,
        HIT,
        0.01,
        &mut work(),
    )
    .unwrap());
    // Only the existing initial-support envelope can admit the unchanged
    // closed gap, over the entire prefix rather than at sampled endpoints.
    assert!(cast_policy(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        0.,
        HIT,
        0.01,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .is_none());
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
    let inward = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor,
            offset,
            rotation,
            linear_velocity: rp::Vector::new(0., -1., 0.),
        },
        ..b
    };
    let hit = cast_policy(
        a,
        sa.as_ref(),
        inward,
        sb.as_ref(),
        0.,
        HIT,
        0.01,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .unwrap();
    assert_eq!(hit.hit_time, 0.);
    let outgoing = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor,
            offset,
            rotation,
            linear_velocity: rp::Vector::Y,
        },
        ..b
    };
    assert!(cast_policy(
        a,
        sa.as_ref(),
        outgoing,
        sb.as_ref(),
        0.,
        HIT,
        0.01,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .is_none());
}

#[test]
fn optional_axes_use_only_remaining_slots_and_leave_original_batch_order_and_cost_unchanged() {
    let (a, b) = recorded();
    let normal = rp::Vector::new(5.399_426e-13, 1., -2.691_535e-14);
    let right = rp::Vector::new(5.4e-13, 1., -2.7e-14);
    let mut axes = original_axes(a, b, SAFE, normal, Some(right));
    let mut ledger = work();
    axes.ensure_all(&mut ledger).unwrap();
    assert_eq!(ledger.used, 6);
    let count = axes.len;
    let order: Vec<_> = axes.values[..count].iter().map(|v| v.normal).collect();
    axes.append_cardinals(&mut ledger).unwrap();
    assert_eq!(ledger.used, 12);
    assert_eq!(axes.len, MAX_SEPARATION_AXES);
    assert_eq!(
        axes.values[..count]
            .iter()
            .map(|v| v.normal)
            .collect::<Vec<_>>(),
        order
    );
    let once = ledger.used;
    axes.append_cardinals(&mut ledger).unwrap();
    assert_eq!(ledger.used, once);
    let mut almost_full = SeparationAxes::single(normal);
    for n in 1..13 {
        almost_full
            .push(rp::Vector::new(n as f32, 0.5, 0.25))
            .unwrap();
    }
    almost_full.append_cardinals(&mut ledger).unwrap();
    assert_eq!(almost_full.len, MAX_SEPARATION_AXES);
    assert_eq!(almost_full.values[13].normal, rp::Vector::X);
    let mut denied = original_axes(a, b, SAFE, normal, None);
    denied.ensure_all(&mut work()).unwrap();
    let old_count = denied.len;
    assert_eq!(
        denied.append_cardinals(&mut Work { used: 0, limit: 5 }),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(denied.len, old_count);
}

#[test]
fn optional_cardinal_projection_has_exact_work_one_below_and_immutable_curve_bytes() {
    let (a, b) = recorded();
    let (sa, sb) = shapes();
    let margin = 0.51_f32 - 0.5;
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let invoke = |ledger: &mut Work| {
        let axes = SeparationAxes::single(rp::Vector::Y);
        let mut cache = rounded::AxisCache::new(a, sa.as_ref(), b, sb.as_ref(), SAFE, HIT, margin);
        rounded::closed_plane_cached(0, ledger, &axes, &mut cache)
    };
    let mut measured = work();
    assert!(invoke(&mut measured).unwrap());
    assert!(invoke(&mut Work {
        used: 0,
        limit: measured.used
    })
    .unwrap());
    assert_eq!(
        invoke(&mut Work {
            used: 0,
            limit: measured.used - 1
        }),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
    // No margin epsilon: an adjacent larger requested gap remains unproved.
    let axes = SeparationAxes::single(rp::Vector::Y);
    let mut cache =
        rounded::AxisCache::new(a, sa.as_ref(), b, sb.as_ref(), SAFE, HIT, margin.next_up());
    assert!(!rounded::closed_plane_cached(0, &mut work(), &axes, &mut cache).unwrap());
}

#[test]
fn optional_whole_plane_keeps_zero_closed_and_rejects_real_overlap_or_positive_clearance() {
    let (a, b) = recorded();
    let (sa, sb) = shapes();
    let Curve::Anchored {
        carrier,
        anchor,
        mut offset,
        linear_velocity,
        rotation,
    } = b.curve
    else {
        unreachable!()
    };
    offset.y -= 0.51_f32 - 0.5;
    let at_offset = |offset| ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        },
        ..b
    };
    let closed = at_offset(offset);
    assert_eq!(closed.curve.com_pose(SAFE).translation.y, 0.5);
    assert_eq!(closed.curve.com_pose(HIT).translation.y, 0.5);
    let invoke = |motion, clearance, ledger: &mut Work| {
        let axes = SeparationAxes::single(rp::Vector::Y);
        let mut cache =
            rounded::AxisCache::new(a, sa.as_ref(), motion, sb.as_ref(), SAFE, HIT, clearance);
        rounded::closed_plane_cached(0, ledger, &axes, &mut cache)
    };
    assert!(invoke(closed, 0., &mut work()).unwrap());
    assert!(!invoke(closed, 2_f32.powi(-27), &mut work()).unwrap());
    offset.y = offset.y.next_down();
    let overlapping = at_offset(offset);
    assert!(overlapping.curve.com_pose(HIT).translation.y < 0.5);
    let c = leaf_contact(
        &a.pose(HIT),
        sa.as_ref(),
        &overlapping.pose(HIT),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(c.dist < 0.);
    assert!(!invoke(overlapping, 0., &mut work()).unwrap());
}
