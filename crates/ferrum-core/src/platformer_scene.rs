use std::f32::consts::TAU;

use crate::camera::Camera2D;
use crate::components::gameplay::{
    CollisionReaction, CollisionReactionTrigger, CollisionTarget, Cooldown, MovementPattern,
    MAX_COLLISION_REACTIONS_PER_ENTITY,
};
use crate::components::{CollisionLayer, CollisionMask, Transform2D, Velocity};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::gameplay::{
    collision_side_effect_payload, commit_tile_collision_side_effect_reaction,
    CollisionSideEffectEvaluation, CollisionSideEffectPayload,
};
use crate::input::InputState;
use crate::particles::{ParticlePreset, ParticleRange, ParticleSystem};
use crate::physics::{
    MovingPlatformCarryConfig, OneWayPlatformConfig, PhysicsCounters, PhysicsSystem,
    PlatformerControllerConfig, PlatformerControllerInput, PlatformerControllerState,
};
use crate::world::{
    EntityTemplate, EntityTemplateCollider, PrefabEntitySpawnRequest, PrefabSpriteTint, World,
};

const DEFAULT_TEXTURE_ID: u32 = 0;
const WORLD_WIDTH: f32 = 1200.0;
const WORLD_HEIGHT: f32 = 640.0;
const PLAYER_WIDTH: f32 = 28.0;
const PLAYER_HEIGHT: f32 = 36.0;
const PLATFORM_HEIGHT: f32 = 22.0;
const WALL_THICKNESS: f32 = 24.0;
const FLOOR_HEIGHT: f32 = 48.0;
const PLAYER_START_X: f32 = 96.0;
const PLAYER_START_Y: f32 = 500.0;
const HORIZONTAL_SPEED: f32 = 210.0;
const GRAVITY: f32 = 900.0;
const JUMP_SPEED: f32 = 420.0;
const MAX_FALL_SPEED: f32 = 760.0;
const GROUND_PROBE_DISTANCE: f32 = 2.0;
const STEP_OFFSET: f32 = 12.0;
const COYOTE_TIME_SECONDS: f32 = 0.08;
const JUMP_BUFFER_SECONDS: f32 = 0.10;
const MOVING_PLATFORM_ORIGIN_X: f32 = 760.0;
const MOVING_PLATFORM_Y: f32 = 500.0;
const MOVING_PLATFORM_AMPLITUDE: f32 = 112.0;
const MOVING_PLATFORM_SPEED: f32 = 1.4;
const LANDING_DUST_PARTICLE_PRESET_ID: u32 = 0;
const LANDING_DUST_PARTICLE_COUNT: u32 = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
struct PlatformerControllerTuning {
    horizontal_speed: f32,
    gravity: f32,
    jump_speed: f32,
    max_fall_speed: f32,
    ground_probe_distance: f32,
    step_offset: f32,
    coyote_time_seconds: f32,
    jump_buffer_seconds: f32,
}

impl PlatformerControllerTuning {
    const fn default() -> Self {
        Self {
            horizontal_speed: HORIZONTAL_SPEED,
            gravity: GRAVITY,
            jump_speed: JUMP_SPEED,
            max_fall_speed: MAX_FALL_SPEED,
            ground_probe_distance: GROUND_PROBE_DISTANCE,
            step_offset: STEP_OFFSET,
            coyote_time_seconds: COYOTE_TIME_SECONDS,
            jump_buffer_seconds: JUMP_BUFFER_SECONDS,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct MovingPlatformPath {
    origin: Transform2D,
    amplitude_x: f32,
    amplitude_y: f32,
    phase_speed: f32,
}

impl MovingPlatformPath {
    const fn default() -> Self {
        Self {
            origin: Transform2D {
                x: MOVING_PLATFORM_ORIGIN_X,
                y: MOVING_PLATFORM_Y,
            },
            amplitude_x: MOVING_PLATFORM_AMPLITUDE,
            amplitude_y: 0.0,
            phase_speed: MOVING_PLATFORM_SPEED,
        }
    }

    fn sample(self, phase: f32) -> Transform2D {
        Transform2D {
            x: self.origin.x + phase.sin() * self.amplitude_x,
            y: self.origin.y + phase.sin() * self.amplitude_y,
        }
    }
}

#[derive(Debug)]
pub(crate) struct PlatformerScene {
    game_state: GameState,
    score: u32,
    elapsed_play_seconds: f32,
    player: Option<Entity>,
    moving_platform: Option<Entity>,
    controller_state: PlatformerControllerState,
    moving_platform_phase: f32,
    jump_was_down: bool,
    player_was_grounded: bool,
}

impl Default for PlatformerScene {
    fn default() -> Self {
        Self {
            game_state: GameState::Title,
            score: 0,
            elapsed_play_seconds: 0.0,
            player: None,
            moving_platform: None,
            controller_state: PlatformerControllerState::new(),
            moving_platform_phase: 0.0,
            jump_was_down: false,
            player_was_grounded: false,
        }
    }
}

pub(crate) struct PlatformerParticleBurstSink<'a> {
    particles: &'a mut ParticleSystem,
    preset_id: u32,
    preset: ParticlePreset,
}

impl<'a> PlatformerParticleBurstSink<'a> {
    pub(crate) fn new(particles: &'a mut ParticleSystem, preset: ParticlePreset) -> Self {
        Self {
            particles,
            preset_id: LANDING_DUST_PARTICLE_PRESET_ID,
            preset,
        }
    }

    fn spawn_landing_dust(&mut self, preset_id: u32, position: Transform2D) -> usize {
        if preset_id != self.preset_id {
            return 0;
        }
        self.particles
            .spawn_burst(self.preset, position.x, position.y + PLAYER_HEIGHT * 0.5)
    }
}

pub(crate) fn platformer_landing_dust_particle_preset() -> ParticlePreset {
    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = LANDING_DUST_PARTICLE_COUNT;
    preset.lifetime_seconds = ParticleRange::new(0.18, 0.34);
    preset.speed = ParticleRange::new(35.0, 120.0);
    preset.start_size = ParticleRange::new(5.0, 9.0);
    preset.end_size = ParticleRange::constant(1.0);
    preset.start_color = [0.78, 0.72, 0.62, 0.8];
    preset.end_color = [0.58, 0.5, 0.42, 0.0];
    preset.acceleration_y = 80.0;
    preset.damping = 2.6;
    preset
}

impl PlatformerScene {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn reset_to_title(&mut self, world: &mut World, camera: &mut Camera2D) {
        self.rebuild_level(world, camera, GameState::Title);
    }

    pub(crate) fn reset_playing(&mut self, world: &mut World, camera: &mut Camera2D) {
        self.rebuild_level(world, camera, GameState::Playing);
    }

    pub(crate) fn update(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        delta: f32,
        physics_counters: &mut PhysicsCounters,
        landing_particles: Option<&mut PlatformerParticleBurstSink<'_>>,
    ) {
        match self.game_state {
            GameState::Title => {
                if action_pressed(input) {
                    self.reset_playing(world, camera);
                }
            }
            GameState::Playing => {
                self.update_playing(world, input, delta, physics_counters, landing_particles);
            }
            GameState::GameOver => {
                if action_pressed(input) {
                    self.reset_playing(world, camera);
                }
            }
        }
        self.jump_was_down = input.space == 1;
        self.update_camera(world, camera);
    }

    pub(crate) fn update_camera(&self, world: &World, camera: &mut Camera2D) {
        let Some(player) = self.player else {
            camera.x = camera.viewport_width * 0.5;
            camera.y = camera.viewport_height * 0.5;
            return;
        };
        if let Some(transform) = world.transform(player) {
            camera.follow(transform, WORLD_WIDTH, WORLD_HEIGHT);
        }
    }

    pub(crate) fn score(&self) -> u32 {
        self.score
    }

    pub(crate) fn game_state(&self) -> GameState {
        self.game_state
    }

    fn rebuild_level(&mut self, world: &mut World, camera: &mut Camera2D, game_state: GameState) {
        *world = World::default();
        self.score = 0;
        self.elapsed_play_seconds = 0.0;
        self.player = None;
        self.moving_platform = None;
        self.controller_state.reset();
        self.moving_platform_phase = 0.0;
        self.jump_was_down = false;
        self.player_was_grounded = false;
        self.game_state = game_state;

        self.spawn_level(world);
        self.update_camera(world, camera);
    }

    fn spawn_level(&mut self, world: &mut World) {
        spawn_body(
            world,
            Transform2D {
                x: WORLD_WIDTH * 0.5,
                y: WORLD_HEIGHT - FLOOR_HEIGHT * 0.5,
            },
            WORLD_WIDTH,
            FLOOR_HEIGHT,
            CollisionLayer::Wall,
            Velocity::default(),
            [0.32, 0.36, 0.42, 1.0],
        );
        spawn_body(
            world,
            Transform2D {
                x: -WALL_THICKNESS * 0.5,
                y: WORLD_HEIGHT * 0.5,
            },
            WALL_THICKNESS,
            WORLD_HEIGHT,
            CollisionLayer::Wall,
            Velocity::default(),
            [0.22, 0.28, 0.36, 1.0],
        );
        spawn_body(
            world,
            Transform2D {
                x: WORLD_WIDTH + WALL_THICKNESS * 0.5,
                y: WORLD_HEIGHT * 0.5,
            },
            WALL_THICKNESS,
            WORLD_HEIGHT,
            CollisionLayer::Wall,
            Velocity::default(),
            [0.22, 0.28, 0.36, 1.0],
        );
        spawn_platform(
            world,
            260.0,
            470.0,
            190.0,
            CollisionLayer::Wall,
            [0.34, 0.47, 0.66, 1.0],
        );
        spawn_platform(
            world,
            420.0,
            390.0,
            150.0,
            CollisionLayer::Wall,
            [0.34, 0.47, 0.66, 1.0],
        );
        spawn_platform(
            world,
            610.0,
            324.0,
            165.0,
            CollisionLayer::Enemy,
            [0.86, 0.72, 0.28, 1.0],
        );
        let moving_platform = spawn_platform(
            world,
            MOVING_PLATFORM_ORIGIN_X,
            MOVING_PLATFORM_Y,
            150.0,
            CollisionLayer::Wall,
            [0.24, 0.78, 0.82, 1.0],
        );
        world.set_movement_pattern(
            moving_platform,
            MovementPattern::Oscillate {
                origin_x: MOVING_PLATFORM_ORIGIN_X,
                origin_y: MOVING_PLATFORM_Y,
                amplitude_x: MOVING_PLATFORM_AMPLITUDE,
                amplitude_y: 0.0,
                phase_speed: MOVING_PLATFORM_SPEED,
            },
        );
        self.moving_platform = Some(moving_platform);

        let player = spawn_player_body(
            world,
            Transform2D {
                x: PLAYER_START_X,
                y: PLAYER_START_Y,
            },
        );
        world.set_movement_pattern(
            player,
            platformer_input_movement(PlatformerControllerTuning::default()),
        );
        attach_player_landing_reactions(world, player);
        self.player = Some(player);
    }

    fn update_playing(
        &mut self,
        world: &mut World,
        input: InputState,
        delta: f32,
        physics_counters: &mut PhysicsCounters,
        landing_particles: Option<&mut PlatformerParticleBurstSink<'_>>,
    ) {
        if !delta.is_finite() || delta <= 0.0 {
            return;
        }
        self.elapsed_play_seconds += delta;
        self.score = self.elapsed_play_seconds.floor() as u32;

        self.update_moving_platform(world, delta);
        self.update_player(world, input, delta, physics_counters, landing_particles);
        if self
            .player
            .and_then(|player| world.transform(player))
            .is_some_and(|transform| transform.y > WORLD_HEIGHT + PLAYER_HEIGHT * 2.0)
        {
            self.game_state = GameState::GameOver;
        }
    }

    fn update_moving_platform(&mut self, world: &mut World, delta: f32) {
        let Some(platform) = self.moving_platform else {
            return;
        };
        let Some(current) = world.transform(platform) else {
            return;
        };
        let path = moving_platform_path(world, platform);
        self.moving_platform_phase =
            (self.moving_platform_phase + delta * path.phase_speed).rem_euclid(TAU);
        let next = path.sample(self.moving_platform_phase);
        if let Some(player) = self.player {
            let _ = PhysicsSystem::carry_moving_platform(
                world,
                player,
                MovingPlatformCarryConfig::new(
                    platform,
                    Velocity {
                        vx: next.x - current.x,
                        vy: next.y - current.y,
                    },
                    GROUND_PROBE_DISTANCE,
                    solid_mask(),
                    4,
                )
                .with_one_way_platforms(one_way_config()),
            );
        }
        world.set_transform(platform, next);
    }

    fn update_player(
        &mut self,
        world: &mut World,
        input: InputState,
        delta: f32,
        physics_counters: &mut PhysicsCounters,
        landing_particles: Option<&mut PlatformerParticleBurstSink<'_>>,
    ) {
        let Some(player) = self.player else {
            self.player_was_grounded = false;
            return;
        };
        let horizontal_axis = f32::from(input.d) - f32::from(input.a);
        let jump_pressed = input.space == 1 && !self.jump_was_down;
        let tuning = platformer_controller_tuning(world, player);
        let result = PhysicsSystem::move_platformer_controller_with_state_and_counters(
            world,
            player,
            PlatformerControllerInput::new(horizontal_axis, jump_pressed),
            platformer_config(tuning),
            delta,
            &mut self.controller_state,
            physics_counters,
        );
        if !self.player_was_grounded && result.grounded {
            spawn_landing_reaction_particles(world, player, landing_particles);
        }
        self.player_was_grounded = result.grounded;
    }
}

fn platformer_config(tuning: PlatformerControllerTuning) -> PlatformerControllerConfig {
    PlatformerControllerConfig::new(solid_mask(), 4)
        .with_horizontal_speed(tuning.horizontal_speed)
        .with_gravity(tuning.gravity)
        .with_jump_speed(tuning.jump_speed)
        .with_max_fall_speed(tuning.max_fall_speed)
        .with_ground_probe_distance(tuning.ground_probe_distance)
        .with_step_offset(tuning.step_offset)
        .with_coyote_time_seconds(tuning.coyote_time_seconds)
        .with_jump_buffer_seconds(tuning.jump_buffer_seconds)
        .with_one_way_platforms(one_way_config())
}

fn platformer_controller_tuning(world: &World, player: Entity) -> PlatformerControllerTuning {
    let mut tuning = PlatformerControllerTuning::default();
    if let Some(MovementPattern::PlatformerInput {
        horizontal_speed,
        gravity,
        jump_speed,
        max_fall_speed,
        ground_probe_distance,
        step_offset,
        coyote_time_seconds,
        jump_buffer_seconds,
    }) = movement_pattern(world, player)
    {
        tuning.horizontal_speed = positive_or(tuning.horizontal_speed, horizontal_speed);
        tuning.gravity = positive_or(tuning.gravity, gravity);
        tuning.jump_speed = positive_or(tuning.jump_speed, jump_speed);
        tuning.max_fall_speed = positive_or(tuning.max_fall_speed, max_fall_speed);
        tuning.ground_probe_distance =
            non_negative_or(tuning.ground_probe_distance, ground_probe_distance);
        tuning.step_offset = non_negative_or(tuning.step_offset, step_offset);
        tuning.coyote_time_seconds =
            non_negative_or(tuning.coyote_time_seconds, coyote_time_seconds);
        tuning.jump_buffer_seconds =
            non_negative_or(tuning.jump_buffer_seconds, jump_buffer_seconds);
        return tuning;
    }
    tuning.horizontal_speed = platformer_player_horizontal_speed(world, player);
    tuning
}

fn platformer_player_horizontal_speed(world: &World, player: Entity) -> f32 {
    match movement_pattern(world, player) {
        Some(MovementPattern::TopdownInput { speed }) if speed.is_finite() && speed > 0.0 => speed,
        Some(MovementPattern::PlatformerInput {
            horizontal_speed, ..
        }) if horizontal_speed.is_finite() && horizontal_speed > 0.0 => horizontal_speed,
        _ => HORIZONTAL_SPEED,
    }
}

fn platformer_input_movement(tuning: PlatformerControllerTuning) -> MovementPattern {
    MovementPattern::PlatformerInput {
        horizontal_speed: tuning.horizontal_speed,
        gravity: tuning.gravity,
        jump_speed: tuning.jump_speed,
        max_fall_speed: tuning.max_fall_speed,
        ground_probe_distance: tuning.ground_probe_distance,
        step_offset: tuning.step_offset,
        coyote_time_seconds: tuning.coyote_time_seconds,
        jump_buffer_seconds: tuning.jump_buffer_seconds,
    }
}

fn movement_pattern(world: &World, entity: Entity) -> Option<MovementPattern> {
    world.movement_pattern(entity)
}

fn positive_or(fallback: f32, value: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

fn non_negative_or(fallback: f32, value: f32) -> f32 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        fallback
    }
}

fn moving_platform_path(world: &World, platform: Entity) -> MovingPlatformPath {
    let mut path = MovingPlatformPath::default();
    let Some(MovementPattern::Oscillate {
        origin_x,
        origin_y,
        amplitude_x,
        amplitude_y,
        phase_speed,
    }) = movement_pattern(world, platform)
    else {
        return path;
    };
    if origin_x.is_finite() && origin_y.is_finite() {
        path.origin = Transform2D {
            x: origin_x,
            y: origin_y,
        };
    }
    if amplitude_x.is_finite() {
        path.amplitude_x = amplitude_x;
    }
    if amplitude_y.is_finite() {
        path.amplitude_y = amplitude_y;
    }
    if phase_speed.is_finite() {
        path.phase_speed = phase_speed;
    }
    path
}

fn attach_player_landing_reactions(world: &mut World, player: Entity) {
    world.add_collision_reaction(
        player,
        CollisionReaction::SpawnParticle {
            preset_id: LANDING_DUST_PARTICLE_PRESET_ID,
            target: CollisionTarget::SelfEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Enter,
        },
    );
}

fn spawn_landing_reaction_particles(
    world: &mut World,
    player: Entity,
    landing_particles: Option<&mut PlatformerParticleBurstSink<'_>>,
) {
    let Some(sink) = landing_particles else {
        return;
    };
    let mut evaluations: [Option<CollisionSideEffectEvaluation>;
        MAX_COLLISION_REACTIONS_PER_ENTITY] = [None; MAX_COLLISION_REACTIONS_PER_ENTITY];
    let mut evaluation_count = 0;
    if let Some((player_index, reactions)) = world.collision_reactions_mut(player) {
        for reaction in reactions.iter_mut() {
            if let Some(evaluation) =
                commit_tile_collision_side_effect_reaction(player_index, reaction)
            {
                evaluations[evaluation_count] = Some(evaluation);
                evaluation_count += 1;
            }
        }
    }
    for evaluation in evaluations.into_iter().take(evaluation_count).flatten() {
        if let Some(CollisionSideEffectPayload::SpawnParticleAt {
            preset_id,
            position,
        }) = collision_side_effect_payload(world, evaluation)
        {
            sink.spawn_landing_dust(preset_id, position);
        }
    }
}

fn solid_mask() -> CollisionMask {
    CollisionMask::WALL.union(CollisionMask::ENEMY)
}

fn one_way_config() -> OneWayPlatformConfig {
    OneWayPlatformConfig::new(CollisionMask::ENEMY)
}

fn spawn_platform(
    world: &mut World,
    x: f32,
    y: f32,
    width: f32,
    layer: CollisionLayer,
    color: [f32; 4],
) -> Entity {
    spawn_body(
        world,
        Transform2D { x, y },
        width,
        PLATFORM_HEIGHT,
        layer,
        Velocity::default(),
        color,
    )
}

fn spawn_player_body(world: &mut World, transform: Transform2D) -> Entity {
    spawn_body_from_request(
        world,
        PlatformerBodySpawnRequest {
            transform,
            width: PLAYER_WIDTH,
            height: PLAYER_HEIGHT,
            layer: CollisionLayer::Player,
            velocity: Velocity::default(),
            color: [0.94, 0.26, 0.34, 1.0],
            player_marker: true,
        },
    )
}

fn spawn_body(
    world: &mut World,
    transform: Transform2D,
    width: f32,
    height: f32,
    layer: CollisionLayer,
    velocity: Velocity,
    color: [f32; 4],
) -> Entity {
    spawn_body_from_request(
        world,
        PlatformerBodySpawnRequest {
            transform,
            width,
            height,
            layer,
            velocity,
            color,
            player_marker: false,
        },
    )
}

#[derive(Clone, Copy, Debug)]
struct PlatformerBodySpawnRequest {
    transform: Transform2D,
    width: f32,
    height: f32,
    layer: CollisionLayer,
    velocity: Velocity,
    color: [f32; 4],
    player_marker: bool,
}

fn spawn_body_from_request(world: &mut World, request: PlatformerBodySpawnRequest) -> Entity {
    world.spawn_prefab_entity_from_request(PrefabEntitySpawnRequest {
        transform: request.transform,
        velocity: Some(request.velocity),
        texture_id: DEFAULT_TEXTURE_ID,
        template: EntityTemplate::new(request.width, request.height).with_collider(
            EntityTemplateCollider::aabb(
                request.width * 0.5,
                request.height * 0.5,
                0.0,
                0.0,
                true,
                false,
                None,
            ),
        ),
        layer: request.layer,
        sprite_tint: PrefabSpriteTint {
            r: request.color[0],
            g: request.color[1],
            b: request.color[2],
            a: request.color[3],
        },
        lifetime_seconds: None,
        projectile_policy: None,
        gameplay_faction: None,
        damage: None,
        health: None,
        score_reward: None,
        player_marker: request.player_marker,
    })
}

fn action_pressed(input: InputState) -> bool {
    input.space == 1 || input.enter == 1 || input.mouse_left == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_level_spawns_platformer_bodies() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);

        scene.reset_to_title(&mut world, &mut camera);

        assert_eq!(scene.game_state(), GameState::Title);
        assert_eq!(world.alive_count(), 8);
        let player = scene.player.expect("platformer player should exist");
        let moving_platform = scene.moving_platform.expect("moving platform should exist");
        assert_eq!(world.player_entity(), Some(player));
        assert_eq!(
            world.movement_pattern(player),
            Some(platformer_input_movement(
                PlatformerControllerTuning::default()
            ))
        );
        let reactions = world.collision_reactions[player.id as usize]
            .expect("player has authored landing reactions");
        assert_eq!(reactions.len(), 1);
        assert!(reactions.iter().any(|reaction| matches!(
            reaction,
            CollisionReaction::SpawnParticle { preset_id, .. }
                if preset_id == LANDING_DUST_PARTICLE_PRESET_ID
        )));
        assert_eq!(
            world.movement_pattern(moving_platform),
            Some(MovementPattern::Oscillate {
                origin_x: MOVING_PLATFORM_ORIGIN_X,
                origin_y: MOVING_PLATFORM_Y,
                amplitude_x: MOVING_PLATFORM_AMPLITUDE,
                amplitude_y: 0.0,
                phase_speed: MOVING_PLATFORM_SPEED,
            })
        );
        assert!(
            !world
                .colliders
                .get(player.id as usize)
                .copied()
                .flatten()
                .expect("player collider should exist")
                .is_trigger
        );
    }

    #[test]
    fn authored_metadata_drives_platformer_scene_tuning_sources() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        scene.reset_playing(&mut world, &mut camera);
        let player = scene.player.expect("platformer player should exist");
        let moving_platform = scene.moving_platform.expect("moving platform should exist");

        let authored_tuning = PlatformerControllerTuning {
            horizontal_speed: 96.0,
            gravity: 700.0,
            jump_speed: 360.0,
            max_fall_speed: 640.0,
            ground_probe_distance: 4.0,
            step_offset: 8.0,
            coyote_time_seconds: 0.12,
            jump_buffer_seconds: 0.16,
        };
        world.set_movement_pattern(player, platformer_input_movement(authored_tuning));
        world.set_movement_pattern(
            moving_platform,
            MovementPattern::Oscillate {
                origin_x: 700.0,
                origin_y: 480.0,
                amplitude_x: 64.0,
                amplitude_y: 12.0,
                phase_speed: -2.0,
            },
        );

        assert_eq!(platformer_player_horizontal_speed(&world, player), 96.0);
        assert_eq!(
            platformer_controller_tuning(&world, player),
            authored_tuning
        );
        assert_eq!(
            moving_platform_path(&world, moving_platform),
            MovingPlatformPath {
                origin: Transform2D { x: 700.0, y: 480.0 },
                amplitude_x: 64.0,
                amplitude_y: 12.0,
                phase_speed: -2.0,
            }
        );

        world.set_movement_pattern(player, MovementPattern::Linear { vx: 1.0, vy: 0.0 });
        assert_eq!(
            platformer_player_horizontal_speed(&world, player),
            HORIZONTAL_SPEED
        );
    }

    #[test]
    fn moving_platform_path_ignores_linear_velocity_metadata() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        scene.reset_playing(&mut world, &mut camera);
        let moving_platform = scene.moving_platform.expect("moving platform should exist");

        world.set_movement_pattern(
            moving_platform,
            MovementPattern::Linear { vx: -2.0, vy: 0.0 },
        );

        assert_eq!(
            moving_platform_path(&world, moving_platform),
            MovingPlatformPath::default()
        );
    }

    #[test]
    fn platformer_metadata_helpers_ignore_stale_reused_entities() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        scene.reset_playing(&mut world, &mut camera);
        let stale_player = scene.player.expect("platformer player should exist");

        world.despawn(stale_player);
        let reused_player = spawn_player_body(
            &mut world,
            Transform2D {
                x: PLAYER_START_X,
                y: PLAYER_START_Y,
            },
        );
        assert_eq!(reused_player.id, stale_player.id);
        assert_ne!(reused_player.generation, stale_player.generation);
        world.set_movement_pattern(
            reused_player,
            MovementPattern::TopdownInput { speed: 999.0 },
        );

        assert_eq!(movement_pattern(&world, stale_player), None);
        assert_eq!(
            platformer_player_horizontal_speed(&world, stale_player),
            HORIZONTAL_SPEED
        );
        assert_eq!(
            world.movement_pattern(reused_player),
            Some(MovementPattern::TopdownInput { speed: 999.0 })
        );
    }

    #[test]
    fn invalid_platformer_controller_metadata_falls_back_per_field() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        scene.reset_playing(&mut world, &mut camera);
        let player = scene.player.expect("platformer player should exist");

        world.set_movement_pattern(
            player,
            MovementPattern::PlatformerInput {
                horizontal_speed: -1.0,
                gravity: f32::NAN,
                jump_speed: 300.0,
                max_fall_speed: 0.0,
                ground_probe_distance: f32::INFINITY,
                step_offset: 0.0,
                coyote_time_seconds: -0.1,
                jump_buffer_seconds: 0.2,
            },
        );

        assert_eq!(
            platformer_controller_tuning(&world, player),
            PlatformerControllerTuning {
                jump_speed: 300.0,
                step_offset: 0.0,
                jump_buffer_seconds: 0.2,
                ..PlatformerControllerTuning::default()
            }
        );
    }

    #[test]
    fn moving_platform_path_supports_reverse_authored_phase_speed() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut counters = PhysicsCounters::default();
        scene.reset_playing(&mut world, &mut camera);
        let moving_platform = scene.moving_platform.expect("moving platform should exist");
        let start = world
            .transform(moving_platform)
            .expect("moving platform transform should exist");
        world.set_movement_pattern(
            moving_platform,
            MovementPattern::Oscillate {
                origin_x: MOVING_PLATFORM_ORIGIN_X,
                origin_y: MOVING_PLATFORM_Y,
                amplitude_x: MOVING_PLATFORM_AMPLITUDE,
                amplitude_y: 0.0,
                phase_speed: -2.0,
            },
        );

        scene.update(
            &mut world,
            &mut camera,
            InputState::default(),
            0.25,
            &mut counters,
            None,
        );

        let end = world
            .transform(moving_platform)
            .expect("moving platform transform should exist");
        assert!(end.x < start.x);
        assert_eq!(end.y, MOVING_PLATFORM_Y);
    }

    #[test]
    fn action_starts_platformer_and_controller_moves_player() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut counters = PhysicsCounters::default();
        scene.reset_to_title(&mut world, &mut camera);

        scene.update(
            &mut world,
            &mut camera,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            0.016,
            &mut counters,
            None,
        );
        let player = scene.player.expect("platformer player should exist");
        let start = world
            .transform(player)
            .expect("player transform should exist");

        scene.update(
            &mut world,
            &mut camera,
            InputState {
                d: 1,
                ..InputState::default()
            },
            0.25,
            &mut counters,
            None,
        );

        let end = world
            .transform(player)
            .expect("player transform should exist");
        assert_eq!(scene.game_state(), GameState::Playing);
        assert!(end.x > start.x);
        assert!(end.y > start.y);
        assert!(counters.kinematic_moves > 0);
    }

    #[test]
    fn grounded_jump_moves_player_up() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut counters = PhysicsCounters::default();
        scene.reset_playing(&mut world, &mut camera);
        let player = scene.player.expect("platformer player should exist");
        world.set_transform(
            player,
            Transform2D {
                x: PLAYER_START_X,
                y: WORLD_HEIGHT - FLOOR_HEIGHT - PLAYER_HEIGHT * 0.5,
            },
        );

        scene.update(
            &mut world,
            &mut camera,
            InputState {
                space: 1,
                ..InputState::default()
            },
            0.25,
            &mut counters,
            None,
        );

        let velocity = world
            .velocity(player)
            .expect("player velocity should exist");
        assert!(velocity.vy < 0.0);
        assert!(world.transform(player).unwrap().y < WORLD_HEIGHT - FLOOR_HEIGHT);
    }

    #[test]
    fn falling_player_landing_spawns_dust_burst_when_sink_is_bound() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut counters = PhysicsCounters::default();
        let mut particles = ParticleSystem::with_capacity(LANDING_DUST_PARTICLE_COUNT as usize);
        let mut landing_particles = PlatformerParticleBurstSink::new(
            &mut particles,
            platformer_landing_dust_particle_preset(),
        );
        scene.reset_playing(&mut world, &mut camera);
        let player = scene.player.expect("platformer player should exist");
        world.set_transform(
            player,
            Transform2D {
                x: PLAYER_START_X,
                y: WORLD_HEIGHT - FLOOR_HEIGHT - PLAYER_HEIGHT * 0.5 - 18.0,
            },
        );
        world.set_velocity(player, Velocity { vx: 0.0, vy: 220.0 });

        scene.update(
            &mut world,
            &mut camera,
            InputState::default(),
            0.1,
            &mut counters,
            Some(&mut landing_particles),
        );

        assert_eq!(
            particles.particle_count(),
            LANDING_DUST_PARTICLE_COUNT as usize
        );
        assert!(scene.player_was_grounded);
    }

    #[test]
    fn landing_dust_requires_authored_player_reaction() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut counters = PhysicsCounters::default();
        let mut particles = ParticleSystem::with_capacity(LANDING_DUST_PARTICLE_COUNT as usize);
        let mut landing_particles = PlatformerParticleBurstSink::new(
            &mut particles,
            platformer_landing_dust_particle_preset(),
        );
        scene.reset_playing(&mut world, &mut camera);
        let player = scene.player.expect("platformer player should exist");
        world.clear_collision_reactions(player);
        world.set_transform(
            player,
            Transform2D {
                x: PLAYER_START_X,
                y: WORLD_HEIGHT - FLOOR_HEIGHT - PLAYER_HEIGHT * 0.5 - 18.0,
            },
        );
        world.set_velocity(player, Velocity { vx: 0.0, vy: 220.0 });

        scene.update(
            &mut world,
            &mut camera,
            InputState::default(),
            0.1,
            &mut counters,
            Some(&mut landing_particles),
        );

        assert_eq!(particles.particle_count(), 0);
        assert!(scene.player_was_grounded);
    }

    #[test]
    fn landing_dust_ignores_stale_reused_player_handle() {
        let mut scene = PlatformerScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(800.0, 480.0);
        let mut particles = ParticleSystem::with_capacity(LANDING_DUST_PARTICLE_COUNT as usize);
        scene.reset_playing(&mut world, &mut camera);
        let stale_player = scene.player.expect("platformer player should exist");

        world.despawn(stale_player);
        let reused_player = spawn_player_body(
            &mut world,
            Transform2D {
                x: PLAYER_START_X,
                y: WORLD_HEIGHT - FLOOR_HEIGHT - PLAYER_HEIGHT * 0.5,
            },
        );
        assert_eq!(reused_player.id, stale_player.id);
        assert_ne!(reused_player.generation, stale_player.generation);
        attach_player_landing_reactions(&mut world, reused_player);

        let mut landing_particles = PlatformerParticleBurstSink::new(
            &mut particles,
            platformer_landing_dust_particle_preset(),
        );
        spawn_landing_reaction_particles(&mut world, stale_player, Some(&mut landing_particles));
        assert_eq!(landing_particles.particles.particle_count(), 0);

        spawn_landing_reaction_particles(&mut world, reused_player, Some(&mut landing_particles));
        assert_eq!(
            landing_particles.particles.particle_count(),
            LANDING_DUST_PARTICLE_COUNT as usize
        );
    }
}
