use wasm_bindgen::prelude::*;

use super::scenes::ActiveScene;
use super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        self.camera.set_viewport_size(width, height);
        match self.active_scene {
            ActiveScene::Shooter => self
                .scene
                .update_camera_follow(&self.world, &mut self.camera),
            ActiveScene::Breakout => self.breakout_scene.update_camera(&mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .update_camera(&self.world, &mut self.camera),
        }
    }
}
