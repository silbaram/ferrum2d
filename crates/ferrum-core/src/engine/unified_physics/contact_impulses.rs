//! Maps solver observations into gameplay effects and existing frame reports.
use super::{Engine, UnifiedPhysicsError, UnifiedPhysicsRuntime};
use crate::components::RigidContactImpulse;
use crate::entity::Entity;
use crate::physics3d::{ContactImpulse, ContactImpulseDiagnostics, Space};
use crate::world::World;

/// Last fixed tick's solved contact with both native and gameplay identities.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct UnifiedContactImpulse {
    /// First participant, including its World generation at solve time.
    pub a: Entity,
    /// Second participant, including its World generation at solve time.
    pub b: Entity,
    /// Full XYZ contact evidence. Visual anchor offsets do not move this point.
    pub contact: ContactImpulse,
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct ContactReports {
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(in crate::engine) terrain_events: Vec<super::terrain_events::TerrainImpactRecord>,
    pub(in crate::engine) terrain_dropped: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) native: Vec<ContactImpulse>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    contacts: Vec<UnifiedContactImpulse>,
    pub(super) diagnostics: ContactImpulseDiagnostics,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) observations: Vec<super::observations::ImpulseRecord>,
    // Same order as World::impact_feedback_impacts; native fixture categories
    // cannot be recovered from the World primary collider (or an entity union).
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(in crate::engine) feedback_categories: Vec<u32>,
}

impl Engine {
    /// Last completed fixed tick's bounded solved contacts, including CCD/joint
    /// substeps. Rejected/zero-duration calls and geometry queries preserve them.
    /// Frame-level 2D impact reports use XY in planar worlds and X/-Z in spatial
    /// worlds. Use this API for the full normal and elevation of spatial impacts.
    pub fn unified_contact_impulses(
        &self,
    ) -> Result<&[UnifiedContactImpulse], UnifiedPhysicsError> {
        Ok(&self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .contacts
            .contacts)
    }

    /// Counts observations before truncation by the native tick buffer.
    pub fn unified_contact_impulse_diagnostics(
        &self,
    ) -> Result<ContactImpulseDiagnostics, UnifiedPhysicsError> {
        Ok(self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .contacts
            .diagnostics)
    }
}

impl UnifiedPhysicsRuntime {
    pub(super) fn finish_contact_reports(&mut self, world: &mut World) {
        let reports = &mut self.contacts;
        reports.contacts.clear();
        reports.observations.clear();
        reports.feedback_categories.clear();
        reports.diagnostics = self.physics.contact_impulses(&mut reports.native);
        world.clear_rigid_contact_impulses();
        world.contact_impacts.clear();
        world.contact_impacts_dropped = 0;
        world.impact_feedback_impacts.clear();
        world.impact_feedback_dropped = 0;
        let project = |v: [f32; 3]| match self.physics.config().space {
            Space::PlanarXy => [v[0], v[1]],
            Space::Spatial => [v[0], -v[2]],
        };
        for contact in &reports.native {
            reports
                .observations
                .push(super::observations::ImpulseRecord::new(
                    contact,
                    &self.entities_by_body,
                    &self.terrain.by_collider,
                ));
            let (Some(&a), Some(&b)) = (
                self.entities_by_body.get(&contact.first.body),
                self.entities_by_body.get(&contact.second.body),
            ) else {
                continue;
            };
            let point = project(contact.point);
            let normal = project(contact.normal);
            let tangent = project(contact.tangent_impulse);
            let impulse = RigidContactImpulse {
                entity_a: a,
                entity_b: b,
                point_x: point[0],
                point_y: point[1],
                normal_x: normal[0],
                normal_y: normal[1],
                normal_impulse: contact.normal_impulse,
                tangent_impulse: tangent[0] * -normal[1] + tangent[1] * normal[0],
            };
            world.record_rigid_contact_impulse(impulse);
            let count = world.impact_feedback_impacts.len();
            world.record_contact_impact(impulse, contact.approach_speed);
            if world.impact_feedback_impacts.len() != count {
                reports.feedback_categories.push(contact.categories);
            }
            reports.contacts.push(UnifiedContactImpulse {
                a,
                b,
                contact: contact.clone(),
            });
        }
        // The bounded native stream can drop observations before the speed/profile
        // filters. Conservatively report all such losses on each enabled consumer.
        let dropped = reports.diagnostics.dropped.min(u32::MAX as usize) as u32;
        if world.contact_impact_min_speed.is_some() {
            world.contact_impacts_dropped = world.contact_impacts_dropped.saturating_add(dropped);
        }
        if world.impact_feedback_enabled {
            world.impact_feedback_dropped = world.impact_feedback_dropped.saturating_add(dropped);
        }
    }
}

mod file_runtime_observation_admission;
