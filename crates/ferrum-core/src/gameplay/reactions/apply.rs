use super::*;

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_default_collision_damage_hit(
    world: &mut World,
    source_index: usize,
    target_index: usize,
    damage: f32,
    default_target_health: f32,
    default_score_reward: u32,
    despawn_source: bool,
    despawn_target_on_kill: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<DefaultCollisionDamageHitOutcome> {
    let source = entity_at(world, source_index)?;
    let target = entity_at(world, target_index)?;
    let source_removed = despawn_source
        && queue_marked_despawn(world, source_index, marked_for_despawn, pending_despawn);
    let damage_outcome = apply_damage_to_health(
        world,
        target_index,
        damage,
        default_target_health,
        default_score_reward,
    );
    let target_removed = damage_outcome.killed
        && despawn_target_on_kill
        && queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn);

    Some(DefaultCollisionDamageHitOutcome {
        source_index,
        source,
        source_removed,
        target_index,
        target,
        damage,
        killed: damage_outcome.killed,
        target_removed,
        score_reward: damage_outcome.score_reward,
    })
}

pub(crate) fn apply_default_collision_game_over_hit(
    world: &World,
    source_index: usize,
    target_index: usize,
    damage: f32,
    despawn_source: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<DefaultCollisionGameOverHitOutcome> {
    let source = entity_at(world, source_index)?;
    let target = entity_at(world, target_index)?;
    let source_removed = despawn_source
        && queue_marked_despawn(world, source_index, marked_for_despawn, pending_despawn);

    Some(DefaultCollisionGameOverHitOutcome {
        source_index,
        source,
        source_removed,
        target_index,
        target,
        damage,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_tile_collision_reaction_set(
    world: &mut World,
    source_index: usize,
    impact_center: Transform2D,
    reactions: &mut CollisionReactionSet,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: impl FnMut(&World, usize) -> CollisionDamageReactionDefaults,
) -> TileCollisionReactionSetOutcome {
    let mut outcome = TileCollisionReactionSetOutcome::default();
    for reaction in reactions.iter_mut() {
        match reaction {
            CollisionReaction::AreaDamage {
                radius,
                target_layer,
            } => {
                let query_height_span = world.height_span_at(source_index);
                let area_outcome = apply_collision_area_damage_reaction_at_center(
                    world,
                    source_index,
                    impact_center,
                    *radius,
                    *target_layer,
                    query_height_span,
                    area_damage_hits,
                    marked_for_despawn,
                    pending_despawn,
                    &mut damage_defaults_for,
                );
                for damage_outcome in area_outcome.damage_outcomes() {
                    push_reaction_outcome(
                        &mut outcome.reaction_outcome.damage_outcomes,
                        damage_outcome,
                    );
                }
                for denial in area_outcome.faction_damage_denials() {
                    push_reaction_outcome(
                        &mut outcome.reaction_outcome.faction_damage_denials,
                        denial,
                    );
                }
            }
            CollisionReaction::Despawn {
                target: CollisionTarget::SelfEntity,
            } => {
                if queue_marked_despawn(world, source_index, marked_for_despawn, pending_despawn) {
                    outcome.queued_self_despawn = true;
                    if let Some(source) = entity_at(world, source_index) {
                        outcome.despawn_outcome = Some(CollisionDespawnReactionOutcome {
                            target_index: source_index,
                            target: source,
                        });
                    }
                }
            }
            CollisionReaction::PlaySound { .. }
            | CollisionReaction::SpawnParticle { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::EmitEffect { .. } => {
                if let Some(evaluation) =
                    commit_tile_collision_side_effect_reaction(source_index, reaction)
                {
                    outcome.reaction_outcome.replace_default_audio |=
                        evaluation.replace_default_audio;
                    outcome.reaction_outcome.replace_default_particle |=
                        evaluation.replace_default_particle;
                    push_reaction_outcome(&mut outcome.reaction_outcome.side_effects, evaluation);
                }
            }
            CollisionReaction::SpawnPrefab { .. } => {
                if let Some(evaluation) =
                    tile_collision_spawn_prefab_reaction(world, source_index, *reaction)
                {
                    push_reaction_outcome(&mut outcome.reaction_outcome.spawn_prefabs, evaluation);
                }
            }
            CollisionReaction::Damage { .. }
            | CollisionReaction::Knockback { .. }
            | CollisionReaction::Pickup { .. }
            | CollisionReaction::Despawn {
                target: CollisionTarget::OtherEntity,
            } => {}
        }
    }
    outcome
}

pub(crate) fn apply_pickup_collision_reaction_set_for_pair(
    world: &World,
    pair: CollisionReactionPair,
    reactions: &mut CollisionReactionSet,
    contact_entered: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> PickupCollisionReactionSetOutcome {
    let mut outcome = PickupCollisionReactionSetOutcome::default();
    for reaction in reactions.iter_mut() {
        match reaction {
            CollisionReaction::Pickup { target } => {
                outcome.handled_pickup = true;
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
            CollisionReaction::PlaySound { .. }
            | CollisionReaction::SpawnParticle { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::EmitEffect { .. } => {
                if let Some(evaluation) =
                    commit_collision_side_effect_reaction_for_pair(pair, reaction, contact_entered)
                {
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
            CollisionReaction::Damage { .. }
            | CollisionReaction::AreaDamage { .. }
            | CollisionReaction::Knockback { .. }
            | CollisionReaction::Despawn { .. } => {}
        }
    }
    outcome
}

pub(crate) fn apply_pickup_collision_reaction_sets_for_pair(
    world: &mut World,
    pair: CollisionReactionPair,
    contact_entered: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<PickupCollisionReactionSetsForPairOutcome> {
    let first_reactions = world.collision_reactions_at_index(pair.source_index);
    let second_reactions = world.collision_reactions_at_index(pair.other_index);
    if first_reactions.is_none() && second_reactions.is_none() {
        return None;
    }

    let mut outcome = PickupCollisionReactionSetsForPairOutcome::default();
    if let Some(mut reactions) = first_reactions {
        let reaction_outcome = apply_pickup_collision_reaction_set_for_pair(
            world,
            pair,
            &mut reactions,
            contact_entered,
            marked_for_despawn,
            pending_despawn,
        );
        outcome.push(pair, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.source_index, Some(reactions));
    }
    if let Some(mut reactions) = second_reactions {
        let reversed = pair.reversed();
        let reaction_outcome = apply_pickup_collision_reaction_set_for_pair(
            world,
            reversed,
            &mut reactions,
            contact_entered,
            marked_for_despawn,
            pending_despawn,
        );
        outcome.push(reversed, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.other_index, Some(reactions));
    }

    Some(outcome)
}

pub(crate) fn apply_collision_damage_reaction_for_pair(
    world: &mut World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    defaults: CollisionDamageReactionDefaults,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<CollisionDamageReactionOutcome> {
    let target_index = pair.target_index(target);
    let target_entity = pair.target_entity(target);
    if !world.is_alive_index(target_index)
        || marked_for_despawn
            .get(target_index)
            .copied()
            .unwrap_or(false)
        || !collision_damage_allowed(world, pair.source_index, target_index)
    {
        return None;
    }

    let damage = damage_at_or_default(world, pair.source_index, 0.0);
    let damage_outcome = apply_damage_to_health(
        world,
        target_index,
        damage,
        defaults.health,
        defaults.score_reward,
    );
    let target_removed = damage_outcome.killed
        && defaults.despawn_on_kill
        && queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn);

    Some(CollisionDamageReactionOutcome {
        target_index,
        target: target_entity,
        damage,
        killed: damage_outcome.killed,
        target_removed,
        score_reward: damage_outcome.score_reward,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_collision_area_damage_reaction_for_pair<F>(
    world: &mut World,
    pair: CollisionReactionPair,
    radius: f32,
    target_layer: CollisionLayer,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: F,
) -> CollisionReactionSetOutcome
where
    F: FnMut(&World, usize) -> CollisionDamageReactionDefaults,
{
    let Some(center) = collision_area_damage_center(world, pair) else {
        return CollisionReactionSetOutcome::default();
    };
    let query_height_span = world
        .height_span_at(pair.source_index)
        .or_else(|| world.height_span_at(pair.other_index));
    apply_collision_area_damage_reaction_at_center(
        world,
        pair.source_index,
        center,
        radius,
        target_layer,
        query_height_span,
        area_damage_hits,
        marked_for_despawn,
        pending_despawn,
        &mut damage_defaults_for,
    )
}

#[allow(clippy::too_many_arguments)]
pub(in crate::gameplay) fn apply_collision_area_damage_reaction_at_center<F>(
    world: &mut World,
    source_index: usize,
    center: Transform2D,
    radius: f32,
    target_layer: CollisionLayer,
    query_height_span: Option<crate::components::HeightSpan>,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: F,
) -> CollisionReactionSetOutcome
where
    F: FnMut(&World, usize) -> CollisionDamageReactionDefaults,
{
    let mut outcome = CollisionReactionSetOutcome::default();
    CollisionSystem::circle_query_with_height_span_into(
        world,
        center,
        radius,
        target_layer.mask(),
        query_height_span,
        area_damage_hits,
    );

    let damage = damage_at_or_default(world, source_index, 0.0);
    let mut damaged_targets = 0;
    for hit in area_damage_hits.iter().copied() {
        if damaged_targets >= MAX_COLLISION_REACTIONS_PER_ENTITY {
            break;
        }
        let target_index = hit.entity.id as usize;
        if target_index == source_index {
            continue;
        }
        if entity_at(world, target_index) != Some(hit.entity)
            || !is_alive_layer(world, target_index, target_layer)
            || marked_for_despawn
                .get(target_index)
                .copied()
                .unwrap_or(false)
        {
            continue;
        }
        if !collision_damage_allowed(world, source_index, target_index) {
            if let Some(denial) = faction_damage_denial(world, source_index, target_index) {
                push_reaction_outcome(&mut outcome.faction_damage_denials, denial);
            }
            continue;
        }

        let defaults = damage_defaults_for(world, target_index);
        let damage_outcome = apply_damage_to_health(
            world,
            target_index,
            damage,
            defaults.health,
            defaults.score_reward,
        );
        let target_removed = damage_outcome.killed
            && defaults.despawn_on_kill
            && queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn);
        push_reaction_outcome(
            &mut outcome.damage_outcomes,
            CollisionDamageReactionOutcome {
                target_index,
                target: hit.entity,
                damage,
                killed: damage_outcome.killed,
                target_removed,
                score_reward: damage_outcome.score_reward,
            },
        );
        damaged_targets += 1;
    }
    outcome
}

pub(crate) fn apply_collision_knockback_reaction_for_pair(
    world: &mut World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    impulse: f32,
    marked_for_despawn: &[bool],
) -> Option<CollisionKnockbackReactionOutcome> {
    if !impulse.is_finite() || impulse <= 0.0 {
        return None;
    }
    let target_index = pair.target_index(target);
    if !world.is_alive_index(target_index)
        || marked_for_despawn
            .get(target_index)
            .copied()
            .unwrap_or(false)
    {
        return None;
    }
    let target_entity = entity_at(world, target_index)?;
    let direction = collision_knockback_direction(world, pair, target);
    let impulse = Velocity {
        vx: direction.vx * impulse,
        vy: direction.vy * impulse,
    };
    let velocity = world.velocities.get_mut(target_index)?;
    let current = velocity.unwrap_or_default();
    *velocity = Some(Velocity {
        vx: current.vx + impulse.vx,
        vy: current.vy + impulse.vy,
    });
    Some(CollisionKnockbackReactionOutcome {
        target_index,
        target: target_entity,
        impulse,
    })
}

pub(in crate::gameplay) fn collision_knockback_direction(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
) -> Velocity {
    let (target_index, origin_index, fallback) = match target {
        CollisionTarget::SelfEntity => (
            pair.source_index,
            pair.other_index,
            Velocity { vx: -1.0, vy: 0.0 },
        ),
        CollisionTarget::OtherEntity => (
            pair.other_index,
            pair.source_index,
            Velocity { vx: 1.0, vy: 0.0 },
        ),
    };
    let Some(target_transform) = world.transforms.get(target_index).copied().flatten() else {
        return fallback;
    };
    let Some(origin_transform) = world.transforms.get(origin_index).copied().flatten() else {
        return fallback;
    };
    normalized_direction(
        target_transform.x - origin_transform.x,
        target_transform.y - origin_transform.y,
    )
    .unwrap_or(fallback)
}

pub(crate) fn collision_damage_reaction_faction_denial(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    marked_for_despawn: &[bool],
) -> Option<FactionDamageDenial> {
    let target_index = pair.target_index(target);
    if !world.is_alive_index(target_index)
        || marked_for_despawn
            .get(target_index)
            .copied()
            .unwrap_or(false)
    {
        return None;
    }
    faction_damage_denial(world, pair.source_index, target_index)
}

pub(crate) fn apply_damage_to_health(
    world: &mut World,
    entity_index: usize,
    damage: f32,
    default_health: f32,
    default_score_reward: u32,
) -> DamageOutcome {
    let remaining_health = world
        .apply_damage_to_health_at_index(entity_index, damage, default_health)
        .unwrap_or(default_health);
    let killed = remaining_health <= 0.0;
    let score_reward = if killed {
        world
            .score_reward_at_index(entity_index)
            .unwrap_or(default_score_reward)
    } else {
        0
    };
    DamageOutcome {
        remaining_health,
        killed,
        score_reward,
    }
}

pub(in crate::gameplay) fn collision_area_damage_center(
    world: &World,
    pair: CollisionReactionPair,
) -> Option<Transform2D> {
    world
        .transforms
        .get(pair.source_index)
        .copied()
        .flatten()
        .or_else(|| world.transforms.get(pair.other_index).copied().flatten())
}
