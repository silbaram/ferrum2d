use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ProjectileActionPayload {
    pub(crate) speed: f32,
    pub(crate) damage: f32,
    pub(crate) lifetime_seconds: f32,
    pub(crate) aim: ActionAimSource,
    pub(crate) collision_target: ProjectileCollisionTarget,
    pub(crate) tile_impact: ProjectileTileImpact,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ProjectileSpawnPlan {
    pub(crate) direction_x: f32,
    pub(crate) direction_y: f32,
    pub(crate) transform: Transform2D,
    pub(crate) velocity: Velocity,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ProjectileSpawnCoreData {
    pub(crate) transform: Transform2D,
    pub(crate) velocity: Velocity,
    pub(crate) lifetime_seconds: f32,
    pub(crate) damage: f32,
    pub(crate) collision_target: ProjectileCollisionTarget,
    pub(crate) tile_impact: ProjectileTileImpact,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ProjectileEntitySpawnData {
    pub(crate) request: ProjectileSpawnRequest,
    pub(crate) arc: Option<ProjectileArc>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ProjectileEntitySpawnResult {
    pub(crate) spawned: Entity,
    pub(crate) arc_applied: bool,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PrefabEnemyEntitySpawnData {
    pub(crate) transform: Transform2D,
    pub(crate) texture_id: u32,
    pub(crate) template: EntityTemplate,
    pub(crate) health: f32,
    pub(crate) score_reward: u32,
}

#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PrefabEnemyEntitySpawnResult {
    pub(crate) spawned: Entity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectileActionPlanError {
    UnsupportedAimSource,
    UnsupportedCollisionTarget,
    MissingActionTarget,
}

pub(crate) fn validate_projectile_action_support(
    payload: ProjectileActionPayload,
) -> Result<(), ProjectileActionPlanError> {
    if payload.aim != ActionAimSource::TargetPlayer {
        return Err(ProjectileActionPlanError::UnsupportedAimSource);
    }
    if payload.collision_target != ProjectileCollisionTarget::Player {
        return Err(ProjectileActionPlanError::UnsupportedCollisionTarget);
    }
    Ok(())
}

pub(crate) fn validate_input_projectile_action_support(
    payload: ProjectileActionPayload,
) -> Result<(), ProjectileActionPlanError> {
    if payload.aim != ActionAimSource::Input {
        return Err(ProjectileActionPlanError::UnsupportedAimSource);
    }
    if payload.collision_target != ProjectileCollisionTarget::Enemies {
        return Err(ProjectileActionPlanError::UnsupportedCollisionTarget);
    }
    Ok(())
}

pub(crate) fn plan_projectile_action_toward_target(
    payload: ProjectileActionPayload,
    source: Entity,
    source_transform: Transform2D,
    target: Option<(Entity, Transform2D)>,
    spawn_offset: f32,
) -> Result<ProjectileSpawnPlan, ProjectileActionPlanError> {
    validate_projectile_action_support(payload)?;
    let Some((target_entity, target_transform)) = target else {
        return Err(ProjectileActionPlanError::MissingActionTarget);
    };
    if target_entity == source {
        return Err(ProjectileActionPlanError::MissingActionTarget);
    }
    let dx = target_transform.x - source_transform.x;
    let dy = target_transform.y - source_transform.y;
    let len = (dx * dx + dy * dy).sqrt();
    if len <= 0.0001 {
        return Err(ProjectileActionPlanError::MissingActionTarget);
    }
    let direction_x = dx / len;
    let direction_y = dy / len;
    Ok(ProjectileSpawnPlan {
        direction_x,
        direction_y,
        transform: Transform2D {
            x: source_transform.x + direction_x * spawn_offset,
            y: source_transform.y + direction_y * spawn_offset,
        },
        velocity: Velocity {
            vx: direction_x * payload.speed,
            vy: direction_y * payload.speed,
        },
    })
}

pub(crate) fn plan_input_projectile_action(
    payload: ProjectileActionPayload,
    source_transform: Transform2D,
    aim_target: Transform2D,
    spawn_offset: f32,
) -> Result<ProjectileSpawnPlan, ProjectileActionPlanError> {
    validate_input_projectile_action_support(payload)?;
    let direction = normalized_direction(
        aim_target.x - source_transform.x,
        aim_target.y - source_transform.y,
    )
    .unwrap_or(Velocity { vx: 1.0, vy: 0.0 });
    Ok(ProjectileSpawnPlan {
        direction_x: direction.vx,
        direction_y: direction.vy,
        transform: Transform2D {
            x: source_transform.x + direction.vx * spawn_offset,
            y: source_transform.y + direction.vy * spawn_offset,
        },
        velocity: Velocity {
            vx: direction.vx * payload.speed,
            vy: direction.vy * payload.speed,
        },
    })
}

pub(crate) const fn projectile_spawn_core_data_from_plan(
    plan: ProjectileSpawnPlan,
    payload: ProjectileActionPayload,
) -> ProjectileSpawnCoreData {
    ProjectileSpawnCoreData {
        transform: plan.transform,
        velocity: plan.velocity,
        lifetime_seconds: payload.lifetime_seconds,
        damage: payload.damage,
        collision_target: payload.collision_target,
        tile_impact: payload.tile_impact,
    }
}

pub(crate) fn spawn_projectile_entity(
    world: &mut World,
    data: ProjectileEntitySpawnData,
) -> ProjectileEntitySpawnResult {
    let bullet = world.spawn_projectile_from_request(data.request);
    let arc_applied = if let Some(arc) = data.arc {
        world.set_projectile_arc(bullet, arc);
        true
    } else {
        false
    };
    ProjectileEntitySpawnResult {
        spawned: bullet,
        arc_applied,
    }
}

#[cfg(test)]
pub(crate) fn spawn_prefab_enemy_entity(
    world: &mut World,
    data: PrefabEnemyEntitySpawnData,
) -> PrefabEnemyEntitySpawnResult {
    let spawned = world.spawn_enemy_from_template(
        data.transform.x,
        data.transform.y,
        data.texture_id,
        data.template,
        data.health,
        data.score_reward,
    );
    PrefabEnemyEntitySpawnResult { spawned }
}

pub(crate) const fn projectile_action_plan_failure_reason(error: ProjectileActionPlanError) -> u32 {
    match error {
        ProjectileActionPlanError::UnsupportedAimSource => {
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE
        }
        ProjectileActionPlanError::UnsupportedCollisionTarget => {
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET
        }
        ProjectileActionPlanError::MissingActionTarget => {
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET
        }
    }
}

#[cfg(test)]
pub(crate) fn prepare_projectile_action_payload(
    world: &World,
    entity: Entity,
    action_id: u32,
) -> Result<ProjectileActionPayload, ActionReadiness> {
    let readiness =
        prepare_action_if_ready(world, entity, action_id, ActionPatternKind::Projectile);
    let ActionReadiness::Ready(prepared) = readiness else {
        return Err(readiness);
    };
    projectile_action_payload_from_binding(prepared.binding)
}

#[cfg(test)]
pub(crate) const fn projectile_action_payload_from_binding(
    binding: ActionBinding,
) -> Result<ProjectileActionPayload, ActionReadiness> {
    let ActionPattern::Projectile {
        speed,
        damage,
        lifetime_seconds,
        aim,
        collision_target,
        tile_impact,
    } = binding.pattern
    else {
        return Err(ActionReadiness::PatternMismatch);
    };
    Ok(ProjectileActionPayload {
        speed,
        damage,
        lifetime_seconds,
        aim,
        collision_target,
        tile_impact,
    })
}
