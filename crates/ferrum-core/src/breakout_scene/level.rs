use crate::camera::Camera2D;
use crate::components::{
    AabbCollider, CollisionFilter, CollisionLayer, Sprite, SpriteFrame, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::world::World;

use super::config::{
    BALL_SIZE, BALL_SPEED, BRICK_COLUMNS, BRICK_GAP, BRICK_HEIGHT, BRICK_ROWS, BRICK_SCORE,
    BRICK_START_Y, BRICK_WIDTH, DEFAULT_TEXTURE_ID, PADDLE_HEIGHT, PADDLE_WIDTH, PADDLE_Y,
    WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH,
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

fn brick_color(row: u32) -> [f32; 4] {
    match row % 5 {
        0 => [0.95, 0.28, 0.24, 1.0],
        1 => [0.98, 0.62, 0.22, 1.0],
        2 => [0.92, 0.82, 0.26, 1.0],
        3 => [0.23, 0.7, 0.92, 1.0],
        _ => [0.56, 0.45, 0.92, 1.0],
    }
}
