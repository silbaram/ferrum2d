use super::*;

#[test]
fn prescribed_kinematic_linear_motion_keeps_speed_while_dynamic_bodies_are_capped() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let mut bodies = Vec::new();
        for (i, kind) in [
            BodyKind::Dynamic,
            BodyKind::KinematicVelocity,
            BodyKind::KinematicPosition,
        ]
        .into_iter()
        .enumerate()
        {
            bodies.push(
                world
                    .create_body(
                        BodyDesc {
                            kind,
                            pose: Pose {
                                position: [0.0, i as f32 * 5.0, 0.0],
                                ..Pose::default()
                            },
                            linear_velocity: [6000.0, 0.0, 0.0],
                            can_sleep: false,
                            ..BodyDesc::default()
                        },
                        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
                    )
                    .unwrap(),
            );
        }
        for tick in 1..=2 {
            world
                .set_kinematic_target(
                    bodies[2],
                    Pose {
                        position: [tick as f32 * 100.0, 10.0, 0.0],
                        ..Pose::default()
                    },
                )
                .unwrap();
            world.step();
            let dynamic = world.body_state(bodies[0]).unwrap();
            assert!(dynamic.linear_velocity[0] <= 400.001);
            for &id in &bodies[1..] {
                let state = world.body_state(id).unwrap();
                assert!(
                    (state.pose.position[0] - tick as f32 * 100.0).abs() < 0.001,
                    "{state:?}"
                );
                assert!(
                    (state.linear_velocity[0] - 6000.0).abs() < 0.01,
                    "{state:?}"
                );
            }
        }
    }
}

#[test]
fn explicit_mass_and_inertia_apply_before_first_step_and_survive_rotation_lock() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let b = w.create_body_without_collider(BodyDesc::default()).unwrap();
    w.set_additional_mass_properties(
        b,
        &AdditionalMassProperties {
            mass: 2.0,
            principal_inertia: [2.0, 2.0, 4.0],
            center: [0.0; 3],
            inertia_rotation: Pose::default().rotation,
        },
    )
    .unwrap();
    w.apply_impulse(b, [4.0, 0.0, 0.0]).unwrap();
    w.apply_torque_impulse(b, [0.0, 0.0, 8.0]).unwrap();
    assert_eq!(w.body_state(b).unwrap().linear_velocity[0], 2.0);
    assert!((w.body_state(b).unwrap().angular_velocity[2] - 2.0).abs() < 1e-5);
    let options = BodyOptions {
        lock_rotation: true,
        ..BodyOptions::default()
    };
    w.set_body_options(b, &options).unwrap();
    let before = w.body_state(b).unwrap();
    assert_eq!(
        w.set_velocity(b, [20.0, 0.0, 0.0], [0.0, 0.0, 1.0]),
        Err(PhysicsError::LockedRotation)
    );
    assert_eq!(w.body_state(b).unwrap(), before);
    w.apply_torque_impulse(b, [0.0, 0.0, 8.0]).unwrap();
    assert_eq!(w.body_state(b).unwrap().angular_velocity, [0.0; 3]);
    w.set_body_options(b, &BodyOptions::default()).unwrap();
    w.apply_torque_impulse(b, [0.0, 0.0, 8.0]).unwrap();
    assert!((w.body_state(b).unwrap().angular_velocity[2] - 2.0).abs() < 1e-5);
}

#[test]
fn disabling_and_enabling_bodies_updates_queries_before_any_step() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let b = w
        .create_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: 1.0 }),
        )
        .unwrap();
    let ray = RayCast {
        origin: [-5.0, 0.0, 0.0],
        direction: [1.0, 0.0, 0.0],
        max_distance: 10.0,
        solid: true,
    };
    let filter = QueryFilter::default();
    assert!(w.cast_ray(&ray, &filter).unwrap().is_some());
    w.set_body_options(
        b,
        &BodyOptions {
            enabled: false,
            ..BodyOptions::default()
        },
    )
    .unwrap();
    assert!(w.cast_ray(&ray, &filter).unwrap().is_none());
    w.step();
    assert!(w.cast_ray(&ray, &filter).unwrap().is_none());
    w.set_body_options(b, &BodyOptions::default()).unwrap();
    assert!(w.cast_ray(&ray, &filter).unwrap().is_some());
}

#[test]
fn invalid_mass_is_atomic_and_locked_kinematic_target_cannot_rotate() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let b = w
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::KinematicPosition,
            ..BodyDesc::default()
        })
        .unwrap();
    w.set_body_options(
        b,
        &BodyOptions {
            kind: BodyKind::KinematicPosition,
            lock_rotation: true,
            ..BodyOptions::default()
        },
    )
    .unwrap();
    let before = w.body_state(b).unwrap();
    assert_eq!(
        w.set_kinematic_target(
            b,
            Pose {
                position: [10.0, 0.0, 0.0],
                rotation: [0.0, 0.0, 1.0, 0.0]
            }
        ),
        Err(PhysicsError::LockedRotation)
    );
    assert_eq!(
        w.set_additional_mass_properties(
            b,
            &AdditionalMassProperties {
                mass: f32::NAN,
                principal_inertia: [1.0; 3],
                center: [0.0; 3],
                inertia_rotation: Pose::default().rotation
            }
        ),
        Err(PhysicsError::InvalidBody)
    );
    w.step();
    assert_eq!(w.body_state(b).unwrap(), before);
}
