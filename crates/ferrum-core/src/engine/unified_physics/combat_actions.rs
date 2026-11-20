//! Combat queries use native geometry and the source's primary enabled fixture.
use super::*;
use crate::components::CollisionMask;
use crate::gameplay::{melee_attack_query_mask, MeleeAttackCoreData};
use crate::physics3d::{ColliderId, QueryFilter, RayCast};
use crate::world::World;

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct NativeMeleeHit {
    pub entity: Entity,
    collider: ColliderId,
    #[serde(with = "crate::checkpoint_codec::array")]
    point: [f32; 3],
    distance: f32,
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn melee_span(
        &self,
        world: &World,
        entity: Entity,
    ) -> Option<HeightSpan> {
        if self.physics.config().space != Space::PlanarXy {
            return None;
        }
        let binding = self.bindings.get(&(entity.id, entity.generation));
        if binding.is_none_or(|b| b.legacy.is_some()) {
            return world.height_span(entity);
        }
        let span = self.physics.planar_collision_span(binding?.body).ok()??;
        HeightSpan::new(PhysicsFloorId(span.floor), span.elevation, span.height)
    }

    pub(in crate::engine) fn is_planar_combat(&self) -> bool {
        self.physics.config().space == Space::PlanarXy
    }

    /// Conservative fixture-level charge, not an estimate of mesh triangle visits.
    pub(in crate::engine) fn combat_query_work(&self) -> u64 {
        (self.physics.collider_count() as u64)
            .saturating_mul(32)
            .saturating_add(64)
    }

    pub(in crate::engine) fn melee_candidates(
        &mut self,
        world: &World,
        attack: MeleeAttackCoreData,
        center: [f32; 3],
        out: &mut Vec<NativeMeleeHit>,
    ) -> Result<QueryFilter, UnifiedPhysicsError> {
        let body = self
            .bindings
            .get(&(attack.attacker.id, attack.attacker.generation))
            .ok_or(UnifiedPhysicsError::StaleEntity)?
            .body;
        let groups = self
            .physics
            .collider_ids(body)?
            .find_map(|id| self.physics.enabled_collider_groups(id).ok().flatten())
            .ok_or(PhysicsError::InvalidCollider)?;
        let mut filter = queries::legacy_filter(
            groups.1,
            (self.physics.config().space == Space::PlanarXy)
                .then_some(attack.height_span)
                .flatten(),
        );
        filter.category = groups.0;
        filter.respect_target_mask = true;
        filter.exclude_body = Some(body);
        let mut targets = filter.clone();
        targets.mask &= melee_attack_query_mask(attack.target).bits;
        if self.physics.project_point_all(
            center,
            attack.range,
            &targets,
            &mut self.native_nearest_hits,
            self.physics.config().max_colliders,
        )? {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        out.clear();
        for hit in &self.native_nearest_hits {
            if let Some(&entity) = self.entities_by_body.get(&hit.target.body) {
                if world.is_current_entity(entity) {
                    out.push(NativeMeleeHit {
                        entity,
                        collider: hit.target.collider,
                        point: hit.point,
                        distance: hit.distance,
                    });
                }
            }
        }
        // Try the nearest matching fixture first, but a second exposed fixture can
        // still receive the attack. Damage is committed only once per entity.
        out.sort_unstable_by(|a, b| {
            (a.entity.id, a.entity.generation)
                .cmp(&(b.entity.id, b.entity.generation))
                .then(a.distance.total_cmp(&b.distance))
                .then(a.collider.cmp(&b.collider))
        });
        filter.mask &= CollisionMask::WALL.bits;
        filter.include_sensors = false;
        Ok(filter)
    }

    pub(in crate::engine) fn melee_line_clear(
        &mut self,
        center: [f32; 3],
        target: NativeMeleeHit,
        filter: &QueryFilter,
    ) -> Result<bool, UnifiedPhysicsError> {
        let direction: [f32; 3] = std::array::from_fn(|i| target.point[i] - center[i]);
        let distance = direction.iter().map(|v| v * v).sum::<f32>().sqrt();
        if distance <= f32::EPSILON {
            return Ok(true);
        }
        let mut filter = filter.clone();
        if let Some(source) = filter.planar_span {
            let body = self
                .bindings
                .get(&(target.entity.id, target.entity.generation))
                .ok_or(UnifiedPhysicsError::StaleEntity)?
                .body;
            let Some(span) = self.physics.planar_collision_span(body)? else {
                return Ok(false);
            };
            let low = f64::from(source.elevation.max(span.elevation));
            let high = (f64::from(source.elevation) + f64::from(source.height))
                .min(f64::from(span.elevation) + f64::from(span.height));
            filter.planar_span = Some(crate::physics3d::PlanarCollisionSpan {
                floor: source.floor,
                elevation: ((low + high) * 0.5) as f32,
                height: 0.001,
            });
        }
        filter.include_sensors = true;
        filter.respect_target_mask = false;
        if self.physics.cast_ray_all(
            &RayCast {
                origin: center,
                direction,
                max_distance: distance,
                solid: true,
            },
            &filter,
            &mut self.native_ray_hits,
            self.physics.config().max_colliders,
        )? {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        Ok(self.native_ray_hits.iter().all(|hit| {
            // A target with both enemy and wall fixtures does not occlude itself.
            if self.terrain.source(hit.target.collider).is_some() {
                !self.terrain.allows(hit.target.collider, 3)
            } else {
                hit.target.sensor
                    || self
                        .physics
                        .enabled_collider_groups(hit.target.collider)
                        .ok()
                        .flatten()
                        .is_none_or(|(_, mask)| mask & filter.category == 0)
                    || self.entities_by_body.get(&hit.target.body) == Some(&target.entity)
            }
        }))
    }

    pub(in crate::engine) fn record_combat_error(&mut self, error: UnifiedPhysicsError) {
        self.last_error = Some(error);
    }
}

mod file_admission;
