use super::*;
use crate::physics3d::kinematic_paths::KinematicPath;

#[test]
fn native_snapshot_restores_all_seven_shapes_and_dirty_terrain_queries() {
    let shapes = [
        Shape::Box {
            half_extents: [0.5; 3],
        },
        Shape::Sphere { radius: 0.5 },
        Shape::Capsule {
            half_height: 0.5,
            radius: 0.3,
        },
        Shape::ConvexHull {
            points: vec![[-1., 0., -1.], [1., 0., -1.], [0., 0., 1.], [0., 1., 0.]],
        },
        Shape::TriangleMesh {
            vertices: vec![[-1., 0., -1.], [1., 0., -1.], [0., 0., 1.]],
            triangles: vec![[0, 2, 1]],
        },
        Shape::Heightfield {
            rows: 2,
            columns: 2,
            heights: vec![0., 0.1, 0.1, 0.2],
            size: [2., 2.],
        },
        Shape::Compound {
            parts: vec![ShapePart {
                pose: Pose::default(),
                shape: Shape::Sphere { radius: 0.5 },
            }],
        },
    ];
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let ids: Vec<_> = shapes
        .into_iter()
        .enumerate()
        .map(|(i, shape)| body(&mut w, BodyKind::Fixed, [i as f32 * 5., 0., 0.], shape))
        .collect();
    // Capture before the first query refresh, retaining the pending broad-phase edits.
    let mut restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
    for (i, &id) in ids.iter().enumerate() {
        let ray = RayCast {
            origin: [i as f32 * 5., 3., 0.],
            direction: [0., -1., 0.],
            max_distance: 6.,
            solid: true,
        };
        let expected = w.cast_ray(&ray, &QueryFilter::default()).unwrap().unwrap();
        let actual = restored
            .cast_ray(&ray, &QueryFilter::default())
            .unwrap()
            .unwrap();
        assert_eq!(expected.target.body, id);
        assert_eq!(expected, actual);
    }
    w.step();
    restored.step();
    same(&w, &restored, &ids);
}

#[test]
fn native_snapshot_preserves_floor_one_way_conveyor_and_correction_policies() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        ..WorldConfig::default()
    })
    .unwrap();
    let floor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., -0.5, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                friction: 1.,
                surface_velocity: [1., 0., 0.],
                contact_correction: Some(ContactCorrection {
                    velocity_rate: 10.,
                    max_velocity: 2.,
                    position_rate: 20.,
                    position_slop: 0.001,
                    velocity_slop: 0.001,
                    split_impulse: true,
                }),
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [10., 0.5, 1.],
                })
            },
        )
        .unwrap();
    let fixture = w.collider_ids(floor).unwrap().next().unwrap();
    w.set_terrain_one_way(
        fixture,
        Some(crate::physics3d::one_way::TerrainOneWay {
            point: [0., 0.5, 0.],
            normal: [0., 1., 0.],
        }),
    )
    .unwrap();
    let rider = cube(&mut w, BodyKind::Dynamic, [0., 0.5, 0.]);
    let ghost = cube(&mut w, BodyKind::Dynamic, [3., 0.5, 0.]);
    for (id, floor_id) in [(floor, 1), (rider, 1), (ghost, 2)] {
        w.set_planar_collision_span(
            id,
            Some(PlanarCollisionSpan {
                floor: floor_id,
                elevation: 0.,
                height: 1.,
            }),
        )
        .unwrap();
    }
    step(&mut w, 20);
    let start_x = w.body_state(rider).unwrap().pose.position[0];
    let mut restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
    for _ in 0..120 {
        w.step();
        restored.step();
        same(&w, &restored, &[floor, rider, ghost]);
        events(&mut w, &mut restored);
    }
    assert!(w.body_state(rider).unwrap().pose.position[0] > start_x + 0.5);
    assert!(w.body_state(rider).unwrap().pose.position[1] > 0.35);
    assert!(w.body_state(ghost).unwrap().pose.position[1] < -5.);
    // Approach from the disabled side still passes through after restoration.
    let upward = w
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [-5., -2., 0.],
                    ..Pose::default()
                },
                linear_velocity: [0., 8., 0.],
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
        )
        .unwrap();
    let checkpoint = w.capture_snapshot().unwrap();
    restored.restore_snapshot(&checkpoint).unwrap();
    for _ in 0..25 {
        w.step();
        restored.step();
        same(&w, &restored, &[upward]);
    }
    assert!(w.body_state(upward).unwrap().pose.position[1] > 0.3);
}

#[test]
fn native_snapshot_replays_path_stop_carry_and_interpolated_motion_queries() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    let platform = body(
        &mut w,
        BodyKind::KinematicPosition,
        [0.; 3],
        Shape::Box {
            half_extents: [0.5, 0.2, 2.],
        },
    );
    let rider = body(
        &mut w,
        BodyKind::KinematicPosition,
        [0., 0.71, 0.],
        Shape::Capsule {
            half_height: 0.25,
            radius: 0.25,
        },
    );
    w.enable_character(rider, CharacterConfig::default())
        .unwrap();
    let wall = cube(&mut w, BodyKind::Fixed, [2., 0., 0.]);
    let rotor = body(
        &mut w,
        BodyKind::KinematicPosition,
        [0., 10., 0.],
        Shape::Box {
            half_extents: [2., 0.1, 0.1],
        },
    );
    w.step_checked().unwrap();
    assert_eq!(
        w.character_state(rider).unwrap().ground.unwrap().body,
        platform
    );
    w.set_step_motion_enabled(true);
    let pose_at = |x| Pose {
        position: [x, 0., 0.],
        ..Pose::default()
    };
    let rotor_pose = |angle| Pose {
        position: [0., 10., 0.],
        rotation: rp::Rotation::from_rotation_z(angle).to_array(),
    };
    w.step_with_kinematic_paths(&[
        KinematicPath {
            body: platform,
            sweep_sensors: false,
            knots: vec![(0.5, pose_at(0.5)), (1., pose_at(3.))],
        },
        KinematicPath {
            body: rotor,
            sweep_sensors: false,
            knots: vec![
                (0.5, rotor_pose(std::f32::consts::FRAC_PI_6)),
                (1., rotor_pose(std::f32::consts::FRAC_PI_2)),
            ],
        },
    ])
    .unwrap();
    assert_eq!(w.kinematic_path_progress_precise(platform), (0.5, true));
    assert_eq!(w.body_state(platform).unwrap().pose, pose_at(0.5));
    assert_eq!(w.character_state(rider).unwrap().carried_by, Some(platform));
    assert!((w.character_state(rider).unwrap().carry_translation[0] - 0.5).abs() < 0.005);

    let mut restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
    let query = |world: &PhysicsWorld3d, position, delta| {
        let mut hits = Vec::new();
        world
            .sweep_step_motion(
                &Shape::Sphere { radius: 0.1 },
                Pose {
                    position,
                    ..Pose::default()
                },
                delta,
                &QueryFilter::default(),
                &mut hits,
                16,
            )
            .unwrap();
        hits
    };
    let hits = |world: &PhysicsWorld3d, x| {
        let hits = query(world, [x, 0., 2.5], [0., 0., -5.]);
        assert!(hits.iter().any(|hit| hit.target.body == platform));
        hits
    };
    assert_eq!(
        restored.kinematic_path_progress_precise(platform),
        (0.5, true)
    );
    assert_eq!(hits(&w, 0.25), hits(&restored, 0.25));
    // This point is clear at both endpoints and the turn reaches it in between.
    let rotor_hits = query(&w, [1., 11., 0.], [0.; 3]);
    assert!(rotor_hits
        .iter()
        .any(|hit| hit.target.body == rotor && (0.2..0.8).contains(&hit.fraction)));
    assert_eq!(rotor_hits, query(&restored, [1., 11., 0.], [0.; 3]));
    same(&w, &restored, &[platform, rider, rotor]);

    for world in [&mut w, &mut restored] {
        world.remove_body(wall).unwrap();
    }
    for tick in 1..=6 {
        let from = 0.5 + (tick - 1) as f32 * 0.25;
        let to = from + 0.25;
        let continuation = KinematicPath {
            body: platform,
            sweep_sensors: false,
            knots: vec![(0.5, pose_at(f32::midpoint(from, to))), (1., pose_at(to))],
        };
        for world in [&mut w, &mut restored] {
            world
                .step_with_kinematic_paths(std::slice::from_ref(&continuation))
                .unwrap();
            assert_eq!(world.kinematic_path_progress_precise(platform), (1., false));
            assert_eq!(world.body_state(platform).unwrap().pose, pose_at(to));
            let state = world.character_state(rider).unwrap();
            assert_eq!(state.ground.unwrap().body, platform);
            assert_eq!(state.carried_by, Some(platform));
            assert!((state.carry_translation[0] - 0.25).abs() < 0.005);
        }
        assert_eq!(
            hits(&w, f32::midpoint(from, to)),
            hits(&restored, f32::midpoint(from, to))
        );
        same(&w, &restored, &[platform, rider, rotor]);
    }
}

#[test]
fn native_snapshot_keeps_undrained_joint_breaks_overflow_and_allocator_generation() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        max_events: 1,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = cube(&mut w, BodyKind::Fixed, [0.; 3]);
    let ids: Vec<_> = (1..=2)
        .map(|i| {
            let b = cube(&mut w, BodyKind::Dynamic, [i as f32 * 3., 0., 0.]);
            let mut desc = JointDesc::new(a, b, JointKind::Fixed);
            desc.break_force = Some(0.001);
            let joint = w.create_joint(desc).unwrap();
            w.add_force(b, [100., 0., 0.], [0.; 3]).unwrap();
            (b, joint)
        })
        .collect();
    w.step();
    for &(_, id) in &ids {
        assert!(w.joint_state(id).is_err());
    }
    let mut restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
    let (mut x, mut y) = (Vec::new(), Vec::new());
    assert_eq!(w.drain_joint_events(&mut x), 1);
    assert_eq!(restored.drain_joint_events(&mut y), 1);
    assert_eq!(x, y);
    assert_eq!(x.len(), 1);
    assert_eq!(x[0].reason, JointEventReason::ForceLimit);
    let desc = JointDesc::new(a, ids[0].0, JointKind::Fixed);
    let next = w.create_joint(desc.clone()).unwrap();
    assert_eq!(restored.create_joint(desc).unwrap(), next);
    assert!(ids.iter().all(|&(_, old)| old != next));
}

#[test]
fn native_snapshot_successful_restore_rewinds_removal_and_pending_inputs_atomically() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let original = cube(&mut w, BodyKind::Dynamic, [0.; 3]);
    w.add_force(original, [6., 0., 0.], [0.; 3]).unwrap();
    let checkpoint = w.capture_snapshot().unwrap();
    let mut reference = PhysicsWorld3d::from_snapshot(&checkpoint).unwrap();
    w.remove_body(original).unwrap();
    let future = cube(&mut w, BodyKind::Dynamic, [10., 0., 0.]);
    step(&mut w, 10);
    w.restore_snapshot(&checkpoint).unwrap();
    assert!(w.body_state(future).is_err());
    same(&w, &reference, &[original]);
    for _ in 0..30 {
        w.step();
        reference.step();
        same(&w, &reference, &[original]);
    }
    assert!(w.body_state(original).unwrap().linear_velocity[0] > 0.1);
}
