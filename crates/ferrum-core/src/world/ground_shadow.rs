//! Cached ground silhouettes, owned and retired with their entity.
use crate::components::{Sprite, Transform2D};
use crate::render_command::{SpriteRenderCommand, SPRITE_PROJECT_GROUND, SPRITE_SHADOW_ALPHA};
mod volume;
pub(crate) use volume::{GroundShadowHull, GroundShadowVolume, GroundShadowVolumeVertex};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum GroundShadowShape {
    Ellipse,
    Box,
    Alpha,
    Volume(GroundShadowVolume),
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum CachedGeometry {
    Sprite(SpriteRenderCommand),
    Volume(GroundShadowHull),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GroundShadowCaster {
    pub shape: GroundShadowShape,
    pub width: f32,
    pub height: f32,
    pub opacity: f32,
    pub layer: i32,
    cache: Option<([f32; 15], CachedGeometry)>,
}

impl GroundShadowCaster {
    pub fn new(
        shape: GroundShadowShape,
        width: f32,
        height: f32,
        opacity: f32,
        layer: i32,
    ) -> Self {
        Self {
            shape,
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
        let key = self.geometry_key(t, sprite, sun, ground_y_scale);
        if let Some((previous, CachedGeometry::Sprite(command))) = self.cache {
            if previous == key {
                return (self.with_current_frame(command, sprite), true);
            }
        }
        let [foot_x, foot_y] = sprite_foot(t, sprite, ground_y_scale);
        let (sin, cos) = sprite.rotation_radians.sin_cos();
        let projection = sun.projection;
        let alpha = self.shape == GroundShadowShape::Alpha;
        let length = self.height * projection.length_scale;
        let (offset_x, offset_y) = if alpha {
            projection.project(self.height * 0.5 * sin, -self.height * 0.5 * cos)
        } else {
            (
                projection.direction_x * length * 0.5,
                projection.direction_y * length * 0.5,
            )
        };
        let height = if alpha { self.height } else { length };
        let command = SpriteRenderCommand {
            x: foot_x + offset_x - self.width * 0.5,
            y: foot_y + offset_y - height * 0.5,
            width: self.width,
            height,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: self.opacity * sun.opacity * sprite.a,
            texture_id: 0.0,
            effect_flags: SPRITE_PROJECT_GROUND
                + match self.shape {
                    GroundShadowShape::Ellipse => 8.0,
                    GroundShadowShape::Box => 16.0,
                    GroundShadowShape::Alpha => SPRITE_SHADOW_ALPHA,
                    // append_ground_shadow routes volume casters through volume_geometry first.
                    GroundShadowShape::Volume(_) => {
                        unreachable!("volume shadows have triangle geometry")
                    }
                },
            rotation_radians: if alpha {
                sprite.rotation_radians
            } else {
                projection.direction_y.atan2(projection.direction_x) - std::f32::consts::FRAC_PI_2
            },
        };
        self.cache = Some((key, CachedGeometry::Sprite(command)));
        (self.with_current_frame(command, sprite), false)
    }

    pub fn volume_geometry(
        &mut self,
        t: Transform2D,
        sprite: Sprite,
        sun: GroundSun,
        ground_y_scale: f32,
    ) -> Option<(GroundShadowHull, bool)> {
        let GroundShadowShape::Volume(volume) = self.shape else {
            return None;
        };
        let key = self.geometry_key(t, sprite, sun, ground_y_scale);
        if let Some((previous, CachedGeometry::Volume(hull))) = self.cache {
            if previous == key {
                return Some((hull, true));
            }
        }
        let hull = volume.project(
            sprite_foot(t, sprite, ground_y_scale),
            self.width,
            self.height,
            sprite.rotation_radians,
            sun.projection,
        );
        self.cache = Some((key, CachedGeometry::Volume(hull)));
        Some((hull, false))
    }

    fn geometry_key(
        &self,
        t: Transform2D,
        sprite: Sprite,
        sun: GroundSun,
        ground_y_scale: f32,
    ) -> [f32; 15] {
        [
            t.x,
            t.y,
            sprite.width,
            sprite.height,
            sprite.origin_x,
            sprite.origin_y,
            sprite.rotation_radians,
            sprite.a,
            sun.projection.direction_x,
            sun.projection.direction_y,
            sun.opacity,
            sun.projection.length_scale,
            ground_y_scale,
            if sprite.project_ground { 1.0 } else { 0.0 },
            self.opacity,
        ]
    }

    fn with_current_frame(
        &self,
        mut command: SpriteRenderCommand,
        sprite: Sprite,
    ) -> SpriteRenderCommand {
        if self.shape == GroundShadowShape::Alpha {
            // UV/texture updates do not change geometry; never cache an animation frame or flip.
            command.texture_id = sprite.texture_id as f32;
            command.u0 = sprite.u0;
            command.v0 = sprite.v0;
            command.u1 = sprite.u1;
            command.v1 = sprite.v1;
        }
        command
    }

    pub fn half_extents(
        &self,
        command: SpriteRenderCommand,
        projection: GroundShadowProjection,
    ) -> (f32, f32) {
        let (sin, cos) = command.rotation_radians.sin_cos();
        if self.shape == GroundShadowShape::Alpha {
            let (ax, ay) = projection.project(cos * command.width, sin * command.width);
            let (bx, by) = projection.project(-sin * command.height, cos * command.height);
            ((ax.abs() + bx.abs()) * 0.5, (ay.abs() + by.abs()) * 0.5)
        } else {
            (
                (cos.abs() * command.width + sin.abs() * command.height) * 0.5,
                (sin.abs() * command.width + cos.abs() * command.height) * 0.5,
            )
        }
    }
}

fn sprite_foot(t: Transform2D, sprite: Sprite, ground_y_scale: f32) -> [f32; 2] {
    let dx = (0.5 - sprite.origin_x) * sprite.width;
    let dy = (1.0 - sprite.origin_y) * sprite.height;
    let (sin, cos) = sprite.rotation_radians.sin_cos();
    [
        t.x + dx * cos - dy * sin,
        t.y + (dx * sin + dy * cos)
            / if sprite.project_ground {
                1.0
            } else {
                ground_y_scale
            },
    ]
}

/// Frame-level numeric metadata; shared with renderers without per-caster boundary calls.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GroundShadowProjection {
    pub direction_x: f32,
    pub direction_y: f32,
    pub length_scale: f32,
}

const _: () = assert!(core::mem::size_of::<GroundShadowProjection>() == 12);

impl GroundShadowProjection {
    /// Across the sun, then from the image's top toward the sun direction. This is a 2D
    /// silhouette approximation, not a height map or a multiple-receiver shadow model.
    fn project(self, x: f32, y: f32) -> (f32, f32) {
        (
            self.direction_y * x - self.direction_x * y * self.length_scale,
            -self.direction_x * x - self.direction_y * y * self.length_scale,
        )
    }
}

impl Default for GroundShadowProjection {
    fn default() -> Self {
        Self {
            direction_x: 1.0,
            direction_y: 0.0,
            length_scale: 1.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct GroundSun {
    pub projection: GroundShadowProjection,
    pub opacity: f32,
    pub max_casters: usize,
}

impl Default for GroundSun {
    fn default() -> Self {
        Self {
            projection: GroundShadowProjection::default(),
            opacity: 0.0,
            max_casters: 0,
        }
    }
}
