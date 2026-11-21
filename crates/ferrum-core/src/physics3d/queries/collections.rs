//! Reusable query output buffers. Traversal order must not select the retained hits.
use super::*;

impl PhysicsWorld3d {
    /// Replaces `out` with ray hits ordered by distance, then collider identity.
    /// Each collider contributes its first hit, including a compound collider.
    /// Retains the closest `limit` hits and reports whether others were omitted.
    /// The buffer may grow up to the world's collider capacity during collection.
    /// Invalid input leaves `out` unchanged; queries never advance simulation time.
    pub fn cast_ray_all(
        &mut self,
        ray: &RayCast,
        filter: &QueryFilter,
        out: &mut Vec<RayHit>,
        limit: usize,
    ) -> Result<bool, PhysicsError> {
        self.validate_query_limit(limit)?;
        let ray_native = self.native_ray(ray)?;
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let pipeline = self
            .backend
            .query_pipeline_with_filter(native_filter.predicate(&enabled));
        out.clear();
        for (id, collider, hit) in pipeline.intersect_ray(ray_native, ray.max_distance, ray.solid) {
            if let Some(target) = collider_ref(id, collider) {
                out.push(RayHit {
                    target,
                    distance: hit.time_of_impact,
                    point: ray_native.point_at(hit.time_of_impact).to_array(),
                    normal: hit.normal.to_array(),
                });
            }
        }
        out.sort_unstable_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then(a.target.collider.cmp(&b.target.collider))
        });
        let truncated = out.len() > limit;
        out.truncate(limit);
        Ok(truncated)
    }

    /// Replaces `out` with colliders containing a point, sorted by collider identity.
    /// Retains the first `limit` identities and reports whether others were omitted.
    /// The buffer may grow up to the world's collider capacity during collection.
    /// Invalid input leaves `out` unchanged; direct edits are visible immediately.
    pub fn overlap_point(
        &mut self,
        point: [f32; 3],
        filter: &QueryFilter,
        out: &mut Vec<ColliderRef>,
        limit: usize,
    ) -> Result<bool, PhysicsError> {
        self.validate_query_limit(limit)?;
        if !valid_vector(&point) {
            return Err(PhysicsError::InvalidQuery);
        }
        validate_plane(
            self.config.space,
            Pose {
                position: point,
                ..Pose::default()
            },
            [0.0; 3],
            [0.0; 3],
        )?;
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let pipeline = self
            .backend
            .query_pipeline_with_filter(native_filter.predicate(&enabled));
        out.clear();
        for (id, collider) in pipeline.intersect_point(point.into()) {
            if let Some(target) = collider_ref(id, collider) {
                out.push(target);
            }
        }
        out.sort_unstable_by_key(|hit| hit.collider);
        let truncated = out.len() > limit;
        out.truncate(limit);
        Ok(truncated)
    }

    pub(super) fn validate_query_limit(&self, limit: usize) -> Result<(), PhysicsError> {
        if limit == 0 || limit > self.config.max_colliders {
            Err(PhysicsError::InvalidQuery)
        } else {
            Ok(())
        }
    }
}
