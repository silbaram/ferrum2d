use super::*;
use crate::physics3d::solver_trajectory::{self, ShapeMotion};

const SAFE: Time = 7.271704357017194e-7;
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
struct Fixture {
    old: Curve,
    driver: ShapeMotion,
    actor: ShapeMotion,
    driver_shape: rp::SharedShape,
    actor_shape: rp::SharedShape,
    geometry: rp::Vector,
    normal: rp::Vector,
    planes: [Plane; 4],
    constraints: [(rp::Vector, rp::Vector); 2],
    end: Time,
}
fn fixture() -> Fixture {
    let end = f64::from(0.025_f32);
    let kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., end).unwrap(),
        0.025,
        rp::Pose::from_parts(
            rp::Vector::ZERO,
            rp::Rotation::from_xyzw(0., 0., 0.38152424, 0.9243588),
        ),
        rp::Vector::ZERO,
        rp::Vector::Z * 7.853982,
    )
    .unwrap();
    let old = Curve::Anchored {
        carrier: kernel,
        anchor: rp::Vector::ZERO,
        offset: rp::Vector::new(1.1999968, 1.8460346, 0.),
        linear_velocity: rp::Vector::new(7.8838453, 29.742083, -0.000261052),
        rotation: rp::Rotation::IDENTITY,
    };
    let geometry = curve_velocity(old, SAFE).unwrap().0;
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let driver = motion(Curve::Integrated(kernel));
    let actor = motion(old);
    let driver_shape = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let actor_shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let contact = solver_trajectory::leaf_contact(
        &driver.pose(SAFE),
        driver_shape.as_ref(),
        &actor.pose(SAFE),
        actor_shape.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(contact.dist > 0. && contact.dist <= 0.01);
    // The actual recorded simultaneous instantaneous and endpoint planes.
    let constraints = [
        (
            rp::Vector::new(-0.70533484, 0.7088746, 0.),
            rp::Vector::new(-11.115689, 10.837421, 0.),
        ),
        (
            rp::Vector::new(1., 0., -1.4457195e-11),
            rp::Vector::new(7.883845, 0., -0.0002610521),
        ),
    ];
    let planes = [
        Plane {
            normal: constraints[0].0,
            offset: constraints[0].0.dot(constraints[0].1),
        },
        Plane {
            normal: constraints[1].0,
            offset: constraints[1].0.dot(constraints[1].1),
        },
        Plane {
            normal: rp::Vector::Z,
            offset: geometry.z,
        },
        Plane {
            normal: -rp::Vector::Z,
            offset: -geometry.z,
        },
    ];
    Fixture {
        old,
        driver,
        actor,
        driver_shape,
        actor_shape,
        geometry,
        normal: contact.normal1,
        planes,
        constraints,
        end,
    }
}
fn future(f: &Fixture, p: Proposal, work: &mut Work) -> Result<bool, TrajectoryError> {
    if !f
        .constraints
        .iter()
        .all(|(n, v)| (p.rate - *v).dot(*n) >= 0.)
    {
        return Ok(false);
    }
    Ok(solver_trajectory::cast_full_shapes_policy(
        f.driver,
        f.driver_shape.as_ref(),
        ShapeMotion {
            curve: p.curve,
            ..f.actor
        },
        f.actor_shape.as_ref(),
        SAFE,
        f.end,
        0.01,
        f64::from(0.025_f32 * 1e-6),
        work,
        true,
    )?
    .is_none())
}

#[test]
fn recorded_initial_graze_preserves_safe_clock_and_planes_with_full_pair_future() {
    let f = fixture();
    let before = postcard::to_allocvec(&(f.old, f.driver)).unwrap();
    let old = solver_trajectory::cast_full_shapes_policy(
        f.driver,
        f.driver_shape.as_ref(),
        f.actor,
        f.actor_shape.as_ref(),
        SAFE,
        f.end,
        0.01,
        f64::from(0.025_f32 * 1e-6),
        &mut work(),
        true,
    )
    .unwrap()
    .expect("the unchanged recorded angular graze still needs a response");
    assert_eq!(old.safe_time, SAFE);
    assert_eq!(old.hit_time, SAFE);
    let proposal = propose(
        f.old,
        f.geometry,
        f.normal,
        [false, false, true],
        &f.planes,
        SAFE,
        f.end,
        0.01,
        &mut work(),
        &mut |p, w| future(&f, p, w),
    )
    .unwrap()
    .expect("a bounded actual full-future response for the recorded graze");
    assert!(same_pose(
        proposal.curve.com_pose(SAFE),
        f.old.com_pose(SAFE)
    ));
    assert_eq!(proposal.rate.z.to_bits(), f.geometry.z.to_bits());
    let Curve::Anchored {
        carrier: original, ..
    } = f.old
    else {
        unreachable!()
    };
    let Curve::Anchored {
        carrier, anchor, ..
    } = proposal.curve
    else {
        unreachable!()
    };
    assert!(same_kernel(carrier, original));
    assert_eq!(
        anchor,
        rp::Vector::ZERO,
        "the angular driver is only a clock reference"
    );
    assert!(future(&f, proposal, &mut work()).unwrap());
    for i in 0..=128 {
        let t = SAFE + (f.end - SAFE) * (i as f64 / 128.);
        let before = f.old.com_pose(t);
        let after = proposal.curve.com_pose(t);
        assert!((after.translation - before.translation).length() <= 0.01);
        assert_eq!(
            after.rotation.to_array().map(f32::to_bits),
            before.rotation.to_array().map(f32::to_bits)
        );
    }
    assert_eq!(postcard::to_allocvec(&(f.old, f.driver)).unwrap(), before);
}

#[test]
fn a_real_future_blocker_never_becomes_a_sampled_or_endpoint_only_approval() {
    let f = fixture();
    let lid = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(
                f.actor.pose(SAFE).translation + rp::Vector::Y * (0.5 + 0.01 + 0.1),
            ),
            start_time: 0.,
            end_time: f.end,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let shape = rp::SharedShape::cuboid(100., 0.1, 100.);
    let mut calls = 0;
    let result = propose(
        f.old,
        f.geometry,
        f.normal,
        [false, false, true],
        &f.planes,
        SAFE,
        f.end,
        0.01,
        &mut work(),
        &mut |p, w| {
            calls += 1;
            Ok(solver_trajectory::cast_full_shapes_policy(
                lid,
                shape.as_ref(),
                ShapeMotion {
                    curve: p.curve,
                    ..f.actor
                },
                f.actor_shape.as_ref(),
                SAFE,
                f.end,
                0.01,
                f64::from(0.025_f32 * 1e-6),
                w,
                true,
            )?
            .is_none())
        },
    )
    .unwrap();
    assert!(
        calls > 0,
        "the complete geometry observer was actually consulted"
    );
    assert!(
        result.is_none(),
        "no unsupported stop or escaping endpoint is a proof"
    );
}

#[test]
fn exact_work_offset_retry_and_observer_errors_never_publish_a_partial_descriptor() {
    let f = fixture();
    let mut measured = work();
    let first = propose(
        f.old,
        f.geometry,
        f.normal,
        [false, false, true],
        &f.planes,
        SAFE,
        f.end,
        0.01,
        &mut measured,
        &mut |_, _| Ok(true),
    )
    .unwrap()
    .unwrap();
    let mut exact = Work {
        used: 17,
        limit: 17 + measured.used,
    };
    let retry = propose(
        f.old,
        f.geometry,
        f.normal,
        [false, false, true],
        &f.planes,
        SAFE,
        f.end,
        0.01,
        &mut exact,
        &mut |_, _| Ok(true),
    )
    .unwrap()
    .unwrap();
    assert_eq!(exact.used, exact.limit);
    assert_eq!(
        postcard::to_allocvec(&first.curve).unwrap(),
        postcard::to_allocvec(&retry.curve).unwrap()
    );
    assert!(matches!(
        propose(
            f.old,
            f.geometry,
            f.normal,
            [false, false, true],
            &f.planes,
            SAFE,
            f.end,
            0.01,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            },
            &mut |_, _| Ok(true)
        ),
        Err(TrajectoryError::WorkLimit)
    ));
    assert!(matches!(
        propose(
            f.old,
            f.geometry,
            f.normal,
            [false, false, true],
            &f.planes,
            SAFE,
            f.end,
            0.01,
            &mut work(),
            &mut |_, _| Err(TrajectoryError::UnsupportedShape)
        ),
        Err(TrajectoryError::UnsupportedShape)
    ));
}

#[test]
fn real_anchor_nonangular_invalid_time_and_locked_rates_cannot_gain_phase_authority() {
    let f = fixture();
    let Curve::Anchored {
        carrier,
        offset,
        linear_velocity,
        rotation,
        ..
    } = f.old
    else {
        unreachable!()
    };
    let linear_carrier = Kernel::from_velocity_seconds(
        carrier.native.motion.body,
        carrier.domain,
        carrier.native.integration_seconds,
        carrier.native.motion.start,
        carrier.native.linear_velocity,
        rp::Vector::ZERO,
    )
    .unwrap();
    let mut calls = 0;
    let mut observe = |_: Proposal, _: &mut Work| {
        calls += 1;
        Ok(true)
    };
    for old in [
        Curve::Anchored {
            carrier,
            anchor: rp::Vector::X,
            offset,
            linear_velocity,
            rotation,
        },
        Curve::Anchored {
            carrier: linear_carrier,
            anchor: rp::Vector::ZERO,
            offset,
            linear_velocity,
            rotation,
        },
        Curve::Constant {
            pose: f.old.com_pose(SAFE),
            start_time: 0.,
            end_time: f.end,
        },
    ] {
        assert!(propose(
            old,
            f.geometry,
            f.normal,
            [false; 3],
            &f.planes,
            SAFE,
            f.end,
            0.01,
            &mut work(),
            &mut observe
        )
        .unwrap()
        .is_none());
    }
    assert!(propose(
        f.old,
        f.geometry,
        f.normal,
        [true; 3],
        &f.planes,
        SAFE,
        f.end,
        0.01,
        &mut work(),
        &mut observe
    )
    .unwrap()
    .is_none());
    assert!(matches!(
        propose(
            f.old,
            f.geometry,
            f.normal,
            [false; 3],
            &f.planes,
            f.end,
            f.end,
            0.01,
            &mut work(),
            &mut observe
        ),
        Err(TrajectoryError::InvalidTime)
    ));
    assert!(matches!(
        propose(
            f.old,
            f.geometry,
            rp::Vector::splat(f32::NAN),
            [false; 3],
            &f.planes,
            SAFE,
            f.end,
            0.01,
            &mut work(),
            &mut observe
        ),
        Err(TrajectoryError::NonFinite)
    ));
    assert_eq!(calls, 0);
}
