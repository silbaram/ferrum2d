//! Physical operations needed by scene-neutral collision reactions.
use super::*;

pub(crate) trait CollisionReactionPhysics {
    #[allow(clippy::too_many_arguments)]
    fn area_damage<F: FnMut(&World, usize) -> CollisionDamageReactionDefaults>(
        &mut self,
        world: &mut World,
        pair: CollisionReactionPair,
        radius: f32,
        layer: CollisionLayer,
        hits: &mut Vec<CircleQueryHit>,
        marked: &mut [bool],
        pending: &mut Vec<Entity>,
        defaults: F,
    ) -> CollisionReactionSetOutcome;

    fn knockback(
        &mut self,
        world: &mut World,
        pair: CollisionReactionPair,
        target: CollisionTarget,
        speed: f32,
        marked: &[bool],
    ) -> Option<CollisionKnockbackReactionOutcome>;
}

pub(crate) struct LegacyReactionPhysics;

impl CollisionReactionPhysics for LegacyReactionPhysics {
    fn area_damage<F: FnMut(&World, usize) -> CollisionDamageReactionDefaults>(
        &mut self,
        world: &mut World,
        pair: CollisionReactionPair,
        radius: f32,
        layer: CollisionLayer,
        hits: &mut Vec<CircleQueryHit>,
        marked: &mut [bool],
        pending: &mut Vec<Entity>,
        defaults: F,
    ) -> CollisionReactionSetOutcome {
        apply_collision_area_damage_reaction_for_pair(
            world, pair, radius, layer, hits, marked, pending, defaults,
        )
    }

    fn knockback(
        &mut self,
        world: &mut World,
        pair: CollisionReactionPair,
        target: CollisionTarget,
        speed: f32,
        marked: &[bool],
    ) -> Option<CollisionKnockbackReactionOutcome> {
        apply_collision_knockback_reaction_for_pair(world, pair, target, speed, marked)
    }
}
