use super::*;
use crate::shooter_scene::SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET;

#[test]
fn engine_captures_and_restores_builtin_shooter_snapshot() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

    let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.damages[bullet.id as usize] = Some(1.0);
    engine.update(0.016);
    assert_eq!(engine.score(), 1);
    assert!(!engine.world.alive[enemy.id as usize]);

    let saved_enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    let saved_bullet = engine
        .world
        .spawn_bullet(120.0, 100.0, 12.0, 0.0, DEFAULT_TEXTURE_ID);
    engine.world.projectile_tile_impacts[saved_bullet.id as usize] =
        Some(ProjectileTileImpact::PassThrough);
    let saved_bullet_faction =
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap();
    engine
        .world
        .set_gameplay_faction(saved_bullet, saved_bullet_faction);
    assert!(engine.world.alive[saved_enemy.id as usize]);
    assert!(engine.world.alive[saved_bullet.id as usize]);
    let saved_entity_count = engine.entity_count();
    engine.camera.x = 320.0;
    engine.camera.y = 240.0;

    assert!(engine.capture_shooter_snapshot());
    assert_eq!(
        engine.shooter_snapshot_header_float_len(),
        engine.shooter_snapshot_header_floats()
    );
    assert_eq!(
        engine.shooter_snapshot_header_u32_len(),
        engine.shooter_snapshot_header_u32s()
    );
    assert!(engine.shooter_snapshot_entity_float_len() >= SHOOTER_SNAPSHOT_ENTITY_FLOATS);
    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();

    engine.reset_game();
    assert_eq!(engine.score(), 0);
    set_test_particle_preset(&mut engine, 0, DEFAULT_TEXTURE_ID, 2, 1.0);
    assert_eq!(engine.spawn_particle_burst(0, 100.0, 100.0), 2);
    assert_eq!(engine.particle_count(), 2);
    assert!(engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s
    ));

    assert_eq!(engine.score(), 1);
    assert_eq!(engine.game_state(), 1);
    assert_eq!(engine.entity_count(), saved_entity_count);
    assert_eq!(engine.camera_x(), 320.0);
    assert_eq!(engine.camera_y(), 240.0);
    assert_eq!(engine.particle_count(), 0);
    assert!(engine
        .world
        .transforms
        .iter()
        .flatten()
        .any(|transform| (transform.x - 100.0).abs() < 0.001));
    assert!(engine
        .world
        .velocities
        .iter()
        .flatten()
        .any(|velocity| (velocity.vx - 12.0).abs() < 0.001));
    assert!(engine
        .world
        .projectile_tile_impacts
        .iter()
        .flatten()
        .any(|tile_impact| *tile_impact == ProjectileTileImpact::PassThrough));
    assert!(engine
        .world
        .gameplay_factions
        .iter()
        .flatten()
        .any(|faction| *faction == saved_bullet_faction));
}

#[test]
fn shooter_snapshot_restores_full_previous_input_state() {
    let mut engine = Engine::new();
    engine.set_input(true, false, true, false, false, true, true, 123.0, 456.0);
    engine.update(0.016);
    assert!(engine.capture_shooter_snapshot());
    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();

    assert_eq!(header_floats[6], 123.0);
    assert_eq!(header_floats[7], 456.0);
    assert_eq!(header_u32s[6], 0);
    assert_eq!(header_u32s[7], 1);
    assert_eq!(header_u32s[8], 1);
    assert_eq!(
        header_u32s[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
            + crate::input::INPUT_ACTION_REGISTRY_SNAPSHOT_U32S],
        1
    );
    assert_eq!(
        header_u32s[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
            + crate::input::INPUT_ACTION_REGISTRY_SNAPSHOT_U32S
            + 2],
        1
    );

    engine.reset_game();
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    assert!(engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s
    ));
    assert!(engine.capture_shooter_snapshot());

    assert_eq!(engine.shooter_snapshot_header_floats[6], 123.0);
    assert_eq!(engine.shooter_snapshot_header_floats[7], 456.0);
    assert_eq!(engine.shooter_snapshot_header_u32s[7], 1);
    assert_eq!(engine.shooter_snapshot_header_u32s[8], 1);
    assert_eq!(
        engine.shooter_snapshot_header_u32s[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
            + crate::input::INPUT_ACTION_REGISTRY_SNAPSHOT_U32S],
        1
    );
    assert_eq!(
        engine.shooter_snapshot_header_u32s[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
            + crate::input::INPUT_ACTION_REGISTRY_SNAPSHOT_U32S
            + 2],
        1
    );
}

#[test]
fn shooter_snapshot_restore_resume_keeps_held_pressed_action_deterministic() {
    let mut original = Engine::new();
    original.set_input(false, false, false, false, false, true, false, 800.0, 240.0);
    original.update(0.016);
    original.set_input(
        false, false, false, false, false, false, false, 800.0, 240.0,
    );
    original.update(0.016);
    let player = original.world.player.unwrap();
    assert!(original.set_gameplay_action_dash(player.id, player.generation, 2, 0.0, 64.0));

    original.set_input(false, false, false, false, false, true, false, 800.0, 240.0);
    original.update_frame(0.016, false, false, false);
    assert!(original.capture_shooter_snapshot());
    let header_floats = original.shooter_snapshot_header_floats.clone();
    let header_u32s = original.shooter_snapshot_header_u32s.clone();
    let entity_floats = original.shooter_snapshot_entity_floats.clone();
    let entity_u32s = original.shooter_snapshot_entity_u32s.clone();
    let snapshot_player_x =
        entity_floats[player_snapshot_slot(&entity_u32s) * SHOOTER_SNAPSHOT_ENTITY_FLOATS];

    original.update_frame(0.016, false, false, false);
    let original_player_x = original.world.transforms[original.world.player.unwrap().id as usize]
        .unwrap()
        .x;

    let mut restored = Engine::new();
    assert!(restored.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s
    ));
    restored.set_input(false, false, false, false, false, true, false, 800.0, 240.0);
    restored.update_frame(0.016, false, false, false);
    let restored_player_x = restored.world.transforms[restored.world.player.unwrap().id as usize]
        .unwrap()
        .x;

    assert!((original_player_x - restored_player_x).abs() < 0.001);
    assert!((restored_player_x - snapshot_player_x).abs() < 0.001);
}

#[test]
fn shooter_snapshot_player_score_reward_does_not_pollute_projectile_policy_slot() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    let player = engine.world.player.unwrap();
    engine.world.score_rewards[player.id as usize] = Some(99);

    assert!(engine.capture_shooter_snapshot());
    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();
    let player_slot = player_snapshot_slot(&entity_u32s);
    assert_eq!(
        entity_u32s[player_slot * SHOOTER_SNAPSHOT_ENTITY_U32S + SNAPSHOT_PROJECTILE_POLICY],
        0
    );

    assert!(engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s
    ));
}

#[test]
fn shooter_snapshot_restores_authored_primary_fire_action_cooldown() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    let player = engine.world.player.unwrap();
    assert!(engine.set_gameplay_action_projectile_with_target(
        player.id,
        player.generation,
        1,
        0.5,
        900.0,
        3.0,
        2.0,
        0,
        0,
        1,
    ));
    assert!(engine.set_gameplay_action_dash(player.id, player.generation, 2, 0.75, 96.0,));
    assert!(engine.set_gameplay_action_melee(player.id, player.generation, 3, 0.25, 64.0, 4.0,));
    assert!(engine.set_gameplay_action_spawn_prefab(
        player.id,
        player.generation,
        11,
        0.4,
        1,
        0,
        0,
        24.0,
        -12.0,
    ));
    assert_eq!(
        engine.world.commit_action_cooldown_if_ready(player, 1),
        Some(ActionBinding::projectile_with_target(
            1,
            0.5,
            crate::components::gameplay::ProjectileActionConfig {
                speed: 900.0,
                damage: 3.0,
                lifetime_seconds: 2.0,
                aim: crate::components::gameplay::ActionAimSource::Input,
                collision_target: crate::components::gameplay::ProjectileCollisionTarget::Enemies,
                tile_impact: ProjectileTileImpact::PassThrough,
            },
        ))
    );
    assert_eq!(
        engine.world.commit_action_cooldown_if_ready(player, 2),
        Some(ActionBinding::dash(2, 0.75, 96.0))
    );
    assert_eq!(
        engine.world.commit_action_cooldown_if_ready(player, 3),
        Some(ActionBinding::melee(3, 0.25, 64.0, 4.0))
    );
    assert_eq!(
        engine.world.commit_action_cooldown_if_ready(player, 11),
        Some(ActionBinding::spawn_prefab(
            11,
            0.4,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            24.0,
            -12.0,
        ))
    );

    assert!(engine.capture_shooter_snapshot());
    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();

    engine.reset_game();
    assert!(engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s,
    ));

    let restored_player = engine.world.player.unwrap();
    let restored_action = engine.world.action_binding(restored_player, 1).unwrap();
    assert_eq!(restored_action.action_id, 1);
    assert_eq!(restored_action.cooldown.duration_seconds, 0.5);
    assert!((restored_action.cooldown.remaining_seconds - 0.5).abs() < 0.001);
    assert_eq!(
        restored_action.pattern,
        ActionPattern::Projectile {
            speed: 900.0,
            damage: 3.0,
            lifetime_seconds: 2.0,
            aim: crate::components::gameplay::ActionAimSource::Input,
            collision_target: crate::components::gameplay::ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::PassThrough,
        }
    );
    let restored_dash = engine.world.action_binding(restored_player, 2).unwrap();
    assert_eq!(restored_dash.action_id, 2);
    assert_eq!(restored_dash.cooldown.duration_seconds, 0.75);
    assert!((restored_dash.cooldown.remaining_seconds - 0.75).abs() < 0.001);
    assert_eq!(
        restored_dash.pattern,
        ActionPattern::Dash {
            distance: 96.0,
            aim: crate::components::gameplay::ActionAimSource::Input,
        }
    );
    let restored_melee = engine.world.action_binding(restored_player, 3).unwrap();
    assert_eq!(restored_melee.action_id, 3);
    assert_eq!(restored_melee.cooldown.duration_seconds, 0.25);
    assert!((restored_melee.cooldown.remaining_seconds - 0.25).abs() < 0.001);
    assert_eq!(
        restored_melee.pattern,
        ActionPattern::Melee {
            range: 64.0,
            damage: 4.0,
            target: crate::components::gameplay::MeleeTarget::Enemies,
        }
    );
    let restored_spawn_prefab = engine.world.action_binding(restored_player, 11).unwrap();
    assert_eq!(restored_spawn_prefab.action_id, 11);
    assert_eq!(restored_spawn_prefab.cooldown.duration_seconds, 0.4);
    assert!((restored_spawn_prefab.cooldown.remaining_seconds - 0.4).abs() < 0.001);
    assert_eq!(
        restored_spawn_prefab.pattern,
        ActionPattern::SpawnPrefab {
            prefab_id: 1,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: 24.0,
            offset_y: -12.0,
        }
    );

    engine.set_input(false, false, false, false, false, false, true, 800.0, 240.0);
    engine.update_frame(0.016, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 0);

    engine.update_frame(0.5, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 1);
    let bullet_index = engine
        .world
        .alive
        .iter()
        .enumerate()
        .find(|(index, alive)| {
            **alive && engine.world.collider_layer_at(*index) == Some(CollisionLayer::Bullet)
        })
        .map(|(index, _)| index)
        .unwrap();
    let velocity = engine.world.velocities[bullet_index].unwrap();
    let speed = (velocity.vx * velocity.vx + velocity.vy * velocity.vy).sqrt();
    assert!((speed - 900.0).abs() < 0.01);
    assert_eq!(engine.world.damages[bullet_index], Some(3.0));
    assert!((engine.world.bullet_lifetimes[bullet_index].unwrap() - 1.5).abs() < 0.001);
}

#[test]
fn shooter_snapshot_restores_multiple_spawn_prefab_action_bindings() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    let player = engine.world.player.unwrap();
    assert!(engine.set_gameplay_action_projectile(
        player.id,
        player.generation,
        1,
        0.05,
        720.0,
        2.0,
        1.2,
    ));
    assert!(engine.set_gameplay_action_spawn_prefab(
        player.id,
        player.generation,
        12,
        0.8,
        1,
        0,
        0,
        -32.0,
        16.0,
    ));
    assert!(engine.set_gameplay_action_spawn_prefab(
        player.id,
        player.generation,
        11,
        0.4,
        1,
        0,
        0,
        24.0,
        -12.0,
    ));
    assert_eq!(
        engine.world.commit_action_cooldown_if_ready(player, 11),
        Some(ActionBinding::spawn_prefab(
            11,
            0.4,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            24.0,
            -12.0,
        ))
    );
    assert_eq!(
        engine.world.commit_action_cooldown_if_ready(player, 12),
        Some(ActionBinding::spawn_prefab(
            12,
            0.8,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            -32.0,
            16.0,
        ))
    );

    assert!(engine.capture_shooter_snapshot());
    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();
    let player_slot = player_snapshot_slot(&entity_u32s);
    assert_eq!(
        entity_u32s[player_slot * SHOOTER_SNAPSHOT_ENTITY_U32S + SNAPSHOT_SPAWN_PREFAB_U32_BASE],
        11
    );
    assert_eq!(
        entity_u32s[player_slot * SHOOTER_SNAPSHOT_ENTITY_U32S
            + SNAPSHOT_SPAWN_PREFAB_U32_BASE
            + SNAPSHOT_SPAWN_PREFAB_U32_STRIDE],
        12
    );

    engine.reset_game();
    assert!(engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s,
    ));

    let restored_player = engine.world.player.unwrap();
    let restored_first = engine.world.action_binding(restored_player, 11).unwrap();
    assert_eq!(restored_first.action_id, 11);
    assert_eq!(restored_first.cooldown.duration_seconds, 0.4);
    assert!((restored_first.cooldown.remaining_seconds - 0.4).abs() < 0.001);
    assert_eq!(
        restored_first.pattern,
        ActionPattern::SpawnPrefab {
            prefab_id: 1,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: 24.0,
            offset_y: -12.0,
        }
    );
    let restored_second = engine.world.action_binding(restored_player, 12).unwrap();
    assert_eq!(restored_second.action_id, 12);
    assert_eq!(restored_second.cooldown.duration_seconds, 0.8);
    assert!((restored_second.cooldown.remaining_seconds - 0.8).abs() < 0.001);
    assert_eq!(
        restored_second.pattern,
        ActionPattern::SpawnPrefab {
            prefab_id: 1,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: -32.0,
            offset_y: 16.0,
        }
    );
}

#[test]
fn shooter_snapshot_rejects_duplicate_action_binding_ids() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    assert!(engine.capture_shooter_snapshot());

    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let mut entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let mut entity_u32s = engine.shooter_snapshot_entity_u32s.clone();
    let player_slot = player_snapshot_slot(&entity_u32s);
    set_valid_primary_snapshot_action(&mut entity_floats, &mut entity_u32s, player_slot);
    set_valid_spawn_prefab_snapshot_action(&mut entity_floats, &mut entity_u32s, player_slot, 0, 1);

    assert!(!engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s,
    ));
}

#[test]
fn shooter_snapshot_rejects_action_binding_count_over_capacity() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    assert!(engine.capture_shooter_snapshot());

    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let mut entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let mut entity_u32s = engine.shooter_snapshot_entity_u32s.clone();
    let player_slot = player_snapshot_slot(&entity_u32s);
    set_valid_primary_snapshot_action(&mut entity_floats, &mut entity_u32s, player_slot);
    set_valid_dash_snapshot_action(&mut entity_floats, &mut entity_u32s, player_slot);
    set_valid_melee_snapshot_action(&mut entity_floats, &mut entity_u32s, player_slot);
    set_valid_spawn_prefab_snapshot_action(
        &mut entity_floats,
        &mut entity_u32s,
        player_slot,
        0,
        11,
    );
    set_valid_spawn_prefab_snapshot_action(
        &mut entity_floats,
        &mut entity_u32s,
        player_slot,
        1,
        12,
    );

    assert!(!engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s,
    ));
}

#[test]
fn shooter_snapshot_rejects_gapped_spawn_prefab_action_slots() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    assert!(engine.capture_shooter_snapshot());

    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let mut entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let mut entity_u32s = engine.shooter_snapshot_entity_u32s.clone();
    let player_slot = player_snapshot_slot(&entity_u32s);
    set_valid_spawn_prefab_snapshot_action(
        &mut entity_floats,
        &mut entity_u32s,
        player_slot,
        1,
        11,
    );

    assert!(!engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s,
    ));
}

#[test]
fn shooter_snapshot_rejects_unsorted_spawn_prefab_action_slots() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    assert!(engine.capture_shooter_snapshot());

    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let mut entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let mut entity_u32s = engine.shooter_snapshot_entity_u32s.clone();
    let player_slot = player_snapshot_slot(&entity_u32s);
    set_valid_spawn_prefab_snapshot_action(
        &mut entity_floats,
        &mut entity_u32s,
        player_slot,
        0,
        12,
    );
    set_valid_spawn_prefab_snapshot_action(
        &mut entity_floats,
        &mut entity_u32s,
        player_slot,
        1,
        11,
    );

    assert!(!engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s,
    ));
}

#[test]
fn shooter_snapshot_restores_input_action_registry() {
    let mut engine = Engine::new();
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.016);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    let player = engine.world.player.unwrap();
    assert!(engine.set_gameplay_action_projectile(
        player.id,
        player.generation,
        1,
        0.05,
        900.0,
        3.0,
        2.0,
    ));
    assert!(engine.clear_input_action_bindings(1));
    assert!(engine.set_input_action_binding(
        1,
        0,
        crate::input::INPUT_ACTION_CONTROL_ENTER,
        crate::input::INPUT_ACTION_ACTIVATION_DOWN,
    ));

    assert!(engine.capture_shooter_snapshot());
    let header_floats = engine.shooter_snapshot_header_floats.clone();
    let header_u32s = engine.shooter_snapshot_header_u32s.clone();
    let entity_floats = engine.shooter_snapshot_entity_floats.clone();
    let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();

    engine.reset_input_action_bindings();
    assert!(engine.restore_shooter_snapshot(
        header_floats,
        header_u32s,
        entity_floats,
        entity_u32s,
    ));

    engine.set_input(false, false, false, false, true, false, false, 800.0, 240.0);
    engine.update_frame(0.016, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 0);

    engine.set_input(false, false, false, false, false, true, false, 800.0, 240.0);
    engine.update_frame(0.016, false, false, false);
    assert_eq!(count_layer(&engine, CollisionLayer::Bullet), 1);
}

#[test]
fn shooter_snapshot_capture_does_not_switch_non_shooter_scene() {
    let mut engine = Engine::new();
    engine.use_platformer_scene();
    let entity_count = engine.entity_count();

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert!(!engine.capture_shooter_snapshot());

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert_eq!(engine.entity_count(), entity_count);
    assert_eq!(engine.shooter_snapshot_header_float_len(), 0);
    assert_eq!(engine.shooter_snapshot_header_u32_len(), 0);
    assert_eq!(engine.shooter_snapshot_entity_float_len(), 0);
    assert_eq!(engine.shooter_snapshot_entity_u32_len(), 0);
}

#[test]
fn failed_shooter_snapshot_restore_preserves_active_scene() {
    let mut engine = Engine::new();
    engine.use_platformer_scene();
    let entity_count = engine.entity_count();
    let mut header_u32s = vec![0; SHOOTER_SNAPSHOT_HEADER_U32S];
    header_u32s[0] = crate::shooter_scene::SHOOTER_SNAPSHOT_VERSION;

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert!(!engine.restore_shooter_snapshot(
        vec![0.0; SHOOTER_SNAPSHOT_HEADER_FLOATS],
        header_u32s,
        Vec::new(),
        Vec::new(),
    ));

    assert_eq!(engine.active_scene, ActiveScene::Platformer);
    assert_eq!(engine.entity_count(), entity_count);
}

const SNAPSHOT_PRIMARY_COOLDOWN_DURATION: usize = 7;
const SNAPSHOT_PRIMARY_COOLDOWN_REMAINING: usize = 8;
const SNAPSHOT_PRIMARY_PROJECTILE_SPEED: usize = 9;
const SNAPSHOT_PRIMARY_PROJECTILE_DAMAGE: usize = 10;
const SNAPSHOT_PRIMARY_PROJECTILE_LIFETIME: usize = 11;
const SNAPSHOT_PRIMARY_ACTION_ID: usize = 2;
const SNAPSHOT_PROJECTILE_POLICY: usize = 1;
const SNAPSHOT_DASH_COOLDOWN_DURATION: usize = 12;
const SNAPSHOT_DASH_COOLDOWN_REMAINING: usize = 13;
const SNAPSHOT_DASH_DISTANCE: usize = 14;
const SNAPSHOT_DASH_ACTION_ID: usize = 3;
const SNAPSHOT_MELEE_COOLDOWN_DURATION: usize = 15;
const SNAPSHOT_MELEE_COOLDOWN_REMAINING: usize = 16;
const SNAPSHOT_MELEE_RANGE: usize = 17;
const SNAPSHOT_MELEE_DAMAGE: usize = 18;
const SNAPSHOT_MELEE_ACTION_ID: usize = 4;
const SNAPSHOT_SPAWN_PREFAB_FLOAT_BASE: usize = 19;
const SNAPSHOT_SPAWN_PREFAB_FLOAT_STRIDE: usize = 4;
const SNAPSHOT_SPAWN_PREFAB_U32_BASE: usize = 5;
const SNAPSHOT_SPAWN_PREFAB_U32_STRIDE: usize = 4;

fn player_snapshot_slot(entity_u32s: &[u32]) -> usize {
    entity_u32s
        .chunks_exact(SHOOTER_SNAPSHOT_ENTITY_U32S)
        .position(|entity| entity[0] == crate::shooter_scene::SHOOTER_SNAPSHOT_ENTITY_PLAYER)
        .expect("snapshot should contain player entity")
}

fn set_valid_primary_snapshot_action(
    entity_floats: &mut [f32],
    entity_u32s: &mut [u32],
    player_slot: usize,
) {
    let float_base = player_slot * SHOOTER_SNAPSHOT_ENTITY_FLOATS;
    let u32_base = player_slot * SHOOTER_SNAPSHOT_ENTITY_U32S;
    entity_u32s[u32_base + SNAPSHOT_PRIMARY_ACTION_ID] = 1;
    entity_floats[float_base + SNAPSHOT_PRIMARY_COOLDOWN_DURATION] = 0.1;
    entity_floats[float_base + SNAPSHOT_PRIMARY_COOLDOWN_REMAINING] = 0.0;
    entity_floats[float_base + SNAPSHOT_PRIMARY_PROJECTILE_SPEED] = 720.0;
    entity_floats[float_base + SNAPSHOT_PRIMARY_PROJECTILE_DAMAGE] = 1.0;
    entity_floats[float_base + SNAPSHOT_PRIMARY_PROJECTILE_LIFETIME] = 1.0;
}

fn set_valid_dash_snapshot_action(
    entity_floats: &mut [f32],
    entity_u32s: &mut [u32],
    player_slot: usize,
) {
    let float_base = player_slot * SHOOTER_SNAPSHOT_ENTITY_FLOATS;
    let u32_base = player_slot * SHOOTER_SNAPSHOT_ENTITY_U32S;
    entity_u32s[u32_base + SNAPSHOT_DASH_ACTION_ID] = 2;
    entity_floats[float_base + SNAPSHOT_DASH_COOLDOWN_DURATION] = 0.2;
    entity_floats[float_base + SNAPSHOT_DASH_COOLDOWN_REMAINING] = 0.0;
    entity_floats[float_base + SNAPSHOT_DASH_DISTANCE] = 64.0;
}

fn set_valid_melee_snapshot_action(
    entity_floats: &mut [f32],
    entity_u32s: &mut [u32],
    player_slot: usize,
) {
    let float_base = player_slot * SHOOTER_SNAPSHOT_ENTITY_FLOATS;
    let u32_base = player_slot * SHOOTER_SNAPSHOT_ENTITY_U32S;
    entity_u32s[u32_base + SNAPSHOT_MELEE_ACTION_ID] = 3;
    entity_floats[float_base + SNAPSHOT_MELEE_COOLDOWN_DURATION] = 0.3;
    entity_floats[float_base + SNAPSHOT_MELEE_COOLDOWN_REMAINING] = 0.0;
    entity_floats[float_base + SNAPSHOT_MELEE_RANGE] = 32.0;
    entity_floats[float_base + SNAPSHOT_MELEE_DAMAGE] = 1.0;
}

fn set_valid_spawn_prefab_snapshot_action(
    entity_floats: &mut [f32],
    entity_u32s: &mut [u32],
    player_slot: usize,
    slot: usize,
    action_id: u32,
) {
    let float_base =
        player_slot * SHOOTER_SNAPSHOT_ENTITY_FLOATS + SNAPSHOT_SPAWN_PREFAB_FLOAT_BASE;
    let u32_base = player_slot * SHOOTER_SNAPSHOT_ENTITY_U32S + SNAPSHOT_SPAWN_PREFAB_U32_BASE;
    let float_slot = float_base + slot * SNAPSHOT_SPAWN_PREFAB_FLOAT_STRIDE;
    let u32_slot = u32_base + slot * SNAPSHOT_SPAWN_PREFAB_U32_STRIDE;
    entity_u32s[u32_slot] = action_id;
    entity_u32s[u32_slot + 1] = 1;
    entity_u32s[u32_slot + 2] = 0;
    entity_u32s[u32_slot + 3] = 0;
    entity_floats[float_slot] = 0.4;
    entity_floats[float_slot + 1] = 0.0;
    entity_floats[float_slot + 2] = 16.0;
    entity_floats[float_slot + 3] = 0.0;
}
