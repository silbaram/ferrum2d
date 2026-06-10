use wasm_bindgen::prelude::*;

use super::scenes::{ActiveScene, SceneMode};
use super::Engine;

const INVALID_ENTITY_ID: u32 = u32::MAX;

#[wasm_bindgen]
impl Engine {
    pub fn set_texture_ids(&mut self, player: u32, enemy: u32, bullet: u32) {
        self.activate_built_in_shooter_scene();
        self.scenes
            .shooter
            .set_texture_ids(&mut self.world, player, enemy, bullet);
    }

    pub fn set_sound_ids(&mut self, shoot: u32, hit: u32, game_over: u32) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_sound_ids(shoot, hit, game_over);
    }

    pub fn built_in_shooter_player_entity_id(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || self.scenes.active() != ActiveScene::Shooter {
            return INVALID_ENTITY_ID;
        }
        self.world
            .player_entity()
            .map_or(INVALID_ENTITY_ID, |entity| entity.id)
    }

    pub fn built_in_shooter_player_entity_generation(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || self.scenes.active() != ActiveScene::Shooter {
            return 0;
        }
        self.world
            .player_entity()
            .map_or(0, |entity| entity.generation)
    }

    pub fn use_data_scene(&mut self) {
        self.activate_data_scene();
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
        self.clear_scene_output_buffers();
    }

    pub fn use_breakout_scene(&mut self) {
        self.activate_built_in_breakout_scene();
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.scenes
            .breakout
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }

    pub fn use_platformer_scene(&mut self) {
        self.activate_built_in_platformer_scene();
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.scenes
            .platformer
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }
}
