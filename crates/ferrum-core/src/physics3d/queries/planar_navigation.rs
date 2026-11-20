//! Planar controller queries reuse every active solid convex source fixture.
use super::super::events::collider_id;
use super::*;
use rapier3d::parry::bounding_volume::BoundingVolume;

struct RecoveryContact {
    distance: f32,
    normal: [f32; 3],
    target: ColliderId,
    source: ColliderId,
}

impl PhysicsWorld3d {
    /// Plans bounded XY penetration recovery without moving bodies or consuming input.
    /// Every active solid convex fixture participates with its own native pose/filter.
    /// Unresolved or non-planar recovery rejects the complete plan.
    pub(crate) fn planar_navigation_recovery_translation(
        &mut self,
        body: BodyId,
        solid_mask: u32,
    ) -> Result<([f32; 3], u32), PhysicsError> {
        self.refresh_queries();
        self.validate_planar_controller_source(body)?;
        let span = self.planar_collision_span(body)?;
        let rigid = self
            .backend
            .bodies
            .get(native_id(body))
            .ok_or(PhysicsError::StaleBody)?;
        let tolerance = 1e-5 * self.config.length_unit;
        let mut offset = [0.; 3];
        let mut candidates = 0u32;
        // The final pass verifies the eighth correction without committing a ninth.
        for iteration in 0..=8 {
            let mut deepest: Option<RecoveryContact> = None;
            for &source in rigid.colliders() {
                let collider = &self.backend.colliders[source];
                if !collider.is_enabled() || collider.is_sensor() {
                    continue;
                }
                let shape = collider.shape();
                let mut pose = *collider.position();
                pose.translation += rp::Vector::from(offset);
                let groups = collider.collision_groups();
                let filter = QueryFilter {
                    category: groups.memberships.bits(),
                    mask: groups.filter.bits() & solid_mask,
                    exclude_body: Some(body),
                    ..Default::default()
                };
                let enabled = |_, target: &rp::Collider| {
                    self.query_allows(target, &filter)
                        && self
                            .contact_policies
                            .pair_span_allows(span, target.parent())
                };
                let pipeline = self
                    .backend
                    .query_pipeline_with_filter(self.query_filter(&filter)?.predicate(&enabled));
                for (target_id, target) in
                    pipeline.intersect_aabb_conservative(shape.compute_aabb(&pose))
                {
                    candidates = candidates.saturating_add(1);
                    let Some(contact) = rapier3d::parry::query::contact(
                        &pose,
                        shape,
                        target.position(),
                        target.shape(),
                        0.,
                    )
                    .map_err(|_| PhysicsError::UnsupportedShape)?
                    else {
                        continue;
                    };
                    if !contact.dist.is_finite()
                        || !contact.normal1.to_array().iter().all(|v| v.is_finite())
                    {
                        return Err(PhysicsError::InvalidQuery);
                    }
                    if contact.dist >= -tolerance {
                        continue;
                    }
                    let target = collider_id(target_id);
                    let source = collider_id(source);
                    if deepest.as_ref().is_some_and(|old| {
                        old.distance < contact.dist
                            || (old.distance == contact.dist
                                && (old.target, old.source) <= (target, source))
                    }) {
                        continue;
                    }
                    deepest = Some(RecoveryContact {
                        distance: contact.dist,
                        normal: contact.normal1.to_array(),
                        target,
                        source,
                    });
                }
            }
            let Some(contact) = deepest else {
                return Ok((offset, candidates));
            };
            if iteration == 8 {
                return Err(PhysicsError::InvalidQuery);
            }
            let xy_squared = contact.normal[0].powi(2) + contact.normal[1].powi(2);
            if xy_squared <= 1e-12 || contact.normal[2].abs() > 1e-4 {
                return Err(PhysicsError::UnsupportedShape);
            }
            let distance = (contact.distance - tolerance) / xy_squared;
            offset[0] += contact.normal[0] * distance;
            offset[1] += contact.normal[1] * distance;
            if !valid_vector(&offset) {
                return Err(PhysicsError::InvalidQuery);
            }
        }
        Err(PhysicsError::InvalidQuery)
    }

    /// Validates the live source without changing its pose, clock or pending input.
    pub(crate) fn validate_planar_controller_source(
        &self,
        body: BodyId,
    ) -> Result<(), PhysicsError> {
        if self.config.space != super::super::Space::PlanarXy {
            return Err(PhysicsError::InvalidQuery);
        }
        let rigid = self
            .backend
            .bodies
            .get(native_id(body))
            .ok_or(PhysicsError::StaleBody)?;
        if !rigid.is_enabled() || rigid.body_type() != rp::RigidBodyType::KinematicVelocityBased {
            return Err(PhysicsError::WrongBodyKind);
        }
        let mut solid = false;
        for &id in rigid.colliders() {
            let collider = self
                .backend
                .colliders
                .get(id)
                .ok_or(PhysicsError::StaleCollider)?;
            if !collider.is_enabled() || collider.is_sensor() {
                continue;
            }
            let shape = collider.shape();
            if shape.as_ball().is_none()
                && shape.as_cuboid().is_none()
                && shape.as_capsule().is_none()
                && shape.as_convex_polyhedron().is_none()
            {
                return Err(PhysicsError::UnsupportedShape);
            }
            solid = true;
        }
        if solid {
            Ok(())
        } else {
            Err(PhysicsError::UnsupportedShape)
        }
    }

    pub(crate) fn commit_planar_navigation_position(
        &mut self,
        id: BodyId,
        position: [f32; 3],
    ) -> Result<(), PhysicsError> {
        let pose = Pose {
            position,
            ..self.body_state(id)?.pose
        };
        self.validate_pose(id, pose)?;
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        // Translating an actor must preserve its unwrapped planar angle/history.
        body.set_translation(position.into(), true);
        self.query_updates.extend_from_slice(body.colliders());
        self.invalidate_character_support(Some(id), None);
        Ok(())
    }

    pub(crate) fn sweep_planar_navigation_body(
        &mut self,
        body: BodyId,
        translation: [f32; 3],
        solid_mask: u32,
    ) -> Result<(Option<SweepHit>, u32), PhysicsError> {
        self.sweep_planar_navigation_body_at(body, [0.; 3], translation, solid_mask)
    }

    pub(crate) fn sweep_planar_navigation_body_at(
        &mut self,
        body: BodyId,
        offset: [f32; 3],
        translation: [f32; 3],
        solid_mask: u32,
    ) -> Result<(Option<SweepHit>, u32), PhysicsError> {
        if self.config.space != super::super::Space::PlanarXy
            || !valid_vector(&translation)
            || !valid_vector(&offset)
            || offset[2] != 0.
            || translation[2] != 0.
        {
            return Err(PhysicsError::InvalidQuery);
        }
        self.refresh_queries();
        self.validate_planar_controller_source(body)?;
        let native_body = native_id(body);
        let rigid = self
            .backend
            .bodies
            .get(native_body)
            .ok_or(PhysicsError::StaleBody)?;
        if translation == [0.; 3] {
            return Ok((None, 0));
        }
        let translation = rp::Vector::from(translation);
        let options = rapier3d::parry::query::ShapeCastOptions {
            max_time_of_impact: 1.,
            target_distance: 0.,
            stop_at_penetration: false,
            compute_impact_geometry_on_penetration: true,
        };
        let mut closest: Option<(SweepHit, ColliderId)> = None;
        let mut candidates = 0u32;
        for &source_id in rigid.colliders() {
            let collider = &self.backend.colliders[source_id];
            if !collider.is_enabled() || collider.is_sensor() {
                continue;
            }
            // Borrow the existing SharedShape; neither fixtures nor query meshes are rebuilt.
            let shape = collider.shape();
            let mut pose = *collider.position();
            pose.translation += rp::Vector::from(offset);
            let groups = collider.collision_groups();
            let filter = QueryFilter {
                category: groups.memberships.bits(),
                mask: groups.filter.bits() & solid_mask,
                exclude_body: Some(body),
                ..Default::default()
            };
            let enabled = |_, c: &rp::Collider| {
                self.query_allows(c, &filter)
                    && self
                        .contact_policies
                        .pair_allows(Some(native_body), c.parent())
            };
            let pipeline = self
                .backend
                .query_pipeline_with_filter(self.query_filter(&filter)?.predicate(&enabled));
            let bounds = shape.compute_aabb(&pose);
            let bounds = bounds.merged(&bounds.translated(translation));
            for (id, target) in pipeline.intersect_aabb_conservative(bounds) {
                candidates = candidates.saturating_add(1);
                let Some(hit) = rapier3d::parry::query::cast_shapes(
                    target.position(),
                    rp::Vector::ZERO,
                    target.shape(),
                    &pose,
                    translation,
                    shape,
                    options,
                )
                .map_err(|_| PhysicsError::UnsupportedShape)?
                else {
                    continue;
                };
                let target_ref = collider_ref(id, target).ok_or(PhysicsError::StaleCollider)?;
                let source_id = collider_id(source_id);
                if closest.as_ref().is_some_and(|(old, old_source)| {
                    old.fraction < hit.time_of_impact
                        || (old.fraction == hit.time_of_impact
                            && (old.target.collider, *old_source)
                                <= (target_ref.collider, source_id))
                }) {
                    continue;
                }
                closest = Some((
                    SweepHit {
                        target: target_ref,
                        fraction: hit.time_of_impact,
                        point: (target.position() * hit.witness1).to_array(),
                        normal: (target.position().rotation * hit.normal1).to_array(),
                        initial_overlap: hit.time_of_impact == 0.,
                    },
                    source_id,
                ));
            }
        }
        Ok((closest.map(|(hit, _)| hit), candidates))
    }

    pub(crate) fn planar_navigation_destination_is_clear(
        &mut self,
        body: BodyId,
        offset: [f32; 3],
        span: Option<PlanarCollisionSpan>,
        solid_mask: u32,
    ) -> Result<(bool, u32), PhysicsError> {
        self.validate_planar_collision_span(span)?;
        if !valid_vector(&offset) || offset[2] != 0. {
            return Err(PhysicsError::InvalidQuery);
        }
        self.refresh_queries();
        self.validate_planar_controller_source(body)?;
        let id = native_id(body);
        let rigid = self.backend.bodies.get(id).ok_or(PhysicsError::StaleBody)?;
        let mut candidates = 0u32;
        for &source in rigid.colliders() {
            let collider = &self.backend.colliders[source];
            if !collider.is_enabled() || collider.is_sensor() {
                continue;
            }
            let shape = collider.shape();
            let mut pose = *collider.position();
            pose.translation += rp::Vector::from(offset);
            let groups = collider.collision_groups();
            let filter = QueryFilter {
                category: groups.memberships.bits(),
                mask: groups.filter.bits() & solid_mask,
                exclude_body: Some(body),
                ..Default::default()
            };
            let enabled = |_, target: &rp::Collider| {
                self.query_allows(target, &filter)
                    && self
                        .contact_policies
                        .pair_span_allows(span, target.parent())
            };
            let pipeline = self
                .backend
                .query_pipeline_with_filter(self.query_filter(&filter)?.predicate(&enabled));
            for (_, target) in pipeline.intersect_aabb_conservative(shape.compute_aabb(&pose)) {
                candidates = candidates.saturating_add(1);
                if rapier3d::parry::query::contact(
                    &pose,
                    shape,
                    target.position(),
                    target.shape(),
                    0.,
                )
                .map_err(|_| PhysicsError::UnsupportedShape)?
                .is_some_and(|c| c.dist < -1e-5 * self.config.length_unit)
                {
                    return Ok((false, candidates));
                }
            }
        }
        Ok((true, candidates))
    }
}

#[cfg(test)]
#[path = "planar_navigation_tests.rs"]
mod tests;
