use wasm_bindgen::prelude::*;

use crate::audio_event::AudioEvent;
use crate::breakout_scene::BreakoutScene;
use crate::camera::{Camera2D, CameraPresetConfig};
use crate::collision::{CollisionSystem, PhysicsDebugLine};
use crate::collision_event::{CollisionEvent, CollisionEventCounts, CollisionEventTracker};
use crate::game_state::GameState;
use crate::input::InputState;
use crate::physics::{FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate, PhysicsCounters};
use crate::platformer_scene::PlatformerScene;
use crate::render_command::SpriteRenderCommand;
use crate::shooter_scene::{
    EnemyBehavior, EnemySpawnPattern, ShooterAudioPolicy, ShooterConfig, ShooterScene,
    ShooterWaveConfig,
};
use crate::tilemap::Tilemap;
use crate::world::World;

const DEFAULT_VIEWPORT_WIDTH: f32 = 800.0;
const DEFAULT_VIEWPORT_HEIGHT: f32 = 480.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum ActiveScene {
    #[default]
    Shooter,
    Breakout,
    Platformer,
}

#[derive(Clone, Copy, Debug, Default)]
struct FixedTimestepInputLatch {
    space: bool,
    enter: bool,
    mouse_left: bool,
}

impl FixedTimestepInputLatch {
    fn observe(&mut self, previous: InputState, current: InputState) {
        self.space |= current.space == 1 && previous.space == 0;
        self.enter |= current.enter == 1 && previous.enter == 0;
        self.mouse_left |= current.mouse_left == 1 && previous.mouse_left == 0;
    }

    fn apply_to(self, mut input: InputState) -> InputState {
        input.space = input.space.max(u8::from(self.space));
        input.enter = input.enter.max(u8::from(self.enter));
        input.mouse_left = input.mouse_left.max(u8::from(self.mouse_left));
        input
    }

    fn clear(&mut self) {
        *self = Self::default();
    }
}

#[wasm_bindgen]
pub struct Engine {
    elapsed_seconds: f64,
    input: InputState,
    previous_input_sample: InputState,
    fixed_timestep_input_latch: FixedTimestepInputLatch,
    scene: ShooterScene,
    breakout_scene: BreakoutScene,
    platformer_scene: PlatformerScene,
    active_scene: ActiveScene,
    camera: Camera2D,
    world: World,
    tilemap: Tilemap,
    render_commands: Vec<SpriteRenderCommand>,
    audio_events: Vec<AudioEvent>,
    collision_events: Vec<CollisionEvent>,
    physics_debug_lines: Vec<PhysicsDebugLine>,
    physics_debug_lines_enabled: bool,
    collision_event_tracker: CollisionEventTracker,
    collision_event_counts: CollisionEventCounts,
    physics_counters: PhysicsCounters,
    fixed_timestep: FixedTimestep,
    fixed_timestep_enabled: bool,
    last_fixed_update: FixedTimestepUpdate,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut engine = Self {
            elapsed_seconds: 0.0,
            input: InputState::default(),
            previous_input_sample: InputState::default(),
            fixed_timestep_input_latch: FixedTimestepInputLatch::default(),
            scene: ShooterScene::new(),
            breakout_scene: BreakoutScene::new(),
            platformer_scene: PlatformerScene::new(),
            active_scene: ActiveScene::Shooter,
            camera: Camera2D::new(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT),
            world: World::default(),
            tilemap: Tilemap::default(),
            render_commands: Vec::with_capacity(256),
            audio_events: Vec::with_capacity(16),
            collision_events: Vec::with_capacity(128),
            physics_debug_lines: Vec::with_capacity(64),
            physics_debug_lines_enabled: false,
            collision_event_tracker: CollisionEventTracker::default(),
            collision_event_counts: CollisionEventCounts::default(),
            physics_counters: PhysicsCounters::default(),
            fixed_timestep: FixedTimestep::default(),
            fixed_timestep_enabled: false,
            last_fixed_update: FixedTimestepUpdate::default(),
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
        let input = InputState {
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
        self.observe_input_sample(input);
        self.input = input;
    }

    pub fn set_texture_ids(&mut self, player: u32, enemy: u32, bullet: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene
            .set_texture_ids(&mut self.world, player, enemy, bullet);
    }

    pub fn set_sound_ids(&mut self, shoot: u32, hit: u32, game_over: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_sound_ids(shoot, hit, game_over);
    }

    pub fn use_breakout_scene(&mut self) {
        self.active_scene = ActiveScene::Breakout;
        self.tilemap.clear();
        self.breakout_scene
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }

    pub fn use_platformer_scene(&mut self) {
        self.active_scene = ActiveScene::Platformer;
        self.tilemap.clear();
        self.platformer_scene
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }

    pub fn clear_shooter_tilemap(&mut self) {
        self.active_scene = ActiveScene::Shooter;
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
        self.active_scene = ActiveScene::Shooter;
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
        self.active_scene = ActiveScene::Shooter;
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
        self.active_scene = ActiveScene::Shooter;
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
        self.active_scene = ActiveScene::Shooter;
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
        self.active_scene = ActiveScene::Shooter;
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
        match self.active_scene {
            ActiveScene::Shooter => self
                .scene
                .update_camera_follow(&self.world, &mut self.camera),
            ActiveScene::Breakout => self.breakout_scene.update_camera(&mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .update_camera(&self.world, &mut self.camera),
        }
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
        self.active_scene = ActiveScene::Shooter;
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
        self.clear_physics_history();
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
        self.active_scene = ActiveScene::Shooter;
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
        self.clear_physics_history();
    }

    pub fn set_shooter_behavior(&mut self, enemy_behavior: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_enemy_behavior(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            EnemyBehavior::from_code(enemy_behavior),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_spawn_pattern(&mut self, enemy_spawn_pattern: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_enemy_spawn_pattern(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            EnemySpawnPattern::from_code(enemy_spawn_pattern),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_combat(&mut self, enemy_health: f32, bullet_damage: f32, score_reward: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_combat(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            enemy_health,
            bullet_damage,
            score_reward,
        );
        self.clear_physics_history();
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
        self.active_scene = ActiveScene::Shooter;
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
        self.active_scene = ActiveScene::Shooter;
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
        self.active_scene = ActiveScene::Shooter;
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
        self.clear_physics_history();
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
        orbit_radius: f32,
        orbit_radial_band: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
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
        .with_combat(enemy_health, bullet_damage, score_reward)
        .with_orbit(orbit_radius, orbit_radial_band);

        self.scene.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            config,
        );
        self.clear_physics_history();
    }

    pub fn update(&mut self, delta: f64) {
        self.elapsed_seconds += delta;
        self.clear_physics_frame();
        if self.fixed_timestep_enabled {
            let update = self.fixed_timestep.advance(delta as f32);
            self.last_fixed_update = update;
            self.physics_counters.record_fixed_update(update);
            let step_seconds = self.fixed_timestep.config().step_seconds;
            for step_index in 0..update.steps {
                let input = self.fixed_step_input(step_index == 0);
                self.update_scene(step_seconds, input);
                if step_index == 0 {
                    self.fixed_timestep_input_latch.clear();
                }
                self.record_collision_events();
            }
        } else {
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.update_scene(delta as f32, self.input);
            self.record_collision_events();
        }
        self.build_physics_debug_lines();
        self.build_render_commands();
    }

    pub fn set_physics_debug_lines_enabled(&mut self, enabled: bool) {
        self.physics_debug_lines_enabled = enabled;
        if !enabled {
            self.physics_debug_lines.clear();
        }
    }

    pub fn configure_fixed_timestep(
        &mut self,
        enabled: bool,
        step_seconds: f32,
        max_frame_seconds: f32,
        max_steps_per_update: u32,
    ) {
        let was_enabled = self.fixed_timestep_enabled;
        self.fixed_timestep_enabled = enabled;
        self.fixed_timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds,
            max_frame_seconds,
            max_steps_per_update,
        });
        self.last_fixed_update = FixedTimestepUpdate::default();
        if !enabled || !was_enabled {
            self.fixed_timestep_input_latch.clear();
            self.previous_input_sample = self.input;
        }
    }

    pub fn fixed_timestep_enabled(&self) -> bool {
        self.fixed_timestep_enabled
    }

    pub fn fixed_timestep_alpha(&self) -> f32 {
        self.last_fixed_update.alpha
    }

    pub fn fixed_timestep_consumed_seconds(&self) -> f32 {
        self.last_fixed_update.consumed_seconds
    }

    pub fn fixed_timestep_dropped_seconds(&self) -> f32 {
        self.last_fixed_update.dropped_seconds
    }

    pub fn physics_fixed_steps(&self) -> u32 {
        self.physics_counters.fixed_steps
    }

    pub fn physics_kinematic_moves(&self) -> u32 {
        self.physics_counters.kinematic_moves
    }

    pub fn physics_kinematic_hits(&self) -> u32 {
        self.physics_counters.kinematic_hits
    }

    pub fn physics_kinematic_entity_hits(&self) -> u32 {
        self.physics_counters.kinematic_entity_hits
    }

    pub fn physics_kinematic_tile_hits(&self) -> u32 {
        self.physics_counters.kinematic_tile_hits
    }

    pub fn physics_solid_candidate_checks(&self) -> u32 {
        self.physics_counters.solid_candidate_checks
    }

    pub fn physics_tile_candidate_checks(&self) -> u32 {
        self.physics_counters.tile_candidate_checks
    }

    pub fn collision_event_ptr(&self) -> *const CollisionEvent {
        self.collision_events.as_ptr()
    }

    pub fn collision_event_len(&self) -> usize {
        self.collision_events.len()
    }

    pub fn collision_enter_count(&self) -> u32 {
        self.collision_event_counts.enter
    }

    pub fn collision_stay_count(&self) -> u32 {
        self.collision_event_counts.stay
    }

    pub fn collision_exit_count(&self) -> u32 {
        self.collision_event_counts.exit
    }

    pub fn collision_hit_count(&self) -> u32 {
        self.collision_event_counts.hit
    }

    pub fn physics_debug_line_ptr(&self) -> *const PhysicsDebugLine {
        self.physics_debug_lines.as_ptr()
    }

    pub fn physics_debug_line_len(&self) -> usize {
        self.physics_debug_lines.len()
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
        self.clear_audio_events();
    }

    pub fn clear_audio_events(&mut self) {
        self.audio_events.clear();
    }

    pub fn score(&self) -> u32 {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.score(),
            ActiveScene::Breakout => self.breakout_scene.score(),
            ActiveScene::Platformer => self.platformer_scene.score(),
        }
    }

    pub fn entity_count(&self) -> usize {
        self.world.alive_count()
    }

    pub fn game_state(&self) -> u32 {
        self.game_state_code()
    }

    pub fn game_state_code(&self) -> u32 {
        let game_state = match self.active_scene {
            ActiveScene::Shooter => self.scene.game_state(),
            ActiveScene::Breakout => self.breakout_scene.game_state(),
            ActiveScene::Platformer => self.platformer_scene.game_state(),
        };
        match game_state {
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
        match self.active_scene {
            ActiveScene::Shooter => {
                self.scene
                    .reset_playing(&mut self.world, &mut self.camera, &mut self.audio_events);
            }
            ActiveScene::Breakout => self
                .breakout_scene
                .reset_playing(&mut self.world, &mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .reset_playing(&mut self.world, &mut self.camera),
        }
        self.clear_physics_history();
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    fn reset_to_title(&mut self) {
        match self.active_scene {
            ActiveScene::Shooter => {
                self.scene.reset_to_title(
                    &mut self.world,
                    &mut self.camera,
                    &mut self.audio_events,
                );
            }
            ActiveScene::Breakout => self
                .breakout_scene
                .reset_to_title(&mut self.world, &mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .reset_to_title(&mut self.world, &mut self.camera),
        }
        self.clear_physics_history();
    }

    fn update_scene(&mut self, delta: f32, input: InputState) {
        match self.active_scene {
            ActiveScene::Shooter => {
                self.scene.update_with_counters(
                    &mut self.world,
                    &mut self.camera,
                    input,
                    &mut self.audio_events,
                    &self.tilemap,
                    delta,
                    &mut self.physics_counters,
                    &mut self.collision_events,
                    &mut self.collision_event_counts,
                );
            }
            ActiveScene::Breakout => self.breakout_scene.update(
                &mut self.world,
                &mut self.camera,
                input,
                delta,
                &mut self.collision_events,
                &mut self.collision_event_counts,
            ),
            ActiveScene::Platformer => self.platformer_scene.update(
                &mut self.world,
                &mut self.camera,
                input,
                delta,
                &mut self.physics_counters,
            ),
        }
    }

    fn clear_physics_frame(&mut self) {
        self.physics_counters.clear();
        self.collision_events.clear();
        self.collision_event_counts.clear();
        self.physics_debug_lines.clear();
    }

    fn clear_physics_history(&mut self) {
        self.collision_event_tracker.clear();
        self.collision_events.clear();
        self.collision_event_counts.clear();
        self.physics_debug_lines.clear();
        self.fixed_timestep.reset();
        self.last_fixed_update = FixedTimestepUpdate::default();
        self.fixed_timestep_input_latch.clear();
        self.previous_input_sample = self.input;
    }

    fn record_collision_events(&mut self) {
        let counts = self
            .collision_event_tracker
            .update(&self.world, &mut self.collision_events);
        self.collision_event_counts.add(counts);
    }

    fn build_physics_debug_lines(&mut self) {
        if !self.physics_debug_lines_enabled {
            return;
        }
        CollisionSystem::build_physics_debug_lines_into(
            &self.world,
            16.0,
            &mut self.physics_debug_lines,
        );
    }

    fn observe_input_sample(&mut self, input: InputState) {
        if self.fixed_timestep_enabled {
            self.fixed_timestep_input_latch
                .observe(self.previous_input_sample, input);
        }
        self.previous_input_sample = input;
    }

    fn fixed_step_input(&self, is_first_step: bool) -> InputState {
        if is_first_step {
            self.fixed_timestep_input_latch.apply_to(self.input)
        } else {
            self.input
        }
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
    use crate::collision_event::{
        COLLISION_EVENT_ENTER, COLLISION_EVENT_EXIT, COLLISION_EVENT_HIT, COLLISION_EVENT_STAY,
    };
    use crate::components::{
        AabbCollider, CollisionFilter, CollisionLayer, CollisionMask, Transform2D,
    };
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
    fn engine_can_switch_to_breakout_scene() {
        let mut engine = Engine::new();

        engine.use_breakout_scene();
        engine.update(0.016);

        assert_eq!(engine.game_state(), 0);
        assert_eq!(engine.score(), 0);
        assert_eq!(engine.entity_count(), 55);
        assert_eq!(engine.sprite_count(), 55);

        engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
        engine.update(0.016);

        assert_eq!(engine.game_state(), 1);
        assert_eq!(count_layer(&engine, CollisionLayer::Wall), 3);
    }

    #[test]
    fn engine_can_switch_to_platformer_scene() {
        let mut engine = Engine::new();

        engine.use_platformer_scene();
        engine.update(0.016);

        assert_eq!(engine.game_state(), 0);
        assert_eq!(engine.score(), 0);
        assert_eq!(engine.entity_count(), 8);
        assert_eq!(engine.sprite_count(), 8);
        assert_eq!(count_layer(&engine, CollisionLayer::Wall), 6);
        assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);

        engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, true, false, false, false, 0.0, 0.0);
        engine.update(0.25);

        assert_eq!(engine.game_state(), 1);
        assert!(engine.physics_kinematic_moves() > 0);
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
    fn fixed_timestep_is_opt_in_and_reports_steps() {
        let mut engine = Engine::new();

        engine.update(0.25);

        assert!(!engine.fixed_timestep_enabled());
        assert_eq!(engine.physics_fixed_steps(), 0);

        engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
        engine.update(0.25);

        assert!(engine.fixed_timestep_enabled());
        assert_eq!(engine.physics_fixed_steps(), 2);
        assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);
        assert!((engine.fixed_timestep_consumed_seconds() - 0.2).abs() < 0.01);
    }

    #[test]
    fn fixed_timestep_waits_until_accumulator_reaches_step() {
        let mut engine = Engine::new();
        engine.configure_fixed_timestep(true, 0.1, 1.0, 4);

        engine.update(0.05);

        assert_eq!(engine.physics_fixed_steps(), 0);
        assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);
        assert!(engine.collision_events.is_empty());
    }

    #[test]
    fn fixed_timestep_latches_action_input_until_next_step() {
        let mut engine = Engine::new();
        engine.configure_fixed_timestep(true, 0.1, 1.0, 4);

        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.05);
        assert_eq!(engine.physics_fixed_steps(), 0);
        assert_eq!(engine.game_state_code(), 0);

        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
        engine.update(0.05);

        assert_eq!(engine.physics_fixed_steps(), 1);
        assert_eq!(engine.game_state_code(), 1);
    }

    #[test]
    fn engine_collision_events_report_enter_stay_and_exit() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let a = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let b = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

        engine.update(0.016);
        assert_eq!(engine.collision_enter_count(), 1);
        assert_eq!(engine.collision_event_len(), 1);
        assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_ENTER);

        engine.update(0.016);
        assert_eq!(engine.collision_stay_count(), 1);
        assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_STAY);

        engine
            .world
            .set_transform(b, Transform2D { x: 40.0, y: 0.0 });
        engine.update(0.016);
        assert_eq!(engine.collision_exit_count(), 1);
        assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_EXIT);
        assert_eq!(engine.collision_events[0].a_id, a.id.min(b.id));
    }

    #[test]
    fn physics_debug_lines_are_opt_in_and_report_broadphase_and_contacts() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

        engine.update(0.016);
        assert_eq!(engine.physics_debug_line_len(), 0);

        engine.set_physics_debug_lines_enabled(true);
        engine.update(0.016);

        assert_eq!(engine.physics_debug_line_len(), 9);
        assert_eq!(engine.physics_debug_lines[0].x0, -5.0);
        assert_eq!(engine.physics_debug_lines[0].x1, 5.0);
        assert_eq!(engine.physics_debug_lines[8].x0, 4.0);
        assert_eq!(engine.physics_debug_lines[8].x1, 20.0);

        engine.set_physics_debug_lines_enabled(false);
        assert_eq!(engine.physics_debug_line_len(), 0);
    }

    #[test]
    fn physics_debug_line_abi_matches_float_buffer() {
        assert_eq!(crate::physics_debug_line_floats(), 8);
        assert_eq!(crate::physics_debug_line_bytes(), 32);
    }

    #[test]
    fn engine_collision_events_include_shooter_hit_before_despawn() {
        let mut engine = Engine::new();
        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
        let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
        let bullet = engine
            .world
            .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        engine.world.damages[bullet.id as usize] = Some(2.5);

        engine.update(0.016);

        assert_eq!(engine.collision_hit_count(), 1);
        let hit = engine
            .collision_events
            .iter()
            .find(|event| event.kind == COLLISION_EVENT_HIT)
            .expect("shooter hit should be recorded before despawn");
        assert_eq!(hit.a_id, bullet.id);
        assert_eq!(hit.a_generation, bullet.generation);
        assert_eq!(hit.b_id, enemy.id);
        assert_eq!(hit.b_generation, enemy.generation);
        assert_eq!(hit.damage(), 2.5);
    }

    #[test]
    fn collision_event_abi_includes_damage_payload_slot() {
        assert_eq!(crate::collision_event_u32s(), 6);
        assert_eq!(crate::collision_event_bytes(), 24);
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

    fn spawn_test_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
    ) -> crate::entity::Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_aabb_collider(
            entity,
            AabbCollider {
                half_width: 5.0,
                half_height: 5.0,
                is_trigger: true,
                layer,
            },
        );
        world.set_collision_filter(
            entity,
            CollisionFilter::new(layer.mask(), CollisionMask::ALL),
        );
        entity
    }

    #[test]
    fn resolved_shooter_config_applies_all_values_with_one_call() {
        let mut engine = Engine::new();

        engine.set_shooter_resolved_config(
            3200.0, 1800.0, 240.0, 120.0, 0.75, 640.0, 0.08, 2.4, 40.0, 44.0, 30.0, 34.0, 10.0,
            12.0, 4, 12.0, 3, 9.0, 2, 18.0, 2, 2, 4.0, 2.0, 9, 220.0, 18.0,
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
        assert_eq!(config.orbit_radius, 220.0);
        assert_eq!(config.orbit_radial_band, 18.0);
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
