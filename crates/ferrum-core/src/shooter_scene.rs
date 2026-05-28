use crate::audio_event::AudioEvent;
use crate::camera::{Camera2D, CameraPresetConfig};
use crate::collision::{CollisionPair, CollisionScratch};
use crate::components::{CollisionLayer, SpriteAnimation, SpriteFrame, Transform2D};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::tilemap::TilemapNavigationScratch;
use crate::tweens::SpriteTint;
use crate::world::{EntityTemplate, EntityTemplateCollider, World};

pub(crate) const DEFAULT_TEXTURE_ID: u32 = 0;
const DEFAULT_SOUND_ID: u32 = 0;
const DEFAULT_PLAYER_SPEED: f32 = 180.0;
const DEFAULT_BULLET_SPEED: f32 = 360.0;
const DEFAULT_FIRE_COOLDOWN: f32 = 0.12;
const DEFAULT_ENEMY_SPEED: f32 = 72.0;
const DEFAULT_ENEMY_SPAWN_INTERVAL: f32 = 1.0;
const DEFAULT_BULLET_LIFETIME: f32 = 1.8;
const DEFAULT_ENEMY_HEALTH: f32 = 1.0;
const DEFAULT_BULLET_DAMAGE: f32 = 1.0;
const DEFAULT_SCORE_REWARD: u32 = 1;
const DEFAULT_WORLD_WIDTH: f32 = 1600.0;
const DEFAULT_WORLD_HEIGHT: f32 = 960.0;
const DEFAULT_SHOOT_VOLUME: f32 = 0.35;
const DEFAULT_HIT_VOLUME: f32 = 0.45;
const DEFAULT_GAME_OVER_VOLUME: f32 = 0.65;
const DEFAULT_SOUND_PITCH: f32 = 1.0;
const NAVIGATION_REPATH_INTERVAL: f32 = 0.25;
const NAVIGATION_TARGET_REACHED_DISTANCE_SQUARED: f32 = 4.0;
pub const SHOOTER_SNAPSHOT_VERSION: u32 = 1;
pub const SHOOTER_SNAPSHOT_HEADER_FLOATS: usize = 6;
pub const SHOOTER_SNAPSHOT_HEADER_U32S: usize = 8;
pub const SHOOTER_SNAPSHOT_ENTITY_FLOATS: usize = 7;
pub const SHOOTER_SNAPSHOT_ENTITY_U32S: usize = 2;
pub const SHOOTER_SNAPSHOT_ENTITY_PLAYER: u32 = 0;
pub const SHOOTER_SNAPSHOT_ENTITY_ENEMY: u32 = 1;
pub const SHOOTER_SNAPSHOT_ENTITY_BULLET: u32 = 2;
const DEFAULT_ORBIT_RADIUS: f32 = 180.0;
const DEFAULT_ORBIT_RADIAL_BAND: f32 = 24.0;
const ENEMY_HIT_FLASH_TINT: SpriteTint = SpriteTint::new(1.0, 0.88, 0.38, 1.0);
const ENEMY_HIT_FLASH_SECONDS: f32 = 0.12;

mod config;
mod runtime;
mod snapshot;

use config::{
    finite_or_default, non_negative_or_default, positive_or_default, sprite_frames_from_values,
    SoundIds, TextureIds,
};
pub(crate) use config::{
    EnemyBehavior, EnemySpawnPattern, ShooterAudioPolicy, ShooterConfig, ShooterPrefabKind,
    ShooterWaveConfig,
};
use runtime::NavigationTargetCache;
pub(crate) use runtime::{ParticleBurstSink, TweenSink};
pub use snapshot::{ShooterEntitySnapshot, ShooterSceneSnapshot};

fn has_reached_navigation_target(from: Transform2D, to: Transform2D) -> bool {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    dx * dx + dy * dy <= NAVIGATION_TARGET_REACHED_DISTANCE_SQUARED
}

#[derive(Debug)]
pub struct ShooterScene {
    score: u32,
    fire_cooldown_seconds: f32,
    enemy_spawn_timer: f32,
    previous_space: u8,
    previous_enter: u8,
    game_state: GameState,
    spawn_index: u32,
    texture_ids: TextureIds,
    sound_ids: SoundIds,
    config: ShooterConfig,
    waves: Vec<ShooterWaveConfig>,
    active_wave_index: usize,
    wave_elapsed_seconds: f32,
    wave_spawned_count: u32,
    camera_elapsed_seconds: f32,
    navigation_targets: Vec<Option<NavigationTargetCache>>,
    navigation_scratch: TilemapNavigationScratch,
    collision_scratch: CollisionScratch,
    collision_pairs: Vec<CollisionPair>,
    pending_despawn: Vec<Entity>,
    marked_for_despawn: Vec<bool>,
}

impl Default for ShooterScene {
    fn default() -> Self {
        Self {
            score: 0,
            fire_cooldown_seconds: 0.0,
            enemy_spawn_timer: DEFAULT_ENEMY_SPAWN_INTERVAL,
            previous_space: 0,
            previous_enter: 0,
            game_state: GameState::Title,
            spawn_index: 0,
            texture_ids: TextureIds::default(),
            sound_ids: SoundIds::default(),
            config: ShooterConfig::default(),
            waves: Vec::new(),
            active_wave_index: 0,
            wave_elapsed_seconds: 0.0,
            wave_spawned_count: 0,
            camera_elapsed_seconds: 0.0,
            navigation_targets: Vec::with_capacity(256),
            navigation_scratch: TilemapNavigationScratch::default(),
            collision_scratch: CollisionScratch::default(),
            collision_pairs: Vec::with_capacity(256),
            pending_despawn: Vec::with_capacity(128),
            marked_for_despawn: Vec::with_capacity(256),
        }
    }
}

impl ShooterScene {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset_to_title(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        self.reset_playing(world, camera, audio_events);
        self.game_state = GameState::Title;
    }

    pub fn reset_playing(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        self.score = 0;
        self.fire_cooldown_seconds = 0.0;
        self.enemy_spawn_timer = self.config.enemy_spawn_interval;
        self.previous_space = 0;
        self.previous_enter = 0;
        self.spawn_index = 0;
        self.reset_wave_state();
        self.camera_elapsed_seconds = 0.0;
        self.navigation_targets.clear();
        audio_events.clear();
        *world = World::default();
        world.spawn_player_from_template(
            self.config.world_width * 0.5,
            self.config.world_height * 0.5,
            self.texture_ids.player,
            self.config.player_template,
        );
        self.update_camera_follow(world, camera);
    }

    pub fn set_texture_ids(&mut self, world: &mut World, player: u32, enemy: u32, bullet: u32) {
        self.texture_ids = TextureIds {
            player,
            enemy,
            bullet,
        };
        self.apply_texture_ids_to_existing_sprites(world);
    }

    pub fn set_sound_ids(&mut self, shoot: u32, hit: u32, game_over: u32) {
        self.sound_ids = SoundIds {
            shoot,
            hit,
            game_over,
        };
    }

    pub fn set_config(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
        config: ShooterConfig,
    ) {
        let game_state = self.game_state;
        self.config = config;
        self.reset_playing(world, camera, audio_events);
        self.game_state = game_state;
    }

    pub fn clear_wave_configs(&mut self) {
        self.waves.clear();
        self.reset_wave_state();
    }

    pub fn set_wave_config(&mut self, index: u32, wave: ShooterWaveConfig) {
        let index = index as usize;
        if index >= self.waves.len() {
            self.waves.resize(index + 1, wave);
        }
        self.waves[index] = wave;
        self.reset_wave_state();
    }

    pub fn set_audio_policy(&mut self, audio_policy: ShooterAudioPolicy) {
        self.config = self.config.with_audio_policy(audio_policy);
    }

    pub fn set_enemy_behavior(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
        behavior: EnemyBehavior,
    ) {
        let next = self.config.with_enemy_behavior(behavior);
        self.set_config(world, camera, audio_events, next);
    }

    pub fn set_enemy_spawn_pattern(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
        pattern: EnemySpawnPattern,
    ) {
        let next = self.config.with_enemy_spawn_pattern(pattern);
        self.set_config(world, camera, audio_events, next);
    }

    pub fn set_combat(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
        enemy_health: f32,
        bullet_damage: f32,
        score_reward: u32,
    ) {
        let next = self
            .config
            .with_combat(enemy_health, bullet_damage, score_reward);
        self.set_config(world, camera, audio_events, next);
    }

    pub fn set_camera_preset(
        &mut self,
        world: &World,
        camera: &mut Camera2D,
        camera_preset: CameraPresetConfig,
    ) {
        self.config = self.config.with_camera(camera_preset);
        self.update_camera_follow(world, camera);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_atlas_frame(
        &mut self,
        world: &mut World,
        prefab_code: u32,
        texture_id: u32,
        width: f32,
        height: f32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
    ) {
        let Some(prefab) = ShooterPrefabKind::from_code(prefab_code) else {
            return;
        };
        if !width.is_finite() || width <= 0.0 || !height.is_finite() || height <= 0.0 {
            return;
        }
        let Some(frame) = SpriteFrame::from_values(u0, v0, u1, v1) else {
            return;
        };
        let template = EntityTemplate::new(width, height).with_frame(width, height, frame);

        match prefab {
            ShooterPrefabKind::Player => {
                self.texture_ids.player = texture_id;
                self.config.player_template = template;
                self.apply_template_to_existing_layer(
                    world,
                    CollisionLayer::Player,
                    texture_id,
                    template,
                );
            }
            ShooterPrefabKind::Enemy => {
                self.texture_ids.enemy = texture_id;
                self.config.enemy_template = template;
                self.apply_template_to_existing_layer(
                    world,
                    CollisionLayer::Enemy,
                    texture_id,
                    template,
                );
            }
            ShooterPrefabKind::Bullet => {
                self.texture_ids.bullet = texture_id;
                self.config.bullet_template = template;
                self.apply_template_to_existing_layer(
                    world,
                    CollisionLayer::Bullet,
                    texture_id,
                    template,
                );
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_atlas_animation(
        &mut self,
        world: &mut World,
        prefab_code: u32,
        texture_id: u32,
        width: f32,
        height: f32,
        idle_fps: f32,
        idle_frames: &[f32],
        move_fps: f32,
        move_frames: &[f32],
    ) {
        let Some(prefab) = ShooterPrefabKind::from_code(prefab_code) else {
            return;
        };
        if !width.is_finite() || width <= 0.0 || !height.is_finite() || height <= 0.0 {
            return;
        }
        let Some(idle) = sprite_frames_from_values(idle_frames) else {
            return;
        };
        let moving = sprite_frames_from_values(move_frames).unwrap_or_else(|| idle.clone());
        let Some(animation) = SpriteAnimation::atlas(&idle, idle_fps, &moving, move_fps) else {
            return;
        };
        let template = EntityTemplate::new(width, height)
            .with_frame_animation(width, height, idle[0], animation);

        match prefab {
            ShooterPrefabKind::Player => {
                self.texture_ids.player = texture_id;
                self.config.player_template = template;
                self.apply_template_to_existing_layer(
                    world,
                    CollisionLayer::Player,
                    texture_id,
                    template,
                );
            }
            ShooterPrefabKind::Enemy => {
                self.texture_ids.enemy = texture_id;
                self.config.enemy_template = template;
                self.apply_template_to_existing_layer(
                    world,
                    CollisionLayer::Enemy,
                    texture_id,
                    template,
                );
            }
            ShooterPrefabKind::Bullet => {
                self.texture_ids.bullet = texture_id;
                self.config.bullet_template = template;
                self.apply_template_to_existing_layer(
                    world,
                    CollisionLayer::Bullet,
                    texture_id,
                    template,
                );
            }
        }
    }

    pub fn set_prefab_collider(
        &mut self,
        world: &mut World,
        prefab_code: u32,
        collider: EntityTemplateCollider,
    ) -> bool {
        let Some(prefab) = ShooterPrefabKind::from_code(prefab_code) else {
            return false;
        };
        self.config = self.config.with_prefab_collider(prefab, collider);
        match prefab {
            ShooterPrefabKind::Player => self.apply_template_to_existing_layer(
                world,
                CollisionLayer::Player,
                self.texture_ids.player,
                self.config.player_template,
            ),
            ShooterPrefabKind::Enemy => self.apply_template_to_existing_layer(
                world,
                CollisionLayer::Enemy,
                self.texture_ids.enemy,
                self.config.enemy_template,
            ),
            ShooterPrefabKind::Bullet => self.apply_template_to_existing_layer(
                world,
                CollisionLayer::Bullet,
                self.texture_ids.bullet,
                self.config.bullet_template,
            ),
        }
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_prefabs(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
    ) {
        let next = self.config.with_prefabs(
            player_width,
            player_height,
            enemy_width,
            enemy_height,
            bullet_width,
            bullet_height,
        );
        self.set_config(world, camera, audio_events, next);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_animation_states(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
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
        let next = self.config.with_animation_states(
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
        self.set_config(world, camera, audio_events, next);
    }

    pub fn score(&self) -> u32 {
        self.score
    }

    pub fn game_state(&self) -> GameState {
        self.game_state
    }

    #[cfg(test)]
    pub(crate) fn config(&self) -> ShooterConfig {
        self.config
    }

    pub fn update_camera_follow(&self, world: &World, camera: &mut Camera2D) {
        let Some(player) = world.player else {
            return;
        };
        let Some(player_t) = world.transforms[player.id as usize] else {
            return;
        };
        let player_velocity = world.velocities[player.id as usize].unwrap_or_default();
        camera.apply_preset(
            player_t,
            player_velocity,
            self.config.world_width,
            self.config.world_height,
            self.config.camera,
            self.camera_elapsed_seconds,
        );
    }

    fn apply_texture_ids_to_existing_sprites(&self, world: &mut World) {
        for i in 0..world.sprites.len() {
            let Some(layer) = world.collider_layer_at(i) else {
                continue;
            };
            let Some(sprite) = world.sprites[i].as_mut() else {
                continue;
            };
            sprite.texture_id = match layer {
                CollisionLayer::Player => self.texture_ids.player,
                CollisionLayer::Enemy => self.texture_ids.enemy,
                CollisionLayer::Bullet => self.texture_ids.bullet,
                CollisionLayer::Wall => sprite.texture_id,
            };
        }
    }

    fn apply_template_to_existing_layer(
        &self,
        world: &mut World,
        layer: CollisionLayer,
        texture_id: u32,
        template: EntityTemplate,
    ) {
        for i in 0..world.alive.len() {
            if world.collider_layer_at(i) != Some(layer) {
                continue;
            }
            world.apply_template_to_entity(
                Entity {
                    id: i as u32,
                    generation: world.generations[i],
                },
                texture_id,
                template,
            );
        }
    }
}

#[cfg(test)]
mod tests;
