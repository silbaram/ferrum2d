use super::*;
use crate::components::Transform2D;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};

#[test]
fn gameplay_positions_use_native_simulation_pose_preserve_order_and_stale_rows() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2., 3., 4.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [100., 200., 300.],
        )
        .unwrap();
    // A projected ECS transform must not replace the native simulation position.
    assert_ne!(e.world.transform(a).unwrap(), Transform2D { x: 2., y: 3. });
    let b = e.world.spawn_entity();
    e.world.set_transform(b, Transform2D { x: -0., y: -7. });
    let dead = e.world.spawn_entity();
    e.world.despawn(dead);
    let replacement = e.world.spawn_entity();
    e.world
        .set_transform(replacement, Transform2D { x: 88., y: 99. });
    let before = e.unified_body_state(a).unwrap();
    let time = e.time();
    let output = e
        .query_gameplay_positions(&[
            a.id,
            a.generation,
            dead.id,
            dead.generation,
            b.id,
            b.generation,
            a.id,
            a.generation,
        ])
        .unwrap();
    assert_eq!(
        output,
        vec![1., 2., 3., 4., 0., 0., 0., 0., 1., -0., -7., 0., 1., 2., 3., 4.]
    );
    assert_eq!(output[9].to_bits(), (-0.0_f64).to_bits());
    assert_eq!(e.unified_body_state(a).unwrap(), before);
    assert_eq!(e.time(), time);
    assert_eq!(e.unified_physics_error(), None);
    assert!(e.query_gameplay_positions(&[a.id]).is_err());
    assert!(e
        .query_gameplay_positions(&vec![0; (MAX_POSITIONS + 1) * 2])
        .is_err());
    assert!(e.query_gameplay_positions(&[]).unwrap().is_empty());
}

#[test]
fn shooter_progress_reads_native_wave_state_and_rewinds_with_checkpoint() {
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
        length_unit: 100.,
        ..Default::default()
    })
    .unwrap();
    e.clear_shooter_waves();
    e.set_shooter_wave(0, 60., 0.1, 100, 1., 0, 0, 1., 1);
    e.input.enter = 1;
    e.update(0.1);
    e.input.enter = 0;
    e.update(0.1);
    let saved = e.built_in_shooter_progress();
    assert_eq!(saved[0], 0.);
    assert!(saved[1] > 0.);
    assert!(saved[2] > 0.);
    let player = e
        .entity_from_handle(
            e.built_in_shooter_player_entity_id(),
            e.built_in_shooter_player_entity_generation(),
        )
        .unwrap();
    assert!(e.world.upsert_action_binding(
        player,
        crate::components::gameplay::ActionBinding::projectile(1, 0.5, 720., 12., 3.)
    ));
    let actions = e.built_in_shooter_player_actions();
    assert_eq!(&actions[..6], &[1., 0.5, 0., 720., 12., 3.]);
    let checkpoint = e.runtime_checkpoint().unwrap();
    let time = e.time();
    assert_eq!(e.built_in_shooter_progress(), saved);
    assert_eq!(e.time(), time);
    assert_eq!(e.unified_physics_error(), None);
    e.update(0.1);
    assert!(e.built_in_shooter_progress()[1] > saved[1]);
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    assert_eq!(e.built_in_shooter_progress(), saved);
    e.activate_data_scene();
    assert!(e.built_in_shooter_progress().is_empty());
    assert!(e.built_in_shooter_player_actions().is_empty());
}
