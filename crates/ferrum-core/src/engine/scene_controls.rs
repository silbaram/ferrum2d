use wasm_bindgen::prelude::*;

use crate::components::Transform2D;
use crate::entity::Entity;

use super::scenes::{ActiveScene, SceneMode};
use super::Engine;

const INVALID_ENTITY_ID: u32 = u32::MAX;
const INVALID_GAME_STATE: u32 = u32::MAX;

#[wasm_bindgen]
impl Engine {
    pub fn set_texture_ids(&mut self, player: u32, enemy: u32, bullet: u32) {
        self.activate_built_in_shooter_scene();
        self.scenes
            .shooter_mut()
            .set_texture_ids(&mut self.world, player, enemy, bullet);
    }

    pub fn set_sound_ids(&mut self, shoot: u32, hit: u32, game_over: u32) {
        self.activate_built_in_shooter_scene();
        self.scenes
            .shooter_mut()
            .set_sound_ids(shoot, hit, game_over);
    }

    pub fn built_in_shooter_player_entity_id(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Shooter) {
            return INVALID_ENTITY_ID;
        }
        self.world
            .primary_actor_entity()
            .map_or(INVALID_ENTITY_ID, |entity| entity.id)
    }

    pub fn built_in_shooter_player_entity_generation(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Shooter) {
            return 0;
        }
        self.world
            .primary_actor_entity()
            .map_or(0, |entity| entity.generation)
    }

    pub fn built_in_platformer_player_entity_id(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Platformer)
        {
            return INVALID_ENTITY_ID;
        }
        self.scenes
            .platformer()
            .player_entity()
            .map_or(INVALID_ENTITY_ID, |entity| entity.id)
    }

    pub fn built_in_platformer_player_entity_generation(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Platformer)
        {
            return 0;
        }
        self.scenes
            .platformer()
            .player_entity()
            .map_or(0, |entity| entity.generation)
    }

    pub fn built_in_breakout_paddle_entity_id(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Breakout) {
            return INVALID_ENTITY_ID;
        }
        self.scenes
            .breakout()
            .paddle_entity()
            .map_or(INVALID_ENTITY_ID, |entity| entity.id)
    }

    pub fn built_in_breakout_paddle_entity_generation(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Breakout) {
            return 0;
        }
        self.scenes
            .breakout()
            .paddle_entity()
            .map_or(0, |entity| entity.generation)
    }

    pub fn built_in_breakout_ball_entity_id(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Breakout) {
            return INVALID_ENTITY_ID;
        }
        self.scenes
            .breakout()
            .ball_entity()
            .map_or(INVALID_ENTITY_ID, |entity| entity.id)
    }

    pub fn built_in_breakout_ball_entity_generation(&self) -> u32 {
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Breakout) {
            return 0;
        }
        self.scenes
            .breakout()
            .ball_entity()
            .map_or(0, |entity| entity.generation)
    }

    pub fn set_built_in_scene_entity_position(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        x: f32,
        y: f32,
    ) -> bool {
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        let entity = Entity {
            id: entity_id,
            generation: entity_generation,
        };
        let active_scene_entity = self.scene_mode == SceneMode::BuiltIn
            && ((self.scenes.is_active(ActiveScene::Shooter)
                && self.world.primary_actor_entity() == Some(entity))
                || (self.scenes.is_active(ActiveScene::Platformer)
                    && self.scenes.platformer().player_entity() == Some(entity))
                || (self.scenes.is_active(ActiveScene::Breakout)
                    && (self.scenes.breakout().paddle_entity() == Some(entity)
                        || self.scenes.breakout().ball_entity() == Some(entity))));
        if !active_scene_entity || self.world.transform(entity).is_none() {
            return false;
        }
        self.world.set_transform(entity, Transform2D { x, y });
        true
    }

    pub fn use_data_scene(&mut self) {
        self.activate_data_scene();
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
        self.clear_scene_output_buffers();
    }

    pub fn data_scene_game_state(&self) -> u32 {
        if self.scene_mode != SceneMode::Data {
            return INVALID_GAME_STATE;
        }
        self.data_scene.game_state().code()
    }

    pub fn pause_data_scene(&mut self) -> bool {
        if self.scene_mode != SceneMode::Data || !self.data_scene.pause() {
            return false;
        }
        self.data_scene.gameplay.observe_input(self.input);
        self.fixed_timestep_input_latch.clear();
        self.previous_input_sample = self.input;
        true
    }

    pub fn resume_data_scene(&mut self) -> bool {
        if self.scene_mode != SceneMode::Data || !self.data_scene.resume() {
            return false;
        }
        self.data_scene.gameplay.observe_input(self.input);
        self.fixed_timestep_input_latch.clear();
        self.previous_input_sample = self.input;
        true
    }

    pub fn complete_data_scene(&mut self) -> bool {
        if self.scene_mode != SceneMode::Data || !self.data_scene.complete_level() {
            return false;
        }
        self.data_scene.movement.cancel();
        self.data_scene.movement_animation.stop(&mut self.world);
        true
    }

    pub fn use_breakout_scene(&mut self) {
        self.activate_built_in_breakout_scene();
        self.tilemap.clear();
        self.reset_to_title();
    }

    pub fn use_platformer_scene(&mut self) {
        self.activate_built_in_platformer_scene();
        self.tilemap.clear();
        self.reset_to_title();
    }
}
