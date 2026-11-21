//! Complete stored DataSceneGameplay/Combat payload after bounded decode,
//! World/native, resource/alias and native-controller admission. The separate
//! CombatNavigation.native controller is not visited twice. No update/query runs.
use super::Engine;
use crate::gameplay::file_admission::{require, Budget, Problem};
pub(crate) use crate::gameplay::file_admission::{Error, Limits, Usage};
pub(crate) fn validate(e: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut b = Budget::new(limits);
    e.data_scene
        .gameplay
        .validate_file(&e.world, &e.spatial_scene, &mut b)?;
    Ok(b.usage())
}
pub(in crate::engine) fn unique_entities(
    rows: impl ExactSizeIterator<Item = (u32, u32)>,
    b: &mut Budget,
    owner: &'static str,
    field: &'static str,
) -> Result<(), Error> {
    let n = rows.len();
    b.work(n)?;
    b.sort(n)?;
    let mut keys = b.reserve::<(u32, u32)>(n)?;
    keys.extend(rows);
    keys.sort_unstable();
    b.work(n)?;
    require(
        !keys.windows(2).any(|w| w[0] == w[1]),
        owner,
        field,
        0,
        Problem::Duplicate,
    )
}

#[cfg(test)]
mod tests;
