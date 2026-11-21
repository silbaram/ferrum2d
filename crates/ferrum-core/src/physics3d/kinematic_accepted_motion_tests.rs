use super::world::native_id;
use super::*;
use rapier3d::prelude as rp;

fn world(dt: f32) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: dt,
        ..Default::default()
    })
    .unwrap()
}
fn pose(position: [f32; 3]) -> Pose {
    Pose {
        position,
        ..Default::default()
    }
}
fn bar(w: &mut PhysicsWorld3d, omega: f32, damping: f32) -> BodyId {
    w.create_body(
        BodyDesc {
            kind: BodyKind::KinematicVelocity,
            angular_velocity: [0., 0., omega],
            angular_damping: damping,
            can_sleep: false,
            ..Default::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [2., 0.025, 0.1],
        }),
    )
    .unwrap()
}
fn actor(w: &mut PhysicsWorld3d, p: [f32; 3]) -> BodyId {
    let a = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(p),
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    w.enable_character(
        a,
        CharacterConfig {
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    a
}
fn unrelated_joint(w: &mut PhysicsWorld3d) {
    let ids = [BodyKind::Fixed, BodyKind::Dynamic].map(|kind| {
        w.create_body(
            BodyDesc {
                kind,
                pose: pose([100., 0., 0.]),
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        )
        .unwrap()
    });
    w.create_joint(JointDesc::new(ids[0], ids[1], JointKind::Fixed))
        .unwrap();
}
#[test]
fn kinematic_accepted_public_high_omega_does_not_push_outside_accepted_arc() {
    let mut w = world(0.1);
    let b = bar(&mut w, 40., 0.);
    let a = actor(&mut w, [-0.83, 1.82, 0.]);
    let saved = w.capture_snapshot().unwrap();
    w.step();
    let state = w.character_state(a).unwrap();
    assert!(!state.blocked_by_moving_obstacle, "{state:?}");
    assert_eq!(w.body_state(a).unwrap().pose.position[0], -0.83);
    let first = w.body_state(b).unwrap();
    let actor_first = w.body_state(a).unwrap();
    assert!(first.angular_velocity[2] < 8.);
    let stats = w.step_statistics();
    w.restore_snapshot(&saved).unwrap();
    w.step();
    assert_eq!(w.body_state(b).unwrap(), first);
    assert_eq!(w.body_state(a).unwrap(), actor_first);
    assert_eq!(w.step_statistics(), stats);
    for _ in 0..6 {
        w.step();
        assert!(w
            .body_state(a)
            .unwrap()
            .pose
            .position
            .into_iter()
            .all(f32::is_finite));
    }
}
#[test]
fn kinematic_accepted_joint_pass_schedule_keeps_real_collision() {
    for joint in [false, true] {
        let mut w = world(0.1);
        let b = bar(&mut w, 40., 0.);
        let a = actor(&mut w, [-0.83, 1.82, 0.]);
        if joint {
            unrelated_joint(&mut w);
        }
        let (params, passes) = w.kinematic_prediction_schedule();
        let (expected_bar_pose, _) =
            w.backend.bodies[native_id(b)].predict_kinematic_motion(&params, passes);
        w.step_checked().unwrap();
        assert_eq!(
            w.actual_motion_completed_time(),
            f64::from(w.config().step_seconds)
        );
        let state = w.character_state(a).unwrap();
        assert_eq!(
            state.blocked_by_moving_obstacle, joint,
            "joint={joint} {state:?}"
        );
        assert_eq!(w.step_statistics().backend_steps, if joint { 4 } else { 1 });
        assert_eq!(w.step_statistics().kinematic_character_stops, 0);
        assert_eq!(w.step_statistics().character_preview_obstacle_failures, 0);
        assert_eq!(
            *w.backend.bodies[native_id(b)].position(),
            expected_bar_pose
        );
        let actor_x = w.body_state(a).unwrap().pose.position[0];
        if joint {
            assert!(
                actor_x < -0.83,
                "the rotating bar must push the character: {actor_x}"
            );
        } else {
            assert_eq!(actor_x, -0.83);
        }
        assert!(w.body_state(b).unwrap().pose.rotation[2] > if joint { 0.9 } else { 0.3 });
    }
}
#[test]
fn kinematic_accepted_predicts_actual_com_endpoints_and_pass_damping() {
    for joint in [false, true] {
        for dt in [0.1, 0.037, 0.001] {
            for damping in [0., 7.] {
                for sign in [-1., 1.] {
                    let mut w = world(dt);
                    let b = bar(&mut w, sign * 40., damping);
                    w.add_collider(
                        b,
                        ColliderDesc {
                            pose: pose([1.3, 0.4, -0.2]),
                            density: 20.,
                            ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
                        },
                    )
                    .unwrap();
                    w.set_velocity(b, [0.3, -0.2, 0.1], [0., 0., sign * 40.])
                        .unwrap();
                    if joint {
                        unrelated_joint(&mut w);
                    }
                    let schedule = w.kinematic_prediction_schedule();
                    let body = &w.backend.bodies[native_id(b)];
                    let (next, angle) = body.predict_kinematic_motion(&schedule.0, schedule.1);
                    assert_eq!(angle.z.signum(), sign);
                    let before = w.capture_snapshot().unwrap();
                    w.step();
                    let actual = w.backend.bodies[native_id(b)].position();
                    assert_eq!(*actual, next, "joint={joint} dt={dt} damping={damping}");
                    w.restore_snapshot(&before).unwrap();
                    w.step();
                    assert_eq!(*w.backend.bodies[native_id(b)].position(), next);
                }
            }
        }
    }
}
#[test]
fn kinematic_accepted_zero_angular_preserves_raw_motion_bitwise() {
    for joint in [false, true] {
        for kind in [BodyKind::KinematicVelocity, BodyKind::KinematicPosition] {
            let mut w = world(0.1);
            let b = w
                .create_body(
                    BodyDesc {
                        kind,
                        linear_velocity: [1.2, -0.3, 0.7],
                        ..Default::default()
                    },
                    ColliderDesc {
                        pose: pose([1., 0.2, 0.]),
                        ..ColliderDesc::new(Shape::Box {
                            half_extents: [1., 0.2, 0.1],
                        })
                    },
                )
                .unwrap();
            if kind == BodyKind::KinematicPosition {
                w.set_kinematic_target(
                    b,
                    Pose {
                        position: [0.5, 0.2, -0.1],
                        rotation: [0., 0., 0.38268343, 0.9238795],
                    },
                )
                .unwrap();
            }
            if joint {
                unrelated_joint(&mut w);
            }
            let body = &w.backend.bodies[native_id(b)];
            let c = &w.backend.colliders[body.colliders()[0]];
            let raw = super::kinematic_motion::collider_motion(body, c, 0.1);
            let accepted = super::kinematic_motion::accepted_collider_motion(
                body,
                c,
                0.1,
                &w.kinematic_prediction_schedule(),
            );
            assert_eq!(raw.start, accepted.start);
            assert_eq!(raw.local_center, accepted.local_center);
            assert_eq!(raw.linvel, accepted.linvel);
            assert_eq!(raw.angvel, accepted.angvel);
            for t in [0., 0.1, 0.5, 1.] {
                assert_eq!(raw.position_at_time(t), accepted.position_at_time(t));
            }
        }
    }
}
#[test]
fn kinematic_accepted_recomputes_current_event_interval_not_scaled_old_cap() {
    let mut w = world(0.1);
    let b = bar(&mut w, 40., 0.);
    let body = &w.backend.bodies[native_id(b)];
    let s = w.kinematic_prediction_schedule();
    let long = body.predict_kinematic_motion(&s.0, s.1);
    w.backend.integration_parameters.dt = 0.025;
    let s = w.kinematic_prediction_schedule();
    let short = w.backend.bodies[native_id(b)].predict_kinematic_motion(&s.0, s.1);
    // Both intervals still exceed the backend cap. Reusing 1/4 of the old
    // displacement would disagree with the next actual backend call.
    assert_eq!(short.1, long.1);
    w.step();
    assert_eq!(*w.backend.bodies[native_id(b)].position(), short.0);
}
#[test]
fn kinematic_accepted_winding_and_pose_projection_are_not_authored_input_mutation() {
    let mut w = world(0.1);
    let b = bar(&mut w, 40., 0.);
    let saved = w.capture_snapshot().unwrap();
    let body = &w.backend.bodies[native_id(b)];
    let c = &w.backend.colliders[body.colliders()[0]];
    let raw = super::kinematic_motion::collider_motion(body, c, 0.1);
    assert_eq!(raw.angvel, rp::Vector::new(0., 0., 4.));
    let s = w.kinematic_prediction_schedule();
    let accepted = super::kinematic_motion::accepted_collider_motion(body, c, 0.1, &s);
    assert!(accepted.angvel.z < 0.8);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        saved.encoded_bytes()
    );
    assert_eq!(w.body_state(b).unwrap().angular_velocity, [0., 0., 40.]);
}

#[test]
fn kinematic_accepted_rotating_ground_carry_uses_actual_endpoint() {
    for omega in [-40., 40.] {
        let mut w = world(0.1);
        let platform = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicVelocity,
                    pose: pose([0., -0.1, 0.]),
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [3., 0.1, 3.],
                }),
            )
            .unwrap();
        let a = actor(&mut w, [2., 0.51, 0.]);
        w.step_checked().unwrap();
        assert!(w.character_state(a).unwrap().grounded);
        w.set_velocity(platform, [0.; 3], [0., omega, 0.]).unwrap();
        let next = w.backend.bodies[native_id(platform)]
            .predict_kinematic_motion(&w.kinematic_prediction_schedule().0, 1)
            .0;
        let local = w.backend.bodies[native_id(platform)].position().inverse()
            * rp::Vector::from(w.body_state(a).unwrap().pose.position);
        let expected = next * local;
        w.step_checked().unwrap();
        let actual = w.body_state(a).unwrap().pose.position;
        assert!(
            (actual[0] - expected.x).abs() < 0.001,
            "{actual:?} {expected:?}"
        );
        assert!(
            (actual[2] - expected.z).abs() < 0.001,
            "{actual:?} {expected:?}"
        );
        assert_eq!(w.character_state(a).unwrap().carried_by, Some(platform));
    }
}
#[test]
fn kinematic_accepted_event_knots_recompute_actual_remaining_schedule() {
    let mut w = world(0.1);
    let b = bar(&mut w, 40., 0.);
    let a = actor(&mut w, [-0.83, 1.82, 0.]);
    let remote = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose([100., 0., 0.]),
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        )
        .unwrap();
    let saved = w.capture_snapshot().unwrap();
    let path = KinematicPath {
        body: remote,
        sweep_sensors: false,
        knots: vec![(0.5, pose([100., 0.1, 0.])), (1., pose([100., 0., 0.]))],
    };
    w.step_with_kinematic_paths(std::slice::from_ref(&path))
        .unwrap();
    let state = w.character_state(a).unwrap();
    assert!(!state.blocked_by_moving_obstacle, "{state:?}");
    assert_eq!(w.body_state(a).unwrap().pose.position[0], -0.83);
    let after = w.body_state(b).unwrap();
    assert!(
        after.pose.rotation[2] > 0.7 && after.pose.rotation[2] < 0.71,
        "{after:?}"
    );
    assert_eq!(w.step_statistics().backend_steps, 2);
    let state = state.clone();
    w.restore_snapshot(&saved).unwrap();
    w.step_with_kinematic_paths(&[path]).unwrap();
    assert_eq!(w.body_state(b).unwrap(), after);
    assert_eq!(w.character_state(a).unwrap(), &state);
}
