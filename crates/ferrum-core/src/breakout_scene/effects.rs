use crate::components::Transform2D;
use crate::particles::{ParticlePreset, ParticleRange, ParticleSystem};

use super::config::{BRICK_HIT_PARTICLE_COUNT, DEFAULT_TEXTURE_ID};

pub(crate) struct BreakoutParticleBurstSink<'a> {
    particles: &'a mut ParticleSystem,
    preset: ParticlePreset,
}

impl<'a> BreakoutParticleBurstSink<'a> {
    pub(crate) fn new(particles: &'a mut ParticleSystem, preset: ParticlePreset) -> Self {
        Self { particles, preset }
    }

    pub(super) fn spawn_brick_hit(&mut self, position: Transform2D) -> usize {
        self.particles
            .spawn_burst(self.preset, position.x, position.y)
    }
}

pub(crate) fn breakout_brick_hit_particle_preset() -> ParticlePreset {
    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = BRICK_HIT_PARTICLE_COUNT;
    preset.lifetime_seconds = ParticleRange::new(0.14, 0.3);
    preset.speed = ParticleRange::new(70.0, 190.0);
    preset.start_size = ParticleRange::new(6.0, 10.0);
    preset.end_size = ParticleRange::constant(1.5);
    preset.start_color = [1.0, 0.88, 0.36, 1.0];
    preset.end_color = [1.0, 0.28, 0.08, 0.0];
    preset.damping = 1.8;
    preset
}
