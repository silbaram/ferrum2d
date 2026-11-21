use super::*;
use crate::physics3d::{BodyId, ColliderId, ColliderRef, ContactImpulseDiagnostics};

fn row(j: f32) -> ContactImpulse {
    ContactImpulse {
        first: ColliderRef {
            body: BodyId {
                slot: 1,
                generation: 7,
            },
            collider: ColliderId {
                slot: 3,
                generation: 11,
            },
            sensor: false,
        },
        second: ColliderRef {
            body: BodyId {
                slot: 2,
                generation: 9,
            },
            collider: ColliderId {
                slot: 4,
                generation: 13,
            },
            sensor: false,
        },
        categories: 2 | 4,
        point: [1.25, 0.5, -0.],
        normal: [0., 1., 0.],
        normal_impulse: j,
        tangent_impulse: [0.; 3],
        approach_speed: 6.,
    }
}
fn work() -> Work {
    Work {
        used: 0,
        limit: u64::MAX,
    }
}
fn output(collector: &EventCollector) -> (Vec<ContactImpulse>, ContactImpulseDiagnostics) {
    let buffer = collector.1.lock().unwrap();
    (buffer.contacts.clone(), buffer.diagnostics)
}

#[test]
fn actual_rows_publish_only_sealed_committed_prefix_and_never_replay() {
    let collector = EventCollector::new(8);
    let mut pending = Staging::default();
    pending.reset(8);
    let mut work = work();
    pending.push(row(7.), &mut work, usize::MAX).unwrap();
    pending.seal(0.01, &mut work, usize::MAX).unwrap();
    pending.push(row(11.), &mut work, usize::MAX).unwrap();
    pending.seal(0.02, &mut work, usize::MAX).unwrap();
    // A final failed context never seals. It must not leak with an earlier batch.
    pending.push(row(13.), &mut work, usize::MAX).unwrap();
    let charged = work.used;
    let capacities = (pending.contacts.capacity(), pending.batches.capacity());
    pending.publish_committed(0.01, &collector).unwrap();
    assert_eq!(work.used, charged);
    assert_eq!(
        output(&collector),
        (
            vec![row(7.)],
            ContactImpulseDiagnostics {
                solved_contacts: 1,
                dropped: 0
            }
        )
    );
    assert_eq!(
        output(&collector).0[0].point[2].to_bits(),
        (-0.0_f32).to_bits()
    );
    assert_eq!(
        capacities,
        (pending.contacts.capacity(), pending.batches.capacity())
    );
    pending.publish_committed(0.02, &collector).unwrap();
    assert_eq!(output(&collector).0, [row(7.)]);
    assert!(pending.contacts.is_empty() && pending.batches.is_empty());
}

#[test]
fn actual_rows_share_existing_stream_capacity_and_count_every_real_drop() {
    let collector = EventCollector::new(2);
    // A pre-existing observation occupies the same bounded tick stream. This
    // adapter test does not claim to execute the native forceevent producer.
    collector.record_actual_contact_impulses(&[row(3.)], 1);
    let mut pending = Staging::default();
    pending.reset(2);
    let mut work = work();
    for j in [5., 7., 11.] {
        pending.push(row(j), &mut work, usize::MAX).unwrap();
        pending.seal(0.01, &mut work, usize::MAX).unwrap();
    }
    assert_eq!(pending.contacts.len(), 2);
    assert_eq!(pending.solved, 3);
    pending.publish_committed(0.01, &collector).unwrap();
    assert_eq!(
        output(&collector),
        (
            vec![row(3.), row(5.)],
            ContactImpulseDiagnostics {
                solved_contacts: 4,
                dropped: 2
            }
        )
    );
    let before = output(&collector);
    pending.publish_committed(0.01, &collector).unwrap();
    assert_eq!(output(&collector), before);
}

#[test]
fn actual_plan_rewind_discards_superseded_physical_rows_without_refunding_work() {
    let collector = EventCollector::new(8);
    let mut pending = Staging::default();
    pending.reset(8);
    let mut work = work();
    let mark = pending.mark();
    pending.push(row(4.), &mut work, usize::MAX).unwrap();
    pending.push(row(6.), &mut work, usize::MAX).unwrap();
    let charged = work.used;
    pending.rewind(mark).unwrap();
    assert_eq!(work.used, charged);
    assert_eq!((pending.contacts.len(), pending.solved), (0, 0));
    pending.push(row(7.), &mut work, usize::MAX).unwrap();
    pending.seal(0.01, &mut work, usize::MAX).unwrap();
    assert_eq!(pending.rewind(mark), Err(TrajectoryError::InvalidReference));
    pending.publish_committed(0.01, &collector).unwrap();
    assert_eq!(output(&collector).0, [row(7.)]);
}

#[test]
fn actual_row_and_batch_work_and_requested_storage_are_exact_before_publication() {
    let collector = EventCollector::new(1);
    let mut pending = Staging::default();
    pending.reset(1);
    let row_bytes = std::mem::size_of::<ContactImpulse>();
    let batch_bytes = std::mem::size_of::<Batch>();
    assert_eq!(
        pending.push(
            row(6.),
            &mut Work {
                used: 0,
                limit: ROW_WORK - 1
            },
            row_bytes
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!((pending.contacts.len(), pending.solved), (0, 0));
    assert_eq!(
        pending.push(row(6.), &mut work(), row_bytes - 1),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!((pending.contacts.len(), pending.solved), (0, 0));
    let mut exact_row = Work {
        used: 0,
        limit: ROW_WORK,
    };
    pending.push(row(6.), &mut exact_row, row_bytes).unwrap();
    assert_eq!(exact_row.used, ROW_WORK);
    assert_eq!(
        pending.seal(
            0.01,
            &mut Work {
                used: 0,
                limit: BATCH_WORK - 1
            },
            row_bytes + batch_bytes
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert!(pending.batches.is_empty());
    assert_eq!(
        pending.seal(0.01, &mut work(), row_bytes + batch_bytes - 1),
        Err(TrajectoryError::WorkLimit)
    );
    assert!(pending.batches.is_empty());
    let mut exact_batch = Work {
        used: 0,
        limit: BATCH_WORK,
    };
    pending
        .seal(0.01, &mut exact_batch, row_bytes + batch_bytes)
        .unwrap();
    assert_eq!(exact_batch.used, BATCH_WORK);
    assert!(output(&collector).0.is_empty());
    pending.publish_committed(0.01, &collector).unwrap();
    assert_eq!(output(&collector).0, [row(6.)]);
}

#[test]
fn actual_rejected_prefix_does_not_count_drops_from_uncommitted_tail() {
    for (committed, expected) in [(0., (0, 0)), (0.01, (1, 0)), (0.02, (2, 1))] {
        let collector = EventCollector::new(1);
        let mut pending = Staging::default();
        pending.reset(1);
        let mut work = work();
        pending.push(row(3.), &mut work, usize::MAX).unwrap();
        pending.seal(0.01, &mut work, usize::MAX).unwrap();
        pending.push(row(5.), &mut work, usize::MAX).unwrap();
        pending.seal(0.02, &mut work, usize::MAX).unwrap();
        pending.push(row(7.), &mut work, usize::MAX).unwrap();
        pending.publish_committed(committed, &collector).unwrap();
        let (rows, diagnostics) = output(&collector);
        assert_eq!((diagnostics.solved_contacts, diagnostics.dropped), expected);
        assert_eq!(rows.len(), usize::from(committed > 0.));
    }
}

#[test]
fn actual_zero_rows_and_malformed_numeric_identity_clock_never_publish_or_repair() {
    let collector = EventCollector::new(8);
    let mut pending = Staging::default();
    pending.reset(8);
    pending.push(row(0.), &mut work(), 0).unwrap();
    assert_eq!((pending.contacts.len(), pending.solved), (0, 0));
    for case in 0..10 {
        let mut bad = row(6.);
        match case {
            0 => bad.normal[0] = f32::NAN,
            1 => bad.normal = [0.; 3],
            2 => bad.point[2] = f32::INFINITY,
            3 => bad.normal_impulse = f32::NAN,
            4 => bad.normal_impulse = -1.,
            5 => bad.tangent_impulse[0] = f32::NAN,
            6 => bad.approach_speed = -1.,
            7 => bad.second.body = bad.first.body,
            8 => bad.second.collider = bad.first.collider,
            _ => bad.first.sensor = true,
        }
        let bytes = postcard::to_allocvec(&bad).unwrap();
        assert!(
            pending.push(bad.clone(), &mut work(), usize::MAX).is_err(),
            "case {case}"
        );
        assert_eq!(postcard::to_allocvec(&bad).unwrap(), bytes);
        assert_eq!((pending.contacts.len(), pending.solved), (0, 0));
    }
    pending.push(row(6.), &mut work(), usize::MAX).unwrap();
    assert_eq!(
        pending.seal(0., &mut work(), usize::MAX),
        Err(TrajectoryError::InvalidTime)
    );
    for end in [Time::NAN, Time::INFINITY, -1.] {
        assert_eq!(
            pending.seal(end, &mut work(), usize::MAX),
            Err(TrajectoryError::InvalidTime)
        );
        assert_eq!(
            pending.publish_committed(end, &collector),
            Err(TrajectoryError::InvalidTime)
        );
        assert!(output(&collector).0.is_empty());
        assert_eq!((pending.contacts.len(), pending.solved), (1, 1));
    }
    pending.publish_committed(1., &collector).unwrap();
    assert!(
        output(&collector).0.is_empty(),
        "unsealed failed context is discarded"
    );
}

#[test]
fn native_codec_restored_output_reserves_before_publication_with_independent_owner_bound() {
    use crate::physics3d::{PhysicsWorld3d, WorldConfig};
    let limit = 65536;
    let world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        max_bodies: 1,
        max_colliders: 1,
        max_characters: 1,
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap();
    let saved = world.capture_snapshot().unwrap();
    let restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    let before = restored
        .capture_snapshot()
        .unwrap()
        .encoded_bytes()
        .to_vec();
    let requested = limit
        .checked_mul(std::mem::size_of::<ContactImpulse>())
        .unwrap();
    assert!(requested > restored.actual_motion_scratch_bound().unwrap());
    assert!(restored.events.1.lock().unwrap().contacts.capacity() < limit);
    assert_eq!(
        restored
            .events
            .prepare_actual_contact_impulses(limit, &mut work(), requested - 1),
        Err(TrajectoryError::WorkLimit)
    );
    assert!(restored.events.1.lock().unwrap().contacts.capacity() < limit);
    assert_eq!(restored.capture_snapshot().unwrap().encoded_bytes(), before);
    let mut short = Work {
        used: 0,
        limit: limit as u64,
    };
    assert_eq!(
        restored
            .events
            .prepare_actual_contact_impulses(limit, &mut short, requested),
        Err(TrajectoryError::WorkLimit)
    );
    assert!(restored.events.1.lock().unwrap().contacts.capacity() < limit);
    assert_eq!(restored.capture_snapshot().unwrap().encoded_bytes(), before);
    let mut exact = Work {
        used: 0,
        limit: limit as u64 + 1,
    };
    restored
        .events
        .prepare_actual_contact_impulses(limit, &mut exact, requested)
        .unwrap();
    assert_eq!(exact.used, limit as u64 + 1);
    let capacity = restored.events.1.lock().unwrap().contacts.capacity();
    assert!(capacity >= limit);
    assert_eq!(restored.capture_snapshot().unwrap().encoded_bytes(), before);
    let mut steady = Work { used: 0, limit: 1 };
    restored
        .events
        .prepare_actual_contact_impulses(limit, &mut steady, requested)
        .unwrap();
    assert_eq!(steady.used, 1);
    assert_eq!(
        restored.events.1.lock().unwrap().contacts.capacity(),
        capacity
    );
    let mut pending = Staging::default();
    pending.reset(limit);
    pending.push(row(6.), &mut work(), usize::MAX).unwrap();
    pending.seal(0.01, &mut work(), usize::MAX).unwrap();
    pending.publish_committed(0.01, &restored.events).unwrap();
    assert_eq!(
        restored.events.1.lock().unwrap().contacts.capacity(),
        capacity
    );
    assert_eq!(output(&restored.events).0, [row(6.)]);
}
