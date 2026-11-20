//! Stored native-runtime payload after native storage/binding/share/controller
//! admission. Logical work/scratch only, not allocator/RSS or session readiness.
use super::Engine;
use crate::gameplay::file_admission::Budget;
pub(super) use crate::gameplay::file_admission::{Error, Limits, Usage};

pub(super) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = Budget::new(limits);
    budget.work(1)?;
    if let Some(runtime) = &engine.unified_physics {
        runtime.validate_file_payload(&mut budget)?;
    }
    Ok(budget.usage())
}
