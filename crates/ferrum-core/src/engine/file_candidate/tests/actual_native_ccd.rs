//! Real Native-only angular CCD producer → complete existing native file codec.
use super::*;
use crate::components::CollisionMask;
use crate::engine::file_shared_arcs as arcs;
use crate::physics3d::{BodyId, BodyKind, PhysicsSnapshot};
use crate::Entity;

fn native_ccd_source(ccd: bool, exact: bool) -> (Engine, Entity, BodyId) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.configure_data_scene_camera(400., 240., u32::MAX, 0, false, 0., 0., 0., 0., 0.);
    engine
        .configure_unified_physics(WorldConfig {
            space: Space::Spatial,
            gravity: [0.; 3],
            step_seconds: 0.1,
            max_events: 16,
            ..WorldConfig::default()
        })
        .unwrap();
    if exact {
        force_exact_motion_fixture(&mut engine);
    }
    engine.configure_fixed_timestep(true, 0.1, 0.1, 1);
    // A real generated projectile enables completed-step motion capture. Keep
    // its owner/trajectory far from the original bar/sphere pair, rather than
    // directly changing private trace state or installing a handcrafted trace.
    let player = engine
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [100., 10., -100.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                category: CollisionMask::PLAYER.bits,
                ..ColliderDesc::new(Shape::Sphere { radius: 1. })
            },
            [0.; 3],
        )
        .unwrap();
    assert!(engine.set_gameplay_action_projectile_with_target(
        player.id,
        player.generation,
        77,
        10.,
        1.,
        0.01,
        3., // Actual lifetime, long enough for warmup + CCD tick + six replay ticks.
        0,
        0,
        0,
    ));
    assert!(engine.set_input_action_binding(77, 0, 3, 2));
    assert!(engine.configure_data_scene_gameplay_v2(true, player.id, player.generation, 0, true));
    let screen = engine
        .camera
        .world_to_screen(crate::components::Transform2D { x: 300., y: 100. });
    engine.set_input(
        false, false, false, false, false, false, true, screen.x, screen.y,
    );
    engine
        .update_frame_checked(f64::from(0.1_f32), true, true, true)
        .unwrap();
    assert!(engine.take_unified_physics_error().is_none());
    let projectiles: Vec<_> = engine
        .world
        .alive_indices()
        .iter()
        .filter_map(|&index| engine.world.entity_at_index(index))
        .filter(|&entity| engine.data_scene.gameplay.combat.owns_projectile(entity))
        .collect();
    assert_eq!(
        projectiles.len(),
        1,
        "the real public action must leave an active projectile"
    );
    assert!(engine.world.gameplay_lifetime(projectiles[0]).unwrap() > 1.);
    assert!(engine.unified_body_state(projectiles[0]).is_ok());
    PhysicsSnapshot::test_assert_native_step_motion_enabled(&native_bytes(&engine));
    engine.set_input(false, false, false, false, false, false, false, 0., 0.);

    let angle = -std::f32::consts::FRAC_PI_8;
    let bar = engine
        .create_unified_body(
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
            [0.; 3],
        )
        .unwrap();
    engine
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [1.99, 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.015 }),
            [0.; 3],
        )
        .unwrap();
    engine
        .update_frame_checked(f64::from(0.1_f32), true, true, true)
        .unwrap();
    assert!(engine.take_unified_physics_error().is_none());
    assert_eq!(
        engine.unified_physics_step_statistics().unwrap().ccd_clamps,
        1
    );
    let clamps = engine.unified_ccd_clamps().unwrap();
    assert_eq!(clamps.len(), 1);
    assert_eq!(clamps[0].moving, bar);
    let body = clamps[0].clamp.moving.body;
    assert!(engine.unified_body_state(bar).unwrap().pose.rotation[2] < 0.);
    (engine, bar, body)
}
fn force_exact_motion_fixture(engine: &mut Engine) {
    engine
        .unified_physics
        .as_mut()
        .unwrap()
        .force_exact_motion_fixture();
}

fn native_bytes(engine: &Engine) -> Vec<u8> {
    engine.unified_physics.as_ref().unwrap().checkpoint_bytes()
}

#[test]
fn file_candidate_actual_native_ccd_saved_queries_and_six_tick_runtime_are_identical() {
    for ccd in [false, true] {
        let (mut source, bar, body) = native_ccd_source(ccd, true);
        let native = native_bytes(&source);
        let (shape, pose, query) =
            PhysicsSnapshot::test_assert_native_ccd_saved_query(&native, body);
        let memory = persistence::encode(&source).unwrap();
        let file = wire(&source);
        let file_before = file.clone();
        let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
        force_exact_motion_fixture(&mut candidate.engine);
        assert_eq!(persistence::encode(&candidate.engine).unwrap(), memory);
        assert_eq!(native_bytes(&candidate.engine), native);
        assert_eq!(
            PhysicsSnapshot::test_query_saved_native_ccd(
                &native_bytes(&candidate.engine),
                &shape,
                pose
            ),
            query
        );
        assert_eq!(persistence::encode(&source).unwrap(), memory);
        for _ in 0..6 {
            assert_eq!(
                source.unified_body_state(bar),
                candidate.engine.unified_body_state(bar)
            );
            assert_eq!(
                source.unified_ccd_clamps(),
                candidate.engine.unified_ccd_clamps()
            );
            assert_eq!(
                PhysicsSnapshot::test_query_saved_native_ccd(&native_bytes(&source), &shape, pose),
                PhysicsSnapshot::test_query_saved_native_ccd(
                    &native_bytes(&candidate.engine),
                    &shape,
                    pose
                )
            );
            assert_eq!(
                persistence::encode(&source).unwrap(),
                persistence::encode(&candidate.engine).unwrap()
            );
            source
                .update_frame_checked(f64::from(0.1_f32), true, true, true)
                .unwrap();
            candidate
                .engine
                .update_frame_checked(f64::from(0.1_f32), true, true, true)
                .unwrap();
        }
        assert_eq!(
            persistence::encode(&source).unwrap(),
            persistence::encode(&candidate.engine).unwrap()
        );
        assert_eq!(file, file_before);
    }
}

#[test]
fn file_candidate_actual_native_ccd_original_end_damage_rejects_valid_crcs_and_keeps_source() {
    for ccd in [false, true] {
        let (source, _, body) = native_ccd_source(ccd, true);
        let native = native_bytes(&source);
        let bad_native = PhysicsSnapshot::test_native_ccd_bad_original_end(&native, body);
        let memory = persistence::encode(&source).unwrap();
        let mut bad_memory = memory.clone();
        // Existing helper also recalculates the inner Engine CRC. The altered
        // native snapshot already has its own valid CRC; wire adds both valid
        // outer Engine-section and full-file framing CRCs without repairing it.
        replace_unique(&mut bad_memory, &native, &bad_native);
        let bad = wire_with_memory(&source, &bad_memory);
        let before = bad.clone();
        framing::read(&bad, &profile(SDK_BUILD), &framing::Limits::default()).unwrap();
        assert_eq!(
            prepare(&bad, SDK_BUILD, &Limits::default()).unwrap_err(),
            Error::EngineSection(engine_section::Error::Payload(
                RuntimeCheckpointError::InvalidState
            ))
        );
        assert_eq!(bad, before);
        assert_eq!(persistence::encode(&source).unwrap(), memory);
        prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
    }
}

#[test]
fn file_candidate_actual_native_ccd_uses_exact_decode_and_common_post_decode_quotas() {
    for ccd in [false, true] {
        let (source, _, _) = native_ccd_source(ccd, false);
        let memory = persistence::encode(&source).unwrap();
        let file = wire(&source);
        let original = file.clone();
        let parsed =
            framing::read(&file, &profile(SDK_BUILD), &framing::Limits::default()).unwrap();
        let (_, decode) = engine_section::decode_with_usage::<
            arcs::Table,
            Option<crate::physics3d::file_shared_shapes::Table>,
        >(
            parsed.section(framing::SectionKind::Engine),
            Limits::default().decode,
        )
        .unwrap();
        let usage = prepare(&file, SDK_BUILD, &Limits::default())
            .unwrap()
            .usage();
        let exact = Limits {
            decode: crate::checkpoint_decode::Limits {
                allocation_work: decode.allocation_work,
                ..Limits::default().decode
            },
            max_post_decode_work: usage.post_decode_work,
            max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
            ..Limits::default()
        };
        assert_eq!(
            prepare(&file, SDK_BUILD, &exact)
                .unwrap()
                .usage()
                .post_decode_work,
            usage.post_decode_work
        );
        for (limits, expected) in [
            (
                Limits {
                    decode: crate::checkpoint_decode::Limits {
                        allocation_work: decode.allocation_work - 1,
                        ..exact.decode
                    },
                    ..exact.clone()
                },
                Error::EngineSection(engine_section::Error::Payload(
                    RuntimeCheckpointError::Capacity,
                )),
            ),
            (
                Limits {
                    max_post_decode_work: usage.post_decode_work - 1,
                    ..exact.clone()
                },
                Error::NativeResources(native_resources::Error::WorkLimit),
            ),
            (
                Limits {
                    max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes - 1,
                    ..exact
                },
                Error::NativeResources(native_resources::Error::ScratchLimit),
            ),
        ] {
            assert_eq!(prepare(&file, SDK_BUILD, &limits).unwrap_err(), expected);
            assert_eq!(file, original);
            assert_eq!(persistence::encode(&source).unwrap(), memory);
        }
    }
}
