use super::data_scene_visuals::sprite;
use super::*;

fn scene() -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800., 600.);
    engine.camera.x = 400.;
    engine.camera.y = 300.;
    engine
}
#[test]
fn lighting_sidecar_is_optional_and_follows_sorted_commands_and_shadow_gaps() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 10);
    let b = sprite(&mut e, 71, 350., 300., -10);
    e.build_render_commands();
    assert_eq!(e.sprite_lighting_material_len(), 0);
    assert_eq!(e.frame_buffers.sprite_lighting_materials.capacity(), 0);
    assert!(e.configure_sprite_lighting_materials(&[
        a.id,
        a.generation,
        2,
        0.502_f32.to_bits(),
        b.id,
        b.generation,
        1,
        0
    ]));
    assert!(e.configure_data_scene_sun(1., 0., 0.5, 2., 512));
    assert!(e.configure_data_scene_ground_shadow(a.id, a.generation, 3, 32., 64., 0.8, false, -20));
    e.build_render_commands();
    assert_eq!(
        e.frame_buffers
            .sprite_lighting_materials
            .iter()
            .map(|m| m.mode)
            .collect::<Vec<_>>(),
        vec![1, 0, 2]
    );
    assert_eq!(
        e.frame_buffers.sprite_lighting_materials[2].alpha_cutoff,
        0.502
    );
    assert_eq!(e.sprite_lighting_material_size(), 8);
    assert_eq!(e.sprite_lighting_material_abi_version(), 1);
    assert!(e.configure_sprite_lighting_materials(&[
        a.id,
        a.generation,
        0,
        0,
        b.id,
        b.generation,
        0,
        0
    ]));
    e.build_render_commands();
    assert_eq!(e.sprite_lighting_material_len(), 0);
}
#[test]
fn lighting_binding_rejects_malformed_batches_atomically_and_preserves_reuse_snapshot_clone() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    let b = sprite(&mut e, 72, 350., 300., 0);
    assert!(e.configure_sprite_lighting_materials(&[a.id, a.generation, 2, 0.5_f32.to_bits()]));
    let before = e.world.sprite_lighting_materials[a.id as usize];
    for invalid in [
        vec![b.id, b.generation, 1, 0, a.id, a.generation + 1, 1, 0],
        vec![a.id, a.generation, 3, 0],
        vec![a.id, a.generation, 1, 0.5_f32.to_bits()],
        vec![a.id, a.generation, 2, f32::NAN.to_bits()],
        vec![a.id, a.generation, 2, 1.1_f32.to_bits()],
        vec![a.id, a.generation, 2, 0, a.id, a.generation, 1, 0],
        vec![a.id],
    ] {
        assert!(!e.configure_sprite_lighting_materials(&invalid));
        assert_eq!(e.world.sprite_lighting_materials[a.id as usize], before);
        assert_eq!(e.world.sprite_lighting_materials[b.id as usize], None);
    }
    let snapshot = e.world.snapshot();
    let prototype = e.world.actor_prototype(a).unwrap();
    let clone = e
        .world
        .spawn_actor_prototype(&prototype, Transform2D { x: 400., y: 300. }, None, 100)
        .unwrap();
    assert_eq!(e.world.sprite_lighting_materials[clone.id as usize], before);
    e.world.despawn(a);
    let reused = e.world.spawn_entity();
    assert_eq!(reused.id, a.id);
    assert_eq!(e.world.sprite_lighting_materials[reused.id as usize], None);
    e.world.restore_snapshot(&snapshot);
    assert_eq!(e.world.sprite_lighting_materials[a.id as usize], before);
}
