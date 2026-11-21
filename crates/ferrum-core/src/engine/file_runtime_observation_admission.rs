//! Cold admission of eleven internal native-runtime observation owners.
//! World/native ownership and the outer Engine output roots are separate passes.
pub(crate) use super::file_physics_output_admission::{Error, Limits, Usage};
use super::{file_physics_output_admission::Budget, Engine};

pub(crate) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = Budget::new(limits);
    budget.work(11)?;
    if let Some(runtime) = &engine.unified_physics {
        runtime.validate_file_observations(
            &mut budget,
            &engine.frame_buffers.gameplay_events,
            &engine.world,
        )?;
    } else {
        budget.work(engine.frame_buffers.gameplay_events.len())?;
        super::file_physics_output_admission::require(
            !engine
                .frame_buffers
                .gameplay_events
                .iter()
                .any(|e| e.kind == crate::gameplay_event::GAMEPLAY_EVENT_TERRAIN_IMPACT),
            "terrain_events",
            "native_owner_absent",
            0,
            super::file_physics_output_admission::Problem::Graph,
        )?;
    }
    Ok(budget.usage())
}
