use crate::camera::Camera2D;
use crate::collision_event::{CollisionEvent, CollisionEventCounts, COLLISION_EVENT_HIT};
use crate::components::gameplay::{CollisionTarget, MovementPattern};
use crate::components::Velocity;
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::gameplay::{
    apply_collision_damage_reaction_for_pair, apply_collision_reaction_sets_for_pair,
    apply_velocity_reflection, collision_side_effect_payload, commit_score_delta,
    first_swept_kinematic_hit, topdown_input_velocity, CollisionDamageReactionDefaults,
    CollisionReactionPair, CollisionSideEffectPayload, SweptKinematicHit, VelocityReflection,
};
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

        let speed = match world.movement_pattern(paddle) {
            Some(MovementPattern::TopdownInput { speed }) => speed,
            _ => PADDLE_SPEED,
        };
        let velocity = Velocity {
            vy: 0.0,
            ..topdown_input_velocity(input, speed)
        };
        world.velocities[index] = Some(velocity);
        let Some(transform) = world.transforms[index].as_mut() else {
            return;
        };
        let Some(collider) = world.colliders[index] else {
            return;
        };
        if !collider.enabled {
            return;
        }
        transform.x = (transform.x + velocity.vx * delta).clamp(
            WALL_THICKNESS + collider.half_width,
            WORLD_WIDTH - WALL_THICKNESS - collider.half_width,
        );
    }

    fn first_ball_hit(&self, world: &World, ball: Entity, delta: f32) -> Option<BreakoutHit> {
        let mut best = self.paddle.and_then(|paddle| {
            first_breakout_hit(world, ball, [paddle], BreakoutHitKind::Paddle, delta)
        });
        best = earlier_breakout_hit(
            best,
            first_breakout_hit(
                world,
                ball,
                self.walls.iter().copied(),
                BreakoutHitKind::Wall,
                delta,
            ),
        );
        earlier_breakout_hit(
            best,
            first_breakout_hit(
                world,
                ball,
                self.bricks.iter().copied(),
                BreakoutHitKind::Brick,
                delta,
            ),
        )
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
                self.apply_brick_side_effect_reactions(world, ball, hit.entity, hit_particles);
                self.apply_brick_damage_reaction(world, ball, hit.entity);
            }
            BreakoutHitKind::Wall => {
                self.bounce_from_surface(world, ball, hit.normal_x, hit.normal_y)
            }
        }
    }

    fn apply_brick_side_effect_reactions(
        &mut self,
        world: &mut World,
        ball: Entity,
        brick: Entity,
        hit_particles: Option<&mut BreakoutParticleBurstSink<'_>>,
    ) {
        let pair = CollisionReactionPair::new(ball.id as usize, brick.id as usize, ball, brick);
        self.marked_for_despawn.clear();
        self.marked_for_despawn
            .resize(world.entity_capacity(), false);
        self.pending_despawn.clear();
        self.area_damage_hits.clear();
        let Some(outcome) = apply_collision_reaction_sets_for_pair(
            world,
            pair,
            true,
            &mut self.area_damage_hits,
            &mut self.marked_for_despawn,
            &mut self.pending_despawn,
            breakout_collision_damage_defaults,
        ) else {
            return;
        };
        let Some(sink) = hit_particles else {
            return;
        };
        for applied in outcome.outcomes() {
            for effect in applied.outcome.side_effects() {
                if let Some(CollisionSideEffectPayload::SpawnParticleAt { position, .. }) =
                    collision_side_effect_payload(world, effect)
                {
                    sink.spawn_brick_hit(position);
                }
            }
        }
    }

    fn apply_brick_damage_reaction(&mut self, world: &mut World, ball: Entity, brick: Entity) {
        let ball_index = ball.id as usize;
        let brick_index = brick.id as usize;
        let pair = CollisionReactionPair::new(ball_index, brick_index, ball, brick);
        self.marked_for_despawn.clear();
        self.marked_for_despawn
            .resize(world.entity_capacity(), false);
        self.pending_despawn.clear();
        let outcome = apply_collision_damage_reaction_for_pair(
            world,
            pair,
            CollisionTarget::OtherEntity,
            CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: BRICK_SCORE,
                despawn_on_kill: true,
            },
            &mut self.marked_for_despawn,
            &mut self.pending_despawn,
        );
        if let Some(outcome) = outcome {
            commit_score_delta(&mut self.score, outcome.score_reward);
        }
        for entity in self.pending_despawn.drain(..) {
            world.despawn(entity);
        }
    }

    fn bounce_from_paddle(&self, world: &mut World, ball: Entity, paddle: Entity) {
        apply_velocity_reflection(
            world,
            ball,
            VelocityReflection::ContactOffsetX {
                surface: paddle,
                speed: BALL_SPEED,
            },
        );
    }

    fn bounce_from_surface(&self, world: &mut World, ball: Entity, normal_x: f32, normal_y: f32) {
        apply_velocity_reflection(
            world,
            ball,
            VelocityReflection::SurfaceNormal { normal_x, normal_y },
        );
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

fn breakout_collision_damage_defaults(
    _world: &World,
    _entity_index: usize,
) -> CollisionDamageReactionDefaults {
    CollisionDamageReactionDefaults {
        health: 1.0,
        score_reward: BRICK_SCORE,
        despawn_on_kill: true,
    }
}

fn first_breakout_hit<I>(
    world: &World,
    ball: Entity,
    targets: I,
    kind: BreakoutHitKind,
    delta: f32,
) -> Option<BreakoutHit>
where
    I: IntoIterator<Item = Entity>,
{
    first_swept_kinematic_hit(world, ball, targets, delta).map(|hit| breakout_hit(kind, hit))
}

fn breakout_hit(kind: BreakoutHitKind, hit: SweptKinematicHit) -> BreakoutHit {
    BreakoutHit {
        entity: hit.entity,
        kind,
        time: hit.time,
        normal_x: hit.normal_x,
        normal_y: hit.normal_y,
    }
}

fn earlier_breakout_hit(
    current: Option<BreakoutHit>,
    candidate: Option<BreakoutHit>,
) -> Option<BreakoutHit> {
    match (current, candidate) {
        (None, next) => next,
        (Some(hit), None) => Some(hit),
        (Some(hit), Some(next)) if hit.time <= next.time => Some(hit),
        (Some(_), Some(next)) => Some(next),
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
    world.is_current_entity(entity)
}
