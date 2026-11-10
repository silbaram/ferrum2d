use super::{Engine, SceneMode};
use crate::components::DEFAULT_SPRITE_RENDER_LAYER;
use crate::world::ground_shadow::{
    GroundShadowCaster, GroundShadowHull, GroundShadowProjection, GroundShadowShape,
    GroundShadowVolume, GroundShadowVolumeVertex, GroundSun,
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
        if shape == 3 && self.world.sprite_nine_slices[index].is_some() {
            return false;
        }
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

    /// Installs an entity-owned footprint/wall/gable proxy. Values are world units;
    /// offsets locate its ground center relative to the sprite's bottom-center.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_ground_shadow_volume(
        &mut self,
        id: u32,
        generation: u32,
        width: f32,
        depth: f32,
        height: f32,
        roof_height: f32,
        offset_x: f32,
        offset_y: f32,
        opacity: f32,
        explicit_layer: bool,
        layer: i32,
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || ![width, depth, height]
                .iter()
                .all(|v| v.is_finite() && (0.001..=1e6).contains(v))
            || !roof_height.is_finite()
            || !(0.0..=1e6).contains(&roof_height)
            || ![offset_x, offset_y]
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 1e6)
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
        self.world.ground_shadows[index] = Some(GroundShadowCaster::new(
            GroundShadowShape::Volume(GroundShadowVolume {
                depth,
                roof_height,
                offset_x,
                offset_y,
            }),
            width,
            height,
            opacity,
            layer,
        ));
        true
    }

    /// Optional triangle sidecar ABI: three f32 values (screen X/Y and opacity) per vertex.
    pub fn ground_shadow_volume_abi_version(&self) -> u32 {
        1
    }
    /// Number of f32 fields in each volume-shadow vertex; version 1 uses X/Y/opacity.
    pub fn ground_shadow_volume_vertex_stride(&self) -> u32 {
        3
    }
    /// Borrowed triangle data from the last render build. Reacquire after memory growth.
    pub fn ground_shadow_volume_ptr(&self) -> *const f32 {
        self.frame_buffers.ground_shadow_volumes.as_ptr().cast()
    }
    /// Number of vertices in the last render build, not the number of f32 fields.
    pub fn ground_shadow_volume_len(&self) -> u32 {
        self.frame_buffers.ground_shadow_volumes.len() as u32
    }
    /// Volume casters admitted after culling and the shared silhouette budget.
    pub fn ground_shadow_volume_caster_count(&self) -> u32 {
        self.frame_buffers.ground_shadow_volume_casters
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
        if let Some((hull, cached)) = caster.volume_geometry(
            transform,
            sprite,
            self.ground_sun,
            self.camera.ground_y_scale,
        ) {
            let opacity = caster.opacity * self.ground_sun.opacity * sprite.a;
            self.append_volume_shadow(hull, cached, opacity);
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
            normal_material: Default::default(),
            lighting_material: Default::default(),
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

    fn append_volume_shadow(&mut self, hull: GroundShadowHull, cached: bool, opacity: f32) {
        use crate::components::Transform2D;
        self.ground_shadow_stats[if cached { 1 } else { 2 }] += 1;
        let foot = self.camera.world_to_screen(Transform2D {
            x: hull.foot[0],
            y: hull.foot[1],
        });
        let mut points = [[0.0; 2]; 10];
        let mut bounds = [
            f32::INFINITY,
            f32::INFINITY,
            f32::NEG_INFINITY,
            f32::NEG_INFINITY,
        ];
        for (output, input) in points.iter_mut().zip(&hull.points[..hull.len]) {
            *output = [
                foot.x + input[0],
                foot.y + input[1] * self.camera.ground_y_scale,
            ];
            bounds[0] = bounds[0].min(output[0]);
            bounds[1] = bounds[1].min(output[1]);
            bounds[2] = bounds[2].max(output[0]);
            bounds[3] = bounds[3].max(output[1]);
        }
        if hull.len < 3
            || !points[..hull.len].iter().flatten().all(|v| v.is_finite())
            || bounds[2] < 0.0
            || bounds[3] < 0.0
            || bounds[0] > self.camera.viewport_width
            || bounds[1] > self.camera.viewport_height
        {
            self.ground_shadow_stats[3] += 1;
            return;
        }
        if self.ground_shadow_stats[0] as usize >= self.ground_sun.max_casters {
            self.ground_shadow_stats[4] += 1;
            return;
        }
        self.ground_shadow_stats[0] += 1;
        self.frame_buffers.ground_shadow_volume_casters += 1;
        for i in 1..hull.len - 1 {
            for p in [points[0], points[i], points[i + 1]] {
                self.frame_buffers
                    .ground_shadow_volumes
                    .push(GroundShadowVolumeVertex {
                        x: p[0],
                        y: p[1],
                        opacity,
                    });
            }
        }
    }
}
