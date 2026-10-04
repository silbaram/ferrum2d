use super::data_scene_visuals::sprite;
use super::*;

fn clips(engine: &mut Engine, entity: Entity) {
    assert!(engine.configure_data_scene_sprite_clips(
        entity.id,
        entity.generation,
        &[0.0, 1.0, 8.0, 1.0, 1.0, 2.0, 8.0, 1.0, 2.0, 2.0, 8.0, 0.0],
        &[
            0.0, 0.0, 0.25, 1.0, 0.25, 0.0, 0.5, 1.0, 0.5, 0.0, 0.75, 1.0, 0.25, 0.0, 0.5, 1.0,
            0.5, 0.0, 0.75, 1.0
        ],
        0
    ));
}

#[test]
fn shared_atlas_playback_is_independent_and_preserves_native_body() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let a = sprite(&mut engine, 71, 300.0, 300.0, 0);
    let b = sprite(&mut engine, 71, 340.0, 300.0, 0);
    assert!(engine.configure_data_scene_body(a.id, a.generation, 1, false, 0, 0.0, 1.0));
    clips(&mut engine, a);
    clips(&mut engine, b);
    let before = engine.world.rigid_bodies[a.id as usize];
    assert!(engine.update_data_scene_sprite_animations(&[
        a.id,
        a.generation,
        1 | 32 | 4,
        1,
        0,
        1,
        0,
        0
    ]));
    engine.update(0.125);
    let sa = engine.world.sprite_at_index(a.id as usize).unwrap();
    let sb = engine.world.sprite_at_index(b.id as usize).unwrap();
    assert_eq!((sa.texture_id, sb.texture_id), (71, 71));
    assert_eq!((sa.u0, sa.u1), (0.75, 0.5));
    assert_eq!((sb.u0, sb.u1), (0.0, 0.25));
    assert_eq!(engine.world.rigid_bodies[a.id as usize], before);
    assert!(engine.world.is_current_entity(a));
    assert_eq!(
        engine.world.transform(a),
        Some(Transform2D { x: 300.0, y: 300.0 })
    );
}

#[test]
fn playback_pause_finish_seek_and_preserve_seconds_have_explicit_behavior() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let e = sprite(&mut engine, 71, 300.0, 300.0, 0);
    clips(&mut engine, e);
    assert!(engine.update_data_scene_sprite_animations(&[e.id, e.generation, 33, 1, 0, 0, 0, 0]));
    engine.update(0.125);
    assert!(engine.pause_data_scene());
    engine.update(1.0);
    assert_eq!(
        engine.data_scene_sprite_animation_state(e.id, e.generation)[2],
        0.125
    );
    assert!(engine.resume_data_scene());
    assert!(engine.update_data_scene_sprite_animations(&[
        e.id,
        e.generation,
        1 | 16,
        2,
        0,
        0,
        0,
        1
    ]));
    engine.update(0.25);
    assert_eq!(
        engine.data_scene_sprite_animation_state(e.id, e.generation)[2],
        0.125
    );
    assert!(engine.update_data_scene_sprite_animations(&[e.id, e.generation, 16, 0, 0, 0, 0, 0]));
    engine.update(0.5);
    let state = engine.data_scene_sprite_animation_state(e.id, e.generation);
    assert_eq!((state[1], state[4]), (1.0, 1.0));
    assert!(engine.update_data_scene_sprite_animations(&[e.id, e.generation, 2, 0, 0, 0, 0, 0]));
    assert_eq!(
        engine.data_scene_sprite_animation_state(e.id, e.generation)[4],
        0.0
    );
}

#[test]
fn invalid_batches_and_configs_are_atomic_and_reset_invalidates_handles() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let a = sprite(&mut engine, 71, 300.0, 300.0, 0);
    let b = sprite(&mut engine, 71, 340.0, 300.0, 0);
    clips(&mut engine, a);
    clips(&mut engine, b);
    let before = engine.data_scene_sprite_animation_state(a.id, a.generation);
    for invalid in [
        vec![b.id, b.generation, 1, 99, 0, 0, 0, 0],
        vec![b.id, b.generation, 2, 0, 99, 0, 0, 0],
        vec![b.id, b.generation + 1, 0, 0, 0, 0, 0, 0],
        vec![a.id, a.generation, 0, 0, 0, 0, 0, 0],
    ] {
        let mut updates = vec![a.id, a.generation, 33, 1, 0, 0, 0, 0];
        updates.extend(invalid);
        assert!(!engine.update_data_scene_sprite_animations(&updates));
        assert_eq!(
            engine.data_scene_sprite_animation_state(a.id, a.generation),
            before
        );
    }
    assert!(!engine.configure_data_scene_sprite_clips(
        a.id,
        a.generation,
        &[0.0, 1.0, 8.0, 1.0],
        &[0.0, 0.0, 0.0, 1.0],
        0
    ));
    assert_eq!(
        engine.data_scene_sprite_animation_state(a.id, a.generation),
        before
    );
    engine.use_data_scene();
    assert!(!engine.update_data_scene_sprite_animations(&[a.id, a.generation, 0, 0, 0, 0, 0, 0]));
    assert!(engine
        .data_scene_sprite_animation_state(a.id, a.generation)
        .is_empty());
}
