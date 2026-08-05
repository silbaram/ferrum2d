use super::*;

pub(super) const MAX_COLLISION_GAMEPLAY_EVENTS_PER_REACTION_SET: usize =
    MAX_COLLISION_REACTIONS_PER_ENTITY * 3;

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_collision_reaction_set_for_pair<F>(
    world: &mut World,
    pair: CollisionReactionPair,
    reactions: &mut CollisionReactionSet,
    contact_entered: bool,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: F,
) -> CollisionReactionSetOutcome
where
    F: FnMut(&World, usize) -> CollisionDamageReactionDefaults,
{
    let mut outcome = CollisionReactionSetOutcome::default();
    for reaction in reactions.iter_mut() {
        match reaction {
            CollisionReaction::Damage { target } => {
                outcome.overrides_default_gameplay = true;
                let target_index = pair.target_index(*target);
                let damage_outcome = apply_collision_damage_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    damage_defaults_for(world, target_index),
                    marked_for_despawn,
                    pending_despawn,
                );
                if let Some(damage_outcome) = damage_outcome {
                    push_reaction_outcome(&mut outcome.damage_outcomes, damage_outcome);
                } else if let Some(denial) = collision_damage_reaction_faction_denial(
                    world,
                    pair,
                    *target,
                    marked_for_despawn,
                ) {
                    push_reaction_outcome(&mut outcome.faction_damage_denials, denial);
                }
            }
            CollisionReaction::AreaDamage {
                radius,
                target_layer,
            } => {
                outcome.overrides_default_gameplay = true;
                let area_outcome = apply_collision_area_damage_reaction_for_pair(
                    world,
                    pair,
                    *radius,
                    *target_layer,
                    area_damage_hits,
                    marked_for_despawn,
                    pending_despawn,
                    &mut damage_defaults_for,
                );
                for damage_outcome in area_outcome.damage_outcomes() {
                    push_reaction_outcome(&mut outcome.damage_outcomes, damage_outcome);
                }
                for denial in area_outcome.faction_damage_denials() {
                    push_reaction_outcome(&mut outcome.faction_damage_denials, denial);
                }
            }
            CollisionReaction::Pickup { target } => {
                outcome.overrides_default_gameplay = true;
                let pickup_outcome = apply_collision_pickup_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    marked_for_despawn,
                    pending_despawn,
                );
                if let Some(pickup_outcome) = pickup_outcome {
                    push_reaction_outcome(&mut outcome.pickup_outcomes, pickup_outcome);
                }
            }
            CollisionReaction::Knockback { target, impulse } => {
                let knockback_outcome = apply_collision_knockback_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    *impulse,
                    marked_for_despawn,
                );
                if let Some(knockback_outcome) = knockback_outcome {
                    push_reaction_outcome(&mut outcome.knockback_outcomes, knockback_outcome);
                }
            }
            CollisionReaction::Despawn { target } => {
                outcome.overrides_default_gameplay = true;
                let despawn_outcome = apply_collision_despawn_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    marked_for_despawn,
                    pending_despawn,
                );
                if let Some(despawn_outcome) = despawn_outcome {
                    push_reaction_outcome(&mut outcome.despawn_outcomes, despawn_outcome);
                }
            }
            CollisionReaction::PlaySound { .. }
            | CollisionReaction::SpawnParticle { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::EmitEffect { .. } => {
                if let Some(evaluation) =
                    commit_collision_side_effect_reaction_for_pair(pair, reaction, contact_entered)
                {
                    outcome.replace_default_audio |= evaluation.replace_default_audio;
                    outcome.replace_default_particle |= evaluation.replace_default_particle;
                    push_reaction_outcome(&mut outcome.side_effects, evaluation);
                }
            }
            CollisionReaction::SpawnPrefab { .. } => {
                if let Some(evaluation) =
                    collision_spawn_prefab_reaction_for_pair(pair, *reaction, contact_entered)
                {
                    push_reaction_outcome(&mut outcome.spawn_prefabs, evaluation);
                }
            }
        }
    }
    outcome
}

pub(crate) fn apply_collision_reaction_sets_for_pair<F>(
    world: &mut World,
    pair: CollisionReactionPair,
    contact_entered: bool,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    damage_defaults: F,
) -> Option<CollisionReactionSetsForPairOutcome>
where
    F: Fn(&World, usize) -> CollisionDamageReactionDefaults + Copy,
{
    let first_reactions = world.collision_reactions_at_index(pair.source_index);
    let second_reactions = world.collision_reactions_at_index(pair.other_index);
    if first_reactions.is_none() && second_reactions.is_none() {
        return None;
    }

    let mut outcome = CollisionReactionSetsForPairOutcome::default();
    if let Some(mut reactions) = first_reactions {
        let reaction_outcome = apply_collision_reaction_set_for_pair(
            world,
            pair,
            &mut reactions,
            contact_entered,
            area_damage_hits,
            marked_for_despawn,
            pending_despawn,
            damage_defaults,
        );
        outcome.push(pair, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.source_index, Some(reactions));
    }
    if let Some(mut reactions) = second_reactions {
        let reversed = pair.reversed();
        let reaction_outcome = apply_collision_reaction_set_for_pair(
            world,
            reversed,
            &mut reactions,
            contact_entered,
            area_damage_hits,
            marked_for_despawn,
            pending_despawn,
            damage_defaults,
        );
        outcome.push(reversed, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.other_index, Some(reactions));
    }
    Some(outcome)
}

pub(crate) fn has_collision_reaction_sets_for_pair(
    world: &World,
    pair: CollisionReactionPair,
) -> bool {
    world
        .collision_reactions_at_index(pair.source_index)
        .is_some()
        || world
            .collision_reactions_at_index(pair.other_index)
            .is_some()
}

pub(crate) fn summarize_collision_reaction_set_outcome<F>(
    reaction_outcome: &CollisionReactionSetOutcome,
    mut target_role: F,
) -> CollisionReactionOutcomeSummary
where
    F: FnMut(usize) -> CollisionReactionTargetRole,
{
    let mut summary = CollisionReactionOutcomeSummary {
        overrides_default_gameplay: reaction_outcome.overrides_default_gameplay,
        replace_default_audio: reaction_outcome.replace_default_audio,
        replace_default_particle: reaction_outcome.replace_default_particle,
        ..CollisionReactionOutcomeSummary::default()
    };

    for damage_outcome in reaction_outcome.damage_outcomes() {
        summary.total_damage += damage_outcome.damage;
        match target_role(damage_outcome.target_index) {
            CollisionReactionTargetRole::Enemy => {
                summary.enemy_damaged = true;
                if damage_outcome.killed {
                    summary.enemy_removed = true;
                    summary.score_delta = summary
                        .score_delta
                        .saturating_add(damage_outcome.score_reward);
                }
            }
            CollisionReactionTargetRole::Player => {
                if damage_outcome.killed {
                    summary.player_game_over = true;
                }
            }
            CollisionReactionTargetRole::Other => {
                if damage_outcome.killed {
                    summary.score_delta = summary
                        .score_delta
                        .saturating_add(damage_outcome.score_reward);
                }
            }
        }
    }

    for pickup_outcome in reaction_outcome.pickup_outcomes() {
        summary.pickup_collected = true;
        summary.score_delta = summary.score_delta.saturating_add(pickup_outcome.count);
    }

    summary.faction_damage_denied = reaction_outcome.faction_damage_denials().next().is_some();

    for despawn_outcome in reaction_outcome.despawn_outcomes() {
        if target_role(despawn_outcome.target_index) == CollisionReactionTargetRole::Enemy {
            summary.enemy_removed = true;
        }
    }

    summary
}

pub(crate) fn collision_gameplay_events_for_reaction_outcome(
    context: CollisionReactionPair,
    reaction_outcome: &CollisionReactionSetOutcome,
) -> CollisionGameplayEventPayloadSet {
    let mut events = CollisionGameplayEventPayloadSet::default();

    for damage_outcome in reaction_outcome.damage_outcomes() {
        events.push(CollisionGameplayEventPayload::Damage {
            target: damage_outcome.target,
            source: context.source,
            damage: damage_outcome.damage,
            target_removed: damage_outcome.target_removed,
        });
    }

    for denial in reaction_outcome.faction_damage_denials() {
        events.push(CollisionGameplayEventPayload::FactionDamageDenied {
            target: denial.target,
            source: denial.source,
            source_faction_id: denial.source_faction_id,
            target_faction_id: denial.target_faction_id,
        });
    }

    for pickup_outcome in reaction_outcome.pickup_outcomes() {
        events.push(CollisionGameplayEventPayload::PickupCollected {
            collector: pickup_outcome.collector,
            pickup: pickup_outcome.pickup,
            item_id: pickup_outcome.item_id,
            count: pickup_outcome.count,
            target_removed: pickup_outcome.target_removed,
        });
    }

    for despawn_outcome in reaction_outcome.despawn_outcomes() {
        events.push(CollisionGameplayEventPayload::Despawn {
            target: despawn_outcome.target,
            source: context.source,
        });
    }

    events
}

pub(crate) const fn default_collision_damage_gameplay_event_payload(
    outcome: DefaultCollisionDamageHitOutcome,
) -> CollisionGameplayEventPayload {
    CollisionGameplayEventPayload::Damage {
        target: outcome.target,
        source: outcome.source,
        damage: outcome.damage,
        target_removed: outcome.target_removed,
    }
}

pub(crate) const fn default_collision_damage_score_delta(
    outcome: DefaultCollisionDamageHitOutcome,
) -> u32 {
    if outcome.killed {
        outcome.score_reward
    } else {
        0
    }
}

pub(crate) fn commit_score_delta(score: &mut u32, delta: u32) {
    *score = (*score).saturating_add(delta);
}

pub(in crate::gameplay) fn push_reaction_outcome<T: Copy>(
    outcomes: &mut [Option<T>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    outcome: T,
) {
    if let Some(slot) = outcomes.iter_mut().find(|slot| slot.is_none()) {
        *slot = Some(outcome);
    }
}
