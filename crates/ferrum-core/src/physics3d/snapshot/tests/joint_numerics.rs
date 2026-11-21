use super::*;

fn scene(space: Space) -> (PhysicsWorld3d, JointId, BodyId) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = cube(&mut world, BodyKind::Fixed, [0.; 3]);
    let b = cube(&mut world, BodyKind::Dynamic, [2., 0., 0.]);
    let joint = world
        .create_joint(JointDesc::new(a, b, JointKind::Fixed))
        .unwrap();
    (world, joint, b)
}

fn unchecked(world: &PhysicsWorld3d, header: &PhysicsSnapshot) -> PhysicsSnapshot {
    let payload = postcard::to_allocvec(&Capture { world }).unwrap();
    let mut snapshot = header.clone();
    snapshot.bytes.truncate(HEADER);
    snapshot.bytes.extend_from_slice(&payload);
    snapshot.bytes[20..24].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    snapshot.bytes[24..28].copy_from_slice(&crc(&payload).to_le_bytes());
    snapshot
}

#[test]
fn native_joint_numeric_invalid_actual_payload_is_rejected_before_commit() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for case in 0..23 {
            let (mut bad, id, _) = scene(space);
            let before = bad.capture_snapshot().unwrap();
            let mut live = PhysicsWorld3d::from_snapshot(&before).unwrap();
            let joint = bad
                .backend
                .impulse_joints
                .get_mut(crate::physics3d::joints::native_joint(id), false)
                .unwrap();
            match case {
                0 => joint.data.local_frame1.translation.x = f32::NAN,
                1 => joint.data.local_frame2.rotation = rp::Rotation::from_xyzw(0., 0., 0., 0.),
                2 => joint.data.locked_axes = rp::JointAxesMask::from_bits_retain(0x80),
                3 => joint.data.limits[0].min = f32::NAN,
                4 => joint.data.limits[0].max = f32::NEG_INFINITY,
                5 => {
                    joint.data.limits[0].min = 1.;
                    joint.data.limits[0].max = -1.;
                }
                6 => joint.data.limits[0].impulse = f32::NAN,
                7 => joint.data.motors[0].target_pos = f32::NAN,
                8 => joint.data.motors[0].target_vel = f32::INFINITY,
                9 => joint.data.motors[0].stiffness = -1.,
                10 => joint.data.motors[0].damping = f32::NAN,
                11 => joint.data.motors[0].max_force = f32::NEG_INFINITY,
                12 => joint.data.motors[0].impulse = f32::INFINITY,
                13 => joint.data.softness.natural_frequency = f32::NAN,
                14 => joint.data.softness.damping_ratio = -1.,
                15 => joint.impulses[0] = f32::NAN,
                16 => bad.joints.get_mut(&id).unwrap().ratio_impulse = f32::NAN,
                17 => bad.joints.get_mut(&id).unwrap().pulley_axes[0].x = f32::NAN,
                18 => bad.joints.get_mut(&id).unwrap().radial_direction = Some(rp::Vector::Y * 2.),
                19 => bad.joints.get_mut(&id).unwrap().state.force = f32::NAN,
                20 => bad.joints.get_mut(&id).unwrap().ratio_reaction.force = -1.,
                21 => joint.data.softness.natural_frequency = f32::MAX,
                22 => {
                    joint.data.softness.natural_frequency = 0.;
                    joint.data.softness.damping_ratio = 0.;
                }
                _ => unreachable!(),
            }
            let raw = postcard::to_allocvec(&Capture { world: &bad }).unwrap();
            assert_eq!(
                bad.capture_snapshot().unwrap_err(),
                PhysicsSnapshotError::InvalidState,
                "{space:?} case {case}"
            );
            let packet = unchecked(&bad, &before);
            assert_eq!(
                live.restore_snapshot(&packet),
                Err(PhysicsSnapshotError::InvalidState),
                "{space:?} case {case}"
            );
            assert_eq!(
                postcard::to_allocvec(&Capture { world: &bad }).unwrap(),
                raw
            );
            assert_eq!(
                live.capture_snapshot().unwrap().encoded_bytes(),
                before.encoded_bytes()
            );
        }
    }
}

#[test]
fn native_joint_numeric_signed_disabled_history_and_native_frames_are_preserved() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut world, id, b) = scene(space);
        let joint = world
            .backend
            .impulse_joints
            .get_mut(crate::physics3d::joints::native_joint(id), false)
            .unwrap();
        joint.data.set_enabled(false);
        joint.data.local_frame1.translation.x = 0.25;
        joint.impulses[0] = -0.5;
        joint.data.limits[0].impulse = -0.25;
        joint.data.motors[0].impulse = -0.125;
        joint.data.motors[0].max_force = f32::INFINITY;
        let desc = world.joint_desc(id).unwrap().clone();
        assert_eq!(desc.local_frame_a.position[0], 0.);
        let snapshot = world.capture_snapshot().unwrap();
        let mut restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
        assert_eq!(
            restored.capture_snapshot().unwrap().encoded_bytes(),
            snapshot.encoded_bytes()
        );
        assert_eq!(restored.joint_desc(id).unwrap(), &desc);
        world.step();
        restored.step();
        same(&world, &restored, &[b]);
    }
}

#[test]
fn native_joint_numeric_unregistered_backend_joint_is_rejected() {
    let (mut world, id, _) = scene(Space::Spatial);
    world.joints.remove(&id).unwrap();
    assert_eq!(world.backend.impulse_joints.len(), 1);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        PhysicsSnapshotError::InvalidState
    );
}

#[test]
fn native_joint_numeric_valid_authored_frame_tolerance_survives_hinge_updates() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let a = cube(&mut world, BodyKind::Fixed, [0.; 3]);
        let b = cube(&mut world, BodyKind::Dynamic, [0.; 3]);
        let kind = if space == Space::PlanarXy {
            JointKind::ContinuousRevolute {
                limits: [-100., 100.],
                motor: None,
            }
        } else {
            JointKind::Revolute {
                limits: Some([-1., 1.]),
                motor: None,
            }
        };
        let mut desc = JointDesc::new(a, b, kind);
        let scale = (1.0f32 + 9.8e-6).sqrt();
        let mut rotation = rp::Rotation::from_rotation_y(-std::f32::consts::FRAC_PI_2).to_array();
        for value in &mut rotation {
            *value *= scale;
        }
        desc.local_frame_a.rotation = rotation;
        desc.local_frame_b.rotation = rotation;
        assert!(crate::physics3d::types::valid_pose(desc.local_frame_a));
        let id = world.create_joint(desc).unwrap();
        for angle in [0.01, 0.5, 1., 3., 7.] {
            if space == Space::PlanarXy {
                world.set_planar_rotation(b, angle).unwrap();
            } else {
                world
                    .set_pose(
                        b,
                        Pose {
                            rotation: rp::Rotation::from_rotation_z(angle as f32).to_array(),
                            ..Pose::default()
                        },
                    )
                    .unwrap();
            }
            world.step();
            let snapshot = world.capture_snapshot().unwrap();
            let restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
            assert_eq!(restored.joint_desc(id), world.joint_desc(id));
            assert_eq!(
                restored.capture_snapshot().unwrap().encoded_bytes(),
                snapshot.encoded_bytes()
            );
        }
    }
}
