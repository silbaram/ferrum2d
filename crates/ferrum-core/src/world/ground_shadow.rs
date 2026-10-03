//! Cached explicit ground silhouettes, owned and retired with their entity.
use crate::components::{Sprite, Transform2D};
use crate::render_command::{SpriteRenderCommand, SPRITE_PROJECT_GROUND};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GroundShadowCaster {
    pub ellipse: bool,
    pub width: f32,
    pub height: f32,
    pub opacity: f32,
    pub layer: i32,
    cache: Option<([f32; 15], SpriteRenderCommand)>,
}

impl GroundShadowCaster {
    pub fn new(ellipse: bool, width: f32, height: f32, opacity: f32, layer: i32) -> Self {
        Self {
            ellipse,
            width,
            height,
            opacity,
            layer,
            cache: None,
        }
    }

    /// Returns world-space rectangle geometry; the camera offset is applied after cache lookup.
    pub fn geometry(
        &mut self,
        t: Transform2D,
        sprite: Sprite,
        sun: GroundSun,
        ground_y_scale: f32,
    ) -> (SpriteRenderCommand, bool) {
        let key = [
            t.x,
            t.y,
            sprite.width,
            sprite.height,
            sprite.origin_x,
            sprite.origin_y,
            sprite.rotation_radians,
            sprite.a,
            sun.x,
            sun.y,
            sun.opacity,
            sun.length_scale,
            ground_y_scale,
            if sprite.project_ground { 1.0 } else { 0.0 },
            self.opacity,
        ];
        if let Some((previous, command)) = self.cache {
            if previous == key {
                return (command, true);
            }
        }
        // The bottom-center of the authored image is the ground contact, including pivot/rotation.
        let dx = (0.5 - sprite.origin_x) * sprite.width;
        let dy = (1.0 - sprite.origin_y) * sprite.height;
        let (sin, cos) = sprite.rotation_radians.sin_cos();
        let foot_x = t.x + dx * cos - dy * sin;
        let foot_y = t.y
            + (dx * sin + dy * cos)
                / if sprite.project_ground {
                    1.0
                } else {
                    ground_y_scale
                };
        let length = self.height * sun.length_scale;
        let center_x = foot_x + sun.x * length * 0.5;
        let center_y = foot_y + sun.y * length * 0.5;
        let command = SpriteRenderCommand {
            x: center_x - self.width * 0.5,
            y: center_y - length * 0.5,
            width: self.width,
            height: length,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: self.opacity * sun.opacity * sprite.a,
            texture_id: 0.0,
            effect_flags: SPRITE_PROJECT_GROUND + if self.ellipse { 8.0 } else { 16.0 },
            rotation_radians: sun.y.atan2(sun.x) - std::f32::consts::FRAC_PI_2,
        };
        self.cache = Some((key, command));
        (command, false)
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct GroundSun {
    pub x: f32,
    pub y: f32,
    pub opacity: f32,
    pub length_scale: f32,
    pub max_casters: usize,
}

impl Default for GroundSun {
    fn default() -> Self {
        Self {
            x: 1.0,
            y: 0.0,
            opacity: 0.0,
            length_scale: 1.0,
            max_casters: 0,
        }
    }
}
