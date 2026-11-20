//! Readonly admission of SpatialScene and authoring continuity, including its
//! delegated Tilemap/kinematic scratch owners. Bounded decode, World/native
//! payloads and host/GPU resource/session/fence admission remain prerequisites.
//! This helper never publishes an Engine or makes a whole-file Ready claim.
use super::Engine;
pub(crate) use crate::spatial_scene::file_admission::{Error, Limits, Usage};
#[allow(dead_code)] // Detached Engine candidate integration is Root-owned.
pub(in crate::engine) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = crate::spatial_scene::file_admission::Budget::new(limits);
    crate::spatial_scene::file_admission::validate_root(
        &engine.spatial_scene,
        &engine.world,
        &mut budget,
    )?;
    engine.authoring_continuity.validate_file(&mut budget)?;
    let remaining = budget.remaining();
    let usage = crate::tilemap::file_admission::validate(
        &engine.spatial_scene.physics,
        crate::tilemap::file_admission::Limits {
            max_work: remaining.max_work,
            max_scratch_bytes: remaining.max_scratch_bytes,
        },
    )
    .map_err(|e| match e {
        crate::tilemap::file_admission::Error::WorkLimit => Error::WorkLimit,
        crate::tilemap::file_admission::Error::ScratchLimit => Error::ScratchLimit,
        crate::tilemap::file_admission::Error::Allocation => Error::Allocation,
        other => Error::Tilemap(other),
    })?;
    budget.external(Usage {
        work: usage.work,
        scratch_bytes: usage.scratch_bytes,
    })?;
    crate::spatial_scene::file_admission::validate_movement(
        &engine.spatial_scene,
        &engine.world,
        &mut budget,
    )?;
    Ok(budget.usage)
}
#[cfg(test)]
mod tests;
