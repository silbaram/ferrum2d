use super::*;
use crate::physics3d::{BodyKind, CharacterConfig};
use crate::spatial_scene::SpatialMoveStatus;

fn fixture() -> (Engine, crate::entity::Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    assert!(engine
        .configure_spatial_camera(&[0., 0., 8., 10., 0., 0., 0., 20., 0.1, 100., 100., 100.,]));
    engine
        .configure_unified_physics(WorldConfig::default())
        .unwrap();
    assert!(engine.configure_spatial_terrain(
        &[-10., -10., 30., 20., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1],
    ));
    let actor = engine
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0., 1., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            [0.; 3],
        )
        .unwrap();
    engine
        .enable_unified_character(actor, CharacterConfig::default())
        .unwrap();
    assert!(engine.configure_spatial_actor(actor.id, actor.generation, 2., 0.3, 0.2));
    for _ in 0..120 {
        engine.update(1. / 60.);
    }
    assert!(engine.unified_character_state(actor).unwrap().grounded);
    assert!(engine.move_data_scene_spatial_actor_to(4., 0., 0, 2., 0.5, 0.02, true));
    let handles = [actor.id, actor.generation, actor.id, actor.generation];
    engine.query_unified_physics_body_states(&handles).unwrap();
    engine
        .query_unified_physics_character_states(&handles)
        .unwrap();
    (engine, actor)
}

#[test]
fn file_candidate_controller_and_outputs_keep_route_duplicate_rows_and_six_tick_execution() {
    let (mut source, actor) = fixture();
    let original = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    assert_eq!(candidate.engine.unified_physics_body_states.len(), 2);
    assert_eq!(candidate.engine.unified_physics_character_states.len(), 2);
    assert_eq!(persistence::encode(&candidate.engine).unwrap(), original);
    let start = source.unified_body_state(actor).unwrap().pose;
    for _ in 0..6 {
        source.update(1. / 60.);
        candidate.engine.update(1. / 60.);
        assert_eq!(
            persistence::encode(&candidate.engine).unwrap(),
            persistence::encode(&source).unwrap()
        );
        prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
    }
    assert!(source.unified_body_state(actor).unwrap().pose.position[0] > start.position[0]);
}

#[test]
fn file_candidate_controller_refuses_valid_crc_late_route_damage_after_shared_restore() {
    let (source, _) = fixture();
    let original = persistence::encode(&source).unwrap();
    let mut damaged = persistence::decode(&original).unwrap();
    damaged
        .unified_physics
        .as_mut()
        .unwrap()
        .actor_navigation
        .status = SpatialMoveStatus::Arrived;
    let file = wire(&damaged);
    let before = file.clone();
    framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
    assert!(matches!(
        prepare(&file, SDK_BUILD, &Limits::default()),
        Err(Error::Controller(_))
    ));
    assert_eq!(file, before);
    assert_eq!(persistence::encode(&source).unwrap(), original);
}

#[test]
fn file_candidate_physics_outputs_refuse_valid_crc_stored_damage_without_live_mutation() {
    let (source, _) = fixture();
    let original = persistence::encode(&source).unwrap();
    for case in 0..4 {
        let mut damaged = persistence::decode(&original).unwrap();
        match case {
            0 => damaged.physics_query_result.distance = f32::NAN,
            1 => damaged.physics_body_snapshot_floats.push(0.),
            2 => damaged.unified_physics_body_states[0].corrupt_output(0),
            _ => damaged.unified_physics_body_states[0].corrupt_output(1),
        }
        let file = wire(&damaged);
        let before = file.clone();
        framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
        assert!(
            matches!(
                prepare(&file, SDK_BUILD, &Limits::default()),
                Err(Error::PhysicsOutput(_))
            ),
            "case {case}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&source).unwrap(), original);
    }
}

#[test]
fn file_candidate_controller_outputs_share_exact_work_and_scratch_allowances() {
    let (source, _) = fixture();
    let file = wire(&source);
    let usage = prepare(&file, SDK_BUILD, &Limits::default())
        .unwrap()
        .usage();
    let limits = Limits {
        max_post_decode_work: usage.post_decode_work,
        max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
        ..Limits::default()
    };
    assert_eq!(prepare(&file, SDK_BUILD, &limits).unwrap().usage(), usage);
    assert!(prepare(
        &file,
        SDK_BUILD,
        &Limits {
            max_post_decode_work: usage.post_decode_work - 1,
            ..limits.clone()
        }
    )
    .is_err());
    assert!(prepare(
        &file,
        SDK_BUILD,
        &Limits {
            max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes - 1,
            ..limits
        }
    )
    .is_err());
}
