use super::*;
use crate::entity::Entity;

pub(super) fn sprite(engine: &mut Engine, texture: u32, x: f32, y: f32, layer: i32) -> Entity {
    assert!(engine.spawn_data_scene_entity(
        x,
        y,
        0.0,
        layer,
        texture,
        32.0,
        64.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0,
        0.0,
        PHYSICS_LAYER_PLAYER,
        PHYSICS_COLLIDER_TYPE_AABB,
        0.0,
        0.0,
        true,
        true,
        8.0,
        8.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        vec![]
    ));
    Entity {
        id: engine.data_scene_entity_id(),
        generation: engine.data_scene_entity_generation(),
    }
}
fn order(engine: &mut Engine) -> Vec<u32> {
    engine.build_render_commands();
    engine
        .frame_buffers
        .render_commands
        .iter()
        .map(|c| c.texture_id as u32)
        .collect()
}
#[test]
fn visual_pivot_rotation_scale_and_tint_reach_commands_without_moving_collider() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    let e = sprite(&mut engine, 71, 300.0, 300.0, 0);
    for origin in [0.0, 0.5, 1.0] {
        for rotation in [0.0_f32, std::f32::consts::FRAC_PI_2, 0.6] {
            for scale in [0.5, 2.0] {
                let s = engine.world.sprite_mut_at_index(e.id as usize).unwrap();
                s.width = 32.0 * scale;
                s.height = 64.0 * scale;
                s.rotation_radians = rotation;
                assert!(engine.configure_data_scene_visual(
                    e.id,
                    e.generation,
                    origin,
                    origin,
                    0.0,
                    false,
                    1.0,
                    0.0,
                    0.0,
                    0.5
                ));
                engine.build_render_commands();
                let c = engine.frame_buffers.render_commands[0];
                let t = engine
                    .camera
                    .world_to_screen(Transform2D { x: 300.0, y: 300.0 });
                // Rotate the rectangle center about the entity anchor, then encode a centered quad.
                let (sin, cos) = rotation.sin_cos();
                let dx = (0.5 - origin) * c.width;
                let dy = (0.5 - origin) * c.height;
                assert!((c.x - (t.x + dx * cos - dy * sin - c.width / 2.0)).abs() < 0.001);
                assert!((c.y - (t.y + dx * sin + dy * cos - c.height / 2.0)).abs() < 0.001);
                assert_eq!((c.r, c.g, c.b, c.a), (1.0, 0.0, 0.0, 0.5));
                assert_eq!(
                    engine.world.transform(e).unwrap(),
                    Transform2D { x: 300.0, y: 300.0 }
                );
                assert_eq!(engine.world.collider(e).unwrap().offset_y, 0.0);
            }
        }
    }
}
#[test]
fn pivot_culling_uses_shifted_rotated_bounds() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    engine.set_viewport_size(100.0, 100.0);
    engine.camera.x = 50.0;
    engine.camera.y = 50.0;
    let e = sprite(&mut engine, 71, 50.0, 120.0, 0);
    assert!(engine.configure_data_scene_visual(
        e.id,
        e.generation,
        0.5,
        1.0,
        0.0,
        false,
        1.0,
        1.0,
        1.0,
        1.0
    ));
    assert_eq!(order(&mut engine), vec![71]);
    engine
        .world
        .sprite_mut_at_index(e.id as usize)
        .unwrap()
        .rotation_radians = std::f32::consts::PI;
    assert!(order(&mut engine).is_empty());
}
#[test]
fn data_scene_layers_survive_unrelated_height_span_and_lifecycle_changes() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    engine.set_viewport_size(1600.0, 960.0);
    let ground = sprite(&mut engine, 1, 720.0, 480.0, -10);
    let s = engine
        .world
        .sprite_mut_at_index(ground.id as usize)
        .unwrap();
    s.width = 1440.0;
    s.height = 960.0;
    sprite(&mut engine, 2, 300.0, 300.0, 10);
    assert_eq!(order(&mut engine), vec![1, 2]);
    let body = engine.world.spawn_entity();
    engine
        .world
        .set_transform(body, Transform2D { x: 300.0, y: 300.0 });
    engine.world.set_rigid_body(body, RigidBody::kinematic());
    for floor in [0, 3] {
        assert!(engine.set_physics_body_height_span(body.id, body.generation, floor, 10.0, 1.0));
        assert_eq!(order(&mut engine), vec![1, 2]);
        assert!(engine.clear_physics_body_height_span(body.id, body.generation));
        assert_eq!(order(&mut engine), vec![1, 2]);
    }
    engine.world.despawn(body);
    assert_eq!(order(&mut engine), vec![1, 2]);
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    assert!(order(&mut engine).is_empty());
    assert!(!engine.configure_data_scene_visual(
        ground.id,
        ground.generation,
        0.0,
        0.0,
        0.0,
        false,
        1.0,
        1.0,
        1.0,
        1.0
    ));
}
#[test]
fn data_scene_depth_is_explicit_and_uses_feet_inside_layers() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    sprite(&mut engine, 1, 300.0, 300.0, -10);
    let actor = sprite(&mut engine, 2, 300.0, 300.0, 0);
    let tree = sprite(&mut engine, 3, 300.0, 280.0, 0);
    for e in [actor, tree] {
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
    }
    assert_eq!(order(&mut engine), vec![1, 3, 2]);
    engine
        .world
        .set_transform(actor, Transform2D { x: 300.0, y: 270.0 });
    assert_eq!(order(&mut engine), vec![1, 2, 3]);
    engine
        .world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 0.0, 1.0).unwrap());
    assert_eq!(order(&mut engine), vec![1, 3, 2]);
}

#[test]
fn data_scene_body_uses_the_sprite_transform_and_generation() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    let actor = sprite(&mut engine, 2, 300.0, 300.0, 0);
    assert!(engine.world.rigid_body(actor).is_none());
    assert!(engine.configure_data_scene_body(actor.id, actor.generation, 1, true, 0, 0.0, 1.0));
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
    order(&mut engine);
    let before = engine.frame_buffers.render_commands[0];
    assert!(engine.set_physics_body_position(actor.id, actor.generation, 320.0, 300.0));
    order(&mut engine);
    let after = engine.frame_buffers.render_commands[0];
    assert_eq!(after.x - before.x, 20.0);
    assert_eq!(after.y, before.y);
    engine.world.despawn(actor);
    let next = sprite(&mut engine, 3, 100.0, 100.0, 0);
    assert_ne!(next, actor);
    assert!(!engine.configure_data_scene_body(actor.id, actor.generation, 1, false, 0, 0.0, 1.0));
    assert!(engine.world.rigid_body(next).is_none());
}

#[test]
fn data_scene_camera_follows_after_simulation_and_drops_stale_targets() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(200.0, 100.0);
    let actor = sprite(&mut engine, 2, 300.0, 300.0, 0);
    assert!(engine.configure_data_scene_body(actor.id, actor.generation, 1, false, 0, 0.0, 1.0));
    assert!(engine.configure_data_scene_camera(
        300.0,
        300.0,
        actor.id,
        actor.generation,
        true,
        0.0,
        0.0,
        1000.0,
        1000.0,
        0.0
    ));
    engine
        .world
        .set_velocity(actor, Velocity { vx: 100.0, vy: 0.0 });
    engine.update_frame(0.1, true, true, true);
    assert_eq!(engine.camera.x, engine.world.transform(actor).unwrap().x);
    assert_eq!(engine.frame_buffers.render_commands[0].x, 100.0 - 16.0);
    engine
        .world
        .set_transform(actor, Transform2D { x: 990.0, y: 990.0 });
    engine.update_frame(0.0, true, false, false);
    assert_eq!((engine.camera.x, engine.camera.y), (900.0, 950.0));
    engine.set_viewport_size(400.0, 200.0);
    assert_eq!((engine.camera.x, engine.camera.y), (800.0, 900.0));
    engine.world.despawn(actor);
    let next = sprite(&mut engine, 3, 100.0, 100.0, 0);
    engine.update_frame(0.0, true, false, false);
    assert_eq!((engine.camera.x, engine.camera.y), (800.0, 900.0));
    assert!(!engine.configure_data_scene_camera(
        100.0,
        100.0,
        actor.id,
        actor.generation,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
    ));
    assert_ne!(next, actor);
    engine.use_data_scene();
    assert!(engine.configure_data_scene_camera(
        200.0,
        200.0,
        u32::MAX,
        0,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
    ));
    assert_eq!((engine.camera.x, engine.camera.y), (200.0, 200.0));
}

#[test]
fn data_scene_sort_order_is_secondary_to_render_layer() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    let first = sprite(&mut engine, 71, 300.0, 300.0, 0);
    sprite(&mut engine, 72, 300.0, 300.0, 0);
    sprite(&mut engine, 73, 300.0, 300.0, 1);
    assert!(engine.configure_data_scene_visual(
        first.id,
        first.generation,
        0.5,
        0.5,
        100.0,
        false,
        1.0,
        1.0,
        1.0,
        1.0
    ));
    assert_eq!(order(&mut engine), vec![72, 71, 73]);
}
