use super::*;

const FIRST_SHOT: usize = 7 + 2 * 72;

fn visual_config(
    engine: &mut Engine,
    actor: Entity,
    enemy: Entity,
    texture: u32,
    looping: bool,
    animated: bool,
    aligned: bool,
) -> bool {
    engine.configure_data_scene_gameplay_v8(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[1, texture],
        &[
            12., 4., 0., 0., 0.5, 1., 2., 2., 1., 0.1, 3., 1., 1., 1., 1.,
        ],
        &[enemy.id, enemy.generation, 31, 1],
        &[],
        &[],
        &[],
        0,
        &[],
        &[
            1,
            if animated { 2 } else { 0 },
            u32::from(animated && looping),
            u32::from(aligned),
        ],
        &[if animated { 3. } else { 0. }],
        if animated {
            &[0., 0., 0.5, 1., 1., 0., 0.5, 1.]
        } else {
            &[]
        },
    )
}
fn shots(engine: &Engine) -> Vec<Entity> {
    engine
        .world
        .alive_indices()
        .iter()
        .filter_map(|&index| {
            (engine.world.collider_layer_at(index) == Some(CollisionLayer::Bullet))
                .then(|| engine.world.entity_at_index(index))
                .flatten()
        })
        .collect()
}
fn altered(saved: &Saved, index: usize, value: f64) -> Saved {
    let mut combat = saved.combat.clone();
    combat[index] = value;
    Saved {
        flags: saved.flags.clone(),
        animations: saved.animations.clone(),
        spatial: saved.spatial.clone(),
        rotations: saved.rotations.clone(),
        combat,
    }
}

#[test]
fn shared_projectile_atlas_has_independent_clocks_flips_and_fresh_texture_restore() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 10);
    assert!(visual_config(
        &mut engine,
        actor,
        enemy,
        71,
        true,
        true,
        true
    ));
    engine.update(0.5);
    engine.update(0.5);
    engine.update(0.2);
    let bullets = shots(&engine);
    assert_eq!(bullets.len(), 2);
    let a = engine.world.sprite_playbacks[bullets[0].id as usize]
        .as_ref()
        .unwrap();
    let b = engine.world.sprite_playbacks[bullets[1].id as usize]
        .as_ref()
        .unwrap();
    assert!(std::sync::Arc::ptr_eq(&a.clips, &b.clips));
    assert_ne!(a.elapsed, b.elapsed);
    assert_ne!(a.frame_index(), b.frame_index());
    assert!(engine.update_data_scene_sprite_animations(&[
        bullets[0].id,
        bullets[0].generation,
        4 | 8 | 16,
        0,
        0,
        1,
        1,
        1
    ]));
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat[0], 4.);
    assert_eq!(saved.combat.len(), 7 + 144 + 2 * 32);
    assert_eq!(saved.combat[FIRST_SHOT + 26], 1.);
    let before = engine.world.sprite_playbacks[bullets[0].id as usize]
        .clone()
        .unwrap();
    engine.update(0.1);
    assert_eq!(
        engine.world.sprite_playbacks[bullets[0].id as usize]
            .as_ref()
            .unwrap()
            .elapsed,
        before.elapsed
    );
    let (fresh_actor, fresh_enemy, fresh) = setup(&mut engine, 20);
    assert!(visual_config(
        &mut engine,
        fresh_actor,
        fresh_enemy,
        91,
        true,
        true,
        true
    ));
    assert!(restore(&mut engine, &fresh, &saved));
    assert_eq!(capture(&engine, &fresh).combat, saved.combat);
    let restored = shots(&engine);
    assert!(restored.iter().all(|&shot| engine
        .world
        .sprite_at_index(shot.id as usize)
        .unwrap()
        .texture_id
        == 91));
    assert!(restored.iter().all(|e| !bullets.contains(e)));
    engine.update(0.);
    assert_eq!(capture(&engine, &fresh).combat, saved.combat);
    assert_eq!(engine.spatial_scene.runtime_sprite_rotations.len(), 2);
}

#[test]
fn malformed_atlas_checkpoint_and_catalog_refuse_without_retiring_the_scene() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 10);
    assert!(visual_config(
        &mut engine,
        actor,
        enemy,
        71,
        true,
        true,
        true
    ));
    engine.update(0.5);
    let saved = capture(&engine, &handles);
    let original = shots(&engine)[0];
    for (offset, value) in [(26, 0.), (27, 1.), (28, 1.), (29, 2.), (13, 0.25)] {
        let bad = altered(&saved, FIRST_SHOT + offset, value);
        assert!(!restore(&mut engine, &handles, &bad));
        assert!(engine.world.is_current_entity(original));
        assert_eq!(capture(&engine, &handles).combat, saved.combat);
    }
    let old = saved.combat.clone();
    assert!(!engine.configure_data_scene_gameplay_v8(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[1, 71],
        &[12., 4., 0., 0., 0.5, 1., 2., 2., 1., 0.1, 3., 1., 1., 1., 1.],
        &[enemy.id, enemy.generation, 31, 1],
        &[],
        &[],
        &[],
        0,
        &[],
        &[1, 2, 1, 1],
        &[3.],
        &[0., 0., 0.5, 1.]
    ));
    assert_eq!(capture(&engine, &handles).combat, old);
    // Old envelopes cannot silently discard an animated catalog's playback state.
    let mut legacy = saved.combat[..4].to_vec();
    legacy[0] = 2.;
    legacy.extend(&saved.combat[7..FIRST_SHOT]);
    legacy.extend(&saved.combat[FIRST_SHOT..FIRST_SHOT + 26]);
    let legacy = Saved {
        flags: saved.flags.clone(),
        animations: saved.animations.clone(),
        spatial: saved.spatial.clone(),
        rotations: saved.rotations.clone(),
        combat: legacy,
    };
    assert!(!restore(&mut engine, &handles, &legacy));
    assert!(engine.world.is_current_entity(original));
}

#[test]
fn nonlooping_projectiles_keep_the_last_frame_and_static_rotation_has_no_playback() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 10);
    assert!(visual_config(
        &mut engine,
        actor,
        enemy,
        71,
        false,
        true,
        false
    ));
    engine.update(0.5);
    let bullet = shots(&engine)[0];
    engine.update(0.3);
    let playback = engine.world.sprite_playbacks[bullet.id as usize]
        .as_ref()
        .unwrap();
    assert!(playback.finished());
    assert_eq!(playback.frame_index(), 1);
    let saved = capture(&engine, &handles);
    assert!(restore(&mut engine, &handles, &saved));
    assert_eq!(capture(&engine, &handles).combat, saved.combat);
    assert!(visual_config(
        &mut engine,
        actor,
        enemy,
        71,
        false,
        false,
        true
    ));
    engine.update(0.5);
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat[0], 4.);
    assert!(saved.combat[FIRST_SHOT + 26..FIRST_SHOT + 32]
        .iter()
        .all(|&v| v == 0.));
    assert!(!engine.spatial_scene.runtime_sprite_rotations.is_empty());
    let bad = altered(&saved, FIRST_SHOT + 26, 1.);
    assert!(!restore(&mut engine, &handles, &bad));
}

fn projected(matrix: [f32; 16], point: [f32; 3]) -> [f64; 2] {
    let clip: [f64; 4] = std::array::from_fn(|r| {
        (0..3)
            .map(|i| f64::from(matrix[i * 4 + r]) * f64::from(point[i]))
            .sum::<f64>()
            + f64::from(matrix[12 + r])
    });
    [clip[0] / clip[3], clip[1] / clip[3]]
}

#[test]
fn projectile_roll_matches_actual_projected_velocity_for_both_cameras_and_pixel_presentations() {
    for perspective in [0., 1.] {
        for pixel in [false, true] {
            let mut engine = Engine::new();
            let (actor, enemy, _) = setup(&mut engine, 10);
            assert!(visual_config(
                &mut engine,
                actor,
                enemy,
                71,
                true,
                false,
                true
            ));
            assert!(engine.configure_spatial_camera(&[
                perspective,
                250.,
                180.,
                350.,
                100.,
                10.,
                -100.,
                if perspective == 0. {
                    400.
                } else {
                    std::f32::consts::FRAC_PI_3
                },
                0.1,
                2000.,
                800.,
                480.
            ]));
            if pixel {
                let mut env = [0.; 112];
                env[0] = 16.;
                env[2] = -1.;
                env[60..76].copy_from_slice(&[
                    100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
                ]);
                env[80] = 320.;
                env[81] = 180.;
                env[82] = 1.;
                assert!(engine.configure_spatial_environment(&env));
            }
            engine.update(0.5);
            let bullet = shots(&engine)[0];
            for velocity in [
                Velocity { vx: 100., vy: 40. },
                Velocity { vx: -40., vy: 80. },
                Velocity { vx: 0., vy: -60. },
            ] {
                engine.world.set_velocity(bullet, velocity);
                engine.update(0.);
                let angle = engine.spatial_scene.runtime_sprite_rotation(bullet);
                assert!(angle.is_finite());
                assert_eq!(
                    engine
                        .world
                        .sprite_at_index(bullet.id as usize)
                        .unwrap()
                        .rotation_radians,
                    0.
                );
                assert_eq!(
                    engine
                        .world
                        .rotation_at_index_or_default(bullet.id as usize)
                        .radians,
                    0.
                );
                let vertices = &engine.spatial_scene.billboards;
                let quad = vertices
                    .chunks_exact(6)
                    .find(|q| q[0].texture == 71.)
                    .unwrap();
                let camera = engine
                    .spatial_scene
                    .presented_camera([800., 480.])
                    .unwrap()
                    .0;
                let left =
                    std::array::from_fn(|i| (quad[0].position[i] + quad[5].position[i]) * 0.5);
                let a = projected(camera.matrix, left);
                let right =
                    std::array::from_fn(|i| (quad[1].position[i] + quad[2].position[i]) * 0.5);
                let b = projected(camera.matrix, right);
                let at = engine.world.transform(bullet).unwrap();
                let span = engine.world.height_span(bullet).unwrap();
                let elevation = span.elevation
                    + engine
                        .spatial_scene
                        .runtime_billboards
                        .iter()
                        .find(|(e, _)| *e == bullet)
                        .unwrap()
                        .1
                        .elevation;
                let p = projected(camera.matrix, [at.x, elevation, -at.y]);
                let next = projected(
                    camera.matrix,
                    [
                        at.x + velocity.vx * 0.001,
                        elevation,
                        -at.y - velocity.vy * 0.001,
                    ],
                );
                let edge = [b[0] - a[0], b[1] - a[1]];
                let d = [next[0] - p[0], next[1] - p[1]];
                let cosine =
                    (edge[0] * d[0] + edge[1] * d[1]) / (edge[0].hypot(edge[1]) * d[0].hypot(d[1]));
                assert!(
                    cosine > 0.999,
                    "cosine={cosine}, angle={angle}, perspective={perspective}, pixel={pixel}"
                );
            }
            engine.world.set_velocity(bullet, Velocity::default());
            engine.update(0.);
            assert_eq!(engine.spatial_scene.runtime_sprite_rotation(bullet), 0.);
        }
    }
}

#[test]
fn flat_projectile_orientation_uses_render_projection_and_clears_retired_generations() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 10);
    engine.clear_spatial_scene();
    engine.camera.ground_y_scale = 0.5;
    engine.camera.x = 100.;
    engine.camera.y = 100.;
    assert!(visual_config(
        &mut engine,
        actor,
        enemy,
        71,
        true,
        false,
        true
    ));
    engine.update(0.5);
    let bullet = shots(&engine)[0];
    engine
        .world
        .set_velocity(bullet, Velocity { vx: 100., vy: 100. });
    engine.update(0.);
    let expected = 0.5_f32.atan();
    assert!((engine.spatial_scene.runtime_sprite_rotation(bullet) - expected).abs() < 1e-6);
    let command = engine
        .frame_buffers
        .render_commands
        .iter()
        .find(|c| c.texture_id == 71.)
        .unwrap_or_else(|| {
            panic!(
                "missing projectile command: {:?}, camera {:?}, sprite {:?}",
                engine.frame_buffers.render_commands,
                engine.camera,
                engine.world.sprite_at_index(bullet.id as usize)
            )
        });
    assert!((command.rotation_radians - expected).abs() < 1e-6);
    assert_eq!(
        engine
            .world
            .sprite_at_index(bullet.id as usize)
            .unwrap()
            .rotation_radians,
        0.
    );
    let saved = capture(&engine, &handles);
    assert!(restore(&mut engine, &handles, &saved));
    engine.update(0.);
    let fresh = shots(&engine)[0];
    assert_ne!(fresh, bullet);
    assert_eq!(engine.spatial_scene.runtime_sprite_rotation(bullet), 0.);
    assert!((engine.spatial_scene.runtime_sprite_rotation(fresh) - expected).abs() < 1e-6);
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    assert!(engine.spatial_scene.runtime_sprite_rotations.is_empty());
    assert!(shots(&engine).is_empty());
}

#[test]
fn animated_shots_from_spawned_sources_restore_with_the_actor_catalog() {
    fn configure(engine: &mut Engine, actor: Entity, enemy: Entity, texture: u32) {
        assert!(engine.configure_spatial_terrain(
            &[0., 0., 300., 200., 8., 8., 8., 1., 1., 1., 1.],
            &[1, 0, 16_777_215, 1]
        ));

        assert!(engine.set_gameplay_action_projectile_with_target(
            enemy.id,
            enemy.generation,
            31,
            0.5,
            10.,
            3.,
            3.,
            1,
            1,
            0
        ));
        assert!(engine.set_gameplay_action_spawn_prefab(
            actor.id,
            actor.generation,
            77,
            0.,
            1000,
            0,
            0,
            -40.,
            0.
        ));
        assert!(engine.set_input_action_binding(
            77,
            0,
            crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
            crate::input::INPUT_ACTION_ACTIVATION_PRESSED
        ));
        assert!(engine.configure_data_scene_gameplay_v8(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &[1, texture],
            &[12., 4., 0., 0., 0.5, 1., 2., 2., 1., 0.1, 3., 1., 1., 1., 1.],
            &[enemy.id, enemy.generation, 31, 1],
            &[],
            &[],
            &[],
            0,
            &[1000, enemy.id, enemy.generation],
            &[1, 2, 1, 1],
            &[3.],
            &[0., 0., 0.5, 1., 1., 0., 0.5, 1.]
        ));
    }
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 10);
    configure(&mut engine, actor, enemy, 71);
    assert!(engine.despawn_physics_entity(enemy.id, enemy.generation));
    engine.set_input(false, false, false, false, false, false, true, -1., -1.);
    engine.update(0.01);
    engine.set_input(false, false, false, false, false, false, false, -1., -1.);
    engine.update(0.5);
    assert_eq!(shots(&engine).len(), 1);
    let saved = capture(&engine, &handles);
    assert_eq!(&saved.combat[..7], &[4., 2., 1., 0., 1., 1., 1.]);
    let offset = 7 + 144 + 89;
    assert_eq!(saved.combat[offset], 2.);
    assert_eq!(saved.combat[offset + 26], 1.);
    let (fresh_actor, fresh_enemy, fresh) = setup(&mut engine, 20);
    configure(&mut engine, fresh_actor, fresh_enemy, 91);
    assert!(restore(&mut engine, &fresh, &saved));
    assert_eq!(capture(&engine, &fresh).combat, saved.combat);
    assert_eq!(
        engine
            .world
            .sprite_at_index(shots(&engine)[0].id as usize)
            .unwrap()
            .texture_id,
        91
    );
}
