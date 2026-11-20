//! Immediate geometric contacts, separate from the last simulation tick's lifecycle.
use super::events::{collider_id, collider_ref};
use super::{ColliderRef, PhysicsError, PhysicsWorld3d};
use rapier3d::parry::query::{
    ContactManifold as NativeManifold, DefaultQueryDispatcher, PersistentQueryDispatcher,
};
use rapier3d::prelude as rp;

/// Two surface witnesses belonging to one current geometric contact.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ContactPoint {
    /// World-space surface point on the first collider's subshape.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub first: [f32; 3],
    /// World-space surface point on the second collider's subshape.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub second: [f32; 3],
    /// Nonnegative overlap along the manifold normal, in engine units.
    pub penetration: f32,
}

/// Current geometric contact patch between two collider subshapes.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ContactManifold {
    /// First participant, oriented by the requested category masks.
    pub first: ColliderRef,
    /// Second participant.
    pub second: ColliderRef,
    /// Native geometry subshape index within the first collider (zero for convex shapes).
    pub first_subshape: u32,
    /// Native geometry subshape index within the second collider.
    pub second_subshape: u32,
    /// World-space unit normal pointing out of the first shape toward the second.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub normal: [f32; 3],
    /// Touching or penetrating surface witnesses. No positive-distance predictions.
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub points: Vec<ContactPoint>,
}

impl PhysicsWorld3d {
    /// Replaces `out` with current geometric contact patches, without stepping physics.
    ///
    /// Both collision masks and logical planar spans must allow the pair. Sensors are
    /// optional. Fixed-fixed geometry is included; joint exclusions and simulation
    /// collision-type selection do not apply to this geometry query. Matching is
    /// (first in category_a, second in category_b), reversed if needed. Ambiguous pairs
    /// use ascending collider identity. Results sort by collider/subshape identities.
    ///
    /// Direct edits are refreshed without consuming forces, kinematic targets or events.
    /// Output and temporary storage scale with all intersecting collider/subshape pairs;
    /// `max_events` does not cap this explicit query. Unsupported shape pairs clear output
    /// and return an error. Geometric points carry no solver impulses.
    pub fn query_contact_manifolds(
        &mut self,
        category_a: u32,
        category_b: u32,
        include_sensors: bool,
        out: &mut Vec<ContactManifold>,
    ) -> Result<(), PhysicsError> {
        self.refresh_queries();
        out.clear();
        if category_a == 0 || category_b == 0 {
            return Ok(());
        }
        let mut manifolds: Vec<NativeManifold<(), ()>> = Vec::new();
        let pipeline = self
            .backend
            .query_pipeline_with_filter(rp::QueryFilter::default());
        for (a_id, a) in self.backend.colliders.iter() {
            if !enabled(self, a) || (!include_sensors && a.is_sensor()) {
                continue;
            }
            let a_bits = a.collision_groups().memberships.bits();
            if a_bits & (category_a | category_b) == 0 {
                continue;
            }
            for (b_id, b) in pipeline.intersect_aabb_conservative(a.compute_aabb()) {
                if collider_id(a_id) >= collider_id(b_id)
                    || a.parent() == b.parent()
                    || !enabled(self, b)
                    || (!include_sensors && b.is_sensor())
                    || !a.collision_groups().test(b.collision_groups())
                    || !self.contact_policies.pair_allows(a.parent(), b.parent())
                {
                    continue;
                }
                let b_bits = b.collision_groups().memberships.bits();
                let (a_id, a, b_id, b) = if a_bits & category_a != 0 && b_bits & category_b != 0 {
                    (a_id, a, b_id, b)
                } else if b_bits & category_a != 0 && a_bits & category_b != 0 {
                    (b_id, b, a_id, a)
                } else {
                    continue;
                };
                let (Some(first), Some(second)) = (collider_ref(a_id, a), collider_ref(b_id, b))
                else {
                    continue;
                };
                // Different collider pairs cannot share persistent contact features or
                // composite subshape workspaces. The outer scratch vector is reusable.
                manifolds.clear();
                if DefaultQueryDispatcher
                    .contact_manifolds(
                        &a.position().inv_mul(b.position()),
                        a.shape(),
                        b.shape(),
                        0.0,
                        &mut manifolds,
                        &mut None,
                    )
                    .is_err()
                {
                    out.clear();
                    return Err(PhysicsError::UnsupportedShape);
                }
                for manifold in &manifolds {
                    let a_pose = manifold
                        .subshape_pos1()
                        .map_or(*a.position(), |p| a.position() * p);
                    let b_pose = manifold
                        .subshape_pos2()
                        .map_or(*b.position(), |p| b.position() * p);
                    let points: Vec<_> = manifold
                        .points
                        .iter()
                        .filter(|p| p.dist <= 0.0)
                        .map(|p| ContactPoint {
                            first: (a_pose * p.local_p1).to_array(),
                            second: (b_pose * p.local_p2).to_array(),
                            penetration: -p.dist,
                        })
                        .collect();
                    if !points.is_empty() {
                        out.push(ContactManifold {
                            first,
                            second,
                            first_subshape: manifold.subshape1,
                            second_subshape: manifold.subshape2,
                            normal: (a_pose.rotation * manifold.local_n1).to_array(),
                            points,
                        });
                    }
                }
            }
        }
        out.sort_unstable_by_key(|m| {
            (
                m.first.collider,
                m.second.collider,
                m.first_subshape,
                m.second_subshape,
            )
        });
        Ok(())
    }
}

fn enabled(world: &PhysicsWorld3d, collider: &rp::Collider) -> bool {
    collider.is_enabled()
        && collider.parent().is_some_and(|id| {
            world
                .backend
                .bodies
                .get(id)
                .is_some_and(|body| body.is_enabled())
        })
}
