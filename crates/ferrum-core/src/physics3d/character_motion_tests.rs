use super::*;
fn pose(x: f32, y: f32, z: f32) -> Pose {
    Pose {
        position: [x, y, z],
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
fn block(w: &mut PhysicsWorld3d, kind: BodyKind, p: Pose, half: [f32; 3]) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: p,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box { half_extents: half }),
    )
    .unwrap()
}
fn actor(w: &mut PhysicsWorld3d, p: Pose) -> BodyId {
    let a = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: p,
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
    a
}
#[test]
fn carried_capsule_and_wall_moving_together_keep_their_separation() {
    for path in [false, true] {
        let mut w = world();
        let p = block(
            &mut w,
            BodyKind::KinematicPosition,
            pose(0.0, -0.1, 0.0),
            [5.0, 0.1, 5.0],
        );
        let a = actor(&mut w, pose(0.0, 0.51, 0.0));
        w.step();
        assert!(w.character_state(a).unwrap().grounded);
        let wall = block(
            &mut w,
            BodyKind::KinematicPosition,
            pose(1.0, 1.0, 0.0),
            [0.25, 0.5, 5.0],
        );
        w.set_kinematic_target(wall, pose(3.0, 1.0, 0.0)).unwrap();
        if path {
            w.step_with_kinematic_paths(&[KinematicPath {
                sweep_sensors: false,
                body: p,
                knots: vec![(1.0, pose(2.0, -0.1, 0.0))],
            }])
            .unwrap();
        } else {
            w.set_kinematic_target(p, pose(2.0, -0.1, 0.0)).unwrap();
            w.step();
        }
        let x = w.body_state(a).unwrap().pose.position[0];
        assert!((x - 2.0).abs() < 0.001, "path={path}, x={x}");
        assert!(w.character_state(a).unwrap().grounded);
    }
}
#[test]
fn locomotion_does_not_hit_the_old_pose_of_a_receding_wall() {
    let mut w = world();
    let a = actor(&mut w, pose(0.0, 0.0, 0.0));
    let wall = block(
        &mut w,
        BodyKind::KinematicPosition,
        pose(1.0, 0.0, 0.0),
        [0.25, 2.0, 5.0],
    );
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [20.0, 0.0, 0.0],
            ..CharacterInput::default()
        },
    )
    .unwrap();
    w.set_kinematic_target(wall, pose(3.0, 0.0, 0.0)).unwrap();
    w.step();
    assert!((w.body_state(a).unwrap().pose.position[0] - 2.0).abs() < 0.001);
}
#[test]
fn fast_incoming_wall_pushes_an_idle_capsule_without_passing_through() {
    let mut w = world();
    let a = actor(&mut w, pose(0.0, 0.0, 0.0));
    let wall = block(
        &mut w,
        BodyKind::KinematicPosition,
        pose(3.0, 0.0, 0.0),
        [0.25, 2.0, 5.0],
    );
    w.set_kinematic_target(wall, pose(-3.0, 0.0, 0.0)).unwrap();
    w.step();
    let p = w.body_state(a).unwrap().pose.position;
    assert!((p[0] + 3.51).abs() < 0.02, "{p:?}");
}
#[test]
fn incoming_wall_preserves_the_capsules_tangent_locomotion() {
    let mut w = world();
    let a = actor(&mut w, pose(0.0, 0.0, 0.0));
    let wall = block(
        &mut w,
        BodyKind::KinematicPosition,
        pose(3.0, 0.0, 0.0),
        [0.25, 2.0, 5.0],
    );
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [0.0, 0.0, 10.0],
            ..CharacterInput::default()
        },
    )
    .unwrap();
    w.set_kinematic_target(wall, pose(-1.0, 0.0, 0.0)).unwrap();
    w.step();
    let p = w.body_state(a).unwrap().pose.position;
    assert!(
        (p[0] + 1.51).abs() < 0.02 && (p[2] - 1.0).abs() < 0.001,
        "{p:?}"
    );
}
#[test]
fn incoming_elevator_catches_a_previously_unsupported_capsule() {
    let mut w = world();
    let a = actor(&mut w, pose(0.0, 0.5, 0.0));
    let p = block(
        &mut w,
        BodyKind::KinematicPosition,
        pose(0.0, -2.0, 0.0),
        [5.0, 0.1, 5.0],
    );
    w.set_kinematic_target(p, pose(0.0, 2.0, 0.0)).unwrap();
    w.step();
    let y = w.body_state(a).unwrap().pose.position[1];
    assert!((y - 2.61).abs() < 0.02, "{y}");
    assert!(w.character_state(a).unwrap().grounded);
}

#[test]
fn moving_obstacle_filters_preserve_sensors_masks_and_planar_floors() {
    for mode in 0..5 {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space: Space::PlanarXy,
            step_seconds: 0.1,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let a = actor(&mut w, pose(0.0, 0.0, 0.0));
        let b = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose(3.0, 0.0, 0.0),
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    sensor: mode == 0,
                    mask: if mode == 1 { 0 } else { u32::MAX },
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [0.25, 2.0, 0.5],
                    })
                },
            )
            .unwrap();
        if mode == 2 {
            w.set_body_options(
                b,
                &BodyOptions {
                    kind: BodyKind::KinematicPosition,
                    enabled: false,
                    ..BodyOptions::default()
                },
            )
            .unwrap();
        }
        if mode == 3 {
            w.set_planar_collision_span(
                a,
                Some(PlanarCollisionSpan {
                    floor: 0,
                    elevation: 0.0,
                    height: 1.0,
                }),
            )
            .unwrap();
            w.set_planar_collision_span(
                b,
                Some(PlanarCollisionSpan {
                    floor: 1,
                    elevation: 0.0,
                    height: 1.0,
                }),
            )
            .unwrap();
        }
        w.set_kinematic_target(b, pose(-3.0, 0.0, 0.0)).unwrap();
        w.step();
        if mode == 4 {
            let position = w.body_state(a).unwrap().pose.position;
            assert!((position[0] + 3.51).abs() < 0.02);
            assert_eq!(position[2], 0.0);
            assert!(w.character_state(a).unwrap().blocked_by_moving_obstacle);
            continue;
        }
        assert_eq!(
            w.body_state(a).unwrap().pose.position,
            [0.0; 3],
            "mode={mode}"
        );
        assert!(!w.character_state(a).unwrap().blocked_by_moving_obstacle);
    }
}

#[test]
fn velocity_based_wall_uses_the_same_relative_response_and_reports_query_work() {
    let mut w = world();
    let a = actor(&mut w, pose(0.0, 0.0, 0.0));
    let b = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: pose(3.0, 0.0, 0.0),
                linear_velocity: [-60.0, 0.0, 0.0],
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 2.0, 5.0],
            }),
        )
        .unwrap();
    w.step();
    assert!((w.body_state(a).unwrap().pose.position[0] + 3.51).abs() < 0.02);
    assert!((w.body_state(b).unwrap().pose.position[0] + 3.0).abs() < 0.001);
    let s = w.character_state(a).unwrap();
    assert!(s.blocked_by_moving_obstacle && s.moving_obstacle_casts > 0);
    assert!(!s.moving_obstacle_iteration_limit);
    assert_eq!(s.failed_moving_obstacle_casts, 0);
}

#[test]
fn velocity_collider_motion_preserves_mass_center_offsets_and_angular_winding() {
    use super::kinematic_motion::collider_motion;
    use super::world::native_id;
    let mut w = world();
    let b = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: pose(4.0, 2.0, 1.0),
                linear_velocity: [1.0, 2.0, 3.0],
                angular_velocity: [0.0, 0.0, 40.0],
                ..BodyDesc::default()
            },
            ColliderDesc {
                pose: pose(2.0, 0.0, 0.0),
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [0.5; 3],
                })
            },
        )
        .unwrap();
    w.add_collider(
        b,
        ColliderDesc {
            pose: pose(-1.0, 0.0, 0.0),
            density: 2.0,
            ..ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            })
        },
    )
    .unwrap();
    let body = &w.backend.bodies[native_id(b)];
    for &handle in body.colliders() {
        let c = &w.backend.colliders[handle];
        let motion = collider_motion(body, c, 0.1);
        assert_eq!(motion.angvel.z, 4.0);
        for i in 0..=16 {
            let t = i as f32 / 16.0;
            let expected = body.predict_position_using_velocity(0.1 * t)
                * c.position_wrt_parent().copied().unwrap();
            let actual = motion.position_at_time(t);
            assert!(
                (actual.translation - expected.translation).length() < 2e-5,
                "{i}: {actual:?} {expected:?}"
            );
            assert!(actual.rotation.dot(expected.rotation).abs() > 0.99999);
        }
    }
}

#[test]
fn moving_one_way_surface_catches_from_above_and_passes_from_below() {
    for rising in [true, false] {
        let mut w = world();
        let a = actor(&mut w, pose(0.0, 0.5, 0.0));
        let from = if rising { -2.0 } else { 2.0 };
        let p = block(
            &mut w,
            BodyKind::KinematicPosition,
            pose(0.0, from, 0.0),
            [5.0, 0.1, 5.0],
        );
        let c = w.collider_ids(p).unwrap().next().unwrap();
        w.set_terrain_one_way(
            c,
            Some(TerrainOneWay {
                point: [0.0, 0.1, 0.0],
                normal: [0.0, 1.0, 0.0],
            }),
        )
        .unwrap();
        w.set_kinematic_target(p, pose(0.0, -from, 0.0)).unwrap();
        w.step();
        let y = w.body_state(a).unwrap().pose.position[1];
        if rising {
            assert!((y - 2.61).abs() < 0.02, "{y}");
            assert!(w.character_state(a).unwrap().grounded);
        } else {
            assert_eq!(y, 0.5);
            assert!(!w.character_state(a).unwrap().grounded);
        }
    }
}
