use crate::camera::Camera2D;
use crate::collision::CollisionSystem;
use crate::collision_event::{CollisionEvent, CollisionEventCounts, COLLISION_EVENT_HIT};
use crate::components::{AabbCollider, Transform2D, Velocity};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::world::World;

use super::config::{
    BALL_SIZE, BALL_SPEED, BRICK_SCORE, PADDLE_SPEED, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH,
};
use super::effects::BreakoutParticleBurstSink;
use super::BreakoutScene;

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

impl BreakoutScene {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
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

    fn update_playing(
        &mut self,
        world: &mut World,
        input: InputState,
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

    fn update_paddle(&self, world: &mut World, input: InputState, delta: f32) {
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

    pub(super) fn remaining_bricks(&self, world: &World) -> usize {
        self.bricks
            .iter()
            .copied()
            .filter(|brick| is_alive(world, *brick))
            .count()
    }
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

fn action_pressed(input: InputState) -> bool {
    input.enter == 1 || input.space == 1
}

pub(super) fn is_alive(world: &World, entity: Entity) -> bool {
    let index = entity.id as usize;
    index < world.alive.len() && world.alive[index] && world.generations[index] == entity.generation
}
