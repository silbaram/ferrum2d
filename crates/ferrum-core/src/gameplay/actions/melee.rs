use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MeleeActionPayload {
    pub(crate) range: f32,
    pub(crate) damage: f32,
    pub(crate) target: MeleeTarget,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MeleeActionPlan {
    pub(crate) center: Transform2D,
    pub(crate) range: f32,
    pub(crate) damage: f32,
    pub(crate) target: MeleeTarget,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MeleeAttackCoreData {
    pub(crate) attacker: Entity,
    pub(crate) center: Transform2D,
    pub(crate) range: f32,
    pub(crate) damage: f32,
    pub(crate) target: MeleeTarget,
    pub(crate) height_span: Option<HeightSpan>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MeleeActionPlanError {
    UnsupportedTarget,
    MissingActionTarget,
}

pub(crate) fn validate_queued_melee_action_support(
    _payload: MeleeActionPayload,
) -> Result<(), MeleeActionPlanError> {
    Ok(())
}

pub(crate) fn validate_input_melee_action_support(
    payload: MeleeActionPayload,
) -> Result<(), MeleeActionPlanError> {
    if payload.target != MeleeTarget::Enemies {
        return Err(MeleeActionPlanError::UnsupportedTarget);
    }
    Ok(())
}

pub(crate) fn plan_melee_action(
    payload: MeleeActionPayload,
    source: Entity,
    source_transform: Transform2D,
    target: Option<Entity>,
) -> Result<MeleeActionPlan, MeleeActionPlanError> {
    validate_queued_melee_action_support(payload)?;
    if payload.target == MeleeTarget::Player {
        let Some(target) = target else {
            return Err(MeleeActionPlanError::MissingActionTarget);
        };
        if target == source {
            return Err(MeleeActionPlanError::MissingActionTarget);
        }
    }
    Ok(MeleeActionPlan {
        center: source_transform,
        range: payload.range,
        damage: payload.damage,
        target: payload.target,
    })
}

pub(crate) fn plan_input_melee_action(
    payload: MeleeActionPayload,
    source_transform: Transform2D,
) -> Result<MeleeActionPlan, MeleeActionPlanError> {
    validate_input_melee_action_support(payload)?;
    Ok(MeleeActionPlan {
        center: source_transform,
        range: payload.range,
        damage: payload.damage,
        target: payload.target,
    })
}

pub(crate) const fn melee_attack_core_data_from_plan(
    attacker: Entity,
    plan: MeleeActionPlan,
    height_span: Option<HeightSpan>,
) -> MeleeAttackCoreData {
    MeleeAttackCoreData {
        attacker,
        center: plan.center,
        range: plan.range,
        damage: plan.damage,
        target: plan.target,
        height_span,
    }
}

pub(crate) const fn melee_attack_query_mask(target: MeleeTarget) -> CollisionMask {
    match target {
        MeleeTarget::Enemies => CollisionMask::ENEMY,
        MeleeTarget::Player => CollisionMask::PLAYER,
    }
}

pub(crate) fn run_melee_attack_query(
    world: &World,
    center: Transform2D,
    range: f32,
    target: MeleeTarget,
    height_span: Option<HeightSpan>,
    hits: &mut Vec<CircleQueryHit>,
) -> usize {
    CollisionSystem::circle_query_with_height_span_into(
        world,
        center,
        range,
        melee_attack_query_mask(target),
        height_span,
        hits,
    );
    hits.len()
}

pub(crate) fn melee_attack_attacker_can_resolve(
    world: &World,
    attacker: Entity,
    target: MeleeTarget,
    marked_for_despawn: &[bool],
) -> bool {
    let attacker_index = attacker.id as usize;
    if marked_for_despawn
        .get(attacker_index)
        .copied()
        .unwrap_or(true)
    {
        return false;
    }
    match target {
        MeleeTarget::Enemies | MeleeTarget::Player => world.is_alive_index(attacker_index),
    }
}

pub(crate) fn melee_attack_target_can_receive_hit(
    world: &World,
    target: Entity,
    melee_target: MeleeTarget,
    marked_for_despawn: &[bool],
) -> bool {
    let target_index = target.id as usize;
    if marked_for_despawn
        .get(target_index)
        .copied()
        .unwrap_or(true)
    {
        return false;
    }
    match melee_target {
        MeleeTarget::Enemies => is_alive_layer(world, target_index, CollisionLayer::Enemy),
        MeleeTarget::Player => is_alive_layer(world, target_index, CollisionLayer::Player),
    }
}

pub(crate) const fn melee_action_plan_failure_reason(error: MeleeActionPlanError) -> u32 {
    match error {
        MeleeActionPlanError::UnsupportedTarget => {
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET
        }
        MeleeActionPlanError::MissingActionTarget => GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
    }
}

#[cfg(test)]
pub(crate) fn prepare_melee_action_payload(
    world: &World,
    entity: Entity,
    action_id: u32,
) -> Result<MeleeActionPayload, ActionReadiness> {
    let readiness = prepare_action_if_ready(world, entity, action_id, ActionPatternKind::Melee);
    let ActionReadiness::Ready(prepared) = readiness else {
        return Err(readiness);
    };
    melee_action_payload_from_binding(prepared.binding)
}

#[cfg(test)]
pub(crate) const fn melee_action_payload_from_binding(
    binding: ActionBinding,
) -> Result<MeleeActionPayload, ActionReadiness> {
    let ActionPattern::Melee {
        range,
        damage,
        target,
    } = binding.pattern
    else {
        return Err(ActionReadiness::PatternMismatch);
    };
    Ok(MeleeActionPayload {
        range,
        damage,
        target,
    })
}
