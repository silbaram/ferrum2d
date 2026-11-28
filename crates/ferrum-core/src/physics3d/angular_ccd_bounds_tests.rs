use super::*;
fn pose(position: [f32; 3]) -> Pose {
    Pose {
        position,
        ..Default::default()
    }
}
fn bar(w: &mut PhysicsWorld3d, kind: BodyKind, z: f32, ccd: bool) -> BodyId {
    let angle = -std::f32::consts::FRAC_PI_8;
    let depth = if w.config.space == Space::PlanarXy {
        100.
    } else {
        0.1
    };
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: [0., 0., z],
                rotation: [0., 0., (angle * 0.5).sin(), (angle * 0.5).cos()],
            },
            angular_velocity: [0., 0., std::f32::consts::FRAC_PI_4 / 0.1],
            ccd,
            can_sleep: false,
            ..Default::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [2., 0.025, depth],
        }),
    )
    .unwrap()
}
fn target(w: &mut PhysicsWorld3d, p: [f32; 3]) {
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: pose(p),
            ..Default::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.015 }),
    )
    .unwrap();
}
fn world(events: usize) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        max_events: events,
        ..Default::default()
    })
    .unwrap()
}
#[test]
fn angular_ccd_public_mid_tip_regression() {
    for space in [Space::Spatial, Space::PlanarXy] {
        for bullet in [false, true] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                space,
                gravity: [0.; 3],
                step_seconds: 0.1,
                max_events: 16,
                ..Default::default()
            })
            .unwrap();
            let body = bar(&mut w, BodyKind::Dynamic, 0., bullet);
            target(&mut w, [1.99, 0., 0.]);
            w.step_checked().unwrap();
            assert_eq!(w.step_statistics().ccd_clamps, 1, "{space:?} {bullet}");
            assert_eq!(w.ccd_clamps()[0].moving.body, body);
            assert!(w.body_state(body).unwrap().pose.rotation[2] < 0.);
            assert_eq!(
                w.step_statistics().ccd_clamp_checks,
                1,
                "{space:?} {bullet}"
            );
        }
    }
}

#[test]
fn angular_ccd_public_three_shapes_offsets_and_compound_share_real_com_bounds() {
    for variant in 0..4 {
        let mut w = world(16);
        let angle = -std::f32::consts::FRAC_PI_8;
        let shape = match variant {
            0 => Shape::Box {
                half_extents: [2., 0.025, 0.1],
            },
            1 => Shape::Capsule {
                half_height: 1.85,
                radius: 0.15,
            },
            2 => Shape::Sphere { radius: 0.05 },
            _ => Shape::Compound {
                parts: vec![
                    ShapePart {
                        pose: pose([2., 0., 0.]),
                        shape: Shape::Sphere { radius: 0.05 },
                    },
                    ShapePart {
                        pose: Pose::default(),
                        shape: Shape::Sphere { radius: 0.25 },
                    },
                ],
            },
        };
        let body = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::Dynamic,
                    pose: Pose {
                        rotation: [0., 0., (angle * 0.5).sin(), (angle * 0.5).cos()],
                        ..Default::default()
                    },
                    angular_velocity: [0., 0., std::f32::consts::FRAC_PI_4 / 0.1],
                    ccd: true,
                    can_sleep: false,
                    ..Default::default()
                },
                ColliderDesc {
                    pose: if variant == 2 {
                        pose([2., 0., 0.])
                    } else {
                        Pose::default()
                    },
                    ..ColliderDesc::new(shape)
                },
            )
            .unwrap();
        if variant >= 2 {
            w.add_collider(
                body,
                ColliderDesc {
                    density: 1000.,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.25 })
                },
            )
            .unwrap();
        }
        target(
            &mut w,
            if variant == 1 {
                [0., 1.99, 0.]
            } else if variant >= 2 {
                [2.035, 0., 0.]
            } else {
                [1.99, 0., 0.]
            },
        );
        w.step();
        assert_eq!(
            w.step_statistics().ccd_clamps,
            1,
            "variant={variant} state={:?} stats={:?}",
            w.body_state(body),
            w.step_statistics()
        );
        assert!(w.step_statistics().ccd_clamp_checks > 0);
    }
}
#[test]
fn angular_ccd_rotating_capsule_and_hull_reach_intermediate_obstacles() {
    let hull = Shape::ConvexHull {
        points: [-2., 2.]
            .into_iter()
            .flat_map(|x| {
                [-0.025, 0.025]
                    .into_iter()
                    .flat_map(move |y| [-0.1, 0.1].map(|z| [x, y, z]))
            })
            .collect(),
    };
    let mut failures = Vec::new();
    for (moving, fixed, radial_axis) in [
        (
            Shape::Capsule {
                half_height: 1.85,
                radius: 0.15,
            },
            Shape::Box {
                half_extents: [0.015; 3],
            },
            1,
        ),
        (
            hull,
            Shape::Capsule {
                half_height: 0.012,
                radius: 0.015,
            },
            0,
        ),
    ] {
        for sign in [-1., 1.] {
            for translates in [false, true] {
                for hit in [true, false] {
                    let mut w = world(16);
                    let tangent = 1 - radial_axis;
                    let mut position = [0.; 3];
                    let mut velocity = [0.; 3];
                    if translates {
                        position[tangent] = -0.05;
                        velocity[tangent] = 1.;
                    }
                    let half_angle = -sign * std::f64::consts::FRAC_PI_8 * 0.5;
                    let body = w
                        .create_body(
                            BodyDesc {
                                kind: BodyKind::Dynamic,
                                pose: Pose {
                                    position,
                                    rotation: [
                                        0.,
                                        0.,
                                        half_angle.sin() as f32,
                                        half_angle.cos() as f32,
                                    ],
                                },
                                angular_velocity: [
                                    0.,
                                    0.,
                                    (sign * std::f64::consts::FRAC_PI_4
                                        / f64::from(w.config.step_seconds))
                                        as f32,
                                ],
                                linear_velocity: velocity,
                                ccd: true,
                                can_sleep: false,
                                ..Default::default()
                            },
                            ColliderDesc::new(moving.clone()),
                        )
                        .unwrap();
                    let mut target = [0.; 3];
                    target[radial_axis] = if hit { 1.99 } else { 2.021 };
                    w.create_body(
                        BodyDesc {
                            kind: BodyKind::Fixed,
                            pose: pose(target),
                            ..Default::default()
                        },
                        ColliderDesc::new(fixed.clone()),
                    )
                    .unwrap();
                    if let Err(err) = w.step_checked() {
                        failures.push((radial_axis, sign, translates, hit, err));
                        continue;
                    }
                    assert_eq!(w.step_statistics().ccd_clamps, u32::from(hit));
                    if hit {
                        assert_eq!(w.ccd_clamps()[0].moving.body, body);
                    }
                }
            }
        }
    }
    assert!(failures.is_empty(), "{failures:?}");
}
#[test]
fn angular_ccd_one_below_record_capacity_preserves_physics_counts_and_next_tick() {
    let fixture = |capacity| {
        let mut w = world(capacity);
        let a = bar(&mut w, BodyKind::Dynamic, 0., true);
        let b = bar(&mut w, BodyKind::Dynamic, 5., true);
        target(&mut w, [1.99, 0., 0.]);
        target(&mut w, [1.99, 0., 5.]);
        (w, [a, b])
    };
    let (mut exact, ids) = fixture(2);
    let (mut low, other) = fixture(1);
    exact.step_checked().unwrap();
    low.step_checked().unwrap();
    assert_eq!(exact.step_statistics().ccd_clamps, 2);
    assert_eq!(low.step_statistics().ccd_clamps, 2);
    assert_eq!(exact.ccd_clamps().len(), 2);
    assert_eq!(low.ccd_clamps().len(), 1);
    assert_eq!(low.step_statistics().ccd_clamps_dropped, 1);
    for tick in 2..=7 {
        exact
            .step_checked()
            .unwrap_or_else(|error| panic!("full observation capacity, tick {tick}: {error:?}"));
        low.step_checked()
            .unwrap_or_else(|error| panic!("one observation slot, tick {tick}: {error:?}"));
        for (i, j) in ids.into_iter().zip(other) {
            assert_eq!(exact.body_state(i).unwrap(), low.body_state(j).unwrap());
        }
    }
}
#[test]
fn angular_ccd_sdk_rotating_bars_complete_thirty_two_consecutive_ticks() {
    for levels in [&[0.][..], &[5.], &[0., 5.]] {
        let pairs = levels.len() as u32;
        let mut w = world(4096);
        for &z in levels {
            let body = bar(&mut w, BodyKind::Dynamic, z, true);
            // JS computes PI/(4*step) in F64, then writes the packed F32.
            let spin = (std::f64::consts::FRAC_PI_4 / f64::from(w.config.step_seconds)) as f32;
            w.set_velocity(body, [0.; 3], [0., 0., spin]).unwrap();
        }
        for &z in levels {
            target(&mut w, [1.99, 0., z]);
        }
        for tick in 1..=32 {
            w.step_checked()
                .unwrap_or_else(|error| panic!("SDK pairs at {levels:?}, tick {tick}: {error:?}"));
            assert!(w.step_statistics().backend_steps > 0);
            if tick == 1 {
                assert_eq!(w.step_statistics().ccd_clamps, pairs);
            }
        }
    }
}
#[test]
fn angular_ccd_force_damping_cap_and_pending_snapshot_replay_do_not_use_stale_prediction() {
    for passes in [1, 4] {
        let mut w = world(16);
        let id = bar(&mut w, BodyKind::Dynamic, 0., true);
        w.set_velocity(id, [0.; 3], [0., 0., 50.]).unwrap();
        // Private backend tier fixture: Core public settings select one CCD pass.
        w.backend.integration_parameters.max_ccd_substeps = passes;
        w.backend
            .bodies
            .get_mut(super::world::native_id(id))
            .unwrap()
            .set_angular_damping(30.);
        w.add_force(id, [0.; 3], [0., 0., 1.]).unwrap();
        target(&mut w, [1.99, 0., 0.]);
        let saved = w.capture_snapshot().unwrap();
        w.step();
        let state = w.body_state(id).unwrap();
        let stats = w.step_statistics();
        let clamps = w.ccd_clamps().to_vec();
        assert!(stats.ccd_clamps > 0, "passes={passes} {state:?} {stats:?}");
        assert!(state.angular_velocity[2].abs() <= std::f32::consts::FRAC_PI_4 / 0.1 + 1e-5);
        w.restore_snapshot(&saved).unwrap();
        w.step();
        assert_eq!(w.body_state(id).unwrap(), state);
        assert_eq!(w.step_statistics(), stats);
        assert_eq!(w.ccd_clamps(), clamps);
    }
}
#[test]
fn angular_ccd_position_kinematic_model_remains_outside_dynamic_ccd_origins() {
    let mut w = world(16);
    let id = bar(&mut w, BodyKind::KinematicPosition, 0., true);
    target(&mut w, [1.99, 0., 0.]);
    let angle = std::f32::consts::FRAC_PI_8;
    w.set_kinematic_target(
        id,
        Pose {
            rotation: [0., 0., (angle * 0.5).sin(), (angle * 0.5).cos()],
            ..Default::default()
        },
    )
    .unwrap();
    w.step();
    assert_eq!(w.step_statistics().ccd_clamps, 0);
    assert!(w.body_state(id).unwrap().pose.rotation[2] > 0.);
}

#[test]
fn angular_ccd_small_angle_long_offset_sparse_and_dense_candidate_cost() {
    for angle in [0.001, 0.01, 0.05] {
        for z in [0.0, 0.2] {
            let mut w = world(16);
            let start = -angle * 0.5;
            let body = w
                .create_body(
                    BodyDesc {
                        kind: BodyKind::Dynamic,
                        pose: Pose {
                            rotation: [0., 0., (start * 0.5_f32).sin(), (start * 0.5_f32).cos()],
                            ..Default::default()
                        },
                        angular_velocity: [0., 0., angle / 0.1],
                        ccd: true,
                        can_sleep: false,
                        ..Default::default()
                    },
                    ColliderDesc {
                        pose: pose([1000., 0., 0.]),
                        ..ColliderDesc::new(Shape::Box {
                            half_extents: [100., 0.02, 0.02],
                        })
                    },
                )
                .unwrap();
            w.add_collider(
                body,
                ColliderDesc {
                    density: 1000.,
                    ..ColliderDesc::new(Shape::Sphere { radius: 1. })
                },
            )
            .unwrap();
            let count = 500;
            for index in 0..count {
                target(
                    &mut w,
                    [
                        950. + (index % 100) as f32,
                        (index / 100) as f32 * 0.05 - 0.1,
                        z,
                    ],
                );
            }
            let result = w.step_checked();
            assert!(
                result.is_ok(),
                "angle={angle} z={z} first actual checked failure: {result:?}"
            );
            let stats = w.step_statistics();
            if z == 0.0 {
                assert_eq!(stats.ccd_clamps, 1);
                assert!(stats.ccd_clamp_checks > 0 && stats.ccd_clamp_checks <= count);
            } else {
                assert_eq!(stats.ccd_clamps, 0);
                assert_eq!(stats.ccd_clamp_checks, 0);
            }
            eprintln!("ANGULAR_PUBLIC_COST angle={angle} off_plane_z={z} targets={count} pair_checks={} clamps={} state={:?}",stats.ccd_clamp_checks,stats.ccd_clamps,w.body_state(body).unwrap().pose);
        }
    }
}
