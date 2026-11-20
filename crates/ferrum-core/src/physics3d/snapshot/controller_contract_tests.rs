use super::*;
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, Pose, Shape, WorldConfig,
};
use rapier3d::prelude as rp;
fn fixture(
    config: CharacterConfig,
    rotation: [f32; 4],
    local: [f32; 4],
) -> (PhysicsWorld3d, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0., 2., 0.],
                    rotation,
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                pose: Pose {
                    rotation: local,
                    ..Pose::default()
                },
                ..ColliderDesc::new(Shape::Capsule {
                    half_height: 0.5,
                    radius: 0.25,
                })
            },
        )
        .unwrap();
    w.enable_character(a, config).unwrap();
    (w, a)
}
fn replace(snapshot: &PhysicsSnapshot, old: &[u8], new: &[u8]) -> PhysicsSnapshot {
    assert_eq!(old.len(), new.len());
    let positions = snapshot.bytes[HEADER..]
        .windows(old.len())
        .enumerate()
        .filter_map(|(i, b)| (b == old).then_some(HEADER + i))
        .collect::<Vec<_>>();
    assert_eq!(positions.len(), 1);
    let mut changed = snapshot.clone();
    let at = positions[0];
    changed.bytes[at..at + old.len()].copy_from_slice(new);
    let sum = crc(&changed.bytes[HEADER..]);
    changed.bytes[24..28].copy_from_slice(&sum.to_le_bytes());
    assert!(changed.payload().is_ok());
    changed
}
#[test]
fn controller_admission_native_snapshot_rejects_valid_crc_skin_radius_contract() {
    let skin = f32::from_bits(0x3d00adfd);
    let (mut source, a) = fixture(
        CharacterConfig {
            skin_width: skin,
            ..CharacterConfig::default()
        },
        Pose::default().rotation,
        Pose::default().rotation,
    );
    source
        .set_character_input(
            a,
            CharacterInput {
                velocity: [0., 0., 0.5],
                jump_speed: 3.,
            },
        )
        .unwrap();
    let before = source.capture_snapshot().unwrap();
    assert!(source
        .enable_character(
            a,
            CharacterConfig {
                skin_width: 0.125,
                ..CharacterConfig::default()
            }
        )
        .is_err());
    for bad in [0.125f32, f32::from_bits(0.125f32.to_bits() + 1)] {
        let changed = replace(&before, &skin.to_le_bytes(), &bad.to_le_bytes());
        assert_eq!(
            PhysicsWorld3d::from_snapshot(&changed).err(),
            Some(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            source.restore_snapshot(&changed).err(),
            Some(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            source.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
}
#[test]
fn controller_admission_native_snapshot_rejects_valid_crc_body_up_mismatch() {
    let up = [0.6f32, 0.8, 0.];
    let rotation = rp::Rotation::from_rotation_z(-0.6435011).to_array();
    let (mut source, a) = fixture(
        CharacterConfig {
            up,
            ..CharacterConfig::default()
        },
        rotation,
        Pose::default().rotation,
    );
    source
        .set_character_input(
            a,
            CharacterInput {
                velocity: [0., 0., 0.5],
                jump_speed: 3.,
            },
        )
        .unwrap();
    let before = source.capture_snapshot().unwrap();
    assert!(source
        .enable_character(a, CharacterConfig::default())
        .is_err());
    assert!(source.set_pose(a, Pose::default()).is_err());
    let old = up
        .into_iter()
        .flat_map(f32::to_le_bytes)
        .collect::<Vec<_>>();
    let new = [0f32, 1., 0.]
        .into_iter()
        .flat_map(f32::to_le_bytes)
        .collect::<Vec<_>>();
    let changed = replace(&before, &old, &new);
    assert_eq!(
        PhysicsWorld3d::from_snapshot(&changed).err(),
        Some(PhysicsSnapshotError::InvalidState)
    );
    assert_eq!(
        source.restore_snapshot(&changed).err(),
        Some(PhysicsSnapshotError::InvalidState)
    );
    assert_eq!(
        source.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}
#[test]
fn controller_admission_native_public_skin_boundary_and_axis_pending_six_tick_replay() {
    let identity = Pose::default().rotation;
    let turn = rp::Rotation::from_rotation_z(0.5);
    let cases = [
        (
            CharacterConfig {
                skin_width: f32::from_bits(0.125f32.to_bits() - 1),
                push_mass: 10.,
                ..CharacterConfig::default()
            },
            identity,
            identity,
        ),
        (
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
            rp::Rotation::from_rotation_x(std::f32::consts::PI).to_array(),
            identity,
        ),
        (
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
            turn.to_array(),
            turn.inverse().to_array(),
        ),
        (
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
            rp::Rotation::from_rotation_x(0.003).to_array(),
            identity,
        ),
    ];
    for (config, body, local) in cases {
        let (mut source, a) = fixture(config, body, local);
        source
            .set_character_input(
                a,
                CharacterInput {
                    velocity: [0., 0., 0.5],
                    jump_speed: 3.,
                },
            )
            .unwrap();
        source.set_character_traversal(a, 0.7, 0.8).unwrap();
        source.add_character_force(a, [1., 0., 0.]).unwrap();
        source.apply_character_impulse(a, [2., 0., 0.]).unwrap();
        let snapshot = source.capture_snapshot().unwrap();
        let mut candidate = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
        assert_eq!(
            candidate.capture_snapshot().unwrap().encoded_bytes(),
            snapshot.encoded_bytes()
        );
        for _ in 0..6 {
            source.step();
            candidate.step();
            assert!(PhysicsWorld3d::from_snapshot(&source.capture_snapshot().unwrap()).is_ok());
            assert_eq!(
                source.body_state(a).unwrap(),
                candidate.body_state(a).unwrap()
            );
            assert_eq!(
                source.character_state(a).unwrap(),
                candidate.character_state(a).unwrap()
            );
            assert_eq!(
                source.capture_snapshot().unwrap().encoded_bytes(),
                candidate.capture_snapshot().unwrap().encoded_bytes()
            );
        }
        assert!(source.body_state(a).unwrap().pose.position[2] > 0.04);
    }
}
#[test]
fn controller_admission_native_preenable_target_is_history_not_current_axis() {
    let mut source = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = source
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
                radius: 0.25,
            }),
        )
        .unwrap();
    source
        .set_kinematic_target(
            a,
            Pose {
                position: [1., 2., 0.],
                rotation: rp::Rotation::from_rotation_x(std::f32::consts::FRAC_PI_2).to_array(),
            },
        )
        .unwrap();
    source
        .enable_character(a, CharacterConfig::default())
        .unwrap();
    let snapshot = source.capture_snapshot().unwrap();
    let mut candidate = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    assert_eq!(
        candidate.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );
    for _ in 0..6 {
        source.step();
        candidate.step();
        assert!(PhysicsWorld3d::from_snapshot(&source.capture_snapshot().unwrap()).is_ok());
        assert_eq!(
            source.capture_snapshot().unwrap().encoded_bytes(),
            candidate.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}
