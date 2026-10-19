use super::data_scene_visuals::sprite;
use super::*;
use crate::gameplay_event::*;

fn combat() -> (Engine, Entity, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 1, 100.0, 100.0, 0);
    let enemy = sprite(&mut engine, 2, 20.0, 100.0, 0);
    engine.world.set_aabb_collider(
        enemy,
        AabbCollider::new(3.0, 3.0, true, CollisionLayer::Enemy),
    );
    engine.world.set_collision_filter(
        enemy,
        crate::components::CollisionFilter::from_layer(CollisionLayer::Enemy),
    );
    assert!(engine.set_gameplay_health(actor.id, actor.generation, 6.0));
    assert!(engine.set_gameplay_movement_chase_primary_actor(enemy.id, enemy.generation, 2.0));
    assert!(engine.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        31,
        0.0,
        400.0,
        3.0,
        2.0,
        1,
        1,
        0
    ));
    assert!(engine.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 17, 0.2, 31));
    for entity in [actor, enemy] {
        assert!(engine.world.set_height_span(
            entity,
            HeightSpan::new(PhysicsFloorId(0), 8.0, 8.0).unwrap()
        ));
    }
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    (engine, actor, enemy)
}

#[test]
fn native_combat_repeats_timer_moves_and_sweeps_projectiles_into_actual_health_and_death() {
    let (mut engine, actor, enemy) = combat();
    // Two hundred units per step crosses the entire actor instead of relying on an endpoint overlap.
    engine.update(0.5);
    assert_eq!(
        engine.world.health(actor),
        Some(3.0),
        "stats={:?} events={:?}",
        engine.data_scene_combat_stats(),
        engine.frame_buffers.gameplay_events
    );
    assert!(engine.world.transform(enemy).unwrap().x > 20.0);
    assert_eq!(engine.data_scene_combat_stats()[4], 1);
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_TIMER));
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_PREFAB_SPAWNED));
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE));
    engine.clear_events();
    engine.update(0.5);
    assert!(!engine.world.is_current_entity(actor));
    assert_eq!(engine.data_scene_combat_stats()[6], 1);
    assert_eq!(engine.data_scene_combat_stats()[2], 0);
    engine.clear_events();
    engine.update(0.5);
    assert_eq!(engine.data_scene_combat_stats()[4], 2);
    assert!(engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_ACTION_FAILED));
    assert!(!engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_PREFAB_SPAWNED));
}

#[test]
fn combat_pause_freezes_native_timers_movement_lifetimes_and_effects() {
    let (mut engine, _, enemy) = combat();
    engine.configure_fixed_timestep(true, 0.05, 1.0, 8);
    engine.update(0.11);
    let before = engine.world.transform(enemy).unwrap();
    let stats = engine.data_scene_combat_stats();
    assert!(engine.pause_data_scene());
    engine.update(2.0);
    assert_eq!(engine.world.transform(enemy), Some(before));
    assert_eq!(engine.data_scene_combat_stats(), stats);
    assert!(engine.resume_data_scene());
    engine.update(0.15);
    assert_eq!(engine.data_scene_combat_stats()[4], 1);
}

#[test]
fn combat_height_filters_no_cross_floor_damage_and_expires_bounded_projectiles() {
    let (mut engine, actor, _) = combat();
    engine
        .world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 8.0, 8.0).unwrap());
    for _ in 0..30 {
        engine.update(0.1);
    }
    assert_eq!(engine.world.health(actor), Some(6.0));
    assert!(engine.data_scene_combat_stats()[7] > 0);
    assert!(engine.data_scene_combat_stats()[2] <= 20);
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(!engine.data_scene_combat_enabled());
    assert!(engine.spatial_scene.runtime_billboards.is_empty());
    assert_eq!(engine.data_scene_combat_stats()[2], 0);
}

#[test]
fn combat_configure_and_progress_rejection_are_atomic_and_exploration_remains_legacy() {
    let (mut engine, actor, _) = combat();
    let epoch = engine.data_scene_epoch();
    let handles = [actor.id, actor.generation];
    assert!(!engine.configure_data_scene_gameplay_v2(
        true,
        actor.id,
        actor.generation + 1,
        0,
        false
    ));
    assert!(engine.data_scene_combat_enabled());
    assert!(!engine
        .capture_data_scene_progress(epoch, &handles)
        .is_empty());
    assert!(!engine
        .capture_data_scene_animation_progress(epoch, &handles)
        .is_empty());
    assert!(!engine
        .capture_data_scene_spatial_progress(epoch, &handles)
        .is_empty());
    assert!(!engine.restore_data_scene_progress(epoch, &handles, &[0]));
    assert!(!engine.restore_data_scene_progress_with_animations(epoch, &handles, &[0], &[0.0; 32]));
    assert!(!engine.restore_data_scene_progress_with_spatial(
        epoch,
        &handles,
        &[0],
        &[],
        &[0.0; 21]
    ));
    assert!(engine.world.is_current_entity(actor));
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(!engine
        .capture_data_scene_progress(epoch, &handles)
        .is_empty());
    let at = engine.world.transform(actor);
    engine.update(1.0);
    assert_eq!(engine.world.transform(actor), at);
    assert!(!engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_PREFAB_SPAWNED));
}

#[test]
fn combat_dynamic_billboards_hit_particles_preserve_target_height_without_authored_revision_changes(
) {
    let (mut engine, actor, enemy) = combat();
    assert!(engine.configure_spatial_camera(&[
        0.0, 60.0, 150.0, 180.0, 60.0, 8.0, -100.0, 300.0, 0.1, 1000.0, 800.0, 480.0
    ]));
    assert!(engine.configure_spatial_billboards(
        &[actor.id, actor.generation, enemy.id, enemy.generation],
        &[1.0, 0.01, 0.0, 1.0, 0.01, 0.0]
    ));
    let revision = engine.spatial_scene.revision;
    engine
        .particle_presets
        .push(Some(crate::particles::ParticlePreset::new(99)));
    assert!(engine.add_gameplay_collision_particle(actor.id, actor.generation, 0, 0));
    assert!(engine.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 17, 0.1, 31));
    engine.update(0.1);
    assert_eq!(engine.data_scene_combat_stats()[2], 1);
    assert_eq!(engine.spatial_scene.runtime_billboards.len(), 1);
    let projectile = engine.spatial_scene.runtime_billboards[0].0;
    assert_eq!(
        engine.world.height_span(projectile).unwrap().elevation,
        12.0
    );
    assert_eq!(engine.frame_buffers.render_commands.len(), 0);
    engine.update(0.1);
    assert!(engine.data_scene_combat_stats()[9] > 0);
    assert!(engine.particle_count() > 0);
    assert_eq!(engine.spatial_scene.revision, revision);
    assert!(engine
        .spatial_scene
        .billboards
        .iter()
        .any(|v| v.texture == 99.0));
    assert!(engine
        .frame_buffers
        .render_commands
        .iter()
        .all(|c| c.texture_id != 99.0));
    // Reconfiguration owns only the generations it spawned, never a replacement entity.
    engine.world.despawn(projectile);
    let replacement = engine.world.spawn_entity();
    engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0);
    assert!(engine.world.is_current_entity(replacement));
    engine.use_data_scene();
    assert_eq!(
        engine.data_scene_combat_stats(),
        vec![1, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    );
    assert!(engine.spatial_scene.runtime_billboards.is_empty());
}

#[test]
fn combat_event_only_timer_stays_one_shot_and_action_sources_are_bounded_per_step() {
    let (mut engine, actor, enemy) = combat();
    assert!(engine.set_gameplay_timer_trigger(actor.id, actor.generation, 99, 0.1));
    engine.update(1.0);
    assert_eq!(engine.data_scene_combat_stats()[4], 1);
    assert_eq!(
        engine
            .frame_buffers
            .gameplay_events
            .iter()
            .filter(|e| e.kind == GAMEPLAY_EVENT_TIMER && e.token_id == 99)
            .count(),
        1
    );
    engine.clear_events();
    engine.update(1.0);
    assert!(!engine
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|e| e.kind == GAMEPLAY_EVENT_TIMER && e.token_id == 99));
    assert!(engine.world.is_current_entity(enemy));
}

#[test]
fn combat_spatial_trigger_ai_moves_with_native_terrain_height_and_single_integration() {
    for automatic in [false, true] {
        let (mut engine, _, enemy) = combat();
        engine.auto_rigid_body_step_enabled = automatic;
        assert!(engine.configure_data_scene_body(enemy.id, enemy.generation, 1, true, 0, 8.0, 8.0));
        assert!(engine.configure_spatial_terrain(
            &[-500.0, -500.0, 1000.0, 1000.0, 0.0, 8.0, 8.0, 1.0, 1.0, 1.0, 1.0],
            &[1, 0, 16_777_215, 1]
        ));
        assert!(engine.configure_spatial_camera(&[
            0.0, 60.0, 150.0, 180.0, 60.0, 8.0, -100.0, 300.0, 0.1, 1000.0, 800.0, 480.0
        ]));
        engine.update(0.1);
        assert!((engine.world.transform(enemy).unwrap().x - 20.2).abs() < 0.001);
        assert_eq!(engine.world.height_span(enemy).unwrap().elevation, 8.0);
        assert!(engine.world.collider(enemy).unwrap().is_trigger);
        assert_eq!(
            engine
                .world
                .velocity_at_index_or_default(enemy.id as usize)
                .vx,
            2.0
        );
    }
}

#[test]
fn combat_projectile_queue_and_dense_pairs_are_bounded_and_expired_slots_are_reusable() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 1, 500.0, 0.0, 0);
    engine
        .world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0).unwrap());
    for _ in 0..513 {
        let enemy = engine.world.spawn_enemy_from_template(
            0.0,
            0.0,
            2,
            crate::world::EntityTemplate::new(2.0, 2.0),
            1.0,
            0,
        );
        engine
            .world
            .set_height_span(enemy, HeightSpan::new(PhysicsFloorId(0), 0.0, 8.0).unwrap());
        assert!(engine.set_gameplay_action_projectile_with_target(
            enemy.id,
            enemy.generation,
            31,
            0.0,
            1.0,
            1.0,
            0.5,
            1,
            1,
            0
        ));
        assert!(engine.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 17, 0.1, 31));
    }
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    engine.update_frame(0.1, false, false, false);
    let stats = engine.data_scene_combat_stats();
    assert_eq!(stats[4], 512);
    assert_eq!(stats[2], 512);
    assert!(stats[8] >= 2); // queue and dense pair caps
    let capacity = engine.world.entity_capacity();
    engine.clear_events();
    engine.update_frame(0.1, false, false, false);
    assert_eq!(engine.data_scene_combat_stats()[4], 512);
    assert!(engine.data_scene_combat_stats()[8] >= 514); // attempted projectile overflow
    engine.clear_events();
    engine.update_frame(0.5, false, false, false);
    assert_eq!(engine.data_scene_combat_stats()[2], 0);
    engine.clear_events();
    engine.update_frame(0.1, false, false, false);
    assert_eq!(engine.data_scene_combat_stats()[2], 512);
    assert_eq!(engine.world.entity_capacity(), capacity);
}

#[test]
fn combat_reuses_a_dead_slot_at_the_exact_total_entity_limit() {
    let (mut engine, actor, _) = combat();
    engine
        .world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 8.0, 8.0).unwrap());
    let mut last = actor;
    while engine.world.entity_capacity() < 2048 {
        last = engine.world.spawn_entity();
    }
    engine.update_frame(0.2, false, false, false);
    assert_eq!(engine.data_scene_combat_stats()[4], 0);
    assert!(engine.data_scene_combat_stats()[8] > 0);
    engine.world.despawn(last);
    engine.clear_events();
    engine.update_frame(0.2, false, false, false);
    assert_eq!(engine.data_scene_combat_stats()[4], 1);
    assert_eq!(engine.world.entity_capacity(), 2048);
    assert_eq!(engine.data_scene_combat_stats()[2], 1);
}

#[test]
fn combat_emit_effect_preserves_public_payload_and_position() {
    let (mut engine, actor, _) = combat();
    assert!(engine.add_gameplay_collision_emit_effect_with_payload(
        actor.id,
        actor.generation,
        77,
        GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
        0,
        0.0,
        0,
        0.25,
        64.0
    ));
    engine.update(0.5);
    let effect = engine
        .frame_buffers
        .effect_events
        .iter()
        .find(|e| e.effect_id == 77)
        .unwrap();
    assert_eq!((effect.intensity, effect.radius), (0.25, 64.0));
    assert_eq!((effect.x, effect.y), (100.0, 100.0));
}

#[test]
fn combat_preserves_exploration_custom_and_score_pickups_without_duplicate_events() {
    for item in [1, 42] {
        let (mut engine, actor, _) = combat();
        let pickup = sprite(&mut engine, 3, 100.0, 100.0, 0);
        engine.world.set_aabb_collider(
            pickup,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        engine.world.set_collision_filter(
            pickup,
            crate::components::CollisionFilter::from_layer(CollisionLayer::Pickup),
        );
        engine.world.set_height_span(
            pickup,
            HeightSpan::new(PhysicsFloorId(0), 8.0, 8.0).unwrap(),
        );
        assert!(engine.set_gameplay_pickup(pickup.id, pickup.generation, item, 3, true));
        engine.world.add_collision_reaction(
            actor,
            crate::components::gameplay::CollisionReaction::Pickup {
                target: crate::components::gameplay::CollisionTarget::OtherEntity,
            },
        );
        engine.update(0.02);
        assert_eq!(
            engine.frame_buffers.gameplay_events,
            vec![GameplayEvent::pickup_collected(
                actor, pickup, item, 3, true
            )]
        );
        assert!(!engine.world.is_current_entity(pickup));
        engine.clear_events();
        engine.update(0.02);
        assert!(engine.frame_buffers.gameplay_events.is_empty());
    }
}

#[test]
fn combat_reconfigure_rejects_owned_projectile_actor_before_cleanup() {
    let (mut engine, actor, enemy) = combat();
    assert!(engine.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        31,
        0.0,
        1.0,
        3.0,
        2.0,
        1,
        1,
        0
    ));
    engine.update(0.2);
    let spawned = engine
        .frame_buffers
        .gameplay_events
        .iter()
        .find(|event| event.kind == GAMEPLAY_EVENT_PREFAB_SPAWNED)
        .unwrap();
    let projectile = Entity {
        id: spawned.actor_id,
        generation: spawned.actor_generation,
    };
    assert!(engine.world.is_current_entity(projectile));
    let stats = engine.data_scene_combat_stats();
    let alive = engine.world.alive_count();
    for combat_enabled in [false, true] {
        assert!(!engine.configure_data_scene_gameplay_v2(
            true,
            projectile.id,
            projectile.generation,
            0,
            combat_enabled
        ));
        assert!(engine.world.is_current_entity(projectile));
        assert_eq!(engine.world.primary_actor_entity(), Some(actor));
        assert!(engine.data_scene_combat_enabled());
        assert_eq!(engine.data_scene_combat_stats(), stats);
        assert_eq!(engine.world.alive_count(), alive);
    }
}
