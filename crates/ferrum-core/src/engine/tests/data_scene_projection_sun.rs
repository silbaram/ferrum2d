use super::data_scene_visuals::sprite;
use super::*;

#[test]
fn projected_world_text_sorts_by_its_upright_block_bottom() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800.0, 600.0);
    engine.camera.x = 400.0;
    engine.camera.y = 300.0;
    let actor = sprite(&mut engine, 71, 300.0, 312.0, 0);
    assert!(engine.configure_data_scene_visual(
        actor.id,
        actor.generation,
        0.5,
        1.0,
        0.0,
        true,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
    assert!(engine.register_bitmap_font(
        1,
        99,
        10.0,
        u32::MAX,
        &['A' as u32],
        &[0.0, 0.0, 1.0, 1.0, 8.0, 10.0, 0.0, 0.0, 8.0],
        &[],
        &[],
    ));
    assert!(engine.set_world_text(
        1,
        1,
        "A",
        300.0,
        300.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
        0.0,
        0,
        crate::components::DEFAULT_SPRITE_RENDER_LAYER,
        0,
        0.0,
        u32::MAX,
        0,
    ));
    let layout_revision = engine.bitmap_text.layout_revision();
    for (scale, expected) in [(1.0, [99.0, 71.0]), (0.72, [71.0, 99.0])] {
        assert!(engine.configure_data_scene_projection(scale));
        engine.build_render_commands();
        let commands = &engine.frame_buffers.render_commands;
        assert_eq!([commands[0].texture_id, commands[1].texture_id], expected);
        assert!(commands[0].y + commands[0].height < commands[1].y + commands[1].height);
        assert_eq!(engine.bitmap_text.layout_revision(), layout_revision);
    }
}

#[test]
fn projected_depth_sort_uses_the_upright_pivot_foot_in_ground_units() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800.0, 600.0);
    engine.camera.x = 400.0;
    engine.camera.y = 300.0;
    let centered = sprite(&mut engine, 71, 300.0, 300.0, 0);
    let anchored = sprite(&mut engine, 72, 300.0, 340.0, 0);
    for (entity, origin_y) in [(centered, 0.5), (anchored, 1.0)] {
        assert!(engine.configure_data_scene_visual(
            entity.id,
            entity.generation,
            0.5,
            origin_y,
            0.0,
            true,
            1.0,
            1.0,
            1.0,
            1.0,
        ));
    }
    let before = engine.world.snapshot();
    for (scale, expected) in [
        (1.0, [71.0, 72.0]),
        (0.72, [72.0, 71.0]),
        (0.5, [72.0, 71.0]),
    ] {
        assert!(engine.configure_data_scene_projection(scale));
        engine.build_render_commands();
        let commands = &engine.frame_buffers.render_commands;
        assert_eq!([commands[0].texture_id, commands[1].texture_id], expected);
        assert!(commands[0].y + commands[0].height < commands[1].y + commands[1].height);
        assert_eq!(engine.world.snapshot(), before);
    }
    // Ground images compress their pivot offset along with their height.
    assert!(engine.configure_data_scene_sprite_projection(centered.id, centered.generation, true));
    engine.build_render_commands();
    assert_eq!(engine.frame_buffers.render_commands[0].texture_id, 71.0);
}

#[test]
fn ground_projection_preserves_physics_and_upright_feet_and_camera_bounds() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 71, 300.0, 300.0, 0);
    let ground = sprite(&mut engine, 72, 300.0, 300.0, -10);
    assert!(engine.configure_data_scene_body(actor.id, actor.generation, 1, false, 0, 0.0, 1.0));
    assert!(engine.configure_data_scene_visual(
        actor.id,
        actor.generation,
        0.5,
        1.0,
        0.0,
        true,
        1.0,
        1.0,
        1.0,
        1.0
    ));
    assert!(engine.configure_data_scene_sprite_projection(ground.id, ground.generation, true));
    engine.set_viewport_size(1280.0, 720.0);
    let before = engine.world.snapshot();
    for scale in [1.0, 0.72] {
        assert!(engine.configure_data_scene_projection(scale));
        assert!(engine.configure_data_scene_camera(
            300.0,
            300.0,
            actor.id,
            actor.generation,
            false,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0
        ));
        engine.build_render_commands();
        let c = engine
            .frame_buffers
            .render_commands
            .iter()
            .find(|c| c.texture_id == 71.0)
            .unwrap();
        assert!((c.y + c.height - 360.0).abs() < 0.001);
        assert_eq!(c.height, 64.0);
        let ground = engine
            .frame_buffers
            .render_commands
            .iter()
            .find(|c| c.texture_id == 72.0)
            .unwrap();
        assert_eq!(ground.effect_flags, 4.0);
        let world = Transform2D { x: 372.0, y: 561.0 };
        let roundtrip = engine
            .camera
            .screen_to_world(engine.camera.world_to_screen(world));
        assert!((roundtrip.y - world.y).abs() < 0.001);
        assert_eq!(engine.world.snapshot(), before);
    }
    engine.set_viewport_size(390.0, 844.0);
    assert!(engine.configure_data_scene_camera(
        0.0,
        0.0,
        u32::MAX,
        0,
        true,
        0.0,
        0.0,
        1440.0,
        1600.0,
        0.0
    ));
    assert!((engine.camera.y - 844.0 / 0.72 * 0.5).abs() < 0.001);
    engine.use_data_scene();
    assert_eq!(engine.camera.ground_y_scale, 0.72);
    assert!(!engine.configure_data_scene_camera(
        0.0,
        0.0,
        actor.id,
        actor.generation,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
    ));
    let next = sprite(&mut engine, 71, 400.0, 700.0, 0);
    assert!(engine.configure_data_scene_camera(
        0.0,
        0.0,
        next.id,
        next.generation,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
    ));
    assert_eq!(engine.camera.y, 700.0);
}

#[test]
fn upright_culling_keeps_visible_tops_outside_the_ground_view() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(100.0, 100.0);
    engine.camera.x = 50.0;
    engine.camera.y = 50.0;
    assert!(engine.configure_data_scene_projection(0.72));
    let e = sprite(&mut engine, 71, 50.0, 180.0, 0);
    assert!(engine.configure_data_scene_visual(
        e.id,
        e.generation,
        0.5,
        1.0,
        0.0,
        true,
        1.0,
        1.0,
        1.0,
        1.0
    ));
    engine.build_render_commands();
    assert_eq!(engine.frame_buffers.render_commands.len(), 1);
    assert!(!engine.configure_data_scene_projection(0.0));
    assert!(!engine.configure_data_scene_projection(f32::NAN));
}

#[test]
fn ground_shadows_reuse_geometry_follow_sun_and_owner_and_retire_with_entities() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800.0, 600.0);
    engine.camera.x = 320.0;
    engine.camera.y = 300.0;
    let a = sprite(&mut engine, 71, 300.0, 300.0, 0);
    let b = sprite(&mut engine, 72, 340.0, 300.0, 0);
    for e in [a, b] {
        assert!(engine.configure_data_scene_visual(
            e.id,
            e.generation,
            0.5,
            1.0,
            0.0,
            true,
            1.0,
            1.0,
            1.0,
            1.0
        ));
        assert!(engine.configure_data_scene_ground_shadow(
            e.id,
            e.generation,
            1,
            32.0,
            64.0,
            1.0,
            false,
            0
        ));
    }
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.5, 1.0, 512));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![2, 0, 2, 0, 0]);
    assert_eq!(engine.frame_buffers.render_commands[0].effect_flags, 12.0);
    let before = engine.frame_buffers.render_commands[0];
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![2, 2, 0, 0, 0]);
    engine
        .world
        .set_transform(a, Transform2D { x: 320.0, y: 300.0 });
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![2, 1, 1, 0, 0]);
    assert_eq!(engine.frame_buffers.render_commands[0].x, before.x + 20.0);
    assert!(engine.configure_data_scene_sun(0.0, 1.0, 0.5, 1.0, 512));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![2, 0, 2, 0, 0]);
    assert!(engine.configure_data_scene_projection(0.72));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats()[2], 2);
    assert!(engine.despawn_physics_entity(a.id, a.generation));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats()[0], 1);
    assert!(engine.world.ground_shadows[a.id as usize].is_none());
    assert!(!engine.configure_data_scene_ground_shadow(
        a.id,
        a.generation,
        1,
        1.0,
        1.0,
        1.0,
        false,
        0
    ));
    engine.use_data_scene();
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![0; 5]);
}

#[test]
fn shadow_budget_excludes_offscreen_casters_and_disabled_sun_skips_cache_work() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800.0, 600.0);
    engine.camera.x = 400.0;
    engine.camera.y = 300.0;
    for (texture, x, opacity) in [
        (71, 10000.0, 1.0),
        (72, 200.0, 0.0),
        (73, 300.0, 1.0),
        (74, 400.0, 1.0),
    ] {
        let e = sprite(&mut engine, texture, x, 300.0, 0);
        assert!(engine.configure_data_scene_ground_shadow(
            e.id,
            e.generation,
            1,
            16.0,
            32.0,
            opacity,
            false,
            0
        ));
    }
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.5, 1.0, 1));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![1, 0, 3, 1, 1]);
    assert!(!engine.configure_data_scene_sun(0.0, 0.0, 0.5, 1.0, 1));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![1, 3, 0, 1, 1]);
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.5, 1.0, 0));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![0; 5]);
    assert!(engine.configure_data_scene_projection(0.72));
    engine.use_breakout_scene();
    assert_eq!(engine.camera_ground_y_scale(), 1.0);
    assert_eq!(engine.ground_sun.max_casters, 0);
}
