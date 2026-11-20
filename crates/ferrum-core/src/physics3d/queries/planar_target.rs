//! Exact planar casts against one selected body; callers own target priority.
use super::super::events::collider_id;
use super::*;

impl PhysicsWorld3d {
    /// Sweeps each active solid source fixture against one selected body's solids.
    /// Target velocity is intentionally ignored. A stationary cast reports current
    /// contact geometry, and ties use target then source fixture identity.
    /// Does not advance simulation or consume queued input.
    pub(crate) fn sweep_planar_body_against(
        &mut self,
        source: BodyId,
        target: BodyId,
        translation: [f32; 3],
    ) -> Result<Option<SweepHit>, PhysicsError> {
        if self.config.space != super::super::Space::PlanarXy
            || !valid_vector(&translation)
            || translation[2] != 0.
        {
            return Err(PhysicsError::InvalidQuery);
        }
        self.validate_planar_controller_source(source)?;
        let source_handle = native_id(source);
        let target_handle = native_id(target);
        let target_body = self
            .backend
            .bodies
            .get(target_handle)
            .ok_or(PhysicsError::StaleBody)?;
        if source == target
            || !target_body.is_enabled()
            || !self
                .contact_policies
                .pair_allows(Some(source_handle), Some(target_handle))
        {
            return Ok(None);
        }
        self.refresh_queries();
        let source_body = self
            .backend
            .bodies
            .get(source_handle)
            .ok_or(PhysicsError::StaleBody)?;
        let target_body = self
            .backend
            .bodies
            .get(target_handle)
            .ok_or(PhysicsError::StaleBody)?;
        let options = rapier3d::parry::query::ShapeCastOptions {
            max_time_of_impact: 1.,
            target_distance: 0.,
            stop_at_penetration: true,
            compute_impact_geometry_on_penetration: true,
        };
        let motion = rp::Vector::from(translation);
        let mut closest: Option<(SweepHit, ColliderId)> = None;
        for &source_id in source_body.colliders() {
            let moving = &self.backend.colliders[source_id];
            if !moving.is_enabled() || moving.is_sensor() {
                continue;
            }
            for &target_id in target_body.colliders() {
                let fixed = &self.backend.colliders[target_id];
                if !fixed.is_enabled()
                    || fixed.is_sensor()
                    || !moving.collision_groups().test(fixed.collision_groups())
                {
                    continue;
                }
                let target_ref =
                    collider_ref(target_id, fixed).ok_or(PhysicsError::StaleCollider)?;
                let hit = if translation == [0.; 3] {
                    rapier3d::parry::query::contact(
                        fixed.position(),
                        fixed.shape(),
                        moving.position(),
                        moving.shape(),
                        0.,
                    )
                    .map_err(|_| PhysicsError::UnsupportedShape)?
                    .map(|contact| SweepHit {
                        target: target_ref,
                        fraction: 0.,
                        point: contact.point1.to_array(),
                        normal: contact.normal1.to_array(),
                        initial_overlap: true,
                    })
                } else {
                    rapier3d::parry::query::cast_shapes(
                        fixed.position(),
                        rp::Vector::ZERO,
                        fixed.shape(),
                        moving.position(),
                        motion,
                        moving.shape(),
                        options,
                    )
                    .map_err(|_| PhysicsError::UnsupportedShape)?
                    .map(|hit| SweepHit {
                        target: target_ref,
                        fraction: hit.time_of_impact,
                        point: (fixed.position() * hit.witness1).to_array(),
                        normal: (fixed.position().rotation * hit.normal1).to_array(),
                        initial_overlap: hit.time_of_impact == 0.,
                    })
                };
                let Some(hit) = hit else {
                    continue;
                };
                if !hit.fraction.is_finite()
                    || !(0. ..=1.).contains(&hit.fraction)
                    || !hit.point.iter().chain(&hit.normal).all(|v| v.is_finite())
                {
                    return Err(PhysicsError::InvalidQuery);
                }
                if hit.fraction == 0.
                    && hit
                        .normal
                        .iter()
                        .zip(translation)
                        .map(|(n, d)| n * d)
                        .sum::<f32>()
                        > 0.
                {
                    // A completed bounce leaves the mover on the surface. Allow
                    // departure through a length-scaled contact rounding band;
                    // genuine initial penetration still reports an immediate hit.
                    let tolerance = 1e-5 * self.config.length_unit;
                    let contact = rapier3d::parry::query::contact(
                        fixed.position(),
                        fixed.shape(),
                        moving.position(),
                        moving.shape(),
                        tolerance,
                    )
                    .map_err(|_| PhysicsError::UnsupportedShape)?;
                    if contact.is_some_and(|contact| contact.dist >= -tolerance) {
                        continue;
                    }
                }
                let source_id = collider_id(source_id);
                if closest.as_ref().is_some_and(|(old, old_source)| {
                    old.fraction < hit.fraction
                        || (old.fraction == hit.fraction
                            && (old.target.collider, *old_source)
                                <= (hit.target.collider, source_id))
                }) {
                    continue;
                }
                closest = Some((hit, source_id));
            }
        }
        Ok(closest.map(|(hit, _)| hit))
    }
}

#[cfg(test)]
#[path = "planar_target_tests.rs"]
mod tests;
