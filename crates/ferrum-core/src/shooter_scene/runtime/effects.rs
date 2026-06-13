use crate::audio_event::{AudioEvent, AUDIO_CHANNEL_SFX};
use crate::collision_event::{CollisionEvent, CollisionEventCounts, COLLISION_EVENT_HIT};
use crate::components::Transform2D;
use crate::effect_event::EffectEvent;
use crate::entity::Entity;
use crate::gameplay::{
    action_failure_gameplay_event, ActionFailureEventData, ActionFailureEventSink,
    CollisionGameplayEventPayload, CollisionHitPresentationPayload, GameplayTimerDispatch,
    PrefabSpawnedEventPayload,
};
use crate::gameplay_event::{
    GameplayEvent, GameplayTileImpactEventPayload, GAMEPLAY_EVENT_COLLISION_DESPAWN,
    GAMEPLAY_EVENT_INTERACTION,
};
use crate::particles::{ParticlePreset, ParticleSystem};
use crate::physics::PhysicsCounters;
use crate::tweens::{TweenEasing, TweenSystem};
use crate::world::World;

use super::super::{
    ShooterAudioPolicy, DEFAULT_SOUND_ID, ENEMY_HIT_FLASH_SECONDS, ENEMY_HIT_FLASH_TINT,
};

pub(in crate::shooter_scene) struct CollisionEventSink<'a> {
    events: &'a mut Vec<CollisionEvent>,
    counts: &'a mut CollisionEventCounts,
}

impl<'a> CollisionEventSink<'a> {
    pub(in crate::shooter_scene) fn new(
        events: &'a mut Vec<CollisionEvent>,
        counts: &'a mut CollisionEventCounts,
    ) -> CollisionEventSink<'a> {
        CollisionEventSink { events, counts }
    }

    pub(in crate::shooter_scene) fn push_hit(&mut self, a: Entity, b: Entity, damage: f32) {
        self.events.push(CollisionEvent::from_entities_with_damage(
            COLLISION_EVENT_HIT,
            a,
            b,
            damage,
        ));
        self.counts.hit = self.counts.hit.saturating_add(1);
    }

    pub(in crate::shooter_scene) fn push_hit_payload(
        &mut self,
        payload: CollisionHitPresentationPayload,
    ) {
        self.push_hit(payload.source, payload.target, payload.damage);
    }
}

pub(in crate::shooter_scene) struct GameplayEventSink<'a> {
    events: &'a mut Vec<GameplayEvent>,
    effect_events: Option<&'a mut Vec<EffectEvent>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::shooter_scene) struct PrefabSpawnedEventDispatchResult {
    pub(in crate::shooter_scene) event_pushed: bool,
}

impl<'a> GameplayEventSink<'a> {
    #[cfg(test)]
    pub(in crate::shooter_scene) fn new(
        events: &'a mut Vec<GameplayEvent>,
    ) -> GameplayEventSink<'a> {
        GameplayEventSink {
            events,
            effect_events: None,
        }
    }

    pub(in crate::shooter_scene) fn with_effect_events(
        events: &'a mut Vec<GameplayEvent>,
        effect_events: &'a mut Vec<EffectEvent>,
    ) -> GameplayEventSink<'a> {
        GameplayEventSink {
            events,
            effect_events: Some(effect_events),
        }
    }

    pub(in crate::shooter_scene) fn push_interaction_once_per_frame(
        &mut self,
        actor: Entity,
        source: Entity,
        action_id: u32,
        once: bool,
        consumed_this_frame: bool,
    ) {
        if self.events.iter().any(|event| {
            event.kind == GAMEPLAY_EVENT_INTERACTION
                && event.actor_id == actor.id
                && event.actor_generation == actor.generation
                && event.source_id == source.id
                && event.source_generation == source.generation
        }) {
            return;
        }
        self.events.push(GameplayEvent::interaction(
            actor,
            source,
            action_id,
            once,
            consumed_this_frame,
        ));
    }

    pub(in crate::shooter_scene) fn push_collision_damage(
        &mut self,
        actor: Entity,
        source: Entity,
        damage: f32,
        target_removed: bool,
    ) {
        self.events.push(GameplayEvent::collision_damage(
            actor,
            source,
            damage,
            target_removed,
        ));
    }

    pub(in crate::shooter_scene) fn push_collision_despawn(
        &mut self,
        actor: Entity,
        source: Entity,
    ) {
        if self.events.iter().any(|event| {
            event.kind == GAMEPLAY_EVENT_COLLISION_DESPAWN
                && event.actor_id == actor.id
                && event.actor_generation == actor.generation
                && event.source_id == source.id
                && event.source_generation == source.generation
        }) {
            return;
        }
        self.events
            .push(GameplayEvent::collision_despawn(actor, source));
    }

    pub(in crate::shooter_scene) fn push_presentation_effect(
        &mut self,
        actor: Entity,
        source: Entity,
        effect_id: u32,
        effect_type: u32,
    ) {
        self.events.push(GameplayEvent::presentation_effect(
            actor,
            source,
            effect_id,
            effect_type,
        ));
    }

    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn push_presentation_effect_at(
        &mut self,
        actor: Entity,
        source: Entity,
        effect_id: u32,
        effect_type: u32,
        position: Transform2D,
        intensity: f32,
        radius: f32,
    ) {
        self.push_presentation_effect(actor, source, effect_id, effect_type);
        if let Some(effect_events) = self.effect_events.as_mut() {
            effect_events.push(EffectEvent::new(
                actor,
                source,
                effect_id,
                effect_type,
                position,
                intensity,
                radius,
            ));
        }
    }

    pub(in crate::shooter_scene) fn push_prefab_spawned(
        &mut self,
        actor: Entity,
        source: Entity,
        prefab_id: u32,
        action_id: u32,
    ) -> PrefabSpawnedEventDispatchResult {
        self.events.push(GameplayEvent::prefab_spawned(
            actor, source, prefab_id, action_id,
        ));
        PrefabSpawnedEventDispatchResult { event_pushed: true }
    }

    pub(in crate::shooter_scene) fn push_prefab_spawned_payload(
        &mut self,
        payload: PrefabSpawnedEventPayload,
    ) -> PrefabSpawnedEventDispatchResult {
        self.push_prefab_spawned(
            payload.spawned,
            payload.source,
            payload.prefab_id,
            payload.action_id,
        )
    }

    pub(in crate::shooter_scene) fn push_timer_dispatch(
        &mut self,
        dispatch: GameplayTimerDispatch,
    ) {
        self.events.push(dispatch.event());
    }

    pub(in crate::shooter_scene) fn push_pickup_collected(
        &mut self,
        collector: Entity,
        pickup: Entity,
        item_id: u32,
        count: u32,
        target_removed: bool,
    ) {
        self.events.push(GameplayEvent::pickup_collected(
            collector,
            pickup,
            item_id,
            count,
            target_removed,
        ));
    }

    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn push_tile_impact(
        &mut self,
        projectile: Entity,
        tile_impact_code: u32,
        layer_index: u32,
        tile_index: u32,
        normal_x: f32,
        normal_y: f32,
        bounced: bool,
        target_removed: bool,
    ) {
        self.events
            .push(GameplayEvent::tile_impact(GameplayTileImpactEventPayload {
                projectile,
                tile_impact_code,
                layer_index,
                tile_index,
                normal_x,
                normal_y,
                bounced,
                target_removed,
            }));
    }

    pub(in crate::shooter_scene) fn push_faction_damage_denied(
        &mut self,
        actor: Entity,
        source: Entity,
        source_faction_id: u32,
        target_faction_id: u32,
    ) {
        self.events.push(GameplayEvent::faction_damage_denied(
            actor,
            source,
            source_faction_id,
            target_faction_id,
        ));
    }

    pub(in crate::shooter_scene) fn push_collision_payload(
        &mut self,
        payload: CollisionGameplayEventPayload,
    ) -> CollisionGameplayEventDispatchResult {
        let before_len = self.events.len();
        match payload {
            CollisionGameplayEventPayload::Damage {
                target,
                source,
                damage,
                target_removed,
            } => self.push_collision_damage(target, source, damage, target_removed),
            CollisionGameplayEventPayload::Despawn { target, source } => {
                self.push_collision_despawn(target, source);
            }
            CollisionGameplayEventPayload::PickupCollected {
                collector,
                pickup,
                item_id,
                count,
                target_removed,
            } => {
                self.push_pickup_collected(collector, pickup, item_id, count, target_removed);
            }
            CollisionGameplayEventPayload::FactionDamageDenied {
                target,
                source,
                source_faction_id,
                target_faction_id,
            } => {
                self.push_faction_damage_denied(
                    target,
                    source,
                    source_faction_id,
                    target_faction_id,
                );
            }
        }
        CollisionGameplayEventDispatchResult {
            event_pushed: self.events.len() > before_len,
        }
    }
}

impl ActionFailureEventSink for GameplayEventSink<'_> {
    fn push_action_failure(&mut self, data: ActionFailureEventData) {
        self.events.push(action_failure_gameplay_event(data));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::shooter_scene) struct CollisionGameplayEventDispatchResult {
    pub(in crate::shooter_scene) event_pushed: bool,
}

pub(crate) struct ParticleBurstSink<'a> {
    particles: &'a mut ParticleSystem,
    hit_preset: Option<ParticlePreset>,
    particle_presets: &'a [Option<ParticlePreset>],
}

impl<'a> ParticleBurstSink<'a> {
    pub(crate) fn with_presets(
        particles: &'a mut ParticleSystem,
        hit_preset: Option<ParticlePreset>,
        particle_presets: &'a [Option<ParticlePreset>],
    ) -> Self {
        Self {
            particles,
            hit_preset,
            particle_presets,
        }
    }

    pub(in crate::shooter_scene) fn spawn_at(&mut self, position: Transform2D) -> usize {
        let Some(preset) = self.hit_preset else {
            return 0;
        };
        self.particles.spawn_burst(preset, position.x, position.y)
    }

    pub(in crate::shooter_scene) fn spawn_hit_payload(
        &mut self,
        payload: CollisionHitPresentationPayload,
    ) -> usize {
        let Some(position) = payload.particle_position else {
            return 0;
        };
        self.spawn_at(position)
    }

    pub(in crate::shooter_scene) fn spawn_preset_at(
        &mut self,
        preset_id: u32,
        position: Transform2D,
    ) -> usize {
        let Some(Some(preset)) = self.particle_presets.get(preset_id as usize) else {
            return 0;
        };
        self.particles.spawn_burst(*preset, position.x, position.y)
    }
}

pub(crate) struct TweenSink<'a> {
    tweens: &'a mut TweenSystem,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::shooter_scene) struct HitTweenDispatchResult {
    pub(in crate::shooter_scene) tween_started: bool,
}

impl<'a> TweenSink<'a> {
    pub(crate) fn new(tweens: &'a mut TweenSystem) -> Self {
        Self { tweens }
    }

    pub(in crate::shooter_scene) fn flash_enemy_hit(
        &mut self,
        world: &mut World,
        enemy: Entity,
    ) -> bool {
        self.tweens.flash_sprite_tint(
            world,
            enemy,
            ENEMY_HIT_FLASH_TINT,
            ENEMY_HIT_FLASH_SECONDS,
            TweenEasing::EaseOut,
        )
    }

    pub(in crate::shooter_scene) fn flash_enemy_hit_payload(
        &mut self,
        world: &mut World,
        payload: CollisionHitPresentationPayload,
    ) -> HitTweenDispatchResult {
        HitTweenDispatchResult {
            tween_started: self.flash_enemy_hit(world, payload.target),
        }
    }
}

#[derive(Default)]
pub(in crate::shooter_scene) struct ShooterRuntimeSinks<'a> {
    pub(in crate::shooter_scene) physics_counters: Option<&'a mut PhysicsCounters>,
    pub(in crate::shooter_scene) collision_events: Option<CollisionEventSink<'a>>,
    pub(in crate::shooter_scene) gameplay_events: Option<GameplayEventSink<'a>>,
    pub(in crate::shooter_scene) hit_particles: Option<ParticleBurstSink<'a>>,
    pub(in crate::shooter_scene) hit_tweens: Option<TweenSink<'a>>,
}

impl<'a> ShooterRuntimeSinks<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn with_effects(
        physics_counters: &'a mut PhysicsCounters,
        collision_events: &'a mut Vec<CollisionEvent>,
        collision_event_counts: &'a mut CollisionEventCounts,
        gameplay_events: &'a mut Vec<GameplayEvent>,
        effect_events: &'a mut Vec<EffectEvent>,
        hit_particles: Option<ParticleBurstSink<'a>>,
        hit_tweens: Option<TweenSink<'a>>,
    ) -> Self {
        Self {
            physics_counters: Some(physics_counters),
            collision_events: Some(CollisionEventSink::new(
                collision_events,
                collision_event_counts,
            )),
            gameplay_events: Some(GameplayEventSink::with_effect_events(
                gameplay_events,
                effect_events,
            )),
            hit_particles,
            hit_tweens,
        }
    }
}

pub(in crate::shooter_scene) fn push_audio_event(
    audio_events: &mut Vec<AudioEvent>,
    sound_id: u32,
    volume: f32,
    pitch: f32,
) {
    if sound_id == DEFAULT_SOUND_ID {
        return;
    }

    audio_events.push(AudioEvent {
        sound_id: sound_id as f32,
        volume,
        pitch,
        channel_id: AUDIO_CHANNEL_SFX,
    });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::shooter_scene) struct HitAudioDispatchResult {
    pub(in crate::shooter_scene) audio_event_pushed: bool,
}

pub(in crate::shooter_scene) fn push_hit_audio_event(
    audio_events: &mut Vec<AudioEvent>,
    payload: CollisionHitPresentationPayload,
    sound_id: u32,
    volume: f32,
    pitch: f32,
) -> HitAudioDispatchResult {
    let before_len = audio_events.len();
    if payload.emit_audio {
        push_audio_event(audio_events, sound_id, volume, pitch);
    }
    HitAudioDispatchResult {
        audio_event_pushed: audio_events.len() > before_len,
    }
}

pub(in crate::shooter_scene) fn push_game_over_audio_event(
    audio_events: &mut Vec<AudioEvent>,
    sound_id: u32,
    audio_policy: ShooterAudioPolicy,
) {
    push_audio_event(
        audio_events,
        sound_id,
        audio_policy.game_over_volume,
        audio_policy.game_over_pitch,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::action_failure_event_data;
    use crate::gameplay_event::{
        GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING, GAMEPLAY_EVENT_ACTION_FAILED,
        GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_COLLISION_DESPAWN,
        GAMEPLAY_EVENT_FLAG_TARGET_REMOVED, GAMEPLAY_EVENT_PICKUP_COLLECTED,
        GAMEPLAY_EVENT_PRESENTATION_EFFECT, GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
    };
    use crate::shooter_scene::DEFAULT_TEXTURE_ID;

    #[test]
    fn gameplay_event_sink_action_failure_trait_preserves_payload() {
        let actor = Entity {
            id: 1,
            generation: 2,
        };
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let mut events = Vec::new();
        {
            let mut sink = GameplayEventSink::new(&mut events);
            sink.push_action_failure(action_failure_event_data(
                actor,
                source,
                21,
                GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
            ));
        }

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, GAMEPLAY_EVENT_ACTION_FAILED);
        assert_eq!(events[0].actor_id, actor.id);
        assert_eq!(events[0].actor_generation, actor.generation);
        assert_eq!(events[0].source_id, source.id);
        assert_eq!(events[0].source_generation, source.generation);
        assert_eq!(events[0].token_id, 21);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
        );
    }

    #[test]
    fn gameplay_event_sink_pushes_prefab_spawned_payload() {
        let spawned = Entity {
            id: 1,
            generation: 2,
        };
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let mut events = Vec::new();
        let result = {
            let mut sink = GameplayEventSink::new(&mut events);
            sink.push_prefab_spawned_payload(crate::gameplay::prefab_spawned_event_payload(
                spawned, source, 7, 11,
            ))
        };

        assert_eq!(
            result,
            PrefabSpawnedEventDispatchResult { event_pushed: true }
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            crate::gameplay_event::GAMEPLAY_EVENT_PREFAB_SPAWNED
        );
        assert_eq!(events[0].actor_id, spawned.id);
        assert_eq!(events[0].actor_generation, spawned.generation);
        assert_eq!(events[0].source_id, source.id);
        assert_eq!(events[0].source_generation, source.generation);
        assert_eq!(events[0].token_id, 7);
        assert_eq!(events[0].payload_bits, 11);
    }

    #[test]
    fn gameplay_event_sink_pushes_prefab_spawned_direct_result() {
        let spawned = Entity {
            id: 1,
            generation: 2,
        };
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let mut events = Vec::new();
        let result = {
            let mut sink = GameplayEventSink::new(&mut events);
            sink.push_prefab_spawned(spawned, source, 7, 11)
        };

        assert_eq!(
            result,
            PrefabSpawnedEventDispatchResult { event_pushed: true }
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].kind,
            crate::gameplay_event::GAMEPLAY_EVENT_PREFAB_SPAWNED
        );
        assert_eq!(events[0].actor_id, spawned.id);
        assert_eq!(events[0].actor_generation, spawned.generation);
        assert_eq!(events[0].source_id, source.id);
        assert_eq!(events[0].source_generation, source.generation);
        assert_eq!(events[0].token_id, 7);
        assert_eq!(events[0].payload_bits, 11);
    }

    #[test]
    fn gameplay_event_sink_pushes_timer_dispatch() {
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let mut events = Vec::new();
        {
            let mut sink = GameplayEventSink::new(&mut events);
            sink.push_timer_dispatch(crate::gameplay::GameplayTimerDispatch {
                source,
                timer_id: 9,
                duration_seconds: 0.25,
                action_id: Some(21),
            });
        }

        assert_eq!(events.len(), 1);
        assert_eq!(events[0], GameplayEvent::timer(source, 9, 0.25));
    }

    #[test]
    fn gameplay_event_sink_pushes_attached_effect_event() {
        let actor = Entity {
            id: 1,
            generation: 2,
        };
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let mut events = Vec::new();
        let mut effect_events = Vec::new();
        {
            let mut sink = GameplayEventSink::with_effect_events(&mut events, &mut effect_events);
            sink.push_presentation_effect_at(
                actor,
                source,
                99,
                GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
                Transform2D { x: 4.0, y: -5.0 },
                0.5,
                12.0,
            );
        }

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, GAMEPLAY_EVENT_PRESENTATION_EFFECT);
        assert_eq!(events[0].actor_id, actor.id);
        assert_eq!(events[0].source_id, source.id);
        assert_eq!(events[0].token_id, 99);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM
        );
        assert_eq!(effect_events.len(), 1);
        assert_eq!(
            effect_events[0],
            EffectEvent::new(
                actor,
                source,
                99,
                GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM,
                Transform2D { x: 4.0, y: -5.0 },
                0.5,
                12.0,
            )
        );
    }

    #[test]
    fn collision_event_sink_pushes_hit_presentation_payload() {
        let source = Entity {
            id: 1,
            generation: 2,
        };
        let target = Entity {
            id: 3,
            generation: 4,
        };
        let mut events = Vec::new();
        let mut counts = CollisionEventCounts::default();
        {
            let mut sink = CollisionEventSink::new(&mut events, &mut counts);
            sink.push_hit_payload(CollisionHitPresentationPayload {
                source,
                target,
                damage: 3.5,
                emit_audio: false,
                particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
            });
        }

        assert_eq!(events.len(), 1);
        assert_eq!(counts.hit, 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_HIT);
        assert_eq!(events[0].a_id, source.id);
        assert_eq!(events[0].a_generation, source.generation);
        assert_eq!(events[0].b_id, target.id);
        assert_eq!(events[0].b_generation, target.generation);
        assert_eq!(events[0].damage(), 3.5);
    }

    #[test]
    fn particle_burst_sink_spawns_hit_presentation_payload_position_only() {
        let source = Entity {
            id: 1,
            generation: 2,
        };
        let target = Entity {
            id: 3,
            generation: 4,
        };
        let mut hit_preset = ParticlePreset::new(7);
        hit_preset.burst_count = 2;
        let mut particles = ParticleSystem::with_capacity(8);
        {
            let mut sink = ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &[]);
            assert_eq!(
                sink.spawn_hit_payload(CollisionHitPresentationPayload {
                    source,
                    target,
                    damage: 3.5,
                    emit_audio: false,
                    particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
                }),
                2,
            );
            assert_eq!(
                sink.spawn_hit_payload(CollisionHitPresentationPayload {
                    source: target,
                    target: source,
                    damage: 0.0,
                    emit_audio: true,
                    particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
                }),
                2,
            );
            assert_eq!(
                sink.spawn_hit_payload(CollisionHitPresentationPayload {
                    source,
                    target,
                    damage: 3.5,
                    emit_audio: true,
                    particle_position: None,
                }),
                0,
            );
        }

        assert_eq!(particles.particle_count(), 4);
    }

    #[test]
    fn push_hit_audio_event_respects_emit_audio_only() {
        let source = Entity {
            id: 1,
            generation: 2,
        };
        let target = Entity {
            id: 3,
            generation: 4,
        };
        let mut audio_events = Vec::new();

        let muted_result = push_hit_audio_event(
            &mut audio_events,
            CollisionHitPresentationPayload {
                source,
                target,
                damage: 3.5,
                emit_audio: false,
                particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
            },
            12,
            0.5,
            1.25,
        );
        let default_sound_result = push_hit_audio_event(
            &mut audio_events,
            CollisionHitPresentationPayload {
                source: target,
                target: source,
                damage: 0.0,
                emit_audio: true,
                particle_position: None,
            },
            DEFAULT_SOUND_ID,
            0.5,
            1.25,
        );
        let pushed_result = push_hit_audio_event(
            &mut audio_events,
            CollisionHitPresentationPayload {
                source: target,
                target: source,
                damage: 0.0,
                emit_audio: true,
                particle_position: None,
            },
            12,
            0.5,
            1.25,
        );

        assert_eq!(
            muted_result,
            HitAudioDispatchResult {
                audio_event_pushed: false,
            }
        );
        assert_eq!(
            default_sound_result,
            HitAudioDispatchResult {
                audio_event_pushed: false,
            }
        );
        assert_eq!(
            pushed_result,
            HitAudioDispatchResult {
                audio_event_pushed: true,
            }
        );
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id, 12.0);
        assert_eq!(audio_events[0].volume, 0.5);
        assert_eq!(audio_events[0].pitch, 1.25);
        assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);
    }

    #[test]
    fn push_game_over_audio_event_uses_policy_and_default_sound_skip() {
        let mut audio_events = Vec::new();
        let audio_policy = ShooterAudioPolicy::from_values(0.1, 1.1, 0.2, 1.2, 0.7, 0.85);

        push_game_over_audio_event(&mut audio_events, DEFAULT_SOUND_ID, audio_policy);
        push_game_over_audio_event(&mut audio_events, 31, audio_policy);

        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id, 31.0);
        assert_eq!(audio_events[0].volume, 0.7);
        assert_eq!(audio_events[0].pitch, 0.85);
        assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);
    }

    #[test]
    fn tween_sink_flashes_hit_presentation_payload_target_only() {
        let mut world = World::default();
        let source = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);
        let target = world.spawn_enemy(20.0, 10.0, DEFAULT_TEXTURE_ID);
        let source_tint = world
            .sprite_at_index(source.id as usize)
            .expect("spawned enemy should have a sprite");
        let mut tweens = TweenSystem::new();
        let result;
        {
            let mut sink = TweenSink::new(&mut tweens);
            result = sink.flash_enemy_hit_payload(
                &mut world,
                CollisionHitPresentationPayload {
                    source,
                    target,
                    damage: 3.5,
                    emit_audio: false,
                    particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
                },
            );
        }

        assert_eq!(
            result,
            HitTweenDispatchResult {
                tween_started: true,
            }
        );
        assert_eq!(tweens.tween_count(), 1);
        assert_eq!(world.sprite_at_index(source.id as usize), Some(source_tint));
        assert_eq!(
            world
                .sprite_at_index(target.id as usize)
                .expect("spawned enemy should have a sprite")
                .r,
            ENEMY_HIT_FLASH_TINT.r,
        );
    }

    #[test]
    fn tween_sink_reports_missing_hit_presentation_target() {
        let mut world = World::default();
        let source = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);
        let missing_target = Entity {
            id: 99,
            generation: 0,
        };
        let mut tweens = TweenSystem::new();
        let result = {
            let mut sink = TweenSink::new(&mut tweens);
            sink.flash_enemy_hit_payload(
                &mut world,
                CollisionHitPresentationPayload {
                    source,
                    target: missing_target,
                    damage: 3.5,
                    emit_audio: false,
                    particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
                },
            )
        };

        assert_eq!(
            result,
            HitTweenDispatchResult {
                tween_started: false,
            }
        );
        assert_eq!(tweens.tween_count(), 0);
    }

    #[test]
    fn tween_sink_reports_capacity_limited_hit_presentation_target() {
        let mut world = World::default();
        let source = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);
        let target = world.spawn_enemy(20.0, 10.0, DEFAULT_TEXTURE_ID);
        let mut tweens = TweenSystem::with_capacity(0);
        let result = {
            let mut sink = TweenSink::new(&mut tweens);
            sink.flash_enemy_hit_payload(
                &mut world,
                CollisionHitPresentationPayload {
                    source,
                    target,
                    damage: 3.5,
                    emit_audio: false,
                    particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
                },
            )
        };

        assert_eq!(
            result,
            HitTweenDispatchResult {
                tween_started: false,
            }
        );
        assert_eq!(tweens.tween_count(), 0);
    }

    #[test]
    fn gameplay_event_sink_pushes_collision_payloads_and_preserves_dedupe_policy() {
        let target = Entity {
            id: 1,
            generation: 2,
        };
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let pickup = Entity {
            id: 5,
            generation: 6,
        };
        let mut events = Vec::new();
        let (
            damage_result,
            despawn_result,
            duplicate_despawn_result,
            pickup_collected_result,
            removed_pickup_collected_result,
        );
        {
            let mut sink = GameplayEventSink::new(&mut events);
            damage_result = sink.push_collision_payload(CollisionGameplayEventPayload::Damage {
                target,
                source,
                damage: 3.5,
                target_removed: true,
            });
            despawn_result = sink
                .push_collision_payload(CollisionGameplayEventPayload::Despawn { target, source });
            duplicate_despawn_result = sink
                .push_collision_payload(CollisionGameplayEventPayload::Despawn { target, source });
            pickup_collected_result =
                sink.push_collision_payload(CollisionGameplayEventPayload::PickupCollected {
                    collector: source,
                    pickup,
                    item_id: 7,
                    count: 2,
                    target_removed: false,
                });
            removed_pickup_collected_result =
                sink.push_collision_payload(CollisionGameplayEventPayload::PickupCollected {
                    collector: source,
                    pickup,
                    item_id: 8,
                    count: 1,
                    target_removed: true,
                });
        }

        assert_eq!(
            damage_result,
            CollisionGameplayEventDispatchResult { event_pushed: true }
        );
        assert_eq!(
            despawn_result,
            CollisionGameplayEventDispatchResult { event_pushed: true }
        );
        assert_eq!(
            duplicate_despawn_result,
            CollisionGameplayEventDispatchResult {
                event_pushed: false
            }
        );
        assert_eq!(
            pickup_collected_result,
            CollisionGameplayEventDispatchResult { event_pushed: true }
        );
        assert_eq!(
            removed_pickup_collected_result,
            CollisionGameplayEventDispatchResult { event_pushed: true }
        );
        assert_eq!(events.len(), 4);
        assert_eq!(events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
        assert_eq!(events[0].actor_id, target.id);
        assert_eq!(events[0].actor_generation, target.generation);
        assert_eq!(events[0].source_id, source.id);
        assert_eq!(events[0].source_generation, source.generation);
        assert_eq!(
            events[0].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
            GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        );
        assert_eq!(events[0].payload_bits, 3.5f32.to_bits());

        assert_eq!(events[1].kind, GAMEPLAY_EVENT_COLLISION_DESPAWN);
        assert_eq!(events[1].actor_id, target.id);
        assert_eq!(events[1].actor_generation, target.generation);
        assert_eq!(events[1].source_id, source.id);
        assert_eq!(events[1].source_generation, source.generation);

        assert_eq!(events[2].kind, GAMEPLAY_EVENT_PICKUP_COLLECTED);
        assert_eq!(events[2].actor_id, source.id);
        assert_eq!(events[2].actor_generation, source.generation);
        assert_eq!(events[2].source_id, pickup.id);
        assert_eq!(events[2].source_generation, pickup.generation);
        assert_eq!(events[2].token_id, 7);
        assert_eq!(events[2].payload_bits, 2);

        assert_eq!(events[3].kind, GAMEPLAY_EVENT_PICKUP_COLLECTED);
        assert_eq!(events[3].token_id, 8);
        assert_eq!(events[3].payload_bits, 1);
        assert_eq!(
            events[3].flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
            GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
        );
    }
}
