use super::*;

#[test]
fn resolved_shooter_config_applies_all_values_with_one_call() {
    let mut engine = Engine::new();

    engine.set_shooter_resolved_config(
        3200.0, 1800.0, 240.0, 120.0, 0.75, 640.0, 0.08, 2.4, 40.0, 44.0, 30.0, 34.0, 10.0, 12.0,
        4, 12.0, 3, 9.0, 2, 18.0, 2, 2, 4.0, 2.0, 9, 220.0, 18.0,
    );

    let config = engine.scenes.shooter.config();
    assert_eq!(config.world_width, 3200.0);
    assert_eq!(config.world_height, 1800.0);
    assert_eq!(config.player_speed, 240.0);
    assert_eq!(config.enemy_speed, 120.0);
    assert_eq!(config.enemy_spawn_interval, 0.75);
    assert_eq!(config.bullet_speed, 640.0);
    assert_eq!(config.fire_cooldown, 0.08);
    assert_eq!(config.bullet_lifetime, 2.4);
    assert_eq!(config.player_template.sprite_width, 40.0);
    assert_eq!(config.player_template.sprite_height, 44.0);
    assert_eq!(config.enemy_template.sprite_width, 30.0);
    assert_eq!(config.enemy_template.sprite_height, 34.0);
    assert_eq!(config.bullet_template.sprite_width, 10.0);
    assert_eq!(config.bullet_template.sprite_height, 12.0);
    assert_eq!(
        config.player_template.animation.unwrap().idle.frame_count,
        4
    );
    assert_eq!(
        config
            .player_template
            .animation
            .unwrap()
            .idle
            .frames_per_second,
        12.0
    );
    assert_eq!(config.enemy_template.animation.unwrap().idle.frame_count, 3);
    assert_eq!(
        config
            .enemy_template
            .animation
            .unwrap()
            .idle
            .frames_per_second,
        9.0
    );
    assert_eq!(
        config.bullet_template.animation.unwrap().idle.frame_count,
        2
    );
    assert_eq!(
        config
            .bullet_template
            .animation
            .unwrap()
            .idle
            .frames_per_second,
        18.0
    );
    assert_eq!(config.enemy_behavior, EnemyBehavior::Static);
    assert_eq!(config.enemy_spawn_pattern, EnemySpawnPattern::Center);
    assert_eq!(config.enemy_health, 4.0);
    assert_eq!(config.bullet_damage, 2.0);
    assert_eq!(config.score_reward, 9);
    assert_eq!(config.orbit_radius, 220.0);
    assert_eq!(config.orbit_radial_band, 18.0);
}

#[test]
fn gameplay_component_authoring_sets_and_clears_scalar_components() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    let bouncer = engine.world.spawn_enemy(140.0, 100.0, DEFAULT_TEXTURE_ID);
    let bullet = engine
        .world
        .spawn_bullet(120.0, 100.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_health(enemy.id, enemy.generation, 4.0));
    assert!(engine.set_gameplay_score_reward(enemy.id, enemy.generation, 9));
    assert!(engine.set_gameplay_action_projectile(
        enemy.id,
        enemy.generation,
        7,
        0.12,
        420.0,
        2.0,
        1.5
    ));
    assert!(engine.set_gameplay_action_projectile_with_target(
        bouncer.id,
        bouncer.generation,
        11,
        0.2,
        360.0,
        1.0,
        1.25,
        0,
        0,
        2
    ));
    assert!(engine.set_gameplay_action_dash(enemy.id, enemy.generation, 8, 0.4, 96.0));
    assert!(engine.set_gameplay_action_melee(enemy.id, enemy.generation, 9, 0.3, 36.0, 4.0));
    assert!(engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        10,
        0.6,
        1,
        0,
        0,
        8.0,
        -4.0
    ));
    assert!(engine.set_gameplay_pickup(
        enemy.id,
        enemy.generation,
        GAMEPLAY_PICKUP_ITEM_SCORE,
        3,
        true
    ));
    assert!(engine.set_gameplay_interaction(enemy.id, enemy.generation, 5, 28.0, true));
    assert!(engine.set_gameplay_timer_trigger(enemy.id, enemy.generation, 6, 0.25));
    assert!(engine.set_gameplay_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_ENEMY,
        1 << GAMEPLAY_FACTION_PLAYER
    ));
    assert!(engine.set_gameplay_tags(enemy.id, enemy.generation, 1 << 5));
    assert!(!engine.set_gameplay_tags(enemy.id, enemy.generation, 0));
    assert!(engine.set_gameplay_damage(bullet.id, bullet.generation, 2.0));
    assert!(engine.set_gameplay_lifetime(bullet.id, bullet.generation, 1.25));
    assert!(engine.set_gameplay_projectile_tile_impact(
        bullet.id,
        bullet.generation,
        ProjectileTileImpact::Bounce.code()
    ));

    assert_eq!(engine.world.health(enemy), Some(4.0));
    assert_eq!(engine.world.score_reward(enemy), Some(9));
    assert_eq!(
        engine
            .world
            .action_bindings(enemy)
            .unwrap()
            .iter()
            .collect::<Vec<_>>(),
        vec![
            ActionBinding::projectile(7, 0.12, 420.0, 2.0, 1.5),
            ActionBinding::dash(8, 0.4, 96.0),
            ActionBinding::melee(9, 0.3, 36.0, 4.0),
            ActionBinding::spawn_prefab(
                10,
                0.6,
                1,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                8.0,
                -4.0,
            ),
        ]
    );
    assert_eq!(
        engine
            .world
            .action_bindings(bouncer)
            .unwrap()
            .iter()
            .collect::<Vec<_>>(),
        vec![ActionBinding::projectile_with_target(
            11,
            0.2,
            crate::components::gameplay::ProjectileActionConfig {
                speed: 360.0,
                damage: 1.0,
                lifetime_seconds: 1.25,
                aim: crate::components::gameplay::ActionAimSource::Input,
                collision_target: crate::components::gameplay::ProjectileCollisionTarget::Enemies,
                tile_impact: ProjectileTileImpact::Bounce,
            },
        )]
    );
    assert_eq!(
        engine.world.pickup(enemy),
        Some(Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true))
    );
    assert_eq!(
        engine.world.interaction(enemy),
        Some(Interaction::new(5, 28.0, true))
    );
    assert_eq!(
        engine.world.gameplay_timer_trigger(enemy),
        Some(GameplayTimerTrigger::new(6, 0.25))
    );
    assert_eq!(
        engine.world.gameplay_faction(enemy),
        Some(GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap())
    );
    assert_eq!(engine.world.gameplay_tags(enemy), GameplayTags::new(1 << 5));
    assert_eq!(engine.world.damage(bullet), Some(2.0));
    assert_eq!(engine.world.gameplay_lifetime(bullet), Some(1.25));
    assert_eq!(
        engine.world.projectile_tile_impact_at(bullet.id as usize),
        ProjectileTileImpact::Bounce
    );

    assert!(engine.clear_gameplay_health(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_score_reward(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_actions(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_pickup(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_interaction(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_timer_trigger(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_faction(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_tags(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_damage(bullet.id, bullet.generation));
    assert!(engine.clear_gameplay_lifetime(bullet.id, bullet.generation));

    assert_eq!(engine.world.health(enemy), None);
    assert_eq!(engine.world.score_reward(enemy), None);
    assert_eq!(engine.world.action_bindings(enemy), None);
    assert_eq!(engine.world.pickup(enemy), None);
    assert_eq!(engine.world.interaction(enemy), None);
    assert_eq!(engine.world.gameplay_timer_trigger(enemy), None);
    assert_eq!(engine.world.gameplay_faction(enemy), None);
    assert_eq!(engine.world.gameplay_tags(enemy), None);
    assert_eq!(engine.world.damage(bullet), None);
    assert_eq!(engine.world.gameplay_lifetime(bullet), None);
}

#[test]
fn gameplay_component_authoring_accepts_max_u32_mask_faction_and_tag_ids() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    let max_faction_mask = 1_u32 << GAMEPLAY_FACTION_MAX_ID;
    let max_tag_mask = 1_u32 << GAMEPLAY_TAG_MAX_ID;

    assert!(engine.set_gameplay_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_MAX_ID,
        max_faction_mask,
    ));
    assert_eq!(
        engine.world.gameplay_faction(enemy),
        GameplayFaction::new(GAMEPLAY_FACTION_MAX_ID, max_faction_mask)
    );
    assert!(!engine.set_gameplay_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_MAX_ID + 1,
        0,
    ));

    assert!(engine.set_gameplay_faction_relation(
        GAMEPLAY_FACTION_MAX_ID,
        GAMEPLAY_FACTION_MAX_ID,
        FactionRelation::Hostile.code(),
    ));
    assert_eq!(
        engine
            .world
            .gameplay_faction_relation(GAMEPLAY_FACTION_MAX_ID, GAMEPLAY_FACTION_MAX_ID),
        Some(FactionRelation::Hostile)
    );
    assert!(!engine.set_gameplay_faction_relation(
        GAMEPLAY_FACTION_MAX_ID + 1,
        GAMEPLAY_FACTION_MAX_ID,
        FactionRelation::Hostile.code(),
    ));
    assert!(!engine.set_gameplay_faction_relation(
        GAMEPLAY_FACTION_MAX_ID,
        GAMEPLAY_FACTION_MAX_ID + 1,
        FactionRelation::Hostile.code(),
    ));

    assert!(engine.set_gameplay_tags(enemy.id, enemy.generation, max_tag_mask));
    assert_eq!(
        engine.world.gameplay_tags(enemy),
        GameplayTags::new(max_tag_mask)
    );

    assert!(engine.set_gameplay_movement_chase_nearest_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_MAX_ID,
        50.0,
    ));
    assert!(engine.set_gameplay_movement_chase_nearest_tag(
        enemy.id,
        enemy.generation,
        GAMEPLAY_TAG_MAX_ID,
        45.0,
    ));
    assert!(engine.set_gameplay_movement_seek_target_nearest_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_MAX_ID,
        60.0,
        0.5,
    ));
    assert!(engine.set_gameplay_movement_seek_target_nearest_tag(
        enemy.id,
        enemy.generation,
        GAMEPLAY_TAG_MAX_ID,
        55.0,
        0.5,
    ));
    assert!(!engine.set_gameplay_movement_chase_nearest_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_MAX_ID + 1,
        50.0,
    ));
    assert!(!engine.set_gameplay_movement_chase_nearest_tag(
        enemy.id,
        enemy.generation,
        GAMEPLAY_TAG_MAX_ID + 1,
        45.0,
    ));
    assert!(!engine.set_gameplay_movement_seek_target_nearest_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_MAX_ID + 1,
        60.0,
        0.5,
    ));
    assert!(!engine.set_gameplay_movement_seek_target_nearest_tag(
        enemy.id,
        enemy.generation,
        GAMEPLAY_TAG_MAX_ID + 1,
        55.0,
        0.5,
    ));
}

#[test]
fn gameplay_authoring_snapshot_restores_supported_runtime_component_slots() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_health(enemy.id, enemy.generation, 4.0));
    assert!(engine.set_gameplay_damage(enemy.id, enemy.generation, 2.0));
    assert!(engine.set_gameplay_lifetime(enemy.id, enemy.generation, 1.25));
    assert!(engine.set_gameplay_score_reward(enemy.id, enemy.generation, 9));
    assert!(engine.set_gameplay_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_ENEMY,
        1 << GAMEPLAY_FACTION_PLAYER
    ));
    assert!(engine.set_gameplay_tags(enemy.id, enemy.generation, 1 << 5));
    assert!(engine.set_gameplay_pickup(
        enemy.id,
        enemy.generation,
        GAMEPLAY_PICKUP_ITEM_SCORE,
        3,
        true
    ));
    assert!(engine.set_gameplay_interaction(enemy.id, enemy.generation, 5, 28.0, true));
    assert!(engine.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 6, 0.25, 7));
    assert!(engine.set_gameplay_movement_orbit_player(
        enemy.id,
        enemy.generation,
        72.0,
        120.0,
        12.0
    ));
    assert!(engine.set_gameplay_action_projectile(
        enemy.id,
        enemy.generation,
        7,
        0.12,
        420.0,
        2.0,
        1.5
    ));
    assert!(engine.set_gameplay_action_dash(enemy.id, enemy.generation, 8, 0.4, 96.0));
    assert!(engine.set_gameplay_action_melee(enemy.id, enemy.generation, 9, 0.3, 36.0, 4.0));
    assert!(engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        10,
        0.6,
        1,
        0,
        0,
        8.0,
        -4.0
    ));
    assert!(!engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        11,
        0.6,
        7,
        0,
        0,
        0.0,
        0.0
    ));
    assert!(engine.register_gameplay_enemy_prefab(7));
    assert!(engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        11,
        0.6,
        7,
        0,
        0,
        0.0,
        0.0
    ));
    assert!(engine.add_gameplay_collision_damage(enemy.id, enemy.generation, 1));
    assert!(engine.add_gameplay_collision_despawn(enemy.id, enemy.generation, 0));
    assert!(engine.add_gameplay_collision_sound_with_cooldown(
        enemy.id,
        enemy.generation,
        12,
        0.75,
        1.1,
        0.5
    ));
    assert!(engine.add_gameplay_collision_particle_with_cooldown(
        enemy.id,
        enemy.generation,
        2,
        1,
        0.25
    ));

    let index = enemy.id as usize;
    engine
        .world
        .interaction_mut_at_index(index)
        .unwrap()
        .consumed = true;
    let timer = engine
        .world
        .gameplay_timer_trigger_mut_at_index(index)
        .unwrap();
    timer.remaining_seconds = 0.1;
    timer.fired = true;
    assert!(engine
        .world
        .commit_action_cooldown_if_ready(enemy, 7)
        .is_some());
    let (_, collision_reactions) = engine
        .world
        .collision_reactions_mut(enemy)
        .expect("enemy has collision reactions");
    for reaction in collision_reactions.iter_mut() {
        match reaction {
            CollisionReaction::PlaySound { cooldown, .. }
            | CollisionReaction::SpawnParticle { cooldown, .. }
            | CollisionReaction::EmitEffect { cooldown, .. }
            | CollisionReaction::SpawnPrefab { cooldown, .. } => {
                cooldown.remaining_seconds = cooldown.duration_seconds;
            }
            CollisionReaction::Damage { .. }
            | CollisionReaction::Pickup { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::AreaDamage { .. }
            | CollisionReaction::Knockback { .. }
            | CollisionReaction::Despawn { .. } => {}
        }
    }

    let expected_health = engine.world.health_at_index(index);
    let expected_damage = engine.world.damage_at_index(index);
    let expected_lifetime = engine.world.gameplay_lifetime_at(index);
    let expected_score_reward = engine.world.score_reward_at_index(index);
    let expected_faction = engine.world.gameplay_faction(enemy);
    let expected_tags = engine.world.gameplay_tags(enemy);
    let expected_pickup = engine.world.pickup(enemy);
    let expected_interaction = engine.world.interaction(enemy);
    let expected_timer = engine.world.gameplay_timer_trigger(enemy);
    let expected_movement = engine.world.movement_pattern(enemy);
    let expected_actions = engine.world.action_bindings(enemy);
    let expected_collision_reactions = engine.world.collision_reactions(enemy);

    assert!(engine.capture_gameplay_authoring_snapshot(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_health(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_damage(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_lifetime(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_score_reward(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_faction(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_tags(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_pickup(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_interaction(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_timer_trigger(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_movement(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_actions(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_collision_reactions(enemy.id, enemy.generation));

    assert!(engine.restore_gameplay_authoring_snapshot(enemy.id, enemy.generation));
    assert_eq!(engine.world.health_at_index(index), expected_health);
    assert_eq!(engine.world.damage_at_index(index), expected_damage);
    assert_eq!(engine.world.gameplay_lifetime_at(index), expected_lifetime);
    assert_eq!(
        engine.world.score_reward_at_index(index),
        expected_score_reward
    );
    assert_eq!(engine.world.gameplay_faction(enemy), expected_faction);
    assert_eq!(engine.world.gameplay_tags(enemy), expected_tags);
    assert_eq!(
        engine
            .world
            .gameplay_faction_query_indices(GAMEPLAY_FACTION_ENEMY),
        &[index]
    );
    assert_eq!(engine.world.gameplay_tag_query_indices(5), &[index]);
    assert_eq!(engine.world.pickup(enemy), expected_pickup);
    assert_eq!(engine.world.interaction(enemy), expected_interaction);
    assert_eq!(engine.world.gameplay_timer_trigger(enemy), expected_timer);
    assert_eq!(engine.world.movement_pattern(enemy), expected_movement);
    assert_eq!(engine.world.action_bindings(enemy), expected_actions);
    assert_eq!(
        engine.world.collision_reactions(enemy),
        expected_collision_reactions
    );

    engine.clear_gameplay_authoring_snapshot();
    assert!(!engine.restore_gameplay_authoring_snapshot(enemy.id, enemy.generation));
    assert!(!engine.capture_gameplay_authoring_snapshot(enemy.id + 1, enemy.generation));
}

#[test]
fn gameplay_authoring_snapshot_rejects_stale_or_despawned_restore_handles() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_health(enemy.id, enemy.generation, 4.0));
    assert!(engine.capture_gameplay_authoring_snapshot(enemy.id, enemy.generation));
    assert!(!engine.restore_gameplay_authoring_snapshot(enemy.id, enemy.generation + 1));

    engine.world.despawn(enemy);

    assert!(!engine.restore_gameplay_authoring_snapshot(enemy.id, enemy.generation));
    assert!(!engine.capture_gameplay_authoring_snapshot(enemy.id, enemy.generation));
}

#[test]
fn gameplay_component_authoring_sets_behavior_state_machine() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_behavior_state_machine(enemy.id, enemy.generation, 1));
    assert_eq!(
        engine.world.behavior_state_machine(enemy),
        Some(BehaviorStateMachine::new(1))
    );
    assert_eq!(
        engine.gameplay_behavior_state(enemy.id, enemy.generation),
        1
    );

    assert!(engine.add_gameplay_behavior_transition(enemy.id, enemy.generation, 1, 2, 7));
    let mut expected = BehaviorStateMachine::new(1);
    assert!(expected.push_transition(BehaviorStateTransition::new(1, 2, 7)));
    assert_eq!(engine.world.behavior_state_machine(enemy), Some(expected));

    assert!(engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        2,
        3,
        GAMEPLAY_EVENT_COLLISION_DAMAGE,
        0,
    ));
    assert!(expected.push_transition(BehaviorStateTransition::new_event(
        2,
        3,
        GAMEPLAY_EVENT_COLLISION_DAMAGE,
        0,
    )));
    assert_eq!(engine.world.behavior_state_machine(enemy), Some(expected));

    let expected_state_enter_actions = (0..MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY)
        .map(|index| {
            BehaviorStateEnterAction::new(
                2,
                11 + index as u32,
                BehaviorStateEnterActionPhase::NextFramePrePhysics,
            )
        })
        .collect::<Vec<_>>();
    for action in expected_state_enter_actions.iter().copied() {
        assert!(engine.add_gameplay_behavior_state_enter_action(
            enemy.id,
            enemy.generation,
            action.state,
            action.action_id,
            0,
        ));
    }
    assert!(!engine.add_gameplay_behavior_state_enter_action(
        enemy.id,
        enemy.generation,
        2,
        11 + MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY as u32,
        0,
    ));
    assert_eq!(
        engine
            .world
            .behavior_state_enter_actions(enemy)
            .unwrap()
            .iter_for_state(2)
            .collect::<Vec<_>>(),
        expected_state_enter_actions
    );

    assert!(engine.clear_gameplay_behavior_state_machine(enemy.id, enemy.generation));
    assert_eq!(
        engine.gameplay_behavior_state(enemy.id, enemy.generation),
        0
    );
    assert_eq!(engine.world.behavior_state_machine(enemy), None);
    assert!(engine.clear_gameplay_behavior_state_enter_actions(enemy.id, enemy.generation,));
    assert_eq!(engine.world.behavior_state_enter_actions(enemy), None);
}

#[test]
fn gameplay_component_authoring_rejects_invalid_values_and_stale_handles() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(!engine.set_gameplay_health(enemy.id, enemy.generation, f32::NAN));
    assert!(!engine.set_gameplay_health(enemy.id, enemy.generation, -1.0));
    assert!(!engine.set_gameplay_damage(enemy.id, enemy.generation, 0.0));
    assert!(!engine.set_gameplay_damage(enemy.id, enemy.generation, f32::INFINITY));
    assert!(!engine.set_gameplay_lifetime(enemy.id, enemy.generation, f32::NAN));
    assert!(engine.set_gameplay_projectile_tile_impact(
        enemy.id,
        enemy.generation,
        ProjectileTileImpact::Bounce.code()
    ));
    assert!(!engine.set_gameplay_projectile_tile_impact(enemy.id, enemy.generation, 99));
    assert_eq!(
        engine.world.projectile_tile_impact_at(enemy.id as usize),
        ProjectileTileImpact::Bounce
    );
    assert!(engine.set_gameplay_score_reward(enemy.id, enemy.generation, 0));
    assert!(!engine.set_gameplay_pickup(
        enemy.id,
        enemy.generation,
        GAMEPLAY_PICKUP_ITEM_SCORE,
        0,
        true
    ));
    assert!(!engine.set_gameplay_pickup(enemy.id, enemy.generation, 99, 1, true));
    assert!(!engine.set_gameplay_pickup(
        enemy.id,
        enemy.generation,
        GAMEPLAY_PICKUP_ITEM_SCORE,
        1,
        false
    ));
    assert!(!engine.set_gameplay_interaction(enemy.id, enemy.generation, 0, 24.0, true));
    assert!(!engine.set_gameplay_interaction(enemy.id, enemy.generation, 5, 0.0, true));
    assert!(!engine.set_gameplay_interaction(enemy.id, enemy.generation, 5, f32::NAN, true));
    assert!(!engine.set_gameplay_timer_trigger(enemy.id, enemy.generation, 0, 0.25));
    assert!(!engine.set_gameplay_timer_trigger(enemy.id, enemy.generation, 6, 0.0));
    assert!(!engine.set_gameplay_timer_trigger(enemy.id, enemy.generation, 6, f32::INFINITY));
    assert!(!engine.set_gameplay_action_projectile(
        enemy.id,
        enemy.generation,
        0,
        0.1,
        420.0,
        1.0,
        1.0
    ));
    assert!(!engine.set_gameplay_action_projectile(
        enemy.id,
        enemy.generation,
        7,
        f32::NAN,
        420.0,
        1.0,
        1.0
    ));
    assert!(!engine.set_gameplay_action_projectile(
        enemy.id,
        enemy.generation,
        7,
        0.1,
        0.0,
        1.0,
        1.0
    ));
    assert!(!engine.set_gameplay_action_projectile(
        enemy.id,
        enemy.generation,
        7,
        0.1,
        420.0,
        0.0,
        1.0
    ));
    assert!(!engine.set_gameplay_action_projectile(
        enemy.id,
        enemy.generation,
        7,
        0.1,
        420.0,
        1.0,
        f32::INFINITY
    ));
    assert!(!engine.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        7,
        0.1,
        420.0,
        1.0,
        1.0,
        0,
        0,
        99
    ));
    assert!(!engine.set_gameplay_action_dash(enemy.id, enemy.generation, 0, 0.4, 96.0));
    assert!(!engine.set_gameplay_action_dash(
        enemy.id,
        enemy.generation,
        8,
        f32::NEG_INFINITY,
        96.0
    ));
    assert!(!engine.set_gameplay_action_dash(enemy.id, enemy.generation, 8, 0.4, 0.0));
    assert!(!engine.set_gameplay_action_dash(enemy.id, enemy.generation, 8, 0.4, f32::NAN));
    assert!(!engine.set_gameplay_action_melee(enemy.id, enemy.generation, 0, 0.3, 36.0, 4.0));
    assert!(!engine.set_gameplay_action_melee(enemy.id, enemy.generation, 9, f32::NAN, 36.0, 4.0));
    assert!(!engine.set_gameplay_action_melee(enemy.id, enemy.generation, 9, 0.3, 0.0, 4.0));
    assert!(!engine.set_gameplay_action_melee(
        enemy.id,
        enemy.generation,
        9,
        0.3,
        36.0,
        f32::INFINITY
    ));
    assert!(!engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        0,
        0.5,
        1,
        0,
        0,
        0.0,
        0.0
    ));
    assert!(!engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        10,
        f32::NAN,
        1,
        0,
        0,
        0.0,
        0.0
    ));
    assert!(!engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        10,
        0.5,
        2,
        0,
        0,
        0.0,
        0.0
    ));
    assert!(!engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        10,
        0.5,
        1,
        1,
        0,
        0.0,
        0.0
    ));
    assert!(!engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        10,
        0.5,
        1,
        0,
        1,
        0.0,
        0.0
    ));
    assert!(!engine.set_gameplay_action_spawn_prefab(
        enemy.id,
        enemy.generation,
        10,
        0.5,
        1,
        0,
        0,
        f32::INFINITY,
        0.0
    ));
    assert!(!engine.set_gameplay_behavior_state_machine(enemy.id, enemy.generation, 0));
    assert!(!engine.add_gameplay_behavior_transition(enemy.id, enemy.generation, 1, 2, 7));
    assert!(engine.set_gameplay_behavior_state_machine(enemy.id, enemy.generation, 1));
    assert!(!engine.add_gameplay_behavior_transition(enemy.id, enemy.generation, 0, 2, 7));
    assert!(!engine.add_gameplay_behavior_transition(enemy.id, enemy.generation, 1, 0, 7));
    assert!(!engine.add_gameplay_behavior_transition(enemy.id, enemy.generation, 1, 2, 0));
    assert!(!engine.add_gameplay_behavior_state_enter_action(enemy.id, enemy.generation, 0, 11, 0,));
    assert!(!engine.add_gameplay_behavior_state_enter_action(enemy.id, enemy.generation, 2, 0, 0,));
    assert!(!engine.add_gameplay_behavior_state_enter_action(enemy.id, enemy.generation, 2, 11, 1,));
    assert!(engine.add_gameplay_behavior_state_enter_action(enemy.id, enemy.generation, 2, 11, 0,));
    assert!(!engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        99,
        0
    ));
    assert!(!engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_COLLISION_DAMAGE,
        7,
    ));
    assert!(!engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_PICKUP_COLLECTED,
        0,
    ));
    assert!(engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_PICKUP_COLLECTED,
        1,
    ));
    assert!(!engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_TIMER,
        0,
    ));
    assert!(engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_TIMER,
        6,
    ));
    assert!(!engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_TILE_IMPACT,
        3,
    ));
    assert!(!engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_TILE_IMPACT,
        1,
    ));
    assert!(engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_TILE_IMPACT,
        0,
    ));
    assert!(engine.add_gameplay_behavior_event_transition(
        enemy.id,
        enemy.generation,
        1,
        2,
        GAMEPLAY_EVENT_TILE_IMPACT,
        2,
    ));
    assert!(engine.gameplay_entity_exists(enemy.id, enemy.generation));

    engine.world.despawn(enemy);
    assert!(!engine.gameplay_entity_exists(enemy.id, enemy.generation));
    assert!(!engine.set_gameplay_health(enemy.id, enemy.generation, 1.0));
    assert!(!engine.set_gameplay_projectile_tile_impact(
        enemy.id,
        enemy.generation,
        ProjectileTileImpact::Despawn.code()
    ));
    assert!(!engine.clear_gameplay_score_reward(enemy.id, enemy.generation));
    assert!(!engine.clear_gameplay_actions(enemy.id, enemy.generation));
    assert!(!engine.clear_gameplay_pickup(enemy.id, enemy.generation));
    assert!(!engine.clear_gameplay_interaction(enemy.id, enemy.generation));
    assert!(!engine.clear_gameplay_timer_trigger(enemy.id, enemy.generation));
    assert!(!engine.clear_gameplay_behavior_state_machine(enemy.id, enemy.generation));
    assert!(!engine.clear_gameplay_behavior_state_enter_actions(enemy.id, enemy.generation));
    assert_eq!(
        engine.gameplay_behavior_state(enemy.id, enemy.generation),
        0
    );
}

#[test]
fn input_action_authoring_rejects_invalid_bindings_and_can_reset_defaults() {
    let mut engine = Engine::new();

    assert!(!engine.set_input_action_binding(
        0,
        0,
        crate::input::INPUT_ACTION_CONTROL_SPACE,
        crate::input::INPUT_ACTION_ACTIVATION_DOWN,
    ));
    assert!(!engine.set_input_action_binding(
        1,
        8,
        crate::input::INPUT_ACTION_CONTROL_SPACE,
        crate::input::INPUT_ACTION_ACTIVATION_DOWN,
    ));
    assert!(!engine.set_input_action_binding(1, 0, 99, crate::input::INPUT_ACTION_ACTIVATION_DOWN,));
    assert!(!engine.set_input_action_binding(1, 0, crate::input::INPUT_ACTION_CONTROL_SPACE, 99,));
    assert!(!engine.clear_input_action_bindings(0));
    assert!(engine.clear_input_action_bindings(1));
    assert!(engine.set_input_action_binding(
        1,
        0,
        crate::input::INPUT_ACTION_CONTROL_SPACE,
        crate::input::INPUT_ACTION_ACTIVATION_DOWN,
    ));
    engine.reset_input_action_bindings();
}

#[test]
fn gameplay_component_authoring_sets_movement_and_collision_reactions() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    let pickup = engine.world.spawn_entity();
    let target = engine.world.spawn_enemy(140.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_movement_topdown_input(enemy.id, enemy.generation, 180.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::TopdownInput { speed: 180.0 })
    );

    assert!(engine.set_gameplay_movement_linear(enemy.id, enemy.generation, 1.0, -2.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Linear { vx: 1.0, vy: -2.0 })
    );

    assert!(engine.set_gameplay_movement_to_point(enemy.id, enemy.generation, 320.0, 180.0, 90.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::MoveToPoint {
            x: 320.0,
            y: 180.0,
            speed: 90.0,
        })
    );

    assert!(engine.set_gameplay_movement_chase_player(enemy.id, enemy.generation, 95.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Chase {
            target: MovementTarget::Player,
            speed: 95.0,
        })
    );

    assert!(engine.set_gameplay_movement_chase_nearest_player(enemy.id, enemy.generation, 85.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Chase {
            target: MovementTarget::NearestPlayer,
            speed: 85.0,
        })
    );

    assert!(engine.set_gameplay_movement_chase_nearest_enemy(enemy.id, enemy.generation, 65.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Chase {
            target: MovementTarget::NearestEnemy,
            speed: 65.0,
        })
    );

    assert!(engine.set_gameplay_movement_chase_nearest_layer(enemy.id, enemy.generation, 2, 55.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Chase {
            target: MovementTarget::NearestLayer(CollisionLayer::Bullet),
            speed: 55.0,
        })
    );

    assert!(engine.set_gameplay_movement_chase_nearest_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_ENEMY,
        50.0,
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Chase {
            target: MovementTarget::NearestFaction(GAMEPLAY_FACTION_ENEMY),
            speed: 50.0,
        })
    );

    assert!(engine.set_gameplay_movement_chase_nearest_tag(enemy.id, enemy.generation, 5, 45.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Chase {
            target: MovementTarget::NearestTag(5),
            speed: 45.0,
        })
    );
    assert!(!engine.set_gameplay_movement_chase_nearest_tag(enemy.id, enemy.generation, 32, 45.0,));

    assert!(engine.set_gameplay_movement_chase_entity(
        enemy.id,
        enemy.generation,
        target.id,
        target.generation,
        75.0
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 75.0,
        })
    );

    assert!(engine.set_gameplay_movement_orbit_player(enemy.id, enemy.generation, 80.0, 48.0, 6.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Orbit {
            target: MovementTarget::Player,
            speed: 80.0,
            radius: 48.0,
            radial_band: 6.0,
        })
    );
    assert!(engine.set_gameplay_movement_seek_target_player(enemy.id, enemy.generation, 90.0, 0.6,));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::SeekTarget {
            target: MovementTarget::Player,
            speed: 90.0,
            turn_rate: 0.6,
        })
    );
    assert!(engine.set_gameplay_movement_seek_target_nearest_player(
        enemy.id,
        enemy.generation,
        88.0,
        0.4,
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::SeekTarget {
            target: MovementTarget::NearestPlayer,
            speed: 88.0,
            turn_rate: 0.4,
        })
    );
    assert!(engine.set_gameplay_movement_seek_target_nearest_enemy(
        enemy.id,
        enemy.generation,
        78.0,
        0.8,
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::SeekTarget {
            target: MovementTarget::NearestEnemy,
            speed: 78.0,
            turn_rate: 0.8,
        })
    );
    assert!(engine.set_gameplay_movement_seek_target_nearest_layer(
        enemy.id,
        enemy.generation,
        4,
        68.0,
        0.7,
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::SeekTarget {
            target: MovementTarget::NearestLayer(CollisionLayer::Pickup),
            speed: 68.0,
            turn_rate: 0.7,
        })
    );
    assert!(engine.set_gameplay_movement_seek_target_nearest_faction(
        enemy.id,
        enemy.generation,
        GAMEPLAY_FACTION_PLAYER,
        58.0,
        0.9,
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::SeekTarget {
            target: MovementTarget::NearestFaction(GAMEPLAY_FACTION_PLAYER),
            speed: 58.0,
            turn_rate: 0.9,
        })
    );
    assert!(engine.set_gameplay_movement_seek_target_nearest_tag(
        enemy.id,
        enemy.generation,
        6,
        52.0,
        0.95,
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::SeekTarget {
            target: MovementTarget::NearestTag(6),
            speed: 52.0,
            turn_rate: 0.95,
        })
    );
    assert!(!engine.set_gameplay_movement_seek_target_nearest_tag(
        enemy.id,
        enemy.generation,
        32,
        52.0,
        0.95,
    ));
    assert!(engine.set_gameplay_movement_seek_target_entity(
        enemy.id,
        enemy.generation,
        target.id,
        target.generation,
        95.0,
        1.0,
    ));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::SeekTarget {
            target: MovementTarget::Entity(target),
            speed: 95.0,
            turn_rate: 1.0,
        })
    );
    assert!(engine.set_gameplay_movement_accelerate(enemy.id, enemy.generation, 2.0, 0.0, 12.0));
    assert_eq!(
        engine.world.movement_pattern(enemy),
        Some(MovementPattern::Accelerate {
            acceleration_x: 2.0,
            acceleration_y: 0.0,
            max_speed: 12.0,
        })
    );

    assert!(engine.add_gameplay_collision_damage(enemy.id, enemy.generation, 1));
    assert!(engine.add_gameplay_collision_sound(enemy.id, enemy.generation, 42, 0.75, 1.25));
    assert!(engine.add_gameplay_collision_particle(enemy.id, enemy.generation, 3, 1));
    assert!(engine.add_gameplay_collision_knockback(enemy.id, enemy.generation, 1, 120.0));
    assert!(engine.add_gameplay_collision_pickup(pickup.id, pickup.generation, 0));
    assert!(engine.add_gameplay_collision_emit_effect(
        pickup.id,
        pickup.generation,
        99,
        4,
        0,
        0.25,
        1,
    ));
    assert!(engine.add_gameplay_collision_spawn_prefab(
        pickup.id,
        pickup.generation,
        17,
        1,
        0,
        0.5,
        1,
        6.0,
        -3.0,
    ));
    let reactions = engine.world.collision_reactions(enemy).unwrap();
    assert_eq!(
        reactions.iter().collect::<Vec<_>>(),
        vec![
            CollisionReaction::Damage {
                target: CollisionTarget::OtherEntity,
            },
            CollisionReaction::PlaySound {
                sound_id: 42,
                volume: 0.75,
                pitch: 1.25,
                cooldown: Cooldown::ready(0.0),
                replace_default: false,
                trigger: CollisionReactionTrigger::Contact,
            },
            CollisionReaction::SpawnParticle {
                preset_id: 3,
                target: CollisionTarget::OtherEntity,
                cooldown: Cooldown::ready(0.0),
                replace_default: false,
                trigger: CollisionReactionTrigger::Contact,
            },
            CollisionReaction::Knockback {
                target: CollisionTarget::OtherEntity,
                impulse: 120.0,
            },
        ]
    );
    let pickup_reactions = engine.world.collision_reactions(pickup).unwrap();
    assert_eq!(
        pickup_reactions.iter().collect::<Vec<_>>(),
        vec![
            CollisionReaction::Pickup {
                target: CollisionTarget::SelfEntity,
            },
            CollisionReaction::EmitEffect {
                effect_id: 99,
                effect_type: 4,
                target: CollisionTarget::SelfEntity,
                intensity: 1.0,
                radius: 0.0,
                cooldown: Cooldown::ready(0.25),
                trigger: CollisionReactionTrigger::Enter,
            },
            CollisionReaction::SpawnPrefab {
                action_id: 17,
                prefab_id: 1,
                target: CollisionTarget::SelfEntity,
                cooldown: Cooldown::ready(0.5),
                trigger: CollisionReactionTrigger::Enter,
                offset_x: 6.0,
                offset_y: -3.0,
            },
        ]
    );
    let effect_source = engine.world.spawn_entity();
    assert!(engine.add_gameplay_collision_emit_effect_with_payload(
        effect_source.id,
        effect_source.generation,
        100,
        3,
        1,
        0.1,
        0,
        0.4,
        24.0,
    ));
    let effect_reactions = engine.world.collision_reactions(effect_source).unwrap();
    assert_eq!(
        effect_reactions.iter().collect::<Vec<_>>(),
        vec![CollisionReaction::EmitEffect {
            effect_id: 100,
            effect_type: 3,
            target: CollisionTarget::OtherEntity,
            intensity: 0.4,
            radius: 24.0,
            cooldown: Cooldown::ready(0.1),
            trigger: CollisionReactionTrigger::Contact,
        }]
    );

    let policy_enemy = engine.world.spawn_enemy(180.0, 100.0, DEFAULT_TEXTURE_ID);
    assert!(engine.add_gameplay_collision_sound_with_policy(
        policy_enemy.id,
        policy_enemy.generation,
        43,
        0.5,
        0.9,
        0.2,
        true,
    ));
    assert!(engine.add_gameplay_collision_particle_with_policy(
        policy_enemy.id,
        policy_enemy.generation,
        4,
        1,
        0.3,
        true,
    ));
    let policy_reactions = engine.world.collision_reactions(policy_enemy).unwrap();
    assert_eq!(
        policy_reactions.iter().collect::<Vec<_>>(),
        vec![
            CollisionReaction::PlaySound {
                sound_id: 43,
                volume: 0.5,
                pitch: 0.9,
                cooldown: Cooldown::ready(0.2),
                replace_default: true,
                trigger: CollisionReactionTrigger::Contact,
            },
            CollisionReaction::SpawnParticle {
                preset_id: 4,
                target: CollisionTarget::OtherEntity,
                cooldown: Cooldown::ready(0.3),
                replace_default: true,
                trigger: CollisionReactionTrigger::Contact,
            },
        ]
    );

    let trigger_enemy = engine.world.spawn_enemy(220.0, 100.0, DEFAULT_TEXTURE_ID);
    assert!(engine.add_gameplay_collision_sound_with_trigger(
        trigger_enemy.id,
        trigger_enemy.generation,
        44,
        0.4,
        1.2,
        0.15,
        false,
        1,
    ));
    assert!(engine.add_gameplay_collision_particle_with_trigger(
        trigger_enemy.id,
        trigger_enemy.generation,
        5,
        1,
        0.2,
        false,
        1,
    ));
    assert!(!engine.add_gameplay_collision_sound_with_trigger(
        trigger_enemy.id,
        trigger_enemy.generation,
        45,
        0.4,
        1.2,
        0.15,
        false,
        99,
    ));
    assert!(!engine.add_gameplay_collision_particle_with_trigger(
        trigger_enemy.id,
        trigger_enemy.generation,
        6,
        1,
        0.2,
        false,
        99,
    ));
    let trigger_reactions = engine.world.collision_reactions(trigger_enemy).unwrap();
    assert_eq!(
        trigger_reactions.iter().collect::<Vec<_>>(),
        vec![
            CollisionReaction::PlaySound {
                sound_id: 44,
                volume: 0.4,
                pitch: 1.2,
                cooldown: Cooldown::ready(0.15),
                replace_default: false,
                trigger: CollisionReactionTrigger::Enter,
            },
            CollisionReaction::SpawnParticle {
                preset_id: 5,
                target: CollisionTarget::OtherEntity,
                cooldown: Cooldown::ready(0.2),
                replace_default: false,
                trigger: CollisionReactionTrigger::Enter,
            },
        ]
    );

    assert!(engine.clear_gameplay_movement(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_collision_reactions(enemy.id, enemy.generation));
    assert!(engine.clear_gameplay_collision_reactions(pickup.id, pickup.generation));
    assert!(engine.clear_gameplay_collision_reactions(policy_enemy.id, policy_enemy.generation));
    assert!(engine.clear_gameplay_collision_reactions(trigger_enemy.id, trigger_enemy.generation));
    assert_eq!(engine.world.movement_pattern(enemy), None);
    assert_eq!(engine.world.collision_reactions(enemy), None);
    assert_eq!(engine.world.collision_reactions(pickup), None);
    assert_eq!(engine.world.collision_reactions(policy_enemy), None);
    assert_eq!(engine.world.collision_reactions(trigger_enemy), None);
}

#[test]
fn gameplay_component_authoring_sets_atomic_damage_reaction() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_damage_reaction(enemy.id, enemy.generation, 2.5, 1));
    assert_eq!(engine.world.damage(enemy), Some(2.5));
    let reactions = engine.world.collision_reactions(enemy).unwrap();
    assert_eq!(
        reactions.iter().collect::<Vec<_>>(),
        vec![CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }]
    );

    assert!(engine.set_gameplay_damage_reaction(enemy.id, enemy.generation, 3.5, 1));
    assert_eq!(engine.world.damage(enemy), Some(3.5));
    let reactions = engine.world.collision_reactions(enemy).unwrap();
    assert_eq!(reactions.len(), 1);
    assert_eq!(
        reactions.iter().collect::<Vec<_>>(),
        vec![CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }]
    );
}

#[test]
fn gameplay_component_authoring_damage_reaction_failure_is_atomic() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(engine.add_gameplay_collision_despawn(enemy.id, enemy.generation, 0));
    assert!(engine.add_gameplay_collision_despawn(enemy.id, enemy.generation, 1));
    assert!(engine.add_gameplay_collision_sound(enemy.id, enemy.generation, 42, 0.75, 1.25));
    assert!(engine.add_gameplay_collision_particle(enemy.id, enemy.generation, 3, 1));
    assert!(engine.add_gameplay_collision_pickup(enemy.id, enemy.generation, 0));
    assert!(engine.add_gameplay_collision_pickup(enemy.id, enemy.generation, 1));
    assert!(engine.add_gameplay_collision_knockback(enemy.id, enemy.generation, 0, 12.0));
    assert!(engine.add_gameplay_collision_knockback(enemy.id, enemy.generation, 1, 12.0));
    for index in 0..(MAX_COLLISION_REACTIONS_PER_ENTITY - 8) {
        assert!(engine.add_gameplay_collision_sound(
            enemy.id,
            enemy.generation,
            100 + index as u32,
            0.75,
            1.25
        ));
    }
    let reactions = engine.world.collision_reactions(enemy).unwrap();
    assert_eq!(reactions.len(), MAX_COLLISION_REACTIONS_PER_ENTITY);

    assert!(!engine.set_gameplay_damage_reaction(enemy.id, enemy.generation, 3.0, 1));
    assert_eq!(engine.world.damage(enemy), None);
    let reactions = engine.world.collision_reactions(enemy).unwrap();
    assert_eq!(reactions.len(), MAX_COLLISION_REACTIONS_PER_ENTITY);
    assert!(!reactions
        .iter()
        .any(|reaction| matches!(reaction, CollisionReaction::Damage { .. })));
}

#[test]
fn gameplay_component_authoring_sets_area_damage_reaction() {
    let mut engine = Engine::new();
    let bullet = engine
        .world
        .spawn_bullet(100.0, 100.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);

    assert!(engine.set_gameplay_area_damage_reaction(bullet.id, bullet.generation, 3.0, 48.0, 1,));
    assert_eq!(engine.world.damage(bullet), Some(3.0));
    let reactions = engine.world.collision_reactions(bullet).unwrap();
    assert_eq!(
        reactions.iter().collect::<Vec<_>>(),
        vec![CollisionReaction::AreaDamage {
            radius: 48.0,
            target_layer: CollisionLayer::Enemy,
        }]
    );

    assert!(engine.set_gameplay_area_damage_reaction(bullet.id, bullet.generation, 4.0, 64.0, 1,));
    assert_eq!(engine.world.damage(bullet), Some(4.0));
    let reactions = engine.world.collision_reactions(bullet).unwrap();
    assert_eq!(reactions.len(), 1);
    assert_eq!(
        reactions.iter().collect::<Vec<_>>(),
        vec![CollisionReaction::AreaDamage {
            radius: 64.0,
            target_layer: CollisionLayer::Enemy,
        }]
    );
}

#[test]
fn gameplay_component_authoring_rejects_invalid_movement_and_collision_values() {
    let mut engine = Engine::new();
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
    let target = engine.world.spawn_enemy(140.0, 100.0, DEFAULT_TEXTURE_ID);

    assert!(!engine.set_gameplay_movement_topdown_input(enemy.id, enemy.generation, 0.0));
    assert!(!engine.set_gameplay_movement_linear(enemy.id, enemy.generation, f32::NAN, 0.0));
    assert!(!engine.set_gameplay_movement_to_point(
        enemy.id,
        enemy.generation,
        0.0,
        f32::INFINITY,
        1.0
    ));
    assert!(!engine.set_gameplay_movement_chase_player(enemy.id, enemy.generation, -1.0));
    assert!(!engine.set_gameplay_movement_chase_nearest_enemy(enemy.id, enemy.generation, -1.0));
    assert!(!engine.set_gameplay_movement_chase_nearest_layer(enemy.id, enemy.generation, 99, 1.0));
    assert!(!engine.set_gameplay_movement_chase_nearest_faction(
        enemy.id,
        enemy.generation,
        32,
        1.0,
    ));
    assert!(!engine.set_gameplay_movement_seek_target_player(
        enemy.id,
        enemy.generation,
        60.0,
        -0.5,
    ));
    assert!(!engine.set_gameplay_movement_seek_target_nearest_enemy(
        enemy.id,
        enemy.generation,
        60.0,
        -0.5,
    ));
    assert!(!engine.set_gameplay_movement_seek_target_nearest_layer(
        enemy.id,
        enemy.generation,
        99,
        60.0,
        0.5,
    ));
    assert!(!engine.set_gameplay_movement_seek_target_nearest_faction(
        enemy.id,
        enemy.generation,
        32,
        60.0,
        0.5,
    ));
    assert!(!engine.set_gameplay_movement_seek_target_player(
        enemy.id,
        enemy.generation,
        60.0,
        f32::NAN,
    ));
    assert!(!engine.set_gameplay_movement_accelerate(enemy.id, enemy.generation, 0.0, 0.0, 1.0,));
    assert!(!engine.set_gameplay_movement_accelerate(
        enemy.id,
        enemy.generation,
        f32::NAN,
        1.0,
        1.0,
    ));
    assert!(!engine.set_gameplay_movement_orbit_player(enemy.id, enemy.generation, 1.0, 0.0, 0.0));
    assert!(!engine.set_gameplay_damage_reaction(enemy.id, enemy.generation, 0.0, 1));
    assert!(!engine.set_gameplay_damage_reaction(enemy.id, enemy.generation, f32::INFINITY, 1));
    assert!(!engine.set_gameplay_damage_reaction(enemy.id, enemy.generation, 1.0, 99));
    assert!(!engine.set_gameplay_area_damage_reaction(enemy.id, enemy.generation, 0.0, 24.0, 1));
    assert!(!engine.set_gameplay_area_damage_reaction(enemy.id, enemy.generation, 1.0, 0.0, 1));
    assert!(!engine.set_gameplay_area_damage_reaction(enemy.id, enemy.generation, 1.0, 24.0, 99,));
    assert_eq!(engine.world.damage(enemy), None);
    assert_eq!(engine.world.collision_reactions(enemy), None);
    assert!(!engine.add_gameplay_collision_damage(enemy.id, enemy.generation, 99));
    assert!(!engine.add_gameplay_collision_area_damage(enemy.id, enemy.generation, 0.0, 1,));
    assert!(!engine.add_gameplay_collision_area_damage(
        enemy.id,
        enemy.generation,
        f32::INFINITY,
        1,
    ));
    assert!(!engine.add_gameplay_collision_area_damage(enemy.id, enemy.generation, 24.0, 99,));
    assert!(!engine.add_gameplay_collision_knockback(enemy.id, enemy.generation, 99, 24.0));
    assert!(!engine.add_gameplay_collision_knockback(enemy.id, enemy.generation, 1, 0.0));
    assert!(!engine.add_gameplay_collision_knockback(enemy.id, enemy.generation, 1, f32::INFINITY,));
    assert!(!engine.add_gameplay_collision_emit_effect(
        enemy.id,
        enemy.generation,
        1,
        0,
        1,
        0.0,
        0,
    ));
    assert!(!engine.add_gameplay_collision_emit_effect(
        enemy.id,
        enemy.generation,
        1,
        4,
        99,
        0.0,
        0,
    ));
    assert!(!engine.add_gameplay_collision_emit_effect(
        enemy.id,
        enemy.generation,
        1,
        4,
        1,
        -0.1,
        0,
    ));
    assert!(!engine.add_gameplay_collision_emit_effect(
        enemy.id,
        enemy.generation,
        1,
        4,
        1,
        0.0,
        99,
    ));
    assert!(!engine.add_gameplay_collision_emit_effect_with_payload(
        enemy.id,
        enemy.generation,
        1,
        4,
        1,
        0.0,
        0,
        -0.1,
        0.0,
    ));
    assert!(!engine.add_gameplay_collision_emit_effect_with_payload(
        enemy.id,
        enemy.generation,
        1,
        4,
        1,
        0.0,
        0,
        1.0,
        f32::INFINITY,
    ));
    assert!(!engine.add_gameplay_collision_spawn_prefab(
        enemy.id,
        enemy.generation,
        0,
        1,
        1,
        0.0,
        0,
        0.0,
        0.0,
    ));
    assert!(!engine.add_gameplay_collision_spawn_prefab(
        enemy.id,
        enemy.generation,
        17,
        99,
        1,
        0.0,
        0,
        0.0,
        0.0,
    ));
    assert!(!engine.add_gameplay_collision_spawn_prefab(
        enemy.id,
        enemy.generation,
        17,
        1,
        99,
        0.0,
        0,
        0.0,
        0.0,
    ));
    assert!(!engine.add_gameplay_collision_spawn_prefab(
        enemy.id,
        enemy.generation,
        17,
        1,
        1,
        -0.1,
        0,
        0.0,
        0.0,
    ));
    assert!(!engine.add_gameplay_collision_spawn_prefab(
        enemy.id,
        enemy.generation,
        17,
        1,
        1,
        0.0,
        99,
        0.0,
        0.0,
    ));
    assert!(!engine.add_gameplay_collision_spawn_prefab(
        enemy.id,
        enemy.generation,
        17,
        1,
        1,
        0.0,
        0,
        f32::NAN,
        0.0,
    ));
    assert!(!engine.add_gameplay_collision_pickup(enemy.id, enemy.generation, 99));
    assert!(!engine.add_gameplay_collision_sound(enemy.id, enemy.generation, 0, 1.0, 1.0));
    assert!(!engine.add_gameplay_collision_sound(enemy.id, enemy.generation, 1, f32::NAN, 1.0));
    assert!(!engine.add_gameplay_collision_sound(enemy.id, enemy.generation, 1, 1.0, 0.0));
    assert!(!engine.add_gameplay_collision_sound_with_cooldown(
        enemy.id,
        enemy.generation,
        1,
        1.0,
        1.0,
        -0.1
    ));
    assert!(!engine.add_gameplay_collision_particle(enemy.id, enemy.generation, 256, 1));
    assert!(!engine.add_gameplay_collision_particle(enemy.id, enemy.generation, 1, 99));
    assert!(!engine.add_gameplay_collision_particle_with_cooldown(
        enemy.id,
        enemy.generation,
        1,
        1,
        f32::NAN
    ));
    assert!(engine.add_gameplay_collision_sound_with_cooldown(
        enemy.id,
        enemy.generation,
        1,
        0.8,
        1.2,
        0.25
    ));
    assert!(engine.add_gameplay_collision_particle_with_cooldown(
        enemy.id,
        enemy.generation,
        2,
        0,
        0.5
    ));

    engine.world.despawn(target);
    assert!(!engine.set_gameplay_movement_chase_entity(
        enemy.id,
        enemy.generation,
        target.id,
        target.generation,
        75.0
    ));
    assert!(!engine.set_gameplay_movement_seek_target_entity(
        enemy.id,
        enemy.generation,
        target.id,
        target.generation,
        95.0,
        0.5,
    ));
}

#[test]
fn shooter_prefab_collider_api_updates_template_and_existing_entities() {
    let mut engine = Engine::new();

    assert!(engine.set_shooter_prefab_collider(
        0, 12.0, 14.0, 2.0, -3.0, false, false, true, 0.2, 0.8, 2.0, 0.0, 1.4, 0.7, 0.6, 0.5, 0.4,
    ));

    let config = engine.scenes.shooter.config();
    assert_eq!(config.player_template.collider_half_width, 12.0);
    assert_eq!(config.player_template.collider_half_height, 14.0);
    assert_eq!(config.player_template.collider_offset_x, 2.0);
    assert_eq!(config.player_template.collider_offset_y, -3.0);
    assert!(!config.player_template.collider_enabled);
    assert!(!config.player_template.collider_is_trigger);
    let player = engine.world.player_entity().unwrap();
    let collider = engine.world.collider(player).unwrap();
    assert_eq!(collider.half_width, 12.0);
    assert_eq!(collider.offset_x, 2.0);
    assert!(!collider.enabled);
    assert_eq!(
        engine.world.collider_material(player).unwrap().friction,
        0.8
    );

    assert!(!engine.set_shooter_prefab_collider(
        0,
        f32::NAN,
        14.0,
        2.0,
        -3.0,
        false,
        false,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
    assert!(!engine.set_shooter_prefab_collider(
        99, 12.0, 14.0, 2.0, -3.0, false, false, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0,
        1.0,
    ));
}

#[test]
fn shooter_prefab_shape_collider_apis_update_templates_and_entities() {
    let mut engine = Engine::new();

    assert!(engine.set_shooter_prefab_circle_collider(
        0, 11.0, 1.0, -2.0, true, true, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0,
    ));
    let player = engine.world.player_entity().unwrap();
    let player_collider = engine.world.circle_collider(player).unwrap();
    assert_eq!(player_collider.radius, 11.0);
    assert_eq!(player_collider.offset_x, 1.0);
    assert_eq!(
        engine.world.collider_layer_at(player.id as usize),
        Some(CollisionLayer::Player)
    );

    assert!(engine.set_shooter_prefab_capsule_collider(
        1, -5.0, 0.0, 5.0, 0.0, 3.0, 0.0, 2.0, true, true, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0,
        1.0, 1.0, 1.0,
    ));
    let enemy = engine.world.spawn_enemy_from_template(
        100.0,
        100.0,
        DEFAULT_TEXTURE_ID,
        engine.scenes.shooter.config().enemy_template,
        1.0,
        1,
    );
    assert_eq!(engine.world.capsule_collider(enemy).unwrap().radius, 3.0);

    assert!(engine.set_shooter_prefab_oriented_box_collider(
        1, 7.0, 4.0, 0.3, 1.0, 1.0, true, false, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0,
        1.0,
    ));
    let enemy_collider = engine.world.oriented_box_collider(enemy).unwrap();
    assert_eq!(enemy_collider.half_width, 7.0);
    assert_eq!(enemy_collider.rotation_radians, 0.3);
    assert!(!enemy_collider.is_trigger);

    assert!(engine.set_shooter_prefab_convex_polygon_collider(
        2,
        vec![-2.0, -2.0, 2.0, -2.0, 0.0, 2.0],
        0.1,
        -1.0,
        0.5,
        true,
        true,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
    let bullet = engine.world.spawn_bullet_from_template(
        Transform2D { x: 0.0, y: 0.0 },
        Velocity { vx: 0.0, vy: 0.0 },
        DEFAULT_TEXTURE_ID,
        1.0,
        engine.scenes.shooter.config().bullet_template,
        1.0,
    );
    let polygon = engine.world.convex_polygon_collider(bullet).unwrap();
    assert_eq!(polygon.vertex_count, 3);
    assert_eq!(polygon.offset_x, -1.0);
    assert_eq!(polygon.rotation_radians, 0.1);

    assert!(!engine.set_shooter_prefab_circle_collider(
        0,
        f32::NAN,
        0.0,
        0.0,
        true,
        true,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
    assert!(!engine.set_shooter_prefab_convex_polygon_collider(
        2,
        vec![0.0, 0.0, 1.0, 0.0],
        0.0,
        0.0,
        0.0,
        true,
        true,
        false,
        0.0,
        0.4,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
    ));
}
