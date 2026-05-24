use std::f32::consts::TAU;

use crate::camera::Camera2D;
use crate::components::{
    AabbCollider, CollisionFilter, CollisionLayer, CollisionMask, Sprite, SpriteFrame, Transform2D,
    Velocity,
};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::particles::{ParticlePreset, ParticleRange, ParticleSystem};
use crate::physics::{
    MovingPlatformCarryConfig, OneWayPlatformConfig, PhysicsCounters, PhysicsSystem,
    PlatformerControllerConfig, PlatformerControllerInput, PlatformerControllerState,
};
use crate::world::World;

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
const LANDING_DUST_PARTICLE_COUNT: u32 = 12;

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
    preset: ParticlePreset,
}

impl<'a> PlatformerParticleBurstSink<'a> {
    pub(crate) fn new(particles: &'a mut ParticleSystem, preset: ParticlePreset) -> Self {
        Self { particles, preset }
    }

    fn spawn_landing_dust(&mut self, position: Transform2D) -> usize {
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
        self.moving_platform = Some(spawn_platform(
            world,
            MOVING_PLATFORM_ORIGIN_X,
            MOVING_PLATFORM_Y,
            150.0,
            CollisionLayer::Wall,
            [0.24, 0.78, 0.82, 1.0],
        ));

        let player = spawn_body(
            world,
            Transform2D {
                x: PLAYER_START_X,
                y: PLAYER_START_Y,
            },
            PLAYER_WIDTH,
            PLAYER_HEIGHT,
            CollisionLayer::Player,
            Velocity::default(),
            [0.94, 0.26, 0.34, 1.0],
        );
        world.player = Some(player);
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
        self.moving_platform_phase += delta * MOVING_PLATFORM_SPEED;
        if self.moving_platform_phase > TAU {
            self.moving_platform_phase -= TAU;
        }
        let next = Transform2D {
            x: MOVING_PLATFORM_ORIGIN_X
                + self.moving_platform_phase.sin() * MOVING_PLATFORM_AMPLITUDE,
            y: current.y,
        };
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
        let result = PhysicsSystem::move_platformer_controller_with_state_and_counters(
            world,
            player,
            PlatformerControllerInput::new(horizontal_axis, jump_pressed),
            platformer_config(),
            delta,
            &mut self.controller_state,
            physics_counters,
        );
        if !self.player_was_grounded && result.grounded {
            if let (Some(sink), Some(position)) = (landing_particles, world.transform(player)) {
                sink.spawn_landing_dust(position);
            }
        }
        self.player_was_grounded = result.grounded;
    }
}

fn platformer_config() -> PlatformerControllerConfig {
    PlatformerControllerConfig::new(solid_mask(), 4)
        .with_horizontal_speed(HORIZONTAL_SPEED)
        .with_gravity(GRAVITY)
        .with_jump_speed(JUMP_SPEED)
        .with_max_fall_speed(MAX_FALL_SPEED)
        .with_ground_probe_distance(GROUND_PROBE_DISTANCE)
        .with_step_offset(STEP_OFFSET)
        .with_coyote_time_seconds(COYOTE_TIME_SECONDS)
        .with_jump_buffer_seconds(JUMP_BUFFER_SECONDS)
        .with_one_way_platforms(one_way_config())
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

fn spawn_body(
    world: &mut World,
    transform: Transform2D,
    width: f32,
    height: f32,
    layer: CollisionLayer,
    velocity: Velocity,
    color: [f32; 4],
) -> Entity {
    let entity = world.spawn_entity();
    let index = entity.id as usize;
    let (u0, v0, u1, v1) = SpriteFrame::FULL.uv();
    world.transforms[index] = Some(transform);
    world.velocities[index] = Some(velocity);
    world.sprites[index] = Some(Sprite {
        texture_id: DEFAULT_TEXTURE_ID,
        width,
        height,
        u0,
        v0,
        u1,
        v1,
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3],
    });
    world.colliders[index] = Some(AabbCollider {
        half_width: width * 0.5,
        half_height: height * 0.5,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: false,
        layer,
    });
    world.collision_filters[index] = Some(CollisionFilter::from_layer(layer));
    entity
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
        assert!(scene.player.is_some());
        assert!(scene.moving_platform.is_some());
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
}
