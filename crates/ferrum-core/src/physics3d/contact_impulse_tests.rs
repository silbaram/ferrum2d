use super::*;
use rapier3d::prelude as rp;

fn desc(kind: BodyKind, position: [f32; 3]) -> BodyDesc {
    BodyDesc {
        kind,
        pose: Pose {
            position,
            ..Pose::default()
        },
        can_sleep: false,
        ..BodyDesc::default()
    }
}
fn fixture(shape: Shape) -> ColliderDesc {
    ColliderDesc {
        density: 0.0,
        friction: 0.6,
        ..ColliderDesc::new(shape)
    }
}
fn setup(
    space: Space,
    shape: Shape,
    limit: usize,
    gravity: f32,
) -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0, gravity, 0.0],
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap();
    let floor = w
        .create_body(
            desc(BodyKind::Fixed, [0.0, -0.5, 0.0]),
            fixture(Shape::Box {
                half_extents: [100.0, 0.5, 2.0],
            }),
        )
        .unwrap();
    let body = w
        .create_body(desc(BodyKind::Dynamic, [0.0, 0.5, 0.0]), fixture(shape))
        .unwrap();
    w.set_additional_mass_properties(
        body,
        &AdditionalMassProperties {
            mass: 2.0,
            principal_inertia: [1.0; 3],
            center: [0.0; 3],
            inertia_rotation: [0.0, 0.0, 0.0, 1.0],
        },
    )
    .unwrap();
    (w, floor, body)
}
fn dummy_joint(w: &mut PhysicsWorld3d) {
    let a = w
        .create_body_without_collider(desc(BodyKind::Fixed, [1000.0, 1000.0, 0.0]))
        .unwrap();
    let b = w
        .create_body_without_collider(desc(BodyKind::Dynamic, [1000.0, 1000.0, 0.0]))
        .unwrap();
    w.create_joint(JointDesc::new(a, b, JointKind::Fixed))
        .unwrap();
}
fn impulses(w: &PhysicsWorld3d, body: BodyId) -> ([f32; 3], Vec<ContactImpulse>) {
    let mut contacts = Vec::new();
    assert_eq!(w.contact_impulses(&mut contacts).dropped, 0);
    let mut sum = [0.0; 3];
    for c in &contacts {
        assert!(!c.first.sensor && !c.second.sensor);
        let sign = if c.second.body == body {
            1.0
        } else if c.first.body == body {
            -1.0
        } else {
            continue;
        };
        for (i, value) in sum.iter_mut().enumerate() {
            *value += sign * (c.normal[i] * c.normal_impulse + c.tangent_impulse[i]);
        }
    }
    (sum, contacts)
}
fn near(a: f32, b: f32, tol: f32) {
    assert!((a - b).abs() < tol, "{a} != {b}, tolerance {tol}");
}

#[test]
fn centered_box_wall_impact_preserves_angular_momentum_and_reports_the_full_impulse() {
    for model in [rp::FrictionModel::Simplified, rp::FrictionModel::Coulomb] {
        for direction in [-1., 1.] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                gravity: [0.; 3],
                step_seconds: 0.0863,
                ..WorldConfig::default()
            })
            .unwrap();
            w.backend.integration_parameters.friction_model = model;
            w.create_body(
                desc(BodyKind::Fixed, [1.8 * direction, 0., 0.]),
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.1, 2., 2.],
                }),
            )
            .unwrap();
            let body = w
                .create_body(
                    BodyDesc {
                        linear_velocity: [100. * direction, 0., 0.],
                        ..desc(BodyKind::Dynamic, [1.44 * direction, 0., 0.])
                    },
                    ColliderDesc::new(Shape::Box {
                        half_extents: [0.25, 1., 1.],
                    }),
                )
                .unwrap();
            w.step_checked().unwrap();
            let state = w.body_state(body).unwrap();
            let (j, contacts) = impulses(&w, body);
            assert_eq!(contacts.len(), 4, "{model:?}: {contacts:?}");
            assert_eq!(state.angular_velocity, [0.; 3], "{model:?}: {state:?}");
            near(state.pose.position[0] * direction, 1.45, 0.005);
            near(state.linear_velocity[0], 0., 0.001);
            near(
                j[0],
                2. * (state.linear_velocity[0] - 100. * direction),
                0.001,
            );
            for c in contacts {
                near(c.normal_impulse, j[0].abs() / 4., 0.001);
            }
        }
    }
}

#[test]
fn contact_impulses_resting_load_matches_momentum_without_warmstart_double_count() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for model in [rp::FrictionModel::Simplified, rp::FrictionModel::Coulomb] {
            for warmstart in [0.0, 0.5, 1.0] {
                for joint in [false, true] {
                    let (mut w, _, body) = setup(
                        space,
                        Shape::Box {
                            half_extents: [0.5; 3],
                        },
                        4096,
                        -10.0,
                    );
                    w.backend.integration_parameters.friction_model = model;
                    w.backend.integration_parameters.warmstart_coefficient = warmstart;
                    if joint {
                        dummy_joint(&mut w);
                    }
                    for _ in 0..90 {
                        w.step();
                    }
                    let before = w.body_state(body).unwrap();
                    w.step();
                    let after = w.body_state(body).unwrap();
                    let (j, contacts) = impulses(&w, body);
                    assert!(!contacts.is_empty(), "{space:?}, {model:?}, {joint}");
                    near(
                        j[1],
                        2.0 * (after.linear_velocity[1] - before.linear_velocity[1]
                            + 10.0 * w.config().step_seconds),
                        0.002,
                    );
                    assert!(
                        contacts.iter().all(|c| c.approach_speed < 0.5),
                        "{contacts:?}"
                    );
                }
            }
        }
    }
}

#[test]
fn contact_impulses_bounce_and_friction_match_momentum_for_both_models_and_substeps() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for model in [rp::FrictionModel::Simplified, rp::FrictionModel::Coulomb] {
            for joint in [false, true] {
                let (mut w, _, body) = setup(
                    space,
                    Shape::Box {
                        half_extents: [0.5; 3],
                    },
                    4096,
                    0.0,
                );
                w.backend.integration_parameters.friction_model = model;
                let cid = w.collider_ids(body).unwrap().next().unwrap();
                let mut shape = fixture(Shape::Box {
                    half_extents: [0.5; 3],
                });
                shape.restitution = 0.5;
                w.update_collider(cid, shape).unwrap();
                w.set_body_options(
                    body,
                    &BodyOptions {
                        lock_rotation: true,
                        can_sleep: false,
                        ..BodyOptions::default()
                    },
                )
                .unwrap();
                if joint {
                    dummy_joint(&mut w);
                }
                let velocity = [3.0, -6.0, 0.0];
                w.set_velocity(body, velocity, [0.0; 3]).unwrap();
                w.step();
                let (j, contacts) = impulses(&w, body);
                let after = w.body_state(body).unwrap();
                for i in 0..3 {
                    near(j[i], 2.0 * (after.linear_velocity[i] - velocity[i]), 0.003);
                }
                assert!(
                    contacts.iter().any(|c| c.approach_speed > 5.9),
                    "{contacts:?}"
                );
                assert!(j[0] < -1.0);
            }
        }
    }
}

#[test]
fn contact_impulses_include_rotational_approach_speed() {
    let (mut w, _, body) = setup(
        Space::PlanarXy,
        Shape::Box {
            half_extents: [0.5; 3],
        },
        4096,
        0.0,
    );
    w.set_velocity(body, [0.0; 3], [0.0, 0.0, 4.0]).unwrap();
    w.step();
    let (_, contacts) = impulses(&w, body);
    assert!(
        contacts
            .iter()
            .any(|c| c.approach_speed > 1.9 && c.normal_impulse > 0.1),
        "{contacts:?}"
    );
}

#[test]
fn contact_impulses_ccd_early_solve_is_retained_and_conserves_momentum() {
    for ccd_budget in [1, 4] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        w.backend.integration_parameters.max_ccd_substeps = ccd_budget;
        w.create_body(
            desc(BodyKind::Fixed, [0.0; 3]),
            fixture(Shape::Box {
                half_extents: [0.05, 10.0, 10.0],
            }),
        )
        .unwrap();
        // Stay below the independent 400 units/s solver speed cap: its momentum
        // removal is not a collision impulse. CCD can clamp the first tick's pose
        // without solving a contact until the next tick when its budget is one.
        let mut d = desc(BodyKind::Dynamic, [-2.0, 0.0, 0.0]);
        d.linear_velocity = [300.0, 0.0, 0.0];
        d.ccd = true;
        let body = w
            .create_body(d, fixture(Shape::Sphere { radius: 0.5 }))
            .unwrap();
        w.set_additional_mass_properties(
            body,
            &AdditionalMassProperties {
                mass: 2.0,
                principal_inertia: [1.0; 3],
                center: [0.0; 3],
                inertia_rotation: [0.0, 0.0, 0.0, 1.0],
            },
        )
        .unwrap();
        let mut observed_impact = false;
        for _ in 0..4 {
            let before = w.body_state(body).unwrap();
            w.step();
            let (j, contacts) = impulses(&w, body);
            let after = w.body_state(body).unwrap();
            near(
                j[0],
                2.0 * (after.linear_velocity[0] - before.linear_velocity[0]),
                0.1,
            );
            assert!(after.pose.position[0] < -0.5);
            observed_impact |= contacts.iter().any(|c| c.approach_speed > 299.0);
        }
        assert!(observed_impact);
        assert!(w.body_state(body).unwrap().linear_velocity[0] < 1.0);
    }
}

#[test]
fn contact_impulses_sleep_sensors_and_removed_contacts_do_not_replay_cached_impulses() {
    let (mut w, _, body) = setup(Space::PlanarXy, Shape::Sphere { radius: 0.5 }, 4096, -10.0);
    for _ in 0..90 {
        w.step();
    }
    assert!(!impulses(&w, body).1.is_empty());
    w.set_sleeping(body, true).unwrap();
    w.step();
    assert!(impulses(&w, body).1.is_empty());
    let cid = w.collider_ids(body).unwrap().next().unwrap();
    let mut shape = fixture(Shape::Sphere { radius: 0.5 });
    shape.sensor = true;
    w.update_collider(cid, shape).unwrap();
    w.set_sleeping(body, false).unwrap();
    w.step();
    assert!(impulses(&w, body).1.is_empty());
    w.remove_body(body).unwrap();
    w.step();
    let mut contacts = Vec::new();
    assert_eq!(
        w.contact_impulses(&mut contacts),
        ContactImpulseDiagnostics::default()
    );
}

#[test]
fn contact_impulses_capacity_and_repeated_reads_do_not_change_simulation() {
    let (mut limited, _, a) = setup(
        Space::PlanarXy,
        Shape::Box {
            half_extents: [0.5; 3],
        },
        1,
        0.0,
    );
    let (mut full, _, b) = setup(
        Space::PlanarXy,
        Shape::Box {
            half_extents: [0.5; 3],
        },
        4096,
        0.0,
    );
    limited.set_velocity(a, [0.0, -6.0, 0.0], [0.0; 3]).unwrap();
    full.set_velocity(b, [0.0, -6.0, 0.0], [0.0; 3]).unwrap();
    limited.step();
    full.step();
    assert_eq!(limited.body_state(a).unwrap(), full.body_state(b).unwrap());
    let mut contacts = Vec::new();
    let report = limited.contact_impulses(&mut contacts);
    assert_eq!(contacts.len(), 1);
    assert!(report.dropped > 0);
    assert_eq!(report.solved_contacts, report.dropped + 1);
    let first = contacts.clone();
    assert_eq!(limited.contact_impulses(&mut contacts), report);
    assert_eq!(contacts, first);
    limited.step();
    full.step();
    assert_eq!(limited.body_state(a).unwrap(), full.body_state(b).unwrap());
}
