//! Optional contact policies on the common native solver, including CCD filtering.
use super::events::collider_id;
use super::world::native_id;
use super::{BodyId, ColliderId, PhysicsError, PhysicsWorld3d, Space};
use rapier3d::prelude as rp;
use std::collections::BTreeMap;

/// Logical floor/height filtering for planar games. This does not move geometry
/// out of the XY plane; spatial worlds use their actual 3D geometry instead.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PlanarCollisionSpan {
    /// Only equal floor identities overlap.
    pub floor: u32,
    /// Lower elevation, in [-1,000,000, 1,000,000].
    pub elevation: f32,
    /// Nonnegative height; the upper elevation must also be within those bounds.
    pub height: f32,
}

impl PlanarCollisionSpan {
    pub(crate) fn valid(self) -> bool {
        self.elevation.is_finite()
            && self.elevation.abs() <= 1e6
            && self.height.is_finite()
            && self.height >= 0.0
            && (self.elevation + self.height).abs() <= 1e6
    }

    fn overlaps(self, other: Self) -> bool {
        self.floor == other.floor
            && self.elevation <= other.elevation + other.height
            && other.elevation <= self.elevation + self.height
    }
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub(super) struct ContactPolicies {
    pub(super) planar: bool,
    pub(super) one_way: BTreeMap<ColliderId, super::one_way::OneWay>,
    pub(super) corrections: BTreeMap<ColliderId, super::ContactCorrection>,
    pub(super) surfaces: BTreeMap<ColliderId, [f32; 3]>,
    pub(super) spans: BTreeMap<BodyId, PlanarCollisionSpan>,
    /// Only character/dynamic pairs whose impulses are owned by the controller.
    pub(super) character_dynamic_pairs: std::collections::BTreeSet<(ColliderId, ColliderId)>,
}

fn body_id(handle: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = handle.into_raw_parts();
    BodyId { slot, generation }
}

impl ContactPolicies {
    pub(super) fn pair_allows(
        &self,
        a: Option<rp::RigidBodyHandle>,
        b: Option<rp::RigidBodyHandle>,
    ) -> bool {
        self.pair_span_allows(a.and_then(|h| self.spans.get(&body_id(h))).copied(), b)
    }

    pub(super) fn pair_span_allows(
        &self,
        span: Option<PlanarCollisionSpan>,
        target: Option<rp::RigidBodyHandle>,
    ) -> bool {
        match (span, target.and_then(|h| self.spans.get(&body_id(h)))) {
            (Some(a), Some(b)) => a.overlaps(*b),
            _ => true,
        }
    }

    pub(super) fn query_allows(
        &self,
        body: Option<rp::RigidBodyHandle>,
        span: Option<PlanarCollisionSpan>,
    ) -> bool {
        span.is_none_or(|span| {
            body.and_then(|h| self.spans.get(&body_id(h)))
                .is_some_and(|other| span.overlaps(*other))
        })
    }

    pub(super) fn set_surface(&mut self, id: ColliderId, velocity: [f32; 3]) {
        if velocity == [0.0; 3] {
            self.surfaces.remove(&id);
        } else {
            self.surfaces.insert(id, velocity);
        }
    }

    pub(super) fn set_correction(
        &mut self,
        id: ColliderId,
        value: Option<super::ContactCorrection>,
    ) {
        if let Some(value) = value {
            self.corrections.insert(id, value);
        } else {
            self.corrections.remove(&id);
        }
    }

    pub(super) fn flags(&self, body: BodyId, collider: ColliderId) -> rp::ActiveHooks {
        let mut flags = rp::ActiveHooks::empty();
        if self.spans.contains_key(&body)
            || self.one_way.contains_key(&collider)
            || self
                .character_dynamic_pairs
                .iter()
                .any(|&(a, b)| a == collider || b == collider)
        {
            flags |=
                rp::ActiveHooks::FILTER_CONTACT_PAIRS | rp::ActiveHooks::FILTER_INTERSECTION_PAIR;
        }
        if self.planar
            || self.surfaces.contains_key(&collider)
            || self.corrections.contains_key(&collider)
        {
            flags |= rp::ActiveHooks::MODIFY_SOLVER_CONTACTS;
        }
        flags
    }
}

impl rp::PhysicsHooks for ContactPolicies {
    fn filter_contact_pair(&self, context: &rp::PairFilterContext) -> Option<rp::SolverFlags> {
        if !self.pair_allows(context.rigid_body1, context.rigid_body2)
            || !self.one_way_pair_allows(context)
        {
            return None;
        }
        let a = collider_id(context.collider1);
        let b = collider_id(context.collider2);
        let pair = if a < b { (a, b) } else { (b, a) };
        Some(if self.character_dynamic_pairs.contains(&pair) {
            rp::SolverFlags::empty()
        } else {
            rp::SolverFlags::COMPUTE_RIGID_IMPULSES
        })
    }

    fn filter_intersection_pair(&self, context: &rp::PairFilterContext) -> bool {
        self.pair_allows(context.rigid_body1, context.rigid_body2)
    }

    fn modify_solver_contacts(&self, context: &mut rp::ContactModificationContext) {
        let surface = |id| {
            rp::Vector::from(
                self.surfaces
                    .get(&collider_id(id))
                    .copied()
                    .unwrap_or([0.0; 3]),
            )
        };
        let velocity = surface(context.collider1) - surface(context.collider2);
        let correction = match (
            self.corrections
                .get(&collider_id(context.collider1))
                .copied(),
            self.corrections
                .get(&collider_id(context.collider2))
                .copied(),
        ) {
            (Some(a), Some(b)) => Some(a.combine(b)),
            (a, b) => a.or(b),
        };
        if let Some(manifold) = context.rigid_mut() {
            *manifold.contact_correction = correction.map_or_else(Default::default, |c| c.native());
            if self.planar && manifold.normal.z.abs() < 1.0e-4 {
                // Extrusion creates two Z witnesses for each XY constraint. Solve
                // each projected constraint once, with stable XY ordering.
                manifold.solver_contacts.sort_by(|a, b| {
                    a.anchor1
                        .x
                        .total_cmp(&b.anchor1.x)
                        .then(a.anchor1.y.total_cmp(&b.anchor1.y))
                        .then(a.contact_id.cmp(&b.contact_id))
                });
                manifold.solver_contacts.dedup_by(|a, b| {
                    (a.anchor1.x - b.anchor1.x).abs() <= 1e-6
                        && (a.anchor1.y - b.anchor1.y).abs() <= 1e-6
                        && (a.anchor2.x - b.anchor2.x).abs() <= 1e-6
                        && (a.anchor2.y - b.anchor2.y).abs() <= 1e-6
                        && (a.dist - b.dist).abs() <= 1e-6
                });
            }
            let tangent = velocity - *manifold.normal * velocity.dot(*manifold.normal);
            for contact in manifold.solver_contacts.iter_mut() {
                contact.tangent_velocity = tangent;
                // XY-constrained solver rows have no Z lever arm. Extruded geometry's
                // arbitrarily chosen Z face must not condition these effective masses.
                if self.planar && manifold.normal.z.abs() < 1.0e-4 {
                    contact.anchor1.z = 0.0;
                    contact.anchor2.z = 0.0;
                }
            }
        }
    }
}

impl PhysicsWorld3d {
    /// Uses collision-pair span semantics, including wildcard bodies without a span.
    pub(crate) fn body_collision_spans_allow(
        &self,
        a: BodyId,
        b: BodyId,
    ) -> Result<bool, PhysicsError> {
        let a = native_id(a);
        let b = native_id(b);
        if !self.backend.bodies.contains(a) || !self.backend.bodies.contains(b) {
            return Err(PhysicsError::StaleBody);
        }
        Ok(self.contact_policies.pair_allows(Some(a), Some(b)))
    }

    /// Changes a planar body's logical collision range. Missing spans collide with
    /// every range; explicit query spans only return bodies with matching spans.
    /// Validation is atomic. Changes affect the next contact/sensor/CCD step and
    /// immediate queries, and invalidate character grounding before new input.
    pub fn set_planar_collision_span(
        &mut self,
        body: BodyId,
        span: Option<PlanarCollisionSpan>,
    ) -> Result<(), PhysicsError> {
        self.validate_planar_collision_span(span)?;
        let native = self
            .backend
            .bodies
            .get_mut(native_id(body))
            .ok_or(PhysicsError::StaleBody)?;
        if self.contact_policies.spans.get(&body).copied() == span {
            return Ok(());
        }
        if let Some(span) = span {
            self.contact_policies.spans.insert(body, span);
        } else {
            self.contact_policies.spans.remove(&body);
        }
        native.wake_up(true);
        for &handle in native.colliders() {
            if let Some(collider) = self.backend.colliders.get_mut(handle) {
                collider.set_active_hooks(self.contact_policies.flags(body, collider_id(handle)));
                // set_active_hooks alone does not mark native narrow-phase data dirty.
                // Touch the unchanged pose to recompute even stationary sensor pairs.
                collider.set_position(*collider.position());
            }
        }
        self.invalidate_character_support(Some(body), None);
        if let Some(character) = self.characters.get_mut(&body) {
            character.state.grounded = false;
            character.state.ground = None;
        }
        Ok(())
    }

    pub(crate) fn planar_collision_span(
        &self,
        body: BodyId,
    ) -> Result<Option<PlanarCollisionSpan>, PhysicsError> {
        self.body_state(body)?;
        Ok(self.contact_policies.spans.get(&body).copied())
    }

    pub(crate) fn validate_planar_collision_span(
        &self,
        span: Option<PlanarCollisionSpan>,
    ) -> Result<(), PhysicsError> {
        if span.is_some() && self.config.space != Space::PlanarXy {
            return Err(PhysicsError::OutOfPlane);
        }
        if span.is_some_and(|s| !s.valid()) {
            return Err(PhysicsError::InvalidBody);
        }
        Ok(())
    }
}
