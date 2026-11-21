use super::*;

fn ball() -> ColliderDesc {
    ColliderDesc::new(Shape::Sphere { radius: 0.5 })
}

fn ground(world: &mut PhysicsWorld3d) {
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0.0, -0.1, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [20.0, 0.1, 20.0],
            }),
        )
        .unwrap();
}

#[test]
fn spatial_sphere_falls_and_settles_on_ground() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    ground(&mut world);
    let id = world
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [0.0, 3.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ball(),
        )
        .unwrap();
    for _ in 0..240 {
        world.step();
    }
    let state = world.body_state(id).unwrap();
    assert!((state.pose.position[1] - 0.5).abs() < 0.025, "{state:?}");
    assert!(state.linear_velocity[1].abs() < 0.01);
}

#[test]
fn planar_direct_mutations_cannot_bypass_axis_locks() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let bad = BodyDesc {
        linear_velocity: [0.0, 0.0, 100.0],
        ..BodyDesc::default()
    };
    assert_eq!(
        world.create_body(bad, ball()),
        Err(PhysicsError::OutOfPlane)
    );
    assert_eq!(world.body_count(), 0);
    let id = world.create_body(BodyDesc::default(), ball()).unwrap();
    assert_eq!(
        world.set_velocity(id, [0.0, 0.0, 1.0], [0.0; 3]),
        Err(PhysicsError::OutOfPlane)
    );
    assert_eq!(
        world.set_velocity(id, [0.0; 3], [1.0, 0.0, 0.0]),
        Err(PhysicsError::OutOfPlane)
    );
    assert_eq!(
        world.set_pose(
            id,
            Pose {
                position: [0.0, 0.0, 1.0],
                ..Pose::default()
            }
        ),
        Err(PhysicsError::OutOfPlane)
    );
    world.apply_impulse(id, [0.0, 0.0, 100.0]).unwrap();
    for _ in 0..120 {
        world.step();
    }
    assert_eq!(world.body_state(id).unwrap().pose.position[2], 0.0);
}

#[test]
fn removed_and_cleared_handles_do_not_alias_reused_slots() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let first = world.create_body(BodyDesc::default(), ball()).unwrap();
    world.remove_body(first).unwrap();
    let second = world.create_body(BodyDesc::default(), ball()).unwrap();
    assert_ne!(first, second);
    assert_eq!(world.body_state(first), Err(PhysicsError::StaleBody));
    world.clear();
    let third = world.create_body(BodyDesc::default(), ball()).unwrap();
    assert_ne!(second, third);
    assert_eq!(
        world.set_velocity(second, [0.0; 3], [0.0; 3]),
        Err(PhysicsError::StaleBody)
    );
}

#[test]
fn invalid_inputs_are_transactional() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    assert_eq!(
        world.create_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: f32::NAN })
        ),
        Err(PhysicsError::InvalidCollider)
    );
    assert_eq!(
        world.create_body(
            BodyDesc {
                pose: Pose {
                    rotation: [0.0; 4],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ball()
        ),
        Err(PhysicsError::InvalidBody)
    );
    assert_eq!(world.body_count(), 0);
}

#[test]
fn ccd_stops_a_high_speed_sphere_at_a_thin_floor() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    ground(&mut world);
    let id = world
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [0.0, 5.0, 0.0],
                    ..Pose::default()
                },
                linear_velocity: [0.0, -1000.0, 0.0],
                ccd: true,
                ..BodyDesc::default()
            },
            ball(),
        )
        .unwrap();
    world.step();
    let y = world.body_state(id).unwrap().pose.position[1];
    assert!((0.47..1.0).contains(&y), "y={y}");
    for _ in 0..60 {
        world.step();
        let y = world.body_state(id).unwrap().pose.position[1];
        assert!(y >= 0.49, "later CCD frame penetrated floor: y={y}");
    }
    assert!(world.body_state(id).unwrap().linear_velocity[1].abs() < 0.02);
}

#[test]
fn planar_colliders_cannot_escape_the_plane_with_local_offsets() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        ..WorldConfig::default()
    })
    .unwrap();
    let mut collider = ball();
    collider.pose.position[2] = 10.0;
    assert_eq!(
        world.create_body(BodyDesc::default(), collider),
        Err(PhysicsError::OutOfPlane)
    );
    assert_eq!(world.body_count(), 0);
}

#[test]
fn capacity_and_kinematic_target_contracts() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        max_bodies: 1,
        space: Space::PlanarXy,
        ..WorldConfig::default()
    })
    .unwrap();
    let id = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ball(),
        )
        .unwrap();
    assert_eq!(
        world.create_body(BodyDesc::default(), ball()),
        Err(PhysicsError::CapacityExceeded)
    );
    assert_eq!(
        world.set_kinematic_target(
            id,
            Pose {
                position: [0.0, 0.0, 1.0],
                ..Pose::default()
            }
        ),
        Err(PhysicsError::OutOfPlane)
    );
    world
        .set_kinematic_target(
            id,
            Pose {
                position: [1.0, 2.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
    world.step();
    assert_eq!(world.body_state(id).unwrap().pose.position, [1.0, 2.0, 0.0]);
}

#[test]
fn impulse_applies_before_the_first_step() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let id = world.create_body(BodyDesc::default(), ball()).unwrap();
    world.apply_impulse(id, [1.0, 0.0, 0.0]).unwrap();
    world.step();
    let state = world.body_state(id).unwrap();
    // Unit-density radius-0.5 sphere has mass pi/6; p=1 gives velocity 6/pi.
    assert!(
        (state.linear_velocity[0] - 6.0 / std::f32::consts::PI).abs() < 0.001,
        "{state:?}"
    );
    assert!(state.pose.position[0] > 0.03);
}

#[test]
fn rejected_velocity_change_preserves_both_components() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        ..WorldConfig::default()
    })
    .unwrap();
    let id = world.create_body(BodyDesc::default(), ball()).unwrap();
    let before = world.body_state(id).unwrap();
    assert_eq!(
        world.set_velocity(id, [1.0, 0.0, 0.0], [f32::NAN, 0.0, 0.0]),
        Err(PhysicsError::InvalidBody)
    );
    assert_eq!(world.body_state(id).unwrap(), before);
}

#[test]
fn spatial_and_planar_stacks_settle_without_lateral_drift() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            ..WorldConfig::default()
        })
        .unwrap();
        ground(&mut world);
        let ids: Vec<_> = (0..8)
            .map(|i| {
                world
                    .create_body(
                        BodyDesc {
                            pose: Pose {
                                position: [0.0, 0.5 + i as f32 * 1.02, 0.0],
                                ..Pose::default()
                            },
                            ..BodyDesc::default()
                        },
                        ColliderDesc::new(Shape::Box {
                            half_extents: [0.5, 0.5, 0.5],
                        }),
                    )
                    .unwrap()
            })
            .collect();
        for _ in 0..900 {
            world.step();
        }
        for (i, id) in ids.into_iter().enumerate() {
            let state = world.body_state(id).unwrap();
            assert!(
                (state.pose.position[1] - (i as f32 + 0.5)).abs() < 0.075,
                "{space:?} body {i}: {state:?}"
            );
            assert!(
                state.pose.position[0].abs() < 0.1 && state.pose.position[2].abs() < 0.1,
                "{space:?}: {state:?}"
            );
            assert!(
                state.linear_velocity.iter().all(|v| v.abs() < 0.05),
                "{space:?}: {state:?}"
            );
        }
    }
}
