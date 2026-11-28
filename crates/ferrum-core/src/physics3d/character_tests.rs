use super::*;

fn block(
    world: &mut PhysicsWorld3d,
    kind: BodyKind,
    position: [f32; 3],
    half_extents: [f32; 3],
) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position,
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box { half_extents }),
        )
        .unwrap()
}

fn floor(world: &mut PhysicsWorld3d) -> BodyId {
    block(world, BodyKind::Fixed, [0.0, -0.1, 0.0], [20.0, 0.1, 20.0])
}

fn actor(world: &mut PhysicsWorld3d, position: [f32; 3], config: CharacterConfig) -> BodyId {
    let body = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position,
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.4,
            }),
        )
        .unwrap();
    world.enable_character(body, config).unwrap();
    body
}

fn steps(world: &mut PhysicsWorld3d, count: usize) {
    for _ in 0..count {
        world.step();
    }
}

// These positive runtime controls must complete the nominal tick; unchanged
// positions after a rejected void step are not successful motion evidence.
fn checked_positive_steps(world: &mut PhysicsWorld3d, count: usize) {
    for tick in 0..count {
        let result = world.step_checked();
        assert!(result.is_ok(), "positive tick {tick}/{count}: {result:?}");
        assert_eq!(
            world.actual_motion_completed_time(),
            f64::from(world.config().step_seconds)
        );
    }
}

fn position(world: &PhysicsWorld3d, id: BodyId) -> [f32; 3] {
    world.body_state(id).unwrap().pose.position
}

#[test]
fn traversal_queries_leave_physics_state_and_one_shot_jump_untouched() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    let wall = block(&mut world, BodyKind::Fixed, [2., 2., 0.], [0.1, 2., 5.]);
    let body = actor(&mut world, [0., 2., 0.], CharacterConfig::default());
    steps(&mut world, 120);
    world
        .set_character_input(
            body,
            CharacterInput {
                jump_speed: 4.,
                ..CharacterInput::default()
            },
        )
        .unwrap();
    let pose = world.body_state(body).unwrap().pose;
    let state = world.character_state(body).unwrap().clone();
    let obstacle = world.body_state(wall).unwrap();
    let mut scratch = CharacterProbeScratch::default();
    for _ in 0..3 {
        let probe = world
            .probe_character_motion(body, pose, [10., 0., 0.], true, &mut scratch)
            .unwrap();
        assert!(probe.grounded && probe.ground.is_some());
        assert!(probe.pose.position[0] > 1.3 && probe.pose.position[0] < 1.51);
        assert_eq!(world.body_state(body).unwrap().pose, pose);
        assert_eq!(world.character_state(body).unwrap(), &state);
        assert_eq!(world.body_state(wall).unwrap(), obstacle);
    }
    world.step();
    assert!(world.character_state(body).unwrap().vertical_speed > 3.);
    assert!(position(&world, body)[1] > pose.position[1]);
}

#[test]
fn capsule_falls_settles_and_walks_on_the_same_rigid_body_backend() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let ground = floor(&mut world);
    let body = actor(&mut world, [0.0, 4.0, 0.0], CharacterConfig::default());
    steps(&mut world, 180);
    let state = world.character_state(body).unwrap();
    assert!(state.grounded, "{state:?}");
    assert_eq!(state.ground.unwrap().body, ground);
    assert!((position(&world, body)[1] - 0.91).abs() < 0.02);
    assert_eq!(state.vertical_speed, 0.0);
    world
        .set_character_input(
            body,
            CharacterInput {
                velocity: [2.0, 0.0, 0.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
    steps(&mut world, 60);
    let pos = position(&world, body);
    assert!((pos[0] - 2.0).abs() < 0.03, "{pos:?}");
    assert!((pos[1] - 0.91).abs() < 0.02, "{pos:?}");
    assert!(world.character_state(body).unwrap().grounded);
}

#[test]
fn character_platform_carry_and_input_survive_joint_substeps() {
    for snap_distance in [0.0, 0.2] {
        for with_joint in [false, true] {
            let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
            let platform = block(
                &mut world,
                BodyKind::KinematicPosition,
                [0.0, -0.25, 0.0],
                [10.0, 0.25, 10.0],
            );
            let body = actor(
                &mut world,
                [0.0, 0.91, 0.0],
                CharacterConfig {
                    snap_distance,
                    ..CharacterConfig::default()
                },
            );
            let anchor = block(&mut world, BodyKind::Fixed, [0.0, -10.0, 0.0], [0.5; 3]);
            let weight = block(&mut world, BodyKind::Dynamic, [0.0, -12.0, 0.0], [0.5; 3]);
            if with_joint {
                world
                    .create_joint(JointDesc::new(
                        anchor,
                        weight,
                        JointKind::Distance { length: 2.0 },
                    ))
                    .unwrap();
            }
            checked_positive_steps(&mut world, 30);
            assert!(world.character_state(body).unwrap().grounded);
            world
                .set_character_input(
                    body,
                    CharacterInput {
                        velocity: [1.0, 0.0, 0.0],
                        ..CharacterInput::default()
                    },
                )
                .unwrap();
            for tick in 1..=120 {
                let t = tick as f32 / 60.0;
                world
                    .set_kinematic_target(
                        platform,
                        Pose {
                            position: [t * 2.0, -0.25 + t * 0.5, 0.0],
                            ..Pose::default()
                        },
                    )
                    .unwrap();
                let result = world.step_checked();
                assert!(
                    result.is_ok(),
                    "tick={tick} snap={snap_distance} joint={with_joint}: {result:?}"
                );
                assert_eq!(
                    world.actual_motion_completed_time(),
                    f64::from(world.config().step_seconds)
                );
                let p = position(&world, body);
                assert!((p[0] - t * 3.0).abs() < 0.035, "tick={tick}: {p:?}");
                assert!(
                    (p[1] - (0.91 + t * 0.5)).abs() < 0.025,
                    "tick={tick}: {p:?}"
                );
                assert!(world.character_state(body).unwrap().grounded);
                assert_eq!(
                    world.character_state(body).unwrap().ground.unwrap().body,
                    platform
                );
            }
        }
    }
}

#[test]
fn planar_character_supports_y_down_gravity_without_z_drift() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0, 9.81, 0.0],
        ..WorldConfig::default()
    })
    .unwrap();
    block(
        &mut world,
        BodyKind::Fixed,
        [0.0, 0.1, 0.0],
        [20.0, 0.1, 20.0],
    );
    let body = actor(
        &mut world,
        [0.0, -4.0, 0.0],
        CharacterConfig {
            up: [0.0, -1.0, 0.0],
            ..CharacterConfig::default()
        },
    );
    steps(&mut world, 180);
    world
        .set_character_input(
            body,
            CharacterInput {
                velocity: [2.0, 0.0, 0.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
    steps(&mut world, 60);
    let pos = position(&world, body);
    assert!(
        (pos[0] - 2.0).abs() < 0.03 && (pos[1] + 0.91).abs() < 0.02,
        "{pos:?}"
    );
    assert_eq!(pos[2], 0.0);
    assert!(world.character_state(body).unwrap().grounded);
}

#[test]
fn character_slides_along_a_wall_without_crossing_it() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    block(
        &mut world,
        BodyKind::Fixed,
        [1.5, 2.0, 0.0],
        [0.1, 2.0, 10.0],
    );
    let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
    steps(&mut world, 2);
    world
        .set_character_input(
            body,
            CharacterInput {
                velocity: [3.0, 0.0, 2.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
    steps(&mut world, 60);
    let pos = position(&world, body);
    assert!((0.9..=1.01).contains(&pos[0]), "{pos:?}");
    assert!(pos[2] > 1.8, "{pos:?}");
    assert!(world.character_state(body).unwrap().grounded);
}

#[test]
fn jump_is_consumed_once_and_ceiling_blocks_upward_motion() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    block(
        &mut world,
        BodyKind::Fixed,
        [0.0, 2.5, 0.0],
        [2.0, 0.1, 2.0],
    );
    let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
    steps(&mut world, 3);
    world
        .set_character_input(
            body,
            CharacterInput {
                jump_speed: 5.0,
                ..CharacterInput::default()
            },
        )
        .unwrap();
    let mut hit_ceiling = false;
    let mut max_y = 0.0_f32;
    for _ in 0..120 {
        world.step();
        max_y = max_y.max(position(&world, body)[1]);
        hit_ceiling |= world.character_state(body).unwrap().hit_ceiling;
        assert!(position(&world, body)[1] <= 1.51);
    }
    assert!(
        max_y > 1.3 && hit_ceiling,
        "max_y={max_y}, ceiling={hit_ceiling}"
    );
    assert!(world.character_state(body).unwrap().grounded);
    assert!((position(&world, body)[1] - 0.91).abs() < 0.02);
}

#[test]
fn stairs_obey_height_and_headroom_limits() {
    for (height, ceiling, crosses) in [(0.2, false, true), (0.6, false, false), (0.2, true, false)]
    {
        let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        floor(&mut world);
        block(
            &mut world,
            BodyKind::Fixed,
            [1.5, height * 0.5, 0.0],
            [0.5, height * 0.5, 2.0],
        );
        if ceiling {
            block(
                &mut world,
                BodyKind::Fixed,
                [1.5, 2.0, 0.0],
                [0.5, 0.1, 2.0],
            );
        }
        let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
        checked_positive_steps(&mut world, 2);
        world
            .set_character_input(
                body,
                CharacterInput {
                    velocity: [2.0, 0.0, 0.0],
                    ..CharacterInput::default()
                },
            )
            .unwrap();
        let mut max_y = 0.0_f32;
        for _ in 0..120 {
            checked_positive_steps(&mut world, 1);
            max_y = max_y.max(position(&world, body)[1]);
        }
        let pos = position(&world, body);
        if crosses {
            assert!(
                pos[0] > 3.5 && max_y > 1.08,
                "height={height}, ceiling={ceiling}, pos={pos:?}, max_y={max_y}"
            );
        } else {
            assert!(
                pos[0] < 0.7,
                "height={height}, ceiling={ceiling}, pos={pos:?}, max_y={max_y}"
            );
        }
    }
}

#[test]
fn slope_limit_distinguishes_walkable_and_steep_ramps() {
    for (slope, climbs) in [(0.5, true), (1.7320508, false)] {
        let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        floor(&mut world);
        let ramp = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::TriangleMesh {
                    vertices: vec![
                        [0.0, 0.0, -2.0],
                        [4.0, 4.0 * slope, -2.0],
                        [4.0, 4.0 * slope, 2.0],
                        [0.0, 0.0, 2.0],
                    ],
                    triangles: vec![[0, 2, 1], [0, 3, 2]],
                }),
            )
            .unwrap();
        let body = actor(&mut world, [-1.0, 0.91, 0.0], CharacterConfig::default());
        checked_positive_steps(&mut world, 2);
        world
            .set_character_input(
                body,
                CharacterInput {
                    velocity: [2.0, 0.0, 0.0],
                    ..CharacterInput::default()
                },
            )
            .unwrap();
        checked_positive_steps(&mut world, 120);
        let pos = position(&world, body);
        if climbs {
            assert!(pos[0] > 1.5 && pos[1] > 1.6, "{pos:?}");
            let state = world.character_state(body).unwrap();
            assert!(state.grounded);
            assert_eq!(state.ground.unwrap().body, ramp);
        } else {
            assert!(pos[0] < 0.3 && pos[1] < 1.3, "{pos:?}");
        }
    }
}

#[test]
fn bridge_top_and_underpass_use_actual_3d_collisions() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    let bridge = block(
        &mut world,
        BodyKind::Fixed,
        [0.0, 2.9, 0.0],
        [5.0, 0.1, 2.0],
    );
    let below = actor(&mut world, [-2.0, 0.91, 0.0], CharacterConfig::default());
    let above = actor(&mut world, [-2.0, 3.91, 0.0], CharacterConfig::default());
    steps(&mut world, 2);
    for body in [below, above] {
        world
            .set_character_input(
                body,
                CharacterInput {
                    velocity: [2.0, 0.0, 0.0],
                    ..CharacterInput::default()
                },
            )
            .unwrap();
    }
    steps(&mut world, 120);
    let low = position(&world, below);
    let high = position(&world, above);
    assert!(low[0] > 1.8 && high[0] > 1.8, "low={low:?}, high={high:?}");
    assert!((low[1] - 0.91).abs() < 0.02 && (high[1] - 3.91).abs() < 0.02);
    assert_eq!(
        world.character_state(above).unwrap().ground.unwrap().body,
        bridge
    );
}

#[test]
fn walking_off_a_ledge_and_removing_support_both_cause_falling() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let platform = block(
        &mut world,
        BodyKind::Fixed,
        [0.0, -0.1, 0.0],
        [1.0, 0.1, 2.0],
    );
    let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
    steps(&mut world, 3);
    world.remove_body(platform).unwrap();
    assert!(!world.character_state(body).unwrap().grounded);
    world
        .set_character_input(
            body,
            CharacterInput {
                jump_speed: 10.0,
                ..CharacterInput::default()
            },
        )
        .unwrap();
    steps(&mut world, 60);
    assert!(position(&world, body)[1] < -2.0);
    block(
        &mut world,
        BodyKind::Fixed,
        [0.0, -0.1, 0.0],
        [1.0, 0.1, 2.0],
    );
    world
        .set_pose(
            body,
            Pose {
                position: [0.0, 0.91, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
    world
        .set_character_input(body, CharacterInput::default())
        .unwrap();
    steps(&mut world, 3);
    world
        .set_character_input(
            body,
            CharacterInput {
                velocity: [2.0, 0.0, 0.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
    checked_positive_steps(&mut world, 150);
    assert!(!world.character_state(body).unwrap().grounded);
    assert!(position(&world, body)[1] < -2.0);
}

#[test]
fn character_ownership_validation_and_lifecycle_are_explicit() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let body = actor(&mut world, [0.0, 3.0, 0.0], CharacterConfig::default());
    let collider = world.collider_ids(body).unwrap().next().unwrap();
    assert_eq!(
        world.set_velocity(body, [1.0, 0.0, 0.0], [0.0; 3]),
        Err(PhysicsError::CharacterControlled)
    );
    assert_eq!(
        world.set_kinematic_target(body, Pose::default()),
        Err(PhysicsError::CharacterControlled)
    );
    assert_eq!(
        world.remove_collider(collider),
        Err(PhysicsError::CharacterControlled)
    );
    assert_eq!(
        world.update_collider(collider, ColliderDesc::new(Shape::Sphere { radius: 1.0 })),
        Err(PhysicsError::CharacterControlled)
    );
    assert_eq!(
        world.set_character_input(
            body,
            CharacterInput {
                velocity: [0.0, 1.0, 0.0],
                ..CharacterInput::default()
            }
        ),
        Err(PhysicsError::InvalidCharacter)
    );
    let original = world.body_state(body).unwrap();
    assert_eq!(
        world.set_pose(
            body,
            Pose {
                rotation: [0.5_f32.sqrt(), 0.0, 0.0, 0.5_f32.sqrt()],
                ..Pose::default()
            }
        ),
        Err(PhysicsError::InvalidCharacter)
    );
    assert_eq!(world.body_state(body).unwrap(), original);
    world.disable_character(body).unwrap();
    world.set_kinematic_target(body, Pose::default()).unwrap();
    world.remove_collider(collider).unwrap();
    world.remove_body(body).unwrap();
    assert_eq!(world.character_state(body), Err(PhysicsError::StaleBody));
}

#[test]
fn horizontal_platform_carry_tracks_starts_stops_and_reversals() {
    for kind in [BodyKind::KinematicVelocity, BodyKind::KinematicPosition] {
        let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        let platform = block(&mut world, kind, [0.0, -0.1, 0.0], [3.0, 0.1, 3.0]);
        let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
        steps(&mut world, 5);
        for speed in [2.0, 0.0, -1.0] {
            for _ in 0..60 {
                if kind == BodyKind::KinematicVelocity {
                    world
                        .set_velocity(platform, [speed, 0.0, 0.0], [0.0; 3])
                        .unwrap();
                } else {
                    let mut target = world.body_state(platform).unwrap().pose;
                    target.position[0] += speed / 60.0;
                    world.set_kinematic_target(platform, target).unwrap();
                }
                world.step();
                let actor_pos = position(&world, body);
                let platform_pos = position(&world, platform);
                assert!(
                    (actor_pos[0] - platform_pos[0]).abs() < 0.05,
                    "kind={kind:?}, speed={speed}, actor={actor_pos:?}, platform={platform_pos:?}"
                );
                assert!(
                    world.character_state(body).unwrap().grounded,
                    "{:?}",
                    world.character_state(body)
                );
            }
        }
    }
}

#[test]
fn elevator_support_is_evaluated_after_the_platform_moves() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let platform = block(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.0, -0.1, 0.0],
        [3.0, 0.1, 3.0],
    );
    let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
    checked_positive_steps(&mut world, 5);
    for speed in [2.0, -2.0, 0.0] {
        world
            .set_velocity(platform, [0.0, speed, 0.0], [0.0; 3])
            .unwrap();
        for _ in 0..60 {
            checked_positive_steps(&mut world, 1);
            let gap = position(&world, body)[1] - position(&world, platform)[1];
            assert!((gap - 1.01).abs() < 0.025, "speed={speed}, gap={gap}");
            assert!(
                world.character_state(body).unwrap().grounded,
                "speed={speed}, {:?}",
                world.character_state(body)
            );
        }
    }
}

#[test]
fn rotating_rider_with_locomotion_meets_wall_in_one_tick() {
    for sign in [1., -1.] {
        for blocked in [false, true] {
            let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
            let platform = block(
                &mut world,
                BodyKind::KinematicVelocity,
                [0., -0.1, 0.],
                [3., 0.1, 3.],
            );
            if blocked {
                block(
                    &mut world,
                    BodyKind::Fixed,
                    [1., 1., -0.517 * sign],
                    [2., 0.8, 0.1],
                );
            }
            let rider = actor(
                &mut world,
                [1., 0.91, 0.],
                CharacterConfig {
                    skin_width: 0.01,
                    step_height: 0.,
                    ..Default::default()
                },
            );
            checked_positive_steps(&mut world, 5);
            assert!(world.character_state(rider).unwrap().grounded);
            let original = world.body_state(platform).unwrap().pose;
            let before = position(&world, rider);
            world
                .set_velocity(
                    platform,
                    [0.; 3],
                    [0., std::f32::consts::FRAC_PI_2 * sign, 0.],
                )
                .unwrap();
            world
                .set_character_input(
                    rider,
                    CharacterInput {
                        velocity: [1., 0., 0.],
                        ..Default::default()
                    },
                )
                .unwrap();
            checked_positive_steps(&mut world, 1);
            let state = world.character_state(rider).unwrap();
            let [x, y, z] = position(&world, rider);
            assert!(state.grounded);
            assert_eq!(state.ground.unwrap().body, platform);
            assert_eq!(
                (state.failed_moving_obstacle_casts, state.dropped_contacts),
                (0, 0)
            );
            assert!((y - before[1]).abs() <= 0.005, "y={y}, before={before:?}");
            if blocked {
                // A blocked rider stops the rotating carrier as a group.
                assert_eq!(position(&world, rider), before);
                assert_eq!(world.body_state(platform).unwrap().pose, original);
                assert_eq!(world.step_statistics().kinematic_path_stops, 1);
            } else {
                assert!(x > 1.014 && z * sign < -0.017, "x={x}; z={z}");
                assert_eq!(state.carried_by, Some(platform));
            }
        }
    }
}

#[test]
fn rotating_platform_preserves_radius_over_a_full_turn() {
    for kind in [BodyKind::KinematicVelocity, BodyKind::KinematicPosition] {
        let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        let platform = block(&mut world, kind, [0.0, -0.1, 0.0], [3.0, 0.1, 3.0]);
        let body = actor(&mut world, [1.0, 0.91, 0.0], CharacterConfig::default());
        checked_positive_steps(&mut world, 5);
        let speed = std::f32::consts::FRAC_PI_2;
        if kind == BodyKind::KinematicVelocity {
            world
                .set_velocity(platform, [0.0; 3], [0.0, speed, 0.0])
                .unwrap();
        }
        for frame in 1..=240 {
            if kind == BodyKind::KinematicPosition {
                let half = speed * frame as f32 / 120.0;
                world
                    .set_kinematic_target(
                        platform,
                        Pose {
                            position: [0.0, -0.1, 0.0],
                            rotation: [0.0, half.sin(), 0.0, half.cos()],
                        },
                    )
                    .unwrap();
            }
            checked_positive_steps(&mut world, 1);
            let pos = position(&world, body);
            let radius = pos[0].hypot(pos[2]);
            assert!(
                (radius - 1.0).abs() < 0.025,
                "kind={kind:?}, frame={frame}, radius={radius}, pos={pos:?}"
            );
            assert!(world.character_state(body).unwrap().grounded);
        }
        let pos = position(&world, body);
        assert!(
            (pos[0] - 1.0).abs() < 0.03 && pos[2].abs() < 0.03,
            "kind={kind:?}, pos={pos:?}"
        );
    }
}

#[test]
fn configured_character_impulses_push_dynamic_obstacles() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    let obstacle = block(&mut world, BodyKind::Dynamic, [1.5, 0.5, 0.0], [0.5; 3]);
    let body = actor(
        &mut world,
        [0.0, 0.91, 0.0],
        CharacterConfig {
            push_mass: 10.0,
            ..CharacterConfig::default()
        },
    );
    checked_positive_steps(&mut world, 10);
    world
        .set_character_input(
            body,
            CharacterInput {
                velocity: [2.0, 0.0, 0.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
    checked_positive_steps(&mut world, 120);
    assert!(
        position(&world, obstacle)[0] > 2.5,
        "{:?}",
        position(&world, obstacle)
    );
    assert!(
        position(&world, body)[0] > 1.0,
        "{:?}",
        position(&world, body)
    );
}

#[test]
fn platform_carry_is_swept_against_environment_walls() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let platform = block(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.0, -0.1, 0.0],
        [3.0, 0.1, 3.0],
    );
    block(
        &mut world,
        BodyKind::Fixed,
        [1.5, 2.0, 0.0],
        [0.1, 2.0, 4.0],
    );
    let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
    steps(&mut world, 5);
    world
        .set_velocity(platform, [2.0, 0.0, 0.0], [0.0; 3])
        .unwrap();
    steps(&mut world, 60);
    let pos = position(&world, body);
    assert!((0.9..=1.01).contains(&pos[0]), "{pos:?}");
    assert!(world.character_state(body).unwrap().grounded);
    let platform_x = position(&world, platform)[0];
    assert!(
        (platform_x - pos[0]).abs() < 0.005,
        "rider={pos:?}; platform={platform_x}"
    );
    assert!(platform_x < 1.0);
}

#[test]
fn support_edits_invalidate_grounding_before_a_queued_jump() {
    for mode in 0..3 {
        let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        let support = floor(&mut world);
        let collider = world.collider_ids(support).unwrap().next().unwrap();
        let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
        steps(&mut world, 3);
        world
            .set_character_input(
                body,
                CharacterInput {
                    jump_speed: 10.0,
                    ..CharacterInput::default()
                },
            )
            .unwrap();
        match mode {
            0 => world.remove_collider(collider).unwrap(),
            1 => world
                .update_collider(
                    collider,
                    ColliderDesc {
                        sensor: true,
                        ..ColliderDesc::new(Shape::Box {
                            half_extents: [20.0, 0.1, 20.0],
                        })
                    },
                )
                .unwrap(),
            _ => world
                .set_pose(
                    support,
                    Pose {
                        position: [0.0, -20.0, 0.0],
                        ..Pose::default()
                    },
                )
                .unwrap(),
        }
        assert!(!world.character_state(body).unwrap().grounded);
        world.step();
        assert!(world.character_state(body).unwrap().vertical_speed < 0.0);
        assert!(position(&world, body)[1] < 0.91);
    }
}

#[test]
fn invalid_character_updates_preserve_queued_input_and_controller() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    let body = actor(&mut world, [0.0, 0.91, 0.0], CharacterConfig::default());
    steps(&mut world, 3);
    let collider = world.collider_ids(body).unwrap().next().unwrap();
    world
        .set_character_input(
            body,
            CharacterInput {
                jump_speed: 5.0,
                ..CharacterInput::default()
            },
        )
        .unwrap();
    assert_eq!(
        world.set_character_input(
            body,
            CharacterInput {
                velocity: [f32::NAN, 0.0, 0.0],
                jump_speed: 0.0
            }
        ),
        Err(PhysicsError::InvalidCharacter)
    );
    assert_eq!(
        world.enable_character(
            body,
            CharacterConfig {
                up: [0.0; 3],
                ..CharacterConfig::default()
            }
        ),
        Err(PhysicsError::InvalidCharacter)
    );
    assert_eq!(
        world.update_collider(
            collider,
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.001
            })
        ),
        Err(PhysicsError::CharacterControlled)
    );
    world.step();
    assert!(world.character_state(body).unwrap().vertical_speed > 4.8);
    assert!(position(&world, body)[1] > 0.98);
    world.clear();
    assert_eq!(world.character_state(body), Err(PhysicsError::StaleBody));
    assert!(world.characters.is_empty());
}

#[test]
fn fast_characters_do_not_cross_each_other() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    let a = actor(&mut world, [-2.0, 0.91, 0.0], CharacterConfig::default());
    let b = actor(&mut world, [2.0, 0.91, 0.0], CharacterConfig::default());
    steps(&mut world, 3);
    world
        .set_character_input(
            a,
            CharacterInput {
                velocity: [20.0, 0.0, 0.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
    world
        .set_character_input(
            b,
            CharacterInput {
                velocity: [-20.0, 0.0, 0.0],
                ..CharacterInput::default()
            },
        )
        .unwrap();
    for _ in 0..30 {
        world.step();
        let gap = position(&world, b)[0] - position(&world, a)[0];
        assert!(
            gap >= 0.79,
            "gap={gap}, a={:?}, b={:?}",
            position(&world, a),
            position(&world, b)
        );
    }
}

#[test]
fn co_moving_characters_keep_their_speed_and_separation() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    let actors: Vec<_> = (0..8)
        .map(|i| {
            actor(
                &mut world,
                [i as f32, 0.91, 0.0],
                CharacterConfig::default(),
            )
        })
        .collect();
    steps(&mut world, 3);
    for &body in &actors {
        world
            .set_character_input(
                body,
                CharacterInput {
                    velocity: [10.0, 0.0, 0.0],
                    ..CharacterInput::default()
                },
            )
            .unwrap();
    }
    steps(&mut world, 60);
    for (i, &body) in actors.iter().enumerate() {
        let pos = position(&world, body);
        assert!((pos[0] - i as f32 - 10.0).abs() < 0.03, "{i}: {pos:?}");
        let state = world.character_state(body).unwrap();
        assert_eq!(state.failed_pair_casts, 0);
        assert!(!state.blocked_by_character);
    }
}

#[test]
fn character_contact_limits_propagate_through_a_following_group() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    block(
        &mut world,
        BodyKind::Fixed,
        [8.0, 2.0, 0.0],
        [0.1, 2.0, 4.0],
    );
    let actors: Vec<_> = (0..8)
        .map(|i| {
            actor(
                &mut world,
                [i as f32, 0.91, 0.0],
                CharacterConfig::default(),
            )
        })
        .collect();
    checked_positive_steps(&mut world, 3);
    for &body in &actors {
        world
            .set_character_input(
                body,
                CharacterInput {
                    velocity: [20.0, 0.0, 0.0],
                    ..CharacterInput::default()
                },
            )
            .unwrap();
    }
    for _ in 0..60 {
        checked_positive_steps(&mut world, 1);
        for pair in actors.windows(2) {
            let a = position(&world, pair[0]);
            let b = position(&world, pair[1]);
            // Ordinary KCC may slide a following capsule sideways. Check
            // actual horizontal separation instead of the old shared X prefix.
            let gap = (b[0] - a[0]).hypot(b[2] - a[2]);
            assert!(gap >= 0.79, "gap={gap}, a={:?}, b={:?}", a, b);
            assert_eq!(world.character_state(pair[0]).unwrap().failed_pair_casts, 0);
        }
        assert!(position(&world, actors[7])[0] <= 7.51);
    }
}

#[test]
fn separated_characters_do_not_trigger_all_pairs_casts() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let actors: Vec<_> = (0..32)
        .map(|i| {
            actor(
                &mut world,
                [i as f32 * 4.0, 10.0, 0.0],
                CharacterConfig::default(),
            )
        })
        .collect();
    world.step();
    for body in actors {
        assert_eq!(world.character_state(body).unwrap().character_pair_casts, 0);
    }
}

#[test]
fn airborne_character_does_not_snap_before_it_has_support() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    floor(&mut world);
    let body = actor(
        &mut world,
        [0.0, 0.94, 0.0],
        CharacterConfig {
            snap_distance: 10.0,
            ..CharacterConfig::default()
        },
    );
    world.step();
    let pos = position(&world, body);
    assert!((pos[1] - (0.94 - 9.81 / 3600.0)).abs() < 1.0e-5, "{pos:?}");
    assert!(!world.character_state(body).unwrap().grounded);
    steps(&mut world, 60);
    assert!(world.character_state(body).unwrap().grounded);
}

#[test]
fn character_capacity_rejects_registration_without_claiming_body_control() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        max_characters: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    let first = actor(&mut world, [0.0, 3.0, 0.0], CharacterConfig::default());
    let second = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.4,
            }),
        )
        .unwrap();
    assert_eq!(
        world.enable_character(second, CharacterConfig::default()),
        Err(PhysicsError::CapacityExceeded)
    );
    world.set_kinematic_target(second, Pose::default()).unwrap();
    world.disable_character(first).unwrap();
    world
        .enable_character(second, CharacterConfig::default())
        .unwrap();
    assert_eq!(
        world.set_kinematic_target(second, Pose::default()),
        Err(PhysicsError::CharacterControlled)
    );
}

#[test]
fn disabling_support_immediately_removes_grounding_and_cannot_enable_an_air_jump() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let ground = floor(&mut world);
    let body = actor(&mut world, [0.0, 1.0, 0.0], CharacterConfig::default());
    steps(&mut world, 30);
    assert!(world.character_state(body).unwrap().grounded);
    world
        .set_body_options(
            ground,
            &BodyOptions {
                kind: BodyKind::Fixed,
                enabled: false,
                ..BodyOptions::default()
            },
        )
        .unwrap();
    assert!(!world.character_state(body).unwrap().grounded);
    let before = position(&world, body)[1];
    world
        .set_character_input(
            body,
            CharacterInput {
                jump_speed: 6.0,
                ..CharacterInput::default()
            },
        )
        .unwrap();
    world.step();
    assert!(!world.character_state(body).unwrap().grounded);
    assert!(position(&world, body)[1] < before);
}
