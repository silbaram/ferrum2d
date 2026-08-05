use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DamageOutcome {
    pub(crate) remaining_health: f32,
    pub(crate) killed: bool,
    pub(crate) score_reward: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionDamageReactionOutcome {
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
    pub(crate) killed: bool,
    pub(crate) target_removed: bool,
    pub(crate) score_reward: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionDamageReactionDefaults {
    pub(crate) health: f32,
    pub(crate) score_reward: u32,
    pub(crate) despawn_on_kill: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CollisionDespawnReactionOutcome {
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionKnockbackReactionOutcome {
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) impulse: Velocity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CollisionPickupReactionOutcome {
    pub(crate) pickup_index: usize,
    pub(crate) pickup: Entity,
    pub(crate) collector_index: usize,
    pub(crate) collector: Entity,
    pub(crate) item_id: u32,
    pub(crate) count: u32,
    pub(crate) target_removed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CollisionGameplayEventPayload {
    Damage {
        target: Entity,
        source: Entity,
        damage: f32,
        target_removed: bool,
    },
    Despawn {
        target: Entity,
        source: Entity,
    },
    PickupCollected {
        collector: Entity,
        pickup: Entity,
        item_id: u32,
        count: u32,
        target_removed: bool,
    },
    FactionDamageDenied {
        target: Entity,
        source: Entity,
        source_faction_id: u32,
        target_faction_id: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionGameplayEventPayloadSet {
    pub(in crate::gameplay) events:
        [Option<CollisionGameplayEventPayload>; MAX_COLLISION_GAMEPLAY_EVENTS_PER_REACTION_SET],
}

impl Default for CollisionGameplayEventPayloadSet {
    fn default() -> Self {
        Self {
            events: [None; MAX_COLLISION_GAMEPLAY_EVENTS_PER_REACTION_SET],
        }
    }
}

impl CollisionGameplayEventPayloadSet {
    pub(crate) fn events(&self) -> impl Iterator<Item = CollisionGameplayEventPayload> + '_ {
        self.events.iter().filter_map(|event| *event)
    }

    pub(in crate::gameplay) fn push(&mut self, event: CollisionGameplayEventPayload) {
        if let Some(slot) = self.events.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(event);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionSideEffectEvaluation {
    pub(crate) replace_default_audio: bool,
    pub(crate) replace_default_particle: bool,
    pub(crate) effect: Option<CollisionSideEffect>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CollisionSideEffect {
    PlaySound {
        sound_id: u32,
        volume: f32,
        pitch: f32,
    },
    SpawnParticle {
        preset_id: u32,
        target_index: usize,
    },
    CameraShake,
    EmitEffect {
        effect_id: u32,
        effect_type: u32,
        target_index: usize,
        intensity: f32,
        radius: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CollisionSideEffectPayload {
    PlaySound {
        sound_id: u32,
        volume: f32,
        pitch: f32,
    },
    SpawnParticleAt {
        preset_id: u32,
        position: Transform2D,
    },
    CameraShake,
    PresentationEffect {
        actor: Entity,
        effect_id: u32,
        effect_type: u32,
        intensity: f32,
        radius: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionSpawnPrefabEvaluation {
    pub(crate) reaction_owner_index: usize,
    pub(crate) source: Entity,
    pub(crate) action_id: u32,
    pub(crate) prefab_id: u32,
    pub(crate) target: CollisionTarget,
    pub(crate) anchor_index: usize,
    pub(crate) anchor: Entity,
    pub(crate) offset_x: f32,
    pub(crate) offset_y: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionReactionSetOutcome {
    pub(crate) overrides_default_gameplay: bool,
    pub(crate) replace_default_audio: bool,
    pub(crate) replace_default_particle: bool,
    pub(in crate::gameplay) damage_outcomes:
        [Option<CollisionDamageReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) faction_damage_denials:
        [Option<FactionDamageDenial>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) despawn_outcomes:
        [Option<CollisionDespawnReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) knockback_outcomes:
        [Option<CollisionKnockbackReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) pickup_outcomes:
        [Option<CollisionPickupReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) side_effects:
        [Option<CollisionSideEffectEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) spawn_prefabs:
        [Option<CollisionSpawnPrefabEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
}

impl Default for CollisionReactionSetOutcome {
    fn default() -> Self {
        Self {
            overrides_default_gameplay: false,
            replace_default_audio: false,
            replace_default_particle: false,
            damage_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            faction_damage_denials: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            despawn_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            knockback_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            pickup_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            side_effects: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            spawn_prefabs: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
        }
    }
}

impl CollisionReactionSetOutcome {
    pub(crate) fn damage_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionDamageReactionOutcome> + '_ {
        self.damage_outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(crate) fn faction_damage_denials(&self) -> impl Iterator<Item = FactionDamageDenial> + '_ {
        self.faction_damage_denials
            .iter()
            .filter_map(|outcome| *outcome)
    }

    pub(crate) fn despawn_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionDespawnReactionOutcome> + '_ {
        self.despawn_outcomes.iter().filter_map(|outcome| *outcome)
    }

    #[cfg(test)]
    pub(crate) fn knockback_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionKnockbackReactionOutcome> + '_ {
        self.knockback_outcomes
            .iter()
            .filter_map(|outcome| *outcome)
    }

    pub(crate) fn pickup_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionPickupReactionOutcome> + '_ {
        self.pickup_outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(crate) fn side_effects(&self) -> impl Iterator<Item = CollisionSideEffectEvaluation> + '_ {
        self.side_effects.iter().filter_map(|effect| *effect)
    }

    pub(crate) fn spawn_prefabs(
        &self,
    ) -> impl Iterator<Item = CollisionSpawnPrefabEvaluation> + '_ {
        self.spawn_prefabs.iter().filter_map(|spawn| *spawn)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct TileCollisionReactionSetOutcome {
    pub(crate) queued_self_despawn: bool,
    pub(crate) despawn_outcome: Option<CollisionDespawnReactionOutcome>,
    pub(in crate::gameplay) reaction_outcome: CollisionReactionSetOutcome,
}

impl TileCollisionReactionSetOutcome {
    pub(crate) fn reaction_outcome(&self) -> &CollisionReactionSetOutcome {
        &self.reaction_outcome
    }

    pub(crate) fn side_effects(&self) -> impl Iterator<Item = CollisionSideEffectEvaluation> + '_ {
        self.reaction_outcome.side_effects()
    }

    pub(crate) fn spawn_prefabs(
        &self,
    ) -> impl Iterator<Item = CollisionSpawnPrefabEvaluation> + '_ {
        self.reaction_outcome.spawn_prefabs()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PickupCollisionReactionSetOutcome {
    pub(crate) handled_pickup: bool,
    pub(in crate::gameplay) pickup_outcomes:
        [Option<CollisionPickupReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) side_effects:
        [Option<CollisionSideEffectEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pub(in crate::gameplay) spawn_prefabs:
        [Option<CollisionSpawnPrefabEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
}

impl Default for PickupCollisionReactionSetOutcome {
    fn default() -> Self {
        Self {
            handled_pickup: false,
            pickup_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            side_effects: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            spawn_prefabs: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
        }
    }
}

impl PickupCollisionReactionSetOutcome {
    pub(crate) fn pickup_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionPickupReactionOutcome> + '_ {
        self.pickup_outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(crate) fn side_effects(&self) -> impl Iterator<Item = CollisionSideEffectEvaluation> + '_ {
        self.side_effects.iter().filter_map(|effect| *effect)
    }

    pub(crate) fn spawn_prefabs(
        &self,
    ) -> impl Iterator<Item = CollisionSpawnPrefabEvaluation> + '_ {
        self.spawn_prefabs.iter().filter_map(|spawn| *spawn)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AppliedPickupCollisionReactionSetOutcome {
    pub(crate) pair: CollisionReactionPair,
    pub(crate) outcome: PickupCollisionReactionSetOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct PickupCollisionReactionSetsForPairOutcome {
    pub(crate) handled_pickup: bool,
    pub(in crate::gameplay) outcomes: [Option<AppliedPickupCollisionReactionSetOutcome>; 2],
}

impl PickupCollisionReactionSetsForPairOutcome {
    pub(crate) fn outcomes(
        &self,
    ) -> impl Iterator<Item = AppliedPickupCollisionReactionSetOutcome> + '_ {
        self.outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(in crate::gameplay) fn push(
        &mut self,
        pair: CollisionReactionPair,
        outcome: PickupCollisionReactionSetOutcome,
    ) {
        self.handled_pickup |= outcome.handled_pickup;
        if let Some(slot) = self.outcomes.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(AppliedPickupCollisionReactionSetOutcome { pair, outcome });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CollisionReactionPair {
    pub(crate) source_index: usize,
    pub(crate) other_index: usize,
    pub(crate) source: Entity,
    pub(crate) other: Entity,
}

impl CollisionReactionPair {
    pub(crate) const fn new(
        source_index: usize,
        other_index: usize,
        source: Entity,
        other: Entity,
    ) -> Self {
        Self {
            source_index,
            other_index,
            source,
            other,
        }
    }

    pub(crate) const fn reversed(self) -> Self {
        Self {
            source_index: self.other_index,
            other_index: self.source_index,
            source: self.other,
            other: self.source,
        }
    }

    pub(crate) const fn target_index(self, target: CollisionTarget) -> usize {
        match target {
            CollisionTarget::SelfEntity => self.source_index,
            CollisionTarget::OtherEntity => self.other_index,
        }
    }

    pub(crate) const fn target_entity(self, target: CollisionTarget) -> Entity {
        match target {
            CollisionTarget::SelfEntity => self.source,
            CollisionTarget::OtherEntity => self.other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AppliedCollisionReactionSetOutcome {
    pub(crate) pair: CollisionReactionPair,
    pub(crate) outcome: CollisionReactionSetOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct CollisionReactionSetsForPairOutcome {
    pub(in crate::gameplay) outcomes: [Option<AppliedCollisionReactionSetOutcome>; 2],
}

impl CollisionReactionSetsForPairOutcome {
    pub(crate) fn outcomes(&self) -> impl Iterator<Item = AppliedCollisionReactionSetOutcome> + '_ {
        self.outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(in crate::gameplay) fn push(
        &mut self,
        pair: CollisionReactionPair,
        outcome: CollisionReactionSetOutcome,
    ) {
        if let Some(slot) = self.outcomes.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(AppliedCollisionReactionSetOutcome { pair, outcome });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollisionReactionTargetRole {
    Player,
    Enemy,
    Other,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct CollisionReactionOutcomeSummary {
    pub(crate) total_damage: f32,
    pub(crate) score_delta: u32,
    pub(crate) overrides_default_gameplay: bool,
    pub(crate) faction_damage_denied: bool,
    pub(crate) enemy_damaged: bool,
    pub(crate) enemy_removed: bool,
    pub(crate) player_game_over: bool,
    pub(crate) pickup_collected: bool,
    pub(crate) replace_default_audio: bool,
    pub(crate) replace_default_particle: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DefaultCollisionDamageHitOutcome {
    pub(crate) source_index: usize,
    pub(crate) source: Entity,
    pub(crate) source_removed: bool,
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
    pub(crate) killed: bool,
    pub(crate) target_removed: bool,
    pub(crate) score_reward: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DefaultCollisionGameOverHitOutcome {
    pub(crate) source_index: usize,
    pub(crate) source: Entity,
    pub(crate) source_removed: bool,
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
}
