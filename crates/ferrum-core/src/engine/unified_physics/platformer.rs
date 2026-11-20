//! Native Platformer owns player/platform translation and queued control input.
use super::platformer_controller::PlatformerGeometry;
mod file_admission;

use super::*;
use crate::components::RigidBodyType;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::physics::{
    PhysicsCounters, PlatformerControllerInput, PlatformerControllerResult,
    PlatformerControllerState, RigidBodyStepConfig,
};
use crate::platformer_scene::{
    platformer_landing_dust_particle_preset, PlatformerNativePlan, PlatformerParticleBurstSink,
    PlatformerScene,
};
use crate::world::World;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct PlatformerBodies {
    player: Option<Entity>,
    platform: Option<Entity>,
    horizontal_axis: f32,
    jump_queued: bool,
}
impl PlatformerBodies {
    pub(super) fn from_scene(scene: &PlatformerScene) -> Self {
        Self {
            player: scene.player_entity(),
            platform: scene.moving_platform_entity(),
            horizontal_axis: 0.,
            jump_queued: false,
        }
    }
    pub(super) fn refresh(&mut self, scene: &PlatformerScene) {
        if self.player != scene.player_entity() || self.platform != scene.moving_platform_entity() {
            *self = Self::from_scene(scene);
        }
    }
    pub(super) fn owns(&self, entity: Entity) -> bool {
        self.player == Some(entity) || self.platform == Some(entity)
    }
    pub(super) fn is_player(&self, entity: Entity) -> bool {
        self.player == Some(entity)
    }
    pub(super) fn validate_components(&self, world: &World) -> Result<(), UnifiedPhysicsError> {
        for e in [self.player, self.platform].into_iter().flatten() {
            if world
                .rigid_body(e)
                .is_some_and(|b| !b.enabled || b.body_type != RigidBodyType::Kinematic)
            {
                return Err(PhysicsError::WrongBodyKind.into());
            }
        }
        Ok(())
    }
    fn input(&self) -> PlatformerControllerInput {
        PlatformerControllerInput::new(self.horizontal_axis, self.jump_queued)
    }
}

struct SavedMover {
    entity: Entity,
    body: BodyId,
    start: BodyState,
    angle: f64,
    command: Option<Velocity>,
}
struct Motion {
    player: Option<SavedMover>,
    platform: Option<SavedMover>,
    plan: PlatformerNativePlan,
    state: PlatformerControllerState,
    result: Option<PlatformerControllerResult>,
}

impl Engine {
    pub(in crate::engine) fn update_native_platformer(&mut self, dt: f32, input: InputState) {
        let command = self.scenes.platformer_mut().prepare_native_tick(
            &mut self.world,
            &mut self.camera,
            input,
            dt,
        );
        self.refresh_native_built_in_owners();
        if let Some(command) = command {
            if let Some(profile) = self
                .unified_physics
                .as_mut()
                .and_then(|r| r.platformer.as_mut())
            {
                profile.horizontal_axis = command.horizontal_axis;
                profile.jump_queued |= command.jump_pressed;
            }
            if self.auto_rigid_body_step_enabled {
                self.step_native_platformer(dt, self.auto_rigid_body_step_config);
            } else {
                self.sync_native_built_in();
            }
        } else {
            self.sync_native_built_in();
        }
    }

    pub(in crate::engine) fn step_native_platformer(
        &mut self,
        dt: f32,
        config: RigidBodyStepConfig,
    ) -> bool {
        self.with_unified_interval(dt, |engine| {
            engine.step_native_platformer_interval(dt, config)
        })
        .unwrap_or(false)
    }

    fn step_native_platformer_interval(&mut self, dt: f32, config: RigidBodyStepConfig) -> bool {
        let config = config.sanitized();
        self.refresh_native_built_in_owners();
        let admitted = (|| {
            let r = self
                .unified_physics
                .as_ref()
                .ok_or(UnifiedPhysicsError::NotConfigured)?;
            if !dt.is_finite() || (dt - r.physics.config().step_seconds).abs() > 1e-7 {
                return Err(UnifiedPhysicsError::ClockMismatch);
            }
            r.physics.validate_runtime_settings(
                super::execution::gravity(&r.physics, config),
                super::execution::solver_settings(config),
            )?;
            r.platformer
                .as_ref()
                .ok_or(UnifiedPhysicsError::WrongScene)?
                .validate_components(&self.world)
        })();
        if let Err(error) = admitted {
            if let Some(r) = &mut self.unified_physics {
                r.last_error = Some(error);
            }
            return false;
        }
        if self.scenes.platformer().game_state() != GameState::Playing {
            self.sync_native_built_in();
            return true;
        }
        let prepared = (|| {
            let r = self
                .unified_physics
                .as_mut()
                .ok_or(UnifiedPhysicsError::NotConfigured)?;
            let input = r
                .platformer
                .as_ref()
                .ok_or(UnifiedPhysicsError::WrongScene)?
                .input();
            let plan = self
                .scenes
                .platformer()
                .plan_native_step(&self.world, dt, input);
            r.prepare_query(&mut self.world, config, &self.tilemap, &self.spatial_scene)?;
            let mut m = Motion {
                player: plan
                    .player
                    .map(|e| r.platformer_mover(&self.world, e))
                    .transpose()?,
                platform: plan
                    .platform
                    .map(|p| r.platformer_mover(&self.world, p.entity))
                    .transpose()?,
                plan,
                state: plan.state,
                result: None,
            };
            if let Err(error) =
                r.plan_platformer_motion(&mut self.world, &mut self.physics_counters, &mut m, dt)
            {
                r.restore_platformer_motion(&mut self.world, &m, true)?;
                return Err(error);
            }
            Ok(m)
        })();
        let m = match prepared {
            Ok(m) => m,
            Err(error) => {
                if let Some(r) = &mut self.unified_physics {
                    r.last_error = Some(error);
                }
                return false;
            }
        };
        let succeeded = self.step_unified_with_config(dt, config, false) == Some(true);
        if let Some(r) = &mut self.unified_physics {
            if let Err(error) = r.restore_platformer_motion(&mut self.world, &m, !succeeded) {
                r.last_error = Some(error);
                return false;
            }
        }
        if !succeeded {
            return false;
        }
        let mut dust = PlatformerParticleBurstSink::new(
            &mut self.particles,
            platformer_landing_dust_particle_preset(),
        );
        self.scenes.platformer_mut().finish_native_tick(
            &mut self.world,
            &mut self.camera,
            m.plan,
            m.state,
            m.result,
            Some(&mut dust),
        );
        if let Some(profile) = self
            .unified_physics
            .as_mut()
            .and_then(|r| r.platformer.as_mut())
        {
            profile.jump_queued = false;
        }
        self.sync_native_built_in();
        true
    }
}

impl UnifiedPhysicsRuntime {
    fn platformer_mover(
        &self,
        world: &World,
        entity: Entity,
    ) -> Result<SavedMover, UnifiedPhysicsError> {
        let body = self
            .bindings
            .get(&(entity.id, entity.generation))
            .ok_or(UnifiedPhysicsError::StaleEntity)?
            .body;
        if self.physics.body_kind(body)? != crate::physics3d::BodyKind::KinematicVelocity {
            return Err(PhysicsError::WrongBodyKind.into());
        }
        Ok(SavedMover {
            entity,
            body,
            start: self.physics.body_state(body)?,
            angle: self.physics.planar_rotation(body)?,
            command: world.velocity(entity),
        })
    }
    fn plan_platformer_motion(
        &mut self,
        world: &mut World,
        counters: &mut PhysicsCounters,
        m: &mut Motion,
        dt: f32,
    ) -> Result<(), UnifiedPhysicsError> {
        let mut start = m.player.as_ref().map(|p| Transform2D {
            x: p.start.pose.position[0],
            y: p.start.pose.position[1],
        });
        let active = m.player.as_ref().is_some_and(|p| {
            (0..world.compound_collider_count(p.entity)).any(|i| {
                world
                    .compound_collider_ref_at(p.entity.id as usize, i)
                    .is_some_and(|c| c.enabled())
            })
        });
        if let (Some(player), Some(platform), Some(path), Some(at)) =
            (&m.player, &m.platform, m.plan.platform, start)
        {
            let mut g = PlatformerGeometry {
                runtime: self,
                body: player.body,
                origin: at,
                active,
                counters,
            };
            if g.probe(at, 2., m.plan.config)?.and_then(|h| h.entity) == Some(platform.entity) {
                start = Some(
                    g.slide(
                        at,
                        Velocity {
                            vx: path.end.x - path.start.x,
                            vy: path.end.y - path.start.y,
                        },
                        m.plan.config,
                        Some(platform.body),
                    )?
                    .end,
                );
            }
        }
        if let (Some(platform), Some(path)) = (&m.platform, m.plan.platform) {
            self.physics
                .commit_planar_navigation_position(platform.body, [path.end.x, path.end.y, 0.])?;
            self.write_entity(world, platform.entity)?;
            world.set_velocity(platform.entity, Velocity::default());
        }
        if let (Some(player), Some(start)) = (&m.player, start) {
            let origin = Transform2D {
                x: player.start.pose.position[0],
                y: player.start.pose.position[1],
            };
            let mut g = PlatformerGeometry {
                runtime: self,
                body: player.body,
                origin,
                active,
                counters,
            };
            let result = g.controller(
                start,
                player.command.unwrap_or_default(),
                m.plan.input,
                m.plan.config,
                dt,
                &mut m.state,
            )?;
            g.runtime.physics.commit_planar_navigation_position(
                player.body,
                [result.movement.end.x, result.movement.end.y, 0.],
            )?;
            g.runtime.write_entity(world, player.entity)?;
            world.set_velocity(player.entity, Velocity::default());
            m.result = Some(result);
        }
        Ok(())
    }
    fn restore_platformer_motion(
        &mut self,
        world: &mut World,
        m: &Motion,
        rollback: bool,
    ) -> Result<(), UnifiedPhysicsError> {
        for mover in [&m.platform, &m.player].into_iter().flatten() {
            if rollback {
                self.physics.set_pose(mover.body, mover.start.pose)?;
                self.physics.set_planar_rotation(mover.body, mover.angle)?;
                self.write_entity(world, mover.entity)?;
            }
            let command =
                if !rollback && m.player.as_ref().is_some_and(|p| p.entity == mover.entity) {
                    m.result.map(|r| r.velocity).or(mover.command)
                } else {
                    mover.command
                };
            let v = command.unwrap_or_default();
            let angular = if rollback {
                mover.start.angular_velocity
            } else {
                self.physics.body_state(mover.body)?.angular_velocity
            };
            self.physics
                .set_velocity(mover.body, [v.vx, v.vy, 0.], angular)?;
            world.velocities[mover.entity.id as usize] = command;
        }
        Ok(())
    }
}

#[cfg(test)]
impl PlatformerBodies {
    pub(super) fn builtin_leaf_input_fixture(&self) -> (f32, bool) {
        (self.horizontal_axis, self.jump_queued)
    }
    pub(super) fn corrupt_builtin_leaf_fixture(&mut self, case: usize) {
        match case {
            2 => self.horizontal_axis = f32::NAN,
            3 => self.horizontal_axis = 300.,
            4 => {
                self.player = Some(Entity {
                    id: u32::MAX,
                    generation: 0,
                })
            }
            5 => self.player = self.platform,
            _ => unreachable!(),
        }
    }
}
