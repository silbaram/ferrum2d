//! Solved contact observations. Geometry queries never populate this stream.
use super::events::collider_ref;
use super::{ColliderRef, PhysicsWorld3d};
use rapier3d::prelude as rp;

/// One solved contact's impulse over a native solve (including its internal substeps).
/// A fixed tick can contain several solves due to CCD or joint substeps.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ContactImpulse {
    /// First collider in native solver order, including generation.
    pub first: ColliderRef,
    /// Second collider in native solver order, including generation.
    pub second: ColliderRef,
    /// Union of the two participating fixtures' category bits at solve time.
    pub categories: u32,
    /// World-space solver point captured before integration.
    pub point: [f32; 3],
    /// Unit normal directed from the first collider toward the second.
    pub normal: [f32; 3],
    /// Total nonnegative normal impulse, including warm starts actually applied.
    pub normal_impulse: f32,
    /// Total world-space friction impulse applied to the second body.
    /// Simplified friction is distributed equally over the manifold's solver points.
    /// This vector excludes the separate twist-friction angular impulse.
    pub tangent_impulse: [f32; 3],
    /// Positive approach speed at constraint generation, including angular motion.
    pub approach_speed: f32,
}

/// Last completed fixed tick's contact-report counts, before output truncation.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ContactImpulseDiagnostics {
    /// Contact observations with a positive normal or nonzero friction impulse.
    pub solved_contacts: usize,
    /// Observations omitted because the tick exceeded `WorldConfig::max_events`.
    pub dropped: usize,
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub(super) struct ImpulseBuffer {
    pub(super) contacts: Vec<ContactImpulse>,
    pub(super) diagnostics: ContactImpulseDiagnostics,
    limit: usize,
}

impl ImpulseBuffer {
    pub(super) fn new(limit: usize) -> Self {
        Self {
            contacts: Vec::with_capacity(limit),
            diagnostics: ContactImpulseDiagnostics::default(),
            limit,
        }
    }

    pub(super) fn clear(&mut self) {
        self.contacts.clear();
        self.diagnostics = ContactImpulseDiagnostics::default();
    }

    fn admit(&mut self) -> bool {
        self.diagnostics.solved_contacts = self.diagnostics.solved_contacts.saturating_add(1);
        if self.contacts.len() == self.limit {
            self.diagnostics.dropped = self.diagnostics.dropped.saturating_add(1);
            false
        } else {
            true
        }
    }

    pub(super) fn record(&mut self, colliders: &rp::ColliderSet, pair: &rp::ContactPair) {
        let (Some(a), Some(b)) = (colliders.get(pair.collider1), colliders.get(pair.collider2))
        else {
            return;
        };
        let (Some(first), Some(second)) = (
            collider_ref(pair.collider1, a),
            collider_ref(pair.collider2, b),
        ) else {
            return;
        };
        let categories =
            (a.collision_groups().memberships | b.collision_groups().memberships).bits();
        for manifold in pair.solver_manifolds() {
            if !manifold
                .data
                .solver_flags
                .contains(rp::SolverFlags::COMPUTE_RIGID_IMPULSES)
            {
                continue;
            }
            // Raw manifold points can retain impulses from removed solver rows. Only
            // visit rows selected for this solve, including planar deduplication.
            for contact in &manifold.data.solver_contacts {
                let index = (contact.contact_id[0] & !rapier3d::geometry::NEW_CONTACT_BIT) as usize;
                let Some(point) = manifold.points.get(index) else {
                    continue;
                };
                let data = &point.data;
                if data.impulse <= 0.0 && data.solved.tangent_impulse_world == rp::Vector::ZERO {
                    continue;
                }
                if !self.admit() {
                    continue;
                }
                self.contacts.push(ContactImpulse {
                    first,
                    second,
                    categories,
                    point: data.solved.point.into(),
                    normal: data.solved.normal.into(),
                    normal_impulse: data.impulse.max(0.0),
                    tangent_impulse: (-data.solved.tangent_impulse_world).into(),
                    approach_speed: data.solved.approach_speed,
                });
            }
        }
    }
}

impl PhysicsWorld3d {
    /// Copies the last tick's bounded solved-contact stream into reusable storage.
    /// Reading never drains it, changes warm-start caches, or advances simulation.
    /// Sleeping pairs and sensors produce no observations. Counts include all CCD
    /// and joint substeps; overflow does not change simulation or collision events.
    pub fn contact_impulses(&self, out: &mut Vec<ContactImpulse>) -> ContactImpulseDiagnostics {
        let buffer = self.events.1.lock().unwrap_or_else(|p| p.into_inner());
        out.clear();
        out.extend_from_slice(&buffer.contacts);
        buffer.diagnostics
    }
}
