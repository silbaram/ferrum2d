//! Read-only planar controller casts with one-way and carry exclusions.
use super::super::events::collider_id;
use super::*;
use crate::physics::KINEMATIC_EPSILON;
use rapier3d::parry::bounding_volume::BoundingVolume;

struct PlatformerCastFilter {
    solid_mask: u32,
    one_way_mask: u32,
    ignored: Option<BodyId>,
    ground_only: bool,
}

impl PhysicsWorld3d {
    /// Casts every active solid convex fixture at a speculative XY offset.
    /// One-way fixtures only stop downward motion that starts above their top.
    /// This changes query caches only, never body state, clock or queued input.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn sweep_planar_platformer(
        &mut self,
        source: BodyId,
        offset: [f32; 3],
        translation: [f32; 3],
        solid_mask: u32,
        one_way_mask: u32,
        ignored: Option<BodyId>,
    ) -> Result<(Option<SweepHit>, u32), PhysicsError> {
        self.sweep_planar_platformer_filtered(
            source,
            offset,
            translation,
            PlatformerCastFilter {
                solid_mask,
                one_way_mask,
                ignored,
                ground_only: false,
            },
        )
    }

    /// Probes downward while selecting only supporting normals. Side contacts
    /// cannot hide a farther floor in the closest-hit reduction.
    pub(crate) fn probe_planar_platformer_ground(
        &mut self,
        source: BodyId,
        offset: [f32; 3],
        probe_distance: f32,
        solid_mask: u32,
        one_way_mask: u32,
        ignored: Option<BodyId>,
    ) -> Result<(Option<SweepHit>, u32), PhysicsError> {
        if !probe_distance.is_finite() || probe_distance < 0. {
            return Err(PhysicsError::InvalidQuery);
        }
        self.sweep_planar_platformer_filtered(
            source,
            offset,
            [0., probe_distance, 0.],
            PlatformerCastFilter {
                solid_mask,
                one_way_mask,
                ignored,
                ground_only: true,
            },
        )
    }

    fn sweep_planar_platformer_filtered(
        &mut self,
        source: BodyId,
        offset: [f32; 3],
        translation: [f32; 3],
        filter: PlatformerCastFilter,
    ) -> Result<(Option<SweepHit>, u32), PhysicsError> {
        let PlatformerCastFilter {
            solid_mask,
            one_way_mask,
            ignored,
            ground_only,
        } = filter;
        if self.config.space != super::super::Space::PlanarXy
            || !valid_vector(&offset)
            || !valid_vector(&translation)
            || offset[2] != 0.
            || translation[2] != 0.
        {
            return Err(PhysicsError::InvalidQuery);
        }
        self.validate_planar_controller_source(source)?;
        if ignored.is_some_and(|id| !self.backend.bodies.contains(native_id(id))) {
            return Err(PhysicsError::StaleBody);
        }
        self.refresh_queries();
        if translation == [0.; 3] {
            return Ok((None, 0));
        }
        let source_handle = native_id(source);
        let ignored_handle = ignored.map(native_id);
        let body = self
            .backend
            .bodies
            .get(source_handle)
            .ok_or(PhysicsError::StaleBody)?;
        let options = rapier3d::parry::query::ShapeCastOptions {
            max_time_of_impact: 1.,
            target_distance: 0.,
            stop_at_penetration: true,
            compute_impact_geometry_on_penetration: true,
        };
        let motion = rp::Vector::from(translation);
        let tolerance = 1e-5 * self.config.length_unit;
        let mut closest: Option<(SweepHit, ColliderId)> = None;
        let mut candidates = 0u32;
        for &source_id in body.colliders() {
            let moving = &self.backend.colliders[source_id];
            if !moving.is_enabled() || moving.is_sensor() {
                continue;
            }
            let shape = moving.shape();
            let mut pose = *moving.position();
            pose.translation += rp::Vector::from(offset);
            let source_bounds = shape.compute_aabb(&pose);
            let swept_bounds = source_bounds.merged(&source_bounds.translated(motion));
            let groups = moving.collision_groups();
            let filter = QueryFilter {
                category: groups.memberships.bits(),
                mask: groups.filter.bits() & solid_mask,
                exclude_body: Some(source),
                ..Default::default()
            };
            let enabled = |_, target: &rp::Collider| {
                self.query_allows(target, &filter)
                    && (ignored_handle.is_none() || target.parent() != ignored_handle)
                    && self
                        .contact_policies
                        .pair_allows(Some(source_handle), target.parent())
            };
            let pipeline = self
                .backend
                .query_pipeline_with_filter(self.query_filter(&filter)?.predicate(&enabled));
            for (target_id, target) in pipeline.intersect_aabb_conservative(swept_bounds) {
                candidates = candidates.saturating_add(1);
                let one_way = target.collision_groups().memberships.bits() & one_way_mask != 0;
                if one_way
                    && (translation[1] <= KINEMATIC_EPSILON
                        || source_bounds.maxs.y > target.compute_aabb().mins.y + KINEMATIC_EPSILON)
                {
                    continue;
                }
                let target_bounds = target.compute_aabb();
                let boxes_are_axis_aligned = shape.as_cuboid().is_some()
                    && target.shape().as_cuboid().is_some()
                    && axis_aligned_planar_rotation(pose.rotation.to_array())
                    && axis_aligned_planar_rotation(target.position().rotation.to_array())
                    && source_bounds.maxs.z.min(target_bounds.maxs.z)
                        > source_bounds.mins.z.max(target_bounds.mins.z);
                let hit = if boxes_are_axis_aligned {
                    // Use the actual native cuboid poses/bounds. GJK can turn an
                    // exact floor touch into a positive TOI at large aspect ratios.
                    // f64 slab arithmetic keeps these aligned native primitives exact.
                    axis_aligned_box_cast(
                        [
                            source_bounds.mins.x,
                            source_bounds.mins.y,
                            source_bounds.maxs.x,
                            source_bounds.maxs.y,
                        ],
                        [
                            target_bounds.mins.x,
                            target_bounds.mins.y,
                            target_bounds.maxs.x,
                            target_bounds.maxs.y,
                        ],
                        translation,
                        (source_bounds.mins.z.max(target_bounds.mins.z)
                            + source_bounds.maxs.z.min(target_bounds.maxs.z))
                            * 0.5,
                    )
                } else {
                    rapier3d::parry::query::cast_shapes(
                        target.position(),
                        rp::Vector::ZERO,
                        target.shape(),
                        &pose,
                        motion,
                        shape,
                        options,
                    )
                    .map_err(|_| PhysicsError::UnsupportedShape)?
                    .map(|hit| PlatformerGeometryHit {
                        fraction: hit.time_of_impact,
                        normal: (target.position().rotation * hit.normal1).to_array(),
                        point: (target.position() * hit.witness1).to_array(),
                        contact_distance: None,
                    })
                };
                let Some(hit) = hit else {
                    continue;
                };
                let normal = hit.normal;
                let point = hit.point;
                if !hit.fraction.is_finite()
                    || !(0. ..=1.).contains(&hit.fraction)
                    || !normal.iter().chain(&point).all(|v| v.is_finite())
                {
                    return Err(PhysicsError::InvalidQuery);
                }
                if (one_way || ground_only) && normal[1] > -0.5 {
                    continue;
                }
                let dot = normal
                    .iter()
                    .zip(translation)
                    .map(|(n, d)| n * d)
                    .sum::<f32>();
                if hit.fraction == 0. && dot >= 0. {
                    // A floor tangent must not block horizontal travel, and an
                    // existing contact must not catch a jump moving away from it.
                    let distance = if let Some(distance) = hit.contact_distance {
                        Some(distance)
                    } else {
                        rapier3d::parry::query::contact(
                            target.position(),
                            target.shape(),
                            &pose,
                            shape,
                            tolerance,
                        )
                        .map_err(|_| PhysicsError::UnsupportedShape)?
                        .map(|c| c.dist)
                    };
                    if distance.is_some_and(|distance| distance >= -tolerance) {
                        continue;
                    }
                }
                let target_ref =
                    collider_ref(target_id, target).ok_or(PhysicsError::StaleCollider)?;
                let source_id = collider_id(source_id);
                if closest.as_ref().is_some_and(|(old, old_source)| {
                    old.fraction < hit.fraction
                        || (old.fraction == hit.fraction
                            && (old.target.collider, *old_source)
                                <= (target_ref.collider, source_id))
                }) {
                    continue;
                }
                closest = Some((
                    SweepHit {
                        target: target_ref,
                        fraction: hit.fraction,
                        point,
                        normal,
                        initial_overlap: hit.fraction == 0.,
                    },
                    source_id,
                ));
            }
        }
        Ok((closest.map(|(hit, _)| hit), candidates))
    }

    /// Unions active solid native fixture bounds at an XY offset, including fixed
    /// platform bodies. Empty and disabled bodies are rejected.
    pub(crate) fn planar_platformer_bounds(
        &mut self,
        body: BodyId,
        offset: [f32; 3],
    ) -> Result<[f32; 4], PhysicsError> {
        if self.config.space != super::super::Space::PlanarXy
            || !valid_vector(&offset)
            || offset[2] != 0.
        {
            return Err(PhysicsError::InvalidQuery);
        }
        self.refresh_queries();
        let body = self
            .backend
            .bodies
            .get(native_id(body))
            .ok_or(PhysicsError::StaleBody)?;
        if !body.is_enabled() {
            return Err(PhysicsError::WrongBodyKind);
        }
        let mut union: Option<[f32; 4]> = None;
        for &id in body.colliders() {
            let collider = &self.backend.colliders[id];
            if !collider.is_enabled() || collider.is_sensor() {
                continue;
            }
            let mut pose = *collider.position();
            pose.translation += rp::Vector::from(offset);
            let bounds = collider.shape().compute_aabb(&pose);
            let next = [bounds.mins.x, bounds.mins.y, bounds.maxs.x, bounds.maxs.y];
            if !next.iter().all(|v| v.is_finite()) {
                return Err(PhysicsError::InvalidQuery);
            }
            union = Some(union.map_or(next, |old| {
                [
                    old[0].min(next[0]),
                    old[1].min(next[1]),
                    old[2].max(next[2]),
                    old[3].max(next[3]),
                ]
            }));
        }
        union.ok_or(PhysicsError::UnsupportedShape)
    }
}

struct PlatformerGeometryHit {
    fraction: f32,
    point: [f32; 3],
    normal: [f32; 3],
    contact_distance: Option<f32>,
}

// Exact identity/half-turn quaternions only. Real small rotations and quarter-turn
// rounding continue through the native convex cast instead of an enclosing AABB.
fn axis_aligned_planar_rotation(q: [f32; 4]) -> bool {
    q[0] == 0. && q[1] == 0. && (q[2] == 0. || q[3] == 0.)
}

fn axis_aligned_box_cast(
    source: [f32; 4],
    target: [f32; 4],
    motion: [f32; 3],
    witness_z: f32,
) -> Option<PlatformerGeometryHit> {
    let s = source.map(f64::from);
    let t = target.map(f64::from);
    let d = [f64::from(motion[0]), f64::from(motion[1])];
    let overlap = [
        s[2].min(t[2]) - s[0].max(t[0]),
        s[3].min(t[3]) - s[1].max(t[1]),
    ];
    let (fraction, normal, contact_distance) = if overlap[0] > 0. && overlap[1] > 0. {
        let depths = [
            (s[2] - t[0]).min(t[2] - s[0]),
            (s[3] - t[1]).min(t[3] - s[1]),
        ];
        let axis = usize::from(depths[1] <= depths[0]);
        let mut normal = [0.; 3];
        normal[axis] = if s[axis] + s[axis + 2] <= t[axis] + t[axis + 2] {
            -1.
        } else {
            1.
        };
        (0., normal, Some(-depths[axis] as f32))
    } else {
        let mut entry = [f64::NEG_INFINITY; 2];
        let mut exit = [f64::INFINITY; 2];
        for axis in 0..2 {
            if d[axis] == 0. {
                // Tangency in a stationary axis is a slide, not entry into volume.
                if s[axis + 2] <= t[axis] || s[axis] >= t[axis + 2] {
                    return None;
                }
            } else {
                let a = (t[axis] - s[axis + 2]) / d[axis];
                let b = (t[axis + 2] - s[axis]) / d[axis];
                entry[axis] = a.min(b);
                exit[axis] = a.max(b);
            }
        }
        let first = entry[0].max(entry[1]);
        let last = exit[0].min(exit[1]);
        if !(0. ..=1.).contains(&first) || first > last || last <= 0. {
            return None;
        }
        let axis = usize::from(entry[1] >= entry[0]);
        let mut normal = [0.; 3];
        normal[axis] = if d[axis] > 0. { -1. } else { 1. };
        (first as f32, normal, (first == 0.).then_some(0.))
    };
    let center = [
        (s[0] + s[2]) * 0.5 + d[0] * f64::from(fraction),
        (s[1] + s[3]) * 0.5 + d[1] * f64::from(fraction),
    ];
    let mut point = [
        center[0].clamp(t[0], t[2]) as f32,
        center[1].clamp(t[1], t[3]) as f32,
        witness_z,
    ];
    if normal[0] != 0. {
        point[0] = if normal[0] < 0. { target[0] } else { target[2] };
    }
    if normal[1] != 0. {
        point[1] = if normal[1] < 0. { target[1] } else { target[3] };
    }
    Some(PlatformerGeometryHit {
        fraction,
        point,
        normal,
        contact_distance,
    })
}

#[cfg(test)]
#[path = "planar_platformer_tests.rs"]
mod tests;
