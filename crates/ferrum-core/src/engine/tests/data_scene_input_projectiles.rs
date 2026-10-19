use super::data_scene_visuals::sprite;
use super::*;
use crate::gameplay_event::*;

fn setup(pressed: bool, cooldown: f32, speed: f32) -> (Engine, Entity, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    assert!(engine.configure_data_scene_camera(
        400.0,
        240.0,
        u32::MAX,
        0,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
    ));
    let actor = sprite(&mut engine, 1, 100.0, 100.0, 0);
    let enemy = sprite(&mut engine, 2, 200.0, 100.0, 0);
    engine.world.set_aabb_collider(
        enemy,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Enemy),
    );
    engine
        .world
        .set_collision_filter(enemy, CollisionFilter::from_layer(CollisionLayer::Enemy));
    assert!(engine.set_gameplay_health(enemy.id, enemy.generation, 3.0));
    for entity in [actor, enemy] {
        engine.world.set_height_span(
            entity,
            HeightSpan::new(PhysicsFloorId(0), 24.0, 12.0).unwrap(),
        );
    }
    assert!(engine.set_gameplay_action_projectile_with_target(
        actor.id,
        actor.generation,
        77,
        cooldown,
        speed,
        3.0,
        3.0,
        0,
        0,
        0
    ));
    assert!(engine.set_input_action_binding(77, 0, 3, if pressed { 2 } else { 1 }));
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    (engine, actor, enemy)
}

fn mouse(engine: &mut Engine, down: bool, pointer: [f32; 2]) {
    engine.set_input(
        false, false, false, false, false, false, down, pointer[0], pointer[1],
    );
}

fn simple_pointer(engine: &Engine, target: Entity) -> [f32; 2] {
    let p = engine
        .camera
        .world_to_screen(engine.world.transform(target).unwrap());
    [p.x, p.y]
}

fn spatial(engine: &mut Engine, actor: Entity, enemy: Entity, perspective: bool, pixels: bool) {
    assert!(engine.configure_spatial_camera(&[
        if perspective { 1.0 } else { 0.0 },
        150.37,
        220.21,
        120.12,
        150.37,
        30.21,
        -100.12,
        if perspective { 0.9 } else { 400.0 },
        0.1,
        2000.0,
        800.0,
        480.0
    ]));
    assert!(engine.configure_spatial_billboards(
        &[actor.id, actor.generation, enemy.id, enemy.generation],
        &[1.0, 0.01, 7.0, 1.0, 0.01, 7.0]
    ));
    if pixels {
        let mut values = vec![0.0; 112];
        values[0] = 16.0;
        values[2] = -1.0;
        values[80] = 160.0;
        values[81] = 90.0;
        values[82] = 1.0;
        values[60..76].copy_from_slice(&[
            100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
        ]);
        assert!(engine.configure_spatial_environment(&values));
    }
}

// Independent projection of a known world point; the implementation unprojects with a ray.
fn projected(engine: &Engine, point: Transform2D, height: f32) -> [f32; 2] {
    let viewport = [engine.camera.viewport_width, engine.camera.viewport_height];
    let (camera, p) = engine.spatial_scene.presented_camera(viewport).unwrap();
    let world = [point.x, height, -point.y, 1.0];
    let clip: [f32; 4] = std::array::from_fn(|row| {
        (0..4)
            .map(|column| camera.matrix[column * 4 + row] * world[column])
            .sum()
    });
    [
        viewport[0] * (p[0] + (clip[0] / clip[3] + 1.0) * 0.5 * p[2]),
        viewport[1] * (p[1] + (1.0 - clip[1] / clip[3]) * 0.5 * p[3]),
    ]
}

#[test]
fn input_projectile_hits_enemy_with_existing_damage_death_and_particle_reactions() {
    let (mut engine, actor, enemy) = setup(false, 0.2, 1000.0);
    engine
        .particle_presets
        .push(Some(crate::particles::ParticlePreset::new(91)));
    assert!(engine.add_gameplay_collision_particle(enemy.id, enemy.generation, 0, 0));
    let aim = simple_pointer(&engine, enemy);
    mouse(&mut engine, true, aim);
    engine.update(0.15); // Endpoints cross the target, so only the swept path can hit.
    assert!(
        !engine.world.is_current_entity(enemy),
        "stats {:?}, events {:?}, input {:?}, binding {:?}, camera {:?}",
        engine.data_scene_combat_stats(),
        engine.frame_buffers.gameplay_events,
        engine.input,
        engine.world.action_binding(actor, 77),
        engine.camera
    );
    assert!(engine.world.is_current_entity(actor));
    assert_eq!(engine.data_scene_input_projectiles_version(), 1);
    assert_eq!(engine.data_scene_combat_stats()[4], 1);
    assert_eq!(engine.data_scene_combat_stats()[6], 1);
    assert!(engine.data_scene_combat_stats()[9] > 0);
    assert!(engine.particle_count() > 0);
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|event| event.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE && event.actor_id == enemy.id));
}

#[test]
fn input_projectile_fixed_short_presses_zero_substeps_and_pause_do_not_replay_edges() {
    let (mut engine, _, enemy) = setup(true, 0.0, 1.0);
    let aim = simple_pointer(&engine, enemy);
    engine.configure_fixed_timestep(true, 0.1, 1.0, 8);
    for count in 1..=2 {
        mouse(&mut engine, true, aim);
        engine.update(0.04);
        assert_eq!(engine.data_scene_combat_stats()[4], count - 1);
        mouse(&mut engine, false, aim);
        engine.update(0.06);
        assert_eq!(engine.data_scene_combat_stats()[4], count);
    }
    engine.update(0.3);
    assert_eq!(engine.data_scene_combat_stats()[4], 2);
    mouse(&mut engine, true, aim);
    engine.update(0.3);
    assert_eq!(engine.data_scene_combat_stats()[4], 3);
    assert!(engine.pause_data_scene());
    mouse(&mut engine, false, aim);
    engine.update(0.04);
    mouse(&mut engine, true, aim);
    engine.update(0.06);
    let before = engine.data_scene_combat_stats();
    assert!(engine.resume_data_scene());
    engine.update(0.3);
    assert_eq!(engine.data_scene_combat_stats(), before);
    mouse(&mut engine, false, aim);
    engine.update(0.1);
    mouse(&mut engine, true, aim);
    engine.update(0.1);
    assert_eq!(engine.data_scene_combat_stats()[4], 4);
}

#[test]
fn input_projectile_down_cooldown_and_multiple_bindings_remain_one_attack_per_substep() {
    let (mut engine, actor, enemy) = setup(false, 0.2, 1.0);
    assert!(engine.set_gameplay_action_projectile_with_target(
        actor.id,
        actor.generation,
        78,
        0.2,
        1.0,
        3.0,
        3.0,
        0,
        0,
        0
    ));
    assert!(engine.set_input_action_binding(78, 1, 3, 1));
    let aim = simple_pointer(&engine, enemy);
    mouse(&mut engine, true, aim);
    engine.update(0.01);
    assert_eq!(engine.data_scene_combat_stats()[4], 1);
    engine.update(0.01);
    assert_eq!(engine.data_scene_combat_stats()[4], 2);
    engine.update(0.05);
    assert_eq!(engine.data_scene_combat_stats()[4], 2);
    engine.update(0.21);
    assert_eq!(engine.data_scene_combat_stats()[4], 3);
    assert!(engine.pause_data_scene());
    let before = engine.data_scene_combat_stats();
    engine.update(1.0);
    assert_eq!(engine.data_scene_combat_stats(), before);
    assert!(engine.resume_data_scene());
    engine.update(0.21);
    assert_eq!(engine.data_scene_combat_stats()[4], 4);
}

#[test]
fn input_projectile_invalid_aim_does_not_consume_cooldown_or_spawn() {
    let (mut engine, actor, enemy) = setup(false, 0.5, 1.0);
    for pointer in [
        [f32::NAN, 100.0],
        [-1.0, 100.0],
        [801.0, 100.0],
        simple_pointer(&engine, actor),
    ] {
        mouse(&mut engine, true, pointer);
        engine.update(0.01);
        assert_eq!(engine.data_scene_combat_stats()[4], 0);
        assert_eq!(
            engine
                .world
                .action_binding(actor, 77)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }
    let aim = simple_pointer(&engine, enemy);
    mouse(&mut engine, true, aim);
    engine.update(0.01);
    assert_eq!(engine.data_scene_combat_stats()[4], 1);
}

#[test]
fn input_projectile_orthographic_perspective_pixel_snap_resize_and_visual_height_align() {
    for perspective in [false, true] {
        for pixels in [false, true] {
            for viewport in [[800.0, 480.0], [1000.0, 700.0]] {
                let (mut engine, actor, enemy) = setup(false, 0.2, 1000.0);
                spatial(&mut engine, actor, enemy, perspective, pixels);
                engine.set_viewport_size(viewport[0], viewport[1]);
                let target = engine.world.transform(enemy).unwrap();
                let aim = projected(&engine, target, 37.0); // body 24 + half-height 6 + visual offset 7.
                let result = engine
                    .spatial_scene
                    .aim_on_plane(viewport, aim, 37.0)
                    .unwrap();
                assert!((result.x - target.x).hypot(result.y - target.y) < 0.001);
                mouse(&mut engine, true, aim);
                engine.update(0.15);
                assert!(
                    !engine.world.is_current_entity(enemy),
                    "perspective={perspective} pixels={pixels} viewport={viewport:?}"
                );
                assert!(engine.frame_buffers.render_commands.is_empty());
                assert_eq!(engine.data_scene_combat_stats()[6], 1);
            }
        }
    }
}

#[test]
fn input_projectile_letterbox_parallel_and_behind_camera_rays_are_rejected() {
    let (mut engine, actor, enemy) = setup(false, 0.5, 1.0);
    spatial(&mut engine, actor, enemy, false, true);
    mouse(&mut engine, true, [10.0, 1.0]);
    engine.update(0.01);
    assert_eq!(engine.data_scene_combat_stats()[4], 0);
    assert_eq!(
        engine
            .world
            .action_binding(actor, 77)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
    assert!(engine.configure_spatial_environment(&[]));
    assert!(engine.configure_spatial_camera(&[
        0.0, 100.0, 37.0, 100.0, 100.0, 37.0, 0.0, 400.0, 0.1, 2000.0, 800.0, 480.0
    ]));
    assert!(engine
        .spatial_scene
        .aim_on_plane([800.0, 480.0], [400.0, 240.0], 37.0)
        .is_none());
    mouse(&mut engine, true, [400.0, 240.0]);
    engine.update(0.01);
    assert_eq!(engine.data_scene_combat_stats()[4], 0);
    assert!(engine.configure_spatial_camera(&[
        0.0, 100.0, 5.0, 100.0, 100.0, 0.0, 0.0, 400.0, 0.1, 2000.0, 800.0, 480.0
    ]));
    assert!(engine
        .spatial_scene
        .aim_on_plane([800.0, 480.0], [400.0, 240.0], 37.0)
        .is_none());
}

#[test]
fn input_projectile_ccd_respects_target_floor_wall_and_collision_pair_masks() {
    for obstacle in [0, 1, 2, 3] {
        let (mut engine, _, enemy) = setup(false, 0.2, 1000.0);
        let blocker = sprite(&mut engine, 3, 150.0, 100.0, 0);
        let layer = if obstacle == 1 {
            CollisionLayer::Wall
        } else {
            CollisionLayer::Enemy
        };
        engine
            .world
            .set_aabb_collider(blocker, AabbCollider::new(2.0, 8.0, true, layer));
        engine.world.set_collision_filter(
            blocker,
            if obstacle == 2 {
                CollisionFilter::new(CollisionMask::ENEMY, CollisionMask::NONE)
            } else {
                CollisionFilter::from_layer(layer)
            },
        );
        assert!(engine.set_gameplay_health(blocker.id, blocker.generation, 3.0));
        engine.world.set_height_span(
            blocker,
            HeightSpan::new(
                PhysicsFloorId(if obstacle == 0 { 1 } else { 0 }),
                if obstacle == 3 { 80.0 } else { 24.0 },
                12.0,
            )
            .unwrap(),
        );
        let aim = simple_pointer(&engine, enemy);
        mouse(&mut engine, true, aim);
        engine.update(0.15);
        assert_eq!(engine.world.is_current_entity(enemy), obstacle == 1);
        assert!(engine.world.is_current_entity(blocker));
        assert_eq!(engine.world.health(blocker), Some(3.0));
    }
}

#[test]
fn input_projectile_does_not_fire_for_non_primary_actors_or_after_actor_generation_reuse() {
    let (mut engine, actor, enemy) = setup(false, 0.0, 1.0);
    assert!(engine.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        77,
        0.0,
        1.0,
        3.0,
        3.0,
        0,
        0,
        0
    ));
    engine.world.despawn(actor);
    let replacement = sprite(&mut engine, 1, 100.0, 100.0, 0);
    assert_eq!(replacement.id, actor.id);
    assert_ne!(replacement.generation, actor.generation);
    let aim = simple_pointer(&engine, enemy);
    mouse(&mut engine, true, aim);
    engine.update(0.1);
    assert_eq!(engine.data_scene_combat_stats()[4], 0);
    assert!(engine.world.is_current_entity(replacement));
}

#[test]
fn input_projectile_space_pressed_and_enemy_periodic_timers_keep_independent_target_policies() {
    let (mut engine, actor, enemy) = setup(true, 0.0, 1.0);
    assert!(engine.set_input_action_binding(77, 0, 1, 2));
    assert!(engine.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        88,
        0.0,
        1.0,
        1.0,
        3.0,
        1,
        1,
        0
    ));
    assert!(engine.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 88, 0.1, 88));
    let aim = simple_pointer(&engine, enemy);
    engine.set_input(
        false, false, false, false, true, false, false, aim[0], aim[1],
    );
    engine.update(0.1);
    let spawned: Vec<_> = engine
        .frame_buffers
        .gameplay_events
        .iter()
        .filter(|e| e.kind == GAMEPLAY_EVENT_PREFAB_SPAWNED)
        .copied()
        .collect();
    assert_eq!(spawned.len(), 2);
    for event in spawned {
        let projectile = Entity {
            id: event.actor_id,
            generation: event.actor_generation,
        };
        let expected = if event.source_id == actor.id {
            CollisionMask::ENEMY
        } else {
            CollisionMask::PLAYER
        }
        .union(CollisionMask::WALL);
        assert_eq!(
            engine
                .world
                .collision_filter_at(projectile.id as usize)
                .unwrap()
                .mask,
            expected
        );
    }
    engine.clear_events();
    engine.update(0.1);
    assert_eq!(engine.data_scene_combat_stats()[4], 3);
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .filter(|e| e.kind == GAMEPLAY_EVENT_PREFAB_SPAWNED)
        .all(|e| e.source_id == enemy.id));
    assert_eq!(engine.data_scene_combat_stats().len(), 10);
    assert_eq!(engine.data_scene_combat_stats()[0], 1);
}

#[test]
fn input_projectile_capacity_rejection_leaves_cooldown_ready() {
    let (mut engine, actor, enemy) = setup(false, 0.5, 1.0);
    while engine.world.alive_count() < 2048 {
        engine.world.spawn_entity();
    }
    let aim = simple_pointer(&engine, enemy);
    mouse(&mut engine, true, aim);
    engine.update_frame(0.1, false, false, false);
    assert_eq!(engine.data_scene_combat_stats()[4], 0);
    assert!(engine.data_scene_combat_stats()[8] > 0);
    assert_eq!(
        engine
            .world
            .action_binding(actor, 77)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_ACTION_FAILED
            && e.token_id == 77
            && e.payload_bits == GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL));
}

#[test]
fn input_projectile_prefab_aim_uses_its_relative_visual_height_in_both_camera_projections() {
    for perspective in [false, true] {
        let (mut engine, actor, enemy) = setup(true, 0.2, 1000.);
        spatial(&mut engine, actor, enemy, perspective, true);
        let values = [
            12., 8., 0., 0., 0.5, 1., 3., 2., 0.5, 0.2, 20., 0.2, 0.4, 1., 1.,
        ];
        assert!(engine.configure_data_scene_gameplay_v3(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &[1, 800],
            &values,
            &[actor.id, actor.generation, 77, 1]
        ));
        let point = engine.world.transform(enemy).unwrap();
        let aim = projected(&engine, point, 24. + 12. * 0.5 + 7. + 20.);
        mouse(&mut engine, true, aim);
        engine.update(0.15);
        assert!(
            !engine.world.is_current_entity(enemy),
            "perspective={perspective}, stats={:?}",
            engine.data_scene_combat_stats()
        );
        assert_eq!(engine.data_scene_combat_stats()[4], 1);
    }
}
