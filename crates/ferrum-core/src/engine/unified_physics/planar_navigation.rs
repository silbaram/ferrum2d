//! Scene-owned routes use the configured native world without a second solver.
use super::*;
use crate::physics::{KinematicMoveResult, PhysicsCounters, RigidBodyStepConfig};
use crate::spatial_scene::SpatialScene;
use crate::tilemap::Tilemap;
use crate::world::World;

pub(in crate::engine) struct PlanarNavigationContext<'a> {
    pub runtime: &'a mut UnifiedPhysicsRuntime,
    pub config: RigidBodyStepConfig,
    pub tiles: &'a Tilemap,
    pub spatial: &'a SpatialScene,
}

impl UnifiedPhysicsRuntime {
    fn explicit_planar_navigation_body(&self, entity: Entity) -> Option<BodyId> {
        (self.physics.config().space == Space::PlanarXy)
            .then(|| self.bindings.get(&(entity.id, entity.generation)))
            .flatten()
            .filter(|binding| binding.legacy.is_none())
            .map(|binding| binding.body)
    }

    pub(in crate::engine) fn planar_navigation_obstacle_supported(
        &self,
        entity: Entity,
    ) -> Option<bool> {
        let body = self.explicit_planar_navigation_body(entity)?;
        Some(
            self.physics
                .collider_ids(body)
                .is_ok_and(|mut ids| ids.next().is_some()),
        )
    }

    pub(in crate::engine) fn planar_navigation_obstacle_bounds(
        &mut self,
        entity: Entity,
    ) -> Option<Result<crate::collision::AabbBounds, PhysicsError>> {
        let body = self.explicit_planar_navigation_body(entity)?;
        Some(self.physics.planar_platformer_bounds(body, [0.; 3]).map(
            |[min_x, min_y, max_x, max_y]| crate::collision::AabbBounds {
                min_x,
                min_y,
                max_x,
                max_y,
            },
        ))
    }

    pub(in crate::engine) fn planar_navigation_position(
        &self,
        world: &World,
        actor: Entity,
    ) -> Option<Transform2D> {
        if let Some(body) = self.explicit_planar_navigation_body(actor) {
            let pose = self.physics.body_state(body).ok()?.pose;
            return Some(Transform2D {
                x: pose.position[0],
                y: pose.position[1],
            });
        }
        world.transform(actor)
    }

    pub(in crate::engine) fn supports_planar_navigation_actor(
        &self,
        world: &World,
        actor: Entity,
    ) -> bool {
        if self.physics.config().space != Space::PlanarXy || !world.is_current_entity(actor) {
            return false;
        }
        match self.bindings.get(&(actor.id, actor.generation)) {
            Some(binding) if binding.legacy.is_none() => {
                // Explicit native bodies have no duplicate World collider/body
                // components. Validate their actual enabled convex source instead.
                self.physics
                    .validate_planar_controller_source(binding.body)
                    .is_ok()
            }
            _ => crate::engine::data_scene_movement::supported_actor(world, actor),
        }
    }
}

impl PlanarNavigationContext<'_> {
    pub(in crate::engine) fn prepare(&mut self, world: &mut World, actor: Entity) -> bool {
        let result = (|| {
            self.runtime.require_planar_query()?;
            self.runtime
                .prepare_query(world, self.config, self.tiles, self.spatial)?;
            let binding = self
                .runtime
                .bindings
                .get(&(actor.id, actor.generation))
                .ok_or(UnifiedPhysicsError::BodyOwnershipConflict)?;
            self.runtime
                .physics
                .validate_planar_controller_source(binding.body)?;
            if binding.legacy.is_none() {
                // The scene route commits each swept segment itself. Cancel the
                // prior native translation intent so Rapier cannot integrate it
                // a second time after the route, preserving angular motion.
                let state = self.runtime.physics.body_state(binding.body)?;
                self.runtime
                    .physics
                    .set_velocity(binding.body, [0.; 3], state.angular_velocity)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            self.runtime.last_error.record(error);
            return false;
        }
        true
    }

    pub(in crate::engine) fn move_body(
        &mut self,
        world: &mut World,
        actor: Entity,
        displacement: Velocity,
        mask: crate::components::CollisionMask,
        counters: &mut PhysicsCounters,
    ) -> Option<KinematicMoveResult> {
        let result = self.try_move(world, actor, displacement, mask, counters);
        match result {
            Ok(moved) => Some(moved),
            Err(error) => {
                self.runtime.last_error.record(error);
                None
            }
        }
    }

    fn try_move(
        &mut self,
        world: &mut World,
        actor: Entity,
        requested: Velocity,
        mask: crate::components::CollisionMask,
        counters: &mut PhysicsCounters,
    ) -> Result<KinematicMoveResult, UnifiedPhysicsError> {
        let binding = self
            .runtime
            .bindings
            .get(&(actor.id, actor.generation))
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        let body = binding.body;
        let start = self
            .runtime
            .planar_navigation_position(world, actor)
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        let (hit, candidates) = self.runtime.physics.sweep_planar_navigation_body(
            body,
            [requested.vx, requested.vy, 0.],
            mask.bits,
        )?;
        let fraction = hit.as_ref().map_or(1., |h| h.fraction);
        let mut pose = self.runtime.physics.body_state(body)?.pose;
        pose.position[0] += requested.vx * fraction;
        pose.position[1] += requested.vy * fraction;
        self.runtime
            .physics
            .commit_planar_navigation_position(body, pose.position)?;
        self.runtime.write_entity(world, actor)?;
        let end = self
            .runtime
            .planar_navigation_position(world, actor)
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        let remaining = Velocity {
            vx: requested.vx - (end.x - start.x),
            vy: requested.vy - (end.y - start.y),
        };
        counters.kinematic_moves = counters.kinematic_moves.saturating_add(1);
        counters.solid_candidate_checks =
            counters.solid_candidate_checks.saturating_add(candidates);
        if let Some(hit) = &hit {
            counters.kinematic_hits = counters.kinematic_hits.saturating_add(1);
            if self
                .runtime
                .terrain
                .by_collider
                .contains_key(&hit.target.collider)
            {
                counters.kinematic_tile_hits = counters.kinematic_tile_hits.saturating_add(1);
            } else {
                counters.kinematic_entity_hits = counters.kinematic_entity_hits.saturating_add(1);
            }
        }
        Ok(KinematicMoveResult {
            start,
            end,
            requested,
            remaining,
            hit_count: u32::from(hit.is_some()),
            blocked_x: hit.as_ref().is_some_and(|h| h.normal[0].abs() > 1e-5),
            blocked_y: hit.as_ref().is_some_and(|h| h.normal[1].abs() > 1e-5),
            last_hit: hit.and_then(|h| self.runtime.entities_by_body.get(&h.target.body).copied()),
        })
    }
}

#[cfg(test)]
mod default_tests;
