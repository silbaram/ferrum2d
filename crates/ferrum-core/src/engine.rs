use wasm_bindgen::prelude::*;

use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::render_command::SpriteRenderCommand;
use crate::shooter_scene::{EnemyBehavior, EnemySpawnPattern, ShooterConfig, ShooterScene};
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
            12.0, 2, 2, 4.0, 2.0, 9,
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
        assert_eq!(config.enemy_behavior, EnemyBehavior::Static);
        assert_eq!(config.enemy_spawn_pattern, EnemySpawnPattern::Center);
        assert_eq!(config.enemy_health, 4.0);
        assert_eq!(config.bullet_damage, 2.0);
        assert_eq!(config.score_reward, 9);
    }
}
