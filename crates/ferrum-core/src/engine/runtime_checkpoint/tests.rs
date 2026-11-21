use super::*;
use crate::entity::Entity;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};

#[derive(Debug, PartialEq)]
pub(in crate::engine) struct Signature {
    world: crate::world::WorldSnapshot,
    native: Option<Vec<u8>>,
    time: f64,
    clock: crate::physics::FixedTimestep,
    navigation: Vec<u32>,
    scheduler: Vec<u32>,
    crowd: Vec<u32>,
    observations: String,
    render: Vec<(
        Option<crate::components::Transform2D>,
        Option<crate::components::HeightSpan>,
        crate::components::Rotation2D,
    )>,
}
pub(in crate::engine) fn signature(e: &Engine) -> Signature {
    Signature {
        world: e.world.snapshot(),
        native: e.unified_physics.as_ref().map(|r| r.checkpoint_bytes()),
        time: e.elapsed_seconds,
        clock: e.fixed_timestep,
        navigation: e.data_scene_combat_navigation_stats(),
        scheduler: e.data_scene_combat_navigation_scheduler_stats(),
        crowd: e.data_scene_combat_crowd_stats(),
        observations: format!(
            "{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
            e.camera,
            e.particles,
            e.input,
            e.previous_input_sample,
            e.fixed_timestep_input_latch,
            e.frame_buffers.render_commands,
            e.frame_buffers.audio_events,
            e.frame_buffers.effect_events,
            e.frame_buffers.gameplay_events,
            e.last_fixed_update,
            e.rigid_body_step_stats
        ),
        render: (0..e.world.entity_capacity())
            .map(|i| {
                (
                    e.world.render_transform_at_index(i),
                    e.world.render_height_span_at(i),
                    e.world.render_rotation_at_index(i),
                )
            })
            .collect(),
    }
}
fn setup(space: Space) -> (Engine, Entity, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [2., 3., 0.],
        )
        .unwrap();
    let k = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [10., 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
            [0.; 3],
        )
        .unwrap();
    (e, a, k)
}
#[test]
fn runtime_checkpoint_replays_pending_force_target_clock_and_entity_generations_in_both_spaces() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, a, k) = setup(space);
        e.update(0.013);
        let body_before = e.unified_body_state(a).unwrap();
        // Pending commands are saved before the next native fixed tick.
        e.queued_checkpoint_commands_test(a, k);
        e.set_unified_body_velocity(k, [1., 0., 0.], [0.; 3])
            .unwrap();
        let before = signature(&e);
        let checkpoint = e.runtime_checkpoint().unwrap();
        assert_eq!(signature(&e), before);
        let trace: Vec<_> = (0..60)
            .map(|_| {
                e.update(0.007);
                signature(&e)
            })
            .collect();
        let future = e.world.spawn_entity();
        assert_eq!(e.runtime_checkpoint_revision(), 0);
        e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
        assert_eq!(signature(&e), before);
        assert_eq!(e.unified_body_state(a).unwrap(), body_before);
        assert!(!e.world.is_current_entity(future));
        assert_eq!(e.runtime_checkpoint_revision(), 1);
        for expected in trace {
            e.update(0.007);
            assert_eq!(signature(&e), expected);
        }
    }
}
#[test]
fn runtime_checkpoint_rejects_foreign_transaction_and_revision_overflow_without_mutation() {
    let (mut e, _, _) = setup(Space::PlanarXy);
    let checkpoint = e.runtime_checkpoint().unwrap();
    let mut other = crate::engine::legacy_test_fixture::engine();
    let before = signature(&other);
    assert_eq!(
        other.restore_runtime_checkpoint_native(&checkpoint),
        Err(RuntimeCheckpointError::WrongEngine)
    );
    assert_eq!(signature(&other), before);
    assert!(other.begin_physics_restore_transaction());
    assert_eq!(
        other.runtime_checkpoint().unwrap_err(),
        RuntimeCheckpointError::RestoreInProgress
    );
    assert_eq!(
        other.restore_runtime_checkpoint_native(&checkpoint),
        Err(RuntimeCheckpointError::RestoreInProgress)
    );
    assert!(other.end_physics_restore_transaction(false));
    e.checkpoint_revision = u32::MAX;
    let before = signature(&e);
    assert_eq!(
        e.restore_runtime_checkpoint_native(&checkpoint),
        Err(RuntimeCheckpointError::RevisionExhausted)
    );
    assert_eq!(signature(&e), before);
}
#[test]
fn runtime_checkpoint_is_reusable_and_replays_builtin_gameplay_and_frame_outputs() {
    let mut e = Engine::new();
    e.set_input(false, false, false, false, false, true, false, 100., 100.);
    e.update(0.016);
    e.set_input(false, false, false, true, true, false, false, 100., 100.);
    let packet = e.runtime_checkpoint().unwrap();
    let before = signature(&e);
    let trace: Vec<_> = (0..30)
        .map(|_| {
            e.update(0.016);
            signature(&e)
        })
        .collect();
    for revision in 1..=2 {
        e.restore_runtime_checkpoint_native(&packet).unwrap();
        assert_eq!(signature(&e), before);
        assert_eq!(e.runtime_checkpoint_revision(), revision);
        for expected in &trace {
            e.update(0.016);
            assert_eq!(&signature(&e), expected);
        }
    }
}

#[test]
fn engine_serialization_bad_complete_runtime_token_rejects_atomically() {
    let (mut engine, _, _) = setup(Space::Spatial);
    engine.update(0.021);
    let checkpoint = engine.runtime_checkpoint().unwrap();
    let before = crate::engine::persistence::encode(&engine).unwrap();
    let mut bad = EngineRuntimeCheckpoint {
        owner: Arc::clone(&checkpoint.owner),
        captured_revision: checkpoint.captured_revision,
        bytes: checkpoint.bytes.clone(),
    };
    bad.bytes[32] ^= 1;
    assert_eq!(
        engine.restore_runtime_checkpoint_native(&bad),
        Err(RuntimeCheckpointError::Corrupt)
    );
    assert_eq!(crate::engine::persistence::encode(&engine).unwrap(), before);
    assert_eq!(engine.runtime_checkpoint_revision(), 0);
    engine
        .restore_runtime_checkpoint_native(&checkpoint)
        .unwrap();
    assert_eq!(engine.runtime_checkpoint_revision(), 1);
}

#[test]
fn decode_admission_rejects_complete_candidate_before_commit_and_preserves_revision() {
    let (mut engine, _, _) = setup(Space::Spatial);
    engine.update(0.021);
    let checkpoint = engine.runtime_checkpoint().unwrap();
    let before = crate::engine::persistence::encode(&engine).unwrap();
    let limits = crate::checkpoint_decode::Limits {
        allocation_work: 32 * 1024 * 1024,
        ..Default::default()
    };
    assert_eq!(
        engine.restore_runtime_checkpoint_with_limits(&checkpoint, limits),
        Err(RuntimeCheckpointError::Capacity)
    );
    assert_eq!(crate::engine::persistence::encode(&engine).unwrap(), before);
    assert_eq!(engine.runtime_checkpoint_revision(), 0);
    engine
        .restore_runtime_checkpoint_native(&checkpoint)
        .unwrap();
    assert_eq!(engine.runtime_checkpoint_revision(), 1);
}
