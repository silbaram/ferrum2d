use crate::camera::Camera2D;
use crate::components::gameplay::{
    CollisionReaction, CollisionReactionTrigger, CollisionTarget, Cooldown, MovementPattern,
};
use crate::components::{CollisionLayer, Transform2D, Velocity, DEFAULT_SPRITE_RENDER_LAYER};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::world::{EntityTemplate, PrefabEntitySpawnRequest, PrefabSpriteTint, World};

use super::config::{
    BALL_SIZE, BALL_SPEED, BRICK_COLUMNS, BRICK_GAP, BRICK_HEIGHT, BRICK_HIT_PARTICLE_PRESET_ID,
    BRICK_ROWS, BRICK_SCORE, BRICK_START_Y, BRICK_WIDTH, DEFAULT_TEXTURE_ID, PADDLE_HEIGHT,
    PADDLE_SPEED, PADDLE_WIDTH, PADDLE_Y, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH,
};
use super::BreakoutScene;

impl BreakoutScene {
    pub(crate) fn reset_to_title(&mut self, world: &mut World, camera: &mut Camera2D) {
        self.score = 0;
        self.rebuild_level(world, camera, GameState::Title, false);
    }

    pub(crate) fn reset_playing(&mut self, world: &mut World, camera: &mut Camera2D) {
        self.score = 0;
        self.rebuild_level(world, camera, GameState::Playing, true);
    }

    pub(crate) fn update_camera(&self, camera: &mut Camera2D) {
        camera.x = WORLD_WIDTH * 0.5;
        camera.y = WORLD_HEIGHT * 0.5;
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
        self.marked_for_despawn.clear();
        self.pending_despawn.clear();
        self.game_state = game_state;
        self.update_camera(camera);

        self.spawn_walls(world);
        let paddle = spawn_body(
            world,
            BreakoutBodySpawnRequest {
                transform: Transform2D {
                    x: WORLD_WIDTH * 0.5,
                    y: PADDLE_Y,
                },
                width: PADDLE_WIDTH,
                height: PADDLE_HEIGHT,
                layer: CollisionLayer::Player,
                velocity: Velocity::default(),
                color: [0.2, 0.85, 0.45, 1.0],
                damage: None,
                health: None,
                score_reward: None,
                primary_actor_marker: true,
            },
        );
        world.set_movement_pattern(
            paddle,
            MovementPattern::TopdownInput {
                speed: PADDLE_SPEED,
            },
        );
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
            BreakoutBodySpawnRequest {
                transform: Transform2D {
                    x: WORLD_WIDTH * 0.5,
                    y: PADDLE_Y - 28.0,
                },
                width: BALL_SIZE,
                height: BALL_SIZE,
                layer: CollisionLayer::Bullet,
                velocity: ball_velocity,
                color: [0.96, 0.98, 0.78, 1.0],
                damage: Some(1.0),
                health: None,
                score_reward: None,
                primary_actor_marker: false,
            },
        ));

        self.spawn_bricks(world);
    }

    fn spawn_walls(&mut self, world: &mut World) {
        self.walls.push(spawn_body(
            world,
            BreakoutBodySpawnRequest {
                transform: Transform2D {
                    x: WALL_THICKNESS * 0.5,
                    y: WORLD_HEIGHT * 0.5,
                },
                width: WALL_THICKNESS,
                height: WORLD_HEIGHT,
                layer: CollisionLayer::Wall,
                velocity: Velocity::default(),
                color: [0.18, 0.45, 0.9, 1.0],
                damage: None,
                health: None,
                score_reward: None,
                primary_actor_marker: false,
            },
        ));
        self.walls.push(spawn_body(
            world,
            BreakoutBodySpawnRequest {
                transform: Transform2D {
                    x: WORLD_WIDTH - WALL_THICKNESS * 0.5,
                    y: WORLD_HEIGHT * 0.5,
                },
                width: WALL_THICKNESS,
                height: WORLD_HEIGHT,
                layer: CollisionLayer::Wall,
                velocity: Velocity::default(),
                color: [0.18, 0.45, 0.9, 1.0],
                damage: None,
                health: None,
                score_reward: None,
                primary_actor_marker: false,
            },
        ));
        self.walls.push(spawn_body(
            world,
            BreakoutBodySpawnRequest {
                transform: Transform2D {
                    x: WORLD_WIDTH * 0.5,
                    y: WALL_THICKNESS * 0.5,
                },
                width: WORLD_WIDTH,
                height: WALL_THICKNESS,
                layer: CollisionLayer::Wall,
                velocity: Velocity::default(),
                color: [0.18, 0.45, 0.9, 1.0],
                damage: None,
                health: None,
                score_reward: None,
                primary_actor_marker: false,
            },
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
                    BreakoutBodySpawnRequest {
                        transform: Transform2D {
                            x: start_x + column as f32 * (BRICK_WIDTH + BRICK_GAP),
                            y: BRICK_START_Y + row as f32 * (BRICK_HEIGHT + BRICK_GAP),
                        },
                        width: BRICK_WIDTH,
                        height: BRICK_HEIGHT,
                        layer: CollisionLayer::Enemy,
                        velocity: Velocity::default(),
                        color: brick_color(row),
                        damage: None,
                        health: Some(1.0),
                        score_reward: Some(BRICK_SCORE),
                        primary_actor_marker: false,
                    },
                );
                attach_brick_hit_reactions(world, entity);
                self.bricks.push(entity);
            }
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct BreakoutBodySpawnRequest {
    transform: Transform2D,
    width: f32,
    height: f32,
    layer: CollisionLayer,
    velocity: Velocity,
    color: [f32; 4],
    damage: Option<f32>,
    health: Option<f32>,
    score_reward: Option<u32>,
    primary_actor_marker: bool,
}

fn spawn_body(world: &mut World, request: BreakoutBodySpawnRequest) -> Entity {
    world.spawn_prefab_entity_from_request(PrefabEntitySpawnRequest {
        transform: request.transform,
        velocity: Some(request.velocity),
        texture_id: DEFAULT_TEXTURE_ID,
        template: EntityTemplate::new(request.width, request.height),
        layer: request.layer,
        sprite_rotation_radians: 0.0,
        render_layer: DEFAULT_SPRITE_RENDER_LAYER,
        sprite_tint: PrefabSpriteTint {
            r: request.color[0],
            g: request.color[1],
            b: request.color[2],
            a: request.color[3],
        },
        lifetime_seconds: None,
        projectile_policy: None,
        gameplay_faction: None,
        damage: request.damage,
        health: request.health,
        score_reward: request.score_reward,
        primary_actor_marker: request.primary_actor_marker,
    })
}

fn attach_brick_hit_reactions(world: &mut World, brick: Entity) {
    world.add_collision_reaction(
        brick,
        CollisionReaction::SpawnParticle {
            preset_id: BRICK_HIT_PARTICLE_PRESET_ID,
            target: CollisionTarget::SelfEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Enter,
        },
    );
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
