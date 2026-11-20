use super::*;
use crate::physics3d::world::native_id;
use crate::physics3d::*;
fn fixture(mode: u8) -> (PhysicsWorld3d, BodyId, BodyId, BodyTrajectory) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        space: Space::PlanarXy,
        ..Default::default()
    })
    .unwrap();
    let wall = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                can_sleep: false,
                pose: Pose {
                    position: [0.5, 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [-10., 0., 0.],
                ..Default::default()
            },
            ColliderDesc {
                sensor: mode == 1,
                mask: if mode == 2 { 0 } else { u32::MAX },
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [0.1, 2., 0.5],
                })
            },
        )
        .unwrap();
    let body = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
        )
        .unwrap();
    if mode == 3 {
        for (id, floor) in [(wall, 1), (body, 2)] {
            world
                .set_planar_collision_span(
                    id,
                    Some(PlanarCollisionSpan {
                        floor,
                        elevation: 0.,
                        height: 1.,
                    }),
                )
                .unwrap();
        }
    }
    if mode == 4 || mode == 5 {
        let collider = world.collider_ids(wall).unwrap().next().unwrap();
        world
            .set_terrain_one_way(
                collider,
                Some(crate::physics3d::one_way::TerrainOneWay {
                    point: [0.; 3],
                    normal: if mode == 4 {
                        [1., 0., 0.]
                    } else {
                        [-1., 0., 0.]
                    },
                }),
            )
            .unwrap();
    }
    world.backend.bodies[native_id(body)].sleep();
    let saved = world.capture_snapshot().unwrap();
    world.restore_snapshot(&saved).unwrap();
    assert!(world.body_state(body).unwrap().sleeping);
    let mut actual = None;
    world.backend.bodies[native_id(wall)].visit_kinematic_motion(
        native_id(wall),
        &world.backend.integration_parameters,
        1,
        |m| {
            if actual.is_none() {
                actual = Some(m)
            }
        },
    );
    let motion = BodyTrajectory {
        body: native_id(wall),
        curve: {
            let m = actual.unwrap();
            Curve::Integrated(
                crate::physics3d::solver_trajectory::Kernel::from_native(
                    m,
                    crate::physics3d::solver_trajectory::Domain {
                        start: f64::from(m.motion.start_time),
                        end: f64::from(m.motion.end_time),
                    },
                )
                .unwrap(),
            )
        },
    };
    (world, wall, body, motion)
}
fn work() -> Work {
    Work {
        used: 0,
        limit: 1 << 24,
    }
}

#[test]
fn native_box_contact_requires_initial_overlap_and_full_motion_within_solver_error() {
    use crate::physics3d::solver_trajectory::{Domain, Kernel};
    let floor = rp::ColliderBuilder::cuboid(2., 0.1, 2.).build();
    let body = rp::ColliderBuilder::cuboid(0.25, 0.25, 0.25).build();
    let floor_pose = rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.));
    let trajectory = |index, role, collider: &rp::Collider, curve| {
        let motion = ShapeMotion {
            curve,
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        ColliderTrajectory {
            collider: rp::ColliderHandle::from_raw_parts(index, 0),
            parent: Some(rp::RigidBodyHandle::from_raw_parts(index, 0)),
            role,
            motion,
            bounds: motion
                .bounds(collider.shape(), 0., 1., &mut work())
                .unwrap(),
            sensor: false,
        }
    };
    let fixed = trajectory(
        0,
        Role::Fixed,
        &floor,
        Curve::Constant {
            pose: floor_pose,
            start_time: 0.,
            end_time: 1.,
        },
    );
    let platform = |linear, angular| {
        trajectory(
            0,
            Role::Prescribed,
            &floor,
            Curve::Integrated(
                Kernel::from_velocity(
                    rp::RigidBodyHandle::from_raw_parts(0, 0),
                    Domain::new(0., 1.).unwrap(),
                    floor_pose,
                    linear,
                    angular,
                )
                .unwrap(),
            ),
        )
    };
    let stationary = platform(rp::Vector::ZERO, rp::Vector::ZERO);
    assert!(solver_trajectory::constant_pose(stationary.motion.curve).is_some());
    let sliding = platform(rp::Vector::X * 0.01, rp::Vector::ZERO);
    let turning = platform(rp::Vector::ZERO, rp::Vector::Y * 0.01);
    for (initial_y, vertical, retained) in [
        (0.24975, -0.0005, true),
        (0.25025, -0.00075, false),
        (0.24975, -0.002, false),
    ] {
        let initial = rp::Pose::from_translation(rp::Vector::Y * initial_y);
        let moving = trajectory(
            1,
            Role::Dynamic,
            &body,
            Curve::Integrated(
                Kernel::from_velocity(
                    rp::RigidBodyHandle::from_raw_parts(1, 0),
                    Domain::new(0., 1.).unwrap(),
                    initial,
                    rp::Vector::new(0.1, vertical, 0.),
                    rp::Vector::ZERO,
                )
                .unwrap(),
            ),
        );
        for (support, stationary) in [
            (&fixed, true),
            (&stationary, true),
            (&sliding, false),
            (&turning, false),
        ] {
            let surface = (support, &floor, &floor_pose);
            let obstacle = (&moving, &body, &initial);
            for (a, b) in [(surface, obstacle), (obstacle, surface)] {
                assert_eq!(
                    retains_native_box_contact(a, b, 0.001, &mut work()).unwrap(),
                    retained && stationary,
                    "initial_y={initial_y}, vertical={vertical}, support={:?}",
                    support.role,
                );
            }
        }
    }
}

#[test]
fn actual_scene_reports_sleeping_first_hit_without_reclassifying_or_waking_source() {
    let (world, wall, body, motion) = fixture(0);
    let bytes = world.capture_snapshot().unwrap();
    let (start, end) = motion.curve.times();
    let mut scene = Scratch::default();
    scene
        .prepare(
            &world.backend.bodies,
            &world.backend.colliders,
            &[motion],
            &world.characters,
            start,
            end,
            1 << 20,
            &mut work(),
        )
        .unwrap();
    let hit = scene
        .first_hit(
            &world.backend.colliders,
            &world.contact_policies,
            start,
            end,
            0.,
            1e-7,
            &mut work(),
            &|a, b| a.role != Role::Fixed || b.role != Role::Fixed,
        )
        .unwrap()
        .unwrap();
    assert!(hit.a.role == Role::SleepingDynamic || hit.b.role == Role::SleepingDynamic);
    assert!([hit.a.parent, hit.b.parent].contains(&Some(native_id(wall))));
    assert!([hit.a.parent, hit.b.parent].contains(&Some(native_id(body))));
    assert!((hit.cast.hit_time - 0.015).abs() < 2e-6);
    assert!(world.body_state(body).unwrap().sleeping);
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        bytes.encoded_bytes()
    );
}
#[test]
fn actual_scene_preserves_sensors_masks_floors_and_actual_one_way_sides() {
    for mode in 0..=5 {
        let (world, _, _, motion) = fixture(mode);
        let (start, end) = motion.curve.times();
        let mut scene = Scratch::default();
        scene
            .prepare(
                &world.backend.bodies,
                &world.backend.colliders,
                &[motion],
                &world.characters,
                start,
                end,
                1 << 20,
                &mut work(),
            )
            .unwrap();
        let hit = scene
            .first_hit(
                &world.backend.colliders,
                &world.contact_policies,
                start,
                end,
                0.,
                1e-7,
                &mut work(),
                &|_, _| true,
            )
            .unwrap();
        assert_eq!(hit.is_some(), mode == 0 || mode == 5, "mode={mode}");
    }
}
#[test]
fn actual_scene_never_falls_back_to_old_awake_body_pose_after_missing_census() {
    let (world, _, _, motion) = fixture(0);
    let (start, end) = motion.curve.times();
    let mut scene = Scratch::default();
    scene
        .prepare(
            &world.backend.bodies,
            &world.backend.colliders,
            &[motion],
            &world.characters,
            start,
            end,
            1 << 20,
            &mut work(),
        )
        .unwrap();
    assert_eq!(
        scene.prepare(
            &world.backend.bodies,
            &world.backend.colliders,
            &[],
            &world.characters,
            start,
            end,
            1 << 20,
            &mut work()
        ),
        Err(TrajectoryError::MissingBodyMotion)
    );
    assert!(matches!(
        scene.first_hit(
            &world.backend.colliders,
            &world.contact_policies,
            start,
            end,
            0.,
            1e-7,
            &mut work(),
            &|_, _| true
        ),
        Err(TrajectoryError::InvalidReference)
    ));
}

#[test]
fn simultaneous_box_face_census_keeps_complete_patch_and_source_bytes() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    for x in [-0.5, 0.501] {
        world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [x, 0., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.5, 1., 1.],
                }),
            )
            .unwrap();
    }
    let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut scene = Scratch::default();
    let mut allowance = work();
    scene
        .prepare(
            &world.backend.bodies,
            &world.backend.colliders,
            &[],
            &world.characters,
            0.,
            1.,
            1 << 20,
            &mut allowance,
        )
        .unwrap();
    let mut points = Vec::new();
    scene
        .contacts_at(
            &world.backend.colliders,
            &world.contact_policies,
            0.,
            0.002,
            &mut allowance,
            &|_, _| true,
            &mut |sample, _| {
                points.push(sample.contact);
                Ok(())
            },
        )
        .unwrap();
    assert!(points.len() >= 4);
    let average = points.iter().fold(rp::Vector::ZERO, |v, p| v + p.point1) / (points.len() as f32);
    assert!(average.y.abs() < 1e-6 && average.z.abs() < 1e-6);
    assert!(points
        .iter()
        .all(|p| p.dist >= 0. && p.dist <= 0.002 && p.normal1.x > 0.999));
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
}
