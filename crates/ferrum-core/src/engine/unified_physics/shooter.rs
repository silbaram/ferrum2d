//! Built-in Shooter intent → native movement → gameplay reactions.
use super::*;
use crate::input::InputState;
use crate::shooter_scene::{ParticleBurstSink, TweenSink};

impl Engine {
    pub(in crate::engine) fn update_native_shooter(&mut self, delta: f32, input: InputState) {
        let playing = self.scenes.shooter_mut().pre_physics_with_counters(
            &mut self.world,
            &mut self.camera,
            input,
            &self.input_actions,
            &mut self.frame_buffers.audio_events,
            &self.tilemap,
            delta,
            &mut self.frame_buffers.gameplay_events,
            &mut self.frame_buffers.effect_events,
        );
        // A title/start or game-over/restart press changes state only. Movement,
        // timers and reactions begin on the next tick, as in the legacy Shooter.
        if !playing {
            self.sync_native_built_in();
            return;
        }
        // Imported and newly spawned fixtures wait for native movement. Only
        // collider-free logical entities use World velocity integration here.
        self.world.update_with_rigid_body_step(
            delta,
            true,
            true,
            &mut self.frame_buffers.gameplay_events,
            &mut self.frame_buffers.animation_event_overflow,
        );
        if self.auto_rigid_body_step_enabled
            && self.step_unified_with_config(delta, self.auto_rigid_body_step_config, true)
                != Some(true)
        {
            // A native rejection is never a request for legacy movement/reactions.
            return;
        }
        let preset = self
            .shooter_hit_particle_preset
            .and_then(|id| self.particle_presets.get(id as usize))
            .and_then(|preset| *preset);
        let particles = (preset.is_some() || !self.particle_presets.is_empty()).then(|| {
            ParticleBurstSink::with_presets(&mut self.particles, preset, &self.particle_presets)
        });
        self.scenes.shooter_mut().post_physics_with_counters(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            &self.tilemap,
            delta,
            false,
            &mut self.physics_counters,
            &mut self.frame_buffers.collision_events,
            &mut self.collision_event_counts,
            &mut self.frame_buffers.gameplay_events,
            &mut self.frame_buffers.effect_events,
            particles,
            Some(TweenSink::new(&mut self.tweens)),
        );
        self.sync_native_built_in();
    }
}
