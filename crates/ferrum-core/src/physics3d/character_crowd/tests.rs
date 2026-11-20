use super::*;
use crate::physics3d::{
    BodyDesc, BodyKind, BodyOptions, CharacterConfig, ColliderDesc, Shape, WorldConfig,
};

fn actor(w: &mut PhysicsWorld3d, position: [f32; 3], local: [f32; 3]) -> BodyId {
    let id = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position,
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                pose: Pose {
                    position: local,
                    ..Pose::default()
                },
                ..ColliderDesc::new(Shape::Capsule {
                    half_height: 0.5,
                    radius: 0.25,
                })
            },
        )
        .unwrap();
    w.enable_character(id, CharacterConfig::default()).unwrap();
    id
}
fn check(
    w: &PhysicsWorld3d,
    source: BodyId,
    peer: BodyId,
    movement: [f32; 3],
    velocity: [f32; 3],
) -> bool {
    w.character_crowd_clear(
        source,
        w.body_state(source).unwrap().pose,
        movement,
        1.,
        0.1,
        &[CharacterCrowdPeer {
            body: peer,
            velocity,
        }],
    )
    .unwrap()
    .clear
}
#[test]
fn native_crowd_geometry_sweeps_capsules_and_relative_peer_velocity_without_mutation() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = actor(&mut w, [0., 1., 0.], [0.; 3]);
    let b = actor(&mut w, [5., 1., 0.], [0.; 3]);
    let before = w.body_state(a).unwrap();
    assert!(!check(&w, a, b, [10., 0., 0.], [0.; 3]));
    assert!(check(&w, a, b, [10., 0., 0.], [10., 0., 0.]));
    assert!(!check(&w, a, b, [0.; 3], [-10., 0., 0.]));
    assert_eq!(w.body_state(a).unwrap(), before);
}

#[test]
fn native_crowd_geometry_plane_support_uses_offset_and_hypothetical_pose() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = actor(&mut w, [100., 1., 0.], [-98., 0., 0.]);
    let n = std::f32::consts::FRAC_1_SQRT_2;
    let (center, point) = w
        .character_plane_support(
            a,
            Pose {
                position: [100., 2., 0.],
                ..Pose::default()
            },
            [-n, n, 0.],
        )
        .unwrap();
    assert_eq!(center, [2., 2., 0.]);
    assert!((point[0] - 2. - n * 0.25).abs() < 1e-6);
    assert!((point[1] - 1.5 + n * 0.25).abs() < 1e-6);
    assert_eq!(w.body_state(a).unwrap().pose.position, [100., 1., 0.]);
}
#[test]
fn native_crowd_geometry_allows_escape_and_tangents_from_existing_padding_overlap() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = actor(&mut w, [0., 1., 0.], [0.; 3]);
    let b = actor(&mut w, [0.55, 1., 0.], [0.; 3]);
    assert!(check(&w, a, b, [-0.1, 0., 0.], [0.; 3]));
    assert!(check(&w, a, b, [0., 0., 0.1], [0.; 3]));
    assert!(!check(&w, a, b, [0.1, 0., 0.], [0.; 3]));
}
#[test]
fn native_crowd_geometry_uses_local_pose_actual_height_filters_and_live_generations() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = actor(&mut w, [0., 1., 0.], [0.; 3]);
    let b = actor(&mut w, [100., 1., 0.], [-98., 0., 0.]);
    assert!(!check(&w, a, b, [3., 0., 0.], [0.; 3]));
    w.set_pose(
        b,
        Pose {
            position: [100., 5., 0.],
            ..Pose::default()
        },
    )
    .unwrap();
    assert!(check(&w, a, b, [3., 0., 0.], [0.; 3]));
    w.set_pose(
        b,
        Pose {
            position: [100., 1., 0.],
            ..Pose::default()
        },
    )
    .unwrap();
    let collider = w.collider_ids(b).unwrap().next().unwrap();
    let mut desc = ColliderDesc {
        mask: 0,
        pose: Pose {
            position: [-98., 0., 0.],
            ..Pose::default()
        },
        ..ColliderDesc::new(Shape::Capsule {
            half_height: 0.5,
            radius: 0.25,
        })
    };
    w.update_collider(collider, desc.clone()).unwrap();
    assert!(check(&w, a, b, [3., 0., 0.], [0.; 3]));
    desc.mask = u32::MAX;
    w.update_collider(collider, desc).unwrap();
    w.disable_character(b).unwrap();
    w.set_body_options(
        b,
        &BodyOptions {
            enabled: false,
            ..BodyOptions::default()
        },
    )
    .unwrap();
    assert!(check(&w, a, b, [3., 0., 0.], [0.; 3]));
    w.remove_body(b).unwrap();
    let replacement = actor(&mut w, [2., 1., 0.], [0.; 3]);
    assert_eq!(replacement.slot, b.slot);
    assert_ne!(replacement.generation, b.generation);
    assert!(check(&w, a, b, [3., 0., 0.], [0.; 3]));
    assert!(!check(&w, a, replacement, [3., 0., 0.], [0.; 3]));
}

#[test]
fn native_crowd_masked_long_query_skips_only_selected_rows_and_preserves_source_bytes() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = actor(&mut w, [0., 1., 0.], [0.; 3]);
    let b = actor(&mut w, [1.2, 1., 0.], [0.; 3]);
    let c = actor(&mut w, [0., 1., 6.], [0.; 3]);
    let pose = w.body_state(a).unwrap().pose;
    let peers = [
        CharacterCrowdPeer {
            body: a,
            velocity: [0.; 3],
        },
        CharacterCrowdPeer {
            body: b,
            velocity: [0.; 3],
        },
        CharacterCrowdPeer {
            body: c,
            velocity: [0.; 3],
        },
    ];
    let before = w.capture_snapshot().unwrap();
    let input = postcard::to_allocvec(&peers).unwrap();
    let short = w
        .character_crowd_clear(a, pose, [0.02, 0., 0.], 0.01, 0.1, &peers)
        .unwrap();
    assert!(short.clear);
    assert_eq!(short.tests, 2);
    let full = w
        .character_crowd_clear(a, pose, [1., 0., 0.], 0.5, 0.1, &peers)
        .unwrap();
    assert!(!full.clear);
    assert_eq!(full.tests, 1);
    let zero_mask = w
        .character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &peers, 0)
        .unwrap();
    assert_eq!((zero_mask.clear, zero_mask.tests), (full.clear, full.tests));
    let skip_blocker = w
        .character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &peers, 0b010)
        .unwrap();
    assert!(skip_blocker.clear);
    assert_eq!(
        skip_blocker.tests, 1,
        "only the other non-self row is queried"
    );
    let skip_both = w
        .character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &peers, 0b110)
        .unwrap();
    assert!(skip_both.clear);
    assert_eq!(skip_both.tests, 0);
    assert_eq!(postcard::to_allocvec(&peers).unwrap(), input);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn native_crowd_mask_bounds_and_skipped_payload_are_checked_before_peer_geometry() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = actor(&mut w, [0., 1., 0.], [0.; 3]);
    let b = actor(&mut w, [1.2, 1., 0.], [0.; 3]);
    let pose = w.body_state(a).unwrap().pose;
    // A crafted internal query input, not a supported public/file producer.
    // Its excluded payload must not be read by the long query. The required
    // unmasked short query still rejects it, so it cannot bypass admission.
    let peers = [CharacterCrowdPeer {
        body: b,
        velocity: [f32::NAN, 0., 0.],
    }];
    let before = w.capture_snapshot().unwrap();
    let input = postcard::to_allocvec(&peers).unwrap();
    assert!(matches!(
        w.character_crowd_clear(a, pose, [0.02, 0., 0.], 0.01, 0.1, &peers),
        Err(PhysicsError::InvalidQuery)
    ));
    let excluded = w
        .character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &peers, 1)
        .unwrap();
    assert!(excluded.clear);
    assert_eq!(excluded.tests, 0);
    assert!(matches!(
        w.character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &peers, 2),
        Err(PhysicsError::InvalidQuery)
    ));
    assert!(matches!(
        w.character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &[], 1),
        Err(PhysicsError::InvalidQuery)
    ));
    let empty = w
        .character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &[], 0)
        .unwrap();
    assert_eq!((empty.clear, empty.tests), (true, 0));
    let full64: Vec<_> = (0..64)
        .map(|_| CharacterCrowdPeer {
            body: b,
            velocity: [0.; 3],
        })
        .collect();
    let all_excluded = w
        .character_crowd_clear_masked(a, pose, [1., 0., 0.], 0.5, 0.1, &full64, u64::MAX)
        .unwrap();
    assert_eq!((all_excluded.clear, all_excluded.tests), (true, 0));
    assert_eq!(postcard::to_allocvec(&peers).unwrap(), input);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}
