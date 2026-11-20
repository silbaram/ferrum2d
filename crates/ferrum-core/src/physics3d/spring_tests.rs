use super::*;

fn world(dt: f32, gravity: [f32; 3]) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        step_seconds: dt,
        gravity,
        ..WorldConfig::default()
    })
    .unwrap()
}

fn body(w: &mut PhysicsWorld3d, kind: BodyKind, x: f32, mass: f32) -> BodyId {
    let id = w
        .create_body_without_collider(BodyDesc {
            kind,
            pose: Pose {
                position: [x, 0.0, 0.0],
                ..Pose::default()
            },
            can_sleep: false,
            ..BodyDesc::default()
        })
        .unwrap();
    w.set_additional_mass_properties(
        id,
        &AdditionalMassProperties {
            mass,
            principal_inertia: [mass; 3],
            center: [0.0; 3],
            inertia_rotation: Pose::default().rotation,
        },
    )
    .unwrap();
    id
}

fn spring(stiffness: f32, damping: f32) -> JointKind {
    JointKind::AccelerationSpring {
        rest_length: 2.0,
        stiffness,
        damping,
    }
}

fn steps(w: &mut PhysicsWorld3d, n: usize) {
    for _ in 0..n {
        w.step();
    }
}

#[test]
fn acceleration_spring_mass_scaling_preserves_motion_and_scales_actual_force() {
    let mut trajectories = Vec::new();
    for mass in [1.0, 100.0] {
        let mut w = world(1.0 / 60.0, [10.0, 0.0, 0.0]);
        let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
        let b = body(&mut w, BodyKind::Dynamic, 3.0, mass);
        let id = w
            .create_joint(JointDesc::new(a, b, spring(100.0, 20.0)))
            .unwrap();
        let mut trajectory = Vec::new();
        for _ in 0..240 {
            w.step();
            trajectory.push(w.body_state(b).unwrap().pose.position[0]);
        }
        assert!((trajectory.last().unwrap() - 2.1).abs() < 0.002);
        assert!((w.joint_state(id).unwrap().force / mass - 10.0).abs() < 0.05);
        trajectories.push(trajectory);
    }
    for (a, b) in trajectories[0].iter().zip(&trajectories[1]) {
        assert!((a - b).abs() < 0.001);
    }
}

#[test]
fn zero_spring_and_zero_frequency_do_not_secretly_damp_velocity() {
    for kind in [
        spring(0.0, 0.0),
        JointKind::FrequencySpring {
            rest_length: 2.0,
            frequency_hz: 0.0,
            damping_ratio: 1.0,
        },
    ] {
        let mut w = world(1.0 / 60.0, [0.0; 3]);
        let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
        let b = body(&mut w, BodyKind::Dynamic, 3.0, 1.0);
        let id = w.create_joint(JointDesc::new(a, b, kind)).unwrap();
        w.set_velocity(b, [2.0, 0.0, 0.0], [0.0; 3]).unwrap();
        steps(&mut w, 60);
        let state = w.body_state(b).unwrap();
        assert!((state.pose.position[0] - 5.0).abs() < 0.002, "{state:?}");
        assert_eq!(state.linear_velocity[0], 2.0);
        assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
    }
}

#[test]
fn acceleration_spring_pure_damper_removes_motion_without_position_attraction() {
    for dt in [1.0 / 30.0, 1.0 / 60.0, 1.0 / 120.0] {
        let mut w = world(dt, [0.0; 3]);
        let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
        let b = body(&mut w, BodyKind::Dynamic, 3.0, 1.0);
        w.create_joint(JointDesc::new(a, b, spring(0.0, 10.0)))
            .unwrap();
        w.set_velocity(b, [2.0, 0.0, 0.0], [0.0; 3]).unwrap();
        steps(&mut w, (2.0 / dt).round() as usize);
        let state = w.body_state(b).unwrap();
        assert!(
            (state.pose.position[0] - 3.2).abs() < 0.002,
            "dt={dt}, {state:?}"
        );
        assert!(state.linear_velocity[0].abs() < 0.001);
    }
}

#[test]
fn acceleration_spring_invalid_updates_preserve_settings_and_zeroing_releases_body() {
    let mut w = world(1.0 / 60.0, [0.0; 3]);
    let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
    let b = body(&mut w, BodyKind::Dynamic, 3.0, 1.0);
    let desc = JointDesc::new(a, b, spring(100.0, 20.0));
    let id = w.create_joint(desc.clone()).unwrap();
    for kind in [
        spring(-1.0, 1.0),
        spring(1.0, f32::NAN),
        spring(1e6 + 1.0, 1.0),
    ] {
        assert_eq!(
            w.update_joint(id, JointDesc::new(a, b, kind)),
            Err(PhysicsError::InvalidJoint)
        );
        assert_eq!(w.joint_desc(id).unwrap(), &desc);
    }
    steps(&mut w, 120);
    w.update_joint(id, JointDesc::new(a, b, spring(0.0, 0.0)))
        .unwrap();
    w.set_velocity(b, [2.0, 0.0, 0.0], [0.0; 3]).unwrap();
    let x = w.body_state(b).unwrap().pose.position[0];
    steps(&mut w, 60);
    assert!((w.body_state(b).unwrap().pose.position[0] - x - 2.0).abs() < 0.002);
}

#[test]
fn elastic_gears_settle_phase_without_losing_the_unconstrained_coordinate() {
    for ratio in [2.0, -2.0, 0.5] {
        let mut errors = Vec::new();
        for mass in [1.0, 100.0] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                space: Space::PlanarXy,
                gravity: [0.0; 3],
                ..WorldConfig::default()
            })
            .unwrap();
            let a = body(&mut w, BodyKind::Dynamic, -2.0, mass);
            let b = body(&mut w, BodyKind::Dynamic, 2.0, mass);
            w.set_planar_rotation(b, 1.0).unwrap();
            w.create_joint(JointDesc::new(
                a,
                b,
                JointKind::Gear {
                    ratio,
                    reference_angle: 0.0,
                    spring: Some(SpringResponse {
                        stiffness: 36.0,
                        damping: 12.0,
                    }),
                },
            ))
            .unwrap();
            let mut trace = Vec::new();
            for _ in 0..240 {
                w.step();
                let aa = w.planar_rotation(a).unwrap();
                let ab = w.planar_rotation(b).unwrap();
                trace.push(ab + f64::from(ratio) * aa);
                assert!((aa - f64::from(ratio) * ab + f64::from(ratio)).abs() < 0.002);
            }
            assert!(trace.last().unwrap().abs() < 0.002);
            assert_eq!(w.body_state(a).unwrap().pose.position[0], -2.0);
            errors.push(trace);
        }
        for (a, b) in errors[0].iter().zip(&errors[1]) {
            assert!((a - b).abs() < 0.002);
        }
    }
}

#[test]
fn elastic_pulley_retains_load_dependent_stretch_and_mass_normalized_response() {
    for mass in [1.0, 100.0] {
        for slack in [false, true] {
            let mut w = world(1.0 / 60.0, [0.0, -10.0, 0.0]);
            let a = body(&mut w, BodyKind::Dynamic, -2.0, mass);
            let b = body(&mut w, BodyKind::Dynamic, 2.0, mass);
            for id in [a, b] {
                let mut pose = w.body_state(id).unwrap().pose;
                pose.position[1] = -2.0;
                w.set_pose(id, pose).unwrap();
            }
            let length = if slack { 6.0 } else { 4.0 };
            let id = w
                .create_joint(JointDesc::new(
                    a,
                    b,
                    JointKind::Pulley {
                        ground_a: [-2.0, 0.0, 0.0],
                        ground_b: [2.0, 0.0, 0.0],
                        length,
                        ratio: 1.0,
                        slack,
                        spring: Some(SpringResponse {
                            stiffness: 25.0,
                            damping: 10.0,
                        }),
                    },
                ))
                .unwrap();
            w.step();
            if slack {
                assert_eq!(w.joint_state(id).unwrap().force, 0.0);
            }
            steps(&mut w, 480);
            let distance = -w.body_state(a).unwrap().pose.position[1]
                - w.body_state(b).unwrap().pose.position[1];
            assert!(
                (distance - length - 0.8).abs() < 0.02,
                "mass={mass}, slack={slack}, length={distance}"
            );
            assert!((w.joint_state(id).unwrap().force / mass - 10.0).abs() < 0.05);
        }
    }
}

#[test]
fn elastic_gear_zero_gains_and_pure_damping_are_distinct_and_updates_are_atomic() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
    let b = body(&mut w, BodyKind::Dynamic, 0.0, 1.0);
    let desc = JointDesc::new(
        a,
        b,
        JointKind::Gear {
            ratio: 1.0,
            reference_angle: 0.0,
            spring: Some(SpringResponse {
                stiffness: 0.0,
                damping: 0.0,
            }),
        },
    );
    let id = w.create_joint(desc.clone()).unwrap();
    w.set_velocity(b, [0.0; 3], [0.0, 0.0, 2.0]).unwrap();
    steps(&mut w, 60);
    assert!((w.planar_rotation(b).unwrap() - 2.0).abs() < 0.002);
    assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
    let mut bad = desc.clone();
    if let JointKind::Gear {
        spring: Some(r), ..
    } = &mut bad.kind
    {
        r.damping = f32::NAN;
    }
    assert_eq!(w.update_joint(id, bad), Err(PhysicsError::InvalidJoint));
    assert_eq!(w.joint_desc(id).unwrap(), &desc);
    let mut damper = desc;
    if let JointKind::Gear {
        spring: Some(r), ..
    } = &mut damper.kind
    {
        r.damping = 10.0;
    }
    w.update_joint(id, damper).unwrap();
    steps(&mut w, 120);
    assert!((w.planar_rotation(b).unwrap() - 2.2).abs() < 0.002);
    assert!(w.body_state(b).unwrap().angular_velocity[2].abs() < 0.001);
}

#[test]
fn elastic_rope_is_slack_then_stretches_under_load_in_both_spaces() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [10.0, 0.0, 0.0],
            ..WorldConfig::default()
        })
        .unwrap();
        let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
        let b = body(&mut w, BodyKind::Dynamic, 1.0, 1.0);
        let id = w
            .create_joint(JointDesc::new(
                a,
                b,
                JointKind::ElasticRope {
                    max_length: 2.0,
                    spring: SpringResponse {
                        stiffness: 25.0,
                        damping: 10.0,
                    },
                },
            ))
            .unwrap();
        w.step();
        assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
        assert!(w.body_state(b).unwrap().linear_velocity[0] > 0.15);
        steps(&mut w, 480);
        let state = w.body_state(b).unwrap();
        assert!(
            (state.pose.position[0] - 2.4).abs() < 0.01,
            "{space:?}: {state:?}"
        );
        assert!(state.linear_velocity[0].abs() < 0.001);
        assert!((w.joint_state(id).unwrap().force - 10.0).abs() < 0.05);
        assert_eq!(w.joint_state(id).unwrap().torque, 0.0);
    }
}

#[test]
fn elastic_rope_zero_gains_pure_damping_and_invalid_updates_preserve_contracts() {
    let mut w = world(1.0 / 60.0, [0.0; 3]);
    let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
    let b = body(&mut w, BodyKind::Dynamic, 3.0, 1.0);
    let desc = JointDesc::new(
        a,
        b,
        JointKind::ElasticRope {
            max_length: 2.0,
            spring: SpringResponse {
                stiffness: 0.0,
                damping: 0.0,
            },
        },
    );
    let id = w.create_joint(desc.clone()).unwrap();
    let mut bad = desc.clone();
    if let JointKind::ElasticRope { spring, .. } = &mut bad.kind {
        spring.stiffness = -1.0;
    }
    assert_eq!(w.update_joint(id, bad), Err(PhysicsError::InvalidJoint));
    assert_eq!(w.joint_desc(id).unwrap(), &desc);
    w.set_velocity(b, [2.0, 0.0, 0.0], [0.0; 3]).unwrap();
    steps(&mut w, 60);
    assert!((w.body_state(b).unwrap().pose.position[0] - 5.0).abs() < 0.002);
    let mut damper = desc;
    if let JointKind::ElasticRope { spring, .. } = &mut damper.kind {
        spring.damping = 10.0;
    }
    w.update_joint(id, damper).unwrap();
    steps(&mut w, 120);
    assert!((w.body_state(b).unwrap().pose.position[0] - 5.2).abs() < 0.002);
    // A cable damper must not push against motion that makes the cable shorter.
    w.set_velocity(b, [-2.0, 0.0, 0.0], [0.0; 3]).unwrap();
    steps(&mut w, 60);
    assert!((w.body_state(b).unwrap().pose.position[0] - 3.2).abs() < 0.002);
}

#[test]
fn elastic_rope_anticipates_position_kinematic_motion_like_velocity_kinematic_motion() {
    let mut states = Vec::new();
    for kind in [BodyKind::KinematicPosition, BodyKind::KinematicVelocity] {
        let mut w = world(1.0 / 60.0, [0.0; 3]);
        let a = body(&mut w, kind, 0.0, 1.0);
        let b = body(&mut w, BodyKind::Dynamic, 3.0, 1.0);
        w.create_joint(JointDesc::new(
            a,
            b,
            JointKind::ElasticRope {
                max_length: 2.0,
                spring: SpringResponse {
                    stiffness: 0.0,
                    damping: 10.0,
                },
            },
        ))
        .unwrap();
        if kind == BodyKind::KinematicPosition {
            w.set_kinematic_target(
                a,
                Pose {
                    position: [-1.0, 0.0, 0.0],
                    ..Pose::default()
                },
            )
            .unwrap();
        } else {
            w.set_velocity(a, [-60.0, 0.0, 0.0], [0.0; 3]).unwrap();
        }
        w.step();
        assert!((w.body_state(a).unwrap().pose.position[0] + 1.0).abs() < 0.0001);
        states.push(w.body_state(b).unwrap());
    }
    assert!(states[0].linear_velocity[0] < -5.0);
    assert!(
        (states[0].linear_velocity[0] - states[1].linear_velocity[0]).abs() < 0.0001,
        "{states:?}"
    );
    assert!((states[0].pose.position[0] - states[1].pose.position[0]).abs() < 0.0001);
}

#[test]
fn elastic_gear_settles_external_torque_without_a_residual_velocity() {
    for mass in [1.0, 100.0] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let a = body(&mut w, BodyKind::Fixed, 0.0, 1.0);
        let b = body(&mut w, BodyKind::Dynamic, 0.0, mass);
        let id = w
            .create_joint(JointDesc::new(
                a,
                b,
                JointKind::Gear {
                    ratio: 1.0,
                    reference_angle: 0.0,
                    spring: Some(SpringResponse {
                        stiffness: 25.0,
                        damping: 10.0,
                    }),
                },
            ))
            .unwrap();
        w.add_force(b, [0.0; 3], [0.0, 0.0, 10.0 * mass]).unwrap();
        steps(&mut w, 480);
        assert!((w.planar_rotation(b).unwrap() - 0.4).abs() < 0.002);
        assert!(w.body_state(b).unwrap().angular_velocity[2].abs() < 0.001);
        assert!((w.joint_state(id).unwrap().torque / mass - 10.0).abs() < 0.05);
    }
}
