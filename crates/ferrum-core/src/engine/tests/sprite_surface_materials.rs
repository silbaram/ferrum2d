use super::data_scene_visuals::sprite;
use super::*;
use crate::render_command::{SpriteSurfaceMaterial, SPRITE_SURFACE_TEXTURE_NONE};

fn scene() -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800., 600.);
    engine.camera.x = 400.;
    engine.camera.y = 300.;
    engine
}
fn record(id: u32, generation: u32) -> [u32; 12] {
    [
        id,
        generation,
        10,
        11,
        12,
        1,
        4_f32.to_bits(),
        2_f32.to_bits(),
        1_f32.to_bits(),
        0.5_f32.to_bits(),
        0.3_f32.to_bits(),
        0,
    ]
}
fn detach(id: u32, generation: u32) -> [u32; 12] {
    [
        id,
        generation,
        SPRITE_SURFACE_TEXTURE_NONE,
        SPRITE_SURFACE_TEXTURE_NONE,
        SPRITE_SURFACE_TEXTURE_NONE,
        0,
        0,
        0,
        0,
        0,
        1_f32.to_bits(),
        0,
    ]
}
#[test]
fn surface_sidecar_is_optional_and_stays_aligned_through_native_sort_and_shadow_gaps() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 10);
    let b = sprite(&mut e, 72, 350., 300., -10);
    e.build_render_commands();
    assert_eq!(e.sprite_surface_material_len(), 0);
    assert_eq!(e.frame_buffers.sprite_surface_materials.capacity(), 0);
    assert!(e.configure_sprite_lighting_materials(&[a.id, a.generation, 2, 0.5_f32.to_bits()]));
    assert!(e.configure_sprite_surface_materials(&record(a.id, a.generation)));
    assert!(e.configure_data_scene_sun(1., 0., 0.5, 2., 512));
    assert!(e.configure_data_scene_ground_shadow(a.id, a.generation, 3, 32., 64., 0.8, false, -20));
    e.build_render_commands();
    assert_eq!(
        e.frame_buffers
            .sprite_surface_materials
            .iter()
            .map(|m| m.flags)
            .collect::<Vec<_>>(),
        vec![0, 0, 1]
    );
    assert_eq!(
        e.sprite_surface_material_len(),
        e.frame_buffers.render_commands.len()
    );
    let value = e.frame_buffers.sprite_surface_materials[2];
    assert_eq!(value.emission, [4., 2., 1.]);
    assert_eq!(value.specular, 0.5);
    assert_eq!(value.roughness, 0.3);
    assert_eq!(e.frame_buffers.render_commands[0].texture_id, 72.);
    assert_eq!(e.frame_buffers.render_commands[2].texture_id, 71.);
    assert_eq!(e.sprite_surface_material_abi_version(), 1);
    assert_eq!(e.sprite_surface_material_size(), 40);
    assert_eq!(e.sprite_lighting_material_abi_version(), 1);
    assert_eq!(e.sprite_lighting_material_size(), 8);
    assert_eq!(
        core::mem::size_of::<crate::render_command::SpriteRenderCommand>(),
        60
    );
    assert!(e.configure_sprite_surface_materials(&detach(a.id, a.generation)));
    e.build_render_commands();
    assert_eq!(e.sprite_surface_material_len(), 0);
    assert!(e.world.sprite_surface_materials[b.id as usize].is_none());
}
#[test]
fn surface_batches_reject_stale_handles_unknown_flags_and_invalid_values_atomically() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    let b = sprite(&mut e, 72, 350., 300., 0);
    assert!(e.configure_sprite_lighting_materials(&[
        a.id,
        a.generation,
        1,
        0,
        b.id,
        b.generation,
        1,
        0
    ]));
    assert!(e.configure_sprite_surface_materials(&record(a.id, a.generation)));
    let before = e.world.sprite_surface_materials[a.id as usize];
    for (index, value) in [
        (1, a.generation + 1),
        (2, SPRITE_SURFACE_TEXTURE_NONE + 1),
        (3, u32::MAX),
        (4, u32::MAX),
        (5, 2),
        (5, 0),
        (6, f32::NAN.to_bits()),
        (7, 65_f32.to_bits()),
        (8, (-1_f32).to_bits()),
        (9, 1.1_f32.to_bits()),
        (10, f32::INFINITY.to_bits()),
        (10, (-0.1_f32).to_bits()),
        (11, 1),
    ] {
        let mut bad = record(a.id, a.generation);
        bad[index] = value;
        let batch = [record(b.id, b.generation).as_slice(), bad.as_slice()].concat();
        assert!(!e.configure_sprite_surface_materials(&batch));
        assert_eq!(e.world.sprite_surface_materials[a.id as usize], before);
        assert_eq!(e.world.sprite_surface_materials[b.id as usize], None);
    }
    assert!(!e.configure_sprite_surface_materials(&[a.id]));
    assert!(!e.configure_sprite_surface_materials(
        &[record(a.id, a.generation), record(a.id, a.generation)].concat()
    ));
    assert!(e.configure_sprite_lighting_materials(&[b.id, b.generation, 0, 0]));
    assert!(!e.configure_sprite_surface_materials(&record(b.id, b.generation)));
    assert_eq!(e.world.sprite_surface_materials[a.id as usize], before);
}
#[test]
fn surface_lifetime_survives_world_snapshot_and_prototype_but_clears_on_despawn_and_unlit() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    assert!(e.configure_sprite_lighting_materials(&[a.id, a.generation, 1, 0]));
    assert!(e.configure_sprite_surface_materials(&record(a.id, a.generation)));
    let before = e.world.sprite_surface_materials[a.id as usize];
    let snapshot = e.world.snapshot();
    let prototype = e.world.actor_prototype(a).unwrap();
    let copy = e
        .world
        .spawn_actor_prototype(&prototype, Transform2D { x: 400., y: 300. }, None, 100)
        .unwrap();
    assert_eq!(e.world.sprite_surface_materials[copy.id as usize], before);
    // Failed receiver changes must preserve both metadata records.
    assert!(!e.configure_sprite_lighting_materials(&[
        a.id,
        a.generation,
        0,
        0,
        copy.id,
        copy.generation + 1,
        0,
        0
    ]));
    assert_eq!(e.world.sprite_surface_materials[a.id as usize], before);
    assert!(e.configure_sprite_lighting_materials(&[a.id, a.generation, 0, 0]));
    assert_eq!(e.world.sprite_surface_materials[a.id as usize], None);
    e.world.restore_snapshot(&snapshot);
    assert_eq!(e.world.sprite_surface_materials[a.id as usize], before);
    e.world.despawn(a);
    let reused = e.world.spawn_entity();
    assert_eq!(reused.id, a.id);
    assert_eq!(e.world.sprite_surface_materials[reused.id as usize], None);
    assert!(!e.configure_sprite_surface_materials(&record(a.id, a.generation)));
    e.world.restore_snapshot(&snapshot);
    e.build_render_commands();
    let prior = e.frame_buffers.sprite_surface_materials.clone();
    e.frame_buffers.clear_scene_output();
    assert_eq!(e.sprite_surface_material_len(), 0);
    e.build_render_commands();
    assert_eq!(e.frame_buffers.sprite_surface_materials, prior);
    assert_ne!(before, Some(SpriteSurfaceMaterial::default()));
}
