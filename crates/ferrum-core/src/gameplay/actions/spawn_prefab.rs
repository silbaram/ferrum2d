use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SpawnPrefabActionPayload {
    pub(crate) prefab_id: u32,
    pub(crate) projectile: Option<SpawnPrefabProjectilePayload>,
    pub(crate) anchor: SpawnAnchor,
    pub(crate) phase: SpawnPhase,
    pub(crate) offset_x: f32,
    pub(crate) offset_y: f32,
}

impl SpawnPrefabActionPayload {
    pub(crate) const fn placement(self) -> SpawnPrefabPlacement {
        SpawnPrefabPlacement {
            anchor: self.anchor,
            phase: self.phase,
            offset_x: self.offset_x,
            offset_y: self.offset_y,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SpawnPrefabPlacement {
    pub(crate) anchor: SpawnAnchor,
    pub(crate) phase: SpawnPhase,
    pub(crate) offset_x: f32,
    pub(crate) offset_y: f32,
}

impl SpawnPrefabPlacement {
    pub(crate) fn transform_from_source(self, source_transform: Transform2D) -> Transform2D {
        Transform2D {
            x: source_transform.x + self.offset_x,
            y: source_transform.y + self.offset_y,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SpawnPrefabActionPlan {
    pub(crate) prefab_id: u32,
    pub(crate) projectile: Option<SpawnPrefabProjectilePayload>,
    pub(crate) placement: SpawnPrefabPlacement,
    pub(crate) transform: Transform2D,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SpawnPrefabCoreData {
    pub(crate) source: Entity,
    pub(crate) action_id: u32,
    pub(crate) prefab_id: u32,
    pub(crate) projectile: Option<SpawnPrefabProjectilePayload>,
    pub(crate) transform: Transform2D,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PrefabSpawnedEventPayload {
    pub(crate) spawned: Entity,
    pub(crate) source: Entity,
    pub(crate) prefab_id: u32,
    pub(crate) action_id: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnPrefabActionPlanError {
    UnsupportedPrefab,
    UnsupportedAnchor,
    UnsupportedPhase,
    MissingSourceTransform,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnPrefabSupport {
    Supported,
    Unsupported,
}

pub(crate) fn validate_spawn_prefab_action_support(
    payload: SpawnPrefabActionPayload,
) -> Result<(), SpawnPrefabActionPlanError> {
    let placement = payload.placement();
    if placement.anchor != SpawnAnchor::SelfEntity {
        return Err(SpawnPrefabActionPlanError::UnsupportedAnchor);
    }
    if placement.phase != SpawnPhase::PrePhysics {
        return Err(SpawnPrefabActionPlanError::UnsupportedPhase);
    }
    Ok(())
}

pub(crate) fn plan_spawn_prefab_action(
    payload: SpawnPrefabActionPayload,
    source_transform: Option<Transform2D>,
) -> Result<SpawnPrefabActionPlan, SpawnPrefabActionPlanError> {
    validate_spawn_prefab_action_support(payload)?;
    let Some(source_transform) = source_transform else {
        return Err(SpawnPrefabActionPlanError::MissingSourceTransform);
    };
    let placement = payload.placement();
    Ok(SpawnPrefabActionPlan {
        prefab_id: payload.prefab_id,
        projectile: payload.projectile,
        placement,
        transform: placement.transform_from_source(source_transform),
    })
}

pub(crate) fn plan_supported_spawn_prefab_action(
    payload: SpawnPrefabActionPayload,
    source_transform: Option<Transform2D>,
    support: SpawnPrefabSupport,
) -> Result<SpawnPrefabActionPlan, SpawnPrefabActionPlanError> {
    if support == SpawnPrefabSupport::Unsupported {
        return Err(SpawnPrefabActionPlanError::UnsupportedPrefab);
    }
    plan_spawn_prefab_action(payload, source_transform)
}

pub(crate) const fn spawn_prefab_core_data_from_plan(
    source: Entity,
    action_id: u32,
    plan: SpawnPrefabActionPlan,
) -> SpawnPrefabCoreData {
    SpawnPrefabCoreData {
        source,
        action_id,
        prefab_id: plan.prefab_id,
        projectile: plan.projectile,
        transform: plan.transform,
    }
}

pub(crate) const fn prefab_spawned_event_payload(
    spawned: Entity,
    source: Entity,
    prefab_id: u32,
    action_id: u32,
) -> PrefabSpawnedEventPayload {
    PrefabSpawnedEventPayload {
        spawned,
        source,
        prefab_id,
        action_id,
    }
}

pub(crate) const fn spawn_prefab_action_plan_failure_reason(
    error: SpawnPrefabActionPlanError,
) -> u32 {
    match error {
        SpawnPrefabActionPlanError::UnsupportedPrefab => GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
        SpawnPrefabActionPlanError::UnsupportedAnchor => GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
        SpawnPrefabActionPlanError::UnsupportedPhase => GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
        SpawnPrefabActionPlanError::MissingSourceTransform => {
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM
        }
    }
}

pub(crate) fn spawn_prefab_placement_collider(
    template: EntityTemplate,
    layer: CollisionLayer,
) -> AabbCollider {
    AabbCollider::new(
        template.collider_half_width,
        template.collider_half_height,
        template.collider_is_trigger,
        layer,
    )
    .with_enabled(template.collider_enabled)
    .with_offset(template.collider_offset_x, template.collider_offset_y)
}

pub(crate) fn spawn_prefab_placement_is_blocked_by_tilemap(
    tilemap: &Tilemap,
    template: EntityTemplate,
    transform: Transform2D,
    layer: CollisionLayer,
    contacts: &mut Vec<TilemapContactHit>,
) -> bool {
    let collider = spawn_prefab_placement_collider(template, layer);
    tilemap.aabb_obstacle_contacts_into(transform, collider, contacts);
    !contacts.is_empty()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnPrefabPreCommitError {
    SpawnQueueFull,
    BlockedPlacement,
}

pub(crate) fn validate_spawn_prefab_pre_commit_gates(
    has_pending_spawn_capacity: bool,
    is_placement_blocked: impl FnOnce() -> bool,
) -> Result<(), SpawnPrefabPreCommitError> {
    if !has_pending_spawn_capacity {
        return Err(SpawnPrefabPreCommitError::SpawnQueueFull);
    }
    if is_placement_blocked() {
        return Err(SpawnPrefabPreCommitError::BlockedPlacement);
    }
    Ok(())
}

pub(crate) const fn spawn_prefab_pre_commit_failure_reason(
    error: SpawnPrefabPreCommitError,
) -> u32 {
    match error {
        SpawnPrefabPreCommitError::SpawnQueueFull => GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        SpawnPrefabPreCommitError::BlockedPlacement => GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
    }
}

#[cfg(test)]
pub(crate) fn prepare_spawn_prefab_action_payload(
    world: &World,
    entity: Entity,
    action_id: u32,
) -> Result<SpawnPrefabActionPayload, ActionReadiness> {
    let readiness =
        prepare_action_if_ready(world, entity, action_id, ActionPatternKind::SpawnPrefab);
    let ActionReadiness::Ready(prepared) = readiness else {
        return Err(readiness);
    };
    spawn_prefab_action_payload_from_binding(prepared.binding)
}

#[cfg(test)]
pub(crate) const fn spawn_prefab_action_payload_from_binding(
    binding: ActionBinding,
) -> Result<SpawnPrefabActionPayload, ActionReadiness> {
    let ActionPattern::SpawnPrefab {
        prefab_id,
        projectile,
        anchor,
        phase,
        offset_x,
        offset_y,
    } = binding.pattern
    else {
        return Err(ActionReadiness::PatternMismatch);
    };
    Ok(SpawnPrefabActionPayload {
        prefab_id,
        projectile,
        anchor,
        phase,
        offset_x,
        offset_y,
    })
}
