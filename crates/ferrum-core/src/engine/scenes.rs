use crate::audio_event::AudioEvent;
use crate::breakout_scene::{
    breakout_brick_hit_particle_preset, BreakoutParticleBurstSink, BreakoutScene,
};
use crate::camera::Camera2D;
use crate::collision_event::{CollisionEvent, CollisionEventCounts};
use crate::effect_event::EffectEvent;
use crate::game_state::GameState;
use crate::gameplay_event::GameplayEvent;
use crate::input::{InputActionRegistry, InputState};
use crate::particles::{ParticlePreset, ParticleSystem};
use crate::physics::PhysicsCounters;
use crate::platformer_scene::{
    platformer_landing_dust_particle_preset, PlatformerParticleBurstSink, PlatformerScene,
};
use crate::shooter_scene::{ParticleBurstSink, ShooterScene, TweenSink};
use crate::tilemap::Tilemap;
use crate::tweens::TweenSystem;
use crate::world::World;

use super::Engine;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum SceneMode {
    #[default]
    BuiltIn,
    Data,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum ActiveScene {
    #[default]
    Shooter,
    Breakout,
    Platformer,
}

pub(super) struct BuiltInSceneSlots {
    active: ActiveScene,
    pub(super) shooter: ShooterScene,
    pub(super) breakout: BreakoutScene,
    pub(super) platformer: PlatformerScene,
}

impl BuiltInSceneSlots {
    pub(super) fn new() -> Self {
        Self {
            active: ActiveScene::Shooter,
            shooter: ShooterScene::new(),
            breakout: BreakoutScene::new(),
            platformer: PlatformerScene::new(),
        }
    }

    pub(super) const fn active(&self) -> ActiveScene {
        self.active
    }

    pub(super) fn use_shooter(&mut self) {
        self.active = ActiveScene::Shooter;
    }

    pub(super) fn use_breakout(&mut self) {
        self.active = ActiveScene::Breakout;
    }

    pub(super) fn use_platformer(&mut self) {
        self.active = ActiveScene::Platformer;
    }

    pub(super) fn update_active(
        &mut self,
        context: &mut SceneUpdateContext<'_>,
        input: InputState,
        delta: f32,
    ) {
        match self.active {
            ActiveScene::Shooter => {
                BuiltInSceneRuntime::update(&mut self.shooter, context, input, delta);
            }
            ActiveScene::Breakout => {
                BuiltInSceneRuntime::update(&mut self.breakout, context, input, delta);
            }
            ActiveScene::Platformer => {
                BuiltInSceneRuntime::update(&mut self.platformer, context, input, delta);
            }
        }
    }

    pub(super) fn reset_playing_active(&mut self, context: &mut SceneResetContext<'_>) {
        match self.active {
            ActiveScene::Shooter => {
                BuiltInSceneRuntime::reset_playing(&mut self.shooter, context);
            }
            ActiveScene::Breakout => {
                BuiltInSceneRuntime::reset_playing(&mut self.breakout, context);
            }
            ActiveScene::Platformer => {
                BuiltInSceneRuntime::reset_playing(&mut self.platformer, context);
            }
        }
    }

    pub(super) fn reset_to_title_active(&mut self, context: &mut SceneResetContext<'_>) {
        match self.active {
            ActiveScene::Shooter => {
                BuiltInSceneRuntime::reset_to_title(&mut self.shooter, context);
            }
            ActiveScene::Breakout => {
                BuiltInSceneRuntime::reset_to_title(&mut self.breakout, context);
            }
            ActiveScene::Platformer => {
                BuiltInSceneRuntime::reset_to_title(&mut self.platformer, context);
            }
        }
    }
}

pub(super) struct DataSceneRuntime {
    score: u32,
    game_state: GameState,
}

impl DataSceneRuntime {
    pub(super) const fn new() -> Self {
        Self {
            score: 0,
            game_state: GameState::Playing,
        }
    }

    pub(super) const fn score(&self) -> u32 {
        self.score
    }

    pub(super) const fn game_state(&self) -> GameState {
        self.game_state
    }

    pub(super) fn reset_playing(&mut self, context: &mut SceneResetContext<'_>) {
        *context.world = World::default();
        self.score = 0;
        self.game_state = GameState::Playing;
    }

    pub(super) fn reset_to_title(&mut self, context: &mut SceneResetContext<'_>) {
        self.reset_playing(context);
    }

    pub(super) fn update(&mut self, context: &mut SceneUpdateContext<'_>, delta: f32) {
        if self.game_state != GameState::Playing {
            return;
        }
        context.world.tick_action_cooldowns(delta);
        context.world.tick_collision_reaction_cooldowns(delta);
        context.world.update(delta);
        context
            .tilemap
            .resolve_dynamic_collisions_with_counters(context.world, context.physics_counters);
    }
}

pub(super) struct SceneRuntimeDispatch<'a> {
    mode: SceneMode,
    built_in: &'a mut BuiltInSceneSlots,
    data: &'a mut DataSceneRuntime,
}

impl<'a> SceneRuntimeDispatch<'a> {
    pub(super) fn new(
        mode: SceneMode,
        built_in: &'a mut BuiltInSceneSlots,
        data: &'a mut DataSceneRuntime,
    ) -> Self {
        Self {
            mode,
            built_in,
            data,
        }
    }

    pub(super) fn reset_playing(&mut self, context: &mut SceneResetContext<'_>) {
        match self.mode {
            SceneMode::BuiltIn => self.built_in.reset_playing_active(context),
            SceneMode::Data => self.data.reset_playing(context),
        }
    }

    pub(super) fn reset_to_title(&mut self, context: &mut SceneResetContext<'_>) {
        match self.mode {
            SceneMode::BuiltIn => self.built_in.reset_to_title_active(context),
            SceneMode::Data => self.data.reset_to_title(context),
        }
    }

    pub(super) fn update(
        &mut self,
        context: &mut SceneUpdateContext<'_>,
        input: InputState,
        delta: f32,
    ) {
        match self.mode {
            SceneMode::BuiltIn => self.built_in.update_active(context, input, delta),
            SceneMode::Data => self.data.update(context, delta),
        }
    }
}

pub(super) struct SceneResetContext<'a> {
    pub(super) world: &'a mut World,
    pub(super) camera: &'a mut Camera2D,
    pub(super) audio_events: &'a mut Vec<AudioEvent>,
}

pub(super) struct SceneUpdateContext<'a> {
    pub(super) world: &'a mut World,
    pub(super) camera: &'a mut Camera2D,
    pub(super) input_actions: &'a InputActionRegistry,
    pub(super) audio_events: &'a mut Vec<AudioEvent>,
    pub(super) tilemap: &'a Tilemap,
    pub(super) physics_counters: &'a mut PhysicsCounters,
    pub(super) collision_events: &'a mut Vec<CollisionEvent>,
    pub(super) collision_event_counts: &'a mut CollisionEventCounts,
    pub(super) gameplay_events: &'a mut Vec<GameplayEvent>,
    pub(super) effect_events: &'a mut Vec<EffectEvent>,
    pub(super) particles: &'a mut ParticleSystem,
    pub(super) tweens: &'a mut TweenSystem,
    pub(super) particle_presets: &'a [Option<ParticlePreset>],
    pub(super) shooter_hit_particle_preset: Option<u32>,
}

pub(super) trait BuiltInSceneRuntime {
    fn score(&self) -> u32;
    fn game_state(&self) -> GameState;
    fn reset_playing(&mut self, context: &mut SceneResetContext<'_>);
    fn reset_to_title(&mut self, context: &mut SceneResetContext<'_>);
    fn update(&mut self, context: &mut SceneUpdateContext<'_>, input: InputState, delta: f32);
}

impl BuiltInSceneRuntime for ShooterScene {
    fn score(&self) -> u32 {
        ShooterScene::score(self)
    }

    fn game_state(&self) -> GameState {
        ShooterScene::game_state(self)
    }

    fn reset_playing(&mut self, context: &mut SceneResetContext<'_>) {
        ShooterScene::reset_playing(self, context.world, context.camera, context.audio_events);
    }

    fn reset_to_title(&mut self, context: &mut SceneResetContext<'_>) {
        ShooterScene::reset_to_title(self, context.world, context.camera, context.audio_events);
    }

    fn update(&mut self, context: &mut SceneUpdateContext<'_>, input: InputState, delta: f32) {
        let hit_particle_preset = context
            .shooter_hit_particle_preset
            .and_then(|preset_id| context.particle_presets.get(preset_id as usize))
            .and_then(|preset| *preset);
        let hit_particles = (hit_particle_preset.is_some() || !context.particle_presets.is_empty())
            .then(|| {
                ParticleBurstSink::with_presets(
                    context.particles,
                    hit_particle_preset,
                    context.particle_presets,
                )
            });
        let hit_tweens = Some(TweenSink::new(context.tweens));
        ShooterScene::update_with_counters(
            self,
            context.world,
            context.camera,
            input,
            context.input_actions,
            context.audio_events,
            context.tilemap,
            delta,
            context.physics_counters,
            context.collision_events,
            context.collision_event_counts,
            context.gameplay_events,
            context.effect_events,
            hit_particles,
            hit_tweens,
        );
    }
}

impl BuiltInSceneRuntime for BreakoutScene {
    fn score(&self) -> u32 {
        BreakoutScene::score(self)
    }

    fn game_state(&self) -> GameState {
        BreakoutScene::game_state(self)
    }

    fn reset_playing(&mut self, context: &mut SceneResetContext<'_>) {
        BreakoutScene::reset_playing(self, context.world, context.camera);
    }

    fn reset_to_title(&mut self, context: &mut SceneResetContext<'_>) {
        BreakoutScene::reset_to_title(self, context.world, context.camera);
    }

    fn update(&mut self, context: &mut SceneUpdateContext<'_>, input: InputState, delta: f32) {
        let mut hit_particles =
            BreakoutParticleBurstSink::new(context.particles, breakout_brick_hit_particle_preset());
        BreakoutScene::update(
            self,
            context.world,
            context.camera,
            input,
            delta,
            context.collision_events,
            context.collision_event_counts,
            Some(&mut hit_particles),
        );
    }
}

impl BuiltInSceneRuntime for PlatformerScene {
    fn score(&self) -> u32 {
        PlatformerScene::score(self)
    }

    fn game_state(&self) -> GameState {
        PlatformerScene::game_state(self)
    }

    fn reset_playing(&mut self, context: &mut SceneResetContext<'_>) {
        PlatformerScene::reset_playing(self, context.world, context.camera);
    }

    fn reset_to_title(&mut self, context: &mut SceneResetContext<'_>) {
        PlatformerScene::reset_to_title(self, context.world, context.camera);
    }

    fn update(&mut self, context: &mut SceneUpdateContext<'_>, input: InputState, delta: f32) {
        let mut landing_particles = PlatformerParticleBurstSink::new(
            context.particles,
            platformer_landing_dust_particle_preset(),
        );
        PlatformerScene::update(
            self,
            context.world,
            context.camera,
            input,
            delta,
            context.physics_counters,
            Some(&mut landing_particles),
        );
    }
}

impl Engine {
    pub(super) fn activate_built_in_shooter_scene(&mut self) {
        self.clear_data_scene_entity_handle();
        self.scene_mode = SceneMode::BuiltIn;
        self.scenes.use_shooter();
    }

    pub(super) fn activate_built_in_breakout_scene(&mut self) {
        self.clear_data_scene_entity_handle();
        self.scene_mode = SceneMode::BuiltIn;
        self.scenes.use_breakout();
    }

    pub(super) fn activate_built_in_platformer_scene(&mut self) {
        self.clear_data_scene_entity_handle();
        self.scene_mode = SceneMode::BuiltIn;
        self.scenes.use_platformer();
    }

    pub(super) fn activate_data_scene(&mut self) {
        self.clear_data_scene_entity_handle();
        self.scene_mode = SceneMode::Data;
        let mut context = SceneResetContext {
            world: &mut self.world,
            camera: &mut self.camera,
            audio_events: &mut self.frame_buffers.audio_events,
        };
        SceneRuntimeDispatch::new(self.scene_mode, &mut self.scenes, &mut self.data_scene)
            .reset_playing(&mut context);
        self.clear_data_scene_entity_handle();
    }

    pub(super) fn active_scene_score(&self) -> u32 {
        if self.scene_mode == SceneMode::Data {
            return self.data_scene.score();
        }
        match self.scenes.active() {
            ActiveScene::Shooter => BuiltInSceneRuntime::score(&self.scenes.shooter),
            ActiveScene::Breakout => BuiltInSceneRuntime::score(&self.scenes.breakout),
            ActiveScene::Platformer => BuiltInSceneRuntime::score(&self.scenes.platformer),
        }
    }

    pub(super) fn active_scene_game_state(&self) -> GameState {
        if self.scene_mode == SceneMode::Data {
            return self.data_scene.game_state();
        }
        match self.scenes.active() {
            ActiveScene::Shooter => BuiltInSceneRuntime::game_state(&self.scenes.shooter),
            ActiveScene::Breakout => BuiltInSceneRuntime::game_state(&self.scenes.breakout),
            ActiveScene::Platformer => BuiltInSceneRuntime::game_state(&self.scenes.platformer),
        }
    }

    pub(super) fn active_scene_game_state_code(&self) -> u32 {
        match self.active_scene_game_state() {
            GameState::Title => 0,
            GameState::Playing => 1,
            GameState::GameOver => 2,
        }
    }

    pub(super) fn active_scene_action_trigger_attempts(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self.scenes.shooter.last_action_trigger_attempts(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn reset_active_scene_action_trigger_frame_diagnostics(&mut self) {
        if self.scene_mode == SceneMode::Data {
            return;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self.scenes.shooter.reset_action_trigger_frame_diagnostics(),
            ActiveScene::Breakout | ActiveScene::Platformer => {}
        }
    }

    pub(super) fn active_scene_action_trigger_failures(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self.scenes.shooter.last_action_trigger_failures(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_action_trigger_failure_events_pushed(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .last_action_trigger_failure_events_pushed(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_action_trigger_commit_skips(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self.scenes.shooter.last_action_trigger_commit_skips(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_last_prepared_action_trigger_failure_reason_code(&self) -> u32 {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .last_prepared_action_trigger_failure_reason_code(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_action_trigger_failure_count_for_reason(
        &self,
        reason_code: u32,
    ) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .last_action_trigger_failure_count_for_reason(reason_code),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_commands_drained(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self.scenes.shooter.last_spawn_flush_commands_drained(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_projectile_spawns(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self.scenes.shooter.last_spawn_flush_projectile_spawns(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_projectile_arcs_applied(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .last_spawn_flush_projectile_arcs_applied(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_projectile_shoot_audio_events_pushed(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .last_spawn_flush_projectile_shoot_audio_events_pushed(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_prefab_spawns(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self.scenes.shooter.last_spawn_flush_prefab_spawns(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_prefab_spawned_payloads(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .last_spawn_flush_prefab_spawned_payloads(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_prefab_spawned_events_pushed(&self) -> usize {
        if self.scene_mode == SceneMode::Data {
            return 0;
        }
        match self.scenes.active() {
            ActiveScene::Shooter => self
                .scenes
                .shooter
                .last_spawn_flush_prefab_spawned_events_pushed(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_ticks_gameplay_timers(&self) -> bool {
        if self.scene_mode == SceneMode::Data {
            return false;
        }
        self.scenes.active() == ActiveScene::Shooter
            && self.scenes.shooter.game_state() == GameState::Playing
    }

    pub(super) fn reset_active_scene_game(&mut self) {
        let mut context = SceneResetContext {
            world: &mut self.world,
            camera: &mut self.camera,
            audio_events: &mut self.frame_buffers.audio_events,
        };
        SceneRuntimeDispatch::new(self.scene_mode, &mut self.scenes, &mut self.data_scene)
            .reset_playing(&mut context);
        if self.scene_mode == SceneMode::Data {
            self.clear_data_scene_entity_handle();
        }
    }

    pub(super) fn reset_to_title(&mut self) {
        let scene_mode = self.scene_mode;
        {
            let mut context = SceneResetContext {
                world: &mut self.world,
                camera: &mut self.camera,
                audio_events: &mut self.frame_buffers.audio_events,
            };
            SceneRuntimeDispatch::new(scene_mode, &mut self.scenes, &mut self.data_scene)
                .reset_to_title(&mut context);
        }
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
        self.clear_data_scene_entity_handle();
        if scene_mode == SceneMode::Data {
            self.clear_scene_output_buffers();
        }
    }

    pub(super) fn update_scene(&mut self, delta: f32, input: InputState) {
        let mut context = SceneUpdateContext {
            world: &mut self.world,
            camera: &mut self.camera,
            input_actions: &self.input_actions,
            audio_events: &mut self.frame_buffers.audio_events,
            tilemap: &self.tilemap,
            physics_counters: &mut self.physics_counters,
            collision_events: &mut self.frame_buffers.collision_events,
            collision_event_counts: &mut self.collision_event_counts,
            gameplay_events: &mut self.frame_buffers.gameplay_events,
            effect_events: &mut self.frame_buffers.effect_events,
            particles: &mut self.particles,
            tweens: &mut self.tweens,
            particle_presets: &self.particle_presets,
            shooter_hit_particle_preset: self.shooter_hit_particle_preset,
        };
        SceneRuntimeDispatch::new(self.scene_mode, &mut self.scenes, &mut self.data_scene).update(
            &mut context,
            input,
            delta,
        );
    }
}
