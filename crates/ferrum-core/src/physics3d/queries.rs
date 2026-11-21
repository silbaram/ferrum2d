use super::colliders::native_collider;
use super::events::collider_ref;
use super::geometry::{groups, is_convex, shared_shape};
use super::types::{valid_pose, valid_vector, validate_plane};
use super::world::{native_id, native_pose};
use super::{
    BodyId, ColliderId, ColliderRef, PhysicsError, PhysicsWorld3d, PlanarCollisionSpan, Pose, Shape,
};
use rapier3d::prelude as rp;

mod collections;
mod planar_navigation;
mod planar_platformer;
mod planar_target;
mod shape_queries;
mod step_motion;
pub use shape_queries::PointHit;
pub(super) use step_motion::StepMotion;

/// Category/mask filtering, optional exclusions, and sensor selection.
#[derive(Debug, Clone, PartialEq)]
pub struct QueryFilter {
    /// Membership bits of the query shape.
    pub category: u32,
    /// Accepted target membership bits.
    pub mask: u32,
    /// Require the target mask to accept `category` (default true). Set false for
    /// category-only inspection queries; `mask` still selects target categories.
    pub respect_target_mask: bool,
    /// Sensors are omitted by default, including sensors on terrain bodies.
    pub include_sensors: bool,
    /// Ignore all colliders of this live body.
    pub exclude_body: Option<BodyId>,
    /// Ignore one live collider.
    pub exclude_collider: Option<ColliderId>,
    /// Optional logical planar range. Unlike collision pairs, an explicit query
    /// range excludes targets without a span, matching height-aware game queries.
    pub planar_span: Option<PlanarCollisionSpan>,
}

impl Default for QueryFilter {
    fn default() -> Self {
        Self {
            category: u32::MAX,
            mask: u32::MAX,
            include_sensors: false,
            respect_target_mask: true,
            exclude_body: None,
            exclude_collider: None,
            planar_span: None,
        }
    }
}

/// Finite ray in engine units. Direction is normalized internally; it must be nonzero.
#[derive(Debug, Clone, PartialEq)]
pub struct RayCast {
    /// World-space ray origin.
    pub origin: [f32; 3],
    /// Nonzero direction; its length does not scale `max_distance`.
    pub direction: [f32; 3],
    /// Maximum distance in engine units, in [0, 1,000,000].
    pub max_distance: f32,
    /// An origin inside a solid reports distance zero; false finds the exit surface.
    pub solid: bool,
}

/// Ray hit. Point and outward surface normal are in world space.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RayHit {
    /// Hit collider and its owner.
    pub target: ColliderRef,
    /// Distance from the ray origin in engine units.
    pub distance: f32,
    /// World-space hit position.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub point: [f32; 3],
    /// World-space outward surface normal (may be zero for an interior solid hit).
    #[serde(with = "crate::checkpoint_codec::array")]
    pub normal: [f32; 3],
}

/// Convex sweep hit against world geometry, including terrain and compounds.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SweepHit {
    /// Hit collider and its owner.
    pub target: ColliderRef,
    /// Fraction of the requested translation completed before impact, in [0, 1].
    pub fraction: f32,
    /// World-space witness point and outward normal on the hit collider.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub point: [f32; 3],
    /// World-space outward normal on the hit collider.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub normal: [f32; 3],
    /// The cast began touching or penetrating the target.
    pub initial_overlap: bool,
}

impl PhysicsWorld3d {
    /// Refreshes scene-query bounds after direct edits without running collision detection.
    /// The physics pipeline retains its modification lists and pending kinematic targets.
    pub fn refresh_queries(&mut self) {
        if self.query_updates.is_empty() {
            return;
        }
        self.backend
            .bodies
            .propagate_modified_body_positions_to_colliders(&mut self.backend.colliders);
        self.query_updates
            .sort_unstable_by_key(|id| id.into_raw_parts());
        self.query_updates.dedup();
        for id in self.query_updates.drain(..) {
            if let Some(collider) = self.backend.colliders.get(id) {
                // set_aabb records the update for the next physics broad-phase pass.
                // Removed leaves can remain until that pass: queries reject absent handles,
                // and a replacement in the same slot overwrites the leaf here.
                self.backend.broad_phase.set_aabb(
                    &self.backend.integration_parameters,
                    id,
                    collider.compute_aabb(),
                );
            }
        }
    }

    pub(super) fn query_filter(
        &self,
        filter: &QueryFilter,
    ) -> Result<rp::QueryFilter<'static>, PhysicsError> {
        self.validate_planar_collision_span(filter.planar_span)?;
        if let Some(body) = filter.exclude_body {
            if !self.backend.bodies.contains(native_id(body)) {
                return Err(PhysicsError::StaleBody);
            }
        }
        if let Some(collider) = filter.exclude_collider {
            if !self.backend.colliders.contains(native_collider(collider)) {
                return Err(PhysicsError::StaleCollider);
            }
        }
        Ok(rp::QueryFilter {
            flags: if filter.include_sensors {
                rp::QueryFilterFlags::empty()
            } else {
                rp::QueryFilterFlags::EXCLUDE_SENSORS
            },
            groups: filter
                .respect_target_mask
                .then(|| groups(filter.category, filter.mask)),
            exclude_rigid_body: filter.exclude_body.map(native_id),
            exclude_collider: filter.exclude_collider.map(native_collider),
            predicate: None,
        })
    }

    fn query_allows(&self, collider: &rp::Collider, filter: &QueryFilter) -> bool {
        collider.is_enabled()
            && (collider.collision_groups().memberships.bits() & filter.mask != 0)
            && self
                .contact_policies
                .query_allows(collider.parent(), filter.planar_span)
            && collider.parent().is_none_or(|id| {
                self.backend
                    .bodies
                    .get(id)
                    .is_some_and(|body| body.is_enabled())
            })
    }

    pub(super) fn native_ray(&self, ray: &RayCast) -> Result<rp::Ray, PhysicsError> {
        if !valid_vector(&ray.origin)
            || !valid_vector(&ray.direction)
            || !ray.max_distance.is_finite()
            || !(0.0..=1.0e6).contains(&ray.max_distance)
        {
            return Err(PhysicsError::InvalidQuery);
        }
        let direction = rp::Vector::from(ray.direction);
        let length = direction.length();
        if length < 1.0e-8 {
            return Err(PhysicsError::InvalidQuery);
        }
        validate_plane(
            self.config.space,
            Pose {
                position: ray.origin,
                ..Pose::default()
            },
            ray.direction,
            [0.0; 3],
        )?;
        Ok(rp::Ray::new(ray.origin.into(), direction / length))
    }

    /// Casts a ray against the current scene, refreshing edits without advancing time.
    /// Invalid inputs and stale excluded identities are errors, not silent misses.
    pub fn cast_ray(
        &mut self,
        ray: &RayCast,
        filter: &QueryFilter,
    ) -> Result<Option<RayHit>, PhysicsError> {
        let ray_native = self.native_ray(ray)?;
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let filter = native_filter.predicate(&enabled);
        let hit =
            self.backend
                .cast_ray_and_get_normal(&ray_native, ray.max_distance, ray.solid, filter);
        Ok(hit.and_then(|(id, hit)| {
            let target = collider_ref(id, self.backend.colliders.get(id)?)?;
            Some(RayHit {
                target,
                distance: hit.time_of_impact,
                point: ray_native.point_at(hit.time_of_impact).to_array(),
                normal: hit.normal.to_array(),
            })
        }))
    }

    /// Sweeps a convex shape by a world-space translation, with fixed orientation.
    /// Initial penetration is reported at fraction zero with impact geometry computed.
    pub fn sweep(
        &mut self,
        shape: &Shape,
        pose: Pose,
        translation: [f32; 3],
        filter: &QueryFilter,
    ) -> Result<Option<SweepHit>, PhysicsError> {
        if !valid_pose(pose) || !valid_vector(&translation) {
            return Err(PhysicsError::InvalidQuery);
        }
        validate_plane(self.config.space, pose, translation, [0.0; 3])?;
        let shape = self.query_shape(shape, pose)?;
        if translation == [0.0; 3] {
            return self.stationary_sweep(shape.as_ref(), pose, filter);
        }
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let filter = native_filter.predicate(&enabled);
        let options = rapier3d::parry::query::ShapeCastOptions {
            max_time_of_impact: 1.0,
            target_distance: 0.0,
            stop_at_penetration: true,
            compute_impact_geometry_on_penetration: true,
        };
        let hit = self.backend.cast_shape(
            &native_pose(pose),
            translation.into(),
            shape.as_ref(),
            options,
            filter,
        );
        Ok(hit.and_then(|(id, hit)| {
            let target = collider_ref(id, self.backend.colliders.get(id)?)?;
            Some(SweepHit {
                target,
                fraction: hit.time_of_impact,
                point: hit.witness1.to_array(),
                normal: hit.normal1.to_array(),
                initial_overlap: hit.time_of_impact == 0.0,
            })
        }))
    }

    /// Replaces `out` with at most `limit` convex-overlap hits, sorted by collider identity.
    /// Retains the lowest identities and returns true if additional hits were omitted.
    /// The buffer may grow to world collider capacity. Invalid input preserves output.
    pub fn overlap(
        &mut self,
        shape: &Shape,
        pose: Pose,
        filter: &QueryFilter,
        out: &mut Vec<ColliderRef>,
        limit: usize,
    ) -> Result<bool, PhysicsError> {
        self.validate_query_limit(limit)?;
        let shape = self.query_shape(shape, pose)?;
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let filter = native_filter.predicate(&enabled);
        out.clear();
        let pipeline = self.backend.query_pipeline_with_filter(filter);
        for (id, collider) in pipeline.intersect_shape(native_pose(pose), shape.as_ref()) {
            if let Some(target) = collider_ref(id, collider) {
                out.push(target);
            }
        }
        out.sort_unstable_by_key(|hit| hit.collider);
        let truncated = out.len() > limit;
        out.truncate(limit);
        Ok(truncated)
    }
}
