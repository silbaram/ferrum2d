impl ShooterScene {
    pub(crate) fn progress(&self) -> (u32, f32, u32) {
        (
            self.active_wave_index as u32,
            self.wave_elapsed_seconds,
            self.wave_spawned_count,
        )
    }

    pub(crate) fn file_resource_spawn_lengths(&self) -> [usize; 2] {
        [self.pending_spawns.len(), self.spawn_commands.len()]
    }
    /// queue0=pending, queue1=drained; branch0=projectile, branch1=prefab base,
    /// branch2=its nested projectile. Commands own IDs captured before later
    /// catalog changes. No current-catalog resolution or queue consumption.
    pub(crate) fn visit_file_resource_spawns<E>(
        &self,
        visit: &mut impl FnMut(usize, usize, u32, Option<Entity>, u32, Option<u32>) -> Result<(), E>,
    ) -> Result<(), E> {
        for (queue, commands) in [&self.pending_spawns, &self.spawn_commands]
            .into_iter()
            .enumerate()
        {
            for (ordinal, command) in commands.iter().enumerate() {
                match command {
                    runtime::ShooterSpawnCommand::Projectile(p) => {
                        visit(queue, ordinal, 0, None, p.texture_id, Some(p.sound_id))?
                    }
                    runtime::ShooterSpawnCommand::Prefab(p) => {
                        visit(queue, ordinal, 1, Some(p.source), p.texture_id, None)?;
                        if let Some(nested) = &p.projectile {
                            visit(
                                queue,
                                ordinal,
                                2,
                                Some(p.source),
                                nested.texture_id,
                                Some(nested.sound_id),
                            )?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
impl ShooterScene {
    /// Boundary fixture uses actual constructor/queue/transfer producers. It is
    /// not claimed to be a public Engine checkpoint interrupted mid-tick.
    pub(crate) fn seed_file_resource_pending_fixture(&mut self, world: &World, source: Entity) {
        use crate::components::gameplay::{
            ActionAimSource, ProjectileCollisionTarget, ProjectileTileImpact, SpawnAnchor,
            SpawnPhase, SpawnPrefabProjectilePayload,
        };
        use crate::gameplay::SpawnPrefabActionPayload;
        self.seed_builtin_captured_finite_action_fixture(world, source);
        let base = SpawnPrefabActionPayload {
            prefab_id: ShooterPrefabKind::Enemy.code(),
            projectile: None,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: 0.,
            offset_y: 0.,
        };
        let command = self.spawn_prefab_command(world, source, 41, base).unwrap();
        self.queue_prefab_spawn(command).unwrap();
        assert!(self.register_spawn_prefab_kind(9, ShooterPrefabKind::Bullet));
        let bullet = self
            .spawn_prefab_command(
                world,
                source,
                42,
                SpawnPrefabActionPayload {
                    prefab_id: 9,
                    projectile: Some(SpawnPrefabProjectilePayload {
                        speed: 10.,
                        damage: 1.,
                        lifetime_seconds: 1.,
                        aim: ActionAimSource::TargetPlayer,
                        collision_target: ProjectileCollisionTarget::Player,
                        tile_impact: ProjectileTileImpact::Despawn,
                    }),
                    ..base
                },
            )
            .unwrap();
        self.queue_prefab_spawn(bullet).unwrap();
        crate::gameplay::drain_deferred_commands_into(
            &mut self.pending_spawns,
            &mut self.spawn_commands,
        );
        self.seed_builtin_captured_finite_action_fixture(world, source);
    }
}

impl ShooterScene {
    /// Copies only the two stored catalogs. No prefab resolution/spawn/reset.
    pub(crate) fn file_resource_catalog(&self) -> ([u32; 3], [u32; 3]) {
        (
            [
                self.texture_ids.player,
                self.texture_ids.enemy,
                self.texture_ids.bullet,
            ],
            [
                self.sound_ids.shoot,
                self.sound_ids.hit,
                self.sound_ids.game_over,
            ],
        )
    }
}

mod file_admission;
use crate::audio_event::AudioEvent;
use crate::camera::{Camera2D, CameraPresetConfig};
use crate::collision::{CircleQueryHit, CollisionPair, CollisionScratch};
use crate::components::gameplay::GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S;
use crate::components::{CollisionLayer, SpriteAnimation, SpriteFrame};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::gameplay::{ActionTriggerQueue, CollisionContactTracker, MovementNavigationTargetCache};
use crate::gameplay_variables::GAMEPLAY_VARIABLE_SNAPSHOT_U32S;
use crate::input::{InputState, INPUT_ACTION_REGISTRY_SNAPSHOT_U32S};
use crate::tilemap::{TilemapContactHit, TilemapNavigationScratch};
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
pub(crate) const SHOOTER_PRIMARY_FIRE_ACTION_ID: u32 = 1;
pub(crate) const SHOOTER_DASH_ACTION_ID: u32 = 2;
pub(crate) const SHOOTER_MELEE_ACTION_ID: u32 = 3;
const MAX_AUTHORED_COLLISION_CONTACTS: usize = 1024;
pub const SHOOTER_SNAPSHOT_VERSION: u32 = 19;
pub const SHOOTER_SNAPSHOT_HEADER_FLOATS: usize = 8;
pub(crate) const SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET: usize = 9;
const SHOOTER_SNAPSHOT_PREVIOUS_INPUT_EXTRA_U32S: usize = 4;
pub(crate) const SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET: usize =
    SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
        + INPUT_ACTION_REGISTRY_SNAPSHOT_U32S
        + SHOOTER_SNAPSHOT_PREVIOUS_INPUT_EXTRA_U32S
        + config::GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_U32S
        + GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S;
pub const SHOOTER_SNAPSHOT_HEADER_U32S: usize =
    SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET + GAMEPLAY_VARIABLE_SNAPSHOT_U32S;
pub const SHOOTER_SNAPSHOT_ENTITY_FLOATS: usize = 131;
pub const SHOOTER_SNAPSHOT_ENTITY_U32S: usize = 117;
pub const SHOOTER_SNAPSHOT_ENTITY_PLAYER: u32 = 0;
pub const SHOOTER_SNAPSHOT_ENTITY_ENEMY: u32 = 1;
pub const SHOOTER_SNAPSHOT_ENTITY_BULLET: u32 = 2;
const DEFAULT_ORBIT_RADIUS: f32 = 180.0;
const DEFAULT_ORBIT_RADIAL_BAND: f32 = 24.0;
const ENEMY_HIT_FLASH_TINT: SpriteTint = SpriteTint::new(1.0, 0.88, 0.38, 1.0);
const ENEMY_HIT_FLASH_SECONDS: f32 = 0.12;

mod config;
mod runtime;
pub(crate) mod snapshot;

use config::{
    finite_or_default, non_negative_or_default, positive_or_default, sprite_frames_from_values,
    SoundIds, TextureIds,
};
pub(crate) use config::{
    EnemyBehavior, EnemySpawnPattern, GameplayPrefabRegistration, GameplayPrefabResolvedComponents,
    ShooterAudioPolicy, ShooterConfig, ShooterPrefabKind, ShooterPrefabTextureSlot,
    ShooterProjectileArcConfig, ShooterWaveConfig,
};
pub(crate) use runtime::{ParticleBurstSink, TweenSink};
pub use snapshot::{ShooterEntitySnapshot, ShooterSceneSnapshot};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct ShooterCollisionPairStats {
    pub(crate) bullet_enemy_swept_pairs: usize,
    pub(crate) bullet_enemy_moving_proxies: usize,
    pub(crate) bullet_enemy_target_proxies: usize,
    pub(crate) bullet_player_swept_pairs: usize,
    pub(crate) bullet_player_moving_proxies: usize,
    pub(crate) bullet_player_target_proxies: usize,
    pub(crate) player_enemy_pairs: usize,
    pub(crate) player_enemy_current_proxies: usize,
    pub(crate) player_pickup_pairs: usize,
    pub(crate) player_pickup_current_proxies: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShooterScene {
    score: u32,
    fire_cooldown_seconds: f32,
    enemy_spawn_timer: f32,
    previous_space: u8,
    previous_enter: u8,
    previous_mouse_left: u8,
    previous_input: InputState,
    game_state: GameState,
    spawn_index: u32,
    texture_ids: TextureIds,
    sound_ids: SoundIds,
    config: ShooterConfig,
    #[serde(with = "crate::checkpoint_codec::vector")]
    waves: Vec<ShooterWaveConfig>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    wave_action_triggers: Vec<Option<runtime::WaveActionTrigger>>,
    active_wave_index: usize,
    wave_elapsed_seconds: f32,
    wave_spawned_count: u32,
    camera_elapsed_seconds: f32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    navigation_targets: Vec<Option<MovementNavigationTargetCache>>,
    navigation_scratch: TilemapNavigationScratch,
    collision_scratch: CollisionScratch,
    #[serde(with = "crate::checkpoint_codec::vector")]
    collision_pairs: Vec<CollisionPair>,
    authored_collision_contacts: CollisionContactTracker,
    last_action_trigger_phase_result: runtime::ActionTriggerPhaseProcessResult,
    last_spawn_flush_result: runtime::SpawnFlushResult,
    #[serde(with = "crate::checkpoint_codec::vector")]
    melee_hits: Vec<CircleQueryHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    area_damage_hits: Vec<CircleQueryHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    spawn_obstacle_contacts: Vec<TilemapContactHit>,
    action_triggers: ActionTriggerQueue<runtime::ActionTriggerCommand>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    action_trigger_commands: Vec<runtime::ActionTriggerCommand>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending_spawns: Vec<runtime::ShooterSpawnCommand>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    spawn_commands: Vec<runtime::ShooterSpawnCommand>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending_melee_attacks: Vec<runtime::MeleeAttackCommand>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    melee_attack_commands: Vec<runtime::MeleeAttackCommand>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending_despawn: Vec<Entity>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    marked_for_despawn: Vec<bool>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    bounced_projectiles_this_frame: Vec<bool>,
    last_collision_pair_stats: ShooterCollisionPairStats,
}

impl Default for ShooterScene {
    fn default() -> Self {
        Self {
            score: 0,
            fire_cooldown_seconds: 0.0,
            enemy_spawn_timer: DEFAULT_ENEMY_SPAWN_INTERVAL,
            previous_space: 0,
            previous_enter: 0,
            previous_mouse_left: 0,
            previous_input: InputState::default(),
            game_state: GameState::Title,
            spawn_index: 0,
            texture_ids: TextureIds::default(),
            sound_ids: SoundIds::default(),
            config: ShooterConfig::default(),
            waves: Vec::new(),
            wave_action_triggers: Vec::new(),
            active_wave_index: 0,
            wave_elapsed_seconds: 0.0,
            wave_spawned_count: 0,
            camera_elapsed_seconds: 0.0,
            navigation_targets: Vec::with_capacity(256),
            navigation_scratch: TilemapNavigationScratch::default(),
            collision_scratch: CollisionScratch::default(),
            collision_pairs: Vec::with_capacity(256),
            authored_collision_contacts: CollisionContactTracker::with_capacity(
                MAX_AUTHORED_COLLISION_CONTACTS,
            ),
            last_action_trigger_phase_result: runtime::ActionTriggerPhaseProcessResult::default(),
            last_spawn_flush_result: runtime::SpawnFlushResult::default(),
            melee_hits: Vec::with_capacity(16),
            area_damage_hits: Vec::with_capacity(16),
            spawn_obstacle_contacts: Vec::with_capacity(8),
            action_triggers: ActionTriggerQueue::with_capacity(64),
            action_trigger_commands: Vec::with_capacity(64),
            pending_spawns: Vec::with_capacity(64),
            spawn_commands: Vec::with_capacity(64),
            pending_melee_attacks: Vec::with_capacity(8),
            melee_attack_commands: Vec::with_capacity(8),
            pending_despawn: Vec::with_capacity(128),
            marked_for_despawn: Vec::with_capacity(256),
            bounced_projectiles_this_frame: Vec::with_capacity(256),
            last_collision_pair_stats: ShooterCollisionPairStats::default(),
        }
    }
}

impl ShooterScene {
    pub fn new() -> Self {
        Self::default()
    }

    #[cfg(test)]
    pub(crate) fn last_collision_pair_stats(&self) -> ShooterCollisionPairStats {
        self.last_collision_pair_stats
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
        self.previous_mouse_left = 0;
        self.previous_input = InputState::default();
        self.spawn_index = 0;
        self.reset_wave_state();
        self.camera_elapsed_seconds = 0.0;
        self.navigation_targets.clear();
        self.collision_pairs.clear();
        self.authored_collision_contacts.clear();
        self.clear_deferred_runtime_state();
        audio_events.clear();
        world.reset_preserving_gameplay_variables();
        world.spawn_player_from_template(
            self.config.world_width * 0.5,
            self.config.world_height * 0.5,
            self.texture_ids.player,
            self.config.player_template,
        );
        self.update_camera_follow(world, camera);
    }

    pub(crate) fn clear_deferred_runtime_state(&mut self) {
        self.last_action_trigger_phase_result = runtime::ActionTriggerPhaseProcessResult::default();
        self.last_spawn_flush_result = runtime::SpawnFlushResult::default();
        self.wave_action_triggers.clear();
        self.action_triggers.clear();
        self.action_trigger_commands.clear();
        self.pending_spawns.clear();
        self.spawn_commands.clear();
        self.pending_melee_attacks.clear();
        self.melee_attack_commands.clear();
        self.pending_despawn.clear();
        self.marked_for_despawn.clear();
        self.bounced_projectiles_this_frame.clear();
    }

    #[cfg(test)]
    pub(crate) fn seed_deferred_runtime_state_for_test(&mut self) {
        self.fill_pending_spawns_for_test();
        self.pending_despawn.push(Entity {
            id: 1,
            generation: 0,
        });
    }

    #[cfg(test)]
    pub(crate) fn deferred_runtime_state_counts_for_test(&self) -> (usize, usize) {
        (self.pending_spawns.len(), self.pending_despawn.len())
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
        self.wave_action_triggers.clear();
        self.reset_wave_state();
    }

    pub fn set_wave_config(&mut self, index: u32, wave: ShooterWaveConfig) {
        let index = index as usize;
        if index >= self.waves.len() {
            self.waves.resize(index + 1, wave);
        }
        self.waves[index] = wave;
        if index >= self.wave_action_triggers.len() {
            self.wave_action_triggers.resize(index + 1, None);
        }
        self.reset_wave_state();
    }

    pub fn set_audio_policy(&mut self, audio_policy: ShooterAudioPolicy) {
        self.config = self.config.with_audio_policy(audio_policy);
    }

    pub(crate) fn register_spawn_prefab_kind(
        &mut self,
        prefab_id: u32,
        kind: ShooterPrefabKind,
    ) -> bool {
        if prefab_id == 0 {
            return false;
        }
        self.config.register_spawn_prefab(prefab_id, kind)
    }

    pub(crate) fn resolve_spawn_prefab_registration(
        &self,
        prefab_id: u32,
    ) -> Option<GameplayPrefabRegistration> {
        self.config.resolve_spawn_prefab(prefab_id)
    }

    pub(crate) fn resolve_spawn_prefab_components(
        &self,
        registration: GameplayPrefabRegistration,
    ) -> GameplayPrefabResolvedComponents {
        self.config.resolve_spawn_prefab_components(registration)
    }

    pub(crate) fn resolve_builtin_prefab_components(
        &self,
        kind: ShooterPrefabKind,
    ) -> GameplayPrefabResolvedComponents {
        self.config.resolve_builtin_prefab_components(kind)
    }

    pub(crate) fn supports_spawn_prefab_id(&self, prefab_id: u32) -> bool {
        self.resolve_spawn_prefab_registration(prefab_id)
            .map(|registration| self.resolve_spawn_prefab_components(registration).layer)
            == Some(CollisionLayer::Enemy)
    }

    pub(crate) fn supports_projectile_prefab_id(&self, prefab_id: u32) -> bool {
        self.resolve_spawn_prefab_registration(prefab_id)
            .map(|registration| self.resolve_spawn_prefab_components(registration).layer)
            == Some(CollisionLayer::Bullet)
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

    pub(crate) fn reset_action_trigger_frame_diagnostics(&mut self) {
        self.last_action_trigger_phase_result = runtime::ActionTriggerPhaseProcessResult::default();
        self.last_spawn_flush_result = runtime::SpawnFlushResult::default();
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn last_spawn_flush_result(&self) -> runtime::SpawnFlushResult {
        self.last_spawn_flush_result
    }

    pub(crate) fn last_action_trigger_attempts(&self) -> usize {
        self.last_action_trigger_phase_result.triggers_processed
    }

    pub(crate) fn last_action_trigger_failures(&self) -> usize {
        self.last_action_trigger_phase_result
            .prepared_dispatch_failures
            .saturating_add(self.last_action_trigger_phase_result.preparation_failures)
    }

    pub(crate) fn last_action_trigger_failure_events_pushed(&self) -> usize {
        self.last_action_trigger_phase_result
            .prepared_dispatch_failure_events_pushed
            .saturating_add(
                self.last_action_trigger_phase_result
                    .preparation_failure_events_pushed,
            )
    }

    pub(crate) fn last_action_trigger_commit_skips(&self) -> usize {
        self.last_action_trigger_phase_result
            .prepared_dispatch_commit_skips
    }

    pub(crate) fn last_prepared_action_trigger_failure_reason_code(&self) -> u32 {
        self.last_action_trigger_phase_result
            .last_prepared_dispatch_failure_reason_code
            .unwrap_or(0)
    }

    pub(crate) fn last_action_trigger_failure_count_for_reason(&self, reason_code: u32) -> usize {
        self.last_action_trigger_phase_result
            .action_failure_count_for_reason(reason_code)
    }

    pub(crate) fn last_spawn_flush_commands_drained(&self) -> usize {
        self.last_spawn_flush_result.commands_drained
    }

    pub(crate) fn last_spawn_flush_projectile_spawns(&self) -> usize {
        self.last_spawn_flush_result.projectile_spawns
    }

    pub(crate) fn last_spawn_flush_projectile_arcs_applied(&self) -> usize {
        self.last_spawn_flush_result.projectile_arcs_applied
    }

    pub(crate) fn last_spawn_flush_projectile_shoot_audio_events_pushed(&self) -> usize {
        self.last_spawn_flush_result
            .projectile_shoot_audio_events_pushed
    }

    pub(crate) fn last_spawn_flush_prefab_spawns(&self) -> usize {
        self.last_spawn_flush_result.prefab_spawns
    }

    pub(crate) fn last_spawn_flush_prefab_spawned_payloads(&self) -> usize {
        self.last_spawn_flush_result.prefab_spawned_payloads
    }

    pub(crate) fn last_spawn_flush_prefab_spawned_events_pushed(&self) -> usize {
        self.last_spawn_flush_result.prefab_spawned_events_pushed
    }

    pub fn game_state(&self) -> GameState {
        self.game_state
    }

    pub(crate) fn config(&self) -> ShooterConfig {
        self.config
    }

    pub fn update_camera_follow(&self, world: &World, camera: &mut Camera2D) {
        let Some(player) = world.primary_actor_entity() else {
            return;
        };
        let Some(player_t) = world.transform(player) else {
            return;
        };
        let player_velocity = world.velocity(player).unwrap_or_default();
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
        let alive_count = world.alive_indices().len();
        for alive_position in 0..alive_count {
            let i = world.alive_indices()[alive_position];
            let Some(layer) = world.collider_layer_at(i) else {
                continue;
            };
            let Some(sprite) = world.sprite_mut_at_index(i) else {
                continue;
            };
            sprite.texture_id = match layer {
                CollisionLayer::Player => self.texture_ids.player,
                CollisionLayer::Enemy => self.texture_ids.enemy,
                CollisionLayer::Bullet => self.texture_ids.bullet,
                CollisionLayer::Wall | CollisionLayer::Pickup => sprite.texture_id,
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
        let alive_count = world.alive_indices().len();
        for alive_position in 0..alive_count {
            let i = world.alive_indices()[alive_position];
            if world.collider_layer_at(i) != Some(layer) {
                continue;
            }
            let Some(entity) = world.entity_at_index(i) else {
                continue;
            };
            world.apply_template_to_entity(entity, texture_id, template);
        }
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
impl ShooterScene {
    pub(crate) fn corrupt_builtin_file_fixture(&mut self, case: usize) {
        match case {
            0 => self.fire_cooldown_seconds = f32::NAN,
            1 => self.active_wave_index = usize::MAX,
            2 => self.config.world_width = f32::NAN,
            3 => self.config.audio_policy.shoot_pitch = f32::INFINITY,
            4 => self.config.projectile_arc.gravity = f32::NAN,
            5 => self.config.camera.shake_frequency = 0.,
            6 => self.config.prefab_registry.corrupt_builtin_file_fixture(0),
            7 => {
                let mut a = SpriteAnimation::horizontal(2, 6.).unwrap();
                a.current_frame = u32::MAX;
                self.config.player_template.animation = Some(a);
            }
            8 | 13 => {
                self.fill_pending_spawns_for_test();
                if case == 13 {
                    self.pending_spawns.push(self.pending_spawns[0]);
                } else if let runtime::ShooterSpawnCommand::Projectile(v) =
                    &mut self.pending_spawns[0]
                {
                    v.velocity.vx = f32::NAN;
                }
            }
            9 => self.navigation_targets.resize(4096, None),
            10 => self.collision_pairs.push(CollisionPair {
                a: Entity {
                    id: 0,
                    generation: 0,
                },
                b: Entity {
                    id: 0,
                    generation: 0,
                },
            }),
            11 => self.config.player_template.collider_half_width = f32::INFINITY,
            12 => self.action_triggers = ActionTriggerQueue::with_capacity(65),
            14 => self
                .pending_melee_attacks
                .push(runtime::MeleeAttackCommand {
                    attacker: Entity {
                        id: 0,
                        generation: 0,
                    },
                    center: crate::components::Transform2D { x: 0., y: 0. },
                    range: 1.,
                    damage: f32::NAN,
                    target: crate::components::gameplay::MeleeTarget::Enemies,
                    height_span: None,
                }),
            15 => {
                self.last_action_trigger_phase_result
                    .last_prepared_dispatch_failure_reason_code = Some(u32::MAX)
            }
            16 => self.config.prefab_registry.corrupt_builtin_file_fixture(1),
            _ => unreachable!(),
        }
    }
}
