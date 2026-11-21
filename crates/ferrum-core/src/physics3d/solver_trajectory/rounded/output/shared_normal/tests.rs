use super::*;
use crate::physics3d::solver_trajectory::{cast_full_shapes_policy, Domain};

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
struct Fixture {
    k: Kernel,
    a: ShapeMotion,
    b: ShapeMotion,
    sa: rp::SharedShape,
    sb: rp::SharedShape,
}
fn recorded() -> Fixture {
    let domain = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let mut k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.0032724752, 0., 0.99999464),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., std::f32::consts::FRAC_PI_2, 0.),
    )
    .unwrap();
    k.native.motion.start_time = 0.004166667;
    k.native.motion.end_time = 0.008333334;
    let a = ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier: k,
            anchor: rp::Vector::new(0.99997854, 0.10000002, -0.0065449155),
            offset: rp::Vector::new(6.431341e-5, 0.91000015, 0.0065446342),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    Fixture {
        k,
        a,
        b,
        sa: rp::SharedShape::cuboid(3., 0.1, 3.),
        sb: rp::SharedShape::capsule_y(0.5, 0.4),
    }
}
fn context(f: &Fixture, start: Time, end: Time) -> Context<'_> {
    Context {
        a: f.a,
        sa: f.sa.as_ref(),
        b: f.b,
        sb: f.sb.as_ref(),
        start,
        end,
        clearance: 0.01,
    }
}

#[test]
fn c84_rotating_normal_delta_certifies_the_original_projected_full_future() {
    let f = recorded();
    let before = crate::checkpoint_codec::encode(&(f.a, f.b, &f.sa, &f.sb)).unwrap();
    let Curve::Anchored { anchor, .. } = f.b.curve else {
        unreachable!()
    };
    assert_ne!(anchor.y.to_bits(), 0.1_f32.to_bits());
    assert_eq!(
        f.k.native.motion.end.rotation.to_array().map(f32::to_bits),
        rp::Rotation::from_xyzw(0., 0.006544916, 0., 0.99997866)
            .to_array()
            .map(f32::to_bits)
    );
    let start = 0.00807291708770208;
    let end = f.k.domain.end;
    let mut charged = work();
    assert!(separated(context(&f, start, end), rp::Vector::Y, &mut charged).unwrap());
    let price = charged.used;
    for limit in [price, price - 1] {
        let result = separated(
            context(&f, start, end),
            rp::Vector::Y,
            &mut Work {
                used: 1000,
                limit: 1000 + limit,
            },
        );
        if limit == price {
            assert!(result.unwrap());
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    assert!(separated(
        context(&f, f.k.domain.start, end),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    let reversed = Context {
        a: f.b,
        sa: f.sb.as_ref(),
        b: f.a,
        sb: f.sa.as_ref(),
        ..context(&f, f.k.domain.start, end)
    };
    assert!(separated(reversed, -rp::Vector::Y, &mut work()).unwrap());
    let tolerance = f64::from((f.k.native.motion.end_time - f.k.native.motion.start_time) * 1e-6);
    let mut future = work();
    assert!(cast_full_shapes_policy(
        f.a,
        f.sa.as_ref(),
        f.b,
        f.sb.as_ref(),
        f.k.domain.start,
        end,
        0.01,
        tolerance,
        &mut future,
        true
    )
    .unwrap()
    .is_none());
    assert!(
        future.used < 1_000_000,
        "original projected future exhausted the fixed32Mi ledger"
    );
    // C87 actual response candidate: .91 is not the earlier .91000015.
    // The independent error envelope cannot close its thin real margin; the
    // common exact output lattice must still approve the whole original future.
    let mut current = recorded();
    let Curve::Anchored { offset, .. } = &mut current.b.curve else {
        unreachable!()
    };
    offset.y = 0.91;
    let Curve::Anchored { anchor, .. } = current.b.curve else {
        unreachable!()
    };
    assert_eq!(anchor.y - 0.1_f32, 2. * (0.1_f32.next_up() - 0.1_f32));
    let c87_start = 0.00424452265755626;
    let c87_end = 0.004252619313220407;
    let original =
        crate::checkpoint_codec::encode(&(current.a, current.b, &current.sa, &current.sb)).unwrap();
    let mut cell_work = work();
    assert!(separated(
        context(&current, c87_start, c87_end),
        rp::Vector::Y,
        &mut cell_work
    )
    .unwrap());
    for limit in [cell_work.used, cell_work.used - 1] {
        let found = separated(
            context(&current, c87_start, c87_end),
            rp::Vector::Y,
            &mut Work {
                used: 37,
                limit: 37 + limit,
            },
        );
        if limit == cell_work.used {
            assert!(found.unwrap());
        } else {
            assert_eq!(found, Err(TrajectoryError::WorkLimit));
        }
    }
    let mut actual_future = work();
    assert!(cast_full_shapes_policy(
        current.a,
        current.sa.as_ref(),
        current.b,
        current.sb.as_ref(),
        f64::from_bits(4571478279943356415),
        current.k.domain.end,
        0.01,
        tolerance,
        &mut actual_future,
        true
    )
    .unwrap()
    .is_none());
    assert!(actual_future.used < actual_future.limit);
    assert_eq!(
        crate::checkpoint_codec::encode(&(current.a, current.b, &current.sa, &current.sb)).unwrap(),
        original
    );

    // A small admitted nonunit stored quaternion and a negative anchor delta
    // must use actual coefficients, never a manufactured qnorm=1/equality.
    let mut nonunit = recorded();
    let mut k = nonunit.k;
    let scale = 1_f32.next_up();
    k.native.motion.start.rotation =
        rp::Rotation::from_array(k.native.motion.start.rotation.to_array().map(|v| v * scale));
    k.native.motion.end.rotation =
        rp::Rotation::from_array(k.native.motion.end.rotation.to_array().map(|v| v * scale));
    nonunit.a.curve = Curve::Integrated(k);
    let Curve::Anchored {
        carrier, anchor, ..
    } = &mut nonunit.b.curve
    else {
        unreachable!()
    };
    *carrier = k;
    anchor.y = 0.1_f32.next_down();
    assert_ne!(k.native.motion.start.rotation.length_squared(), 1.);
    assert!(separated(
        context(&nonunit, k.domain.start, k.domain.end),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.a, f.b, &f.sa, &f.sb)).unwrap(),
        before
    );
}

#[test]
fn shared_rotating_normal_keeps_gravity_contacts_clock_and_real_radius_counterexamples() {
    let mut f = recorded();
    let Curve::Anchored {
        linear_velocity, ..
    } = &mut f.b.curve
    else {
        unreachable!()
    };
    linear_velocity.y = -0.022303263;
    let before = crate::checkpoint_codec::encode(&(f.a, f.b)).unwrap();
    assert!(!separated(
        context(&f, f.k.domain.start, f.k.domain.end),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    // One original closed Box point/actual Capsule core and real radius give
    // a positive interior-contact counter. Absence of a point is never NoHit.
    let t = f.k.domain.end;
    let box_pose = f.a.pose(t);
    let cap_pose = f.b.pose(t);
    let core = cap_pose * f.sb.as_capsule().unwrap().segment.a;
    let half = f.sa.as_cuboid().unwrap().half_extents;
    let local = (box_pose.inverse() * core).clamp(-half, half);
    assert!(local.cmpge(-half).all() && local.cmple(half).all());
    let point = box_pose * local;
    let mut squared = Bound::exact(0.);
    for axis in 0..3 {
        let delta = Bound::exact(f64::from(core[axis])).sub(Bound::exact(f64::from(point[axis])));
        squared = squared.add(delta.mul(delta));
    }
    let gap = squared.sqrt().sub(Bound::exact(f64::from(0.4_f32)));
    assert!(gap.hi < 0.01);
    let pair = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        f.sa.as_ref(),
        f.sb.as_ref(),
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(pair
        .native_strict_at(f.a, f.b, t, 0.01, &mut work())
        .unwrap());
    for change in 0..4 {
        let mut g = recorded();
        match change {
            0 => {
                let Curve::Anchored { carrier, .. } = &mut g.b.curve else {
                    unreachable!()
                };
                carrier.domain.start = carrier.domain.start.next_down();
            }
            1 => {
                let Curve::Anchored { rotation, .. } = &mut g.b.curve else {
                    unreachable!()
                };
                *rotation = rp::Rotation::from_rotation_x(0.01);
            }
            2 => {
                let Curve::Integrated(k) = &mut g.a.curve else {
                    unreachable!()
                };
                k.native.angular_velocity.z = f32::from_bits(1);
            }
            _ => g.a.local_pose.translation.y = 0.125,
        }
        assert!(!separated(
            context(&g, g.k.domain.start, g.k.domain.end),
            rp::Vector::Y,
            &mut work()
        )
        .unwrap());
    }
    let mut actual_contact = recorded();
    let Curve::Anchored { offset, .. } = &mut actual_contact.b.curve else {
        unreachable!()
    };
    offset.y = 0.909999;
    assert!(!separated(
        context(&actual_contact, 0.00424452265755626, 0.004252619313220407),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    // A smaller actual one-grid-step action input cannot borrow the two-step
    // floor. Any single insufficient represented S keeps the whole proof false.
    let mut insufficient = recorded();
    let Curve::Anchored { anchor, offset, .. } = &mut insufficient.b.curve else {
        unreachable!()
    };
    anchor.y = 0.1_f32.next_up();
    offset.y = 0.91;
    assert!(!separated(
        context(&insufficient, 0.00424452265755626, 0.004252619313220407),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    let mut nonzero = recorded();
    let Curve::Anchored {
        offset,
        linear_velocity,
        ..
    } = &mut nonzero.b.curve
    else {
        unreachable!()
    };
    offset.y = 0.91;
    linear_velocity.y = -0.022303263;
    assert!(!separated(
        context(&nonzero, nonzero.k.domain.start, nonzero.k.domain.end),
        rp::Vector::Y,
        &mut work()
    )
    .unwrap());
    let g = recorded();
    assert!(!separated(
        context(&g, g.k.domain.start, g.k.domain.end),
        rp::Vector::new(1e-6, 1., 0.),
        &mut work()
    )
    .unwrap());
    // A stored qI/zero-omega form is left to the old scalar certificates,
    // without charging even this optional header.
    let mut static_form = recorded();
    let Curve::Integrated(k) = &mut static_form.a.curve else {
        unreachable!()
    };
    k.native.angular_velocity = rp::Vector::ZERO;
    let mut untouched = Work {
        used: 81,
        limit: 81,
    };
    assert!(!separated(
        context(&static_form, g.k.domain.start, g.k.domain.end),
        rp::Vector::Y,
        &mut untouched
    )
    .unwrap());
    assert_eq!(untouched.used, 81);
    // At a large COM a local pole can erase the original world radius. Both
    // independent support interpretations still have to pass the same margin.
    let mut erased = recorded();
    erased.sb = rp::SharedShape::capsule_y(16777216., 0.4);
    let Curve::Anchored { offset, .. } = &mut erased.b.curve else {
        unreachable!()
    };
    offset.y = 16777216.;
    assert_eq!(-16777216_f32 - 0.4, -16777216.);
    let mut c = context(&erased, erased.k.domain.start, erased.k.domain.end);
    c.clearance = -0.2;
    assert!(!separated(c, rp::Vector::Y, &mut work()).unwrap());
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.a, f.b)).unwrap(),
        before
    );
}

#[test]
fn c89_larger_odd_action_gap_requires_strict_second_term_and_both_radius_graphs() {
    let q = Float::exact(0.0065464294_f32);
    let w = 0.99997866_f32;
    let scale = Float::exact(w * w - q.lo * q.lo);
    let half = 0.1;
    let anchor = f32::from_bits(0x3dccccde);
    let offset = f32::from_bits(0x3f68f5c1);
    let translation = Float::exact(-0.1);
    let run = |q, scale, offset, budget: &mut Work| {
        lattice_phase(
            q,
            scale,
            translation,
            Float::exact(0.),
            half,
            anchor,
            offset,
            -0.5,
            0.4,
            0.01,
            None,
            budget,
        )
    };
    let mut paid = work();
    assert!(run(q, scale, offset, &mut paid).unwrap());
    let actual_action = |p: f32| (p * scale.lo) + q.lo * ((p * q.lo) * 2.);
    let h = actual_action(half);
    let a = actual_action(anchor);
    assert_eq!((f64::from(a) - f64::from(h)) / 2_f64.powi(-27), 17.);
    let com = (-0.1_f32 + a) + offset;
    let top = -0.1_f32 + h;
    assert!(f64::from(com - 0.5) - f64::from(0.4_f32) - f64::from(top) > f64::from(0.01_f32));
    assert!(f64::from(com + (-0.5_f32 - 0.4)) - f64::from(top) > f64::from(0.01_f32));
    for available in [paid.used, paid.used - 1] {
        let mut budget = Work {
            used: 100,
            limit: 100 + available,
        };
        let result = run(q, scale, offset, &mut budget);
        if available == paid.used {
            assert!(result.unwrap());
            assert_eq!(budget.used, budget.limit);
        } else {
            assert_eq!(result, Err(TrajectoryError::WorkLimit));
        }
    }
    // Zero q cannot borrow a strict second-term proof, and an original real
    // contact cannot borrow the phase change merely because its gap is close.
    assert!(!run(Float::exact(0.), Float::exact(1.), offset, &mut work()).unwrap());
    assert!(!run(q, scale, offset - 0.000001, &mut work()).unwrap());
    // An odd unit shift alone is insufficient: at an exact half tie it can
    // round one ULP back. The producer above must prove a STRICT second term.
    let one = 1_f32;
    let ulp = f64::from(one.next_up()) - 1.;
    let tie = 1. + 1.5 * ulp;
    assert_eq!(tie as f32, f32::from_bits(one.to_bits() + 2));
    assert_eq!(((tie + ulp) as f32).to_bits(), one.to_bits() + 2);
}

#[test]
fn complete_modular_product_bound_covers_all_represented_scales() {
    let scale = Float::span(0.9998, 0.99999);
    let half = 0.1;
    let anchor = f32::from_bits(0x3dccccde);
    let spacing = 2_f64.powi(-27);
    let lower = modular_product_gap(scale, spacing, half, anchor, &mut work())
        .unwrap()
        .unwrap();
    assert_eq!(lower, 17.);
    for bits in scale.lo.to_bits()..=scale.hi.to_bits() {
        let s = f32::from_bits(bits);
        assert!((f64::from(anchor * s) - f64::from(half * s)) / spacing >= lower);
    }
}

fn recorded_independent() -> Fixture {
    let h = 0.004166667_f32;
    let end = f64::from(h);
    let box_kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., end).unwrap(),
        h,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.19508974, 0., 0.9807855),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., std::f32::consts::FRAC_PI_2, 0.),
    )
    .unwrap();
    let cap_kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(f64::from(f32::from_bits(1)) * 0.5, end).unwrap(),
        h,
        rp::Pose::from_translation(rp::Vector::new(0.9203319, 0.9100001, -0.38119462)),
        rp::Vector::new(-0.5987792, 1.8626451e-9, -1.4456542),
        rp::Vector::ZERO,
    )
    .unwrap();
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    Fixture {
        k: cap_kernel,
        a: motion(Curve::Integrated(box_kernel)),
        b: motion(Curve::Integrated(cap_kernel)),
        sa: rp::SharedShape::cuboid(3., 0.1, 3.),
        sb: rp::SharedShape::capsule_y(0.5, 0.4),
    }
}

#[test]
fn independent_clock_proof_clears_the_recorded_sixteenth_tick_scene_query() {
    let f = recorded_independent();
    let c = context(&f, f.k.domain.start, f.k.domain.end);
    let Curve::Integrated(box_kernel) = c.a.curve else {
        unreachable!()
    };
    assert_ne!(box_kernel.domain.start, f.k.domain.start);
    assert_eq!(
        box_kernel.native.motion.end.rotation.to_array(),
        [0., 0.19829826, 0., 0.9801417]
    );
    assert_eq!(
        f.k.native.motion.end.translation.to_array(),
        [0.91783696, 0.9100001, -0.38721818]
    );

    let mut proof = work();
    assert!(complete_separation(c, rp::Vector::Y, &mut proof).unwrap());
    assert!(proof.used < 100_000, "work={}", proof.used);
    let reverse = Context {
        a: c.b,
        sa: c.sb,
        b: c.a,
        sb: c.sa,
        ..c
    };
    assert!(complete_separation(reverse, -rp::Vector::Y, &mut work()).unwrap());

    let mut cast_work = Work {
        used: 0,
        limit: 200_000,
    };
    assert!(cast_full_shapes_policy(
        c.a,
        c.sa,
        c.b,
        c.sb,
        c.start,
        c.end,
        c.clearance,
        f64::from(f.k.native.integration_seconds * 1e-6),
        &mut cast_work,
        true,
    )
    .unwrap()
    .is_none());
}

#[test]
fn independent_clock_proof_keeps_world_contact_and_stored_endpoints() {
    let f = recorded_independent();
    let c = context(&f, f.k.domain.start, f.k.domain.end);
    let pair =
        crate::physics3d::solver_trajectory::world_contact::Pair::new(c.sa, c.sb, &mut work())
            .unwrap()
            .unwrap();
    let cap_motion = |carrier| ShapeMotion {
        curve: Curve::Integrated(carrier),
        ..c.b
    };
    let mut lower = f.k;
    lower.native.motion.start.translation.y = lower.native.motion.start.translation.y.next_down();
    lower.native.motion.end.translation.y = lower.native.motion.end.translation.y.next_down();
    let b = cap_motion(lower);
    assert!(!complete_separation(Context { b, ..c }, rp::Vector::Y, &mut work()).unwrap());
    let t = f64::from(f32::from_bits(885006739));
    assert!(pair
        .native_strict_at(c.a, b, t, c.clearance, &mut work())
        .unwrap());

    let mut stored_jump = f.k;
    stored_jump.native.motion.end.translation.y = stored_jump
        .native
        .motion
        .end
        .translation
        .y
        .next_down()
        .next_down();
    let b = cap_motion(stored_jump);
    assert!(
        complete_separation(Context { b, end: 0.004, ..c }, rp::Vector::Y, &mut work(),).unwrap()
    );
    assert!(!complete_separation(Context { b, ..c }, rp::Vector::Y, &mut work()).unwrap());
    assert!(pair
        .native_strict_at(c.a, b, c.end, c.clearance, &mut work())
        .unwrap());
}

fn near_face_response(
    domain: Domain,
    from: [f32; 4],
    to: [f32; 4],
    anchor: [f32; 3],
    offset: [f32; 3],
) -> Fixture {
    let [x, y, z, w] = from;
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(x, y, z, w),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(carrier.native.motion.end.rotation.to_array(), to);
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::from_array(anchor),
            offset: rp::Vector::from_array(offset),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    Fixture {
        k: carrier,
        a,
        b,
        sa: rp::SharedShape::cuboid(3., 0.1, 3.),
        sb: rp::SharedShape::capsule_y(0.5, 0.4),
    }
}

#[test]
fn one_action_step_proves_the_recorded_near_face_response() {
    let f = near_face_response(
        Domain::new(0.004166666883975267, 0.008333333767950535).unwrap(),
        [0., 0.3491843, 0., 0.9370541],
        [0., 0.35224894, 0., 0.9359064],
        [0.99365985, 0.10000002, -0.00646922],
        [0.004271865, 0.91, 0.0049039125],
    );
    // A second-product change bounded only by one cell width may land
    // on two ties and produce equal outputs.
    assert_eq!(second_product_gap(Float::exact(0.25), 0.1, 0.10000002), 0.);
    check_near_face_response(f, 0.004171774325413935, 0.91_f32.next_down());
}

#[test]
fn both_product_gaps_prove_the_recorded_larger_near_face_response() {
    let f = near_face_response(
        Domain::new(0.012500000651925802, 0.01666666753590107).unwrap(),
        [0., 0.3675148, 0., 0.9300177],
        [0., 0.37055627, 0., 0.92881],
        [0.9931072, 0.100000136, -0.0194664],
        [0.0134705305, 0.9099999, 0.014103472],
    );
    check_near_face_response(
        f,
        0.012520134184342167,
        0.9099999_f32.next_down().next_down(),
    );
}

fn check_near_face_response(f: Fixture, start: Time, lower_offset: f32) {
    let c = context(&f, start, f.k.domain.end);
    let budget = || Work {
        used: 0,
        limit: 200_000,
    };
    let mut proof = budget();
    assert!(complete_separation(c, rp::Vector::Y, &mut proof).unwrap());
    let mut cast_work = budget();
    assert!(cast_full_shapes_policy(
        c.a,
        c.sa,
        c.b,
        c.sb,
        c.start,
        c.end,
        c.clearance,
        f64::from((f.k.native.motion.end_time - f.k.native.motion.start_time) * 1e-6),
        &mut cast_work,
        true,
    )
    .unwrap()
    .is_none());

    let mut b = c.b;
    let Curve::Anchored { offset, .. } = &mut b.curve else {
        unreachable!()
    };
    offset.y = lower_offset;
    assert!(!complete_separation(Context { b, ..c }, rp::Vector::Y, &mut budget()).unwrap());
    let pair =
        crate::physics3d::solver_trajectory::world_contact::Pair::new(c.sa, c.sb, &mut budget())
            .unwrap()
            .unwrap();
    assert!(pair
        .native_strict_at(c.a, b, c.end, c.clearance, &mut budget())
        .unwrap());
}

#[test]
fn signed_action_difference_clears_the_recorded_lower_anchor() {
    let f = near_face_response(
        Domain::new(0.012500000651925802, 0.01666666753590107).unwrap(),
        [0., 0.41568428, 0., 0.909509],
        [0., 0.4186584, 0., 0.9081438],
        [0.99208695, 0.1_f32.next_down(), -0.01944226],
        [0.014855564, 0.9100001, 0.012605369],
    );
    check_near_face_response(
        f,
        0.01250009193632806,
        0.9100001_f32.next_down().next_down(),
    );
}

#[test]
fn mixed_product_and_action_grids_clear_the_recorded_near_face_response() {
    let f = near_face_response(
        Domain::new(0.004166666883975267, 0.008333333767950535).unwrap(),
        [0., 0.4452199, 0., 0.89542127],
        [0., 0.44814774, 0., 0.8939595],
        [0.99161905, 0.10000014, -0.006447345],
        [0.0051873922, 0.9099999, 0.003900528],
    );
    let [_, y, _, w] = f.k.native.motion.end.rotation.to_array();
    let scale = w * w - y * y;
    let first = 0.1 * scale;
    let final_value = (f.k.native.motion.end.rotation * (rp::Vector::Y * 0.1)).y;
    let spacing = |value| binade(Float::exact(value)).unwrap().0;
    assert_eq!(spacing(first) * 2., spacing(final_value));
    check_near_face_response(f, 0.004168286228434681, 0.9099999_f32.next_down());
}
