//! Collider-level observations, independent of entity lifecycle telemetry.
use super::{BodyId, Entity, UnifiedTerrainSource};
use crate::physics3d::{
    ActiveCollisionPair, ColliderId, ColliderRef, CollisionEvent, CollisionPhase,
};
use std::collections::BTreeMap;

type Entities = BTreeMap<BodyId, Entity>;
type Terrain = BTreeMap<ColliderId, UnifiedTerrainSource>;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct Participant {
    pub flags: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub entity: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub body: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub collider: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub terrain: [u32; 3],
}
impl Participant {
    pub(super) fn new(target: ColliderRef, entities: &Entities, terrain: &Terrain) -> Self {
        let entity = entities.get(&target.body);
        Self {
            flags: u32::from(entity.is_some()) | (u32::from(target.sensor) << 1),
            entity: entity.map_or([0; 2], |e| [e.id, e.generation]),
            body: [target.body.slot, target.body.generation],
            collider: [target.collider.slot, target.collider.generation],
            terrain: match terrain.get(&target.collider) {
                Some(UnifiedTerrainSource::Tile { layer, tile }) => [1, *layer, *tile],
                Some(UnifiedTerrainSource::SpatialSurface { id }) => [2, *id, 0],
                None => [0; 3],
            },
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct CollisionRecord {
    pub(super) phase: u32,
    pub(super) flags: u32,
    pub(super) first: Participant,
    pub(super) second: Participant,
}
const _: () = assert!(std::mem::size_of::<CollisionRecord>() == 22 * 4);
const _: () = assert!(std::mem::align_of::<CollisionRecord>() == 4);

impl CollisionRecord {
    pub(super) fn active(
        pair: ActiveCollisionPair,
        entities: &Entities,
        terrain: &Terrain,
    ) -> Self {
        Self {
            phase: 2,
            flags: u32::from(pair.sensor),
            first: Participant::new(pair.first, entities, terrain),
            second: Participant::new(pair.second, entities, terrain),
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct CollisionStream {
    enabled: bool,
    limit: usize,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending: Vec<CollisionRecord>,
    dropped_transitions: u32,
    dropped_events: u32,
}
impl CollisionStream {
    pub(super) fn new(limit: usize) -> Self {
        Self {
            enabled: false,
            limit,
            pending: Vec::new(),
            dropped_transitions: 0,
            dropped_events: 0,
        }
    }
    pub(super) fn set_enabled(&mut self, enabled: bool) {
        if self.enabled != enabled {
            self.pending.clear();
            self.dropped_events = 0;
            self.dropped_transitions = 0;
            self.enabled = enabled;
        }
    }
    pub(super) fn capture(
        &mut self,
        events: &[CollisionEvent],
        dropped: usize,
        entities: &Entities,
        terrain: &Terrain,
    ) {
        if !self.enabled {
            return;
        }
        self.dropped_transitions = self
            .dropped_transitions
            .saturating_add(dropped.min(u32::MAX as usize) as u32);
        for event in events {
            if self.pending.len() == self.limit {
                self.dropped_events = self.dropped_events.saturating_add(1);
                continue;
            }
            self.pending.push(CollisionRecord {
                phase: u32::from(event.phase == CollisionPhase::Exit),
                flags: u32::from(event.sensor) | (u32::from(event.removed) << 1),
                first: Participant::new(event.first, entities, terrain),
                second: Participant::new(event.second, entities, terrain),
            });
        }
    }
    pub(super) fn drain(&mut self, out: &mut CollisionBuffers) {
        out.rows.clear();
        out.rows.append(&mut self.pending);
        out.dropped_transitions = std::mem::take(&mut self.dropped_transitions);
        out.dropped_events = std::mem::take(&mut self.dropped_events);
    }
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct CollisionBuffers {
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) rows: Vec<CollisionRecord>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) active: Vec<ActiveCollisionPair>,
    pub(super) dropped_transitions: u32,
    pub(super) dropped_events: u32,
}
impl CollisionBuffers {
    pub(super) fn clear(&mut self) {
        self.rows.clear();
        self.dropped_transitions = 0;
        self.dropped_events = 0;
    }
}

mod file_output_admission;

mod file_runtime_observation_admission;
