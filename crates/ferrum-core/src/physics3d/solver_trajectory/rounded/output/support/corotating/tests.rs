use super::*;

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
struct Pair {
    a: ShapeMotion,
    b: ShapeMotion,
    sa: rp::SharedShape,
    sb: rp::SharedShape,
}
impl Pair {
    fn context(&self, start: Time, end: Time, clearance: f32) -> Context<'_> {
        Context {
            a: self.a,
            sa: self.sa.as_ref(),
            b: self.b,
            sb: self.sb.as_ref(),
            start,
            end,
            clearance,
        }
    }
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn recorded(nonzero_angle: bool) -> Pair {
    let h = 0.025_f32;
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        crate::physics3d::solver_trajectory::Domain::new(0., f64::from(h)).unwrap(),
        h,
        if nonzero_angle {
            rp::Pose::from_parts(
                rp::Vector::ZERO,
                rp::Rotation::from_xyzw(0., 0., 0.38152424, 0.9243588),
            )
        } else {
            rp::Pose::from_translation(rp::Vector::Y * -0.033326734)
        },
        if nonzero_angle {
            rp::Vector::ZERO
        } else {
            rp::Vector::Y * 2.
        },
        rp::Vector::Z * if nonzero_angle { 7.853982 } else { 2. },
    )
    .unwrap();
    Pair {
        a: motion(Curve::Integrated(k)),
        b: motion(Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::ZERO,
            offset: if nonzero_angle {
                rp::Vector::new(1.1999968, 1.8460345, 0.)
            } else {
                rp::Vector::Y * 1.01
            },
            linear_velocity: if nonzero_angle {
                rp::Vector::new(7.8838453, 29.759804, -0.000261052)
            } else {
                rp::Vector::ZERO
            },
            rotation: rp::Rotation::IDENTITY,
        }),
        sa: if nonzero_angle {
            rp::SharedShape::cuboid(2., 0.025, 0.1)
        } else {
            rp::SharedShape::cuboid(3., 0.1, 3.)
        },
        sb: if nonzero_angle {
            rp::SharedShape::capsule_y(0.25, 0.25)
        } else {
            rp::SharedShape::capsule_y(0.5, 0.4)
        },
    }
}

#[test]
fn cubic_hull_covers_interior_extrema_and_common_time_cancellation_without_sampling_approval() {
    let mut p = Polynomial::zero();
    p.0 = [
        Bound::exact(0.1),
        Bound::exact(-1.),
        Bound::exact(1.),
        Bound::exact(0.),
    ];
    let x = Bound { lo: 0., hi: 1. };
    assert!(p.at(Bound::exact(0.)).lo > 0. && p.at(Bound::exact(1.)).lo > 0.);
    assert!(
        p.range(x).lo < 0.,
        "positive endpoints cannot certify the negative interior"
    );
    let v = Polynomial::affine(1.5, Bound::exact(40.));
    let cancelled = p.add(v).sub(v).range(x);
    assert!(cancelled.lo <= -0.15 && cancelled.hi >= 0.1);
    for i in 0..=64 {
        let at = p.at(Bound::exact(f64::from(i) / 64.));
        let hull = p.range(x);
        assert!(hull.lo <= at.lo && hull.hi >= at.hi);
    }
}

#[test]
fn recorded_shared_carriers_admit_full_moving_prefixes_and_keep_original_pose_bytes() {
    for nonzero in [false, true] {
        let p = recorded(nonzero);
        let before = postcard::to_allocvec(&(p.a, p.b)).unwrap();
        let (start, end) = if nonzero {
            (7.396722864495951e-5, 0.0002)
        } else {
            (0., 0.005)
        };
        // Geometric nonpenetration is intentionally separate from the
        // original near-skin cast tests, which keep their stricter margins.
        assert!(separated(p.context(start, end, 0.), &mut work()).unwrap());
        assert!(separated(
            Context {
                a: p.b,
                sa: p.sb.as_ref(),
                b: p.a,
                sb: p.sa.as_ref(),
                ..p.context(start, end, 0.)
            },
            &mut work()
        )
        .unwrap());
        assert!(
            crate::physics3d::solver_trajectory::cast_full_shapes_policy(
                p.a,
                p.sa.as_ref(),
                p.b,
                p.sb.as_ref(),
                start,
                end,
                0.,
                f64::from(0.025_f32 * 1e-6),
                &mut work(),
                false
            )
            .unwrap()
            .is_none()
        );
        assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), before);
    }
}

#[test]
fn nonzero_anchor_proves_perpendicular_clearance_with_finite_spin_axis_drift() {
    let mut pair = recorded(true);
    let Curve::Integrated(carrier) = pair.a.curve else {
        unreachable!()
    };
    let end = carrier.domain.end;
    let anchored = |anchor, offset, linear_velocity| {
        motion(Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation: rp::Rotation::IDENTITY,
        })
    };
    let anchor = rp::Vector::new(2.1527214, 0.46221992, 0.);
    let offset = rp::Vector::new(2.3841858e-7, 0.001, 0.);
    let drift = rp::Vector::Z * 7.277426e-6;
    pair.b = anchored(anchor, offset, drift);
    let before = postcard::to_allocvec(&(pair.a, pair.b)).unwrap();
    assert!(pair.b.pose(0.).translation.z < pair.b.pose(end).translation.z);
    assert!(separated(pair.context(0., end, 0.01), &mut work()).unwrap());
    assert_eq!(postcard::to_allocvec(&(pair.a, pair.b)).unwrap(), before);

    pair.b = anchored(anchor, offset, drift + rp::Vector::X);
    assert!(!separated(pair.context(0., end, 0.01), &mut work()).unwrap());

    pair.b = anchored(
        rp::Vector::new(0.5, 0., 0.5),
        rp::Vector::ZERO,
        -40. * rp::Vector::Z,
    );
    let contact = rapier3d::parry::query::contact(
        &pair.a.pose(end * 0.5),
        pair.sa.as_ref(),
        &pair.b.pose(end * 0.5),
        pair.sb.as_ref(),
        0.,
    )
    .unwrap()
    .unwrap();
    assert!(contact.dist < 0.);
    assert!(!separated(pair.context(0., end, 0.), &mut work()).unwrap());
}

#[test]
fn recorded_three_microsecond_near_skin_interval_uses_the_original_proof_margin() {
    let p = recorded(false);
    let before = postcard::to_allocvec(&(p.a, p.b)).unwrap();
    let start = 3.051757857974735e-6;
    let end = 3.433227590221577e-6;
    let margin = 0.009999943_f32;
    let Curve::Integrated(k) = p.a.curve else {
        unreachable!()
    };
    let half = p.sa.as_cuboid().unwrap().half_extents;
    let frames = kernel(k, start, end, &mut work()).unwrap().unwrap();
    for frame in &frames.values[..frames.len] {
        let q = frame.rotation.components.map(Value::input);
        let t = frame.translation.map(Value::input);
        let whole = transformed(q, t, box_input(half, None));
        let near = transformed(q, t, box_input(half, Some((1, true))));
        assert!(
            near[1].error < whole[1].error,
            "the opposite slab's larger output binade is not this slab's RN error"
        );
    }
    // The original Native point graph is checked on both closed halves,
    // including their common zero face and every original box corner.
    // These probes test the enclosure; they never approve the production cast.
    for face in 0..3 {
        let lower = box_input(half, Some((face, false)));
        let upper = box_input(half, Some((face, true)));
        assert_eq!(
            (lower[face].actual.lo, lower[face].actual.hi),
            (-half[face], 0.)
        );
        assert_eq!(
            (upper[face].actual.lo, upper[face].actual.hi),
            (0., half[face])
        );
        for x in [-1., 0., 1.] {
            for y in [-1., 0., 1.] {
                for z in [-1., 0., 1.] {
                    let point = half * rp::Vector::new(x, y, z);
                    for positive in [false, true] {
                        if (positive && point[face] < 0.) || (!positive && point[face] > 0.) {
                            continue;
                        }
                        for i in 0..=16 {
                            let time = start + (end - start) * (f64::from(i) / 16.);
                            let actual = k.position_at_time(time) * point;
                            assert!(frames.values[..frames.len].iter().any(|frame| {
                                let bound = transformed(
                                    frame.rotation.components.map(Value::input),
                                    frame.translation.map(Value::input),
                                    box_input(half, Some((face, positive))),
                                );
                                (0..3).all(|j| {
                                    bound[j].actual.lo <= actual[j]
                                        && actual[j] <= bound[j].actual.hi
                                })
                            }));
                        }
                    }
                }
            }
        }
    }
    let mut measured = work();
    assert!(separated(p.context(start, end, margin), &mut measured).unwrap());
    let mut exact = Work {
        used: 17,
        limit: 17 + measured.used,
    };
    assert!(separated(p.context(start, end, margin), &mut exact).unwrap());
    assert_eq!(exact.used, exact.limit);
    let mut short = Work {
        used: 17,
        limit: 17 + measured.used - 1,
    };
    assert!(matches!(
        separated(p.context(start, end, margin), &mut short),
        Err(TrajectoryError::WorkLimit)
    ));
    assert!(
        p.a.separated(
            p.sa.as_ref(),
            p.b,
            p.sb.as_ref(),
            rp::Vector::Y,
            start,
            end,
            margin,
            &mut work()
        )
        .unwrap(),
        "the actual parent proof must consume this certificate"
    );
    assert!(
        crate::physics3d::solver_trajectory::cast_full_shapes_policy(
            p.a,
            p.sa.as_ref(),
            p.b,
            p.sb.as_ref(),
            start,
            end,
            margin,
            2.5e-8,
            &mut work(),
            false
        )
        .unwrap()
        .is_none()
    );
    assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), before);
}

#[test]
fn real_inward_contact_and_nonunit_stored_endpoints_never_become_closed_clear() {
    let mut p = recorded(false);
    let Curve::Anchored {
        carrier, rotation, ..
    } = p.b.curve
    else {
        unreachable!()
    };
    for sign in [-1., 1.] {
        p.b.curve = Curve::Anchored {
            carrier,
            anchor: rp::Vector::ZERO,
            offset: rp::Vector::Y * (sign * 0.95),
            linear_velocity: rp::Vector::ZERO,
            rotation,
        };
        assert!(!separated(p.context(0., 0.005, 0.), &mut work()).unwrap());
        assert!(
            crate::physics3d::solver_trajectory::cast_full_shapes_policy(
                p.a,
                p.sa.as_ref(),
                p.b,
                p.sb.as_ref(),
                0.,
                0.005,
                0.,
                1e-8,
                &mut work(),
                false
            )
            .unwrap()
            .is_some()
        );
    }
    let mut p = recorded(false);
    let Curve::Integrated(mut k) = p.a.curve else {
        unreachable!()
    };
    k.native.motion.end.rotation = rp::Rotation::from_xyzw(0., 0., 0., 2.);
    p.a.curve = Curve::Integrated(k);
    let Curve::Anchored {
        anchor,
        offset,
        linear_velocity,
        rotation,
        ..
    } = p.b.curve
    else {
        unreachable!()
    };
    p.b.curve = Curve::Anchored {
        carrier: k,
        anchor,
        offset,
        linear_velocity,
        rotation,
    };
    let end = k.domain.end;
    assert!(
        !separated(p.context(0., end, 0.), &mut work()).unwrap(),
        "stored q scales the box; no unit-q endpoint substitution"
    );
}

#[test]
fn erased_large_com_local_radius_never_erases_the_real_world_sphere_extent() {
    let mut p = recorded(false);
    let Curve::Integrated(mut k) = p.a.curve else {
        unreachable!()
    };
    k.native.motion.start.translation = rp::Vector::Y * 8191.5;
    k.native.motion.end.translation = rp::Vector::Y * 8191.5;
    k.native.linear_velocity = rp::Vector::ZERO;
    p.a.curve = Curve::Integrated(k);
    p.b.curve = Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::ZERO,
        offset: rp::Vector::Y * 0.5,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    p.sa = rp::SharedShape::cuboid(3., 0.5, 3.);
    p.sb = rp::SharedShape::capsule_y(0., 2_f32.powi(-12));
    assert_eq!(8192_f32 - 2_f32.powi(-12), 8192.);
    assert!(!separated(p.context(0., 0.00001, 0.), &mut work()).unwrap());
}

#[test]
fn mismatched_clock_anchor_frame_and_multiaxis_queries_fall_back_without_a_new_curve() {
    for change in 0..5 {
        let mut p = recorded(false);
        let before = postcard::to_allocvec(&(p.a, p.b)).unwrap();
        let Curve::Anchored {
            mut carrier,
            mut anchor,
            offset,
            mut linear_velocity,
            rotation,
        } = p.b.curve
        else {
            unreachable!()
        };
        match change {
            0 => carrier.domain.end = carrier.domain.end.next_up(),
            1 => carrier.native.integration_seconds = carrier.native.integration_seconds.next_up(),
            2 => {
                anchor = rp::Vector::X;
                linear_velocity = rp::Vector::Y;
            }
            3 => p.b.local_pose.translation.x = 0.001,
            _ => carrier.native.angular_velocity.x = 0.001,
        }
        p.b.curve = Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        };
        let changed = postcard::to_allocvec(&(p.a, p.b)).unwrap();
        assert_ne!(changed, before);
        assert!(!separated(p.context(0., 0.005, 0.), &mut work()).unwrap());
        assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), changed);
    }
}

#[test]
fn exact_and_one_below_work_leave_inputs_unmodified_and_keep_typed_errors() {
    let p = recorded(false);
    let before = postcard::to_allocvec(&(p.a, p.b)).unwrap();
    let mut full = work();
    assert!(separated(p.context(0., 0.005, 0.), &mut full).unwrap());
    let mut exact = Work {
        used: 17,
        limit: 17 + full.used,
    };
    assert!(separated(p.context(0., 0.005, 0.), &mut exact).unwrap());
    assert_eq!(exact.used, exact.limit);
    for available in [0, full.used - 1] {
        let mut limited = Work {
            used: 17,
            limit: 17 + available,
        };
        assert!(matches!(
            separated(p.context(0., 0.005, 0.), &mut limited),
            Err(TrajectoryError::WorkLimit)
        ));
        assert!(limited.used <= limited.limit);
        assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), before);
    }
    assert!(matches!(
        separated(p.context(f64::NAN, 0.005, 0.), &mut work()),
        Err(TrajectoryError::InvalidTime)
    ));
    assert!(matches!(
        separated(p.context(0., 0.005, f32::NAN), &mut work()),
        Err(TrajectoryError::NonFinite)
    ));
}

#[test]
fn native_reciprocal_enclosure_preserves_raw_scalar_outputs_and_subnormal_phase() {
    for nonzero in [false, true] {
        let p = recorded(nonzero);
        let Curve::Integrated(k) = p.a.curve else {
            unreachable!()
        };
        for first in [f32::from_bits(1), 0.000003, 0.012] {
            let mut last = first;
            for _ in 0..16 {
                last = last.next_up();
            }
            let dt = Value::input(Float::span(first, last));
            let hang = k.native.angular_velocity.to_array().map(|v| {
                Value::input(Float::exact(v)).mul(dt.mul(Value::input(Float::exact(0.5))))
            });
            let raw = quat_product(
                [hang[0], hang[1], hang[2], Value::input(Float::exact(1.))],
                k.native
                    .motion
                    .start
                    .rotation
                    .to_array()
                    .map(|v| Value::input(Float::exact(v))),
            );
            let reciprocal = factor(raw.map(|v| v.actual)).unwrap();
            let ranges = raw.map(|v| v.mul(Value::input(reciprocal)).actual);
            let mut at = first;
            for _ in 0..=16 {
                let original = k
                    .native
                    .position_at_integration_time(at)
                    .rotation
                    .to_array();
                for i in 0..4 {
                    assert!(original[i] >= ranges[i].lo && original[i] <= ranges[i].hi);
                }
                at = at.next_up();
            }
        }
    }
}

#[test]
fn complete_raw_rotation_cell_uses_actual_native_quaternion_without_theoretical_error() {
    let mut p = recorded(true);
    let Curve::Integrated(k) = p.a.curve else {
        unreachable!()
    };
    if let Curve::Anchored {
        offset,
        linear_velocity,
        ..
    } = &mut p.b.curve
    {
        *offset = rp::Vector::new(1.1999968, 1.8460344, 0.);
        *linear_velocity = rp::Vector::new(7.8838453, 30.02564, -0.000261052);
    }
    let start = 7.757607783768398e-7;
    let end = 7.757665989737103e-7;
    let x = Bound { lo: start, hi: end };
    let dt = Float::span(k.local_delta(start), k.local_delta(end));
    let h = f64::from(k.native.integration_seconds);
    let mapping = upper_add(upper_mul(h, 2_f64.powi(-53)), (h.next_up() - h) * 0.5);
    let input = Value {
        actual: dt,
        ideal: x,
        error: upper_add(mapping, half_ulp(dt)),
    };
    let half = input.mul(Value::input(Float::exact(0.5)));
    let hang = k
        .native
        .angular_velocity
        .to_array()
        .map(|v| Value::input(Float::exact(v)).mul(half));
    let q0 = k.native.motion.start.rotation.to_array();
    let raw = quat_product(
        [hang[0], hang[1], hang[2], Value::input(Float::exact(1.))],
        q0.map(|v| Value::input(Float::exact(v))),
    );
    // This complete input image contains many distinct physical F32 dt's.
    // The scalar interval graph, not its two endpoint poses, proves constancy.
    assert!(dt.hi.to_bits() - dt.lo.to_bits() > 1);
    assert!(dt.hi.to_bits() - dt.lo.to_bits() < 256);
    assert!(raw.iter().all(|v| singleton(v.actual)));
    assert!(raw.iter().any(|v| v.error > 0.));
    let f = factor(raw.map(|v| v.actual)).unwrap();
    assert!(raw
        .map(|v| v.mul(Value::input(f)))
        .iter()
        .any(|v| v.error > 0.));
    let mut polynomial = [Polynomial::zero(); 4];
    let slope = Bound::exact(f64::from(k.native.angular_velocity.z)).mul(Bound::exact(0.5));
    polynomial[2] = Polynomial::affine(q0[2], slope.mul(Bound::exact(f64::from(q0[3]))));
    polynomial[3] = Polynomial::affine(q0[3], slope.mul(Bound::exact(-f64::from(q0[2]))));
    let rotation = rotation_proof(raw, polynomial).unwrap();
    assert!(rotation.factor.is_exact(1.));
    let expected = rp::Rotation::from_array(raw.map(|v| v.actual.lo))
        .normalize()
        .to_array();
    for (i, &value) in expected.iter().enumerate() {
        assert!(rotation.q[i].0[0].is_exact(f64::from(value)));
        assert!(rotation.q[i].0[1..].iter().all(|c| c.is_exact(0.)));
        assert_eq!(rotation.actual_q[i].error, 0.);
        assert_eq!(rotation.actual_q[i].actual.lo.to_bits(), value.to_bits());
    }
    // Independent complete enumeration of this small original Native input
    // image is a regression oracle, never a trajectory sampling certificate.
    for bits in dt.lo.to_bits()..=dt.hi.to_bits() {
        let actual = k
            .native
            .position_at_integration_time(f32::from_bits(bits))
            .rotation;
        assert_eq!(
            actual.to_array().map(f32::to_bits),
            expected.map(f32::to_bits)
        );
    }
    let before = postcard::to_allocvec(&(p.a, p.b)).unwrap();
    let margin = 0.009999314;
    assert!(separated(p.context(start, end, margin), &mut work()).unwrap());
    assert!(
        crate::physics3d::solver_trajectory::cast_full_shapes_policy(
            p.a,
            p.sa.as_ref(),
            p.b,
            p.sb.as_ref(),
            start,
            end,
            margin,
            f64::from(0.025_f32 * 1e-6),
            &mut work(),
            false,
        )
        .unwrap()
        .is_none()
    );
    assert_eq!(postcard::to_allocvec(&(p.a, p.b)).unwrap(), before);
}

#[test]
fn normalized_output_singletons_are_not_renormalized_and_varying_images_keep_the_old_ledger() {
    let mut raw = [Value::input(Float::ZERO); 4];
    raw[2] = Value::input(Float::span(
        f32::from_bits(0x3dcccc8e),
        f32::from_bits(0x3dcccc8f),
    ));
    raw[3] = Value::input(Float::exact(1.5));
    assert!(!singleton(raw[2].actual));
    let f = factor(raw.map(|v| v.actual)).unwrap();
    let outputs = raw.map(|v| v.mul(Value::input(f)));
    assert!(outputs.iter().all(|v| singleton(v.actual)));
    let exact = rp::Rotation::from_array(outputs.map(|v| v.actual.lo));
    // A second normalization changes these actual F32 bits. The output-image
    // branch must read the original normalized result instead of doing that.
    assert_ne!(
        exact.normalize().to_array().map(f32::to_bits),
        exact.to_array().map(f32::to_bits)
    );
    let polynomial = [Polynomial::constant(0.25); 4];
    let proof = rotation_proof(raw, polynomial).unwrap();
    assert_eq!(
        proof.actual_q.map(|v| v.actual.lo.to_bits()),
        exact.to_array().map(f32::to_bits)
    );
    assert!(proof.actual_q.iter().all(|v| v.error == 0.));
    assert!(proof.factor.is_exact(1.));

    raw[2] = Value::input(Float::span(0.1, 0.2));
    let f = factor(raw.map(|v| v.actual)).unwrap();
    let original = raw.map(|v| v.mul(Value::input(f)));
    assert!(original.iter().any(|v| !singleton(v.actual)));
    let proof = rotation_proof(raw, polynomial).unwrap();
    for (i, value) in original.iter().enumerate() {
        assert_eq!(
            proof.actual_q[i].actual.lo.to_bits(),
            value.actual.lo.to_bits()
        );
        assert_eq!(
            proof.actual_q[i].actual.hi.to_bits(),
            value.actual.hi.to_bits()
        );
        assert_eq!(proof.actual_q[i].error.to_bits(), value.error.to_bits());
        for (actual, expected) in proof.q[i].0.iter().zip(polynomial[i].0) {
            assert_eq!(actual.lo.to_bits(), expected.lo.to_bits());
            assert_eq!(actual.hi.to_bits(), expected.hi.to_bits());
        }
    }
    assert_eq!(proof.factor.lo.to_bits(), f64::from(f.lo).to_bits());
    assert_eq!(proof.factor.hi.to_bits(), f64::from(f.hi).to_bits());
    assert!(rotation_proof([Value::input(Float::ZERO); 4], polynomial).is_none());
    assert!(rotation_proof([Value::input(Float::exact(f32::MAX)); 4], polynomial).is_none());
    assert!(rotation_proof(
        [Value::input(Float::exact(f32::from_bits(1))); 4],
        polynomial
    )
    .is_none());
    raw[2] = Value::input(Float::exact(f32::NAN));
    assert!(rotation_proof(raw, polynomial).is_none());
}

#[test]
fn incoming_rotating_box_uses_correlated_translation_and_both_capsule_radii() {
    let start = 0.04900101794303979;
    let end = 0.061750763829808875;
    let domain = crate::physics3d::solver_trajectory::Domain::new(start, end).unwrap();
    let h = 0.0127497455;
    let cuboid = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        domain,
        h,
        rp::Pose::from_parts(
            rp::Vector::new(0.5099948, 0., 0.),
            rp::Rotation::from_xyzw(0., 6.963409e-7, 1.2162493e-13, 1.),
        ),
        rp::Vector::new(-5.066886, 0., 0.),
        rp::Vector::new(0., 1.3650212, 2.3841858e-7),
    )
    .unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        h,
        rp::Pose::from_translation(rp::Vector::new(0.5099948, 0., 0.09800203)),
        rp::Vector::new(-5.066886, 0., 2.),
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(-0.5099948, 0., 0.),
        offset: rp::Vector::new(-5.098521e-6, 0., 0.),
        linear_velocity: rp::Vector::new(0.1337719, 0., 0.),
        rotation: rp::Rotation::IDENTITY,
    });
    let b = motion(Curve::Integrated(cuboid));
    let sa = rp::SharedShape::capsule_y(0.25, 0.25);
    let sb = rp::SharedShape::cuboid(0.25, 1., 1.);
    let context = Context {
        a,
        sa: sa.as_ref(),
        b,
        sb: sb.as_ref(),
        start,
        end: start + (end - start) / 512.,
        clearance: 0.01,
    };
    let mut measured = work();
    assert!(moving_face::separated(context, &mut measured).unwrap());
    assert!(measured.used < 150_000);
    assert!(!moving_face::separated(
        Context {
            clearance: 0.01001,
            ..context
        },
        &mut work()
    )
    .unwrap());
    assert_eq!(
        moving_face::separated(
            context,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            },
        ),
        Err(TrajectoryError::WorkLimit)
    );
}

#[test]
fn moving_box_face_covers_a_full_interval_with_independent_capsule_translation() {
    use crate::physics3d::solver_trajectory::Domain;

    let start = 0.061750763829808875;
    let end = 0.07450050971657796;
    let domain = Domain::new(start, end).unwrap();
    let h = 0.0127497455;
    let cuboid = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        domain,
        h,
        rp::Pose::from_parts(
            rp::Vector::new(0.4453933, 0., 0.),
            rp::Rotation::from_xyzw(0., 0.008702205, 1.5199523e-9, 0.9999622),
        ),
        rp::Vector::new(-5.066886, 0., 0.),
        rp::Vector::new(6.720677e-20, 1.3650215, 2.3841864e-7),
    )
    .unwrap();
    let capsule = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        h,
        rp::Pose::from_translation(rp::Vector::new(-0.06290105, 0., 0.123501524)),
        rp::Vector::new(-4.933114, 0., 2.),
        rp::Vector::ZERO,
    )
    .unwrap();
    let pair = Pair {
        a: motion(Curve::Integrated(capsule)),
        b: motion(Curve::Integrated(cuboid)),
        sa: rp::SharedShape::capsule_y(0.25, 0.25),
        sb: rp::SharedShape::cuboid(0.25, 1., 1.),
    };
    let mut measured = work();
    assert!(moving_face::separated(pair.context(start, end, 0.01), &mut measured).unwrap());
    assert!(measured.used < 150_000);
    assert!(!moving_face::separated(pair.context(start, end, 0.0105), &mut work()).unwrap());
}
