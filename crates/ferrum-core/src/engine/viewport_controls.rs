use wasm_bindgen::prelude::*;

use super::scenes::SceneMode;
use super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        self.camera.set_viewport_size(width, height);
        if self.scene_mode == SceneMode::Data {
            return;
        }
        self.scenes
            .update_active_camera(&self.world, &mut self.camera);
    }
}
