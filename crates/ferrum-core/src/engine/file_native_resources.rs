//! Cold dependency facts from an already admitted immutable Native cut.
//! Stored IDs are not evidence of loaded resources, content, historical entity
//! existence, or platform object identity. No owner is rebuilt or rebound.
use super::Engine;
use crate::entity::Entity;
use crate::gameplay::file_admission::Budget;
pub(super) use crate::gameplay::file_admission::{Error, Limits, Usage};
mod scan;
#[cfg(test)]
mod tests;
mod visual;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Domain {
    Texture,
    Model,
    Font,
    DirectSound,
    ParticlePreset,
    /// This is an SDK presentation registry key, even when effect_type == SOUND.
    PresentationEffect {
        effect_type: u32,
    },
    AnimationClip,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Owner {
    BuiltinProgramTexture,
    WorldSprite,
    WorldGroundShadow,
    ActorGroundShadow,
    WorldPlayback,
    WorldReaction,
    ProjectilePrefab,
    ActorPrototype,
    ActorBillboard,
    AuthoredDefinition,
    AuthoringSnapshot,
    MovementPose,
    ContinuityClip,
    ContinuityModel,
    TileMain,
    TileNavigation,
    TileSpatialPhysics,
    Particle,
    ParticlePreset,
    ShooterHitPreset,
    BitmapFont,
    BitmapText,
    BitmapCachedCommand,
    ShooterTextureCatalog,
    ShooterSpawnCommand,
    ShooterSoundCatalog,
    SpatialSurface,
    SpatialVertex,
    SpatialNormal,
    SpatialBillboard,
    SpatialRuntimeBillboard,
    ModelBinding,
    ModelLod,
    ModelDraw,
    ImpactFeedback,
    FrameCommand,
    FrameItem,
    FrameNormal,
    FrameSurface,
    FrameAudio,
    FrameEffect,
    FrameGameplayEffect,
    FrameGameplayClip,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Role {
    Base,
    Normal,
    Emission,
    Specular,
    Roughness,
    Clip,
    Sound,
    Preset,
    Effect,
    Font,
    Model,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum StoredId {
    U32(u32),
    /// Preserve the stored numeric packet exactly. Existing output admission
    /// permits finite signed/fractional IDs. No lossy u32 cast or new rejection.
    F32Bits(u32),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Provenance {
    StoredField,
    ProgramConstant,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Reference {
    pub owner: Owner,
    pub provenance: Provenance,
    /// Stable owner-defined path: stored key/ordinal, sub-buffer, sub-ordinal.
    /// All vector ordinals and duplicates remain distinguishable. Font HashMap
    /// keys use their numeric IDs, not iteration/address order.
    pub path: [u32; 4],
    /// Only populated where the owner actually stores an entity handle.
    /// This never asserts that the handle is currently live or ever was live.
    pub entity: Option<Entity>,
    pub domain: Domain,
    pub role: Role,
    pub value: StoredId,
    /// Owner-specific scalar or documented boolean packing; never a universal
    /// enabled/loaded bit. F32 packet flags retain their exact bits.
    pub flags: u32,
    /// An owner-defined absence marker, kept alongside the raw value. ID0 is
    /// retained; it is never globally interpreted as absence.
    pub absence_sentinel: Option<u32>,
}
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Inventory {
    pub references: Vec<Reference>,
}
fn index(n: usize) -> Result<u32, Error> {
    u32::try_from(n).map_err(|_| Error::WorkLimit)
}
#[allow(clippy::too_many_arguments)] // Fixed cold DTO record, not a public API.
fn row(
    owner: Owner,
    path: [u32; 4],
    entity: Option<Entity>,
    domain: Domain,
    role: Role,
    value: StoredId,
    flags: u32,
    absence_sentinel: Option<u32>,
) -> Reference {
    Reference {
        owner,
        provenance: Provenance::StoredField,
        path,
        entity,
        domain,
        role,
        value,
        flags,
        absence_sentinel,
    }
}
/// All admission/alias owners must have succeeded on this exact Engine first.
/// Both traversal passes, canonical metadata sort and fallible output reserve
/// share the caller's remaining ledger. Retained output is logical scratch,
/// not an actual heap/RSS ceiling.
pub(super) fn capture_after_admission(
    engine: &Engine,
    limits: Limits,
) -> Result<(Inventory, Usage), Error> {
    let mut b = Budget::new(limits);
    b.work(2)?;
    b.nested(Usage {
        work: 0,
        scratch_bytes: std::mem::size_of::<Inventory>(),
    })?;
    let mut count = 0usize;
    scan::visit(engine, &mut b, &mut |_| {
        count = count.checked_add(1).ok_or(Error::WorkLimit)?;
        Ok(())
    })?;
    let mut references = b.reserve(count)?;
    scan::visit(engine, &mut b, &mut |v| {
        references.push(v);
        Ok(())
    })?;
    // Only output metadata is sorted. Stored paths preserve every vector's
    // order and raw duplicates; equal rows never imply equal Arc/resource data.
    b.sort(references.len())?;
    references.sort_unstable_by_key(|r| {
        (
            r.owner,
            r.provenance,
            r.path,
            r.entity.map(|e| (e.id, e.generation)),
            r.domain,
            r.role,
            r.value,
            r.flags,
            r.absence_sentinel,
        )
    });
    Ok((Inventory { references }, b.usage()))
}
