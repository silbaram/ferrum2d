use super::*;

#[test]
fn native_island_current_joint_requires_stored_link_before_commit() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let mut bodies = Vec::new();
        for _ in 0..2 {
            bodies.push(
                world
                    .create_body_without_collider(BodyDesc {
                        kind: BodyKind::Dynamic,
                        can_sleep: false,
                        ..BodyDesc::default()
                    })
                    .unwrap(),
            );
        }
        let joint = world
            .create_joint(JointDesc::new(bodies[0], bodies[1], JointKind::Fixed))
            .unwrap();
        world.step();
        let good = world.capture_snapshot().unwrap();
        let mut without_joint = PhysicsWorld3d::from_snapshot(&good).unwrap();
        without_joint.remove_joint(joint).unwrap();
        without_joint.step();
        // Each donor value comes from a normal public API sequence. Combining
        // them leaves a current enabled joint with no persistent link. Never
        // step this inconsistent fixture: the cold boundary must reject it.
        world.backend.islands = without_joint.backend.islands;
        world.backend.bodies = without_joint.backend.bodies;
        rp::validate_stored_references(&world.backend, REFERENCE_LIMITS).unwrap();
        let raw = postcard::to_allocvec(&Capture { world: &world }).unwrap();
        let mut bad = good.clone();
        bad.bytes.truncate(HEADER);
        bad.bytes.extend_from_slice(&raw);
        bad.bytes[20..24].copy_from_slice(&(raw.len() as u32).to_le_bytes());
        bad.bytes[24..28].copy_from_slice(&crc(&raw).to_le_bytes());
        assert!(bad.payload().is_ok());
        assert_eq!(
            world.capture_snapshot().unwrap_err(),
            PhysicsSnapshotError::InvalidState
        );
        assert!(matches!(
            PhysicsWorld3d::from_snapshot(&bad),
            Err(PhysicsSnapshotError::InvalidState)
        ));
        let mut live = PhysicsWorld3d::from_snapshot(&good).unwrap();
        assert_eq!(
            live.restore_snapshot(&bad),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            postcard::to_allocvec(&Capture { world: &world }).unwrap(),
            raw
        );
        assert_eq!(
            live.capture_snapshot().unwrap().encoded_bytes(),
            good.encoded_bytes()
        );
    }
}

#[test]
fn native_island_scheduler_high_stamp_sleep_continues_after_public_checkpoint() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for stamp in [1u32, u32::MAX] {
            let mut world = PhysicsWorld3d::new(WorldConfig {
                space,
                gravity: [0.0; 3],
                ..WorldConfig::default()
            })
            .unwrap();
            let bodies: Vec<_> = (0..2)
                .map(|_| {
                    world
                        .create_body_without_collider(BodyDesc {
                            kind: BodyKind::Dynamic,
                            ..BodyDesc::default()
                        })
                        .unwrap()
                })
                .collect();
            world.step();
            for &body in &bodies {
                let activation = world
                    .backend
                    .bodies
                    .get_mut(native_id(body))
                    .unwrap()
                    .activation_mut();
                activation.time_since_can_sleep = activation.time_until_sleep;
            }
            // Set only the persisted counter in a private fixture. Reconstituting
            // this vendor value also leaves the skipped scan workspace cold, as it
            // would be after an ordinary native checkpoint decode. No public byte
            // importer or production mutation hook is added.
            let mut bytes = postcard::to_allocvec(&world.backend.islands).unwrap();
            // In the pinned vendor schema PersistentIslands is the last manager
            // field; its last two stored fields are scan stamp and bootstrapped.
            // Assert the complete known suffix before replacing this one scalar.
            let original = postcard::to_allocvec(&(1u32, true)).unwrap();
            assert!(bytes.ends_with(&original));
            bytes.truncate(bytes.len() - original.len());
            bytes.extend(postcard::to_allocvec(&(stamp, true)).unwrap());
            world.backend.islands = crate::checkpoint_decode::from_bytes(&bytes).unwrap();
            let before = world.capture_snapshot().unwrap();
            let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
            assert_eq!(
                world.capture_snapshot().unwrap().encoded_bytes(),
                before.encoded_bytes()
            );
            assert_eq!(
                restored.capture_snapshot().unwrap().encoded_bytes(),
                before.encoded_bytes()
            );
            world.step();
            restored.step();
            for &body in &bodies {
                assert!(
                world.body_state(body).unwrap().sleeping,
                "{space:?}: the original must observe a sleep-eligible body at the clock boundary"
            );
                assert!(
                    restored.body_state(body).unwrap().sleeping,
                    "{space:?}: the restored world must observe the same sleep eligibility"
                );
            }
            same(&world, &restored, &bodies);
            for _ in 0..6 {
                world.step();
                restored.step();
                same(&world, &restored, &bodies);
            }
        }
    }
}

#[test]
fn native_island_pending_joint_public_codec_six_step() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = world
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::Dynamic,
            can_sleep: false,
            ..BodyDesc::default()
        })
        .unwrap();
    let b = world
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::Dynamic,
            can_sleep: false,
            pose: Pose {
                position: [1.0, 0.0, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        })
        .unwrap();
    world.step();
    let mut desc = JointDesc::new(a, b, JointKind::Fixed);
    desc.local_frame_a.position = [1.0, 0.0, 0.0];
    world.create_joint(desc).unwrap();
    let snapshot = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    assert_eq!(
        snapshot.encoded_bytes(),
        restored.capture_snapshot().unwrap().encoded_bytes()
    );
    let mut differences = Vec::new();
    for tick in 1..=6 {
        world.step();
        restored.step();
        if world.capture_snapshot().unwrap().encoded_bytes()
            != restored.capture_snapshot().unwrap().encoded_bytes()
        {
            differences.push(tick);
        }
    }
    let island_equal = postcard::to_allocvec(&world.backend.islands).unwrap()
        == postcard::to_allocvec(&restored.backend.islands).unwrap();
    eprintln!("CORE_PENDING_JOINT differences={differences:?} island_equal={island_equal} body_states_equal={}", world.body_state(a)==restored.body_state(a) && world.body_state(b)==restored.body_state(b));
    assert!(differences.is_empty());
    assert!(island_equal);
}

#[test]
fn native_island_missing_sleep_membership_rejects_before_capture_and_commit() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut source = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let body = source
            .create_body_without_collider(BodyDesc {
                kind: BodyKind::Dynamic,
                ..BodyDesc::default()
            })
            .unwrap();
        source.set_sleeping(body, true).unwrap();
        source.step();
        let before = source.capture_snapshot().unwrap();
        let mut live = PhysicsWorld3d::from_snapshot(&before).unwrap();
        // Keep the body and its stored ids but remove the sleeping membership.
        // The prior awake-only reference guard accepts this mismatch. Never
        // execute the invalid world: admission must reject it first.
        source.backend.islands = rp::IslandManager::new();
        rp::validate_stored_references(&source.backend, REFERENCE_LIMITS).unwrap();
        let raw = postcard::to_allocvec(&Capture { world: &source }).unwrap();
        assert_eq!(
            source.capture_snapshot().unwrap_err(),
            PhysicsSnapshotError::InvalidState
        );
        let mut bad = before.clone();
        bad.bytes.truncate(HEADER);
        bad.bytes.extend_from_slice(&raw);
        bad.bytes[20..24].copy_from_slice(&(raw.len() as u32).to_le_bytes());
        bad.bytes[24..28].copy_from_slice(&crc(&raw).to_le_bytes());
        assert!(bad.payload().is_ok());
        assert_eq!(
            live.restore_snapshot(&bad),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            postcard::to_allocvec(&Capture { world: &source }).unwrap(),
            raw
        );
        assert_eq!(
            live.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
}

#[test]
fn native_island_work_and_scratch_limits_keep_pending_joint_bytes() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = cube(&mut world, BodyKind::Dynamic, [0.0; 3]);
    let b = cube(&mut world, BodyKind::Dynamic, [2.0, 0.0, 0.0]);
    world.step();
    world
        .create_joint(JointDesc::new(a, b, JointKind::Fixed))
        .unwrap();
    let before = world.capture_snapshot().unwrap();
    let used = rp::validate_stored_islands(&world.backend, islands::LIMITS).unwrap();
    assert!(used > 0);
    islands::validate_with_limits(
        &world.backend,
        rp::StoredIslandLimits {
            max_work: used,
            ..islands::LIMITS
        },
    )
    .unwrap();
    for limits in [
        rp::StoredIslandLimits {
            max_work: used - 1,
            ..islands::LIMITS
        },
        rp::StoredIslandLimits {
            max_scratch_bytes: 0,
            ..islands::LIMITS
        },
    ] {
        assert_eq!(
            islands::validate_with_limits(&world.backend, limits),
            Err(PhysicsSnapshotError::Capacity)
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
    let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
    for _ in 0..6 {
        world.step();
        restored.step();
        same(&world, &restored, &[a, b]);
    }
}
