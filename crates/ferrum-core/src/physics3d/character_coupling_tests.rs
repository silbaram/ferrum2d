use super::*;
fn pose(x: f32) -> Pose {
    Pose {
        position: [x, 0.0, 0.0],
        ..Pose::default()
    }
}
fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap()
}
fn actor(w: &mut PhysicsWorld3d, x: f32) -> BodyId {
    let id = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(x),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    w.enable_character(
        id,
        CharacterConfig {
            step_height: 0.0,
            ..CharacterConfig::default()
        },
    )
    .unwrap();
    id
}
fn wall(w: &mut PhysicsWorld3d, x: f32, kind: BodyKind) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: pose(x),
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.25, 2.0, 5.0],
        }),
    )
    .unwrap()
}
fn x(w: &PhysicsWorld3d, id: BodyId) -> f32 {
    w.body_state(id).unwrap().pose.position[0]
}

#[track_caller]
fn step_report_checked(w: &mut PhysicsWorld3d, control: &str) {
    let expected_seconds = f64::from(w.backend.integration_parameters.dt);
    let result = w.step_checked();
    eprintln!(
        "C23_COUPLING_STEP case={:?} control={control} result={result:?} completed={} expected={expected_seconds} statistics={:?}",
        std::thread::current().name(),
        w.actual_motion_completed_time(),
        w.step_statistics(),
    );
    w.diagnostic_actual_motion(control);
    assert_eq!(
        result,
        Ok(()),
        "{control}: rejected character coupling tick"
    );
    assert_eq!(
        w.actual_motion_completed_time(),
        expected_seconds,
        "{control}: character coupling did not commit the full original tick",
    );
}

#[test]
fn incoming_wall_push_propagates_to_another_capsule_with_free_space() {
    let mut w = world();
    let a = actor(&mut w, 0.0);
    let b = actor(&mut w, -1.0);
    let p = wall(&mut w, 3.0, BodyKind::KinematicPosition);
    w.set_kinematic_target(p, pose(-3.0)).unwrap();
    step_report_checked(&mut w, "incoming position wall");
    let points = [x(&w, b), x(&w, a), x(&w, p)];
    assert!(
        (points[2] + 3.0).abs() < 0.001
            && (points[1] + 3.51).abs() < 0.02
            && (points[0] + 4.02).abs() < 0.02,
        "{points:?}"
    );
    assert_eq!(w.step_statistics().kinematic_character_stops, 0);
}
#[test]
fn capsule_chain_transmits_fixed_wall_obstruction_back_to_the_prescribed_pusher() {
    for count in [2, 8] {
        let mut w = world();
        let chars: Vec<_> = (0..count).map(|i| actor(&mut w, -(i as f32))).collect();
        let left = -(count as f32 + 1.0);
        wall(&mut w, left, BodyKind::Fixed);
        let p = wall(&mut w, 3.0, BodyKind::KinematicPosition);
        w.set_kinematic_target(p, pose(-12.0)).unwrap();
        w.step();
        let positions: Vec<_> = chars.iter().map(|&id| x(&w, id)).collect();
        assert_eq!(
            w.step_statistics().kinematic_character_stops,
            1,
            "{positions:?}; p={}",
            x(&w, p)
        );
        for pair in positions.windows(2) {
            assert!(pair[0] - pair[1] >= 0.499, "{positions:?}");
        }
        assert!(positions[count - 1] >= left + 0.499, "{positions:?}");
        assert!(
            (positions[count - 1] - left - 0.51).abs() < 0.02,
            "{positions:?}"
        );
        assert!(
            x(&w, p) - positions[0] >= 0.499,
            "{positions:?}; p={}",
            x(&w, p)
        );
    }
}

#[test]
fn free_capsule_chain_is_pushed_without_a_false_squeeze_stop() {
    for count in [8, 16, 32] {
        let mut w = world();
        let chars: Vec<_> = (0..count).map(|i| actor(&mut w, -(i as f32))).collect();
        let p = wall(&mut w, 3.0, BodyKind::KinematicPosition);
        let target = -(count as f32 + 3.0);
        w.set_kinematic_target(p, pose(target)).unwrap();
        let tick_seconds = f64::from(w.backend.integration_parameters.dt);
        assert_eq!(w.step_checked(), Ok(()), "count={count}");
        assert_eq!(
            w.actual_motion_completed_time(),
            tick_seconds,
            "count={count}"
        );
        assert_eq!(
            w.step_statistics().kinematic_character_stops,
            0,
            "count={count}, p={}",
            x(&w, p)
        );
        for (i, a) in chars.into_iter().enumerate() {
            let expected = target - 0.51 * (i as f32 + 1.0);
            assert!(
                (x(&w, a) - expected).abs() < 0.02,
                "count={count}, i={i}: {} expected {expected}",
                x(&w, a)
            );
            assert!(
                !w.character_state(a)
                    .unwrap()
                    .character_coupling_iteration_limit
            );
        }
    }
}

#[test]
fn coupled_push_preserves_tangential_input_and_planar_locks() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.0; 3],
            step_seconds: 0.1,
            ..WorldConfig::default()
        })
        .unwrap();
        let a = actor(&mut w, 0.0);
        let b = actor(&mut w, -1.0);
        if space == Space::Spatial {
            for id in [a, b] {
                w.set_character_input(
                    id,
                    CharacterInput {
                        velocity: [0.0, 0.0, 2.0],
                        ..CharacterInput::default()
                    },
                )
                .unwrap();
            }
        }
        let p = wall(&mut w, 3.0, BodyKind::KinematicVelocity);
        w.set_velocity(p, [-60.0, 0.0, 0.0], [0.0; 3]).unwrap();
        step_report_checked(&mut w, &format!("tangent/planar {space:?}"));
        assert!((x(&w, a) + 3.51).abs() < 0.02 && (x(&w, b) + 4.02).abs() < 0.02);
        for id in [a, b] {
            let z = w.body_state(id).unwrap().pose.position[2];
            if space == Space::Spatial {
                assert!((z - 0.2).abs() < 0.001);
            } else {
                assert_eq!(z, 0.0);
            }
        }
    }
}

#[test]
fn oblique_wall_normals_push_a_capsule_pair_in_the_actual_world_direction() {
    use rapier3d::prelude::{Rotation, Vector};
    for angle in [0.3, 1.1, 1.57] {
        let rot = Rotation::from_rotation_y(angle);
        let at = |x| Pose {
            position: (rot * Vector::new(x, 0.0, 0.0)).to_array(),
            rotation: rot.to_array(),
        };
        let mut w = world();
        let a = actor(&mut w, 0.0);
        let b = actor(&mut w, -1.0);
        w.set_pose(a, at(0.0)).unwrap();
        w.set_pose(b, at(-1.0)).unwrap();
        let p = wall(&mut w, 3.0, BodyKind::KinematicPosition);
        w.set_pose(p, at(3.0)).unwrap();
        w.set_kinematic_target(p, at(-3.0)).unwrap();
        step_report_checked(&mut w, &format!("oblique {angle}"));
        for (id, expected) in [(a, -3.51), (b, -4.02)] {
            let local = rot.inverse() * Vector::from(w.body_state(id).unwrap().pose.position);
            assert!(
                (local.x - expected).abs() < 0.02 && local.y.abs() < 0.001 && local.z.abs() < 0.001,
                "{angle}: {local:?}"
            );
        }
        assert_eq!(w.step_statistics().kinematic_character_stops, 0);
    }
}

#[test]
fn a_distant_fast_obstacle_does_not_loosen_local_capsule_contact_tolerance() {
    let mut w = world();
    let a = actor(&mut w, 0.0);
    let b = actor(&mut w, 0.51);
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [0.01, 0.0, 0.0],
            ..CharacterInput::default()
        },
    )
    .unwrap();
    w.set_character_input(
        b,
        CharacterInput {
            velocity: [-0.01, 0.0, 0.0],
            ..CharacterInput::default()
        },
    )
    .unwrap();
    let distant = wall(&mut w, 0.0, BodyKind::KinematicVelocity);
    w.set_pose(
        distant,
        Pose {
            position: [0.0, 1000.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    w.set_velocity(distant, [100000.0, 0.0, 0.0], [0.0; 3])
        .unwrap();
    for _ in 0..20 {
        w.step();
        assert!(x(&w, b) - x(&w, a) >= 0.499, "{} {}", x(&w, a), x(&w, b));
    }
}

#[test]
fn pair_contacts_reduce_reported_carry_to_the_accepted_motion() {
    let mut w = world();
    let a = actor(&mut w, -1.0);
    let b = actor(&mut w, 0.0);
    for (id, x) in [(a, -1.0), (b, 0.0)] {
        w.set_pose(
            id,
            Pose {
                position: [x, 0.51, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
    }
    let p = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0.0, -0.1, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [5.0, 0.1, 5.0],
            }),
        )
        .unwrap();
    wall(&mut w, 1.0, BodyKind::Fixed);
    step_report_checked(&mut w, "accepted carry pair warmup");
    assert!(w.character_state(a).unwrap().grounded && w.character_state(b).unwrap().grounded);
    let inputs = [
        w.characters[&a].input_velocity(),
        w.characters[&b].input_velocity(),
    ];
    w.set_kinematic_target(
        p,
        Pose {
            position: [2.0, -0.1, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    step_report_checked(&mut w, "accepted carry pair move");
    assert!((x(&w, p) - 2.0).abs() < 0.001);
    assert!(
        (x(&w, a) + 0.02).abs() < 0.02 && (x(&w, b) - 0.49).abs() < 0.02,
        "{} {}",
        x(&w, a),
        x(&w, b)
    );
    for id in [a, b] {
        let s = w.character_state(id).unwrap();
        assert!(
            s.carry_translation[0] > 0.0 && s.carry_translation[0] <= s.translation[0] + 0.001,
            "{s:?}"
        );
        assert!(s.grounded);
    }
    let snapshot = w.capture_snapshot().unwrap();
    let restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    assert_eq!(
        restored.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );
    assert_eq!(
        [
            w.characters[&a].input_velocity(),
            w.characters[&b].input_velocity()
        ],
        inputs
    );
    let mut impulses = Vec::new();
    w.contact_impulses(&mut impulses);
    assert!(impulses.iter().all(|v| v.normal_impulse == 0.));
    step_report_checked(&mut w, "accepted carry stopped support");
    for id in [a, b] {
        assert_eq!(w.character_state(id).unwrap().carry_translation, [0.0; 3]);
    }

    let before_reverse = [x(&w, a), x(&w, b)];
    let mut target = w.body_state(p).unwrap().pose;
    target.position[0] -= 0.5;
    w.set_kinematic_target(p, target).unwrap();
    step_report_checked(&mut w, "carry away from the wall");
    for (id, before) in [a, b].into_iter().zip(before_reverse) {
        let state = w.character_state(id).unwrap();
        assert_eq!(state.ground.unwrap().body, p);
        assert!((x(&w, id) - before + 0.5).abs() < 0.001);
        assert!((state.carry_translation[0] + 0.5).abs() < 0.001);
    }
}

#[test]
fn excluded_capsule_pairs_do_not_transmit_pushes_or_consume_pair_query_work() {
    let mut w = world();
    let a = actor(&mut w, 0.0);
    let b = actor(&mut w, -1.0);
    for (id, category) in [(a, 1), (b, 2)] {
        let collider = w.collider_ids(id).unwrap().next().unwrap();
        let mut desc = ColliderDesc::new(Shape::Capsule {
            half_height: 0.25,
            radius: 0.25,
        });
        desc.category = category;
        desc.mask = 4;
        w.update_collider(collider, desc).unwrap();
    }
    let mut desc = ColliderDesc::new(Shape::Box {
        half_extents: [0.25, 2.0, 5.0],
    });
    desc.category = 4;
    let p = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(3.0),
                ..BodyDesc::default()
            },
            desc,
        )
        .unwrap();
    w.set_kinematic_target(p, pose(-3.0)).unwrap();
    step_report_checked(&mut w, "excluded character pair");
    for id in [a, b] {
        assert!((x(&w, id) + 3.51).abs() < 0.02);
        let s = w.character_state(id).unwrap();
        assert!(!s.blocked_by_character);
        assert_eq!(s.character_pair_casts, 0);
        assert_eq!(s.character_pair_contact_checks, 0);
    }
    assert_eq!(w.step_statistics().kinematic_character_stops, 0);
}

#[test]
fn a_disabled_controller_does_not_push_an_enabled_character() {
    let mut w = world();
    let a = actor(&mut w, 0.0);
    let b = actor(&mut w, -1.0);
    w.disable_character(a).unwrap();
    w.set_body_options(
        a,
        &BodyOptions {
            kind: BodyKind::KinematicPosition,
            enabled: false,
            ..BodyOptions::default()
        },
    )
    .unwrap();
    w.enable_character(a, CharacterConfig::default()).unwrap();
    let p = wall(&mut w, 3.0, BodyKind::KinematicPosition);
    w.set_kinematic_target(p, pose(-3.0)).unwrap();
    w.step();
    assert_eq!(x(&w, a), 0.0);
    assert!((x(&w, b) + 3.51).abs() < 0.02, "{}", x(&w, b));
    assert_eq!(w.character_state(a).unwrap().translation, [0.0; 3]);
    assert_eq!(w.character_state(b).unwrap().character_pair_casts, 0);
}
