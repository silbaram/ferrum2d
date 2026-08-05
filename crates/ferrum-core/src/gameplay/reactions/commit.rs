use super::*;

pub(crate) fn apply_collision_despawn_reaction_for_pair(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<CollisionDespawnReactionOutcome> {
    let target_index = pair.target_index(target);
    let target_entity = pair.target_entity(target);
    queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn).then_some(
        CollisionDespawnReactionOutcome {
            target_index,
            target: target_entity,
        },
    )
}

pub(crate) fn apply_collision_pickup_reaction_for_pair(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<CollisionPickupReactionOutcome> {
    let (pickup_index, pickup_entity, collector_index, collector_entity) = match target {
        CollisionTarget::SelfEntity => {
            (pair.source_index, pair.source, pair.other_index, pair.other)
        }
        CollisionTarget::OtherEntity => {
            (pair.other_index, pair.other, pair.source_index, pair.source)
        }
    };

    if !is_alive_layer(world, collector_index, CollisionLayer::Player)
        || marked_for_despawn
            .get(collector_index)
            .copied()
            .unwrap_or(false)
        || !is_alive_layer(world, pickup_index, CollisionLayer::Pickup)
        || marked_for_despawn
            .get(pickup_index)
            .copied()
            .unwrap_or(false)
    {
        return None;
    }

    let pickup = world.pickup_at_index(pickup_index)?;
    if pickup.item_id != GAMEPLAY_PICKUP_ITEM_SCORE || !pickup.despawn_on_collect {
        return None;
    }

    let target_removed =
        queue_marked_despawn(world, pickup_index, marked_for_despawn, pending_despawn);
    target_removed.then_some(CollisionPickupReactionOutcome {
        pickup_index,
        pickup: pickup_entity,
        collector_index,
        collector: collector_entity,
        item_id: pickup.item_id,
        count: pickup.count,
        target_removed,
    })
}

pub(crate) fn commit_collision_side_effect_reaction_for_pair(
    pair: CollisionReactionPair,
    reaction: &mut CollisionReaction,
    contact_entered: bool,
) -> Option<CollisionSideEffectEvaluation> {
    match reaction {
        CollisionReaction::PlaySound {
            sound_id,
            volume,
            pitch,
            cooldown,
            replace_default,
            trigger,
        } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::PlaySound {
                    sound_id: *sound_id,
                    volume: *volume,
                    pitch: *pitch,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: *replace_default,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::SpawnParticle {
            preset_id,
            target,
            cooldown,
            replace_default,
            trigger,
        } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::SpawnParticle {
                    preset_id: *preset_id,
                    target_index: pair.target_index(*target),
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: *replace_default,
                effect,
            })
        }
        CollisionReaction::CameraShake { cooldown, trigger } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::CameraShake)
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::EmitEffect {
            effect_id,
            effect_type,
            target,
            intensity,
            radius,
            cooldown,
            trigger,
        } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::EmitEffect {
                    effect_id: *effect_id,
                    effect_type: *effect_type,
                    target_index: pair.target_index(*target),
                    intensity: *intensity,
                    radius: *radius,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::Damage { .. }
        | CollisionReaction::AreaDamage { .. }
        | CollisionReaction::Knockback { .. }
        | CollisionReaction::Pickup { .. }
        | CollisionReaction::Despawn { .. }
        | CollisionReaction::SpawnPrefab { .. } => None,
    }
}

pub(crate) fn collision_spawn_prefab_reaction_for_pair(
    pair: CollisionReactionPair,
    reaction: CollisionReaction,
    contact_entered: bool,
) -> Option<CollisionSpawnPrefabEvaluation> {
    let CollisionReaction::SpawnPrefab {
        action_id,
        prefab_id,
        target,
        cooldown,
        trigger,
        offset_x,
        offset_y,
    } = reaction
    else {
        return None;
    };
    if !trigger.is_allowed(contact_entered) || !cooldown.is_ready() {
        return None;
    }
    Some(CollisionSpawnPrefabEvaluation {
        reaction_owner_index: pair.source_index,
        source: pair.source,
        action_id,
        prefab_id,
        target,
        anchor_index: pair.target_index(target),
        anchor: pair.target_entity(target),
        offset_x,
        offset_y,
    })
}

pub(crate) fn commit_tile_collision_side_effect_reaction(
    source_index: usize,
    reaction: &mut CollisionReaction,
) -> Option<CollisionSideEffectEvaluation> {
    match reaction {
        CollisionReaction::PlaySound {
            sound_id,
            volume,
            pitch,
            cooldown,
            trigger,
            ..
        } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::PlaySound {
                    sound_id: *sound_id,
                    volume: *volume,
                    pitch: *pitch,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::SpawnParticle {
            preset_id,
            target: CollisionTarget::SelfEntity,
            cooldown,
            trigger,
            ..
        } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::SpawnParticle {
                    preset_id: *preset_id,
                    target_index: source_index,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::CameraShake { cooldown, trigger } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::CameraShake)
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::EmitEffect {
            effect_id,
            effect_type,
            target: CollisionTarget::SelfEntity,
            intensity,
            radius,
            cooldown,
            trigger,
        } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::EmitEffect {
                    effect_id: *effect_id,
                    effect_type: *effect_type,
                    target_index: source_index,
                    intensity: *intensity,
                    radius: *radius,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::SpawnParticle {
            target: CollisionTarget::OtherEntity,
            ..
        }
        | CollisionReaction::EmitEffect {
            target: CollisionTarget::OtherEntity,
            ..
        }
        | CollisionReaction::AreaDamage { .. }
        | CollisionReaction::Knockback { .. }
        | CollisionReaction::Damage { .. }
        | CollisionReaction::Pickup { .. }
        | CollisionReaction::Despawn { .. }
        | CollisionReaction::SpawnPrefab { .. } => None,
    }
}

pub(crate) fn tile_collision_spawn_prefab_reaction(
    world: &World,
    source_index: usize,
    reaction: CollisionReaction,
) -> Option<CollisionSpawnPrefabEvaluation> {
    let CollisionReaction::SpawnPrefab {
        action_id,
        prefab_id,
        target,
        cooldown,
        trigger,
        offset_x,
        offset_y,
    } = reaction
    else {
        return None;
    };
    if target != CollisionTarget::SelfEntity || !trigger.is_allowed(true) || !cooldown.is_ready() {
        return None;
    }
    let source = entity_at(world, source_index)?;
    Some(CollisionSpawnPrefabEvaluation {
        reaction_owner_index: source_index,
        source,
        action_id,
        prefab_id,
        target,
        anchor_index: source_index,
        anchor: source,
        offset_x,
        offset_y,
    })
}

pub(crate) fn commit_collision_spawn_prefab_reaction_cooldown(
    world: &mut World,
    evaluation: CollisionSpawnPrefabEvaluation,
) -> bool {
    let Some(mut reactions) = world.collision_reactions_at_index(evaluation.reaction_owner_index)
    else {
        return false;
    };
    let mut committed = false;
    for reaction in reactions.iter_mut() {
        let CollisionReaction::SpawnPrefab {
            action_id,
            cooldown,
            ..
        } = reaction
        else {
            continue;
        };
        if *action_id != evaluation.action_id || !cooldown.is_ready() {
            continue;
        }
        cooldown.commit();
        committed = true;
        break;
    }
    if !committed {
        return false;
    }
    world.replace_collision_reactions_at_index(evaluation.reaction_owner_index, Some(reactions))
}
