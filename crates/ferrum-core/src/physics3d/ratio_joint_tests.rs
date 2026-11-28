use super::*;

fn world(space: Space, gravity: [f32; 3]) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space,
        gravity,
        ..WorldConfig::default()
    })
    .unwrap()
}
fn body(w: &mut PhysicsWorld3d, kind: BodyKind, position: [f32; 3]) -> BodyId {
    let b = w
        .create_body_without_collider(BodyDesc {
            kind,
            pose: Pose {
                position,
                ..Pose::default()
            },
            can_sleep: false,
            ..BodyDesc::default()
        })
        .unwrap();
    w.set_additional_mass_properties(
        b,
        &AdditionalMassProperties {
            mass: 1.0,
            principal_inertia: [1.0; 3],
            center: [0.0; 3],
            inertia_rotation: Pose::default().rotation,
        },
    )
    .unwrap();
    b
}
fn near(a: f64, b: f64, tolerance: f64) {
    assert!((a - b).abs() < tolerance, "{a} != {b}");
}
fn steps(w: &mut PhysicsWorld3d, n: usize) {
    for _ in 0..n {
        w.step();
    }
}
fn pulley(a: BodyId, b: BodyId, ratio: f32, slack: bool) -> JointDesc {
    JointDesc::new(
        a,
        b,
        JointKind::Pulley {
            ground_a: [-2.0, 0.0, 0.0],
            ground_b: [2.0, 0.0, 0.0],
            length: 2.0 + ratio * 2.0,
            ratio,
            slack,
            spring: None,
        },
    )
}

#[test]
fn pulley_offset_attachment_reports_cable_force_without_an_anchor_couple() {
    let mut w = world(Space::PlanarXy, [0.0, -10.0, 0.0]);
    let a = body(&mut w, BodyKind::Dynamic, [-2.0, -2.0, 0.0]);
    let b = body(&mut w, BodyKind::Fixed, [2.0, -2.0, 0.0]);
    let mut desc = pulley(a, b, 1.0, false);
    desc.local_frame_a.position = [1.0, 0.0, 0.0];
    if let JointKind::Pulley { length, .. } = &mut desc.kind {
        *length = 5.0_f32.sqrt() + 2.0;
    }
    desc.break_torque = Some(0.0);
    let id = w.create_joint(desc).unwrap();
    steps(&mut w, 10);
    let state = w.joint_state(id).unwrap();
    assert!(state.force > 1.0);
    assert_eq!(state.torque, 0.0);
    assert!(w.body_state(a).unwrap().angular_velocity[2].abs() > 0.1);
}

#[test]
fn gear_enforces_positive_negative_and_fractional_ratios_through_multiple_turns() {
    for ratio in [2.0, -2.0, 0.5] {
        let mut w = world(Space::PlanarXy, [0.0; 3]);
        let a = body(&mut w, BodyKind::Dynamic, [-2.0, 0.0, 0.0]);
        let b = body(&mut w, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
        w.create_joint(JointDesc::new(
            a,
            b,
            JointKind::Gear {
                ratio,
                reference_angle: 0.0,
                spring: None,
            },
        ))
        .unwrap();
        w.set_velocity(a, [0.0; 3], [0.0, 0.0, 10.0]).unwrap();
        steps(&mut w, 600);
        let aa = w.planar_rotation(a).unwrap();
        let ab = w.planar_rotation(b).unwrap();
        assert!(aa.abs() > 10.0);
        near(ab + f64::from(ratio) * aa, 0.0, 0.002);
        near(
            f64::from(
                w.body_state(b).unwrap().angular_velocity[2]
                    + ratio * w.body_state(a).unwrap().angular_velocity[2],
            ),
            0.0,
            0.002,
        );
        assert_eq!(w.body_state(a).unwrap().pose.position, [-2.0, 0.0, 0.0]);
    }
}

#[test]
fn pulley_moves_unequal_ratios_under_gravity_in_planar_and_spatial_worlds() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut w = world(space, [0.0, -10.0, 0.0]);
        let a = body(&mut w, BodyKind::Dynamic, [-2.0, -2.0, 0.0]);
        let b = body(&mut w, BodyKind::Dynamic, [2.0, -2.0, 0.0]);
        let joint = w.create_joint(pulley(a, b, 2.0, false)).unwrap();
        steps(&mut w, 30);
        let pa = w.body_state(a).unwrap().pose.position;
        let pb = w.body_state(b).unwrap().pose.position;
        near(f64::from(-pa[1] - 2.0 * pb[1]), 6.0, 0.02);
        assert!(pa[1] < -2.2 && pb[1] > -1.9, "{pa:?} {pb:?}");
        assert!(w.joint_state(joint).unwrap().force > 10.0);
    }
}

#[test]
fn slack_pulley_preserves_free_fall_until_taut_without_pushing_short_cables() {
    let mut w = world(Space::PlanarXy, [0.0, -10.0, 0.0]);
    let a = body(&mut w, BodyKind::Dynamic, [-2.0, -1.0, 0.0]);
    let b = body(&mut w, BodyKind::Dynamic, [2.0, -1.0, 0.0]);
    let joint = w.create_joint(pulley(a, b, 1.0, true)).unwrap();
    steps(&mut w, 5);
    near(
        f64::from(w.body_state(a).unwrap().linear_velocity[1]),
        -10.0 / 12.0,
        0.002,
    );
    assert_eq!(w.joint_state(joint).unwrap().force, 0.0);
    steps(&mut w, 115);
    let pa = w.body_state(a).unwrap().pose.position;
    let pb = w.body_state(b).unwrap().pose.position;
    near(f64::from(-pa[1] - pb[1]), 4.0, 0.02);
}

#[test]
fn ratio_joints_break_by_substep_reaction_and_keep_generational_lifecycle() {
    for gear in [true, false] {
        let mut w = world(Space::PlanarXy, [0.0; 3]);
        let a = body(&mut w, BodyKind::Dynamic, [-2.0, -2.0, 0.0]);
        let b = body(&mut w, BodyKind::Dynamic, [2.0, -2.0, 0.0]);
        let mut desc = if gear {
            JointDesc::new(
                a,
                b,
                JointKind::Gear {
                    ratio: 2.0,
                    reference_angle: 0.0,
                    spring: None,
                },
            )
        } else {
            pulley(a, b, 1.0, false)
        };
        if gear {
            desc.break_torque = Some(1.0);
        } else {
            desc.break_force = Some(1.0);
        }
        let id = w.create_joint(desc.clone()).unwrap();
        if gear {
            w.apply_torque_impulse(a, [0.0, 0.0, 10.0]).unwrap();
        } else {
            w.apply_impulse(a, [0.0, -10.0, 0.0]).unwrap();
        }
        w.step();
        assert_eq!(w.joint_state(id), Err(PhysicsError::StaleJoint));
        let mut events = Vec::new();
        assert_eq!(w.drain_joint_events(&mut events), 0);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].reason,
            if gear {
                JointEventReason::TorqueLimit
            } else {
                JointEventReason::ForceLimit
            }
        );
        let next = w.create_joint(desc).unwrap();
        assert_ne!(next, id);
        w.remove_body(a).unwrap();
        w.drain_joint_events(&mut events);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].reason, JointEventReason::BodyRemoved);
    }
}

#[test]
fn invalid_ratio_updates_and_disabled_constraints_preserve_free_motion() {
    let mut w = world(Space::PlanarXy, [0.0; 3]);
    let a = body(&mut w, BodyKind::Dynamic, [-2.0, 0.0, 0.0]);
    let b = body(&mut w, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
    let mut desc = JointDesc::new(
        a,
        b,
        JointKind::Gear {
            ratio: 1.0,
            reference_angle: 0.0,
            spring: None,
        },
    );
    desc.enabled = false;
    let id = w.create_joint(desc.clone()).unwrap();
    let mut bad = desc.clone();
    bad.kind = JointKind::Gear {
        ratio: f32::NAN,
        reference_angle: 0.0,
        spring: None,
    };
    assert_eq!(w.update_joint(id, bad), Err(PhysicsError::InvalidJoint));
    assert_eq!(w.joint_desc(id).unwrap(), &desc);
    w.set_velocity(a, [0.0; 3], [0.0, 0.0, 3.0]).unwrap();
    steps(&mut w, 60);
    near(w.planar_rotation(a).unwrap(), 3.0, 0.001);
    near(w.planar_rotation(b).unwrap(), 0.0, 0.001);
    assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
}

#[test]
fn authored_multi_turn_angle_survives_translation_teleport_and_native_steps() {
    let mut w = world(Space::PlanarXy, [0.0; 3]);
    let a = body(&mut w, BodyKind::Dynamic, [0.0; 3]);
    w.set_planar_rotation(a, 20.0).unwrap();
    w.set_velocity(a, [1.0, 0.0, 0.0], [0.0, 0.0, 2.0]).unwrap();
    steps(&mut w, 60);
    near(w.planar_rotation(a).unwrap(), 22.0, 0.001);
    w.remove_body(a).unwrap();
    assert_eq!(w.planar_rotation(a), Err(PhysicsError::StaleBody));
}

#[test]
fn pulley_contact_response_bounds_floor_penetration_and_weighted_length_after_impact() {
    let mut w = world(Space::PlanarXy, [0.0, -10.0, 0.0]);
    let a = body(&mut w, BodyKind::Dynamic, [-2.0, -2.0, 0.0]);
    let b = body(&mut w, BodyKind::Dynamic, [2.0, -2.0, 0.0]);
    for id in [a, b] {
        let mut collider = ColliderDesc::new(Shape::Sphere { radius: 0.25 });
        collider.density = 0.0;
        w.add_collider(id, collider).unwrap();
    }
    let floor = body(&mut w, BodyKind::Fixed, [-2.0, -3.0, 0.0]);
    w.add_collider(
        floor,
        ColliderDesc::new(Shape::Box {
            half_extents: [1.0, 0.1, 0.5],
        }),
    )
    .unwrap();
    w.create_joint(pulley(a, b, 1.0, false)).unwrap();
    w.apply_impulse(a, [0.0, -6.0, 0.0]).unwrap();
    let mut penetration = 0.0_f32;
    let mut length_error = 0.0_f32;
    for _ in 0..300 {
        w.step();
        let pa = w.body_state(a).unwrap().pose.position;
        let pb = w.body_state(b).unwrap().pose.position;
        penetration = penetration.max(-2.65 - pa[1]);
        length_error = length_error.max((-pa[1] - pb[1] - 4.0).abs());
    }
    assert!(penetration < 0.015, "penetration={penetration}");
    assert!(length_error < 0.04, "length error={length_error}");
    assert!(
        w.body_state(a).unwrap().linear_velocity[1].abs() < 0.05,
        "a={:?} b={:?} penetration={penetration} error={length_error}",
        w.body_state(a).unwrap(),
        w.body_state(b).unwrap()
    );
}

#[test]
fn frequency_spring_normalizes_dynamic_mass_and_damps_toward_rest_length() {
    let mut trajectories = Vec::new();
    for mass in [1.0, 100.0] {
        let mut w = world(Space::PlanarXy, [0.0; 3]);
        let a = body(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = body(&mut w, BodyKind::Dynamic, [3.0, 0.0, 0.0]);
        w.set_additional_mass_properties(
            b,
            &AdditionalMassProperties {
                mass,
                principal_inertia: [mass; 3],
                center: [0.0; 3],
                inertia_rotation: Pose::default().rotation,
            },
        )
        .unwrap();
        w.create_joint(JointDesc::new(
            a,
            b,
            JointKind::FrequencySpring {
                rest_length: 2.0,
                frequency_hz: 2.0,
                damping_ratio: 1.0,
            },
        ))
        .unwrap();
        let mut positions = Vec::new();
        for _ in 0..120 {
            w.step();
            positions.push(w.body_state(b).unwrap().pose.position[0]);
        }
        near(f64::from(*positions.last().unwrap()), 2.0, 0.002);
        trajectories.push(positions);
    }
    for (a, b) in trajectories[0].iter().zip(&trajectories[1]) {
        near(f64::from(*a), f64::from(*b), 0.001);
    }
}

#[test]
fn pulley_wall_keeps_a_full_rapier_tick_in_rigid_kcc_and_path_worlds() {
    for mode in ["rigid", "kcc", "path"] {
        for wall in [false, true] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                gravity: [0.; 3],
                step_seconds: 0.1,
                ..Default::default()
            })
            .unwrap();
            let ball = w
                .create_body(
                    BodyDesc {
                        can_sleep: false,
                        ..Default::default()
                    },
                    ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
                )
                .unwrap();
            let anchor = body(&mut w, BodyKind::Fixed, [4., 2., 0.]);
            let witness = body(&mut w, BodyKind::Dynamic, [0., 10., 0.]);
            w.set_velocity(witness, [4., 0., 0.], [0.; 3]).unwrap();
            w.create_joint(JointDesc::new(
                ball,
                anchor,
                JointKind::Pulley {
                    ground_a: [2., 0., 0.],
                    ground_b: [4., 4., 0.],
                    length: 3.,
                    ratio: 1.,
                    slack: false,
                    spring: None,
                },
            ))
            .unwrap();
            let wall_face = 0.501;
            if wall {
                w.create_body(
                    BodyDesc {
                        kind: BodyKind::Fixed,
                        pose: Pose {
                            position: [wall_face + 0.05, 0., 0.],
                            ..Default::default()
                        },
                        ..Default::default()
                    },
                    ColliderDesc::new(Shape::Box {
                        half_extents: [0.05, 1., 1.],
                    }),
                )
                .unwrap();
            }
            if mode == "kcc" {
                let rider = w
                    .create_body(
                        BodyDesc {
                            kind: BodyKind::KinematicPosition,
                            pose: Pose {
                                position: [0., 30., 0.],
                                ..Default::default()
                            },
                            ..Default::default()
                        },
                        ColliderDesc::new(Shape::Capsule {
                            half_height: 0.25,
                            radius: 0.25,
                        }),
                    )
                    .unwrap();
                w.enable_character(rider, CharacterConfig::default())
                    .unwrap();
            }
            if mode == "path" {
                let platform = body(&mut w, BodyKind::KinematicPosition, [20., 0., 20.]);
                let target = Pose {
                    position: [20.2, 0., 20.],
                    ..Default::default()
                };
                w.step_with_kinematic_paths(&[KinematicPath {
                    body: platform,
                    sweep_sensors: false,
                    knots: vec![(1., target)],
                }])
                .unwrap();
                assert_eq!(w.body_state(platform).unwrap().pose, target);
                assert_eq!(w.kinematic_path_progress_precise(platform), (1., false));
            } else {
                w.step_checked().unwrap();
            }
            assert_eq!(w.step_statistics().backend_steps, 4, "{mode} wall={wall}");

            near(
                f64::from(w.body_state(witness).unwrap().pose.position[0]),
                0.4,
                1e-6,
            );
            let x = w.body_state(ball).unwrap().pose.position[0];
            if wall {
                let tolerance = w.backend.integration_parameters.allowed_linear_error();
                assert!(
                    x + 0.5 <= wall_face + tolerance + 1e-6,
                    "{mode}: ball x={x}"
                );
                assert!(w.ratio_tick.skipped_corrections > 0, "{mode}");
            } else {
                near(f64::from(x), 0.3000001, 1e-6);
                assert_eq!(w.ratio_tick.skipped_corrections, 0);
            }
        }
    }
}
