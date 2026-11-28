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
fn path_impact_preserves_true_hit_time_and_the_other_bodies_full_tick() {
    let mut w = world();
    let p = body(&mut w, BodyKind::KinematicPosition, 0.0, 0.0);
    body(&mut w, BodyKind::Fixed, 3.0, 0.0);
    let free = body(&mut w, BodyKind::Dynamic, 0.0, 10.0);
    let other = body(&mut w, BodyKind::KinematicPosition, 0.0, 20.0);
    w.add_force(free, [10.0, 0.0, 0.0], [0.0; 3]).unwrap();
    w.set_kinematic_target(other, pose(5.0, 20.0)).unwrap();
    w.set_step_motion_enabled(true);
    step(&mut w, p, pose(10.0, 0.0));
    assert!((w.body_state(p).unwrap().pose.position[0] - 2.0).abs() < 0.001);
    assert!((w.kinematic_path_progress(p).0 - 0.2).abs() < 0.001);
    assert_eq!(w.step_statistics().kinematic_path_stops, 1);
    // The actual path approves prefix + stopped suffix in one native call;
    // unrelated force kernels still cover the whole original nominal clock.
    assert_eq!(w.step_statistics().backend_steps, 1);
    let duration = f64::from(w.config().step_seconds);
    assert_eq!(w.actual_motion_completed_time(), duration);
    {
        let trace = w.events.2.lock().unwrap();
        assert_eq!(trace.precise_elapsed(), duration);
        let cadence = w.backend.integration_parameters.num_solver_iterations;
        let h = w.config().step_seconds / cadence as f32;
        let rows: Vec<_> = trace
            .actual
            .iter()
            .filter(|row| row.body == super::world::native_id(free))
            .collect();
        assert_eq!(rows.len(), cadence);
        for (i, row) in rows.iter().enumerate() {
            assert_eq!(row.start_time, duration * i as f64 / cadence as f64);
            assert_eq!(row.end_time, duration * (i + 1) as f64 / cadence as f64);
            let super::solver_trajectory::Curve::Integrated(kernel) = row.curve else {
                panic!("unrelated force uses original native kernels");
            };
            assert_eq!(kernel.native.integration_seconds.to_bits(), h.to_bits());
        }
    }
    assert_eq!(
        w.backend.bodies[super::world::native_id(free)]
            .user_force()
            .to_array(),
        [10., 0., 0.]
    );
    assert!((w.body_state(free).unwrap().linear_velocity[0] - 1.0).abs() < 1e-5);
    assert_eq!(w.body_state(other).unwrap().pose.position[0], 5.0);
    let mut hits = Vec::new();
    w.sweep_step_motion(
        &Shape::Sphere { radius: 0.1 },
        pose(1.0, 0.0),
        [0.0; 3],
        &QueryFilter::default(),
        &mut hits,
        32,
    )
    .unwrap();
    let hit = hits.iter().find(|h| h.target.body == p).unwrap();
    assert!((hit.fraction - 0.04).abs() < 1e-4, "{hit:?}");
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
    assert!(
        progress.1 && (0.4..0.9).contains(&progress.0),
        "{progress:?}"
    );
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
    assert!(
        stopped && fraction > 0.9 && fraction <= 1.,
        "{fraction:?}/{stopped}"
    );
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
    assert!((w.body_state(p).unwrap().pose.position[0] - 2.5).abs() < 0.002);
    assert_eq!(w.step_statistics().kinematic_path_failures, 0);
}

#[test]
fn controller_preview_preserves_jump_and_does_not_duplicate_dynamic_pushes() {
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
        let dynamic = body(&mut w, BodyKind::Dynamic, 1.0, 0.5);
        // Independent input witness: the other character still creates dynamic
        // TOI cuts, but this capsule has an unobstructed analytic trajectory.
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
    let (mut reference, _, a0, d0, witness0) = setup();
    let (mut paths, p1, a1, d1, witness1) = setup();
    let dt = paths.config().step_seconds;
    let gravity = paths.config().gravity[1];
    // The first horizontal impact closes the authored center gap, less the
    // box/capsule radii and character skin. Queue the independent impulse in
    // that tick so it must survive previews and multiple accepted intervals.
    let impulse_tick = ((1.0 - 0.5 - 0.25 - 0.01) / (2.0 * dt)).floor() as usize;
    let mut saw_split = false;
    let mut witness_landed = false;
    for tick in 0..180 {
        if tick == 0 || tick == 60 {
            let input = CharacterInput {
                velocity: [2.0, 0.0, 0.0],
                jump_speed: if tick == 60 { 4.0 } else { 0.0 },
            };
            reference.set_character_input(a0, input.clone()).unwrap();
            paths.set_character_input(a1, input).unwrap();
        }
        if tick == impulse_tick {
            reference
                .apply_character_impulse(witness0, [0., 0., 5.])
                .unwrap();
            paths
                .apply_character_impulse(witness1, [0., 0., 5.])
                .unwrap();
        }
        if tick == 60 {
            let input = CharacterInput {
                jump_speed: 4.,
                ..CharacterInput::default()
            };
            reference
                .set_character_input(witness0, input.clone())
                .unwrap();
            paths.set_character_input(witness1, input).unwrap();
            reference
                .apply_character_impulse(witness0, [0., 20., 0.])
                .unwrap();
            paths
                .apply_character_impulse(witness1, [0., 20., 0.])
                .unwrap();
        }
        reference.step();
        step(&mut paths, p1, pose(0.0, -0.1));
        assert_eq!(
            reference.body_state(a0).unwrap(),
            paths.body_state(a1).unwrap(),
            "actor tick {tick}"
        );
        assert_eq!(
            reference.body_state(d0).unwrap(),
            paths.body_state(d1).unwrap(),
            "push tick {tick}"
        );
        assert_eq!(
            reference.character_state(a0).unwrap(),
            paths.character_state(a1).unwrap()
        );
        let stats = paths.step_statistics();
        // This fixture has no joints or prescribed stop: each accepted TOI
        // interval has exactly one preview admission and one backend pass.
        assert_eq!(
            stats.character_preview_passes, stats.backend_steps,
            "tick {tick}: {stats:?}"
        );
        assert_eq!(
            stats.character_preview_passes,
            reference.step_statistics().character_preview_passes,
            "the inert path must not add preview intervals at tick {tick}"
        );
        assert!(stats.backend_steps > 0);
        assert_eq!(stats.kinematic_path_stops, 0);
        assert_eq!(stats.kinematic_character_stops, 0);
        saw_split |= stats.backend_steps > 1;
        if tick == impulse_tick {
            assert!(
                stats.backend_steps > 1,
                "the queued impulse must cross multiple accepted TOI intervals: {stats:?}"
            );
        }

        let witness = paths.body_state(witness1).unwrap();
        let state = paths.character_state(witness1).unwrap();
        assert_eq!(
            witness,
            reference.body_state(witness0).unwrap(),
            "witness tick {tick}"
        );
        assert_eq!(state, reference.character_state(witness0).unwrap());
        let runtime = &paths.characters[&witness1];
        assert_eq!(
            runtime.pending_impulse, [0.; 3],
            "accepted tick {tick} must consume the one-shot queue"
        );
        assert_eq!(runtime.external_velocity[2], if tick >= impulse_tick { 5. / 10. } else { 0. },
            "one impulse supplies J/m external velocity, independently of contact-clamped translation at tick {tick}");
        // The landing tick must retain the unobstructed tangent too. Across TOI
        // previews every accepted interval consumes exactly one fixed tick.
        assert!(
            (witness.pose.position[2] - 0.5 * dt * (tick + 1).saturating_sub(impulse_tick) as f32)
                .abs()
                < 1.0e-4,
            "queued impulse must be consumed once despite TOI previews: tick {tick}: {witness:?}"
        );
        if tick == 60 {
            assert!(
                !state.grounded,
                "the queued jump/impulse must reach an accepted step"
            );
        }
        if tick >= 60 {
            if !state.grounded {
                let expected = 4. + 20. / 10. + gravity * dt * (tick - 59) as f32;
                assert!(
                    !witness_landed,
                    "consumed jump/impulse relaunched the witness at tick {tick}"
                );
                assert!((state.vertical_speed - expected).abs() < 1.0e-4,
                    "one jump plus one impulse, with gravity over accepted time: tick {tick}: {state:?}");
            } else {
                witness_landed = true;
                assert_eq!(state.vertical_speed, 0.);
            }
        }
    }
    assert!(
        saw_split,
        "the regression must exercise multiple accepted TOI intervals"
    );
    assert!(
        witness_landed,
        "the witness must land so a queued jump replay is observable"
    );
    assert!(paths.body_state(d1).unwrap().pose.position[0] > 1.2);
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
            assert!((y - 1.0).abs() < 0.001, "{y}");
        }
    }
}

#[test]
fn preview_pair_work_counts_each_query_once_and_is_separate_from_ccd() {
    let mut w = world();
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
