use super::*;
use crate::physics3d::solver_trajectory::{self, ShapeMotion};
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}

#[test]
fn stationary_face_clears_the_recorded_forty_ninth_tick_response() {
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let safe = 0.008353740299753552_f64;
    let hit = safe.next_up();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.593066, 0., 0.8051539),
        ),
        rp::Vector::ZERO,
        rp::Vector::Y * 1.5707964,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    assert_eq!(
        carrier.native.motion.end.rotation.to_array(),
        [0., 0.59569764, 0., 0.8032088]
    );
    let own = Kernel::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(safe, domain.end).unwrap(),
        rp::Pose::from_translation(rp::Vector::new(0.29319093, 0.91, -0.9441314)),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let driver = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let old = ShapeMotion {
        curve: Curve::Integrated(own),
        ..driver
    };
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let cast = |curve, work: &mut Work| {
        solver_trajectory::cast_full_shapes_policy_coverage(
            driver,
            box_shape.as_ref(),
            ShapeMotion { curve, ..old },
            capsule.as_ref(),
            safe,
            domain.end,
            0.01,
            f64::from((carrier.native.motion.end_time - carrier.native.motion.start_time) * 1e-6),
            work,
            false,
        )
    };
    let original = cast(old.curve, &mut work()).unwrap().hit.unwrap();
    assert_eq!(original.safe_time, safe);
    assert_eq!(original.hit_time, hit);
    let mut measured = work();
    let proposal = stationary_face_phase(
        own,
        carrier,
        rp::Vector::Y,
        0.1,
        safe,
        hit,
        domain.end,
        0.01,
        &mut measured,
        |curve, work| {
            cast(curve, work)
                .map(|coverage| coverage.strictly_clear_start && coverage.hit.is_none())
        },
    )
    .unwrap()
    .expect("a strict whole-future phase");
    assert_eq!(proposal.rate, rp::Vector::ZERO);
    assert!(same_pose(
        proposal.curve.com_pose(safe),
        old.curve.com_pose(safe)
    ));
    assert_eq!(
        proposal.curve.com_pose(hit).translation.y.to_bits(),
        0.91_f32.next_up().to_bits()
    );
    assert!(measured.used < 8_000_000, "work={}", measured.used);
    for time in [safe, hit, domain.end] {
        let tangent_bits = |curve: Curve| {
            let position = curve.com_pose(time).translation;
            [position.x.to_bits(), position.z.to_bits()]
        };
        assert_eq!(tangent_bits(proposal.curve), tangent_bits(old.curve));
        assert_eq!(
            curve_velocity(proposal.curve, time).unwrap(),
            (rp::Vector::ZERO, rp::Vector::ZERO)
        );
    }
    assert!(stationary_face_phase(
        own,
        carrier,
        rp::Vector::Y,
        0.1,
        safe,
        hit,
        domain.end,
        1e-8,
        &mut work(),
        |_, _| panic!("a correction larger than the skin must not reach the pair query"),
    )
    .unwrap()
    .is_none());
}

fn carrier(position: rp::Vector, velocity: rp::Vector) -> Kernel {
    Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., 0.025).unwrap(),
        0.025,
        rp::Pose::from_translation(position),
        velocity,
        rp::Vector::ZERO,
    )
    .unwrap()
}
#[test]
fn identity_witness_is_only_a_safe_phase_hint_and_requires_the_callback_approval() {
    let k = carrier(rp::Vector::new(0., -0.1, 0.), rp::Vector::new(3., 2., 4.));
    let safe = 0.001;
    let probe = 0.002;
    let anchor = rp::Vector::new(0.9, 1.01, 0.6);
    let desired = Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::new(anchor.x, 0.1, anchor.z),
        offset: rp::Vector::new(0.03, 0.91, 0.05),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    // Generate a genuine inverse producer rather than assuming every arbitrary
    // sum has an inverse. The old curve owns this same represented safe pose.
    let target = desired.com_pose(safe);
    let base = k.position_at_time(safe).translation + rp::Rotation::IDENTITY * anchor;
    let mut offset = rp::Vector::new(0.03, 0., 0.05);
    offset.y = offset_cells(base.y, 0., target.translation.y)
        .into_iter()
        .flatten()
        .next()
        .expect("old actual safe inverse");
    let old = Curve::Anchored {
        carrier: k,
        anchor,
        offset,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let witness = k.position_at_time(probe).translation + rp::Vector::Y * 0.1;
    let before = crate::checkpoint_codec::encode(&(k, old)).unwrap();
    let mut callbacks = 0;
    let chosen = propose(
        k,
        anchor,
        offset,
        rp::Vector::ZERO,
        rp::Rotation::IDENTITY,
        1,
        witness,
        probe,
        safe,
        probe,
        k.domain.end,
        0.01,
        &mut work(),
        &mut |c, _| {
            callbacks += 1;
            assert!(same_pose(c.com_pose(safe), old.com_pose(safe)));
            assert_eq!(
                curve_velocity(c, probe).unwrap(),
                curve_velocity(old, probe).unwrap()
            );
            Ok(true)
        },
    )
    .unwrap()
    .expect("valid safe identity phase");
    assert!(callbacks > 0);
    for t in [safe, probe, k.domain.end] {
        for axis in [0, 2] {
            assert_eq!(
                chosen.curve.com_pose(t).translation[axis].to_bits(),
                old.com_pose(t).translation[axis].to_bits()
            );
        }
    }
    assert!(propose(
        k,
        anchor,
        offset,
        rp::Vector::ZERO,
        rp::Rotation::IDENTITY,
        1,
        witness,
        probe,
        safe,
        probe,
        k.domain.end,
        0.01,
        &mut work(),
        &mut |_, _| Ok(false)
    )
    .unwrap()
    .is_none());
    assert!(matches!(
        propose(
            k,
            anchor,
            offset,
            rp::Vector::ZERO,
            rp::Rotation::IDENTITY,
            1,
            witness,
            probe,
            safe,
            probe,
            k.domain.end,
            0.01,
            &mut work(),
            &mut |_, _| Err(TrajectoryError::WorkLimit)
        ),
        Err(TrajectoryError::WorkLimit)
    ));
    let run = |w: &mut Work| {
        propose(
            k,
            anchor,
            offset,
            rp::Vector::ZERO,
            rp::Rotation::IDENTITY,
            1,
            witness,
            probe,
            safe,
            probe,
            k.domain.end,
            0.01,
            w,
            &mut |_, _| Ok(true),
        )
    };
    let mut measured = work();
    assert!(run(&mut measured).unwrap().is_some());
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(run(&mut exact).unwrap().is_some());
    assert_eq!(exact.used, measured.used);
    assert!(matches!(
        run(&mut Work {
            used: 0,
            limit: measured.used - 1
        }),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(crate::checkpoint_codec::encode(&(k, old)).unwrap(), before);
}
#[test]
fn nonidentity_or_rotating_source_never_supplies_a_surface_witness_phase() {
    let base = carrier(rp::Vector::ZERO, rp::Vector::Y);
    let mut rotating = base;
    rotating.native.angular_velocity = rp::Vector::Y;
    let mut stored = base;
    stored.native.motion.end.rotation = rp::Rotation::from_rotation_y(0.1);
    for k in [rotating, stored] {
        let mut called = false;
        let mut admission = work();
        assert!(propose(
            k,
            rp::Vector::Y,
            rp::Vector::ZERO,
            rp::Vector::ZERO,
            rp::Rotation::IDENTITY,
            1,
            rp::Vector::Y * 0.1,
            0.002,
            0.001,
            0.002,
            k.domain.end,
            0.01,
            &mut admission,
            &mut |_, _| {
                called = true;
                Ok(true)
            }
        )
        .unwrap()
        .is_none());
        assert!(!called);
        assert_eq!(
            admission.used, 512,
            "no unvisited candidate/row reservation"
        );
    }
}
#[test]
fn split_guard_counts_coarse_post_add_jumps_but_cancels_common_elevator_motion() {
    let cases = [
        (
            carrier(rp::Vector::ZERO, rp::Vector::Y * 8.),
            0.5,
            0.5,
            0.25,
            0.75,
        ),
        (
            carrier(rp::Vector::Y * 524288., rp::Vector::ZERO),
            0.03125,
            0.,
            0.03125_f32.next_up(),
            0.,
        ),
    ];
    for (k, a, o, b, p) in cases {
        let correction = ground_rate::CorrectionRange::from_curve(
            k,
            rp::Vector::ZERO,
            rp::Rotation::IDENTITY,
            0.,
            k.domain.end,
            1,
            &mut work(),
        )
        .unwrap();
        let bound = correction.difference_split(a, o, b, p, 0., 0.).unwrap();
        let eval = |anchor, offset, t| (k.position_at_time(t).translation.y + anchor) + offset;
        let mut actual = 0_f64;
        for t in [0., k.domain.end * 0.5, k.domain.end] {
            let delta = (f64::from(eval(a, o, t)) - f64::from(eval(b, p, t))).abs();
            actual = actual.max(delta);
            assert!(delta <= bound);
        }
        if k.native.motion.start.translation.y == 0. {
            assert!(bound <= f64::from(0.01_f32));
        } else {
            assert!(actual > f64::from(0.01_f32) && bound >= actual);
        }
    }
}

#[test]
fn recorded_down_reversal_requires_the_complete_original_pair_future() {
    // C55 reproduced the original whole-Engine reversal: local hit-improving
    // witnesses recontact at a later RN cell. This is its original h/clock,
    // rather than the earlier ascending or .025-second helper fixture.
    let h = 0.004166667_f32;
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., f64::from(h)).unwrap(),
        h,
        rp::Pose::from_translation(rp::Vector::Y * 0.36666667),
        -rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let anchor = rp::Vector::Y * 1.01;
    let old = Curve::Anchored {
        carrier: k,
        anchor,
        offset: rp::Vector::ZERO,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let platform = motion(Curve::Integrated(k));
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let safe: Time = 2.235174090259306e-8;
    let hit = safe.next_up();
    let skin = 0.01;
    let witness = rp::Vector::Y * 0.4666666;
    let before = crate::checkpoint_codec::encode(&(k, old, witness)).unwrap();
    let known = solver_trajectory::leaf_contact(
        &platform.pose(hit),
        box_shape.as_ref(),
        &motion(old).pose(hit),
        capsule.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(known.dist > 0. && known.dist < skin);
    let mut admission = work();
    let chosen = propose(
        k,
        anchor,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Rotation::IDENTITY,
        1,
        witness,
        hit,
        safe,
        hit,
        k.domain.end,
        skin,
        &mut admission,
        &mut |candidate, budget| {
            assert!(same_pose(candidate.com_pose(safe), old.com_pose(safe)));
            assert_eq!(
                curve_velocity(candidate, hit).unwrap(),
                curve_velocity(old, hit).unwrap()
            );
            let next = solver_trajectory::leaf_contact(
                &platform.pose(hit),
                box_shape.as_ref(),
                &motion(candidate).pose(hit),
                capsule.as_ref(),
                budget,
            )?;
            if next.dist < skin || next.dist <= known.dist {
                return Ok(false);
            }
            // Preserve the actual encountered platform-first order and
            // allow-existing policy; a better first point is insufficient.
            Ok(solver_trajectory::cast_full_shapes_policy(
                platform,
                box_shape.as_ref(),
                motion(candidate),
                capsule.as_ref(),
                safe,
                k.domain.end,
                skin,
                f64::from(h * 1e-6),
                budget,
                true,
            )?
            .is_none())
        },
    )
    .unwrap()
    .expect("the recorded reversal has a same-clock, full-future-safe normal phase");
    let Curve::Anchored { carrier, .. } = chosen.curve else {
        unreachable!()
    };
    assert!(same_kernel(carrier, k));
    assert_eq!(carrier.native.integration_seconds.to_bits(), h.to_bits());
    assert!(same_pose(chosen.curve.com_pose(safe), old.com_pose(safe)));
    assert_eq!(chosen.rate, -rp::Vector::Y * 2.);
    for i in 0..=16 {
        let time = safe + (k.domain.end - safe) * f64::from(i) / 16.;
        let previous = old.com_pose(time);
        let next = chosen.curve.com_pose(time);
        assert!((next.translation - previous.translation).length() <= skin);
        assert_eq!(
            next.translation.x.to_bits(),
            previous.translation.x.to_bits()
        );
        assert_eq!(
            next.translation.z.to_bits(),
            previous.translation.z.to_bits()
        );
        assert_eq!(
            next.rotation.to_array().map(f32::to_bits),
            previous.rotation.to_array().map(f32::to_bits)
        );
    }
    assert_eq!(
        crate::checkpoint_codec::encode(&(k, old, witness)).unwrap(),
        before
    );
}

#[test]
fn complete_anchor_preimage_keeps_original_bits_zero_signs_overflow_and_exact_work() {
    let forward = |t: rp::Vector, a: rp::Vector, o: rp::Vector, p: rp::Vector| {
        ((t + rp::Rotation::IDENTITY * a) + o) + p
    };
    let translation = rp::Vector::Y * f32::from_bits(0x3dbbbbbd);
    let old = rp::Vector::Y * f32::from_bits(0xbd3bbbbb);
    let offset = rp::Vector::Y * f32::from_bits(0x3f87258d);
    let target = f32::from_bits(0x3f8d036a);
    for sign in [-1., 1.] {
        let t = translation * sign;
        let a = old * sign;
        let o = offset * sign;
        let target = target * sign;
        let mut budget = work();
        let bounds = anchor_preimage(t, a, o, rp::Vector::ZERO, target, 1, &mut budget)
            .unwrap()
            .unwrap();
        let first = ordered(bounds[0]);
        let last = ordered(bounds[1]);
        assert!(first <= last && last - first < 1024);
        for key in first..=last {
            let mut actual = a;
            actual.y = from_ordered(key);
            assert_eq!(
                forward(t, actual, o, rp::Vector::ZERO).y.to_bits(),
                target.to_bits()
            );
        }
        for key in [first - 1, last + 1] {
            let mut actual = a;
            actual.y = from_ordered(key);
            assert_ne!(
                forward(t, actual, o, rp::Vector::ZERO).y.to_bits(),
                target.to_bits()
            );
        }
        assert!(budget.used <= 64 + 66 * 128);
        let mut exact = Work {
            used: 0,
            limit: budget.used,
        };
        assert_eq!(
            anchor_preimage(t, a, o, rp::Vector::ZERO, target, 1, &mut exact)
                .unwrap()
                .unwrap()
                .map(f32::to_bits),
            bounds.map(f32::to_bits)
        );
        assert_eq!(exact.used, exact.limit);
        assert_eq!(
            anchor_preimage(
                t,
                a,
                o,
                rp::Vector::ZERO,
                target,
                1,
                &mut Work {
                    used: 0,
                    limit: budget.used - 1
                }
            )
            .unwrap_err(),
            TrajectoryError::WorkLimit
        );
    }
    let zeros = anchor_preimage(
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        0.,
        1,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(ordered(zeros[0]) <= ordered(-0.) && ordered(zeros[1]) >= ordered(0.));
    assert!(anchor_preimage(
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        -0.,
        1,
        &mut work()
    )
    .unwrap()
    .is_none());
    let t = rp::Vector::Y * f32::MAX;
    let o = -t;
    let bounds = anchor_preimage(t, rp::Vector::ZERO, o, rp::Vector::ZERO, 0., 1, &mut work())
        .unwrap()
        .unwrap();
    for bound in bounds {
        assert!(bound.is_finite());
        assert_eq!(
            forward(t, rp::Vector::Y * bound, o, rp::Vector::ZERO)
                .y
                .to_bits(),
            0_f32.to_bits()
        );
    }
    assert!(anchor_preimage(
        t,
        rp::Vector::ZERO,
        o,
        rp::Vector::Y * f32::INFINITY,
        0.,
        1,
        &mut work()
    )
    .unwrap()
    .is_none());
    assert!(anchor_preimage(
        t,
        rp::Vector::ZERO,
        o,
        rp::Vector::ZERO,
        f32::NAN,
        1,
        &mut work()
    )
    .unwrap()
    .is_none());
}

#[test]
fn recorded_c63_cell_boundary_phase_reaches_the_original_whole_pair_future() {
    use crate::physics3d::{
        world::native_id, BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Shape, WorldConfig,
    };
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let platform_id = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [3., 0.1, 3.],
            }),
        )
        .unwrap();
    let actor_id = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.4,
            }),
        )
        .unwrap();
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let h = 0.004166667_f32;
    let mut k = Kernel::from_velocity_seconds(
        native_id(platform_id),
        domain,
        h,
        rp::Pose::from_translation(rp::Vector::Y * 0.09166666),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    k.native.motion.start_time = domain.start as f32;
    k.native.motion.end_time = domain.end as f32;
    let anchor = rp::Vector::Y * 1.0350001;
    let offset = rp::Vector::Y * -0.025000095;
    let old = Curve::Anchored {
        carrier: k,
        anchor,
        offset,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let safe = 0.012500008599212187;
    let hit = 0.0125000125728478;
    let skin = 0.01;
    let trajectory = |id, curve, role| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion: ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let actor = trajectory(actor_id, old, Role::Character(actor_id));
    let platform = trajectory(platform_id, Curve::Integrated(k), Role::Prescribed);
    let shape = world.backend.colliders[platform.collider].shape();
    let point = platform.motion.pose(hit) * (rp::Vector::Y * 0.1);
    assert_eq!(old.com_pose(safe).translation.y.to_bits(), 0x3f8d036a);
    assert_eq!(old.com_pose(hit).translation.y.to_bits(), 0x3f8d036a);
    let previous = gap(
        actor,
        old,
        platform,
        platform.motion.curve,
        &world.backend.colliders,
        hit,
        skin,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(previous.to_bits(), 0.00999999_f32.to_bits());
    let bytes = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let descriptor = crate::checkpoint_codec::encode(&(k, old)).unwrap();
    let run = |budget: &mut Work, approve: bool| {
        let future = full_future::FullFuture::new(
            actor,
            old,
            platform,
            platform.motion.curve,
            &world.backend.colliders,
            k,
            safe,
            domain.end,
            skin,
            false,
            budget,
        )?;
        propose(
            k,
            anchor,
            offset,
            rp::Vector::ZERO,
            rp::Rotation::IDENTITY,
            1,
            point,
            hit,
            safe,
            hit,
            domain.end,
            skin,
            budget,
            &mut |candidate, work| {
                assert!(same_pose(candidate.com_pose(safe), old.com_pose(safe)));
                assert_eq!(curve_velocity(candidate, hit)?, curve_velocity(old, hit)?);
                for time in [safe, hit, domain.end] {
                    for axis in [0, 2] {
                        assert_eq!(
                            candidate.com_pose(time).translation[axis].to_bits(),
                            old.com_pose(time).translation[axis].to_bits()
                        );
                    }
                }
                let next = gap(
                    actor,
                    candidate,
                    platform,
                    platform.motion.curve,
                    &world.backend.colliders,
                    hit,
                    skin,
                    work,
                )?;
                if !next.is_some_and(|value| value >= skin && value > previous) {
                    return Ok(false);
                }
                if !approve {
                    return Ok(false);
                }
                future.accepts(candidate, work)
            },
        )
    };
    let mut measured = work();
    let chosen = run(&mut measured, true)
        .unwrap()
        .expect("original C63 hit must reach a safe-fitting whole-future-approved phase");
    let Curve::Anchored {
        carrier,
        anchor: fitted,
        offset: fitted_offset,
        ..
    } = chosen.curve
    else {
        unreachable!()
    };
    assert!(same_kernel(carrier, k));
    assert_eq!(chosen.rate, rp::Vector::Y * 2.);
    assert!(
        gap(
            actor,
            chosen.curve,
            platform,
            platform.motion.curve,
            &world.backend.colliders,
            hit,
            skin,
            &mut work()
        )
        .unwrap()
        .unwrap()
            > previous
    );
    assert_eq!(
        shape.as_cuboid().unwrap().half_extents,
        rp::Vector::new(3., 0.1, 3.)
    );
    assert_ne!(
        (fitted.y.to_bits(), fitted_offset.y.to_bits()),
        (anchor.y.to_bits(), offset.y.to_bits())
    );
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    assert!(run(&mut exact, true).unwrap().is_some());
    assert_eq!(exact.used, exact.limit);
    assert!(matches!(
        run(
            &mut Work {
                used: 0,
                limit: measured.used - 1
            },
            true
        ),
        Err(TrajectoryError::WorkLimit)
    ));
    assert!(
        run(&mut work(), false).unwrap().is_none(),
        "a point improvement is never approval"
    );
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), bytes);
    assert_eq!(
        crate::checkpoint_codec::encode(&(k, old)).unwrap(),
        descriptor
    );
}

struct RotatingFixture {
    world: crate::physics3d::PhysicsWorld3d,
    carrier: Kernel,
    old: Curve,
    actor: ColliderTrajectory,
    platform: ColliderTrajectory,
    safe: Time,
    hit: Time,
    witness: rp::Vector,
}
fn recorded_c81_rotation() -> RotatingFixture {
    use crate::physics3d::{
        world::native_id, BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Shape, WorldConfig,
    };
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let platform_id = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [3., 0.1, 3.],
            }),
        )
        .unwrap();
    let actor_id = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.4,
            }),
        )
        .unwrap();
    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let carrier = Kernel::from_velocity_seconds(
        native_id(platform_id),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
        rp::Vector::ZERO,
        rp::Vector::new(0., std::f32::consts::FRAC_PI_2, 0.),
    )
    .unwrap();
    let old = Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(1., 1.01, 0.),
        offset: rp::Vector::new(0., f32::from_bits(0x33800000), 0.),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let trajectory = |id, curve, role| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion: ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let actor = trajectory(actor_id, old, Role::Character(actor_id));
    let platform = trajectory(platform_id, Curve::Integrated(carrier), Role::Prescribed);
    RotatingFixture {
        world,
        carrier,
        old,
        actor,
        platform,
        safe: 0.0005384070973377674,
        hit: 0.0005384070973377675,
        witness: rp::Vector::new(0.99999946, -7.450581e-9, -0.0008457276),
    }
}

#[test]
fn recorded_c81_rotation_cell_phase_preserves_tangents_and_requires_whole_future() {
    let f = recorded_c81_rotation();
    let Curve::Anchored {
        anchor,
        offset,
        linear_velocity,
        rotation,
        ..
    } = f.old
    else {
        unreachable!()
    };
    assert_eq!(f.carrier.local_delta(f.safe).to_bits(), 0x3a0d23e3);
    assert_eq!(f.carrier.local_delta(f.hit).to_bits(), 0x3a0d23e4);
    let previous = gap(
        f.actor,
        f.old,
        f.platform,
        f.platform.motion.curve,
        &f.world.backend.colliders,
        f.hit,
        0.01,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(previous < 0.01);
    let before = crate::checkpoint_codec::encode(&(f.carrier, f.old)).unwrap();
    let world_before = f.world.capture_snapshot().unwrap();
    let run = |budget: &mut Work, approve: bool| {
        let future = full_future::FullFuture::new(
            f.actor,
            f.old,
            f.platform,
            f.platform.motion.curve,
            &f.world.backend.colliders,
            f.carrier,
            f.safe,
            f.carrier.domain.end,
            0.01,
            false,
            budget,
        )?;
        propose_rotating(
            f.carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
            1,
            f.witness,
            f.hit,
            f.safe,
            f.hit,
            f.carrier.domain.end,
            0.01,
            budget,
            &mut |candidate, work| {
                assert!(same_pose(
                    candidate.com_pose(f.safe),
                    f.old.com_pose(f.safe)
                ));
                assert_eq!(
                    curve_velocity(candidate, f.hit)?,
                    curve_velocity(f.old, f.hit)?
                );
                // Pose/rate comparisons exercise original stored and normalized
                // branches; only the subsequent real full cast approves NoHit.
                for time in [0., f.safe, f.hit, f.carrier.domain.end]
                    .into_iter()
                    .chain((1..32).map(|i| f.carrier.domain.end * f64::from(i) / 32.))
                {
                    for axis in [0, 2] {
                        assert_eq!(
                            candidate.com_pose(time).translation[axis].to_bits(),
                            f.old.com_pose(time).translation[axis].to_bits()
                        );
                        assert_eq!(
                            curve_velocity(candidate, time)?.0[axis].to_bits(),
                            curve_velocity(f.old, time)?.0[axis].to_bits()
                        );
                    }
                }
                let next = gap(
                    f.actor,
                    candidate,
                    f.platform,
                    f.platform.motion.curve,
                    &f.world.backend.colliders,
                    f.hit,
                    0.01,
                    work,
                )?;
                if !next.is_some_and(|g| g >= 0.01 && g > previous) || !approve {
                    return Ok(false);
                }
                future.accepts(candidate, work)
            },
        )
    };
    let mut charged = work();
    let chosen = run(&mut charged, true)
        .unwrap()
        .expect("rotating safe inverse must pass the original whole pair future");
    let Curve::Anchored {
        carrier,
        anchor: next_anchor,
        offset: next_offset,
        ..
    } = chosen.curve
    else {
        unreachable!()
    };
    assert!(same_kernel(carrier, f.carrier));
    assert_eq!(next_anchor.x.to_bits(), anchor.x.to_bits());
    assert_eq!(next_anchor.z.to_bits(), anchor.z.to_bits());
    assert_ne!(next_anchor.y.to_bits(), anchor.y.to_bits());
    assert_eq!(next_offset.x.to_bits(), offset.x.to_bits());
    assert_eq!(next_offset.z.to_bits(), offset.z.to_bits());
    assert_eq!(chosen.rate, curve_velocity(f.old, f.hit).unwrap().0);
    assert!(run(&mut work(), false).unwrap().is_none());
    for limit in [charged.used, charged.used - 1] {
        let mut budget = Work {
            used: 1000,
            limit: 1000 + limit,
        };
        let result = run(&mut budget, true);
        if limit == charged.used {
            assert!(result.unwrap().is_some());
            assert_eq!(budget.used, budget.limit);
        } else {
            assert_eq!(result.err().unwrap(), TrajectoryError::WorkLimit);
        }
    }
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.carrier, f.old)).unwrap(),
        before
    );
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        world_before.encoded_bytes()
    );
}

#[test]
fn rotating_normal_phase_declines_cross_axis_transport_and_large_rounding_corrections() {
    let f = recorded_c81_rotation();
    let Curve::Anchored {
        anchor,
        offset,
        linear_velocity,
        rotation,
        ..
    } = f.old
    else {
        unreachable!()
    };
    for control in 0..7 {
        let mut k = f.carrier;
        let mut changed_offset = offset;
        let mut changed_relative = linear_velocity;
        let mut changed_anchor = anchor;
        let mut changed_rotation = rotation;
        match control {
            0 => k.native.angular_velocity.x = 0.01,
            1 => k.native.motion.start.translation.x = 1.,
            2 => changed_offset.x = f32::from_bits(1),
            3 => changed_relative.z = 1.,
            4 => changed_anchor.y = -1.,
            5 => k.native.angular_velocity = rp::Vector::ZERO,
            _ => changed_rotation = rp::Rotation::from_rotation_y(0.1),
        }
        let mut callbacks = 0;
        assert!(propose_rotating(
            k,
            changed_anchor,
            changed_offset,
            changed_relative,
            changed_rotation,
            1,
            f.witness,
            f.hit,
            f.safe,
            f.hit,
            k.domain.end,
            0.01,
            &mut work(),
            &mut |_, _| {
                callbacks += 1;
                Ok(true)
            }
        )
        .unwrap()
        .is_none());
        assert_eq!(callbacks, 0);
    }
    // Common elevator translation cancels. Actual output cell widths still
    // reject a correction whose possible F32 jump exceeds the original skin.
    for origin in [-0.1, 524288.] {
        let mut k = f.carrier;
        k.native.motion.start.translation.y = origin;
        k.native.linear_velocity.y = 2.;
        k.native.motion.end.translation.y = origin + 2. * k.native.integration_seconds;
        let common = ground_rate::CorrectionRange::from_curve(
            k,
            rp::Vector::ZERO,
            rotation,
            f.safe,
            k.domain.end,
            1,
            &mut work(),
        )
        .unwrap();
        let d = common
            .difference_actions(
                [1.00998, 1.01002],
                f32::from_bits(0x33800000),
                [0.099998, 0.100002],
                0.91000015,
                0.,
            )
            .unwrap();
        assert_eq!(d <= 0.01, origin == -0.1);
    }
    // Physical h, observer labels and the independent logical Domain remain
    // original values even when the proposal's logical clock has another scale.
    let mut clock = f.carrier;
    clock.domain.end *= 1.5;
    let safe = f.safe * 1.5;
    let hit = f.hit * 1.5;
    let witness = clock.position_at_time(hit) * rp::Vector::new(1., 0.1, 0.);
    let nominated = propose_rotating(
        clock,
        anchor,
        offset,
        linear_velocity,
        rotation,
        1,
        witness,
        hit,
        safe,
        hit,
        clock.domain.end,
        0.01,
        &mut work(),
        &mut |candidate, _| {
            let Curve::Anchored { carrier, .. } = candidate else {
                unreachable!()
            };
            assert!(same_kernel(carrier, clock));
            assert_ne!(
                f64::from(carrier.native.integration_seconds),
                carrier.domain.duration()
            );
            Ok(true)
        },
    )
    .unwrap()
    .expect("clock-preserving proposal is not yet a future certificate");
    let Curve::Anchored { carrier, .. } = nominated.curve else {
        unreachable!()
    };
    assert_eq!(
        crate::checkpoint_codec::encode(&carrier).unwrap(),
        crate::checkpoint_codec::encode(&clock).unwrap()
    );
    let mut called = false;
    assert_eq!(
        propose_rotating(
            f.carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
            1,
            f.witness,
            f.hit,
            f.safe,
            f.hit,
            f.carrier.domain.end,
            0.01,
            &mut work(),
            &mut |_, _| {
                called = true;
                Err(TrajectoryError::WorkLimit)
            }
        )
        .err()
        .unwrap(),
        TrajectoryError::WorkLimit
    );
    assert!(called);
    // The identity producer's explicit nonidentity/rotation contract is kept.
    assert!(propose(
        f.carrier,
        anchor,
        offset,
        linear_velocity,
        rotation,
        1,
        f.witness,
        f.hit,
        f.safe,
        f.hit,
        f.carrier.domain.end,
        0.01,
        &mut work(),
        &mut |_, _| panic!("original identity callback must not run")
    )
    .unwrap()
    .is_none());
}

#[test]
fn c83_rebased_rotation_keeps_canonical_gravity_and_requires_projected_whole_future() {
    let mut f = recorded_c81_rotation();
    let domain = Domain::new(0.004166666883975267, 0.008333333767950535).unwrap();
    let mut k = Kernel::from_velocity_seconds(
        f.carrier.native.motion.body,
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
    k.native.motion.start_time = domain.start as f32;
    k.native.motion.end_time = domain.end as f32;
    let anchor = rp::Vector::new(0.99997854, 1.0100001, -0.0065449155);
    let offset = rp::Vector::new(6.431341e-5, 1.7881393e-7, 0.0065446342);
    let gravity = rp::Vector::new(0., -0.022303263, 0.);
    let current = Curve::Anchored {
        carrier: k,
        anchor,
        offset,
        linear_velocity: gravity,
        rotation: rp::Rotation::IDENTITY,
    };
    f.carrier = k;
    f.old = current;
    f.actor.motion.curve = current;
    f.platform.motion.curve = Curve::Integrated(k);
    f.safe = domain.start;
    f.hit = domain.start + domain.duration() * 0.25;
    f.witness = f.platform.motion.pose(f.hit) * rp::Vector::new(1., 0.1, 0.);
    let before = crate::checkpoint_codec::encode(&(k, current)).unwrap();
    let snapshot = f.world.capture_snapshot().unwrap();
    // Lifecycle intentionally restores this downward canonical plan at every
    // new Native context. A new descriptor must not silently remove gravity.
    let future = |old, w: &mut Work| {
        full_future::FullFuture::new(
            f.actor,
            old,
            f.platform,
            f.platform.motion.curve,
            &f.world.backend.colliders,
            k,
            f.safe,
            domain.end,
            0.01,
            false,
            w,
        )
    };
    let run = |relative: rp::Vector, approve: bool, budget: &mut Work| {
        let old = Curve::Anchored {
            carrier: k,
            anchor,
            offset,
            linear_velocity: relative,
            rotation: rp::Rotation::IDENTITY,
        };
        let future = future(old, budget)?;
        propose_rotating_rebased(
            k,
            anchor,
            offset,
            relative,
            rp::Rotation::IDENTITY,
            1,
            f.witness,
            f.hit,
            f.safe,
            f.hit,
            domain.end,
            0.01,
            budget,
            &mut |candidate, work| {
                assert!(same_pose(candidate.com_pose(f.safe), old.com_pose(f.safe)));
                assert_eq!(
                    curve_velocity(candidate, f.hit)?,
                    curve_velocity(old, f.hit)?
                );
                for time in [domain.start, f.hit, domain.end]
                    .into_iter()
                    .chain((1..32).map(|i| domain.start + domain.duration() * f64::from(i) / 32.))
                {
                    for axis in [0, 2] {
                        assert_eq!(
                            candidate.com_pose(time).translation[axis].to_bits(),
                            old.com_pose(time).translation[axis].to_bits()
                        );
                        assert_eq!(
                            curve_velocity(candidate, time)?.0[axis].to_bits(),
                            curve_velocity(old, time)?.0[axis].to_bits()
                        );
                    }
                }
                if !approve {
                    return Ok(false);
                }
                future.accepts(candidate, work)
            },
        )
    };
    // Keeping the actual downward rate still meets the platform later. No
    // phase, point witness, or old support flag may approve that whole future.
    assert!(run(gravity, true, &mut work()).unwrap().is_none());
    // Only after the existing real ground row has projected normal motion to
    // zero can this geometry-only continuation receive whole-pair approval.
    let mut paid = work();
    let selected = run(rp::Vector::ZERO, true, &mut paid)
        .unwrap()
        .expect("rebased normal-only phase must pass the original full future");
    let Curve::Anchored {
        carrier,
        anchor: next,
        offset: fitted,
        linear_velocity,
        ..
    } = selected.curve
    else {
        unreachable!()
    };
    assert!(same_kernel(carrier, k));
    assert_eq!(linear_velocity, rp::Vector::ZERO);
    for axis in [0, 2] {
        assert_eq!(next[axis].to_bits(), anchor[axis].to_bits());
        assert_eq!(fitted[axis].to_bits(), offset[axis].to_bits());
    }
    assert!(run(rp::Vector::ZERO, false, &mut work()).unwrap().is_none());
    for allowance in [paid.used, paid.used - 1] {
        let mut budget = Work {
            used: 1000,
            limit: 1000 + allowance,
        };
        let result = run(rp::Vector::ZERO, true, &mut budget);
        if allowance == paid.used {
            assert!(result.unwrap().is_some());
            assert_eq!(budget.used, budget.limit);
        } else {
            assert_eq!(result.err().unwrap(), TrajectoryError::WorkLimit);
        }
    }
    // A zero-tangent tuple has already exhausted the old producer; do not
    // repeat its nine cells or a whole-future query through the new wrapper.
    let mut no_work = Work { used: 0, limit: 0 };
    assert!(propose_rotating_rebased(
        k,
        anchor,
        rp::Vector::Y * offset.y,
        rp::Vector::ZERO,
        rp::Rotation::IDENTITY,
        1,
        f.witness,
        f.hit,
        f.safe,
        f.hit,
        domain.end,
        0.01,
        &mut no_work,
        &mut |_, _| panic!("old zero-tangent candidates must not repeat")
    )
    .unwrap()
    .is_none());
    assert_eq!(no_work.used, 0);
    // The arbitrary finite tangent relative products use exactly the same
    // original logical clock and RN order on both sides of the phase change.
    assert!(run(rp::Vector::new(0.125, 0., -0.25), false, &mut work())
        .unwrap()
        .is_none());
    assert_eq!(
        crate::checkpoint_codec::encode(&(k, current)).unwrap(),
        before
    );
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );
}

fn recorded_c89_rotation() -> RotatingFixture {
    let mut f = recorded_c81_rotation();
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let mut k = Kernel::from_velocity_seconds(
        f.carrier.native.motion.body,
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.006544916, 0., 0.99997866),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., std::f32::consts::FRAC_PI_2, 0.),
    )
    .unwrap();
    k.native.motion.start_time = 0.008333334;
    k.native.motion.end_time = 0.012500001;
    k.native.motion.end.rotation = rp::Rotation::from_xyzw(0., 0.009817285, 0., 0.9999519);
    f.carrier = k;
    f.old = Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::new(0.9998717, 1.0100001, -0.013088992),
        offset: rp::Vector::new(0.0002568364, -1.7881393e-7, 0.013086753),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    f.actor.motion.curve = f.old;
    f.platform.motion.curve = Curve::Integrated(k);
    f.safe = 0.00833526102530868;
    f.hit = 0.008335261025308682;
    f.witness = rp::Vector::new(0.99987125, -7.450581e-9, -0.013092011);
    f
}

#[test]
fn c89_rotating_safe_cell_endpoints_require_original_whole_future() {
    let f = recorded_c89_rotation();
    let Curve::Anchored {
        anchor,
        offset,
        linear_velocity,
        rotation,
        ..
    } = f.old
    else {
        unreachable!()
    };
    let before = crate::checkpoint_codec::encode(&(f.carrier, f.old)).unwrap();
    let snapshot = f.world.capture_snapshot().unwrap();
    let previous = gap(
        f.actor,
        f.old,
        f.platform,
        f.platform.motion.curve,
        &f.world.backend.colliders,
        f.hit,
        0.01,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(previous < 0.01);
    let future = full_future::FullFuture::new(
        f.actor,
        f.old,
        f.platform,
        f.platform.motion.curve,
        &f.world.backend.colliders,
        f.carrier,
        f.safe,
        f.carrier.domain.end,
        0.01,
        false,
        &mut work(),
    )
    .unwrap();
    // The original single witness anchor fits safe and improves this hit, but
    // that is not approval. This original pair's selected-policy full future
    // still has to reject it before the new inverse endpoints are attempted.
    let bad = Curve::Anchored {
        carrier: f.carrier,
        anchor: rp::Vector::new(anchor.x, 0.099999994, anchor.z),
        offset: rp::Vector::new(offset.x, 0.91, offset.z),
        linear_velocity,
        rotation,
    };
    assert!(same_pose(bad.com_pose(f.safe), f.old.com_pose(f.safe)));
    assert!(
        gap(
            f.actor,
            bad,
            f.platform,
            f.platform.motion.curve,
            &f.world.backend.colliders,
            f.hit,
            0.01,
            &mut work()
        )
        .unwrap()
        .unwrap()
            > previous
    );
    assert!(!future.accepts(bad, &mut work()).unwrap());
    let run = |approve: bool, budget: &mut Work| {
        propose_rotating_rebased(
            f.carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
            1,
            f.witness,
            f.hit,
            f.safe,
            f.hit,
            f.carrier.domain.end,
            0.01,
            budget,
            &mut |candidate, work| {
                assert!(same_pose(
                    candidate.com_pose(f.safe),
                    f.old.com_pose(f.safe)
                ));
                assert_eq!(
                    curve_velocity(candidate, f.hit)?,
                    curve_velocity(f.old, f.hit)?
                );
                for t in [f.carrier.domain.start, f.safe, f.hit, f.carrier.domain.end] {
                    for axis in [0, 2] {
                        assert_eq!(
                            candidate.com_pose(t).translation[axis].to_bits(),
                            f.old.com_pose(t).translation[axis].to_bits()
                        );
                    }
                }
                let improved = gap(
                    f.actor,
                    candidate,
                    f.platform,
                    f.platform.motion.curve,
                    &f.world.backend.colliders,
                    f.hit,
                    0.01,
                    work,
                )?;
                Ok(approve
                    && improved.is_some_and(|value| value >= 0.01 && value > previous)
                    && future.accepts(candidate, work)?)
            },
        )
    };
    let mut paid = work();
    let chosen = run(true, &mut paid)
        .unwrap()
        .expect("the original C89 safe-cell endpoint must pass the original full future");
    let Curve::Anchored {
        carrier,
        anchor: next_anchor,
        offset: next_offset,
        ..
    } = chosen.curve
    else {
        unreachable!()
    };
    assert!(same_kernel(carrier, f.carrier));
    assert_ne!(next_anchor.y.to_bits(), 0.099999994_f32.to_bits());
    assert_eq!(chosen.rate, curve_velocity(f.old, f.hit).unwrap().0);
    for axis in [0, 2] {
        assert_eq!(next_anchor[axis].to_bits(), anchor[axis].to_bits());
        assert_eq!(next_offset[axis].to_bits(), offset[axis].to_bits());
    }
    assert!(future.accepts(chosen.curve, &mut work()).unwrap());
    assert!(run(false, &mut work()).unwrap().is_none());
    for available in [paid.used, paid.used - 1] {
        let mut budget = Work {
            used: 1000,
            limit: 1000 + available,
        };
        let result = run(true, &mut budget);
        if available == paid.used {
            assert!(result.unwrap().is_some());
            assert_eq!(budget.used, budget.limit);
        } else {
            assert_eq!(result.err().unwrap(), TrajectoryError::WorkLimit);
        }
    }
    // Typed callback errors are never changed to rejection or hidden by a
    // later endpoint. The first eligible original candidate remains first.
    assert_eq!(
        propose_rotating_rebased(
            f.carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
            1,
            f.witness,
            f.hit,
            f.safe,
            f.hit,
            f.carrier.domain.end,
            0.01,
            &mut work(),
            &mut |_, _| Err(TrajectoryError::Unresolved),
        )
        .err()
        .unwrap(),
        TrajectoryError::Unresolved
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.carrier, f.old)).unwrap(),
        before
    );
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );
}

#[test]
fn rotating_anchor_preimage_has_complete_bounds_and_preserves_typed_work() {
    let f = recorded_c89_rotation();
    let Curve::Anchored { anchor, offset, .. } = f.old else {
        unreachable!()
    };
    let pose = f.carrier.position_at_time(f.safe);
    let target = f.old.com_pose(f.safe).translation.y;
    let fitted = rp::Vector::new(offset.x, f32::from_bits(0x3f68f5c2), offset.z);
    let mut paid = work();
    let bounds =
        rotating_anchor_preimage(pose, anchor, fitted, rp::Vector::ZERO, target, 1, &mut paid)
            .unwrap()
            .unwrap();
    assert_eq!(bounds.map(f32::to_bits), [0x3dccccd0, 0x3dccccd6]);
    let forward = |coordinate| {
        let mut a = anchor;
        a.y = coordinate;
        (((pose.translation + pose.rotation * a) + fitted) + rp::Vector::ZERO).y
    };
    for bits in bounds[0].to_bits()..=bounds[1].to_bits() {
        assert_eq!(forward(f32::from_bits(bits)).to_bits(), target.to_bits());
    }
    assert!(forward(bounds[0].next_down()) < target);
    assert!(forward(bounds[1].next_up()) > target);
    for available in [paid.used, paid.used - 1] {
        let mut budget = Work {
            used: 81,
            limit: 81 + available,
        };
        let result = rotating_anchor_preimage(
            pose,
            anchor,
            fitted,
            rp::Vector::ZERO,
            target,
            1,
            &mut budget,
        );
        if available == paid.used {
            assert_eq!(
                result.unwrap().unwrap().map(f32::to_bits),
                bounds.map(f32::to_bits)
            );
            assert_eq!(budget.used, budget.limit);
        } else {
            assert_eq!(result, Err(TrajectoryError::WorkLimit));
        }
    }
    // The original graph proof includes negative q-axis values. Its squared
    // second term is still increasing, without a unit-quaternion assumption.
    let mut negative = pose;
    negative.rotation.y = -negative.rotation.y;
    assert_eq!(
        rotating_anchor_preimage(
            negative,
            anchor,
            fitted,
            rp::Vector::ZERO,
            target,
            1,
            &mut work()
        )
        .unwrap()
        .unwrap()
        .map(f32::to_bits),
        bounds.map(f32::to_bits)
    );
    let mut cross = pose;
    cross.rotation.x = f32::from_bits(1);
    assert!(rotating_anchor_preimage(
        cross,
        anchor,
        fitted,
        rp::Vector::ZERO,
        target,
        1,
        &mut work()
    )
    .unwrap()
    .is_none());
    let mut reversed = pose;
    reversed.rotation = rp::Rotation::from_xyzw(0., 1., 0., 0.);
    assert!(rotating_anchor_preimage(
        reversed,
        anchor,
        fitted,
        rp::Vector::ZERO,
        target,
        1,
        &mut work()
    )
    .unwrap()
    .is_none());
    assert!(rotating_anchor_preimage(
        pose,
        anchor,
        fitted,
        rp::Vector::ZERO,
        f32::NAN,
        1,
        &mut work()
    )
    .unwrap()
    .is_none());
    // Numeric zero signs are checked by the final original forward bits; a
    // neighboring numeric zero is never silently substituted for the target.
    let zero_pose = rp::Pose::IDENTITY;
    let zero = rotating_anchor_preimage(
        zero_pose,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        0.,
        1,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(zero.map(f32::to_bits), [0, 0]);
    assert!(rotating_anchor_preimage(
        zero_pose,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        -0.,
        1,
        &mut work()
    )
    .unwrap()
    .is_none());
}

fn recorded_refined_rotation(
    domain: Domain,
    initial: [f32; 4],
    stored_end: [f32; 4],
    anchor: [f32; 3],
    offset: [f32; 3],
    safe: Time,
    witness: [f32; 3],
) -> RotatingFixture {
    let mut f = recorded_c81_rotation();
    let [x, y, z, w] = initial;
    let mut k = Kernel::from_velocity_seconds(
        f.carrier.native.motion.body,
        domain,
        f.carrier.native.integration_seconds,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(x, y, z, w),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 1.5707964, 0.),
    )
    .unwrap();
    k.native.motion.start_time = domain.start as f32;
    k.native.motion.end_time = domain.end as f32;
    assert_eq!(k.native.motion.end.rotation.to_array(), stored_end);
    f.carrier = k;
    f.safe = safe;
    f.hit = safe.next_up();
    f.witness = rp::Vector::from_array(witness);
    f.old = Curve::Anchored {
        carrier: k,
        anchor: rp::Vector::from_array(anchor),
        offset: rp::Vector::from_array(offset),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    f.actor.motion.curve = f.old;
    f.platform.motion.curve = Curve::Integrated(k);
    f
}

#[test]
fn refined_rotation_range_recovers_the_recorded_response_within_the_original_skin() {
    let f = recorded_refined_rotation(
        Domain::new(0., 0.004166666883975267).unwrap(),
        [0., 0.4771573, 0., 0.878818],
        [0., 0.48003066, 0., 0.87725174],
        [0.99087596, 1.0100002, 4.646182e-5],
        [-1.1920929e-7, -1.7881393e-7, 2.3841858e-7],
        6.476681235767501e-8,
        [0.5397111, -7.450581e-9, -0.8309909],
    );
    let (anchor, offset) = check_refined_rotation(&f, work());
    assert_eq!(anchor, 0.1_f32.next_down());
    assert_eq!(offset, 0.91000015);
}

#[test]
fn refined_preimage_correction_requires_the_original_whole_future() {
    let f = recorded_refined_rotation(
        Domain::new(0.008333333767950535, 0.012500000651925802).unwrap(),
        [0., 0.48289886, 0., 0.87567616],
        [0., 0.4857619, 0., 0.87409115],
        [0.9907491, 1.0100002, -0.012923181],
        [0.011013627, -1.7881393e-7, 0.0068496466],
        0.00833671264570057,
        [0.5287605, -7.450581e-9, -0.83795136],
    );
    let (anchor, _) = check_refined_rotation(&f, work());
    assert_ne!(anchor, 0.1_f32.next_down());
}

#[test]
fn signed_offset_neighbor_recovers_the_sixty_second_tick_response() {
    let f = recorded_refined_rotation(
        Domain::new(0.008333333767950535, 0.012500000651925802).unwrap(),
        [0., 0.7208518, 0., 0.6930893],
        [0., 0.72311604, 0., 0.69072664],
        [0.98552144, 1.0100003, 3.8022175e-5],
        [0.012893286, -2.9802322e-7, -0.00042134523],
        0.008335578450328283,
        [-0.025758348, 0., -0.98518443],
    );
    let (anchor, offset) = check_refined_rotation(&f, work());
    assert_eq!(anchor.to_bits(), 0.1_f32.to_bits() - 5);
    assert_eq!(offset.to_bits(), 0.91_f32.next_up().to_bits());
}

#[test]
fn signed_offset_search_recovers_the_sixty_second_tick_fourth_integration() {
    let f = recorded_refined_rotation(
        Domain::new(0.012500000651925802, 0.01666666753590107).unwrap(),
        [0., 0.72311604, 0., 0.69072664],
        [0., 0.72537255, 0., 0.6883566],
        [0.9854162, 1.0100003, -0.006411325],
        [0.01933105, -2.9802322e-7, -0.00082182884],
        0.012502253012257823,
        [-0.032202736, -7.450581e-9, -0.98491055],
    );
    let (anchor, offset) = check_refined_rotation(&f, work());
    assert_eq!(anchor.to_bits(), 0.1_f32.to_bits() + 18);
    assert_eq!(offset.to_bits(), 0.91_f32.to_bits() - 2);
}

#[test]
fn signed_offset_search_recovers_the_sixty_sixth_tick_response() {
    let f = recorded_refined_rotation(
        Domain::new(0., 0.004166666883975267).unwrap(),
        [0., 0.751838, 0., 0.65934783],
        [0., 0.75399166, 0., 0.65688396],
        [0.9844659, 1.0100001, 0.012929574],
        [-7.450581e-9, -5.9604645e-8, 0.],
        1.5645794633201149e-6,
        [-0.115676835, 0., -0.9777315],
    );
    let (anchor, offset) = check_refined_rotation(&f, work());
    assert_eq!(anchor.to_bits(), 0.1_f32.to_bits() - 46);
    assert_eq!(offset.to_bits(), 0.91_f32.to_bits() + 6);
}

#[test]
fn recorded_wasi_turn_recovers_the_supported_rider() {
    let mut f = recorded_c81_rotation();
    let domain = Domain::new(0.012500000651925802, 0.01666666753590107).unwrap();
    let mut native = f.carrier.native;
    native.motion.start_time = domain.start as f32;
    native.motion.end_time = domain.end as f32;
    native.motion.start.rotation = rp::Rotation::from_xyzw(0., 0.73653996, 0., -0.6763941);
    native.motion.end.rotation = rp::Rotation::from_xyzw(0., 0.73432255, 0., -0.67880076);
    native.angular_velocity = rp::Vector::Y * 1.570_792_8;
    let carrier = Kernel::from_native(native, domain).unwrap();
    f.carrier = carrier;
    f.safe = 0.012500052170627995;
    f.hit = f.safe.next_up();
    f.witness = rp::Vector::new(-0.09152511, -7.450581e-9, 0.99589825);
    f.old = Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(1.0000736, 1.01, 0.006560574),
        offset: rp::Vector::new(3.7252903e-8, -5.9604645e-8, -5.9604645e-8),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    f.actor.motion.curve = f.old;
    f.platform.motion.curve = Curve::Integrated(carrier);
    // This interval arrives after three integrations have shared the tick budget.
    check_refined_rotation(
        &f,
        Work {
            used: 0,
            limit: 10_000_000,
        },
    );
}

fn check_refined_rotation(f: &RotatingFixture, mut measured: Work) -> (f32, f32) {
    let k = f.carrier;
    let Curve::Anchored {
        anchor,
        offset,
        rotation,
        ..
    } = f.old
    else {
        unreachable!()
    };
    let colliders = &f.world.backend.colliders;
    let old = gap(
        f.actor,
        f.old,
        f.platform,
        f.platform.motion.curve,
        colliders,
        f.hit,
        0.01,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(old < 0.01);
    let future = full_future::FullFuture::new(
        f.actor,
        f.old,
        f.platform,
        f.platform.motion.curve,
        colliders,
        k,
        f.safe,
        k.domain.end,
        0.01,
        false,
        &mut work(),
    )
    .unwrap();
    let run = |skin, work: &mut Work| {
        propose_rotating_rebased(
            k,
            anchor,
            offset,
            rp::Vector::ZERO,
            rotation,
            1,
            f.witness,
            f.hit,
            f.safe,
            f.hit,
            k.domain.end,
            skin,
            work,
            &mut |candidate, work| {
                assert!(same_pose(
                    candidate.com_pose(f.safe),
                    f.old.com_pose(f.safe)
                ));
                assert_eq!(
                    curve_velocity(candidate, f.hit)?,
                    curve_velocity(f.old, f.hit)?
                );
                let next = gap(
                    f.actor,
                    candidate,
                    f.platform,
                    f.platform.motion.curve,
                    colliders,
                    f.hit,
                    0.01,
                    work,
                )?;
                if !next.is_some_and(|gap| gap >= 0.01 && gap > old) {
                    return Ok(false);
                }
                future.accepts_rotating(candidate, (f.actor, f.platform), colliders, None, work)
            },
        )
    };
    // A first witness can require a complete rejection before a later
    // safe-cell endpoint succeeds.
    let response = run(0.01, &mut measured)
        .unwrap()
        .expect("whole future cleared");
    let Curve::Anchored {
        carrier,
        anchor: next_anchor,
        offset: next_offset,
        ..
    } = response.curve
    else {
        unreachable!()
    };
    assert!(same_kernel(carrier, k));
    assert_eq!(next_anchor.x.to_bits(), anchor.x.to_bits());
    assert_eq!(next_anchor.z.to_bits(), anchor.z.to_bits());
    assert_eq!(next_offset.x.to_bits(), offset.x.to_bits());
    assert_eq!(next_offset.z.to_bits(), offset.z.to_bits());
    assert!(run(1e-8, &mut work()).unwrap().is_none());
    (next_anchor.y, next_offset.y)
}

#[test]
fn adjacent_carrier_translation_cells_certify_the_position_rounding_candidate() {
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let safe = 0.008335446994919948_f64;
    let hit = safe.next_up();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.099_999_99, 0.),
            rp::Rotation::from_xyzw(0., 0.2777339, 0., 0.9606581),
        ),
        rp::Vector::Y * 1.3411044e-6,
        rp::Vector::Y * 1.5707929,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    let own = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(safe, domain.end).unwrap(),
        0.0041645537,
        rp::Pose::from_translation(rp::Vector::new(0.844828, 0.91, -0.53298366)),
        rp::Vector::Y * 1.3411045e-6,
        rp::Vector::ZERO,
    )
    .unwrap();
    let old = Curve::Integrated(own);
    let rate = curve_velocity(old, hit).unwrap().0;
    let relative = fit_relative(carrier.linear_velocity_at_time(), rate).unwrap();
    assert_ne!(relative, rp::Vector::ZERO);
    let phase = Curve::Anchored {
        carrier,
        anchor: rp::Vector::Y * f32::from_bits(0.1_f32.to_bits() - 654),
        offset: rp::Vector::new(0.844828, 0.910_004_9, -0.53298366),
        linear_velocity: relative,
        rotation: rp::Rotation::IDENTITY,
    };
    assert!(same_pose(old.com_pose(safe), phase.com_pose(safe)));
    assert_eq!(curve_velocity(phase, hit).unwrap().0, rate);
    assert!(phase.com_pose(hit).translation.y > old.com_pose(hit).translation.y);
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let a = motion(Curve::Integrated(carrier));
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 15_000_000,
    };
    let coverage = solver_trajectory::cast_full_shapes_policy_coverage(
        a,
        cuboid.as_ref(),
        motion(phase),
        capsule.as_ref(),
        safe,
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
fn adjacent_reference_height_clears_the_recorded_position_rebase() {
    let domain = Domain::new(0., 0.004166666883975267).unwrap();
    let safe = 1.6911545230868796e-6_f64;
    let probe = safe.next_up();
    let mut carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.),
            rp::Rotation::from_xyzw(0., 0.61909395, 0., 0.7853169),
        ),
        rp::Vector::Y * 4.470348e-7,
        rp::Vector::Y * 1.5707966,
    )
    .unwrap();
    carrier.native.motion.start_time = domain.start as f32;
    carrier.native.motion.end_time = domain.end as f32;
    let pose = rp::Pose::from_translation(rp::Vector::new(0.29650408, 0.91, -0.954506));
    let own = Kernel::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        Domain::new(safe, domain.end).unwrap(),
        pose,
        rp::Vector::Y * 4.4889745e-7,
        rp::Vector::ZERO,
    )
    .unwrap();
    let rate = own.linear_velocity_at_time();
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let platform = motion(Curve::Integrated(carrier));
    let cuboid = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 600_000,
    };
    let proposal = translated_face_phase(
        own,
        carrier,
        rp::Vector::Y,
        0.1,
        rate,
        safe,
        probe,
        domain.end,
        0.01,
        &mut work,
        |candidate, work| {
            let result = solver_trajectory::cast_full_shapes_policy_coverage(
                platform,
                cuboid.as_ref(),
                motion(candidate),
                capsule.as_ref(),
                safe,
                domain.end,
                0.01,
                f64::from(carrier.native.integration_seconds * 1e-6),
                work,
                false,
            )?;
            Ok(result.strictly_clear_start && result.hit.is_none())
        },
    )
    .unwrap()
    .expect("the adjacent translation frame clears the full original interval");
    assert!(same_pose(proposal.curve.com_pose(safe), pose));
    assert_eq!(curve_velocity(proposal.curve, probe).unwrap().0, rate);
    assert!(proposal.curve.com_pose(probe).translation.y > pose.translation.y);
    assert_eq!(
        proposal.curve.com_pose(domain.end).translation.x,
        pose.translation.x
    );
    assert_eq!(
        proposal.curve.com_pose(domain.end).translation.z,
        pose.translation.z
    );
}
