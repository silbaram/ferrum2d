use super::data_scene_visuals::sprite;
use super::*;
use crate::render_command::{SpriteLightMasks, SpriteSurfaceMaterial};

fn scene() -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800., 600.);
    engine.camera.x = 400.;
    engine.camera.y = 300.;
    engine
}
fn record(entity: Entity, light: u32, shadow: u32) -> [u32; 6] {
    [
        entity.id,
        entity.generation,
        2,
        0.5_f32.to_bits(),
        light,
        shadow,
    ]
}
#[test]
fn mask_stream_is_optional_sorted_and_independent_of_existing_sprite_and_material_abis() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 10);
    sprite(&mut e, 72, 350., 300., -10);
    e.build_render_commands();
    assert_eq!(e.sprite_light_mask_len(), 0);
    assert_eq!(e.frame_buffers.sprite_light_masks.capacity(), 0);
    assert!(e.configure_sprite_lighting_materials_v2(&record(a, 0, 3)));
    assert!(e.configure_data_scene_sun(1., 0., 0.5, 2., 512));
    assert!(e.configure_data_scene_ground_shadow(a.id, a.generation, 3, 32., 64., 0.8, false, -20));
    e.build_render_commands();
    assert_eq!(
        e.frame_buffers.sprite_light_masks,
        vec![
            SpriteLightMasks::default(),
            SpriteLightMasks::default(),
            SpriteLightMasks {
                light_mask: 0,
                shadow_mask: 3
            }
        ]
    );
    assert_eq!(
        e.sprite_light_mask_len(),
        e.frame_buffers.render_commands.len()
    );
    assert_eq!(e.frame_buffers.render_commands[0].texture_id, 72.);
    assert_eq!(e.frame_buffers.render_commands[2].texture_id, 71.);
    assert_eq!(e.sprite_light_mask_abi_version(), 1);
    assert_eq!(e.sprite_light_mask_size(), 8);
    assert_eq!(core::mem::offset_of!(SpriteLightMasks, shadow_mask), 4);
    assert_eq!(
        core::mem::size_of::<crate::render_command::SpriteRenderCommand>(),
        60
    );
    assert_eq!(e.sprite_lighting_material_size(), 8);
    assert_eq!(e.sprite_surface_material_size(), 40);
    assert!(e.configure_sprite_lighting_materials_v2(&record(a, 255, 255)));
    e.build_render_commands();
    assert_eq!(e.sprite_light_mask_len(), 0);
}
#[test]
fn receiver_mask_batch_rejects_bad_records_atomically_across_lighting_masks_and_surface() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    let b = sprite(&mut e, 72, 350., 300., 0);
    assert!(e.configure_sprite_lighting_materials_v2(&record(a, 1, 0)));
    assert!(e.configure_sprite_surface_materials(&[
        a.id,
        a.generation,
        16_777_215,
        16_777_215,
        16_777_215,
        1,
        1_f32.to_bits(),
        0,
        0,
        0,
        1_f32.to_bits(),
        0
    ]));
    let lighting = e.world.sprite_lighting_materials[a.id as usize];
    let masks = e.world.sprite_light_masks[a.id as usize];
    let surface = e.world.sprite_surface_materials[a.id as usize];
    for (index, value) in [
        (1, a.generation + 1),
        (2, 3),
        (2, 0),
        (3, f32::NAN.to_bits()),
        (3, 1.1_f32.to_bits()),
        (4, 256),
        (5, u32::MAX),
    ] {
        let mut bad = record(a, 2, 4);
        bad[index] = value;
        assert!(!e.configure_sprite_lighting_materials_v2(
            &[record(b, 0, 255).as_slice(), bad.as_slice()].concat()
        ));
        assert_eq!(e.world.sprite_lighting_materials[a.id as usize], lighting);
        assert_eq!(e.world.sprite_light_masks[a.id as usize], masks);
        assert_eq!(e.world.sprite_surface_materials[a.id as usize], surface);
        assert_eq!(e.world.sprite_lighting_materials[b.id as usize], None);
        assert_eq!(e.world.sprite_light_masks[b.id as usize], None);
    }
    assert!(!e.configure_sprite_lighting_materials_v2(&[a.id]));
    assert!(!e.configure_sprite_lighting_materials_v2(&[record(a, 1, 1), record(a, 2, 2)].concat()));
    assert!(!e.configure_sprite_lighting_materials_v2(&vec![0; 6 * 65_537]));
    // A zero cutoff must not let an unlit receiver retain custom channel masks.
    assert!(!e.configure_sprite_lighting_materials_v2(&[a.id, a.generation, 0, 0, 0, 255]));
    assert_eq!(e.world.sprite_light_masks[a.id as usize], masks);
    assert_eq!(e.world.sprite_surface_materials[a.id as usize], surface);
    let nonsprite = e.world.spawn_entity();
    assert!(!e.configure_sprite_lighting_materials_v2(&record(nonsprite, 1, 1)));
    // Existing setters mean default mask reception, and retain Surface while still lit.
    assert!(e.configure_sprite_lighting_materials(&[a.id, a.generation, 1, 0]));
    assert_eq!(e.world.sprite_light_masks[a.id as usize], None);
    assert_eq!(e.world.sprite_surface_materials[a.id as usize], surface);
    assert!(e.configure_sprite_lighting_materials_v2(&record(a, 1, 0)));
    assert!(e.configure_sprite_lighting_materials_v2(&[a.id, a.generation, 0, 0, 255, 255]));
    assert_eq!(e.world.sprite_light_masks[a.id as usize], None);
    assert_eq!(e.world.sprite_surface_materials[a.id as usize], None);
    assert_ne!(surface, Some(SpriteSurfaceMaterial::default()));
}
#[test]
fn masks_survive_snapshot_and_prototype_and_clear_on_despawn_reuse_and_nonrendered_frames() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    assert!(e.configure_sprite_lighting_materials_v2(&record(a, 0, 0)));
    let before = e.world.sprite_light_masks[a.id as usize];
    let snapshot = e.world.snapshot();
    let prototype = e.world.actor_prototype(a).unwrap();
    let copy = e
        .world
        .spawn_actor_prototype(&prototype, Transform2D { x: 400., y: 300. }, None, 100)
        .unwrap();
    assert_eq!(e.world.sprite_light_masks[copy.id as usize], before);
    e.world.despawn(a);
    let reused = e.world.spawn_entity();
    assert_eq!(reused.id, a.id);
    assert_eq!(e.world.sprite_light_masks[reused.id as usize], None);
    assert!(!e.configure_sprite_lighting_materials_v2(&record(a, 1, 1)));
    e.world.restore_snapshot(&snapshot);
    assert_eq!(e.world.sprite_light_masks[a.id as usize], before);
    e.build_render_commands();
    let sorted = e.frame_buffers.sprite_light_masks.clone();
    e.frame_buffers.clear_scene_output();
    assert_eq!(e.sprite_light_mask_len(), 0);
    e.build_render_commands();
    assert_eq!(e.frame_buffers.sprite_light_masks, sorted);
}
