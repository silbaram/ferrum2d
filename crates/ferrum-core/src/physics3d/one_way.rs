//! One-way terrain response; inspection and projectile sensors remain two-sided.
use super::colliders::native_collider;
use super::contact_policy::ContactPolicies;
use super::events::collider_id;
use super::{ColliderId, PhysicsError, PhysicsWorld3d};
use rapier3d::prelude as rp;

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct TerrainOneWay {
    pub point: [f32; 3],
    pub normal: [f32; 3],
}

#[derive(Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct OneWay {
    plane: TerrainOneWay,
    margin: f32,
}

impl ContactPolicies {
    pub(super) fn one_way_allows(
        &self,
        platform: rp::ColliderHandle,
        p: &rp::Collider,
        shape: &dyn rapier3d::parry::shape::Shape,
        pose: &rp::Pose,
    ) -> bool {
        self.one_way_allows_at(platform, p.position(), shape, pose)
    }

    /// Whether `platform` carries a one-way rule (pose-dependent admission).
    pub(super) fn has_one_way(&self, platform: rp::ColliderHandle) -> bool {
        self.one_way.contains_key(&collider_id(platform))
    }

    pub(super) fn one_way_allows_at(
        &self,
        platform: rp::ColliderHandle,
        platform_pose: &rp::Pose,
        shape: &dyn rapier3d::parry::shape::Shape,
        pose: &rp::Pose,
    ) -> bool {
        let Some(rule) = self.one_way.get(&collider_id(platform)) else {
            return true;
        };
        let normal = platform_pose.rotation * rp::Vector::from(rule.plane.normal);
        let point = *platform_pose * rp::Vector::from(rule.plane.point);
        let bottom = minimum_projection(shape, pose, normal);
        bottom >= normal.dot(point) - rule.margin
    }

    pub(super) fn one_way_pair_allows(&self, c: &rp::PairFilterContext) -> bool {
        let a = &c.colliders[c.collider1];
        let b = &c.colliders[c.collider2];
        self.one_way_allows(c.collider1, a, b.shape(), b.position())
            && self.one_way_allows(c.collider2, b, a.shape(), a.position())
    }
}

impl PhysicsWorld3d {
    pub(crate) fn set_terrain_one_way(
        &mut self,
        id: ColliderId,
        plane: Option<TerrainOneWay>,
    ) -> Result<(), PhysicsError> {
        if plane.is_some_and(|p| {
            !p.point.iter().all(|v| v.is_finite() && v.abs() <= 1e6)
                || !p.normal.iter().all(|v| v.is_finite())
                || (rp::Vector::from(p.normal).length_squared() - 1.0).abs() > 1e-4
        }) {
            return Err(PhysicsError::InvalidCollider);
        }
        let owner = self.collider_owner(id)?;
        if let Some(plane) = plane {
            self.contact_policies.one_way.insert(
                id,
                OneWay {
                    plane,
                    margin: 0.01 * self.config.length_unit,
                },
            );
        } else {
            self.contact_policies.one_way.remove(&id);
        }
        if let Some(c) = self.backend.colliders.get_mut(native_collider(id)) {
            c.set_active_hooks(self.contact_policies.flags(owner.body, id));
            c.set_position(*c.position());
        }
        self.invalidate_character_support(None, Some(id));
        Ok(())
    }
}

// Exact convex/compound support avoids the overly low AABB corner of a sphere on
// a ramp. The fallback is only for nonconvex mesh/heightfield counterpart geometry.
fn minimum_projection(
    shape: &dyn rapier3d::parry::shape::Shape,
    pose: &rp::Pose,
    normal: rp::Vector,
) -> f32 {
    if let Some(support) = shape.as_support_map() {
        return normal.dot(support.support_point(pose, -normal));
    }
    if let Some(compound) = shape.as_compound() {
        return compound
            .shapes()
            .iter()
            .map(|(part_pose, part)| {
                minimum_projection(part.as_ref(), &(*pose * *part_pose), normal)
            })
            .fold(f32::INFINITY, f32::min);
    }
    let bounds = shape.compute_aabb(pose);
    normal.dot(bounds.center()) - normal.abs().dot(bounds.half_extents())
}

impl OneWay {
    /// Saved historical plane; no current-world comparison or normalization.
    pub(super) fn saved_controller_plane_valid(&self) -> bool {
        self.plane
            .point
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1e6)
            && self.plane.normal.iter().all(|v| v.is_finite())
            && (rp::Vector::from(self.plane.normal).length_squared() - 1.).abs() <= 1e-4
            && self.margin.is_finite()
            && self.margin >= 0.
    }
}

#[cfg(test)]
mod controller_admission_tests {
    use super::*;
    #[test]
    fn controller_admission_saved_one_way_plane_and_margin_keep_exact_wire() {
        let source = OneWay {
            plane: TerrainOneWay {
                point: [-1., 0., 2.],
                normal: [0., 1., 0.],
            },
            margin: 0.01,
        };
        let original = crate::checkpoint_codec::encode(&source).unwrap();
        for case in 0..4 {
            let mut c = source;
            match case {
                0 => c.plane.point[0] = f32::NAN,
                1 => c.plane.normal = [0.; 3],
                2 => c.margin = -1.,
                _ => c.margin = f32::INFINITY,
            }
            let bytes = crate::checkpoint_codec::encode(&c).unwrap();
            let candidate: OneWay = crate::checkpoint_codec::decode(&bytes).unwrap();
            assert!(!candidate.saved_controller_plane_valid());
            assert_eq!(crate::checkpoint_codec::encode(&candidate).unwrap(), bytes);
        }
        assert!(source.saved_controller_plane_valid());
        assert_eq!(crate::checkpoint_codec::encode(&source).unwrap(), original);
    }
}
