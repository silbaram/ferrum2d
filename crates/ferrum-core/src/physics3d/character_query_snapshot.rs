//! Exact query inputs for a suspended character search. A collider generation and
//! checked shape revision identify geometry without retaining meshes or Arc addresses.
//! These private records belong to their accompanying native world checkpoint.
use super::events::collider_id;
use super::world::native_id;
use super::{BodyId, CharacterConfig, PhysicsError, PhysicsWorld3d, PlanarCollisionSpan, Pose};
use rapier3d::prelude as rp;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct CharacterQuerySnapshot {
    body: BodyId,
    config: CharacterConfig,
    pose: Pose,
    colliders: Vec<Collider>,
    fixed_only: bool,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct FixedQuerySnapshot {
    colliders: Vec<Collider>,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Collider {
    id: rp::ColliderHandle,
    parent: Option<rp::RigidBodyHandle>,
    pose: rp::Pose,
    shape_revision: u64,
    enabled: bool,
    sensor: bool,
    groups: rp::InteractionGroups,
    span: Option<PlanarCollisionSpan>,
    one_way: Option<super::one_way::OneWay>,
}

impl PhysicsWorld3d {
    fn route_snapshot_includes(&self, c: &rp::Collider, source: BodyId, fixed_only: bool) -> bool {
        !fixed_only
            || c.parent() == Some(native_id(source))
            || c.parent()
                .is_none_or(|p| self.backend.bodies.get(p).is_some_and(|b| b.is_fixed()))
    }

    fn query_collider_pose(&self, collider: &rp::Collider) -> rp::Pose {
        collider
            .parent()
            .and_then(|parent| {
                self.backend
                    .bodies
                    .get(parent)
                    .zip(collider.position_wrt_parent())
            })
            .map_or(*collider.position(), |(body, local)| {
                *body.position() * *local
            })
    }
    fn query_collider_enabled(&self, collider: &rp::Collider) -> bool {
        collider.is_enabled()
            && collider
                .parent()
                .is_none_or(|p| self.backend.bodies.get(p).is_some_and(|b| b.is_enabled()))
    }
    fn query_collider_span(&self, collider: &rp::Collider) -> Option<PlanarCollisionSpan> {
        collider.parent().and_then(|p| {
            let (slot, generation) = p.into_raw_parts();
            self.contact_policies
                .spans
                .get(&BodyId { slot, generation })
                .copied()
        })
    }
    fn query_snapshot_collider(&self, id: rp::ColliderHandle, c: &rp::Collider) -> Collider {
        Collider {
            id,
            parent: c.parent(),
            pose: self.query_collider_pose(c),
            shape_revision: self
                .collider_shape_revisions
                .get(&collider_id(id))
                .copied()
                .unwrap_or(0),
            enabled: self.query_collider_enabled(c),
            sensor: c.is_sensor(),
            groups: c.collision_groups(),
            span: self.query_collider_span(c),
            one_way: self.contact_policies.one_way.get(&collider_id(id)).copied(),
        }
    }
    fn query_snapshot_collider_matches(&self, saved: &Collider) -> bool {
        self.backend.colliders.get(saved.id).is_some_and(|c| {
            c.parent() == saved.parent
                && self.query_collider_pose(c) == saved.pose
                && self
                    .collider_shape_revisions
                    .get(&collider_id(saved.id))
                    .copied()
                    .unwrap_or(0)
                    == saved.shape_revision
                && self.query_collider_enabled(c) == saved.enabled
                && c.is_sensor() == saved.sensor
                && c.collision_groups() == saved.groups
                && self.query_collider_span(c) == saved.span
                && self
                    .contact_policies
                    .one_way
                    .get(&collider_id(saved.id))
                    .copied()
                    == saved.one_way
        })
    }
    fn fixed_query_collider(&self, c: &rp::Collider) -> bool {
        c.parent()
            .is_none_or(|p| self.backend.bodies.get(p).is_some_and(|b| b.is_fixed()))
    }
    pub(crate) fn capture_fixed_query_snapshot(&self) -> FixedQuerySnapshot {
        FixedQuerySnapshot {
            colliders: self
                .backend
                .colliders
                .iter()
                .filter(|(_, c)| self.fixed_query_collider(c))
                .map(|(id, c)| self.query_snapshot_collider(id, c))
                .collect(),
        }
    }
    pub(crate) fn fixed_query_snapshot_matches(&self, snapshot: &FixedQuerySnapshot) -> bool {
        self.backend
            .colliders
            .iter()
            .filter(|(_, c)| self.fixed_query_collider(c))
            .count()
            == snapshot.colliders.len()
            && snapshot.colliders.iter().all(|c| {
                self.backend
                    .colliders
                    .get(c.id)
                    .is_some_and(|now| self.fixed_query_collider(now))
                    && self.query_snapshot_collider_matches(c)
            })
    }
    /// Captures native inputs only after the caller has admitted collider-count work.
    pub(crate) fn capture_character_query_snapshot(
        &self,
        body: BodyId,
        fixed_only: bool,
    ) -> Result<CharacterQuerySnapshot, PhysicsError> {
        let config = self.character_config(body)?.clone();
        let pose = self.body_state(body)?.pose;
        let colliders = self
            .backend
            .colliders
            .iter()
            .filter(|(_, c)| self.route_snapshot_includes(c, body, fixed_only))
            .map(|(id, c)| self.query_snapshot_collider(id, c))
            .collect();
        Ok(CharacterQuerySnapshot {
            body,
            config,
            pose,
            colliders,
            fixed_only,
        })
    }
    /// No allocation; an edit cancels a suspended search before it uses old edges.
    pub(crate) fn character_query_snapshot_matches(
        &self,
        snapshot: &CharacterQuerySnapshot,
    ) -> bool {
        if self.character_config(snapshot.body).ok() != Some(&snapshot.config)
            || self.body_state(snapshot.body).ok().map(|s| s.pose) != Some(snapshot.pose)
            || self
                .backend
                .colliders
                .iter()
                .filter(|(_, c)| {
                    self.route_snapshot_includes(c, snapshot.body, snapshot.fixed_only)
                })
                .count()
                != snapshot.colliders.len()
        {
            return false;
        }
        // Explicitly validate the generation even if the snapshot has no fixtures.
        if !self.backend.bodies.contains(native_id(snapshot.body)) {
            return false;
        }
        snapshot.colliders.iter().all(|saved| {
            self.backend.colliders.get(saved.id).is_some_and(|now| {
                self.route_snapshot_includes(now, snapshot.body, snapshot.fixed_only)
            }) && self.query_snapshot_collider_matches(saved)
        })
    }
}

#[cfg(test)]
mod tests;

// Public body/local inputs each admit squared-norm error1e-5. A captured
// product therefore admits2*e+e^2, plus conservative64*f32::EPSILON quaternion
// product roundoff. These are saved observations; never normalize their bits.
const SAVED_DERIVED_ROTATION_ERROR: f64 = 2.0e-5 + 1.0e-10 + 64.0 * f32::EPSILON as f64;
fn saved_controller_colliders_valid(colliders: &[Collider]) -> bool {
    let mut previous = None;
    for c in colliders {
        let slot = c.id.into_raw_parts().0;
        if previous.is_some_and(|p| p >= slot) {
            return false;
        }
        previous = Some(slot);
        let rotation = c.pose.rotation.to_array();
        if !c.pose.translation.to_array().iter().all(|v| v.is_finite())
            || !rotation.iter().all(|v| v.is_finite())
            || (rotation.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() - 1.).abs()
                > (if c.parent.is_some() {
                    SAVED_DERIVED_ROTATION_ERROR
                } else {
                    1e-5
                })
            || c.span.is_some_and(|s| !s.valid())
            || c.one_way.is_some_and(|p| !p.saved_controller_plane_valid())
        {
            return false;
        }
        // id/parent/shape_revision are opaque historical observations. Enabled/sensor
        // bools and InteractionGroups are complete native representations, not indices.
    }
    true
}
impl CharacterQuerySnapshot {
    pub(crate) fn saved_controller_work(&self) -> Option<u64> {
        (self.colliders.len() as u64)
            .checked_mul(96)?
            .checked_add(96)
    }
    pub(crate) fn saved_controller_payload_valid(
        &self,
        body: BodyId,
        config: &CharacterConfig,
        pose: Pose,
        fixed_only: bool,
    ) -> bool {
        self.body == body
            && self.config == *config
            && self.pose == pose
            && self.fixed_only == fixed_only
            && self.config.saved_controller_config_valid()
            && super::types::valid_pose(self.pose)
            && saved_controller_colliders_valid(&self.colliders)
    }
}
impl FixedQuerySnapshot {
    pub(crate) fn saved_controller_work(&self) -> Option<u64> {
        (self.colliders.len() as u64)
            .checked_mul(96)?
            .checked_add(4)
    }
    pub(crate) fn saved_controller_payload_valid(&self) -> bool {
        saved_controller_colliders_valid(&self.colliders)
    }
}
