//! Frame-owned, typed terrain contacts. No terrain is represented as an Entity.
use super::*;
use crate::gameplay_event::{GameplayEvent, GAMEPLAY_EVENT_TERRAIN_IMPACT};
use crate::physics3d::{ColliderRef, ContactImpulse};
use wasm_bindgen::prelude::*;

pub(super) const MAX_TERRAIN_EVENTS: usize = 4096;
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct TerrainImpactRecord {
    /// 1 solved impulse, 2 swept projectile arrival. Unused scalars are zero.
    pub kind: u32,
    pub flags: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub actor: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub actor_body: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub actor_collider: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub terrain_body: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub terrain_collider: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub terrain: [u32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub point: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub normal: [f32; 3],
    pub impulse: f32,
    pub approach_speed: f32,
    pub fraction: f32,
}
const _: () =
    assert!(size_of::<TerrainImpactRecord>() == 24 * 4 && align_of::<TerrainImpactRecord>() == 4);
impl TerrainImpactRecord {
    pub(in crate::engine) fn new(
        kind: u32,
        entity: Entity,
        actor: ColliderRef,
        target: ColliderRef,
        source: UnifiedTerrainSource,
        point: [f32; 3],
        normal: [f32; 3],
    ) -> Self {
        Self {
            kind,
            flags: 0,
            actor: [entity.id, entity.generation],
            actor_body: [actor.body.slot, actor.body.generation],
            actor_collider: [actor.collider.slot, actor.collider.generation],
            terrain_body: [target.body.slot, target.body.generation],
            terrain_collider: [target.collider.slot, target.collider.generation],
            terrain: match source {
                UnifiedTerrainSource::Tile { layer, tile } => [1, layer, tile],
                UnifiedTerrainSource::SpatialSurface { id } => [2, id, 0],
            },
            point,
            normal,
            impulse: 0.,
            approach_speed: 0.,
            fraction: 0.,
        }
    }
    pub(in crate::engine) fn source(&self) -> UnifiedTerrainSource {
        if self.terrain[0] == 1 {
            UnifiedTerrainSource::Tile {
                layer: self.terrain[1],
                tile: self.terrain[2],
            }
        } else {
            UnifiedTerrainSource::SpatialSurface {
                id: self.terrain[1],
            }
        }
    }
}
impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn terrain_contact(
        &self,
        c: &ContactImpulse,
    ) -> Option<TerrainImpactRecord> {
        let (entity, actor, target, normal) = if let (Some(&e), Some(_)) = (
            self.entities_by_body.get(&c.first.body),
            self.terrain.source(c.second.collider),
        ) {
            (e, c.first, c.second, c.normal.map(|v| -v))
        } else if let (Some(&e), Some(_)) = (
            self.entities_by_body.get(&c.second.body),
            self.terrain.source(c.first.collider),
        ) {
            (e, c.second, c.first, c.normal)
        } else {
            return None;
        };
        let mut r = TerrainImpactRecord::new(
            1,
            entity,
            actor,
            target,
            self.terrain.source(target.collider)?,
            c.point,
            normal,
        );
        r.impulse = c.normal_impulse;
        r.approach_speed = c.approach_speed;
        Some(r)
    }
    pub(in crate::engine) fn terrain_feedback_contacts(
        &self,
    ) -> impl Iterator<Item = (TerrainImpactRecord, u32)> + '_ {
        self.contacts
            .native
            .iter()
            .filter(|c| c.normal_impulse > 0.0001 && c.approach_speed > 1.)
            .filter_map(|c| Some((self.terrain_contact(c)?, c.categories)))
    }
    pub(in crate::engine) fn store_terrain_event(
        &mut self,
        record: TerrainImpactRecord,
    ) -> Option<GameplayEvent> {
        if self.contacts.terrain_events.len() >= MAX_TERRAIN_EVENTS {
            self.contacts.terrain_dropped = self.contacts.terrain_dropped.saturating_add(1);
            return None;
        }
        let index = self.contacts.terrain_events.len() as u32;
        self.contacts.terrain_events.push(record);
        Some(GameplayEvent {
            kind: GAMEPLAY_EVENT_TERRAIN_IMPACT,
            actor_id: record.actor[0],
            actor_generation: record.actor[1],
            source_id: u32::MAX,
            source_generation: 0,
            token_id: record.terrain[0],
            flags: record.flags,
            payload_bits: index,
        })
    }
}
impl Engine {
    pub(super) fn record_native_terrain_contacts(&mut self) {
        let Some(rt) = self.unified_physics.as_mut() else {
            return;
        };
        for index in 0..rt.contacts.native.len() {
            let c = &rt.contacts.native[index];
            if c.normal_impulse <= 0.0001 {
                continue;
            }
            let Some(record) = rt.terrain_contact(c) else {
                continue;
            };
            if let Some(event) = rt.store_terrain_event(record) {
                self.frame_buffers.gameplay_events.push(event);
            }
        }
    }
}
#[wasm_bindgen]
impl Engine {
    pub fn terrain_impact_version(&self) -> u32 {
        1
    }
    pub fn terrain_impact_stride_words(&self) -> usize {
        24
    }
    pub fn terrain_impact_count(&self) -> usize {
        self.unified_physics
            .as_ref()
            .map_or(0, |r| r.contacts.terrain_events.len())
    }
    pub fn terrain_impact_dropped(&self) -> u32 {
        self.unified_physics
            .as_ref()
            .map_or(0, |r| r.contacts.terrain_dropped)
    }
    pub fn terrain_impact_ptr(&self) -> *const u32 {
        self.unified_physics.as_ref().map_or(std::ptr::null(), |r| {
            r.contacts.terrain_events.as_ptr().cast()
        })
    }
}
impl TerrainImpactRecord {
    pub(super) fn validate_file(
        &self,
        b: &mut crate::engine::file_physics_output_admission::Budget,
        index: usize,
    ) -> Result<(), crate::engine::file_physics_output_admission::Error> {
        use crate::engine::file_physics_output_admission::{finite, require, Problem};
        b.work(24)?;
        require(
            [1, 2].contains(&self.kind)
                && self.flags <= 4
                && self.flags & !4 == 0
                && self.actor[0] != u32::MAX
                && (self.terrain[0] == 1
                    || self.terrain[0] == 2
                        && self.terrain[1] > 0
                        && self.terrain[1] <= 65535
                        && self.terrain[2] == 0)
                && finite(&self.point)
                && finite(&self.normal)
                && self.impulse.is_finite()
                && self.impulse >= 0.
                && self.approach_speed.is_finite()
                && self.approach_speed >= 0.
                && self.fraction.is_finite()
                && (0. ..=1.).contains(&self.fraction)
                && (self.kind != 1 || self.fraction == 0.)
                && (self.kind != 2 || self.impulse == 0. && self.approach_speed == 0.),
            "terrain_events",
            "row",
            index,
            Problem::Number,
        )
    }
}
