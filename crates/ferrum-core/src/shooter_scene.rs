use crate::audio_event::AudioEvent;
use crate::camera::{Camera2D, CameraPresetConfig};
use crate::collision::{CollisionPair, CollisionScratch, CollisionSystem};
use crate::collision_event::{CollisionEvent, CollisionEventCounts, COLLISION_EVENT_HIT};
use crate::components::{
    CollisionLayer, SpriteAnimation, SpriteAnimationState, SpriteFrame, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::particles::{ParticlePreset, ParticleSystem};
use crate::physics::{PhysicsBounds, PhysicsCounters, PhysicsSystem};
use crate::tilemap::{Tilemap, TilemapNavigationScratch};
use crate::tweens::{SpriteTint, TweenEasing, TweenSystem};
use crate::world::{
    EntityTemplate, EntityTemplateCollider, EntityTemplateColliderShape, World,
    DEFAULT_BULLET_TEMPLATE, DEFAULT_ENEMY_TEMPLATE, DEFAULT_PLAYER_TEMPLATE,
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
const DEFAULT_SHOOT_VOLUME: f32 = 0.35;
const DEFAULT_HIT_VOLUME: f32 = 0.45;
const DEFAULT_GAME_OVER_VOLUME: f32 = 0.65;
const DEFAULT_SOUND_PITCH: f32 = 1.0;
const NAVIGATION_REPATH_INTERVAL: f32 = 0.25;
const NAVIGATION_TARGET_REACHED_DISTANCE_SQUARED: f32 = 4.0;
const DEFAULT_ORBIT_RADIUS: f32 = 180.0;
const DEFAULT_ORBIT_RADIAL_BAND: f32 = 24.0;
const ENEMY_HIT_FLASH_TINT: SpriteTint = SpriteTint::new(1.0, 0.88, 0.38, 1.0);
const ENEMY_HIT_FLASH_SECONDS: f32 = 0.12;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum EnemyBehavior {
    #[default]
    Chase,
    Drift,
    Static,
    Orbit,
}

impl EnemyBehavior {
    pub fn from_code(code: u32) -> Self {
        match code {
            1 => Self::Drift,
            2 => Self::Static,
            3 => Self::Orbit,
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
pub(crate) struct ShooterAudioPolicy {
    pub shoot_volume: f32,
    pub shoot_pitch: f32,
    pub hit_volume: f32,
    pub hit_pitch: f32,
    pub game_over_volume: f32,
    pub game_over_pitch: f32,
}

impl Default for ShooterAudioPolicy {
    fn default() -> Self {
        Self {
            shoot_volume: DEFAULT_SHOOT_VOLUME,
            shoot_pitch: DEFAULT_SOUND_PITCH,
            hit_volume: DEFAULT_HIT_VOLUME,
            hit_pitch: DEFAULT_SOUND_PITCH,
            game_over_volume: DEFAULT_GAME_OVER_VOLUME,
            game_over_pitch: DEFAULT_SOUND_PITCH,
        }
    }
}

impl ShooterAudioPolicy {
    #[allow(clippy::too_many_arguments)]
    pub fn from_values(
        shoot_volume: f32,
        shoot_pitch: f32,
        hit_volume: f32,
        hit_pitch: f32,
        game_over_volume: f32,
        game_over_pitch: f32,
    ) -> Self {
        Self {
            shoot_volume: non_negative_or_default(shoot_volume, DEFAULT_SHOOT_VOLUME),
            shoot_pitch: positive_or_default(shoot_pitch, DEFAULT_SOUND_PITCH),
            hit_volume: non_negative_or_default(hit_volume, DEFAULT_HIT_VOLUME),
            hit_pitch: positive_or_default(hit_pitch, DEFAULT_SOUND_PITCH),
            game_over_volume: non_negative_or_default(game_over_volume, DEFAULT_GAME_OVER_VOLUME),
            game_over_pitch: positive_or_default(game_over_pitch, DEFAULT_SOUND_PITCH),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ShooterWaveConfig {
    pub duration: f32,
    pub spawn_interval: f32,
    pub enemy_count: u32,
    pub enemy_speed: f32,
    pub enemy_behavior: EnemyBehavior,
    pub enemy_spawn_pattern: EnemySpawnPattern,
    pub enemy_health: f32,
    pub score_reward: u32,
}

impl ShooterWaveConfig {
    #[allow(clippy::too_many_arguments)]
    pub fn from_values(
        duration: f32,
        spawn_interval: f32,
        enemy_count: u32,
        enemy_speed: f32,
        enemy_behavior: EnemyBehavior,
        enemy_spawn_pattern: EnemySpawnPattern,
        enemy_health: f32,
        score_reward: u32,
    ) -> Self {
        Self {
            duration: positive_or_default(duration, DEFAULT_ENEMY_SPAWN_INTERVAL),
            spawn_interval: positive_or_default(spawn_interval, DEFAULT_ENEMY_SPAWN_INTERVAL),
            enemy_count: if enemy_count > 0 { enemy_count } else { 1 },
            enemy_speed: positive_or_default(enemy_speed, DEFAULT_ENEMY_SPEED),
            enemy_behavior,
            enemy_spawn_pattern,
            enemy_health: positive_or_default(enemy_health, DEFAULT_ENEMY_HEALTH),
            score_reward: if score_reward > 0 {
                score_reward
            } else {
                DEFAULT_SCORE_REWARD
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShooterPrefabKind {
    Player,
    Enemy,
    Bullet,
}

impl ShooterPrefabKind {
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Player),
            1 => Some(Self::Enemy),
            2 => Some(Self::Bullet),
            _ => None,
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
    pub orbit_radius: f32,
    pub orbit_radial_band: f32,
    pub camera: CameraPresetConfig,
    pub audio_policy: ShooterAudioPolicy,
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
            orbit_radius: DEFAULT_ORBIT_RADIUS,
            orbit_radial_band: DEFAULT_ORBIT_RADIAL_BAND,
            camera: CameraPresetConfig::default(),
            audio_policy: ShooterAudioPolicy::default(),
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

    pub fn with_orbit(mut self, radius: f32, radial_band: f32) -> Self {
        self.orbit_radius = positive_or_default(radius, DEFAULT_ORBIT_RADIUS);
        self.orbit_radial_band = non_negative_or_default(radial_band, DEFAULT_ORBIT_RADIAL_BAND);
        self
    }

    pub fn with_prefab_collider(
        mut self,
        prefab: ShooterPrefabKind,
        collider: EntityTemplateCollider,
    ) -> Self {
        match prefab {
            ShooterPrefabKind::Player => {
                self.player_template =
                    template_with_collider_or_default(self.player_template, collider);
            }
            ShooterPrefabKind::Enemy => {
                self.enemy_template =
                    template_with_collider_or_default(self.enemy_template, collider);
            }
            ShooterPrefabKind::Bullet => {
                self.bullet_template =
                    template_with_collider_or_default(self.bullet_template, collider);
            }
        }
        self
    }

    pub fn with_camera(mut self, camera: CameraPresetConfig) -> Self {
        self.camera = camera;
        self
    }

    pub fn with_audio_policy(mut self, audio_policy: ShooterAudioPolicy) -> Self {
        self.audio_policy = audio_policy;
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

fn non_negative_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        default
    }
}

fn finite_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

fn has_reached_navigation_target(from: Transform2D, to: Transform2D) -> bool {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    dx * dx + dy * dy <= NAVIGATION_TARGET_REACHED_DISTANCE_SQUARED
}

fn template_or_default(width: f32, height: f32, default: EntityTemplate) -> EntityTemplate {
    EntityTemplate::new(
        positive_or_default(width, default.sprite_width),
        positive_or_default(height, default.sprite_height),
    )
}

fn template_with_collider_or_default(
    template: EntityTemplate,
    collider: EntityTemplateCollider,
) -> EntityTemplate {
    let default = EntityTemplateCollider::from_template(template);
    template.with_collider(EntityTemplateCollider {
        shape: collider_shape_or_default(collider.shape, default.shape),
        half_width: collider.half_width,
        half_height: collider.half_height,
        offset_x: finite_or_default(collider.offset_x, default.offset_x),
        offset_y: finite_or_default(collider.offset_y, default.offset_y),
        enabled: collider.enabled,
        is_trigger: collider.is_trigger,
        material: collider.material,
    })
}

fn collider_shape_or_default(
    shape: EntityTemplateColliderShape,
    default: EntityTemplateColliderShape,
) -> EntityTemplateColliderShape {
    match shape {
        EntityTemplateColliderShape::Aabb {
            half_width,
            half_height,
        } => EntityTemplateColliderShape::Aabb {
            half_width: positive_shape_or_default(half_width, default_half_width(default)),
            half_height: positive_shape_or_default(half_height, default_half_height(default)),
        },
        EntityTemplateColliderShape::Circle { radius } => {
            if radius.is_finite() && radius > 0.0 {
                shape
            } else {
                default
            }
        }
        EntityTemplateColliderShape::OrientedBox {
            half_width,
            half_height,
            rotation_radians,
        } => {
            if half_width.is_finite()
                && half_width > 0.0
                && half_height.is_finite()
                && half_height > 0.0
                && rotation_radians.is_finite()
            {
                shape
            } else {
                default
            }
        }
        EntityTemplateColliderShape::Capsule {
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
        } => {
            if start_x.is_finite()
                && start_y.is_finite()
                && end_x.is_finite()
                && end_y.is_finite()
                && radius.is_finite()
                && radius > 0.0
            {
                shape
            } else {
                default
            }
        }
        EntityTemplateColliderShape::ConvexPolygon {
            vertices,
            vertex_count,
            rotation_radians,
        } => {
            let count = vertex_count as usize;
            if (3..=crate::components::MAX_CONVEX_POLYGON_VERTICES).contains(&count)
                && rotation_radians.is_finite()
                && vertices
                    .iter()
                    .take(count)
                    .all(|vertex| vertex.x.is_finite() && vertex.y.is_finite())
            {
                shape
            } else {
                default
            }
        }
    }
}

fn default_half_width(shape: EntityTemplateColliderShape) -> f32 {
    match shape {
        EntityTemplateColliderShape::Aabb { half_width, .. }
        | EntityTemplateColliderShape::OrientedBox { half_width, .. } => half_width,
        EntityTemplateColliderShape::Circle { radius } => radius,
        EntityTemplateColliderShape::Capsule {
            start_x,
            end_x,
            radius,
            ..
        } => ((start_x - end_x).abs() + radius * 2.0) * 0.5,
        EntityTemplateColliderShape::ConvexPolygon {
            vertices,
            vertex_count,
            ..
        } => {
            let count = (vertex_count as usize).min(crate::components::MAX_CONVEX_POLYGON_VERTICES);
            if count == 0 {
                return 0.0;
            }
            let mut min_x = vertices[0].x;
            let mut max_x = vertices[0].x;
            for vertex in vertices.iter().take(count).skip(1) {
                min_x = min_x.min(vertex.x);
                max_x = max_x.max(vertex.x);
            }
            (max_x - min_x) * 0.5
        }
    }
}

fn default_half_height(shape: EntityTemplateColliderShape) -> f32 {
    match shape {
        EntityTemplateColliderShape::Aabb { half_height, .. }
        | EntityTemplateColliderShape::OrientedBox { half_height, .. } => half_height,
        EntityTemplateColliderShape::Circle { radius } => radius,
        EntityTemplateColliderShape::Capsule {
            start_y,
            end_y,
            radius,
            ..
        } => ((start_y - end_y).abs() + radius * 2.0) * 0.5,
        EntityTemplateColliderShape::ConvexPolygon {
            vertices,
            vertex_count,
            ..
        } => {
            let count = (vertex_count as usize).min(crate::components::MAX_CONVEX_POLYGON_VERTICES);
            if count == 0 {
                return 0.0;
            }
            let mut min_y = vertices[0].y;
            let mut max_y = vertices[0].y;
            for vertex in vertices.iter().take(count).skip(1) {
                min_y = min_y.min(vertex.y);
                max_y = max_y.max(vertex.y);
            }
            (max_y - min_y) * 0.5
        }
    }
}

fn positive_shape_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        default
    }
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

fn sprite_frames_from_values(values: &[f32]) -> Option<Vec<SpriteFrame>> {
    let chunks = values.chunks_exact(4);
    if !chunks.remainder().is_empty() {
        return None;
    }

    let frames: Option<Vec<SpriteFrame>> = chunks
        .map(|chunk| SpriteFrame::from_values(chunk[0], chunk[1], chunk[2], chunk[3]))
        .collect();
    frames.filter(|frames| !frames.is_empty())
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

#[derive(Clone, Copy, Debug, PartialEq)]
struct NavigationTargetCache {
    generation: u32,
    target: Transform2D,
    remaining_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct EnemyNavigationSource {
    index: usize,
    generation: u32,
    transform: Transform2D,
}

struct CollisionEventSink<'a> {
    events: &'a mut Vec<CollisionEvent>,
    counts: &'a mut CollisionEventCounts,
}

impl CollisionEventSink<'_> {
    fn push_hit(&mut self, a: Entity, b: Entity, damage: f32) {
        self.events.push(CollisionEvent::from_entities_with_damage(
            COLLISION_EVENT_HIT,
            a,
            b,
            damage,
        ));
        self.counts.hit = self.counts.hit.saturating_add(1);
    }
}

pub(crate) struct ParticleBurstSink<'a> {
    particles: &'a mut ParticleSystem,
    preset: ParticlePreset,
}

impl<'a> ParticleBurstSink<'a> {
    pub(crate) fn new(particles: &'a mut ParticleSystem, preset: ParticlePreset) -> Self {
        Self { particles, preset }
    }

    fn spawn_at(&mut self, position: Transform2D) -> usize {
        self.particles
            .spawn_burst(self.preset, position.x, position.y)
    }
}

pub(crate) struct TweenSink<'a> {
    tweens: &'a mut TweenSystem,
}

impl<'a> TweenSink<'a> {
    pub(crate) fn new(tweens: &'a mut TweenSystem) -> Self {
        Self { tweens }
    }

    fn flash_enemy_hit(&mut self, world: &mut World, enemy: Entity) -> bool {
        self.tweens.flash_sprite_tint(
            world,
            enemy,
            ENEMY_HIT_FLASH_TINT,
            ENEMY_HIT_FLASH_SECONDS,
            TweenEasing::EaseOut,
        )
    }
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

    #[cfg(test)]
    pub fn update(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
    ) {
        self.update_internal(
            world,
            camera,
            input,
            audio_events,
            tilemap,
            delta,
            None,
            None,
            None,
            None,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update_with_counters(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
        physics_counters: &mut PhysicsCounters,
        collision_events: &mut Vec<CollisionEvent>,
        collision_event_counts: &mut CollisionEventCounts,
        hit_particles: Option<ParticleBurstSink<'_>>,
        hit_tweens: Option<TweenSink<'_>>,
    ) {
        self.update_internal(
            world,
            camera,
            input,
            audio_events,
            tilemap,
            delta,
            Some(physics_counters),
            Some(CollisionEventSink {
                events: collision_events,
                counts: collision_event_counts,
            }),
            hit_particles,
            hit_tweens,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn update_internal(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
        physics_counters: Option<&mut PhysicsCounters>,
        collision_events: Option<CollisionEventSink<'_>>,
        hit_particles: Option<ParticleBurstSink<'_>>,
        hit_tweens: Option<TweenSink<'_>>,
    ) {
        let mut collision_events = collision_events;
        let mut hit_particles = hit_particles;
        let mut hit_tweens = hit_tweens;
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
                self.advance_wave_if_needed();
                self.camera_elapsed_seconds += delta.max(0.0);
                self.apply_player_input(world, camera, input, audio_events);
                self.update_enemy_velocity(world, tilemap, delta);
                world.update(delta);
                if let Some(counters) = physics_counters {
                    tilemap.resolve_dynamic_collisions_with_counters(world, counters);
                } else {
                    tilemap.resolve_dynamic_collisions(world);
                }
                self.clamp_player_to_world(world);
                self.update_camera_follow(world, camera);
                self.update_bullets(world, delta);
                self.spawn_enemy_if_needed(world);
                self.handle_collisions(
                    world,
                    audio_events,
                    delta,
                    collision_events.as_mut(),
                    hit_particles.as_mut(),
                    hit_tweens.as_mut(),
                );
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

    fn tick_playing_timers(&mut self, delta: f32) {
        if self.fire_cooldown_seconds > 0.0 {
            self.fire_cooldown_seconds = (self.fire_cooldown_seconds - delta).max(0.0);
        }
        if self.enemy_spawn_timer > 0.0 {
            self.enemy_spawn_timer -= delta;
        }
        if !self.waves.is_empty() {
            self.wave_elapsed_seconds += delta.max(0.0);
        }
    }

    fn reset_wave_state(&mut self) {
        self.active_wave_index = 0;
        self.wave_elapsed_seconds = 0.0;
        self.wave_spawned_count = 0;
        self.enemy_spawn_timer = self.active_spawn_interval();
    }

    fn advance_wave_if_needed(&mut self) {
        let Some(wave) = self.active_wave() else {
            return;
        };
        if self.wave_elapsed_seconds < wave.duration && self.wave_spawned_count < wave.enemy_count {
            return;
        }

        self.active_wave_index = (self.active_wave_index + 1) % self.waves.len();
        self.wave_elapsed_seconds = 0.0;
        self.wave_spawned_count = 0;
        self.enemy_spawn_timer = self.active_spawn_interval();
    }

    fn active_wave(&self) -> Option<ShooterWaveConfig> {
        self.waves.get(self.active_wave_index).copied()
    }

    fn active_spawn_interval(&self) -> f32 {
        self.active_wave()
            .map(|wave| wave.spawn_interval)
            .unwrap_or(self.config.enemy_spawn_interval)
    }

    fn active_enemy_speed(&self) -> f32 {
        self.active_wave()
            .map(|wave| wave.enemy_speed)
            .unwrap_or(self.config.enemy_speed)
    }

    fn active_enemy_behavior(&self) -> EnemyBehavior {
        self.active_wave()
            .map(|wave| wave.enemy_behavior)
            .unwrap_or(self.config.enemy_behavior)
    }

    fn active_enemy_spawn_pattern(&self) -> EnemySpawnPattern {
        self.active_wave()
            .map(|wave| wave.enemy_spawn_pattern)
            .unwrap_or(self.config.enemy_spawn_pattern)
    }

    fn active_enemy_health(&self) -> f32 {
        self.active_wave()
            .map(|wave| wave.enemy_health)
            .unwrap_or(self.config.enemy_health)
    }

    fn active_score_reward(&self) -> u32 {
        self.active_wave()
            .map(|wave| wave.score_reward)
            .unwrap_or(self.config.score_reward)
    }

    fn active_wave_has_spawned_all_enemies(&self) -> bool {
        self.active_wave()
            .map(|wave| self.wave_spawned_count >= wave.enemy_count)
            .unwrap_or(false)
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
        Self::push_audio_event(
            audio_events,
            self.sound_ids.shoot,
            self.config.audio_policy.shoot_volume,
            self.config.audio_policy.shoot_pitch,
        );
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

    fn update_enemy_velocity(&mut self, world: &mut World, tilemap: &Tilemap, delta: f32) {
        self.tick_navigation_targets(delta);
        let player_t = world
            .player
            .and_then(|player| world.transforms[player.id as usize]);
        let speed = self.active_enemy_speed();
        let behavior = self.active_enemy_behavior();
        for i in 0..world.transforms.len() {
            if !world.alive[i] {
                continue;
            }
            if world.collider_layer_at(i) != Some(CollisionLayer::Enemy) {
                continue;
            }
            let Some(enemy_t) = world.transforms[i] else {
                continue;
            };
            world.velocities[i] = Some(self.enemy_velocity(
                EnemyNavigationSource {
                    index: i,
                    generation: world.generations[i],
                    transform: enemy_t,
                },
                player_t,
                tilemap,
                speed,
                behavior,
            ));
        }
    }

    fn enemy_velocity(
        &mut self,
        enemy: EnemyNavigationSource,
        player_t: Option<Transform2D>,
        tilemap: &Tilemap,
        speed: f32,
        behavior: EnemyBehavior,
    ) -> Velocity {
        match behavior {
            EnemyBehavior::Chase => {
                let Some(player_t) = player_t else {
                    return Velocity::default();
                };
                let target = self.navigation_target(enemy, player_t, tilemap);
                self.velocity_toward(enemy.transform, target, speed)
            }
            EnemyBehavior::Drift => self.velocity_toward(
                enemy.transform,
                Transform2D {
                    x: self.config.world_width * 0.5,
                    y: self.config.world_height * 0.5,
                },
                speed,
            ),
            EnemyBehavior::Static => Velocity::default(),
            EnemyBehavior::Orbit => {
                let Some(player_t) = player_t else {
                    return Velocity::default();
                };
                self.orbit_velocity(enemy.transform, player_t, speed)
            }
        }
    }

    fn orbit_velocity(&self, enemy_t: Transform2D, player_t: Transform2D, speed: f32) -> Velocity {
        let dx = enemy_t.x - player_t.x;
        let dy = enemy_t.y - player_t.y;
        let distance = (dx * dx + dy * dy).sqrt();
        if distance <= 0.0001 {
            return Velocity { vx: speed, vy: 0.0 };
        }

        let radial_x = dx / distance;
        let radial_y = dy / distance;
        let mut vx = -radial_y;
        let mut vy = radial_x;

        if distance < self.config.orbit_radius - self.config.orbit_radial_band {
            vx += radial_x;
            vy += radial_y;
        } else if distance > self.config.orbit_radius + self.config.orbit_radial_band {
            vx -= radial_x;
            vy -= radial_y;
        }

        let len = (vx * vx + vy * vy).sqrt();
        if len <= 0.0001 {
            return Velocity::default();
        }
        Velocity {
            vx: vx / len * speed,
            vy: vy / len * speed,
        }
    }

    fn tick_navigation_targets(&mut self, delta: f32) {
        let elapsed = delta.max(0.0);
        if elapsed <= 0.0 {
            return;
        }
        for cache in self.navigation_targets.iter_mut().flatten() {
            cache.remaining_seconds = (cache.remaining_seconds - elapsed).max(0.0);
        }
    }

    fn navigation_target(
        &mut self,
        enemy: EnemyNavigationSource,
        player_t: Transform2D,
        tilemap: &Tilemap,
    ) -> Transform2D {
        if enemy.index >= self.navigation_targets.len() {
            self.navigation_targets.resize(enemy.index + 1, None);
        }

        let cached_target = self.navigation_targets[enemy.index]
            .filter(|cache| {
                cache.generation == enemy.generation
                    && cache.remaining_seconds > 0.0
                    && !has_reached_navigation_target(enemy.transform, cache.target)
            })
            .map(|cache| cache.target);
        if let Some(target) = cached_target {
            return target;
        }

        let target = tilemap
            .navigation_waypoint_with_scratch(
                enemy.transform,
                player_t,
                &mut self.navigation_scratch,
            )
            .unwrap_or(player_t);
        self.navigation_targets[enemy.index] = Some(NavigationTargetCache {
            generation: enemy.generation,
            target,
            remaining_seconds: NAVIGATION_REPATH_INTERVAL,
        });
        target
    }

    fn velocity_toward(&self, from: Transform2D, to: Transform2D, speed: f32) -> Velocity {
        let dx = to.x - from.x;
        let dy = to.y - from.y;
        let len = (dx * dx + dy * dy).sqrt();
        if len > 0.0001 {
            Velocity {
                vx: dx / len * speed,
                vy: dy / len * speed,
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
            if world.collider_layer_at(i) != Some(CollisionLayer::Bullet) {
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
        if self.active_wave_has_spawned_all_enemies() {
            return;
        }
        self.enemy_spawn_timer = self.active_spawn_interval();
        let idx = self.spawn_index;
        self.spawn_index = self.spawn_index.wrapping_add(1);
        let (x, y) = self.enemy_spawn_position(idx);
        world.spawn_enemy_from_template(
            x,
            y,
            self.texture_ids.enemy,
            self.config.enemy_template,
            self.active_enemy_health(),
            self.active_score_reward(),
        );
        if !self.waves.is_empty() {
            self.wave_spawned_count = self.wave_spawned_count.saturating_add(1);
        }
    }

    fn enemy_spawn_position(&self, idx: u32) -> (f32, f32) {
        match self.active_enemy_spawn_pattern() {
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

    fn push_audio_event(
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

    fn handle_collisions(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        hit_particles: Option<&mut ParticleBurstSink<'_>>,
        hit_tweens: Option<&mut TweenSink<'_>>,
    ) {
        self.prepare_collision_scratch(world.alive.len());
        self.handle_bullet_enemy_collisions(
            world,
            audio_events,
            delta,
            collision_events.as_deref_mut(),
            hit_particles,
            hit_tweens,
        );
        self.handle_player_enemy_collisions(world, audio_events, collision_events);

        for e in self.pending_despawn.drain(..) {
            world.despawn(e);
        }
    }

    fn prepare_collision_scratch(&mut self, alive_len: usize) {
        self.pending_despawn.clear();
        self.marked_for_despawn.clear();
        self.marked_for_despawn.resize(alive_len, false);
        self.collision_pairs.clear();
    }

    fn handle_bullet_enemy_collisions(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut hit_tweens: Option<&mut TweenSink<'_>>,
    ) {
        CollisionSystem::build_swept_layer_pairs_into(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            delta,
            &mut self.collision_pairs,
        );
        let hit_sound_id = self.sound_ids.hit;
        let hit_volume = self.config.audio_policy.hit_volume;
        let hit_pitch = self.config.audio_policy.hit_pitch;
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let bullet_index = pair.a.id as usize;
            let enemy_index = pair.b.id as usize;
            if !Self::is_alive_layer(world, bullet_index, CollisionLayer::Bullet)
                || self.marked_for_despawn[bullet_index]
            {
                continue;
            }
            if !Self::is_alive_layer(world, enemy_index, CollisionLayer::Enemy)
                || self.marked_for_despawn[enemy_index]
            {
                continue;
            }

            let damage = world.damages[bullet_index].unwrap_or(DEFAULT_BULLET_DAMAGE);
            let hit_position = world.transforms[enemy_index].or(world.transforms[bullet_index]);
            if let Some(events) = collision_events.as_mut() {
                events.push_hit(pair.a, pair.b, damage);
            }
            if let Some(position) = hit_position {
                if let Some(particles) = hit_particles.as_deref_mut() {
                    particles.spawn_at(position);
                }
            }
            self.marked_for_despawn[bullet_index] = true;
            self.pending_despawn.push(Entity {
                id: bullet_index as u32,
                generation: world.generations[bullet_index],
            });
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
            } else if let Some(tweens) = hit_tweens.as_deref_mut() {
                tweens.flash_enemy_hit(
                    world,
                    Entity {
                        id: enemy_index as u32,
                        generation: world.generations[enemy_index],
                    },
                );
            }
            Self::push_audio_event(audio_events, hit_sound_id, hit_volume, hit_pitch);
        }
    }

    fn handle_player_enemy_collisions(
        &mut self,
        world: &World,
        audio_events: &mut Vec<AudioEvent>,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let player_index = player.id as usize;
        if !Self::is_alive_layer(world, player_index, CollisionLayer::Player)
            || self.marked_for_despawn[player_index]
        {
            return;
        }
        CollisionSystem::build_layer_pairs_into(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
            &mut self.collision_pairs,
        );
        let game_over_sound_id = self.sound_ids.game_over;
        let game_over_volume = self.config.audio_policy.game_over_volume;
        let game_over_pitch = self.config.audio_policy.game_over_pitch;
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let enemy_index = pair.b.id as usize;
            if pair.a != player
                || !Self::is_alive_layer(world, enemy_index, CollisionLayer::Enemy)
                || self.marked_for_despawn[enemy_index]
            {
                continue;
            }
            if self.game_state != GameState::GameOver {
                self.game_state = GameState::GameOver;
                if let Some(events) = collision_events.as_mut() {
                    events.push_hit(pair.a, pair.b, 0.0);
                }
                Self::push_audio_event(
                    audio_events,
                    game_over_sound_id,
                    game_over_volume,
                    game_over_pitch,
                );
            }
            break;
        }
    }

    fn is_alive_layer(world: &World, index: usize, layer: CollisionLayer) -> bool {
        world.alive.get(index).copied().unwrap_or(false)
            && world.collider_layer_at(index) == Some(layer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::PhysicsMaterial;

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
            .filter(|(idx, alive)| **alive && world.collider_layer_at(*idx) == Some(layer))
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
            &Tilemap::default(),
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
            &Tilemap::default(),
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
            &Tilemap::default(),
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
            &Tilemap::default(),
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

        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

        assert!(!world.alive[b.id as usize]);
        assert!(!world.alive[e.id as usize]);
        assert_eq!(scene.score(), 1);
    }

    #[test]
    fn fast_bullet_enemy_collision_uses_swept_physics() {
        let (mut scene, mut world, _, mut audio_events) = playing_scene();
        let b = world.spawn_bullet(0.0, 50.0, 1000.0, 0.0, DEFAULT_TEXTURE_ID);
        let e = world.spawn_enemy(50.0, 50.0, DEFAULT_TEXTURE_ID);

        world.update(0.1);
        assert!(!CollisionSystem::overlaps(
            world.transforms[b.id as usize].unwrap(),
            world.colliders[b.id as usize].unwrap(),
            world.transforms[e.id as usize].unwrap(),
            world.colliders[e.id as usize].unwrap(),
        ));

        scene.handle_collisions(&mut world, &mut audio_events, 0.1, None, None, None);

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

        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

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

        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

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

        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

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

        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

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
            &Tilemap::default(),
            DEFAULT_ENEMY_SPAWN_INTERVAL - 0.01,
        );
        assert_eq!(count_layer(&world, CollisionLayer::Enemy), 0);

        scene.update(
            &mut world,
            &mut camera,
            InputState::default(),
            &mut audio_events,
            &Tilemap::default(),
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
    fn prefab_collider_config_updates_spawned_and_existing_colliders() {
        let (mut scene, mut world, camera, mut audio_events) = playing_scene();
        let material =
            PhysicsMaterial::new(0.2, 0.8).with_surface_velocity(Velocity { vx: 2.0, vy: 0.0 });

        assert!(scene.set_prefab_collider(
            &mut world,
            0,
            EntityTemplateCollider::aabb(12.0, 14.0, 2.0, -3.0, false, false, Some(material)),
        ));

        let player = world.player.unwrap();
        let player_collider = world.colliders[player.id as usize].unwrap();
        assert_eq!(player_collider.half_width, 12.0);
        assert_eq!(player_collider.half_height, 14.0);
        assert_eq!(player_collider.offset_x, 2.0);
        assert_eq!(player_collider.offset_y, -3.0);
        assert!(!player_collider.enabled);
        assert!(!player_collider.is_trigger);
        assert_eq!(world.collider_material(player), Some(material));

        assert!(scene.set_prefab_collider(
            &mut world,
            1,
            EntityTemplateCollider::aabb(9.0, 11.0, 1.0, 0.0, true, true, None),
        ));
        scene.game_state = GameState::Playing;
        scene.enemy_spawn_timer = 0.0;
        scene.spawn_enemy_if_needed(&mut world);
        let enemy = world
            .colliders
            .iter()
            .enumerate()
            .find(|(_, collider)| collider.is_some_and(|c| c.layer == CollisionLayer::Enemy))
            .map(|(index, _)| index)
            .unwrap();
        assert_eq!(world.colliders[enemy].unwrap().half_width, 9.0);
        assert_eq!(world.colliders[enemy].unwrap().offset_x, 1.0);
        assert_eq!(
            world.collider_material(Entity {
                id: enemy as u32,
                generation: 0
            }),
            None
        );

        assert!(scene.set_prefab_collider(
            &mut world,
            2,
            EntityTemplateCollider::aabb(3.0, 5.0, -1.0, 1.0, true, true, Some(material)),
        ));
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
        assert_eq!(world.colliders[bullet].unwrap().half_width, 3.0);
        assert_eq!(world.colliders[bullet].unwrap().half_height, 5.0);
        assert_eq!(world.colliders[bullet].unwrap().offset_x, -1.0);
        assert_eq!(
            world.collider_material(Entity {
                id: bullet as u32,
                generation: 0
            }),
            Some(material)
        );
    }

    #[test]
    fn prefab_collider_config_supports_non_aabb_shapes() {
        let (mut scene, mut world, camera, mut audio_events) = playing_scene();
        let player = world.player.unwrap();
        assert!(scene.set_prefab_collider(
            &mut world,
            0,
            EntityTemplateCollider {
                shape: EntityTemplateColliderShape::Circle { radius: 13.0 },
                half_width: 0.0,
                half_height: 0.0,
                offset_x: 2.0,
                offset_y: -1.0,
                enabled: true,
                is_trigger: true,
                material: None,
            },
        ));
        let player_collider = world.circle_colliders[player.id as usize].unwrap();
        assert_eq!(player_collider.radius, 13.0);
        assert_eq!(player_collider.offset_x, 2.0);
        assert_eq!(
            world.collider_layer_at(player.id as usize),
            Some(CollisionLayer::Player)
        );

        assert!(scene.set_prefab_collider(
            &mut world,
            1,
            EntityTemplateCollider {
                shape: EntityTemplateColliderShape::Capsule {
                    start_x: -4.0,
                    start_y: 0.0,
                    end_x: 4.0,
                    end_y: 0.0,
                    radius: 3.0,
                },
                half_width: 0.0,
                half_height: 0.0,
                offset_x: 0.0,
                offset_y: 1.0,
                enabled: true,
                is_trigger: true,
                material: None,
            },
        ));
        scene.game_state = GameState::Playing;
        scene.enemy_spawn_timer = 0.0;
        scene.spawn_enemy_if_needed(&mut world);
        let enemy = (0..world.alive.len())
            .find(|index| world.collider_layer_at(*index) == Some(CollisionLayer::Enemy))
            .unwrap();
        assert_eq!(world.capsule_colliders[enemy].unwrap().radius, 3.0);

        assert!(scene.set_prefab_collider(
            &mut world,
            1,
            EntityTemplateCollider {
                shape: EntityTemplateColliderShape::OrientedBox {
                    half_width: 7.0,
                    half_height: 5.0,
                    rotation_radians: 0.25,
                },
                half_width: 0.0,
                half_height: 0.0,
                offset_x: 1.0,
                offset_y: 2.0,
                enabled: true,
                is_trigger: false,
                material: None,
            },
        ));
        let enemy_box = world.oriented_box_colliders[enemy].unwrap();
        assert_eq!(enemy_box.half_width, 7.0);
        assert_eq!(enemy_box.rotation_radians, 0.25);
        assert!(!enemy_box.is_trigger);

        let mut vertices =
            [Transform2D { x: 0.0, y: 0.0 }; crate::components::MAX_CONVEX_POLYGON_VERTICES];
        vertices[0] = Transform2D { x: -3.0, y: -2.0 };
        vertices[1] = Transform2D { x: 3.0, y: -2.0 };
        vertices[2] = Transform2D { x: 0.0, y: 3.0 };
        assert!(scene.set_prefab_collider(
            &mut world,
            2,
            EntityTemplateCollider {
                shape: EntityTemplateColliderShape::ConvexPolygon {
                    vertices,
                    vertex_count: 3,
                    rotation_radians: 0.1,
                },
                half_width: 0.0,
                half_height: 0.0,
                offset_x: -1.0,
                offset_y: 0.5,
                enabled: true,
                is_trigger: true,
                material: None,
            },
        ));
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
        let bullet = (0..world.alive.len())
            .find(|index| world.collider_layer_at(*index) == Some(CollisionLayer::Bullet))
            .unwrap();
        let bullet_polygon = world.convex_polygon_colliders[bullet].unwrap();
        assert_eq!(bullet_polygon.vertex_count, 3);
        assert_eq!(bullet_polygon.offset_x, -1.0);
        assert_eq!(bullet_polygon.rotation_radians, 0.1);
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

        scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

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

        scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

        let velocity = world.velocities[enemy.id as usize].unwrap();
        assert!(velocity.vx > 0.0);
        assert!(velocity.vy.abs() < 0.01);
    }

    #[test]
    fn enemy_behavior_orbit_moves_enemy_around_player() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_enemy_behavior(
            &mut world,
            &mut camera,
            &mut audio_events,
            EnemyBehavior::Orbit,
        );
        let player = world.player.unwrap();
        world.transforms[player.id as usize] = Some(Transform2D { x: 100.0, y: 100.0 });
        let enemy = world.spawn_enemy(280.0, 100.0, DEFAULT_TEXTURE_ID);

        scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

        let velocity = world.velocities[enemy.id as usize].unwrap();
        assert!(velocity.vx.abs() < 0.01);
        assert!(velocity.vy > 0.0);
    }

    #[test]
    fn enemy_behavior_orbit_uses_configured_radius() {
        let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
        scene.set_config(
            &mut world,
            &mut camera,
            &mut audio_events,
            ShooterConfig::default()
                .with_enemy_behavior(EnemyBehavior::Orbit)
                .with_orbit(220.0, 0.0),
        );
        let player = world.player.unwrap();
        world.transforms[player.id as usize] = Some(Transform2D { x: 100.0, y: 100.0 });
        let enemy = world.spawn_enemy(280.0, 100.0, DEFAULT_TEXTURE_ID);

        scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

        let velocity = world.velocities[enemy.id as usize].unwrap();
        assert!(velocity.vx > 0.0);
        assert!(velocity.vy > 0.0);
    }

    #[test]
    fn enemy_behavior_chase_uses_tilemap_navigation_waypoint() {
        let (mut scene, mut world, _, _) = playing_scene();
        let player = world.player.unwrap();
        world.transforms[player.id as usize] = Some(Transform2D { x: 25.0, y: 5.0 });
        let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(
            0,
            3,
            3,
            10.0,
            10.0,
            0.0,
            0.0,
            true,
            vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
        );

        scene.update_enemy_velocity(&mut world, &tilemap, 0.0);

        let velocity = world.velocities[enemy.id as usize].unwrap();
        assert!(velocity.vx.abs() < 0.01);
        assert!(velocity.vy > 0.0);
    }

    #[test]
    fn enemy_behavior_chase_reuses_navigation_waypoint_until_repath_interval() {
        let (mut scene, mut world, _, _) = playing_scene();
        let player = world.player.unwrap();
        world.transforms[player.id as usize] = Some(Transform2D { x: 25.0, y: 5.0 });
        let enemy = world.spawn_enemy(5.0, 5.0, DEFAULT_TEXTURE_ID);
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(
            0,
            3,
            3,
            10.0,
            10.0,
            0.0,
            0.0,
            true,
            vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
        );

        scene.update_enemy_velocity(&mut world, &tilemap, 0.0);
        scene.update_enemy_velocity(
            &mut world,
            &Tilemap::default(),
            NAVIGATION_REPATH_INTERVAL * 0.5,
        );

        let cached_velocity = world.velocities[enemy.id as usize].unwrap();
        assert!(cached_velocity.vx.abs() < 0.01);
        assert!(cached_velocity.vy > 0.0);

        scene.update_enemy_velocity(&mut world, &Tilemap::default(), NAVIGATION_REPATH_INTERVAL);

        let repathed_velocity = world.velocities[enemy.id as usize].unwrap();
        assert!(repathed_velocity.vx > 0.0);
        assert!(repathed_velocity.vy.abs() < 0.01);
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
    fn wave_config_applies_spawn_preset_values() {
        let (mut scene, mut world, _, _) = playing_scene();
        scene.set_wave_config(
            0,
            ShooterWaveConfig::from_values(
                10.0,
                0.5,
                2,
                42.0,
                EnemyBehavior::Static,
                EnemySpawnPattern::Center,
                5.0,
                11,
            ),
        );
        scene.enemy_spawn_timer = 0.0;

        scene.spawn_enemy_if_needed(&mut world);

        let enemy = world
            .colliders
            .iter()
            .enumerate()
            .find(|(_, collider)| collider.is_some_and(|c| c.layer == CollisionLayer::Enemy))
            .map(|(index, _)| index)
            .unwrap();
        assert_eq!(world.transforms[enemy].unwrap().x, 800.0);
        assert_eq!(world.transforms[enemy].unwrap().y, 480.0);
        assert_eq!(world.healths[enemy], Some(5.0));
        assert_eq!(world.score_rewards[enemy], Some(11));

        scene.update_enemy_velocity(&mut world, &Tilemap::default(), 0.0);

        assert_eq!(world.velocities[enemy], Some(Velocity::default()));
    }

    #[test]
    fn wave_config_limits_spawn_count_and_cycles() {
        let (mut scene, mut world, _, _) = playing_scene();
        scene.set_wave_config(
            0,
            ShooterWaveConfig::from_values(
                10.0,
                0.25,
                1,
                72.0,
                EnemyBehavior::Chase,
                EnemySpawnPattern::Center,
                1.0,
                1,
            ),
        );
        scene.set_wave_config(
            1,
            ShooterWaveConfig::from_values(
                10.0,
                0.25,
                1,
                72.0,
                EnemyBehavior::Chase,
                EnemySpawnPattern::Corners,
                1.0,
                1,
            ),
        );
        scene.enemy_spawn_timer = 0.0;

        scene.spawn_enemy_if_needed(&mut world);
        assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);

        scene.spawn_enemy_if_needed(&mut world);
        assert_eq!(count_layer(&world, CollisionLayer::Enemy), 1);

        scene.advance_wave_if_needed();
        scene.enemy_spawn_timer = 0.0;
        scene.spawn_enemy_if_needed(&mut world);

        assert_eq!(count_layer(&world, CollisionLayer::Enemy), 2);
        assert_eq!(scene.active_wave_index, 1);
    }

    #[test]
    fn audio_policy_controls_event_volume_and_pitch() {
        let (mut scene, mut world, camera, mut audio_events) = playing_scene();
        scene.set_audio_policy(ShooterAudioPolicy::from_values(
            0.2, 1.2, 0.5, 0.9, 0.8, 0.7,
        ));
        scene.set_sound_ids(10, 20, 30);
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

        assert_eq!(audio_events[0].sound_id as u32, 10);
        assert_eq!(audio_events[0].volume, 0.2);
        assert_eq!(audio_events[0].pitch, 1.2);
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
        assert_eq!(audio_events[0].volume, DEFAULT_SHOOT_VOLUME);
    }

    #[test]
    fn bullet_enemy_collision_pushes_hit_audio_event() {
        let (mut scene, mut world, _, mut audio_events) = playing_scene();
        scene.set_sound_ids(10, 20, 30);
        let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);

        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

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

        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);
        scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

        assert_eq!(scene.game_state(), GameState::GameOver);
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, 30);

        audio_events.clear();
        assert!(audio_events.is_empty());
    }
}
