use super::*;
use rapier3d::parry::bounding_volume::BoundingVolume;

/// Closest point on one collider, or the query point itself when inside a solid.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PointHit {
    /// Collider and body identity.
    pub target: ColliderRef,
    /// Distance from the query point in engine units.
    pub distance: f32,
    /// World-space closest point.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub point: [f32; 3],
    /// Whether the query point is inside or on the collider.
    pub is_inside: bool,
}

impl PhysicsWorld3d {
    // Query boxes can have zero thickness, unlike physical mass-bearing colliders.
    // In particular a legacy AABB may collapse to a line or point in XY.
    pub(super) fn query_shape(
        &self,
        shape: &Shape,
        pose: Pose,
    ) -> Result<rp::SharedShape, PhysicsError> {
        if !valid_pose(pose) {
            return Err(PhysicsError::InvalidQuery);
        }
        validate_plane(self.config.space, pose, [0.0; 3], [0.0; 3])?;
        if !is_convex(shape) {
            return Err(PhysicsError::UnsupportedShape);
        }
        if let Shape::Box {
            half_extents: [x, y, z],
        } = shape
        {
            if crate::physics3d::geometry::valid_box_extents([*x, *y, *z], self.config.space, 0.0) {
                return Ok(rp::SharedShape::cuboid(*x, *y, *z));
            }
        }
        shared_shape(shape, self.config.space)
    }

    /// Sweeps a convex shape against all candidate colliders, with fixed orientation.
    /// Replaces `out`, sorted by fraction then collider identity, and keeps `limit` hits.
    /// Returns whether further hits were omitted. Each collider contributes its first hit.
    /// Points/normals are on the target in world space, including initial penetration.
    /// The buffer may grow to world collider capacity. Invalid input preserves output.
    #[allow(clippy::too_many_arguments)]
    pub fn sweep_all(
        &mut self,
        shape: &Shape,
        pose: Pose,
        translation: [f32; 3],
        filter: &QueryFilter,
        out: &mut Vec<SweepHit>,
        limit: usize,
    ) -> Result<bool, PhysicsError> {
        self.validate_query_limit(limit)?;
        if !valid_pose(pose) || !valid_vector(&translation) {
            return Err(PhysicsError::InvalidQuery);
        }
        validate_plane(self.config.space, pose, translation, [0.0; 3])?;
        let shape = self.query_shape(shape, pose)?;
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let pipeline = self
            .backend
            .query_pipeline_with_filter(native_filter.predicate(&enabled));
        let pose = native_pose(pose);
        let translation = rp::Vector::from(translation);
        let start_bounds = shape.compute_aabb(&pose);
        let bounds = start_bounds.merged(&start_bounds.translated(translation));
        let options = rapier3d::parry::query::ShapeCastOptions {
            max_time_of_impact: 1.0,
            target_distance: 0.0,
            stop_at_penetration: true,
            compute_impact_geometry_on_penetration: true,
        };
        out.clear();
        for (id, collider) in pipeline.intersect_aabb_conservative(bounds) {
            let Some(target) = collider_ref(id, collider) else {
                continue;
            };
            if translation == rp::Vector::ZERO {
                if let Some(hit) = stationary_contact(target, collider, shape.as_ref(), &pose)? {
                    out.push(hit);
                }
                continue;
            }
            // Target is shape 1, stationary. Parry returns witnesses in each shape's
            // local frame; transform target geometry, not the moving shape's center.
            let hit = rapier3d::parry::query::cast_shapes(
                collider.position(),
                rp::Vector::ZERO,
                collider.shape(),
                &pose,
                translation,
                shape.as_ref(),
                options,
            )
            .map_err(|_| PhysicsError::UnsupportedShape)?;
            if let Some(hit) = hit {
                out.push(SweepHit {
                    target,
                    fraction: hit.time_of_impact,
                    point: (collider.position() * hit.witness1).to_array(),
                    normal: (collider.position().rotation * hit.normal1).to_array(),
                    initial_overlap: hit.time_of_impact == 0.0,
                });
            }
        }
        out.sort_unstable_by(|a, b| {
            a.fraction
                .total_cmp(&b.fraction)
                .then(a.target.collider.cmp(&b.target.collider))
        });
        let truncated = out.len() > limit;
        out.truncate(limit);
        Ok(truncated)
    }

    // A zero translation has no GJK cast direction. Query current contact geometry
    // explicitly instead of reporting an overlapping solid as a miss.
    pub(super) fn stationary_sweep(
        &mut self,
        shape: &dyn rp::Shape,
        pose: Pose,
        filter: &QueryFilter,
    ) -> Result<Option<SweepHit>, PhysicsError> {
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let pipeline = self
            .backend
            .query_pipeline_with_filter(native_filter.predicate(&enabled));
        let pose = native_pose(pose);
        let mut nearest: Option<SweepHit> = None;
        for (id, collider) in pipeline.intersect_aabb_conservative(shape.compute_aabb(&pose)) {
            let Some(target) = collider_ref(id, collider) else {
                continue;
            };
            if let Some(hit) = stationary_contact(target, collider, shape, &pose)? {
                if nearest
                    .as_ref()
                    .is_none_or(|old| hit.target.collider < old.target.collider)
                {
                    nearest = Some(hit);
                }
            }
        }
        Ok(nearest)
    }

    /// Finds the closest point on each collider within `max_distance` (0..=1,000,000).
    /// Interior points have distance zero. Results sort by distance then collider identity.
    /// Replaces `out`, keeps `limit` hits and reports whether further hits were omitted.
    /// The buffer may grow to world collider capacity. Invalid input preserves output.
    pub fn project_point_all(
        &mut self,
        point: [f32; 3],
        max_distance: f32,
        filter: &QueryFilter,
        out: &mut Vec<PointHit>,
        limit: usize,
    ) -> Result<bool, PhysicsError> {
        self.validate_query_limit(limit)?;
        if !valid_vector(&point)
            || !max_distance.is_finite()
            || !(0.0..=1.0e6).contains(&max_distance)
        {
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
        let point = rp::Vector::from(point);
        let bounds = rapier3d::parry::bounding_volume::Aabb::from_half_extents(
            point,
            rp::Vector::splat(max_distance),
        );
        out.clear();
        for (id, collider) in pipeline.intersect_aabb_conservative(bounds) {
            let projection = collider
                .shape()
                .project_point(collider.position(), point, true);
            let distance = (point - projection.point).length();
            if distance <= max_distance {
                if let Some(target) = collider_ref(id, collider) {
                    out.push(PointHit {
                        target,
                        distance,
                        point: projection.point.to_array(),
                        is_inside: projection.is_inside,
                    });
                }
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
}

fn stationary_contact(
    target: ColliderRef,
    collider: &rp::Collider,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
) -> Result<Option<SweepHit>, PhysicsError> {
    rapier3d::parry::query::contact(collider.position(), collider.shape(), pose, shape, 0.0)
        .map(|contact| {
            contact.map(|contact| SweepHit {
                target,
                fraction: 0.0,
                point: contact.point1.to_array(),
                normal: contact.normal1.to_array(),
                initial_overlap: true,
            })
        })
        .map_err(|_| PhysicsError::UnsupportedShape)
}

// Native geometry callback used by the legacy tile DTO adapter. It does not
// insert a query body/collider or fabricate an identity.
pub(crate) type ShapeContactVisitor<'a> = dyn FnMut(ColliderRef, [f32; 3], [f32; 3], f32) + 'a;
impl PhysicsWorld3d {
    pub(crate) fn visit_shape_contacts(
        &mut self,
        shape: &Shape,
        pose: Pose,
        filter: &QueryFilter,
        visit: &mut ShapeContactVisitor<'_>,
    ) -> Result<(), PhysicsError> {
        use rapier3d::parry::query::{
            ContactManifold, DefaultQueryDispatcher, PersistentQueryDispatcher,
        };
        let shape = self.query_shape(shape, pose)?;
        let native_filter = self.query_filter(filter)?;
        self.refresh_queries();
        let enabled = |_, collider: &rp::Collider| self.query_allows(collider, filter);
        let pipeline = self
            .backend
            .query_pipeline_with_filter(native_filter.predicate(&enabled));
        let pose = native_pose(pose);
        let mut manifolds: Vec<ContactManifold<(), ()>> = Vec::new();
        for (id, collider) in pipeline.intersect_aabb_conservative(shape.compute_aabb(&pose)) {
            let Some(target) = collider_ref(id, collider) else {
                continue;
            };
            manifolds.clear();
            DefaultQueryDispatcher
                .contact_manifolds(
                    &pose.inv_mul(collider.position()),
                    shape.as_ref(),
                    collider.shape(),
                    0.,
                    &mut manifolds,
                    &mut None,
                )
                .map_err(|_| PhysicsError::UnsupportedShape)?;
            for manifold in &manifolds {
                let first = manifold.subshape_pos1().map_or(pose, |p| pose * p);
                let second = manifold
                    .subshape_pos2()
                    .map_or(*collider.position(), |p| collider.position() * p);
                let normal = -(first.rotation * manifold.local_n1);
                for point in &manifold.points {
                    if point.dist <= 0. {
                        visit(
                            target,
                            normal.to_array(),
                            (second * point.local_p2).to_array(),
                            -point.dist,
                        );
                    }
                }
            }
        }
        Ok(())
    }
}
