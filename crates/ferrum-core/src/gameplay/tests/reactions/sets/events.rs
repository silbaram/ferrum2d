use super::*;

#[test]
fn collision_reaction_outcome_summary_tracks_default_flags_and_target_roles() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let enemy = world.spawn_enemy(4.0, 0.0, 1);
    world.set_damage(source, 3.0);
    world.set_health(enemy, 3.0);
    world.set_score_reward(enemy, 5);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Damage {
        target: CollisionTarget::OtherEntity,
    }));
    assert!(reactions.push(CollisionReaction::Despawn {
        target: CollisionTarget::OtherEntity,
    }));
    assert!(reactions.push(CollisionReaction::PlaySound {
        sound_id: 2,
        volume: 1.0,
        pitch: 1.0,
        cooldown: Cooldown::ready(0.0),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    }));
    let pair = CollisionReactionPair::new(source.id as usize, enemy.id as usize, source, enemy);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let reaction_outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        false,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: true,
        },
    );
    let summary = summarize_collision_reaction_set_outcome(&reaction_outcome, |target_index| {
        if target_index == enemy.id as usize {
            CollisionReactionTargetRole::Enemy
        } else {
            CollisionReactionTargetRole::Other
        }
    });

    assert_eq!(
        summary,
        CollisionReactionOutcomeSummary {
            total_damage: 3.0,
            score_delta: 5,
            overrides_default_gameplay: true,
            faction_damage_denied: false,
            enemy_damaged: true,
            enemy_removed: true,
            player_game_over: false,
            pickup_collected: false,
            replace_default_audio: true,
            replace_default_particle: false,
        },
    );
}

#[test]
fn collision_gameplay_event_payloads_preserve_outcome_order_and_sources() {
    let mut world = World::default();
    let source = world.spawn_player(0.0, 0.0, 1);
    world.set_damage(source, 3.0);
    let target = world.spawn_enemy(4.0, 0.0, 1);
    world.set_health(target, 3.0);
    world.set_score_reward(target, 5);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Damage {
        target: CollisionTarget::OtherEntity,
    }));
    assert!(reactions.push(CollisionReaction::Pickup {
        target: CollisionTarget::OtherEntity,
    }));
    assert!(reactions.push(CollisionReaction::Despawn {
        target: CollisionTarget::SelfEntity,
    }));
    world.set_pickup(
        target,
        Pickup {
            item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
            count: 2,
            despawn_on_collect: true,
        },
    );
    world.set_aabb_collider(
        target,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
    );
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let reaction_outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        false,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: false,
        },
    );

    assert_eq!(
        collision_gameplay_events_for_reaction_outcome(pair, &reaction_outcome)
            .events()
            .collect::<Vec<_>>(),
        vec![
            CollisionGameplayEventPayload::Damage {
                target,
                source,
                damage: 3.0,
                target_removed: false,
            },
            CollisionGameplayEventPayload::PickupCollected {
                collector: source,
                pickup: target,
                item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
                count: 2,
                target_removed: true,
            },
            CollisionGameplayEventPayload::Despawn {
                target: source,
                source,
            },
        ],
    );
}

#[test]
fn collision_damage_reaction_denial_reports_faction_payload() {
    use crate::components::gameplay::{
        GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_entity();
    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
    );
    world.set_gameplay_faction(
        target,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Damage {
        target: CollisionTarget::OtherEntity,
    }));
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let reaction_outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        false,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: false,
        },
    );

    assert!(reaction_outcome.damage_outcomes().next().is_none());
    let summary = summarize_collision_reaction_set_outcome(&reaction_outcome, |target_index| {
        if target_index == target.id as usize {
            CollisionReactionTargetRole::Player
        } else {
            CollisionReactionTargetRole::Other
        }
    });
    assert!(summary.overrides_default_gameplay);
    assert!(summary.faction_damage_denied);
    assert_eq!(summary.total_damage, 0.0);
    assert_eq!(
        reaction_outcome
            .faction_damage_denials()
            .collect::<Vec<_>>(),
        vec![FactionDamageDenial {
            source,
            target,
            source_faction_id: GAMEPLAY_FACTION_ENEMY,
            target_faction_id: GAMEPLAY_FACTION_PLAYER,
        }],
    );
    assert_eq!(
        collision_gameplay_events_for_reaction_outcome(pair, &reaction_outcome)
            .events()
            .collect::<Vec<_>>(),
        vec![CollisionGameplayEventPayload::FactionDamageDenied {
            target,
            source,
            source_faction_id: GAMEPLAY_FACTION_ENEMY,
            target_faction_id: GAMEPLAY_FACTION_PLAYER,
        }],
    );
}

#[test]
fn collision_damage_reaction_denial_skips_marked_target() {
    use crate::components::gameplay::{
        GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_entity();
    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
    );
    world.set_gameplay_faction(
        target,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Despawn {
        target: CollisionTarget::OtherEntity,
    }));
    assert!(reactions.push(CollisionReaction::Damage {
        target: CollisionTarget::OtherEntity,
    }));
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let reaction_outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        false,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: false,
        },
    );

    assert_eq!(reaction_outcome.despawn_outcomes().count(), 1);
    assert!(reaction_outcome.damage_outcomes().next().is_none());
    assert!(reaction_outcome.faction_damage_denials().next().is_none());
    assert!(
        collision_gameplay_events_for_reaction_outcome(pair, &reaction_outcome)
            .events()
            .all(|payload| !matches!(
                payload,
                CollisionGameplayEventPayload::FactionDamageDenied { .. }
            )),
    );
}
