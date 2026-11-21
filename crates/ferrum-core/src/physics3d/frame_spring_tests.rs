use super::*;

fn setup(space: Space, dt: f32, mass: f32) -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space,
        step_seconds: dt,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = w
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::Fixed,
            ..BodyDesc::default()
        })
        .unwrap();
    let b = w
        .create_body_without_collider(BodyDesc {
            can_sleep: false,
            ..BodyDesc::default()
        })
        .unwrap();
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
    (w, a, b)
}

fn response(k: f32, d: f32) -> Option<SpringResponse> {
    Some(SpringResponse {
        stiffness: k,
        damping: d,
    })
}

fn steps(w: &mut PhysicsWorld3d, count: usize) {
    for _ in 0..count {
        w.step();
    }
}

fn near(actual: f32, expected: f32, tolerance: f32) {
    assert!(
        (actual - expected).abs() < tolerance,
        "{actual} != {expected}"
    );
}

#[test]
fn elastic_frame_has_independent_linear_and_angular_equilibria_and_physical_reactions() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for mass in [1.0, 100.0] {
            for dt in [1.0 / 60.0, 1.0 / 120.0] {
                let (mut w, a, b) = setup(space, dt, mass);
                let mut desc = JointDesc::new(a, b, JointKind::Fixed);
                desc.linear_spring = response(100.0, 20.0);
                desc.angular_spring = response(25.0, 10.0);
                let id = w.create_joint(desc).unwrap();
                let z = if space == Space::Spatial { 30.0 } else { 0.0 };
                w.add_force(
                    b,
                    [10.0 * mass, 20.0 * mass, z * mass],
                    [0.0, 0.0, 5.0 * mass],
                )
                .unwrap();
                steps(&mut w, (4.0 / dt) as usize);
                let s = w.body_state(b).unwrap();
                for (v, target) in s.pose.position.into_iter().zip([0.1, 0.2, z / 100.0]) {
                    near(v, target, 0.001);
                }
                near(
                    2.0 * s.pose.rotation[2].atan2(s.pose.rotation[3]),
                    0.2,
                    0.001,
                );
                assert!(s.linear_velocity.iter().all(|v| v.abs() < 0.001));
                assert!(s.angular_velocity.iter().all(|v| v.abs() < 0.001));
                let reaction = w.joint_state(id).unwrap();
                near(reaction.force / mass, (500.0 + z * z).sqrt(), 0.02);
                near(reaction.torque / mass, 5.0, 0.02);
            }
        }
    }
}

#[test]
fn frame_zero_gains_release_only_selected_coordinates_and_pure_damping_does_not_restore_position() {
    for angular in [false, true] {
        for damping in [0.0, 10.0] {
            let (mut w, a, b) = setup(Space::PlanarXy, 1.0 / 60.0, 1.0);
            let mut desc = JointDesc::new(a, b, JointKind::Fixed);
            if angular {
                desc.angular_spring = response(0.0, damping);
            } else {
                desc.linear_spring = response(0.0, damping);
            }
            w.create_joint(desc).unwrap();
            w.set_velocity(b, [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]).unwrap();
            steps(&mut w, 120);
            let s = w.body_state(b).unwrap();
            let target = if damping == 0.0 { 2.0 } else { 0.1 };
            if angular {
                near(w.planar_rotation(b).unwrap() as f32, target, 0.002);
                near(s.pose.position[0], 0.0, 0.001);
            } else {
                near(s.pose.position[0], target, 0.002);
                near(w.planar_rotation(b).unwrap() as f32, 0.0, 0.001);
            }
        }
    }
}

#[test]
fn frame_response_validation_is_atomic_and_updates_keep_identity() {
    let (mut w, a, b) = setup(Space::Spatial, 1.0 / 60.0, 1.0);
    let desc = JointDesc::new(a, b, JointKind::Fixed);
    let id = w.create_joint(desc.clone()).unwrap();
    for (kind, linear, angular) in [
        (JointKind::Fixed, response(f32::NAN, 1.0), None),
        (JointKind::Fixed, None, response(1.0, -1.0)),
        (
            JointKind::Distance { length: 1.0 },
            response(1.0, 1.0),
            None,
        ),
        (JointKind::Spherical, None, response(1.0, 1.0)),
    ] {
        let mut invalid = JointDesc::new(a, b, kind);
        invalid.linear_spring = linear;
        invalid.angular_spring = angular;
        assert_eq!(w.update_joint(id, invalid), Err(PhysicsError::InvalidJoint));
        assert_eq!(w.joint_desc(id).unwrap(), &desc);
    }
    let mut free = desc.clone();
    free.linear_spring = response(0.0, 0.0);
    w.update_joint(id, free).unwrap();
    w.set_velocity(b, [1.0, 0.0, 0.0], [0.0; 3]).unwrap();
    steps(&mut w, 60);
    near(w.body_state(b).unwrap().pose.position[0], 1.0, 0.002);
    w.update_joint(id, desc).unwrap();
    steps(&mut w, 120);
    near(w.body_state(b).unwrap().pose.position[0], 0.0, 0.002);
    assert_eq!(w.joint_count(), 1);
}

#[test]
fn elastic_frame_offset_anchors_report_the_actual_force_and_anchor_couple() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut w, a, b) = setup(space, 1.0 / 60.0, 1.0);
        let mut desc = JointDesc::new(a, b, JointKind::Fixed);
        desc.local_frame_a.position = [0.0, 1.0, 0.0];
        desc.local_frame_b.position = [0.0, 1.0, 0.0];
        desc.linear_spring = response(100.0, 30.0);
        desc.angular_spring = response(100.0, 30.0);
        let id = w.create_joint(desc).unwrap();
        w.add_force(b, [10.0, 0.0, 0.0], [0.0, 0.0, 5.0]).unwrap();
        steps(&mut w, 600);
        let s = w.body_state(b).unwrap();
        let angle = 2.0 * s.pose.rotation[2].atan2(s.pose.rotation[3]);
        let reaction = w.joint_state(id).unwrap();
        near(reaction.force, 10.0, 0.03);
        near(reaction.torque, 5.0 + 10.0 * angle.cos(), 0.03);
        assert!(s.linear_velocity.iter().all(|v| v.abs() < 0.001));
        assert!(
            s.angular_velocity.iter().all(|v| v.abs() < 0.001),
            "{space:?}: {s:?}, {reaction:?}"
        );
    }
}

#[test]
fn elastic_frame_breaks_by_reconstructed_angular_motor_reaction() {
    for limit in [4.0, 6.0] {
        let (mut w, a, b) = setup(Space::PlanarXy, 1.0 / 60.0, 1.0);
        let mut desc = JointDesc::new(a, b, JointKind::Fixed);
        desc.angular_spring = response(25.0, 10.0);
        let id = w.create_joint(desc.clone()).unwrap();
        w.add_force(b, [0.0; 3], [0.0, 0.0, 5.0]).unwrap();
        steps(&mut w, 240);
        desc.break_torque = Some(limit);
        w.update_joint(id, desc).unwrap();
        w.step();
        assert_eq!(w.joint_state(id).is_ok(), limit > 5.0);
        let mut events = Vec::new();
        w.drain_joint_events(&mut events);
        if limit < 5.0 {
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].joint, id);
            assert_eq!(events[0].reason, JointEventReason::TorqueLimit);
            near(events[0].reaction.torque, 5.0, 0.02);
        } else {
            assert!(events.is_empty());
        }
    }
}

#[test]
fn limited_hinge_motor_stops_and_reverses_without_a_residual_boundary_velocity() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for dt in [1.0 / 30.0, 1.0 / 60.0, 1.0 / 120.0] {
            for position_motor in [false, true] {
                let (mut w, a, b) = setup(space, dt, 1.0);
                let kind = |direction: f32| JointKind::Revolute {
                    limits: Some([-0.3, 0.4]),
                    motor: Some(JointMotor {
                        target_position: direction * 2.0,
                        target_velocity: if position_motor { 0.0 } else { direction * 2.0 },
                        stiffness: if position_motor { 100.0 } else { 0.0 },
                        damping: 20.0,
                        max_force: 10.0,
                    }),
                };
                let mut desc = JointDesc::new(a, b, kind(1.0));
                let half = std::f32::consts::FRAC_1_SQRT_2;
                desc.local_frame_a.rotation = [0.0, -half, 0.0, half];
                desc.local_frame_b.rotation = desc.local_frame_a.rotation;
                let id = w.create_joint(desc.clone()).unwrap();
                for (direction, expected) in [(1.0, 0.4), (-1.0, -0.3)] {
                    desc.kind = kind(direction);
                    w.update_joint(id, desc.clone()).unwrap();
                    steps(&mut w, (4.0 / dt) as usize);
                    let s = w.body_state(b).unwrap();
                    near(
                        2.0 * s.pose.rotation[2].atan2(s.pose.rotation[3]),
                        expected,
                        0.003,
                    );
                    near(s.angular_velocity[2], 0.0, 0.003);
                    assert!(w.joint_state(id).unwrap().torque <= 10.01);
                }
            }
        }
    }
}
