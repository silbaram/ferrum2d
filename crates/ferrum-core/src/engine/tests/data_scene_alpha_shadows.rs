use super::data_scene_visuals::sprite;
use super::*;

fn scene() -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(800.0, 600.0);
    engine.camera.x = 400.0;
    engine.camera.y = 300.0;
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.5, 2.0, 512));
    engine
}

fn alpha_shadow(engine: &mut Engine, entity: Entity) {
    assert!(engine.configure_data_scene_ground_shadow(
        entity.id,
        entity.generation,
        3,
        32.0,
        64.0,
        0.8,
        false,
        0
    ));
    assert!(engine.configure_data_scene_visual(
        entity.id,
        entity.generation,
        0.5,
        1.0,
        0.0,
        true,
        1.0,
        0.2,
        0.1,
        0.5
    ));
}

#[test]
fn alpha_shadow_reuses_geometry_but_follows_live_atlas_frames_flips_and_texture() {
    let mut engine = scene();
    let actor = sprite(&mut engine, 71, 300.0, 300.0, 0);
    alpha_shadow(&mut engine, actor);
    assert!(engine.configure_data_scene_body(actor.id, actor.generation, 1, false, 0, 0.0, 1.0));
    let body = engine.world.rigid_bodies[actor.id as usize];
    assert!(engine.configure_data_scene_sprite_clips(
        actor.id,
        actor.generation,
        &[0.0, 2.0, 8.0, 1.0],
        &[0.0, 0.0, 0.25, 1.0, 0.5, 0.0, 0.75, 1.0],
        0
    ));
    engine.build_render_commands();
    let first = engine.frame_buffers.render_commands[0];
    assert_eq!(first.effect_flags, 36.0);
    assert_eq!((first.texture_id, first.u0, first.u1), (71.0, 0.0, 0.25));
    assert_eq!((first.r, first.g, first.b, first.a), (0.0, 0.0, 0.0, 0.2));
    assert!(engine.update_data_scene_sprite_animations(&[
        actor.id,
        actor.generation,
        2 | 4 | 8 | 16,
        0,
        1,
        1,
        1,
        1
    ]));
    engine.build_render_commands();
    let flipped = engine.frame_buffers.render_commands[0];
    assert_eq!(
        (flipped.u0, flipped.v0, flipped.u1, flipped.v1),
        (0.75, 1.0, 0.5, 0.0)
    );
    assert_eq!(
        (flipped.x, flipped.y, flipped.width, flipped.height),
        (first.x, first.y, first.width, first.height)
    );
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![1, 1, 0, 0, 0]);
    engine
        .world
        .sprite_mut_at_index(actor.id as usize)
        .unwrap()
        .texture_id = 72;
    engine.build_render_commands();
    assert_eq!(engine.frame_buffers.render_commands[0].texture_id, 72.0);
    assert_eq!(engine.world.rigid_bodies[actor.id as usize], body);
    assert!(engine.despawn_physics_entity(actor.id, actor.generation));
    assert!(engine.world.ground_shadows[actor.id as usize].is_none());
    assert!(!engine.configure_data_scene_ground_shadow(
        actor.id,
        actor.generation,
        3,
        1.0,
        1.0,
        1.0,
        false,
        0
    ));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![0; 5]);
}

#[test]
fn rotated_alpha_shadow_keeps_the_owners_foot_and_uses_affine_bounds() {
    let mut engine = scene();
    let actor = sprite(&mut engine, 71, 300.0, 300.0, 0);
    alpha_shadow(&mut engine, actor);
    assert!(engine.configure_data_scene_visual(
        actor.id,
        actor.generation,
        0.0,
        0.5,
        0.0,
        true,
        1.0,
        1.0,
        1.0,
        1.0
    ));
    engine
        .world
        .sprite_mut_at_index(actor.id as usize)
        .unwrap()
        .rotation_radians = std::f32::consts::FRAC_PI_2;
    assert!(engine.configure_data_scene_projection(0.5));
    engine.build_render_commands();
    let command = engine.frame_buffers.render_commands[0];
    // Upright rotated foot: (300 - 32, 300 + 16/0.5) = (268, 332).
    // The rotated silhouette extends 64 world units upward, hence center (268, 300).
    assert!((command.x + command.width * 0.5 - 268.0).abs() < 0.0001);
    assert!((command.y + command.height * 0.5 - 300.0).abs() < 0.0001);
    assert_eq!(command.rotation_radians, std::f32::consts::FRAC_PI_2);
    let caster = engine.world.ground_shadows[actor.id as usize].unwrap();
    let (hw, hh) = caster.half_extents(command, engine.ground_sun.projection);
    assert!((hw - 32.0).abs() < 0.0001);
    assert!((hh - 32.0).abs() < 0.0001);
    // A changed camera reuses geometry; a changed image pivot invalidates it.
    engine.camera.x += 10.0;
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats()[1], 1);
    engine
        .world
        .sprite_mut_at_index(actor.id as usize)
        .unwrap()
        .origin_x = 0.5;
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats()[2], 1);
}

#[test]
fn alpha_shadow_culling_and_budget_include_shadows_of_offscreen_owners() {
    let mut engine = scene();
    // The first owner is offscreen but casts from x=-100 to x=28, into the viewport.
    for x in [-100.0, -1000.0, 400.0] {
        let entity = sprite(&mut engine, 71, x, 300.0, 0);
        alpha_shadow(&mut engine, entity);
    }
    assert!(engine.configure_data_scene_sun(1.0, 0.0, 0.5, 2.0, 1));
    engine.build_render_commands();
    assert_eq!(engine.data_scene_ground_shadow_stats(), vec![1, 0, 3, 1, 1]);
    assert_eq!(
        engine
            .frame_buffers
            .render_commands
            .iter()
            .filter(|c| c.effect_flags == 36.0)
            .count(),
        1
    );
    assert_eq!(engine.data_scene_ground_shadow_projection_len(), 3);
    assert_eq!(
        engine.data_scene_ground_shadow_projection_ptr(),
        &engine.frame_buffers.ground_shadow_projection.direction_x
    );
    engine.use_breakout_scene();
    assert_eq!(engine.ground_sun.projection.length_scale, 1.0);
    assert_eq!(engine.ground_sun.max_casters, 0);
}

#[test]
fn render_metadata_stays_with_its_commands_until_the_next_build() {
    let mut engine = scene();
    let actor = sprite(&mut engine, 71, 300.0, 300.0, 0);
    alpha_shadow(&mut engine, actor);
    engine.build_render_commands();
    let commands = engine.frame_buffers.render_commands.clone();
    let projection = engine.frame_buffers.ground_shadow_projection;
    assert!(engine.configure_data_scene_sun(0.0, 1.0, 0.5, 3.0, 512));
    assert!(engine.configure_data_scene_projection(0.72));
    assert_eq!(engine.frame_buffers.render_commands, commands);
    assert_eq!(engine.frame_buffers.ground_shadow_projection, projection);
    assert_eq!(engine.render_command_ground_y_scale(), 1.0);
    engine.build_render_commands();
    assert_eq!(
        engine.frame_buffers.ground_shadow_projection,
        engine.ground_sun.projection
    );
    assert_eq!(engine.render_command_ground_y_scale(), 0.72);
    assert_ne!(engine.frame_buffers.render_commands, commands);
}
