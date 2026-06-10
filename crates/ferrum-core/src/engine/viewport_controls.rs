use wasm_bindgen::prelude::*;

use super::scenes::{ActiveScene, SceneMode};
use super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        self.camera.set_viewport_size(width, height);
        if self.scene_mode == SceneMode::Data {
            return;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .update_camera_follow(&self.world, &mut self.camera),
            ActiveScene::Breakout => self.scenes.breakout.update_camera(&mut self.camera),
            ActiveScene::Platformer => self
                .scenes
                .platformer
                .update_camera(&self.world, &mut self.camera),
        }
    }
}
