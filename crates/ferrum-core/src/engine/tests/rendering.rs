use super::*;

#[test]
fn player_render_command_uses_centered_transform() {
    let mut engine = Engine::new();
    engine.build_render_commands();

    let command = engine.render_commands[0];
    assert!((command.x - 382.0).abs() < 0.01);
    assert!((command.y - 222.0).abs() < 0.01);
}

#[test]
fn camera_follows_player_and_offsets_render_commands() {
    let mut engine = Engine::new();
    engine.set_viewport_size(400.0, 240.0);
    let player = engine.world.player.unwrap();
    engine.world.transforms[player.id as usize] = Some(Transform2D {
        x: 1000.0,
        y: 600.0,
    });

    engine
        .scenes
        .shooter
        .update_camera_follow(&engine.world, &mut engine.camera);
    engine.build_render_commands();

    assert_eq!(engine.camera_x(), 1000.0);
    assert_eq!(engine.camera_y(), 600.0);
    let command = engine.render_commands[0];
    assert!((command.x - 182.0).abs() < 0.01);
    assert!((command.y - 102.0).abs() < 0.01);
}

#[test]
fn configured_texture_ids_are_written_to_render_commands() {
    let mut engine = Engine::new();
    engine.set_texture_ids(1, 2, 3);
    engine.world.spawn_enemy(820.0, 480.0, 2);
    engine.world.spawn_bullet(840.0, 480.0, 0.0, 0.0, 3);
    engine.build_render_commands();

    let texture_ids: Vec<u32> = engine
        .render_commands
        .iter()
        .map(|command| command.texture_id as u32)
        .collect();
    assert!(texture_ids.contains(&1));
    assert!(texture_ids.contains(&2));
    assert!(texture_ids.contains(&3));
}

#[test]
fn offscreen_entity_sprites_do_not_emit_render_commands() {
    let mut engine = Engine::new();
    engine.world.spawn_enemy(2_000.0, 2_000.0, 99);

    engine.build_render_commands();

    assert!(!engine
        .render_commands
        .iter()
        .any(|command| command.texture_id == 99.0));
}

#[test]
fn non_finite_entity_position_does_not_emit_render_commands() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(f32::NAN, 480.0, 99);
    engine.world.transforms[enemy.id as usize] = Some(Transform2D {
        x: f32::NAN,
        y: 480.0,
    });

    engine.build_render_commands();

    assert!(!engine
        .render_commands
        .iter()
        .any(|command| command.texture_id == 99.0));
}

#[test]
fn camera_preset_applies_without_resetting_world() {
    let mut engine = Engine::new();
    engine.set_viewport_size(400.0, 240.0);
    let player = engine.world.player.unwrap();
    engine.world.transforms[player.id as usize] = Some(Transform2D {
        x: 1000.0,
        y: 600.0,
    });
    engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    engine.set_shooter_camera_preset(2, 160.0, 96.0, 80.0, 6.0, 8.0);

    assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
    assert_eq!(engine.camera_x(), 1000.0);
    assert_eq!(engine.camera_y(), 600.0);

    engine.world.velocities[player.id as usize] =
        Some(crate::components::Velocity { vx: 1.0, vy: 0.0 });
    engine
        .scenes
        .shooter
        .update_camera_follow(&engine.world, &mut engine.camera);

    assert_eq!(engine.camera_x(), 1080.0);
    assert_eq!(engine.camera_y(), 600.0);
}

#[test]
fn atlas_frame_updates_prefab_without_render_abi_change() {
    let mut engine = Engine::new();

    engine.set_shooter_atlas_frame(2, 9, 12.0, 10.0, 0.25, 0.5, 0.5, 0.75);
    engine.world.spawn_bullet_from_template(
        Transform2D { x: 820.0, y: 480.0 },
        crate::components::Velocity { vx: 0.0, vy: 0.0 },
        9,
        1.0,
        engine.scenes.shooter.config().bullet_template,
        1.0,
    );
    engine.build_render_commands();

    let command = engine
        .render_commands
        .iter()
        .find(|command| command.texture_id == 9.0)
        .expect("bullet render command should use configured atlas texture");
    assert_eq!(command.width, 12.0);
    assert_eq!(command.height, 10.0);
    assert_eq!(command.u0, 0.25);
    assert_eq!(command.v0, 0.5);
    assert_eq!(command.u1, 0.5);
    assert_eq!(command.v1, 0.75);
    assert_eq!(
        command.effect_flags,
        crate::render_command::SPRITE_EFFECT_NONE
    );
    assert_eq!(crate::sprite_render_command_floats(), 14);
}

#[test]
fn atlas_animation_updates_prefab_uvs_in_rust() {
    let mut engine = Engine::new();

    engine.set_shooter_atlas_animation(
        2,
        9,
        12.0,
        10.0,
        1.0,
        vec![0.0, 0.0, 0.25, 0.5],
        8.0,
        vec![0.0, 0.5, 0.25, 1.0, 0.25, 0.5, 0.5, 1.0],
    );
    engine.world.spawn_bullet_from_template(
        Transform2D { x: 820.0, y: 480.0 },
        crate::components::Velocity { vx: 10.0, vy: 0.0 },
        9,
        1.0,
        engine.scenes.shooter.config().bullet_template,
        1.0,
    );
    engine.world.update(0.125);
    engine.build_render_commands();

    let command = engine
        .render_commands
        .iter()
        .find(|command| command.texture_id == 9.0)
        .expect("bullet render command should use configured atlas animation texture");
    assert_eq!(command.width, 12.0);
    assert_eq!(command.height, 10.0);
    assert_eq!(command.u0, 0.25);
    assert_eq!(command.v0, 0.5);
    assert_eq!(command.u1, 0.5);
    assert_eq!(command.v1, 1.0);
}

#[test]
fn atlas_animation_frame_events_reach_gameplay_event_buffer() {
    let mut engine = Engine::new();

    engine.set_shooter_atlas_animation(
        0,
        9,
        36.0,
        36.0,
        1.0,
        vec![0.0, 0.0, 0.25, 0.5],
        8.0,
        vec![0.0, 0.5, 0.25, 1.0, 0.25, 0.5, 0.5, 1.0],
    );
    assert!(engine.add_shooter_animation_frame_event(
        0,
        crate::components::SPRITE_ANIMATION_CLIP_MOVE,
        1,
        crate::components::SPRITE_ANIMATION_EVENT_HITBOX,
        99,
    ));
    engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
    engine.update_frame(0.016, false, false, false);
    engine.set_input(false, false, false, true, false, false, false, 0.0, 0.0);
    let player = engine.world.player.expect("player should exist");

    engine.update_frame(0.125, false, false, false);

    let event = engine
        .gameplay_events
        .iter()
        .find(|event| event.kind == crate::gameplay_event::GAMEPLAY_EVENT_ANIMATION_FRAME)
        .expect("animation frame event should be emitted");
    assert_eq!(event.source_id, player.id);
    assert_eq!(event.token_id, 99);
    assert_eq!(
        event.flags,
        crate::components::SPRITE_ANIMATION_EVENT_HITBOX
    );
}

#[test]
fn tilemap_render_commands_are_emitted_before_entities() {
    let mut engine = Engine::new();
    engine.set_viewport_size(1600.0, 960.0);
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 0.4, 0.5, 0.6, 0.7);
    engine.set_shooter_tilemap_layer(0, 2, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1, 0]);

    engine.build_render_commands();

    assert_eq!(engine.render_commands.len(), 2);
    let tile = engine.render_commands[0];
    assert_eq!(tile.texture_id, 9.0);
    assert_eq!(tile.width, 32.0);
    assert_eq!(tile.height, 32.0);
    assert_eq!(tile.r, 0.4);
    assert_eq!(tile.a, 0.7);
    assert!((tile.x - 0.0).abs() < 0.01);
    assert!((tile.y - 0.0).abs() < 0.01);

    let player = engine.render_commands[1];
    assert_eq!(player.texture_id, DEFAULT_TEXTURE_ID as f32);
}

#[test]
fn non_hd2d_render_commands_keep_layer_order_over_foot_y() {
    let mut engine = Engine::new();
    engine.set_viewport_size(1600.0, 960.0);
    let player = engine.world.player.unwrap();
    engine.world.transforms[player.id as usize] = Some(Transform2D { x: 16.0, y: 8.0 });
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(0, 1, 1, 32.0, 32.0, 0.0, 240.0, false, vec![1]);

    engine.build_render_commands();

    assert_eq!(
        engine
            .render_commands
            .iter()
            .map(|command| command.texture_id as u32)
            .collect::<Vec<_>>(),
        vec![9, DEFAULT_TEXTURE_ID]
    );
}

#[test]
fn non_hd2d_tilemap_rendering_preserves_texture_bucket_order() {
    let mut engine = Engine::new();
    engine.set_viewport_size(1600.0, 960.0);
    engine.set_shooter_tile(1, 11, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tile(2, 22, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(0, 4, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1, 2, 1, 2]);

    engine.build_render_commands();

    assert_eq!(
        engine.render_commands[..4]
            .iter()
            .map(|command| command.texture_id as u32)
            .collect::<Vec<_>>(),
        vec![11, 11, 22, 22]
    );
}

#[test]
fn non_hd2d_particles_emit_after_entities_over_foot_y() {
    let mut engine = Engine::new();
    engine.set_viewport_size(1600.0, 960.0);
    let player = engine.world.player.unwrap();
    engine.world.transforms[player.id as usize] = Some(Transform2D { x: 800.0, y: 480.0 });
    set_test_particle_preset(&mut engine, 0, 77, 1, 1.0);

    assert_eq!(engine.spawn_particle_burst(0, 16.0, 8.0), 1);
    engine.build_render_commands();

    assert_eq!(engine.render_commands.last().unwrap().texture_id, 77.0);
}

#[test]
fn clear_tilemap_removes_static_tile_render_commands() {
    let mut engine = Engine::new();
    engine.set_viewport_size(1600.0, 960.0);
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1]);

    engine.clear_shooter_tilemap();
    engine.build_render_commands();

    assert_eq!(engine.render_commands.len(), 1);
    assert_eq!(
        engine.render_commands[0].texture_id,
        DEFAULT_TEXTURE_ID as f32
    );
}

#[test]
fn render_commands_sort_entities_by_hd2d_floor_elevation_and_foot_y() {
    let mut engine = Engine::new();
    engine.set_viewport_size(1600.0, 960.0);
    let player = engine.world.player.unwrap();
    engine.world.transforms[player.id as usize] = Some(Transform2D { x: 100.0, y: 120.0 });
    engine.world.sprites[player.id as usize]
        .as_mut()
        .unwrap()
        .texture_id = 1;
    assert!(engine.world.set_height_span(
        player,
        HeightSpan::new(PhysicsFloorId(0), 10.0, 16.0).unwrap(),
    ));

    let low_enemy = engine.world.spawn_enemy(120.0, 180.0, 2);
    assert!(engine.world.set_height_span(
        low_enemy,
        HeightSpan::new(PhysicsFloorId(0), 0.0, 16.0).unwrap(),
    ));
    let upper_enemy = engine.world.spawn_enemy(140.0, 80.0, 3);
    assert!(engine.world.set_height_span(
        upper_enemy,
        HeightSpan::new(PhysicsFloorId(1), 0.0, 16.0).unwrap(),
    ));

    engine.build_render_commands();

    assert_eq!(
        engine
            .render_commands
            .iter()
            .map(|command| command.texture_id as u32)
            .collect::<Vec<_>>(),
        vec![2, 1, 3]
    );
}

#[test]
fn hd2d_render_commands_sort_tiles_and_entities_by_foot_y_without_render_abi_change() {
    let mut engine = Engine::new();
    engine.set_viewport_size(1600.0, 960.0);
    let player = engine.world.player.unwrap();
    engine.world.transforms[player.id as usize] = Some(Transform2D { x: 16.0, y: 8.0 });
    engine.world.sprites[player.id as usize]
        .as_mut()
        .unwrap()
        .texture_id = 1;
    assert!(engine.world.set_height_span(
        player,
        HeightSpan::new(PhysicsFloorId::DEFAULT, 0.0, 16.0).unwrap(),
    ));
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1]);
    assert!(engine.set_shooter_tile_height_span(1, 0, 0.0, 32.0));

    engine.build_render_commands();

    assert_eq!(
        engine
            .render_commands
            .iter()
            .map(|command| command.texture_id as u32)
            .collect::<Vec<_>>(),
        vec![1, 9]
    );
    assert_eq!(crate::sprite_render_command_floats(), 14);
}
