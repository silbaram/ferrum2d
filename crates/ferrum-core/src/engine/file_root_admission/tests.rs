use super::*;
use crate::engine::persistence;
use crate::physics::{FixedTimestep, FixedTimestepConfig};
use crate::physics3d::{SolverSettings, WorldConfig};

fn limits() -> Limits {
    Limits { max_work: 1000 }
}
fn encoded(engine: &Engine) -> Vec<u8> {
    persistence::encode(engine).unwrap()
}

fn check(engine: &Engine) -> Usage {
    assert!(engine.capture_runtime_checkpoint().is_some());
    let before = encoded(engine);
    let usage = validate(engine, limits()).unwrap();
    assert_eq!(encoded(engine), before);
    let candidate = persistence::decode(&before).unwrap();
    assert_eq!(validate(&candidate, limits()), Ok(usage));
    assert_eq!(encoded(&candidate), before);
    usage
}

fn continuation(engine: &mut Engine) {
    check(engine);
    let mut candidate = persistence::decode(&encoded(engine)).unwrap();
    for dt in [0.0, 0.004, 0.01, 0.025, 0.0, 0.019] {
        engine.update_frame(dt, false, false, false);
        candidate.update_frame(dt, false, false, false);
        check(engine);
        check(&candidate);
        assert_eq!(encoded(engine), encoded(&candidate));
    }
}

fn config() -> WorldConfig {
    WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        max_bodies: 64,
        max_colliders: 128,
        max_events: 64,
        max_characters: 8,
        max_joints: 64,
        ..WorldConfig::default()
    }
}

fn native() -> Engine {
    let mut engine = crate::engine::legacy_test_fixture::engine();
    engine.use_data_scene();
    engine.configure_unified_physics_defaults(config()).unwrap();
    engine
}

fn sprite(engine: &mut Engine) -> Entity {
    assert!(engine.spawn_data_scene_entity(
        10.0,
        20.0,
        0.0,
        0,
        1,
        32.0,
        32.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0,
        0.0,
        crate::engine::PHYSICS_LAYER_PLAYER,
        crate::engine::PHYSICS_COLLIDER_TYPE_NONE,
        0.0,
        0.0,
        false,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        vec![],
    ));
    Entity {
        id: engine.data_scene_entity_id(),
        generation: engine.data_scene_entity_generation(),
    }
}

#[test]
fn file_engine_root_builtin_scene_histories_and_continuation_preserve_private_bytes() {
    let mut engine = Engine::new();
    check(&engine);
    for scene in 0..3 {
        match scene {
            0 => engine.set_texture_ids(1, 2, 3),
            1 => engine.use_breakout_scene(),
            _ => engine.use_platformer_scene(),
        }
        engine.set_input(false, false, false, false, false, true, false, -50.0, 900.0);
        engine.update_frame(0.02, false, false, false);
        engine.set_input(
            false, false, false, false, false, false, false, -50.0, 900.0,
        );
        engine.configure_fixed_timestep(true, 0.01, 0.25, 8);
        engine.configure_physics_render_interpolation(true);
        continuation(&mut engine);
        engine.reset_game();
        check(&engine);
    }
    // Inactive scene-owned handles are saved history, not a newly rebuilt scene.
    engine.use_data_scene();
    check(&engine);
    continuation(&mut engine);
}

#[test]
fn file_engine_root_zero_dt_negative_legacy_time_latch_and_epsilon_clock_are_legal() {
    let mut engine = crate::engine::legacy_test_fixture::engine();
    engine.use_data_scene();
    engine.update_frame(-0.25, false, false, false);
    assert_eq!(engine.elapsed_seconds, -0.25);
    check(&engine);
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    engine.set_input(false, false, false, false, true, false, false, 0.0, -0.0);
    engine.set_input(false, false, false, false, false, false, false, 0.0, -0.0);
    assert_eq!(engine.input.space, 0);
    // A short sampled press is retained independently of current/previous input.
    check(&engine);
    engine.update_frame(0.09995, false, false, false);
    assert!(engine.fixed_timestep.accumulated_seconds() < 0.0);
    check(&engine);
    engine.update_frame(0.0, false, false, false);
    check(&engine);
    engine.fixed_timestep.pause();
    check(&engine);
    engine.update_frame(0.03, false, false, false);
    check(&engine);
    engine.fixed_timestep.resume();
    engine.configure_physics_render_interpolation(true);
    assert!(engine.pause_data_scene());
    check(&engine);
    assert!(engine.resume_data_scene());
    continuation(&mut engine);
}

#[test]
fn file_engine_root_camera_free_stale_follow_and_last_spawn_are_distinct_from_primary() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine);
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    let last = sprite(&mut engine);
    assert_ne!(
        engine.world.primary_actor_entity(),
        engine.data_scene_entity
    );
    assert!(engine.configure_data_scene_camera(
        -1000.0,
        900.0,
        last.id,
        last.generation,
        true,
        -2000.0,
        -1000.0,
        4000.0,
        5000.0,
        0.25
    ));
    assert!(engine.configure_data_scene_projection(0.01));
    assert!(engine.configure_data_scene_sun(1e-6, -1e-6, 1.0, 100.0, 10000));
    engine.set_viewport_size(400.0, 200.0);
    check(&engine);
    assert!(engine.despawn_physics_entity(last.id, last.generation));
    // Both saved handles intentionally remain stale until their consumers run.
    assert_eq!(engine.data_scene_entity, Some(last));
    assert_eq!(engine.data_scene.camera.file_configuration().0, Some(last));
    let reused = sprite(&mut engine);
    assert_eq!(reused.id, last.id);
    assert!(reused.generation > last.generation);
    check(&engine);
    continuation(&mut engine);
    assert!(engine.configure_data_scene_camera(
        -100000.0,
        90000.0,
        u32::MAX,
        u32::MAX,
        false,
        f32::NAN,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NAN,
        0.0
    ));
    assert_eq!(engine.data_scene.camera.file_configuration().0, None);
    assert_eq!(engine.camera.x, -100000.0);
    check(&engine);
}

#[test]
fn file_engine_root_raw_auto_settings_debug_bits_and_dormant_presets_are_preserved() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.configure_auto_rigid_body_step(
        false,
        -100.0,
        250.0,
        0,
        u32::MAX,
        -2.0,
        -3.0,
        -4.0,
        20.0,
        -5.0,
        true,
        false,
    );
    assert_eq!(engine.auto_rigid_body_step_config.velocity_iterations, 0);
    assert_eq!(
        engine
            .auto_rigid_body_step_config
            .position_correction_percent,
        -2.0
    );
    engine.set_physics_debug_line_flags(u32::MAX);
    engine.set_shooter_hit_particle_preset(255); // Registration is deliberately later.
    assert!(engine.particle_presets.is_empty());
    check(&engine);
    continuation(&mut engine);
}

#[test]
fn file_engine_root_native_policy_override_and_carried_legacy_clock_budget_are_legal() {
    let mut engine = crate::engine::legacy_test_fixture::engine();
    engine.use_data_scene();
    engine.configure_fixed_timestep(true, 0.02, 0.00001, 2048);
    engine.configure_unified_physics_defaults(config()).unwrap();
    assert_eq!(engine.fixed_timestep.config().max_steps_per_update, 2048);
    assert!(engine.fixed_timestep.config().max_frame_seconds < 0.0001);
    check(&engine);
    assert!(engine.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    assert!(!engine.default_unified_physics_fixed);
    // Native variable and zero-dt continuations use the actual existing clock.
    continuation(&mut engine);
    let mut explicit = config();
    explicit.step_seconds = 0.02;
    explicit.gravity = [1.0, -5.0, 0.0];
    explicit.solver = SolverSettings {
        velocity_iterations: 4,
        ..SolverSettings::default()
    };
    engine.configure_unified_physics(explicit).unwrap();
    assert_ne!(
        engine
            .default_unified_physics
            .as_ref()
            .unwrap()
            .step_seconds,
        engine.unified_physics_clock_step_seconds()
    );
    assert_eq!(engine.auto_rigid_body_step_config.gravity.vx, 1.0);
    assert!(!engine.default_unified_physics_fixed);
    assert!(engine.fixed_timestep_enabled);
    check(&engine);
    continuation(&mut engine);
}

#[test]
fn file_engine_root_spatial_without_default_keeps_nominal_clock_and_exact_work() {
    let mut engine = crate::engine::legacy_test_fixture::engine();
    engine.use_data_scene();
    let mut spatial = config();
    spatial.space = Space::Spatial;
    spatial.gravity = [0.0, -1.0, 2.0];
    engine.configure_unified_physics(spatial).unwrap();
    assert!(engine.default_unified_physics.is_none());
    assert_eq!(check(&engine).work, 25);
    assert_eq!(
        validate(&engine, Limits { max_work: 25 }),
        Ok(Usage { work: 25 })
    );
    assert_eq!(
        validate(&engine, Limits { max_work: 24 }),
        Err(Error::WorkLimit)
    );
    assert!(engine.configure_unified_physics_clock(false, 0.01, 0.25, 8));
    engine.set_input(false, true, false, false, false, false, false, -0.0, 0.0);
    continuation(&mut engine);
}

#[derive(serde::Serialize)]
struct RawCamera {
    follow: Option<Entity>,
    bounds: Option<[f32; 4]>,
    smooth_seconds: f32,
}
fn camera(
    engine: &mut Engine,
    follow: Option<Entity>,
    bounds: Option<[f32; 4]>,
    smooth_seconds: f32,
) {
    let raw = crate::checkpoint_codec::encode(&RawCamera {
        follow,
        bounds,
        smooth_seconds,
    })
    .unwrap();
    engine.data_scene.camera = crate::checkpoint_codec::decode(&raw).unwrap();
}

#[derive(serde::Serialize)]
struct RawClock {
    config: FixedTimestepConfig,
    accumulated_seconds: f32,
    paused: bool,
}
#[derive(serde::Deserialize)]
struct ClockRestore {
    #[serde(with = "crate::physics::fixed_timestep::checkpoint_state::State")]
    clock: FixedTimestep,
}
fn clock(engine: &mut Engine, step: f32, accumulated: f32) {
    let raw = crate::checkpoint_codec::encode(&RawClock {
        config: FixedTimestepConfig {
            step_seconds: step,
            ..engine.fixed_timestep.config()
        },
        accumulated_seconds: accumulated,
        paused: false,
    })
    .unwrap();
    engine.fixed_timestep = crate::checkpoint_codec::decode::<ClockRestore>(&raw)
        .unwrap()
        .clock;
}

#[derive(Clone, Copy, serde::Serialize)]
struct RawBinding {
    action_id: u32,
    control: u32,
    activation: u32,
}
#[derive(serde::Serialize)]
struct RawRegistry {
    #[serde(with = "crate::checkpoint_codec::array")]
    bindings: [Option<RawBinding>; 8],
}
fn invalid_registry(engine: &mut Engine) {
    let mut raw = RawRegistry {
        bindings: [None; 8],
    };
    raw.bindings[0] = Some(RawBinding {
        action_id: 0,
        control: 0,
        activation: 0,
    });
    engine.input_actions =
        crate::checkpoint_codec::decode(&crate::checkpoint_codec::encode(&raw).unwrap()).unwrap();
}

#[test]
fn file_engine_root_valid_codec_malformed_candidates_reject_readonly_without_live_publication() {
    let live = native();
    let before = encoded(&live);
    type Case = (&'static str, Error, fn(&mut Engine));
    let cases: Vec<Case> = vec![
        ("elapsed-nan", Error::Elapsed, |e| {
            e.elapsed_seconds = f64::NAN
        }),
        ("elapsed-infinity", Error::Elapsed, |e| {
            e.elapsed_seconds = f64::INFINITY
        }),
        ("input-bits", Error::Input { previous: false }, |e| {
            e.input.w = 2
        }),
        ("input-mouse", Error::Input { previous: false }, |e| {
            e.input.mouse_x = f32::NAN
        }),
        ("previous-mouse", Error::Input { previous: true }, |e| {
            e.previous_input_sample.mouse_y = f32::INFINITY
        }),
        (
            "action-zero",
            Error::InputAction { index: 0 },
            invalid_registry,
        ),
        ("camera-position", Error::Camera, |e| {
            e.camera.x = f32::INFINITY
        }),
        ("viewport-zero", Error::Camera, |e| {
            e.camera.viewport_width = 0.0
        }),
        ("viewport-nan", Error::Camera, |e| {
            e.camera.viewport_height = f32::NAN
        }),
        ("projection-zero", Error::Camera, |e| {
            e.camera.ground_y_scale = 0.0
        }),
        ("smooth-negative", Error::CameraConfiguration, |e| {
            camera(e, None, None, -1.0)
        }),
        ("bounds-order", Error::CameraConfiguration, |e| {
            camera(e, None, Some([1.0, 0.0, -1.0, 1.0]), 0.0)
        }),
        (
            "follow-future",
            Error::EntityHistory(Reference::CameraFollow),
            |e| {
                camera(
                    e,
                    Some(Entity {
                        id: 0,
                        generation: u32::MAX,
                    }),
                    None,
                    0.0,
                )
            },
        ),
        (
            "last-missing",
            Error::EntityHistory(Reference::LastDataEntity),
            |e| {
                e.data_scene_entity = Some(Entity {
                    id: u32::MAX,
                    generation: 0,
                })
            },
        ),
        (
            "last-dead-current",
            Error::EntityHistory(Reference::LastDataEntity),
            |e| {
                e.data_scene_entity = Some(Entity {
                    id: 0,
                    generation: e.world.generation_at_index(0).unwrap(),
                })
            },
        ),
        ("default-space", Error::DefaultPhysics, |e| {
            e.default_unified_physics.as_mut().unwrap().space = Space::Spatial
        }),
        ("default-capacity", Error::DefaultPhysics, |e| {
            e.default_unified_physics.as_mut().unwrap().max_bodies = 0
        }),
        ("default-solver", Error::DefaultPhysics, |e| {
            e.default_unified_physics
                .as_mut()
                .unwrap()
                .solver
                .velocity_iterations = 0
        }),
        ("default-no-runtime", Error::DefaultPhysics, |e| {
            e.unified_physics = None
        }),
        ("auto-gravity", Error::AutoStepScalars, |e| {
            e.auto_rigid_body_step_config.gravity.vx = f32::NAN
        }),
        ("auto-correction", Error::AutoStepScalars, |e| {
            e.auto_rigid_body_step_config.position_correction_slop = f32::INFINITY
        }),
        ("hd2d-bit", Error::Hd2dResult, |e| {
            e.hd2d_kinematic_flags = 1 << 31
        }),
        ("hd2d-delta", Error::Hd2dResult, |e| {
            e.hd2d_kinematic_elevation_delta = f32::NAN
        }),
        ("sun-opacity", Error::GroundSun, |e| {
            e.ground_sun.opacity = 2.0
        }),
        ("sun-zero-direction", Error::GroundSun, |e| {
            e.ground_sun.projection.direction_x = 0.0;
            e.ground_sun.projection.direction_y = 0.0;
        }),
        ("sun-scale", Error::GroundSun, |e| {
            e.ground_sun.projection.length_scale = 0.0
        }),
        ("preset-ref", Error::ParticlePresetReference, |e| {
            e.shooter_hit_particle_preset = Some(256)
        }),
        ("preset-count", Error::ParticlePresetReference, |e| {
            e.particle_presets.resize(257, None)
        }),
        ("mode-ref", Error::SceneModeReference, |e| {
            e.scene_mode = SceneMode::BuiltIn;
            e.data_scene_entity = Some(Entity {
                id: 0,
                generation: 0,
            });
        }),
        ("clock-zero", Error::ClockConfiguration, |e| {
            clock(e, 0.0, 0.0)
        }),
        ("accumulator-nan", Error::ClockAccumulator, |e| {
            clock(e, 0.01, f32::NAN)
        }),
        ("accumulator-low", Error::ClockAccumulator, |e| {
            clock(e, 0.01, -1.0)
        }),
        ("accumulator-high", Error::ClockAccumulator, |e| {
            clock(e, 0.01, 1.0)
        }),
        ("update-alpha", Error::LastFixedUpdate, |e| {
            e.last_fixed_update.alpha = f32::NAN
        }),
        ("update-negative", Error::LastFixedUpdate, |e| {
            e.last_fixed_update.consumed_seconds = -1.0
        }),
        ("update-step-relation", Error::LastFixedUpdate, |e| {
            e.last_fixed_update.consumed_seconds = 1.0
        }),
        ("native-step", Error::NativeClock, |e| clock(e, 0.02, 0.0)),
    ];
    for (name, expected, mutate) in &cases {
        let mut candidate = persistence::decode(&before).unwrap();
        mutate(&mut candidate);
        let malformed = encoded(&candidate); // Correct actual private envelope/CRC.
        let decoded = persistence::decode(&malformed).unwrap();
        assert_eq!(validate(&candidate, limits()), Err(*expected), "{name}");
        assert_eq!(
            validate(&decoded, limits()),
            Err(*expected),
            "decoded {name}"
        );
        assert_eq!(encoded(&candidate), malformed, "{name}");
        assert_eq!(encoded(&decoded), malformed, "{name}");
        assert_eq!(encoded(&live), before, "live {name}");
        // No malformed candidate reaches simulation, queries, repair or publication.
    }
    assert_eq!(cases.len(), 37);
}

#[test]
fn file_engine_root_work_exact_and_one_below_preserve_source_and_precharge() {
    for engine in [crate::engine::legacy_test_fixture::engine(), native()] {
        let before = encoded(&engine);
        let usage = check(&engine);
        assert_eq!(
            usage.work,
            if engine.unified_physics.is_some() {
                26
            } else {
                24
            }
        );
        assert_eq!(
            validate(
                &engine,
                Limits {
                    max_work: usage.work
                }
            ),
            Ok(usage)
        );
        assert_eq!(
            validate(
                &engine,
                Limits {
                    max_work: usage.work - 1
                }
            ),
            Err(Error::WorkLimit)
        );
        assert_eq!(
            validate(&engine, Limits { max_work: 0 }),
            Err(Error::WorkLimit)
        );
        assert_eq!(encoded(&engine), before);
    }
    let mut malformed = native();
    malformed.elapsed_seconds = f64::NAN;
    assert_eq!(
        validate(&malformed, Limits { max_work: 0 }),
        Err(Error::WorkLimit)
    );
    assert_eq!(
        validate(&malformed, Limits { max_work: 1 }),
        Err(Error::Elapsed)
    );
}
