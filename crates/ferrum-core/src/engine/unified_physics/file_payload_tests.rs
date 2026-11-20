use super::*;
use crate::components::{AabbCollider, CollisionLayer, CollisionMask, DistanceJoint, RigidBody};
use crate::engine::{file_candidate, file_envelope, persistence};

const SDK: u64 = 0xab71_3944_4818_2047;
fn tick(e: &mut Engine) {
    e.update(1. / 60.);
}

fn fixture() -> (Engine, Entity, Entity, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_data_scene_camera(400., 240., u32::MAX, 0, false, 0., 0., 0., 0., 0.);
    let mut entities = Vec::new();
    for (x, rigid) in [
        (0., RigidBody::dynamic(2.)),
        (2., RigidBody::dynamic(2.)),
        (20., RigidBody::kinematic()),
    ] {
        let a = e.world.spawn_entity();
        e.world.set_transform(a, Transform2D { x, y: 0. });
        e.world.set_rigid_body(a, rigid);
        e.world.set_aabb_collider(
            a,
            AabbCollider::new(0.25, 0.25, false, CollisionLayer::Player),
        );
        entities.push(a);
    }
    let (a, b, k) = (entities[0], entities[1], entities[2]);
    e.world.add_distance_joint(DistanceJoint::new(a, b, 2.));
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let shooter = e
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Fixed,
                pose: Pose {
                    position: [100., 100., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc {
                sensor: true,
                category: CollisionMask::PLAYER.bits,
                ..ColliderDesc::new(crate::physics3d::Shape::Sphere { radius: 1. })
            },
            [0.; 3],
        )
        .unwrap();
    assert!(e.configure_spatial_terrain(
        &[40., 40., 4., 4., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    assert!(e.configure_spatial_moving_platforms(&[2., 7., 2., 0., 0., 1., 0., 0.]));
    assert!(e.configure_data_scene_kinematic_controller(
        k.id,
        k.generation,
        false,
        u32::MAX,
        4,
        0.25,
        0.5,
        true
    ));
    assert!(e.set_gameplay_action_projectile_with_target(
        shooter.id,
        shooter.generation,
        77,
        1.,
        5.,
        3.,
        3.,
        0,
        0,
        0
    ));
    assert!(e.set_input_action_binding(77, 0, 3, 2));
    assert!(e.configure_data_scene_gameplay_v2(true, shooter.id, shooter.generation, 0, true));
    let mouse = e.camera.world_to_screen(Transform2D { x: 300., y: 100. });
    e.set_input(
        false, false, false, false, false, false, true, mouse.x, mouse.y,
    );
    tick(&mut e);
    assert_eq!(e.unified_physics_error(), None);
    e.set_input(false, false, false, false, false, false, false, 0., 0.);
    // The internal admitted queue/resolve producer is identified separately
    // from the public projectile producer used above.
    e.unified_physics
        .as_mut()
        .unwrap()
        .queue_native_dash(&e.world, k, Velocity { vx: 0.5, vy: 0. }, 1)
        .unwrap();
    tick(&mut e);
    e.unified_physics
        .as_mut()
        .unwrap()
        .take_native_dash_result(k)
        .unwrap();
    let r = e.unified_physics.as_ref().unwrap();
    assert!(!r.projectiles.is_empty());
    assert!(!r.legacy_joints.is_empty());
    (e, a, b, k)
}

fn pending_body(e: &mut Engine, a: Entity, b: Entity) {
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(0.75, 0.25, false, CollisionLayer::Player),
    );
    let mut rigid = e.world.rigid_body(b).unwrap();
    rigid.linear_damping = -1.;
    e.world.set_rigid_body(b, rigid);
    tick(e);
    assert!(e.unified_physics_error().is_some());
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .pending_planar
        .is_empty());
}

fn pending_joint(e: &mut Engine, a: Entity, b: Entity) {
    let mut invalid = DistanceJoint::new(a, b, 2.);
    invalid.stiffness = -1.;
    e.world.add_distance_joint(invalid);
    tick(e);
    assert!(e.unified_physics_error().is_some());
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .pending_joints
        .is_empty());
}

fn wire(e: &Engine) -> Vec<u8> {
    let l = file_candidate::Limits::default();
    let section = file_candidate::capture_engine_section(e, &l).unwrap();
    file_envelope::encode(
        &file_candidate::profile(SDK),
        &file_envelope::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &l.framing,
    )
    .unwrap()
}

fn limits() -> crate::gameplay::file_admission::Limits {
    crate::gameplay::file_admission::Limits {
        max_work: 100_000_000,
        max_scratch_bytes: 16_000_000,
    }
}
fn validate(
    e: &Engine,
    l: crate::gameplay::file_admission::Limits,
) -> Result<crate::gameplay::file_admission::Usage, crate::gameplay::file_admission::Error> {
    let mut b = crate::gameplay::file_admission::Budget::new(l);
    if let Some(r) = &e.unified_physics {
        r.validate_file_payload(&mut b)?;
    }
    Ok(b.usage())
}
fn admitted(e: &Engine) {
    let used = validate(e, limits()).unwrap();
    let bytes = persistence::encode(e).unwrap();
    let restored = persistence::decode(&bytes).unwrap();
    assert_eq!(persistence::encode(&restored).unwrap(), bytes);
    assert_eq!(validate(&restored, limits()), Ok(used));
    file_candidate::prepare(&wire(e), SDK, &file_candidate::Limits::default()).unwrap();
}

impl Engine {
    pub(in crate::engine) fn runtime_payload_fixture_for_file_candidate() -> Self {
        fixture().0
    }
}

#[test]
fn runtime_payload_public_cached_and_partial_failure_histories() {
    let (mut e, _, _, _) = fixture();
    admitted(&e);
    let mut restored = persistence::decode(&persistence::encode(&e).unwrap()).unwrap();
    for _ in 0..6 {
        tick(&mut e);
        tick(&mut restored);
        assert_eq!(
            persistence::encode(&e).unwrap(),
            persistence::encode(&restored).unwrap()
        );
    }
    let (mut e, a, b, _) = fixture();
    pending_body(&mut e, a, b);
    admitted(&e);
    let (mut e, a, b, _) = fixture();
    pending_joint(&mut e, a, b);
    admitted(&e);
}

#[test]
fn runtime_payload_actual_valid_crc_twenty_one_hidden_cache_and_pending_damage_rejects() {
    for case in 0..21 {
        let (mut e, a, b, k) = fixture();
        if case == 12 {
            // The admitted pending cache now contains changes only. A real tile
            // edit must precede the planar failure to retain an actual delta.
            e.tilemap
                .set_layer(0, 1, 1, 1., 1., 1000., 1000., true, vec![1]);
        }
        if (4..=6).contains(&case) || case == 12 {
            pending_body(&mut e, a, b);
            if case == 12 {
                assert!(e
                    .unified_physics
                    .as_ref()
                    .unwrap()
                    .terrain
                    .file_pending()
                    .is_some_and(|p| !p.is_empty()));
            }
        }
        if case == 8 {
            pending_joint(&mut e, a, b);
        }
        admitted(&e);
        let source = persistence::encode(&e).unwrap();
        let mut damaged = persistence::decode(&source).unwrap();
        let r = damaged.unified_physics.as_mut().unwrap();
        let body = r.bindings[&(k.id, k.generation)].body;
        match case {
            0 => r.previous_auto_config.gravity.vx = f32::NAN,
            1..=3 => r
                .bindings
                .values_mut()
                .find_map(|v| v.legacy.as_mut())
                .unwrap()
                .corrupt_runtime_payload_fixture(case - 1),
            4..=6 => r.pending_planar[0].corrupt_runtime_payload_fixture(case - 4),
            7 => r
                .legacy_joints
                .values_mut()
                .next()
                .unwrap()
                .corrupt_runtime_payload_fixture(),
            8 => r.pending_joints[0].corrupt_runtime_payload_fixture(),
            9..=10 => r
                .projectiles
                .values_mut()
                .next()
                .unwrap()
                .corrupt_runtime_payload_fixture(case - 9),
            11..=12 => r.terrain.corrupt_runtime_payload_fixture(case == 12),
            13..=15 => r.platform_motion.corrupt_runtime_payload_fixture(case - 13),
            16 => r.dash.corrupt_runtime_payload_fixture(0, k, body),
            17 => r.dash.corrupt_runtime_payload_fixture(1, k, body),
            18 => {
                let v = r
                    .automatic_planar
                    .settings
                    .get_mut(&(k.id, k.generation))
                    .unwrap();
                let mut bytes = postcard::to_allocvec(v).unwrap();
                let marker = 0.25f32.to_le_bytes();
                let at = bytes.windows(4).position(|p| p == marker).unwrap();
                bytes[at..at + 4].copy_from_slice(&f32::NAN.to_le_bytes());
                *v = crate::checkpoint_decode::from_bytes(&bytes).unwrap();
            }
            19 => r.automatic_planar.corrupt_runtime_payload_fixture(k, body),
            20 => r.dash.corrupt_runtime_payload_fixture(2, k, body),
            _ => unreachable!(),
        }
        let memory = persistence::encode(&damaged).unwrap();
        assert_ne!(memory, source);
        let decoded = persistence::decode(&memory).unwrap();
        assert_eq!(persistence::encode(&decoded).unwrap(), memory);
        assert!(
            matches!(
                validate(&decoded, limits()),
                Err(crate::gameplay::file_admission::Error::Invalid { .. })
            ),
            "case {case}: {:?}",
            validate(&decoded, limits())
        );
        assert_eq!(persistence::encode(&decoded).unwrap(), memory);
        assert_eq!(persistence::encode(&e).unwrap(), source);
        let file = wire(&decoded);
        let before = file.clone();
        file_envelope::read(
            &file,
            &file_candidate::profile(SDK),
            &file_candidate::Limits::default().framing,
        )
        .unwrap();
        assert!(
            matches!(
                file_candidate::prepare(&file, SDK, &file_candidate::Limits::default()),
                Err(file_candidate::Error::RuntimePayload(_))
            ),
            "sealed candidate case {case}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&decoded).unwrap(), memory);
        assert_eq!(persistence::encode(&e).unwrap(), source);
        println!("AFTER runtime_payload case{case}: validCRC/codec/readonly owner typed rejection; source bytes unchanged");
    }
}

#[test]
fn runtime_payload_exact_one_below_work_scratch_and_shared_allowance_do_not_mutate() {
    let (e, _, _, _) = fixture();
    let source = persistence::encode(&e).unwrap();
    let u = validate(&e, limits()).unwrap();
    assert!(u.work > 0 && u.scratch_bytes > 0);
    assert_eq!(
        validate(
            &e,
            crate::gameplay::file_admission::Limits {
                max_work: u.work,
                max_scratch_bytes: u.scratch_bytes
            }
        ),
        Ok(u)
    );
    assert_eq!(
        validate(
            &e,
            crate::gameplay::file_admission::Limits {
                max_work: u.work - 1,
                max_scratch_bytes: u.scratch_bytes
            }
        ),
        Err(crate::gameplay::file_admission::Error::WorkLimit)
    );
    assert_eq!(
        validate(
            &e,
            crate::gameplay::file_admission::Limits {
                max_work: u.work,
                max_scratch_bytes: u.scratch_bytes - 1
            }
        ),
        Err(crate::gameplay::file_admission::Error::ScratchLimit)
    );
    let mut b =
        crate::gameplay::file_admission::Budget::new(crate::gameplay::file_admission::Limits {
            max_work: u.work,
            max_scratch_bytes: u.scratch_bytes,
        });
    b.work(1).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .validate_file_payload(&mut b),
        Err(crate::gameplay::file_admission::Error::WorkLimit)
    );
    assert_eq!(persistence::encode(&e).unwrap(), source);
}
#[test]
fn runtime_payload_previous_auto_raw_finite_negative_zero_and_max_iterations_are_history() {
    let (mut e, _, _, _) = fixture();
    let c = &mut e.unified_physics.as_mut().unwrap().previous_auto_config;
    c.velocity_iterations = u32::MAX;
    c.position_iterations = 0;
    c.position_correction_percent = -2.;
    c.position_correction_slop = -0.;
    c.restitution_velocity_threshold = -3.;
    c.contact_baumgarte_bias_factor = -4.;
    c.max_contact_baumgarte_bias_velocity = -5.;
    admitted(&e);
}
#[test]
fn runtime_payload_real_prefab_unbound_batch_and_stale_settings_survive_until_retirement() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_data_scene_camera(400., 240., u32::MAX, 0, false, 0., 0., 0., 0., 0.);
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        max_bodies: 4,
        ..WorldConfig::default()
    })
    .unwrap();
    let source = e.world.spawn_entity();
    e.world.set_transform(source, Transform2D { x: 0., y: 0. });
    e.world.set_rigid_body(source, RigidBody::kinematic());
    e.world.set_aabb_collider(
        source,
        AabbCollider::new(1., 1., false, CollisionLayer::Player),
    );
    assert!(e.configure_data_scene_kinematic_controller(
        source.id,
        source.generation,
        false,
        u32::MAX,
        4,
        0.25,
        0.5,
        true
    ));
    let r = e.unified_physics.as_mut().unwrap();
    let definition = r.actor_physics_prototype(source).unwrap().unwrap();
    let n = r.physics.config().max_bodies + 4;
    // Actual internal prefab installer, distinguished from public source APIs.
    // Keep this unbound batch alive while inserting, then despawn it together.
    let mut pending = Vec::new();
    for _ in 0..n {
        let a = e.world.spawn_entity();
        e.world.set_transform(a, Transform2D { x: 4., y: 0. });
        r.install_actor_physics_prototype(&mut e.world, a, &definition)
            .unwrap();
        pending.push(a);
    }
    assert_eq!(r.automatic_planar.settings.len(), n + 1);
    assert!(r.automatic_planar.settings.len() > r.physics.config().max_bodies);
    for entity in pending {
        e.world.despawn(entity);
    }
    assert_eq!(r.automatic_planar.settings.len(), n + 1);
    admitted(&e);
}
#[test]
fn runtime_payload_actual_platform_prepare_failure_keeps_finite_large_pose_and_default_suffix() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_data_scene_camera(400., 240., u32::MAX, 0, false, 0., 0., 0., 0., 0.);
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    assert!(e.configure_spatial_terrain(
        &[
            999999., 40., 1., 4., -1., 0., 0., 1., 1., 1., 1., 40., 40., 4., 4., -1., 0., 0., 1.,
            1., 1., 1.
        ],
        &[7, 0, 0, 1, 8, 0, 0, 1]
    ));
    assert!(e.configure_spatial_moving_platforms(&[
        2., 7., 1_000_000., 0., 0., 1., 0., 0., 2., 8., 2., 0., 0., 1., 0., 0.
    ]));
    tick(&mut e);
    assert!(e.unified_physics_error().is_some());
    e.unified_physics
        .as_ref()
        .unwrap()
        .platform_motion
        .assert_runtime_payload_failed_prefix_fixture();
    admitted(&e);
    assert!(e.configure_spatial_moving_platforms(&[
        2., 7., 0., 0., 0., 1., 0., 0., 2., 8., 2., 0., 0., 1., 0., 0.
    ]));
    assert!(e.take_unified_physics_error().is_some());
    tick(&mut e);
    assert_eq!(e.unified_physics_error(), None);
    admitted(&e);
}

#[test]
fn runtime_payload_spatial_dash_cached_request_keeps_xz_plane_after_queue_is_taken() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_data_scene_camera(400., 240., u32::MAX, 0, false, 0., 0., 0., 0., 0.);
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::KinematicVelocity,
                ..BodyDesc::default()
            },
            ColliderDesc::new(crate::physics3d::Shape::Sphere { radius: 1. }),
            [0.; 3],
        )
        .unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .queue_native_dash(&e.world, a, Velocity { vx: 0.5, vy: 0.25 }, 0)
        .unwrap();
    tick(&mut e);
    assert!(e
        .unified_physics
        .as_mut()
        .unwrap()
        .take_native_dash_result(a)
        .unwrap());
    admitted(&e);
    let mut restored = persistence::decode(&persistence::encode(&e).unwrap()).unwrap();
    for _ in 0..6 {
        tick(&mut e);
        tick(&mut restored);
        admitted(&e);
        assert_eq!(
            persistence::encode(&e).unwrap(),
            persistence::encode(&restored).unwrap()
        );
    }
}
