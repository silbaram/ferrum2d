use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DashActionPayload {
    pub(crate) distance: f32,
    pub(crate) aim: ActionAimSource,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DashActionCoreData {
    pub(crate) entity: Entity,
    pub(crate) transform: Transform2D,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DashActionPlanError {
    UnsupportedAimSource,
    MissingActionTarget,
}

pub(in crate::gameplay) fn normalized_direction(dx: f32, dy: f32) -> Option<Velocity> {
    let len = (dx * dx + dy * dy).sqrt();
    if !len.is_finite() || len <= 0.0001 {
        return None;
    }
    Some(Velocity {
        vx: dx / len,
        vy: dy / len,
    })
}

pub(crate) fn plan_dash_action_transform(
    payload: DashActionPayload,
    source: Entity,
    source_transform: Transform2D,
    target: Option<(Entity, Transform2D)>,
) -> Result<Transform2D, DashActionPlanError> {
    if payload.aim != ActionAimSource::TargetPlayer {
        return Err(DashActionPlanError::UnsupportedAimSource);
    }
    let Some((target_entity, target_transform)) = target else {
        return Err(DashActionPlanError::MissingActionTarget);
    };
    if target_entity == source {
        return Err(DashActionPlanError::MissingActionTarget);
    }
    let dx = target_transform.x - source_transform.x;
    let dy = target_transform.y - source_transform.y;
    let direction = normalized_direction(dx, dy).ok_or(DashActionPlanError::MissingActionTarget)?;
    Ok(Transform2D {
        x: source_transform.x + direction.vx * payload.distance,
        y: source_transform.y + direction.vy * payload.distance,
    })
}

pub(crate) const fn dash_action_plan_failure_reason(error: DashActionPlanError) -> u32 {
    match error {
        DashActionPlanError::UnsupportedAimSource => GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
        DashActionPlanError::MissingActionTarget => GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
    }
}

pub(crate) fn plan_input_dash_action_transform(
    payload: DashActionPayload,
    source_transform: Transform2D,
    input_direction: Velocity,
    aim_target: Transform2D,
) -> Result<Transform2D, DashActionPlanError> {
    if payload.aim != ActionAimSource::Input {
        return Err(DashActionPlanError::UnsupportedAimSource);
    }
    let direction = normalized_direction(input_direction.vx, input_direction.vy)
        .or_else(|| {
            normalized_direction(
                aim_target.x - source_transform.x,
                aim_target.y - source_transform.y,
            )
        })
        .unwrap_or(Velocity { vx: 1.0, vy: 0.0 });
    Ok(Transform2D {
        x: source_transform.x + direction.vx * payload.distance,
        y: source_transform.y + direction.vy * payload.distance,
    })
}

pub(crate) const fn dash_action_core_data_from_plan(
    entity: Entity,
    transform: Transform2D,
) -> DashActionCoreData {
    DashActionCoreData { entity, transform }
}

pub(crate) fn apply_dash_action_core_data(world: &mut World, data: DashActionCoreData) {
    world.set_transform(data.entity, data.transform);
}

#[cfg(test)]
pub(crate) fn prepare_dash_action_payload(
    world: &World,
    entity: Entity,
    action_id: u32,
) -> Result<DashActionPayload, ActionReadiness> {
    let readiness = prepare_action_if_ready(world, entity, action_id, ActionPatternKind::Dash);
    let ActionReadiness::Ready(prepared) = readiness else {
        return Err(readiness);
    };
    dash_action_payload_from_binding(prepared.binding)
}

#[cfg(test)]
pub(crate) const fn dash_action_payload_from_binding(
    binding: ActionBinding,
) -> Result<DashActionPayload, ActionReadiness> {
    let ActionPattern::Dash { distance, aim } = binding.pattern else {
        return Err(ActionReadiness::PatternMismatch);
    };
    Ok(DashActionPayload { distance, aim })
}
