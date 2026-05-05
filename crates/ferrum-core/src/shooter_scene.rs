use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::collision::CollisionSystem;
use crate::components::{
    CollisionLayer, SpriteAnimation, SpriteAnimationState, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::physics::{PhysicsBounds, PhysicsSystem};
use crate::world::{
    EntityTemplate, World, DEFAULT_BULLET_TEMPLATE, DEFAULT_ENEMY_TEMPLATE, DEFAULT_PLAYER_TEMPLATE,
};

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
const SHOOT_VOLUME: f32 = 0.35;
const HIT_VOLUME: f32 = 0.45;
const GAME_OVER_VOLUME: f32 = 0.65;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum EnemyBehavior {
    #[default]
    Chase,
    Drift,
    Static,
}

impl EnemyBehavior {
    pub fn from_code(code: u32) -> Self {
        match code {
            1 => Self::Drift,
            2 => Self::Static,
            _ => Self::Chase,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum EnemySpawnPattern {
    #[default]
    Edge,
    Corners,
    Center,
}

impl EnemySpawnPattern {
    pub fn from_code(code: u32) -> Self {
        match code {
            1 => Self::Corners,
            2 => Self::Center,
            _ => Self::Edge,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ShooterConfig {
    pub world_width: f32,
    pub world_height: f32,
    pub player_speed: f32,
    pub enemy_speed: f32,
    pub enemy_spawn_interval: f32,
    pub bullet_speed: f32,
    pub fire_cooldown: f32,
    pub bullet_lifetime: f32,
    pub player_template: EntityTemplate,
    pub enemy_template: EntityTemplate,
    pub bullet_template: EntityTemplate,
    pub enemy_behavior: EnemyBehavior,
    pub enemy_spawn_pattern: EnemySpawnPattern,
    pub enemy_health: f32,
    pub bullet_damage: f32,
    pub score_reward: u32,
}

impl Default for ShooterConfig {
    fn default() -> Self {
        Self {
            world_width: DEFAULT_WORLD_WIDTH,
            world_height: DEFAULT_WORLD_HEIGHT,
            player_speed: DEFAULT_PLAYER_SPEED,
            enemy_speed: DEFAULT_ENEMY_SPEED,
            enemy_spawn_interval: DEFAULT_ENEMY_SPAWN_INTERVAL,
            bullet_speed: DEFAULT_BULLET_SPEED,
            fire_cooldown: DEFAULT_FIRE_COOLDOWN,
            bullet_lifetime: DEFAULT_BULLET_LIFETIME,
            player_template: DEFAULT_PLAYER_TEMPLATE,
            enemy_template: DEFAULT_ENEMY_TEMPLATE,
            bullet_template: DEFAULT_BULLET_TEMPLATE,
            enemy_behavior: EnemyBehavior::default(),
            enemy_spawn_pattern: EnemySpawnPattern::default(),
            enemy_health: DEFAULT_ENEMY_HEALTH,
            bullet_damage: DEFAULT_BULLET_DAMAGE,
            score_reward: DEFAULT_SCORE_REWARD,
        }
    }
}

impl ShooterConfig {
    #[allow(clippy::too_many_arguments)]
    pub fn from_values(
        world_width: f32,
        world_height: f32,
        player_speed: f32,
        enemy_speed: f32,
        enemy_spawn_interval: f32,
        bullet_speed: f32,
        fire_cooldown: f32,
        bullet_lifetime: f32,
    ) -> Self {
        Self {
            world_width: positive_or_default(world_width, DEFAULT_WORLD_WIDTH),
            world_height: positive_or_default(world_height, DEFAULT_WORLD_HEIGHT),
            player_speed: positive_or_default(player_speed, DEFAULT_PLAYER_SPEED),
            enemy_speed: positive_or_default(enemy_speed, DEFAULT_ENEMY_SPEED),
            enemy_spawn_interval: positive_or_default(
                enemy_spawn_interval,
                DEFAULT_ENEMY_SPAWN_INTERVAL,
            ),
            bullet_speed: positive_or_default(bullet_speed, DEFAULT_BULLET_SPEED),
            fire_cooldown: positive_or_default(fire_cooldown, DEFAULT_FIRE_COOLDOWN),
            bullet_lifetime: positive_or_default(bullet_lifetime, DEFAULT_BULLET_LIFETIME),
            ..Self::default()
        }
    }

    pub fn with_prefabs(
        mut self,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
    ) -> Self {
        self.player_template =
            template_or_default(player_width, player_height, DEFAULT_PLAYER_TEMPLATE);
        self.enemy_template =
            template_or_default(enemy_width, enemy_height, DEFAULT_ENEMY_TEMPLATE);
        self.bullet_template =
            template_or_default(bullet_width, bullet_height, DEFAULT_BULLET_TEMPLATE);
        self
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_animations(
        mut self,
        player_frame_count: u32,
        player_fps: f32,
        enemy_frame_count: u32,
        enemy_fps: f32,
        bullet_frame_count: u32,
        bullet_fps: f32,
    ) -> Self {
        self.player_template =
            apply_animation_or_default(self.player_template, player_frame_count, player_fps);
        self.enemy_template =
            apply_animation_or_default(self.enemy_template, enemy_frame_count, enemy_fps);
        self.bullet_template =
            apply_animation_or_default(self.bullet_template, bullet_frame_count, bullet_fps);
        self
    }

    #[allow(clippy::too_many_arguments)]
    pub fn with_animation_states(
        mut self,
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
    ) -> Self {
        self.player_template =
            self.player_template
                .with_sprite_animation(sprite_animation_or_none(
                    player_columns,
                    player_rows,
                    player_idle_row,
                    player_idle_frames,
                    player_idle_fps,
                    player_move_row,
                    player_move_frames,
                    player_move_fps,
                ));
        self.enemy_template = self
            .enemy_template
            .with_sprite_animation(sprite_animation_or_none(
                enemy_columns,
                enemy_rows,
                enemy_idle_row,
                enemy_idle_frames,
                enemy_idle_fps,
                enemy_move_row,
                enemy_move_frames,
                enemy_move_fps,
            ));
        self.bullet_template =
            self.bullet_template
                .with_sprite_animation(sprite_animation_or_none(
                    bullet_columns,
                    bullet_rows,
                    bullet_idle_row,
                    bullet_idle_frames,
                    bullet_idle_fps,
                    bullet_move_row,
                    bullet_move_frames,
                    bullet_move_fps,
                ));
        self
    }

    pub fn with_enemy_behavior(mut self, behavior: EnemyBehavior) -> Self {
        self.enemy_behavior = behavior;
        self
    }

    pub fn with_enemy_spawn_pattern(mut self, pattern: EnemySpawnPattern) -> Self {
        self.enemy_spawn_pattern = pattern;
        self
    }

    pub fn with_combat(mut self, enemy_health: f32, bullet_damage: f32, score_reward: u32) -> Self {
        self.enemy_health = positive_or_default(enemy_health, DEFAULT_ENEMY_HEALTH);
        self.bullet_damage = positive_or_default(bullet_damage, DEFAULT_BULLET_DAMAGE);
        self.score_reward = if score_reward > 0 {
            score_reward
        } else {
            DEFAULT_SCORE_REWARD
        };
        self
    }
}

fn positive_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        default
    }
}

fn template_or_default(width: f32, height: f32, default: EntityTemplate) -> EntityTemplate {
    EntityTemplate::new(
        positive_or_default(width, default.sprite_width),
        positive_or_default(height, default.sprite_height),
    )
}

fn apply_animation_or_default(
    template: EntityTemplate,
    frame_count: u32,
    fps: f32,
) -> EntityTemplate {
    if frame_count <= 1 || !fps.is_finite() || fps <= 0.0 {
        return template;
    }

    template.with_animation(frame_count, fps)
}

#[allow(clippy::too_many_arguments)]
fn sprite_animation_or_none(
    columns: u32,
    rows: u32,
    idle_row: u32,
    idle_frames: u32,
    idle_fps: f32,
    move_row: u32,
    move_frames: u32,
    move_fps: f32,
) -> Option<SpriteAnimation> {
    SpriteAnimation::new(
        columns,
        rows,
        SpriteAnimationState {
            row: idle_row,
            frame_count: idle_frames,
            frames_per_second: idle_fps,
        },
        SpriteAnimationState {
            row: move_row,
            frame_count: move_frames,
            frames_per_second: move_fps,
        },
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextureIds {
    player: u32,
    enemy: u32,
    bullet: u32,
}

impl Default for TextureIds {
    fn default() -> Self {
        Self {
            player: DEFAULT_TEXTURE_ID,
            enemy: DEFAULT_TEXTURE_ID,
            bullet: DEFAULT_TEXTURE_ID,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SoundIds {
    shoot: u32,
    hit: u32,
    game_over: u32,
}

impl Default for SoundIds {
    fn default() -> Self {
        Self {
            shoot: DEFAULT_SOUND_ID,
            hit: DEFAULT_SOUND_ID,
            game_over: DEFAULT_SOUND_ID,
        }
    }
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
            pending_despawn: Vec::with_capacity(128),
            marked_for_despawn: Vec::with_capacity(256),
        }
    }
}

impl ShooterScene {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
    ) {
        let space_pressed = input.space == 1 && self.previous_space == 0;
        let enter_pressed = input.enter == 1 && self.previous_enter == 0;

        match self.game_state {
            GameState::Title => {
                if space_pressed || enter_pressed {
                    self.game_state = GameState::Playing;
                }
            }
            GameState::GameOver => {
                if space_pressed {
                    self.reset_playing(world, camera, audio_events);
                    self.game_state = GameState::Playing;
                }
            }
            GameState::Playing => {
                self.tick_playing_timers(delta);
                self.apply_player_input(world, camera, input, audio_events);
                self.update_enemy_velocity(world);
                world.update(delta);
                self.clamp_player_to_world(world);
                self.update_camera_follow(world, camera);
                self.update_bullets(world, delta);
                self.spawn_enemy_if_needed(world);
                self.handle_collisions(world, audio_events);
            }
        }

        self.previous_space = input.space;
        self.previous_enter = input.enter;
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
        camera.follow(player_t, self.config.world_width, self.config.world_height);
    }

    fn tick_playing_timers(&mut self, delta: f32) {
        if self.fire_cooldown_seconds > 0.0 {
            self.fire_cooldown_seconds = (self.fire_cooldown_seconds - delta).max(0.0);
        }
        if self.enemy_spawn_timer > 0.0 {
            self.enemy_spawn_timer -= delta;
        }
    }

    fn normalized_input_direction(input: InputState) -> Velocity {
        let mut x: f32 = 0.0;
        let mut y: f32 = 0.0;
        if input.w == 1 {
            y -= 1.0;
        }
        if input.s == 1 {
            y += 1.0;
        }
        if input.a == 1 {
            x -= 1.0;
        }
        if input.d == 1 {
            x += 1.0;
        }
        let len = (x * x + y * y).sqrt();
        if len > 0.0 {
            Velocity {
                vx: x / len,
                vy: y / len,
            }
        } else {
            Velocity::default()
        }
    }

    fn apply_player_input(
        &mut self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let dir = Self::normalized_input_direction(input);
        world.velocities[player.id as usize] = Some(Velocity {
            vx: dir.vx * self.config.player_speed,
            vy: dir.vy * self.config.player_speed,
        });
        let wants_fire = input.space == 1 || input.mouse_left == 1;
        if wants_fire && self.fire_cooldown_seconds <= 0.0 {
            self.fire_bullet_toward_mouse(world, camera, input, player, audio_events);
            self.fire_cooldown_seconds = self.config.fire_cooldown;
        }
    }

    fn fire_bullet_toward_mouse(
        &self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        player: Entity,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        let Some(player_t) = world.transforms[player.id as usize] else {
            return;
        };
        let target = camera.screen_to_world(Transform2D {
            x: input.mouse_x,
            y: input.mouse_y,
        });
        let dx = target.x - player_t.x;
        let dy = target.y - player_t.y;
        let len = (dx * dx + dy * dy).sqrt();
        let (nx, ny) = if len > 0.0001 {
            (dx / len, dy / len)
        } else {
            (1.0, 0.0)
        };
        let spawn_offset = self
            .config
            .player_template
            .sprite_width
            .max(self.config.player_template.sprite_height)
            * 0.5
            + self
                .config
                .bullet_template
                .sprite_width
                .max(self.config.bullet_template.sprite_height)
                * 0.5;
        world.spawn_bullet_from_template(
            Transform2D {
                x: player_t.x + nx * spawn_offset,
                y: player_t.y + ny * spawn_offset,
            },
            Velocity {
                vx: nx * self.config.bullet_speed,
                vy: ny * self.config.bullet_speed,
            },
            self.texture_ids.bullet,
            self.config.bullet_lifetime,
            self.config.bullet_template,
            self.config.bullet_damage,
        );
        self.push_audio_event(audio_events, self.sound_ids.shoot, SHOOT_VOLUME, 1.0);
    }

    fn clamp_player_to_world(&self, world: &mut World) {
        let Some(player) = world.player else {
            return;
        };
        PhysicsSystem::clamp_entity_to_bounds(
            world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: self.config.world_width,
                max_y: self.config.world_height,
            },
        );
    }

    fn update_enemy_velocity(&self, world: &mut World) {
        let player_t = world
            .player
            .and_then(|player| world.transforms[player.id as usize]);
        for i in 0..world.transforms.len() {
            if !world.alive[i] {
                continue;
            }
            let Some(collider) = world.colliders[i] else {
                continue;
            };
            if collider.layer != CollisionLayer::Enemy {
                continue;
            }
            let Some(enemy_t) = world.transforms[i] else {
                continue;
            };
            world.velocities[i] = Some(self.enemy_velocity(enemy_t, player_t));
        }
    }

    fn enemy_velocity(&self, enemy_t: Transform2D, player_t: Option<Transform2D>) -> Velocity {
        match self.config.enemy_behavior {
            EnemyBehavior::Chase => {
                let Some(player_t) = player_t else {
                    return Velocity::default();
                };
                self.velocity_toward(enemy_t, player_t)
            }
            EnemyBehavior::Drift => self.velocity_toward(
                enemy_t,
                Transform2D {
                    x: self.config.world_width * 0.5,
                    y: self.config.world_height * 0.5,
                },
            ),
            EnemyBehavior::Static => Velocity::default(),
        }
    }

    fn velocity_toward(&self, from: Transform2D, to: Transform2D) -> Velocity {
        let dx = to.x - from.x;
        let dy = to.y - from.y;
        let len = (dx * dx + dy * dy).sqrt();
        if len > 0.0001 {
            Velocity {
                vx: dx / len * self.config.enemy_speed,
                vy: dy / len * self.config.enemy_speed,
            }
        } else {
            Velocity::default()
        }
    }

    fn update_bullets(&mut self, world: &mut World, delta: f32) {
        self.pending_despawn.clear();
        for i in 0..world.transforms.len() {
            if !world.alive[i] {
                continue;
            }
            if let Some(time_left) = world.bullet_lifetimes[i].as_mut() {
                *time_left -= delta;
            }
            let is_bullet = world.colliders[i]
                .map(|c| c.layer == CollisionLayer::Bullet)
                .unwrap_or(false);
            if !is_bullet {
                continue;
            }
            if world.bullet_lifetimes[i].is_some_and(|t| t <= 0.0) {
                self.pending_despawn.push(Entity {
                    id: i as u32,
                    generation: world.generations[i],
                });
                continue;
            }
            if let Some(t) = world.transforms[i] {
                if t.x < -20.0
                    || t.x > self.config.world_width + 20.0
                    || t.y < -20.0
                    || t.y > self.config.world_height + 20.0
                {
                    self.pending_despawn.push(Entity {
                        id: i as u32,
                        generation: world.generations[i],
                    });
                }
            }
        }
        for e in self.pending_despawn.drain(..) {
            world.despawn(e);
        }
    }

    fn spawn_enemy_if_needed(&mut self, world: &mut World) {
        if self.enemy_spawn_timer > 0.0 {
            return;
        }
        self.enemy_spawn_timer = self.config.enemy_spawn_interval;
        let idx = self.spawn_index;
        self.spawn_index = self.spawn_index.wrapping_add(1);
        let (x, y) = self.enemy_spawn_position(idx);
        world.spawn_enemy_from_template(
            x,
            y,
            self.texture_ids.enemy,
            self.config.enemy_template,
            self.config.enemy_health,
            self.config.score_reward,
        );
    }

    fn enemy_spawn_position(&self, idx: u32) -> (f32, f32) {
        match self.config.enemy_spawn_pattern {
            EnemySpawnPattern::Edge => self.edge_spawn_position(idx),
            EnemySpawnPattern::Corners => self.corner_spawn_position(idx),
            EnemySpawnPattern::Center => (
                self.config.world_width * 0.5,
                self.config.world_height * 0.5,
            ),
        }
    }

    fn edge_spawn_position(&self, idx: u32) -> (f32, f32) {
        let lane = (idx % 6) as f32;
        match idx % 4 {
            0 => (lane * (self.config.world_width / 5.0), 0.0),
            1 => (
                self.config.world_width,
                lane * (self.config.world_height / 5.0),
            ),
            2 => (
                lane * (self.config.world_width / 5.0),
                self.config.world_height,
            ),
            _ => (0.0, lane * (self.config.world_height / 5.0)),
        }
    }

    fn corner_spawn_position(&self, idx: u32) -> (f32, f32) {
        match idx % 4 {
            0 => (0.0, 0.0),
            1 => (self.config.world_width, 0.0),
            2 => (self.config.world_width, self.config.world_height),
            _ => (0.0, self.config.world_height),
        }
    }

    fn apply_texture_ids_to_existing_sprites(&self, world: &mut World) {
        for i in 0..world.sprites.len() {
            let Some(collider) = world.colliders[i] else {
                continue;
            };
            let Some(sprite) = world.sprites[i].as_mut() else {
                continue;
            };
            sprite.texture_id = match collider.layer {
                CollisionLayer::Player => self.texture_ids.player,
                CollisionLayer::Enemy => self.texture_ids.enemy,
                CollisionLayer::Bullet => self.texture_ids.bullet,
            };
        }
    }

    fn push_audio_event(
        &self,
        audio_events: &mut Vec<AudioEvent>,
        sound_id: u32,
        volume: f32,
        pitch: f32,
    ) {
        if sound_id == DEFAULT_SOUND_ID {
            return;
        }

        audio_events.push(AudioEvent {
            sound_id: sound_id as f32,
            volume,
            pitch,
        });
    }

    fn handle_collisions(&mut self, world: &mut World, audio_events: &mut Vec<AudioEvent>) {
        self.prepare_collision_scratch(world.alive.len());
        self.handle_bullet_enemy_collisions(world, audio_events);
        self.handle_player_enemy_collisions(world, audio_events);

        for e in self.pending_despawn.drain(..) {
            world.despawn(e);
        }
    }

    fn prepare_collision_scratch(&mut self, alive_len: usize) {
        self.pending_despawn.clear();
        self.marked_for_despawn.clear();
        self.marked_for_despawn.resize(alive_len, false);
    }

    fn handle_bullet_enemy_collisions(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        for bullet_index in 0..world.alive.len() {
            if !self.is_alive_layer(world, bullet_index, CollisionLayer::Bullet)
                || self.marked_for_despawn[bullet_index]
            {
                continue;
            }
            let Some(bullet_transform) = world.transforms[bullet_index] else {
                continue;
            };
            let Some(bullet_collider) = world.colliders[bullet_index] else {
                continue;
            };

            for enemy_index in 0..world.alive.len() {
                if !self.is_alive_layer(world, enemy_index, CollisionLayer::Enemy)
                    || self.marked_for_despawn[enemy_index]
                {
                    continue;
                }
                let Some(enemy_transform) = world.transforms[enemy_index] else {
                    continue;
                };
                let Some(enemy_collider) = world.colliders[enemy_index] else {
                    continue;
                };
                if !CollisionSystem::overlaps(
                    bullet_transform,
                    bullet_collider,
                    enemy_transform,
                    enemy_collider,
                ) {
                    continue;
                }

                self.marked_for_despawn[bullet_index] = true;
                self.pending_despawn.push(Entity {
                    id: bullet_index as u32,
                    generation: world.generations[bullet_index],
                });
                let damage = world.damages[bullet_index].unwrap_or(DEFAULT_BULLET_DAMAGE);
                let health = world.healths[enemy_index].get_or_insert(DEFAULT_ENEMY_HEALTH);
                *health -= damage;
                if *health <= 0.0 {
                    self.marked_for_despawn[enemy_index] = true;
                    self.pending_despawn.push(Entity {
                        id: enemy_index as u32,
                        generation: world.generations[enemy_index],
                    });
                    let reward = world.score_rewards[enemy_index].unwrap_or(DEFAULT_SCORE_REWARD);
                    self.score = self.score.saturating_add(reward);
                }
                self.push_audio_event(audio_events, self.sound_ids.hit, HIT_VOLUME, 1.0);
                break;
            }
        }
    }

    fn handle_player_enemy_collisions(
        &mut self,
        world: &World,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let player_index = player.id as usize;
        if !self.is_alive_layer(world, player_index, CollisionLayer::Player)
            || self.marked_for_despawn[player_index]
        {
            return;
        }
        let Some(player_transform) = world.transforms[player_index] else {
            return;
        };
        let Some(player_collider) = world.colliders[player_index] else {
            return;
        };

        for enemy_index in 0..world.alive.len() {
            if !self.is_alive_layer(world, enemy_index, CollisionLayer::Enemy)
                || self.marked_for_despawn[enemy_index]
            {
                continue;
            }
            let Some(enemy_transform) = world.transforms[enemy_index] else {
                continue;
            };
            let Some(enemy_collider) = world.colliders[enemy_index] else {
                continue;
            };
            if CollisionSystem::overlaps(
                player_transform,
                player_collider,
                enemy_transform,
                enemy_collider,
            ) {
                if self.game_state != GameState::GameOver {
                    self.game_state = GameState::GameOver;
                    self.push_audio_event(
                        audio_events,
                        self.sound_ids.game_over,
                        GAME_OVER_VOLUME,
                        0.9,
                    );
                }
                break;
            }
        }
    }

    fn is_alive_layer(&self, world: &World, index: usize, layer: CollisionLayer) -> bool {
        world.alive.get(index).copied().unwrap_or(false)
            && world.colliders[index].is_some_and(|collider| collider.layer == layer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playing_scene() -> (ShooterScene, World, Camera2D, Vec<AudioEvent>) {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut audio_events = Vec::new();
        scene.reset_playing(&mut world, &mut camera, &mut audio_events);
        scene.game_state = GameState::Playing;
        (scene, world, camera, audio_events)
    }

    fn count_layer(world: &World, layer: CollisionLayer) -> usize {
        world
            .alive
            .iter()
            .enumerate()
            .filter(|(idx, alive)| {
                **alive && world.colliders[*idx].is_some_and(|c| c.layer == layer)
            })
            .count()
    }

    #[test]
    fn diagonal_movement_is_normalized() {
        let (mut scene, mut world, camera, mut audio_events) = playing_scene();
        let input = InputState {
            w: 1,
            d: 1,
            ..InputState::default()
        };

        scene.apply_player_input(&mut world, &camera, input, &mut audio_events);

        let player = world.player.unwrap();
        let v = world.velocities[player.id as usize].unwrap();
        let speed = (v.vx * v.vx + v.vy * v.vy).sqrt();
        assert!((speed - DEFAULT_PLAYER_SPEED).abs() < 0.01);
    }

    #[test]
    fn title_enters_playing_with_enter_or_space() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut audio_events = Vec::new();
        scene.reset_to_title(&mut world, &mut camera, &mut audio_events);

        scene.update(
            &mut world,
            &mut camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            &mut audio_events,
            0.016,
        );
        assert_eq!(scene.game_state(), GameState::Playing);

        let mut scene = ShooterScene::new();
        scene.reset_to_title(&mut world, &mut camera, &mut audio_events);
        scene.update(
            &mut world,
            &mut camera,
            InputState {
                space: 1,
                ..InputState::default()
            },
            &mut audio_events,
            0.016,
        );
        assert_eq!(scene.game_state(), GameState::Playing);
    }

    #[test]
    fn title_does_not_start_from_mouse_left() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut audio_events = Vec::new();
        scene.reset_to_title(&mut world, &mut camera, &mut audio_events);

        scene.update(
            &mut world,
            &mut camera,
            InputState {
                mouse_left: 1,
                ..InputState::default()
            },
            &mut audio_events,
            0.016,
        );

        assert_eq!(scene.game_state(), GameState::Title);
    }

    #[test]
    fn game_over_restarts_with_space() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.game_state = GameState::GameOver;
        scene.score = 7;

        scene.update(
            &mut world,
            &mut camera,
            InputState {
                space: 1,
                ..InputState::default()
            },
            &mut audio_events,
            0.016,
        );

        assert_eq!(scene.game_state(), GameState::Playing);
        assert_eq!(scene.score(), 0);
        assert!(world.player.is_some());
    }

    #[test]
    fn bullet_lifetime_despawns() {
        let (mut scene, mut world, _, _) = playing_scene();
        let b = world.spawn_bullet(30.0, 30.0, 10.0, 0.0, DEFAULT_TEXTURE_ID);

        scene.update_bullets(&mut world, crate::world::BULLET_LIFETIME + 0.1);

        assert!(!world.alive[b.id as usize]);
    }

    #[test]
    fn bullet_enemy_collision_increments_score() {
        let (mut scene, mut world, _, mut audio_events) = playing_scene();
        let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);

        scene.handle_collisions(&mut world, &mut audio_events);

        assert!(!world.alive[b.id as usize]);
        assert!(!world.alive[e.id as usize]);
        assert_eq!(scene.score(), 1);
    }

    #[test]
    fn bullet_damage_reduces_enemy_health_before_death() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 1.0, 5);
        let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        let e = world.spawn_enemy_from_template(
            52.0,
            50.0,
            DEFAULT_TEXTURE_ID,
            scene.config.enemy_template,
            scene.config.enemy_health,
            scene.config.score_reward,
        );

        scene.handle_collisions(&mut world, &mut audio_events);

        assert!(!world.alive[b.id as usize]);
        assert!(world.alive[e.id as usize]);
        assert_eq!(world.healths[e.id as usize], Some(2.0));
        assert_eq!(scene.score(), 0);
    }

    #[test]
    fn score_reward_is_added_when_enemy_dies() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_combat(&mut world, &mut camera, &mut audio_events, 2.0, 2.0, 7);
        let b = world.spawn_bullet_from_template(
            Transform2D { x: 50.0, y: 50.0 },
            Velocity::default(),
            DEFAULT_TEXTURE_ID,
            DEFAULT_BULLET_LIFETIME,
            scene.config.bullet_template,
            scene.config.bullet_damage,
        );
        let e = world.spawn_enemy_from_template(
            52.0,
            50.0,
            DEFAULT_TEXTURE_ID,
            scene.config.enemy_template,
            scene.config.enemy_health,
            scene.config.score_reward,
        );

        scene.handle_collisions(&mut world, &mut audio_events);

        assert!(!world.alive[b.id as usize]);
        assert!(!world.alive[e.id as usize]);
        assert_eq!(scene.score(), 7);
    }

    #[test]
    fn one_bullet_scores_once_when_overlapping_multiple_enemies() {
        let (mut scene, mut world, _, mut audio_events) = playing_scene();
        let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        let first_enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
        let second_enemy = world.spawn_enemy(54.0, 50.0, DEFAULT_TEXTURE_ID);

        scene.handle_collisions(&mut world, &mut audio_events);

        assert!(!world.alive[bullet.id as usize]);
        assert!(!world.alive[first_enemy.id as usize]);
        assert!(world.alive[second_enemy.id as usize]);
        assert_eq!(scene.score(), 1);
    }

    #[test]
    fn player_enemy_collision_sets_game_over() {
        let (mut scene, mut world, _, mut audio_events) = playing_scene();
        let player = world.player.unwrap();
        let pt = world.transforms[player.id as usize].unwrap();
        world.spawn_enemy(pt.x, pt.y, DEFAULT_TEXTURE_ID);

        scene.handle_collisions(&mut world, &mut audio_events);

        assert_eq!(scene.game_state(), GameState::GameOver);
    }

    #[test]
    fn player_is_clamped_inside_world_bounds() {
        let (scene, mut world, _, _) = playing_scene();
        let player = world.player.unwrap();
        world.transforms[player.id as usize] = Some(Transform2D {
            x: -100.0,
            y: 1000.0,
        });

        scene.clamp_player_to_world(&mut world);

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 18.0);
        assert_eq!(transform.y, DEFAULT_WORLD_HEIGHT - 18.0);
    }

    #[test]
    fn firing_uses_camera_adjusted_mouse_world_position() {
        let (scene, mut world, mut camera, mut audio_events) = playing_scene();
        camera.set_viewport_size(400.0, 240.0);
        let player = world.player.unwrap();
        world.transforms[player.id as usize] = Some(Transform2D {
            x: 1000.0,
            y: 600.0,
        });
        scene.update_camera_follow(&world, &mut camera);

        scene.fire_bullet_toward_mouse(
            &mut world,
            &camera,
            InputState {
                mouse_left: 1,
                mouse_x: 220.0,
                mouse_y: 120.0,
                ..InputState::default()
            },
            player,
            &mut audio_events,
        );

        let bullet_velocity = world
            .velocities
            .iter()
            .flatten()
            .find(|velocity| velocity.vx != 0.0 || velocity.vy != 0.0)
            .copied()
            .unwrap();
        assert!((bullet_velocity.vx - DEFAULT_BULLET_SPEED).abs() < 0.01);
        assert!(bullet_velocity.vy.abs() < 0.01);
    }

    #[test]
    fn reset_game_clears_score_and_recreates_player() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.score = 42;
        if let Some(player) = world.player {
            world.despawn(player);
        }
        world.player = None;

        scene.reset_playing(&mut world, &mut camera, &mut audio_events);

        assert_eq!(scene.score(), 0);
        assert!(world.player.is_some());
        assert_eq!(count_layer(&world, CollisionLayer::Player), 1);
        assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);
    }

    #[test]
    fn enemy_spawns_after_playing_interval() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();

        scene.update(
            &mut world,
            &mut camera,
            InputState::default(),
            &mut audio_events,
            DEFAULT_ENEMY_SPAWN_INTERVAL - 0.01,
        );
        assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);

        scene.update(
            &mut world,
            &mut camera,
            InputState::default(),
            &mut audio_events,
            0.02,
        );
        assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);
    }

    #[test]
    fn config_changes_player_speed_and_world_bounds() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_config(
            &mut world,
            &mut camera,
            &mut audio_events,
            ShooterConfig::from_values(3200.0, 1800.0, 240.0, 72.0, 1.0, 360.0, 0.12, 1.8),
        );
        scene.game_state = GameState::Playing;

        scene.apply_player_input(
            &mut world,
            &camera,
            InputState {
                d: 1,
                ..InputState::default()
            },
            &mut audio_events,
        );

        let player = world.player.unwrap();
        assert_eq!(world.transforms[player.id as usize].unwrap().x, 1600.0);
        assert_eq!(world.velocities[player.id as usize].unwrap().vx, 240.0);
    }

    #[test]
    fn config_changes_bullet_lifetime_and_speed() {
        let (mut scene, mut world, camera, mut audio_events) = playing_scene();
        let mut config_camera = Camera2D::new(800.0, 480.0);
        scene.set_config(
            &mut world,
            &mut config_camera,
            &mut audio_events,
            ShooterConfig::from_values(1600.0, 960.0, 180.0, 72.0, 1.0, 500.0, 0.12, 0.25),
        );
        let player = world.player.unwrap();

        scene.fire_bullet_toward_mouse(
            &mut world,
            &camera,
            InputState {
                mouse_x: 800.0,
                mouse_y: 240.0,
                ..InputState::default()
            },
            player,
            &mut audio_events,
        );

        let bullet_index = world
            .velocities
            .iter()
            .position(|velocity| velocity.is_some_and(|v| v.vx != 0.0 || v.vy != 0.0))
            .unwrap();
        assert!((world.velocities[bullet_index].unwrap().vx - 500.0).abs() < 0.01);

        scene.update_bullets(&mut world, 0.26);

        assert!(!world.alive[bullet_index]);
    }

    #[test]
    fn prefab_config_changes_spawned_sprite_and_collider_sizes() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_prefabs(
            &mut world,
            &mut camera,
            &mut audio_events,
            48.0,
            40.0,
            30.0,
            28.0,
            12.0,
            10.0,
        );
        scene.game_state = GameState::Playing;
        scene.enemy_spawn_timer = 0.0;

        let player = world.player.unwrap();
        assert_eq!(world.sprites[player.id as usize].unwrap().width, 48.0);
        assert_eq!(world.sprites[player.id as usize].unwrap().height, 40.0);
        assert_eq!(
            world.colliders[player.id as usize].unwrap().half_width,
            24.0
        );
        assert_eq!(
            world.colliders[player.id as usize].unwrap().half_height,
            20.0
        );

        scene.spawn_enemy_if_needed(&mut world);
        let enemy = world
            .colliders
            .iter()
            .enumerate()
            .find(|(_, collider)| collider.is_some_and(|c| c.layer == CollisionLayer::Enemy))
            .map(|(index, _)| index)
            .unwrap();
        assert_eq!(world.sprites[enemy].unwrap().width, 30.0);
        assert_eq!(world.sprites[enemy].unwrap().height, 28.0);

        scene.fire_bullet_toward_mouse(
            &mut world,
            &camera,
            InputState {
                mouse_x: 800.0,
                mouse_y: 240.0,
                ..InputState::default()
            },
            player,
            &mut audio_events,
        );
        let bullet = world
            .colliders
            .iter()
            .enumerate()
            .find(|(_, collider)| collider.is_some_and(|c| c.layer == CollisionLayer::Bullet))
            .map(|(index, _)| index)
            .unwrap();
        assert_eq!(world.sprites[bullet].unwrap().width, 12.0);
        assert_eq!(world.sprites[bullet].unwrap().height, 10.0);
        assert_eq!(world.colliders[bullet].unwrap().half_width, 6.0);
        assert_eq!(world.colliders[bullet].unwrap().half_height, 5.0);
    }

    #[test]
    fn enemy_behavior_static_stops_enemy_velocity() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_enemy_behavior(
            &mut world,
            &mut camera,
            &mut audio_events,
            EnemyBehavior::Static,
        );
        let enemy = world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

        scene.update_enemy_velocity(&mut world);

        assert_eq!(
            world.velocities[enemy.id as usize],
            Some(Velocity::default())
        );
    }

    #[test]
    fn enemy_behavior_drift_moves_enemy_toward_world_center() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_enemy_behavior(
            &mut world,
            &mut camera,
            &mut audio_events,
            EnemyBehavior::Drift,
        );
        let enemy = world.spawn_enemy(0.0, 480.0, DEFAULT_TEXTURE_ID);

        scene.update_enemy_velocity(&mut world);

        let velocity = world.velocities[enemy.id as usize].unwrap();
        assert!(velocity.vx > 0.0);
        assert!(velocity.vy.abs() < 0.01);
    }

    #[test]
    fn enemy_spawn_pattern_corners_cycles_world_corners() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_enemy_spawn_pattern(
            &mut world,
            &mut camera,
            &mut audio_events,
            EnemySpawnPattern::Corners,
        );

        assert_eq!(scene.enemy_spawn_position(0), (0.0, 0.0));
        assert_eq!(scene.enemy_spawn_position(1), (1600.0, 0.0));
        assert_eq!(scene.enemy_spawn_position(2), (1600.0, 960.0));
        assert_eq!(scene.enemy_spawn_position(3), (0.0, 960.0));
    }

    #[test]
    fn enemy_spawn_pattern_center_uses_world_center() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_enemy_spawn_pattern(
            &mut world,
            &mut camera,
            &mut audio_events,
            EnemySpawnPattern::Center,
        );

        assert_eq!(scene.enemy_spawn_position(7), (800.0, 480.0));
    }

    #[test]
    fn configured_texture_ids_are_written_to_existing_sprites() {
        let (mut scene, mut world, _, _) = playing_scene();
        world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
        world.spawn_bullet(120.0, 100.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);

        scene.set_texture_ids(&mut world, 1, 2, 3);

        let texture_ids: Vec<u32> = world
            .sprites
            .iter()
            .flatten()
            .map(|sprite| sprite.texture_id)
            .collect();
        assert!(texture_ids.contains(&1));
        assert!(texture_ids.contains(&2));
        assert!(texture_ids.contains(&3));
    }

    #[test]
    fn firing_bullet_pushes_shoot_audio_event() {
        let (mut scene, mut world, camera, mut audio_events) = playing_scene();
        scene.set_sound_ids(10, 20, 30);
        let player = world.player.unwrap();

        scene.fire_bullet_toward_mouse(
            &mut world,
            &camera,
            InputState::default(),
            player,
            &mut audio_events,
        );

        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, 10);
        assert_eq!(audio_events[0].volume, SHOOT_VOLUME);
    }

    #[test]
    fn bullet_enemy_collision_pushes_hit_audio_event() {
        let (mut scene, mut world, _, mut audio_events) = playing_scene();
        scene.set_sound_ids(10, 20, 30);
        let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);

        scene.handle_collisions(&mut world, &mut audio_events);

        assert!(!world.alive[b.id as usize]);
        assert!(!world.alive[e.id as usize]);
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, 20);
    }

    #[test]
    fn game_over_pushes_event_once_and_clear_events_removes_it() {
        let (mut scene, mut world, _, mut audio_events) = playing_scene();
        scene.set_sound_ids(10, 20, 30);
        let player = world.player.unwrap();
        let pt = world.transforms[player.id as usize].unwrap();
        world.spawn_enemy(pt.x, pt.y, DEFAULT_TEXTURE_ID);

        scene.handle_collisions(&mut world, &mut audio_events);
        scene.handle_collisions(&mut world, &mut audio_events);

        assert_eq!(scene.game_state(), GameState::GameOver);
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, 30);

        audio_events.clear();
        assert!(audio_events.is_empty());
    }
}
