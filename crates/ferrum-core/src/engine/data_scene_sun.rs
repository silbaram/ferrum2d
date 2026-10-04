use super::{Engine, SceneMode};
use crate::components::DEFAULT_SPRITE_RENDER_LAYER;
use crate::world::ground_shadow::{
    GroundShadowCaster, GroundShadowProjection, GroundShadowShape, GroundSun,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Changes view lighting geometry without changing world or collider data.
    pub fn configure_data_scene_sun(
        &mut self,
        x: f32,
        y: f32,
        opacity: f32,
        length_scale: f32,
        max_casters: u32,
    ) -> bool {
        let length = x.hypot(y);
        if self.scene_mode != SceneMode::Data
            || !length.is_finite()
            || length < 0.000001
            || !opacity.is_finite()
            || !(0.0..=1.0).contains(&opacity)
            || !length_scale.is_finite()
            || !(0.01..=100.0).contains(&length_scale)
            || max_casters > 10000
        {
            return false;
        }
        self.ground_sun = GroundSun {
            projection: GroundShadowProjection {
                direction_x: x / length,
                direction_y: y / length,
                length_scale,
            },
            opacity,
            max_casters: max_casters as usize,
        };
        true
    }

    /// Attaches a low-cost silhouette to the same generational entity as its sprite/body.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_ground_shadow(
        &mut self,
        id: u32,
        generation: u32,
        shape: u32,
        width: f32,
        height: f32,
        opacity: f32,
        explicit_layer: bool,
        layer: i32,
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || shape > 3
            || !width.is_finite()
            || !height.is_finite()
            || width <= 0.0
            || height <= 0.0
            || width > 1e10
            || height > 1e10
            || !opacity.is_finite()
            || !(0.0..=1.0).contains(&opacity)
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(id, generation) else {
            return false;
        };
        let index = entity.id as usize;
        let Some(sprite) = self.world.sprites[index] else {
            return false;
        };
        let layer = if explicit_layer {
            let Some(layer) = layer.checked_add(DEFAULT_SPRITE_RENDER_LAYER) else {
                return false;
            };
            layer
        } else {
            sprite.render_layer.saturating_sub(1)
        };
        let shape = match shape {
            0 => None,
            1 => Some(GroundShadowShape::Ellipse),
            2 => Some(GroundShadowShape::Box),
            3 => Some(GroundShadowShape::Alpha),
            _ => return false,
        };
        self.world.ground_shadows[index] =
            shape.map(|shape| GroundShadowCaster::new(shape, width, height, opacity, layer));
        true
    }

    /// Three contiguous f32s captured with the last render build: normalized direction X/Y,
    /// then length scale. Reacquire after memory growth or the next render build.
    pub fn data_scene_ground_shadow_projection_ptr(&self) -> *const f32 {
        &self.frame_buffers.ground_shadow_projection.direction_x
    }

    pub fn data_scene_ground_shadow_projection_len(&self) -> usize {
        core::mem::size_of::<GroundShadowProjection>() / core::mem::size_of::<f32>()
    }

    /// Ground scale captured with the render commands, unaffected by changes for the next frame.
    pub fn render_command_ground_y_scale(&self) -> f32 {
        self.frame_buffers.ground_y_scale
    }

    /// Last render-build counters: admitted casters, cache hits, rebuilds, culled, budget skipped.
    pub fn data_scene_ground_shadow_stats(&self) -> Vec<u32> {
        self.ground_shadow_stats.to_vec()
    }
}

impl Engine {
    pub(super) fn append_ground_shadow(
        &mut self,
        index: usize,
        transform: crate::components::Transform2D,
        sprite: crate::components::Sprite,
    ) {
        use crate::components::Transform2D;
        use crate::render_command::{SpriteRenderItem, SpriteRenderSortKey};
        if self.scene_mode != SceneMode::Data
            || self.ground_sun.opacity <= 0.0
            || self.ground_sun.max_casters == 0
        {
            return;
        }
        let Some(caster) = self.world.ground_shadows[index].as_mut() else {
            return;
        };
        if caster.opacity <= 0.0 || sprite.a <= 0.0 {
            return;
        }
        let (mut command, cached) = caster.geometry(
            transform,
            sprite,
            self.ground_sun,
            self.camera.ground_y_scale,
        );
        self.ground_shadow_stats[if cached { 1 } else { 2 }] += 1;
        let center = self.camera.world_to_screen(Transform2D {
            x: command.x + command.width * 0.5,
            y: command.y + command.height * 0.5,
        });
        let (hw, hh) = caster.half_extents(command, self.ground_sun.projection);
        let hh = hh * self.camera.ground_y_scale;
        if ![center.x, center.y, hw, hh].iter().all(|v| v.is_finite())
            || center.x + hw < 0.0
            || center.y + hh < 0.0
            || center.x - hw > self.camera.viewport_width
            || center.y - hh > self.camera.viewport_height
        {
            self.ground_shadow_stats[3] += 1;
            return;
        }
        if self.ground_shadow_stats[0] as usize >= self.ground_sun.max_casters {
            self.ground_shadow_stats[4] += 1;
            return;
        }
        self.ground_shadow_stats[0] += 1;
        command.x = center.x - command.width * 0.5;
        command.y = center.y - command.height * 0.5;
        self.frame_buffers.render_items.push(SpriteRenderItem {
            command,
            sort_key: SpriteRenderSortKey {
                floor_id: 0,
                elevation: 0.0,
                foot_y: 0.0,
                render_layer: caster.layer,
                sort_order: sprite.sort_order,
                stable_id: index as u32,
            },
        });
    }
}
