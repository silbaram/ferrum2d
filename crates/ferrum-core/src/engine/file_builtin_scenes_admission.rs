//! Cold readonly BuiltInSceneSlots admission. World/native/decode and all output
//! owners precede this pass; no scene reset, step, query, rebuild or publication.
use super::Engine;
use crate::entity::Entity;
pub(crate) use crate::gameplay::file_admission::{finite, require, Budget, Limits, Problem, Usage};
use crate::world::World;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    Gameplay(crate::gameplay::file_admission::Error),
    Output(super::file_physics_output_admission::Error),
    Tilemap(crate::tilemap::file_admission::Error),
}
impl From<crate::gameplay::file_admission::Error> for Error {
    fn from(v: crate::gameplay::file_admission::Error) -> Self {
        use crate::gameplay::file_admission::Error as E;
        match v {
            E::WorkLimit => Self::WorkLimit,
            E::ScratchLimit => Self::ScratchLimit,
            E::Allocation => Self::Allocation,
            e => Self::Gameplay(e),
        }
    }
}
impl From<super::file_physics_output_admission::Error> for Error {
    fn from(v: super::file_physics_output_admission::Error) -> Self {
        use super::file_physics_output_admission::Error as E;
        match v {
            E::WorkLimit => Self::WorkLimit,
            E::ScratchLimit => Self::ScratchLimit,
            E::Allocation => Self::Allocation,
            e => Self::Output(e),
        }
    }
}
impl From<crate::tilemap::file_admission::Error> for Error {
    fn from(v: crate::tilemap::file_admission::Error) -> Self {
        use crate::tilemap::file_admission::Error as E;
        match v {
            E::WorkLimit => Self::WorkLimit,
            E::ScratchLimit => Self::ScratchLimit,
            E::Allocation => Self::Allocation,
            e => Self::Tilemap(e),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "built-in scene file admission rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
#[allow(dead_code)] // Candidate coordinator integration is Root-owned.
pub(in crate::engine) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut b = Budget::new(limits);
    engine.scenes.validate_file(&engine.world, &mut b)?;
    if let Some(runtime) = &engine.unified_physics {
        runtime.validate_file_builtin_leaves(&engine.world, &mut b)?;
    }
    Ok(b.usage())
}
pub(crate) fn entity_history(w: &World, e: Entity) -> bool {
    w.generation_at_index(e.id as usize).is_some_and(|g| {
        e.generation < g || e.generation == g && (w.is_current_entity(e) || g == u32::MAX)
    })
}
pub(crate) fn entity(
    w: &World,
    e: Entity,
    owner: &'static str,
    field: &'static str,
    i: usize,
) -> Result<(), Error> {
    require(entity_history(w, e), owner, field, i, Problem::Reference)?;
    Ok(())
}
pub(crate) fn template(
    v: &crate::world::EntityTemplate,
    b: &mut Budget,
    owner: &'static str,
    i: usize,
) -> Result<(), Error> {
    b.work(crate::world::EntityTemplate::file_payload_work_bound())?;
    require(
        v.file_payload_valid(),
        owner,
        "template",
        i,
        Problem::Number,
    )?;
    Ok(())
}
pub(crate) fn hit(
    v: &crate::tilemap::TilemapContactHit,
    b: &mut Budget,
    owner: &'static str,
    i: usize,
) -> Result<(), Error> {
    b.work(7)?;
    require(
        u32::try_from(v.layer_index).is_ok()
            && v.tile_index < isize::MAX as usize / std::mem::size_of::<u32>()
            && finite(&[v.normal_x, v.normal_y, v.penetration, v.point_x, v.point_y])
            && v.penetration >= 0.,
        owner,
        "tile_contact",
        i,
        Problem::Number,
    )?;
    Ok(())
}
#[cfg(test)]
mod tests;
