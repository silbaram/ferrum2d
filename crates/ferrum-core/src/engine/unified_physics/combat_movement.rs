//! Direct combat steering reads physical poses and submits intent to the native owner.
use super::*;
use crate::components::gameplay::{MovementPattern, MovementTarget};
use crate::components::CollisionLayer;
use crate::gameplay::{
    evaluate_movement_pattern_with_target, velocity_interpolate, velocity_toward,
    velocity_with_acceleration_and_speed_cap, MovementPatternEvaluation,
};
use crate::physics3d::{BodyKind, PlanarCollisionSpan};
use crate::world::World;

fn projected(space: Space, p: [f32; 3]) -> Transform2D {
    match space {
        Space::PlanarXy => Transform2D { x: p[0], y: p[1] },
        Space::Spatial => Transform2D { x: p[0], y: -p[2] },
    }
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn owns_combat_movement(&self, world: &World, entity: Entity) -> bool {
        self.bindings.contains_key(&(entity.id, entity.generation))
            || (self.physics.config().space == Space::PlanarXy
                && (world.rigid_body(entity).is_some()
                    || world.compound_collider_count(entity) != 0))
    }

    fn movement_span(&self, world: &World, entity: Entity) -> Option<PlanarCollisionSpan> {
        if let Some(binding) = self.bindings.get(&(entity.id, entity.generation)) {
            if binding.legacy.is_none() {
                return self
                    .physics
                    .planar_collision_span(binding.body)
                    .ok()
                    .flatten();
            }
        }
        world.height_span(entity).map(|s| PlanarCollisionSpan {
            floor: s.floor.0,
            elevation: s.elevation,
            height: s.height,
        })
    }

    fn movement_layer_matches(&self, world: &World, entity: Entity, layer: CollisionLayer) -> bool {
        if let Some(binding) = self.bindings.get(&(entity.id, entity.generation)) {
            if binding.legacy.is_none() {
                return self
                    .physics
                    .collider_ids(binding.body)
                    .is_ok_and(|mut ids| {
                        ids.any(|id| {
                            self.physics
                                .enabled_collider_groups(id)
                                .ok()
                                .flatten()
                                .is_some_and(|(category, _)| category & layer.mask().bits != 0)
                        })
                    });
            }
        }
        world.collider_layer_at(entity.id as usize) == Some(layer)
    }

    fn movement_position(&self, world: &World, entity: Entity) -> Option<[f32; 3]> {
        if self
            .bindings
            .get(&(entity.id, entity.generation))
            .is_some_and(|binding| binding.legacy.is_some())
        {
            let t = world.transform(entity)?;
            return Some([t.x, t.y, 0.]);
        }
        self.gameplay_position(world, entity)
    }

    pub(super) fn movement_target_entity(
        &self,
        world: &World,
        source: Entity,
        query: MovementTarget,
    ) -> Option<Entity> {
        let space = self.physics.config().space;
        let from = self.movement_position(world, source)?;
        let span = self.movement_span(world, source);
        let valid = |entity| {
            entity != source
                && world.is_current_entity(entity)
                && (space != Space::PlanarXy
                    || match (span, self.movement_span(world, entity)) {
                        (None, None) => true,
                        (Some(a), Some(b)) => {
                            a.floor == b.floor
                                && a.elevation <= b.elevation + b.height
                                && b.elevation <= a.elevation + a.height
                        }
                        _ => false,
                    })
        };
        let explicit = match query {
            MovementTarget::PrimaryActor | MovementTarget::NearestPrimaryActor => {
                Some(world.primary_actor_entity())
            }
            MovementTarget::Entity(entity) => Some(Some(entity)),
            _ => None,
        };
        if let Some(entity) = explicit {
            return entity.filter(|&e| valid(e));
        }
        let mut best = None;
        let mut best_distance = f64::INFINITY;
        let mut best_key = (u32::MAX, u32::MAX);
        // The combat orchestrator bounds this to 2048 entities / 512 movers.
        // No candidate allocation and ties use generational identity, not dense order.
        for &index in world.alive_indices() {
            let Some(entity) = world.entity_at_index(index).filter(|&e| valid(e)) else {
                continue;
            };
            let matches = match query {
                MovementTarget::NearestEnemy => {
                    self.movement_layer_matches(world, entity, CollisionLayer::Enemy)
                }
                MovementTarget::NearestLayer(layer) => {
                    self.movement_layer_matches(world, entity, layer)
                }
                MovementTarget::NearestFaction(id) => world
                    .gameplay_faction_at_index(index)
                    .is_some_and(|f| f.faction_id == id),
                MovementTarget::NearestTag(id) => world
                    .gameplay_tags_at_index(index)
                    .is_some_and(|t| t.contains(id)),
                _ => false,
            };
            if !matches {
                continue;
            }
            let Some(position) = self.movement_position(world, entity) else {
                continue;
            };
            let distance = from
                .into_iter()
                .zip(position)
                .map(|(a, b)| (f64::from(a) - f64::from(b)).powi(2))
                .sum::<f64>();
            let key = (entity.id, entity.generation);
            if distance < best_distance || (distance == best_distance && key < best_key) {
                best = Some(entity);
                best_distance = distance;
                best_key = key;
            }
        }
        best
    }

    pub(in crate::engine) fn apply_combat_movement(
        &mut self,
        world: &World,
        entity: Entity,
        pattern: MovementPattern,
    ) -> bool {
        let result = self.combat_movement(world, entity, pattern);
        if let Err(error) = result {
            self.last_error = Some(error);
        }
        result.unwrap_or(false)
    }

    fn combat_movement(
        &mut self,
        world: &World,
        entity: Entity,
        pattern: MovementPattern,
    ) -> Result<bool, UnifiedPhysicsError> {
        if self
            .projectiles
            .contains_key(&(entity.id, entity.generation))
        {
            return Ok(false);
        }
        let body = self
            .bindings
            .get(&(entity.id, entity.generation))
            .ok_or(UnifiedPhysicsError::StaleEntity)?
            .body;
        let state = self.physics.body_state(body)?;
        let space = self.physics.config().space;
        let transform = projected(space, state.pose.position);
        let mut current = state.linear_velocity;
        if let Ok(character) = self.physics.character_state(body) {
            let dt = self.physics.config().step_seconds;
            current = std::array::from_fn(|i| {
                (character.translation[i] - character.carry_translation[i]) / dt
            });
            let up = self.physics.character_config(body)?.up;
            let vertical = current.into_iter().zip(up).map(|(a, b)| a * b).sum::<f32>();
            for (v, up) in current.iter_mut().zip(up) {
                *v -= up * vertical;
            }
        }
        let current = projected(space, current);
        let Some(evaluation) = evaluate_movement_pattern_with_target(
            transform,
            Some(Velocity {
                vx: current.x,
                vy: current.y,
            }),
            pattern,
            |target| {
                self.movement_target_entity(world, entity, target)
                    .and_then(|e| self.movement_position(world, e))
                    .map(|p| projected(space, p))
            },
        ) else {
            return Ok(false);
        };
        let velocity = match evaluation {
            MovementPatternEvaluation::Velocity(v) => v,
            MovementPatternEvaluation::Chase {
                target_transform,
                speed,
                ..
            } => velocity_toward(transform, target_transform, speed),
            MovementPatternEvaluation::SeekTarget {
                target_transform,
                current_velocity,
                speed,
                turn_rate,
            } => velocity_interpolate(
                current_velocity,
                velocity_toward(transform, target_transform, speed),
                turn_rate,
            ),
            MovementPatternEvaluation::Accelerate {
                current_velocity,
                acceleration_x,
                acceleration_y,
                max_speed,
            } => velocity_with_acceleration_and_speed_cap(
                current_velocity,
                acceleration_x,
                acceleration_y,
                max_speed,
            ),
        };
        let mut linear = match space {
            Space::PlanarXy => [velocity.vx, velocity.vy, 0.],
            Space::Spatial => [velocity.vx, 0., -velocity.vy],
        };
        if linear.iter().any(|v| !v.is_finite() || v.abs() > 1.0e6) {
            return Err(PhysicsError::InvalidBody.into());
        }
        if let Ok(config) = self.physics.character_config(body) {
            let vertical = linear
                .into_iter()
                .zip(config.up)
                .map(|(a, b)| a * b)
                .sum::<f32>();
            for (v, up) in linear.iter_mut().zip(config.up) {
                *v -= up * vertical;
            }
            self.physics.set_character_ground_velocity(body, linear)?;
        } else {
            match self.physics.body_kind(body)? {
                BodyKind::Dynamic | BodyKind::KinematicVelocity => {
                    if space == Space::Spatial {
                        linear[1] = state.linear_velocity[1];
                    }
                    self.physics
                        .set_velocity(body, linear, state.angular_velocity)?;
                }
                BodyKind::KinematicPosition => {
                    let dt = self.physics.config().step_seconds;
                    let pose = Pose {
                        position: std::array::from_fn(|i| state.pose.position[i] + linear[i] * dt),
                        ..state.pose
                    };
                    self.physics.set_kinematic_target(body, pose)?;
                }
                BodyKind::Fixed if linear == [0.; 3] => {}
                BodyKind::Fixed => return Err(PhysicsError::WrongBodyKind.into()),
            }
        }
        Ok(true)
    }
}

#[cfg(test)]
mod tests;
