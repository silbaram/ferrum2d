//! Native collider transitions reduced to entity lifecycle events without losing identities.
use super::*;
use crate::collision::CollisionPair;
use crate::collision_event::{
    CollisionEvent, CollisionEventCounts, CollisionPairCounts, COLLISION_EVENT_ENTER,
    COLLISION_EVENT_EXIT, COLLISION_EVENT_STAY, COLLISION_EVENT_TRIGGER_ENTER,
    COLLISION_EVENT_TRIGGER_EXIT, COLLISION_EVENT_TRIGGER_STAY,
};
use crate::physics3d::{ActiveCollisionPair, ColliderId, CollisionPhase};
use std::collections::BTreeSet;

/// Active gameplay entity pair. Solid and sensor contacts are independent channels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnifiedCollisionPair {
    /// Entity with the smaller (id, generation) identity.
    pub a: Entity,
    /// Other entity.
    pub b: Entity,
    /// True for sensor overlap, false for solid contact.
    pub is_trigger: bool,
}

/// Lost transitions/events in the current frame, including pending manual-step output.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct UnifiedCollisionEventDiagnostics {
    /// Native collider transitions omitted by the backend event queue.
    pub dropped_transitions: u32,
    /// Entity lifecycle events omitted by pending or per-frame output bounds.
    pub dropped_events: u32,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
struct PairKey {
    a: (u32, u32),
    b: (u32, u32),
    trigger: bool,
}
impl PairKey {
    fn new(a: Entity, b: Entity, trigger: bool) -> Option<Self> {
        if a == b {
            return None;
        }
        let a = (a.id, a.generation);
        let b = (b.id, b.generation);
        let (a, b) = if a <= b { (a, b) } else { (b, a) };
        Some(Self { a, b, trigger })
    }
    fn pair(self) -> UnifiedCollisionPair {
        UnifiedCollisionPair {
            a: Entity {
                id: self.a.0,
                generation: self.a.1,
            },
            b: Entity {
                id: self.b.0,
                generation: self.b.1,
            },
            is_trigger: self.trigger,
        }
    }
    fn event(self, solid: u32, trigger: u32) -> CollisionEvent {
        let pair = self.pair();
        CollisionEvent::from_entities(if self.trigger { trigger } else { solid }, pair.a, pair.b)
    }
}

type FixtureKey = (ColliderId, ColliderId);

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct Lifecycle {
    enabled: bool,
    pub(super) stream: super::collision_stream::CollisionStream,
    limit: usize,
    #[serde(deserialize_with = "super::file_ordered::map")]
    fixtures: BTreeMap<FixtureKey, PairKey>,
    #[serde(deserialize_with = "super::file_ordered::map")]
    counts: BTreeMap<PairKey, u32>,
    #[serde(deserialize_with = "super::file_ordered::set")]
    changed: BTreeSet<PairKey>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    transitions: Vec<crate::physics3d::CollisionEvent>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    snapshot: Vec<ActiveCollisionPair>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending: Vec<CollisionEvent>,
    pending_dropped: UnifiedCollisionEventDiagnostics,
    frame_dropped: UnifiedCollisionEventDiagnostics,
    published: usize,
}

impl Lifecycle {
    pub(super) fn new(limit: usize, enabled: bool) -> Self {
        Self {
            enabled,
            stream: super::collision_stream::CollisionStream::new(limit),
            limit,
            fixtures: BTreeMap::new(),
            counts: BTreeMap::new(),
            changed: BTreeSet::new(),
            transitions: Vec::new(),
            snapshot: Vec::new(),
            pending: Vec::with_capacity(limit),
            pending_dropped: Default::default(),
            frame_dropped: Default::default(),
            published: 0,
        }
    }

    pub(super) fn reset(
        &mut self,
        physics: &mut PhysicsWorld3d,
        entities: &BTreeMap<BodyId, Entity>,
        terrain: &BTreeMap<ColliderId, UnifiedTerrainSource>,
        enabled: bool,
    ) {
        self.capture(physics, entities, terrain);
        self.enabled = enabled;
        self.pending.clear();
        self.pending_dropped = Default::default();
        self.changed.clear();
        self.fixtures.clear();
        self.counts.clear();
        self.reconcile(physics, entities);
    }

    pub(super) fn begin_frame(&mut self) {
        self.published = 0;
        self.frame_dropped = Default::default();
    }

    pub(super) fn capture(
        &mut self,
        physics: &mut PhysicsWorld3d,
        entities: &BTreeMap<BodyId, Entity>,
        terrain: &BTreeMap<ColliderId, UnifiedTerrainSource>,
    ) {
        let dropped = physics.drain_collision_events(&mut self.transitions);
        self.stream
            .capture(&self.transitions, dropped, entities, terrain);
        for index in 0..self.transitions.len() {
            let event = self.transitions[index];
            let key = (event.first.collider, event.second.collider);
            match event.phase {
                CollisionPhase::Exit => self.remove_fixture(key),
                CollisionPhase::Enter => {
                    if let (Some(&a), Some(&b)) = (
                        entities.get(&event.first.body),
                        entities.get(&event.second.body),
                    ) {
                        if let Some(pair) = PairKey::new(a, b, event.sensor) {
                            if self.fixtures.get(&key) != Some(&pair) {
                                self.remove_fixture(key);
                                self.fixtures.insert(key, pair);
                                let count = self.counts.entry(pair).or_default();
                                *count += 1;
                                if *count == 1 {
                                    self.changed.insert(pair);
                                    self.queue(pair.event(
                                        COLLISION_EVENT_ENTER,
                                        COLLISION_EVENT_TRIGGER_ENTER,
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }
        self.transitions.clear();
        if dropped != 0 {
            if self.enabled {
                self.pending_dropped.dropped_transitions = self
                    .pending_dropped
                    .dropped_transitions
                    .saturating_add(u32::try_from(dropped).unwrap_or(u32::MAX));
            }
            // The retained prefix cannot describe missing transient events, but the
            // full active snapshot repairs persistent state even with telemetry OFF.
            self.reconcile(physics, entities);
        }
    }

    fn remove_fixture(&mut self, key: FixtureKey) {
        let Some(pair) = self.fixtures.remove(&key) else {
            return;
        };
        if let Some(count) = self.counts.get_mut(&pair) {
            *count -= 1;
            if *count == 0 {
                self.counts.remove(&pair);
                self.changed.insert(pair);
                self.queue(pair.event(COLLISION_EVENT_EXIT, COLLISION_EVENT_TRIGGER_EXIT));
            }
        }
    }

    fn queue(&mut self, event: CollisionEvent) {
        if self.enabled {
            push_bounded(
                &mut self.pending,
                &mut self.pending_dropped.dropped_events,
                self.limit,
                event,
            );
        }
    }

    fn reconcile(&mut self, physics: &PhysicsWorld3d, entities: &BTreeMap<BodyId, Entity>) {
        physics.active_collision_pairs(&mut self.snapshot);
        let mut fixtures = BTreeMap::new();
        let mut counts = BTreeMap::<PairKey, u32>::new();
        for pair in &self.snapshot {
            if let (Some(&a), Some(&b)) = (
                entities.get(&pair.first.body),
                entities.get(&pair.second.body),
            ) {
                if let Some(key) = PairKey::new(a, b, pair.sensor) {
                    fixtures.insert((pair.first.collider, pair.second.collider), key);
                    *counts.entry(key).or_default() += 1;
                }
            }
        }
        for &key in self.counts.keys() {
            if !counts.contains_key(&key) {
                self.changed.insert(key);
                if self.enabled {
                    push_bounded(
                        &mut self.pending,
                        &mut self.pending_dropped.dropped_events,
                        self.limit,
                        key.event(COLLISION_EVENT_EXIT, COLLISION_EVENT_TRIGGER_EXIT),
                    );
                }
            }
        }
        for &key in counts.keys() {
            if !self.counts.contains_key(&key) {
                self.changed.insert(key);
                if self.enabled {
                    push_bounded(
                        &mut self.pending,
                        &mut self.pending_dropped.dropped_events,
                        self.limit,
                        key.event(COLLISION_EVENT_ENTER, COLLISION_EVENT_TRIGGER_ENTER),
                    );
                }
            }
        }
        self.fixtures = fixtures;
        self.counts = counts;
    }

    pub(super) fn finish_step(
        &mut self,
        physics: &mut PhysicsWorld3d,
        entities: &BTreeMap<BodyId, Entity>,
        terrain: &BTreeMap<ColliderId, UnifiedTerrainSource>,
    ) {
        self.capture(physics, entities, terrain);
        if self.enabled {
            for &key in self.counts.keys() {
                if !self.changed.contains(&key) {
                    push_bounded(
                        &mut self.pending,
                        &mut self.pending_dropped.dropped_events,
                        self.limit,
                        key.event(COLLISION_EVENT_STAY, COLLISION_EVENT_TRIGGER_STAY),
                    );
                }
            }
        }
        self.changed.clear();
    }

    pub(super) fn flush(
        &mut self,
        out: &mut Vec<CollisionEvent>,
    ) -> (CollisionEventCounts, CollisionPairCounts) {
        self.frame_dropped.dropped_transitions = self
            .frame_dropped
            .dropped_transitions
            .saturating_add(std::mem::take(
                &mut self.pending_dropped.dropped_transitions,
            ));
        self.frame_dropped.dropped_events = self
            .frame_dropped
            .dropped_events
            .saturating_add(std::mem::take(&mut self.pending_dropped.dropped_events));
        let mut counts = CollisionEventCounts::default();
        for event in self.pending.drain(..) {
            if self.published == self.limit {
                self.frame_dropped.dropped_events =
                    self.frame_dropped.dropped_events.saturating_add(1);
                continue;
            }
            self.published += 1;
            match event.kind {
                COLLISION_EVENT_ENTER => counts.enter += 1,
                COLLISION_EVENT_STAY => counts.stay += 1,
                COLLISION_EVENT_EXIT => counts.exit += 1,
                COLLISION_EVENT_TRIGGER_ENTER => counts.trigger_enter += 1,
                COLLISION_EVENT_TRIGGER_STAY => counts.trigger_stay += 1,
                COLLISION_EVENT_TRIGGER_EXIT => counts.trigger_exit += 1,
                _ => {}
            }
            out.push(event);
        }
        let mut pairs = CollisionPairCounts::default();
        if self.enabled {
            for key in self.counts.keys() {
                pairs.total = pairs.total.saturating_add(1);
                if key.trigger {
                    pairs.trigger = pairs.trigger.saturating_add(1);
                } else {
                    pairs.solid = pairs.solid.saturating_add(1);
                }
            }
        }
        (counts, pairs)
    }

    fn diagnostics(&self) -> UnifiedCollisionEventDiagnostics {
        UnifiedCollisionEventDiagnostics {
            dropped_transitions: self
                .frame_dropped
                .dropped_transitions
                .saturating_add(self.pending_dropped.dropped_transitions),
            dropped_events: self
                .frame_dropped
                .dropped_events
                .saturating_add(self.pending_dropped.dropped_events),
        }
    }

    pub(super) fn gameplay_pairs(&self, out: &mut Vec<CollisionPair>) {
        out.clear();
        for key in self.counts.keys() {
            let pair = key.pair();
            // Solid and trigger entries for one entity pair are adjacent in key order.
            if out
                .last()
                .is_none_or(|last| last.a != pair.a || last.b != pair.b)
            {
                out.push(CollisionPair {
                    a: pair.a,
                    b: pair.b,
                });
            }
        }
    }
}

fn push_bounded(
    out: &mut Vec<CollisionEvent>,
    dropped: &mut u32,
    limit: usize,
    event: CollisionEvent,
) {
    if out.len() < limit {
        out.push(event);
    } else {
        *dropped = dropped.saturating_add(1);
    }
}

impl Engine {
    /// Reads native lifecycle loss diagnostics without draining events or advancing time.
    /// Use `unified_collision_pairs` to resynchronize after any nonzero drop count.
    pub fn unified_collision_event_diagnostics(
        &self,
    ) -> Result<UnifiedCollisionEventDiagnostics, UnifiedPhysicsError> {
        Ok(self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .lifecycle
            .diagnostics())
    }

    /// Replaces `out` with every currently active entity pair, even with telemetry off.
    /// Reflects completed native steps and explicit native removals. This is a full
    /// snapshot for overflow recovery; its size is not bounded by the event queue limit.
    pub fn unified_collision_pairs(
        &self,
        out: &mut Vec<UnifiedCollisionPair>,
    ) -> Result<(), UnifiedPhysicsError> {
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        out.clear();
        out.extend(runtime.lifecycle.counts.keys().map(|key| key.pair()));
        Ok(())
    }

    pub(in crate::engine) fn reset_unified_collision_history(&mut self) {
        if let Some(runtime) = &mut self.unified_physics {
            runtime.retire_deleted_entities(&self.world);
            runtime.lifecycle.reset(
                &mut runtime.physics,
                &runtime.entities_by_body,
                &runtime.terrain.by_collider,
                self.collision_lifecycle_events_enabled,
            );
        }
    }

    pub(in crate::engine) fn begin_unified_collision_frame(&mut self) {
        if let Some(runtime) = &mut self.unified_physics {
            runtime.lifecycle.begin_frame();
        }
    }

    pub(in crate::engine) fn flush_unified_collision_events(
        &mut self,
    ) -> Option<(CollisionEventCounts, CollisionPairCounts)> {
        let runtime = self.unified_physics.as_mut()?;
        Some(
            runtime
                .lifecycle
                .flush(&mut self.frame_buffers.collision_events),
        )
    }
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn gameplay_collision_pairs(&mut self) -> &[CollisionPair] {
        self.lifecycle
            .gameplay_pairs(&mut self.gameplay_collision_pairs);
        &self.gameplay_collision_pairs
    }
}

mod file_runtime_observation_admission;
