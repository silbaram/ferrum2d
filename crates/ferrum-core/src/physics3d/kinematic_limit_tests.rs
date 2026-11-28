use super::*;
fn pose(x: f32, y: f32) -> Pose {
    Pose {
        position: [x, y, 0.0],
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
fn body(w: &mut PhysicsWorld3d, kind: BodyKind, x: f32, y: f32) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: pose(x, y),
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.5; 3],
        }),
    )
    .unwrap()
}
fn step(w: &mut PhysicsWorld3d, b: BodyId, to: Pose) {
    w.step_with_kinematic_paths(&[KinematicPath {
        sweep_sensors: false,
        body: b,
        knots: vec![(1.0, to)],
    }])
    .unwrap();
}
#[test]
fn blocked_path_does_not_shorten_the_other_bodies_tick() {
    let mut w = world();
    let p = body(&mut w, BodyKind::KinematicPosition, 0.0, 0.0);
    body(&mut w, BodyKind::Fixed, 3.0, 0.0);
    let free = body(&mut w, BodyKind::Dynamic, 0.0, 10.0);
    let other = body(&mut w, BodyKind::KinematicPosition, 0.0, 20.0);
    w.add_force(free, [10.0, 0.0, 0.0], [0.0; 3]).unwrap();
    w.set_kinematic_target(other, pose(5.0, 20.0)).unwrap();
    step(&mut w, p, pose(10.0, 0.0));
    assert_eq!(w.body_state(p).unwrap().pose, pose(0., 0.));
    assert_eq!(w.kinematic_path_progress(p), (0., true));
    assert_eq!(w.step_statistics().kinematic_path_stops, 1);
    assert_eq!(w.step_statistics().backend_steps, 1);
    assert_eq!(
        w.actual_motion_completed_time(),
        f64::from(w.config().step_seconds)
    );
    assert!((w.body_state(free).unwrap().linear_velocity[0] - 1.0).abs() < 1e-5);
    assert_eq!(w.body_state(other).unwrap().pose.position[0], 5.0);
    w.step_checked().unwrap();
    assert!((w.body_state(free).unwrap().linear_velocity[0] - 2.0).abs() < 1e-5);
    assert_eq!(w.body_state(other).unwrap().pose.position[0], 5.0);
}
#[test]
fn path_filters_ignore_sensors_disabled_bodies_masks_and_other_planar_floors() {
    for mode in 0..4 {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let p = body(&mut w, BodyKind::KinematicPosition, 0.0, 0.0);
        let wall = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: pose(3.0, 0.0),
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    sensor: mode == 0,
                    mask: if mode == 2 { 0 } else { u32::MAX },
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [0.5; 3],
                    })
                },
            )
            .unwrap();
        if mode == 1 {
            w.set_body_options(
                wall,
                &BodyOptions {
                    kind: BodyKind::Fixed,
                    enabled: false,
                    ..BodyOptions::default()
                },
            )
            .unwrap();
        }
        if mode == 3 {
            w.set_planar_collision_span(
                p,
                Some(PlanarCollisionSpan {
                    floor: 0,
                    elevation: 0.0,
                    height: 1.0,
                }),
            )
            .unwrap();
            w.set_planar_collision_span(
                wall,
                Some(PlanarCollisionSpan {
                    floor: 1,
                    elevation: 0.0,
                    height: 1.0,
                }),
            )
            .unwrap();
        }
        step(&mut w, p, pose(10.0, 0.0));
        assert_eq!(
            w.body_state(p).unwrap().pose.position[0],
            10.0,
            "mode {mode}"
        );
        assert_eq!(w.step_statistics().kinematic_path_stops, 0);
    }
}
#[test]
fn touching_paths_can_separate_and_slide_but_cannot_move_into_a_wall() {
    for target in [pose(-1.0, 0.0), pose(0.0, 1.0), pose(1.0, 0.0)] {
        let mut w = world();
        let p = body(&mut w, BodyKind::KinematicPosition, 0.0, 0.0);
        body(&mut w, BodyKind::Fixed, 1.0, 0.0);
        step(&mut w, p, target);
        let actual = w.body_state(p).unwrap().pose;
        if target.position[0] > 0.0 {
            assert_eq!(actual, Pose::default());
            assert!(w.kinematic_path_progress(p).1);
        } else {
            assert_eq!(actual, target);
            assert!(!w.kinematic_path_progress(p).1);
        }
    }
}
fn rotating_bar_fixture(fast: bool) -> (PhysicsWorld3d, BodyId, BodyId, Pose) {
    let mut w = world();
    let p = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2.0, 0.1, 0.1],
            }),
        )
        .unwrap();
    let obstacle = body(&mut w, BodyKind::Fixed, 0.0, 1.6);
    let handle = super::world::native_id(p);
    assert!(!w.backend.bodies[handle].is_fast_rotation_allowed());
    if fast {
        w.backend.bodies[handle].set_allow_fast_rotation(true);
    }
    let to = Pose {
        rotation: [
            0.0,
            0.0,
            std::f32::consts::FRAC_1_SQRT_2,
            std::f32::consts::FRAC_1_SQRT_2,
        ],
        ..Pose::default()
    };
    (w, p, obstacle, to)
}

fn original_bar_obstacle_gap(w: &PhysicsWorld3d, bar: BodyId, obstacle: BodyId) -> f32 {
    let collider = |id| {
        let body = &w.backend.bodies[super::world::native_id(id)];
        &w.backend.colliders[body.colliders()[0]]
    };
    let a = collider(bar);
    let b = collider(obstacle);
    let mut work = super::solver_trajectory::Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    };
    let fixed = |pose| super::solver_trajectory::ShapeMotion {
        curve: super::solver_trajectory::Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rapier3d::prelude::Vector::ZERO,
        local_pose: rapier3d::prelude::Pose::IDENTITY,
    };
    let mut minimum = f32::INFINITY;
    super::solver_trajectory::contacts_full_shapes(
        fixed(*a.position()),
        a.shape(),
        fixed(*b.position()),
        b.shape(),
        0.,
        10.,
        &mut work,
        &mut |contact, _, _, _| {
            minimum = minimum.min(contact.dist);
            Ok(())
        },
    )
    .unwrap();
    assert!(
        minimum.is_finite(),
        "the two original boxes produce a finite full-shape contact query"
    );
    minimum
}

#[test]
fn rotation_cast_stops_a_bar_before_its_tip_crosses_an_obstacle() {
    // Exercise the commanded quarter-turn as continuous Native motion. The
    // default full-step pi/4 cap is covered independently below; it must not
    // replace this test's unchanged pre-tip collision fraction expectation.
    let (mut w, p, obstacle, to) = rotating_bar_fixture(true);
    step(&mut w, p, to);
    let progress = w.kinematic_path_progress(p);
    assert!(progress == (0., true), "{progress:?}");
    assert_eq!(w.step_statistics().kinematic_path_failures, 0);
    assert!(original_bar_obstacle_gap(&w, p, obstacle) >= 0.);
    assert_eq!(
        w.actual_motion_completed_time(),
        f64::from(w.config.step_seconds)
    );
}

#[test]
fn capped_position_path_retains_native_cap_and_rejects_only_the_actual_target_projection() {
    let (mut native, reference, _, target) = rotating_bar_fixture(false);
    native.set_kinematic_target(reference, target).unwrap();
    native.step_checked().unwrap();
    let expected_cap = std::f32::consts::FRAC_PI_4 * (1. / native.config.step_seconds);
    assert_eq!(
        native.body_state(reference).unwrap().angular_velocity[2].to_bits(),
        expected_cap.to_bits()
    );
    assert_eq!(native.body_state(reference).unwrap().pose, target);

    let (mut limited, bar, obstacle, target) = rotating_bar_fixture(false);
    step(&mut limited, bar, target);
    let (fraction, stopped) = limited.kinematic_path_progress_precise(bar);
    assert!(stopped && fraction == 0., "{fraction:?}/{stopped}");
    assert_eq!(limited.step_statistics().kinematic_path_failures, 0);
    assert_eq!(
        limited.actual_motion_completed_time(),
        f64::from(limited.config.step_seconds)
    );
    assert!(original_bar_obstacle_gap(&limited, bar, obstacle) >= 0.);
    assert_ne!(
        limited.body_state(bar).unwrap().pose.rotation,
        target.rotation
    );
    assert!(!limited.backend.bodies[super::world::native_id(bar)].is_fast_rotation_allowed());
}
#[test]
fn zero_thickness_surface_mesh_stops_at_a_mesh_wall() {
    let mut w = world();
    let floor = Shape::TriangleMesh {
        vertices: vec![
            [-0.5, 0.0, -0.5],
            [0.5, 0.0, -0.5],
            [0.5, 0.0, 0.5],
            [-0.5, 0.0, 0.5],
        ],
        triangles: vec![[0, 1, 2], [0, 2, 3]],
    };
    let wall = Shape::TriangleMesh {
        vertices: vec![
            [0.0, -1.0, -1.0],
            [0.0, 1.0, -1.0],
            [0.0, 1.0, 1.0],
            [0.0, -1.0, 1.0],
        ],
        triangles: vec![[0, 1, 2], [0, 2, 3]],
    };
    let p = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(floor),
        )
        .unwrap();
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: pose(3.0, 0.0),
            ..BodyDesc::default()
        },
        ColliderDesc::new(wall),
    )
    .unwrap();
    step(&mut w, p, pose(10.0, 0.0));
    assert_eq!(w.body_state(p).unwrap().pose.position[0], 0.);
    assert_eq!(w.kinematic_path_progress(p), (0., true));
    assert_eq!(w.step_statistics().kinematic_path_failures, 0);
}

#[test]
fn path_slices_consume_character_jump_impulse_and_dynamic_push_once() {
    fn setup() -> (PhysicsWorld3d, BodyId, BodyId, BodyId, BodyId) {
        let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        let floor = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose(0.0, -0.1),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [20.0, 0.1, 20.0],
                }),
            )
            .unwrap();
        let actor = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose(0.0, 0.51),
                    ..BodyDesc::default()
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
                push_mass: 10.0,
                step_height: 0.0,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
        let dynamic = w
            .create_body(
                BodyDesc {
                    pose: pose(0.78, 0.5),
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    friction: 0.,
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [0.5; 3],
                    })
                },
            )
            .unwrap();
        // This rider has unobstructed motion and receives a one-shot jump and impulse.
        let witness = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose(-10.0, 0.51),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        w.enable_character(
            witness,
            CharacterConfig {
                push_mass: 10.0,
                step_height: 0.0,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
        for _ in 0..5 {
            w.step();
        }
        (w, floor, actor, dynamic, witness)
    }
    let (mut w, floor, actor, dynamic, witness) = setup();
    assert!(w.character_state(witness).unwrap().grounded);
    let dt = w.config().step_seconds;
    let gravity = w.config().gravity[1];
    w.set_character_input(
        actor,
        CharacterInput {
            velocity: [10., 0., 0.],
            ..CharacterInput::default()
        },
    )
    .unwrap();
    w.set_character_input(
        witness,
        CharacterInput {
            jump_speed: 4.,
            ..CharacterInput::default()
        },
    )
    .unwrap();
    w.apply_character_impulse(witness, [0., 20., 5.]).unwrap();
    let path = KinematicPath {
        body: floor,
        sweep_sensors: false,
        knots: vec![
            (0.25, pose(0., -0.1)),
            (0.5, pose(0., -0.1)),
            (1., pose(0., -0.1)),
        ],
    };
    w.step_with_kinematic_paths(std::slice::from_ref(&path))
        .unwrap();
    assert_eq!(w.step_statistics().backend_steps, 3);
    let state = w.character_state(witness).unwrap();
    assert!(!state.grounded);
    assert!(
        (state.vertical_speed - (6. + gravity * dt)).abs() < 1e-5,
        "{state:?}"
    );
    let runtime = &w.characters[&witness];
    assert_eq!(runtime.pending_impulse, [0.; 3]);
    assert_eq!(runtime.external_velocity[2], 0.5);
    assert!((w.body_state(witness).unwrap().pose.position[2] - 0.5 * dt).abs() < 1e-5);
    let dynamic_velocity = w.body_state(dynamic).unwrap().linear_velocity[0];
    assert!(
        dynamic_velocity > 0.,
        "the character must actually push the box"
    );
    let reaction = w.characters[&actor].external_velocity[0];
    assert!((-10. ..0.).contains(&reaction), "reaction={reaction}");
    // The box and the stored reaction use the same total horizontal impulse.
    let mass = w.backend.bodies[super::world::native_id(dynamic)].mass();
    assert!(
        (mass * dynamic_velocity + 10. * reaction).abs() < 0.01,
        "box vx={dynamic_velocity}, box mass={mass}, reaction={reaction}"
    );
    let mut landed = false;
    for _ in 0..120 {
        w.step_with_kinematic_paths(std::slice::from_ref(&path))
            .unwrap();
        let state = w.character_state(witness).unwrap();
        assert!(
            !landed || state.grounded,
            "the consumed jump must not relaunch the witness"
        );
        landed |= state.grounded;
        assert_eq!(w.characters[&witness].external_velocity[2], 0.5);
    }
    assert!(landed);
}

#[test]
fn path_one_way_policy_passes_from_below_and_stops_from_above() {
    for upward in [true, false] {
        let mut w = world();
        let p = body(
            &mut w,
            BodyKind::KinematicPosition,
            0.0,
            if upward { -3.0 } else { 3.0 },
        );
        let platform = body(&mut w, BodyKind::Fixed, 0.0, 0.0);
        let collider = w.collider_ids(platform).unwrap().next().unwrap();
        w.set_terrain_one_way(
            collider,
            Some(TerrainOneWay {
                point: [0.0, 0.5, 0.0],
                normal: [0.0, 1.0, 0.0],
            }),
        )
        .unwrap();
        step(&mut w, p, pose(0.0, if upward { 3.0 } else { -3.0 }));
        let y = w.body_state(p).unwrap().pose.position[1];
        if upward {
            assert_eq!(y, 3.0);
        } else {
            assert_eq!(y, 3.);
            assert_eq!(w.kinematic_path_progress(p), (0., true));
        }
    }
}

#[test]
fn preview_pair_work_counts_each_query_once_and_is_separate_from_ccd() {
    let mut w = world();
    w.force_character_motion_proof();
    let p = body(&mut w, BodyKind::KinematicPosition, 0.0, -10.0);
    let mut actors = Vec::new();
    for (x, velocity) in [(-1.0, 10.0), (1.0, -10.0)] {
        let a = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose(x, 0.0),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        w.enable_character(a, CharacterConfig::default()).unwrap();
        w.set_character_input(
            a,
            CharacterInput {
                velocity: [velocity, 0.0, 0.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
        actors.push(a);
    }
    step(&mut w, p, pose(0.0, -10.0));
    let s = w.step_statistics();
    let actual: usize = actors
        .iter()
        .map(|&a| w.character_state(a).unwrap().character_pair_casts)
        .sum();
    assert!(actual > 0);
    assert_eq!(s.character_preview_pair_casts as usize, actual / 2);
    assert_eq!(s.character_preview_passes, 1);
    assert_eq!(s.ccd_prediction_checks, 0);
    assert_eq!(s.ccd_clamp_checks, 0);
}
