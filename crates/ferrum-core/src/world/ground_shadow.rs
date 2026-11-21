//! Cached ground silhouettes, owned and retired with their entity.
impl GroundShadowCaster {
    /// Reads the persisted cached packet without evaluating its key or geometry.
    /// The second word is raw shader mode bits, never a presentation effect ID.
    pub(crate) fn file_resource_cache(&self) -> Option<(u32, u32)> {
        match &self.cache {
            Some((_, CachedGeometry::Sprite(c))) => {
                Some((c.texture_id.to_bits(), c.effect_flags.to_bits()))
            }
            _ => None,
        }
    }
    /// Box/ellipse generation uses this build's fixed white texture. Alpha uses
    /// the current Sprite texture and volume shadows use untextured geometry.
    pub(crate) fn file_program_texture(&self) -> Option<u32> {
        matches!(
            self.shape,
            GroundShadowShape::Box | GroundShadowShape::Ellipse
        )
        .then_some(0)
    }
}

use crate::components::{Sprite, Transform2D};
use crate::render_command::{SpriteRenderCommand, SPRITE_PROJECT_GROUND, SPRITE_SHADOW_ALPHA};
mod volume;
pub(crate) use volume::{GroundShadowHull, GroundShadowVolume, GroundShadowVolumeVertex};

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) enum GroundShadowShape {
    Ellipse,
    Box,
    Alpha,
    Volume(GroundShadowVolume),
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
enum CachedGeometry {
    Sprite(SpriteRenderCommand),
    Volume(GroundShadowHull),
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
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
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
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

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
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

impl GroundShadowCaster {
    /// Cold inspection includes the private persisted cache's safe bounds. It
    /// does not recompute/repair history or certify cache keys against an Engine.
    pub(crate) fn saved_payload_valid(&self) -> bool {
        if ![self.width, self.height, self.opacity]
            .iter()
            .all(|v| v.is_finite())
            || self.width <= 0.
            || self.height <= 0.
            || !(0.0..=1.).contains(&self.opacity)
        {
            return false;
        }
        if let GroundShadowShape::Volume(v) = self.shape {
            if ![v.depth, v.roof_height, v.offset_x, v.offset_y]
                .iter()
                .all(|x| x.is_finite())
                || v.depth <= 0.
                || v.roof_height < 0.
            {
                return false;
            }
        }
        let Some((key, geometry)) = &self.cache else {
            return true;
        };
        if key.iter().any(|x| !x.is_finite()) {
            return false;
        }
        match geometry {
            CachedGeometry::Sprite(v) => [
                v.x,
                v.y,
                v.width,
                v.height,
                v.u0,
                v.v0,
                v.u1,
                v.v1,
                v.r,
                v.g,
                v.b,
                v.a,
                v.texture_id,
                v.effect_flags,
                v.rotation_radians,
            ]
            .iter()
            .all(|x| x.is_finite()),
            CachedGeometry::Volume(v) => {
                (v.len == 0 || (3..=v.points.len()).contains(&v.len))
                    && v.foot
                        .iter()
                        .chain(v.points.iter().flatten())
                        .all(|x| x.is_finite())
            }
        }
    }
}
