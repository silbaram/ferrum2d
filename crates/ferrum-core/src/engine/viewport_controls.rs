use wasm_bindgen::prelude::*;

use super::scenes::SceneMode;
use super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        self.camera.set_viewport_size(width, height);
        if self.scene_mode == SceneMode::Data {
            self.update_data_scene_camera(0.0);
            return;
        }
        self.scenes
            .update_active_camera(&self.world, &mut self.camera);
    }
}

#[derive(Default)]
pub(super) struct DataSceneCamera {
    follow: Option<crate::entity::Entity>,
    bounds: Option<[f32; 4]>,
    smooth_seconds: f32,
}

#[wasm_bindgen]
impl Engine {
    /// Low-frequency camera configuration; following runs in Rust after simulation.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_camera(
        &mut self,
        x: f32,
        y: f32,
        follow_id: u32,
        follow_generation: u32,
        bounded: bool,
        min_x: f32,
        min_y: f32,
        max_x: f32,
        max_y: f32,
        smooth_seconds: f32,
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || !x.is_finite()
            || !y.is_finite()
            || !smooth_seconds.is_finite()
            || smooth_seconds < 0.0
        {
            return false;
        }
        let follow = if follow_id == u32::MAX {
            None
        } else {
            let Some(entity) = self.entity_from_handle(follow_id, follow_generation) else {
                return false;
            };
            if self.world.transform(entity).is_none() {
                return false;
            }
            Some(entity)
        };
        let bounds = if bounded {
            if ![min_x, min_y, max_x, max_y].iter().all(|v| v.is_finite())
                || min_x > max_x
                || min_y > max_y
            {
                return false;
            }
            Some([min_x, min_y, max_x, max_y])
        } else {
            None
        };
        self.data_scene.camera = DataSceneCamera {
            follow,
            bounds,
            smooth_seconds,
        };
        self.camera.x = x;
        self.camera.y = y;
        self.update_data_scene_camera(0.0);
        true
    }
}

impl Engine {
    pub(super) fn update_data_scene_camera(&mut self, delta: f32) {
        if self.scene_mode != SceneMode::Data {
            return;
        }
        let config = &mut self.data_scene.camera;
        if let Some(entity) = config.follow {
            if let Some(target) = self.world.transform(entity) {
                let blend = if config.smooth_seconds == 0.0 {
                    1.0
                } else {
                    1.0 - (-delta.max(0.0) / config.smooth_seconds).exp()
                };
                self.camera.x += (target.x - self.camera.x) * blend;
                self.camera.y += (target.y - self.camera.y) * blend;
            } else {
                config.follow = None;
            }
        }
        if let Some([min_x, min_y, max_x, max_y]) = config.bounds {
            self.camera.x =
                clamp_camera_axis(self.camera.x, min_x, max_x, self.camera.viewport_width);
            self.camera.y =
                clamp_camera_axis(self.camera.y, min_y, max_y, self.camera.viewport_height);
        }
    }
}

fn clamp_camera_axis(value: f32, min: f32, max: f32, viewport: f32) -> f32 {
    if viewport >= max - min {
        min * 0.5 + max * 0.5
    } else {
        value.clamp(min + viewport * 0.5, max - viewport * 0.5)
    }
}
