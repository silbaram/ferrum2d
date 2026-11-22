//! Restored geometry must use the public collider domain. Storage checks alone
//! admitted finite out-of-domain half-extents that trapped EPA on the next step.
use super::*;

fn reseal(bytes: &mut [u8]) {
    let length = (bytes.len() - HEADER) as u32;
    let checksum = crc(&bytes[HEADER..]);
    bytes[20..24].copy_from_slice(&length.to_le_bytes());
    bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
}

#[test]
fn restore_rejects_finite_out_of_domain_half_extent_without_changing_world() {
    // A unique half-extent bit pattern locates the stored cuboid field. It is
    // not the thinnest axis, so the body's derived CCD thickness differs.
    const MARK: f32 = 0.718_281_8;
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space,
            ..WorldConfig::default()
        })
        .unwrap();
        cube(&mut w, BodyKind::Fixed, [0., -1., 0.]);
        let id = body(
            &mut w,
            BodyKind::Dynamic,
            // Off-origin, so the world AABB does not repeat the marker bits.
            [1., 0.5, 0.],
            Shape::Box {
                half_extents: [0.4, MARK, 0.4],
            },
        );
        let checkpoint = w.capture_snapshot().unwrap();
        let before = w.body_state(id).unwrap();
        let mark = MARK.to_le_bytes();
        let found: Vec<_> = checkpoint
            .bytes
            .windows(4)
            .enumerate()
            .filter_map(|(at, v)| (v == mark).then_some(at))
            .collect();
        assert_eq!(found.len(), 1, "{space:?} stored cuboid half-extent");
        let at = found[0];
        for huge in [1.0e30_f32, 3.0e38, 10000.5] {
            let mut bad = checkpoint.clone();
            bad.bytes[at..at + 4].copy_from_slice(&huge.to_le_bytes());
            reseal(&mut bad.bytes);
            assert_eq!(
                w.restore_snapshot(&bad),
                Err(PhysicsSnapshotError::InvalidState),
                "{space:?} {huge}"
            );
            assert_eq!(w.body_state(id).unwrap(), before);
        }
        // The untouched checkpoint still restores and steps.
        w.restore_snapshot(&checkpoint).unwrap();
        step(&mut w, 2);
    }
}

#[test]
fn snapshot_state_rejects_native_shapes_outside_public_authoring() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let id = cube(&mut w, BodyKind::Dynamic, [0., 2., 0.]);
    assert_eq!(w.validate_snapshot_state(), Ok(()));
    let collider = *w
        .backend
        .bodies
        .get(native_id(id))
        .unwrap()
        .colliders()
        .first()
        .unwrap();
    let cases = [
        // Public capsules are local-Y only.
        rp::SharedShape::capsule_z(0.5, 0.25),
        rp::SharedShape::cylinder(0.5, 0.25),
        rp::SharedShape::ball(20000.),
        rp::SharedShape::cuboid(0.4, 0.00001, 0.4),
        rp::SharedShape::cuboid(1.0e30, 0.4, 0.4),
    ];
    for shape in cases {
        w.backend
            .colliders
            .get_mut(collider)
            .unwrap()
            .set_shape(shape);
        assert_eq!(
            w.validate_snapshot_state(),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert!(w.capture_snapshot().is_err());
    }
}

#[test]
fn planar_snapshot_state_rejects_out_of_plane_collider_offset() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        ..WorldConfig::default()
    })
    .unwrap();
    let id = cube(&mut w, BodyKind::Dynamic, [0., 2., 0.]);
    assert_eq!(w.validate_snapshot_state(), Ok(()));
    let collider = *w
        .backend
        .bodies
        .get(native_id(id))
        .unwrap()
        .colliders()
        .first()
        .unwrap();
    w.backend
        .colliders
        .get_mut(collider)
        .unwrap()
        .set_position_wrt_parent(rp::Pose::from_translation(rp::Vector::new(0., 0., 0.5)));
    assert_eq!(
        w.validate_snapshot_state(),
        Err(PhysicsSnapshotError::InvalidState)
    );
}
