use super::*;

#[test]
fn damage_reduces_health_and_returns_reward_only_on_kill() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(0.0, 0.0, 1);
    let enemy_index = enemy.id as usize;
    world.set_health(enemy, 3.0);
    world.set_score_reward(enemy, 7);

    let first = apply_damage_to_health(&mut world, enemy_index, 1.0, 5.0, 1);
    assert_eq!(
        first,
        DamageOutcome {
            remaining_health: 2.0,
            killed: false,
            score_reward: 0,
        }
    );

    let second = apply_damage_to_health(&mut world, enemy_index, 2.0, 5.0, 1);
    assert_eq!(
        second,
        DamageOutcome {
            remaining_health: 0.0,
            killed: true,
            score_reward: 7,
        }
    );
}

#[test]
fn tile_collision_side_effect_reaction_is_self_only_and_ignores_replace_policy() {
    let mut sound = CollisionReaction::PlaySound {
        sound_id: 7,
        volume: 0.5,
        pitch: 1.1,
        cooldown: Cooldown::ready(0.0),
        replace_default: true,
        trigger: CollisionReactionTrigger::Enter,
    };
    assert_eq!(
        commit_tile_collision_side_effect_reaction(3, &mut sound),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::PlaySound {
                sound_id: 7,
                volume: 0.5,
                pitch: 1.1,
            }),
        }),
    );

    let mut particle = CollisionReaction::SpawnParticle {
        preset_id: 4,
        target: CollisionTarget::OtherEntity,
        cooldown: Cooldown::ready(0.5),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    };
    assert_eq!(
        commit_tile_collision_side_effect_reaction(3, &mut particle),
        None,
    );
    assert_eq!(
        particle,
        CollisionReaction::SpawnParticle {
            preset_id: 4,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.5),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        },
    );

    let mut emit = CollisionReaction::EmitEffect {
        effect_id: 77,
        effect_type: 4,
        target: CollisionTarget::SelfEntity,
        intensity: 0.25,
        radius: 18.0,
        cooldown: Cooldown::ready(0.0),
        trigger: CollisionReactionTrigger::Contact,
    };
    assert_eq!(
        commit_tile_collision_side_effect_reaction(3, &mut emit),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::EmitEffect {
                effect_id: 77,
                effect_type: 4,
                target_index: 3,
                intensity: 0.25,
                radius: 18.0,
            }),
        }),
    );

    let mut other_emit = CollisionReaction::EmitEffect {
        effect_id: 78,
        effect_type: 4,
        target: CollisionTarget::OtherEntity,
        intensity: 1.0,
        radius: 0.0,
        cooldown: Cooldown::ready(0.0),
        trigger: CollisionReactionTrigger::Contact,
    };
    assert_eq!(
        commit_tile_collision_side_effect_reaction(3, &mut other_emit),
        None,
    );
}

#[test]
fn tile_collision_side_effect_reaction_ignores_non_self_particle_and_queues_camera_shake() {
    let mut shake = CollisionReaction::CameraShake {
        cooldown: Cooldown::ready(0.5),
        trigger: CollisionReactionTrigger::Contact,
    };
    assert_eq!(
        commit_tile_collision_side_effect_reaction(3, &mut shake),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::CameraShake),
        }),
    );

    let mut shake_enter = CollisionReaction::CameraShake {
        cooldown: Cooldown::ready(0.5),
        trigger: CollisionReactionTrigger::Enter,
    };
    assert_eq!(
        commit_tile_collision_side_effect_reaction(3, &mut shake_enter),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::CameraShake),
        }),
    );
}

#[test]
fn tile_collision_reaction_set_queues_self_despawn_and_side_effects() {
    let mut world = World::default();
    let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let bullet_index = bullet.id as usize;
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::PlaySound {
        sound_id: 7,
        volume: 0.5,
        pitch: 1.1,
        cooldown: Cooldown::ready(0.0),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    }));
    assert!(reactions.push(CollisionReaction::Despawn {
        target: CollisionTarget::SelfEntity,
    }));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_hits = Vec::new();

    let outcome = apply_tile_collision_reaction_set(
        &mut world,
        bullet_index,
        Transform2D { x: 0.0, y: 0.0 },
        &mut reactions,
        &mut area_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: true,
        },
    );

    assert!(outcome.queued_self_despawn);
    assert_eq!(
        outcome.despawn_outcome,
        Some(CollisionDespawnReactionOutcome {
            target_index: bullet_index,
            target: bullet,
        }),
    );
    assert_eq!(pending, vec![bullet]);
    assert_eq!(
        outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::PlaySound {
                sound_id: 7,
                volume: 0.5,
                pitch: 1.1,
            }),
        }],
    );
}

#[test]
fn tile_collision_reaction_set_ignores_entity_only_targets_without_cooldown_commit() {
    let mut world = World::default();
    let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Despawn {
        target: CollisionTarget::OtherEntity,
    }));
    assert!(reactions.push(CollisionReaction::SpawnParticle {
        preset_id: 4,
        target: CollisionTarget::OtherEntity,
        cooldown: Cooldown::ready(0.5),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    }));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_hits = Vec::new();

    let outcome = apply_tile_collision_reaction_set(
        &mut world,
        bullet.id as usize,
        Transform2D { x: 0.0, y: 0.0 },
        &mut reactions,
        &mut area_hits,
        &mut marked,
        &mut pending,
        |_, _| CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: true,
        },
    );

    assert!(!outcome.queued_self_despawn);
    assert_eq!(outcome.despawn_outcome, None);
    assert!(outcome.side_effects().collect::<Vec<_>>().is_empty());
    assert!(pending.is_empty());
    assert_eq!(
        reactions.iter().collect::<Vec<_>>(),
        vec![
            CollisionReaction::Despawn {
                target: CollisionTarget::OtherEntity,
            },
            CollisionReaction::SpawnParticle {
                preset_id: 4,
                target: CollisionTarget::OtherEntity,
                cooldown: Cooldown::ready(0.5),
                replace_default: true,
                trigger: CollisionReactionTrigger::Contact,
            },
        ],
    );
}

#[test]
fn tile_collision_area_damage_reaction_uses_impact_center() {
    let mut world = World::default();
    let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let direct = world.spawn_enemy(10.0, 0.0, 1);
    let splash = world.spawn_enemy(15.0, 0.0, 1);
    let far = world.spawn_enemy(40.0, 0.0, 1);
    world.set_damage(bullet, 2.0);
    world.set_health(direct, 2.0);
    world.set_health(splash, 3.0);
    world.set_health(far, 2.0);
    world.set_score_reward(direct, 7);
    world.set_score_reward(splash, 11);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::AreaDamage {
        radius: 12.0,
        target_layer: CollisionLayer::Enemy,
    }));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();
    let mut area_hits = Vec::new();

    let outcome = apply_tile_collision_reaction_set(
        &mut world,
        bullet.id as usize,
        Transform2D { x: 5.0, y: 0.0 },
        &mut reactions,
        &mut area_hits,
        &mut marked,
        &mut pending,
        |world, target_index| CollisionDamageReactionDefaults {
            health: world.health_at_index(target_index).unwrap_or(1.0),
            score_reward: world.score_reward_at_index(target_index).unwrap_or(0),
            despawn_on_kill: true,
        },
    );

    assert_eq!(
        outcome
            .reaction_outcome()
            .damage_outcomes()
            .map(|outcome| (outcome.target, outcome.damage, outcome.killed))
            .collect::<Vec<_>>(),
        vec![(direct, 2.0, true), (splash, 2.0, false)],
    );
    assert!(marked[direct.id as usize]);
    assert_eq!(pending, vec![direct]);
    assert_eq!(world.health(splash), Some(1.0));
    assert_eq!(world.health(far), Some(2.0));
}

#[test]
fn collision_damage_reaction_for_pair_damages_and_queues_kill() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_enemy(0.0, 0.0, 1);
    world.set_damage(source, 2.0);
    world.set_health(target, 2.0);
    world.set_score_reward(target, 7);
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    assert_eq!(
        apply_collision_damage_reaction_for_pair(
            &mut world,
            pair,
            CollisionTarget::OtherEntity,
            CollisionDamageReactionDefaults {
                health: 5.0,
                score_reward: 7,
                despawn_on_kill: true,
            },
            &mut marked,
            &mut pending,
        ),
        Some(CollisionDamageReactionOutcome {
            target_index: target.id as usize,
            target,
            damage: 2.0,
            killed: true,
            target_removed: true,
            score_reward: 7,
        }),
    );
    assert_eq!(world.health(target), Some(0.0));
    assert_eq!(pending, vec![target]);
}

#[test]
fn collision_damage_reaction_for_pair_can_leave_killed_target_in_place() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_entity();
    world.set_damage(source, 1.0);
    world.set_health(target, 1.0);
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    let outcome = apply_collision_damage_reaction_for_pair(
        &mut world,
        pair,
        CollisionTarget::OtherEntity,
        CollisionDamageReactionDefaults {
            health: 1.0,
            score_reward: 0,
            despawn_on_kill: false,
        },
        &mut marked,
        &mut pending,
    )
    .unwrap();

    assert!(outcome.killed);
    assert!(!outcome.target_removed);
    assert!(pending.is_empty());
}
