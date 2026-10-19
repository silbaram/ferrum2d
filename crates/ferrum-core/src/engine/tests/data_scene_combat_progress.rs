use super::data_scene_visuals::sprite;
use super::*;

fn setup(engine: &mut Engine, texture: u32) -> (Entity, Entity, Vec<u32>) {
    engine.use_data_scene();
    let actor = sprite(engine, texture, 200., 100., 0);
    let enemy = sprite(engine, texture + 1, 20., 100., 0);
    engine.world.set_aabb_collider(
        enemy,
        AabbCollider::new(4., 4., true, CollisionLayer::Enemy),
    );
    engine
        .world
        .set_collision_filter(enemy, CollisionFilter::from_layer(CollisionLayer::Enemy));
    assert!(engine.set_gameplay_health(actor.id, actor.generation, 12.));
    for e in [actor, enemy] {
        assert!(engine.configure_data_scene_body(e.id, e.generation, 1, true, 0, 8., 8.));
    }
    assert!(engine.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        31,
        0.5,
        100.,
        3.,
        3.,
        1,
        1,
        0
    ));
    assert!(engine.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 17, 0.5, 31));
    assert!(engine.configure_spatial_camera(&[
        0., 100., 200., 300., 100., 0., 100., 400., 0.1, 2000., 800., 480.
    ]));
    assert!(engine.configure_spatial_billboards(
        &[actor.id, actor.generation, enemy.id, enemy.generation],
        &[1., 0.01, 2., 1., 0.01, 7.]
    ));
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    (
        actor,
        enemy,
        vec![actor.id, actor.generation, enemy.id, enemy.generation],
    )
}

struct Saved {
    flags: Vec<u32>,
    animations: Vec<f64>,
    spatial: Vec<f64>,
    rotations: Vec<f64>,
    combat: Vec<f64>,
}
fn capture(engine: &Engine, handles: &[u32]) -> Saved {
    let epoch = engine.data_scene_epoch();
    let saved = Saved {
        flags: engine.capture_data_scene_progress(epoch, handles),
        animations: engine.capture_data_scene_animation_progress(epoch, handles),
        spatial: engine.capture_data_scene_spatial_progress(epoch, handles),
        rotations: engine.capture_data_scene_spatial_rotations(epoch, handles),
        combat: engine.capture_data_scene_combat_progress(epoch, handles),
    };
    assert!(!saved.combat.is_empty());
    assert!(engine.preflight_data_scene_combat_progress(&saved.flags, &saved.combat));
    saved
}
fn restore(engine: &mut Engine, handles: &[u32], saved: &Saved) -> bool {
    engine.restore_data_scene_progress_with_combat(
        engine.data_scene_epoch(),
        handles,
        &saved.flags,
        &saved.animations,
        &saved.spatial,
        &[],
        &saved.rotations,
        false,
        &saved.combat,
    )
}
fn bullet(engine: &Engine) -> Entity {
    find_layer(engine, CollisionLayer::Bullet)
}

#[test]
fn checkpoint_midflight_roundtrip_uses_fresh_generations_and_texture_then_hits() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 10);
    engine.update(0.5);
    let original = bullet(&engine);
    let before = engine.world.transform(original).unwrap();
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat.len(), 4 + 2 * 72 + 25);
    assert_eq!(saved.combat[2], 1.);
    let (fresh_actor, fresh_enemy, fresh) = setup(&mut engine, 90);
    assert_ne!(actor, fresh_actor);
    assert_ne!(enemy, fresh_enemy);
    assert!(restore(&mut engine, &fresh, &saved));
    let restored = bullet(&engine);
    assert_ne!(restored, original);
    assert_eq!(engine.world.transform(restored), Some(before));
    assert_eq!(
        engine
            .world
            .sprite_at_index(restored.id as usize)
            .unwrap()
            .texture_id,
        91
    );
    assert_eq!(engine.spatial_scene.runtime_billboards[0].1.elevation, 7.);
    engine.update(1.5);
    assert!(engine.world.health(fresh_actor).unwrap() < 12.);
}

#[test]
fn checkpoint_keeps_projectile_after_source_dies_and_remaps_texture_before_removal() {
    let mut engine = Engine::new();
    let (_, source, handles) = setup(&mut engine, 10);
    engine.update(0.5);
    engine.world.despawn(source);
    let saved = capture(&engine, &handles);
    assert_eq!(saved.flags[1], 0);
    assert_eq!(saved.combat[4 + 72], 0.);
    let (actor, fresh_source, fresh) = setup(&mut engine, 70);
    assert!(restore(&mut engine, &fresh, &saved));
    assert!(!engine.world.is_current_entity(fresh_source));
    assert_eq!(
        engine
            .world
            .sprite_at_index(bullet(&engine).id as usize)
            .unwrap()
            .texture_id,
        71
    );
    // The removed owner's id may be reused, but its generation is never rebound.
    engine.update(1.5);
    assert_eq!(engine.world.health(actor), Some(9.));
}

#[test]
fn checkpoint_preserves_health_timer_action_and_reaction_cooldowns_and_flipped_uvs() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 2);
    engine.world.add_collision_reaction(
        actor,
        CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::SelfEntity,
            cooldown: Cooldown::ready(0.7),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    );
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    let sprite = engine.world.sprite_mut_at_index(enemy.id as usize).unwrap();
    sprite.u0 = 1.;
    sprite.u1 = 0.;
    engine.update(0.5);
    engine.update(0.1);
    engine.world.set_health(actor, 7.);
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat[4 + 72 + 25], 0.4f32 as f64);
    let shot_uv = engine
        .world
        .sprite_at_index(bullet(&engine).id as usize)
        .unwrap();
    assert!(shot_uv.u0 > shot_uv.u1);
    let (a, e, fresh) = setup(&mut engine, 42);
    engine.world.add_collision_reaction(
        a,
        CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::SelfEntity,
            cooldown: Cooldown::ready(0.7),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
    );
    assert!(engine.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
    assert!(restore(&mut engine, &fresh, &saved));
    assert_eq!(engine.world.health(a), Some(7.));
    assert!(
        (engine
            .world
            .gameplay_timer_trigger(e)
            .unwrap()
            .remaining_seconds
            - 0.4)
            .abs()
            < 0.001
    );
    assert!(
        (engine
            .world
            .action_binding(e, 31)
            .unwrap()
            .cooldown
            .remaining_seconds
            - 0.4)
            .abs()
            < 0.001
    );
    assert_eq!(
        engine
            .world
            .sprite_at_index(bullet(&engine).id as usize)
            .unwrap()
            .u0,
        1.
    );
    let spawned = engine.data_scene_combat_stats()[4];
    engine.update(0.2);
    assert_eq!(engine.data_scene_combat_stats()[4], spawned);
    engine.update(0.21);
    assert!(engine.data_scene_combat_stats()[4] > spawned);
}

#[test]
fn checkpoint_malformed_native_payloads_and_stale_handles_never_mutate() {
    let mut engine = Engine::new();
    let (_, _, handles) = setup(&mut engine, 2);
    engine.update(0.5);
    let original = capture(&engine, &handles);
    let before = engine.world.snapshot();
    for (offset, bad) in [
        (0, 2.),
        (2, 513.),
        (3, 4097.),
        (4 + 22, 1.),
        (4 + 13, f64::NAN),
        (4 + 72 + 25, -1.),
        (4 + 144, 2.),
    ] {
        let mut saved = Saved {
            flags: original.flags.clone(),
            animations: original.animations.clone(),
            spatial: original.spatial.clone(),
            rotations: original.rotations.clone(),
            combat: original.combat.clone(),
        };
        saved.combat[offset] = bad;
        assert!(!restore(&mut engine, &handles, &saved), "offset={offset}");
        assert_eq!(engine.world.snapshot(), before);
    }
    let mut stale = handles.clone();
    stale[1] += 1;
    assert!(!restore(&mut engine, &stale, &original));
    assert_eq!(engine.world.snapshot(), before);
    let mut bad = original;
    bad.spatial[1] = f64::NAN;
    assert!(!restore(&mut engine, &handles, &bad));
    assert_eq!(engine.world.snapshot(), before);
}

#[test]
fn checkpoint_reset_discards_input_accumulator_events_particles_and_statistics() {
    let mut engine = Engine::new();
    let (_, _, handles) = setup(&mut engine, 2);
    engine.configure_fixed_timestep(true, 0.1, 1., 8);
    engine.update(0.55);
    assert!(engine.fixed_timestep.accumulated_seconds() > 0.);
    let saved = capture(&engine, &handles);
    assert!(engine.pause_data_scene());
    engine.set_input(false, false, false, false, true, false, true, 80., 90.);
    assert!(restore(&mut engine, &handles, &saved));
    assert_eq!(engine.fixed_timestep.accumulated_seconds(), 0.);
    assert_eq!(engine.input, crate::input::InputState::default());
    assert!(engine.frame_buffers.gameplay_events.is_empty());
    assert_eq!(&engine.data_scene_combat_stats()[3..], &[0; 7]);
    let before = engine.world.snapshot();
    engine.update(0.5);
    assert_eq!(engine.world.snapshot(), before);
    assert!(engine.resume_data_scene());
    engine.update(0.05);
    assert_eq!(engine.world.snapshot(), before);
}

#[test]
fn checkpoint_capture_rejects_unowned_entities_and_unsupported_static_edits() {
    let mut engine = Engine::new();
    let (_, enemy, handles) = setup(&mut engine, 2);
    let extra = sprite(&mut engine, 4, 400., 400., 0);
    assert!(engine
        .capture_data_scene_combat_progress(engine.data_scene_epoch(), &handles)
        .is_empty());
    engine.world.despawn(extra);
    engine.world.set_damage(enemy, 999.);
    assert!(engine
        .capture_data_scene_combat_progress(engine.data_scene_epoch(), &handles)
        .is_empty());
}

fn enter_effect(engine: &mut Engine, actor: Entity) {
    engine.world.add_collision_reaction(
        actor,
        CollisionReaction::EmitEffect {
            effect_id: 88,
            effect_type: GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
            target: CollisionTarget::SelfEntity,
            intensity: 1.,
            radius: 4.,
            cooldown: Cooldown::ready(0.),
            trigger: CollisionReactionTrigger::Enter,
        },
    );
}

#[test]
fn checkpoint_preserves_previous_contacts_so_enter_effect_does_not_replay() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 2);
    enter_effect(&mut engine, actor);
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    engine
        .world
        .set_transform(enemy, engine.world.transform(actor).unwrap());
    engine.update(0.01);
    assert_eq!(engine.frame_buffers.effect_events.len(), 1);
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat[3], 1.);
    let (a, e, fresh) = setup(&mut engine, 20);
    enter_effect(&mut engine, a);
    assert!(engine.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
    assert!(restore(&mut engine, &fresh, &saved));
    engine.update(0.01);
    assert!(engine.frame_buffers.effect_events.is_empty());
    engine
        .world
        .set_transform(e, Transform2D { x: 400., y: 100. });
    engine.update(0.01);
    engine
        .world
        .set_transform(e, engine.world.transform(a).unwrap());
    engine.update(0.01);
    assert_eq!(engine.frame_buffers.effect_events.len(), 1);
}

#[test]
fn checkpoint_projectile_capacity_is_exact_and_overflow_is_atomic() {
    let mut engine = Engine::new();
    let (_, _, handles) = setup(&mut engine, 2);
    engine.update(0.5);
    let mut saved = capture(&engine, &handles);
    let shot = saved.combat[4 + 144..].to_vec();
    saved.combat[2] = 512.;
    saved.combat.truncate(4 + 144);
    for _ in 0..512 {
        saved.combat.extend_from_slice(&shot);
    }
    assert!(restore(&mut engine, &handles, &saved));
    assert_eq!(engine.data_scene_combat_stats()[2], 512);
    let before = engine.world.snapshot();
    saved.combat[2] = 513.;
    saved.combat.extend_from_slice(&shot);
    assert!(!engine.preflight_data_scene_combat_progress(&saved.flags, &saved.combat));
    assert!(!restore(&mut engine, &handles, &saved));
    assert_eq!(engine.world.snapshot(), before);
}

#[test]
fn checkpoint_runtime_height_span_changes_restore_using_authored_body() {
    let mut engine = Engine::new();
    let (actor, _, handles) = setup(&mut engine, 2);
    engine.world.clear_height_span(actor);
    let saved = capture(&engine, &handles);
    let (a, _, fresh) = setup(&mut engine, 20);
    assert!(restore(&mut engine, &fresh, &saved));
    assert!(engine.world.height_span(a).is_none());
    // A body may receive a span after authoring and still checkpoint correctly.
    engine
        .world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId(4), 33., 9.).unwrap());
    let added = capture(&engine, &fresh);
    let (a2, _, next) = setup(&mut engine, 30);
    engine.world.clear_height_span(a2);
    assert!(restore(&mut engine, &next, &added));
    assert_eq!(engine.world.height_span(a2).unwrap().elevation, 33.);
}

#[test]
fn checkpoint_world_capacity_reuses_removed_authored_slot_at_2048() {
    let mut engine = Engine::new();
    let (actor, _, mut handles) = setup(&mut engine, 2);
    engine.update(0.5);
    let seed = capture(&engine, &handles).combat[4 + 144..].to_vec();
    // Reconfigure retires the seed bullet; fill the authored scene to its exact bound.
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    for _ in 2..2048 {
        let e = sprite(&mut engine, 1, 400., 400., 0);
        handles.extend([e.id, e.generation]);
    }
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    let mut saved = capture(&engine, &handles);
    saved.combat[2] = 1.;
    saved.combat.extend_from_slice(&seed);
    assert!(!engine.preflight_data_scene_combat_progress(&saved.flags, &saved.combat));
    saved.flags[2047] = 0;
    saved.combat[4 + 2047 * 72..4 + 2048 * 72].fill(0.);
    assert!(restore(&mut engine, &handles, &saved));
    assert_eq!(engine.world.alive_count(), 2048);
    assert!(engine.world.alive_indices().iter().all(|&i| i < 2048));
}

#[test]
fn checkpoint_static_gameplay_guard_allows_consumed_but_rejects_definition_edits() {
    for change in 0..4 {
        let mut engine = Engine::new();
        let (actor, _, handles) = setup(&mut engine, 2);
        engine
            .world
            .set_interaction(actor, Interaction::new(77, 24., true));
        assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
        engine
            .world
            .interaction_mut_at_index(actor.id as usize)
            .unwrap()
            .consumed = true;
        assert!(!engine
            .capture_data_scene_combat_progress(engine.data_scene_epoch(), &handles)
            .is_empty());
        match change {
            0 => engine
                .world
                .set_gameplay_tags(actor, GameplayTags::new(8).unwrap()),
            1 => {
                engine.world.set_score_reward(actor, 100);
            }
            2 => {
                engine.world.set_pickup(actor, Pickup::new(4, 2, true));
            }
            _ => {
                engine
                    .world
                    .set_interaction(actor, Interaction::new(88, 24., true));
            }
        }
        assert!(engine
            .capture_data_scene_combat_progress(engine.data_scene_epoch(), &handles)
            .is_empty());
    }
}

#[test]
fn checkpoint_projectile_decode_and_capture_share_canonical_f32_constraints() {
    let mut engine = Engine::new();
    let (_, _, handles) = setup(&mut engine, 2);
    engine.update(0.5);
    let saved = capture(&engine, &handles);
    for (index, value) in [(11, 5.), (8, 1e-50), (17, 1e-50), (19, 1e-50), (15, 1e-50)] {
        let mut values = saved.combat.clone();
        values[4 + 144 + index] = value;
        assert!(
            !engine.preflight_data_scene_combat_progress(&saved.flags, &values),
            "field={index}"
        );
    }
    assert!(restore(&mut engine, &handles, &saved));
    let recaptured = capture(&engine, &handles);
    assert_eq!(saved.combat, recaptured.combat);
}

fn prefab_values() -> [f32; 15] {
    [
        12., 8., 0.75, 0.25, 0.25, 0.75, 6., 3., 0.75, 0.25, 5., 0.2, 0.4, 0.8, 0.9,
    ]
}
fn configure_prefab(engine: &mut Engine, actor: Entity, enemy: Entity, texture: u32) -> bool {
    engine.configure_data_scene_gameplay_v3(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[1, texture],
        &prefab_values(),
        &[enemy.id, enemy.generation, 31, 1],
    )
}

#[test]
fn projectile_prefab_spawns_its_texture_uv_tint_size_collider_and_spatial_style() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 2);
    assert!(configure_prefab(&mut engine, actor, enemy, 700));
    engine.update(0.5);
    let shot = bullet(&engine);
    let sprite = engine.world.sprite_at_index(shot.id as usize).unwrap();
    assert_eq!(sprite.texture_id, 700);
    assert_eq!(
        [
            sprite.width,
            sprite.height,
            sprite.u0,
            sprite.v0,
            sprite.u1,
            sprite.v1
        ],
        prefab_values()[..6]
    );
    assert_eq!(
        [sprite.r, sprite.g, sprite.b, sprite.a],
        prefab_values()[11..]
    );
    let collider = engine.world.collider(shot).unwrap();
    assert_eq!([collider.half_width, collider.half_height], [6., 3.]);
    let style = engine
        .spatial_scene
        .runtime_billboards
        .iter()
        .find(|(e, _)| *e == shot)
        .unwrap()
        .1;
    assert_eq!(
        [style.units_per_pixel, style.cutoff, style.elevation],
        [0.75, 0.25, 12.]
    );
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat.len(), 4 + 2 * 72 + 26);
    assert_eq!(saved.combat[0], 2.);
    assert_eq!(saved.combat[4 + 2 * 72 + 25], 1.);
    engine.update(1.5);
    assert!(engine.world.health(actor).unwrap() < 12.);
}

#[test]
fn projectile_prefab_checkpoint_remaps_its_asset_even_after_its_source_dies() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 2);
    assert!(configure_prefab(&mut engine, actor, enemy, 700));
    engine.update(0.5);
    engine.world.despawn(enemy);
    let saved = capture(&engine, &handles);
    let (actor, enemy, fresh) = setup(&mut engine, 80);
    assert!(configure_prefab(&mut engine, actor, enemy, 900));
    assert!(restore(&mut engine, &fresh, &saved));
    assert!(!engine.world.is_current_entity(enemy));
    let sprite = engine
        .world
        .sprite_at_index(bullet(&engine).id as usize)
        .unwrap();
    assert_eq!(sprite.texture_id, 900);
    assert_eq!(
        [sprite.r, sprite.g, sprite.b, sprite.a],
        prefab_values()[11..]
    );
    assert_eq!(capture(&engine, &fresh).combat, saved.combat);
    engine.update(1.5);
    assert_eq!(engine.world.health(actor), Some(9.));
}

#[test]
fn projectile_prefab_configuration_preflights_every_record_before_retiring_live_bullets() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 2);
    assert!(configure_prefab(&mut engine, actor, enemy, 700));
    engine.update(0.5);
    let before = capture(&engine, &handles).combat;
    let shot = bullet(&engine);
    let stats = engine.data_scene_combat_stats();
    for (slot, value) in [
        (0, 0.),
        (1, f32::INFINITY),
        (2, -1.),
        (4, 0.75),
        (6, 0.),
        (8, 10001.),
        (9, 1.1),
        (10, 1_000_001.),
        (14, -0.1),
    ] {
        let mut values = prefab_values();
        values[slot] = value;
        assert!(!engine.configure_data_scene_gameplay_v3(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &[1, 900],
            &values,
            &[enemy.id, enemy.generation, 31, 1]
        ));
        assert!(engine.world.is_current_entity(shot));
        assert_eq!(engine.data_scene_combat_stats(), stats);
        assert_eq!(capture(&engine, &handles).combat, before);
    }
    for bindings in [
        vec![enemy.id, enemy.generation + 1, 31, 1],
        vec![enemy.id, enemy.generation, 99, 1],
        vec![enemy.id, enemy.generation, 31, 2],
        vec![
            enemy.id,
            enemy.generation,
            31,
            1,
            enemy.id,
            enemy.generation,
            31,
            1,
        ],
    ] {
        assert!(!engine.configure_data_scene_gameplay_v3(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &[1, 900],
            &prefab_values(),
            &bindings
        ));
        assert_eq!(capture(&engine, &handles).combat, before);
    }
    assert!(!engine.configure_data_scene_gameplay_v3(
        true,
        actor.id,
        actor.generation + 1,
        0,
        true,
        &[1, 900],
        &prefab_values(),
        &[enemy.id, enemy.generation, 31, 1]
    ));
    assert!(engine.world.is_current_entity(shot));
}

#[test]
fn projectile_prefab_checkpoint_rejects_unknown_or_changed_definition_atomically() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 2);
    assert!(configure_prefab(&mut engine, actor, enemy, 700));
    engine.update(0.5);
    let mut saved = capture(&engine, &handles);
    let (actor, enemy, fresh) = setup(&mut engine, 80);
    assert!(configure_prefab(&mut engine, actor, enemy, 900));
    let before = capture(&engine, &fresh).combat;
    let offset = 4 + 2 * 72;
    for (slot, value) in [(25, 2.), (11, 4.), (17, 1.), (19, 1.), (13, 0.)] {
        let original = saved.combat[offset + slot];
        saved.combat[offset + slot] = value;
        assert!(!restore(&mut engine, &fresh, &saved));
        assert_eq!(capture(&engine, &fresh).combat, before);
        saved.combat[offset + slot] = original;
    }
    assert!(restore(&mut engine, &fresh, &saved));
    engine
        .world
        .sprite_mut_at_index(bullet(&engine).id as usize)
        .unwrap()
        .r = 1.;
    assert!(engine
        .capture_data_scene_combat_progress(engine.data_scene_epoch(), &fresh)
        .is_empty());
}

#[test]
fn projectile_prefab_flat_scene_checkpoint_and_legacy_reconfigure_keep_canonical_formats() {
    let mut engine = Engine::new();
    let (actor, enemy, handles) = setup(&mut engine, 2);
    engine.clear_spatial_scene();
    assert!(configure_prefab(&mut engine, actor, enemy, 700));
    engine.update(0.5);
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat[0], 2.);
    let (actor, enemy, fresh) = setup(&mut engine, 80);
    engine.clear_spatial_scene();
    assert!(configure_prefab(&mut engine, actor, enemy, 900));
    assert!(restore(&mut engine, &fresh, &saved));
    assert_eq!(capture(&engine, &fresh).combat, saved.combat);
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    assert_eq!(capture(&engine, &fresh).combat[0], 1.);
    assert_eq!(engine.data_scene_combat_progress_version(), 4);
    assert_eq!(engine.data_scene_projectile_prefabs_version(), 1);
}

#[test]
fn projectile_prefab_catalog_capacity_and_same_action_on_distinct_sources_are_independent() {
    let mut engine = Engine::new();
    let (actor, enemy, mut handles) = setup(&mut engine, 2);
    let other = sprite(&mut engine, 4, 20., 130., 0);
    engine.world.set_aabb_collider(
        other,
        AabbCollider::new(4., 4., true, CollisionLayer::Enemy),
    );
    engine
        .world
        .set_collision_filter(other, CollisionFilter::from_layer(CollisionLayer::Enemy));
    assert!(engine.configure_data_scene_body(other.id, other.generation, 1, true, 0, 8., 8.));
    assert!(engine.set_gameplay_action_projectile_with_target(
        other.id,
        other.generation,
        31,
        0.5,
        100.,
        3.,
        3.,
        1,
        1,
        0
    ));
    assert!(engine.set_gameplay_timer_action_trigger(other.id, other.generation, 17, 0.5, 31));
    handles.extend([other.id, other.generation]);
    let metadata: Vec<_> = (1..=256).flat_map(|id| [id, id + 700]).collect();
    let values = prefab_values().repeat(256);
    assert!(engine.configure_data_scene_gameplay_v3(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &metadata,
        &values,
        &[
            enemy.id,
            enemy.generation,
            31,
            256,
            other.id,
            other.generation,
            31,
            1
        ]
    ));
    engine.update(0.5);
    let mut textures: Vec<_> = engine
        .world
        .alive_indices()
        .iter()
        .filter_map(|&index| engine.world.sprite_at_index(index))
        .filter(|s| s.texture_id > 700)
        .map(|s| s.texture_id)
        .collect();
    textures.sort_unstable();
    assert_eq!(textures, [701, 956]);
    let before = capture(&engine, &handles).combat;
    for (m, v) in [
        (vec![1, 0x1000000], prefab_values().to_vec()),
        (
            (1..=257).flat_map(|id| [id, id + 700]).collect(),
            prefab_values().repeat(257),
        ),
    ] {
        assert!(!engine.configure_data_scene_gameplay_v3(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &m,
            &v,
            &[]
        ));
        assert_eq!(capture(&engine, &handles).combat, before);
    }
}

#[test]
fn projectile_prefab_checkpoint_v2_roundtrips_mixed_default_and_custom_bullets() {
    let mut engine = Engine::new();
    let configure = |engine: &mut Engine, actor: Entity, enemy: Entity, texture| {
        engine.clear_spatial_scene();
        assert!(engine.configure_data_scene_camera(
            400.,
            240.,
            u32::MAX,
            0,
            false,
            0.,
            0.,
            0.,
            0.,
            0.
        ));
        assert!(engine.set_gameplay_action_projectile_with_target(
            actor.id,
            actor.generation,
            77,
            1.,
            100.,
            1.,
            3.,
            0,
            0,
            0
        ));
        assert!(engine.set_input_action_binding(77, 0, 3, 2));
        assert!(configure_prefab(engine, actor, enemy, texture));
    };
    let (actor, enemy, handles) = setup(&mut engine, 2);
    configure(&mut engine, actor, enemy, 700);
    let aim = engine
        .camera
        .world_to_screen(engine.world.transform(enemy).unwrap());
    engine.set_input(false, false, false, false, false, false, true, aim.x, aim.y);
    engine.update(0.5);
    let saved = capture(&engine, &handles);
    assert_eq!(saved.combat[0], 2.);
    assert_eq!(
        saved.combat[2],
        2.,
        "stats={:?}, events={:?}",
        engine.data_scene_combat_stats(),
        engine.frame_buffers.gameplay_events
    );
    let offset = 4 + 2 * 72;
    assert_eq!(
        [saved.combat[offset + 25], saved.combat[offset + 26 + 25]],
        [0., 1.]
    );
    let (actor, enemy, fresh) = setup(&mut engine, 80);
    configure(&mut engine, actor, enemy, 900);
    assert!(restore(&mut engine, &fresh, &saved));
    let mut textures: Vec<_> = engine
        .world
        .alive_indices()
        .iter()
        .filter_map(|&index| {
            let entity = engine.world.entity_at_index(index)?;
            engine
                .data_scene
                .gameplay
                .combat
                .owns_projectile(entity)
                .then(|| engine.world.sprite_at_index(index).unwrap().texture_id)
        })
        .collect();
    textures.sort_unstable();
    assert_eq!(textures, [80, 900]);
    assert_eq!(capture(&engine, &fresh).combat, saved.combat);
}

#[path = "data_scene_combat_progress/projectile_visuals.rs"]
mod projectile_visuals;
