use super::*;
use rapier3d::prelude::FrictionModel;

fn sphere(w: &mut PhysicsWorld3d, y: f32, speed: f32, restitution: f32) -> BodyId {
    let mut c = ColliderDesc::new(Shape::Sphere { radius: 0.5 });
    c.restitution = restitution;
    w.create_body(
        BodyDesc {
            pose: Pose {
                position: [0.0, y, 0.0],
                ..Pose::default()
            },
            linear_velocity: [0.0, -speed, 0.0],
            can_sleep: false,
            ..BodyDesc::default()
        },
        c,
    )
    .unwrap()
}
fn floor(w: &mut PhysicsWorld3d) {
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [0.0, -0.5, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [5.0, 0.5, 0.5],
        }),
    )
    .unwrap();
}
#[test]
fn solver_settings_threshold_uses_approach_speed_in_both_spaces_and_friction_models() {
    for space in [Space::Spatial, Space::PlanarXy] {
        for model in [FrictionModel::Simplified, FrictionModel::Coulomb] {
            for speed in [0.5, 1.0, 1.1, 2.0] {
                let mut w = PhysicsWorld3d::new(WorldConfig {
                    space,
                    gravity: [0.0; 3],
                    ..WorldConfig::default()
                })
                .unwrap();
                w.backend.integration_parameters.friction_model = model;
                floor(&mut w);
                let b = sphere(&mut w, 0.495, speed, 0.1);
                w.set_runtime_settings(
                    [0.0; 3],
                    SolverSettings {
                        restitution_velocity_threshold: 1.0,
                        ..SolverSettings::default()
                    },
                )
                .unwrap();
                w.step();
                let s = w.body_state(b).unwrap();
                let expected = if speed > 1.0 { speed * 0.1 } else { 0.0 };
                assert!(
                    (s.linear_velocity[1] - expected).abs() < 0.005,
                    "{space:?} {model:?} {speed} {s:?}"
                );
            }
        }
    }
}

#[test]
fn solver_settings_gravity_wakes_sleeping_bodies_and_invalid_changes_are_atomic() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let b = w
        .create_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
    w.set_sleeping(b, true).unwrap();
    w.set_runtime_settings([0.0, -6.0, 0.0], SolverSettings::default())
        .unwrap();
    assert!(!w.body_state(b).unwrap().sleeping);
    w.step();
    assert!((w.body_state(b).unwrap().linear_velocity[1] + 0.1).abs() < 1e-5);
    w.set_sleeping(b, true).unwrap();
    let before = w.body_state(b).unwrap();
    let config = w.config().clone();
    for (g, s) in [
        ([0.0, 0.0, 1.0], SolverSettings::default()),
        (
            [0.0; 3],
            SolverSettings {
                velocity_iterations: 0,
                ..SolverSettings::default()
            },
        ),
        (
            [0.0; 3],
            SolverSettings {
                position_iterations: 33,
                ..SolverSettings::default()
            },
        ),
        (
            [0.0; 3],
            SolverSettings {
                restitution_velocity_threshold: f32::NAN,
                ..SolverSettings::default()
            },
        ),
    ] {
        assert!(w.set_runtime_settings(g, s).is_err());
        assert_eq!(w.body_state(b).unwrap(), before);
        assert_eq!(w.config(), &config);
    }
}

#[test]
fn solver_settings_global_ccd_switch_controls_fast_body_detection() {
    for continuous in [false, true] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.05, 5.0, 5.0],
            }),
        )
        .unwrap();
        let b = w
            .create_body(
                BodyDesc {
                    pose: Pose {
                        position: [-2.0, 0.0, 0.0],
                        ..Pose::default()
                    },
                    linear_velocity: [300.0, 0.0, 0.0],
                    ccd: true,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
            )
            .unwrap();
        w.set_runtime_settings(
            [0.0; 3],
            SolverSettings {
                continuous,
                ..SolverSettings::default()
            },
        )
        .unwrap();
        w.step();
        let x = w.body_state(b).unwrap().pose.position[0];
        if continuous {
            assert!(x < -0.15, "{x}");
        } else {
            assert!(x > 2.0, "{x}");
        }
    }
}

#[test]
fn solver_settings_more_velocity_sweeps_reduce_loaded_chain_constraint_error() {
    let run = |iterations| {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.0, -10.0, 0.0],
            solver: SolverSettings {
                velocity_iterations: iterations,
                ..SolverSettings::default()
            },
            ..WorldConfig::default()
        })
        .unwrap();
        let mut bodies = Vec::new();
        for i in 0..10 {
            let b = w
                .create_body(
                    BodyDesc {
                        kind: if i == 0 {
                            BodyKind::Fixed
                        } else {
                            BodyKind::Dynamic
                        },
                        pose: Pose {
                            position: [i as f32, 0.0, 0.0],
                            ..Pose::default()
                        },
                        can_sleep: false,
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
                )
                .unwrap();
            if let Some(&prev) = bodies.last() {
                w.create_joint(JointDesc::new(prev, b, JointKind::Distance { length: 1.0 }))
                    .unwrap();
            }
            bodies.push(b);
        }
        for _ in 0..120 {
            w.step();
        }
        bodies
            .windows(2)
            .map(|p| {
                let a = w.body_state(p[0]).unwrap().pose.position;
                let b = w.body_state(p[1]).unwrap().pose.position;
                ((a[0] - b[0]).hypot(a[1] - b[1]) - 1.0).abs()
            })
            .sum::<f32>()
    };
    let low = run(1);
    let high = run(12);
    assert!(high < low * 0.5 && high < 0.02, "low={low}, high={high}");
}

#[test]
fn solver_settings_more_relaxation_sweeps_reduce_correction_energy() {
    let run = |iterations| {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.0; 3],
            solver: SolverSettings {
                position_iterations: iterations,
                ..SolverSettings::default()
            },
            ..WorldConfig::default()
        })
        .unwrap();
        let mut bodies = Vec::new();
        for i in 0..10 {
            let b = w
                .create_body(
                    BodyDesc {
                        kind: if i == 0 {
                            BodyKind::Fixed
                        } else {
                            BodyKind::Dynamic
                        },
                        pose: Pose {
                            position: [i as f32 * 1.1, 0.0, 0.0],
                            ..Pose::default()
                        },
                        can_sleep: false,
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
                )
                .unwrap();
            if let Some(&prev) = bodies.last() {
                w.create_joint(JointDesc::new(prev, b, JointKind::Distance { length: 1.0 }))
                    .unwrap();
            }
            bodies.push(b);
        }
        w.step();
        bodies
            .iter()
            .map(|b| {
                w.body_state(*b)
                    .unwrap()
                    .linear_velocity
                    .iter()
                    .map(|v| v * v)
                    .sum::<f32>()
            })
            .sum::<f32>()
    };
    let low = run(1);
    let high = run(12);
    assert!(high < low * 0.5, "low={low}, high={high}");
}
