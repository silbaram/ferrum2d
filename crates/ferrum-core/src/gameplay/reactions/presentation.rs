use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DefaultCollisionPresentationPolicy {
    pub(crate) emit_audio: bool,
    pub(crate) emit_particle: bool,
}

impl DefaultCollisionPresentationPolicy {
    pub(crate) const fn emit_all() -> Self {
        Self {
            emit_audio: true,
            emit_particle: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionHitPresentationPayload {
    pub(crate) source: Entity,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
    pub(crate) emit_audio: bool,
    pub(crate) particle_position: Option<Transform2D>,
}

impl CollisionReactionOutcomeSummary {
    pub(crate) fn merge(&mut self, other: Self) {
        self.total_damage += other.total_damage;
        self.score_delta = self.score_delta.saturating_add(other.score_delta);
        self.overrides_default_gameplay |= other.overrides_default_gameplay;
        self.faction_damage_denied |= other.faction_damage_denied;
        self.enemy_damaged |= other.enemy_damaged;
        self.enemy_removed |= other.enemy_removed;
        self.player_game_over |= other.player_game_over;
        self.pickup_collected |= other.pickup_collected;
        self.replace_default_audio |= other.replace_default_audio;
        self.replace_default_particle |= other.replace_default_particle;
    }
}

pub(crate) fn default_collision_presentation_policy(
    authored_outcome: Option<&CollisionReactionOutcomeSummary>,
) -> DefaultCollisionPresentationPolicy {
    let Some(outcome) = authored_outcome else {
        return DefaultCollisionPresentationPolicy::emit_all();
    };
    DefaultCollisionPresentationPolicy {
        emit_audio: !outcome.replace_default_audio,
        emit_particle: !outcome.replace_default_particle,
    }
}

pub(crate) fn should_emit_default_game_over_audio(
    game_over_entered: bool,
    authored_outcome: Option<&CollisionReactionOutcomeSummary>,
) -> bool {
    game_over_entered && default_collision_presentation_policy(authored_outcome).emit_audio
}

pub(crate) fn collision_hit_presentation_payload(
    world: &World,
    pair: CollisionReactionPair,
    damage: f32,
    authored_outcome: Option<&CollisionReactionOutcomeSummary>,
) -> CollisionHitPresentationPayload {
    let default_presentation = default_collision_presentation_policy(authored_outcome);
    CollisionHitPresentationPayload {
        source: pair.source,
        target: pair.other,
        damage,
        emit_audio: default_presentation.emit_audio,
        particle_position: if default_presentation.emit_particle {
            world
                .transforms
                .get(pair.other_index)
                .copied()
                .flatten()
                .or_else(|| world.transforms.get(pair.source_index).copied().flatten())
        } else {
            None
        },
    }
}

pub(crate) fn target_only_default_collision_damage_hit_presentation_payload(
    world: &World,
    outcome: DefaultCollisionDamageHitOutcome,
) -> CollisionHitPresentationPayload {
    CollisionHitPresentationPayload {
        source: outcome.source,
        target: outcome.target,
        damage: outcome.damage,
        emit_audio: true,
        particle_position: world
            .transforms
            .get(outcome.target_index)
            .copied()
            .flatten(),
    }
}

pub(crate) fn collision_side_effect_payload(
    world: &World,
    evaluation: CollisionSideEffectEvaluation,
) -> Option<CollisionSideEffectPayload> {
    match evaluation.effect {
        Some(CollisionSideEffect::PlaySound {
            sound_id,
            volume,
            pitch,
        }) => Some(CollisionSideEffectPayload::PlaySound {
            sound_id,
            volume,
            pitch,
        }),
        Some(CollisionSideEffect::SpawnParticle {
            preset_id,
            target_index,
        }) => world
            .transforms
            .get(target_index)
            .copied()
            .flatten()
            .map(|position| CollisionSideEffectPayload::SpawnParticleAt {
                preset_id,
                position,
            }),
        Some(CollisionSideEffect::CameraShake) => Some(CollisionSideEffectPayload::CameraShake),
        Some(CollisionSideEffect::EmitEffect {
            effect_id,
            effect_type,
            target_index,
            intensity,
            radius,
        }) => entity_at(world, target_index).map(|actor| {
            CollisionSideEffectPayload::PresentationEffect {
                actor,
                effect_id,
                effect_type,
                intensity,
                radius,
            }
        }),
        None => None,
    }
}
