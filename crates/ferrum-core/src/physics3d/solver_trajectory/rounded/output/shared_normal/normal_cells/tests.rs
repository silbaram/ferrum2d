use super::*;
use crate::physics3d::solver_trajectory::Domain;

#[test]
fn shared_rounding_cells_clear_the_recorded_second_tick_prefix() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.022905365, 0., 0.9997377),
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
    let box_motion = motion(Curve::Integrated(carrier));
    let capsule_motion = motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.9994222, 1.0100002, -0.019624656),
        offset: rp::Vector::new(0.0010911226, -1.7881393e-7, 0.019596659),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    });
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a: box_motion,
        sa: cuboid.as_ref(),
        b: capsule_motion,
        sb: capsule.as_ref(),
        start: 0.012506680346132004,
        end: domain.end,
        clearance: 0.01,
    };
    let mut measured = Work {
        used: 0,
        limit: 2_000_000,
    };
    let clear = prefix(context, rp::Vector::Y, &mut measured)
        .unwrap()
        .unwrap();
    assert_eq!(clear.to_bits(), 0.012825842262827791_f64.to_bits());
    assert_eq!(
        clear.next_up().to_bits(),
        0.012825842262827793_f64.to_bits()
    );
    let pair = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        context.sa,
        context.sb,
        &mut Work {
            used: 0,
            limit: 20_000,
        },
    )
    .unwrap()
    .unwrap();
    assert!(pair
        .native_strict_at(
            context.a,
            context.b,
            clear.next_up(),
            context.clearance,
            &mut Work {
                used: 0,
                limit: 20_000
            },
        )
        .unwrap());
    assert!(measured.used < 1_500_000);
    let reversed = Context {
        a: context.b,
        sa: context.sb,
        b: context.a,
        sb: context.sa,
        ..context
    };
    assert_eq!(
        prefix(
            reversed,
            -rp::Vector::Y,
            &mut Work {
                used: 0,
                limit: measured.used
            }
        ),
        Ok(Some(clear))
    );
    assert_eq!(
        prefix(
            context,
            rp::Vector::Y,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(
        prefix(
            Context {
                clearance: 0.010001,
                ..context
            },
            rp::Vector::Y,
            &mut measured
        ),
        Ok(None)
    );
}

#[test]
fn shared_rounding_cells_keep_the_independent_logical_normal_displacement() {
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.03271897, 0., 0.9994646),
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
    let a = motion(Curve::Integrated(carrier));
    let b = |velocity| {
        motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.99935776, 1.0100003, -0.0130800195),
            offset: rp::Vector::new(0.00094103813, 1.1920929e-7, 0.013048656),
            linear_velocity: rp::Vector::new(0., velocity, 0.),
            rotation: rp::Rotation::IDENTITY,
        })
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a,
        sa: cuboid.as_ref(),
        b: b(-0.022307051),
        sb: capsule.as_ref(),
        start: domain.start,
        end: domain.end,
        clearance: 0.01,
    };
    let mut paid = Work {
        used: 0,
        limit: 2_000_000,
    };
    let clear = prefix(context, rp::Vector::Y, &mut paid).unwrap().unwrap();
    assert_eq!(clear.to_bits(), 0.008349538055881565_f64.to_bits());
    assert!(paid.used < 350_000);

    // Removing the original downward product would incorrectly certify the
    // next time value as clear. Preserve the original query in the witness.
    let at = clear.next_up();
    let pair = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        context.sa, context.sb, &mut paid,
    )
    .unwrap()
    .unwrap();
    assert!(pair
        .native_strict_at(context.a, context.b, at, context.clearance, &mut paid,)
        .unwrap());
    assert_eq!(
        prefix(
            Context {
                b: b(0.),
                end: at,
                ..context
            },
            rp::Vector::Y,
            &mut paid,
        ),
        Ok(Some(at)),
    );
}

#[test]
fn shared_rotation_range_clears_the_recorded_whole_fourth_tick_substep() {
    let domain = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.042529423, 0., 0.9990952),
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
    let a = motion(Curve::Integrated(carrier));
    let b = motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.999208, 1.0100002, -0.006536506),
        offset: rp::Vector::new(0.00057709217, 0., 0.0065144002),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    });
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a,
        sa: cuboid.as_ref(),
        b,
        sb: capsule.as_ref(),
        start: domain.start,
        end: domain.end,
        clearance: 0.01,
    };
    let mut paid = Work {
        used: 0,
        limit: 14_000_000,
    };
    assert_eq!(
        prefix(context, rp::Vector::Y, &mut paid),
        Ok(Some(domain.end))
    );
    assert!(paid.used < 7_000_000, "work={}", paid.used);
}

#[test]
fn scalar_range_endpoints_match_the_original_pure_axis_rotation_graph() {
    let domain = Domain::new(0., f64::from(0.004166667_f32)).unwrap();
    for axis in 0..3 {
        for direction in [-1., 1.] {
            let mut initial = [0., 0., 0., 0.9987955];
            initial[axis] = direction * 0.04906751;
            let mut angular = rp::Vector::ZERO;
            angular[axis] = direction * 1.5707964;
            let kernel = Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::from_raw_parts(0, 0),
                domain,
                0.004166667,
                rp::Pose::from_parts(rp::Vector::ZERO, rp::Rotation::from_array(initial)),
                rp::Vector::ZERO,
                angular,
            )
            .unwrap();
            let proof = NormalProjection {
                kernel,
                axis,
                half: 0.1,
                anchor: 1.01,
                offset: 0.,
                velocity: 0.,
                core: -0.5,
                pole: -0.9,
                radius: 0.4,
                clearance: 0.01,
                translation: Float::exact(-0.1),
                reference_height: None,
            };
            for dt in [f32::from_bits(1), 1e-7, 0.001, 0.004166667_f32.next_down()] {
                let endpoint = proof.raw_endpoint(dt.to_bits());
                let original = proof.raw(Clock::Physical, u64::from(dt.to_bits()));
                assert_eq!(
                    endpoint.axial.to_bits(),
                    original.to_array()[axis].to_bits()
                );
                assert_eq!(endpoint.scalar.to_bits(), original.w.to_bits());
            }
        }
    }
}

#[test]
fn fixed_raw_scalar_cells_prove_the_recorded_fifth_tick_response_suffix() {
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.058870602, 0., 0.9982656),
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
    let a = motion(Curve::Integrated(carrier));
    let b = motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.9988444, 1.0100003, -0.013071068),
        offset: rp::Vector::new(0.0016217232, -1.7881393e-7, 0.012974873),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    });
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a,
        sa: cuboid.as_ref(),
        b,
        sb: capsule.as_ref(),
        start: 0.008335849648915426,
        end: domain.end,
        clearance: 0.01,
    };
    let mut paid = Work {
        used: 0,
        limit: 12_000_000,
    };
    assert_eq!(
        prefix(context, rp::Vector::Y, &mut paid),
        Ok(Some(domain.end))
    );
    assert!(paid.used < 10_000_000, "work={}", paid.used);

    // This stronger gap cannot reuse the verified cell partition as a clear
    // result. The published prefix must stop before the end.
    let tighter = prefix(
        Context {
            clearance: 0.01000005,
            ..context
        },
        rp::Vector::Y,
        &mut Work {
            used: 0,
            limit: 12_000_000,
        },
    )
    .unwrap();
    assert!(tighter.is_none_or(|time| time < domain.end));
}

#[test]
fn whole_normal_action_clears_the_recorded_last_response_before_time_subdivision() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.062137086, 0., 0.9980676),
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
    let a = motion(Curve::Integrated(carrier));
    let b = motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.998652, 0.099999994, -0.019606166),
        offset: rp::Vector::new(0.0026232004, 0.9100002, 0.019435644),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    });
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let context = Context {
        a,
        sa: cuboid.as_ref(),
        b,
        sb: capsule.as_ref(),
        start: 0.012502065556759588,
        end: domain.end,
        clearance: 0.01,
    };
    let budget = || Work {
        used: 0,
        limit: 180_000,
    };
    let mut work = budget();
    let result = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        a,
        context.sa,
        b,
        context.sb,
        context.start,
        context.end,
        context.clearance,
        4.166666567329003e-9,
        &mut work,
        true,
    )
    .unwrap();
    assert!(result.hit.is_none() && result.strictly_clear_start);
    assert!(work.used < 150_000, "work={}", work.used);
    let hint = rp::Vector::Y * 1.000000238418579;
    assert!(complete_separation(context, hint, &mut budget()).unwrap());
    assert!(!complete_separation(
        Context {
            clearance: 0.010001,
            ..context
        },
        hint,
        &mut budget(),
    )
    .unwrap());
    assert!(!complete_separation(context, rp::Vector::X + hint, &mut budget()).unwrap());
}

#[test]
fn separate_action_bounds_clear_the_recorded_twenty_fourth_tick() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.3059021, 0., 0.95206296),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    carrier.native.motion.start_time = 0.012500001;
    carrier.native.motion.end_time = 0.016666668;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.30901605, 0., 0.9510568]
    );
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let anchored = |y| {
        motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.99438405, 1.0100005, -0.019496888),
            offset: rp::Vector::new(0.011529386, y, 0.015761435),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        })
    };
    let context = Context {
        a: motion(Curve::Integrated(carrier)),
        sa: cuboid.as_ref(),
        b: anchored(-1.1920929e-7),
        sb: capsule.as_ref(),
        start: domain.start,
        end: domain.end,
        clearance: 0.01,
    };
    assert!(binade(Float::span(0.1, 1.0100005)).is_none());
    let budget = || Work {
        used: 0,
        limit: 150_000,
    };
    let mut proof = budget();
    assert!(complete_separation(context, rp::Vector::Y, &mut proof).unwrap());
    assert!(proof.used < 100_000, "work={}", proof.used);

    let mut cast_work = budget();
    let cast = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        context.a,
        context.sa,
        context.b,
        context.sb,
        context.start,
        context.end,
        context.clearance,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut cast_work,
        true,
    )
    .unwrap();
    assert!(cast.hit.is_none() && cast.strictly_clear_start);

    // One changed offset preserves a real end contact in the world-radius
    // graph even though the normal local-radius projection remains clear.
    let b = anchored(-3.5762787e-7);
    assert!(!complete_separation(Context { b, ..context }, rp::Vector::Y, &mut budget()).unwrap());
    let pair = crate::physics3d::solver_trajectory::world_contact::Pair::new(
        context.sa,
        context.sb,
        &mut budget(),
    )
    .unwrap()
    .unwrap();
    assert!(pair
        .native_strict_at(context.a, b, context.end, context.clearance, &mut budget())
        .unwrap());
}

#[test]
fn moving_normal_prefix_skips_clear_rotation_and_preserves_the_first_contact() {
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.47427884, 0., 0.8803747),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.4771573, 0., 0.878818]
    );
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let anchored = |velocity| {
        motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.99081314, 1.0104632, -0.019411445),
            offset: rp::Vector::new(0.016352832, -1.1920929e-7, 0.010545135),
            linear_velocity: rp::Vector::new(0., velocity, 0.),
            rotation: rp::Rotation::IDENTITY,
        })
    };
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let c = Context {
        a: motion(Curve::Integrated(carrier)),
        sa: cuboid.as_ref(),
        b: anchored(-0.11118736),
        sb: capsule.as_ref(),
        start: domain.start,
        end: domain.end,
        clearance: 0.01,
    };
    let budget = || Work {
        used: 0,
        limit: 300_000,
    };
    let safe = 0.016665026778355237_f64;
    let hit = safe.next_up();
    let mut proof = budget();
    assert_eq!(prefix(c, rp::Vector::Y, &mut proof), Ok(Some(safe)));
    let mut measured = budget();
    let cast = crate::physics3d::solver_trajectory::cast_full_shapes_policy_coverage(
        c.a,
        c.sa,
        c.b,
        c.sb,
        c.start,
        c.end,
        c.clearance,
        f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
        &mut measured,
        true,
    )
    .unwrap()
    .hit
    .expect("actual first contact after the certified prefix");
    assert_eq!(cast.safe_time.to_bits(), safe.to_bits());
    assert_eq!(cast.hit_time.to_bits(), hit.to_bits());

    let pair =
        crate::physics3d::solver_trajectory::world_contact::Pair::new(c.sa, c.sb, &mut budget())
            .unwrap()
            .unwrap();
    assert!(pair
        .native_strict_at(c.a, c.b, hit, c.clearance, &mut budget())
        .unwrap());
    let away = Context {
        b: anchored(0.11118736),
        ..c
    };
    assert_eq!(prefix(away, rp::Vector::Y, &mut budget()), Ok(Some(c.end)));
    let reversed = Context {
        a: c.b,
        sa: c.sb,
        b: c.a,
        sb: c.sa,
        ..c
    };
    assert_eq!(
        prefix(reversed, -rp::Vector::Y, &mut budget()),
        Ok(Some(safe))
    );
}
