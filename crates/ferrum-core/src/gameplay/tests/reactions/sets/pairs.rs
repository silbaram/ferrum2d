use super::*;

#[test]
fn collision_reaction_set_for_pair_applies_damage_and_despawn_outcomes() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_enemy(4.0, 0.0, 1);
    world.set_damage(source, 2.0);
    world.set_health(target, 2.0);
    world.set_score_reward(target, 9);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Damage {
        target: CollisionTarget::OtherEntity,
    }));
    assert!(reactions.push(CollisionReaction::Despawn {
        target: CollisionTarget::SelfEntity,
    }));
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        true,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 1,
            despawn_on_kill: true,
        },
    );

    assert!(outcome.overrides_default_gameplay);
    assert_eq!(
        outcome.damage_outcomes().collect::<Vec<_>>(),
        vec![CollisionDamageReactionOutcome {
            target_index: target.id as usize,
            target,
            damage: 2.0,
            killed: true,
            target_removed: true,
            score_reward: 9,
        }],
    );
    assert_eq!(
        outcome.despawn_outcomes().collect::<Vec<_>>(),
        vec![CollisionDespawnReactionOutcome {
            target_index: source.id as usize,
            target: source,
        }],
    );
    assert_eq!(pending, vec![target, source]);
}

#[test]
fn guarded_collision_reaction_is_suppressed_until_variable_matches() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_enemy(4.0, 0.0, 1);
    world.set_damage(source, 1.0);
    world.set_health(target, 3.0);
    assert!(world.configure_gameplay_variable(
        1,
        crate::gameplay_variables::GameplayVariableType::Bool,
        crate::gameplay_variables::GameplayVariableScope::Scene,
        0.0,
        0.0,
    ));
    let guard = crate::gameplay_variables::GameplayVariableComparison::new(
        1,
        crate::gameplay_variables::GameplayVariableComparisonOperator::Equal,
        0,
        1.0,
    )
    .unwrap();
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push_guarded(
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
        guard,
    ));
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();
    let defaults = |_: &World, _: usize| CollisionDamageReactionDefaults {
        health: 3.0,
        score_reward: 0,
        despawn_on_kill: false,
    };

    let suppressed = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        true,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        defaults,
    );
    assert!(suppressed.damage_outcomes().next().is_none());
    assert!(suppressed.overrides_default_gameplay);

    assert!(world.set_gameplay_variable_value(1, 1.0));
    let applied = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        true,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        defaults,
    );
    assert_eq!(applied.damage_outcomes().count(), 1);
    assert!(applied.overrides_default_gameplay);
}

#[test]
fn collision_reaction_set_for_pair_applies_knockback_without_overriding_gameplay() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_entity();
    world.set_transform(source, Transform2D { x: 0.0, y: 0.0 });
    world.set_transform(target, Transform2D { x: 3.0, y: 4.0 });
    world.set_velocity(target, Velocity { vx: 1.0, vy: -1.0 });
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Knockback {
        target: CollisionTarget::OtherEntity,
        impulse: 10.0,
    }));
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        true,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: false,
        },
    );

    assert!(!outcome.overrides_default_gameplay);
    assert_eq!(
        outcome.knockback_outcomes().collect::<Vec<_>>(),
        vec![CollisionKnockbackReactionOutcome {
            target_index: target.id as usize,
            target,
            impulse: Velocity { vx: 6.0, vy: 8.0 },
        }],
    );
    assert_eq!(world.velocity(target), Some(Velocity { vx: 7.0, vy: 7.0 }));
    assert!(pending.is_empty());
}

#[test]
fn collision_area_damage_reaction_damages_enemy_layer_targets_in_radius() {
    let mut world = World::default();
    let source = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let direct = world.spawn_enemy(4.0, 0.0, 1);
    let splash = world.spawn_enemy(18.0, 0.0, 1);
    let far = world.spawn_enemy(96.0, 0.0, 1);
    let pickup = world.spawn_entity();
    world.set_transform(pickup, Transform2D { x: 10.0, y: 0.0 });
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
    );
    world.set_damage(source, 2.0);
    world.set_health(direct, 2.0);
    world.set_health(splash, 3.0);
    world.set_health(far, 2.0);
    world.set_score_reward(direct, 7);
    world.set_score_reward(splash, 5);
    let pair = CollisionReactionPair::new(source.id as usize, direct.id as usize, source, direct);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::AreaDamage {
        radius: 24.0,
        target_layer: CollisionLayer::Enemy,
    }));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        true,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 1,
            despawn_on_kill: true,
        },
    );

    assert!(outcome.overrides_default_gameplay);
    assert_eq!(
        outcome.damage_outcomes().collect::<Vec<_>>(),
        vec![
            CollisionDamageReactionOutcome {
                target_index: direct.id as usize,
                target: direct,
                damage: 2.0,
                killed: true,
                target_removed: true,
                score_reward: 7,
            },
            CollisionDamageReactionOutcome {
                target_index: splash.id as usize,
                target: splash,
                damage: 2.0,
                killed: false,
                target_removed: false,
                score_reward: 0,
            },
        ],
    );
    assert_eq!(world.health(splash), Some(1.0));
    assert_eq!(world.health(far), Some(2.0));
    assert_eq!(world.health(pickup), None);
    assert_eq!(pending, vec![direct]);
}

#[test]
fn collision_area_damage_reaction_reports_faction_denials() {
    use crate::components::gameplay::{
        GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let source = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let blocked = world.spawn_enemy(4.0, 0.0, 1);
    world.set_damage(source, 2.0);
    world.set_health(blocked, 2.0);
    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
    );
    world.set_gameplay_faction(
        blocked,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    let pair = CollisionReactionPair::new(source.id as usize, blocked.id as usize, source, blocked);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::AreaDamage {
        radius: 24.0,
        target_layer: CollisionLayer::Enemy,
    }));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        true,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 1,
            despawn_on_kill: true,
        },
    );

    assert!(outcome.damage_outcomes().next().is_none());
    assert_eq!(
        outcome.faction_damage_denials().collect::<Vec<_>>(),
        vec![FactionDamageDenial {
            source,
            target: blocked,
            source_faction_id: GAMEPLAY_FACTION_PLAYER,
            target_faction_id: GAMEPLAY_FACTION_ENEMY,
        }],
    );
    assert_eq!(world.health(blocked), Some(2.0));
    assert!(pending.is_empty());
}

#[test]
fn collision_reaction_set_for_pair_keeps_side_effects_additive() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let other = world.spawn_entity();
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::PlaySound {
        sound_id: 5,
        volume: 0.75,
        pitch: 1.25,
        cooldown: Cooldown::ready(0.1),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    }));
    let pair = CollisionReactionPair::new(source.id as usize, other.id as usize, source, other);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let outcome = apply_collision_reaction_set_for_pair(
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

    assert!(!outcome.overrides_default_gameplay);
    assert!(outcome.replace_default_audio);
    assert_eq!(
        outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: true,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::PlaySound {
                sound_id: 5,
                volume: 0.75,
                pitch: 1.25,
            }),
        }],
    );
    assert!(pending.is_empty());
}

#[test]
fn collision_reaction_set_for_pair_preserves_reversed_target_orientation() {
    let mut world = World::default();
    let first = world.spawn_entity();
    let second = world.spawn_entity();
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::SpawnParticle {
        preset_id: 11,
        target: CollisionTarget::OtherEntity,
        cooldown: Cooldown::ready(0.0),
        replace_default: true,
        trigger: CollisionReactionTrigger::Enter,
    }));
    let pair =
        CollisionReactionPair::new(first.id as usize, second.id as usize, first, second).reversed();
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let outcome = apply_collision_reaction_set_for_pair(
        &mut world,
        pair,
        &mut reactions,
        true,
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
        outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: true,
            effect: Some(CollisionSideEffect::SpawnParticle {
                preset_id: 11,
                target_index: first.id as usize,
            }),
        }],
    );
}

#[test]
fn collision_reaction_sets_for_pair_applies_both_sides_and_writes_back_cooldowns() {
    let mut world = World::default();
    let first = world.spawn_entity();
    let second = world.spawn_entity();
    let mut first_reactions = CollisionReactionSet::default();
    assert!(first_reactions.push(CollisionReaction::PlaySound {
        sound_id: 7,
        volume: 0.5,
        pitch: 1.0,
        cooldown: Cooldown::ready(0.5),
        replace_default: false,
        trigger: CollisionReactionTrigger::Contact,
    }));
    let mut second_reactions = CollisionReactionSet::default();
    assert!(second_reactions.push(CollisionReaction::SpawnParticle {
        preset_id: 13,
        target: CollisionTarget::OtherEntity,
        cooldown: Cooldown::ready(0.0),
        replace_default: false,
        trigger: CollisionReactionTrigger::Contact,
    }));
    world.replace_collision_reactions(first, Some(first_reactions));
    world.replace_collision_reactions(second, Some(second_reactions));
    let pair = CollisionReactionPair::new(first.id as usize, second.id as usize, first, second);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_damage_hits = Vec::new();

    let outcome = apply_collision_reaction_sets_for_pair(
        &mut world,
        pair,
        false,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: false,
        },
    )
    .expect("pair has authored reactions");
    let applied = outcome.outcomes().collect::<Vec<_>>();
    assert_eq!(applied.len(), 2);
    assert_eq!(applied[0].pair, pair);
    assert_eq!(
        applied[0].outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::PlaySound {
                sound_id: 7,
                volume: 0.5,
                pitch: 1.0,
            }),
        }],
    );
    assert_eq!(applied[1].pair, pair.reversed());
    assert_eq!(
        applied[1].outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::SpawnParticle {
                preset_id: 13,
                target_index: first.id as usize,
            }),
        }],
    );

    let second_outcome = apply_collision_reaction_sets_for_pair(
        &mut world,
        pair,
        false,
        &mut area_damage_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: false,
        },
    )
    .expect("pair still has authored reactions");
    let second_applied = second_outcome.outcomes().collect::<Vec<_>>();
    assert_eq!(
        second_applied[0].outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: None,
        }],
    );
    assert!(pending.is_empty());
}
