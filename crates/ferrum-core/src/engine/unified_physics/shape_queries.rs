use super::queries::legacy_filter;
use super::*;
use crate::collision::CollisionQueryShape;
use crate::engine::physics_bridge::{
    PhysicsQueryEntityHit, PhysicsQueryResult, PhysicsRaycastBodyHit,
};

impl Engine {
    pub(in crate::engine) fn query_unified_planar_shape(
        &mut self,
        query: CollisionQueryShape,
        mask: u32,
        span: Option<HeightSpan>,
    ) -> Option<u32> {
        let runtime = self.unified_physics.as_mut()?;
        self.physics_query_hits.clear();
        let result = runtime
            .require_planar_query()
            .and_then(|()| query_geometry::convert(query))
            .and_then(|(shape, pose)| {
                runtime.prepare_query(
                    &mut self.world,
                    self.auto_rigid_body_step_config,
                    &self.tilemap,
                    &self.spatial_scene,
                )?;
                runtime.physics.overlap(
                    &shape,
                    pose,
                    &legacy_filter(mask, span),
                    &mut runtime.native_point_hits,
                    runtime.physics.config().max_colliders,
                )?;
                Ok(())
            });
        if let Err(error) = result {
            runtime.last_error.record(error);
            return Some(0);
        }
        for hit in &runtime.native_point_hits {
            if let Some(entity) = runtime.entities_by_body.get(&hit.body) {
                self.physics_query_hits
                    .push(PhysicsQueryEntityHit::from_entity(*entity));
            }
        }
        self.physics_query_hits
            .sort_unstable_by_key(|hit| (hit.entity_id, hit.entity_generation));
        self.physics_query_hits
            .dedup_by_key(|hit| (hit.entity_id, hit.entity_generation));
        Some(self.physics_query_hits.len() as u32)
    }

    pub(in crate::engine) fn query_unified_planar_sweep(
        &mut self,
        query: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        mask: u32,
        span: Option<HeightSpan>,
    ) -> Option<u32> {
        let runtime = self.unified_physics.as_mut()?;
        self.physics_raycast_hits.clear();
        let result = runtime
            .require_planar_query()
            .and_then(|()| query_geometry::convert(query))
            .and_then(|(shape, pose)| {
                let translation = translation(direction, max_distance)?;
                runtime.prepare_query(
                    &mut self.world,
                    self.auto_rigid_body_step_config,
                    &self.tilemap,
                    &self.spatial_scene,
                )?;
                runtime.physics.sweep_all(
                    &shape,
                    pose,
                    translation,
                    &legacy_filter(mask, span),
                    &mut runtime.native_sweep_hits,
                    runtime.physics.config().max_colliders,
                )?;
                Ok((pose, translation))
            });
        let (pose, translation) = match result {
            Ok(value) => value,
            Err(error) => {
                runtime.last_error.record(error);
                return Some(0);
            }
        };
        for hit in &runtime.native_sweep_hits {
            if let Some(entity) = runtime.entities_by_body.get(&hit.target.body) {
                self.physics_raycast_hits.push(PhysicsRaycastBodyHit {
                    entity_id: entity.id,
                    entity_generation: entity.generation,
                    distance: hit.fraction * max_distance,
                    // Existing shape-cast API reports the moving reference point.
                    // The native sweep retains a separate target surface witness.
                    point_x: pose.position[0] + translation[0] * hit.fraction,
                    point_y: pose.position[1] + translation[1] * hit.fraction,
                    normal_x: hit.normal[0],
                    normal_y: hit.normal[1],
                });
            }
        }
        self.physics_raycast_hits.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then((a.entity_id, a.entity_generation).cmp(&(b.entity_id, b.entity_generation)))
        });
        Some(self.physics_raycast_hits.len() as u32)
    }

    pub(in crate::engine) fn query_unified_planar_nearest(
        &mut self,
        point: Transform2D,
        max_distance: f32,
        mask: u32,
        span: Option<HeightSpan>,
    ) -> Option<bool> {
        let runtime = self.unified_physics.as_mut()?;
        self.physics_query_result = PhysicsQueryResult::default();
        let result = runtime
            .require_planar_query()
            .and_then(|()| {
                runtime.prepare_query(
                    &mut self.world,
                    self.auto_rigid_body_step_config,
                    &self.tilemap,
                    &self.spatial_scene,
                )
            })
            .and_then(|()| {
                runtime.physics.project_point_all(
                    [point.x, point.y, 0.0],
                    max_distance,
                    &legacy_filter(mask, span),
                    &mut runtime.native_nearest_hits,
                    runtime.physics.config().max_colliders,
                )?;
                Ok(())
            });
        if let Err(error) = result {
            runtime.last_error.record(error);
            return Some(false);
        }
        let nearest = runtime
            .native_nearest_hits
            .iter()
            .filter_map(|hit| Some((hit, runtime.entities_by_body.get(&hit.target.body)?)))
            .min_by(|(a, ea), (b, eb)| {
                a.distance
                    .total_cmp(&b.distance)
                    .then((ea.id, ea.generation).cmp(&(eb.id, eb.generation)))
                    .then(a.target.collider.cmp(&b.target.collider))
            });
        let Some((hit, entity)) = nearest else {
            return Some(false);
        };
        self.physics_query_result = PhysicsQueryResult {
            entity_id: entity.id,
            entity_generation: entity.generation,
            point_x: hit.point[0],
            point_y: hit.point[1],
            distance: hit.distance,
            ..PhysicsQueryResult::default()
        };
        Some(true)
    }
}

fn translation(direction: Velocity, distance: f32) -> Result<[f32; 3], UnifiedPhysicsError> {
    if ![direction.vx, direction.vy]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= 1.0e6)
        || !distance.is_finite()
        || !(0.0..=1.0e6).contains(&distance)
    {
        return Err(PhysicsError::InvalidQuery.into());
    }
    let length = direction.vx.hypot(direction.vy);
    if length < 1.0e-8 {
        return Err(PhysicsError::InvalidQuery.into());
    }
    Ok([
        direction.vx / length * distance,
        direction.vy / length * distance,
        0.0,
    ])
}
