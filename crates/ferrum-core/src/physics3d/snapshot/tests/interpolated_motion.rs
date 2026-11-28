use super::*;

fn fixture() -> PhysicsWorld3d {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.037,
        ..WorldConfig::default()
    })
    .unwrap();
    world.set_step_motion_enabled(true);
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                angular_velocity: [0., 0., 40.],
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.025, 0.1],
            }),
        )
        .unwrap();
    world.step();
    world
}
fn unchecked(world: &PhysicsWorld3d) -> PhysicsSnapshot {
    // Encode the real private owner codec without calling/repairing with the
    // validator. A valid envelope/CRC alone must not admit a damaged path.
    let payload = postcard::to_allocvec(&Capture { world }).unwrap();
    let mut bytes = vec![0u8; HEADER];
    bytes.extend_from_slice(&payload);
    bytes[..8].copy_from_slice(MAGIC);
    bytes[8..12].copy_from_slice(&PHYSICS_SNAPSHOT_VERSION.to_le_bytes());
    bytes[12..20].copy_from_slice(&BUILD.to_le_bytes());
    bytes[20..24].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    bytes[24..28].copy_from_slice(&crc(&payload).to_le_bytes());
    PhysicsSnapshot { bytes }
}
#[test]
fn interpolation_time_valid_crc_damage_is_rejected_without_touching_live_world() {
    let mut candidate = fixture();
    let mut live = fixture();
    let before = live.capture_snapshot().unwrap().encoded_bytes().to_vec();
    candidate.step_motion.test_corrupt_precise_payload(3);
    let damaged = unchecked(&candidate);
    assert!(damaged.payload().is_ok());
    assert_eq!(
        live.restore_snapshot(&damaged),
        Err(PhysicsSnapshotError::InvalidState)
    );
    assert_eq!(live.capture_snapshot().unwrap().encoded_bytes(), before);
    // Never run solver/query against the rejected candidate.
}
#[test]
fn completed_rotating_interpolated_queries_survive_native_codec_and_six_tick_continuation() {
    let mut world = fixture();
    let saved = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    let query = Shape::Sphere { radius: 0.1 };
    let pose = Pose {
        position: [1.1, 0.8, 0.],
        ..Pose::default()
    };
    for _ in 0..6 {
        let (mut a, mut b) = (Vec::new(), Vec::new());
        assert_eq!(
            world.sweep_step_motion(&query, pose, [0.; 3], &QueryFilter::default(), &mut a, 64),
            restored.sweep_step_motion(&query, pose, [0.; 3], &QueryFilter::default(), &mut b, 64)
        );
        assert_eq!(a, b);
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
        world.step();
        restored.step();
    }
}

impl PhysicsSnapshot {
    pub(crate) fn test_interpolated_query(bytes: &[u8], pose: Pose) -> Vec<SweepHit> {
        let saved = Self {
            bytes: bytes.to_vec(),
        };
        let world = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        let mut hits = Vec::new();
        world
            .sweep_step_motion(
                &Shape::Sphere { radius: 0.1 },
                pose,
                [0.; 3],
                &QueryFilter::default(),
                &mut hits,
                64,
            )
            .unwrap();
        hits
    }

    pub(crate) fn test_bad_interpolated_time(bytes: &[u8]) -> Vec<u8> {
        let saved = Self {
            bytes: bytes.to_vec(),
        };
        let mut world = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        world.step_motion.test_corrupt_precise_payload(3);
        unchecked(&world).bytes
    }
}
