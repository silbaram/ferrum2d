//! Manual HD-2D displacement uses native geometry and shared surface metadata.
use super::*;
use crate::physics::{
    Hd2dKinematicControllerConfig, Hd2dKinematicMoveResult, KinematicMoveResult, PhysicsCounters,
    PhysicsSystem,
};
use crate::physics3d::{BodyId, PlanarCollisionSpan};
use crate::world::World;

impl Engine {
    pub(in crate::engine) fn move_unified_hd2d_kinematic(
        &mut self,
        entity: Entity,
        requested: Velocity,
        config: Hd2dKinematicControllerConfig,
    ) -> Option<Result<Hd2dKinematicMoveResult, UnifiedPhysicsError>> {
        let runtime = self.unified_physics.as_mut()?;
        let result = (|| {
            runtime.require_planar_query()?;
            if self.world.collider(entity).is_none()
                || self.world.compound_collider_count(entity) != 1
            {
                return Err(PhysicsError::UnsupportedShape.into());
            }
            runtime.prepare_query(
                &mut self.world,
                self.auto_rigid_body_step_config,
                &self.tilemap,
                &self.spatial_scene,
            )?;
            runtime.move_hd2d_kinematic(
                &mut self.world,
                &self.tilemap,
                entity,
                requested,
                config,
                &mut self.physics_counters,
            )
        })();
        if let Err(error) = result {
            runtime.last_error = Some(error);
        }
        Some(result)
    }
}

fn native_span(span: HeightSpan) -> PlanarCollisionSpan {
    PlanarCollisionSpan {
        floor: span.floor.0,
        elevation: span.elevation,
        height: span.height,
    }
}

impl UnifiedPhysicsRuntime {
    pub(super) fn move_hd2d_kinematic(
        &mut self,
        world: &mut World,
        tiles: &crate::tilemap::Tilemap,
        entity: Entity,
        requested: Velocity,
        config: Hd2dKinematicControllerConfig,
        counters: &mut PhysicsCounters,
    ) -> Result<Hd2dKinematicMoveResult, UnifiedPhysicsError> {
        let body = self
            .bindings
            .get(&(entity.id, entity.generation))
            .filter(|b| b.legacy.is_some())
            .ok_or(UnifiedPhysicsError::BodyOwnershipConflict)?
            .body;
        let movement = self.plan_hd2d_movement(world, body, entity, requested, config, counters)?;
        let start_span = world.height_span(entity);
        let mut pose = self.physics.body_state(body)?.pose;
        pose.position = [movement.end.x, movement.end.y, 0.];
        self.physics.validate_pose(body, pose)?;
        world.set_transform(entity, movement.end);
        let finish = (|| {
            let mut result = PhysicsSystem::finish_hd2d_kinematic_movement(
                world, tiles, entity, movement, config,
            );
            let span = world.height_span(entity).map(native_span);
            self.physics.validate_planar_collision_span(span)?;
            if world.height_span(entity) != start_span {
                let end = world
                    .transform(entity)
                    .ok_or(UnifiedPhysicsError::StaleEntity)?;
                let (clear, candidates) = self.physics.planar_navigation_destination_is_clear(
                    body,
                    [end.x - movement.start.x, end.y - movement.start.y, 0.],
                    span,
                    config.solid_mask.bits,
                )?;
                counters.solid_candidate_checks =
                    counters.solid_candidate_checks.saturating_add(candidates);
                if !clear {
                    result = PhysicsSystem::block_hd2d_kinematic_transition(world, entity, result);
                }
            }
            let end = world
                .transform(entity)
                .ok_or(UnifiedPhysicsError::StaleEntity)?;
            let span = world.height_span(entity).map(native_span);
            self.physics.set_planar_collision_span(body, span)?;
            self.physics
                .commit_planar_navigation_position(body, [end.x, end.y, 0.])?;
            self.write_entity(world, entity)?;
            Ok(result)
        })();
        if finish.is_err() {
            world.set_transform(entity, movement.start);
            if let Some(span) = start_span {
                world.set_height_span(entity, span);
            } else {
                world.clear_height_span(entity);
            }
        }
        finish
    }

    fn plan_hd2d_movement(
        &mut self,
        world: &World,
        body: BodyId,
        entity: Entity,
        requested: Velocity,
        config: Hd2dKinematicControllerConfig,
        counters: &mut PhysicsCounters,
    ) -> Result<KinematicMoveResult, UnifiedPhysicsError> {
        let start = world
            .transform(entity)
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        // Validate even a zero-iteration/zero-distance call without committing pose.
        self.physics
            .sweep_planar_navigation_body(body, [0.; 3], config.solid_mask.bits)?;
        let mut end = start;
        let mut remaining = requested;
        let mut hits = 0u32;
        let mut last_hit = None;
        let mut blocked_x = false;
        let mut blocked_y = false;
        counters.kinematic_moves = counters.kinematic_moves.saturating_add(1);
        for _ in 0..config.max_iterations.min(8) {
            if remaining.vx == 0. && remaining.vy == 0. {
                break;
            }
            let (hit, candidates) = self.physics.sweep_planar_navigation_body_at(
                body,
                [end.x - start.x, end.y - start.y, 0.],
                [remaining.vx, remaining.vy, 0.],
                config.solid_mask.bits,
            )?;
            counters.solid_candidate_checks =
                counters.solid_candidate_checks.saturating_add(candidates);
            let fraction = hit.as_ref().map_or(1., |h| h.fraction);
            end.x += remaining.vx * fraction;
            end.y += remaining.vy * fraction;
            let Some(hit) = hit else {
                break;
            };
            hits = hits.saturating_add(1);
            last_hit = self.entities_by_body.get(&hit.target.body).copied();
            blocked_x |= hit.normal[0].abs() > 1e-5;
            blocked_y |= hit.normal[1].abs() > 1e-5;
            counters.kinematic_hits = counters.kinematic_hits.saturating_add(1);
            if self.terrain.by_collider.contains_key(&hit.target.collider) {
                counters.kinematic_tile_hits = counters.kinematic_tile_hits.saturating_add(1);
            } else {
                counters.kinematic_entity_hits = counters.kinematic_entity_hits.saturating_add(1);
            }
            remaining.vx *= 1. - fraction;
            remaining.vy *= 1. - fraction;
            let length = hit.normal[0].hypot(hit.normal[1]);
            if length <= 1e-6 {
                break;
            }
            let nx = hit.normal[0] / length;
            let ny = hit.normal[1] / length;
            let inward = remaining.vx * nx + remaining.vy * ny;
            if inward >= 0. {
                break;
            }
            remaining.vx -= nx * inward;
            remaining.vy -= ny * inward;
        }
        Ok(KinematicMoveResult {
            start,
            end,
            requested,
            remaining: Velocity {
                vx: requested.vx - (end.x - start.x),
                vy: requested.vy - (end.y - start.y),
            },
            hit_count: hits,
            blocked_x,
            blocked_y,
            last_hit,
        })
    }
}
