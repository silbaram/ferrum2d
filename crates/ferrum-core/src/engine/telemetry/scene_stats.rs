use wasm_bindgen::prelude::*;

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn score(&self) -> u32 {
        self.active_scene_score()
    }

    pub fn entity_count(&self) -> usize {
        self.world.alive_count()
    }

    pub fn game_state(&self) -> u32 {
        self.game_state_code()
    }

    pub fn game_state_code(&self) -> u32 {
        self.active_scene_game_state_code()
    }

    pub fn sprite_count(&self) -> usize {
        self.render_commands.len()
    }

    pub fn camera_x(&self) -> f32 {
        self.camera.x
    }

    pub fn camera_y(&self) -> f32 {
        self.camera.y
    }
}
