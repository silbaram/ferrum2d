use super::*;
use crate::physics3d::solver_trajectory::{cast_full_shapes_policy, leaf_contact, Domain};
fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
struct Fixture {
    a: ShapeMotion,
    b: ShapeMotion,
    sa: rp::SharedShape,
    sb: rp::SharedShape,
    selected: f32,
    time: Time,
}
fn kernel(body: u32, d: Domain, h: f32, x: f32, v: rp::Vector, w: rp::Vector) -> Kernel {
    Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(body, 0),
        d,
        h,
        rp::Pose::from_translation(rp::Vector::new(x, 0., 0.)),
        v,
        w,
    )
    .unwrap()
}
fn recorded(is_box: bool) -> Fixture {
    let (a, b, selected, time) = if is_box {
        let d = Domain::new(0.048999998703598946, 0.06174999940022824).unwrap();
        (
            kernel(
                0,
                d,
                0.012750001,
                0.48999998,
                rp::Vector::new(5., 2.1492058e-7, 2.8656075e-7),
                rp::Vector::ZERO,
            ),
            kernel(
                1,
                d,
                0.012750001,
                1.,
                rp::Vector::new(5., -2.149206e-7, -2.865608e-7),
                rp::Vector::new(3.5527137e-15, -2.0227823e-7, 1.1920929e-7),
            ),
            0.009999915,
            0.04900151862212376,
        )
    } else {
        let d = Domain::new(0., 0.02500000037252903).unwrap();
        (
            kernel(
                0,
                d,
                0.025,
                0.,
                rp::Vector::new(3., 0., 0.),
                rp::Vector::ZERO,
            ),
            kernel(
                1,
                d,
                0.025,
                0.51,
                rp::Vector::new(3., 1.2895232e-7, 1.7193648e-7),
                rp::Vector::ZERO,
            ),
            0.00999996,
            0.0003295898486612714,
        )
    };
    let motion = |k| ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    Fixture {
        a: motion(a),
        b: motion(b),
        sa: rp::SharedShape::capsule_y(0.25, 0.25),
        sb: if is_box {
            rp::SharedShape::cuboid(0.25, 1., 1.)
        } else {
            rp::SharedShape::capsule_y(0.25, 0.25)
        },
        selected,
        time,
    }
}
impl Fixture {
    fn context(&self) -> Context<'_> {
        let (start, end) = self.a.curve.times();
        Context {
            a: self.a,
            sa: self.sa.as_ref(),
            b: self.b,
            sb: self.sb.as_ref(),
            start,
            end,
            clearance: self.selected,
        }
    }
    fn bytes(&self) -> Vec<u8> {
        crate::checkpoint_codec::encode(&(self.a, self.b, &self.sa, &self.sb, self.selected))
            .unwrap()
    }
}
#[test]
fn recorded_finite_mass_and_shared_body_first_hits_keep_complete_selected_shape_support() {
    for is_box in [false, true] {
        let f = recorded(is_box);
        let before = f.bytes();
        let native = leaf_contact(
            &f.a.pose(f.time),
            f.sa.as_ref(),
            &f.b.pose(f.time),
            f.sb.as_ref(),
            &mut work(),
        )
        .unwrap();
        assert!(native.dist > f.selected);
        let ctx = f.context();
        let mut measured = work();
        assert!(
            separated(ctx, native.normal1, &mut measured).unwrap(),
            "box={is_box}"
        );
        assert!(measured.used < 100_000);
        for allowance in [measured.used, measured.used - 1] {
            let result = separated(
                ctx,
                native.normal1,
                &mut Work {
                    used: 97,
                    limit: 97 + allowance,
                },
            );
            if allowance == measured.used {
                assert!(result.unwrap());
            } else {
                assert_eq!(result, Err(TrajectoryError::WorkLimit));
            }
        }
        let flipped = Context {
            a: ctx.b,
            sa: ctx.sb,
            b: ctx.a,
            sb: ctx.sa,
            ..ctx
        };
        assert!(separated(flipped, -native.normal1, &mut work()).unwrap());
        if is_box {
            let Curve::Integrated(k) = f.b.curve else {
                unreachable!()
            };
            assert!(k.native.angular_velocity != rp::Vector::ZERO);
            assert!(unchanged_box_normal(
                f.b,
                f.sb.as_cuboid().unwrap(),
                0,
                ctx.start,
                ctx.end,
                &mut work()
            )
            .unwrap());
            assert_eq!(
                k.native.angular_velocity.to_array(),
                [3.5527137e-15, -2.0227823e-7, 1.1920929e-7]
            );
        }
        let Curve::Integrated(k) = f.a.curve else {
            unreachable!()
        };
        let tol = f64::from((k.native.motion.end_time - k.native.motion.start_time) * 1e-6);
        // Original request .01 + existing-contact policy selects its OWN band.
        // Direct selected support is not permission to lower a strict request.
        assert!(
            cast_full_shapes_policy(
                f.a,
                f.sa.as_ref(),
                f.b,
                f.sb.as_ref(),
                ctx.start,
                ctx.end,
                0.01,
                tol,
                &mut work(),
                true
            )
            .unwrap()
            .is_none(),
            "whole caller box={is_box}"
        );
        assert!(cast_full_shapes_policy(
            f.a,
            f.sa.as_ref(),
            f.b,
            f.sb.as_ref(),
            ctx.start,
            ctx.end,
            0.01,
            tol,
            &mut work(),
            false
        )
        .unwrap()
        .is_some());
        assert_eq!(f.bytes(), before);
    }
}
#[test]
fn common_product_rejects_contact_clock_rotation_and_partial_binade_authority() {
    for is_box in [false, true] {
        for change in 0..8 {
            let mut f = recorded(is_box);
            let Curve::Integrated(mut a) = f.a.curve else {
                unreachable!()
            };
            let Curve::Integrated(mut b) = f.b.curve else {
                unreachable!()
            };
            match change {
                0 => b.native.linear_velocity.x = b.native.linear_velocity.x.next_up(),
                1 => b.domain.start = b.domain.start.next_up(),
                2 => b.native.motion.end_time = b.native.motion.end_time.next_up(),
                3 => {
                    a.native.motion.end.translation.z = a.native.motion.end.translation.z.next_up()
                }
                4 => {
                    b = Kernel::from_velocity_seconds(
                        b.native.motion.body,
                        b.domain,
                        b.native.integration_seconds,
                        b.native.motion.start,
                        b.native.linear_velocity,
                        rp::Vector::Y * 0.01,
                    )
                    .unwrap();
                }
                5 => {
                    let mut pose = b.native.motion.start;
                    pose.translation.x -= 0.001;
                    b = Kernel::from_velocity_seconds(
                        b.native.motion.body,
                        b.domain,
                        b.native.integration_seconds,
                        pose,
                        b.native.linear_velocity,
                        b.native.angular_velocity,
                    )
                    .unwrap();
                }
                6 => {
                    let d = Domain::new(a.domain.start, a.domain.start + 0.2).unwrap();
                    a = Kernel::from_velocity_seconds(
                        a.native.motion.body,
                        d,
                        0.2,
                        a.native.motion.start,
                        a.native.linear_velocity,
                        a.native.angular_velocity,
                    )
                    .unwrap();
                    b = Kernel::from_velocity_seconds(
                        b.native.motion.body,
                        d,
                        0.2,
                        b.native.motion.start,
                        b.native.linear_velocity,
                        b.native.angular_velocity,
                    )
                    .unwrap();
                }
                7 => {
                    if is_box {
                        f.sb = rp::SharedShape::cuboid(0.3, 1., 1.);
                    } else {
                        f.sb = rp::SharedShape::capsule_y(0.25, 0.3);
                    }
                }
                _ => unreachable!(),
            }
            f.a.curve = Curve::Integrated(a);
            f.b.curve = Curve::Integrated(b);
            let before = f.bytes();
            assert!(
                !separated(f.context(), rp::Vector::X, &mut work()).unwrap(),
                "box={is_box}, change={change}"
            );
            assert_eq!(f.bytes(), before);
            if change == 5 {
                let ctx = f.context();
                assert!(cast_full_shapes_policy(
                    f.a,
                    f.sa.as_ref(),
                    f.b,
                    f.sb.as_ref(),
                    ctx.start,
                    ctx.end,
                    f.selected,
                    1e-8,
                    &mut work(),
                    false
                )
                .unwrap()
                .is_some());
            }
        }
        let f = recorded(is_box);
        // The original nonzero normal tangents are bounded, never snapped.
        assert!(!separated(f.context(), rp::Vector::new(1., 0., 0.01), &mut work()).unwrap());
        let mut strict = f.context();
        strict.clearance = 0.01;
        assert!(!separated(strict, rp::Vector::X, &mut work()).unwrap());
        // Identical clocks need not use h==logical duration. Both original
        // branch laws remain intact under the same explicit physical h.
        let mut shifted = f;
        for motion in [&mut shifted.a, &mut shifted.b] {
            let Curve::Integrated(mut k) = motion.curve else {
                unreachable!()
            };
            k.domain.end = k.domain.start + 2. * k.domain.duration();
            motion.curve = Curve::Integrated(k);
        }
        assert!(separated(shifted.context(), rp::Vector::X, &mut work()).unwrap());
    }
}

#[test]
fn staggered_native_box_clock_proves_only_a_complete_clear_prefix() {
    let start = 0.05000001266598719;
    let end = 0.07500000111758709;
    let a_domain = Domain::new(start, end).unwrap();
    let b_domain = Domain::new(0.05000000074505806, end).unwrap();
    let motion = |k| ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let a = motion(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(1, 0),
            a_domain,
            0.02499999,
            rp::Pose::from_translation(rp::Vector::new(0.66, 6.4476176e-9, 8.5968255e-9)),
            rp::Vector::new(3., 1.2895232e-7, 1.7193648e-7),
            rp::Vector::ZERO,
        )
        .unwrap(),
    );
    let mut box_kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(2, 0),
        b_domain,
        0.025,
        rp::Pose::from_parts(
            rp::Vector::new(1.1700001, -6.447617e-9, -8.596823e-9),
            rp::Rotation::from_xyzw(-2.6645354e-16, -3.0341725e-9, 3.8662473e-9, 1.),
        ),
        rp::Vector::new(2.9999998, -1.2895234e-7, -1.7193645e-7),
        rp::Vector::new(-1.0658141e-14, -1.213669e-7, 1.5464988e-7),
    )
    .unwrap();
    box_kernel.native.motion.start_time = 0.05;
    box_kernel.native.motion.end_time = 0.075;
    let b = motion(box_kernel);
    let sa = rp::SharedShape::capsule_y(0.25, 0.25);
    let sb = rp::SharedShape::cuboid(0.25, 1., 1.);
    let complete = Context {
        a,
        sa: sa.as_ref(),
        b,
        sb: sb.as_ref(),
        start,
        end,
        clearance: 0.01,
    };
    let prefix = Context {
        end: 0.056,
        ..complete
    };
    let mut measured = work();
    assert!(early_applicable(prefix));
    assert!(separated(prefix, rp::Vector::X, &mut measured).unwrap());
    assert!(measured.used < 100_000);
    let mut below = Work {
        limit: measured.used - 1,
        ..work()
    };
    assert_eq!(
        separated(prefix, rp::Vector::X, &mut below),
        Err(TrajectoryError::WorkLimit)
    );
    let flipped = Context {
        a: b,
        sa: sb.as_ref(),
        b: a,
        sb: sa.as_ref(),
        ..prefix
    };
    assert!(separated(flipped, -rp::Vector::X, &mut work()).unwrap());
    assert!(!separated(complete, rp::Vector::X, &mut work()).unwrap());
    let frontier = staggered_prefix(complete, rp::Vector::X, 2.5e-8, &mut work())
        .unwrap()
        .unwrap();
    assert!(frontier > prefix.end && frontier < 0.057812680536876104);
    assert!(separated(
        Context {
            end: frontier,
            ..complete
        },
        rp::Vector::X,
        &mut work()
    )
    .unwrap());

    // After the actual response, only the capsule's clock starts
    // again. Bind the two represented coordinates at its new start;
    // the Box's original stored start remains older.
    let rebase = 0.0578126805368761;
    let rebased = motion(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(1, 0),
            Domain::new(rebase, end).unwrap(),
            0.01718732,
            rp::Pose::from_translation(rp::Vector::new(0.683438, 7.455079e-9, 9.940108e-9)),
            rp::Vector::new(3., 1.2895232e-7, 1.7193648e-7),
            rp::Vector::ZERO,
        )
        .unwrap(),
    );
    assert!(separated(
        Context {
            a: rebased,
            start: rebase,
            ..complete
        },
        rp::Vector::X,
        &mut work()
    )
    .unwrap());
}

#[test]
fn same_physical_clock_and_different_labels_cover_the_capsule_pole_binade_change() {
    let start = 0.07500000111758709;
    let end = 0.10000000149011612;
    let d = Domain::new(start, end).unwrap();
    let a = kernel(
        1,
        d,
        0.025,
        0.73499995,
        rp::Vector::X * 3.,
        rp::Vector::ZERO,
    );
    let mut box_kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(2, 0),
        d,
        0.025,
        rp::Pose::from_parts(
            rp::Vector::new(1.2450001, 0., 0.),
            rp::Rotation::from_xyzw(-3.996803e-16, -4.551259e-9, 5.7993708e-9, 1.),
        ),
        rp::Vector::X * 2.9999998,
        rp::Vector::new(-1.0658141e-14, -1.213669e-7, 1.5464988e-7),
    )
    .unwrap();
    box_kernel.native.motion.start_time = 0.075;
    box_kernel.native.motion.end_time = 0.1;
    let motion = |k| ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let sa = rp::SharedShape::capsule_y(0.25, 0.25);
    let sb = rp::SharedShape::cuboid(0.25, 1., 1.);
    let context = Context {
        a: motion(a),
        sa: sa.as_ref(),
        b: motion(box_kernel),
        sb: sb.as_ref(),
        start,
        end,
        clearance: 0.01,
    };
    assert!(a.position_at_time(start).translation.x + 0.25 < 1.);
    assert!(a.position_at_time(end).translation.x + 0.25 >= 1.);
    let mut measured = work();
    assert!(early_applicable(context));
    assert!(separated(context, rp::Vector::X, &mut measured).unwrap());
    assert!(measured.used < 100_000);
    assert!(!separated(
        Context {
            clearance: 0.0100002,
            ..context
        },
        rp::Vector::X,
        &mut work(),
    )
    .unwrap());
}
