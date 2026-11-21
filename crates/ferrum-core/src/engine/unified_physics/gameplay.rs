//! Gameplay geometry uses simulation coordinates, never projected visual anchors.
use super::*;
use crate::collision::CircleQueryHit;
use crate::components::gameplay::CollisionTarget;
use crate::components::CollisionLayer;
use crate::gameplay::{
    apply_collision_area_damage_hits, CollisionDamageReactionDefaults,
    CollisionKnockbackReactionOutcome, CollisionReactionPair, CollisionReactionPhysics,
    CollisionReactionSetOutcome,
};
use crate::physics3d::{BodyKind, Shape};
use crate::world::World;

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn gameplay_position(
        &self,
        world: &World,
        entity: Entity,
    ) -> Option<[f32; 3]> {
        if !world.is_current_entity(entity) {
            return None;
        }
        if let Some(binding) = self.bindings.get(&(entity.id, entity.generation)) {
            return self
                .physics
                .body_state(binding.body)
                .ok()
                .map(|b| b.pose.position);
        }
        // Nonphysical interaction markers retain their authored world position.
        let p = world.transform(entity)?;
        Some(match self.physics.config().space {
            Space::PlanarXy => [p.x, p.y, 0.0],
            Space::Spatial => [
                p.x,
                world.height_span(entity).map_or(0.0, |s| s.elevation),
                -p.y,
            ],
        })
    }

    pub(in crate::engine) fn interaction_distance_squared(
        &self,
        world: &World,
        actor: Entity,
        target: Entity,
    ) -> Option<f32> {
        if self.physics.config().space == Space::PlanarXy
            && !world.height_spans_allow_at(actor.id as usize, target.id as usize)
        {
            return None;
        }
        let a = self.gameplay_position(world, actor)?;
        let b = self.gameplay_position(world, target)?;
        Some(a.into_iter().zip(b).map(|(a, b)| (a - b).powi(2)).sum())
    }

    fn area_targets(
        &mut self,
        world: &World,
        pair: CollisionReactionPair,
        radius: f32,
        layer: CollisionLayer,
        out: &mut Vec<CircleQueryHit>,
    ) -> Result<(), UnifiedPhysicsError> {
        let center = self
            .gameplay_position(world, pair.source)
            .or_else(|| self.gameplay_position(world, pair.other))
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        let span = if self.physics.config().space == Space::PlanarXy {
            world
                .height_span(pair.source)
                .or_else(|| world.height_span(pair.other))
        } else {
            None
        };
        self.physics.overlap(
            &Shape::Sphere { radius },
            Pose {
                position: center,
                ..Pose::default()
            },
            &queries::legacy_filter(layer.mask().bits, span),
            &mut self.native_point_hits,
            self.physics.config().max_colliders,
        )?;
        for hit in &self.native_point_hits {
            if let Some(&entity) = self.entities_by_body.get(&hit.body) {
                if world.is_current_entity(entity) {
                    out.push(CircleQueryHit { entity });
                }
            }
        }
        out.sort_unstable_by_key(|hit| (hit.entity.id, hit.entity.generation));
        out.dedup_by_key(|hit| hit.entity);
        Ok(())
    }
}

impl CollisionReactionPhysics for UnifiedPhysicsRuntime {
    fn area_damage<F: FnMut(&World, usize) -> CollisionDamageReactionDefaults>(
        &mut self,
        world: &mut World,
        pair: CollisionReactionPair,
        radius: f32,
        layer: CollisionLayer,
        hits: &mut Vec<CircleQueryHit>,
        marked: &mut [bool],
        pending: &mut Vec<Entity>,
        defaults: F,
    ) -> CollisionReactionSetOutcome {
        hits.clear();
        if let Err(error) = self.area_targets(world, pair, radius, layer, hits) {
            self.last_error.record(error);
            return CollisionReactionSetOutcome::default();
        }
        apply_collision_area_damage_hits(world, pair.source_index, hits, marked, pending, defaults)
    }

    fn knockback(
        &mut self,
        world: &mut World,
        pair: CollisionReactionPair,
        target: CollisionTarget,
        speed: f32,
        marked: &[bool],
    ) -> Option<CollisionKnockbackReactionOutcome> {
        let entity = pair.target_entity(target);
        let index = entity.id as usize;
        if !speed.is_finite() || speed <= 0.0 || marked.get(index).copied().unwrap_or(false) {
            return None;
        }
        let origin = match target {
            CollisionTarget::SelfEntity => pair.other,
            CollisionTarget::OtherEntity => pair.source,
        };
        let p = self.gameplay_position(world, entity)?;
        let q = self.gameplay_position(world, origin)?;
        let mut direction: [f32; 3] = std::array::from_fn(|i| p[i] - q[i]);
        let length = direction.iter().map(|v| v * v).sum::<f32>().sqrt();
        if length > f32::EPSILON {
            direction.iter_mut().for_each(|v| *v /= length);
        } else {
            direction = [
                if target == CollisionTarget::SelfEntity {
                    -1.0
                } else {
                    1.0
                },
                0.0,
                0.0,
            ];
        }
        let body = self.bindings.get(&(entity.id, entity.generation))?.body;
        let delta: [f32; 3] = direction.map(|v| v * speed);
        let result = (|| {
            // The authored "impulse" has always meant a velocity increment, not N*s.
            // Fixed/position-controlled bodies cannot accept this direct motion.
            if !matches!(
                self.physics.body_kind(body)?,
                BodyKind::Dynamic | BodyKind::KinematicVelocity
            ) {
                return Err(PhysicsError::WrongBodyKind.into());
            }
            let state = self.physics.body_state(body)?;
            self.physics.set_velocity(
                body,
                std::array::from_fn(|i| state.linear_velocity[i] + delta[i]),
                state.angular_velocity,
            )?;
            self.write_entity(world, entity)
        })();
        if let Err(error) = result {
            self.last_error.record(error);
            return None;
        }
        Some(CollisionKnockbackReactionOutcome {
            target_index: index,
            target: entity,
            impulse: match self.physics.config().space {
                Space::PlanarXy => Velocity {
                    vx: delta[0],
                    vy: delta[1],
                },
                Space::Spatial => Velocity {
                    vx: delta[0],
                    vy: -delta[2],
                },
            },
        })
    }
}
