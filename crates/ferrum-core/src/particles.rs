use std::f32::consts::TAU;

use crate::camera::Camera2D;
use crate::components::{SpriteFrame, Transform2D};
use crate::render_command::{SpriteRenderCommand, SPRITE_EFFECT_NONE};

const DEFAULT_PARTICLE_CAPACITY: usize = 512;
const DEFAULT_PARTICLE_SEED: u32 = 0xA341_316C;
const PARTICLE_EPSILON: f32 = 0.0001;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParticleRange {
    pub min: f32,
    pub max: f32,
}

impl ParticleRange {
    pub const fn new(min: f32, max: f32) -> Self {
        Self { min, max }
    }

    pub const fn constant(value: f32) -> Self {
        Self {
            min: value,
            max: value,
        }
    }

    fn normalized(self, fallback: Self) -> Self {
        if !self.min.is_finite() || !self.max.is_finite() {
            return fallback;
        }
        if self.min <= self.max {
            self
        } else {
            Self {
                min: self.max,
                max: self.min,
            }
        }
    }

    fn sample(self, random: f32) -> f32 {
        self.min + (self.max - self.min) * random.clamp(0.0, 1.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ParticlePreset {
    pub texture_id: u32,
    pub frame: SpriteFrame,
    pub burst_count: u32,
    pub lifetime_seconds: ParticleRange,
    pub speed: ParticleRange,
    pub start_size: ParticleRange,
    pub end_size: ParticleRange,
    pub start_color: [f32; 4],
    pub end_color: [f32; 4],
    pub acceleration_x: f32,
    pub acceleration_y: f32,
    pub damping: f32,
}

impl ParticlePreset {
    pub fn new(texture_id: u32) -> Self {
        Self {
            texture_id,
            frame: SpriteFrame::FULL,
            burst_count: 8,
            lifetime_seconds: ParticleRange::new(0.18, 0.38),
            speed: ParticleRange::new(60.0, 180.0),
            start_size: ParticleRange::constant(8.0),
            end_size: ParticleRange::constant(2.0),
            start_color: [1.0, 1.0, 1.0, 1.0],
            end_color: [1.0, 1.0, 1.0, 0.0],
            acceleration_x: 0.0,
            acceleration_y: 0.0,
            damping: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Particle {
    pub x: f32,
    pub y: f32,
    pub velocity_x: f32,
    pub velocity_y: f32,
    pub age_seconds: f32,
    pub lifetime_seconds: f32,
    pub start_size: f32,
    pub end_size: f32,
    pub start_color: [f32; 4],
    pub end_color: [f32; 4],
    pub texture_id: u32,
    pub frame: SpriteFrame,
    acceleration_x: f32,
    acceleration_y: f32,
    damping: f32,
}

impl Particle {
    pub fn normalized_age(self) -> f32 {
        if self.lifetime_seconds <= PARTICLE_EPSILON {
            1.0
        } else {
            (self.age_seconds / self.lifetime_seconds).clamp(0.0, 1.0)
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParticleSystem {
    particles: Vec<Particle>,
    capacity: usize,
    rng: ParticleRng,
}

impl Default for ParticleSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl ParticleSystem {
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_PARTICLE_CAPACITY)
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            particles: Vec::with_capacity(capacity),
            capacity,
            rng: ParticleRng::new(DEFAULT_PARTICLE_SEED),
        }
    }

    pub fn set_seed(&mut self, seed: u32) {
        self.rng = ParticleRng::new(seed);
    }

    pub fn particle_count(&self) -> usize {
        self.particles.len()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn particles(&self) -> &[Particle] {
        &self.particles
    }

    pub fn clear(&mut self) {
        self.particles.clear();
    }

    pub fn spawn_burst(&mut self, preset: ParticlePreset, x: f32, y: f32) -> usize {
        if !x.is_finite() || !y.is_finite() || preset.burst_count == 0 {
            return 0;
        }

        let lifetime = preset
            .lifetime_seconds
            .normalized(ParticleRange::constant(0.0));
        let start_size = preset.start_size.normalized(ParticleRange::constant(0.0));
        let end_size = preset.end_size.normalized(ParticleRange::constant(0.0));
        let speed = preset.speed.normalized(ParticleRange::constant(0.0));
        let acceleration_x = finite_or_default(preset.acceleration_x, 0.0);
        let acceleration_y = finite_or_default(preset.acceleration_y, 0.0);
        let damping = non_negative_or_default(preset.damping, 0.0);
        let start_color = finite_color_or_default(preset.start_color, [1.0, 1.0, 1.0, 1.0]);
        let end_color = finite_color_or_default(preset.end_color, [1.0, 1.0, 1.0, 0.0]);
        let mut spawned = 0;

        for _ in 0..preset.burst_count {
            if self.particles.len() >= self.capacity {
                break;
            }

            let lifetime_seconds = lifetime.sample(self.rng.next_f32());
            if lifetime_seconds <= PARTICLE_EPSILON {
                continue;
            }

            let angle = self.rng.next_f32() * TAU;
            let velocity = speed.sample(self.rng.next_f32());
            let start_size = non_negative_or_default(start_size.sample(self.rng.next_f32()), 0.0);
            let end_size = non_negative_or_default(end_size.sample(self.rng.next_f32()), 0.0);
            self.particles.push(Particle {
                x,
                y,
                velocity_x: angle.cos() * velocity,
                velocity_y: angle.sin() * velocity,
                age_seconds: 0.0,
                lifetime_seconds,
                start_size,
                end_size,
                start_color,
                end_color,
                texture_id: preset.texture_id,
                frame: preset.frame,
                acceleration_x,
                acceleration_y,
                damping,
            });
            spawned += 1;
        }

        spawned
    }

    pub fn update(&mut self, delta_seconds: f32) {
        if !delta_seconds.is_finite() || delta_seconds <= 0.0 {
            return;
        }

        for particle in &mut self.particles {
            particle.age_seconds += delta_seconds;
            particle.velocity_x += particle.acceleration_x * delta_seconds;
            particle.velocity_y += particle.acceleration_y * delta_seconds;

            let damping_factor = (1.0 - particle.damping * delta_seconds).clamp(0.0, 1.0);
            particle.velocity_x *= damping_factor;
            particle.velocity_y *= damping_factor;
            particle.x += particle.velocity_x * delta_seconds;
            particle.y += particle.velocity_y * delta_seconds;
        }

        self.particles
            .retain(|particle| particle.age_seconds < particle.lifetime_seconds);
    }

    pub fn append_render_commands(
        &self,
        camera: &Camera2D,
        render_commands: &mut Vec<SpriteRenderCommand>,
    ) {
        for particle in &self.particles {
            let t = particle.normalized_age();
            let size = lerp(particle.start_size, particle.end_size, t);
            let color = lerp_color(particle.start_color, particle.end_color, t);
            if size <= PARTICLE_EPSILON || color[3] <= 0.0 {
                continue;
            }

            let screen = camera.world_to_screen(Transform2D {
                x: particle.x,
                y: particle.y,
            });
            let (u0, v0, u1, v1) = particle.frame.uv();
            render_commands.push(SpriteRenderCommand {
                x: screen.x - size * 0.5,
                y: screen.y - size * 0.5,
                width: size,
                height: size,
                u0,
                v0,
                u1,
                v1,
                r: color[0],
                g: color[1],
                b: color[2],
                a: color[3],
                texture_id: particle.texture_id as f32,
                effect_flags: SPRITE_EFFECT_NONE,
            });
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ParticleRng {
    state: u32,
}

impl ParticleRng {
    fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 {
                DEFAULT_PARTICLE_SEED
            } else {
                seed
            },
        }
    }

    fn next_f32(&mut self) -> f32 {
        self.state = self
            .state
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        ((self.state >> 8) as f32) / ((u32::MAX >> 8) as f32)
    }
}

fn finite_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

fn non_negative_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        default
    }
}

fn finite_color_or_default(value: [f32; 4], default: [f32; 4]) -> [f32; 4] {
    if value.iter().all(|channel| channel.is_finite()) {
        value
    } else {
        default
    }
}

fn lerp(start: f32, end: f32, t: f32) -> f32 {
    start + (end - start) * t.clamp(0.0, 1.0)
}

fn lerp_color(start: [f32; 4], end: [f32; 4], t: f32) -> [f32; 4] {
    [
        lerp(start[0], end[0], t),
        lerp(start[1], end[1], t),
        lerp(start[2], end[2], t),
        lerp(start[3], end[3], t),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawn_burst_respects_capacity_and_seeded_randomness() {
        let mut preset = ParticlePreset::new(7);
        preset.burst_count = 4;
        preset.lifetime_seconds = ParticleRange::constant(1.0);
        preset.speed = ParticleRange::constant(100.0);
        preset.start_size = ParticleRange::constant(6.0);
        preset.end_size = ParticleRange::constant(2.0);

        let mut first = ParticleSystem::with_capacity(2);
        first.set_seed(123);
        let mut second = ParticleSystem::with_capacity(2);
        second.set_seed(123);

        assert_eq!(first.spawn_burst(preset, 10.0, 20.0), 2);
        assert_eq!(second.spawn_burst(preset, 10.0, 20.0), 2);
        assert_eq!(first.particle_count(), 2);
        assert_eq!(first.particles(), second.particles());
    }

    #[test]
    fn update_advances_particles_and_removes_expired_particles() {
        let mut preset = ParticlePreset::new(3);
        preset.burst_count = 1;
        preset.lifetime_seconds = ParticleRange::constant(0.5);
        preset.speed = ParticleRange::constant(0.0);
        preset.start_size = ParticleRange::constant(4.0);
        preset.end_size = ParticleRange::constant(4.0);
        preset.acceleration_y = 8.0;

        let mut particles = ParticleSystem::with_capacity(8);
        assert_eq!(particles.spawn_burst(preset, 0.0, 0.0), 1);

        particles.update(0.25);
        assert_eq!(particles.particle_count(), 1);
        let particle = particles.particles()[0];
        assert!((particle.age_seconds - 0.25).abs() < 0.001);
        assert!((particle.velocity_y - 2.0).abs() < 0.001);
        assert!((particle.y - 0.5).abs() < 0.001);

        particles.update(0.25);
        assert_eq!(particles.particle_count(), 0);
    }

    #[test]
    fn append_render_commands_interpolates_size_color_and_camera_offset() {
        let mut preset = ParticlePreset::new(5);
        preset.frame = SpriteFrame::from_values(0.25, 0.5, 0.75, 1.0).unwrap();
        preset.burst_count = 1;
        preset.lifetime_seconds = ParticleRange::constant(1.0);
        preset.speed = ParticleRange::constant(0.0);
        preset.start_size = ParticleRange::constant(10.0);
        preset.end_size = ParticleRange::constant(2.0);
        preset.start_color = [1.0, 0.0, 0.0, 1.0];
        preset.end_color = [0.0, 0.0, 1.0, 0.0];

        let mut particles = ParticleSystem::with_capacity(4);
        particles.spawn_burst(preset, 20.0, 30.0);
        particles.update(0.5);

        let mut commands = Vec::new();
        particles.append_render_commands(&Camera2D::new(100.0, 100.0), &mut commands);

        assert_eq!(commands.len(), 1);
        let command = commands[0];
        assert!((command.x - 17.0).abs() < 0.001);
        assert!((command.y - 27.0).abs() < 0.001);
        assert!((command.width - 6.0).abs() < 0.001);
        assert!((command.height - 6.0).abs() < 0.001);
        assert_eq!(command.u0, 0.25);
        assert_eq!(command.v0, 0.5);
        assert_eq!(command.u1, 0.75);
        assert_eq!(command.v1, 1.0);
        assert!((command.r - 0.5).abs() < 0.001);
        assert_eq!(command.g, 0.0);
        assert!((command.b - 0.5).abs() < 0.001);
        assert!((command.a - 0.5).abs() < 0.001);
        assert_eq!(command.texture_id, 5.0);
    }

    #[test]
    fn invalid_spawn_values_are_ignored_without_panicking() {
        let mut preset = ParticlePreset::new(1);
        preset.burst_count = 3;
        preset.lifetime_seconds = ParticleRange::constant(f32::NAN);

        let mut particles = ParticleSystem::with_capacity(4);
        assert_eq!(particles.spawn_burst(preset, f32::NAN, 0.0), 0);
        assert_eq!(particles.spawn_burst(preset, 0.0, 0.0), 0);
        assert_eq!(particles.particle_count(), 0);
    }
}
