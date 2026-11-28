use super::*;
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, Pose, Shape,
};

fn fixture() -> (PhysicsWorld3d, BodyId, CharacterInput) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
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
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(actor, CharacterConfig::default())
        .unwrap();
    let input = CharacterInput {
        velocity: [0.1234567, 0., 0.7654321],
        jump_speed: 1.2345678,
    };
    world.set_character_input(actor, input.clone()).unwrap();
    (world, actor, input)
}

fn unchecked(world: &PhysicsWorld3d, header: &PhysicsSnapshot) -> PhysicsSnapshot {
    let payload = postcard::to_allocvec(&Capture { world }).unwrap();
    let mut result = header.clone();
    result.bytes.truncate(HEADER);
    result.bytes.extend_from_slice(&payload);
    result.bytes[20..24].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    result.bytes[24..28].copy_from_slice(&crc(&payload).to_le_bytes());
    assert!(result.payload().is_ok());
    result
}

fn replace_input(
    source: &PhysicsSnapshot,
    old: &CharacterInput,
    new: &CharacterInput,
) -> PhysicsSnapshot {
    let old = postcard::to_allocvec(old).unwrap();
    let new = postcard::to_allocvec(new).unwrap();
    assert_eq!(old.len(), new.len());
    let positions: Vec<_> = source.bytes[HEADER..]
        .windows(old.len())
        .enumerate()
        .filter_map(|(i, bytes)| (bytes == old).then_some(HEADER + i))
        .collect();
    assert_eq!(positions.len(), 1);
    let mut result = source.clone();
    result.bytes[positions[0]..positions[0] + old.len()].copy_from_slice(&new);
    let checksum = crc(&result.bytes[HEADER..]);
    result.bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
    assert!(result.payload().is_ok());
    result
}

#[test]
fn character_runtime_admission_valid_crc_bad_input_and_state_reject_before_commit() {
    let (mut world, actor, input) = fixture();
    let header = world.capture_snapshot().unwrap();
    for (index, changed) in [
        CharacterInput {
            velocity: [f32::NAN, 0., 0.],
            ..input.clone()
        },
        CharacterInput {
            velocity: [0., 0.5, 0.],
            ..input.clone()
        },
        CharacterInput {
            jump_speed: -1.,
            ..input.clone()
        },
        CharacterInput {
            jump_speed: 51.,
            ..input.clone()
        },
        CharacterInput {
            jump_speed: f32::NAN,
            ..input.clone()
        },
    ]
    .into_iter()
    .enumerate()
    {
        assert!(world.set_character_input(actor, changed.clone()).is_err());
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            header.encoded_bytes()
        );
        let changed = replace_input(&header, &input, &changed);
        let decoded = PhysicsWorld3d::from_snapshot(&changed);
        assert_eq!(
            decoded.err(),
            Some(PhysicsSnapshotError::InvalidState),
            "input {index}"
        );
        assert_eq!(
            world.restore_snapshot(&changed),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            header.encoded_bytes()
        );
    }
    for case in 0..10 {
        let mut candidate = PhysicsWorld3d::from_snapshot(&header).unwrap();
        let runtime = candidate.characters.get_mut(&actor).unwrap();
        match case {
            0 => runtime.state.translation[0] = f32::NAN,
            1 => runtime.state.velocity[2] = f32::INFINITY,
            2 => runtime.state.carry_translation[1] = f32::NAN,
            3 => runtime.state.vertical_speed = f32::INFINITY,
            4 => runtime.tick_velocity[0] = f32::NAN,
            5 => runtime.carry_fraction = -1.,
            6 => {
                runtime.motion_stop = Some(crate::physics3d::character_motion::MotionStop {
                    fraction: f64::NAN,
                    bodies: [Some(actor); 12],
                })
            }
            7 => {
                runtime.state.grounded = true;
                runtime.state.ground = Some(crate::physics3d::ColliderRef {
                    body: BodyId {
                        slot: u32::MAX,
                        generation: 0,
                    },
                    collider: runtime.collider,
                    sensor: false,
                });
            }
            8 => {
                runtime.state.grounded = true;
                runtime.state.ground = Some(crate::physics3d::ColliderRef {
                    body: actor,
                    collider: runtime.collider,
                    sensor: true,
                });
            }
            9 => runtime.state.failed_pair_casts = 1,
            _ => unreachable!(),
        }
        let snapshot = unchecked(&candidate, &header);
        let raw = postcard::to_allocvec(&Capture { world: &candidate }).unwrap();
        assert_eq!(
            PhysicsWorld3d::from_snapshot(&snapshot).err(),
            Some(PhysicsSnapshotError::InvalidState),
            "runtime {case}"
        );
        assert_eq!(
            candidate.capture_snapshot().err(),
            Some(PhysicsSnapshotError::InvalidState),
            "capture runtime {case}"
        );
        assert_eq!(
            world.restore_snapshot(&snapshot),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            postcard::to_allocvec(&Capture { world: &candidate }).unwrap(),
            raw
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            header.encoded_bytes()
        );
    }
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        header.encoded_bytes()
    );
}

#[test]
fn character_runtime_admission_work_exact_one_below_and_zero_scratch_are_pure() {
    use super::character_admission::{validate, Limits, LIMITS};
    let (world, actor, _) = fixture();
    let before = world.capture_snapshot().unwrap();
    let usage = validate(&world, LIMITS).unwrap();
    assert_eq!(usage.work, 8 + 384 + 8);
    assert_eq!(usage.scratch_bytes, 0);
    assert_eq!(
        validate(
            &world,
            Limits {
                max_work: usage.work,
                max_scratch_bytes: 0
            }
        ),
        Ok(usage)
    );
    assert_eq!(
        validate(
            &world,
            Limits {
                max_work: usage.work - 1,
                max_scratch_bytes: 0
            }
        ),
        Err(PhysicsSnapshotError::Capacity)
    );
    assert!(world.character_state(actor).is_ok());
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn character_runtime_admission_pending_traversal_force_and_actual_interval_six_step_replay() {
    for space in [super::super::Space::PlanarXy, super::super::Space::Spatial] {
        for dt in [0.0001, 0.003, 1. / 60., 0.1] {
            let mut world = PhysicsWorld3d::new(WorldConfig {
                gravity: [0.; 3],
                space,
                ..WorldConfig::default()
            })
            .unwrap();
            let actor = world
                .create_body(
                    BodyDesc {
                        kind: BodyKind::KinematicPosition,
                        pose: Pose {
                            position: [0., 20., 0.],
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
            world
                .enable_character(
                    actor,
                    CharacterConfig {
                        push_mass: 10.,
                        ..CharacterConfig::default()
                    },
                )
                .unwrap();
            let velocity = if space == super::super::Space::PlanarXy {
                [0.25, -0., 0.]
            } else {
                [0., -0., 0.25]
            };
            world
                .set_character_input(
                    actor,
                    CharacterInput {
                        velocity,
                        jump_speed: 3.,
                    },
                )
                .unwrap();
            world.set_character_traversal(actor, 0., 0.).unwrap();
            let axis = if space == super::super::Space::PlanarXy {
                0
            } else {
                2
            };
            let mut force = [0.; 3];
            force[axis] = 10.;
            let mut impulse = [0.; 3];
            impulse[axis] = 5.;
            world.add_character_force(actor, force).unwrap();
            world.apply_character_impulse(actor, impulse).unwrap();
            let before = world.capture_snapshot().unwrap();
            let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
            assert_eq!(
                restored.capture_snapshot().unwrap().encoded_bytes(),
                before.encoded_bytes()
            );
            for tick in 1..=6 {
                for candidate in [&mut world, &mut restored] {
                    assert!(candidate.begin_interval(dt, true).unwrap());
                    candidate.step();
                    candidate.end_interval();
                }
                let state = world.character_state(actor).unwrap();
                let expected = 0.25 + 0.5 + tick as f32 * dt;
                assert!(
                    (state.velocity[axis] - expected).abs() < 0.0003,
                    "{space:?} dt={dt} tick={tick} {state:?}"
                );
                assert_eq!(world.body_state(actor), restored.body_state(actor));
                assert_eq!(
                    world.character_state(actor),
                    restored.character_state(actor)
                );
                assert_eq!(
                    world.capture_snapshot().unwrap().encoded_bytes(),
                    restored.capture_snapshot().unwrap().encoded_bytes()
                );
                assert_eq!(
                    world.config().step_seconds,
                    WorldConfig::default().step_seconds
                );
            }
        }
    }
}

#[test]
fn character_runtime_admission_cold_move_state_velocity_is_not_reconstructed() {
    let (mut world, actor, _) = fixture();
    let mut scratch = crate::physics3d::character_query::CharacterProbeScratch::default();
    world
        .move_character_displacement(actor, [0.125, 0., 0.], 0., 0., &mut scratch)
        .unwrap();
    let state = world.character_state(actor).unwrap();
    assert!((state.translation[0] - 0.125).abs() < 1.0e-6);
    assert_eq!(state.velocity, [0.; 3]);
    let before = world.capture_snapshot().unwrap();
    let restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
    assert_eq!(
        restored.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    assert_eq!(
        restored.character_state(actor),
        world.character_state(actor)
    );
}

fn path_fixture() -> (PhysicsWorld3d, BodyId, BodyId) {
    let (mut world, actor, _) = fixture();
    world
        .enable_character(
            actor,
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    let other = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [4., 2., 0.],
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
    world
        .enable_character(
            other,
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    let platform = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0., 1.1405, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [10., 0.1, 10.],
            }),
        )
        .unwrap();
    world.force_character_motion_proof();
    world.step();
    assert!(world.character_state(actor).unwrap().grounded);
    world
        .set_character_input(
            actor,
            CharacterInput {
                velocity: [0., 0., 0.25],
                jump_speed: 0.,
            },
        )
        .unwrap();
    world.add_character_force(actor, [0., 0., 10.]).unwrap();
    world.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
    world
        .set_kinematic_target(
            platform,
            Pose {
                position: [0.25, 1.1405, 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    world.step();
    assert_eq!(world.path_scratch.saved_character_payload_counts(), (2, 2));
    assert!(world.character_state(actor).unwrap().carry_translation[0] > 0.24);
    (world, actor, platform)
}

#[test]
fn character_runtime_admission_persistent_preview_and_total_valid_crc_damage_is_guard_only() {
    let (world, _, _) = path_fixture();
    let before = world.capture_snapshot().unwrap();
    for case in 0..20 {
        let mut damaged = PhysicsWorld3d::from_snapshot(&before).unwrap();
        damaged.path_scratch.damage_character_payload_for_test(case);
        let raw = postcard::to_allocvec(&Capture { world: &damaged }).unwrap();
        let packet = unchecked(&damaged, &before);
        assert_eq!(
            PhysicsWorld3d::from_snapshot(&packet).err(),
            Some(PhysicsSnapshotError::InvalidState),
            "copy case {case}"
        );
        assert_eq!(
            damaged.capture_snapshot().err(),
            Some(PhysicsSnapshotError::InvalidState),
            "copy capture {case}"
        );
        let mut live = PhysicsWorld3d::from_snapshot(&before).unwrap();
        assert_eq!(
            live.restore_snapshot(&packet),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            live.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
        assert_eq!(
            postcard::to_allocvec(&Capture { world: &damaged }).unwrap(),
            raw
        );
    }
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn character_runtime_admission_preview_stale_support_clear_reenable_and_new_axis_are_history() {
    let (mut world, actor, platform) = path_fixture();
    let (_, old_jump, old_ground) = world.path_scratch.character_payload_history_for_test();
    assert_eq!(old_jump, 0.);
    assert_eq!(old_ground.unwrap().body, platform);
    // Preserve one actual stale carry result before making a new jump preview.
    let carry_packet = world.capture_snapshot().unwrap();
    let mut carry_only = PhysicsWorld3d::from_snapshot(&carry_packet).unwrap();
    carry_only.remove_body(platform).unwrap();
    assert_eq!(
        carry_only.character_state(actor).unwrap().carried_by,
        Some(platform)
    );
    carry_only.capture_snapshot().unwrap();
    world
        .set_character_input(
            actor,
            CharacterInput {
                velocity: [0.25, 0., 0.25],
                jump_speed: 3.,
            },
        )
        .unwrap();
    world
        .set_kinematic_target(
            platform,
            Pose {
                position: [0.5, 1.1405, 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    world.step();
    let (_, old_jump, old_ground) = world.path_scratch.character_payload_history_for_test();
    assert_eq!(old_jump, 3.);
    assert_eq!(old_ground.unwrap().body, platform);
    world.remove_body(platform).unwrap();
    assert!(world.character_state(actor).unwrap().ground.is_none());
    world.disable_character(actor).unwrap();
    let mut pose = world.body_state(actor).unwrap().pose;
    pose.rotation = rp::Rotation::from_rotation_z(-std::f32::consts::FRAC_PI_2).to_array();
    world.set_pose(actor, pose).unwrap();
    world
        .enable_character(
            actor,
            CharacterConfig {
                up: [1., 0., 0.],
                push_mass: 0.,
                max_vertical_speed: 0.1,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    let before = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
    restored.force_character_motion_proof();
    for _ in 0..6 {
        world.step();
        restored.step();
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
    world.clear();
    let snapshot = world.capture_snapshot().unwrap();
    assert_eq!(world.path_scratch.saved_character_payload_counts(), (2, 2));
    let restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    assert_eq!(
        restored.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );
}

fn reject_fixture(candidate: &PhysicsWorld3d, header: &PhysicsSnapshot, label: &str) {
    let raw = postcard::to_allocvec(&Capture { world: candidate }).unwrap();
    let packet = unchecked(candidate, header);
    assert_eq!(
        candidate.capture_snapshot().err(),
        Some(PhysicsSnapshotError::InvalidState),
        "capture {label}"
    );
    assert_eq!(
        PhysicsWorld3d::from_snapshot(&packet).err(),
        Some(PhysicsSnapshotError::InvalidState),
        "decode {label}"
    );
    let mut live = PhysicsWorld3d::from_snapshot(header).unwrap();
    assert_eq!(
        live.restore_snapshot(&packet),
        Err(PhysicsSnapshotError::InvalidState),
        "restore {label}"
    );
    assert_eq!(
        postcard::to_allocvec(&Capture { world: candidate }).unwrap(),
        raw,
        "raw {label}"
    );
    assert_eq!(
        live.capture_snapshot().unwrap().encoded_bytes(),
        header.encoded_bytes(),
        "live {label}"
    );
}

#[test]
fn character_runtime_admission_all_numeric_arrays_relations_and_config_fields_are_checked() {
    let (world, actor, _) = fixture();
    let header = world.capture_snapshot().unwrap();
    for case in 0..48 {
        let mut candidate = PhysicsWorld3d::from_snapshot(&header).unwrap();
        let runtime = candidate.characters.get_mut(&actor).unwrap();
        if case < 24 {
            let arrays = [
                &mut runtime.state.translation,
                &mut runtime.state.velocity,
                &mut runtime.state.carry_translation,
                &mut runtime.tick_velocity,
                &mut runtime.external_velocity,
                &mut runtime.external_force,
                &mut runtime.pending_impulse,
                &mut runtime.contact_velocity,
            ];
            arrays[case / 3][case % 3] = f32::NAN;
        } else {
            match case {
                24 => runtime.state.vertical_speed = f32::NAN,
                25 => runtime.state.vertical_speed = runtime.config.max_vertical_speed + 1.,
                26 => runtime.state.vertical_speed = -runtime.config.max_vertical_speed - 1.,
                27 => runtime.carry_fraction = f64::NAN,
                28 => runtime.carry_fraction = -f64::EPSILON,
                29 => runtime.carry_fraction = 1. + f64::EPSILON,
                30..=35 => {
                    let mut bodies = [None; 12];
                    bodies[0] = Some(actor);
                    let mut fraction = 0.5;
                    match case {
                        30 => fraction = f64::NAN,
                        31 => fraction = -f64::EPSILON,
                        32 => fraction = 1. + f64::EPSILON,
                        33 => bodies[0] = None,
                        34 => {
                            bodies[0] = None;
                            bodies[1] = Some(actor);
                        }
                        35 => bodies[1] = Some(actor),
                        _ => unreachable!(),
                    }
                    runtime.motion_stop =
                        Some(crate::physics3d::character_motion::MotionStop { fraction, bodies });
                }
                36 => runtime.state.failed_pair_casts = 1,
                37 => runtime.state.failed_moving_obstacle_casts = 1,
                38 => runtime.state.failed_moving_obstacle_contacts = 1,
                39 => runtime.state.grounded = true,
                40 => {
                    runtime.state.ground = Some(crate::physics3d::ColliderRef {
                        body: actor,
                        collider: runtime.collider,
                        sensor: false,
                    })
                }
                41 => runtime.external_velocity[0] = 1.,
                42 => runtime.external_force[0] = 1.,
                43 => runtime.pending_impulse[0] = 1.,
                44 => runtime.contact_velocity[0] = 1.,
                45..=47 => {
                    runtime.state.grounded = true;
                    runtime.state.ground = Some(crate::physics3d::ColliderRef {
                        body: if case == 47 {
                            BodyId {
                                slot: u32::MAX,
                                generation: 0,
                            }
                        } else {
                            actor
                        },
                        collider: runtime.collider,
                        sensor: case == 45,
                    });
                }
                _ => unreachable!(),
            }
        }
        reject_fixture(&candidate, &header, &format!("runtime {case}"));
    }
    for case in 0..9 {
        let mut candidate = PhysicsWorld3d::from_snapshot(&header).unwrap();
        let config = &mut candidate.characters.get_mut(&actor).unwrap().config;
        let fields = [
            &mut config.up[0],
            &mut config.skin_width,
            &mut config.max_slope_angle,
            &mut config.slide_angle,
            &mut config.step_height,
            &mut config.step_min_width,
            &mut config.snap_distance,
            &mut config.max_vertical_speed,
            &mut config.push_mass,
        ];
        *fields[case] = f32::NAN;
        reject_fixture(&candidate, &header, &format!("config {case}"));
    }
}

#[test]
fn character_runtime_admission_one_solid_and_sensor_history_keep_quota_and_bytes() {
    let (mut world, actor, _) = fixture();
    let solid = ColliderDesc::new(Shape::Sphere { radius: 0.1 });
    let before = world.capture_snapshot().unwrap();
    assert!(world.add_collider(actor, solid.clone()).is_err());
    assert!(world.add_character_force(actor, [1., 0., 0.]).is_err());
    assert!(world.apply_character_impulse(actor, [1., 0., 0.]).is_err());
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    let mut last = None;
    for _ in 0..63 {
        last = Some(
            world
                .add_collider(
                    actor,
                    ColliderDesc {
                        sensor: true,
                        ..solid.clone()
                    },
                )
                .unwrap(),
        );
    }
    let full = world.capture_snapshot().unwrap();
    let usage = character_admission::validate(&world, character_admission::LIMITS).unwrap();
    assert_eq!(usage.work, 8 + 384 + 64 * 8);
    assert_eq!(usage.scratch_bytes, 0);
    world
        .backend
        .colliders
        .get_mut(crate::physics3d::colliders::native_collider(last.unwrap()))
        .unwrap()
        .set_sensor(false);
    reject_fixture(&world, &full, "second solid after normal 63 sensors");
}

#[test]
fn character_runtime_admission_real_1024_controller_producer_uses_bounded_zero_scratch() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        max_characters: 1024,
        ..WorldConfig::default()
    })
    .unwrap();
    for i in 0..1024 {
        let actor = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [i as f32 * 2., 2., 0.],
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
        world
            .enable_character(actor, CharacterConfig::default())
            .unwrap();
    }
    let before = world.capture_snapshot().unwrap();
    let usage = character_admission::validate(&world, character_admission::LIMITS).unwrap();
    assert_eq!(usage.work, 8 + 1024 * (384 + 8));
    assert_eq!(usage.scratch_bytes, 0);
    for maximum in [usage.work, usage.work - 1] {
        let result = character_admission::validate(
            &world,
            character_admission::Limits {
                max_work: maximum,
                max_scratch_bytes: 0,
            },
        );
        assert_eq!(
            result,
            if maximum == usage.work {
                Ok(usage)
            } else {
                Err(PhysicsSnapshotError::Capacity)
            }
        );
    }
    let restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
    assert_eq!(
        restored.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn character_runtime_admission_result_speed_can_exceed_single_command_cap() {
    let (mut world, actor, _) = fixture();
    world
        .enable_character(
            actor,
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    world
        .set_character_input(
            actor,
            CharacterInput {
                velocity: [1.0e6, -0., 0.],
                jump_speed: -0.,
            },
        )
        .unwrap();
    world
        .apply_character_impulse(actor, [1.0e6, 0., 0.])
        .unwrap();
    assert!(world.begin_interval(0.0001, true).unwrap());
    world.step();
    world.end_interval();
    let state = world.character_state(actor).unwrap();
    assert!(state.velocity[0] > 1.0e6);
    assert!((state.translation[0] - 110.).abs() < 0.001);
    let snapshot = world.capture_snapshot().unwrap();
    assert_eq!(
        PhysicsWorld3d::from_snapshot(&snapshot)
            .unwrap()
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        snapshot.encoded_bytes()
    );
}

#[test]
fn character_runtime_admission_real_preview_counts_have_exact_budget_without_reintegration() {
    let (world, _, _) = path_fixture();
    let before = world.capture_snapshot().unwrap();
    let usage = character_admission::validate(&world, character_admission::LIMITS).unwrap();
    assert_eq!(world.path_scratch.saved_time_payload_counts(), (1, 0, 0));
    assert_eq!(usage.work, 8 + 2 * (384 + 160 + 128 + 8) + 8);
    assert_eq!(usage.scratch_bytes, 0);
    for maximum in [usage.work, usage.work - 1] {
        let result = character_admission::validate(
            &world,
            character_admission::Limits {
                max_work: maximum,
                max_scratch_bytes: 0,
            },
        );
        assert_eq!(
            result,
            if maximum == usage.work {
                Ok(usage)
            } else {
                Err(PhysicsSnapshotError::Capacity)
            }
        );
    }
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn rapier_path_checkpoint_replays_support_preview_and_pending_jump() {
    use crate::physics3d::KinematicPath;

    let (mut world, actor, _) = fixture();
    let target = |x| Pose {
        position: [x, 1.1405, 0.],
        ..Pose::default()
    };
    let platform = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: target(0.),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [10., 0.1, 10.],
            }),
        )
        .unwrap();
    world
        .set_character_input(actor, CharacterInput::default())
        .unwrap();
    world.step_checked().unwrap();
    let path = KinematicPath {
        body: platform,
        sweep_sensors: false,
        knots: vec![(0.5, target(0.25)), (1., target(0.))],
    };
    world
        .step_with_kinematic_paths(std::slice::from_ref(&path))
        .unwrap();
    assert_eq!(
        world.character_state(actor).unwrap().carried_by,
        Some(platform)
    );
    world
        .set_character_input(
            actor,
            CharacterInput {
                jump_speed: 7.,
                ..CharacterInput::default()
            },
        )
        .unwrap();
    let saved = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    for tick in 0..6 {
        for candidate in [&mut world, &mut restored] {
            candidate
                .step_with_kinematic_paths(std::slice::from_ref(&path))
                .unwrap();
            let state = candidate.character_state(actor).unwrap();
            assert!(!state.grounded);
            assert_eq!(state.vertical_speed, 7.);
        }
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes(),
            "rollback continuation changed on tick {tick}",
        );
    }
}

#[test]
fn character_runtime_admission_grounded_jump_is_retained_then_consumed_once() {
    let (mut world, actor, _) = path_fixture();
    assert!(world.character_state(actor).unwrap().grounded);
    world
        .set_character_input(
            actor,
            CharacterInput {
                velocity: [0., 0., 0.25],
                jump_speed: 7.,
            },
        )
        .unwrap();
    world.set_character_traversal(actor, 0., 0.).unwrap();
    let before = world.capture_snapshot().unwrap();
    for _ in 0..3 {
        character_admission::validate(&world, character_admission::LIMITS).unwrap();
    }
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
    restored.force_character_motion_proof();
    let dt = world.config().step_seconds;
    for _ in 0..6 {
        let start = world.body_state(actor).unwrap().pose.position[1];
        world.step();
        restored.step();
        let state = world.character_state(actor).unwrap();
        assert!(!state.grounded);
        assert_eq!(state.vertical_speed, 7.);
        assert!(
            (world.body_state(actor).unwrap().pose.position[1] - start - 7. * dt).abs() < 0.00001
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn character_runtime_admission_input_planar_oblique_axis_boundaries_and_signed_zero_preserve_wire()
{
    use crate::physics3d::Space;
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let spatial = space == Space::Spatial;
        let actor = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        rotation: if spatial {
                            rp::Rotation::from_rotation_z(-std::f32::consts::FRAC_PI_2).to_array()
                        } else {
                            Pose::default().rotation
                        },
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
        world
            .enable_character(
                actor,
                CharacterConfig {
                    up: if spatial { [1., 0., 0.] } else { [0., 1., 0.] },
                    ..CharacterConfig::default()
                },
            )
            .unwrap();
        let input = CharacterInput {
            velocity: if spatial {
                [0., -0., -1.0e6]
            } else {
                [-1.0e6, -0., 0.]
            },
            jump_speed: -0.,
        };
        world.set_character_input(actor, input.clone()).unwrap();
        let header = world.capture_snapshot().unwrap();
        assert_eq!(
            PhysicsWorld3d::from_snapshot(&header)
                .unwrap()
                .capture_snapshot()
                .unwrap()
                .encoded_bytes(),
            header.encoded_bytes()
        );
        let mut upward = input.clone();
        upward.velocity[if spatial { 0 } else { 1 }] = 0.1;
        let mut too_large = input.clone();
        too_large.velocity[if spatial { 2 } else { 0 }] = -f32::from_bits(1.0e6f32.to_bits() + 1);
        let mut out_of_plane = input.clone();
        out_of_plane.velocity[2] = if spatial { f32::NAN } else { f32::MIN_POSITIVE };
        for bad in [
            upward,
            too_large,
            out_of_plane,
            CharacterInput {
                jump_speed: f32::from_bits(50f32.to_bits() + 1),
                ..input.clone()
            },
        ] {
            assert!(world.set_character_input(actor, bad.clone()).is_err());
            let packet = replace_input(&header, &input, &bad);
            assert_eq!(
                PhysicsWorld3d::from_snapshot(&packet).err(),
                Some(PhysicsSnapshotError::InvalidState)
            );
            assert_eq!(
                world.restore_snapshot(&packet),
                Err(PhysicsSnapshotError::InvalidState)
            );
            assert_eq!(
                world.capture_snapshot().unwrap().encoded_bytes(),
                header.encoded_bytes()
            );
        }
    }
}

#[test]
fn character_runtime_admission_piecewise_ceiling_flag_keeps_later_descent() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0., -10., 0.],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
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
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(
            actor,
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., 2.95, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [10., 0.1, 10.],
            }),
        )
        .unwrap();
    let mover = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [100., 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1; 3],
            }),
        )
        .unwrap();
    world.apply_character_impulse(actor, [0., 30., 0.]).unwrap();
    world
        .step_with_kinematic_paths(&[crate::physics3d::KinematicPath {
            body: mover,
            sweep_sensors: false,
            knots: vec![
                (
                    0.5,
                    Pose {
                        position: [100.1, 0., 0.],
                        ..Pose::default()
                    },
                ),
                (
                    1.,
                    Pose {
                        position: [100.2, 0., 0.],
                        ..Pose::default()
                    },
                ),
            ],
        }])
        .unwrap();
    let state = world.character_state(actor).unwrap();
    println!("piecewise ceiling state: {state:?}");
    assert!(state.hit_ceiling);
    assert_eq!(state.vertical_speed, -0.5);
    assert!(!state.grounded);
    let packet = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&packet).unwrap();
    for _ in 0..6 {
        world.step();
        restored.step();
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn character_runtime_admission_raw_character_map_rejects_order_and_duplicates_without_normalizing()
{
    let (world, _, _) = path_fixture();
    let header = world.capture_snapshot().unwrap();
    let rows: Vec<_> = world.characters.iter().collect();
    assert_eq!(rows.len(), 2);
    let original = postcard::to_allocvec(&world.characters).unwrap();
    assert_eq!(postcard::to_allocvec(&rows).unwrap(), original);
    for (label, changed) in [
        ("reverse", vec![rows[1], rows[0]]),
        ("duplicate", vec![rows[0], rows[1], rows[0]]),
    ] {
        let changed = postcard::to_allocvec(&changed).unwrap();
        let positions: Vec<_> = header.bytes[HEADER..]
            .windows(original.len())
            .enumerate()
            .filter_map(|(i, bytes)| (bytes == original).then_some(HEADER + i))
            .collect();
        assert_eq!(positions.len(), 1);
        let at = positions[0];
        let mut packet = header.clone();
        packet.bytes.splice(at..at + original.len(), changed);
        let len = packet.bytes.len() - HEADER;
        let sum = crc(&packet.bytes[HEADER..]);
        packet.bytes[20..24].copy_from_slice(&(len as u32).to_le_bytes());
        packet.bytes[24..28].copy_from_slice(&sum.to_le_bytes());
        assert!(packet.payload().is_ok());
        assert_eq!(
            PhysicsWorld3d::from_snapshot(&packet).err(),
            Some(PhysicsSnapshotError::InvalidState),
            "{label}"
        );
        let mut live = PhysicsWorld3d::from_snapshot(&header).unwrap();
        assert_eq!(
            live.restore_snapshot(&packet),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            live.capture_snapshot().unwrap().encoded_bytes(),
            header.encoded_bytes()
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            header.encoded_bytes()
        );
    }
}

#[test]
fn character_runtime_admission_map_inherits_nested_active_decode_allowances() {
    use crate::checkpoint_decode::{self, ErrorKind, Limit};
    #[derive(serde::Deserialize)]
    struct Pair {
        #[serde(with = "checkpoint_state")]
        first: PhysicsWorld3d,
        #[serde(with = "checkpoint_state")]
        second: PhysicsWorld3d,
    }
    let (world, _, _) = path_fixture();
    let packet = world.capture_snapshot().unwrap();
    let encoded = postcard::to_allocvec(&(packet.encoded_bytes(), packet.encoded_bytes())).unwrap();
    let (decoded, usage) =
        checkpoint_decode::with_limits::<Pair>(&encoded, checkpoint_decode::Limits::default())
            .unwrap();
    assert_eq!(
        decoded.first.capture_snapshot().unwrap().encoded_bytes(),
        packet.encoded_bytes()
    );
    assert_eq!(
        decoded.second.capture_snapshot().unwrap().encoded_bytes(),
        packet.encoded_bytes()
    );
    let (_, single_usage) = checkpoint_decode::with_limits::<Restore>(
        packet.payload().unwrap(),
        checkpoint_decode::Limits::default(),
    )
    .unwrap();
    assert!(usage.values > single_usage.values);
    assert!(usage.allocation_work > single_usage.allocation_work);
    for (allocation, values, expected) in [
        (usage.allocation_work, usage.values, None),
        (
            usage.allocation_work - 1,
            usage.values,
            Some(ErrorKind::Limit(Limit::Allocation)),
        ),
        (
            usage.allocation_work,
            usage.values - 1,
            Some(ErrorKind::Limit(Limit::Values)),
        ),
    ] {
        let result = checkpoint_decode::with_limits::<Pair>(
            &encoded,
            checkpoint_decode::Limits {
                allocation_work: allocation,
                values,
                ..checkpoint_decode::Limits::default()
            },
        );
        if let Some(expected) = expected {
            assert_eq!(result.err().unwrap().kind, expected);
        } else {
            assert_eq!(result.unwrap().1, usage);
        }
    }
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        packet.encoded_bytes()
    );
}

#[test]
fn character_runtime_admission_disabled_controller_keeps_pending_signed_commands() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .set_body_options(
            actor,
            &crate::physics3d::BodyOptions {
                kind: BodyKind::KinematicPosition,
                enabled: false,
                ..crate::physics3d::BodyOptions::default()
            },
        )
        .unwrap();
    world
        .enable_character(
            actor,
            CharacterConfig {
                push_mass: 10.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    world
        .set_character_input(
            actor,
            CharacterInput {
                velocity: [-1., 0., 0.],
                jump_speed: 3.,
            },
        )
        .unwrap();
    world
        .set_character_traversal(actor, 10000., 10000.)
        .unwrap();
    world
        .add_character_force(actor, [-10., -20., -30.])
        .unwrap();
    world
        .apply_character_impulse(actor, [-1., -2., -3.])
        .unwrap();
    let packet = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&packet).unwrap();
    for _ in 0..6 {
        world.step();
        restored.step();
        let runtime = &world.characters[&actor];
        assert_eq!(runtime.external_force, [-10., -20., -30.]);
        assert_eq!(runtime.pending_impulse, [-1., -2., -3.]);
        assert_eq!(runtime.state, crate::physics3d::CharacterState::default());
        assert_eq!(world.body_state(actor), restored.body_state(actor));
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn character_runtime_admission_actual_preview_motion_stop_survives_source_removal() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap();
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(
            actor,
            CharacterConfig {
                step_height: 0.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    let mut moving = None;
    for (x, kind) in [(-1., BodyKind::Fixed), (3., BodyKind::KinematicPosition)] {
        let id = world
            .create_body(
                BodyDesc {
                    kind,
                    pose: Pose {
                        position: [x, 0., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.25, 2., 5.],
                }),
            )
            .unwrap();
        if kind == BodyKind::KinematicPosition {
            moving = Some(id);
        }
    }
    let moving = moving.unwrap();
    world
        .set_kinematic_target(
            moving,
            Pose {
                position: [-3., 0., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    // This is the actual internal preview producer, before an accepted step;
    // it is not a synthetic stop supplied by the admission implementation.
    let mut backup = Vec::new();
    world.preview_characters(&mut backup);
    let stop = world.characters[&actor].motion_stop.as_ref().unwrap();
    assert!((0. ..=1.).contains(&stop.fraction));
    assert!(stop.bodies.contains(&Some(moving)));
    let stage = world.capture_snapshot().unwrap();
    assert_eq!(
        PhysicsWorld3d::from_snapshot(&stage)
            .unwrap()
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        stage.encoded_bytes()
    );
    world.remove_body(moving).unwrap();
    assert!(world.characters[&actor]
        .motion_stop
        .as_ref()
        .unwrap()
        .bodies
        .contains(&Some(moving)));
    let packet = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&packet).unwrap();
    for _ in 0..6 {
        world.step();
        restored.step();
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn precise_character_fractions_keep_sub_f32_bits_signed_zero_and_six_tick_codec_replay() {
    use crate::physics3d::{character_motion::MotionStop, solver_trajectory::Time};
    for (carry, stop) in [(0.5_f64.next_up(), 0.5_f64.next_down()), (-0., -0.)] {
        let (mut world, actor, _) = fixture();
        let retired = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [100., 2., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.5; 3],
                }),
            )
            .unwrap();
        world.remove_body(retired).unwrap();
        // These are controlled cold saved fields. The public producer/step
        // fixture is retained; no assertion claims a public scalar setter.
        let runtime = world.characters.get_mut(&actor).unwrap();
        runtime.carry_fraction = carry;
        let mut bodies = [None; 12];
        bodies[0] = Some(retired);
        runtime.motion_stop = Some(MotionStop {
            fraction: stop,
            bodies,
        });
        let saved = world.capture_snapshot().unwrap();
        assert_eq!(
            u32::from_le_bytes(saved.bytes[8..12].try_into().unwrap()),
            7
        );
        let mut restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        let runtime = &restored.characters[&actor];
        assert_eq!(runtime.carry_fraction.to_bits(), carry.to_bits());
        assert_eq!(
            runtime.motion_stop.as_ref().unwrap().fraction.to_bits(),
            stop.to_bits()
        );
        assert_eq!(
            postcard::to_allocvec(&(carry, stop)).unwrap().len(),
            2 * std::mem::size_of::<Time>()
        );
        assert_eq!(
            saved.encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
        for _ in 0..6 {
            world.step_checked().unwrap();
            restored.step_checked().unwrap();
            assert_eq!(
                world.capture_snapshot().unwrap().encoded_bytes(),
                restored.capture_snapshot().unwrap().encoded_bytes()
            );
        }
    }
}

#[test]
fn precise_authored_path_times_have_exact_cold_work_valid_crc_rejection_and_six_tick_replay() {
    use crate::physics3d::{solver_trajectory::Time, KinematicPath};
    let (mut world, _, _) = fixture();
    let platform = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [10., 2., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5, 0.1, 0.5],
            }),
        )
        .unwrap();
    let knot = 0.37512344_f32;
    world
        .step_with_kinematic_paths(&[KinematicPath {
            body: platform,
            sweep_sensors: false,
            knots: vec![
                (
                    knot,
                    Pose {
                        position: [11., 2., 0.],
                        ..Pose::default()
                    },
                ),
                (
                    1.,
                    Pose {
                        position: [12., 2., 0.],
                        ..Pose::default()
                    },
                ),
            ],
        }])
        .unwrap();
    assert_eq!(world.path_scratch.saved_time_payload_counts(), (2, 1, 1));
    assert!(world.path_scratch.saved_time_payload_valid());
    let saved = world.capture_snapshot().unwrap();
    let usage = character_admission::validate(&world, character_admission::LIMITS).unwrap();
    assert_eq!(usage.work, 8 + 384 + 160 + 128 + 8 + 8 * (2 + 1 + 1));
    assert_eq!(usage.scratch_bytes, 0);
    for maximum in [usage.work, usage.work - 1] {
        assert_eq!(
            character_admission::validate(
                &world,
                character_admission::Limits {
                    max_work: maximum,
                    max_scratch_bytes: 0
                }
            ),
            if maximum == usage.work {
                Ok(usage)
            } else {
                Err(PhysicsSnapshotError::Capacity)
            }
        );
    }
    let cut = Time::from(knot);
    let encoded = postcard::to_allocvec(&cut).unwrap();
    assert_eq!(encoded.len(), 8);
    let positions: Vec<_> = saved.bytes[HEADER..]
        .windows(encoded.len())
        .enumerate()
        .filter_map(|(i, bytes)| (bytes == encoded).then_some(HEADER + i))
        .collect();
    assert_eq!(
        positions.len(),
        1,
        "the actual saved cut has one eight-byte wire location"
    );
    for bad in [Time::NAN, Time::INFINITY, 0., 1., 1.0_f64.next_up()] {
        let mut damaged = saved.clone();
        damaged.bytes[positions[0]..positions[0] + encoded.len()]
            .copy_from_slice(&postcard::to_allocvec(&bad).unwrap());
        let checksum = crc(&damaged.bytes[HEADER..]);
        damaged.bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
        let payload = damaged.payload().unwrap();
        // Decode without semantic admission to establish that CRC/Serde are
        // valid and that the owner guard, not repair, rejects the saved cut.
        let Restore { world: candidate } = crate::checkpoint_decode::from_bytes(payload).unwrap();
        assert!(!candidate.path_scratch.saved_time_payload_valid());
        assert_eq!(
            postcard::to_allocvec(&Capture { world: &candidate }).unwrap(),
            payload
        );
        assert_eq!(
            PhysicsWorld3d::from_snapshot(&damaged).err(),
            Some(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            world.restore_snapshot(&damaged),
            Err(PhysicsSnapshotError::InvalidState)
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            saved.encoded_bytes()
        );
    }
    let mut restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    for _ in 0..6 {
        world.step_checked().unwrap();
        restored.step_checked().unwrap();
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn precise_completed_query_payload_valid_crc_damage_keeps_native_source_unchanged() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.037,
        ..WorldConfig::default()
    })
    .unwrap();
    world.force_character_motion_proof();
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
    world.step_checked().unwrap();
    let saved = world.capture_snapshot().unwrap();
    for case in 0..16 {
        let mut candidate = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        candidate.step_motion.test_corrupt_precise_payload(case);
        reject_fixture(&candidate, &saved, &format!("precise query payload {case}"));
    }
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        saved.encoded_bytes()
    );
}
