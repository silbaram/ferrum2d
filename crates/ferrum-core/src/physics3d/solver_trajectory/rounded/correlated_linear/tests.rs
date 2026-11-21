use super::*;
use crate::physics3d::solver_trajectory::{cast_full_shapes_policy_coverage, Domain};

fn fixture(
    anchor: u32,
    offset: u32,
) -> (ShapeMotion, ShapeMotion, rp::SharedShape, rp::SharedShape) {
    let domain = Domain {
        start: 0.012500000651925802,
        end: 0.01666666753590107,
    };
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::Y * f32::from_bits(0x3dbbbbbb)),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::Y * f32::from_bits(anchor),
            offset: rp::Vector::Y * f32::from_bits(offset),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    (
        a,
        b,
        rp::SharedShape::cuboid(3., 0.1, 3.),
        rp::SharedShape::capsule_y(0.5, 0.4),
    )
}
fn context<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
) -> Context<'a> {
    let (start, end) = a.curve.times();
    Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance: 0.01,
    }
}
fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}

#[test]
fn complete_residue_proof_preserves_both_radius_graphs_and_actual_full_future() {
    for (anchor, offset) in [(0xbd3bbbca, 0x3f87258d), (0x3dccccdc, 0x3f68f5c2)] {
        let (a, b, sa, sb) = fixture(anchor, offset);
        let c = context(a, sa.as_ref(), b, sb.as_ref());
        let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
        let mut w = work();
        assert!(separated(c, rp::Vector::Y, &mut w).unwrap());
        assert_eq!(
            w.used,
            HEADER_WORK + VECTOR_WORK + 5 * NODE_WORK + 32 * RESIDUE_WORK
        );
        // More than a million original T values are covered by a proved
        // period. T+32 input ULP shifts every F32 intermediate by the same
        // real value; two actor ULP preserve tie-to-even parity.
        let shift = 2_f32.powi(-22);
        for residue in 0..32 {
            let t = f32::from_bits(0x3dbbbbbb + residue);
            let a0 = (t + f32::from_bits(anchor)) + f32::from_bits(offset);
            let a1 = ((t + shift) + f32::from_bits(anchor)) + f32::from_bits(offset);
            assert_eq!(f64::from(a1) - f64::from(a0), f64::from(shift));
            let top = t + 0.1;
            let local = a0 + (-0.5_f32 - 0.4);
            let core = a0 - 0.5;
            assert!(f64::from(local) - f64::from(top) > f64::from(c.clearance));
            assert!(f64::from(core) - f64::from(0.4_f32) - f64::from(top) > f64::from(c.clearance));
        }
        // The original pair policy, operand order, Kernel clock and complete
        // curve remain the real consumer. No endpoint-only approval replaces it.
        for reverse in [false, true] {
            let (a, sa, b, sb) = if reverse {
                (b, sb.as_ref(), a, sa.as_ref())
            } else {
                (a, sa.as_ref(), b, sb.as_ref())
            };
            assert!(cast_full_shapes_policy_coverage(
                a,
                sa,
                b,
                sb,
                c.start,
                c.end,
                c.clearance,
                1e-6,
                &mut work(),
                true,
            )
            .unwrap()
            .hit
            .is_none());
        }
        assert_eq!(
            crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
            before
        );
    }
}

#[test]
fn whole_residue_rejects_interior_contact_and_different_clock_or_rotation() {
    let (a, b, sa, sb) = fixture(0xbd3bbb80, 0x3f87258a);
    let c = context(a, sa.as_ref(), b, sb.as_ref());
    let pole = |bits| {
        let Curve::Anchored { anchor, offset, .. } = b.curve else {
            unreachable!()
        };
        let t = f32::from_bits(bits);
        let actor = (t + anchor.y) + offset.y;
        f64::from(actor - 0.5) - f64::from(0.4_f32) - f64::from(t + 0.1)
    };
    assert!(pole(0x3dbbbbbb) > f64::from(c.clearance));
    assert!(pole(0x3dcccccc) > f64::from(c.clearance));
    assert!(pole(0x3dbbbbbe) < f64::from(c.clearance));
    assert!(!separated(c, rp::Vector::Y, &mut work()).unwrap());

    let (a, b, sa, sb) = fixture(0xbd3bbbca, 0x3f87258d);
    let c = context(a, sa.as_ref(), b, sb.as_ref());
    let Curve::Anchored { mut carrier, .. } = b.curve else {
        unreachable!()
    };
    carrier.domain.end = carrier.domain.end.next_up();
    let changed_clock = ShapeMotion {
        curve: match b.curve {
            Curve::Anchored {
                anchor,
                offset,
                linear_velocity,
                rotation,
                ..
            } => Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            },
            _ => unreachable!(),
        },
        ..b
    };
    assert!(!separated(
        Context {
            b: changed_clock,
            ..c
        },
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    let mut changed_rotation = b;
    if let Curve::Anchored { rotation, .. } = &mut changed_rotation.curve {
        *rotation = rp::Rotation::from_xyzw(0., 0., 0., 1_f32.next_up());
    }
    assert!(!separated(
        Context {
            b: changed_rotation,
            ..c
        },
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    assert!(!separated(c, rp::Vector::new(0.01, 1., 0.), &mut work()).unwrap());
    let (mut a, mut b, _, sb) = fixture(0xbd3bbbca, 0x3f87258d);
    let Curve::Integrated(mut k) = a.curve else {
        unreachable!()
    };
    k.native.motion.start.translation.x = f32::MAX;
    k.native.motion.end.translation.x = f32::MAX;
    a.curve = Curve::Integrated(k);
    if let Curve::Anchored { carrier, .. } = &mut b.curve {
        *carrier = k;
    }
    let overflow_box = rp::SharedShape::cuboid(f32::MAX, 0.1, 3.);
    assert!(!separated(
        context(a, overflow_box.as_ref(), b, sb.as_ref()),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
}

#[test]
fn complete_finite_input_path_handles_binade_boundary_and_preserves_exact_budget() {
    let (mut a, mut b, sa, sb) = fixture(0xbd3bbbca, 0x3f87258d);
    // This small complete T image straddles a binade. It cannot use a
    // single-binade periodic proof; every possible F32 T must be checked.
    let Curve::Integrated(mut k) = a.curve else {
        unreachable!()
    };
    k.native.motion.start.translation.y = 0.125_f32.next_down();
    k.native.linear_velocity.y = 2_f32.powi(-25);
    k.native.integration_seconds = 1.;
    k.native.motion.end.translation = k.native.motion.start.translation + k.native.linear_velocity;
    a.curve = Curve::Integrated(k);
    if let Curve::Anchored {
        carrier,
        anchor,
        offset,
        ..
    } = &mut b.curve
    {
        *carrier = k;
        anchor.y = 0.;
        offset.y = 1.02;
    }
    let c = context(a, sa.as_ref(), b, sb.as_ref());
    let mut w = work();
    assert!(separated(c, rp::Vector::Y, &mut w).unwrap());
    let first = ordered(k.position_at_time(c.start).translation.y);
    let last = ordered(k.position_at_time(c.end).translation.y);
    assert!(Range::new(from_ordered(first), from_ordered(last)).is_none());
    assert_eq!(
        w.used,
        HEADER_WORK + VECTOR_WORK + u64::from(last - first + 1) * RESIDUE_WORK
    );
    for limit in [w.used, w.used - 1] {
        let mut exact = Work { used: 0, limit };
        let result = separated(c, rp::Vector::Y, &mut exact);
        if limit == w.used {
            assert!(result.unwrap());
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    let (a, b, sa, sb) = fixture(0xbd3bbbca, 0x3f87258d);
    let c = context(a, sa.as_ref(), b, sb.as_ref());
    let mut full = work();
    assert!(separated(c, rp::Vector::Y, &mut full).unwrap());
    assert!(separated(
        c,
        rp::Vector::Y,
        &mut Work {
            used: 0,
            limit: full.used
        }
    )
    .unwrap());
    assert!(matches!(
        separated(
            c,
            rp::Vector::Y,
            &mut Work {
                used: 0,
                limit: full.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    ));
}

fn gravity_prelude() -> (ShapeMotion, ShapeMotion, rp::SharedShape, rp::SharedShape) {
    let domain = Domain {
        start: 0.004166666883975267,
        end: 0.008333333767950535,
    };
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::Y * f32::from_bits(0xbdbbbbbc)),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::Y * f32::from_bits(0x3f8258bf),
            offset: rp::Vector::Y * f32::from_bits(0xbc088840),
            linear_velocity: rp::Vector::Y * f32::from_bits(0xbc553adf),
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    (
        a,
        b,
        rp::SharedShape::cuboid(3., 0.1, 3.),
        rp::SharedShape::capsule_y(0.5, 0.4),
    )
}

fn world_y_gap(a: ShapeMotion, b: ShapeMotion, time: f64) -> f64 {
    let top = a.pose(time) * (rp::Vector::Y * 0.1);
    let core = b.pose(time) * (rp::Vector::NEG_Y * 0.5);
    f64::from(core.y) - f64::from(0.4_f32) - f64::from(top.y)
}

#[test]
fn recorded_gravity_relative_product_certifies_prefix_and_preserves_actual_first_hit() {
    let (a, b, sa, sb) = gravity_prelude();
    let whole = context(a, sa.as_ref(), b, sb.as_ref());
    let prefix = Context {
        end: whole.start + 1e-6,
        ..whole
    };
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let mut proof = work();
    assert!(separated(prefix, rp::Vector::Y, &mut proof).unwrap());
    assert_eq!(
        proof.used,
        HEADER_WORK + RELATIVE_WORK + VECTOR_WORK + 6 * NODE_WORK + 16 * RESIDUE_WORK
    );
    // This tiny product fails the original exact-sum exponent-distance gate.
    // The additional final RN node needs an outward real pre-round interval.
    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity,
        ..
    } = b.curve
    else {
        unreachable!()
    };
    let base = |t| (carrier.position_at_time(t).translation.y + anchor.y) + offset.y;
    let base = Range::new(base(prefix.start), base(prefix.end)).unwrap();
    let product = linear_velocity.y * (prefix.end - carrier.domain.start) as f32;
    assert!(base.add(product, &mut work()).unwrap().is_none());
    assert!(base.add_product(product, &mut work()).unwrap().is_some());
    for limit in [proof.used, proof.used - 1] {
        let result = separated(prefix, rp::Vector::Y, &mut Work { used: 0, limit });
        if limit == proof.used {
            assert!(result.unwrap());
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    assert!(world_y_gap(a, b, prefix.end) > f64::from(whole.clearance));
    assert!(world_y_gap(a, b, whole.end) < f64::from(whole.clearance));
    assert!(!separated(whole, rp::Vector::Y, &mut work()).unwrap());
    let tolerance = f64::from(carrier.native.integration_seconds) * 1e-6;
    let hit = cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        whole.start,
        whole.end,
        whole.clearance,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .hit
    .expect("original gravity path must still enter the unchanged skin");
    assert!(hit.safe_time >= prefix.end);
    assert!(hit.hit_time > whole.start && hit.hit_time < whole.end);
    assert!(hit.safe_time <= hit.hit_time && hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= whole.clearance);
    assert!(world_y_gap(a, b, hit.hit_time) <= f64::from(whole.clearance));
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );
}

#[test]
fn relative_product_uses_logical_clock_signed_axis_and_full_vector_finite_bounds() {
    let (mut a, mut b, sa, sb) = gravity_prelude();
    let Curve::Integrated(mut k) = a.curve else {
        unreachable!()
    };
    // Native h remains original; only the admitted logical Domain is longer.
    // Using physical elapsed for the relative term would falsely clear this
    // actual endpoint, so the two clocks cannot be interchanged.
    k.domain.end += k.domain.duration();
    a.curve = Curve::Integrated(k);
    if let Curve::Anchored { carrier, .. } = &mut b.curve {
        *carrier = k;
    }
    let full = context(a, sa.as_ref(), b, sb.as_ref());
    let inside = Context {
        end: full.start + 2.4e-6,
        ..full
    };
    let Curve::Anchored {
        anchor,
        offset,
        linear_velocity,
        ..
    } = b.curve
    else {
        unreachable!()
    };
    let base = (k.position_at_time(inside.end).translation.y + anchor.y) + offset.y;
    let incorrect_com = base + linear_velocity.y * k.local_delta(inside.end);
    let top = k.position_at_time(inside.end).translation.y + 0.1;
    let incorrect_gap = f64::from(incorrect_com - 0.5) - f64::from(0.4_f32) - f64::from(top);
    assert!(incorrect_gap > f64::from(full.clearance));
    assert!(world_y_gap(a, b, inside.end) < f64::from(full.clearance));
    assert!(!separated(inside, rp::Vector::Y, &mut work()).unwrap());
    let prefix = Context {
        end: full.start + 1e-6,
        ..full
    };
    assert!(separated(prefix, rp::Vector::Y, &mut work()).unwrap());
    let reversed = Context {
        a: b,
        sa: sb.as_ref(),
        b: a,
        sb: sa.as_ref(),
        ..prefix
    };
    assert!(separated(reversed, rp::Vector::NEG_Y, &mut work()).unwrap());
    // Tangent products cannot be ignored by the full-vector finite gate.
    // At this logical elapsed their F32 multiply overflows, though Native h
    // and the separating Y law are individually finite.
    k.domain.end = k.domain.start + 2.;
    a.curve = Curve::Integrated(k);
    if let Curve::Anchored {
        carrier,
        linear_velocity,
        ..
    } = &mut b.curve
    {
        *carrier = k;
        linear_velocity.x = f32::MAX;
    }
    assert!(!separated(
        context(a, sa.as_ref(), b, sb.as_ref()),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    for axis in [0, 2] {
        // CapsuleY has nonzero tangent endpoints at both X/Z walls. Their
        // full line+ball support along the original normal uses endpoint
        // normal-coordinate zero; tangent endpoint zero is unnecessary.
        let (original, _, _, capsule) = fixture(0xbd3bbbca, 0x3f87258d);
        let (start, end) = original.curve.times();
        let normal = if axis == 0 {
            rp::Vector::X
        } else {
            rp::Vector::Z
        };
        let k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::invalid(),
            Domain { start, end },
            0.004166667,
            rp::Pose::from_translation(normal * f32::from_bits(0x3dbbbbbb)),
            normal * 2.,
            rp::Vector::ZERO,
        )
        .unwrap();
        let wall_motion = ShapeMotion {
            curve: Curve::Integrated(k),
            ..original
        };
        let actor_motion = ShapeMotion {
            curve: Curve::Anchored {
                carrier: k,
                anchor: normal * 0.53,
                offset: rp::Vector::ZERO,
                linear_velocity: rp::Vector::Y * 0.25,
                rotation: rp::Rotation::IDENTITY,
            },
            ..original
        };
        let wall = if axis == 0 {
            rp::SharedShape::cuboid(0.1, 3., 3.)
        } else {
            rp::SharedShape::cuboid(3., 3., 0.1)
        };
        let c = context(wall_motion, wall.as_ref(), actor_motion, capsule.as_ref());
        let before =
            crate::checkpoint_codec::encode(&(wall_motion.curve, actor_motion.curve)).unwrap();
        assert!(separated(c, normal, &mut work()).unwrap());
        assert!(cast_full_shapes_policy_coverage(
            wall_motion,
            wall.as_ref(),
            actor_motion,
            capsule.as_ref(),
            start,
            end,
            c.clearance,
            1e-6,
            &mut work(),
            true,
        )
        .unwrap()
        .hit
        .is_none());
        assert_eq!(
            actor_motion.curve.com_pose(end).translation.y.to_bits(),
            (0.25 * (end - start) as f32).to_bits()
        );
        assert_eq!(
            crate::checkpoint_codec::encode(&(wall_motion.curve, actor_motion.curve)).unwrap(),
            before
        );

        let mut incoming = actor_motion;
        if let Curve::Anchored {
            linear_velocity, ..
        } = &mut incoming.curve
        {
            linear_velocity[axis] = -8.;
        }
        let at_end = incoming.pose(end) * rp::Vector::ZERO;
        let wall_point = wall_motion.pose(end) * (normal * 0.1);
        assert!(
            f64::from(at_end[axis]) - f64::from(0.4_f32) - f64::from(wall_point[axis])
                < f64::from(c.clearance)
        );
        assert!(!separated(Context { b: incoming, ..c }, normal, &mut work()).unwrap());
        let hit = cast_full_shapes_policy_coverage(
            wall_motion,
            wall.as_ref(),
            incoming,
            capsule.as_ref(),
            start,
            end,
            c.clearance,
            1e-6,
            &mut work(),
            true,
        )
        .unwrap()
        .hit
        .expect("real normal approach must retain its original wall contact");
        assert!(hit.hit_time > start && hit.hit_time < end);
        assert!(hit.contact.dist <= c.clearance);
    }
}

fn candidate_c66() -> (ShapeMotion, ShapeMotion, rp::SharedShape, rp::SharedShape) {
    let (original, _, sa, sb) = fixture(0xbd3bbbca, 0x3f87258d);
    let domain = Domain {
        start: 0.008333333767950535,
        end: 0.012500000651925802,
    };
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::Y * f32::from_bits(0xbc88888c)),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(k),
        ..original
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::Y * f32::from_bits(0x3dccccdf),
            offset: rp::Vector::Y * f32::from_bits(0x3f68f5c1),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    (a, b, sa, sb)
}

#[test]
fn complete_binade_cell_union_keeps_prices_budget_zero_signs_and_input_bytes() {
    let (a, mut b, sa, sb) = candidate_c66();
    if let Curve::Anchored { offset, .. } = &mut b.curve {
        offset.y = f32::from_bits(offset.y.to_bits() + 4);
    }
    let whole = context(a, sa.as_ref(), b, sb.as_ref());
    let c = Context {
        start: 0.011653646441118326,
        end: 0.011669922483633854,
        ..whole
    };
    assert!(b.pose(c.start).translation.y < 1. && b.pose(c.end).translation.y > 1.);
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let mut w = work();
    let result = certificate(c, rp::Vector::Y, &mut w).unwrap();
    assert!(result.separated && result.probe.is_none());
    let mut plain = work();
    assert!(separated(c, rp::Vector::Y, &mut plain).unwrap());
    assert_eq!(plain.used, w.used); // no inverse/probe charge on any success
    for limit in [w.used, w.used - 1] {
        let result = certificate(c, rp::Vector::Y, &mut Work { used: 0, limit });
        if limit == w.used {
            assert!(result.unwrap().separated);
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    assert!(cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        c.start,
        c.end,
        c.clearance,
        1e-6,
        &mut work(),
        true
    )
    .unwrap()
    .hit
    .is_none());
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );

    // At the odd-shift limit, the first coarsest addition can tie.
    // The optional tie check must pay for its scratch and first node.
    let plane = Plane {
        anchor: 16.,
        offset: 0.,
        product: 0.,
        point: -0.5,
        radius: 0.4,
        half: 0.1,
        clearance: 0.01,
    };
    let cell = Cell {
        low: ordered(0.1),
        high: ordered(0.10001),
        depth: 0,
    };
    let tie_work = 5 * NODE_WORK + 64 + std::mem::size_of::<[RoundedAdd; 6]>() as u64 + 32;
    let mut exact = Work {
        used: 0,
        limit: tie_work,
    };
    assert!(matches!(
        cell_proof(cell, plane, &mut exact).unwrap(),
        Attempt::Unavailable
    ));
    assert_eq!(exact.used, tie_work);
    let mut one_below = Work {
        used: 0,
        limit: tie_work - 1,
    };
    assert!(matches!(
        cell_proof(cell, plane, &mut one_below),
        Err(TrajectoryError::WorkLimit)
    ));

    // This period is four times the residue limit. The odd-shift proof
    // can halve it at most once and cannot admit this cell.
    let excessive = Plane {
        anchor: 32.,
        ..plane
    };
    let mut large = Work {
        used: 0,
        limit: 5 * NODE_WORK,
    };
    assert!(matches!(
        cell_proof(cell, excessive, &mut large).unwrap(),
        Attempt::Unavailable
    ));
    assert_eq!(large.used, 5 * NODE_WORK);

    // All four represented inputs across +/-0 are visited. Numeric qI
    // geometry, not bit-identical zero arithmetic, justifies this bound.
    let Curve::Integrated(mut k) = a.curve else {
        unreachable!()
    };
    k.native.motion.start.translation.y = -f32::from_bits(1);
    k.native.integration_seconds = 1.;
    k.native.linear_velocity.y = f32::from_bits(2);
    k.native.motion.end.translation = k.native.motion.start.translation + k.native.linear_velocity;
    let zero_a = ShapeMotion {
        curve: Curve::Integrated(k),
        ..a
    };
    let zero_b = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::Y * 1.02,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..b
    };
    let mut zero_work = work();
    assert!(
        certificate(
            context(zero_a, sa.as_ref(), zero_b, sb.as_ref()),
            rp::Vector::Y,
            &mut zero_work
        )
        .unwrap()
        .separated
    );
    assert_eq!(zero_work.used, HEADER_WORK + VECTOR_WORK + 4 * RESIDUE_WORK);
}

#[test]
fn recorded_binade_interior_probe_is_revalidated_and_counterfactual_probe_has_no_hit_authority() {
    let (a, b, sa, sb) = candidate_c66();
    let whole = context(a, sa.as_ref(), b, sb.as_ref());
    let c = Context {
        start: 0.011653646441118326,
        end: 0.011669922483633854,
        ..whole
    };
    let tau = 0.011668468825519085;
    assert_eq!(a.pose(tau).translation.y.to_bits(), 0xbc23c7f4);
    assert_eq!(b.pose(tau).translation.y.to_bits(), 0x3f80001e);
    assert_eq!(
        (b.pose(tau) * (rp::Vector::NEG_Y * 0.5)).y.to_bits(),
        0x3f00003c
    );
    assert_eq!(
        (a.pose(tau) * (rp::Vector::Y * 0.1)).y.to_bits(),
        0x3db853ce
    );
    assert_eq!(world_y_gap(a, b, tau), 0.009999975562095642);
    assert!(world_y_gap(a, b, c.start) > f64::from(c.clearance));
    assert!(world_y_gap(a, b, c.end) > f64::from(c.clearance));
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let mut w = work();
    let nomination = certificate(c, rp::Vector::Y, &mut w).unwrap();
    assert!(!nomination.separated);
    let probe = nomination
        .probe
        .expect("reachable evaluated T residue has an actual interior preimage");
    assert!(probe > c.start && probe < c.end);
    assert!(world_y_gap(a, b, probe) <= f64::from(c.clearance));
    for limit in [w.used, w.used - 1] {
        let result = certificate(c, rp::Vector::Y, &mut Work { used: 0, limit });
        if limit == w.used {
            assert_eq!(result.unwrap().probe.unwrap().to_bits(), probe.to_bits());
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    // Coherent A consumer validates the nominated time against the original
    // selected-margin world contact before using it as a split pivot.
    let tolerance = f64::from(0.004166667_f32) * 1e-6;
    let hit = cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        c.start,
        c.end,
        c.clearance,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .hit
    .expect("original interior world contact survives clear endpoints");
    assert!(hit.hit_time > c.start && hit.hit_time < c.end);
    assert!(hit.safe_time <= hit.hit_time && hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= c.clearance);
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );

    let (a, b, sa, sb) = gravity_prelude();
    let c = context(a, sa.as_ref(), b, sb.as_ref());
    let mut observed = work();
    let counterfactual = certificate(c, rp::Vector::Y, &mut observed).unwrap();
    let time = counterfactual
        .probe
        .expect("counterfactual product can nominate an actual time");
    assert!(!counterfactual.separated && time > c.start && time < c.end);
    assert!(world_y_gap(a, b, time) > f64::from(c.clearance));
    let mut plain = work();
    assert!(!separated(c, rp::Vector::Y, &mut plain).unwrap());
    assert!(observed.used > plain.used); // unused bool cue costs no inverse work
}

fn descending_c68(clear: bool) -> (ShapeMotion, ShapeMotion, rp::SharedShape, rp::SharedShape) {
    let (original, _, sa, sb) = fixture(0xbd3bbbca, 0x3f87258d);
    let domain = Domain {
        start: 0.012500000651925802,
        end: 0.01666666753590107,
    };
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::Y * f32::from_bits(0x3c08889f)),
        rp::Vector::NEG_Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(k),
        ..original
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::Y * f32::from_bits(0x3f7c28f7),
            offset: rp::Vector::Y * f32::from_bits(if clear { 0x3ccccd00 } else { 0x3cccccc0 }),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    (a, b, sa, sb)
}
fn late_displacement_context<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
) -> Context<'a> {
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    Context {
        start: k.domain.start
            + 0.00390625 * (k.domain.duration() / f64::from(k.native.integration_seconds)),
        end: k.domain.end,
        ..context(a, sa, b, sb)
    }
}

#[test]
fn displacement_cancellation_complete_image_preserves_late_clearance_and_whole_domain_authority() {
    let (a, b, sa, sb) = descending_c68(true);
    let c = late_displacement_context(a, sa.as_ref(), b, sb.as_ref());
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let p0 = k.native.linear_velocity.y * k.local_delta(c.start);
    let p1 = k.native.linear_velocity.y * k.local_delta(c.end);
    assert_eq!(p0.to_bits(), (-0.0078125_f32).to_bits());
    assert_eq!(p1.to_bits(), 0xbc088889);
    let origin = k.native.motion.start.translation.y;
    assert!(sterbenz(origin, p1, p0));
    assert_eq!((origin + p1).to_bits(), 0x32b00000);
    let next_p = f32::from_bits(p1.to_bits() - 1);
    assert_eq!(f64::from(next_p) - f64::from(p1), 2_f64.powi(-30));
    assert_eq!(ordered(origin + next_p) - ordered(origin + p1) + 1, 524_289);
    let t_range = Range::new(origin + p1, origin + next_p).unwrap();
    assert!(matches!(
        t_range
            .qualify_add(f32::from_bits(0x3f7c28f7), &mut work())
            .unwrap(),
        Node::Unavailable
    ));
    // Independent source forward enumeration of one mathematically admitted
    // period checks both original radius expressions, not 256 time samples.
    for index in 0..256 {
        let p = f32::from_bits(p1.to_bits() - index);
        let t = origin + p;
        assert_eq!(f64::from(t), f64::from(origin) + f64::from(p));
        let translated = origin + (p + 2_f32.powi(-22));
        assert_eq!(f64::from(translated) - f64::from(t), 2_f64.powi(-22));
    }
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let plane = Plane {
        anchor: f32::from_bits(0x3f7c28f7),
        offset: f32::from_bits(0x3ccccd00),
        product: 0.,
        point: -0.5,
        radius: 0.4,
        half: 0.1,
        clearance: 0.01,
    };
    let zero_cell = Cell {
        low: ordered(-f32::from_bits(1)),
        high: ordered(-0_f32),
        depth: 0,
    };
    assert!(matches!(
        displacement_cell_proof(zero_cell, plane, origin, &mut work()).unwrap(),
        Attempt::Clear
    ));
    assert_eq!(
        (k.native.linear_velocity.y * k.local_delta(k.domain.start)).to_bits(),
        (-0_f32).to_bits()
    );
    assert_eq!(
        (origin + (-0_f32)).to_bits(),
        k.native.motion.start.translation.y.to_bits()
    );
    // A non-Sterbenz input must retain its original rounded T node; its
    // unimplemented excessive period is unavailable, not a partial clear.
    let nonexact = Cell {
        low: ordered(-0.001_f32),
        high: ordered(-0.00099_f32),
        depth: 0,
    };
    assert!(!sterbenz(
        origin,
        from_ordered(nonexact.low),
        from_ordered(nonexact.high)
    ));
    assert!(matches!(
        displacement_cell_proof(nonexact, plane, origin, &mut work()).unwrap(),
        Attempt::Unavailable
    ));
    let mut exact = work();
    let result = certificate(c, rp::Vector::Y, &mut exact).unwrap();
    assert!(result.separated && result.probe.is_none());
    for limit in [exact.used, exact.used - 1] {
        let result = certificate(c, rp::Vector::Y, &mut Work { used: 0, limit });
        if limit == exact.used {
            assert!(result.unwrap().separated);
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    assert!(cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        c.start,
        c.end,
        c.clearance,
        f64::from(k.native.integration_seconds) * 1e-6,
        &mut work(),
        true
    )
    .unwrap()
    .hit
    .is_none());
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );

    // A late clear region cannot certify an earlier real contact. Positive
    // relative rate clears the late part while its tiny early product is
    // invisible; the full-domain graph still contains this genuine point.
    let (a, mut b, sa, sb) = descending_c68(false);
    if let Curve::Anchored {
        linear_velocity, ..
    } = &mut b.curve
    {
        linear_velocity.y = 0.001;
    }
    let whole = context(a, sa.as_ref(), b, sb.as_ref());
    let late = late_displacement_context(a, sa.as_ref(), b, sb.as_ref());
    assert!(
        certificate(late, rp::Vector::Y, &mut work())
            .unwrap()
            .separated
    );
    assert!(world_y_gap(a, b, whole.start + 2_f64.powi(-24)) < f64::from(whole.clearance));
    assert!(
        !certificate(whole, rp::Vector::Y, &mut work())
            .unwrap()
            .separated
    );
}

#[test]
fn unreachable_translation_counter_uses_actual_displacement_preimage_and_original_clock_hit() {
    let (a, b, sa, sb) = descending_c68(false);
    let c = late_displacement_context(a, sa.as_ref(), b, sb.as_ref());
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let fake = f32::from_bits(0x32b40000);
    let origin = k.native.motion.start.translation.y;
    assert_eq!(
        f64::from(fake) - f64::from(k.native.motion.end.translation.y),
        2_f64.powi(-31)
    );
    assert!(time_probe(
        k,
        Input::Translation,
        1,
        1.,
        c.start,
        c.end,
        a.pose(c.start).translation.y,
        a.pose(c.end).translation.y,
        ordered(fake),
        &mut work()
    )
    .unwrap()
    .is_none());
    let source = Input::Displacement { origin };
    let mut measured = work();
    let result = certificate(c, rp::Vector::Y, &mut measured).unwrap();
    assert!(!result.separated);
    let probe = result
        .probe
        .expect("a real P-cell counter has an original strict interior preimage");
    assert!(probe > c.start && probe < c.end);
    let p = source.at(k, 1, 1., probe);
    assert_eq!(
        (origin + p).to_bits(),
        a.pose(probe).translation.y.to_bits()
    );
    assert!(world_y_gap(a, b, probe) <= f64::from(c.clearance));
    for limit in [measured.used, measured.used - 1] {
        let result = certificate(c, rp::Vector::Y, &mut Work { used: 0, limit });
        if limit == measured.used {
            assert_eq!(result.unwrap().probe.unwrap().to_bits(), probe.to_bits());
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let tolerance = f64::from(k.native.integration_seconds) * 1e-6;
    let hit = cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        c.start,
        c.end,
        c.clearance,
        tolerance,
        &mut work(),
        true,
    )
    .unwrap()
    .hit
    .expect("original descending contact must retain its chronological prefix");
    assert!(hit.safe_time >= c.start && hit.hit_time > c.start && hit.hit_time <= probe);
    assert!(hit.safe_time <= hit.hit_time && hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= c.clearance);
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );

    // Actual Native h is unchanged when the logical Domain doubles. P and
    // its inverse must still use the original Kernel map, not logical dt.
    let (mut a, mut b, sa, sb) = descending_c68(true);
    let Curve::Integrated(mut k) = a.curve else {
        unreachable!()
    };
    k.domain.end += k.domain.duration();
    a.curve = Curve::Integrated(k);
    if let Curve::Anchored { carrier, .. } = &mut b.curve {
        *carrier = k;
    }
    let c = late_displacement_context(a, sa.as_ref(), b, sb.as_ref());
    assert_ne!(k.domain.duration(), f64::from(k.native.integration_seconds));
    assert_eq!(
        (k.native.linear_velocity.y * k.local_delta(c.start)).to_bits(),
        (-0.0078125_f32).to_bits()
    );
    assert!(
        certificate(c, rp::Vector::Y, &mut work())
            .unwrap()
            .separated
    );
    assert!(cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        c.start,
        c.end,
        c.clearance,
        tolerance,
        &mut work(),
        true
    )
    .unwrap()
    .hit
    .is_none());
}

fn candidate_c69(offset: u32) -> (ShapeMotion, ShapeMotion, rp::SharedShape, rp::SharedShape) {
    let (a, mut b, sa, sb) = descending_c68(false);
    if let Curve::Anchored { offset: actual, .. } = &mut b.curve {
        actual.y = f32::from_bits(offset);
    }
    (a, b, sa, sb)
}
fn actual_interval_c69<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
) -> Context<'a> {
    Context {
        start: 0.012766495305555571,
        end: 0.012766749338788838,
        ..context(a, sa, b, sb)
    }
}

#[test]
fn recorded_offset_cell_has_complete_tie_free_odd_period_and_exact_work() {
    let (a, b, sa, sb) = candidate_c69(0x3cccccc1);
    let c = actual_interval_c69(a, sa.as_ref(), b, sb.as_ref());
    let first = a.pose(c.start).translation.y;
    let last = a.pose(c.end).translation.y;
    assert_eq!(first.to_bits(), 0x3bff9a34);
    assert_eq!(last.to_bits(), 0x3bff95f1);
    assert_eq!(ordered(first) - ordered(last) + 1, 1092);
    let inner = Range::new(
        first + f32::from_bits(0x3f7c28f7),
        last + f32::from_bits(0x3f7c28f7),
    )
    .unwrap();
    let output = Range::new(
        inner.lo + f32::from_bits(0x3cccccc1),
        inner.hi + f32::from_bits(0x3cccccc1),
    )
    .unwrap();
    assert_eq!(inner.ulp_exponent(), -24);
    assert_eq!(output.ulp_exponent(), -23);
    assert_eq!(quantum_exponent(f32::from_bits(0x3cccccc1)), Some(-29));
    assert!(no_half_tie(RoundedAdd {
        input: inner,
        constant: f32::from_bits(0x3cccccc1),
        output
    }));
    // One output ULP shifts the complete input by256 T ULP. The constant's
    // finer dyadic bit excludes every half tie; neither endpoint sampling
    // nor an assumed singleton coarsest node authorizes this period.
    let shift = 2_f32.powi(-23);
    for index in 0..256 {
        let t = from_ordered(ordered(last) + index);
        let before = (t + f32::from_bits(0x3f7c28f7)) + f32::from_bits(0x3cccccc1);
        let after = ((t + shift) + f32::from_bits(0x3f7c28f7)) + f32::from_bits(0x3cccccc1);
        assert_eq!(f64::from(after) - f64::from(before), f64::from(shift));
    }
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let mut w = work();
    let clear = certificate(c, rp::Vector::Y, &mut w).unwrap();
    assert!(clear.separated && clear.probe.is_none());
    let mut bool_work = work();
    assert!(separated(c, rp::Vector::Y, &mut bool_work).unwrap());
    assert_eq!(w.used, bool_work.used);
    for limit in [w.used, w.used - 1] {
        let result = certificate(c, rp::Vector::Y, &mut Work { used: 0, limit });
        if limit == w.used {
            assert!(result.unwrap().separated);
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    let tolerance = f64::from(0.004166667_f32 * 1e-6_f32);
    assert!(cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        c.start,
        c.end,
        c.clearance,
        tolerance,
        &mut work(),
        true
    )
    .unwrap()
    .hit
    .is_none());
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );
}

#[test]
fn possible_ties_multiple_coarsest_nodes_and_real_contact_keep_original_fallback() {
    let (a, b, sa, sb) = candidate_c69(0x3cccccc0);
    let c = actual_interval_c69(a, sa.as_ref(), b, sb.as_ref());
    let lo = a.pose(c.end).translation.y;
    let hi = a.pose(c.start).translation.y;
    let inner = Range::new(
        lo + f32::from_bits(0x3f7c28f7),
        hi + f32::from_bits(0x3f7c28f7),
    )
    .unwrap();
    let constant = f32::from_bits(0x3cccccc0);
    let output = Range::new(inner.lo + constant, inner.hi + constant).unwrap();
    assert!(!no_half_tie(RoundedAdd {
        input: inner,
        constant,
        output
    }));
    let plane = Plane {
        anchor: f32::from_bits(0x3f7c28f7),
        offset: constant,
        product: 0.,
        point: -0.5,
        radius: 0.4,
        half: 0.1,
        clearance: c.clearance,
    };
    let cell = Cell {
        low: ordered(lo),
        high: ordered(hi),
        depth: 0,
    };
    assert!(matches!(
        cell_proof(cell, plane, &mut work()).unwrap(),
        Attempt::Unavailable
    ));
    // A distinct coarsest rounded node can still tie even if offset alone
    // would pass. Every qualified rounded node must be checked independently.
    let other = Plane {
        anchor: 1.,
        offset: f32::from_bits(0x3cccccc1),
        ..plane
    };
    assert!(matches!(
        cell_proof(cell, other, &mut work()).unwrap(),
        Attempt::Unavailable
    ));
    let tiny = f32::from_bits(1);
    assert_eq!(quantum_exponent(tiny), Some(-149));
    assert!(no_half_tie(RoundedAdd {
        input: output,
        constant: tiny,
        output
    }));
    assert!(!no_half_tie(RoundedAdd {
        input: inner,
        constant: f32::NAN,
        output
    }));

    // The original tie-capable representation really enters skin. A strict
    // cast must retain that original contact; a clear residue elsewhere is
    // never a certificate for the complete interval.
    let time = 0.01276649531791918;
    assert!(time > c.start && time < c.end);
    assert!(world_y_gap(a, b, time) < f64::from(c.clearance));
    assert!(
        !certificate(c, rp::Vector::Y, &mut work())
            .unwrap()
            .separated
    );
    let hit = cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        c.start,
        c.end,
        c.clearance,
        f64::from(0.004166667_f32 * 1e-6_f32),
        &mut work(),
        false,
    )
    .unwrap()
    .hit
    .expect("a real initial strict contact cannot be contradicted by an unproved odd period");
    assert_eq!(hit.safe_time.to_bits(), c.start.to_bits());
    assert_eq!(hit.hit_time.to_bits(), c.start.to_bits());
    assert!(hit.contact.dist <= c.clearance);
}

fn full_future_c71<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
) -> Context<'a> {
    Context {
        start: 0.01250458704205748,
        ..context(a, sa, b, sb)
    }
}

#[test]
fn recorded_p_odd_period_clears_complete_c71_future_with_original_budget_and_bytes() {
    let (a, b, sa, sb) = candidate_c69(0x3cccccc1);
    let full = full_future_c71(a, sa.as_ref(), b, sb.as_ref());
    let c = Context {
        start: 0.014720328410919008,
        end: 0.014720391919227326,
        ..full
    };
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let origin = k.native.motion.start.translation.y;
    let first = k.native.linear_velocity.y * k.local_delta(c.start);
    let last = k.native.linear_velocity.y * k.local_delta(c.end);
    assert_eq!(first.to_bits(), 0xbb9182eb);
    assert_eq!(last.to_bits(), 0xbb9183fc);
    assert_eq!(ordered(first) - ordered(last) + 1, 274);
    assert!(sterbenz(origin, last, first));
    assert_eq!(a.pose(c.start).translation.y.to_bits(), 0x3b7f1ca6);
    assert_eq!(a.pose(c.end).translation.y.to_bits(), 0x3b7f1a84);
    let plane = Plane {
        anchor: f32::from_bits(0x3f7c28f7),
        offset: f32::from_bits(0x3cccccc1),
        product: 0.,
        point: -0.5,
        radius: 0.4,
        half: 0.1,
        clearance: 0.01,
    };
    let cell = Cell {
        low: ordered(last),
        high: ordered(first),
        depth: 0,
    };
    let mut raw = work();
    assert!(matches!(
        displacement_cell_proof(cell, plane, origin, &mut raw).unwrap(),
        Attempt::Clear
    ));
    assert_eq!(
        raw.used,
        6 * NODE_WORK
            + 64
            + std::mem::size_of::<[(i32, f32, i32); 7]>() as u64
            + 5 * 32
            + 256 * RESIDUE_WORK
    );
    // An already admitted even256 P proof pays none of the new metadata.
    let old_even = Plane {
        anchor: 0.5,
        offset: 0.03,
        point: 0.,
        ..plane
    };
    let mut old_work = work();
    assert!(matches!(
        displacement_cell_proof(cell, old_even, origin, &mut old_work).unwrap(),
        Attempt::Clear
    ));
    assert_eq!(old_work.used, 6 * NODE_WORK + 256 * RESIDUE_WORK);

    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let initial_used = 10_092_338;
    let mut proof = Work {
        used: initial_used,
        limit: 32 * 1024 * 1024,
    };
    assert!(
        certificate(full, rp::Vector::Y, &mut proof)
            .unwrap()
            .separated
    );
    for limit in [proof.used, proof.used - 1] {
        let result = certificate(
            full,
            rp::Vector::Y,
            &mut Work {
                used: initial_used,
                limit,
            },
        );
        if limit == proof.used {
            assert!(result.unwrap().separated);
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    // The actual failing FullFuture call, not merely its last P cell, must
    // pass the original permitted policy with the already-used tick ledger.
    let mut query = Work {
        used: initial_used,
        limit: 32 * 1024 * 1024,
    };
    assert!(cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        full.start,
        full.end,
        full.clearance,
        f64::from(0.004166667_f32 * 1e-6_f32),
        &mut query,
        true
    )
    .unwrap()
    .hit
    .is_none());
    assert!(query.used > initial_used);
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );
}

#[test]
fn p_tie_and_rounded_origin_node_keep_counter_and_incomplete_coverage_unproven() {
    let (a, b, sa, sb) = candidate_c69(0x3cccccc0);
    let full = full_future_c71(a, sa.as_ref(), b, sb.as_ref());
    let Curve::Integrated(k) = a.curve else {
        unreachable!()
    };
    let origin = k.native.motion.start.translation.y;
    let first = k.native.linear_velocity.y * k.local_delta(0.014720328410919008);
    let last = k.native.linear_velocity.y * k.local_delta(0.014720391919227326);
    let plane = Plane {
        anchor: f32::from_bits(0x3f7c28f7),
        offset: f32::from_bits(0x3cccccc0),
        product: 0.,
        point: -0.5,
        radius: 0.4,
        half: 0.1,
        clearance: 0.01,
    };
    let cell = Cell {
        low: ordered(last),
        high: ordered(first),
        depth: 0,
    };
    assert!(matches!(
        displacement_cell_proof(cell, plane, origin, &mut work()).unwrap(),
        Attempt::Unavailable
    ));
    // A nonexact origin+P can itself be a coarsest rounded node. Its
    // tie-capable grid must be inspected even if the later offset cannot tie.
    let positive = Cell {
        low: ordered(-first),
        high: ordered(-last),
        depth: 0,
    };
    assert!(!sterbenz(
        1.,
        from_ordered(positive.low),
        from_ordered(positive.high)
    ));
    let later_free = Plane {
        anchor: 0.,
        offset: f32::from_bits(0x3cccccc1),
        ..plane
    };
    assert!(matches!(
        displacement_cell_proof(positive, later_free, 1., &mut work()).unwrap(),
        Attempt::Unavailable
    ));

    // Some clear cells cannot publish the full union. The unchanged installed
    // representation contains a real strict world point in the same future.
    let time = 0.01276649531791918;
    assert!(time > full.start && time < full.end);
    assert!(world_y_gap(a, b, time) < f64::from(full.clearance));
    assert!(
        !certificate(full, rp::Vector::Y, &mut work())
            .unwrap()
            .separated
    );
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let hit = cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        time,
        time + 1e-7,
        full.clearance,
        f64::from(0.004166667_f32 * 1e-6_f32),
        &mut work(),
        false,
    )
    .unwrap()
    .hit
    .expect("strict real contact remains authoritative");
    assert_eq!(hit.safe_time.to_bits(), time.to_bits());
    assert_eq!(hit.hit_time.to_bits(), time.to_bits());
    assert!(hit.contact.dist <= full.clearance);
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );
}

fn zero_offset_c73() -> (ShapeMotion, ShapeMotion, rp::SharedShape, rp::SharedShape) {
    let seconds = 0.004166667_f32;
    let domain = Domain {
        start: 0.,
        end: f64::from(seconds),
    };
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        seconds,
        rp::Pose::from_translation(rp::Vector::Y * f32::from_bits(0x32b00000)),
        rp::Vector::NEG_Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::Y * f32::from_bits(0x3f8147af),
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    (
        a,
        b,
        rp::SharedShape::cuboid(3., 0.1, 3.),
        rp::SharedShape::capsule_y(0.5, 0.4),
    )
}
fn zero_offset_plane_c73() -> Plane {
    Plane {
        anchor: f32::from_bits(0x3f8147af),
        offset: 0.,
        product: 0.,
        point: -0.5,
        radius: 0.4,
        half: 0.1,
        clearance: 0.01,
    }
}

#[test]
fn recorded_zero_offset_affine_roundoff_clears_small_cell_and_whole_native_domain() {
    let (a, b, sa, sb) = zero_offset_c73();
    let full = context(a, sa.as_ref(), b, sb.as_ref());
    let c = Context {
        start: 0.000011496090088165531,
        end: 0.000011559598590678058,
        ..full
    };
    let plane = zero_offset_plane_c73();
    for interval in [c, full] {
        let first = a.pose(interval.start).translation.y;
        let last = a.pose(interval.end).translation.y;
        let cell = Cell {
            low: ordered(first).min(ordered(last)),
            high: ordered(first).max(ordered(last)),
            depth: 0,
        };
        if interval.start == c.start {
            assert_eq!(first.to_bits(), 0xb7c0b355);
            assert_eq!(last.to_bits(), 0xb7c1c419);
            let grid = Range::new(last, first).unwrap().ulp_exponent();
            assert_eq!(grid, -39);
            assert_eq!(1_u32 << (-23 + 1 - grid), 131_072);
            assert!(matches!(
                cell_proof(cell, plane, &mut work()).unwrap(),
                Attempt::Unavailable
            ));
        }
        let input = Affine::input(cell);
        let actor = input.add(plane.anchor, &mut work()).unwrap().unwrap();
        let top = input.add(plane.half, &mut work()).unwrap().unwrap();
        assert_eq!(actor.error, 2_f64.powi(-24));
        assert_eq!(top.error, 2_f64.powi(-28));
        // Both downstream actual additions are represented-grid exact. A
        // blanket half-ULP there would lose the real near-skin clearance.
        assert_eq!(
            actor.add(plane.point, &mut work()).unwrap().unwrap().error,
            actor.error
        );
        assert_eq!(
            actor
                .add(plane.point - plane.radius, &mut work())
                .unwrap()
                .unwrap()
                .error,
            actor.error
        );
        let mut ledger = work();
        let lower = affine_lower(cell, plane, &mut ledger).unwrap().unwrap();
        assert_eq!(
            ledger.used,
            128 + std::mem::size_of::<[Affine; 4]>() as u64 + 5 * NODE_WORK
        );
        let error = 2_f64.powi(-24) + 2_f64.powi(-28);
        let world_ideal = f64::from(plane.anchor) + f64::from(plane.point)
            - f64::from(plane.radius)
            - f64::from(plane.half);
        let local_ideal =
            f64::from(plane.anchor) + f64::from(plane.point - plane.radius) - f64::from(plane.half);
        assert_eq!(world_ideal - error, 0.010000038892030716);
        assert_eq!(local_ideal - error, 0.010000068694353104);
        assert!(lower[0] <= world_ideal - error && lower[0] > f64::from(full.clearance));
        assert!(lower[1] <= local_ideal - error && lower[1] > f64::from(full.clearance));
        for limit in [ledger.used, ledger.used - 1] {
            let result = affine_lower(cell, plane, &mut Work { used: 0, limit });
            if limit == ledger.used {
                assert_eq!(result.unwrap().unwrap(), lower);
            } else {
                assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
            }
        }
        let result = certificate(interval, rp::Vector::Y, &mut work()).unwrap();
        assert!(result.separated && result.probe.is_none());
    }

    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let initial_used = 11_554_416;
    let mut query = Work {
        used: initial_used,
        limit: 32 * 1024 * 1024,
    };
    let cast = |work: &mut Work| {
        cast_full_shapes_policy_coverage(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            full.start,
            full.end,
            full.clearance,
            f64::from(0.004166667_f32 * 1e-6_f32),
            work,
            true,
        )
    };
    assert!(cast(&mut query).unwrap().hit.is_none());
    assert!(query.used > initial_used);
    for limit in [query.used, query.used - 1] {
        let result = cast(&mut Work {
            used: initial_used,
            limit,
        });
        if limit == query.used {
            assert!(result.unwrap().hit.is_none());
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );
}

#[test]
fn affine_roundoff_preserves_real_contact_tight_offsets_and_incomplete_bins() {
    let (a, mut b, sa, sb) = zero_offset_c73();
    let full = context(a, sa.as_ref(), b, sb.as_ref());
    let cell = Cell {
        low: ordered(a.pose(full.end).translation.y),
        high: ordered(a.pose(full.start).translation.y),
        depth: 0,
    };
    let plane = zero_offset_plane_c73();
    // Ties are not silently made exact: both parities of 1 + half-ULP are
    // covered by the same rigorous roundoff ledger.
    let input = Affine::input(Cell {
        low: ordered(1.),
        high: ordered(1_f32.next_up()),
        depth: 0,
    });
    let tied = input.add(2_f32.powi(-24), &mut work()).unwrap().unwrap();
    assert_eq!(tied.error, 2_f64.powi(-24));
    assert_eq!(tied.actual[0].to_bits(), 1_f32.to_bits());
    assert_eq!(
        tied.actual[1].to_bits(),
        1_f32.next_up().next_up().to_bits()
    );
    assert_eq!(input.add(0., &mut work()).unwrap().unwrap().error, 0.);
    assert!(input.add(f32::INFINITY, &mut work()).unwrap().is_none());
    // A crossing output binade cannot borrow only its favorable subrange.
    let crossing = Cell {
        low: ordered(-0.02),
        ..cell
    };
    assert!(affine_lower(crossing, plane, &mut work())
        .unwrap()
        .is_none());

    if let Curve::Anchored { anchor, .. } = &mut b.curve {
        anchor.y = anchor.y.next_down();
    }
    let contact = context(a, sa.as_ref(), b, sb.as_ref());
    assert!(world_y_gap(a, b, contact.start) < f64::from(contact.clearance));
    let lower = affine_lower(
        cell,
        Plane {
            anchor: plane.anchor.next_down(),
            ..plane
        },
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(lower[0] < f64::from(contact.clearance));
    assert!(
        !certificate(contact, rp::Vector::Y, &mut work())
            .unwrap()
            .separated
    );
    let before = crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap();
    let hit = cast_full_shapes_policy_coverage(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        contact.start,
        contact.end,
        contact.clearance,
        f64::from(0.004166667_f32 * 1e-6_f32),
        &mut work(),
        false,
    )
    .unwrap()
    .hit
    .expect("a genuine initial world contact retains strict authority");
    assert_eq!(hit.safe_time.to_bits(), contact.start.to_bits());
    assert_eq!(hit.hit_time.to_bits(), contact.start.to_bits());
    assert!(hit.contact.dist <= contact.clearance);
    assert_eq!(
        crate::checkpoint_codec::encode(&(a.curve, b.curve)).unwrap(),
        before
    );

    // The earlier off1 near-skin representation is too tight for this error
    // enclosure. Its complete period proof must still win at its old price;
    // the new bound neither bypasses a counter nor invents an inverse cue.
    let (a, b, sa, sb) = candidate_c69(0x3cccccc1);
    let c = actual_interval_c69(a, sa.as_ref(), b, sb.as_ref());
    let tight_cell = Cell {
        low: ordered(a.pose(c.end).translation.y),
        high: ordered(a.pose(c.start).translation.y),
        depth: 0,
    };
    let tight_plane = Plane {
        anchor: f32::from_bits(0x3f7c28f7),
        offset: f32::from_bits(0x3cccccc1),
        ..plane
    };
    assert!(affine_lower(tight_cell, tight_plane, &mut work())
        .unwrap()
        .unwrap()
        .into_iter()
        .any(|v| v <= f64::from(c.clearance)));
    let mut old = work();
    assert!(matches!(
        cell_proof(tight_cell, tight_plane, &mut old).unwrap(),
        Attempt::Clear
    ));
    let mut current = work();
    assert!(
        certificate(c, rp::Vector::Y, &mut current)
            .unwrap()
            .separated
    );
    assert_eq!(current.used, HEADER_WORK + VECTOR_WORK + old.used);
}
