use super::*;

fn unchecked_snapshot(world: &PhysicsWorld3d, envelope: &PhysicsSnapshot) -> PhysicsSnapshot {
    // A private fixture bypasses capture admission, while keeping a valid
    // checksum/build/length so restore must validate the decoded candidate.
    let payload = postcard::to_allocvec(&Capture { world }).unwrap();
    let mut snapshot = envelope.clone();
    snapshot.bytes.truncate(HEADER);
    snapshot.bytes.extend_from_slice(&payload);
    snapshot.bytes[20..24].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    snapshot.bytes[24..28].copy_from_slice(&crc(&payload).to_le_bytes());
    snapshot
}

fn reject_without_mutation(source: &PhysicsWorld3d, live: &mut PhysicsWorld3d) {
    let before = live.capture_snapshot().unwrap();
    let source_bytes = postcard::to_allocvec(&Capture { world: source }).unwrap();
    assert_eq!(
        source.capture_snapshot().unwrap_err(),
        PhysicsSnapshotError::InvalidState
    );
    assert_eq!(
        postcard::to_allocvec(&Capture { world: source }).unwrap(),
        source_bytes
    );
    let bad = unchecked_snapshot(source, &before);
    assert_eq!(
        live.restore_snapshot(&bad),
        Err(PhysicsSnapshotError::InvalidState)
    );
    assert_eq!(
        live.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn native_snapshot_rejects_foreign_generation_collision_graphs_before_commit() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let create = || {
            PhysicsWorld3d::new(WorldConfig {
                space,
                gravity: [0.; 3],
                ..WorldConfig::default()
            })
            .unwrap()
        };
        let mut source = create();
        let mut foreign = create();
        let mut live = create();
        let a = cube(&mut source, BodyKind::Dynamic, [0.; 3]);
        cube(&mut source, BodyKind::Fixed, [0.7, 0., 0.]);
        let removed = cube(&mut foreign, BodyKind::Dynamic, [0.; 3]);
        foreign.remove_body(removed).unwrap();
        let replacement = cube(&mut foreign, BodyKind::Dynamic, [0.; 3]);
        cube(&mut foreign, BodyKind::Fixed, [0.7, 0., 0.]);
        assert_eq!(a.slot, replacement.slot);
        assert_ne!(a, replacement);
        source.step();
        foreign.step();
        cube(&mut live, BodyKind::KinematicPosition, [4., 3., 0.]);
        source.capture_snapshot().unwrap();
        source.backend.broad_phase = foreign.backend.broad_phase;
        source.backend.narrow_phase = foreign.backend.narrow_phase;
        reject_without_mutation(&source, &mut live);
        // The corruption is confined to cross-container reference state.
        assert_eq!(source.body_count(), 2);
        assert!(source.body_state(a).is_ok());
    }
}

#[test]
fn native_snapshot_rejects_joint_graph_with_stale_body_generation_before_commit() {
    let mut source = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let mut live = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = cube(&mut source, BodyKind::Fixed, [0.; 3]);
    let b = cube(&mut source, BodyKind::Dynamic, [2., 0., 0.]);
    let (slot, generation) = native_id(b).into_raw_parts();
    let stale = rp::RigidBodyHandle::from_raw_parts(slot, generation + 1);
    source
        .backend
        .impulse_joints
        .insert(native_id(a), stale, rp::FixedJointBuilder::new(), true);
    assert_eq!(source.backend.impulse_joints.len(), 1);
    assert!(!source.backend.bodies.contains(stale));
    reject_without_mutation(&source, &mut live);
}

#[test]
fn native_snapshot_reference_work_and_scratch_limits_preserve_pending_state() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let kinematic = cube(&mut world, BodyKind::KinematicPosition, [0.; 3]);
    world
        .set_kinematic_target(
            kinematic,
            Pose {
                position: [1., 0., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    let snapshot = world.capture_snapshot().unwrap();
    let work = rp::validate_stored_references(&world.backend, REFERENCE_LIMITS).unwrap();
    assert!(work > 0);
    assert_eq!(
        world.validate_snapshot_state_with_reference_limits(rp::StoredReferenceLimits {
            max_work: work - 1,
            ..REFERENCE_LIMITS
        }),
        Err(PhysicsSnapshotError::Capacity)
    );
    world
        .validate_snapshot_state_with_reference_limits(rp::StoredReferenceLimits {
            max_work: work,
            ..REFERENCE_LIMITS
        })
        .unwrap();
    // A stepped contact scene requires actual temporary pair storage.
    let mut contact = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    cube(&mut contact, BodyKind::Dynamic, [0.; 3]);
    cube(&mut contact, BodyKind::Fixed, [0.7, 0., 0.]);
    contact.step();
    let contact_before = contact.capture_snapshot().unwrap();
    assert_eq!(
        contact.validate_snapshot_state_with_reference_limits(rp::StoredReferenceLimits {
            max_scratch_bytes: 0,
            ..REFERENCE_LIMITS
        }),
        Err(PhysicsSnapshotError::Capacity)
    );
    assert_eq!(
        contact.capture_snapshot().unwrap().encoded_bytes(),
        contact_before.encoded_bytes()
    );
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );
    let mut restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    world.step();
    restored.step();
    same(&world, &restored, &[kinematic]);
    assert_eq!(world.body_state(kinematic).unwrap().pose.position[0], 1.);
}
