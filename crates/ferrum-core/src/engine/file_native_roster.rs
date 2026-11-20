//! Cold facts from the already-admitted immutable Native cut. Not SDK metadata,
//! historical entity authentication, resource content admission, or a Ready token.
use super::{scenes::SceneMode, Engine};
use crate::entity::Entity;
use crate::gameplay::file_admission::{Budget, Problem};
use crate::gameplay_variables::{
    file_admission::Layout, GameplayVariableScope, GameplayVariableType,
};
use crate::physics3d::BodyId;

pub(super) use crate::gameplay::file_admission::{Error, Limits, Usage};
mod scan;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Scene {
    BuiltIn,
    Data,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Context {
    pub scene: Scene,
    /// Stored counter, not an authentication/session token. Meaningful as the
    /// current Data epoch only when scene == Data; the counter can wrap.
    pub stored_data_epoch: u32,
    pub spatial_revision: u32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Slot {
    pub generation: u32,
    pub alive: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum HandleFact {
    LiveExact,
    /// Says only that the backing slot exists. Does not prove the requested
    /// generation ever spawned, belonged to this epoch, or was an authored entity.
    StoredSlotNotCurrent {
        stored_generation: u32,
        slot_alive: bool,
    },
    UnknownSlot,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Variable {
    pub slot: u32,
    pub variable_type: GameplayVariableType,
    pub scope: GameplayVariableScope,
    pub default_value: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct LiveEntity {
    pub handle: Entity,
    /// Same World-side flags as Data Scene progress; Native body bindings are
    /// separate rows. No authored kind/instanceId is invented for this entity.
    pub progress_flags: u32,
    pub sprite_present: bool,
    /// Stored depth-sort/project-ground bits; not current visibility.
    pub sprite_projection_flags: Option<u32>,
    pub legacy_animation_present: bool,
    pub playback_present: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TextureRole {
    Sprite,
    Normal,
    Emission,
    Specular,
    Roughness,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Texture {
    pub handle: Entity,
    pub role: TextureRole,
    pub id: u32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Clip {
    pub handle: Entity,
    pub ordinal: u32,
    pub id: u32,
    pub active: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ModelRole {
    Base { flags: u32 },
    Lod(u32),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Model {
    /// Stored relation; may be stale. classify_handle reports only current slot
    /// facts and never upgrades this relation to historical existence proof.
    pub handle: Entity,
    pub role: ModelRole,
    pub asset: u32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct BodyBinding {
    pub handle: Entity,
    pub body: BodyId,
    pub legacy: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Continuity {
    pub serial: u32,
    pub token: u32,
    pub epoch: u32,
    pub instance_count: u32,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ContinuityInstance {
    /// Native handoff does not retain handles. An ordinal is not an entity key.
    pub ordinal: u32,
    pub active_clip: Option<u32>,
    pub selected_lod: Option<u32>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct ContinuityReference {
    pub instance_ordinal: u32,
    pub reference_ordinal: u32,
    pub id: u32,
}
/// Flat typed bulk metadata; no ABI/export or persistent Engine field. Resource
/// rows prove stored IDs/roles only. Equal rows never assert equal Arc/content.
#[derive(Debug, PartialEq)]
pub(super) struct Roster {
    pub context: Context,
    pub variables: Vec<Variable>,
    pub slots: Vec<Slot>,
    pub live_entities: Vec<LiveEntity>,
    pub textures: Vec<Texture>,
    pub clips: Vec<Clip>,
    pub models: Vec<Model>,
    pub bodies: Vec<BodyBinding>,
    pub continuity: Option<Continuity>,
    pub continuity_instances: Vec<ContinuityInstance>,
    pub continuity_clips: Vec<ContinuityReference>,
    pub continuity_models: Vec<ContinuityReference>,
}
impl Roster {
    pub(super) fn classify_handle(&self, handle: Entity) -> HandleFact {
        match self.slots.get(handle.id as usize) {
            Some(s) if s.alive && s.generation == handle.generation => HandleFact::LiveExact,
            Some(s) => HandleFact::StoredSlotNotCurrent {
                stored_generation: s.generation,
                slot_alive: s.alive,
            },
            None => HandleFact::UnknownSlot,
        }
    }
}
#[derive(Clone, Copy)]
enum Fact {
    Variable(Variable),
    Slot(Slot),
    Entity(LiveEntity),
    Texture(Texture),
    Clip(Clip),
    Model(Model),
    Body(BodyBinding),
    Continuity(Continuity),
    ContinuityInstance(ContinuityInstance),
    ContinuityClip(ContinuityReference),
    ContinuityModel(ContinuityReference),
}
#[derive(Default)]
struct Counts {
    n: [usize; 10],
}
fn kind(f: Fact) -> Option<usize> {
    Some(match f {
        Fact::Variable(_) => 0,
        Fact::Slot(_) => 1,
        Fact::Entity(_) => 2,
        Fact::Texture(_) => 3,
        Fact::Clip(_) => 4,
        Fact::Model(_) => 5,
        Fact::Body(_) => 6,
        Fact::Continuity(_) => return None,
        Fact::ContinuityInstance(_) => 7,
        Fact::ContinuityClip(_) => 8,
        Fact::ContinuityModel(_) => 9,
    })
}
fn u32_count(n: usize) -> Result<u32, Error> {
    u32::try_from(n).map_err(|_| Error::WorkLimit)
}

/// Prerequisite: all currently connected native/World/owner/sharing admission
/// passes succeeded for this exact immutable Engine and actual variable Layout.
/// Only Candidate construction calls this in production. No re-admission/query.
///
/// Usage is logical work and cumulative requested output/fixed scratch payload.
/// Output Vecs stay alive with Candidate; scratch is NOT peak/RSS or temporary-only.
pub(super) fn capture_after_admission(
    engine: &Engine,
    variables: &Layout,
    limits: Limits,
) -> Result<(Roster, Usage), Error> {
    let mut b = Budget::new(limits);
    b.nested(Usage {
        work: 3,
        scratch_bytes: std::mem::size_of::<Counts>() + std::mem::size_of::<Roster>(),
    })?;
    let context = Context {
        scene: match engine.scene_mode {
            SceneMode::BuiltIn => Scene::BuiltIn,
            SceneMode::Data => Scene::Data,
        },
        stored_data_epoch: engine.data_scene.epoch,
        spatial_revision: engine.spatial_scene.revision,
    };
    let mut counts = Counts::default();
    scan::visit(engine, variables, &mut b, &mut |fact| {
        if let Some(k) = kind(fact) {
            counts.n[k] = counts.n[k].checked_add(1).ok_or(Error::WorkLimit)?;
        }
        Ok(())
    })?;
    let mut r = Roster {
        context,
        variables: b.reserve(counts.n[0])?,
        slots: b.reserve(counts.n[1])?,
        live_entities: b.reserve(counts.n[2])?,
        textures: b.reserve(counts.n[3])?,
        clips: b.reserve(counts.n[4])?,
        models: b.reserve(counts.n[5])?,
        bodies: b.reserve(counts.n[6])?,
        continuity: None,
        continuity_instances: b.reserve(counts.n[7])?,
        continuity_clips: b.reserve(counts.n[8])?,
        continuity_models: b.reserve(counts.n[9])?,
    };
    scan::visit(engine, variables, &mut b, &mut |fact| {
        match fact {
            Fact::Variable(v) => r.variables.push(v),
            Fact::Slot(v) => r.slots.push(v),
            Fact::Entity(v) => r.live_entities.push(v),
            Fact::Texture(v) => r.textures.push(v),
            Fact::Clip(v) => r.clips.push(v),
            Fact::Model(v) => r.models.push(v),
            Fact::Body(v) => r.bodies.push(v),
            Fact::Continuity(v) => r.continuity = Some(v),
            Fact::ContinuityInstance(v) => r.continuity_instances.push(v),
            Fact::ContinuityClip(v) => r.continuity_clips.push(v),
            Fact::ContinuityModel(v) => r.continuity_models.push(v),
        }
        Ok(())
    })?;
    Ok((r, b.usage()))
}

#[cfg(test)]
mod tests;
