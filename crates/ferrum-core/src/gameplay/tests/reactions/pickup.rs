use super::*;

#[test]
fn collision_despawn_reaction_for_pair_queues_target_once() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_entity();
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    assert_eq!(
        apply_collision_despawn_reaction_for_pair(
            &world,
            pair,
            CollisionTarget::OtherEntity,
            &mut marked,
            &mut pending,
        ),
        Some(CollisionDespawnReactionOutcome {
            target_index: target.id as usize,
            target,
        }),
    );
    assert_eq!(pending, vec![target]);
    assert_eq!(
        apply_collision_despawn_reaction_for_pair(
            &world,
            pair,
            CollisionTarget::OtherEntity,
            &mut marked,
            &mut pending,
        ),
        None,
    );
    assert_eq!(pending, vec![target]);
}

#[test]
fn collision_pickup_reaction_for_pair_collects_score_pickup_once() {
    let mut world = World::default();
    let collector = world.spawn_player(0.0, 0.0, 1);
    let pickup = world.spawn_entity();
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true)));
    let pair =
        CollisionReactionPair::new(pickup.id as usize, collector.id as usize, pickup, collector);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    assert_eq!(
        apply_collision_pickup_reaction_for_pair(
            &world,
            pair,
            CollisionTarget::SelfEntity,
            &mut marked,
            &mut pending,
        ),
        Some(CollisionPickupReactionOutcome {
            pickup_index: pickup.id as usize,
            pickup,
            collector_index: collector.id as usize,
            collector,
            item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
            count: 3,
            target_removed: true,
        }),
    );
    assert_eq!(pending, vec![pickup]);
    assert_eq!(
        apply_collision_pickup_reaction_for_pair(
            &world,
            pair,
            CollisionTarget::SelfEntity,
            &mut marked,
            &mut pending,
        ),
        None,
    );
    assert_eq!(pending, vec![pickup]);
}

#[test]
fn collision_pickup_reaction_for_pair_rejects_non_pickup_targets() {
    let mut world = World::default();
    let collector = world.spawn_player(0.0, 0.0, 1);
    let enemy = world.spawn_enemy(4.0, 0.0, 1);
    let pair =
        CollisionReactionPair::new(enemy.id as usize, collector.id as usize, enemy, collector);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    assert_eq!(
        apply_collision_pickup_reaction_for_pair(
            &world,
            pair,
            CollisionTarget::SelfEntity,
            &mut marked,
            &mut pending,
        ),
        None,
    );
    assert!(pending.is_empty());
}

#[test]
fn pickup_collision_reaction_set_handles_pickup_and_side_effects_only() {
    let mut world = World::default();
    let collector = world.spawn_player(0.0, 0.0, 1);
    let pickup = world.spawn_entity();
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 5, true)));
    let pair =
        CollisionReactionPair::new(pickup.id as usize, collector.id as usize, pickup, collector);
    let mut reactions = CollisionReactionSet::default();
    assert!(reactions.push(CollisionReaction::Pickup {
        target: CollisionTarget::SelfEntity,
    }));
    assert!(reactions.push(CollisionReaction::PlaySound {
        sound_id: 12,
        volume: 0.25,
        pitch: 1.5,
        cooldown: Cooldown::ready(0.0),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    }));
    assert!(reactions.push(CollisionReaction::Despawn {
        target: CollisionTarget::OtherEntity,
    }));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    let outcome = apply_pickup_collision_reaction_set_for_pair(
        &world,
        pair,
        &mut reactions,
        false,
        &mut marked,
        &mut pending,
    );

    assert!(outcome.handled_pickup);
    assert_eq!(
        outcome.pickup_outcomes().collect::<Vec<_>>(),
        vec![CollisionPickupReactionOutcome {
            pickup_index: pickup.id as usize,
            pickup,
            collector_index: collector.id as usize,
            collector,
            item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
            count: 5,
            target_removed: true,
        }],
    );
    assert_eq!(
        outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: true,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::PlaySound {
                sound_id: 12,
                volume: 0.25,
                pitch: 1.5,
            }),
        }],
    );
    assert_eq!(pending, vec![pickup]);
}

#[test]
fn pickup_collision_reaction_set_side_effects_are_additive_and_wrong_pickup_suppresses_fallback() {
    let mut world = World::default();
    let collector = world.spawn_player(0.0, 0.0, 1);
    let pickup = world.spawn_entity();
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 1, true)));
    let pair =
        CollisionReactionPair::new(collector.id as usize, pickup.id as usize, collector, pickup);
    let mut side_effect_only = CollisionReactionSet::default();
    assert!(side_effect_only.push(CollisionReaction::SpawnParticle {
        preset_id: 3,
        target: CollisionTarget::OtherEntity,
        cooldown: Cooldown::ready(0.25),
        replace_default: true,
        trigger: CollisionReactionTrigger::Enter,
    }));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    let additive = apply_pickup_collision_reaction_set_for_pair(
        &world,
        pair,
        &mut side_effect_only,
        false,
        &mut marked,
        &mut pending,
    );
    assert!(!additive.handled_pickup);
    assert_eq!(
        additive.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: true,
            effect: None,
        }],
    );
    assert!(pending.is_empty());

    let additive_enter = apply_pickup_collision_reaction_set_for_pair(
        &world,
        pair,
        &mut side_effect_only,
        true,
        &mut marked,
        &mut pending,
    );
    assert!(!additive_enter.handled_pickup);
    assert_eq!(
        additive_enter.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: true,
            effect: Some(CollisionSideEffect::SpawnParticle {
                preset_id: 3,
                target_index: pickup.id as usize,
            }),
        }],
    );

    let mut wrong_pickup = CollisionReactionSet::default();
    assert!(wrong_pickup.push(CollisionReaction::Pickup {
        target: CollisionTarget::SelfEntity,
    }));
    let wrong = apply_pickup_collision_reaction_set_for_pair(
        &world,
        pair,
        &mut wrong_pickup,
        true,
        &mut marked,
        &mut pending,
    );
    assert!(wrong.handled_pickup);
    assert!(wrong.pickup_outcomes().collect::<Vec<_>>().is_empty());
    assert!(pending.is_empty());
}

#[test]
fn pickup_collision_reaction_sets_for_pair_applies_both_sides_and_writes_cooldowns_back() {
    let mut world = World::default();
    let collector = world.spawn_player(0.0, 0.0, 1);
    let pickup = world.spawn_entity();
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 5, true)));
    let pair =
        CollisionReactionPair::new(collector.id as usize, pickup.id as usize, collector, pickup);
    let mut collector_reactions = CollisionReactionSet::default();
    assert!(collector_reactions.push(CollisionReaction::PlaySound {
        sound_id: 12,
        volume: 0.25,
        pitch: 1.5,
        cooldown: Cooldown::ready(0.25),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    }));
    let mut pickup_reactions = CollisionReactionSet::default();
    assert!(pickup_reactions.push(CollisionReaction::Pickup {
        target: CollisionTarget::SelfEntity,
    }));
    world.replace_collision_reactions(collector, Some(collector_reactions));
    world.replace_collision_reactions(pickup, Some(pickup_reactions));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    assert!(has_collision_reaction_sets_for_pair(&world, pair));
    let outcome = apply_pickup_collision_reaction_sets_for_pair(
        &mut world,
        pair,
        false,
        &mut marked,
        &mut pending,
    )
    .expect("reaction sets are present");

    assert!(outcome.handled_pickup);
    let applied = outcome.outcomes().collect::<Vec<_>>();
    assert_eq!(applied.len(), 2);
    assert_eq!(applied[0].pair, pair);
    assert_eq!(
        applied[0].outcome.side_effects().collect::<Vec<_>>(),
        vec![CollisionSideEffectEvaluation {
            replace_default_audio: true,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::PlaySound {
                sound_id: 12,
                volume: 0.25,
                pitch: 1.5,
            }),
        }],
    );
    assert_eq!(applied[1].pair, pair.reversed());
    assert_eq!(
        applied[1].outcome.pickup_outcomes().collect::<Vec<_>>(),
        vec![CollisionPickupReactionOutcome {
            pickup_index: pickup.id as usize,
            pickup,
            collector_index: collector.id as usize,
            collector,
            item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
            count: 5,
            target_removed: true,
        }],
    );
    assert_eq!(pending, vec![pickup]);
    assert_eq!(
        world
            .collision_reactions(collector)
            .expect("collector reactions are written back")
            .iter()
            .collect::<Vec<_>>(),
        vec![CollisionReaction::PlaySound {
            sound_id: 12,
            volume: 0.25,
            pitch: 1.5,
            cooldown: Cooldown {
                duration_seconds: 0.25,
                remaining_seconds: 0.25,
            },
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        }],
    );
}

#[test]
fn pickup_collision_reaction_sets_for_pair_preserves_wrong_target_fallback_suppression() {
    let mut world = World::default();
    let collector = world.spawn_player(0.0, 0.0, 1);
    let pickup = world.spawn_entity();
    world.set_aabb_collider(
        pickup,
        AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
    );
    assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 1, true)));
    let pair =
        CollisionReactionPair::new(collector.id as usize, pickup.id as usize, collector, pickup);
    let mut collector_reactions = CollisionReactionSet::default();
    assert!(collector_reactions.push(CollisionReaction::Pickup {
        target: CollisionTarget::SelfEntity,
    }));
    world.replace_collision_reactions(collector, Some(collector_reactions));
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    let outcome = apply_pickup_collision_reaction_sets_for_pair(
        &mut world,
        pair,
        true,
        &mut marked,
        &mut pending,
    )
    .expect("reaction set is present");

    assert!(outcome.handled_pickup);
    let applied = outcome.outcomes().collect::<Vec<_>>();
    assert_eq!(applied.len(), 1);
    assert!(applied[0].outcome.pickup_outcomes().next().is_none());
    assert!(pending.is_empty());
}
