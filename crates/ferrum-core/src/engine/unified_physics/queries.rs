//! Query the simulation world, independently of render anchors and interpolation.
use super::*;
use crate::engine::physics_bridge::{PhysicsQueryEntityHit, PhysicsRaycastBodyHit};
use crate::physics::RigidBodyStepConfig;
use crate::physics3d::{PlanarCollisionSpan, QueryFilter, RayCast, RayHit};
use crate::world::World;

/// Native ray geometry and the generational gameplay entity that owns the collider.
#[derive(Debug, Clone, PartialEq)]
pub struct UnifiedRayHit {
    /// Gameplay entity identity, independent of native body arena slots.
    pub entity: Entity,
    /// Hit point/normal in simulation XYZ coordinates, without a render offset.
    pub hit: RayHit,
}

impl Engine {
    /// Queries the current native world in XYZ (or XY with Z zero in planar mode).
    /// Applies pending authored body/fixture edits without stepping or consuming inputs.
    /// Replaces `out` on success with the closest `limit` collider hits in distance order;
    /// ties use entity then collider identity. Returns true if hits were omitted.
    /// Invalid input leaves `out` unchanged. This is a native Rust API, not a Web ABI.
    pub fn cast_unified_ray_all(
        &mut self,
        ray: &RayCast,
        filter: &QueryFilter,
        out: &mut Vec<UnifiedRayHit>,
        limit: usize,
    ) -> Result<bool, UnifiedPhysicsError> {
        if self.scene_mode != SceneMode::Data {
            return Err(UnifiedPhysicsError::WrongScene);
        }
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        if limit == 0 || limit > runtime.physics.config().max_colliders {
            return Err(PhysicsError::InvalidQuery.into());
        }
        runtime.collect_ray(
            &mut self.world,
            self.auto_rigid_body_step_config,
            ray,
            filter,
            (&self.tilemap, &self.spatial_scene),
        )?;
        out.clear();
        out.extend(runtime.native_ray_hits.iter().filter_map(|hit| {
            Some(UnifiedRayHit {
                entity: *runtime.entities_by_body.get(&hit.target.body)?,
                hit: hit.clone(),
            })
        }));
        out.sort_unstable_by(|a, b| {
            a.hit
                .distance
                .total_cmp(&b.hit.distance)
                .then((a.entity.id, a.entity.generation).cmp(&(b.entity.id, b.entity.generation)))
                .then(a.hit.target.collider.cmp(&b.hit.target.collider))
        });
        let truncated = out.len() > limit;
        out.truncate(limit);
        Ok(truncated)
    }

    // None requests the legacy path only when no unified world is configured.
    pub(in crate::engine) fn query_unified_planar_ray(
        &mut self,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        mask: u32,
        span: Option<HeightSpan>,
    ) -> Option<u32> {
        let runtime = self.unified_physics.as_mut()?;
        self.physics_raycast_hits.clear();
        let ray = RayCast {
            origin: [origin.x, origin.y, 0.0],
            direction: [direction.vx, direction.vy, 0.0],
            max_distance,
            solid: true,
        };
        let result = runtime.require_planar_query().and_then(|()| {
            runtime.collect_ray(
                &mut self.world,
                self.auto_rigid_body_step_config,
                &ray,
                &legacy_filter(mask, span),
                (&self.tilemap, &self.spatial_scene),
            )
        });
        if let Err(error) = result {
            runtime.last_error = Some(error);
            return Some(0);
        }
        for hit in &runtime.native_ray_hits {
            if let Some(entity) = runtime.entities_by_body.get(&hit.target.body) {
                self.physics_raycast_hits.push(PhysicsRaycastBodyHit {
                    entity_id: entity.id,
                    entity_generation: entity.generation,
                    distance: hit.distance,
                    point_x: hit.point[0],
                    point_y: hit.point[1],
                    normal_x: hit.normal[0],
                    normal_y: hit.normal[1],
                });
            }
        }
        // Stable sort preserves the collider order for equal hits on one entity.
        self.physics_raycast_hits.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then((a.entity_id, a.entity_generation).cmp(&(b.entity_id, b.entity_generation)))
        });
        Some(self.physics_raycast_hits.len() as u32)
    }

    pub(in crate::engine) fn query_unified_planar_point(
        &mut self,
        point: Transform2D,
        mask: u32,
        span: Option<HeightSpan>,
    ) -> Option<u32> {
        let runtime = self.unified_physics.as_mut()?;
        self.physics_query_hits.clear();
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
                runtime
                    .physics
                    .overlap_point(
                        [point.x, point.y, 0.0],
                        &legacy_filter(mask, span),
                        &mut runtime.native_point_hits,
                        runtime.physics.config().max_colliders,
                    )
                    .map(|_| ())
                    .map_err(Into::into)
            });
        if let Err(error) = result {
            runtime.last_error = Some(error);
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
}

impl UnifiedPhysicsRuntime {
    pub(super) fn require_planar_query(&self) -> Result<(), UnifiedPhysicsError> {
        if self.physics.config().space == Space::PlanarXy {
            Ok(())
        } else {
            Err(UnifiedPhysicsError::SpatialQueryRequires3d)
        }
    }

    pub(super) fn prepare_query(
        &mut self,
        world: &mut World,
        config: RigidBodyStepConfig,
        tiles: &crate::tilemap::Tilemap,
        spatial: &crate::spatial_scene::SpatialScene,
    ) -> Result<(), UnifiedPhysicsError> {
        self.retire_deleted_entities(world);
        self.retire_planar_components(world);
        self.prepare_terrain(tiles, spatial)?;
        self.prepare_planar(world, config)?;
        // Geometry/control synchronization only. Forces, impulses, sleep commands,
        // joints, fixed-clock state, and lifecycle delivery belong to a physics tick.
        self.retire_terrain()?;
        self.commit_planar(world, false)?;
        self.commit_terrain()?;
        // Capture explicit fixture removals before their identities can disappear;
        // queries never publish lifecycle output or synthesize a completed step.
        self.lifecycle.capture(
            &mut self.physics,
            &self.entities_by_body,
            &self.terrain.by_collider,
        );
        Ok(())
    }

    pub(super) fn collect_ray(
        &mut self,
        world: &mut World,
        config: RigidBodyStepConfig,
        ray: &RayCast,
        filter: &QueryFilter,
        terrain: (
            &crate::tilemap::Tilemap,
            &crate::spatial_scene::SpatialScene,
        ),
    ) -> Result<(), UnifiedPhysicsError> {
        self.prepare_query(world, config, terrain.0, terrain.1)?;
        self.physics.cast_ray_all(
            ray,
            filter,
            &mut self.native_ray_hits,
            self.physics.config().max_colliders,
        )?;
        Ok(())
    }
}

pub(super) fn legacy_filter(mask: u32, span: Option<HeightSpan>) -> QueryFilter {
    QueryFilter {
        mask,
        respect_target_mask: false,
        include_sensors: true,
        planar_span: span.map(|span| PlanarCollisionSpan {
            floor: span.floor.0,
            elevation: span.elevation,
            height: span.height,
        }),
        ..QueryFilter::default()
    }
}
