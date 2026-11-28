use super::*;

fn world() -> PhysicsWorld3d {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    world.set_step_motion_enabled(true);
    world
}

fn target(world: &mut PhysicsWorld3d, position: [f32; 3], velocity: [f32; 3]) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position,
                    ..Pose::default()
                },
                linear_velocity: velocity,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap()
}

fn sweep(world: &PhysicsWorld3d, translation: [f32; 3]) -> Vec<SweepHit> {
    let mut hits = Vec::new();
    world
        .sweep_step_motion(
            &Shape::Sphere { radius: 0.5 },
            Pose::default(),
            translation,
            &QueryFilter::default(),
            &mut hits,
            100,
        )
        .unwrap();
    hits
}

#[test]
fn moving_target_hits_stationary_query_at_actual_time_and_world_witness() {
    let mut world = world();
    let target = target(&mut world, [3.0, 0.0, 0.0], [-360.0, 0.0, 0.0]);
    world.step();
    let hits = sweep(&world, [0.0; 3]);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].target.body, target);
    assert!((hits[0].fraction - 1.0 / 3.0).abs() < 1e-4, "{hits:?}");
    assert!((hits[0].point[0] - 0.5).abs() < 1e-4, "{hits:?}");
    assert!((hits[0].normal[0] + 1.0).abs() < 1e-4);
    assert!(!hits[0].initial_overlap);
}

#[test]
fn co_moving_separation_and_initial_overlap_are_distinct() {
    let mut world = world();
    let separated = target(&mut world, [3.0, 0.0, 0.0], [360.0, 0.0, 0.0]);
    let overlap = target(&mut world, [0.75, 0.0, 0.0], [360.0, 0.0, 0.0]);
    world.step();
    let hits = sweep(&world, [6.0, 0.0, 0.0]);
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert_eq!(hits[0].target.body, overlap);
    assert_ne!(hits[0].target.body, separated);
    assert!(hits[0].initial_overlap);
    assert_eq!(hits[0].fraction, 0.0);
}

#[test]
fn motion_snapshot_does_not_follow_post_step_clamps_or_consume_next_inputs() {
    let mut world = world();
    let body = target(&mut world, [3.0, 0.0, 0.0], [-360.0, 0.0, 0.0]);
    world.step();
    let before = sweep(&world, [0.0; 3]);
    world
        .set_pose(
            body,
            Pose {
                position: [100.0, 0.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
    world
        .set_velocity(body, [60.0, 0.0, 0.0], [0.0; 3])
        .unwrap();
    assert_eq!(sweep(&world, [0.0; 3]), before);
    // An ordinary current-pose query must see the edit, not the swept target BVH.
    assert!(world
        .sweep(
            &Shape::Sphere { radius: 0.5 },
            Pose::default(),
            [6.0, 0.0, 0.0],
            &QueryFilter::default()
        )
        .unwrap()
        .is_none());
    world.step();
    assert!((world.body_state(body).unwrap().pose.position[0] - 101.0).abs() < 1e-5);
    assert!(sweep(&world, [0.0; 3]).is_empty());
}

#[test]
fn captured_motion_filters_generations_and_rebuilds_after_empty_ticks() {
    let mut world = world();
    let body = target(&mut world, [3.0, 0.0, 0.0], [-360.0, 0.0, 0.0]);
    world.step();
    assert_eq!(sweep(&world, [0.0; 3]).len(), 1);
    world.remove_body(body).unwrap();
    let replacement = target(&mut world, [100.0, 0.0, 0.0], [0.0; 3]);
    assert_ne!(body, replacement);
    assert!(sweep(&world, [0.0; 3]).is_empty());
    world.clear();
    world.step();
    assert!(sweep(&world, [0.0; 3]).is_empty());
    target(&mut world, [3.0, 0.0, 0.0], [-360.0, 0.0, 0.0]);
    world.step();
    assert_eq!(sweep(&world, [0.0; 3]).len(), 1);
}

#[test]
fn rotating_offset_fixture_uses_body_pivot_and_intermediate_bounds() {
    let mut world = world();
    // Use the ordinary captured start/end arc for an offset target.
    let half_angle = std::f32::consts::FRAC_PI_8;
    let body = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    rotation: [0.0, 0.0, -half_angle.sin(), half_angle.cos()],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                pose: Pose {
                    position: [3.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
            },
        )
        .unwrap();
    // Equal opposite fixtures keep the body's true center of mass at its origin.
    // A lone offset sphere rotates about its own mass center and traces a chord.
    world
        .add_collider(
            body,
            ColliderDesc {
                pose: Pose {
                    position: [-3.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
            },
        )
        .unwrap();
    world
        .set_kinematic_target(
            body,
            Pose {
                rotation: [0.0, 0.0, half_angle.sin(), half_angle.cos()],
                ..Pose::default()
            },
        )
        .unwrap();
    world.step_checked().unwrap();
    let mut hits = Vec::new();
    world
        .sweep_step_motion(
            &Shape::Sphere { radius: 0.2 },
            Pose {
                position: [3.0, 0.0, 0.0],
                ..Pose::default()
            },
            [0.0; 3],
            &QueryFilter::default(),
            &mut hits,
            100,
        )
        .unwrap();
    assert_eq!(hits.len(), 1, "offset fixture must follow the body arc");
    // At first contact the arc center is one combined radius from the query.
    let start_angle = 2. * half_angle;
    let contact_angle = 2. * (0.4_f32 / 6.).asin();
    let end = world.body_state(body).unwrap().pose;
    let rotation = super::world::native_pose(end).rotation.to_scaled_axis().z;
    let expected = (start_angle - contact_angle) / (start_angle + rotation);
    assert!(
        (hits[0].fraction - expected).abs() < 0.0005,
        "{hits:?}; expected {expected}"
    );
    let point = hits[0].point;
    assert!(
        ((point[0] - 3.0).hypot(point[1]) - 0.2).abs() < 0.002,
        "{hits:?}"
    );
}

#[test]
fn joint_pass_motion_is_deduplicated_before_nearest_hit_limit() {
    let mut world = world();
    let first = target(&mut world, [3.0, 0.0, 0.0], [-360.0, 0.0, 0.0]);
    let second = target(&mut world, [4.0, 0.0, 0.0], [-360.0, 0.0, 0.0]);
    let anchor = world
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::Fixed,
            ..BodyDesc::default()
        })
        .unwrap();
    let dynamic = world
        .create_body_without_collider(BodyDesc::default())
        .unwrap();
    let mut joint = JointDesc::new(anchor, dynamic, JointKind::Fixed);
    joint.enabled = false;
    world.create_joint(joint).unwrap();
    world.step();
    assert!(world.step_statistics().backend_steps > 1);
    let hits = sweep(&world, [0.0; 3]);
    assert_eq!(hits.len(), 2, "{hits:?}");
    assert_eq!(hits[0].target.body, first);
    assert_eq!(hits[1].target.body, second);
    assert!((hits[0].fraction - 1.0 / 3.0).abs() < 1e-4, "{hits:?}");
    let mut limited = Vec::new();
    assert!(world
        .sweep_step_motion(
            &Shape::Sphere { radius: 0.5 },
            Pose::default(),
            [0.0; 3],
            &QueryFilter::default(),
            &mut limited,
            1
        )
        .unwrap());
    assert_eq!(limited, hits[..1]);
}

#[test]
fn moving_candidates_preserve_masks_sensor_exclusion_and_query_validation() {
    let mut world = world();
    let body = target(&mut world, [3.0, 0.0, 0.0], [-360.0, 0.0, 0.0]);
    let collider = world.collider_ids(body).unwrap().next().unwrap();
    world
        .update_collider(
            collider,
            ColliderDesc {
                sensor: true,
                category: 2,
                mask: 4,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
            },
        )
        .unwrap();
    world.step();
    let mut hits = Vec::new();
    let mut filter = QueryFilter {
        category: 4,
        mask: 2,
        ..QueryFilter::default()
    };
    for (sensors, category, count) in [(false, 4, 0), (true, 1, 0), (true, 4, 1)] {
        filter.include_sensors = sensors;
        filter.category = category;
        world
            .sweep_step_motion(
                &Shape::Sphere { radius: 0.5 },
                Pose::default(),
                [0.0; 3],
                &filter,
                &mut hits,
                100,
            )
            .unwrap();
        assert_eq!(hits.len(), count);
    }
    let expected = hits.clone();
    assert_eq!(
        world.sweep_step_motion(
            &Shape::Sphere { radius: 0.5 },
            Pose::default(),
            [f32::NAN, 0.0, 0.0],
            &filter,
            &mut hits,
            100
        ),
        Err(PhysicsError::InvalidQuery)
    );
    assert_eq!(hits, expected);
    filter.exclude_body = Some(body);
    world
        .sweep_step_motion(
            &Shape::Sphere { radius: 0.5 },
            Pose::default(),
            [0.0; 3],
            &filter,
            &mut hits,
            100,
        )
        .unwrap();
    assert!(hits.is_empty());
}

#[test]
fn motion_capture_preserves_solver_state_forces_and_pending_kinematic_targets() {
    let mut worlds: Vec<_> = [false, true]
        .into_iter()
        .map(|capture| {
            let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
            world.set_step_motion_enabled(capture);
            world
                .create_body(
                    BodyDesc {
                        kind: BodyKind::Fixed,
                        pose: Pose {
                            position: [0.0, -0.5, 0.0],
                            ..Pose::default()
                        },
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Box {
                        half_extents: [10.0, 0.5, 10.0],
                    }),
                )
                .unwrap();
            let falling = world
                .create_body(
                    BodyDesc {
                        pose: Pose {
                            position: [0.0, 2.0, 0.0],
                            ..Pose::default()
                        },
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
                )
                .unwrap();
            world.add_force(falling, [0.1, 0.0, 0.0], [0.0; 3]).unwrap();
            let kinematic = world
                .create_body(
                    BodyDesc {
                        kind: BodyKind::KinematicPosition,
                        pose: Pose {
                            position: [20.0, 0.0, 0.0],
                            ..Pose::default()
                        },
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
                )
                .unwrap();
            (world, falling, kinematic)
        })
        .collect();
    for tick in 0..120 {
        let states: Vec<_> = worlds
            .iter_mut()
            .map(|(world, falling, kinematic)| {
                world
                    .set_kinematic_target(
                        *kinematic,
                        Pose {
                            position: [20.0 + tick as f32 * 0.01, 0.0, 0.0],
                            ..Pose::default()
                        },
                    )
                    .unwrap();
                world.step();
                [
                    world.body_state(*falling).unwrap(),
                    world.body_state(*kinematic).unwrap(),
                ]
            })
            .collect();
        let _ = sweep(&worlds[1].0, [5.0, 0.0, 0.0]);
        assert_eq!(states[0], states[1], "tick {tick}");
        assert_eq!(worlds[0].0.step_statistics(), worlds[1].0.step_statistics());
    }
}

#[test]
fn solver_motion_records_a_full_turn_instead_of_only_equivalent_end_rotations() {
    let mut world = world();
    world.force_character_motion_proof();
    let body = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                angular_velocity: [0.0, 0.0, 480.0],
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [3.0, 0.1, 0.1],
            }),
        )
        .unwrap();
    // Backend opt-in isolates winding from the normal 45-degree safety cap.
    world
        .backend
        .bodies
        .get_mut(super::world::native_id(body))
        .unwrap()
        .set_allow_fast_rotation(true);
    world.step();
    let mut hits = Vec::new();
    world
        .sweep_step_motion(
            &Shape::Sphere { radius: 0.1 },
            Pose {
                position: [0.0, 2.5, 0.0],
                ..Pose::default()
            },
            [0.0; 3],
            &QueryFilter::default(),
            &mut hits,
            100,
        )
        .unwrap();
    assert_eq!(
        hits.len(),
        1,
        "full-turn target crossed the query even though its end shape matches its start"
    );
    assert!((0.2..0.25).contains(&hits[0].fraction), "{hits:?}");
}

#[test]
fn solver_motion_records_reversal_within_one_backend_pass() {
    let mut world = world();
    world.force_character_motion_proof();
    world
        .set_runtime_settings(
            [-14400.0, 0.0, 0.0],
            SolverSettings {
                continuous: false,
                ..SolverSettings::default()
            },
        )
        .unwrap();
    let body = world
        .create_body(
            BodyDesc {
                linear_velocity: [120.0, 0.0, 0.0],
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.05 }),
        )
        .unwrap();
    world.step();
    assert!(world.body_state(body).unwrap().pose.position[0] < 0.0);
    let mut hits = Vec::new();
    world
        .sweep_step_motion(
            &Shape::Sphere { radius: 0.025 },
            Pose {
                position: [0.25, 0.0, 0.0],
                ..Pose::default()
            },
            [0.0; 3],
            &QueryFilter::default(),
            &mut hits,
            100,
        )
        .unwrap();
    assert_eq!(
        hits.len(),
        1,
        "the first solver substep moves right before gravity reverses it"
    );
    assert!((0.15..0.2).contains(&hits[0].fraction), "{hits:?}");
}

#[test]
fn solver_motion_uses_accepted_ccd_path_even_when_diagnostics_overflow() {
    for ccd_passes in [1, 4] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.0; 3],
            max_events: 1,
            ..WorldConfig::default()
        })
        .unwrap();
        world.force_character_motion_proof();
        world.set_step_motion_enabled(true);
        world.backend.integration_parameters.max_ccd_substeps = ccd_passes;
        world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    category: 1,
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [0.1, 10.0, 10.0],
                    })
                },
            )
            .unwrap();
        let mut bodies = Vec::new();
        for y in [-2.0, 0.0, 2.0] {
            bodies.push(
                world
                    .create_body(
                        BodyDesc {
                            pose: Pose {
                                position: [3.0, y, 0.0],
                                ..Pose::default()
                            },
                            linear_velocity: [-600.0, 0.0, 0.0],
                            ccd: true,
                            ..BodyDesc::default()
                        },
                        ColliderDesc {
                            category: 2,
                            ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
                        },
                    )
                    .unwrap(),
            );
        }
        world.step();
        assert!(world.step_statistics().ccd_clamps > 1);
        assert!(world.step_statistics().ccd_clamps_dropped > 0);
        for (body, y) in bodies.into_iter().zip([-2.0, 0.0, 2.0]) {
            assert!(world.body_state(body).unwrap().pose.position[0] > 0.0);
            let mut hits = Vec::new();
            for (x, expected) in [(-2.0, 0), (1.5, 1)] {
                world
                    .sweep_step_motion(
                        &Shape::Sphere { radius: 0.1 },
                        Pose {
                            position: [x, y, 0.0],
                            ..Pose::default()
                        },
                        [0.0; 3],
                        &QueryFilter {
                            mask: 2,
                            ..QueryFilter::default()
                        },
                        &mut hits,
                        100,
                    )
                    .unwrap();
                assert_eq!(
                    hits.len(),
                    expected,
                    "ccd passes={ccd_passes}, x={x}, y={y}: {hits:?}"
                );
                if let Some(hit) = hits.first() {
                    assert_eq!(hit.target.body, body);
                    // 0.9 units to first contact at the retained 400 units/s cap.
                    // Spreading only the accepted displacement over the whole tick
                    // would incorrectly report about 0.375 instead of 0.135.
                    assert!((hit.fraction - 0.135).abs() < 0.005, "{hits:?}");
                }
            }
        }
    }
}
