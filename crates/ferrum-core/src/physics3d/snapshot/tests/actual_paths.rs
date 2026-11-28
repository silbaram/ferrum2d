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
fn actual_curve_domain_valid_crc_damage_is_rejected_without_touching_live_world() {
    let mut candidate = fixture();
    let mut live = fixture();
    let before = live.capture_snapshot().unwrap().encoded_bytes().to_vec();
    candidate.step_motion.test_corrupt_actual_domain();
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
fn completed_rotating_kernel_queries_survive_native_codec_and_six_tick_continuation() {
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

// These tests consume real completed runtime records. The only new seam is
// A's cfg(test) borrowed/copy view of the existing serialized exact segments.
use crate::physics3d::{
    solver_trajectory::{Curve, ShapeMotion, Time},
    world::native_id,
};
use rapier3d::prelude as rp;

type SavedPiece = (ShapeMotion, Time, Time, Time, Time);

fn native_ccd_fixture(ccd: bool) -> (PhysicsWorld3d, BodyId) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        max_events: 16,
        ..WorldConfig::default()
    })
    .unwrap();
    world.set_step_motion_enabled(true);
    let angle = -std::f32::consts::FRAC_PI_8;
    let bar = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: Pose {
                    position: [0.; 3],
                    rotation: [0., 0., (angle * 0.5).sin(), (angle * 0.5).cos()],
                },
                angular_velocity: [0., 0., std::f32::consts::FRAC_PI_4 / 0.1],
                ccd,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.025, 0.1],
            }),
        )
        .unwrap();
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [1.99, 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.015 }),
        )
        .unwrap();
    world.step_checked().unwrap();
    assert_eq!(world.step_statistics().ccd_clamps, 1);
    assert_eq!(world.ccd_clamps()[0].moving.body, bar);
    assert!(world.body_state(bar).unwrap().pose.rotation[2] < 0.);
    (world, bar)
}

fn native_ccd_saved_pieces(world: &PhysicsWorld3d, body: BodyId) -> (SavedPiece, SavedPiece) {
    let records = world.step_motion.test_exact_segments(native_id(body));
    let prefix = records.iter().copied().find(|(motion, from, to, _, _)| {
        matches!(motion.curve, Curve::Integrated(kernel) if *from < *to && *to < kernel.domain.end)
            && records.iter().any(|(next, start, _, _, _)| {
                matches!(next.curve, Curve::Constant { .. }) && start == to
            })
    }).expect("real native CCD must retain an original-kernel prefix");
    let first_suffix = records
        .iter()
        .copied()
        .find(|(motion, start, end, _, _)| {
            matches!(motion.curve, Curve::Constant { .. }) && *start == prefix.2 && start < end
        })
        .expect("real native CCD must retain its stationary suffix");
    let Curve::Integrated(kernel) = prefix.0.curve else {
        unreachable!()
    };
    assert_eq!(kernel.native.motion.body, native_id(body));
    assert_eq!(
        rapier3d::pipeline::SolverBodyIntegration::from_velocity(
            kernel.native.motion.body,
            0.,
            kernel.native.integration_seconds,
            kernel.native.motion.start,
            kernel.native.linear_velocity,
            kernel.native.angular_velocity,
        )
        .unwrap()
        .motion
        .end,
        kernel.native.motion.end,
        "saved prefix must not replace the original kernel's end law with its clipped endpoint"
    );
    let held_com = prefix.0.curve.com_pose(prefix.2);
    assert_eq!(held_com, first_suffix.0.curve.com_pose(first_suffix.1));
    assert_eq!(prefix.4, first_suffix.3);
    // Native CCD preserves each original solver-context boundary on the
    // stationary suffix. Validate the entire stored chain in emitted order;
    // one Constant is not required to span the rest of the whole tick.
    let mut time = prefix.2;
    let mut fraction = prefix.4;
    let mut last_suffix = None;
    for &row in records.iter().filter(|row| row.2 > prefix.2) {
        assert!(matches!(row.0.curve, Curve::Constant { .. }));
        assert!(row.1 < row.2);
        assert!(row.3 < row.4);
        assert_eq!(row.1, time, "every real suffix context must be contiguous");
        assert_eq!(row.3, fraction, "no normalized-time gap or overlap");
        assert_eq!(row.0.local_center, prefix.0.local_center);
        assert_eq!(row.0.local_pose, prefix.0.local_pose);
        assert_eq!(row.0.curve.com_pose(row.1), held_com);
        assert_eq!(row.0.curve.com_pose(row.2), held_com);
        time = row.2;
        fraction = row.4;
        last_suffix = Some(row);
    }
    assert_eq!(fraction, 1.);
    (
        prefix,
        last_suffix.expect("all saved suffix contexts were visited"),
    )
}

fn native_ccd_query_oracle(world: &PhysicsWorld3d, body: BodyId) -> (Shape, Pose, Vec<SweepHit>) {
    let (prefix, suffix) = native_ccd_saved_pieces(world, body);
    let query_shape = Shape::Sphere { radius: 0.005 };
    let middle = prefix.1 + (prefix.2 - prefix.1) * 0.5;
    let at = prefix.0.pose(middle) * rp::Vector::new(1.5, 0., 0.);
    let query_pose = Pose {
        position: at.to_array(),
        ..Pose::default()
    };
    let sphere = rp::Ball::new(0.005);
    let bar = rp::Cuboid::new(rp::Vector::new(2., 0.025, 0.1));
    let query_native = rp::Pose::from_translation(at);
    // Independent finite-face/corner point projection on the original box,
    // rather than the trajectory cast, its BVH, or its round-support GJK.
    let distance = |time| {
        let p = prefix.0.pose(time);
        rapier3d::parry::query::details::contact_convex_polyhedron_ball(
            &p.inv_mul(&query_native),
            &bar,
            &sphere,
            f32::MAX,
        )
        .unwrap()
        .dist
    };
    assert!(distance(prefix.1) > 0.);
    assert!(distance(middle) < 0.);
    let final_pose = suffix.0.pose(suffix.2);
    assert!(
        rapier3d::parry::query::details::contact_convex_polyhedron_ball(
            &final_pose.inv_mul(&query_native),
            &bar,
            &sphere,
            f32::MAX,
        )
        .unwrap()
        .dist
            > 0.,
        "endpoint-only reconstruction would miss this real interior crossing"
    );
    let (mut lo, mut hi) = (prefix.1, middle);
    for _ in 0..64 {
        let mid = lo + (hi - lo) * 0.5;
        if mid <= lo || mid >= hi {
            break;
        }
        if distance(mid) <= 0. {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    let fraction =
        |time| prefix.3 + (prefix.4 - prefix.3) * ((time - prefix.1) / (prefix.2 - prefix.1));
    let mut hits = Vec::new();
    world
        .sweep_step_motion(
            &query_shape,
            query_pose,
            [0.; 3],
            &QueryFilter::default(),
            &mut hits,
            64,
        )
        .unwrap();
    let hit = hits
        .iter()
        .find(|h| h.target.body == body)
        .expect("stored prefix must hit the independently projected interior point");
    assert!(!hit.initial_overlap);
    // Keep the existing trajectory query's 1e-6 interval tolerance; account only
    // for the public f32 fraction's final rounding, with no new geometry skin.
    let from = (fraction(lo) as f32).next_down();
    let to = ((fraction(hi) + (prefix.4 - prefix.3) * 1e-6) as f32).next_up();
    assert!(
        (from..=to).contains(&hit.fraction),
        "query={hit:?} oracle=[{from},{to}]"
    );
    assert!(hit.point.into_iter().chain(hit.normal).all(f32::is_finite));
    (query_shape, query_pose, hits)
}

impl PhysicsSnapshot {
    pub(crate) fn test_assert_native_step_motion_enabled(bytes: &[u8]) {
        let saved = Self {
            bytes: bytes.to_vec(),
        };
        let world = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        assert!(
            world.step_motion.enabled,
            "actual unhit Native projectile must enable saved observations"
        );
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), bytes);
    }
    // Test-only cross-owner seam: Engine file tests can inspect the existing
    // native checkpoint without exposing UnifiedPhysicsRuntime's private World.
    pub(crate) fn test_assert_native_ccd_saved_query(
        bytes: &[u8],
        body: BodyId,
    ) -> (Shape, Pose, Vec<SweepHit>) {
        let saved = Self {
            bytes: bytes.to_vec(),
        };
        let world = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
        let query = native_ccd_query_oracle(&world, body);
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
        query
    }
    pub(crate) fn test_query_saved_native_ccd(
        bytes: &[u8],
        shape: &Shape,
        pose: Pose,
    ) -> Vec<SweepHit> {
        let saved = Self {
            bytes: bytes.to_vec(),
        };
        let world = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        let mut hits = Vec::new();
        world
            .sweep_step_motion(shape, pose, [0.; 3], &QueryFilter::default(), &mut hits, 64)
            .unwrap();
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), bytes);
        hits
    }
    pub(crate) fn test_native_ccd_bad_original_end(bytes: &[u8], body: BodyId) -> Vec<u8> {
        let saved = Self {
            bytes: bytes.to_vec(),
        };
        let world = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        let (prefix, _) = native_ccd_saved_pieces(&world, body);
        let Curve::Integrated(mut kernel) = prefix.0.curve else {
            unreachable!()
        };
        let marker = postcard::to_allocvec(&kernel).unwrap();
        // Finite/unit payload: only the canonical original native endpoint law
        // is broken; don't let a simpler NaN/domain check hide its rejection.
        kernel.native.motion.end.translation.x += 0.03125;
        let replacement = postcard::to_allocvec(&kernel).unwrap();
        assert_eq!(marker.len(), replacement.len());
        let positions: Vec<_> = bytes[HEADER..]
            .windows(marker.len())
            .enumerate()
            .filter_map(|(i, x)| (x == marker).then_some(HEADER + i))
            .collect();
        assert_eq!(
            positions.len(),
            1,
            "actual saved kernel marker must be unique"
        );
        let mut damaged = bytes.to_vec();
        damaged[positions[0]..positions[0] + marker.len()].copy_from_slice(&replacement);
        let checksum = crc(&damaged[HEADER..]);
        damaged[24..28].copy_from_slice(&checksum.to_le_bytes());
        assert!(Self {
            bytes: damaged.clone()
        }
        .payload()
        .is_ok());
        damaged
    }
}

#[test]
fn native_ccd_actual_kernel_prefix_and_constant_suffix_survive_checkpoint_queries_and_six_ticks() {
    assert_eq!(PHYSICS_SNAPSHOT_VERSION, 7);
    for ccd in [false, true] {
        let (mut world, body) = native_ccd_fixture(ccd);
        let before = world.capture_snapshot().unwrap();
        let (shape, pose, expected) = native_ccd_query_oracle(&world, body);
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
        let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
        assert_eq!(
            PhysicsSnapshot::test_assert_native_ccd_saved_query(before.encoded_bytes(), body).2,
            expected
        );
        for _ in 0..6 {
            let (mut a, mut b) = (Vec::new(), Vec::new());
            world
                .sweep_step_motion(&shape, pose, [0.; 3], &QueryFilter::default(), &mut a, 64)
                .unwrap();
            restored
                .sweep_step_motion(&shape, pose, [0.; 3], &QueryFilter::default(), &mut b, 64)
                .unwrap();
            assert_eq!(a, b);
            assert_eq!(world.body_state(body), restored.body_state(body));
            assert_eq!(world.ccd_clamps(), restored.ccd_clamps());
            assert_eq!(
                world.capture_snapshot().unwrap().encoded_bytes(),
                restored.capture_snapshot().unwrap().encoded_bytes()
            );
            world.step_checked().unwrap();
            restored.step_checked().unwrap();
        }
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn native_ccd_original_kernel_end_law_valid_crc_damage_is_rejected_atomically() {
    for ccd in [false, true] {
        let (mut world, body) = native_ccd_fixture(ccd);
        let before = world.capture_snapshot().unwrap();
        let bad = PhysicsSnapshot {
            bytes: PhysicsSnapshot::test_native_ccd_bad_original_end(before.encoded_bytes(), body),
        };
        let bad_before = bad.encoded_bytes().to_vec();
        assert_eq!(
            world.restore_snapshot(&bad),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
        assert_eq!(bad.encoded_bytes(), bad_before);
    }
}

#[test]
fn native_ccd_completed_runtime_keeps_exact_and_one_below_byte_and_decode_allowances() {
    use crate::checkpoint_decode::{with_limits, ErrorKind, Limit, Limits};
    for ccd in [false, true] {
        let (world, body) = native_ccd_fixture(ccd);
        let before = world.capture_snapshot().unwrap();
        native_ccd_saved_pieces(&world, body);
        let length = before.encoded_bytes().len();
        assert_eq!(
            world
                .capture_snapshot_with_limit(length)
                .unwrap()
                .encoded_bytes(),
            before.encoded_bytes()
        );
        assert!(matches!(
            world.capture_snapshot_with_limit(length - 1),
            Err(PhysicsSnapshotError::Capacity)
        ));
        let payload = before.payload().unwrap();
        let (_, usage) = with_limits::<Restore>(payload, Limits::default()).unwrap();
        let exact = Limits {
            input_bytes: payload.len(),
            allocation_work: usage.allocation_work,
            values: usage.values,
            depth: usage.peak_depth,
            ..Limits::default()
        };
        let (_, admitted) = with_limits::<Restore>(payload, exact).unwrap();
        assert_eq!(admitted, usage);
        for (limit, kind) in [
            (
                Limits {
                    input_bytes: payload.len() - 1,
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
            let error = match with_limits::<Restore>(payload, limit) {
                Ok(_) => panic!("one below must reject"),
                Err(e) => e,
            };
            assert_eq!(error.kind, ErrorKind::Limit(kind));
        }
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
}
