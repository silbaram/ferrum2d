use super::*;
use crate::checkpoint_decode::{with_limits, ErrorKind, Limit, Limits};
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Shape, WorldConfig};

#[derive(Serialize, Deserialize)]
struct EmptySets {
    #[serde(with = "multibodies")]
    multibodies: rp::MultibodyJointSet,
    #[serde(with = "soft_bodies")]
    soft_bodies: rp::SoftBodySet,
}
impl std::fmt::Debug for EmptySets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("EmptySets")
    }
}

#[derive(Serialize)]
struct BorrowedSets<'a> {
    #[serde(with = "multibodies")]
    multibodies: &'a rp::MultibodyJointSet,
    #[serde(with = "soft_bodies")]
    soft_bodies: &'a rp::SoftBodySet,
}
fn reject_sets(world: &PhysicsWorld3d) {
    assert!(postcard::to_allocvec(&BorrowedSets {
        multibodies: &world.backend.multibody_joints,
        soft_bodies: &world.backend.soft_bodies,
    })
    .is_err());
}

#[test]
fn native_snapshot_backend_markers_preserve_canonical_empty_persistent_state() {
    let original = EmptySets {
        multibodies: rp::MultibodyJointSet::new(),
        soft_bodies: rp::SoftBodySet::new(),
    };
    let bytes = postcard::to_allocvec(&original).unwrap();
    assert_eq!(bytes, [0, 0]);
    let restored: EmptySets = with_limits(&bytes, Limits::default()).unwrap().0;
    assert_eq!(
        postcard::to_allocvec(&original.multibodies).unwrap(),
        postcard::to_allocvec(&restored.multibodies).unwrap()
    );
    assert_eq!(
        postcard::to_allocvec(&original.soft_bodies).unwrap(),
        postcard::to_allocvec(&restored.soft_bodies).unwrap()
    );
}

#[test]
fn native_snapshot_backend_invalid_markers_stop_before_native_payload_decode() {
    // A matrix-shaped payload is deliberately appended. It must never reach
    // native set/entry/matrix Deserialize, even under permissive work limits.
    let overflow_dimension = 1usize << (usize::BITS / 2);
    let tail = postcard::to_allocvec(&(Vec::<f32>::new(), overflow_dimension, overflow_dimension))
        .unwrap();
    for marker in [1, 2, u8::MAX] {
        for prefix in [vec![marker], vec![0, marker]] {
            let mut bytes = prefix.clone();
            bytes.extend_from_slice(&tail);
            let error = with_limits::<EmptySets>(&bytes, Limits::default()).unwrap_err();
            assert_eq!(error.kind, ErrorKind::Invalid);
            assert_eq!(error.usage.values, prefix.len() + 1);
            assert_eq!(error.usage.peak_depth, 2);
        }
    }
    assert_eq!(
        with_limits::<EmptySets>(&[], Limits::default())
            .unwrap_err()
            .kind,
        ErrorKind::Invalid
    );
    assert_eq!(
        with_limits::<EmptySets>(&[0, 0, 99], Limits::default())
            .unwrap_err()
            .kind,
        ErrorKind::Trailing
    );
}

#[test]
fn native_snapshot_backend_empty_constructor_is_charged_before_creation() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static CREATED: AtomicUsize = AtomicUsize::new(0);
    #[derive(Debug)]
    struct Constructed;
    impl<'de> Deserialize<'de> for Constructed {
        fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
            load_empty(source, 1024, || {
                CREATED.fetch_add(1, Ordering::Relaxed);
                Self
            })
        }
    }
    let error = with_limits::<Constructed>(
        &[0],
        Limits {
            allocation_work: 32,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Limit(Limit::Allocation));
    assert_eq!(CREATED.load(Ordering::Relaxed), 0);
    with_limits::<Constructed>(&[0], Limits::default()).unwrap();
    assert_eq!(CREATED.load(Ordering::Relaxed), 1);
}

#[test]
fn native_snapshot_backend_capture_rejects_live_and_retired_multibody_state() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = world
        .create_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
    let b = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
    let handle = world
        .backend
        .multibody_joints
        .insert(
            super::super::super::world::native_id(a),
            super::super::super::world::native_id(b),
            rp::SphericalJointBuilder::new(),
            true,
        )
        .unwrap();
    let before = world.body_state(b).unwrap();
    reject_sets(&world);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        super::super::PhysicsSnapshotError::InvalidState
    );
    assert_eq!(world.body_state(b).unwrap(), before);
    world
        .backend
        .multibody_joints
        .remove_multibody_articulations(rp::RigidBodyHandle(handle.0), true);
    assert_eq!(world.backend.multibody_joints.iter().count(), 0);
    reject_sets(&world);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        super::super::PhysicsSnapshotError::InvalidState
    );
}

#[test]
fn native_snapshot_backend_capture_rejects_live_and_retired_soft_state() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let handle = world.backend.insert_soft_body(
        rp::SoftBodyBuilder::new(vec![rp::Vector::ZERO, rp::Vector::X]).edges(vec![[0, 1]]),
    );
    reject_sets(&world);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        super::super::PhysicsSnapshotError::InvalidState
    );
    world.backend.remove_soft_body(handle).unwrap();
    assert!(world.backend.soft_bodies.is_empty());
    reject_sets(&world);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        super::super::PhysicsSnapshotError::InvalidState
    );
}

#[test]
fn native_snapshot_backend_previous_native_version_is_rejected() {
    let world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    assert_eq!(super::super::PHYSICS_SNAPSHOT_VERSION, 7);
    for previous in [2u32, 3, 4, 5, 6] {
        let mut packet = world.capture_snapshot().unwrap();
        packet.bytes[8..12].copy_from_slice(&previous.to_le_bytes());
        assert!(matches!(
            PhysicsWorld3d::from_snapshot(&packet),
            Err(super::super::PhysicsSnapshotError::IncompatibleBuild)
        ));
    }
}

#[test]
fn native_snapshot_backend_bad_marker_with_valid_envelope_keeps_live_world_exact() {
    use super::super::{crc, PhysicsSnapshotError, HEADER};
    use crate::physics3d::{Pose, Space};
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            ..WorldConfig::default()
        })
        .unwrap();
        let id = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Dynamic,
                    pose: Pose {
                        position: [0., 2., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            )
            .unwrap();
        world.add_force(id, [1., 0., 0.], [0.; 3]).unwrap();
        let saved = world.capture_snapshot().unwrap();
        // The pinned Postcard struct fields have the same concatenated prefix
        // as this tuple. Check it against the actual packet before mutation.
        let b = &world.backend;
        let prefix = postcard::to_allocvec(&(
            &b.gravity,
            &b.integration_parameters,
            &b.islands,
            &b.broad_phase,
            &b.narrow_phase,
            &b.bodies,
            &b.colliders,
            &b.impulse_joints,
        ))
        .unwrap();
        let at = HEADER + prefix.len();
        assert_eq!(&saved.bytes[HEADER..at], prefix);
        assert_eq!(&saved.bytes[at..at + 2], [0, 0]);
        for marker_at in [at, at + 1] {
            let mut bad = saved.clone();
            bad.bytes[marker_at] = 1;
            let checksum = crc(&bad.bytes[HEADER..]);
            bad.bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
            assert!(bad.payload().is_ok());
            assert_eq!(
                world.restore_snapshot(&bad),
                Err(PhysicsSnapshotError::InvalidState)
            );
            assert_eq!(
                world.capture_snapshot().unwrap().encoded_bytes(),
                saved.encoded_bytes()
            );
        }
    }
}

#[test]
fn native_snapshot_private_time_wire_width_and_decode_allowance_are_exact() {
    use crate::physics3d::solver_trajectory::Time;
    let values: (Time, Time, Time) = (0.5_f64.next_up(), 0.5_f64.next_down(), -0.);
    let bytes = postcard::to_allocvec(&values).unwrap();
    assert_eq!(bytes.len(), 3 * std::mem::size_of::<Time>());
    assert_eq!(bytes.len(), 24);
    let (decoded, usage) = with_limits::<(Time, Time, Time)>(&bytes, Limits::default()).unwrap();
    assert_eq!(decoded.0.to_bits(), values.0.to_bits());
    assert_eq!(decoded.1.to_bits(), values.1.to_bits());
    assert_eq!(decoded.2.to_bits(), values.2.to_bits());
    assert_eq!(postcard::to_allocvec(&decoded).unwrap(), bytes);
    let exact = Limits {
        input_bytes: bytes.len(),
        allocation_work: usage.allocation_work,
        values: usage.values,
        depth: usage.peak_depth,
        ..Limits::default()
    };
    assert_eq!(
        with_limits::<(Time, Time, Time)>(&bytes, exact).unwrap().1,
        usage
    );
    for (limits, expected) in [
        (
            Limits {
                input_bytes: bytes.len() - 1,
                ..exact
            },
            Limit::Input,
        ),
        (
            Limits {
                allocation_work: usage.allocation_work - 1,
                ..exact
            },
            Limit::Allocation,
        ),
    ] {
        assert_eq!(
            with_limits::<(Time, Time, Time)>(&bytes, limits)
                .unwrap_err()
                .kind,
            ErrorKind::Limit(expected)
        );
        assert_eq!(postcard::to_allocvec(&decoded).unwrap(), bytes);
    }
}
