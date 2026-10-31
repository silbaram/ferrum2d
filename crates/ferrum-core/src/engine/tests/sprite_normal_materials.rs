use super::data_scene_visuals::sprite;
use super::*;
use crate::render_command::{SpriteNormalMaterial, SPRITE_NORMAL_NONE};

fn scene() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(800., 600.);
    e.camera.x = 400.;
    e.camera.y = 300.;
    e
}
#[test]
fn sorted_materials_follow_entities_not_shared_color_textures_or_shadow_commands() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 10);
    let b = sprite(&mut e, 71, 350., 300., -10);
    assert!(e.configure_sprite_normal_materials(&[
        a.id,
        a.generation,
        91,
        0,
        b.id,
        b.generation,
        92,
        0
    ]));
    assert!(e.configure_data_scene_sun(1., 0., 0.5, 2., 512));
    assert!(e.configure_data_scene_ground_shadow(a.id, a.generation, 3, 32., 64., 0.8, false, -20));
    e.build_render_commands();
    assert_eq!(e.frame_buffers.render_commands.len(), 3);
    let materials: Vec<_> = e
        .frame_buffers
        .sprite_normal_materials
        .iter()
        .map(|v| v.normal_texture)
        .collect();
    assert_eq!(materials, vec![92, SPRITE_NORMAL_NONE, 91]);
    assert_eq!(e.sprite_normal_material_size(), 8);
    assert_eq!(e.sprite_normal_material_abi_version(), 1);
    e.frame_buffers.clear_render_commands();
    assert_eq!(e.sprite_normal_material_len(), 0);
}
#[test]
fn bulk_material_binding_rejects_the_entire_transaction_and_detaches_explicitly() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    let b = sprite(&mut e, 72, 350., 300., 0);
    assert!(e.configure_sprite_normal_materials(&[a.id, a.generation, 91, 0]));
    for invalid in [
        vec![b.id, b.generation, 92, 0, a.id, a.generation + 1, 93, 0],
        vec![a.id, a.generation, 92, 1],
        vec![a.id, a.generation, 92, 0, a.id, a.generation, 93, 0],
        vec![a.id, a.generation, SPRITE_NORMAL_NONE + 1, 0],
        vec![a.id],
    ] {
        assert!(!e.configure_sprite_normal_materials(&invalid));
        assert_eq!(
            e.world.sprite_normal_materials[a.id as usize],
            Some(SpriteNormalMaterial {
                normal_texture: 91,
                flags: 0
            })
        );
        assert_eq!(e.world.sprite_normal_materials[b.id as usize], None);
    }
    assert!(e.configure_sprite_normal_materials(&[a.id, a.generation, SPRITE_NORMAL_NONE, 0]));
    assert_eq!(e.world.sprite_normal_materials[a.id as usize], None);
}
#[test]
fn normal_materials_survive_snapshot_and_native_actor_clone_but_not_entity_reuse() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    assert!(e.configure_sprite_normal_materials(&[a.id, a.generation, 91, 0]));
    let snapshot = e.world.snapshot();
    let prototype = e.world.actor_prototype(a).unwrap();
    let clone = e
        .world
        .spawn_actor_prototype(&prototype, Transform2D { x: 400., y: 300. }, None, 100)
        .unwrap();
    assert_eq!(
        e.world.sprite_normal_materials[clone.id as usize],
        e.world.sprite_normal_materials[a.id as usize]
    );
    e.world.despawn(a);
    let recycled = e.world.spawn_entity();
    assert_eq!(recycled.id, a.id);
    assert_eq!(e.world.sprite_normal_materials[recycled.id as usize], None);
    e.world.restore_snapshot(&snapshot);
    assert_eq!(
        e.world.sprite_normal_materials[a.id as usize],
        Some(SpriteNormalMaterial {
            normal_texture: 91,
            flags: 0
        })
    );
}
