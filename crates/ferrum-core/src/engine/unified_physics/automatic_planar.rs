//! Component kinematic velocity is an intent, swept once per native fixed tick.
use super::*;
use crate::physics::PhysicsCounters;
use crate::spatial_scene::SpatialScene;
use crate::tilemap::Tilemap;
use crate::world::World;

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub(super) struct AutomaticPlanarMotion {
    #[serde(deserialize_with = "super::file_ordered::map")]
    pub(super) settings: BTreeMap<(u32, u32), super::controller_settings::ControllerSettings>,
    // Reused scratch is empty at every public checkpoint boundary.
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) saved: Vec<SavedMotion>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct SavedMotion {
    body: BodyId,
    entity: Entity,
    #[serde(with = "crate::checkpoint_codec::array")]
    velocity: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    position: [f32; 3],
    span: Option<HeightSpan>,
}

#[cfg(test)]
impl AutomaticPlanarMotion {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(
        &mut self,
        actor: Entity,
        body: BodyId,
    ) {
        self.saved.push(SavedMotion {
            body,
            entity: actor,
            velocity: [0.; 3],
            position: [0.; 3],
            span: None,
        });
    }
}

impl UnifiedPhysicsRuntime {
    pub(super) fn begin_automatic_planar_motion(
        &mut self,
        world: &mut World,
        tiles: &Tilemap,
        scene: &SpatialScene,
        counters: &mut PhysicsCounters,
        shooter: bool,
    ) -> Result<(), UnifiedPhysicsError> {
        self.automatic_planar.saved.clear();
        if self.physics.config().space != Space::PlanarXy {
            return Ok(());
        }
        let dt = self.physics.config().step_seconds;
        for position in 0..world.alive_indices().len() {
            let index = world.alive_indices()[position];
            let Some(entity) = world.entity_at_index(index) else {
                continue;
            };
            if self.breakout.as_ref().is_some_and(|b| b.owns(entity))
                || self.platformer.as_ref().is_some_and(|p| p.owns(entity))
            {
                // The Breakout driver plans paddle clamp and first-hit ball motion.
                continue;
            }
            let Some(binding) = self.bindings.get(&(entity.id, entity.generation)) else {
                continue;
            };
            let supported = if shooter
                && matches!(
                    world.collider_layer_at(index),
                    Some(
                        crate::components::CollisionLayer::Player
                            | crate::components::CollisionLayer::Enemy
                    )
                ) {
                super::controller_settings::shooter_source_supported(world, entity)
            } else if world.rigid_body(entity).is_some() {
                super::controller_settings::component_source_supported(world, entity)
            } else {
                binding
                    .legacy
                    .as_ref()
                    .is_some_and(|b| b.implicit_kinematic)
                    && super::controller_settings::convex_source_supported(world, entity)
            };
            if (shooter
                && world.collider_layer_at(index)
                    == Some(crate::components::CollisionLayer::Bullet))
                || binding.legacy.is_none()
                || !supported
                || scene.attachments.contains(entity)
                || self
                    .projectiles
                    .contains_key(&(entity.id, entity.generation))
                || self.has_queued_native_dash(entity)
            {
                continue;
            }
            let body = binding.body;
            // Unsupported sources keep their native integration contract; this is
            // never a request to run the legacy collision solver.
            self.physics.validate_planar_controller_source(body)?;
            let mut config = self
                .automatic_planar
                .settings
                .get(&(entity.id, entity.generation))
                .map_or_else(super::controller_settings::default_config, |s| s.config());
            if shooter {
                // Shooter actors overlap for contact damage/pickups. Only walls
                // obstruct movement; projectile impact policy runs after physics.
                config = crate::physics::Hd2dKinematicControllerConfig::new(
                    crate::components::CollisionMask::WALL,
                    4,
                );
            }
            let state = self.physics.body_state(body)?;
            let (recovery, candidates) = if shooter {
                self.physics
                    .planar_navigation_recovery_translation(body, config.solid_mask.bits)?
            } else {
                ([0.; 3], 0)
            };
            counters.solid_candidate_checks =
                counters.solid_candidate_checks.saturating_add(candidates);
            if state.linear_velocity == [0.; 3] && recovery == [0.; 3] {
                continue;
            }
            let requested = Velocity {
                vx: state.linear_velocity[0] * dt,
                vy: state.linear_velocity[1] * dt,
            };
            self.automatic_planar.saved.push(SavedMotion {
                body,
                entity,
                velocity: state.linear_velocity,
                position: state.pose.position,
                span: world.height_span(entity),
            });
            if recovery != [0.; 3] {
                let position = std::array::from_fn(|i| state.pose.position[i] + recovery[i]);
                self.physics
                    .commit_planar_navigation_position(body, position)?;
                world.set_transform(
                    entity,
                    Transform2D {
                        x: position[0],
                        y: position[1],
                    },
                );
                counters.kinematic_hits = counters.kinematic_hits.saturating_add(1);
            }
            self.move_hd2d_kinematic(world, tiles, entity, requested, config, counters)?;
            // The controller already applied this tick's translation. Rapier still
            // advances rotation, dynamics, contacts and every other body exactly once.
            self.physics
                .set_velocity(body, [0.; 3], state.angular_velocity)?;
        }
        Ok(())
    }

    pub(super) fn finish_automatic_planar_motion(
        &mut self,
        world: &mut World,
        succeeded: bool,
    ) -> Result<(), UnifiedPhysicsError> {
        let mut result = Ok(());
        let mut saved = std::mem::take(&mut self.automatic_planar.saved);
        for motion in &saved {
            let restore = (|| {
                if !succeeded {
                    self.physics
                        .commit_planar_navigation_position(motion.body, motion.position)?;
                    self.physics.set_planar_collision_span(
                        motion.body,
                        motion
                            .span
                            .map(|span| crate::physics3d::PlanarCollisionSpan {
                                floor: span.floor.0,
                                elevation: span.elevation,
                                height: span.height,
                            }),
                    )?;
                    if let Some(span) = motion.span {
                        world.set_height_span(motion.entity, span);
                    } else {
                        world.clear_height_span(motion.entity);
                    }
                }
                let state = self.physics.body_state(motion.body)?;
                self.physics
                    .set_velocity(motion.body, motion.velocity, state.angular_velocity)?;
                self.write_entity(world, motion.entity)
            })();
            if let Err(error) = restore {
                result = Err(error);
            }
        }
        saved.clear();
        self.automatic_planar.saved = saved;
        result
    }
}

mod file_payload_admission;
