use super::*;
use crate::physics3d::world::native_id;
use crate::physics3d::*;

#[derive(Clone, Copy)]
enum LeftWall {
    Original,
    AboveFirstBarArc,
}

fn pose(p: [f32; 3]) -> Pose {
    Pose {
        position: p,
        ..Default::default()
    }
}
fn fixture(
    extra: bool,
    ceiling: bool,
    mass: f32,
    left_wall: LeftWall,
) -> (PhysicsWorld3d, BodyId, BodyId, BodyId, Option<BodyId>) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
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
                pose: pose([1.2, 1., 0.]),
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
            push_mass: mass,
            ..Default::default()
        },
    )
    .unwrap();
    let (left_y, left_half_height) = match left_wall {
        LeftWall::Original => (1., 0.6),
        LeftWall::AboveFirstBarArc => (1.35, 0.25),
    };
    let left = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: pose([0.89, left_y, 0.]),
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.05, left_half_height, 0.2],
            }),
        )
        .unwrap();
    let top = ceiling.then(|| {
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: pose([1.2, 1.56, 0.]),
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.7, 0.05, 0.2],
            }),
        )
        .unwrap()
    });
    if extra {
        let other = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose([100., 0., 0.]),
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        w.enable_character(
            other,
            CharacterConfig {
                step_height: 0.,
                snap_distance: 0.,
                ..Default::default()
            },
        )
        .unwrap();
    }
    (w, bar, actor, left, top)
}
fn separation(w: &PhysicsWorld3d, target: BodyId, actor: BodyId) -> f32 {
    let a = &w.backend.colliders[w.backend.bodies[native_id(actor)].colliders()[0]];
    let b = &w.backend.colliders[w.backend.bodies[native_id(target)].colliders()[0]];
    contact(b.position(), b.shape(), a.position(), a.shape(), 10.)
        .unwrap()
        .unwrap()
        .dist
}

fn same_pose(a: rp::Pose, b: rp::Pose) -> bool {
    a.translation.to_array().map(f32::to_bits) == b.translation.to_array().map(f32::to_bits)
        && a.rotation.to_array().map(f32::to_bits) == b.rotation.to_array().map(f32::to_bits)
}

#[test]
fn angular_suffix_actual_solver_curve_and_second_character_control_keep_clearance_without_stop() {
    use crate::physics3d::motion_trace::AcceptedCurve;
    use crate::physics3d::solver_trajectory::{Curve, Domain, Kernel};

    fn kernel_pose(kernel: Kernel, time: Time) -> rp::Pose {
        let pose = if time <= kernel.domain.start {
            kernel.native.motion.start
        } else if time >= kernel.domain.end {
            kernel.native.motion.end
        } else {
            // Independent original Native expression. A clipped AcceptedCurve
            // keeps this original domain/h/end law, not an endpoint lerp.
            let dt = (((time - kernel.domain.start) / (kernel.domain.end - kernel.domain.start))
                .clamp(0., 1.)
                * f64::from(kernel.native.integration_seconds)) as f32;
            let half_angle = kernel.native.angular_velocity * (dt * 0.5);
            let increment = rp::Rotation::from_xyzw(half_angle.x, half_angle.y, half_angle.z, 1.);
            rp::Pose::from_parts(
                kernel.native.motion.start.translation + kernel.native.linear_velocity * dt,
                (increment * kernel.native.motion.start.rotation).normalize(),
            )
        };
        assert!(same_pose(pose, kernel.position_at_time(time)));
        pose
    }
    fn actual_pose(curve: Curve, time: Time) -> rp::Pose {
        let pose = match curve {
            Curve::Integrated(kernel) => kernel_pose(kernel, time),
            Curve::Constant { pose, .. } => pose,
            Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            } => {
                let native = kernel_pose(carrier, time);
                let dt = (time - carrier.domain.start)
                    .clamp(0., carrier.domain.end - carrier.domain.start)
                    as f32;
                rp::Pose::from_parts(
                    native.translation + native.rotation * anchor + offset + linear_velocity * dt,
                    rotation,
                )
            }
            Curve::Ccd {
                sweep,
                start_time,
                end_time,
            } => {
                let fraction = ((time - start_time) / (end_time - start_time)).clamp(0., 1.) as f32;
                sweep
                    .transform_at(fraction)
                    .prepend_translation(sweep.local_center)
            }
        };
        assert!(same_pose(pose, curve.com_pose(time)));
        pose
    }
    fn partition(rows: &[AcceptedCurve], passes: &[Domain], cadence: usize, tick: Time) {
        let positive: Vec<_> = rows.iter().filter(|r| r.start_time < r.end_time).collect();
        assert!(
            !positive.is_empty(),
            "missing whole-tick positive path: {rows:?}"
        );
        assert_eq!(positive.first().unwrap().start_time, 0.);
        assert_eq!(positive.last().unwrap().end_time, tick);
        for row in rows {
            let (start, end) = row.curve.times();
            assert!(
                start <= row.start_time && row.end_time <= end && row.start_time <= row.end_time
            );
        }
        for adjacent in positive.windows(2) {
            assert_eq!(
                adjacent[0].end_time, adjacent[1].start_time,
                "gap/overlap or duplicate: {rows:?}"
            );
            assert!(
                same_pose(
                    actual_pose(adjacent[0].curve, adjacent[0].end_time),
                    actual_pose(adjacent[1].curve, adjacent[1].start_time)
                ),
                "discontinuous positive suffix: {rows:?}"
            );
        }
        // Producer permits one explicitly admitted authored endpoint placement,
        // not another positive-duration interval or a duplicate response prefix.
        let placements: Vec<_> = rows.iter().filter(|r| r.start_time == r.end_time).collect();
        assert!(
            placements.len() <= 1,
            "duplicate endpoint placement: {rows:?}"
        );
        for row in placements {
            assert_eq!(row.start_time, tick);
            assert!(
                matches!(row.curve, Curve::Constant { start_time, end_time, .. } if start_time == tick && end_time == tick)
            );
        }
        for pass in passes {
            for index in 0..=cadence {
                let boundary = if index == 0 {
                    pass.start
                } else if index == cadence {
                    pass.end
                } else {
                    pass.start + (pass.end - pass.start) * (index as f64 / cadence as f64)
                };
                assert!(
                    positive
                        .iter()
                        .any(|r| r.start_time == boundary || r.end_time == boundary),
                    "original Native context missing at {boundary:?}: {rows:?}"
                );
            }
        }
    }
    for extra in [false, true] {
        let (mut w, bar, actor, left, _) = fixture(extra, false, 0., LeftWall::AboveFirstBarArc);
        assert!((0.009..0.011).contains(&separation(&w, left, actor)));
        w.set_step_motion_enabled(true);
        let tick = f64::from(w.config().step_seconds);
        let saved = w.capture_snapshot().unwrap();
        w.step_checked().unwrap();
        assert_eq!(w.actual_motion_completed_time(), tick);
        assert!(separation(&w, bar, actor) > 0.);
        assert!(separation(&w, left, actor) > 0.);
        assert!(w.actual_prescribed_stop(bar).is_none());
        assert_eq!(w.step_statistics().kinematic_character_stops, 0);
        assert_eq!(w.step_statistics().kinematic_path_failures, 0);
        assert!(
            !w.character_state(actor)
                .unwrap()
                .moving_obstacle_iteration_limit
        );
        assert!(w.body_state(bar).unwrap().angular_velocity[2] > 7.);
        assert!(w.body_state(actor).unwrap().pose.position[1] > 1.83);
        let cadence = w.backend.integration_parameters.num_solver_iterations;
        assert_eq!(cadence, 4);
        let (moving, actors, passes) = {
            let trace = w.events.2.get_mut().unwrap();
            assert!(!trace.integration_capacity_failed);
            assert_eq!(
                trace
                    .motions
                    .iter()
                    .filter(|m| m.body == native_id(bar))
                    .count(),
                4
            );
            let moving: Vec<_> = trace
                .actual
                .iter()
                .copied()
                .filter(|m| m.body == native_id(bar))
                .collect();
            let actors: Vec<_> = trace
                .actual
                .iter()
                .copied()
                .filter(|m| m.body == native_id(actor))
                .collect();
            // One observer record per actual accepted curve. A split response
            // or explicit endpoint marker is not a fifth Native solver kernel.
            assert_eq!(
                trace
                    .motions
                    .iter()
                    .filter(|m| m.body == native_id(actor))
                    .count(),
                actors.len()
            );
            (moving, actors, trace.precise_passes.clone())
        };
        assert_eq!(moving.len(), 4);
        assert!(!passes.is_empty());
        assert_eq!(passes.first().unwrap().start, 0.);
        assert_eq!(passes.last().unwrap().end, tick);
        for adjacent in passes.windows(2) {
            assert_eq!(adjacent[0].end, adjacent[1].start);
        }
        partition(&moving, &passes, cadence, tick);
        partition(&actors, &passes, cadence, tick);
        let bar_body = &w.backend.bodies[native_id(bar)];
        let actor_body = &w.backend.bodies[native_id(actor)];
        let bar_collider = &w.backend.colliders[bar_body.colliders()[0]];
        let actor_collider = &w.backend.colliders[actor_body.colliders()[0]];
        let left_collider = &w.backend.colliders[w.backend.bodies[native_id(left)].colliders()[0]];
        let shape_pose =
            |row: &AcceptedCurve, time, body: &rp::RigidBody, collider: &rp::Collider| {
                actual_pose(row.curve, time).prepend_translation(-body.local_center_of_mass())
                    * collider.position_wrt_parent().copied().unwrap_or_default()
            };
        let mut cuts: Vec<_> = moving
            .iter()
            .chain(&actors)
            .filter(|r| r.start_time < r.end_time)
            .flat_map(|r| [r.start_time, r.end_time])
            .collect();
        cuts.sort_by(f64::total_cmp);
        cuts.dedup();
        let mut minimum = f32::MAX;
        let mut samples = 0usize;
        for bounds in cuts.windows(2) {
            let from = bounds[0];
            let to = bounds[1];
            let a = moving
                .iter()
                .find(|r| r.start_time <= from && r.end_time >= to && from < to)
                .unwrap();
            let b = actors
                .iter()
                .find(|r| r.start_time <= from && r.end_time >= to && from < to)
                .unwrap();
            for i in 0..=64 {
                let time = if i == 0 {
                    from
                } else if i == 64 {
                    to
                } else {
                    from + (to - from) * (i as f64 / 64.)
                };
                let bar_pose = shape_pose(a, time, bar_body, bar_collider);
                let actor_pose = shape_pose(b, time, actor_body, actor_collider);
                let d = contact(
                    &bar_pose,
                    bar_collider.shape(),
                    &actor_pose,
                    actor_collider.shape(),
                    10.,
                )
                .unwrap()
                .unwrap()
                .dist;
                assert!(
                    d >= 0.,
                    "extra={extra} actual_time={time:?} distance={d} bar={a:?} actor={b:?}"
                );
                let wall_gap = contact(
                    left_collider.position(),
                    left_collider.shape(),
                    &actor_pose,
                    actor_collider.shape(),
                    10.,
                )
                .unwrap()
                .unwrap()
                .dist;
                assert!(
                    wall_gap >= 0.,
                    "extra={extra} actual_time={time:?} left_wall_gap={wall_gap}"
                );
                let bar_wall_gap = contact(
                    left_collider.position(),
                    left_collider.shape(),
                    &bar_pose,
                    bar_collider.shape(),
                    10.,
                )
                .unwrap()
                .unwrap()
                .dist;
                assert!(
                    bar_wall_gap > 0.,
                    "extra={extra} actual_time={time:?} bar_wall_gap={bar_wall_gap}"
                );
                minimum = minimum.min(d);
                samples += 1;
            }
        }
        assert!(samples >= 260);
        for placement in actors.iter().filter(|r| r.start_time == r.end_time) {
            assert!(same_pose(
                actual_pose(placement.curve, tick)
                    .prepend_translation(-actor_body.local_center_of_mass()),
                *actor_body.position()
            ));
        }
        println!(
            "SUFFIX_ACTUAL_CURVE extra={extra} samples={samples} minimum={minimum} actor_pieces={}",
            actors.len()
        );
        let first = w.capture_snapshot().unwrap();
        let mut continuation = Vec::new();
        for _ in 0..6 {
            w.step_checked().unwrap();
            assert_eq!(w.actual_motion_completed_time(), tick);
            continuation.push(w.capture_snapshot().unwrap());
        }
        w.restore_snapshot(&saved).unwrap();
        w.step_checked().unwrap();
        assert_eq!(w.actual_motion_completed_time(), tick);
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            first.encoded_bytes()
        );
        for next in continuation {
            w.step_checked().unwrap();
            assert_eq!(w.actual_motion_completed_time(), tick);
            assert_eq!(
                w.capture_snapshot().unwrap().encoded_bytes(),
                next.encoded_bytes()
            );
        }
    }
}

#[test]
fn angular_suffix_fixed_wall_stops_the_bar_on_its_original_solver_curve() {
    use crate::physics3d::solver_trajectory::{Curve, ShapeMotion};

    let (mut w, bar, actor, left, _) = fixture(false, false, 0., LeftWall::Original);
    w.set_step_motion_enabled(true);
    let tick = f64::from(w.config().step_seconds);
    w.step_checked().unwrap();
    assert_eq!(w.actual_motion_completed_time(), tick);
    assert_eq!(w.step_statistics().kinematic_character_stops, 0);
    assert_eq!(w.step_statistics().kinematic_path_failures, 0);
    assert_eq!(w.body_state(bar).unwrap().angular_velocity, [0.; 3]);
    assert!(separation(&w, bar, actor) > 0.);
    assert!(separation(&w, left, actor) > 0.);
    assert!(separation(&w, left, bar) >= 0.);
    let stop = w.actual_prescribed_stop(bar).unwrap();
    assert!(tick * 0.25 < stop && stop < tick * 0.5);

    let trace = w.events.2.get_mut().unwrap();
    let moving: Vec<_> = trace
        .actual
        .iter()
        .filter(|row| row.body == native_id(bar))
        .collect();
    let prefix = moving.iter().find(|row| row.end_time == stop).unwrap();
    let Curve::Integrated(kernel) = prefix.curve else {
        panic!("missing the original bar integration prefix");
    };
    assert!(kernel.domain.start < stop && stop < kernel.domain.end);
    let stopped_pose = kernel.position_at_time(stop);
    let holds: Vec<_> = moving.iter().filter(|row| row.start_time >= stop).collect();
    assert_eq!(holds.first().unwrap().start_time, stop);
    assert_eq!(holds.last().unwrap().end_time, tick);
    for rows in holds.windows(2) {
        assert_eq!(rows[0].end_time, rows[1].start_time);
    }
    for row in holds {
        let Curve::Constant { pose, .. } = row.curve else {
            panic!("expected the bar to keep its accepted stop pose");
        };
        assert!(same_pose(pose, stopped_pose));
    }

    let bar_body = &w.backend.bodies[native_id(bar)];
    let bar_collider = &w.backend.colliders[bar_body.colliders()[0]];
    let left_collider = &w.backend.colliders[w.backend.bodies[native_id(left)].colliders()[0]];
    let original = ShapeMotion {
        curve: prefix.curve,
        local_center: bar_body.local_center_of_mass(),
        local_pose: bar_collider.position_wrt_parent().copied().unwrap(),
    };
    assert!(same_pose(original.pose(stop), *bar_collider.position()));
    let uncut = contact(
        left_collider.position(),
        left_collider.shape(),
        &original.pose(kernel.domain.end),
        bar_collider.shape(),
        10.,
    )
    .unwrap()
    .unwrap();
    assert!(uncut.dist < 0.);
}

#[test]
fn angular_suffix_retains_static_ceiling_and_old_stop_prefix_for_single_and_aggregate() {
    for extra in [false, true] {
        let (mut w, bar, actor, left, top) = fixture(extra, true, 0., LeftWall::Original);
        w.step();
        assert!(separation(&w, bar, actor) >= 0.);
        assert!(separation(&w, left, actor) >= 0.);
        assert!(separation(&w, top.unwrap(), actor) >= 0.);
        assert_eq!(w.step_statistics().kinematic_character_stops, 1);
        assert_eq!(w.body_state(bar).unwrap().angular_velocity, [0.; 3]);
        assert_eq!(w.step_statistics().kinematic_path_failures, 0);
    }
}
#[test]
fn angular_suffix_readonly_query_preserves_actual_force_input_and_native_snapshot_bytes() {
    let (mut w, _bar, actor, _left, _) = fixture(false, false, 70., LeftWall::Original);
    w.set_character_input(
        actor,
        CharacterInput {
            velocity: [0.2, 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    w.apply_character_impulse(actor, [3., 0., 0.]).unwrap();
    w.add_character_force(actor, [4., 0., 0.]).unwrap();
    w.refresh_queries();
    w.prepare_character_motion();
    let before = w.capture_snapshot().unwrap();
    let out = super::super::MotionQuery {
        world: &w.backend,
        scene: &w.character_motion,
        policies: &w.contact_policies,
        order: &[],
        body: actor,
        collider: &w.backend.colliders[w.backend.bodies[native_id(actor)].colliders()[0]],
        config: &w.characters[&actor].config,
    }
    .resolve(rp::Vector::ZERO, rp::Vector::ZERO);
    assert!(
        out.translation.y > 0.8,
        "translation={:?} stop={:?} checks={}",
        out.translation,
        out.stop,
        out.contact_checks
    );
    assert!(out.stop.is_none());
    assert_eq!(out.failures + out.contact_failures, 0);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}
