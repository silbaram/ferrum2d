use super::data_scene_visuals::sprite;
use super::*;

fn scene() -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800.0, 600.0);
    engine.camera.x = 400.0;
    engine.camera.y = 300.0;
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.8, 0.7, 512));
    engine
}

fn volume(engine: &mut Engine, entity: Entity) {
    assert!(engine.configure_data_scene_visual(
        entity.id,
        entity.generation,
        0.5,
        1.0,
        0.0,
        true,
        1.0,
        1.0,
        1.0,
        1.0
    ));
    assert!(engine.configure_data_scene_ground_shadow_volume(
        entity.id,
        entity.generation,
        86.0,
        30.0,
        52.0,
        40.0,
        0.0,
        -15.0,
        0.9,
        false,
        0
    ));
}

#[test]
fn volume_shadow_sidecar_is_bounded_and_keeps_sprite_and_normal_abis_aligned() {
    let mut engine = scene();
    let actor = sprite(&mut engine, 71, 400.0, 300.0, 0);
    volume(&mut engine, actor);
    assert_eq!(engine.ground_shadow_volume_abi_version(), 1);
    assert_eq!(engine.ground_shadow_volume_vertex_stride(), 3);
    for degree in 0..=360 {
        let angle = (degree as f32).to_radians();
        assert!(engine.configure_data_scene_sun(angle.cos(), angle.sin(), 0.8, 0.7, 512));
        engine.build_render_commands();
        let vertices = &engine.frame_buffers.ground_shadow_volumes;
        assert!((6..=24).contains(&vertices.len()) && vertices.len().is_multiple_of(3));
        assert_eq!(engine.ground_shadow_volume_caster_count(), 1);
        assert_eq!(engine.frame_buffers.render_commands.len(), 1);
        assert_eq!(engine.frame_buffers.sprite_normal_materials.len(), 1);
        assert!(vertices
            .iter()
            .all(|v| v.x.is_finite() && v.y.is_finite() && (v.opacity - 0.72).abs() < 0.0001));
        for triangle in vertices.chunks_exact(3) {
            let [a, b, c] = [triangle[0], triangle[1], triangle[2]];
            assert!((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) >= -0.001);
        }
    }
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats()[1], 1);
    let pointer = engine.ground_shadow_volume_ptr();
    let before = engine.frame_buffers.ground_shadow_volumes.clone();
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_ptr(), pointer);
    assert_eq!(engine.frame_buffers.ground_shadow_volumes, before);
    assert!(!engine.configure_data_scene_ground_shadow_volume(
        actor.id,
        actor.generation,
        86.0,
        f32::NAN,
        52.0,
        40.0,
        0.0,
        -15.0,
        0.9,
        false,
        0
    ));
    engine.build_render_commands();
    assert_eq!(engine.frame_buffers.ground_shadow_volumes, before);
    engine.frame_buffers.clear_render_commands();
    assert_eq!(engine.ground_shadow_volume_len(), 0);
    assert_eq!(engine.ground_shadow_volume_caster_count(), 0);
    engine.build_render_commands();
    engine.frame_buffers.clear_render_work_buffers();
    assert_eq!(engine.ground_shadow_volume_len(), 0);
    assert!(engine.despawn_physics_entity(actor.id, actor.generation));
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_len(), 0);
}

#[test]
fn volume_and_sprite_shadows_share_budget_and_offscreen_owners_can_cast_on_screen() {
    let mut engine = scene();
    let actor = sprite(&mut engine, 71, -120.0, 300.0, 0);
    volume(&mut engine, actor);
    // A long projection reaches the view even though the owner image is culled.
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.8, 4.0, 1));
    let other = sprite(&mut engine, 72, 300.0, 300.0, 0);
    assert!(engine.configure_data_scene_ground_shadow(
        other.id,
        other.generation,
        1,
        32.0,
        64.0,
        1.0,
        false,
        0
    ));
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_caster_count(), 1);
    assert_eq!(engine.data_scene_ground_shadow_stats()[0], 1);
    assert_eq!(engine.data_scene_ground_shadow_stats()[4], 1);
    assert!(engine
        .frame_buffers
        .render_commands
        .iter()
        .all(|c| c.texture_id != 71.0));
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.8, 4.0, 0));
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_len(), 0);
    engine.use_data_scene();
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_caster_count(), 0);
}

#[test]
fn volume_configuration_survives_prototype_and_world_restore_without_stale_output() {
    let mut engine = scene();
    let actor = sprite(&mut engine, 71, 300.0, 300.0, 0);
    volume(&mut engine, actor);
    engine.build_render_commands();
    let snapshot = engine.world.snapshot();
    assert!(engine.configure_data_scene_ground_shadow(
        actor.id,
        actor.generation,
        0,
        1.0,
        1.0,
        1.0,
        false,
        0
    ));
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_len(), 0);
    engine.world.restore_snapshot(&snapshot);
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_caster_count(), 1);
    let prototype = engine.world.actor_prototype(actor).unwrap();
    let copy = engine
        .world
        .spawn_actor_prototype(
            &prototype,
            Transform2D { x: 500.0, y: 300.0 },
            None,
            usize::MAX,
        )
        .unwrap();
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_caster_count(), 2);
    assert!(engine.world.ground_shadows[copy.id as usize].is_some());
    engine.update_frame(0.0, false, false, false);
    assert_eq!(engine.ground_shadow_volume_len(), 0);
    engine.build_render_commands();
    assert_eq!(engine.ground_shadow_volume_caster_count(), 2);
}
