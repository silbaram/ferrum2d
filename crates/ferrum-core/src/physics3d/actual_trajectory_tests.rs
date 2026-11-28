//! Acceptance regressions for the new execution path. These are intentionally
//! not a replacement for existing prefix/suffix/force/oneway/step/drop goldens.
use super::solver_trajectory::{Curve, Domain, Kernel, ShapeMotion, Work};
use super::world::native_id;
use super::*;

#[test]
fn actual_character_trajectory_automatically_shares_clock_with_admitted_extra32_and_replays() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        space: Space::PlanarXy,
        ..Default::default()
    })
    .unwrap();
    let bar = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                angular_velocity: [0., 0., 40.],
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.025, 0.1],
            }),
        )
        .unwrap();
    let actor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [1.2, 1., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    w.enable_character(
        actor,
        CharacterConfig {
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    let tuned = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                can_sleep: false,
                pose: Pose {
                    position: [100., 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [0., 1., 0.],
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        )
        .unwrap();
    // This is an admitted restored backend setting, not a new public Core
    // setter. The actual private native codec must accept and retain it.
    w.backend.bodies[native_id(tuned)].set_additional_solver_iterations(32);
    w.backend.bodies[native_id(tuned)].set_additional_pgs_iterations(32);
    w.set_step_motion_enabled(true);
    let saved = w.capture_snapshot().unwrap();
    w.restore_snapshot(&saved).unwrap();
    w.force_character_motion_proof();
    assert_eq!(
        w.backend.bodies[native_id(tuned)].additional_solver_iterations(),
        32
    );
    w.step_checked().unwrap();
    let tick_seconds = f64::from(w.config().step_seconds);
    assert_eq!(w.actual_motion_completed_time(), tick_seconds);
    let trace = w.events.2.get_mut().unwrap();
    let cadence = w.backend.integration_parameters.num_solver_iterations + 32;
    assert_eq!(cadence, 36);
    // The original scalar producer divides the ordinal before multiplying by
    // the logical duration. Multiplying first is a different F64 oracle even
    // for this fixture's unchanged nominal tick and cadence.
    let mul_first = tick_seconds * 11. / cadence as f64;
    let fraction_first = tick_seconds * (11. / cadence as f64);
    assert_eq!(mul_first.to_bits(), 0x3f9f_49f4_a71c_71c7);
    assert_eq!(fraction_first.to_bits(), 0x3f9f_49f4_a71c_71c8);
    assert!(!trace.precise_passes.is_empty());
    assert_eq!(trace.precise_passes.first().unwrap().start, 0.);
    assert_eq!(
        trace.precise_passes.last().unwrap().end,
        trace.precise_elapsed()
    );
    assert_eq!(trace.precise_elapsed(), tick_seconds);
    assert!(!trace.integration_capacity_failed);
    for pair in trace.precise_passes.windows(2) {
        assert_eq!(pair[0].end, pair[1].start);
    }
    for pass in &trace.precise_passes {
        for id in [bar, actor, tuned] {
            let rows: Vec<_> = trace
                .actual
                .iter()
                .filter(|m| {
                    m.body == native_id(id) && m.start_time >= pass.start && m.end_time <= pass.end
                })
                .collect();
            assert!(!rows.is_empty(), "body={id:?}");
            assert_eq!(rows.first().unwrap().start_time, pass.start);
            assert_eq!(rows.last().unwrap().end_time, pass.end);
            for pair in rows.windows(2) {
                assert_eq!(pair[0].end_time, pair[1].start_time);
            }
            for row in &rows {
                let (start, end) = row.curve.times();
                assert!(row.start_time >= start && row.end_time <= end);
            }
            // Response may add breakpoints, but every real original Native
            // context boundary must survive in its accepted piecewise path.
            for index in 0..=cadence {
                // State the original scalar law independently; do not call
                // Domain::boundary/the private Native producer as the oracle.
                // Stored endpoints retain their exact bits without recomposing
                // start + (end - start) or passing through an observer label.
                let boundary = if index == 0 {
                    pass.start
                } else if index == cadence {
                    pass.end
                } else {
                    pass.start + (pass.end - pass.start) * (index as f64 / cadence as f64)
                };
                if pass.start == 0. && id == bar && index == 11 {
                    let actual = rows
                        .iter()
                        .find(|m| m.start_time == boundary || m.end_time == boundary)
                        .map(|m| (m.start_time.to_bits(), m.end_time.to_bits()));
                    let mul_first =
                        pass.start + (pass.end - pass.start) * index as f64 / cadence as f64;
                    eprintln!(
                        "A42_CLOCK_ORACLE pass_start_bits={:#018x} pass_end_bits={:#018x} cadence={cadence} index={index} mul_first_bits={:#018x} fraction_first_bits={:#018x} actual_row_bits={actual:?}",
                        pass.start.to_bits(), pass.end.to_bits(), mul_first.to_bits(), boundary.to_bits()
                    );
                }
                assert!(
                    rows.iter()
                        .any(|m| m.start_time == boundary || m.end_time == boundary),
                    "missing actual context boundary body={id:?} index={index}"
                );
            }
            for row in rows {
                if let Curve::Integrated(kernel) = row.curve {
                    let middle = (row.start_time + row.end_time) * 0.5;
                    let physical_dt = (((middle - kernel.domain.start) / kernel.domain.duration())
                        * f64::from(kernel.native.integration_seconds))
                        as f32;
                    let mut native_pose = kernel.native.motion.start;
                    // Independent statement of the original native kernel;
                    // its private helper and Kernel's evaluator stay opaque.
                    let half_angle = kernel.native.angular_velocity * (physical_dt * 0.5);
                    let increment = rapier3d::prelude::Rotation::from_xyzw(
                        half_angle.x,
                        half_angle.y,
                        half_angle.z,
                        1.,
                    );
                    native_pose.rotation = (increment * native_pose.rotation).normalize();
                    native_pose.translation += kernel.native.linear_velocity * physical_dt;
                    assert_eq!(kernel.position_at_time(middle), native_pose);
                }
            }
        }
    }
    let mut expected = Vec::new();
    expected.push(w.capture_snapshot().unwrap());
    for _ in 0..6 {
        w.step_checked().unwrap();
        assert_eq!(w.actual_motion_completed_time(), tick_seconds);
        expected.push(w.capture_snapshot().unwrap());
    }
    w.restore_snapshot(&saved).unwrap();
    w.force_character_motion_proof();
    for expected in expected {
        w.step_checked().unwrap();
        assert_eq!(w.actual_motion_completed_time(), tick_seconds);
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            expected.encoded_bytes()
        );
    }
}

#[test]
fn actual_backend_curve_query_is_readonly_and_retains_full_shape_pose_kernel() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.037,
        ..Default::default()
    })
    .unwrap();
    let body = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                can_sleep: false,
                angular_velocity: [0., 0., 40.],
                linear_velocity: [0.3, -0.2, 0.1],
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.025, 0.1],
            }),
        )
        .unwrap();
    w.force_character_motion_proof();
    w.set_step_motion_enabled(true);
    w.step_checked().unwrap();
    let accepted = *w
        .events
        .2
        .get_mut()
        .unwrap()
        .actual
        .iter()
        .find(|r| r.body == native_id(body))
        .unwrap();
    let Curve::Integrated(row) = accepted.curve else {
        panic!("actual native integration");
    };
    let rigid = &w.backend.bodies[native_id(body)];
    let shape = &w.backend.colliders[rigid.colliders()[0]];
    let motion = ShapeMotion {
        curve: Curve::Integrated(row),
        local_center: rigid.local_center_of_mass(),
        local_pose: *shape.position_wrt_parent().unwrap(),
    };
    let first = motion.pose(row.domain.start);
    let last = motion.pose(row.domain.end);
    assert_eq!(
        first,
        row.native
            .motion
            .start
            .prepend_translation(-rigid.local_center_of_mass())
            * *shape.position_wrt_parent().unwrap()
    );
    assert_eq!(
        last,
        row.native
            .motion
            .end
            .prepend_translation(-rigid.local_center_of_mass())
            * *shape.position_wrt_parent().unwrap()
    );
    let target_shape = rapier3d::prelude::SharedShape::ball(0.25);
    let target_row = Kernel::from_velocity(
        rapier3d::prelude::RigidBodyHandle::invalid(),
        Domain {
            start: row.domain.start,
            end: row.domain.end,
        },
        rapier3d::prelude::Pose::from_translation(rapier3d::prelude::Vector::splat(20.)),
        rapier3d::prelude::Vector::ZERO,
        rapier3d::prelude::Vector::ZERO,
    )
    .unwrap();
    let target = ShapeMotion {
        curve: Curve::Integrated(target_row),
        local_center: rapier3d::prelude::Vector::ZERO,
        local_pose: rapier3d::prelude::Pose::IDENTITY,
    };
    let bytes = w.capture_snapshot().unwrap();
    let mut work = Work {
        used: 0,
        limit: 1024 * 1024,
    };
    assert!(motion
        .separated(
            shape.shape(),
            target,
            target_shape.as_ref(),
            rapier3d::prelude::Vector::Y,
            row.domain.start,
            row.domain.end,
            0.,
            &mut work
        )
        .unwrap());
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        bytes.encoded_bytes()
    );
}
