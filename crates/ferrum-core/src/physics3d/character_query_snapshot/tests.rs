use super::*;
use crate::physics3d::{
    BodyDesc, BodyKind, ColliderDesc, PhysicsSnapshotError, Shape, Space, WorldConfig,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

fn fixture(space: Space) -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let floor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            box_desc(),
        )
        .unwrap();
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0., 2., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.4,
            }),
        )
        .unwrap();
    world
        .enable_character(actor, CharacterConfig::default())
        .unwrap();
    (world, actor, floor)
}

fn box_desc() -> ColliderDesc {
    ColliderDesc::new(Shape::Box {
        half_extents: [0.5; 3],
    })
}

fn roundtrip<T: Serialize + for<'de> Deserialize<'de>>(value: &T) -> T {
    postcard::from_bytes(&postcard::to_allocvec(value).unwrap()).unwrap()
}

fn check(
    world: &PhysicsWorld3d,
    a: &CharacterQuerySnapshot,
    f: &FixedQuerySnapshot,
    expected: bool,
) {
    assert_eq!(world.character_query_snapshot_matches(a), expected);
    assert_eq!(world.fixed_query_snapshot_matches(f), expected);
}

#[test]
fn query_snapshot_serialized_records_match_independently_decoded_native_worlds() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (world, actor, floor) = fixture(space);
        let query = roundtrip(&world.capture_character_query_snapshot(actor, true).unwrap());
        let fixed = roundtrip(&world.capture_fixed_query_snapshot());
        let snapshot = world.capture_snapshot().unwrap();
        let mut restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
        let id = world.collider_ids(floor).unwrap().next().unwrap();
        let a = world
            .backend
            .colliders
            .get(super::super::colliders::native_collider(id))
            .unwrap();
        let b = restored
            .backend
            .colliders
            .get(super::super::colliders::native_collider(id))
            .unwrap();
        assert!(!Arc::ptr_eq(&a.shared_shape().0, &b.shared_shape().0));
        drop(world);
        check(&restored, &query, &fixed, true);
        // Replacing equal geometry must invalidate both the restored job and cache.
        restored.update_collider(id, box_desc()).unwrap();
        check(&restored, &query, &fixed, false);
    }
}

#[test]
fn query_snapshot_equal_shape_replacements_and_edit_back_never_revive_stale_records() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut world, actor, floor) = fixture(space);
        let id = world.collider_ids(floor).unwrap().next().unwrap();
        let query = world
            .capture_character_query_snapshot(actor, false)
            .unwrap();
        let fixed = world.capture_fixed_query_snapshot();
        for desc in [
            box_desc(),
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            box_desc(),
        ] {
            world.update_collider(id, desc).unwrap();
            assert!(!world.collider_shape_revisions.is_empty());
            check(&world, &query, &fixed, false);
            let restored =
                PhysicsWorld3d::from_snapshot(&world.capture_snapshot().unwrap()).unwrap();
            check(&restored, &roundtrip(&query), &roundtrip(&fixed), false);
            check(
                &restored,
                &roundtrip(
                    &world
                        .capture_character_query_snapshot(actor, false)
                        .unwrap(),
                ),
                &roundtrip(&world.capture_fixed_query_snapshot()),
                true,
            );
        }
    }
}

#[test]
fn query_snapshot_rejected_shape_edits_and_exhaustion_leave_every_observation_unchanged() {
    let (mut world, actor, floor) = fixture(Space::Spatial);
    let id = world.collider_ids(floor).unwrap().next().unwrap();
    for revision in [0, u64::MAX] {
        if revision != 0 {
            world.collider_shape_revisions.insert(id, revision);
        }
        let before = world.capture_snapshot().unwrap();
        let query = world
            .capture_character_query_snapshot(actor, false)
            .unwrap();
        let fixed = world.capture_fixed_query_snapshot();
        let invalid = ColliderDesc::new(Shape::Sphere { radius: f32::NAN });
        assert!(world.update_collider(id, invalid).is_err());
        if revision == u64::MAX {
            assert_eq!(
                world.update_collider(id, box_desc()),
                Err(PhysicsError::CapacityExceeded)
            );
        }
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
        check(&world, &query, &fixed, true);
        let restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
        check(&restored, &roundtrip(&query), &roundtrip(&fixed), true);
    }
}

#[test]
fn query_snapshot_removed_fixture_generations_and_sparse_revisions_do_not_alias_or_leak() {
    let (mut world, actor, floor) = fixture(Space::Spatial);
    let id = world.collider_ids(floor).unwrap().next().unwrap();
    world.update_collider(id, box_desc()).unwrap();
    let query = world
        .capture_character_query_snapshot(actor, false)
        .unwrap();
    let fixed = world.capture_fixed_query_snapshot();
    world.remove_collider(id).unwrap();
    assert!(world.collider_shape_revisions.is_empty());
    let replacement = world.add_collider(floor, box_desc()).unwrap();
    assert_eq!(id.slot, replacement.slot);
    assert_ne!(id.generation, replacement.generation);
    check(&world, &query, &fixed, false);
    world.update_collider(replacement, box_desc()).unwrap();
    world.remove_body(floor).unwrap();
    assert!(world.collider_shape_revisions.is_empty());
    let restored = PhysicsWorld3d::from_snapshot(&world.capture_snapshot().unwrap()).unwrap();
    check(&restored, &roundtrip(&query), &roundtrip(&fixed), false);
    world.clear();
    assert!(world.collider_shape_revisions.is_empty());
}

#[test]
fn query_snapshot_does_not_retain_obsolete_geometry_or_encode_mesh_payloads() {
    let (mut world, actor, floor) = fixture(Space::Spatial);
    let id = world.collider_ids(floor).unwrap().next().unwrap();
    let native = super::super::colliders::native_collider(id);
    let old = Arc::downgrade(
        &world
            .backend
            .colliders
            .get(native)
            .unwrap()
            .shared_shape()
            .0,
    );
    let query = world
        .capture_character_query_snapshot(actor, false)
        .unwrap();
    let fixed = world.capture_fixed_query_snapshot();
    let small_bytes = postcard::to_allocvec(&(query.clone(), fixed.clone())).unwrap();
    let vertices = (0..4096)
        .map(|x| [x as f32, (x % 2) as f32, (x % 3) as f32])
        .collect();
    let triangles = (0..4094).map(|x| [x, x + 1, x + 2]).collect();
    world
        .update_collider(
            id,
            ColliderDesc::new(Shape::TriangleMesh {
                vertices,
                triangles,
            }),
        )
        .unwrap();
    assert!(
        old.upgrade().is_none(),
        "snapshots must not keep old meshes alive"
    );
    let large_bytes = postcard::to_allocvec(&(
        world
            .capture_character_query_snapshot(actor, false)
            .unwrap(),
        world.capture_fixed_query_snapshot(),
    ))
    .unwrap();
    assert_eq!(small_bytes.len(), large_bytes.len());
    assert!(large_bytes.len() < 1024);
    check(&world, &query, &fixed, false);
}

#[test]
fn query_snapshot_native_capture_rejects_dangling_or_zero_shape_revision_entries() {
    let (mut world, _, floor) = fixture(Space::Spatial);
    let id = world.collider_ids(floor).unwrap().next().unwrap();
    world.collider_shape_revisions.insert(id, 0);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        PhysicsSnapshotError::InvalidState
    );
    world.collider_shape_revisions.clear();
    world.remove_body(floor).unwrap();
    world.collider_shape_revisions.insert(id, 1);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        PhysicsSnapshotError::InvalidState
    );
}

#[test]
fn query_snapshot_shape_revision_checks_retain_fixed_only_membership_and_character_scope() {
    let (mut world, actor, _) = fixture(Space::Spatial);
    let peer = world.create_body(BodyDesc::default(), box_desc()).unwrap();
    let all = world
        .capture_character_query_snapshot(actor, false)
        .unwrap();
    let restricted = world.capture_character_query_snapshot(actor, true).unwrap();
    let fixed = world.capture_fixed_query_snapshot();
    let peer_id = world.collider_ids(peer).unwrap().next().unwrap();
    world.update_collider(peer_id, box_desc()).unwrap();
    assert!(!world.character_query_snapshot_matches(&all));
    check(&world, &restricted, &fixed, true);
    let id = world.collider_ids(actor).unwrap().next().unwrap();
    world
        .update_collider(
            id,
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.6,
                radius: 0.4,
            }),
        )
        .unwrap();
    assert!(!world.character_query_snapshot_matches(&restricted));
    assert!(world.fixed_query_snapshot_matches(&fixed));
    let restored = PhysicsWorld3d::from_snapshot(&world.capture_snapshot().unwrap()).unwrap();
    assert!(!restored.character_query_snapshot_matches(&roundtrip(&restricted)));
    assert!(restored.fixed_query_snapshot_matches(&roundtrip(&fixed)));
}

mod controller_admission_tests;
