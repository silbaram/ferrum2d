//! Breakout's clamped paddle and one-hit ball share the native fixed tick.
mod file_admission;

use super::*;
use crate::breakout_scene::{
    breakout_brick_hit_particle_preset, BreakoutHit, BreakoutHitKind, BreakoutPaddlePlan,
    BreakoutParticleBurstSink, BreakoutScene,
};
use crate::components::RigidBodyType;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::physics::RigidBodyStepConfig;
use crate::physics3d::BodyKind;
use crate::world::World;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct BreakoutBodies {
    paddle: Option<Entity>,
    ball: Option<Entity>,
}
impl BreakoutBodies {
    pub(super) fn from_scene(scene: &BreakoutScene) -> Self {
        Self {
            paddle: scene.paddle_entity(),
            ball: scene.ball_entity(),
        }
    }
    pub(super) fn owns(&self, entity: Entity) -> bool {
        self.paddle == Some(entity) || self.ball == Some(entity)
    }
    pub(super) fn validate_components(&self, world: &World) -> Result<(), UnifiedPhysicsError> {
        for entity in [self.paddle, self.ball].into_iter().flatten() {
            if world
                .rigid_body(entity)
                .is_some_and(|b| !b.enabled || b.body_type != RigidBodyType::Kinematic)
            {
                return Err(PhysicsError::WrongBodyKind.into());
            }
        }
        Ok(())
    }
}

struct Mover {
    entity: Entity,
    body: BodyId,
    start: BodyState,
    angle: f64,
    command: Option<Velocity>,
}
struct Motion {
    paddle: Option<Mover>,
    ball: Option<Mover>,
    hit: Option<BreakoutHit>,
}

impl Engine {
    pub(in crate::engine) fn update_native_breakout(&mut self, delta: f32, input: InputState) {
        let playing = self.scenes.breakout_mut().prepare_native_tick(
            &mut self.world,
            &mut self.camera,
            input,
            delta,
        );
        if !playing {
            self.sync_native_built_in();
            return;
        }
        if let Some(plan) = self
            .scenes
            .breakout()
            .plan_paddle(&self.world, input, delta)
        {
            self.world.set_velocity(plan.entity, plan.velocity);
        }
        if self.auto_rigid_body_step_enabled {
            self.step_native_breakout(delta, self.auto_rigid_body_step_config);
        } else {
            // Manual callers choose the physical ticks, including first-hit response.
            self.sync_native_built_in();
        }
    }

    pub(in crate::engine) fn step_native_breakout(
        &mut self,
        dt: f32,
        config: RigidBodyStepConfig,
    ) -> bool {
        self.with_unified_interval(dt, |engine| {
            engine.step_native_breakout_interval(dt, config)
        })
        .unwrap_or(false)
    }

    fn step_native_breakout_interval(&mut self, dt: f32, config: RigidBodyStepConfig) -> bool {
        let config = config.sanitized();
        let admitted = (|| {
            let runtime = self
                .unified_physics
                .as_ref()
                .ok_or(UnifiedPhysicsError::NotConfigured)?;
            if !dt.is_finite() || (dt - runtime.physics.config().step_seconds).abs() > 1e-7 {
                return Err(UnifiedPhysicsError::ClockMismatch);
            }
            runtime.physics.validate_runtime_settings(
                super::execution::gravity(&runtime.physics, config),
                super::execution::solver_settings(config),
            )?;
            BreakoutBodies::from_scene(self.scenes.breakout()).validate_components(&self.world)
        })();
        if let Err(error) = admitted {
            if let Some(runtime) = &mut self.unified_physics {
                runtime.last_error = Some(error);
            }
            return false;
        }
        if self.scenes.breakout().game_state() != GameState::Playing {
            self.sync_native_built_in();
            return true;
        }
        let plan = self
            .scenes
            .breakout()
            .plan_paddle_from_velocity(&self.world, dt);
        let ball = self
            .scenes
            .breakout()
            .ball_entity()
            .filter(|e| self.world.is_current_entity(*e));
        let prepared = (|| {
            let runtime = self
                .unified_physics
                .as_mut()
                .ok_or(UnifiedPhysicsError::NotConfigured)?;
            runtime.breakout = Some(BreakoutBodies::from_scene(self.scenes.breakout()));
            runtime.prepare_query(&mut self.world, config, &self.tilemap, &self.spatial_scene)?;
            let mut motion = Motion {
                paddle: plan
                    .as_ref()
                    .map(|p| runtime.breakout_mover(&self.world, p.entity))
                    .transpose()?,
                ball: ball
                    .map(|e| runtime.breakout_mover(&self.world, e))
                    .transpose()?,
                hit: None,
            };
            let result = (|| {
                if let (Some(plan), Some(paddle)) = (&plan, &motion.paddle) {
                    runtime.move_breakout_paddle(&mut self.world, paddle, plan)?;
                }
                if let Some(ball) = &motion.ball {
                    let v = ball.command.unwrap_or_default();
                    let translation = [v.vx * dt, v.vy * dt, 0.];
                    // Collision-disabled or collider-free balls still integrate natively.
                    let active_source =
                        (0..self.world.compound_collider_count(ball.entity)).any(|i| {
                            self.world
                                .compound_collider_ref_at(ball.entity.id as usize, i)
                                .is_some_and(|c| c.enabled())
                        });
                    if active_source {
                        for (entity, kind) in self.scenes.breakout().native_targets() {
                            if !self.world.is_current_entity(entity) {
                                continue;
                            }
                            let Some(binding) =
                                runtime.bindings.get(&(entity.id, entity.generation))
                            else {
                                continue;
                            };
                            let Some(hit) = runtime.physics.sweep_planar_body_against(
                                ball.body,
                                binding.body,
                                translation,
                            )?
                            else {
                                continue;
                            };
                            if motion.hit.is_none_or(|old| hit.fraction < old.time) {
                                motion.hit = Some(scene_hit(entity, kind, hit));
                            }
                        }
                    }
                    let fraction = motion.hit.map_or(1., |h| h.time);
                    self.world.set_velocity(
                        ball.entity,
                        Velocity {
                            vx: v.vx * fraction,
                            vy: v.vy * fraction,
                        },
                    );
                }
                Ok::<_, UnifiedPhysicsError>(())
            })();
            if let Err(error) = result {
                runtime.restore_breakout_motion(&mut self.world, &motion, true)?;
                return Err(error);
            }
            Ok(motion)
        })();
        let motion = match prepared {
            Ok(motion) => motion,
            Err(error) => {
                if let Some(runtime) = &mut self.unified_physics {
                    runtime.last_error = Some(error);
                }
                return false;
            }
        };
        let succeeded = self.step_unified_with_config(dt, config, false) == Some(true);
        if let Some(runtime) = &mut self.unified_physics {
            if let Err(error) =
                runtime.restore_breakout_motion(&mut self.world, &motion, !succeeded)
            {
                runtime.last_error = Some(error);
                return false;
            }
        }
        if !succeeded {
            return false;
        }
        let mut particles = BreakoutParticleBurstSink::new(
            &mut self.particles,
            breakout_brick_hit_particle_preset(),
        );
        self.scenes.breakout_mut().finish_native_tick(
            &mut self.world,
            &mut self.camera,
            motion.hit,
            &mut self.frame_buffers.collision_events,
            &mut self.collision_event_counts,
            Some(&mut particles),
        );
        self.sync_native_built_in();
        true
    }
}

impl UnifiedPhysicsRuntime {
    fn breakout_mover(&self, world: &World, entity: Entity) -> Result<Mover, UnifiedPhysicsError> {
        let body = self
            .bindings
            .get(&(entity.id, entity.generation))
            .ok_or(UnifiedPhysicsError::StaleEntity)?
            .body;
        if self.physics.body_kind(body)? != BodyKind::KinematicVelocity {
            return Err(PhysicsError::WrongBodyKind.into());
        }
        Ok(Mover {
            entity,
            body,
            start: self.physics.body_state(body)?,
            angle: self.physics.planar_rotation(body)?,
            command: world.velocity(entity),
        })
    }
    fn move_breakout_paddle(
        &mut self,
        world: &mut World,
        paddle: &Mover,
        plan: &BreakoutPaddlePlan,
    ) -> Result<(), UnifiedPhysicsError> {
        self.physics
            .commit_planar_navigation_position(paddle.body, [plan.end.x, plan.end.y, 0.])?;
        self.write_entity(world, paddle.entity)?;
        world.set_velocity(paddle.entity, Velocity::default());
        Ok(())
    }
    fn restore_breakout_motion(
        &mut self,
        world: &mut World,
        motion: &Motion,
        rollback: bool,
    ) -> Result<(), UnifiedPhysicsError> {
        for mover in [&motion.paddle, &motion.ball].into_iter().flatten() {
            if rollback {
                self.physics.set_pose(mover.body, mover.start.pose)?;
                self.physics.set_planar_rotation(mover.body, mover.angle)?;
                self.write_entity(world, mover.entity)?;
            }
            let v = mover.command.unwrap_or_default();
            let angular = if rollback {
                mover.start.angular_velocity
            } else {
                self.physics.body_state(mover.body)?.angular_velocity
            };
            self.physics
                .set_velocity(mover.body, [v.vx, v.vy, 0.], angular)?;
            world.velocities[mover.entity.id as usize] = mover.command;
        }
        Ok(())
    }
}

fn scene_hit(
    entity: Entity,
    kind: BreakoutHitKind,
    hit: crate::physics3d::SweepHit,
) -> BreakoutHit {
    BreakoutHit {
        entity,
        kind,
        time: hit.fraction,
        normal_x: hit.normal[0],
        normal_y: hit.normal[1],
    }
}

#[cfg(test)]
impl BreakoutBodies {
    pub(super) fn corrupt_builtin_leaf_fixture(&mut self, case: usize) {
        match case {
            0 => self.ball = self.paddle,
            1 => {
                self.ball = Some(Entity {
                    id: u32::MAX,
                    generation: 0,
                })
            }
            _ => unreachable!(),
        }
    }
}
