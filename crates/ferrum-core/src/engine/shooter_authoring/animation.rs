use wasm_bindgen::prelude::*;

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_atlas_frame(
        &mut self,
        prefab: u32,
        texture_id: u32,
        width: f32,
        height: f32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_atlas_frame(
            &mut self.world,
            prefab,
            texture_id,
            width,
            height,
            u0,
            v0,
            u1,
            v1,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_atlas_animation(
        &mut self,
        prefab: u32,
        texture_id: u32,
        width: f32,
        height: f32,
        idle_fps: f32,
        idle_frames: Vec<f32>,
        move_fps: f32,
        move_frames: Vec<f32>,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_atlas_animation(
            &mut self.world,
            prefab,
            texture_id,
            width,
            height,
            idle_fps,
            &idle_frames,
            move_fps,
            &move_frames,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_animations(
        &mut self,
        player_columns: u32,
        player_rows: u32,
        player_idle_row: u32,
        player_idle_frames: u32,
        player_idle_fps: f32,
        player_move_row: u32,
        player_move_frames: u32,
        player_move_fps: f32,
        enemy_columns: u32,
        enemy_rows: u32,
        enemy_idle_row: u32,
        enemy_idle_frames: u32,
        enemy_idle_fps: f32,
        enemy_move_row: u32,
        enemy_move_frames: u32,
        enemy_move_fps: f32,
        bullet_columns: u32,
        bullet_rows: u32,
        bullet_idle_row: u32,
        bullet_idle_frames: u32,
        bullet_idle_fps: f32,
        bullet_move_row: u32,
        bullet_move_frames: u32,
        bullet_move_fps: f32,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_animation_states(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            player_columns,
            player_rows,
            player_idle_row,
            player_idle_frames,
            player_idle_fps,
            player_move_row,
            player_move_frames,
            player_move_fps,
            enemy_columns,
            enemy_rows,
            enemy_idle_row,
            enemy_idle_frames,
            enemy_idle_fps,
            enemy_move_row,
            enemy_move_frames,
            enemy_move_fps,
            bullet_columns,
            bullet_rows,
            bullet_idle_row,
            bullet_idle_frames,
            bullet_idle_fps,
            bullet_move_row,
            bullet_move_frames,
            bullet_move_fps,
        );
        self.clear_physics_history();
    }
}
