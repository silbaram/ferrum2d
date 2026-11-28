use super::*;
fn pose(x: f32, y: f32) -> Pose {
    Pose {
        position: [x, y, 0.0],
        ..Pose::default()
    }
}
fn setup() -> (PhysicsWorld3d, BodyId) {
    setup_space(Space::Spatial)
}
fn setup_space(space: Space) -> (PhysicsWorld3d, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
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
            step_height: 0.0,
            ..CharacterConfig::default()
        },
    )
    .unwrap();
    (w, a)
}
fn wall(w: &mut PhysicsWorld3d, kind: BodyKind, x: f32) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: pose(x, 0.0),
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.25, 2.0, 5.0],
        }),
    )
    .unwrap()
}
#[test]
fn commanded_wall_stops_when_its_capsule_reaches_a_fixed_wall() {
    for (space, kind) in [Space::Spatial, Space::PlanarXy]
        .into_iter()
        .flat_map(|space| {
            [BodyKind::KinematicPosition, BodyKind::KinematicVelocity].map(|kind| (space, kind))
        })
    {
        let (mut w, a) = setup_space(space);
        wall(&mut w, BodyKind::Fixed, -1.0);
        let moving = wall(&mut w, kind, 3.0);
        if kind == BodyKind::KinematicPosition {
            w.set_kinematic_target(moving, pose(-3.0, 0.0)).unwrap();
        } else {
            w.set_velocity(moving, [-60.0, 0.0, 0.0], [0.0; 3]).unwrap();
        }
        w.step();
        let x = w.body_state(a).unwrap().pose.position[0];
        let wall_x = w.body_state(moving).unwrap().pose.position[0];
        assert!(
            x == 0. && wall_x == 3.,
            "{space:?} {kind:?}: {x} {wall_x} {:?} {:?}",
            w.body_state(a).unwrap(),
            w.character_state(a).unwrap()
        );
        assert!(w.body_state(a).unwrap().pose.position[1].abs() < 0.001);
        assert_eq!(w.body_state(moving).unwrap().linear_velocity, [0.0; 3]);
        let stats = w.step_statistics();
        assert_eq!(stats.kinematic_character_stops, 1);
        assert_eq!(stats.kinematic_path_stops, 1);
        assert!(w.character_state(a).unwrap().moving_obstacle_contact_checks > 0);
        assert_eq!(
            w.character_state(a).unwrap().failed_moving_obstacle_casts,
            0
        );
        if space == Space::PlanarXy {
            assert_eq!(w.body_state(a).unwrap().pose.position[2], 0.0);
            assert_eq!(w.character_state(a).unwrap().translation[2], 0.0);
        }
        assert!(
            !w.character_state(a)
                .unwrap()
                .moving_obstacle_iteration_limit
        );
    }
}
#[test]
fn two_incoming_commanded_walls_stop_together_around_a_capsule() {
    let (mut w, a) = setup();
    let left = wall(&mut w, BodyKind::KinematicPosition, -3.0);
    let right = wall(&mut w, BodyKind::KinematicPosition, 3.0);
    w.set_kinematic_target(left, pose(3.0, 0.0)).unwrap();
    w.set_kinematic_target(right, pose(-3.0, 0.0)).unwrap();
    w.step();
    let x = w.body_state(a).unwrap().pose.position[0];
    let l = w.body_state(left).unwrap().pose.position[0];
    let r = w.body_state(right).unwrap().pose.position[0];
    // Each blocked command keeps its start pose, including simultaneous walls.
    assert_eq!([x, l, r], [0., -3., 3.]);
    assert_eq!(w.step_statistics().kinematic_path_stops, 2);
}
#[test]
fn commanded_elevator_stops_below_a_ceiling_and_keeps_its_rider_grounded() {
    let (mut w, a) = setup();
    w.set_pose(a, pose(0.0, 0.51)).unwrap();
    let p = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(0.0, -0.1),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [5.0, 0.1, 5.0],
            }),
        )
        .unwrap();
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: pose(0.0, 2.25),
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [5.0, 0.25, 5.0],
        }),
    )
    .unwrap();
    w.step();
    assert!(w.character_state(a).unwrap().grounded);
    w.set_kinematic_target(p, pose(0.0, 2.0)).unwrap();
    w.step();
    let top = w.body_state(p).unwrap().pose.position[1] + 0.1;
    let y = w.body_state(a).unwrap().pose.position[1];
    // The whole carrier and rider stop at their pre-tick poses under the ceiling.
    assert_eq!(top, 0.);
    assert!((y - top - 0.51).abs() < 0.005, "{top} {y}");
    assert_eq!(w.step_statistics().kinematic_path_stops, 1);
    assert!(w.character_state(a).unwrap().grounded);
}

#[test]
fn a_stopped_command_is_consumed_and_a_new_command_resumes_after_obstacle_removal() {
    for velocity in [false, true] {
        let (mut w, a) = setup();
        let fixed = wall(&mut w, BodyKind::Fixed, -1.0);
        let moving = wall(
            &mut w,
            if velocity {
                BodyKind::KinematicVelocity
            } else {
                BodyKind::KinematicPosition
            },
            3.0,
        );
        let command = |w: &mut PhysicsWorld3d| {
            if velocity {
                w.set_velocity(moving, [-60.0, 0.0, 0.0], [0.0; 3]).unwrap();
            } else {
                w.set_kinematic_target(moving, pose(-3.0, 0.0)).unwrap();
            }
        };
        command(&mut w);
        w.step();
        let stopped = w.body_state(moving).unwrap().pose;
        assert_eq!(w.step_statistics().kinematic_character_stops, 1);
        w.step();
        assert_eq!(w.body_state(moving).unwrap().pose, stopped);
        assert_eq!(w.step_statistics().kinematic_character_stops, 0);
        command(&mut w);
        w.step();
        assert!(
            (w.body_state(moving).unwrap().pose.position[0] - stopped.position[0]).abs() < 0.001
        );
        assert_eq!(w.step_statistics().kinematic_character_stops, 1);
        // Skin rounding may leave one tiny, positive interval before contact.
        assert!(w.step_statistics().backend_steps <= 2);
        w.remove_body(fixed).unwrap();
        command(&mut w);
        w.step();
        assert!(w.body_state(moving).unwrap().pose.position[0] < -2.9);
        assert!(w.body_state(a).unwrap().pose.position[0] < -3.4);
        assert_eq!(w.step_statistics().kinematic_character_stops, 0);
    }
}

#[test]
fn squeeze_substeps_preserve_force_targets_and_original_motion_time() {
    let (mut w, _) = setup();
    wall(&mut w, BodyKind::Fixed, -1.0);
    let moving = wall(&mut w, BodyKind::KinematicPosition, 3.0);
    let free = w
        .create_body(
            BodyDesc {
                pose: pose(0.0, 100.0),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap();
    let other = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(0.0, 200.0),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap();
    w.add_force(free, [10.0, 0.0, 0.0], [0.0; 3]).unwrap();
    w.set_kinematic_target(other, pose(5.0, 200.0)).unwrap();
    w.set_kinematic_target(moving, pose(-3.0, 0.0)).unwrap();
    w.force_character_motion_proof();
    w.set_step_motion_enabled(true);
    w.step();
    assert!((w.body_state(free).unwrap().linear_velocity[0] - 1.0).abs() < 1e-5);
    assert_eq!(w.body_state(other).unwrap().pose.position[0], 5.0);
    assert_eq!(w.step_statistics().backend_steps, 2);
    let mut hits = Vec::new();
    w.sweep_step_motion(
        &Shape::Sphere { radius: 0.1 },
        pose(2.0, 0.0),
        [0.0; 3],
        &QueryFilter::default(),
        &mut hits,
        16,
    )
    .unwrap();
    let hit = hits.iter().find(|h| h.target.body == moving).unwrap();
    assert!((hit.fraction - 0.65 / 6.0).abs() < 0.0001, "{hit:?}");
}

#[test]
fn more_than_sixteen_independent_external_commands_can_stop_in_one_tick() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    let mut movers = Vec::new();
    for i in 0..20 {
        let y = i as f32 * 10.0;
        let a = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose(0.0, y),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        w.enable_character(a, CharacterConfig::default()).unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: pose(-1.0, y),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 2.0, 5.0],
            }),
        )
        .unwrap();
        let m = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose(3.0 + i as f32 * 0.1, y),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.25, 2.0, 5.0],
                }),
            )
            .unwrap();
        w.set_kinematic_target(m, pose(-3.0, y)).unwrap();
        movers.push((a, m));
    }
    w.step();
    assert_eq!(w.step_statistics().kinematic_character_stops, 20);
    for (i, (a, m)) in movers.into_iter().enumerate() {
        assert!(
            (w.body_state(m).unwrap().pose.position[0] - (3. + i as f32 * 0.1)).abs() < 0.005,
            "{a:?} {:?} {:?}",
            w.body_state(m).unwrap(),
            w.character_state(a).unwrap()
        );
        assert_eq!(w.body_state(a).unwrap().pose.position[0], 0.);
        assert!(
            !w.character_state(a)
                .unwrap()
                .moving_obstacle_iteration_limit
        );
    }
}

#[test]
fn contact_planes_find_three_axis_motion_and_detect_incompatible_constraints() {
    use super::character_constraints::{project, Plane};
    use rapier3d::prelude::Vector;
    let s = std::f32::consts::FRAC_1_SQRT_2;
    let a = Vector::new(s, s, 0.0);
    let b = Vector::new(-s, s, 0.0);
    let mut planes = vec![
        Plane {
            normal: a,
            offset: 1.0,
        },
        Plane {
            normal: b,
            offset: 2.0,
        },
        Plane {
            normal: Vector::Z,
            offset: 3.0,
        },
    ];
    let expected = a + b * 2.0 + Vector::Z * 3.0;
    assert!((project(Vector::ZERO, &planes).unwrap() - expected).length() < 1e-5);
    planes.push(Plane {
        normal: -a,
        offset: -0.5,
    });
    assert!(project(Vector::ZERO, &planes).is_none());
}

#[test]
fn near_parallel_contacts_do_not_create_an_unbounded_escape_along_planar_locks() {
    use super::character_constraints::{project, Plane};
    use rapier3d::prelude::Vector;
    let planes = [
        Plane {
            normal: Vector::new(-1.0, 0.00001, 0.0),
            offset: 6.0,
        },
        Plane {
            normal: Vector::X,
            offset: 0.0,
        },
        Plane {
            normal: Vector::Z,
            offset: 0.0,
        },
        Plane {
            normal: -Vector::Z,
            offset: 0.0,
        },
    ];
    assert!(project(Vector::ZERO, &planes).is_none());
}

#[test]
fn squeeze_events_preserve_unrelated_jump_input_and_full_tick_translation() {
    let (mut w, _) = setup();
    wall(&mut w, BodyKind::Fixed, -1.0);
    let moving = wall(&mut w, BodyKind::KinematicPosition, 3.0);
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: pose(100.0, -0.1),
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [5.0, 0.1, 5.0],
        }),
    )
    .unwrap();
    let jumper = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(100.0, 0.51),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    w.enable_character(jumper, CharacterConfig::default())
        .unwrap();
    w.step();
    assert!(w.character_state(jumper).unwrap().grounded);
    w.set_character_input(
        jumper,
        CharacterInput {
            velocity: [2.0, 0.0, 0.0],
            jump_speed: 3.0,
        },
    )
    .unwrap();
    w.set_kinematic_target(moving, pose(-3.0, 0.0)).unwrap();
    w.step();
    assert_eq!(w.step_statistics().kinematic_path_stops, 1);
    let p = w.body_state(jumper).unwrap().pose.position;
    let s = w.character_state(jumper).unwrap();
    assert!(
        (p[0] - 100.2).abs() < 0.0001 && (p[1] - 0.81).abs() < 0.0001,
        "{p:?}"
    );
    assert!(
        (s.translation[0] - 0.2).abs() < 0.0001 && (s.translation[1] - 0.3).abs() < 0.0001,
        "{s:?}"
    );
    assert!((s.velocity[0] - 2.0).abs() < 0.0001 && (s.velocity[1] - 3.0).abs() < 0.0001);
}
