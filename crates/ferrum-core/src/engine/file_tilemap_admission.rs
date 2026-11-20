//! Tilemap and its separately persisted navigation scratch only. No execution,
//! repair, resource admission or whole Engine/Ready claim is made here.
use super::Engine;
pub(crate) use crate::tilemap::file_admission::{Error, Limits, Usage};
pub(crate) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = crate::tilemap::file_admission::Budget::new(limits);
    crate::tilemap::file_admission::validate_with_budget(&engine.tilemap, &mut budget)?;
    engine
        .tilemap_navigation_scratch
        .validate_file(&mut budget)?;
    Ok(budget.usage)
}
#[cfg(test)]
mod tests;
