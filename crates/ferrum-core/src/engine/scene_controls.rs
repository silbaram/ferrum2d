use wasm_bindgen::prelude::*;

use super::scenes::ActiveScene;
use super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn set_texture_ids(&mut self, player: u32, enemy: u32, bullet: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene
            .set_texture_ids(&mut self.world, player, enemy, bullet);
    }

    pub fn set_sound_ids(&mut self, shoot: u32, hit: u32, game_over: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_sound_ids(shoot, hit, game_over);
    }

    pub fn use_breakout_scene(&mut self) {
        self.active_scene = ActiveScene::Breakout;
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.breakout_scene
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }

    pub fn use_platformer_scene(&mut self) {
        self.active_scene = ActiveScene::Platformer;
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.platformer_scene
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }
}
