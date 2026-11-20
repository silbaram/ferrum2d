//! Only the two dedicated collision scratch fields and rigid-step scratch.
//! World/native admission is separate; no query/cache refresh is performed.
use super::Engine;
use crate::collision::file_scratch_admission::Budget;
pub(crate) use crate::collision::file_scratch_admission::{Error, Limits, Usage};
pub(crate) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut b = Budget::new(limits);
    engine
        .physics_debug_collision_scratch
        .validate_file_with_budget(&mut b)?;
    engine
        .physics_collision_query_scratch
        .validate_file_with_budget(&mut b)?;
    engine
        .rigid_body_step_scratch
        .validate_file_with_budget(&mut b)?;
    Ok(b.usage)
}
#[cfg(test)]
mod tests;
