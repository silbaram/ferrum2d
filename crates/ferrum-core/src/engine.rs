use wasm_bindgen::prelude::*;

use crate::audio_event::AudioEvent;
use crate::camera::{Camera2D, CameraPresetConfig};
use crate::game_state::GameState;
use crate::input::InputState;
use crate::render_command::SpriteRenderCommand;
use crate::shooter_scene::{
    EnemyBehavior, EnemySpawnPattern, ShooterAudioPolicy, ShooterConfig, ShooterScene,
    ShooterWaveConfig,
};
use crate::tilemap::Tilemap;
use crate::world::World;

const DEFAULT_VIEWPORT_WIDTH: f32 = 800.0;
const DEFAULT_VIEWPORT_HEIGHT: f32 = 480.0;

#[wasm_bindgen]
pub struct Engine {
    elapsed_seconds: f64,
    input: InputState,
    scene: ShooterScene,
    camera: Camera2D,
    world: World,
    tilemap: Tilemap,
    render_commands: Vec<SpriteRenderCommand>,
    audio_events: Vec<AudioEvent>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut engine = Self {
            elapsed_seconds: 0.0,
            input: InputState::default(),
            scene: ShooterScene::new(),
            camera: Camera2D::new(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT),
            world: World::default(),
            tilemap: Tilemap::default(),
            render_commands: Vec::with_capacity(256),
            audio_events: Vec::with_capacity(16),
        };
        engine.reset_to_title();
        engine
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_input(
        &mut self,
        w: bool,
        a: bool,
        s: bool,
        d: bool,
        space: bool,
        enter: bool,
        mouse_left: bool,
        mouse_x: f32,
        mouse_y: f32,
    ) {
        self.input = InputState {
            w: u8::from(w),
            a: u8::from(a),
            s: u8::from(s),
            d: u8::from(d),
            space: u8::from(space),
            enter: u8::from(enter),
            mouse_left: u8::from(mouse_left),
            mouse_x,
            mouse_y,
        };
    }

    pub fn set_texture_ids(&mut self, player: u32, enemy: u32, bullet: u32) {
        self.scene
            .set_texture_ids(&mut self.world, player, enemy, bullet);
    }

    pub fn set_sound_ids(&mut self, shoot: u32, hit: u32, game_over: u32) {
        self.scene.set_sound_ids(shoot, hit, game_over);
    }

    pub fn clear_shooter_tilemap(&mut self) {
        self.tilemap.clear();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tile(
        &mut self,
        tile_id: u32,
        texture_id: u32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
    ) {
        self.tilemap
            .set_tile_definition(tile_id, texture_id, u0, v0, u1, v1, r, g, b, a);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tilemap_layer(
        &mut self,
        index: u32,
        columns: u32,
        rows: u32,
        tile_width: f32,
        tile_height: f32,
        origin_x: f32,
        origin_y: f32,
        collision: bool,
        tiles: Vec<u32>,
    ) {
        self.tilemap.set_layer(
            index,
            columns,
            rows,
            tile_width,
            tile_height,
            origin_x,
            origin_y,
            collision,
            tiles,
        );
    }

    pub fn clear_shooter_waves(&mut self) {
        self.scene.clear_wave_configs();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_wave(
        &mut self,
        index: u32,
        duration: f32,
        spawn_interval: f32,
        enemy_count: u32,
        enemy_speed: f32,
        enemy_behavior: u32,
        enemy_spawn_pattern: u32,
        enemy_health: f32,
        score_reward: u32,
    ) {
        self.scene.set_wave_config(
            index,
            ShooterWaveConfig::from_values(
                duration,
                spawn_interval,
                enemy_count,
                enemy_speed,
                EnemyBehavior::from_code(enemy_behavior),
                EnemySpawnPattern::from_code(enemy_spawn_pattern),
                enemy_health,
                score_reward,
            ),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_audio_policy(
        &mut self,
        shoot_volume: f32,
        shoot_pitch: f32,
        hit_volume: f32,
        hit_pitch: f32,
        game_over_volume: f32,
        game_over_pitch: f32,
    ) {
        self.scene.set_audio_policy(ShooterAudioPolicy::from_values(
            shoot_volume,
            shoot_pitch,
            hit_volume,
            hit_pitch,
            game_over_volume,
            game_over_pitch,
        ));
    }

    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        self.camera.set_viewport_size(width, height);
        self.scene
            .update_camera_follow(&self.world, &mut self.camera);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_config(
        &mut self,
        world_width: f32,
        world_height: f32,
        player_speed: f32,
        enemy_speed: f32,
        enemy_spawn_interval: f32,
        bullet_speed: f32,
        fire_cooldown: f32,
        bullet_lifetime: f32,
    ) {
        self.scene.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            ShooterConfig::from_values(
                world_width,
                world_height,
                player_speed,
                enemy_speed,
                enemy_spawn_interval,
                bullet_speed,
                fire_cooldown,
                bullet_lifetime,
            ),
        );
    }

    pub fn set_shooter_prefabs(
        &mut self,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
    ) {
        self.scene.set_prefabs(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            player_width,
            player_height,
            enemy_width,
            enemy_height,
            bullet_width,
            bullet_height,
        );
    }

    pub fn set_shooter_behavior(&mut self, enemy_behavior: u32) {
        self.scene.set_enemy_behavior(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            EnemyBehavior::from_code(enemy_behavior),
        );
    }

    pub fn set_shooter_spawn_pattern(&mut self, enemy_spawn_pattern: u32) {
        self.scene.set_enemy_spawn_pattern(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            EnemySpawnPattern::from_code(enemy_spawn_pattern),
        );
    }

    pub fn set_shooter_combat(&mut self, enemy_health: f32, bullet_damage: f32, score_reward: u32) {
        self.scene.set_combat(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            enemy_health,
            bullet_damage,
            score_reward,
        );
    }

    pub fn set_shooter_camera_preset(
        &mut self,
        preset: u32,
        dead_zone_width: f32,
        dead_zone_height: f32,
        look_ahead_distance: f32,
        shake_amplitude: f32,
        shake_frequency: f32,
    ) {
        self.scene.set_camera_preset(
            &self.world,
            &mut self.camera,
            CameraPresetConfig::from_values(
                preset,
                dead_zone_width,
                dead_zone_height,
                look_ahead_distance,
                shake_amplitude,
                shake_frequency,
            ),
        );
    }

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
        self.scene.set_atlas_frame(
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
        self.scene.set_animation_states(
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
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_resolved_config(
        &mut self,
        world_width: f32,
        world_height: f32,
        player_speed: f32,
        enemy_speed: f32,
        enemy_spawn_interval: f32,
        bullet_speed: f32,
        fire_cooldown: f32,
        bullet_lifetime: f32,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
        player_animation_frame_count: u32,
        player_animation_fps: f32,
        enemy_animation_frame_count: u32,
        enemy_animation_fps: f32,
        bullet_animation_frame_count: u32,
        bullet_animation_fps: f32,
        enemy_behavior: u32,
        enemy_spawn_pattern: u32,
        enemy_health: f32,
        bullet_damage: f32,
        score_reward: u32,
    ) {
        let config = ShooterConfig::from_values(
            world_width,
            world_height,
            player_speed,
            enemy_speed,
            enemy_spawn_interval,
            bullet_speed,
            fire_cooldown,
            bullet_lifetime,
        )
        .with_prefabs(
            player_width,
            player_height,
            enemy_width,
            enemy_height,
            bullet_width,
            bullet_height,
        )
        .with_animations(
            player_animation_frame_count,
            player_animation_fps,
            enemy_animation_frame_count,
            enemy_animation_fps,
            bullet_animation_frame_count,
            bullet_animation_fps,
        )
        .with_enemy_behavior(EnemyBehavior::from_code(enemy_behavior))
        .with_enemy_spawn_pattern(EnemySpawnPattern::from_code(enemy_spawn_pattern))
        .with_combat(enemy_health, bullet_damage, score_reward);

        self.scene.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            config,
        );
    }

    pub fn update(&mut self, delta: f64) {
        let dt = delta as f32;
        self.elapsed_seconds += delta;
        self.scene.update(
            &mut self.world,
            &mut self.camera,
            self.input,
            &mut self.audio_events,
            &self.tilemap,
            dt,
        );
        self.build_render_commands();
    }

    pub fn time(&self) -> f64 {
        self.elapsed_seconds
    }

    pub fn render_command_ptr(&self) -> *const SpriteRenderCommand {
        self.render_commands.as_ptr()
    }

    pub fn render_command_len(&self) -> usize {
        self.render_commands.len()
    }

    pub fn audio_event_ptr(&self) -> *const AudioEvent {
        self.audio_events.as_ptr()
    }

    pub fn audio_event_len(&self) -> usize {
        self.audio_events.len()
    }

    pub fn clear_events(&mut self) {
        self.audio_events.clear();
    }

    pub fn score(&self) -> u32 {
        self.scene.score()
    }

    pub fn entity_count(&self) -> usize {
        self.world.alive_count()
    }

    pub fn game_state(&self) -> u32 {
        self.game_state_code()
    }

    pub fn game_state_code(&self) -> u32 {
        match self.scene.game_state() {
            GameState::Title => 0,
            GameState::Playing => 1,
            GameState::GameOver => 2,
        }
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

    pub fn reset_game(&mut self) {
        self.scene
            .reset_playing(&mut self.world, &mut self.camera, &mut self.audio_events);
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    fn reset_to_title(&mut self) {
        self.scene
            .reset_to_title(&mut self.world, &mut self.camera, &mut self.audio_events);
    }

    fn build_render_commands(&mut self) {
        self.render_commands.clear();
        self.tilemap
            .append_render_commands(&self.camera, &mut self.render_commands);
        for i in 0..self.world.transforms.len() {
            if !self.world.alive[i] {
                continue;
            }
            if let (Some(t), Some(s)) = (self.world.transforms[i], self.world.sprites[i]) {
                let screen = self.camera.world_to_screen(t);
                self.render_commands.push(SpriteRenderCommand {
                    x: screen.x - s.width * 0.5,
                    y: screen.y - s.height * 0.5,
                    width: s.width,
                    height: s.height,
                    u0: s.u0,
                    v0: s.v0,
                    u1: s.u1,
                    v1: s.v1,
                    r: s.r,
                    g: s.g,
                    b: s.b,
                    a: s.a,
                    texture_id: s.texture_id as f32,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{CollisionLayer, Transform2D};
    use crate::shooter_scene::DEFAULT_TEXTURE_ID;

    fn count_layer(engine: &Engine, layer: CollisionLayer) -> usize {
        engine
            .world
            .alive
            .iter()
            .enumerate()
            .filter(|(idx, alive)| {
                **alive && engine.world.colliders[*idx].is_some_and(|c| c.layer == layer)
            })
            .count()
    }

    #[test]
    fn reset_game_clears_score_and_recreates_player() {
        let mut engine = Engine::new();
        engine.scene.update(
            &mut engine.world,
            &mut engine.camera,
            InputState {
                space: 1,
                ..InputState::default()
            },
            &mut engine.audio_events,
            &Tilemap::default(),
            0.016,
        );
        engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

        engine.reset_game();

        assert_eq!(engine.score(), 0);
        assert!(engine.world.player.is_some());
        assert_eq!(count_layer(&engine, CollisionLayer::Player), 1);
        assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 0);
    }

    #[test]
    fn player_render_command_uses_centered_transform() {
        let mut engine = Engine::new();
        engine.build_render_commands();

        let command = engine.render_commands[0];
        assert!((command.x - 382.0).abs() < 0.01);
        assert!((command.y - 222.0).abs() < 0.01);
    }

    #[test]
    fn camera_follows_player_and_offsets_render_commands() {
        let mut engine = Engine::new();
        engine.set_viewport_size(400.0, 240.0);
        let player = engine.world.player.unwrap();
        engine.world.transforms[player.id as usize] = Some(Transform2D {
            x: 1000.0,
            y: 600.0,
        });

        engine
            .scene
            .update_camera_follow(&engine.world, &mut engine.camera);
        engine.build_render_commands();

        assert_eq!(engine.camera_x(), 1000.0);
        assert_eq!(engine.camera_y(), 600.0);
        let command = engine.render_commands[0];
        assert!((command.x - 182.0).abs() < 0.01);
        assert!((command.y - 102.0).abs() < 0.01);
    }

    #[test]
    fn configured_texture_ids_are_written_to_render_commands() {
        let mut engine = Engine::new();
        engine.set_texture_ids(1, 2, 3);
        engine.world.spawn_enemy(100.0, 100.0, 2);
        engine.world.spawn_bullet(120.0, 100.0, 0.0, 0.0, 3);
        engine.build_render_commands();

        let texture_ids: Vec<u32> = engine
            .render_commands
            .iter()
            .map(|command| command.texture_id as u32)
            .collect();
        assert!(texture_ids.contains(&1));
        assert!(texture_ids.contains(&2));
        assert!(texture_ids.contains(&3));
    }

    #[test]
    fn resolved_shooter_config_applies_all_values_with_one_call() {
        let mut engine = Engine::new();

        engine.set_shooter_resolved_config(
            3200.0, 1800.0, 240.0, 120.0, 0.75, 640.0, 0.08, 2.4, 40.0, 44.0, 30.0, 34.0, 10.0,
            12.0, 4, 12.0, 3, 9.0, 2, 18.0, 2, 2, 4.0, 2.0, 9,
        );

        let config = engine.scene.config();
        assert_eq!(config.world_width, 3200.0);
        assert_eq!(config.world_height, 1800.0);
        assert_eq!(config.player_speed, 240.0);
        assert_eq!(config.enemy_speed, 120.0);
        assert_eq!(config.enemy_spawn_interval, 0.75);
        assert_eq!(config.bullet_speed, 640.0);
        assert_eq!(config.fire_cooldown, 0.08);
        assert_eq!(config.bullet_lifetime, 2.4);
        assert_eq!(config.player_template.sprite_width, 40.0);
        assert_eq!(config.player_template.sprite_height, 44.0);
        assert_eq!(config.enemy_template.sprite_width, 30.0);
        assert_eq!(config.enemy_template.sprite_height, 34.0);
        assert_eq!(config.bullet_template.sprite_width, 10.0);
        assert_eq!(config.bullet_template.sprite_height, 12.0);
        assert_eq!(
            config.player_template.animation.unwrap().idle.frame_count,
            4
        );
        assert_eq!(
            config
                .player_template
                .animation
                .unwrap()
                .idle
                .frames_per_second,
            12.0
        );
        assert_eq!(config.enemy_template.animation.unwrap().idle.frame_count, 3);
        assert_eq!(
            config
                .enemy_template
                .animation
                .unwrap()
                .idle
                .frames_per_second,
            9.0
        );
        assert_eq!(
            config.bullet_template.animation.unwrap().idle.frame_count,
            2
        );
        assert_eq!(
            config
                .bullet_template
                .animation
                .unwrap()
                .idle
                .frames_per_second,
            18.0
        );
        assert_eq!(config.enemy_behavior, EnemyBehavior::Static);
        assert_eq!(config.enemy_spawn_pattern, EnemySpawnPattern::Center);
        assert_eq!(config.enemy_health, 4.0);
        assert_eq!(config.bullet_damage, 2.0);
        assert_eq!(config.score_reward, 9);
    }

    #[test]
    fn camera_preset_applies_without_resetting_world() {
        let mut engine = Engine::new();
        engine.set_viewport_size(400.0, 240.0);
        let player = engine.world.player.unwrap();
        engine.world.transforms[player.id as usize] = Some(Transform2D {
            x: 1000.0,
            y: 600.0,
        });
        engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

        engine.set_shooter_camera_preset(2, 160.0, 96.0, 80.0, 6.0, 8.0);

        assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
        assert_eq!(engine.camera_x(), 1000.0);
        assert_eq!(engine.camera_y(), 600.0);

        engine.world.velocities[player.id as usize] =
            Some(crate::components::Velocity { vx: 1.0, vy: 0.0 });
        engine
            .scene
            .update_camera_follow(&engine.world, &mut engine.camera);

        assert_eq!(engine.camera_x(), 1080.0);
        assert_eq!(engine.camera_y(), 600.0);
    }

    #[test]
    fn atlas_frame_updates_prefab_without_render_abi_change() {
        let mut engine = Engine::new();

        engine.set_shooter_atlas_frame(2, 9, 12.0, 10.0, 0.25, 0.5, 0.5, 0.75);
        engine.world.spawn_bullet_from_template(
            Transform2D { x: 120.0, y: 100.0 },
            crate::components::Velocity { vx: 0.0, vy: 0.0 },
            9,
            1.0,
            engine.scene.config().bullet_template,
            1.0,
        );
        engine.build_render_commands();

        let command = engine
            .render_commands
            .iter()
            .find(|command| command.texture_id == 9.0)
            .expect("bullet render command should use configured atlas texture");
        assert_eq!(command.width, 12.0);
        assert_eq!(command.height, 10.0);
        assert_eq!(command.u0, 0.25);
        assert_eq!(command.v0, 0.5);
        assert_eq!(command.u1, 0.5);
        assert_eq!(command.v1, 0.75);
        assert_eq!(crate::sprite_render_command_floats(), 13);
    }

    #[test]
    fn tilemap_render_commands_are_emitted_before_entities() {
        let mut engine = Engine::new();
        engine.set_viewport_size(1600.0, 960.0);
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 0.4, 0.5, 0.6, 0.7);
        engine.set_shooter_tilemap_layer(0, 2, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1, 0]);

        engine.build_render_commands();

        assert_eq!(engine.render_commands.len(), 2);
        let tile = engine.render_commands[0];
        assert_eq!(tile.texture_id, 9.0);
        assert_eq!(tile.width, 32.0);
        assert_eq!(tile.height, 32.0);
        assert_eq!(tile.r, 0.4);
        assert_eq!(tile.a, 0.7);
        assert!((tile.x - 0.0).abs() < 0.01);
        assert!((tile.y - 0.0).abs() < 0.01);

        let player = engine.render_commands[1];
        assert_eq!(player.texture_id, DEFAULT_TEXTURE_ID as f32);
    }

    #[test]
    fn clear_tilemap_removes_static_tile_render_commands() {
        let mut engine = Engine::new();
        engine.set_viewport_size(1600.0, 960.0);
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1]);

        engine.clear_shooter_tilemap();
        engine.build_render_commands();

        assert_eq!(engine.render_commands.len(), 1);
        assert_eq!(
            engine.render_commands[0].texture_id,
            DEFAULT_TEXTURE_ID as f32
        );
    }
}
