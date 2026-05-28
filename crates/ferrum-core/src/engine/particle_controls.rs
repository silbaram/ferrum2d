use wasm_bindgen::prelude::*;

use crate::components::SpriteFrame;
use crate::particles::{ParticlePreset, ParticleRange};

use super::{Engine, MAX_PARTICLE_PRESETS};

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn set_particle_preset(
        &mut self,
        preset_id: u32,
        texture_id: u32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
        burst_count: u32,
        lifetime_min: f32,
        lifetime_max: f32,
        speed_min: f32,
        speed_max: f32,
        start_size_min: f32,
        start_size_max: f32,
        end_size_min: f32,
        end_size_max: f32,
        start_r: f32,
        start_g: f32,
        start_b: f32,
        start_a: f32,
        end_r: f32,
        end_g: f32,
        end_b: f32,
        end_a: f32,
        acceleration_x: f32,
        acceleration_y: f32,
        damping: f32,
    ) {
        let preset_index = preset_id as usize;
        if preset_index >= MAX_PARTICLE_PRESETS {
            return;
        }
        let Some(frame) = SpriteFrame::from_values(u0, v0, u1, v1) else {
            return;
        };

        if preset_index >= self.particle_presets.len() {
            self.particle_presets.resize(preset_index + 1, None);
        }
        self.particle_presets[preset_index] = Some(ParticlePreset {
            texture_id,
            frame,
            burst_count,
            lifetime_seconds: ParticleRange::new(lifetime_min, lifetime_max),
            speed: ParticleRange::new(speed_min, speed_max),
            start_size: ParticleRange::new(start_size_min, start_size_max),
            end_size: ParticleRange::new(end_size_min, end_size_max),
            start_color: [start_r, start_g, start_b, start_a],
            end_color: [end_r, end_g, end_b, end_a],
            acceleration_x,
            acceleration_y,
            damping,
        });
    }

    pub fn clear_particle_presets(&mut self) {
        self.particle_presets.clear();
        self.shooter_hit_particle_preset = None;
    }

    pub fn set_shooter_hit_particle_preset(&mut self, preset_id: u32) {
        if preset_id as usize >= MAX_PARTICLE_PRESETS {
            return;
        }
        self.shooter_hit_particle_preset = Some(preset_id);
    }

    pub fn clear_shooter_hit_particle_preset(&mut self) {
        self.shooter_hit_particle_preset = None;
    }

    pub fn set_particle_seed(&mut self, seed: u32) {
        self.particles.set_seed(seed);
    }

    pub fn spawn_particle_burst(&mut self, preset_id: u32, x: f32, y: f32) -> usize {
        let Some(Some(preset)) = self.particle_presets.get(preset_id as usize) else {
            return 0;
        };
        self.particles.spawn_burst(*preset, x, y)
    }

    pub fn clear_particles(&mut self) {
        self.particles.clear();
    }

    pub fn particle_count(&self) -> usize {
        self.particles.particle_count()
    }

    pub fn particle_capacity(&self) -> usize {
        self.particles.capacity()
    }
}
