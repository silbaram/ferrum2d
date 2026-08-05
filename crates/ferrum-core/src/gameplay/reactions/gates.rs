use super::*;

pub(crate) fn damage_at_or_default(world: &World, entity_index: usize, default_damage: f32) -> f32 {
    world
        .damage_at_index(entity_index)
        .unwrap_or(default_damage)
}

pub(crate) fn collision_damage_allowed(
    world: &World,
    source_index: usize,
    target_index: usize,
) -> bool {
    faction_damage_denial(world, source_index, target_index).is_none()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FactionDamageDenial {
    pub(crate) source: Entity,
    pub(crate) target: Entity,
    pub(crate) source_faction_id: u32,
    pub(crate) target_faction_id: u32,
}

pub(crate) fn faction_damage_denial(
    world: &World,
    source_index: usize,
    target_index: usize,
) -> Option<FactionDamageDenial> {
    let source_faction = world.gameplay_faction_at_index(source_index)?;
    let target_faction = world.gameplay_faction_at_index(target_index)?;
    let can_damage = world.gameplay_factions_can_damage(source_faction, target_faction);
    if can_damage {
        return None;
    }
    Some(FactionDamageDenial {
        source: entity_at(world, source_index)?,
        target: entity_at(world, target_index)?,
        source_faction_id: source_faction.faction_id,
        target_faction_id: target_faction.faction_id,
    })
}

pub(crate) fn projectile_collision_target_at(
    world: &World,
    projectile_index: usize,
) -> ProjectileCollisionTarget {
    world.projectile_collision_target_at(projectile_index)
}

pub(crate) fn default_projectile_damage_allowed(
    world: &World,
    projectile_index: usize,
    target_index: usize,
    expected_target: ProjectileCollisionTarget,
) -> bool {
    projectile_collision_target_at(world, projectile_index) == expected_target
        && collision_damage_allowed(world, projectile_index, target_index)
}

pub(crate) fn default_melee_damage_allowed(
    world: &World,
    attacker_index: usize,
    target_index: usize,
) -> bool {
    collision_damage_allowed(world, attacker_index, target_index)
}

pub(crate) fn build_collision_layer_pairs(
    scratch: &mut CollisionScratch,
    world: &World,
    layer_a: CollisionLayer,
    layer_b: CollisionLayer,
    pairs: &mut Vec<CollisionPair>,
) {
    CollisionSystem::build_layer_pairs_into(scratch, world, layer_a, layer_b, pairs);
}

pub(crate) fn build_swept_collision_layer_pairs(
    scratch: &mut CollisionScratch,
    world: &World,
    moving_layer: CollisionLayer,
    target_layer: CollisionLayer,
    delta: f32,
    pairs: &mut Vec<CollisionPair>,
) {
    CollisionSystem::build_swept_layer_pairs_into(
        scratch,
        world,
        moving_layer,
        target_layer,
        delta,
        pairs,
    );
}

pub(crate) fn collision_reaction_pair_for_layer_pair(
    world: &World,
    pair: CollisionPair,
    source_layer: CollisionLayer,
    other_layer: CollisionLayer,
    marked_for_despawn: &[bool],
) -> Option<CollisionReactionPair> {
    let source_index = pair.a.id as usize;
    let other_index = pair.b.id as usize;
    if marked_for_despawn
        .get(source_index)
        .copied()
        .unwrap_or(true)
        || marked_for_despawn.get(other_index).copied().unwrap_or(true)
    {
        return None;
    }
    if entity_at(world, source_index)? != pair.a || entity_at(world, other_index)? != pair.b {
        return None;
    }
    if !is_alive_layer(world, source_index, source_layer)
        || !is_alive_layer(world, other_index, other_layer)
    {
        return None;
    }
    Some(CollisionReactionPair::new(
        source_index,
        other_index,
        pair.a,
        pair.b,
    ))
}

pub(in crate::gameplay) fn is_alive_layer(
    world: &World,
    index: usize,
    layer: CollisionLayer,
) -> bool {
    world.is_alive_index(index) && world.collider_layer_at(index) == Some(layer)
}
