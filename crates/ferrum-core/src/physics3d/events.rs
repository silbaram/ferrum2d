use super::{BodyId, ColliderId, ColliderRef, PhysicsWorld3d};
use rapier3d::prelude as rp;
use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard};

/// A contact or sensor transition. Identities remain meaningful after object removal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct CollisionEvent {
    /// Participant with the smaller collider identity.
    pub first: ColliderRef,
    /// Participant with the larger collider identity.
    pub second: ColliderRef,
    /// Whether the pair began or ended contact/overlap.
    pub phase: CollisionPhase,
    /// True if either participant was a sensor when the pair started.
    pub sensor: bool,
    /// True for exits caused by explicit collider/body removal or world clearing.
    pub removed: bool,
}

/// Transition between disjoint and touching colliders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CollisionPhase {
    /// Contact or sensor overlap began during a physics step.
    Enter,
    /// Contact or overlap ended, or a participant was removed.
    Exit,
}

/// Currently active native contact or sensor pair, independent of queued transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ActiveCollisionPair {
    /// Participant with the smaller collider identity.
    pub first: ColliderRef,
    /// Participant with the larger collider identity.
    pub second: ColliderRef,
    /// Whether this pair was classified as a sensor intersection when it started.
    pub sensor: bool,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct EventBuffer {
    active: BTreeMap<(ColliderId, ColliderId), CollisionEvent>,
    queued: Vec<CollisionEvent>,
    limit: usize,
    dropped: usize,
}

impl EventBuffer {
    fn push(&mut self, event: CollisionEvent) {
        if self.queued.len() < self.limit {
            self.queued.push(event);
        } else {
            self.dropped = self.dropped.saturating_add(1);
        }
    }

    fn stop(&mut self, key: (ColliderId, ColliderId), removed: bool) {
        if let Some(mut event) = self.active.remove(&key) {
            event.phase = CollisionPhase::Exit;
            event.removed = removed;
            self.push(event);
        }
    }
}

// Rapier's callback requires Sync even for our single-threaded world. A mutex keeps
// the dependency's normal feature configuration and avoids per-event channels/allocations.
// No user callback runs under this lock.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(super) struct EventCollector(
    Mutex<EventBuffer>,
    pub(super) Mutex<super::contact_impulses::ImpulseBuffer>,
    pub(super) Mutex<super::motion_trace::MotionTrace>,
);

impl EventCollector {
    /// Complete a restored output Vec's fallible backing reservation before
    /// native execution/publication. Limits are the existing persistent owner
    /// max_events bytes, not transient body-count-based trajectory scratch.
    pub(in crate::physics3d) fn prepare_actual_contact_impulses(
        &self,
        expected_limit: usize,
        work: &mut super::solver_trajectory::Work,
        max_output_bytes: usize,
    ) -> Result<(), super::solver_trajectory::TrajectoryError> {
        self.1
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .prepare_actual(expected_limit, work, max_output_bytes)
    }

    /// Additional physical impulses after native PGS, already admitted by the
    /// actual-response staging owner. Does not touch manifold/warm-start data.
    pub(in crate::physics3d) fn record_actual_contact_impulses(
        &self,
        contacts: &[super::ContactImpulse],
        solved: usize,
    ) {
        self.1
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .record_actual(contacts, solved);
    }

    pub fn new(limit: usize) -> Self {
        Self(
            Mutex::new(EventBuffer {
                active: BTreeMap::new(),
                queued: Vec::with_capacity(limit),
                limit,
                dropped: 0,
            }),
            Mutex::new(super::contact_impulses::ImpulseBuffer::new(limit)),
            Mutex::new(super::motion_trace::MotionTrace::default()),
        )
    }

    fn buffer(&self) -> MutexGuard<'_, EventBuffer> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn remove_collider(&mut self, collider: ColliderId) {
        let buffer = self
            .0
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let EventBuffer {
            active,
            queued,
            limit,
            dropped,
        } = buffer;
        // Retain visits in key order and needs no temporary allocation on removal.
        active.retain(|&(a, b), event| {
            if a != collider && b != collider {
                return true;
            }
            let mut event = *event;
            event.phase = CollisionPhase::Exit;
            event.removed = true;
            if queued.len() < *limit {
                queued.push(event);
            } else {
                *dropped = dropped.saturating_add(1);
            }
            false
        });
    }

    fn drain(&mut self, out: &mut Vec<CollisionEvent>) -> usize {
        let buffer = self
            .0
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        out.clear();
        out.append(&mut buffer.queued);
        std::mem::take(&mut buffer.dropped)
    }
}

pub(super) fn collider_id(handle: rp::ColliderHandle) -> ColliderId {
    let (slot, generation) = handle.into_raw_parts();
    ColliderId { slot, generation }
}

pub(super) fn collider_ref(
    handle: rp::ColliderHandle,
    collider: &rp::Collider,
) -> Option<ColliderRef> {
    let (slot, generation) = collider.parent()?.into_raw_parts();
    Some(ColliderRef {
        collider: collider_id(handle),
        body: BodyId { slot, generation },
        sensor: collider.is_sensor(),
    })
}

impl rp::EventHandler for EventCollector {
    fn wants_body_motion(&self) -> bool {
        self.2.lock().unwrap_or_else(|p| p.into_inner()).enabled
    }

    fn handle_body_motion_pass_started(&self, duration: f32) {
        self.2
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .begin_pass(duration);
    }

    fn handle_solver_body_motion(&self, motion: rapier3d::pipeline::SolverBodyMotion) {
        self.2
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .record(motion);
    }

    fn handle_solver_body_integration(
        &self,
        integration: rapier3d::pipeline::SolverBodyIntegration,
    ) {
        self.2
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .record_integration(integration);
    }

    fn handle_body_motion_clamped(
        &self,
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        sweep: &rapier3d::parry::query::sweep_toi::Sweep,
        fraction: f32,
    ) {
        self.2
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .accepted_clamp(body, start, end, sweep, fraction);
    }

    fn handle_body_motion_clamp(
        &self,
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        fraction: f32,
    ) {
        self.2
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clamp(body, start, end, fraction);
    }

    fn handle_collision_event(
        &self,
        _bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        event: rp::CollisionEvent,
        _contact_pair: Option<&rp::ContactPair>,
    ) {
        let a = event.collider1();
        let b = event.collider2();
        let (a, b) = if collider_id(a) <= collider_id(b) {
            (a, b)
        } else {
            (b, a)
        };
        let key = (collider_id(a), collider_id(b));
        let mut buffer = self.buffer();
        if event.stopped() {
            buffer.stop(key, event.removed());
        } else if let (Some(first), Some(second)) = (
            colliders.get(a).and_then(|c| collider_ref(a, c)),
            colliders.get(b).and_then(|c| collider_ref(b, c)),
        ) {
            let event = CollisionEvent {
                first,
                second,
                phase: CollisionPhase::Enter,
                sensor: event.sensor(),
                removed: false,
            };
            if buffer.active.insert(key, event).is_none() {
                buffer.push(event);
            }
        }
    }

    fn handle_contact_force_event(
        &self,
        _dt: f32,
        _bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        contact_pair: &rp::ContactPair,
        _total_force_magnitude: f32,
    ) {
        self.1
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .record(colliders, contact_pair);
    }

    fn handle_soft_body_tear_event(
        &self,
        _bodies: &rp::SoftBodySet,
        _event: &rp::SoftBodyTearEvent,
    ) {
    }
}

impl PhysicsWorld3d {
    /// Replaces `out` with every active pair in collider identity order.
    /// This state is maintained even when the transition queue overflows. It reflects
    /// the last physics step plus explicit removals, not a new geometry query.
    /// Reading does not drain events or advance simulation. Storage grows to the
    /// active pair count; `max_events` bounds transitions, not persistent pair state.
    pub fn active_collision_pairs(&self, out: &mut Vec<ActiveCollisionPair>) {
        let buffer = self.events.buffer();
        out.clear();
        out.extend(buffer.active.values().map(|event| ActiveCollisionPair {
            first: event.first,
            second: event.second,
            sensor: event.sensor,
        }));
    }

    /// Replaces `out` with queued transitions and returns the number dropped on overflow.
    /// Storage is reused. On overflow, callers must resynchronize their contact state.
    /// Enter/exit detection occurs during `step`; explicit removal queues an exit immediately.
    /// Querying or draining never advances physics or consumes pending simulation edits.
    pub fn drain_collision_events(&mut self, out: &mut Vec<CollisionEvent>) -> usize {
        self.events.drain(out)
    }
}
