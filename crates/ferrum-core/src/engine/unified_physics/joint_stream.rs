//! One native drain feeds independent legacy diagnostics and opt-in Web lifecycle output.
use crate::entity::Entity;
use crate::physics3d::{BodyId, JointEvent, JointEventReason, JointId, JointState, PhysicsWorld3d};
use std::collections::BTreeMap;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct JointRecord {
    #[serde(with = "crate::checkpoint_codec::array")]
    pub joint: [u32; 2],
    pub code: u32,
    pub flags: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub entity_a: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub entity_b: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub body_a: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub body_b: [u32; 2],
    pub force: f32,
    pub torque: f32,
}
const _: () = assert!(std::mem::size_of::<JointRecord>() == 14 * 4);
const _: () = assert!(std::mem::align_of::<JointRecord>() == 4);
impl JointRecord {
    pub(super) fn new(
        id: JointId,
        code: u32,
        a: BodyId,
        b: BodyId,
        reaction: &JointState,
        entities: &BTreeMap<BodyId, Entity>,
    ) -> Self {
        let ea = entities.get(&a);
        let eb = entities.get(&b);
        Self {
            joint: [id.slot, id.generation],
            code,
            flags: u32::from(ea.is_some()) | (u32::from(eb.is_some()) << 1),
            entity_a: ea.map_or([0; 2], |e| [e.id, e.generation]),
            entity_b: eb.map_or([0; 2], |e| [e.id, e.generation]),
            body_a: [a.slot, a.generation],
            body_b: [b.slot, b.generation],
            force: reaction.force,
            torque: reaction.torque,
        }
    }
}
#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct JointBuffers {
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub states: Vec<JointRecord>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub events: Vec<JointRecord>,
    pub dropped_native: u32,
    pub dropped_events: u32,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct JointStream {
    enabled: bool,
    limit: usize,
    #[serde(with = "crate::checkpoint_codec::vector")]
    scratch: Vec<JointEvent>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending: Vec<JointRecord>,
    dropped_native: u32,
    dropped_events: u32,
    legacy_dropped: u32,
}
impl JointStream {
    pub fn new(limit: usize) -> Self {
        Self {
            enabled: false,
            limit,
            scratch: Vec::new(),
            pending: Vec::new(),
            dropped_native: 0,
            dropped_events: 0,
            legacy_dropped: 0,
        }
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled != enabled {
            self.enabled = enabled;
            self.pending.clear();
            self.dropped_native = 0;
            self.dropped_events = 0;
        }
    }
    pub fn capture(
        &mut self,
        physics: &mut PhysicsWorld3d,
        entities: &BTreeMap<BodyId, Entity>,
        legacy: &mut Vec<JointEvent>,
    ) {
        let dropped = physics
            .drain_joint_events(&mut self.scratch)
            .min(u32::MAX as usize) as u32;
        self.legacy_dropped = self.legacy_dropped.saturating_add(dropped);
        if self.enabled {
            self.dropped_native = self.dropped_native.saturating_add(dropped);
        }
        for e in self.scratch.drain(..) {
            if self.enabled {
                if self.pending.len() < self.limit {
                    let code = match e.reason {
                        JointEventReason::ForceLimit => 0,
                        JointEventReason::TorqueLimit => 1,
                        JointEventReason::ForceAndTorqueLimit => 2,
                        JointEventReason::Removed => 3,
                        JointEventReason::BodyRemoved => 4,
                    };
                    self.pending.push(JointRecord::new(
                        e.joint,
                        code,
                        e.body_a,
                        e.body_b,
                        &e.reaction,
                        entities,
                    ));
                } else {
                    self.dropped_events = self.dropped_events.saturating_add(1);
                }
            }
            if legacy.len() < self.limit {
                legacy.push(e);
            } else {
                self.legacy_dropped = self.legacy_dropped.saturating_add(1);
            }
        }
    }
    pub fn take_legacy_dropped(&mut self) -> u32 {
        std::mem::take(&mut self.legacy_dropped)
    }
    pub fn drain(&mut self, out: &mut JointBuffers) {
        out.events.clear();
        out.events.append(&mut self.pending);
        out.dropped_native = std::mem::take(&mut self.dropped_native);
        out.dropped_events = std::mem::take(&mut self.dropped_events);
    }
}

mod file_output_admission;

mod file_runtime_observation_admission;
