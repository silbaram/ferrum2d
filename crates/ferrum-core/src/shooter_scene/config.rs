use crate::camera::CameraPresetConfig;
use crate::components::CollisionLayer;
use crate::gameplay::DefaultMovementPatternKind;
use crate::world::{
    EntityTemplate, EntityTemplateCollider, DEFAULT_BULLET_TEMPLATE, DEFAULT_ENEMY_TEMPLATE,
    DEFAULT_PLAYER_TEMPLATE,
};

use super::{
    DEFAULT_BULLET_DAMAGE, DEFAULT_BULLET_LIFETIME, DEFAULT_BULLET_SPEED, DEFAULT_ENEMY_HEALTH,
    DEFAULT_ENEMY_SPAWN_INTERVAL, DEFAULT_ENEMY_SPEED, DEFAULT_FIRE_COOLDOWN,
    DEFAULT_GAME_OVER_VOLUME, DEFAULT_HIT_VOLUME, DEFAULT_ORBIT_RADIAL_BAND, DEFAULT_ORBIT_RADIUS,
    DEFAULT_PLAYER_SPEED, DEFAULT_SCORE_REWARD, DEFAULT_SHOOT_VOLUME, DEFAULT_SOUND_ID,
    DEFAULT_SOUND_PITCH, DEFAULT_TEXTURE_ID, DEFAULT_WORLD_HEIGHT, DEFAULT_WORLD_WIDTH,
};

mod animation;
mod numbers;
mod templates;

pub(super) use animation::sprite_frames_from_values;
use animation::{apply_animation_or_default, sprite_animation_or_none};
pub(super) use numbers::{finite_or_default, non_negative_or_default, positive_or_default};
use templates::{template_or_default, template_with_collider_or_default};

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

    pub(crate) const fn default_movement_pattern_kind(self) -> DefaultMovementPatternKind {
        match self {
            Self::Chase => DefaultMovementPatternKind::ChasePlayer,
            Self::Drift => DefaultMovementPatternKind::MoveToWorldCenter,
            Self::Static => DefaultMovementPatternKind::Static,
            Self::Orbit => DefaultMovementPatternKind::OrbitPlayer,
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ShooterProjectileArcConfig {
    pub enabled: bool,
    pub launch_height: f32,
    pub z_velocity: f32,
    pub gravity: f32,
    pub hit_height: f32,
}

impl Default for ShooterProjectileArcConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            launch_height: 0.0,
            z_velocity: 0.0,
            gravity: 0.0,
            hit_height: 0.0,
        }
    }
}

impl ShooterProjectileArcConfig {
    pub fn from_values(
        enabled: bool,
        launch_height: f32,
        z_velocity: f32,
        gravity: f32,
        hit_height: f32,
    ) -> Self {
        Self {
            enabled,
            launch_height: non_negative_or_default(launch_height, 0.0),
            z_velocity: finite_or_default(z_velocity, 0.0),
            gravity: non_negative_or_default(gravity, 0.0),
            hit_height: non_negative_or_default(hit_height, 0.0),
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

    pub(crate) const fn code(self) -> u32 {
        match self {
            Self::Player => 0,
            Self::Enemy => 1,
            Self::Bullet => 2,
        }
    }

    const fn default_component_bucket(self) -> ShooterPrefabComponentBucket {
        match self {
            Self::Player => ShooterPrefabComponentBucket::player_config(),
            Self::Enemy => ShooterPrefabComponentBucket::enemy_config(),
            Self::Bullet => ShooterPrefabComponentBucket::bullet_config(),
        }
    }
}

const MAX_SHOOTER_PREFAB_REGISTRATIONS: usize = 8;
const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_STRIDE: usize = 6;
pub(crate) const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S: usize =
    MAX_SHOOTER_PREFAB_REGISTRATIONS * SHOOTER_PREFAB_REGISTRY_SNAPSHOT_STRIDE;
const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_PREFAB_ID_FIELD: usize = 0;
const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_KIND_FIELD: usize = 1;
const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_LAYER_FIELD: usize = 2;
const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_TEMPLATE_FIELD: usize = 3;
const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_TEXTURE_FIELD: usize = 4;
const SHOOTER_PREFAB_REGISTRY_SNAPSHOT_GAMEPLAY_FIELD: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShooterPrefabLayerSlot {
    Player,
    Enemy,
    Bullet,
}

impl ShooterPrefabLayerSlot {
    const fn code(self) -> u32 {
        match self {
            Self::Player => 0,
            Self::Enemy => 1,
            Self::Bullet => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShooterPrefabTemplateSlot {
    Player,
    Enemy,
    Bullet,
}

impl ShooterPrefabTemplateSlot {
    const fn code(self) -> u32 {
        match self {
            Self::Player => 0,
            Self::Enemy => 1,
            Self::Bullet => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShooterPrefabTextureSlot {
    Player,
    Enemy,
    Bullet,
}

impl ShooterPrefabTextureSlot {
    const fn code(self) -> u32 {
        match self {
            Self::Player => 0,
            Self::Enemy => 1,
            Self::Bullet => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShooterPrefabGameplaySlot {
    None,
    EnemyCombatConfig,
}

impl ShooterPrefabGameplaySlot {
    const fn code(self) -> u32 {
        match self {
            Self::None => 0,
            Self::EnemyCombatConfig => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShooterPrefabComponentBucket {
    pub(crate) layer: ShooterPrefabLayerSlot,
    pub(crate) template: ShooterPrefabTemplateSlot,
    pub(crate) texture: ShooterPrefabTextureSlot,
    pub(crate) gameplay: ShooterPrefabGameplaySlot,
}

impl ShooterPrefabComponentBucket {
    pub(crate) const fn player_config() -> Self {
        Self {
            layer: ShooterPrefabLayerSlot::Player,
            template: ShooterPrefabTemplateSlot::Player,
            texture: ShooterPrefabTextureSlot::Player,
            gameplay: ShooterPrefabGameplaySlot::None,
        }
    }

    pub(crate) const fn enemy_config() -> Self {
        Self {
            layer: ShooterPrefabLayerSlot::Enemy,
            template: ShooterPrefabTemplateSlot::Enemy,
            texture: ShooterPrefabTextureSlot::Enemy,
            gameplay: ShooterPrefabGameplaySlot::EnemyCombatConfig,
        }
    }

    pub(crate) const fn bullet_config() -> Self {
        Self {
            layer: ShooterPrefabLayerSlot::Bullet,
            template: ShooterPrefabTemplateSlot::Bullet,
            texture: ShooterPrefabTextureSlot::Bullet,
            gameplay: ShooterPrefabGameplaySlot::None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShooterPrefabRegistration {
    pub(crate) prefab_id: u32,
    pub(crate) kind: ShooterPrefabKind,
    pub(crate) components: ShooterPrefabComponentBucket,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ShooterPrefabResolvedComponents {
    pub(crate) kind: ShooterPrefabKind,
    pub(crate) layer: CollisionLayer,
    pub(crate) texture: ShooterPrefabTextureSlot,
    pub(crate) template: EntityTemplate,
    pub(crate) health: Option<f32>,
    pub(crate) score_reward: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShooterPrefabRegistry {
    registrations: [Option<ShooterPrefabRegistration>; MAX_SHOOTER_PREFAB_REGISTRATIONS],
}

impl Default for ShooterPrefabRegistry {
    fn default() -> Self {
        let mut registry = Self {
            registrations: [None; MAX_SHOOTER_PREFAB_REGISTRATIONS],
        };
        registry.register(ShooterPrefabKind::Enemy.code(), ShooterPrefabKind::Enemy);
        registry
    }
}

impl ShooterPrefabRegistry {
    pub(crate) fn register(&mut self, prefab_id: u32, kind: ShooterPrefabKind) -> bool {
        self.register_with_components(prefab_id, kind, kind.default_component_bucket())
    }

    pub(crate) fn register_with_components(
        &mut self,
        prefab_id: u32,
        kind: ShooterPrefabKind,
        components: ShooterPrefabComponentBucket,
    ) -> bool {
        if prefab_id == 0 {
            return false;
        }
        if let Some(reserved_kind) = Self::reserved_kind_for_prefab_id(prefab_id) {
            if reserved_kind != kind {
                return false;
            }
        }
        let registration = ShooterPrefabRegistration {
            prefab_id,
            kind,
            components,
        };
        if let Some(slot) = self
            .registrations
            .iter_mut()
            .find(|slot| slot.map(|entry| entry.prefab_id) == Some(prefab_id))
        {
            if slot.map(|entry| entry.kind) != Some(kind) {
                return false;
            }
            *slot = Some(registration);
            return true;
        }
        if let Some(slot) = self.registrations.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(registration);
            return true;
        }
        false
    }

    fn reserved_kind_for_prefab_id(prefab_id: u32) -> Option<ShooterPrefabKind> {
        if prefab_id == ShooterPrefabKind::Enemy.code() {
            Some(ShooterPrefabKind::Enemy)
        } else if prefab_id == ShooterPrefabKind::Bullet.code() {
            Some(ShooterPrefabKind::Bullet)
        } else {
            None
        }
    }

    pub(crate) fn resolve(&self, prefab_id: u32) -> Option<ShooterPrefabRegistration> {
        self.registrations
            .iter()
            .filter_map(|registration| *registration)
            .find(|registration| registration.prefab_id == prefab_id)
    }

    pub(crate) fn write_snapshot(&self, output: &mut [u32]) -> bool {
        if output.len() < SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S {
            return false;
        }
        output[..SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S].fill(0);
        for (slot, registration) in self.registrations.iter().copied().enumerate() {
            let Some(registration) = registration else {
                continue;
            };
            let base = slot * SHOOTER_PREFAB_REGISTRY_SNAPSHOT_STRIDE;
            output[base + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_PREFAB_ID_FIELD] =
                registration.prefab_id;
            output[base + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_KIND_FIELD] = registration.kind.code();
            output[base + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_LAYER_FIELD] =
                registration.components.layer.code();
            output[base + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_TEMPLATE_FIELD] =
                registration.components.template.code();
            output[base + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_TEXTURE_FIELD] =
                registration.components.texture.code();
            output[base + SHOOTER_PREFAB_REGISTRY_SNAPSHOT_GAMEPLAY_FIELD] =
                registration.components.gameplay.code();
        }
        true
    }

    pub(crate) fn matches_snapshot(&self, snapshot: &[u32]) -> bool {
        if snapshot.len() < SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S {
            return false;
        }
        let mut expected = [0; SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S];
        self.write_snapshot(&mut expected)
            && expected == snapshot[..SHOOTER_PREFAB_REGISTRY_SNAPSHOT_U32S]
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
    pub projectile_arc: ShooterProjectileArcConfig,
    pub camera: CameraPresetConfig,
    pub audio_policy: ShooterAudioPolicy,
    pub prefab_registry: ShooterPrefabRegistry,
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
            projectile_arc: ShooterProjectileArcConfig::default(),
            camera: CameraPresetConfig::default(),
            audio_policy: ShooterAudioPolicy::default(),
            prefab_registry: ShooterPrefabRegistry::default(),
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

    pub fn with_projectile_arc(mut self, projectile_arc: ShooterProjectileArcConfig) -> Self {
        self.projectile_arc = projectile_arc;
        self
    }

    pub(crate) fn register_spawn_prefab(
        &mut self,
        prefab_id: u32,
        kind: ShooterPrefabKind,
    ) -> bool {
        self.prefab_registry.register(prefab_id, kind)
    }

    pub(crate) fn resolve_spawn_prefab(&self, prefab_id: u32) -> Option<ShooterPrefabRegistration> {
        self.prefab_registry.resolve(prefab_id)
    }

    pub(crate) fn write_prefab_registry_snapshot(&self, output: &mut [u32]) -> bool {
        self.prefab_registry.write_snapshot(output)
    }

    pub(crate) fn prefab_registry_snapshot_matches(&self, snapshot: &[u32]) -> bool {
        self.prefab_registry.matches_snapshot(snapshot)
    }

    pub(crate) fn resolve_builtin_prefab_components(
        &self,
        kind: ShooterPrefabKind,
    ) -> ShooterPrefabResolvedComponents {
        self.resolve_spawn_prefab_components(ShooterPrefabRegistration {
            prefab_id: kind.code(),
            kind,
            components: kind.default_component_bucket(),
        })
    }

    pub(crate) fn resolve_spawn_prefab_components(
        &self,
        registration: ShooterPrefabRegistration,
    ) -> ShooterPrefabResolvedComponents {
        let bucket = registration.components;
        let (health, score_reward) = match bucket.gameplay {
            ShooterPrefabGameplaySlot::None => (None, None),
            ShooterPrefabGameplaySlot::EnemyCombatConfig => {
                (Some(self.enemy_health), Some(self.score_reward))
            }
        };
        ShooterPrefabResolvedComponents {
            kind: registration.kind,
            layer: self.prefab_layer_for_slot(bucket.layer),
            texture: bucket.texture,
            template: self.prefab_template_for_slot(bucket.template),
            health,
            score_reward,
        }
    }

    fn prefab_template_for_slot(&self, slot: ShooterPrefabTemplateSlot) -> EntityTemplate {
        match slot {
            ShooterPrefabTemplateSlot::Player => self.player_template,
            ShooterPrefabTemplateSlot::Enemy => self.enemy_template,
            ShooterPrefabTemplateSlot::Bullet => self.bullet_template,
        }
    }

    const fn prefab_layer_for_slot(&self, slot: ShooterPrefabLayerSlot) -> CollisionLayer {
        match slot {
            ShooterPrefabLayerSlot::Player => CollisionLayer::Player,
            ShooterPrefabLayerSlot::Enemy => CollisionLayer::Enemy,
            ShooterPrefabLayerSlot::Bullet => CollisionLayer::Bullet,
        }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextureIds {
    pub(super) player: u32,
    pub(super) enemy: u32,
    pub(super) bullet: u32,
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
    pub(super) shoot: u32,
    pub(super) hit: u32,
    pub(super) game_over: u32,
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

#[cfg(test)]
mod prefab_registry_tests {
    use super::*;

    #[test]
    fn rejects_reserved_prefab_id_kind_mismatches() {
        let mut registry = ShooterPrefabRegistry::default();

        assert!(!registry.register(ShooterPrefabKind::Enemy.code(), ShooterPrefabKind::Bullet));
        assert_eq!(
            registry
                .resolve(ShooterPrefabKind::Enemy.code())
                .map(|registration| registration.kind),
            Some(ShooterPrefabKind::Enemy)
        );

        assert!(!registry.register(ShooterPrefabKind::Bullet.code(), ShooterPrefabKind::Enemy));
        assert_eq!(registry.resolve(ShooterPrefabKind::Bullet.code()), None);
    }

    #[test]
    fn rejects_existing_prefab_id_kind_changes() {
        let mut registry = ShooterPrefabRegistry::default();

        assert!(registry.register(7, ShooterPrefabKind::Enemy));
        assert!(!registry.register(7, ShooterPrefabKind::Bullet));
        assert_eq!(
            registry.resolve(7).map(|registration| registration.kind),
            Some(ShooterPrefabKind::Enemy)
        );
    }
}
