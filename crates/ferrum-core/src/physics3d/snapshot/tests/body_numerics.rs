use super::*;

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
fn native_body_numeric_pending_payload_and_iteration_limits_reject_before_commit() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for case in 0..6 {
            let mut world = PhysicsWorld3d::new(WorldConfig {
                space,
                gravity: [0.; 3],
                ..WorldConfig::default()
            })
            .unwrap();
            let dynamic = cube(&mut world, BodyKind::Dynamic, [0.; 3]);
            let kinematic = cube(&mut world, BodyKind::KinematicPosition, [4., 0., 0.]);
            let snapshot = world.capture_snapshot().unwrap();
            let mut live = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
            match case {
                0 => world
                    .backend
                    .bodies
                    .get_mut(native_id(kinematic))
                    .unwrap()
                    .set_next_kinematic_translation(rp::Vector::new(f32::NAN, 0., 0.)),
                1 => world
                    .backend
                    .bodies
                    .get_mut(native_id(dynamic))
                    .unwrap()
                    .add_force(rp::Vector::new(f32::NAN, 0., 0.), true),
                2 => world
                    .backend
                    .bodies
                    .get_mut(native_id(dynamic))
                    .unwrap()
                    .set_additional_mass(f32::NAN, false),
                3 => world
                    .backend
                    .bodies
                    .get_mut(native_id(dynamic))
                    .unwrap()
                    .set_additional_solver_iterations(usize::MAX),
                4 => world
                    .backend
                    .bodies
                    .get_mut(native_id(dynamic))
                    .unwrap()
                    .set_additional_pgs_iterations(33),
                5 => {
                    let collider = world.collider_ids(dynamic).unwrap().next().unwrap();
                    world
                        .backend
                        .colliders
                        .get_mut(crate::physics3d::colliders::native_collider(collider))
                        .unwrap()
                        .set_friction(f32::NAN);
                }
                _ => unreachable!(),
            }
            let raw = postcard::to_allocvec(&Capture { world: &world }).unwrap();
            assert_eq!(
                world.capture_snapshot().unwrap_err(),
                PhysicsSnapshotError::InvalidState,
                "{space:?} case {case}"
            );
            assert_eq!(
                live.restore_snapshot(&unchecked(&world, &snapshot)),
                Err(PhysicsSnapshotError::InvalidState),
                "{space:?} case {case}"
            );
            assert_eq!(
                postcard::to_allocvec(&Capture { world: &world }).unwrap(),
                raw
            );
            assert_eq!(
                live.capture_snapshot().unwrap().encoded_bytes(),
                snapshot.encoded_bytes()
            );
        }
    }
}

#[test]
fn native_body_numeric_preserves_bounded_tuning_pending_targets_and_forces() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let dynamic = cube(&mut world, BodyKind::Dynamic, [0.; 3]);
        let kinematic = cube(&mut world, BodyKind::KinematicPosition, [4., 0., 0.]);
        let body = world.backend.bodies.get_mut(native_id(dynamic)).unwrap();
        body.set_additional_solver_iterations(32);
        body.set_additional_pgs_iterations(32);
        world.add_force(dynamic, [1., -2., 0.], [0.; 3]).unwrap();
        world
            .set_kinematic_target(
                kinematic,
                Pose {
                    position: [4.25, 0., 0.],
                    ..Pose::default()
                },
            )
            .unwrap();
        let snapshot = world.capture_snapshot().unwrap();
        let mut restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
        assert_eq!(
            restored.capture_snapshot().unwrap().encoded_bytes(),
            snapshot.encoded_bytes()
        );
        for _ in 0..3 {
            world.step();
            restored.step();
            same(&world, &restored, &[dynamic, kinematic]);
        }
        assert_eq!(world.body_state(kinematic).unwrap().pose.position[0], 4.25);
        assert!(world.body_state(dynamic).unwrap().linear_velocity[0] > 0.);
    }
}
