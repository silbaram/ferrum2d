use super::*;
use rapier3d::prelude as rp;

fn world(space: Space, gravity: [f32; 3]) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space,
        gravity,
        ..WorldConfig::default()
    })
    .unwrap()
}

fn cube(world: &mut PhysicsWorld3d, kind: BodyKind, position: [f32; 3]) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position,
                    ..Pose::default()
                },
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap()
}

fn motor(position: f32, velocity: f32, stiffness: f32, max_force: f32) -> JointMotor {
    JointMotor {
        target_position: position,
        target_velocity: velocity,
        stiffness,
        damping: 20.0,
        max_force,
    }
}

fn hinge_frames(desc: &mut JointDesc) {
    // Joint local X points along world Z in both bodies; local Y stays world Y.
    let rotation = rp::Rotation::from_rotation_y(-std::f32::consts::FRAC_PI_2).to_array();
    desc.local_frame_a.rotation = rotation;
    desc.local_frame_b.rotation = rotation;
}

fn steps(world: &mut PhysicsWorld3d, count: usize) {
    for _ in 0..count {
        world.step();
    }
}

#[test]
fn fixed_joint_reaction_matches_external_wrench_at_offset_anchors() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for dt in [1.0 / 60.0, 1.0 / 120.0] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                space,
                step_seconds: dt,
                gravity: [0.0; 3],
                ..WorldConfig::default()
            })
            .unwrap();
            let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
            let b = cube(&mut w, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
            let rotation = if space == Space::Spatial {
                rp::Rotation::from_rotation_x(0.7) * rp::Rotation::from_rotation_z(0.4)
            } else {
                rp::Rotation::from_rotation_z(0.4)
            };
            let mut pose = w.body_state(b).unwrap().pose;
            pose.rotation = rotation.to_array();
            w.set_pose(b, pose).unwrap();
            let mut desc = JointDesc::new(a, b, JointKind::Fixed);
            desc.local_frame_b.position =
                (rotation.inverse() * rp::Vector::new(-2.0, 0.0, 0.0)).to_array();
            desc.local_frame_b.rotation = rotation.inverse().to_array();
            let id = w.create_joint(desc).unwrap();
            w.add_force(b, [0.0, 10.0, 0.0], [0.0, 0.0, 5.0]).unwrap();
            steps(&mut w, 240);
            let load = w.joint_state(id).unwrap();
            assert!(
                (load.force - 10.0).abs() < 0.05,
                "{space:?}, dt={dt}, {load:?}"
            );
            // 5 units of external couple + 10 units of force at a two-unit lever arm.
            assert!(
                (load.torque - 25.0).abs() < 0.1,
                "{space:?}, dt={dt}, {load:?}"
            );
            assert!((w.body_state(b).unwrap().pose.position[0] - 2.0).abs() < 0.01);
        }
    }
}

#[test]
fn fixed_joint_torque_threshold_uses_physical_couple_instead_of_raw_quaternion_impulse() {
    for threshold in [4.0, 6.0] {
        let mut w = world(Space::Spatial, [0.0; 3]);
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
        let mut desc = JointDesc::new(a, b, JointKind::Fixed);
        desc.break_torque = Some(threshold);
        let id = w.create_joint(desc).unwrap();
        w.add_force(b, [0.0; 3], [0.0, 0.0, 5.0]).unwrap();
        steps(&mut w, 10);
        if threshold < 5.0 {
            assert_eq!(w.joint_state(id), Err(PhysicsError::StaleJoint));
            let mut events = Vec::new();
            w.drain_joint_events(&mut events);
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].reason, JointEventReason::TorqueLimit);
            assert!((events[0].reaction.torque - 5.0).abs() < 0.02);
        } else {
            assert!((w.joint_state(id).unwrap().torque - 5.0).abs() < 0.02);
        }
    }
}

#[test]
fn fixed_frames_hold_pose_and_reaction_uses_solver_substep_units() {
    for dt in [1.0 / 60.0, 1.0 / 120.0] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            step_seconds: dt,
            gravity: [0.0, -10.0, 0.0],
            ..WorldConfig::default()
        })
        .unwrap();
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
        let mut desc = JointDesc::new(a, b, JointKind::Fixed);
        desc.local_frame_a.position[0] = 2.0;
        let joint = w.create_joint(desc).unwrap();
        steps(&mut w, 240);
        let state = w.body_state(b).unwrap();
        assert!(
            (state.pose.position[0] - 2.0).abs() < 0.001 && state.pose.position[1].abs() < 0.01,
            "{state:?}"
        );
        let reaction = w.joint_state(joint).unwrap();
        assert!((reaction.force - 10.0).abs() < 0.1, "dt={dt}, {reaction:?}");
        assert!(reaction.torque < 0.01, "{reaction:?}");
    }
}

#[test]
fn spherical_joint_keeps_anchors_together_while_body_swings() {
    let mut w = world(Space::Spatial, [0.0, -10.0, 0.0]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0, -2.0, 0.0]);
    let mut desc = JointDesc::new(a, b, JointKind::Spherical);
    desc.local_frame_b.position[1] = 2.0;
    w.create_joint(desc).unwrap();
    w.apply_impulse(b, [3.0, 0.0, 1.0]).unwrap();
    let mut max_x = 0.0_f32;
    for _ in 0..240 {
        w.step();
        let s = w.body_state(b).unwrap();
        let anchor = rp::Vector::from(s.pose.position)
            + rp::Rotation::from_array(s.pose.rotation) * rp::Vector::new(0.0, 2.0, 0.0);
        assert!(anchor.length() < 0.035, "anchor={anchor:?}");
        max_x = max_x.max(s.pose.position[0].abs());
    }
    assert!(max_x > 0.5);
}

#[test]
fn distance_preserves_length_and_rope_is_slack_until_stretched() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut w = world(space, [0.0; 3]);
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
        w.create_joint(JointDesc::new(a, b, JointKind::Distance { length: 2.0 }))
            .unwrap();
        w.apply_impulse(b, [0.0, 2.0, 0.0]).unwrap();
        for _ in 0..240 {
            w.step();
            let p = w.body_state(b).unwrap().pose.position;
            assert!((rp::Vector::from(p).length() - 2.0).abs() < 0.035, "{p:?}");
            assert_eq!(p[2], 0.0);
        }
        w.clear();
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [1.0, 0.0, 0.0]);
        let joint = w
            .create_joint(JointDesc::new(a, b, JointKind::Rope { max_length: 2.0 }))
            .unwrap();
        w.set_velocity(b, [1.0, 0.0, 0.0], [0.0; 3]).unwrap();
        steps(&mut w, 30);
        assert!((w.body_state(b).unwrap().pose.position[0] - 1.5).abs() < 0.01);
        assert!(w.joint_state(joint).unwrap().force < 0.01);
        steps(&mut w, 150);
        assert!((w.body_state(b).unwrap().pose.position[0] - 2.0).abs() < 0.02);
    }
}

#[test]
fn damped_spring_converges_without_locking_orientation() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [4.0, 0.0, 0.0]);
    w.create_joint(JointDesc::new(
        a,
        b,
        JointKind::Spring {
            rest_length: 2.0,
            stiffness: 40.0,
            damping: 8.0,
        },
    ))
    .unwrap();
    w.set_velocity(b, [0.0; 3], [0.0, 1.0, 0.0]).unwrap();
    steps(&mut w, 240);
    let s = w.body_state(b).unwrap();
    assert!((s.pose.position[0] - 2.0).abs() < 0.01, "{s:?}");
    assert!(s.linear_velocity[0].abs() < 0.01);
    assert!((s.angular_velocity[1] - 1.0).abs() < 0.01);
}

#[test]
fn hinge_motor_obeys_both_limits_in_spatial_and_planar_worlds() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut w = world(space, [0.0; 3]);
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
        let mut desc = JointDesc::new(
            a,
            b,
            JointKind::Revolute {
                limits: Some([-0.3, 0.4]),
                motor: Some(motor(0.0, 2.0, 0.0, 20.0)),
            },
        );
        hinge_frames(&mut desc);
        let joint = w.create_joint(desc.clone()).unwrap();
        for target in [0.4_f32, -0.3] {
            if target < 0.0 {
                desc.kind = JointKind::Revolute {
                    limits: Some([-0.3, 0.4]),
                    motor: Some(motor(0.0, -2.0, 0.0, 20.0)),
                };
                w.update_joint(joint, desc.clone()).unwrap();
            }
            steps(&mut w, 120);
            let s = w.body_state(b).unwrap();
            let angle = 2.0 * s.pose.rotation[2].atan2(s.pose.rotation[3]);
            assert!(
                (angle - target).abs() < 0.03,
                "{space:?}: target={target} {s:?}"
            );
            assert!(rp::Vector::from(s.pose.position).length() < 0.001);
            assert!(s.pose.rotation[0].abs() < 0.001 && s.pose.rotation[1].abs() < 0.001);
        }
    }
}

#[test]
fn slider_motor_obeys_rotated_frame_and_translation_limit() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut w = world(space, [0.0; 3]);
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
        let mut desc = JointDesc::new(
            a,
            b,
            JointKind::Prismatic {
                limits: Some([0.0, 1.0]),
                motor: Some(motor(2.0, 0.0, 40.0, 100.0)),
            },
        );
        let rotation = rp::Rotation::from_rotation_z(std::f32::consts::FRAC_PI_2).to_array();
        desc.local_frame_a.rotation = rotation;
        desc.local_frame_b.rotation = rotation;
        w.create_joint(desc).unwrap();
        for _ in 0..180 {
            w.step();
            let s = w.body_state(b).unwrap();
            assert!(
                s.pose.position[0].abs() < 0.001 && s.pose.position[2].abs() < 0.001,
                "{s:?}"
            );
            assert!((-0.02..=1.035).contains(&s.pose.position[1]), "{s:?}");
        }
        assert!((w.body_state(b).unwrap().pose.position[1] - 1.0).abs() < 0.02);
    }
}

#[test]
fn actuator_force_cap_and_motor_reaction_are_measured() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let joint = w
        .create_joint(JointDesc::new(
            a,
            b,
            JointKind::Prismatic {
                limits: None,
                motor: Some(motor(0.0, 100.0, 0.0, 3.0)),
            },
        ))
        .unwrap();
    w.step();
    assert!((w.body_state(b).unwrap().linear_velocity[0] - 0.05).abs() < 0.002);
    assert!((w.joint_state(joint).unwrap().force - 3.0).abs() < 0.01);
}

#[test]
fn break_events_cover_constraint_motor_and_limit_impulses() {
    for case in 0..4 {
        let mut w = world(Space::Spatial, [0.0; 3]);
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
        let mut desc = JointDesc::new(a, b, JointKind::Fixed);
        desc.break_force = Some(1.0);
        desc.break_torque = Some(1.0);
        let expected = match case {
            0 => {
                w.add_force(b, [10.0, 0.0, 0.0], [0.0; 3]).unwrap();
                JointEventReason::ForceLimit
            }
            1 => {
                w.add_force(b, [0.0; 3], [0.0, 10.0, 0.0]).unwrap();
                JointEventReason::TorqueLimit
            }
            2 => {
                desc.kind = JointKind::Prismatic {
                    limits: None,
                    motor: Some(motor(0.0, 10.0, 0.0, 3.0)),
                };
                JointEventReason::ForceLimit
            }
            _ => {
                desc.kind = JointKind::Prismatic {
                    limits: Some([0.0, 0.0]),
                    motor: None,
                };
                w.set_velocity(b, [10.0, 0.0, 0.0], [0.0; 3]).unwrap();
                JointEventReason::ForceLimit
            }
        };
        let id = w.create_joint(desc).unwrap();
        w.step();
        assert_eq!(
            w.joint_count(),
            0,
            "case={case}, state={:?}",
            w.joint_state(id)
        );
        assert_eq!(w.joint_state(id), Err(PhysicsError::StaleJoint));
        let mut events = Vec::new();
        assert_eq!(w.drain_joint_events(&mut events), 0);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].reason, expected);
        assert_eq!(
            (events[0].joint, events[0].body_a, events[0].body_b),
            (id, a, b)
        );
        w.step();
        w.drain_joint_events(&mut events);
        assert!(events.is_empty());
    }
}

#[test]
fn joint_lifecycle_preserves_generations_and_clear_invalidates_all() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let desc = JointDesc::new(a, b, JointKind::Fixed);
    let old = w.create_joint(desc.clone()).unwrap();
    w.remove_joint(old).unwrap();
    let next = w.create_joint(desc).unwrap();
    assert_ne!(old, next);
    assert_eq!(w.remove_joint(old), Err(PhysicsError::StaleJoint));
    w.remove_body(a).unwrap();
    assert_eq!(w.joint_count(), 0);
    assert_eq!(w.joint_desc(next), Err(PhysicsError::StaleJoint));
    let new_a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let third = w
        .create_joint(JointDesc::new(new_a, b, JointKind::Fixed))
        .unwrap();
    w.clear();
    assert_eq!(w.joint_state(third), Err(PhysicsError::StaleJoint));
    let mut events = Vec::new();
    assert_eq!(w.drain_joint_events(&mut events), 0);
    assert_eq!(
        events.iter().map(|e| e.reason).collect::<Vec<_>>(),
        vec![
            JointEventReason::Removed,
            JointEventReason::BodyRemoved,
            JointEventReason::BodyRemoved
        ]
    );
    assert_eq!(events[1].body_a, a);
    assert_eq!(events[2].body_a, new_a);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let fourth = w
        .create_joint(JointDesc::new(a, b, JointKind::Fixed))
        .unwrap();
    assert_ne!(third, fourth);
}

#[test]
fn invalid_joint_input_and_updates_leave_live_state_unchanged() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
    let desc = JointDesc::new(a, b, JointKind::Distance { length: 2.0 });
    let id = w.create_joint(desc.clone()).unwrap();
    let invalid_kinds = [
        JointKind::Distance { length: -1.0 },
        JointKind::Rope { max_length: 0.0 },
        JointKind::Spring {
            rest_length: 1.0,
            stiffness: f32::NAN,
            damping: 0.0,
        },
        JointKind::Revolute {
            limits: Some([-4.0, 0.0]),
            motor: None,
        },
        JointKind::Prismatic {
            limits: Some([2.0, 1.0]),
            motor: None,
        },
        JointKind::Prismatic {
            limits: None,
            motor: Some(motor(0.0, f32::INFINITY, 0.0, 1.0)),
        },
    ];
    for kind in invalid_kinds {
        let mut bad = desc.clone();
        bad.kind = kind;
        assert_eq!(w.update_joint(id, bad), Err(PhysicsError::InvalidJoint));
        assert_eq!(w.joint_desc(id).unwrap(), &desc);
        assert_eq!(w.joint_count(), 1);
    }
    for mode in 0..4 {
        let mut bad = desc.clone();
        match mode {
            0 => bad.body_b = a,
            1 => bad.local_frame_a.rotation = [0.0; 4],
            2 => bad.local_frame_b.position[0] = f32::NAN,
            _ => bad.break_force = Some(f32::INFINITY),
        }
        assert_eq!(w.create_joint(bad), Err(PhysicsError::InvalidJoint));
    }
    w.remove_body(b).unwrap();
    assert_eq!(w.create_joint(desc), Err(PhysicsError::StaleBody));
}

#[test]
fn planar_joint_axes_and_anchors_cannot_request_forbidden_motion() {
    let mut w = world(Space::PlanarXy, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let mut desc = JointDesc::new(
        a,
        b,
        JointKind::Revolute {
            limits: None,
            motor: None,
        },
    );
    assert_eq!(w.create_joint(desc.clone()), Err(PhysicsError::OutOfPlane));
    hinge_frames(&mut desc);
    let id = w.create_joint(desc.clone()).unwrap();
    let mut opposite = desc.clone();
    opposite.local_frame_b.rotation =
        rp::Rotation::from_rotation_y(std::f32::consts::FRAC_PI_2).to_array();
    assert_eq!(w.update_joint(id, opposite), Err(PhysicsError::OutOfPlane));
    desc.local_frame_b.position[2] = 0.01;
    assert_eq!(w.update_joint(id, desc), Err(PhysicsError::OutOfPlane));
    assert_eq!(w.joint_count(), 1);
}

#[test]
fn joint_capacity_and_event_overflow_are_explicit() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        max_joints: 1,
        max_events: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let desc = JointDesc::new(a, b, JointKind::Fixed);
    let id = w.create_joint(desc.clone()).unwrap();
    assert_eq!(
        w.create_joint(desc.clone()),
        Err(PhysicsError::CapacityExceeded)
    );
    w.remove_joint(id).unwrap();
    let next = w.create_joint(desc).unwrap();
    w.remove_joint(next).unwrap();
    let mut events = Vec::new();
    assert_eq!(w.drain_joint_events(&mut events), 1);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].joint, id);
    assert_eq!(w.drain_joint_events(&mut events), 0);
    assert!(events.is_empty());
}

#[test]
fn disabling_joint_releases_body_and_update_resets_reaction() {
    let mut w = world(Space::Spatial, [0.0, -10.0, 0.0]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let mut desc = JointDesc::new(a, b, JointKind::Fixed);
    let id = w.create_joint(desc.clone()).unwrap();
    steps(&mut w, 30);
    assert!(w.joint_state(id).unwrap().force > 9.0);
    desc.enabled = false;
    w.update_joint(id, desc.clone()).unwrap();
    assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
    steps(&mut w, 30);
    assert!(w.body_state(b).unwrap().pose.position[1] < -1.0);
    assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
    desc.enabled = true;
    w.update_joint(id, desc).unwrap();
    steps(&mut w, 120);
    assert!(w.body_state(b).unwrap().pose.position[1].abs() < 0.01);
}

#[test]
fn connected_contact_setting_updates_collision_events_without_duplicates() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let mut desc = JointDesc::new(a, b, JointKind::Fixed);
    let id = w.create_joint(desc.clone()).unwrap();
    w.step();
    let mut events = Vec::new();
    w.drain_collision_events(&mut events);
    assert!(events.is_empty());
    desc.contacts_enabled = true;
    w.update_joint(id, desc.clone()).unwrap();
    w.step();
    w.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].phase, CollisionPhase::Enter);
    desc.contacts_enabled = false;
    w.update_joint(id, desc).unwrap();
    w.step();
    w.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].phase, CollisionPhase::Exit);
}

#[test]
fn substeps_preserve_kinematic_translation_rotation_and_query_targets() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::KinematicPosition, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
    let c = cube(&mut w, BodyKind::KinematicVelocity, [0.0, 5.0, 0.0]);
    w.set_velocity(c, [2.0, 0.0, 0.0], [0.0, 0.0, 0.5]).unwrap();
    let mut desc = JointDesc::new(a, b, JointKind::Fixed);
    desc.local_frame_a.position[0] = 2.0;
    w.create_joint(desc).unwrap();
    for tick in 1..=120 {
        let t = tick as f32 / 60.0;
        let rotation = rp::Rotation::from_rotation_z(t * 0.5);
        let position = [t * 2.0, 0.0, 0.0];
        w.set_kinematic_target(
            a,
            Pose {
                position,
                rotation: rotation.to_array(),
            },
        )
        .unwrap();
        w.cast_ray(
            &RayCast {
                origin: [-4.0, 0.0, 0.0],
                direction: [1.0, 0.0, 0.0],
                max_distance: 20.0,
                solid: true,
            },
            &QueryFilter::default(),
        )
        .unwrap();
        w.step();
        let state = w.body_state(a).unwrap();
        assert!((state.pose.position[0] - t * 2.0).abs() < 1.0e-5);
        assert!((state.linear_velocity[0] - 2.0).abs() < 0.001, "{state:?}");
        assert!((state.angular_velocity[2] - 0.5).abs() < 0.001, "{state:?}");
        let expected = rp::Vector::from(position) + rotation * rp::Vector::new(2.0, 0.0, 0.0);
        let actual = rp::Vector::from(w.body_state(b).unwrap().pose.position);
        assert!(
            actual.distance(expected) < 0.025,
            "{actual:?} != {expected:?}"
        );
    }
    let state = w.body_state(c).unwrap();
    assert!((state.pose.position[0] - 4.0).abs() < 0.001, "{state:?}");
    assert!((2.0 * state.pose.rotation[2].atan2(state.pose.rotation[3]) - 1.0).abs() < 0.001);
}

#[test]
fn zero_distance_anchor_and_zero_length_spring_remain_well_defined() {
    for kind in [
        JointKind::Distance { length: 0.0 },
        JointKind::Spring {
            rest_length: 0.0,
            stiffness: 100.0,
            damping: 20.0,
        },
    ] {
        let mut w = world(Space::Spatial, [0.0; 3]);
        let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
        let id = w.create_joint(JointDesc::new(a, b, kind)).unwrap();
        w.apply_impulse(b, [1.0, 2.0, -1.0]).unwrap();
        steps(&mut w, 240);
        let s = w.body_state(b).unwrap();
        assert!(rp::Vector::from(s.pose.position).length() < 0.01, "{s:?}");
        assert!(rp::Vector::from(s.linear_velocity).length() < 0.01);
        assert!(w.joint_state(id).unwrap().force.is_finite());
    }
}

#[test]
fn sleeping_and_disabled_joints_do_not_break_from_previous_impulses() {
    let mut w = world(Space::Spatial, [0.0, -10.0, 0.0]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let mut desc = JointDesc::new(a, b, JointKind::Fixed);
    let id = w.create_joint(desc.clone()).unwrap();
    w.step();
    assert!(w.joint_state(id).unwrap().force > 9.0);
    w.set_sleeping(b, true).unwrap();
    w.step();
    assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
    desc.enabled = false;
    desc.break_force = Some(0.0);
    desc.break_torque = Some(0.0);
    w.update_joint(id, desc).unwrap();
    steps(&mut w, 5);
    assert_eq!(w.joint_count(), 1);
    assert_eq!(w.joint_state(id).unwrap(), &JointState::default());
}

#[test]
fn both_break_thresholds_and_non_dynamic_endpoints_are_explicit() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
    let k = cube(&mut w, BodyKind::KinematicPosition, [0.0; 3]);
    assert_eq!(
        w.create_joint(JointDesc::new(a, k, JointKind::Fixed)),
        Err(PhysicsError::WrongBodyKind)
    );
    let b = cube(&mut w, BodyKind::Dynamic, [0.0; 3]);
    let mut desc = JointDesc::new(a, b, JointKind::Fixed);
    desc.break_force = Some(1.0);
    desc.break_torque = Some(1.0);
    w.create_joint(desc).unwrap();
    w.add_force(b, [10.0, 0.0, 0.0], [0.0, 10.0, 0.0]).unwrap();
    w.step();
    let mut events = Vec::new();
    assert_eq!(w.drain_joint_events(&mut events), 0);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].reason, JointEventReason::ForceAndTorqueLimit);
}

#[test]
fn distance_resists_compression_and_radial_joints_recover_coincident_anchors() {
    for space in [Space::Spatial, Space::PlanarXy] {
        for initial in [0.0, 0.5, 3.0] {
            for kind in [
                JointKind::Distance { length: 2.0 },
                JointKind::Spring {
                    rest_length: 2.0,
                    stiffness: 100.0,
                    damping: 20.0,
                },
            ] {
                let mut w = world(space, [0.0; 3]);
                let a = cube(&mut w, BodyKind::Fixed, [0.0; 3]);
                let b = cube(&mut w, BodyKind::Dynamic, [0.0, initial, 0.0]);
                w.create_joint(JointDesc::new(a, b, kind)).unwrap();
                steps(&mut w, 240);
                let s = w.body_state(b).unwrap();
                assert!(
                    (rp::Vector::from(s.pose.position).length() - 2.0).abs() < 0.02,
                    "{space:?}, initial={initial}: {s:?}"
                );
                assert_eq!(s.pose.position[2], 0.0);
                // Collapse an already simulated joint: the previous radial direction
                // supplies a stable recovery axis, instead of a zero Jacobian.
                w.set_pose(b, Pose::default()).unwrap();
                w.set_velocity(b, [0.0; 3], [0.0; 3]).unwrap();
                steps(&mut w, 240);
                let s = w.body_state(b).unwrap();
                assert!(
                    (rp::Vector::from(s.pose.position).length() - 2.0).abs() < 0.02,
                    "after collapse: {s:?}"
                );
            }
        }
    }
}

#[test]
fn distance_between_two_dynamic_bodies_preserves_center_and_spatial_orbit() {
    let mut w = world(Space::Spatial, [0.0; 3]);
    let a = cube(&mut w, BodyKind::Dynamic, [-1.0, 0.0, 0.0]);
    let b = cube(&mut w, BodyKind::Dynamic, [1.0, 0.0, 0.0]);
    w.create_joint(JointDesc::new(a, b, JointKind::Distance { length: 2.0 }))
        .unwrap();
    w.set_velocity(a, [0.0, -1.0, -1.0], [0.0; 3]).unwrap();
    w.set_velocity(b, [0.0, 1.0, 1.0], [0.0; 3]).unwrap();
    let mut z_extent = 0.0_f32;
    for _ in 0..360 {
        w.step();
        let a = rp::Vector::from(w.body_state(a).unwrap().pose.position);
        let b = rp::Vector::from(w.body_state(b).unwrap().pose.position);
        assert!((a + b).length() < 0.001, "center drift: {a:?} {b:?}");
        assert!((a.distance(b) - 2.0).abs() < 0.02);
        z_extent = z_extent.max(a.z.abs());
    }
    assert!(z_extent > 0.5);
}
