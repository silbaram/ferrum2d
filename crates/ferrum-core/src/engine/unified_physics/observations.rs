//! Versioned numeric observations preserving identity before entities/terrain retire.
use super::collision_stream::Participant;
use super::{BodyId, Entity, UnifiedTerrainSource};
use crate::physics3d::{CcdClamp, ColliderId, ContactImpulse, StepStatistics};
use std::collections::BTreeMap;

type Entities = BTreeMap<BodyId, Entity>;
type Terrain = BTreeMap<ColliderId, UnifiedTerrainSource>;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct ManifoldRecord {
    pub first: Participant,
    pub second: Participant,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub subshapes: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub normal: [f32; 3],
    pub offset: u32,
    pub count: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct PointRecord {
    #[serde(with = "crate::checkpoint_codec::array")]
    pub first: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub second: [f32; 3],
    pub penetration: f32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct ImpulseRecord {
    pub first: Participant,
    pub second: Participant,
    pub categories: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub point: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub normal: [f32; 3],
    pub normal_impulse: f32,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub tangent_impulse: [f32; 3],
    pub approach_speed: f32,
}
impl ImpulseRecord {
    pub(super) fn new(hit: &ContactImpulse, entities: &Entities, terrain: &Terrain) -> Self {
        Self {
            first: Participant::new(hit.first, entities, terrain),
            second: Participant::new(hit.second, entities, terrain),
            categories: hit.categories,
            point: hit.point,
            normal: hit.normal,
            normal_impulse: hit.normal_impulse,
            tangent_impulse: hit.tangent_impulse,
            approach_speed: hit.approach_speed,
        }
    }
}
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct CcdRecord {
    pub moving: Participant,
    pub target: Participant,
    pub fraction: f32,
    pub sweep_seconds: f32,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub point: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    pub normal: [f32; 3],
}
impl CcdRecord {
    pub(super) fn new(hit: &CcdClamp, entities: &Entities, terrain: &Terrain) -> Self {
        Self {
            moving: Participant::new(hit.moving, entities, terrain),
            target: Participant::new(hit.target, entities, terrain),
            fraction: hit.fraction,
            sweep_seconds: hit.sweep_seconds,
            point: hit.point,
            normal: hit.normal,
        }
    }
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct DiagnosticsRecord {
    pub backend: u32,
    pub capabilities: u32,
    pub fixed_steps: u32,
    pub authored_joint_breaks: u32,
    pub ccd_observations_dropped: u32,
    pub solved_contacts: u32,
    pub impulses_dropped: u32,
    pub step: StepStatistics,
    pub frame: StepStatistics,
}
const _: () = assert!(std::mem::size_of::<ManifoldRecord>() == 27 * 4);
const _: () = assert!(std::mem::size_of::<PointRecord>() == 7 * 4);
const _: () = assert!(std::mem::size_of::<ImpulseRecord>() == 32 * 4);
const _: () = assert!(std::mem::size_of::<CcdRecord>() == 28 * 4);
const _: () = assert!(std::mem::size_of::<StepStatistics>() == 32 * 4);
const _: () = assert!(std::mem::size_of::<DiagnosticsRecord>() == 71 * 4);
const _: () = assert!(std::mem::align_of::<DiagnosticsRecord>() == 4);
const _: () = assert!(std::mem::align_of::<ManifoldRecord>() == 4);
const _: () = assert!(std::mem::align_of::<ImpulseRecord>() == 4);
const _: () = assert!(std::mem::align_of::<CcdRecord>() == 4);

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct ObservationBuffers {
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) manifolds: Vec<ManifoldRecord>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) points: Vec<PointRecord>,
    pub(super) truncated: bool,
    pub(super) total_manifolds: u32,
    pub(super) total_points: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) impulses: Vec<ImpulseRecord>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) clamps: Vec<CcdRecord>,
    pub(super) diagnostics: DiagnosticsRecord,
}
impl ObservationBuffers {
    pub(super) fn clear_contacts(&mut self) {
        self.manifolds.clear();
        self.points.clear();
        self.truncated = false;
        self.total_manifolds = 0;
        self.total_points = 0;
    }
    pub(super) fn clear_observations(&mut self) {
        self.impulses.clear();
        self.clamps.clear();
        self.diagnostics = DiagnosticsRecord::default();
    }
}

mod file_output_admission;
