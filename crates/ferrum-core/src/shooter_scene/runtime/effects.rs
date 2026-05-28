use crate::audio_event::{AudioEvent, AUDIO_CHANNEL_SFX};
use crate::collision_event::{CollisionEvent, CollisionEventCounts, COLLISION_EVENT_HIT};
use crate::components::Transform2D;
use crate::entity::Entity;
use crate::particles::{ParticlePreset, ParticleSystem};
use crate::physics::PhysicsCounters;
use crate::tweens::{TweenEasing, TweenSystem};
use crate::world::World;

use super::super::{DEFAULT_SOUND_ID, ENEMY_HIT_FLASH_SECONDS, ENEMY_HIT_FLASH_TINT};

pub(in crate::shooter_scene) struct CollisionEventSink<'a> {
    events: &'a mut Vec<CollisionEvent>,
    counts: &'a mut CollisionEventCounts,
}

impl CollisionEventSink<'_> {
    pub(in crate::shooter_scene) fn push_hit(&mut self, a: Entity, b: Entity, damage: f32) {
        self.events.push(CollisionEvent::from_entities_with_damage(
            COLLISION_EVENT_HIT,
            a,
            b,
            damage,
        ));
        self.counts.hit = self.counts.hit.saturating_add(1);
    }
}

pub(crate) struct ParticleBurstSink<'a> {
    particles: &'a mut ParticleSystem,
    preset: ParticlePreset,
}

impl<'a> ParticleBurstSink<'a> {
    pub(crate) fn new(particles: &'a mut ParticleSystem, preset: ParticlePreset) -> Self {
        Self { particles, preset }
    }

    pub(in crate::shooter_scene) fn spawn_at(&mut self, position: Transform2D) -> usize {
        self.particles
            .spawn_burst(self.preset, position.x, position.y)
    }
}

pub(crate) struct TweenSink<'a> {
    tweens: &'a mut TweenSystem,
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
}

#[derive(Default)]
pub(in crate::shooter_scene) struct ShooterRuntimeSinks<'a> {
    pub(in crate::shooter_scene) physics_counters: Option<&'a mut PhysicsCounters>,
    pub(in crate::shooter_scene) collision_events: Option<CollisionEventSink<'a>>,
    pub(in crate::shooter_scene) hit_particles: Option<ParticleBurstSink<'a>>,
    pub(in crate::shooter_scene) hit_tweens: Option<TweenSink<'a>>,
}

impl<'a> ShooterRuntimeSinks<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn with_effects(
        physics_counters: &'a mut PhysicsCounters,
        collision_events: &'a mut Vec<CollisionEvent>,
        collision_event_counts: &'a mut CollisionEventCounts,
        hit_particles: Option<ParticleBurstSink<'a>>,
        hit_tweens: Option<TweenSink<'a>>,
    ) -> Self {
        Self {
            physics_counters: Some(physics_counters),
            collision_events: Some(CollisionEventSink {
                events: collision_events,
                counts: collision_event_counts,
            }),
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
