use super::Engine;
use crate::audio_event::{AudioEvent, AUDIO_CHANNEL_SFX};
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy)]
struct Profile {
    mask: u32,
    min_impulse: f32,
    cooldown: f64,
    sound: u32,
    particle: u32,
    volume: f32,
}
#[derive(Default)]
pub(super) struct ImpactFeedback {
    profiles: Vec<Profile>,
    cooldowns: BTreeMap<(u32, u32, u32, u32), f64>,
    time: f64,
    emitted: u32,
    dropped: u32,
}
impl ImpactFeedback {
    pub(super) fn clear_runtime(&mut self) {
        self.cooldowns.clear();
        self.time = 0.0;
        self.begin_frame();
    }
    pub(super) fn begin_frame(&mut self) {
        self.emitted = 0;
        self.dropped = 0;
    }
}
#[wasm_bindgen]
impl Engine {
    /// Rows: category bits, minimum impulse, cooldown seconds, sound id or u32::MAX,
    /// particle preset id or u32::MAX, volume. First matching material category wins.
    pub fn configure_physics_impact_feedback(&mut self, values: &[f64]) -> bool {
        if !values.len().is_multiple_of(6) || values.len() > 32 * 6 {
            return false;
        }
        let mut profiles = Vec::new();
        for r in values.chunks_exact(6) {
            if r.iter().any(|n| !n.is_finite() || *n < 0.0)
                || [0, 3, 4]
                    .iter()
                    .any(|i| r[*i] > u32::MAX as f64 || r[*i].fract() != 0.0)
                || r[0] == 0.0
                || r[1] > f32::MAX as f64
                || r[2] > 60.0
                || r[5] > 1.0
                || (r[3] != u32::MAX as f64 && r[3] > 16_777_216.0)
                || (r[4] != u32::MAX as f64
                    && self
                        .particle_presets
                        .get(r[4] as usize)
                        .and_then(|p| *p)
                        .is_none())
            {
                return false;
            }
            profiles.push(Profile {
                mask: r[0] as u32,
                min_impulse: r[1] as f32,
                cooldown: r[2],
                sound: r[3] as u32,
                particle: r[4] as u32,
                volume: r[5] as f32,
            });
        }
        self.impact_feedback.profiles = profiles;
        self.reset_physics_impact_feedback();
        true
    }
    pub fn physics_impact_feedback_stats(&self) -> Vec<u32> {
        vec![
            self.impact_feedback.emitted,
            self.impact_feedback.dropped,
            self.impact_feedback.cooldowns.len() as u32,
        ]
    }
}
impl Engine {
    /// Call at committed world replacement/reset boundaries, not ordinary despawns.
    pub(super) fn reset_physics_impact_feedback(&mut self) {
        self.impact_feedback.clear_runtime();
        self.world.impact_feedback_enabled = !self.impact_feedback.profiles.is_empty();
        self.world.impact_feedback_impacts.clear();
        self.world.impact_feedback_dropped = 0;
    }

    pub(super) fn process_physics_impact_feedback(&mut self, dt: f32) {
        if !dt.is_finite() || dt <= 0.0 || self.impact_feedback.profiles.is_empty() {
            return;
        }
        let feedback = &mut self.impact_feedback;
        feedback.time += dt as f64;
        feedback.dropped = feedback
            .dropped
            .saturating_add(self.world.impact_feedback_dropped);
        feedback.cooldowns.retain(|_, end| *end > feedback.time);
        for impact in &self.world.impact_feedback_impacts {
            let a = impact.entity_a;
            let b = impact.entity_b;
            let category = self
                .world
                .collision_filter(a)
                .map_or(0, |f| f.category.bits)
                | self
                    .world
                    .collision_filter(b)
                    .map_or(0, |f| f.category.bits);
            let Some(profile) = feedback
                .profiles
                .iter()
                .find(|p| p.mask & category != 0 && impact.normal_impulse >= p.min_impulse)
                .copied()
            else {
                continue;
            };
            let key = if (a.id, a.generation) <= (b.id, b.generation) {
                (a.id, a.generation, b.id, b.generation)
            } else {
                (b.id, b.generation, a.id, a.generation)
            };
            if feedback.cooldowns.contains_key(&key) {
                continue;
            }
            if feedback.emitted >= 32 || feedback.cooldowns.len() >= 1024 {
                feedback.dropped = feedback.dropped.saturating_add(1);
                continue;
            }
            // Even zero cooldown deduplicates manifold/substep hits within this step.
            feedback
                .cooldowns
                .insert(key, feedback.time + profile.cooldown.max(dt as f64));
            if profile.sound != u32::MAX {
                self.frame_buffers.audio_events.push(AudioEvent {
                    sound_id: profile.sound as f32,
                    volume: profile.volume,
                    pitch: 1.0,
                    channel_id: AUDIO_CHANNEL_SFX,
                });
            }
            if let Some(Some(preset)) = self.particle_presets.get(profile.particle as usize) {
                self.particles
                    .spawn_burst(*preset, impact.point_x, impact.point_y);
            }
            feedback.emitted += 1;
        }
    }
}
