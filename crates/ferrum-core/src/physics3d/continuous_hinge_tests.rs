use super::*;

fn world(dt: f32) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        step_seconds: dt,
        ..WorldConfig::default()
    })
    .unwrap()
}

fn body(w: &mut PhysicsWorld3d, kind: BodyKind) -> BodyId {
    let id = w
        .create_body_without_collider(BodyDesc {
            kind,
            can_sleep: false,
            ..BodyDesc::default()
        })
        .unwrap();
    w.set_additional_mass_properties(
        id,
        &AdditionalMassProperties {
            mass: 1.0,
            principal_inertia: [1.0; 3],
            center: [0.0; 3],
            inertia_rotation: Pose::default().rotation,
        },
    )
    .unwrap();
    id
}

fn hinge(a: BodyId, b: BodyId, limits: [f32; 2], speed: f32) -> JointDesc {
    let mut desc = JointDesc::new(
        a,
        b,
        JointKind::ContinuousRevolute {
            limits,
            motor: Some(JointMotor {
                target_position: 0.0,
                target_velocity: speed,
                stiffness: 0.0,
                damping: 1000.0,
                max_force: 10.0,
            }),
        },
    );
    let h = std::f32::consts::FRAC_1_SQRT_2;
    desc.local_frame_a.rotation = [0.0, -h, 0.0, h];
    desc.local_frame_b.rotation = desc.local_frame_a.rotation;
    desc
}

fn steps(w: &mut PhysicsWorld3d, n: usize) {
    for _ in 0..n {
        w.step();
    }
}

fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "{actual} != {expected}"
    );
}

#[test]
fn continuous_hinge_motor_stops_at_both_multiturn_bounds_and_reverses() {
    for dt in [1.0 / 60.0, 1.0 / 120.0] {
        let mut w = world(dt);
        let a = body(&mut w, BodyKind::Fixed);
        let b = body(&mut w, BodyKind::Dynamic);
        w.set_planar_rotation(a, 31.0).unwrap();
        w.set_planar_rotation(b, 31.0).unwrap();
        let mut desc = hinge(a, b, [-14.0, 14.0], 8.0);
        let id = w.create_joint(desc.clone()).unwrap();
        steps(&mut w, (5.0 / dt) as usize);
        near(w.planar_rotation(b).unwrap(), 45.0, 0.015);
        near(
            w.body_state(b).unwrap().angular_velocity[2].into(),
            0.0,
            0.03,
        );
        if let JointKind::ContinuousRevolute { motor: Some(m), .. } = &mut desc.kind {
            m.target_velocity = -8.0;
        }
        w.update_joint(id, desc).unwrap();
        steps(&mut w, (7.0 / dt) as usize);
        near(w.planar_rotation(b).unwrap(), 17.0, 0.015);
        near(
            w.body_state(b).unwrap().angular_velocity[2].into(),
            0.0,
            0.03,
        );
    }
}

#[test]
fn continuous_hinge_recovers_large_teleports_in_the_unwrapped_direction() {
    for (initial, limits) in [-30.0, 50.0]
        .into_iter()
        .flat_map(|initial| [[12.0, 13.0], [12.5, 12.5]].map(|limits| (initial, limits)))
    {
        let mut w = world(1.0 / 60.0);
        let a = body(&mut w, BodyKind::Fixed);
        let b = body(&mut w, BodyKind::Dynamic);
        w.set_planar_rotation(b, initial).unwrap();
        let mut desc = hinge(a, b, limits, 0.0);
        if let JointKind::ContinuousRevolute { motor, .. } = &mut desc.kind {
            *motor = None;
        }
        w.create_joint(desc).unwrap();
        let before = w.planar_rotation(b).unwrap();
        w.step();
        let after = w.planar_rotation(b).unwrap();
        assert!(
            (after - before) * (12.5 - initial) > 0.0,
            "{before} -> {after}"
        );
        assert!(
            (after - before).abs() < 0.051,
            "{limits:?}: {before} -> {after}"
        );
        steps(&mut w, 1100);
        let angle = w.planar_rotation(b).unwrap();
        assert!((11.99..=13.01).contains(&angle), "{initial} -> {angle}");
        if limits[0] == limits[1] {
            near(angle, f64::from(limits[0]), 0.01);
        }
    }
}

#[test]
fn continuous_position_motor_reaches_an_authored_multiturn_target() {
    let mut w = world(1.0 / 60.0);
    let a = body(&mut w, BodyKind::Fixed);
    let b = body(&mut w, BodyKind::Dynamic);
    let mut desc = hinge(a, b, [-30.0, 30.0], 0.0);
    if let JointKind::ContinuousRevolute { motor: Some(m), .. } = &mut desc.kind {
        m.target_position = 20.0;
        m.stiffness = 20.0;
        m.damping = 10.0;
    }
    w.create_joint(desc).unwrap();
    steps(&mut w, 900);
    near(w.planar_rotation(b).unwrap(), 20.0, 0.01);
    near(
        w.body_state(b).unwrap().angular_velocity[2].into(),
        0.0,
        0.01,
    );
}

#[test]
fn continuous_hinge_limit_reaction_breaks_and_preserves_full_identity() {
    let mut w = world(1.0 / 60.0);
    let a = body(&mut w, BodyKind::Dynamic);
    let b = body(&mut w, BodyKind::Dynamic);
    w.set_planar_rotation(b, 20.0).unwrap();
    let mut desc = hinge(a, b, [20.0, 20.0], 0.0);
    if let JointKind::ContinuousRevolute { motor, .. } = &mut desc.kind {
        *motor = None;
    }
    desc.break_torque = Some(1.0);
    let id = w.create_joint(desc).unwrap();
    w.apply_torque_impulse(b, [0.0, 0.0, 10.0]).unwrap();
    w.step();
    assert_eq!(w.joint_desc(id), Err(PhysicsError::StaleJoint));
    let mut events = Vec::new();
    assert_eq!(w.drain_joint_events(&mut events), 0);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].joint, id);
    assert_eq!(events[0].reason, JointEventReason::TorqueLimit);
    assert!(events[0].reaction.torque > 100.0);
}

#[test]
fn continuous_hinge_rejects_invalid_limits_frames_and_spatial_mode_atomically() {
    let mut w = world(1.0 / 60.0);
    let a = body(&mut w, BodyKind::Fixed);
    let b = body(&mut w, BodyKind::Dynamic);
    let desc = hinge(a, b, [10.0, 20.0], 1.0);
    let id = w.create_joint(desc.clone()).unwrap();
    for limits in [
        [20.0, 10.0],
        [0.0, f32::INFINITY],
        [f32::NAN, 1.0],
        [-1e6, 1e6 + 1.0],
    ] {
        let bad = hinge(a, b, limits, 1.0);
        assert_eq!(w.update_joint(id, bad), Err(PhysicsError::InvalidJoint));
        assert_eq!(w.joint_desc(id).unwrap(), &desc);
    }
    let mut bad = desc.clone();
    bad.local_frame_b.rotation = Pose::default().rotation;
    assert_eq!(w.update_joint(id, bad), Err(PhysicsError::OutOfPlane));
    let mut spatial = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = body(&mut spatial, BodyKind::Fixed);
    let b = body(&mut spatial, BodyKind::Dynamic);
    assert_eq!(
        spatial.create_joint(hinge(a, b, [10.0, 20.0], 1.0)),
        Err(PhysicsError::OutOfPlane)
    );
    assert_eq!(spatial.joint_count(), 0);
}

#[test]
fn planar_hinge_offset_anchors_do_not_add_spurious_angular_constraints() {
    for continuous in [false, true] {
        for start in [0.3, 20.0, -37.0] {
            let mut w = world(1.0 / 60.0);
            let a = body(&mut w, BodyKind::Fixed);
            let b = body(&mut w, BodyKind::Dynamic);
            w.set_planar_rotation(a, start).unwrap();
            w.set_planar_rotation(b, start).unwrap();
            let mut desc = hinge(a, b, [-100.0, 100.0], 8.0);
            if !continuous {
                let JointKind::ContinuousRevolute { motor, .. } = desc.kind else {
                    unreachable!()
                };
                desc.kind = JointKind::Revolute {
                    limits: None,
                    motor,
                };
            }
            desc.local_frame_b.position = [-1.0, 0.0, 0.0];
            w.create_joint(desc).unwrap();
            steps(&mut w, 240);
            let angle = w.planar_rotation(b).unwrap();
            assert!(
                angle > start + 20.0,
                "continuous={continuous}, start={start}, angle={angle}"
            );
            let state = w.body_state(b).unwrap();
            near(state.angular_velocity[2].into(), 8.0, 0.02);
            near(state.pose.position[0].into(), angle.cos(), 0.005);
            near(state.pose.position[1].into(), angle.sin(), 0.005);
            assert_eq!(state.pose.position[2], 0.0);
            assert_eq!(state.angular_velocity[0..2], [0.0, 0.0]);
        }
    }
}

#[test]
fn continuous_hinge_motor_and_contact_resolve_together_before_the_angle_limit() {
    for dt in [1.0 / 60.0, 1.0 / 120.0] {
        let mut w = world(dt);
        let a = body(&mut w, BodyKind::Fixed);
        let b = body(&mut w, BodyKind::Dynamic);
        w.set_planar_rotation(a, 20.0).unwrap();
        w.set_planar_rotation(b, 20.0).unwrap();
        let mut collider = ColliderDesc::new(Shape::Sphere { radius: 0.1 });
        collider.pose.position[0] = 1.0;
        collider.density = 0.0;
        w.add_collider(b, collider).unwrap();
        let contact_angle = 21.0_f32;
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [contact_angle.cos(), contact_angle.sin(), 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.15 }),
        )
        .unwrap();
        w.create_joint(hinge(a, b, [0.0, 4.0], 8.0)).unwrap();
        steps(&mut w, (3.0 / dt) as usize);
        let angle = w.planar_rotation(b).unwrap();
        assert!((20.70..20.80).contains(&angle), "dt={dt}, angle={angle}");
        let state = w.body_state(b).unwrap();
        let x = f64::from(state.pose.position[0]) + angle.cos();
        let y = f64::from(state.pose.position[1]) + angle.sin();
        let distance =
            (x - f64::from(contact_angle.cos())).hypot(y - f64::from(contact_angle.sin()));
        assert!(distance > 0.245, "dt={dt}, distance={distance}");
        near(state.angular_velocity[2].into(), 0.0, 0.02);
        near(state.pose.position[0].into(), 0.0, 0.005);
        near(state.pose.position[1].into(), 0.0, 0.005);
    }
}

#[test]
fn continuous_hinge_uses_relative_turns_with_a_rotating_kinematic_endpoint() {
    let mut w = world(1.0 / 60.0);
    let a = body(&mut w, BodyKind::KinematicVelocity);
    let b = body(&mut w, BodyKind::Dynamic);
    w.set_planar_rotation(a, 10.0).unwrap();
    w.set_planar_rotation(b, 20.0).unwrap();
    w.set_velocity(a, [0.0; 3], [0.0, 0.0, 2.0]).unwrap();
    w.create_joint(hinge(a, b, [10.0, 11.0], 4.0)).unwrap();
    steps(&mut w, 600);
    near(w.planar_rotation(a).unwrap(), 30.0, 0.01);
    near(w.planar_rotation(b).unwrap(), 41.0, 0.02);
    near(
        w.body_state(b).unwrap().angular_velocity[2].into(),
        2.0,
        0.02,
    );
}

#[test]
fn continuous_hinge_live_teleport_and_update_keep_the_unwrapped_limit_direction() {
    let mut w = world(1.0 / 60.0);
    let a = body(&mut w, BodyKind::Fixed);
    let b = body(&mut w, BodyKind::Dynamic);
    w.set_planar_rotation(b, 10.0).unwrap();
    let desc = hinge(a, b, [10.0, 11.0], 3.0);
    let id = w.create_joint(desc.clone()).unwrap();
    steps(&mut w, 120);
    near(w.planar_rotation(b).unwrap(), 11.0, 0.01);
    w.set_planar_rotation(b, 18.0).unwrap();
    steps(&mut w, 240);
    near(w.planar_rotation(b).unwrap(), 11.0, 0.01);
    let mut updated = desc;
    if let JointKind::ContinuousRevolute { limits, motor } = &mut updated.kind {
        *limits = [25.0, 26.0];
        *motor = None;
    }
    w.update_joint(id, updated.clone()).unwrap();
    steps(&mut w, 420);
    let angle = w.planar_rotation(b).unwrap();
    assert!((24.99..=26.01).contains(&angle), "{angle}");
    assert_eq!(w.joint_desc(id).unwrap(), &updated);
}

#[test]
fn continuous_hinge_disabled_endpoint_reports_no_stale_solver_load() {
    let mut w = world(1.0 / 60.0);
    let a = body(&mut w, BodyKind::Fixed);
    let b = body(&mut w, BodyKind::Dynamic);
    w.set_planar_rotation(b, 20.0).unwrap();
    let mut desc = hinge(a, b, [20.0, 20.0], 0.0);
    if let JointKind::ContinuousRevolute { motor, .. } = &mut desc.kind {
        *motor = None;
    }
    let id = w.create_joint(desc).unwrap();
    w.add_force(b, [0.0; 3], [0.0, 0.0, 5.0]).unwrap();
    steps(&mut w, 120);
    near(w.joint_state(id).unwrap().torque.into(), 5.0, 0.02);
    let options = BodyOptions {
        kind: BodyKind::Fixed,
        enabled: false,
        ..BodyOptions::default()
    };
    w.set_body_options(a, &options).unwrap();
    steps(&mut w, 10);
    assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
    assert!(w.planar_rotation(b).unwrap() > 20.02);
    w.set_body_options(
        a,
        &BodyOptions {
            enabled: true,
            ..options
        },
    )
    .unwrap();
    steps(&mut w, 120);
    near(w.planar_rotation(b).unwrap(), 20.0, 0.01);
    near(w.joint_state(id).unwrap().torque.into(), 5.0, 0.02);
}
