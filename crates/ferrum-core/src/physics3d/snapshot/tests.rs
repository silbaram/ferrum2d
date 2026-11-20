use super::*;
use crate::physics3d::*;

mod actual_paths;
mod body_numerics;
mod contact_numerics;
mod contact_workspaces;
mod continuation;
mod integration_admission;
mod joint_numerics;
mod pending_removals;
mod shape_edits;
mod stored_references;

fn body(w: &mut PhysicsWorld3d, kind: BodyKind, p: [f32; 3], shape: Shape) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(shape),
    )
    .unwrap()
}
fn cube(w: &mut PhysicsWorld3d, kind: BodyKind, p: [f32; 3]) -> BodyId {
    body(
        w,
        kind,
        p,
        Shape::Box {
            half_extents: [0.4; 3],
        },
    )
}
fn step(w: &mut PhysicsWorld3d, n: usize) {
    for _ in 0..n {
        w.step();
    }
}
fn same(a: &PhysicsWorld3d, b: &PhysicsWorld3d, ids: &[BodyId]) {
    assert_eq!(a.config(), b.config());
    for &id in ids {
        assert_eq!(a.body_state(id), b.body_state(id), "{id:?}");
    }
    assert_eq!(a.step_statistics(), b.step_statistics());
    let (mut x, mut y) = (Vec::new(), Vec::new());
    assert_eq!(a.contact_impulses(&mut x), b.contact_impulses(&mut y));
    assert_eq!(x, y);
    // Compare persistent layout as well as observations: matching body poses can
    // hide a divergent arena/free-list/contact cache until a later operation.
    assert_eq!(
        a.capture_snapshot().unwrap().encoded_bytes(),
        b.capture_snapshot().unwrap().encoded_bytes()
    );
}
fn events(a: &mut PhysicsWorld3d, b: &mut PhysicsWorld3d) {
    let (mut x, mut y) = (Vec::new(), Vec::new());
    assert_eq!(
        a.drain_collision_events(&mut x),
        b.drain_collision_events(&mut y)
    );
    assert_eq!(x, y);
}

#[test]
fn native_snapshot_warm_contacts_continue_identically_in_both_spaces() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space,
            ..WorldConfig::default()
        })
        .unwrap();
        body(
            &mut w,
            BodyKind::Fixed,
            [0., -0.5, 0.],
            Shape::Box {
                half_extents: [10., 0.5, 10.],
            },
        );
        let ids: Vec<_> = (0..3)
            .map(|i| cube(&mut w, BodyKind::Dynamic, [0., 0.41 + i as f32 * 0.81, 0.]))
            .collect();
        step(&mut w, 240);
        let before = w.body_state(ids[0]).unwrap();
        let checkpoint = w.capture_snapshot().unwrap();
        assert_eq!(w.body_state(ids[0]).unwrap(), before);
        let mut restored = PhysicsWorld3d::from_snapshot(&checkpoint).unwrap();
        same(&w, &restored, &ids);
        events(&mut w, &mut restored);
        for tick in 0..180 {
            if tick == 0 || tick == 90 {
                w.apply_impulse(ids[0], [0.1, 0., 0.]).unwrap();
                restored.apply_impulse(ids[0], [0.1, 0., 0.]).unwrap();
            }
            w.step();
            restored.step();
            same(&w, &restored, &ids);
            events(&mut w, &mut restored);
        }
    }
}

#[test]
fn native_snapshot_preserves_pending_commands_dirty_queries_and_arena_reuse() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = cube(&mut w, BodyKind::Dynamic, [0., 0., 0.]);
    let k = cube(&mut w, BodyKind::KinematicPosition, [10., 0., 0.]);
    let removed = cube(&mut w, BodyKind::Dynamic, [20., 0., 0.]);
    w.remove_body(removed).unwrap();
    w.add_force(a, [1., 2., 3.], [0., 0., 1.]).unwrap();
    w.apply_impulse(a, [0.5, 0., 0.]).unwrap();
    w.set_kinematic_target(
        k,
        Pose {
            position: [11., 0., 0.],
            ..Pose::default()
        },
    )
    .unwrap();
    let fixture = w.collider_ids(a).unwrap().next().unwrap();
    w.update_collider(
        fixture,
        ColliderDesc {
            pose: Pose {
                position: [0.1, 0., 0.],
                ..Pose::default()
            },
            ..ColliderDesc::new(Shape::Box {
                half_extents: [0.4; 3],
            })
        },
    )
    .unwrap();
    let checkpoint = w.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&checkpoint).unwrap();
    assert!(restored.body_state(removed).is_err());
    let x = cube(&mut w, BodyKind::Dynamic, [20., 0., 0.]);
    let y = cube(&mut restored, BodyKind::Dynamic, [20., 0., 0.]);
    assert_eq!(x, y);
    assert_ne!(x, removed);
    for _ in 0..60 {
        w.step();
        restored.step();
        same(&w, &restored, &[a, k, x]);
    }
    assert!((w.body_state(k).unwrap().pose.position[0] - 11.).abs() < 1e-6);
    assert!(w.body_state(a).unwrap().linear_velocity[0] > 0.5);
}

#[test]
fn native_snapshot_preserves_queued_jump_and_character_platform_state() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let platform = body(
        &mut w,
        BodyKind::KinematicPosition,
        [0., -0.1, 0.],
        Shape::Box {
            half_extents: [5., 0.1, 5.],
        },
    );
    let a = body(
        &mut w,
        BodyKind::KinematicPosition,
        [0., 0.76, 0.],
        Shape::Capsule {
            half_height: 0.5,
            radius: 0.25,
        },
    );
    w.enable_character(a, CharacterConfig::default()).unwrap();
    step(&mut w, 5);
    assert!(w.character_state(a).unwrap().grounded);
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [1., 0., 0.],
            jump_speed: 5.,
        },
    )
    .unwrap();
    w.set_kinematic_target(
        platform,
        Pose {
            position: [0.1, -0.1, 0.],
            ..Pose::default()
        },
    )
    .unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
    assert_eq!(w.character_state(a), restored.character_state(a));
    for tick in 0..120 {
        w.step();
        restored.step();
        same(&w, &restored, &[platform, a]);
        assert_eq!(w.character_state(a), restored.character_state(a));
        if tick == 0 {
            assert!(w.character_state(a).unwrap().vertical_speed > 0.);
        }
    }
}

#[test]
fn native_snapshot_preserves_all_joint_kinds_and_continuous_angle_state() {
    let response = SpringResponse {
        stiffness: 10.,
        damping: 2.,
    };
    let kinds = vec![
        JointKind::Fixed,
        JointKind::Spherical,
        JointKind::Revolute {
            limits: Some([-0.8, 0.8]),
            motor: Some(JointMotor {
                target_position: 0.,
                target_velocity: 0.5,
                stiffness: 10.,
                damping: 2.,
                max_force: 30.,
            }),
        },
        JointKind::ContinuousRevolute {
            limits: [-100., 100.],
            motor: None,
        },
        JointKind::Prismatic {
            limits: Some([0., 3.]),
            motor: None,
        },
        JointKind::Distance { length: 2. },
        JointKind::Rope { max_length: 2.5 },
        JointKind::ElasticRope {
            max_length: 1.8,
            spring: response,
        },
        JointKind::Gear {
            ratio: 2.,
            reference_angle: 0.,
            spring: Some(response),
        },
        JointKind::Pulley {
            ground_a: [0., 2., 0.],
            ground_b: [2., 2., 0.],
            length: 4.,
            ratio: 1.,
            slack: false,
            spring: None,
        },
        JointKind::FrequencySpring {
            rest_length: 2.,
            frequency_hz: 2.,
            damping_ratio: 0.5,
        },
        JointKind::AccelerationSpring {
            rest_length: 2.,
            stiffness: 10.,
            damping: 2.,
        },
        JointKind::Spring {
            rest_length: 2.,
            stiffness: 10.,
            damping: 2.,
        },
    ];
    for kind in kinds {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0., -1., 0.],
            ..WorldConfig::default()
        })
        .unwrap();
        let a = cube(&mut w, BodyKind::Fixed, [0.; 3]);
        let b = cube(&mut w, BodyKind::Dynamic, [2., 0., 0.]);
        w.set_planar_rotation(b, std::f64::consts::TAU * 2. + 0.2)
            .unwrap();
        let mut desc = JointDesc::new(a, b, kind.clone());
        if matches!(
            kind,
            JointKind::Revolute { .. } | JointKind::ContinuousRevolute { .. }
        ) {
            let q = rapier3d::prelude::Rotation::from_rotation_y(-std::f32::consts::FRAC_PI_2)
                .to_array();
            desc.local_frame_a.rotation = q;
            desc.local_frame_b.rotation = q;
        }
        let joint = w.create_joint(desc).unwrap();
        step(&mut w, 20);
        let mut restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
        assert_eq!(w.joint_state(joint), restored.joint_state(joint));
        assert_eq!(w.planar_rotation(b), restored.planar_rotation(b));
        for _ in 0..60 {
            w.step();
            restored.step();
            same(&w, &restored, &[a, b]);
            assert_eq!(
                w.joint_state(joint),
                restored.joint_state(joint),
                "{kind:?}"
            );
            assert_eq!(w.planar_rotation(b), restored.planar_rotation(b));
        }
    }
}

#[test]
fn native_snapshot_preserves_collision_overflow_and_removed_generations() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        max_events: 1,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    for x in [0., 0.5] {
        w.create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [x, 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
            },
        )
        .unwrap();
    }
    w.step();
    w.remove_body(a).unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
    events(&mut w, &mut restored);
    assert!(restored.body_state(a).is_err());
    let x = cube(&mut w, BodyKind::Dynamic, [10., 0., 0.]);
    let y = cube(&mut restored, BodyKind::Dynamic, [10., 0., 0.]);
    assert_eq!(x, y);
    w.step();
    restored.step();
    same(&w, &restored, &[x]);
    events(&mut w, &mut restored);
}

#[test]
fn native_snapshot_rejects_corrupt_version_length_and_trailing_data_atomically() {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let id = cube(&mut w, BodyKind::Dynamic, [0., 2., 0.]);
    let checkpoint = w.capture_snapshot().unwrap();
    let before = w.body_state(id).unwrap();
    for mode in 0..7 {
        let mut bad = checkpoint.clone();
        let expected = match mode {
            0 => {
                bad.bytes.truncate(4);
                PhysicsSnapshotError::InvalidEnvelope
            }
            1 => {
                bad.bytes[8] ^= 1;
                PhysicsSnapshotError::IncompatibleBuild
            }
            2 => {
                bad.bytes[12] ^= 1;
                PhysicsSnapshotError::IncompatibleBuild
            }
            3 => {
                bad.bytes[HEADER] ^= 1;
                PhysicsSnapshotError::Corrupt
            }
            4 => {
                bad.bytes.push(0);
                PhysicsSnapshotError::InvalidEnvelope
            }
            5 => {
                bad.bytes[28] = 1;
                PhysicsSnapshotError::InvalidEnvelope
            }
            _ => {
                bad.bytes.push(0);
                let length = (bad.bytes.len() - HEADER) as u32;
                let checksum = crc(&bad.bytes[HEADER..]);
                bad.bytes[20..24].copy_from_slice(&length.to_le_bytes());
                bad.bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
                PhysicsSnapshotError::InvalidEnvelope
            }
        };
        assert_eq!(w.restore_snapshot(&bad), Err(expected));
        assert_eq!(w.body_state(id).unwrap(), before);
    }
}

#[test]
fn native_snapshot_capture_enforces_byte_budget_without_advancing_or_consuming_input() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = cube(&mut w, BodyKind::KinematicPosition, [0.; 3]);
    w.set_kinematic_target(
        a,
        Pose {
            position: [1., 0., 0.],
            ..Pose::default()
        },
    )
    .unwrap();
    let before = w.body_state(a).unwrap();
    let size = w.capture_snapshot().unwrap().encoded_bytes().len();
    assert_eq!(
        w.capture_snapshot_with_limit(size)
            .unwrap()
            .encoded_bytes()
            .len(),
        size
    );
    assert!(matches!(
        w.capture_snapshot_with_limit(size - 1),
        Err(PhysicsSnapshotError::Capacity)
    ));
    assert!(matches!(
        w.capture_snapshot_with_limit(64),
        Err(PhysicsSnapshotError::Capacity)
    ));
    assert_eq!(w.body_state(a).unwrap(), before);
    w.step();
    assert_eq!(w.body_state(a).unwrap().pose.position[0], 1.);
}

#[test]
fn native_snapshot_preserves_completed_step_motion_for_cold_projectile_queries() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    w.set_step_motion_enabled(true);
    w.create_body(
        BodyDesc {
            kind: BodyKind::KinematicVelocity,
            pose: Pose {
                position: [5., 0., 0.],
                ..Pose::default()
            },
            linear_velocity: [-10., 0., 0.],
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
    )
    .unwrap();
    w.step();
    let restored = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
    let (mut a, mut b) = (Vec::new(), Vec::new());
    assert_eq!(
        w.sweep_step_motion(
            &Shape::Sphere { radius: 0.5 },
            Pose::default(),
            [10., 0., 0.],
            &QueryFilter::default(),
            &mut a,
            100
        ),
        restored.sweep_step_motion(
            &Shape::Sphere { radius: 0.5 },
            Pose::default(),
            [10., 0., 0.],
            &QueryFilter::default(),
            &mut b,
            100
        )
    );
    assert!(!a.is_empty());
    assert_eq!(a, b);
}

mod island_pending;
