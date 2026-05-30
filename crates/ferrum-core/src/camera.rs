use std::f32::consts::TAU;

use crate::collision::AabbBounds;
use crate::components::{Transform2D, Velocity};

const DEFAULT_DEAD_ZONE_WIDTH: f32 = 160.0;
const DEFAULT_DEAD_ZONE_HEIGHT: f32 = 96.0;
const DEFAULT_LOOK_AHEAD_DISTANCE: f32 = 96.0;
const DEFAULT_SHAKE_AMPLITUDE: f32 = 6.0;
const DEFAULT_SHAKE_FREQUENCY: f32 = 8.0;
const VELOCITY_EPSILON: f32 = 0.0001;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CameraPreset {
    #[default]
    Follow,
    DeadZone,
    LookAhead,
    Shake,
}

impl CameraPreset {
    pub fn from_code(code: u32) -> Self {
        match code {
            1 => Self::DeadZone,
            2 => Self::LookAhead,
            3 => Self::Shake,
            _ => Self::Follow,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CameraPresetConfig {
    pub preset: CameraPreset,
    pub dead_zone_width: f32,
    pub dead_zone_height: f32,
    pub look_ahead_distance: f32,
    pub shake_amplitude: f32,
    pub shake_frequency: f32,
}

impl Default for CameraPresetConfig {
    fn default() -> Self {
        Self {
            preset: CameraPreset::Follow,
            dead_zone_width: DEFAULT_DEAD_ZONE_WIDTH,
            dead_zone_height: DEFAULT_DEAD_ZONE_HEIGHT,
            look_ahead_distance: DEFAULT_LOOK_AHEAD_DISTANCE,
            shake_amplitude: DEFAULT_SHAKE_AMPLITUDE,
            shake_frequency: DEFAULT_SHAKE_FREQUENCY,
        }
    }
}

impl CameraPresetConfig {
    pub fn from_values(
        preset: u32,
        dead_zone_width: f32,
        dead_zone_height: f32,
        look_ahead_distance: f32,
        shake_amplitude: f32,
        shake_frequency: f32,
    ) -> Self {
        let default = Self::default();
        Self {
            preset: CameraPreset::from_code(preset),
            dead_zone_width: non_negative_or_default(dead_zone_width, default.dead_zone_width),
            dead_zone_height: non_negative_or_default(dead_zone_height, default.dead_zone_height),
            look_ahead_distance: non_negative_or_default(
                look_ahead_distance,
                default.look_ahead_distance,
            ),
            shake_amplitude: non_negative_or_default(shake_amplitude, default.shake_amplitude),
            shake_frequency: positive_or_default(shake_frequency, default.shake_frequency),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera2D {
    pub x: f32,
    pub y: f32,
    pub viewport_width: f32,
    pub viewport_height: f32,
}

impl Camera2D {
    pub fn new(viewport_width: f32, viewport_height: f32) -> Self {
        Self {
            x: viewport_width * 0.5,
            y: viewport_height * 0.5,
            viewport_width,
            viewport_height,
        }
    }

    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        if width > 0.0 {
            self.viewport_width = width;
        }
        if height > 0.0 {
            self.viewport_height = height;
        }
    }

    pub fn follow(&mut self, target: Transform2D, world_width: f32, world_height: f32) {
        self.x = target.x;
        self.y = target.y;
        self.clamp_to_world(world_width, world_height);
    }

    pub fn apply_preset(
        &mut self,
        target: Transform2D,
        target_velocity: Velocity,
        world_width: f32,
        world_height: f32,
        config: CameraPresetConfig,
        elapsed_seconds: f32,
    ) {
        match config.preset {
            CameraPreset::Follow => self.follow(target, world_width, world_height),
            CameraPreset::DeadZone => {
                self.x = dead_zone_axis(self.x, target.x, config.dead_zone_width);
                self.y = dead_zone_axis(self.y, target.y, config.dead_zone_height);
                self.clamp_to_world(world_width, world_height);
            }
            CameraPreset::LookAhead => {
                let target = look_ahead_target(target, target_velocity, config.look_ahead_distance);
                self.follow(target, world_width, world_height);
            }
            CameraPreset::Shake => {
                let mut target = target;
                let phase = elapsed_seconds.max(0.0) * config.shake_frequency * TAU;
                target.x += phase.sin() * config.shake_amplitude;
                target.y += phase.cos() * config.shake_amplitude;
                self.follow(target, world_width, world_height);
            }
        }
    }

    pub fn world_to_screen(&self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x - self.left(),
            y: transform.y - self.top(),
        }
    }

    pub fn screen_to_world(&self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.left(),
            y: transform.y + self.top(),
        }
    }

    pub fn visible_bounds(&self) -> AabbBounds {
        AabbBounds {
            min_x: self.left(),
            min_y: self.top(),
            max_x: self.left() + self.viewport_width,
            max_y: self.top() + self.viewport_height,
        }
    }

    fn left(&self) -> f32 {
        self.x - self.viewport_width * 0.5
    }

    fn top(&self) -> f32 {
        self.y - self.viewport_height * 0.5
    }

    fn clamp_to_world(&mut self, world_width: f32, world_height: f32) {
        self.x = clamp_axis(self.x, self.viewport_width, world_width);
        self.y = clamp_axis(self.y, self.viewport_height, world_height);
    }
}

fn dead_zone_axis(center: f32, target: f32, zone_size: f32) -> f32 {
    let half_zone = zone_size.max(0.0) * 0.5;
    if target < center - half_zone {
        target + half_zone
    } else if target > center + half_zone {
        target - half_zone
    } else {
        center
    }
}

fn look_ahead_target(target: Transform2D, velocity: Velocity, distance: f32) -> Transform2D {
    let len = (velocity.vx * velocity.vx + velocity.vy * velocity.vy).sqrt();
    if len <= VELOCITY_EPSILON || distance <= 0.0 {
        return target;
    }

    Transform2D {
        x: target.x + (velocity.vx / len) * distance,
        y: target.y + (velocity.vy / len) * distance,
    }
}

fn clamp_axis(center: f32, viewport_size: f32, world_size: f32) -> f32 {
    if viewport_size >= world_size {
        world_size * 0.5
    } else {
        center.clamp(viewport_size * 0.5, world_size - viewport_size * 0.5)
    }
}

fn positive_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follow_clamps_camera_to_world_bounds() {
        let mut camera = Camera2D::new(400.0, 240.0);

        camera.follow(Transform2D { x: 50.0, y: 900.0 }, 1600.0, 960.0);

        assert_eq!(camera.x, 200.0);
        assert_eq!(camera.y, 840.0);
    }

    #[test]
    fn dead_zone_preset_moves_only_after_target_leaves_zone() {
        let mut camera = Camera2D::new(400.0, 240.0);
        camera.follow(Transform2D { x: 800.0, y: 480.0 }, 1600.0, 960.0);
        let config = CameraPresetConfig {
            preset: CameraPreset::DeadZone,
            dead_zone_width: 100.0,
            dead_zone_height: 80.0,
            ..CameraPresetConfig::default()
        };

        camera.apply_preset(
            Transform2D { x: 830.0, y: 500.0 },
            Velocity::default(),
            1600.0,
            960.0,
            config,
            0.0,
        );
        assert_eq!(camera.x, 800.0);
        assert_eq!(camera.y, 480.0);

        camera.apply_preset(
            Transform2D { x: 900.0, y: 560.0 },
            Velocity::default(),
            1600.0,
            960.0,
            config,
            0.0,
        );
        assert_eq!(camera.x, 850.0);
        assert_eq!(camera.y, 520.0);
    }

    #[test]
    fn look_ahead_preset_offsets_in_velocity_direction() {
        let mut camera = Camera2D::new(400.0, 240.0);

        camera.apply_preset(
            Transform2D { x: 800.0, y: 480.0 },
            Velocity { vx: 3.0, vy: 4.0 },
            1600.0,
            960.0,
            CameraPresetConfig {
                preset: CameraPreset::LookAhead,
                look_ahead_distance: 100.0,
                ..CameraPresetConfig::default()
            },
            0.0,
        );

        assert_eq!(camera.x, 860.0);
        assert_eq!(camera.y, 560.0);
    }

    #[test]
    fn shake_preset_uses_elapsed_time_for_offset() {
        let mut camera = Camera2D::new(400.0, 240.0);

        camera.apply_preset(
            Transform2D { x: 800.0, y: 480.0 },
            Velocity::default(),
            1600.0,
            960.0,
            CameraPresetConfig {
                preset: CameraPreset::Shake,
                shake_amplitude: 10.0,
                shake_frequency: 1.0,
                ..CameraPresetConfig::default()
            },
            0.25,
        );

        assert!((camera.x - 810.0).abs() < 0.01);
        assert!((camera.y - 480.0).abs() < 0.01);
    }

    #[test]
    fn world_to_screen_applies_camera_offset() {
        let mut camera = Camera2D::new(400.0, 240.0);
        camera.follow(Transform2D { x: 800.0, y: 480.0 }, 1600.0, 960.0);

        let screen = camera.world_to_screen(Transform2D { x: 820.0, y: 500.0 });

        assert_eq!(screen, Transform2D { x: 220.0, y: 140.0 });
    }

    #[test]
    fn screen_to_world_applies_camera_offset() {
        let mut camera = Camera2D::new(400.0, 240.0);
        camera.follow(Transform2D { x: 800.0, y: 480.0 }, 1600.0, 960.0);

        let world = camera.screen_to_world(Transform2D { x: 220.0, y: 140.0 });

        assert_eq!(world, Transform2D { x: 820.0, y: 500.0 });
    }
}
