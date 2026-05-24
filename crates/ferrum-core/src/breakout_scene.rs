use crate::camera::Camera2D;
use crate::collision::CollisionSystem;
use crate::collision_event::{CollisionEvent, CollisionEventCounts, COLLISION_EVENT_HIT};
use crate::components::{
    AabbCollider, CollisionFilter, CollisionLayer, Sprite, SpriteFrame, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::particles::{ParticlePreset, ParticleRange, ParticleSystem};
use crate::world::World;

const DEFAULT_TEXTURE_ID: u32 = 0;
const WORLD_WIDTH: f32 = 800.0;
const WORLD_HEIGHT: f32 = 480.0;
const PADDLE_WIDTH: f32 = 96.0;
const PADDLE_HEIGHT: f32 = 16.0;
const PADDLE_SPEED: f32 = 420.0;
const PADDLE_Y: f32 = 430.0;
const BALL_SIZE: f32 = 12.0;
const BALL_SPEED: f32 = 285.0;
const WALL_THICKNESS: f32 = 12.0;
const BRICK_COLUMNS: u32 = 10;
const BRICK_ROWS: u32 = 5;
const BRICK_WIDTH: f32 = 62.0;
const BRICK_HEIGHT: f32 = 20.0;
const BRICK_GAP: f32 = 8.0;
const BRICK_START_Y: f32 = 68.0;
const BRICK_SCORE: u32 = 10;
const BRICK_HIT_PARTICLE_COUNT: u32 = 10;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BreakoutHitKind {
    Paddle,
    Brick,
    Wall,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct BreakoutHit {
    entity: Entity,
    kind: BreakoutHitKind,
    time: f32,
    normal_x: f32,
    normal_y: f32,
}

#[derive(Debug)]
pub(crate) struct BreakoutScene {
    game_state: GameState,
    score: u32,
    paddle: Option<Entity>,
    ball: Option<Entity>,
    bricks: Vec<Entity>,
    walls: Vec<Entity>,
}

pub(crate) struct BreakoutParticleBurstSink<'a> {
    particles: &'a mut ParticleSystem,
    preset: ParticlePreset,
}

impl<'a> BreakoutParticleBurstSink<'a> {
    pub(crate) fn new(particles: &'a mut ParticleSystem, preset: ParticlePreset) -> Self {
        Self { particles, preset }
    }

    fn spawn_brick_hit(&mut self, position: Transform2D) -> usize {
        self.particles
            .spawn_burst(self.preset, position.x, position.y)
    }
}

pub(crate) fn breakout_brick_hit_particle_preset() -> ParticlePreset {
    let mut preset = ParticlePreset::new(DEFAULT_TEXTURE_ID);
    preset.burst_count = BRICK_HIT_PARTICLE_COUNT;
    preset.lifetime_seconds = ParticleRange::new(0.14, 0.3);
    preset.speed = ParticleRange::new(70.0, 190.0);
    preset.start_size = ParticleRange::new(6.0, 10.0);
    preset.end_size = ParticleRange::constant(1.5);
    preset.start_color = [1.0, 0.88, 0.36, 1.0];
    preset.end_color = [1.0, 0.28, 0.08, 0.0];
    preset.damping = 1.8;
    preset
}

impl Default for BreakoutScene {
    fn default() -> Self {
        Self {
            game_state: GameState::Title,
            score: 0,
            paddle: None,
            ball: None,
            bricks: Vec::with_capacity((BRICK_COLUMNS * BRICK_ROWS) as usize),
            walls: Vec::with_capacity(3),
        }
    }
}

impl BreakoutScene {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn reset_to_title(&mut self, world: &mut World, camera: &mut Camera2D) {
        self.score = 0;
        self.rebuild_level(world, camera, GameState::Title, false);
    }

    pub(crate) fn reset_playing(&mut self, world: &mut World, camera: &mut Camera2D) {
        self.score = 0;
        self.rebuild_level(world, camera, GameState::Playing, true);
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: crate::input::InputState,
        delta: f32,
        collision_events: &mut Vec<CollisionEvent>,
        collision_event_counts: &mut CollisionEventCounts,
        hit_particles: Option<&mut BreakoutParticleBurstSink<'_>>,
    ) {
        match self.game_state {
            GameState::Title => {
                if action_pressed(input) {
                    self.reset_playing(world, camera);
                }
            }
            GameState::Playing => {
                self.update_playing(
                    world,
                    input,
                    delta,
                    collision_events,
                    collision_event_counts,
                    hit_particles,
                );
            }
            GameState::GameOver => {
                if action_pressed(input) {
                    self.reset_playing(world, camera);
                }
            }
        }
        self.update_camera(camera);
    }

    pub(crate) fn update_camera(&self, camera: &mut Camera2D) {
        camera.x = WORLD_WIDTH * 0.5;
        camera.y = WORLD_HEIGHT * 0.5;
    }

    pub(crate) fn score(&self) -> u32 {
        self.score
    }

    pub(crate) fn game_state(&self) -> GameState {
        self.game_state
    }

    fn rebuild_level(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        game_state: GameState,
        launch_ball: bool,
    ) {
        *world = World::default();
        self.paddle = None;
        self.ball = None;
        self.bricks.clear();
        self.walls.clear();
        self.game_state = game_state;
        self.update_camera(camera);

        self.spawn_walls(world);
        let paddle = spawn_body(
            world,
            Transform2D {
                x: WORLD_WIDTH * 0.5,
                y: PADDLE_Y,
            },
            PADDLE_WIDTH,
            PADDLE_HEIGHT,
            CollisionLayer::Player,
            Velocity::default(),
            [0.2, 0.85, 0.45, 1.0],
        );
        world.player = Some(paddle);
        self.paddle = Some(paddle);

        let ball_velocity = if launch_ball {
            Velocity {
                vx: BALL_SPEED * 0.55,
                vy: -BALL_SPEED,
            }
        } else {
            Velocity::default()
        };
        self.ball = Some(spawn_body(
            world,
            Transform2D {
                x: WORLD_WIDTH * 0.5,
                y: PADDLE_Y - 28.0,
            },
            BALL_SIZE,
            BALL_SIZE,
            CollisionLayer::Bullet,
            ball_velocity,
            [0.96, 0.98, 0.78, 1.0],
        ));

        self.spawn_bricks(world);
    }

    fn spawn_walls(&mut self, world: &mut World) {
        self.walls.push(spawn_body(
            world,
            Transform2D {
                x: WALL_THICKNESS * 0.5,
                y: WORLD_HEIGHT * 0.5,
            },
            WALL_THICKNESS,
            WORLD_HEIGHT,
            CollisionLayer::Wall,
            Velocity::default(),
            [0.18, 0.45, 0.9, 1.0],
        ));
        self.walls.push(spawn_body(
            world,
            Transform2D {
                x: WORLD_WIDTH - WALL_THICKNESS * 0.5,
                y: WORLD_HEIGHT * 0.5,
            },
            WALL_THICKNESS,
            WORLD_HEIGHT,
            CollisionLayer::Wall,
            Velocity::default(),
            [0.18, 0.45, 0.9, 1.0],
        ));
        self.walls.push(spawn_body(
            world,
            Transform2D {
                x: WORLD_WIDTH * 0.5,
                y: WALL_THICKNESS * 0.5,
            },
            WORLD_WIDTH,
            WALL_THICKNESS,
            CollisionLayer::Wall,
            Velocity::default(),
            [0.18, 0.45, 0.9, 1.0],
        ));
    }

    fn spawn_bricks(&mut self, world: &mut World) {
        let total_width =
            BRICK_COLUMNS as f32 * BRICK_WIDTH + (BRICK_COLUMNS - 1) as f32 * BRICK_GAP;
        let start_x = (WORLD_WIDTH - total_width) * 0.5 + BRICK_WIDTH * 0.5;
        for row in 0..BRICK_ROWS {
            for column in 0..BRICK_COLUMNS {
                let entity = spawn_body(
                    world,
                    Transform2D {
                        x: start_x + column as f32 * (BRICK_WIDTH + BRICK_GAP),
                        y: BRICK_START_Y + row as f32 * (BRICK_HEIGHT + BRICK_GAP),
                    },
                    BRICK_WIDTH,
                    BRICK_HEIGHT,
                    CollisionLayer::Enemy,
                    Velocity::default(),
                    brick_color(row),
                );
                world.score_rewards[entity.id as usize] = Some(BRICK_SCORE);
                self.bricks.push(entity);
            }
        }
    }

    fn update_playing(
        &mut self,
        world: &mut World,
        input: crate::input::InputState,
        delta: f32,
        collision_events: &mut Vec<CollisionEvent>,
        collision_event_counts: &mut CollisionEventCounts,
        hit_particles: Option<&mut BreakoutParticleBurstSink<'_>>,
    ) {
        if !delta.is_finite() || delta <= 0.0 {
            return;
        }

        self.update_paddle(world, input, delta);
        let Some(ball) = self.ball else {
            return;
        };
        if !is_alive(world, ball) {
            return;
        }

        let Some(hit) = self.first_ball_hit(world, ball, delta) else {
            self.integrate_ball(world, ball, delta);
            self.finish_playing_frame(world);
            return;
        };

        self.move_ball_to_contact(world, ball, delta, hit.time);
        push_hit_event(collision_events, collision_event_counts, ball, hit.entity);
        self.apply_ball_response(world, ball, hit, hit_particles);
        self.finish_playing_frame(world);
    }

    fn update_paddle(&self, world: &mut World, input: crate::input::InputState, delta: f32) {
        let Some(paddle) = self.paddle else {
            return;
        };
        let index = paddle.id as usize;
        if !is_alive(world, paddle) {
            return;
        }

        let direction = f32::from(input.d) - f32::from(input.a);
        let Some(transform) = world.transforms[index].as_mut() else {
            return;
        };
        let Some(collider) = world.colliders[index] else {
            return;
        };
        if !collider.enabled {
            return;
        }
        transform.x = (transform.x + direction * PADDLE_SPEED * delta).clamp(
            WALL_THICKNESS + collider.half_width,
            WORLD_WIDTH - WALL_THICKNESS - collider.half_width,
        );
    }

    fn first_ball_hit(&self, world: &World, ball: Entity, delta: f32) -> Option<BreakoutHit> {
        let ball_index = ball.id as usize;
        let start = world.transforms.get(ball_index).copied().flatten()?;
        let velocity = world.velocities.get(ball_index).copied().flatten()?;
        let collider = world.colliders.get(ball_index).copied().flatten()?;
        if !collider.enabled {
            return None;
        }
        let mut best: Option<(f32, BreakoutHit)> = None;

        if let Some(paddle) = self.paddle {
            update_best_hit(
                world,
                ball,
                start,
                velocity,
                collider,
                paddle,
                BreakoutHitKind::Paddle,
                delta,
                &mut best,
            );
        }
        for wall in self.walls.iter().copied() {
            update_best_hit(
                world,
                ball,
                start,
                velocity,
                collider,
                wall,
                BreakoutHitKind::Wall,
                delta,
                &mut best,
            );
        }
        for brick in self.bricks.iter().copied() {
            update_best_hit(
                world,
                ball,
                start,
                velocity,
                collider,
                brick,
                BreakoutHitKind::Brick,
                delta,
                &mut best,
            );
        }

        best.map(|(_, hit)| hit)
    }

    fn integrate_ball(&self, world: &mut World, ball: Entity, delta: f32) {
        let index = ball.id as usize;
        if let (Some(transform), Some(velocity)) =
            (world.transforms[index].as_mut(), world.velocities[index])
        {
            transform.x += velocity.vx * delta;
            transform.y += velocity.vy * delta;
        }
    }

    fn move_ball_to_contact(&self, world: &mut World, ball: Entity, delta: f32, time: f32) {
        let index = ball.id as usize;
        if let (Some(transform), Some(velocity)) =
            (world.transforms[index].as_mut(), world.velocities[index])
        {
            let travel_seconds = delta * time.clamp(0.0, 1.0);
            transform.x += velocity.vx * travel_seconds;
            transform.y += velocity.vy * travel_seconds;
        }
    }

    fn apply_ball_response(
        &mut self,
        world: &mut World,
        ball: Entity,
        hit: BreakoutHit,
        hit_particles: Option<&mut BreakoutParticleBurstSink<'_>>,
    ) {
        match hit.kind {
            BreakoutHitKind::Paddle => self.bounce_from_paddle(world, ball, hit.entity),
            BreakoutHitKind::Brick => {
                self.bounce_from_surface(world, ball, hit.normal_x, hit.normal_y);
                let hit_position = world.transforms[hit.entity.id as usize];
                if let (Some(sink), Some(position)) = (hit_particles, hit_position) {
                    sink.spawn_brick_hit(position);
                }
                let reward = world.score_rewards[hit.entity.id as usize].unwrap_or(BRICK_SCORE);
                self.score = self.score.saturating_add(reward);
                world.despawn(hit.entity);
            }
            BreakoutHitKind::Wall => {
                self.bounce_from_surface(world, ball, hit.normal_x, hit.normal_y)
            }
        }
    }

    fn bounce_from_paddle(&self, world: &mut World, ball: Entity, paddle: Entity) {
        let ball_index = ball.id as usize;
        let paddle_index = paddle.id as usize;
        let (Some(ball_transform), Some(paddle_transform), Some(paddle_collider)) = (
            world.transforms[ball_index],
            world.transforms[paddle_index],
            world.colliders[paddle_index],
        ) else {
            return;
        };
        let Some(velocity) = world.velocities[ball_index].as_mut() else {
            return;
        };

        let offset =
            ((ball_transform.x - paddle_transform.x) / paddle_collider.half_width).clamp(-1.0, 1.0);
        velocity.vx = offset * BALL_SPEED;
        velocity.vy = -BALL_SPEED;
    }

    fn bounce_from_surface(&self, world: &mut World, ball: Entity, normal_x: f32, normal_y: f32) {
        let Some(velocity) = world.velocities[ball.id as usize].as_mut() else {
            return;
        };
        if normal_x.abs() >= normal_y.abs() {
            velocity.vx = -velocity.vx;
        } else {
            velocity.vy = -velocity.vy;
        }
    }

    fn finish_playing_frame(&mut self, world: &World) {
        if self.ball_is_lost(world) || self.remaining_bricks(world) == 0 {
            self.game_state = GameState::GameOver;
        }
    }

    fn ball_is_lost(&self, world: &World) -> bool {
        let Some(ball) = self.ball else {
            return true;
        };
        let Some(transform) = world.transforms.get(ball.id as usize).copied().flatten() else {
            return true;
        };
        transform.y > WORLD_HEIGHT + BALL_SIZE
    }

    fn remaining_bricks(&self, world: &World) -> usize {
        self.bricks
            .iter()
            .copied()
            .filter(|brick| is_alive(world, *brick))
            .count()
    }
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
    let frame = SpriteFrame::FULL;
    world.transforms[index] = Some(transform);
    world.sprites[index] = Some(Sprite {
        texture_id: DEFAULT_TEXTURE_ID,
        width,
        height,
        u0: frame.u0,
        v0: frame.v0,
        u1: frame.u1,
        v1: frame.v1,
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3],
    });
    world.velocities[index] = Some(velocity);
    world.colliders[index] = Some(AabbCollider {
        half_width: width * 0.5,
        half_height: height * 0.5,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: true,
        layer,
    });
    world.collision_filters[index] = Some(CollisionFilter::from_layer(layer));
    entity
}

#[allow(clippy::too_many_arguments)]
fn update_best_hit(
    world: &World,
    ball: Entity,
    start: Transform2D,
    velocity: Velocity,
    collider: AabbCollider,
    target: Entity,
    kind: BreakoutHitKind,
    delta: f32,
    best: &mut Option<(f32, BreakoutHit)>,
) {
    if target == ball || !is_alive(world, target) {
        return;
    }
    let target_index = target.id as usize;
    let (Some(target_transform), Some(target_collider)) = (
        world.transforms.get(target_index).copied().flatten(),
        world.colliders.get(target_index).copied().flatten(),
    ) else {
        return;
    };
    if !target_collider.enabled {
        return;
    }
    let Some(contact) = CollisionSystem::swept_aabb_contact(
        start,
        velocity,
        collider,
        target_transform,
        Velocity::default(),
        target_collider,
        delta,
    ) else {
        return;
    };
    let time = contact.time.clamp(0.0, 1.0);
    if best.as_ref().is_none_or(|(best_time, _)| time < *best_time) {
        *best = Some((
            time,
            BreakoutHit {
                entity: target,
                kind,
                time,
                normal_x: contact.normal_x,
                normal_y: contact.normal_y,
            },
        ));
    }
}

fn push_hit_event(
    events: &mut Vec<CollisionEvent>,
    counts: &mut CollisionEventCounts,
    ball: Entity,
    target: Entity,
) {
    events.push(CollisionEvent::from_entities_with_damage(
        COLLISION_EVENT_HIT,
        ball,
        target,
        0.0,
    ));
    counts.hit = counts.hit.saturating_add(1);
}

fn action_pressed(input: crate::input::InputState) -> bool {
    input.enter == 1 || input.space == 1
}

fn is_alive(world: &World, entity: Entity) -> bool {
    let index = entity.id as usize;
    index < world.alive.len() && world.alive[index] && world.generations[index] == entity.generation
}

fn brick_color(row: u32) -> [f32; 4] {
    match row % 5 {
        0 => [0.95, 0.28, 0.24, 1.0],
        1 => [0.98, 0.62, 0.22, 1.0],
        2 => [0.92, 0.82, 0.26, 1.0],
        3 => [0.23, 0.7, 0.92, 1.0],
        _ => [0.56, 0.45, 0.92, 1.0],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_level_spawns_breakout_bodies_without_launching_ball() {
        let mut scene = BreakoutScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);

        scene.reset_to_title(&mut world, &mut camera);

        assert_eq!(scene.game_state(), GameState::Title);
        assert_eq!(scene.score(), 0);
        assert_eq!(scene.remaining_bricks(&world), 50);
        assert_eq!(world.alive_count(), 55);
        let ball = scene.ball.expect("title level creates ball");
        assert_eq!(
            world.velocities[ball.id as usize],
            Some(Velocity::default())
        );
    }

    #[test]
    fn action_starts_breakout_and_launches_ball() {
        let mut scene = BreakoutScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);
        scene.reset_to_title(&mut world, &mut camera);

        scene.update(
            &mut world,
            &mut camera,
            crate::input::InputState {
                enter: 1,
                ..crate::input::InputState::default()
            },
            0.016,
            &mut Vec::new(),
            &mut CollisionEventCounts::default(),
            None,
        );

        let ball = scene.ball.expect("playing level creates ball");
        let velocity = world.velocities[ball.id as usize].expect("ball has velocity");
        assert_eq!(scene.game_state(), GameState::Playing);
        assert!(velocity.vy < 0.0);
    }

    #[test]
    fn ball_brick_hit_adds_score_and_records_hit_event() {
        let mut scene = BreakoutScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);
        let mut events = Vec::new();
        let mut counts = CollisionEventCounts::default();
        scene.reset_playing(&mut world, &mut camera);
        let ball = scene.ball.expect("playing level creates ball");
        let brick = *scene.bricks.last().expect("level has bricks");
        let brick_transform = world.transforms[brick.id as usize].expect("brick has transform");
        world.transforms[ball.id as usize] = Some(Transform2D {
            x: brick_transform.x,
            y: brick_transform.y + BRICK_HEIGHT,
        });
        world.velocities[ball.id as usize] = Some(Velocity {
            vx: 0.0,
            vy: -BALL_SPEED,
        });

        scene.update(
            &mut world,
            &mut camera,
            crate::input::InputState::default(),
            0.1,
            &mut events,
            &mut counts,
            None,
        );

        assert_eq!(scene.score(), BRICK_SCORE);
        assert!(!is_alive(&world, brick));
        assert_eq!(counts.hit, 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_HIT);
    }

    #[test]
    fn ball_brick_hit_spawns_particle_burst_when_sink_is_bound() {
        let mut scene = BreakoutScene::new();
        let mut world = World::default();
        let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);
        let mut events = Vec::new();
        let mut counts = CollisionEventCounts::default();
        let mut particles = ParticleSystem::with_capacity(BRICK_HIT_PARTICLE_COUNT as usize);
        let mut hit_particles =
            BreakoutParticleBurstSink::new(&mut particles, breakout_brick_hit_particle_preset());
        scene.reset_playing(&mut world, &mut camera);
        let ball = scene.ball.expect("playing level creates ball");
        let brick = *scene.bricks.last().expect("level has bricks");
        let brick_transform = world.transforms[brick.id as usize].expect("brick has transform");
        world.transforms[ball.id as usize] = Some(Transform2D {
            x: brick_transform.x,
            y: brick_transform.y + BRICK_HEIGHT,
        });
        world.velocities[ball.id as usize] = Some(Velocity {
            vx: 0.0,
            vy: -BALL_SPEED,
        });

        scene.update(
            &mut world,
            &mut camera,
            crate::input::InputState::default(),
            0.1,
            &mut events,
            &mut counts,
            Some(&mut hit_particles),
        );

        assert_eq!(counts.hit, 1);
        assert_eq!(
            particles.particle_count(),
            BRICK_HIT_PARTICLE_COUNT as usize
        );
        assert!(!is_alive(&world, brick));
    }
}
