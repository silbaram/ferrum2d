use crate::collision::{CircleQueryHit, CollisionPair, CollisionScratch, CollisionSystem};
use crate::components::gameplay::{
    ActionAimSource, ActionBinding, ActionPattern, CollisionReaction, CollisionReactionSet,
    CollisionTarget, GameplayFaction, GameplayTimerTrigger, MeleeTarget, MovementPattern,
    MovementTarget, ProjectileCollisionTarget, ProjectileTileImpact, SpawnAnchor, SpawnPhase,
    SpawnPrefabProjectilePayload, GAMEPLAY_PICKUP_ITEM_SCORE, MAX_COLLISION_REACTIONS_PER_ENTITY,
};
use crate::components::{
    AabbCollider, CollisionLayer, CollisionMask, HeightSpan, ProjectileArc, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::gameplay_event::{
    GameplayEvent, GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, GAMEPLAY_ACTION_FAILURE_COOLING_DOWN,
    GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING, GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
    GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
};
use crate::input::{InputActionRegistry, InputState};
use crate::tilemap::{Tilemap, TilemapContactHit};
use crate::world::{EntityTemplate, ProjectileSpawnRequest, World};

const MAX_COLLISION_GAMEPLAY_EVENTS_PER_REACTION_SET: usize =
    MAX_COLLISION_REACTIONS_PER_ENTITY * 3;

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActionPatternKind {
    Projectile,
    Dash,
    Melee,
    SpawnPrefab,
}

impl ActionPatternKind {
    pub(crate) const fn from_pattern(pattern: ActionPattern) -> Self {
        match pattern {
            ActionPattern::Projectile {
                speed: _,
                damage: _,
                lifetime_seconds: _,
                aim: _,
                collision_target: _,
                tile_impact: _,
            } => Self::Projectile,
            ActionPattern::Dash {
                distance: _,
                aim: _,
            } => Self::Dash,
            ActionPattern::Melee {
                range: _,
                damage: _,
                target: _,
            } => Self::Melee,
            ActionPattern::SpawnPrefab {
                prefab_id: _,
                projectile: _,
                anchor: _,
                phase: _,
                offset_x: _,
                offset_y: _,
            } => Self::SpawnPrefab,
        }
    }

    pub(crate) const fn matches(self, pattern: ActionPattern) -> bool {
        self as u8 == Self::from_pattern(pattern) as u8
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActionTriggerKind {
    Timer,
    Wave,
    BehaviorStateEnter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActionTriggerPhase {
    PrePhysics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ActionTriggerCommand {
    pub(crate) source: Entity,
    pub(crate) action_id: u32,
    pub(crate) trigger_kind: ActionTriggerKind,
    pub(crate) phase: ActionTriggerPhase,
}

impl ActionTriggerCommand {
    pub(crate) const fn timer(source: Entity, action_id: u32) -> Self {
        Self {
            source,
            action_id,
            trigger_kind: ActionTriggerKind::Timer,
            phase: ActionTriggerPhase::PrePhysics,
        }
    }

    pub(crate) const fn wave(source: Entity, action_id: u32) -> Self {
        Self {
            source,
            action_id,
            trigger_kind: ActionTriggerKind::Wave,
            phase: ActionTriggerPhase::PrePhysics,
        }
    }

    pub(crate) const fn behavior_state_enter(source: Entity, action_id: u32) -> Self {
        Self {
            source,
            action_id,
            trigger_kind: ActionTriggerKind::BehaviorStateEnter,
            phase: ActionTriggerPhase::PrePhysics,
        }
    }
}

pub(crate) const fn action_trigger_runs_in_phase(
    command: ActionTriggerCommand,
    phase: ActionTriggerPhase,
) -> bool {
    match (phase, command.phase, command.trigger_kind) {
        (
            ActionTriggerPhase::PrePhysics,
            ActionTriggerPhase::PrePhysics,
            ActionTriggerKind::Timer
            | ActionTriggerKind::Wave
            | ActionTriggerKind::BehaviorStateEnter,
        ) => true,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ActionReadiness {
    Missing,
    PatternMismatch,
    CoolingDown,
    Ready(PreparedAction),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PreparedAction {
    pub(crate) entity: Entity,
    pub(crate) action_id: u32,
    pub(crate) kind: ActionPatternKind,
    pub(crate) binding: ActionBinding,
}

impl PreparedAction {
    pub(crate) const fn new(
        entity: Entity,
        action_id: u32,
        kind: ActionPatternKind,
        binding: ActionBinding,
    ) -> Self {
        Self {
            entity,
            action_id,
            kind,
            binding,
        }
    }

    #[cfg(test)]
    pub(crate) const fn kind(self) -> ActionPatternKind {
        self.kind
    }
}

pub(crate) fn prepare_any_action_if_ready(
    world: &World,
    entity: Entity,
    action_id: u32,
) -> ActionReadiness {
    let Some(candidate) = world.action_binding(entity, action_id) else {
        return ActionReadiness::Missing;
    };
    if candidate.cooldown.remaining_seconds > 0.0 {
        return ActionReadiness::CoolingDown;
    }
    ActionReadiness::Ready(PreparedAction::new(
        entity,
        action_id,
        ActionPatternKind::from_pattern(candidate.pattern),
        candidate,
    ))
}

pub(crate) fn prepare_action_if_ready(
    world: &World,
    entity: Entity,
    action_id: u32,
    expected: ActionPatternKind,
) -> ActionReadiness {
    let Some(candidate) = world.action_binding(entity, action_id) else {
        return ActionReadiness::Missing;
    };
    if !expected.matches(candidate.pattern) {
        return ActionReadiness::PatternMismatch;
    }
    if candidate.cooldown.remaining_seconds > 0.0 {
        return ActionReadiness::CoolingDown;
    }
    ActionReadiness::Ready(PreparedAction::new(entity, action_id, expected, candidate))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum InputActionTrigger {
    Inactive,
    Missing,
    PatternMismatch,
    CoolingDown,
    Ready(PreparedAction),
}

impl From<ActionReadiness> for InputActionTrigger {
    fn from(readiness: ActionReadiness) -> Self {
        match readiness {
            ActionReadiness::Missing => Self::Missing,
            ActionReadiness::PatternMismatch => Self::PatternMismatch,
            ActionReadiness::CoolingDown => Self::CoolingDown,
            ActionReadiness::Ready(binding) => Self::Ready(binding),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActionAttemptFailurePolicy {
    Silent,
    ReportGenericReadinessFailures,
    ReportPatternMismatchOnly,
    PrimaryInputWithMissingFallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActionAttemptFailureDecision {
    Noop,
    Fallback,
    Failure(u32),
}

pub(crate) fn prepare_input_action_if_ready(
    world: &World,
    input_actions: &InputActionRegistry,
    input: FrameInputSnapshot,
    entity: Entity,
    action_id: u32,
    expected: ActionPatternKind,
) -> InputActionTrigger {
    if !input_actions.is_action_active(action_id, input.current, input.previous) {
        return InputActionTrigger::Inactive;
    }
    prepare_action_if_ready(world, entity, action_id, expected).into()
}

pub(crate) const fn attempted_action_readiness_failure_reason(
    readiness: ActionReadiness,
) -> Option<u32> {
    match readiness {
        ActionReadiness::Missing => Some(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING),
        ActionReadiness::PatternMismatch => Some(GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH),
        ActionReadiness::CoolingDown => Some(GAMEPLAY_ACTION_FAILURE_COOLING_DOWN),
        ActionReadiness::Ready(_) => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ActionFailureEventData {
    pub(crate) actor: Entity,
    pub(crate) source: Entity,
    pub(crate) action_id: u32,
    pub(crate) reason_code: u32,
}

pub(crate) trait ActionFailureEventSink {
    fn push_action_failure(&mut self, data: ActionFailureEventData);
}

pub(crate) const fn action_failure_event_data(
    actor: Entity,
    source: Entity,
    action_id: u32,
    reason_code: u32,
) -> ActionFailureEventData {
    ActionFailureEventData {
        actor,
        source,
        action_id,
        reason_code,
    }
}

pub(crate) fn action_failure_gameplay_event(data: ActionFailureEventData) -> GameplayEvent {
    GameplayEvent::action_failed(data.actor, data.source, data.action_id, data.reason_code)
}

pub(crate) const fn action_trigger_failure_event_data(
    trigger: ActionTriggerCommand,
    reason_code: u32,
) -> ActionFailureEventData {
    action_failure_event_data(
        trigger.source,
        trigger.source,
        trigger.action_id,
        reason_code,
    )
}

pub(crate) const fn action_trigger_queue_full_event_data(
    trigger: ActionTriggerCommand,
) -> ActionFailureEventData {
    action_trigger_failure_event_data(trigger, GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL)
}

pub(crate) fn push_action_failure_event<S: ActionFailureEventSink>(
    sink: Option<&mut S>,
    data: ActionFailureEventData,
) {
    if let Some(sink) = sink {
        sink.push_action_failure(data);
    }
}

pub(crate) fn push_action_trigger_failure_event<S: ActionFailureEventSink>(
    sink: Option<&mut S>,
    trigger: ActionTriggerCommand,
    reason_code: u32,
) {
    push_action_failure_event(
        sink,
        action_trigger_failure_event_data(trigger, reason_code),
    );
}

pub(crate) const fn action_readiness_failure_decision_for_policy(
    readiness: ActionReadiness,
    policy: ActionAttemptFailurePolicy,
) -> ActionAttemptFailureDecision {
    match policy {
        ActionAttemptFailurePolicy::Silent => ActionAttemptFailureDecision::Noop,
        ActionAttemptFailurePolicy::ReportGenericReadinessFailures => {
            match attempted_action_readiness_failure_reason(readiness) {
                Some(reason_code) => ActionAttemptFailureDecision::Failure(reason_code),
                None => ActionAttemptFailureDecision::Noop,
            }
        }
        ActionAttemptFailurePolicy::ReportPatternMismatchOnly => match readiness {
            ActionReadiness::PatternMismatch => {
                ActionAttemptFailureDecision::Failure(GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH)
            }
            ActionReadiness::Missing | ActionReadiness::CoolingDown | ActionReadiness::Ready(_) => {
                ActionAttemptFailureDecision::Noop
            }
        },
        ActionAttemptFailurePolicy::PrimaryInputWithMissingFallback => match readiness {
            ActionReadiness::Missing => ActionAttemptFailureDecision::Fallback,
            ActionReadiness::PatternMismatch => {
                ActionAttemptFailureDecision::Failure(GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH)
            }
            ActionReadiness::CoolingDown | ActionReadiness::Ready(_) => {
                ActionAttemptFailureDecision::Noop
            }
        },
    }
}

pub(crate) const fn input_action_trigger_failure_decision_for_policy(
    trigger: InputActionTrigger,
    policy: ActionAttemptFailurePolicy,
) -> ActionAttemptFailureDecision {
    match trigger {
        InputActionTrigger::Inactive => ActionAttemptFailureDecision::Noop,
        InputActionTrigger::Missing => {
            action_readiness_failure_decision_for_policy(ActionReadiness::Missing, policy)
        }
        InputActionTrigger::PatternMismatch => {
            action_readiness_failure_decision_for_policy(ActionReadiness::PatternMismatch, policy)
        }
        InputActionTrigger::CoolingDown => {
            action_readiness_failure_decision_for_policy(ActionReadiness::CoolingDown, policy)
        }
        InputActionTrigger::Ready(_) => ActionAttemptFailureDecision::Noop,
    }
}

pub(crate) const fn should_report_fixed_action_pattern_mismatch(
    actual_kind: Option<ActionPatternKind>,
) -> bool {
    !matches!(actual_kind, Some(ActionPatternKind::SpawnPrefab))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum PreparedActionPayload {
    Projectile(ProjectileActionPayload),
    Dash(DashActionPayload),
    Melee(MeleeActionPayload),
    SpawnPrefab(SpawnPrefabActionPayload),
}

impl PreparedActionPayload {
    #[cfg(test)]
    pub(crate) const fn kind(self) -> ActionPatternKind {
        match self {
            Self::Projectile(_) => ActionPatternKind::Projectile,
            Self::Dash(_) => ActionPatternKind::Dash,
            Self::Melee(_) => ActionPatternKind::Melee,
            Self::SpawnPrefab(_) => ActionPatternKind::SpawnPrefab,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PreparedActionTrigger {
    pub(crate) trigger: ActionTriggerCommand,
    pub(crate) prepared: PreparedAction,
    pub(crate) payload: PreparedActionPayload,
}

pub(crate) trait PreparedActionTriggerDispatcher {
    fn dispatch_projectile_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: ProjectileActionPayload,
    );

    fn dispatch_dash_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: DashActionPayload,
    );

    fn dispatch_melee_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: MeleeActionPayload,
    );

    fn dispatch_spawn_prefab_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: SpawnPrefabActionPayload,
    );
}

pub(crate) fn dispatch_prepared_action_trigger<D: PreparedActionTriggerDispatcher>(
    dispatcher: &mut D,
    prepared_trigger: PreparedActionTrigger,
) {
    match prepared_trigger.payload {
        PreparedActionPayload::Projectile(payload) => dispatcher
            .dispatch_projectile_action_trigger(
                prepared_trigger.trigger,
                prepared_trigger.prepared,
                payload,
            ),
        PreparedActionPayload::Dash(payload) => dispatcher.dispatch_dash_action_trigger(
            prepared_trigger.trigger,
            prepared_trigger.prepared,
            payload,
        ),
        PreparedActionPayload::Melee(payload) => dispatcher.dispatch_melee_action_trigger(
            prepared_trigger.trigger,
            prepared_trigger.prepared,
            payload,
        ),
        PreparedActionPayload::SpawnPrefab(payload) => dispatcher
            .dispatch_spawn_prefab_action_trigger(
                prepared_trigger.trigger,
                prepared_trigger.prepared,
                payload,
            ),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ActionTriggerPreparation {
    Ready(PreparedActionTrigger),
    Failure(ActionFailureEventData),
    Noop,
}

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

fn normalized_direction(dx: f32, dy: f32) -> Option<Velocity> {
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

pub(crate) fn prepare_any_action_payload_if_ready(
    world: &World,
    entity: Entity,
    action_id: u32,
) -> Result<(PreparedAction, PreparedActionPayload), ActionReadiness> {
    let readiness = prepare_any_action_if_ready(world, entity, action_id);
    let ActionReadiness::Ready(prepared) = readiness else {
        return Err(readiness);
    };
    Ok((
        prepared,
        prepared_action_payload_from_binding(prepared.binding),
    ))
}

pub(crate) fn prepare_action_trigger_for_dispatch(
    world: &World,
    trigger: ActionTriggerCommand,
    failure_policy: ActionAttemptFailurePolicy,
) -> ActionTriggerPreparation {
    match prepare_any_action_payload_if_ready(world, trigger.source, trigger.action_id) {
        Ok((prepared, payload)) => ActionTriggerPreparation::Ready(PreparedActionTrigger {
            trigger,
            prepared,
            payload,
        }),
        Err(readiness) => {
            debug_assert!(
                !matches!(readiness, ActionReadiness::PatternMismatch),
                "any-action payload preparation cannot produce pattern mismatch"
            );
            match action_readiness_failure_decision_for_policy(readiness, failure_policy) {
                ActionAttemptFailureDecision::Failure(reason_code) => {
                    ActionTriggerPreparation::Failure(action_trigger_failure_event_data(
                        trigger,
                        reason_code,
                    ))
                }
                ActionAttemptFailureDecision::Noop | ActionAttemptFailureDecision::Fallback => {
                    ActionTriggerPreparation::Noop
                }
            }
        }
    }
}

pub(crate) const fn prepared_action_payload_from_binding(
    binding: ActionBinding,
) -> PreparedActionPayload {
    match binding.pattern {
        ActionPattern::Projectile {
            speed,
            damage,
            lifetime_seconds,
            aim,
            collision_target,
            tile_impact,
        } => PreparedActionPayload::Projectile(ProjectileActionPayload {
            speed,
            damage,
            lifetime_seconds,
            aim,
            collision_target,
            tile_impact,
        }),
        ActionPattern::Dash { distance, aim } => {
            PreparedActionPayload::Dash(DashActionPayload { distance, aim })
        }
        ActionPattern::Melee {
            range,
            damage,
            target,
        } => PreparedActionPayload::Melee(MeleeActionPayload {
            range,
            damage,
            target,
        }),
        ActionPattern::SpawnPrefab {
            prefab_id,
            projectile,
            anchor,
            phase,
            offset_x,
            offset_y,
        } => PreparedActionPayload::SpawnPrefab(SpawnPrefabActionPayload {
            prefab_id,
            projectile,
            anchor,
            phase,
            offset_x,
            offset_y,
        }),
    }
}

pub(crate) fn commit_prepared_action(world: &mut World, prepared: PreparedAction) -> bool {
    if prepared.binding.action_id != prepared.action_id {
        return false;
    }
    let Some(candidate) = world.action_binding(prepared.entity, prepared.action_id) else {
        return false;
    };
    if candidate.action_id != prepared.action_id
        || !action_pattern_identity_matches(candidate.pattern, prepared.binding.pattern)
        || !prepared.kind.matches(candidate.pattern)
        || candidate.cooldown.remaining_seconds > 0.0
    {
        return false;
    }
    let Some(triggered) =
        world.commit_action_cooldown_if_ready(prepared.entity, prepared.action_id)
    else {
        return false;
    };
    debug_assert!(action_pattern_identity_matches(
        triggered.pattern,
        prepared.binding.pattern
    ));
    action_pattern_identity_matches(triggered.pattern, prepared.binding.pattern)
}

fn f32_identity_matches(a: f32, b: f32) -> bool {
    a.to_bits() == b.to_bits()
}

fn action_pattern_identity_matches(a: ActionPattern, b: ActionPattern) -> bool {
    match (a, b) {
        (
            ActionPattern::Projectile {
                speed: a_speed,
                damage: a_damage,
                lifetime_seconds: a_lifetime_seconds,
                aim: a_aim,
                collision_target: a_collision_target,
                tile_impact: a_tile_impact,
            },
            ActionPattern::Projectile {
                speed: b_speed,
                damage: b_damage,
                lifetime_seconds: b_lifetime_seconds,
                aim: b_aim,
                collision_target: b_collision_target,
                tile_impact: b_tile_impact,
            },
        ) => {
            f32_identity_matches(a_speed, b_speed)
                && f32_identity_matches(a_damage, b_damage)
                && f32_identity_matches(a_lifetime_seconds, b_lifetime_seconds)
                && a_aim == b_aim
                && a_collision_target == b_collision_target
                && a_tile_impact == b_tile_impact
        }
        (
            ActionPattern::Dash {
                distance: a_distance,
                aim: a_aim,
            },
            ActionPattern::Dash {
                distance: b_distance,
                aim: b_aim,
            },
        ) => f32_identity_matches(a_distance, b_distance) && a_aim == b_aim,
        (
            ActionPattern::Melee {
                range: a_range,
                damage: a_damage,
                target: a_target,
            },
            ActionPattern::Melee {
                range: b_range,
                damage: b_damage,
                target: b_target,
            },
        ) => {
            f32_identity_matches(a_range, b_range)
                && f32_identity_matches(a_damage, b_damage)
                && a_target == b_target
        }
        (
            ActionPattern::SpawnPrefab {
                prefab_id: a_prefab_id,
                projectile: a_projectile,
                anchor: a_anchor,
                phase: a_phase,
                offset_x: a_offset_x,
                offset_y: a_offset_y,
            },
            ActionPattern::SpawnPrefab {
                prefab_id: b_prefab_id,
                projectile: b_projectile,
                anchor: b_anchor,
                phase: b_phase,
                offset_x: b_offset_x,
                offset_y: b_offset_y,
            },
        ) => {
            a_prefab_id == b_prefab_id
                && a_anchor == b_anchor
                && a_phase == b_phase
                && a_projectile == b_projectile
                && f32_identity_matches(a_offset_x, b_offset_x)
                && f32_identity_matches(a_offset_y, b_offset_y)
        }
        _ => false,
    }
}

pub(crate) fn has_bounded_deferred_command_capacity<T>(queue: &[T], max_pending: usize) -> bool {
    queue.len() < max_pending
}

pub(crate) fn try_push_bounded_deferred_command<T>(
    queue: &mut Vec<T>,
    max_pending: usize,
    command: T,
) -> bool {
    if !has_bounded_deferred_command_capacity(queue, max_pending) {
        return false;
    }
    queue.push(command);
    true
}

pub(crate) fn drain_deferred_commands_into<T>(queue: &mut Vec<T>, commands: &mut Vec<T>) -> usize {
    commands.clear();
    commands.append(queue);
    commands.len()
}

#[derive(Debug)]
pub(crate) struct ActionTriggerQueue<T> {
    pending: Vec<T>,
    processing: Vec<T>,
    max_pending: usize,
}

impl<T: Copy> ActionTriggerQueue<T> {
    pub(crate) fn with_capacity(max_pending: usize) -> Self {
        Self {
            pending: Vec::with_capacity(max_pending),
            processing: Vec::with_capacity(max_pending),
            max_pending,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.pending.clear();
        self.processing.clear();
    }

    pub(crate) fn queue(&mut self, command: T) -> bool {
        if self.pending.len() >= self.max_pending {
            return false;
        }
        self.pending.push(command);
        true
    }

    pub(crate) fn begin_processing(&mut self) -> bool {
        if self.pending.is_empty() {
            return false;
        }
        std::mem::swap(&mut self.pending, &mut self.processing);
        true
    }

    pub(crate) fn processing_len(&self) -> usize {
        self.processing.len()
    }

    pub(crate) fn processing_at(&self, index: usize) -> Option<T> {
        self.processing.get(index).copied()
    }

    pub(crate) fn finish_processing(&mut self) {
        self.processing.clear();
    }

    #[cfg(test)]
    pub(crate) fn pending_len(&self) -> usize {
        self.pending.len()
    }

    #[cfg(test)]
    pub(crate) fn pending_capacity(&self) -> usize {
        self.pending.capacity()
    }

    #[cfg(test)]
    pub(crate) fn processing_capacity(&self) -> usize {
        self.processing.capacity()
    }
}

impl ActionTriggerQueue<ActionTriggerCommand> {
    pub(crate) fn queue_action_trigger(
        &mut self,
        command: ActionTriggerCommand,
    ) -> Result<(), ActionFailureEventData> {
        if self.queue(command) {
            return Ok(());
        }
        Err(action_trigger_queue_full_event_data(command))
    }

    pub(crate) fn processing_at_phase(
        &self,
        index: usize,
        phase: ActionTriggerPhase,
    ) -> Option<ActionTriggerCommand> {
        let command = self.processing_at(index)?;
        action_trigger_runs_in_phase(command, phase).then_some(command)
    }
}

pub(crate) fn collect_action_triggers_for_phase(
    queue: &mut ActionTriggerQueue<ActionTriggerCommand>,
    phase: ActionTriggerPhase,
    commands: &mut Vec<ActionTriggerCommand>,
) -> usize {
    commands.clear();
    if !queue.begin_processing() {
        return 0;
    }

    let trigger_count = queue.processing_len();
    for trigger_index in 0..trigger_count {
        if let Some(command) = queue.processing_at_phase(trigger_index, phase) {
            commands.push(command);
        }
    }
    queue.finish_processing();
    commands.len()
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DamageOutcome {
    pub(crate) remaining_health: f32,
    pub(crate) killed: bool,
    pub(crate) score_reward: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionDamageReactionOutcome {
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
    pub(crate) killed: bool,
    pub(crate) target_removed: bool,
    pub(crate) score_reward: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionDamageReactionDefaults {
    pub(crate) health: f32,
    pub(crate) score_reward: u32,
    pub(crate) despawn_on_kill: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CollisionDespawnReactionOutcome {
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionKnockbackReactionOutcome {
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) impulse: Velocity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CollisionPickupReactionOutcome {
    pub(crate) pickup_index: usize,
    pub(crate) pickup: Entity,
    pub(crate) collector_index: usize,
    pub(crate) collector: Entity,
    pub(crate) item_id: u32,
    pub(crate) count: u32,
    pub(crate) target_removed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CollisionGameplayEventPayload {
    Damage {
        target: Entity,
        source: Entity,
        damage: f32,
        target_removed: bool,
    },
    Despawn {
        target: Entity,
        source: Entity,
    },
    PickupCollected {
        collector: Entity,
        pickup: Entity,
        item_id: u32,
        count: u32,
        target_removed: bool,
    },
    FactionDamageDenied {
        target: Entity,
        source: Entity,
        source_faction_id: u32,
        target_faction_id: u32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionGameplayEventPayloadSet {
    events: [Option<CollisionGameplayEventPayload>; MAX_COLLISION_GAMEPLAY_EVENTS_PER_REACTION_SET],
}

impl Default for CollisionGameplayEventPayloadSet {
    fn default() -> Self {
        Self {
            events: [None; MAX_COLLISION_GAMEPLAY_EVENTS_PER_REACTION_SET],
        }
    }
}

impl CollisionGameplayEventPayloadSet {
    pub(crate) fn events(&self) -> impl Iterator<Item = CollisionGameplayEventPayload> + '_ {
        self.events.iter().filter_map(|event| *event)
    }

    fn push(&mut self, event: CollisionGameplayEventPayload) {
        if let Some(slot) = self.events.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(event);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionSideEffectEvaluation {
    pub(crate) replace_default_audio: bool,
    pub(crate) replace_default_particle: bool,
    pub(crate) effect: Option<CollisionSideEffect>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CollisionSideEffect {
    PlaySound {
        sound_id: u32,
        volume: f32,
        pitch: f32,
    },
    SpawnParticle {
        preset_id: u32,
        target_index: usize,
    },
    CameraShake,
    EmitEffect {
        effect_id: u32,
        effect_type: u32,
        target_index: usize,
        intensity: f32,
        radius: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CollisionSideEffectPayload {
    PlaySound {
        sound_id: u32,
        volume: f32,
        pitch: f32,
    },
    SpawnParticleAt {
        preset_id: u32,
        position: Transform2D,
    },
    CameraShake,
    PresentationEffect {
        actor: Entity,
        effect_id: u32,
        effect_type: u32,
        intensity: f32,
        radius: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionSpawnPrefabEvaluation {
    pub(crate) reaction_owner_index: usize,
    pub(crate) source: Entity,
    pub(crate) action_id: u32,
    pub(crate) prefab_id: u32,
    pub(crate) target: CollisionTarget,
    pub(crate) anchor_index: usize,
    pub(crate) anchor: Entity,
    pub(crate) offset_x: f32,
    pub(crate) offset_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct CollisionContactKey {
    a_id: u32,
    a_generation: u32,
    b_id: u32,
    b_generation: u32,
}

impl CollisionContactKey {
    pub(crate) fn new(a: Entity, b: Entity) -> Self {
        let a_key = (a.id, a.generation);
        let b_key = (b.id, b.generation);
        let (a_key, b_key) = if a_key <= b_key {
            (a_key, b_key)
        } else {
            (b_key, a_key)
        };
        Self {
            a_id: a_key.0,
            a_generation: a_key.1,
            b_id: b_key.0,
            b_generation: b_key.1,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct CollisionContactTracker {
    previous_contacts: Vec<CollisionContactKey>,
    current_contacts: Vec<CollisionContactKey>,
    max_contacts: usize,
}

impl CollisionContactTracker {
    pub(crate) fn with_capacity(max_contacts: usize) -> Self {
        Self {
            previous_contacts: Vec::with_capacity(max_contacts),
            current_contacts: Vec::with_capacity(max_contacts),
            max_contacts,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.previous_contacts.clear();
        self.current_contacts.clear();
    }

    pub(crate) fn clear_current(&mut self) {
        self.current_contacts.clear();
    }

    pub(crate) fn register(&mut self, first: Entity, second: Entity) -> bool {
        register_collision_contact(
            &self.previous_contacts,
            &mut self.current_contacts,
            self.max_contacts,
            first,
            second,
        )
    }

    pub(crate) fn finish(&mut self) {
        finish_collision_contacts(&mut self.previous_contacts, &mut self.current_contacts);
    }

    #[cfg(test)]
    pub(crate) fn current_len(&self) -> usize {
        self.current_contacts.len()
    }

    #[cfg(test)]
    pub(crate) fn current_capacity(&self) -> usize {
        self.current_contacts.capacity()
    }
}

pub(crate) fn register_collision_contact(
    previous_contacts: &[CollisionContactKey],
    current_contacts: &mut Vec<CollisionContactKey>,
    max_contacts: usize,
    first: Entity,
    second: Entity,
) -> bool {
    let key = CollisionContactKey::new(first, second);
    let insert_index = match current_contacts.binary_search(&key) {
        Ok(_) => return false,
        Err(insert_index) => insert_index,
    };
    let contact_entered = previous_contacts.binary_search(&key).is_err();
    if current_contacts.len() >= max_contacts {
        return false;
    }
    current_contacts.insert(insert_index, key);
    contact_entered
}

pub(crate) fn finish_collision_contacts(
    previous_contacts: &mut Vec<CollisionContactKey>,
    current_contacts: &mut Vec<CollisionContactKey>,
) {
    std::mem::swap(previous_contacts, current_contacts);
    current_contacts.clear();
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionReactionSetOutcome {
    pub(crate) overrides_default_gameplay: bool,
    pub(crate) replace_default_audio: bool,
    pub(crate) replace_default_particle: bool,
    damage_outcomes: [Option<CollisionDamageReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    faction_damage_denials: [Option<FactionDamageDenial>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    despawn_outcomes: [Option<CollisionDespawnReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    knockback_outcomes:
        [Option<CollisionKnockbackReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    pickup_outcomes: [Option<CollisionPickupReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    side_effects: [Option<CollisionSideEffectEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    spawn_prefabs: [Option<CollisionSpawnPrefabEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
}

impl Default for CollisionReactionSetOutcome {
    fn default() -> Self {
        Self {
            overrides_default_gameplay: false,
            replace_default_audio: false,
            replace_default_particle: false,
            damage_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            faction_damage_denials: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            despawn_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            knockback_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            pickup_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            side_effects: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            spawn_prefabs: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
        }
    }
}

impl CollisionReactionSetOutcome {
    pub(crate) fn damage_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionDamageReactionOutcome> + '_ {
        self.damage_outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(crate) fn faction_damage_denials(&self) -> impl Iterator<Item = FactionDamageDenial> + '_ {
        self.faction_damage_denials
            .iter()
            .filter_map(|outcome| *outcome)
    }

    pub(crate) fn despawn_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionDespawnReactionOutcome> + '_ {
        self.despawn_outcomes.iter().filter_map(|outcome| *outcome)
    }

    #[cfg(test)]
    pub(crate) fn knockback_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionKnockbackReactionOutcome> + '_ {
        self.knockback_outcomes
            .iter()
            .filter_map(|outcome| *outcome)
    }

    pub(crate) fn pickup_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionPickupReactionOutcome> + '_ {
        self.pickup_outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(crate) fn side_effects(&self) -> impl Iterator<Item = CollisionSideEffectEvaluation> + '_ {
        self.side_effects.iter().filter_map(|effect| *effect)
    }

    pub(crate) fn spawn_prefabs(
        &self,
    ) -> impl Iterator<Item = CollisionSpawnPrefabEvaluation> + '_ {
        self.spawn_prefabs.iter().filter_map(|spawn| *spawn)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct TileCollisionReactionSetOutcome {
    pub(crate) queued_self_despawn: bool,
    pub(crate) despawn_outcome: Option<CollisionDespawnReactionOutcome>,
    reaction_outcome: CollisionReactionSetOutcome,
}

impl TileCollisionReactionSetOutcome {
    pub(crate) fn reaction_outcome(&self) -> &CollisionReactionSetOutcome {
        &self.reaction_outcome
    }

    pub(crate) fn side_effects(&self) -> impl Iterator<Item = CollisionSideEffectEvaluation> + '_ {
        self.reaction_outcome.side_effects()
    }

    pub(crate) fn spawn_prefabs(
        &self,
    ) -> impl Iterator<Item = CollisionSpawnPrefabEvaluation> + '_ {
        self.reaction_outcome.spawn_prefabs()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PickupCollisionReactionSetOutcome {
    pub(crate) handled_pickup: bool,
    pickup_outcomes: [Option<CollisionPickupReactionOutcome>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    side_effects: [Option<CollisionSideEffectEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    spawn_prefabs: [Option<CollisionSpawnPrefabEvaluation>; MAX_COLLISION_REACTIONS_PER_ENTITY],
}

impl Default for PickupCollisionReactionSetOutcome {
    fn default() -> Self {
        Self {
            handled_pickup: false,
            pickup_outcomes: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            side_effects: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            spawn_prefabs: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
        }
    }
}

impl PickupCollisionReactionSetOutcome {
    pub(crate) fn pickup_outcomes(
        &self,
    ) -> impl Iterator<Item = CollisionPickupReactionOutcome> + '_ {
        self.pickup_outcomes.iter().filter_map(|outcome| *outcome)
    }

    pub(crate) fn side_effects(&self) -> impl Iterator<Item = CollisionSideEffectEvaluation> + '_ {
        self.side_effects.iter().filter_map(|effect| *effect)
    }

    pub(crate) fn spawn_prefabs(
        &self,
    ) -> impl Iterator<Item = CollisionSpawnPrefabEvaluation> + '_ {
        self.spawn_prefabs.iter().filter_map(|spawn| *spawn)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AppliedPickupCollisionReactionSetOutcome {
    pub(crate) pair: CollisionReactionPair,
    pub(crate) outcome: PickupCollisionReactionSetOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct PickupCollisionReactionSetsForPairOutcome {
    pub(crate) handled_pickup: bool,
    outcomes: [Option<AppliedPickupCollisionReactionSetOutcome>; 2],
}

impl PickupCollisionReactionSetsForPairOutcome {
    pub(crate) fn outcomes(
        &self,
    ) -> impl Iterator<Item = AppliedPickupCollisionReactionSetOutcome> + '_ {
        self.outcomes.iter().filter_map(|outcome| *outcome)
    }

    fn push(&mut self, pair: CollisionReactionPair, outcome: PickupCollisionReactionSetOutcome) {
        self.handled_pickup |= outcome.handled_pickup;
        if let Some(slot) = self.outcomes.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(AppliedPickupCollisionReactionSetOutcome { pair, outcome });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CollisionReactionPair {
    pub(crate) source_index: usize,
    pub(crate) other_index: usize,
    pub(crate) source: Entity,
    pub(crate) other: Entity,
}

impl CollisionReactionPair {
    pub(crate) const fn new(
        source_index: usize,
        other_index: usize,
        source: Entity,
        other: Entity,
    ) -> Self {
        Self {
            source_index,
            other_index,
            source,
            other,
        }
    }

    pub(crate) const fn reversed(self) -> Self {
        Self {
            source_index: self.other_index,
            other_index: self.source_index,
            source: self.other,
            other: self.source,
        }
    }

    pub(crate) const fn target_index(self, target: CollisionTarget) -> usize {
        match target {
            CollisionTarget::SelfEntity => self.source_index,
            CollisionTarget::OtherEntity => self.other_index,
        }
    }

    pub(crate) const fn target_entity(self, target: CollisionTarget) -> Entity {
        match target {
            CollisionTarget::SelfEntity => self.source,
            CollisionTarget::OtherEntity => self.other,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AppliedCollisionReactionSetOutcome {
    pub(crate) pair: CollisionReactionPair,
    pub(crate) outcome: CollisionReactionSetOutcome,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct CollisionReactionSetsForPairOutcome {
    outcomes: [Option<AppliedCollisionReactionSetOutcome>; 2],
}

impl CollisionReactionSetsForPairOutcome {
    pub(crate) fn outcomes(&self) -> impl Iterator<Item = AppliedCollisionReactionSetOutcome> + '_ {
        self.outcomes.iter().filter_map(|outcome| *outcome)
    }

    fn push(&mut self, pair: CollisionReactionPair, outcome: CollisionReactionSetOutcome) {
        if let Some(slot) = self.outcomes.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(AppliedCollisionReactionSetOutcome { pair, outcome });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollisionReactionTargetRole {
    Player,
    Enemy,
    Other,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct CollisionReactionOutcomeSummary {
    pub(crate) total_damage: f32,
    pub(crate) score_delta: u32,
    pub(crate) overrides_default_gameplay: bool,
    pub(crate) faction_damage_denied: bool,
    pub(crate) enemy_damaged: bool,
    pub(crate) enemy_removed: bool,
    pub(crate) player_game_over: bool,
    pub(crate) pickup_collected: bool,
    pub(crate) replace_default_audio: bool,
    pub(crate) replace_default_particle: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DefaultCollisionPresentationPolicy {
    pub(crate) emit_audio: bool,
    pub(crate) emit_particle: bool,
}

impl DefaultCollisionPresentationPolicy {
    pub(crate) const fn emit_all() -> Self {
        Self {
            emit_audio: true,
            emit_particle: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionHitPresentationPayload {
    pub(crate) source: Entity,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
    pub(crate) emit_audio: bool,
    pub(crate) particle_position: Option<Transform2D>,
}

impl CollisionReactionOutcomeSummary {
    pub(crate) fn merge(&mut self, other: Self) {
        self.total_damage += other.total_damage;
        self.score_delta = self.score_delta.saturating_add(other.score_delta);
        self.overrides_default_gameplay |= other.overrides_default_gameplay;
        self.faction_damage_denied |= other.faction_damage_denied;
        self.enemy_damaged |= other.enemy_damaged;
        self.enemy_removed |= other.enemy_removed;
        self.player_game_over |= other.player_game_over;
        self.pickup_collected |= other.pickup_collected;
        self.replace_default_audio |= other.replace_default_audio;
        self.replace_default_particle |= other.replace_default_particle;
    }
}

pub(crate) fn default_collision_presentation_policy(
    authored_outcome: Option<&CollisionReactionOutcomeSummary>,
) -> DefaultCollisionPresentationPolicy {
    let Some(outcome) = authored_outcome else {
        return DefaultCollisionPresentationPolicy::emit_all();
    };
    DefaultCollisionPresentationPolicy {
        emit_audio: !outcome.replace_default_audio,
        emit_particle: !outcome.replace_default_particle,
    }
}

pub(crate) fn should_emit_default_game_over_audio(
    game_over_entered: bool,
    authored_outcome: Option<&CollisionReactionOutcomeSummary>,
) -> bool {
    game_over_entered && default_collision_presentation_policy(authored_outcome).emit_audio
}

pub(crate) fn collision_hit_presentation_payload(
    world: &World,
    pair: CollisionReactionPair,
    damage: f32,
    authored_outcome: Option<&CollisionReactionOutcomeSummary>,
) -> CollisionHitPresentationPayload {
    let default_presentation = default_collision_presentation_policy(authored_outcome);
    CollisionHitPresentationPayload {
        source: pair.source,
        target: pair.other,
        damage,
        emit_audio: default_presentation.emit_audio,
        particle_position: if default_presentation.emit_particle {
            world
                .transforms
                .get(pair.other_index)
                .copied()
                .flatten()
                .or_else(|| world.transforms.get(pair.source_index).copied().flatten())
        } else {
            None
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DefaultCollisionDamageHitOutcome {
    pub(crate) source_index: usize,
    pub(crate) source: Entity,
    pub(crate) source_removed: bool,
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
    pub(crate) killed: bool,
    pub(crate) target_removed: bool,
    pub(crate) score_reward: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DefaultCollisionGameOverHitOutcome {
    pub(crate) source_index: usize,
    pub(crate) source: Entity,
    pub(crate) source_removed: bool,
    pub(crate) target_index: usize,
    pub(crate) target: Entity,
    pub(crate) damage: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum MovementPatternEvaluation {
    Velocity(Velocity),
    Chase {
        target: MovementTarget,
        target_transform: Transform2D,
        speed: f32,
    },
    SeekTarget {
        target_transform: Transform2D,
        current_velocity: Velocity,
        speed: f32,
        turn_rate: f32,
    },
    Accelerate {
        current_velocity: Velocity,
        acceleration_x: f32,
        acceleration_y: f32,
        max_speed: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum MovementPatternApplication {
    Applied,
    DeferredChase {
        target: MovementTarget,
        target_transform: Transform2D,
        speed: f32,
    },
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SweptKinematicHit {
    pub(crate) entity: Entity,
    pub(crate) time: f32,
    pub(crate) normal_x: f32,
    pub(crate) normal_y: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum VelocityReflection {
    SurfaceNormal { normal_x: f32, normal_y: f32 },
    ContactOffsetX { surface: Entity, speed: f32 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MovementNavigationSource {
    pub(crate) index: usize,
    pub(crate) generation: u32,
    pub(crate) transform: Transform2D,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MovementNavigationTargetIdentity {
    Player,
    NearestPlayer,
    NearestEnemy,
    NearestLayer(CollisionLayer),
    NearestFaction(u32),
    NearestTag(u32),
    Entity(Entity),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MovementNavigationTargetCache {
    generation: u32,
    target_identity: MovementNavigationTargetIdentity,
    target: Transform2D,
    remaining_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct MovementNavigationPolicy {
    pub(crate) repath_interval_seconds: f32,
    pub(crate) reached_distance_squared: f32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct MovementPatternBatchRunStats {
    pub(crate) candidates: usize,
    pub(crate) applied: usize,
    pub(crate) unsupported: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LayerMovementPatternPhaseConfig {
    pub(crate) layer: CollisionLayer,
    pub(crate) player_transform: Option<Transform2D>,
    pub(crate) navigation_policy: MovementNavigationPolicy,
    pub(crate) fallback_pattern: MovementPattern,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LayerMovementPatternDefaultFallbackConfig {
    pub(crate) layer: CollisionLayer,
    pub(crate) player_transform: Option<Transform2D>,
    pub(crate) navigation_policy: MovementNavigationPolicy,
    pub(crate) fallback: DefaultMovementPatternConfig,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TopdownInputMovementPhaseConfig {
    pub(crate) entity: Entity,
    pub(crate) input: FrameInputSnapshot,
    pub(crate) default_speed: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FrameInputSnapshot {
    pub(crate) current: InputState,
    pub(crate) previous: InputState,
}

impl FrameInputSnapshot {
    pub(crate) const fn new(current: InputState, previous: InputState) -> Self {
        Self { current, previous }
    }

    #[cfg(test)]
    pub(crate) const fn current_only(current: InputState) -> Self {
        Self {
            current,
            previous: current,
        }
    }
}

pub(crate) fn movement_navigation_target_identity(
    target: MovementTarget,
) -> MovementNavigationTargetIdentity {
    match target {
        MovementTarget::Player => MovementNavigationTargetIdentity::Player,
        MovementTarget::NearestPlayer => MovementNavigationTargetIdentity::NearestPlayer,
        MovementTarget::NearestEnemy => MovementNavigationTargetIdentity::NearestEnemy,
        MovementTarget::NearestLayer(layer) => {
            MovementNavigationTargetIdentity::NearestLayer(layer)
        }
        MovementTarget::NearestFaction(faction_id) => {
            MovementNavigationTargetIdentity::NearestFaction(faction_id)
        }
        MovementTarget::NearestTag(tag_id) => MovementNavigationTargetIdentity::NearestTag(tag_id),
        MovementTarget::Entity(entity) => MovementNavigationTargetIdentity::Entity(entity),
    }
}

pub(crate) fn tick_movement_navigation_targets(
    caches: &mut [Option<MovementNavigationTargetCache>],
    delta_seconds: f32,
) {
    let elapsed = delta_seconds.max(0.0);
    if elapsed <= 0.0 {
        return;
    }
    for cache in caches.iter_mut().flatten() {
        cache.remaining_seconds = (cache.remaining_seconds - elapsed).max(0.0);
    }
}

pub(crate) fn resolve_movement_navigation_target<F>(
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    source: MovementNavigationSource,
    target_identity: MovementNavigationTargetIdentity,
    target_transform: Transform2D,
    repath_interval_seconds: f32,
    reached_distance_squared: f32,
    mut resolve_waypoint: F,
) -> Transform2D
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    if source.index >= caches.len() {
        caches.resize(source.index + 1, None);
    }

    let cached_target = caches[source.index]
        .filter(|cache| {
            cache.generation == source.generation
                && cache.target_identity == target_identity
                && cache.remaining_seconds > 0.0
                && !has_reached_movement_navigation_target(
                    source.transform,
                    cache.target,
                    reached_distance_squared,
                )
        })
        .map(|cache| cache.target);
    if let Some(target) = cached_target {
        return target;
    }

    let target = resolve_waypoint(source.transform, target_transform).unwrap_or(target_transform);
    caches[source.index] = Some(MovementNavigationTargetCache {
        generation: source.generation,
        target_identity,
        target,
        remaining_seconds: repath_interval_seconds.max(0.0),
    });
    target
}

pub(crate) fn first_swept_kinematic_hit<I>(
    world: &World,
    mover: Entity,
    targets: I,
    delta: f32,
) -> Option<SweptKinematicHit>
where
    I: IntoIterator<Item = Entity>,
{
    let mover_index = mover.id as usize;
    let start = world.transforms.get(mover_index).copied().flatten()?;
    let velocity = world.velocities.get(mover_index).copied().flatten()?;
    let collider = world.colliders.get(mover_index).copied().flatten()?;
    if !collider.enabled {
        return None;
    }

    let mut best: Option<SweptKinematicHit> = None;
    for target in targets {
        if target == mover {
            continue;
        }
        let target_index = target.id as usize;
        let Some(live_target) = entity_at(world, target_index) else {
            continue;
        };
        if live_target.generation != target.generation {
            continue;
        }
        let (Some(target_transform), Some(target_collider)) = (
            world.transforms.get(target_index).copied().flatten(),
            world.colliders.get(target_index).copied().flatten(),
        ) else {
            continue;
        };
        if !target_collider.enabled {
            continue;
        }
        let Some(contact) = CollisionSystem::swept_aabb_contact(
            start,
            velocity,
            collider,
            target_transform,
            Velocity::default(),
            target_collider,
            delta,
        ) else {
            continue;
        };
        let time = contact.time.clamp(0.0, 1.0);
        if best.as_ref().is_none_or(|hit| time < hit.time) {
            best = Some(SweptKinematicHit {
                entity: target,
                time,
                normal_x: contact.normal_x,
                normal_y: contact.normal_y,
            });
        }
    }
    best
}

pub(crate) fn apply_velocity_reflection(
    world: &mut World,
    target: Entity,
    reflection: VelocityReflection,
) -> bool {
    match reflection {
        VelocityReflection::SurfaceNormal { normal_x, normal_y } => {
            let Some(velocity) = world
                .velocities
                .get_mut(target.id as usize)
                .and_then(Option::as_mut)
            else {
                return false;
            };
            if normal_x.abs() >= normal_y.abs() {
                velocity.vx = -velocity.vx;
            } else {
                velocity.vy = -velocity.vy;
            }
            true
        }
        VelocityReflection::ContactOffsetX { surface, speed } => {
            let target_index = target.id as usize;
            let surface_index = surface.id as usize;
            let (Some(target_transform), Some(surface_transform), Some(surface_collider)) = (
                world.transforms.get(target_index).copied().flatten(),
                world.transforms.get(surface_index).copied().flatten(),
                world.colliders.get(surface_index).copied().flatten(),
            ) else {
                return false;
            };
            let Some(velocity) = world
                .velocities
                .get_mut(target_index)
                .and_then(Option::as_mut)
            else {
                return false;
            };
            let offset = ((target_transform.x - surface_transform.x) / surface_collider.half_width)
                .clamp(-1.0, 1.0);
            velocity.vx = offset * speed;
            velocity.vy = -speed;
            true
        }
    }
}

pub(crate) fn evaluate_movement_pattern(
    world: &World,
    player_transform: Option<Transform2D>,
    transform: Transform2D,
    current_velocity: Option<Velocity>,
    pattern: MovementPattern,
) -> Option<MovementPatternEvaluation> {
    match pattern {
        MovementPattern::Static => Some(MovementPatternEvaluation::Velocity(Velocity::default())),
        MovementPattern::TopdownInput { .. } => None,
        MovementPattern::PlatformerInput { .. } => None,
        MovementPattern::Linear { vx, vy } => {
            Some(MovementPatternEvaluation::Velocity(Velocity { vx, vy }))
        }
        MovementPattern::Oscillate { .. } => None,
        MovementPattern::MoveToPoint { x, y, speed } => Some(MovementPatternEvaluation::Velocity(
            velocity_toward(transform, Transform2D { x, y }, speed),
        )),
        MovementPattern::Chase { target, speed } => {
            let Some(target_transform) =
                movement_target_transform_from(world, player_transform, transform, target)
            else {
                return Some(MovementPatternEvaluation::Velocity(Velocity::default()));
            };
            Some(MovementPatternEvaluation::Chase {
                target,
                target_transform,
                speed,
            })
        }
        MovementPattern::Orbit {
            target,
            speed,
            radius,
            radial_band,
        } => {
            let Some(target_transform) =
                movement_target_transform_from(world, player_transform, transform, target)
            else {
                return Some(MovementPatternEvaluation::Velocity(Velocity::default()));
            };
            Some(MovementPatternEvaluation::Velocity(
                orbit_velocity_with_band(transform, target_transform, speed, radius, radial_band),
            ))
        }
        MovementPattern::SeekTarget {
            target,
            speed,
            turn_rate,
        } => {
            let Some(target_transform) =
                movement_target_transform_from(world, player_transform, transform, target)
            else {
                return Some(MovementPatternEvaluation::Velocity(Velocity::default()));
            };
            Some(MovementPatternEvaluation::SeekTarget {
                target_transform,
                current_velocity: current_velocity.unwrap_or_default(),
                speed,
                turn_rate: clamp_turn_rate(turn_rate),
            })
        }
        MovementPattern::Accelerate {
            acceleration_x,
            acceleration_y,
            max_speed,
        } => Some(MovementPatternEvaluation::Accelerate {
            current_velocity: current_velocity.unwrap_or_default(),
            acceleration_x,
            acceleration_y,
            max_speed,
        }),
    }
}

pub(crate) fn apply_scene_neutral_movement_pattern(
    world: &mut World,
    entity_index: usize,
    player_transform: Option<Transform2D>,
    pattern: MovementPattern,
) -> MovementPatternApplication {
    let Some(transform) = world.transforms.get(entity_index).and_then(|value| *value) else {
        return MovementPatternApplication::Unsupported;
    };
    let current_velocity = world.velocities.get(entity_index).copied().flatten();
    match evaluate_movement_pattern(
        world,
        player_transform,
        transform,
        current_velocity,
        pattern,
    ) {
        Some(MovementPatternEvaluation::Velocity(velocity)) => {
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity);
            MovementPatternApplication::Applied
        }
        Some(MovementPatternEvaluation::Chase {
            target,
            target_transform,
            speed,
        }) => MovementPatternApplication::DeferredChase {
            target,
            target_transform,
            speed,
        },
        Some(MovementPatternEvaluation::SeekTarget {
            target_transform,
            current_velocity,
            speed,
            turn_rate,
        }) => {
            let desired_velocity = velocity_toward(transform, target_transform, speed);
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity_interpolate(
                current_velocity,
                desired_velocity,
                turn_rate,
            ));
            MovementPatternApplication::Applied
        }
        Some(MovementPatternEvaluation::Accelerate {
            current_velocity,
            acceleration_x,
            acceleration_y,
            max_speed,
        }) => {
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity_with_acceleration_and_speed_cap(
                current_velocity,
                acceleration_x,
                acceleration_y,
                max_speed,
            ));
            MovementPatternApplication::Applied
        }
        None => MovementPatternApplication::Unsupported,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DefaultMovementPatternKind {
    ChasePlayer,
    MoveToWorldCenter,
    Static,
    OrbitPlayer,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DefaultMovementPatternConfig {
    pub(crate) kind: DefaultMovementPatternKind,
    pub(crate) speed: f32,
    pub(crate) world_width: f32,
    pub(crate) world_height: f32,
    pub(crate) orbit_radius: f32,
    pub(crate) orbit_radial_band: f32,
}

pub(crate) fn default_movement_pattern(config: DefaultMovementPatternConfig) -> MovementPattern {
    match config.kind {
        DefaultMovementPatternKind::ChasePlayer => MovementPattern::Chase {
            target: MovementTarget::Player,
            speed: config.speed,
        },
        DefaultMovementPatternKind::MoveToWorldCenter => MovementPattern::MoveToPoint {
            x: config.world_width * 0.5,
            y: config.world_height * 0.5,
            speed: config.speed,
        },
        DefaultMovementPatternKind::Static => MovementPattern::Static,
        DefaultMovementPatternKind::OrbitPlayer => MovementPattern::Orbit {
            target: MovementTarget::Player,
            speed: config.speed,
            radius: config.orbit_radius,
            radial_band: config.orbit_radial_band,
        },
    }
}

pub(crate) fn layer_movement_pattern_phase_config_with_default_fallback(
    config: LayerMovementPatternDefaultFallbackConfig,
) -> LayerMovementPatternPhaseConfig {
    LayerMovementPatternPhaseConfig {
        layer: config.layer,
        player_transform: config.player_transform,
        navigation_policy: config.navigation_policy,
        fallback_pattern: default_movement_pattern(config.fallback),
    }
}

fn apply_movement_pattern_with_navigation<F>(
    world: &mut World,
    entity_index: usize,
    player_transform: Option<Transform2D>,
    pattern: MovementPattern,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    resolve_waypoint: &mut F,
) -> MovementPatternApplication
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    match apply_scene_neutral_movement_pattern(world, entity_index, player_transform, pattern) {
        MovementPatternApplication::Applied => MovementPatternApplication::Applied,
        MovementPatternApplication::Unsupported => MovementPatternApplication::Unsupported,
        MovementPatternApplication::DeferredChase {
            target,
            target_transform,
            speed,
        } => {
            let Some(transform) = world.transforms.get(entity_index).and_then(|value| *value)
            else {
                return MovementPatternApplication::Unsupported;
            };
            let Some(source_entity) = world.entity_at_index(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            let source = MovementNavigationSource {
                index: entity_index,
                generation: source_entity.generation,
                transform,
            };
            let target = resolve_movement_navigation_target(
                caches,
                source,
                movement_navigation_target_identity(target),
                target_transform,
                navigation_policy.repath_interval_seconds,
                navigation_policy.reached_distance_squared,
                resolve_waypoint,
            );
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity_toward(source.transform, target, speed));
            MovementPatternApplication::Applied
        }
    }
}

#[cfg(test)]
pub(crate) fn run_movement_pattern_with_navigation_system<F>(
    world: &mut World,
    entity: Entity,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    resolve_waypoint: F,
) -> MovementPatternApplication
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    let entity_index = entity.id as usize;
    if !world.is_current_entity(entity) {
        return MovementPatternApplication::Unsupported;
    }
    let Some(pattern) = world.movement_pattern(entity) else {
        return MovementPatternApplication::Unsupported;
    };
    let mut resolve_waypoint = resolve_waypoint;
    apply_movement_pattern_with_navigation(
        world,
        entity_index,
        player_transform,
        pattern,
        caches,
        navigation_policy,
        &mut resolve_waypoint,
    )
}

#[cfg(test)]
pub(crate) fn run_movement_pattern_with_navigation_or_fallback_system<F>(
    world: &mut World,
    entity: Entity,
    player_transform: Option<Transform2D>,
    fallback_pattern: MovementPattern,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    resolve_waypoint: F,
) -> MovementPatternApplication
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    let entity_index = entity.id as usize;
    if !world.is_current_entity(entity) {
        return MovementPatternApplication::Unsupported;
    }
    let authored_pattern = world.movement_pattern(entity);
    let mut resolve_waypoint = resolve_waypoint;
    let application = if authored_pattern.is_some() {
        run_movement_pattern_with_navigation_system(
            world,
            entity,
            player_transform,
            caches,
            navigation_policy,
            &mut resolve_waypoint,
        )
    } else {
        MovementPatternApplication::Unsupported
    };
    if application == MovementPatternApplication::Unsupported {
        apply_movement_pattern_with_navigation(
            world,
            entity_index,
            player_transform,
            fallback_pattern,
            caches,
            navigation_policy,
            &mut resolve_waypoint,
        )
    } else {
        application
    }
}

#[allow(clippy::too_many_arguments)]
fn movement_pattern_with_navigation_batch_system_impl<F, I, P, U, const COLLECT_STATS: bool>(
    world: &mut World,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    mut include_entity: I,
    mut fallback_pattern: P,
    mut on_unsupported: U,
    mut resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    I: FnMut(&World, usize) -> bool,
    P: FnMut(&World, usize) -> MovementPattern,
    U: FnMut(&mut World, usize),
{
    let mut stats = MovementPatternBatchRunStats::default();
    // Keep this as a private helper: callback hooks may update per-entity
    // components only. Structural mutation belongs in phase-bound command
    // buffers so the alive snapshot stays stable for this scan.
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let entity_index = world.alive_indices()[alive_position];
        if !include_entity(world, entity_index) {
            continue;
        }
        if COLLECT_STATS {
            stats.candidates += 1;
        }
        let mut application =
            if let Some(authored_pattern) = world.movement_pattern_at_index(entity_index) {
                apply_movement_pattern_with_navigation(
                    world,
                    entity_index,
                    player_transform,
                    authored_pattern,
                    caches,
                    navigation_policy,
                    &mut resolve_waypoint,
                )
            } else {
                MovementPatternApplication::Unsupported
            };
        if application == MovementPatternApplication::Unsupported {
            let fallback_pattern = fallback_pattern(world, entity_index);
            application = apply_movement_pattern_with_navigation(
                world,
                entity_index,
                player_transform,
                fallback_pattern,
                caches,
                navigation_policy,
                &mut resolve_waypoint,
            );
        }
        if application == MovementPatternApplication::Applied {
            if COLLECT_STATS {
                stats.applied += 1;
            }
        } else {
            if COLLECT_STATS {
                stats.unsupported += 1;
            }
            on_unsupported(world, entity_index);
        }
    }
    stats
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn run_movement_pattern_with_navigation_batch_system<F, I, P, U>(
    world: &mut World,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    include_entity: I,
    fallback_pattern: P,
    on_unsupported: U,
    resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    I: FnMut(&World, usize) -> bool,
    P: FnMut(&World, usize) -> MovementPattern,
    U: FnMut(&mut World, usize),
{
    movement_pattern_with_navigation_batch_system_impl::<F, I, P, U, true>(
        world,
        player_transform,
        caches,
        navigation_policy,
        include_entity,
        fallback_pattern,
        on_unsupported,
        resolve_waypoint,
    )
}

pub(crate) fn apply_layer_movement_pattern_with_navigation_batch_system<F, P>(
    world: &mut World,
    layer: CollisionLayer,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    fallback_pattern: P,
    resolve_waypoint: F,
) where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    P: FnMut(&World, usize) -> MovementPattern,
{
    movement_pattern_with_navigation_batch_system_impl::<_, _, _, _, false>(
        world,
        player_transform,
        caches,
        navigation_policy,
        |world, entity_index| {
            world.collider_layer_at(entity_index) == Some(layer)
                && world.transforms[entity_index].is_some()
        },
        fallback_pattern,
        |world, entity_index| {
            world.velocities[entity_index] = Some(Velocity::default());
        },
        resolve_waypoint,
    );
}

pub(crate) fn apply_layer_movement_pattern_phase<F>(
    world: &mut World,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    config: LayerMovementPatternPhaseConfig,
    resolve_waypoint: F,
) where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    apply_layer_movement_pattern_with_navigation_batch_system(
        world,
        config.layer,
        config.player_transform,
        caches,
        config.navigation_policy,
        |_, _| config.fallback_pattern,
        resolve_waypoint,
    );
}

#[cfg(test)]
pub(crate) fn run_layer_movement_pattern_with_navigation_batch_system<F, P>(
    world: &mut World,
    layer: CollisionLayer,
    player_transform: Option<Transform2D>,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    navigation_policy: MovementNavigationPolicy,
    fallback_pattern: P,
    resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
    P: FnMut(&World, usize) -> MovementPattern,
{
    movement_pattern_with_navigation_batch_system_impl::<_, _, _, _, true>(
        world,
        player_transform,
        caches,
        navigation_policy,
        |world, entity_index| {
            world.collider_layer_at(entity_index) == Some(layer)
                && world.transforms[entity_index].is_some()
        },
        fallback_pattern,
        |world, entity_index| {
            world.velocities[entity_index] = Some(Velocity::default());
        },
        resolve_waypoint,
    )
}

#[cfg(test)]
pub(crate) fn run_layer_movement_pattern_phase<F>(
    world: &mut World,
    caches: &mut Vec<Option<MovementNavigationTargetCache>>,
    config: LayerMovementPatternPhaseConfig,
    resolve_waypoint: F,
) -> MovementPatternBatchRunStats
where
    F: FnMut(Transform2D, Transform2D) -> Option<Transform2D>,
{
    run_layer_movement_pattern_with_navigation_batch_system(
        world,
        config.layer,
        config.player_transform,
        caches,
        config.navigation_policy,
        |_, _| config.fallback_pattern,
        resolve_waypoint,
    )
}

fn apply_topdown_input_movement(
    world: &mut World,
    entity_index: usize,
    input: InputState,
    default_speed: f32,
) -> MovementPatternApplication {
    let speed = match world.movement_pattern_at_index(entity_index) {
        Some(MovementPattern::TopdownInput { speed }) => speed,
        _ => default_speed,
    };
    let Some(slot) = world.velocities.get_mut(entity_index) else {
        return MovementPatternApplication::Unsupported;
    };
    *slot = Some(topdown_input_velocity(input, speed));
    MovementPatternApplication::Applied
}

#[cfg(test)]
pub(crate) fn run_topdown_input_movement_system(
    world: &mut World,
    entity: Entity,
    input: InputState,
    default_speed: f32,
) -> MovementPatternApplication {
    apply_topdown_input_movement_phase(
        world,
        TopdownInputMovementPhaseConfig {
            entity,
            input: FrameInputSnapshot::current_only(input),
            default_speed,
        },
    )
}

pub(crate) fn apply_topdown_input_movement_phase(
    world: &mut World,
    config: TopdownInputMovementPhaseConfig,
) -> MovementPatternApplication {
    let entity = config.entity;
    let entity_index = entity.id as usize;
    if !world.is_current_entity(entity) {
        return MovementPatternApplication::Unsupported;
    }
    apply_topdown_input_movement(
        world,
        entity_index,
        config.input.current,
        config.default_speed,
    )
}

pub(crate) fn topdown_input_direction(input: InputState) -> Velocity {
    let mut x: f32 = 0.0;
    let mut y: f32 = 0.0;
    if input.w == 1 {
        y -= 1.0;
    }
    if input.s == 1 {
        y += 1.0;
    }
    if input.a == 1 {
        x -= 1.0;
    }
    if input.d == 1 {
        x += 1.0;
    }
    let len = (x * x + y * y).sqrt();
    if len > 0.0 {
        Velocity {
            vx: x / len,
            vy: y / len,
        }
    } else {
        Velocity::default()
    }
}

pub(crate) fn topdown_input_velocity(input: InputState, speed: f32) -> Velocity {
    let direction = topdown_input_direction(input);
    Velocity {
        vx: direction.vx * speed,
        vy: direction.vy * speed,
    }
}

fn movement_target_transform_from(
    world: &World,
    player_transform: Option<Transform2D>,
    source_transform: Transform2D,
    target: MovementTarget,
) -> Option<Transform2D> {
    match target {
        MovementTarget::Player | MovementTarget::NearestPlayer => player_transform,
        MovementTarget::NearestEnemy => {
            nearest_layer_transform(world, source_transform, CollisionLayer::Enemy)
        }
        MovementTarget::NearestLayer(layer) => {
            nearest_layer_transform(world, source_transform, layer)
        }
        MovementTarget::NearestFaction(faction_id) => {
            nearest_faction_transform(world, source_transform, faction_id)
        }
        MovementTarget::NearestTag(tag_id) => {
            nearest_tag_transform(world, source_transform, tag_id)
        }
        MovementTarget::Entity(entity) => world.transform(entity),
    }
}

fn nearest_layer_transform(
    world: &World,
    source_transform: Transform2D,
    layer: CollisionLayer,
) -> Option<Transform2D> {
    let mut nearest = None;
    let mut nearest_distance_squared = f32::INFINITY;
    for &index in world.alive_indices() {
        if world.collider_layer_at(index) != Some(layer) {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let dx = transform.x - source_transform.x;
        let dy = transform.y - source_transform.y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= 0.0001 || distance_squared >= nearest_distance_squared {
            continue;
        }
        nearest = Some(transform);
        nearest_distance_squared = distance_squared;
    }
    nearest
}

fn nearest_faction_transform(
    world: &World,
    source_transform: Transform2D,
    faction_id: u32,
) -> Option<Transform2D> {
    GameplayFaction::new(faction_id, 0)?;
    let mut nearest = None;
    let mut nearest_distance_squared = f32::INFINITY;
    for &index in world.gameplay_faction_indices(faction_id) {
        let Some(faction) = world.gameplay_faction_at_index(index) else {
            continue;
        };
        if faction.faction_id != faction_id {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let dx = transform.x - source_transform.x;
        let dy = transform.y - source_transform.y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= 0.0001 || distance_squared >= nearest_distance_squared {
            continue;
        }
        nearest = Some(transform);
        nearest_distance_squared = distance_squared;
    }
    nearest
}

fn nearest_tag_transform(
    world: &World,
    source_transform: Transform2D,
    tag_id: u32,
) -> Option<Transform2D> {
    if tag_id > crate::components::gameplay::GAMEPLAY_TAG_MAX_ID {
        return None;
    }
    let mut nearest = None;
    let mut nearest_distance_squared = f32::INFINITY;
    for &index in world.gameplay_tag_indices(tag_id) {
        let Some(tags) = world.gameplay_tags_at_index(index) else {
            continue;
        };
        if !tags.contains(tag_id) {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let dx = transform.x - source_transform.x;
        let dy = transform.y - source_transform.y;
        let distance_squared = dx * dx + dy * dy;
        if distance_squared <= 0.0001 || distance_squared >= nearest_distance_squared {
            continue;
        }
        nearest = Some(transform);
        nearest_distance_squared = distance_squared;
    }
    nearest
}

pub(crate) fn velocity_toward(from: Transform2D, to: Transform2D, speed: f32) -> Velocity {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let len = (dx * dx + dy * dy).sqrt();
    if len > 0.0001 {
        Velocity {
            vx: dx / len * speed,
            vy: dy / len * speed,
        }
    } else {
        Velocity::default()
    }
}

fn clamp_turn_rate(turn_rate: f32) -> f32 {
    if !turn_rate.is_finite() {
        0.0
    } else {
        turn_rate.clamp(0.0, 1.0)
    }
}

fn velocity_interpolate(current: Velocity, desired: Velocity, turn_rate: f32) -> Velocity {
    if turn_rate <= 0.0 {
        return current;
    }
    if turn_rate >= 1.0 {
        return desired;
    }
    Velocity {
        vx: current.vx + (desired.vx - current.vx) * turn_rate,
        vy: current.vy + (desired.vy - current.vy) * turn_rate,
    }
}

fn velocity_with_acceleration_and_speed_cap(
    current: Velocity,
    acceleration_x: f32,
    acceleration_y: f32,
    max_speed: f32,
) -> Velocity {
    let mut velocity = Velocity {
        vx: current.vx + acceleration_x,
        vy: current.vy + acceleration_y,
    };
    let speed_sq = velocity.vx * velocity.vx + velocity.vy * velocity.vy;
    let max_speed_sq = max_speed * max_speed;
    if speed_sq > max_speed_sq {
        let current_speed = speed_sq.sqrt();
        if current_speed > 0.0 {
            let scale = max_speed / current_speed;
            velocity.vx *= scale;
            velocity.vy *= scale;
        }
    }
    velocity
}

fn has_reached_movement_navigation_target(
    from: Transform2D,
    to: Transform2D,
    reached_distance_squared: f32,
) -> bool {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    dx * dx + dy * dy <= reached_distance_squared.max(0.0)
}

pub(crate) fn orbit_velocity_with_band(
    transform: Transform2D,
    target_transform: Transform2D,
    speed: f32,
    radius: f32,
    radial_band: f32,
) -> Velocity {
    let dx = transform.x - target_transform.x;
    let dy = transform.y - target_transform.y;
    let distance = (dx * dx + dy * dy).sqrt();
    if distance <= 0.0001 {
        return Velocity { vx: speed, vy: 0.0 };
    }

    let radial_x = dx / distance;
    let radial_y = dy / distance;
    let mut vx = -radial_y;
    let mut vy = radial_x;

    if distance < radius - radial_band {
        vx += radial_x;
        vy += radial_y;
    } else if distance > radius + radial_band {
        vx -= radial_x;
        vy -= radial_y;
    }

    let len = (vx * vx + vy * vy).sqrt();
    if len <= 0.0001 {
        return Velocity::default();
    }
    Velocity {
        vx: vx / len * speed,
        vy: vy / len * speed,
    }
}

pub(crate) fn tick_lifetime(
    world: &mut World,
    entity_index: usize,
    delta_seconds: f32,
) -> Option<f32> {
    world.tick_gameplay_lifetime_at(entity_index, delta_seconds)
}

pub(crate) fn has_expired_lifetime(world: &World, entity_index: usize) -> bool {
    world
        .gameplay_lifetime_at(entity_index)
        .is_some_and(|time_left| time_left <= 0.0)
}

pub(crate) fn run_lifetime_system(
    world: &mut World,
    delta_seconds: f32,
    pending_despawn: &mut Vec<Entity>,
) -> usize {
    let mut expired_count = 0;
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let entity_index = world.alive_indices()[alive_position];
        tick_lifetime(world, entity_index, delta_seconds);
        if has_expired_lifetime(world, entity_index) {
            queue_despawn(world, entity_index, pending_despawn);
            expired_count += 1;
        }
    }
    expired_count
}

pub(crate) fn queue_despawn(world: &World, entity_index: usize, pending_despawn: &mut Vec<Entity>) {
    if let Some(entity) = entity_at(world, entity_index) {
        pending_despawn.push(entity);
    }
}

pub(crate) fn queue_marked_despawn(
    world: &World,
    entity_index: usize,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> bool {
    let Some(marked) = marked_for_despawn.get_mut(entity_index) else {
        return false;
    };
    if *marked {
        return false;
    }
    let Some(entity) = entity_at(world, entity_index) else {
        return false;
    };
    *marked = true;
    pending_despawn.push(entity);
    true
}

pub(crate) fn damage_at_or_default(world: &World, entity_index: usize, default_damage: f32) -> f32 {
    world
        .damage_at_index(entity_index)
        .unwrap_or(default_damage)
}

pub(crate) fn collision_damage_allowed(
    world: &World,
    source_index: usize,
    target_index: usize,
) -> bool {
    faction_damage_denial(world, source_index, target_index).is_none()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FactionDamageDenial {
    pub(crate) source: Entity,
    pub(crate) target: Entity,
    pub(crate) source_faction_id: u32,
    pub(crate) target_faction_id: u32,
}

pub(crate) fn faction_damage_denial(
    world: &World,
    source_index: usize,
    target_index: usize,
) -> Option<FactionDamageDenial> {
    let source_faction = world.gameplay_faction_at_index(source_index)?;
    let target_faction = world.gameplay_faction_at_index(target_index)?;
    let can_damage = world.gameplay_factions_can_damage(source_faction, target_faction);
    if can_damage {
        return None;
    }
    Some(FactionDamageDenial {
        source: entity_at(world, source_index)?,
        target: entity_at(world, target_index)?,
        source_faction_id: source_faction.faction_id,
        target_faction_id: target_faction.faction_id,
    })
}

pub(crate) fn projectile_collision_target_at(
    world: &World,
    projectile_index: usize,
) -> ProjectileCollisionTarget {
    world.projectile_collision_target_at(projectile_index)
}

pub(crate) fn default_projectile_damage_allowed(
    world: &World,
    projectile_index: usize,
    target_index: usize,
    expected_target: ProjectileCollisionTarget,
) -> bool {
    projectile_collision_target_at(world, projectile_index) == expected_target
        && collision_damage_allowed(world, projectile_index, target_index)
}

pub(crate) fn default_melee_damage_allowed(
    world: &World,
    attacker_index: usize,
    target_index: usize,
) -> bool {
    collision_damage_allowed(world, attacker_index, target_index)
}

pub(crate) fn build_collision_layer_pairs(
    scratch: &mut CollisionScratch,
    world: &World,
    layer_a: CollisionLayer,
    layer_b: CollisionLayer,
    pairs: &mut Vec<CollisionPair>,
) {
    CollisionSystem::build_layer_pairs_into(scratch, world, layer_a, layer_b, pairs);
}

pub(crate) fn build_swept_collision_layer_pairs(
    scratch: &mut CollisionScratch,
    world: &World,
    moving_layer: CollisionLayer,
    target_layer: CollisionLayer,
    delta: f32,
    pairs: &mut Vec<CollisionPair>,
) {
    CollisionSystem::build_swept_layer_pairs_into(
        scratch,
        world,
        moving_layer,
        target_layer,
        delta,
        pairs,
    );
}

pub(crate) fn collision_reaction_pair_for_layer_pair(
    world: &World,
    pair: CollisionPair,
    source_layer: CollisionLayer,
    other_layer: CollisionLayer,
    marked_for_despawn: &[bool],
) -> Option<CollisionReactionPair> {
    let source_index = pair.a.id as usize;
    let other_index = pair.b.id as usize;
    if marked_for_despawn
        .get(source_index)
        .copied()
        .unwrap_or(true)
        || marked_for_despawn.get(other_index).copied().unwrap_or(true)
    {
        return None;
    }
    if entity_at(world, source_index)? != pair.a || entity_at(world, other_index)? != pair.b {
        return None;
    }
    if !is_alive_layer(world, source_index, source_layer)
        || !is_alive_layer(world, other_index, other_layer)
    {
        return None;
    }
    Some(CollisionReactionPair::new(
        source_index,
        other_index,
        pair.a,
        pair.b,
    ))
}

pub(crate) fn apply_collision_despawn_reaction_for_pair(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<CollisionDespawnReactionOutcome> {
    let target_index = pair.target_index(target);
    let target_entity = pair.target_entity(target);
    queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn).then_some(
        CollisionDespawnReactionOutcome {
            target_index,
            target: target_entity,
        },
    )
}

pub(crate) fn apply_collision_pickup_reaction_for_pair(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<CollisionPickupReactionOutcome> {
    let (pickup_index, pickup_entity, collector_index, collector_entity) = match target {
        CollisionTarget::SelfEntity => {
            (pair.source_index, pair.source, pair.other_index, pair.other)
        }
        CollisionTarget::OtherEntity => {
            (pair.other_index, pair.other, pair.source_index, pair.source)
        }
    };

    if !is_alive_layer(world, collector_index, CollisionLayer::Player)
        || marked_for_despawn
            .get(collector_index)
            .copied()
            .unwrap_or(false)
        || !is_alive_layer(world, pickup_index, CollisionLayer::Pickup)
        || marked_for_despawn
            .get(pickup_index)
            .copied()
            .unwrap_or(false)
    {
        return None;
    }

    let pickup = world.pickup_at_index(pickup_index)?;
    if pickup.item_id != GAMEPLAY_PICKUP_ITEM_SCORE || !pickup.despawn_on_collect {
        return None;
    }

    let target_removed =
        queue_marked_despawn(world, pickup_index, marked_for_despawn, pending_despawn);
    target_removed.then_some(CollisionPickupReactionOutcome {
        pickup_index,
        pickup: pickup_entity,
        collector_index,
        collector: collector_entity,
        item_id: pickup.item_id,
        count: pickup.count,
        target_removed,
    })
}

pub(crate) fn commit_collision_side_effect_reaction_for_pair(
    pair: CollisionReactionPair,
    reaction: &mut CollisionReaction,
    contact_entered: bool,
) -> Option<CollisionSideEffectEvaluation> {
    match reaction {
        CollisionReaction::PlaySound {
            sound_id,
            volume,
            pitch,
            cooldown,
            replace_default,
            trigger,
        } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::PlaySound {
                    sound_id: *sound_id,
                    volume: *volume,
                    pitch: *pitch,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: *replace_default,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::SpawnParticle {
            preset_id,
            target,
            cooldown,
            replace_default,
            trigger,
        } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::SpawnParticle {
                    preset_id: *preset_id,
                    target_index: pair.target_index(*target),
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: *replace_default,
                effect,
            })
        }
        CollisionReaction::CameraShake { cooldown, trigger } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::CameraShake)
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::EmitEffect {
            effect_id,
            effect_type,
            target,
            intensity,
            radius,
            cooldown,
            trigger,
        } => {
            let effect = if trigger.is_allowed(contact_entered) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::EmitEffect {
                    effect_id: *effect_id,
                    effect_type: *effect_type,
                    target_index: pair.target_index(*target),
                    intensity: *intensity,
                    radius: *radius,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::Damage { .. }
        | CollisionReaction::AreaDamage { .. }
        | CollisionReaction::Knockback { .. }
        | CollisionReaction::Pickup { .. }
        | CollisionReaction::Despawn { .. }
        | CollisionReaction::SpawnPrefab { .. } => None,
    }
}

pub(crate) fn collision_spawn_prefab_reaction_for_pair(
    pair: CollisionReactionPair,
    reaction: CollisionReaction,
    contact_entered: bool,
) -> Option<CollisionSpawnPrefabEvaluation> {
    let CollisionReaction::SpawnPrefab {
        action_id,
        prefab_id,
        target,
        cooldown,
        trigger,
        offset_x,
        offset_y,
    } = reaction
    else {
        return None;
    };
    if !trigger.is_allowed(contact_entered) || !cooldown.is_ready() {
        return None;
    }
    Some(CollisionSpawnPrefabEvaluation {
        reaction_owner_index: pair.source_index,
        source: pair.source,
        action_id,
        prefab_id,
        target,
        anchor_index: pair.target_index(target),
        anchor: pair.target_entity(target),
        offset_x,
        offset_y,
    })
}

pub(crate) fn commit_tile_collision_side_effect_reaction(
    source_index: usize,
    reaction: &mut CollisionReaction,
) -> Option<CollisionSideEffectEvaluation> {
    match reaction {
        CollisionReaction::PlaySound {
            sound_id,
            volume,
            pitch,
            cooldown,
            trigger,
            ..
        } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::PlaySound {
                    sound_id: *sound_id,
                    volume: *volume,
                    pitch: *pitch,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::SpawnParticle {
            preset_id,
            target: CollisionTarget::SelfEntity,
            cooldown,
            trigger,
            ..
        } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::SpawnParticle {
                    preset_id: *preset_id,
                    target_index: source_index,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::CameraShake { cooldown, trigger } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::CameraShake)
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::EmitEffect {
            effect_id,
            effect_type,
            target: CollisionTarget::SelfEntity,
            intensity,
            radius,
            cooldown,
            trigger,
        } => {
            let effect = if trigger.is_allowed(true) && cooldown.commit_if_ready() {
                Some(CollisionSideEffect::EmitEffect {
                    effect_id: *effect_id,
                    effect_type: *effect_type,
                    target_index: source_index,
                    intensity: *intensity,
                    radius: *radius,
                })
            } else {
                None
            };
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect,
            })
        }
        CollisionReaction::SpawnParticle {
            target: CollisionTarget::OtherEntity,
            ..
        }
        | CollisionReaction::EmitEffect {
            target: CollisionTarget::OtherEntity,
            ..
        }
        | CollisionReaction::AreaDamage { .. }
        | CollisionReaction::Knockback { .. }
        | CollisionReaction::Damage { .. }
        | CollisionReaction::Pickup { .. }
        | CollisionReaction::Despawn { .. }
        | CollisionReaction::SpawnPrefab { .. } => None,
    }
}

pub(crate) fn tile_collision_spawn_prefab_reaction(
    world: &World,
    source_index: usize,
    reaction: CollisionReaction,
) -> Option<CollisionSpawnPrefabEvaluation> {
    let CollisionReaction::SpawnPrefab {
        action_id,
        prefab_id,
        target,
        cooldown,
        trigger,
        offset_x,
        offset_y,
    } = reaction
    else {
        return None;
    };
    if target != CollisionTarget::SelfEntity || !trigger.is_allowed(true) || !cooldown.is_ready() {
        return None;
    }
    let source = entity_at(world, source_index)?;
    Some(CollisionSpawnPrefabEvaluation {
        reaction_owner_index: source_index,
        source,
        action_id,
        prefab_id,
        target,
        anchor_index: source_index,
        anchor: source,
        offset_x,
        offset_y,
    })
}

pub(crate) fn commit_collision_spawn_prefab_reaction_cooldown(
    world: &mut World,
    evaluation: CollisionSpawnPrefabEvaluation,
) -> bool {
    let Some(mut reactions) = world.collision_reactions_at_index(evaluation.reaction_owner_index)
    else {
        return false;
    };
    let mut committed = false;
    for reaction in reactions.iter_mut() {
        let CollisionReaction::SpawnPrefab {
            action_id,
            cooldown,
            ..
        } = reaction
        else {
            continue;
        };
        if *action_id != evaluation.action_id || !cooldown.is_ready() {
            continue;
        }
        cooldown.commit();
        committed = true;
        break;
    }
    if !committed {
        return false;
    }
    world.replace_collision_reactions_at_index(evaluation.reaction_owner_index, Some(reactions))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_collision_reaction_set_for_pair<F>(
    world: &mut World,
    pair: CollisionReactionPair,
    reactions: &mut CollisionReactionSet,
    contact_entered: bool,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: F,
) -> CollisionReactionSetOutcome
where
    F: FnMut(&World, usize) -> CollisionDamageReactionDefaults,
{
    let mut outcome = CollisionReactionSetOutcome::default();
    for reaction in reactions.iter_mut() {
        match reaction {
            CollisionReaction::Damage { target } => {
                outcome.overrides_default_gameplay = true;
                let target_index = pair.target_index(*target);
                let damage_outcome = apply_collision_damage_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    damage_defaults_for(world, target_index),
                    marked_for_despawn,
                    pending_despawn,
                );
                if let Some(damage_outcome) = damage_outcome {
                    push_reaction_outcome(&mut outcome.damage_outcomes, damage_outcome);
                } else if let Some(denial) = collision_damage_reaction_faction_denial(
                    world,
                    pair,
                    *target,
                    marked_for_despawn,
                ) {
                    push_reaction_outcome(&mut outcome.faction_damage_denials, denial);
                }
            }
            CollisionReaction::AreaDamage {
                radius,
                target_layer,
            } => {
                outcome.overrides_default_gameplay = true;
                let area_outcome = apply_collision_area_damage_reaction_for_pair(
                    world,
                    pair,
                    *radius,
                    *target_layer,
                    area_damage_hits,
                    marked_for_despawn,
                    pending_despawn,
                    &mut damage_defaults_for,
                );
                for damage_outcome in area_outcome.damage_outcomes() {
                    push_reaction_outcome(&mut outcome.damage_outcomes, damage_outcome);
                }
                for denial in area_outcome.faction_damage_denials() {
                    push_reaction_outcome(&mut outcome.faction_damage_denials, denial);
                }
            }
            CollisionReaction::Pickup { target } => {
                outcome.overrides_default_gameplay = true;
                let pickup_outcome = apply_collision_pickup_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    marked_for_despawn,
                    pending_despawn,
                );
                if let Some(pickup_outcome) = pickup_outcome {
                    push_reaction_outcome(&mut outcome.pickup_outcomes, pickup_outcome);
                }
            }
            CollisionReaction::Knockback { target, impulse } => {
                let knockback_outcome = apply_collision_knockback_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    *impulse,
                    marked_for_despawn,
                );
                if let Some(knockback_outcome) = knockback_outcome {
                    push_reaction_outcome(&mut outcome.knockback_outcomes, knockback_outcome);
                }
            }
            CollisionReaction::Despawn { target } => {
                outcome.overrides_default_gameplay = true;
                let despawn_outcome = apply_collision_despawn_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    marked_for_despawn,
                    pending_despawn,
                );
                if let Some(despawn_outcome) = despawn_outcome {
                    push_reaction_outcome(&mut outcome.despawn_outcomes, despawn_outcome);
                }
            }
            CollisionReaction::PlaySound { .. }
            | CollisionReaction::SpawnParticle { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::EmitEffect { .. } => {
                if let Some(evaluation) =
                    commit_collision_side_effect_reaction_for_pair(pair, reaction, contact_entered)
                {
                    outcome.replace_default_audio |= evaluation.replace_default_audio;
                    outcome.replace_default_particle |= evaluation.replace_default_particle;
                    push_reaction_outcome(&mut outcome.side_effects, evaluation);
                }
            }
            CollisionReaction::SpawnPrefab { .. } => {
                if let Some(evaluation) =
                    collision_spawn_prefab_reaction_for_pair(pair, *reaction, contact_entered)
                {
                    push_reaction_outcome(&mut outcome.spawn_prefabs, evaluation);
                }
            }
        }
    }
    outcome
}

pub(crate) fn apply_collision_reaction_sets_for_pair<F>(
    world: &mut World,
    pair: CollisionReactionPair,
    contact_entered: bool,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    damage_defaults: F,
) -> Option<CollisionReactionSetsForPairOutcome>
where
    F: Fn(&World, usize) -> CollisionDamageReactionDefaults + Copy,
{
    let first_reactions = world.collision_reactions_at_index(pair.source_index);
    let second_reactions = world.collision_reactions_at_index(pair.other_index);
    if first_reactions.is_none() && second_reactions.is_none() {
        return None;
    }

    let mut outcome = CollisionReactionSetsForPairOutcome::default();
    if let Some(mut reactions) = first_reactions {
        let reaction_outcome = apply_collision_reaction_set_for_pair(
            world,
            pair,
            &mut reactions,
            contact_entered,
            area_damage_hits,
            marked_for_despawn,
            pending_despawn,
            damage_defaults,
        );
        outcome.push(pair, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.source_index, Some(reactions));
    }
    if let Some(mut reactions) = second_reactions {
        let reversed = pair.reversed();
        let reaction_outcome = apply_collision_reaction_set_for_pair(
            world,
            reversed,
            &mut reactions,
            contact_entered,
            area_damage_hits,
            marked_for_despawn,
            pending_despawn,
            damage_defaults,
        );
        outcome.push(reversed, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.other_index, Some(reactions));
    }
    Some(outcome)
}

pub(crate) fn has_collision_reaction_sets_for_pair(
    world: &World,
    pair: CollisionReactionPair,
) -> bool {
    world
        .collision_reactions_at_index(pair.source_index)
        .is_some()
        || world
            .collision_reactions_at_index(pair.other_index)
            .is_some()
}

pub(crate) fn summarize_collision_reaction_set_outcome<F>(
    reaction_outcome: &CollisionReactionSetOutcome,
    mut target_role: F,
) -> CollisionReactionOutcomeSummary
where
    F: FnMut(usize) -> CollisionReactionTargetRole,
{
    let mut summary = CollisionReactionOutcomeSummary {
        overrides_default_gameplay: reaction_outcome.overrides_default_gameplay,
        replace_default_audio: reaction_outcome.replace_default_audio,
        replace_default_particle: reaction_outcome.replace_default_particle,
        ..CollisionReactionOutcomeSummary::default()
    };

    for damage_outcome in reaction_outcome.damage_outcomes() {
        summary.total_damage += damage_outcome.damage;
        match target_role(damage_outcome.target_index) {
            CollisionReactionTargetRole::Enemy => {
                summary.enemy_damaged = true;
                if damage_outcome.killed {
                    summary.enemy_removed = true;
                    summary.score_delta = summary
                        .score_delta
                        .saturating_add(damage_outcome.score_reward);
                }
            }
            CollisionReactionTargetRole::Player => {
                if damage_outcome.killed {
                    summary.player_game_over = true;
                }
            }
            CollisionReactionTargetRole::Other => {
                if damage_outcome.killed {
                    summary.score_delta = summary
                        .score_delta
                        .saturating_add(damage_outcome.score_reward);
                }
            }
        }
    }

    for pickup_outcome in reaction_outcome.pickup_outcomes() {
        summary.pickup_collected = true;
        summary.score_delta = summary.score_delta.saturating_add(pickup_outcome.count);
    }

    summary.faction_damage_denied = reaction_outcome.faction_damage_denials().next().is_some();

    for despawn_outcome in reaction_outcome.despawn_outcomes() {
        if target_role(despawn_outcome.target_index) == CollisionReactionTargetRole::Enemy {
            summary.enemy_removed = true;
        }
    }

    summary
}

pub(crate) fn collision_gameplay_events_for_reaction_outcome(
    context: CollisionReactionPair,
    reaction_outcome: &CollisionReactionSetOutcome,
) -> CollisionGameplayEventPayloadSet {
    let mut events = CollisionGameplayEventPayloadSet::default();

    for damage_outcome in reaction_outcome.damage_outcomes() {
        events.push(CollisionGameplayEventPayload::Damage {
            target: damage_outcome.target,
            source: context.source,
            damage: damage_outcome.damage,
            target_removed: damage_outcome.target_removed,
        });
    }

    for denial in reaction_outcome.faction_damage_denials() {
        events.push(CollisionGameplayEventPayload::FactionDamageDenied {
            target: denial.target,
            source: denial.source,
            source_faction_id: denial.source_faction_id,
            target_faction_id: denial.target_faction_id,
        });
    }

    for pickup_outcome in reaction_outcome.pickup_outcomes() {
        events.push(CollisionGameplayEventPayload::PickupCollected {
            collector: pickup_outcome.collector,
            pickup: pickup_outcome.pickup,
            item_id: pickup_outcome.item_id,
            count: pickup_outcome.count,
            target_removed: pickup_outcome.target_removed,
        });
    }

    for despawn_outcome in reaction_outcome.despawn_outcomes() {
        events.push(CollisionGameplayEventPayload::Despawn {
            target: despawn_outcome.target,
            source: context.source,
        });
    }

    events
}

pub(crate) const fn default_collision_damage_gameplay_event_payload(
    outcome: DefaultCollisionDamageHitOutcome,
) -> CollisionGameplayEventPayload {
    CollisionGameplayEventPayload::Damage {
        target: outcome.target,
        source: outcome.source,
        damage: outcome.damage,
        target_removed: outcome.target_removed,
    }
}

pub(crate) const fn default_collision_damage_score_delta(
    outcome: DefaultCollisionDamageHitOutcome,
) -> u32 {
    if outcome.killed {
        outcome.score_reward
    } else {
        0
    }
}

pub(crate) fn commit_score_delta(score: &mut u32, delta: u32) {
    *score = (*score).saturating_add(delta);
}

pub(crate) fn target_only_default_collision_damage_hit_presentation_payload(
    world: &World,
    outcome: DefaultCollisionDamageHitOutcome,
) -> CollisionHitPresentationPayload {
    CollisionHitPresentationPayload {
        source: outcome.source,
        target: outcome.target,
        damage: outcome.damage,
        emit_audio: true,
        particle_position: world
            .transforms
            .get(outcome.target_index)
            .copied()
            .flatten(),
    }
}

pub(crate) fn collision_side_effect_payload(
    world: &World,
    evaluation: CollisionSideEffectEvaluation,
) -> Option<CollisionSideEffectPayload> {
    match evaluation.effect {
        Some(CollisionSideEffect::PlaySound {
            sound_id,
            volume,
            pitch,
        }) => Some(CollisionSideEffectPayload::PlaySound {
            sound_id,
            volume,
            pitch,
        }),
        Some(CollisionSideEffect::SpawnParticle {
            preset_id,
            target_index,
        }) => world
            .transforms
            .get(target_index)
            .copied()
            .flatten()
            .map(|position| CollisionSideEffectPayload::SpawnParticleAt {
                preset_id,
                position,
            }),
        Some(CollisionSideEffect::CameraShake) => Some(CollisionSideEffectPayload::CameraShake),
        Some(CollisionSideEffect::EmitEffect {
            effect_id,
            effect_type,
            target_index,
            intensity,
            radius,
        }) => entity_at(world, target_index).map(|actor| {
            CollisionSideEffectPayload::PresentationEffect {
                actor,
                effect_id,
                effect_type,
                intensity,
                radius,
            }
        }),
        None => None,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_default_collision_damage_hit(
    world: &mut World,
    source_index: usize,
    target_index: usize,
    damage: f32,
    default_target_health: f32,
    default_score_reward: u32,
    despawn_source: bool,
    despawn_target_on_kill: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<DefaultCollisionDamageHitOutcome> {
    let source = entity_at(world, source_index)?;
    let target = entity_at(world, target_index)?;
    let source_removed = despawn_source
        && queue_marked_despawn(world, source_index, marked_for_despawn, pending_despawn);
    let damage_outcome = apply_damage_to_health(
        world,
        target_index,
        damage,
        default_target_health,
        default_score_reward,
    );
    let target_removed = damage_outcome.killed
        && despawn_target_on_kill
        && queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn);

    Some(DefaultCollisionDamageHitOutcome {
        source_index,
        source,
        source_removed,
        target_index,
        target,
        damage,
        killed: damage_outcome.killed,
        target_removed,
        score_reward: damage_outcome.score_reward,
    })
}

pub(crate) fn apply_default_collision_game_over_hit(
    world: &World,
    source_index: usize,
    target_index: usize,
    damage: f32,
    despawn_source: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<DefaultCollisionGameOverHitOutcome> {
    let source = entity_at(world, source_index)?;
    let target = entity_at(world, target_index)?;
    let source_removed = despawn_source
        && queue_marked_despawn(world, source_index, marked_for_despawn, pending_despawn);

    Some(DefaultCollisionGameOverHitOutcome {
        source_index,
        source,
        source_removed,
        target_index,
        target,
        damage,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_tile_collision_reaction_set(
    world: &mut World,
    source_index: usize,
    impact_center: Transform2D,
    reactions: &mut CollisionReactionSet,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: impl FnMut(&World, usize) -> CollisionDamageReactionDefaults,
) -> TileCollisionReactionSetOutcome {
    let mut outcome = TileCollisionReactionSetOutcome::default();
    for reaction in reactions.iter_mut() {
        match reaction {
            CollisionReaction::AreaDamage {
                radius,
                target_layer,
            } => {
                let query_height_span = world.height_span_at(source_index);
                let area_outcome = apply_collision_area_damage_reaction_at_center(
                    world,
                    source_index,
                    impact_center,
                    *radius,
                    *target_layer,
                    query_height_span,
                    area_damage_hits,
                    marked_for_despawn,
                    pending_despawn,
                    &mut damage_defaults_for,
                );
                for damage_outcome in area_outcome.damage_outcomes() {
                    push_reaction_outcome(
                        &mut outcome.reaction_outcome.damage_outcomes,
                        damage_outcome,
                    );
                }
                for denial in area_outcome.faction_damage_denials() {
                    push_reaction_outcome(
                        &mut outcome.reaction_outcome.faction_damage_denials,
                        denial,
                    );
                }
            }
            CollisionReaction::Despawn {
                target: CollisionTarget::SelfEntity,
            } => {
                if queue_marked_despawn(world, source_index, marked_for_despawn, pending_despawn) {
                    outcome.queued_self_despawn = true;
                    if let Some(source) = entity_at(world, source_index) {
                        outcome.despawn_outcome = Some(CollisionDespawnReactionOutcome {
                            target_index: source_index,
                            target: source,
                        });
                    }
                }
            }
            CollisionReaction::PlaySound { .. }
            | CollisionReaction::SpawnParticle { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::EmitEffect { .. } => {
                if let Some(evaluation) =
                    commit_tile_collision_side_effect_reaction(source_index, reaction)
                {
                    outcome.reaction_outcome.replace_default_audio |=
                        evaluation.replace_default_audio;
                    outcome.reaction_outcome.replace_default_particle |=
                        evaluation.replace_default_particle;
                    push_reaction_outcome(&mut outcome.reaction_outcome.side_effects, evaluation);
                }
            }
            CollisionReaction::SpawnPrefab { .. } => {
                if let Some(evaluation) =
                    tile_collision_spawn_prefab_reaction(world, source_index, *reaction)
                {
                    push_reaction_outcome(&mut outcome.reaction_outcome.spawn_prefabs, evaluation);
                }
            }
            CollisionReaction::Damage { .. }
            | CollisionReaction::Knockback { .. }
            | CollisionReaction::Pickup { .. }
            | CollisionReaction::Despawn {
                target: CollisionTarget::OtherEntity,
            } => {}
        }
    }
    outcome
}

pub(crate) fn apply_pickup_collision_reaction_set_for_pair(
    world: &World,
    pair: CollisionReactionPair,
    reactions: &mut CollisionReactionSet,
    contact_entered: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> PickupCollisionReactionSetOutcome {
    let mut outcome = PickupCollisionReactionSetOutcome::default();
    for reaction in reactions.iter_mut() {
        match reaction {
            CollisionReaction::Pickup { target } => {
                outcome.handled_pickup = true;
                let pickup_outcome = apply_collision_pickup_reaction_for_pair(
                    world,
                    pair,
                    *target,
                    marked_for_despawn,
                    pending_despawn,
                );
                if let Some(pickup_outcome) = pickup_outcome {
                    push_reaction_outcome(&mut outcome.pickup_outcomes, pickup_outcome);
                }
            }
            CollisionReaction::PlaySound { .. }
            | CollisionReaction::SpawnParticle { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::EmitEffect { .. } => {
                if let Some(evaluation) =
                    commit_collision_side_effect_reaction_for_pair(pair, reaction, contact_entered)
                {
                    push_reaction_outcome(&mut outcome.side_effects, evaluation);
                }
            }
            CollisionReaction::SpawnPrefab { .. } => {
                if let Some(evaluation) =
                    collision_spawn_prefab_reaction_for_pair(pair, *reaction, contact_entered)
                {
                    push_reaction_outcome(&mut outcome.spawn_prefabs, evaluation);
                }
            }
            CollisionReaction::Damage { .. }
            | CollisionReaction::AreaDamage { .. }
            | CollisionReaction::Knockback { .. }
            | CollisionReaction::Despawn { .. } => {}
        }
    }
    outcome
}

pub(crate) fn apply_pickup_collision_reaction_sets_for_pair(
    world: &mut World,
    pair: CollisionReactionPair,
    contact_entered: bool,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<PickupCollisionReactionSetsForPairOutcome> {
    let first_reactions = world.collision_reactions_at_index(pair.source_index);
    let second_reactions = world.collision_reactions_at_index(pair.other_index);
    if first_reactions.is_none() && second_reactions.is_none() {
        return None;
    }

    let mut outcome = PickupCollisionReactionSetsForPairOutcome::default();
    if let Some(mut reactions) = first_reactions {
        let reaction_outcome = apply_pickup_collision_reaction_set_for_pair(
            world,
            pair,
            &mut reactions,
            contact_entered,
            marked_for_despawn,
            pending_despawn,
        );
        outcome.push(pair, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.source_index, Some(reactions));
    }
    if let Some(mut reactions) = second_reactions {
        let reversed = pair.reversed();
        let reaction_outcome = apply_pickup_collision_reaction_set_for_pair(
            world,
            reversed,
            &mut reactions,
            contact_entered,
            marked_for_despawn,
            pending_despawn,
        );
        outcome.push(reversed, reaction_outcome);
        world.replace_collision_reactions_at_index(pair.other_index, Some(reactions));
    }

    Some(outcome)
}

pub(crate) fn apply_collision_damage_reaction_for_pair(
    world: &mut World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    defaults: CollisionDamageReactionDefaults,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
) -> Option<CollisionDamageReactionOutcome> {
    let target_index = pair.target_index(target);
    let target_entity = pair.target_entity(target);
    if !world.is_alive_index(target_index)
        || marked_for_despawn
            .get(target_index)
            .copied()
            .unwrap_or(false)
        || !collision_damage_allowed(world, pair.source_index, target_index)
    {
        return None;
    }

    let damage = damage_at_or_default(world, pair.source_index, 0.0);
    let damage_outcome = apply_damage_to_health(
        world,
        target_index,
        damage,
        defaults.health,
        defaults.score_reward,
    );
    let target_removed = damage_outcome.killed
        && defaults.despawn_on_kill
        && queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn);

    Some(CollisionDamageReactionOutcome {
        target_index,
        target: target_entity,
        damage,
        killed: damage_outcome.killed,
        target_removed,
        score_reward: damage_outcome.score_reward,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_collision_area_damage_reaction_for_pair<F>(
    world: &mut World,
    pair: CollisionReactionPair,
    radius: f32,
    target_layer: CollisionLayer,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: F,
) -> CollisionReactionSetOutcome
where
    F: FnMut(&World, usize) -> CollisionDamageReactionDefaults,
{
    let Some(center) = collision_area_damage_center(world, pair) else {
        return CollisionReactionSetOutcome::default();
    };
    let query_height_span = world
        .height_span_at(pair.source_index)
        .or_else(|| world.height_span_at(pair.other_index));
    apply_collision_area_damage_reaction_at_center(
        world,
        pair.source_index,
        center,
        radius,
        target_layer,
        query_height_span,
        area_damage_hits,
        marked_for_despawn,
        pending_despawn,
        &mut damage_defaults_for,
    )
}

#[allow(clippy::too_many_arguments)]
fn apply_collision_area_damage_reaction_at_center<F>(
    world: &mut World,
    source_index: usize,
    center: Transform2D,
    radius: f32,
    target_layer: CollisionLayer,
    query_height_span: Option<crate::components::HeightSpan>,
    area_damage_hits: &mut Vec<CircleQueryHit>,
    marked_for_despawn: &mut [bool],
    pending_despawn: &mut Vec<Entity>,
    mut damage_defaults_for: F,
) -> CollisionReactionSetOutcome
where
    F: FnMut(&World, usize) -> CollisionDamageReactionDefaults,
{
    let mut outcome = CollisionReactionSetOutcome::default();
    CollisionSystem::circle_query_with_height_span_into(
        world,
        center,
        radius,
        target_layer.mask(),
        query_height_span,
        area_damage_hits,
    );

    let damage = damage_at_or_default(world, source_index, 0.0);
    let mut damaged_targets = 0;
    for hit in area_damage_hits.iter().copied() {
        if damaged_targets >= MAX_COLLISION_REACTIONS_PER_ENTITY {
            break;
        }
        let target_index = hit.entity.id as usize;
        if target_index == source_index {
            continue;
        }
        if entity_at(world, target_index) != Some(hit.entity)
            || !is_alive_layer(world, target_index, target_layer)
            || marked_for_despawn
                .get(target_index)
                .copied()
                .unwrap_or(false)
        {
            continue;
        }
        if !collision_damage_allowed(world, source_index, target_index) {
            if let Some(denial) = faction_damage_denial(world, source_index, target_index) {
                push_reaction_outcome(&mut outcome.faction_damage_denials, denial);
            }
            continue;
        }

        let defaults = damage_defaults_for(world, target_index);
        let damage_outcome = apply_damage_to_health(
            world,
            target_index,
            damage,
            defaults.health,
            defaults.score_reward,
        );
        let target_removed = damage_outcome.killed
            && defaults.despawn_on_kill
            && queue_marked_despawn(world, target_index, marked_for_despawn, pending_despawn);
        push_reaction_outcome(
            &mut outcome.damage_outcomes,
            CollisionDamageReactionOutcome {
                target_index,
                target: hit.entity,
                damage,
                killed: damage_outcome.killed,
                target_removed,
                score_reward: damage_outcome.score_reward,
            },
        );
        damaged_targets += 1;
    }
    outcome
}

pub(crate) fn apply_collision_knockback_reaction_for_pair(
    world: &mut World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    impulse: f32,
    marked_for_despawn: &[bool],
) -> Option<CollisionKnockbackReactionOutcome> {
    if !impulse.is_finite() || impulse <= 0.0 {
        return None;
    }
    let target_index = pair.target_index(target);
    if !world.is_alive_index(target_index)
        || marked_for_despawn
            .get(target_index)
            .copied()
            .unwrap_or(false)
    {
        return None;
    }
    let target_entity = entity_at(world, target_index)?;
    let direction = collision_knockback_direction(world, pair, target);
    let impulse = Velocity {
        vx: direction.vx * impulse,
        vy: direction.vy * impulse,
    };
    let velocity = world.velocities.get_mut(target_index)?;
    let current = velocity.unwrap_or_default();
    *velocity = Some(Velocity {
        vx: current.vx + impulse.vx,
        vy: current.vy + impulse.vy,
    });
    Some(CollisionKnockbackReactionOutcome {
        target_index,
        target: target_entity,
        impulse,
    })
}

fn collision_knockback_direction(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
) -> Velocity {
    let (target_index, origin_index, fallback) = match target {
        CollisionTarget::SelfEntity => (
            pair.source_index,
            pair.other_index,
            Velocity { vx: -1.0, vy: 0.0 },
        ),
        CollisionTarget::OtherEntity => (
            pair.other_index,
            pair.source_index,
            Velocity { vx: 1.0, vy: 0.0 },
        ),
    };
    let Some(target_transform) = world.transforms.get(target_index).copied().flatten() else {
        return fallback;
    };
    let Some(origin_transform) = world.transforms.get(origin_index).copied().flatten() else {
        return fallback;
    };
    normalized_direction(
        target_transform.x - origin_transform.x,
        target_transform.y - origin_transform.y,
    )
    .unwrap_or(fallback)
}

pub(crate) fn collision_damage_reaction_faction_denial(
    world: &World,
    pair: CollisionReactionPair,
    target: CollisionTarget,
    marked_for_despawn: &[bool],
) -> Option<FactionDamageDenial> {
    let target_index = pair.target_index(target);
    if !world.is_alive_index(target_index)
        || marked_for_despawn
            .get(target_index)
            .copied()
            .unwrap_or(false)
    {
        return None;
    }
    faction_damage_denial(world, pair.source_index, target_index)
}

pub(crate) fn apply_damage_to_health(
    world: &mut World,
    entity_index: usize,
    damage: f32,
    default_health: f32,
    default_score_reward: u32,
) -> DamageOutcome {
    let remaining_health = world
        .apply_damage_to_health_at_index(entity_index, damage, default_health)
        .unwrap_or(default_health);
    let killed = remaining_health <= 0.0;
    let score_reward = if killed {
        world
            .score_reward_at_index(entity_index)
            .unwrap_or(default_score_reward)
    } else {
        0
    };
    DamageOutcome {
        remaining_health,
        killed,
        score_reward,
    }
}

pub(crate) fn apply_behavior_state_machine_events(
    world: &mut World,
    events: &mut Vec<GameplayEvent>,
) {
    if events.is_empty() || !world.has_behavior_state_machines() {
        return;
    }

    let input_event_count = events.len();
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let index = world.alive_indices()[alive_position];
        let Some(source) = world.entity_at_index(index) else {
            continue;
        };
        let Some(mut machine) = world.behavior_state_machine(source) else {
            continue;
        };
        let previous_state = machine.current_state();
        let Some(next_state) = next_behavior_state(machine, source, &events[..input_event_count])
        else {
            continue;
        };
        machine.set_current_state(next_state);
        world.set_behavior_state_machine(source, machine);
        events.push(GameplayEvent::behavior_state_changed(
            source,
            previous_state,
            next_state,
        ));
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GameplayTimerDispatch {
    pub(crate) source: Entity,
    pub(crate) timer_id: u32,
    pub(crate) duration_seconds: f32,
    pub(crate) action_id: Option<u32>,
}

impl GameplayTimerDispatch {
    pub(crate) fn event(self) -> GameplayEvent {
        GameplayEvent::timer(self.source, self.timer_id, self.duration_seconds)
    }

    pub(crate) fn action_trigger(self) -> Option<ActionTriggerCommand> {
        self.action_id
            .filter(|action_id| *action_id != 0)
            .map(|action_id| ActionTriggerCommand::timer(self.source, action_id))
    }
}

pub(crate) fn tick_gameplay_timer_trigger_for_dispatch(
    source: Entity,
    timer: &mut GameplayTimerTrigger,
    delta_seconds: f32,
) -> Option<GameplayTimerDispatch> {
    if !timer.tick(delta_seconds) {
        return None;
    }
    Some(GameplayTimerDispatch {
        source,
        timer_id: timer.timer_id,
        duration_seconds: timer.duration_seconds,
        action_id: timer.action_id,
    })
}

pub(crate) fn tick_gameplay_timer_triggers(
    world: &mut World,
    delta_seconds: f32,
    events: &mut Vec<GameplayEvent>,
) {
    if delta_seconds <= 0.0 || !delta_seconds.is_finite() || !world.has_gameplay_timer_triggers() {
        return;
    }

    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let index = world.alive_indices()[alive_position];
        let Some(source) = world.entity_at_index(index) else {
            continue;
        };
        let Some(timer) = world.gameplay_timer_trigger_mut_at_index(index) else {
            continue;
        };
        let Some(dispatch) = tick_gameplay_timer_trigger_for_dispatch(source, timer, delta_seconds)
        else {
            continue;
        };
        events.push(dispatch.event());
    }
}

fn next_behavior_state(
    machine: crate::components::gameplay::BehaviorStateMachine,
    source: Entity,
    events: &[GameplayEvent],
) -> Option<u32> {
    machine
        .iter_transitions()
        .find(|transition| {
            transition.from_state == machine.current_state()
                && events.iter().any(|event| {
                    event.kind == transition.event_kind
                        && event_subject_matches_entity(event, source)
                        && event.token_id == transition.token_id
                })
        })
        .map(|transition| transition.to_state)
}

fn event_subject_matches_entity(event: &GameplayEvent, entity: Entity) -> bool {
    if event.kind == crate::gameplay_event::GAMEPLAY_EVENT_PICKUP_COLLECTED {
        return event.actor_id == entity.id && event.actor_generation == entity.generation;
    }
    event.source_id == entity.id && event.source_generation == entity.generation
}

fn push_reaction_outcome<T: Copy>(
    outcomes: &mut [Option<T>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    outcome: T,
) {
    if let Some(slot) = outcomes.iter_mut().find(|slot| slot.is_none()) {
        *slot = Some(outcome);
    }
}

fn entity_at(world: &World, entity_index: usize) -> Option<Entity> {
    world.entity_at_index(entity_index)
}

fn collision_area_damage_center(world: &World, pair: CollisionReactionPair) -> Option<Transform2D> {
    world
        .transforms
        .get(pair.source_index)
        .copied()
        .flatten()
        .or_else(|| world.transforms.get(pair.other_index).copied().flatten())
}

fn is_alive_layer(world: &World, index: usize, layer: CollisionLayer) -> bool {
    world.is_alive_index(index) && world.collider_layer_at(index) == Some(layer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::gameplay::{
        ActionAimSource, ActionBinding, BehaviorStateMachine, BehaviorStateTransition,
        CollisionReactionTrigger, Cooldown, GameplayTimerTrigger, MeleeTarget, MovementPattern,
        MovementTarget, Pickup, ProjectileActionConfig, ProjectileCollisionTarget,
        ProjectileTileImpact, SpawnAnchor, SpawnPhase,
    };
    use crate::components::AabbCollider;
    use crate::gameplay_event::{
        GameplayTileImpactEventPayload, GAMEPLAY_EVENT_PICKUP_COLLECTED,
        GAMEPLAY_EVENT_TILE_IMPACT, GAMEPLAY_EVENT_TIMER,
    };
    use crate::input::{
        INPUT_ACTION_ACTIVATION_DOWN, INPUT_ACTION_ACTIVATION_PRESSED, INPUT_ACTION_CONTROL_ENTER,
    };

    fn prepared_action(entity: Entity, binding: ActionBinding) -> PreparedAction {
        PreparedAction::new(
            entity,
            binding.action_id,
            ActionPatternKind::from_pattern(binding.pattern),
            binding,
        )
    }

    #[test]
    fn action_pattern_kind_maps_current_action_patterns_exhaustively() {
        assert_eq!(
            ActionPatternKind::from_pattern(
                ActionBinding::projectile(1, 0.5, 120.0, 1.0, 2.0).pattern
            ),
            ActionPatternKind::Projectile,
        );
        assert_eq!(
            ActionPatternKind::from_pattern(ActionBinding::dash(2, 0.5, 96.0).pattern),
            ActionPatternKind::Dash,
        );
        assert_eq!(
            ActionPatternKind::from_pattern(ActionBinding::melee(3, 0.5, 32.0, 1.0).pattern),
            ActionPatternKind::Melee,
        );
        assert_eq!(
            ActionPatternKind::from_pattern(
                ActionBinding::spawn_prefab(
                    4,
                    0.5,
                    7,
                    SpawnAnchor::SelfEntity,
                    SpawnPhase::PrePhysics,
                    0.0,
                    0.0,
                )
                .pattern,
            ),
            ActionPatternKind::SpawnPrefab,
        );
    }

    #[test]
    fn prepare_action_readiness_reports_action_binding_state_without_input_policy() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            16.0,
            0.0,
        );

        assert_eq!(
            prepare_action_if_ready(&world, source, 11, ActionPatternKind::SpawnPrefab),
            ActionReadiness::Missing,
        );
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(
            prepare_action_if_ready(&world, source, 11, ActionPatternKind::Projectile),
            ActionReadiness::PatternMismatch,
        );
        assert_eq!(
            prepare_action_if_ready(&world, source, 11, ActionPatternKind::SpawnPrefab),
            ActionReadiness::Ready(prepared_action(source, action)),
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, action)
        ));
        assert_eq!(
            prepare_action_if_ready(&world, source, 11, ActionPatternKind::SpawnPrefab),
            ActionReadiness::CoolingDown,
        );
    }

    #[test]
    fn prepare_any_action_readiness_ignores_pattern_kind_for_queued_triggers() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, 96.0);

        assert_eq!(
            prepare_any_action_if_ready(&world, source, 21),
            ActionReadiness::Missing,
        );
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(
            prepare_any_action_if_ready(&world, source, 21),
            ActionReadiness::Ready(prepared_action(source, action)),
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, action)
        ));
        assert_eq!(
            prepare_any_action_if_ready(&world, source, 21),
            ActionReadiness::CoolingDown,
        );
    }

    #[test]
    fn prepare_any_action_payload_returns_typed_payload_without_committing_cooldown() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let dash = ActionBinding::dash_with_aim(21, 0.5, 96.0, ActionAimSource::TargetPlayer);
        let projectile = ActionBinding::projectile_with_target(
            31,
            0.5,
            ProjectileActionConfig {
                speed: 120.0,
                damage: 2.0,
                lifetime_seconds: 3.0,
                aim: ActionAimSource::TargetPlayer,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Bounce,
            },
        );
        let melee = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player);
        let spawn_prefab = ActionBinding::spawn_prefab(
            51,
            0.5,
            7,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            16.0,
            -4.0,
        );

        assert_eq!(
            prepare_any_action_payload_if_ready(&world, source, 21),
            Err(ActionReadiness::Missing),
        );
        assert!(world.upsert_action_binding(source, dash));
        assert_eq!(
            prepare_any_action_payload_if_ready(&world, source, 21),
            Ok((
                prepared_action(source, dash),
                PreparedActionPayload::Dash(DashActionPayload {
                    distance: 96.0,
                    aim: ActionAimSource::TargetPlayer,
                })
            )),
        );
        let (prepared, payload) = prepare_any_action_payload_if_ready(&world, source, 21)
            .expect("dash payload should be ready");
        assert_eq!(prepared.kind(), ActionPatternKind::Dash);
        assert_eq!(payload.kind(), ActionPatternKind::Dash);
        assert_eq!(
            world
                .action_binding(source, 21)
                .expect("dash binding should still exist")
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(
            prepared_action_payload_from_binding(dash),
            PreparedActionPayload::Dash(DashActionPayload {
                distance: 96.0,
                aim: ActionAimSource::TargetPlayer,
            }),
        );
        assert_eq!(
            prepared_action_payload_from_binding(projectile),
            PreparedActionPayload::Projectile(ProjectileActionPayload {
                speed: 120.0,
                damage: 2.0,
                lifetime_seconds: 3.0,
                aim: ActionAimSource::TargetPlayer,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Bounce,
            }),
        );
        assert_eq!(
            prepared_action_payload_from_binding(melee),
            PreparedActionPayload::Melee(MeleeActionPayload {
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Player,
            }),
        );
        assert_eq!(
            prepared_action_payload_from_binding(spawn_prefab),
            PreparedActionPayload::SpawnPrefab(SpawnPrefabActionPayload {
                prefab_id: 7,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 16.0,
                offset_y: -4.0,
            }),
        );
        assert!(commit_prepared_action(&mut world, prepared));
        assert_eq!(
            prepare_any_action_payload_if_ready(&world, source, 21),
            Err(ActionReadiness::CoolingDown),
        );
    }

    #[test]
    fn prepare_action_trigger_for_dispatch_returns_ready_typed_payload() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let trigger = ActionTriggerCommand::timer(source, 21);
        let action = ActionBinding::dash_with_aim(21, 0.5, 96.0, ActionAimSource::TargetPlayer);
        assert!(world.upsert_action_binding(source, action));

        assert_eq!(
            prepare_action_trigger_for_dispatch(
                &world,
                trigger,
                ActionAttemptFailurePolicy::ReportGenericReadinessFailures,
            ),
            ActionTriggerPreparation::Ready(PreparedActionTrigger {
                trigger,
                prepared: prepared_action(source, action),
                payload: PreparedActionPayload::Dash(DashActionPayload {
                    distance: 96.0,
                    aim: ActionAimSource::TargetPlayer,
                }),
            }),
        );
        assert_eq!(
            world
                .action_binding(source, 21)
                .expect("dash binding should still exist")
                .cooldown
                .remaining_seconds,
            0.0,
        );
    }

    #[test]
    fn prepare_action_trigger_for_dispatch_maps_readiness_policy_to_failure_event() {
        let world = World::default();
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let trigger = ActionTriggerCommand::behavior_state_enter(source, 31);

        assert_eq!(
            prepare_action_trigger_for_dispatch(
                &world,
                trigger,
                ActionAttemptFailurePolicy::ReportGenericReadinessFailures,
            ),
            ActionTriggerPreparation::Failure(ActionFailureEventData {
                actor: source,
                source,
                action_id: 31,
                reason_code: GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
            }),
        );
        assert_eq!(
            prepare_action_trigger_for_dispatch(
                &world,
                trigger,
                ActionAttemptFailurePolicy::Silent,
            ),
            ActionTriggerPreparation::Noop,
        );
    }

    #[test]
    fn attempted_action_readiness_failure_reason_maps_only_generic_failures() {
        let action = ActionBinding::dash(21, 0.5, 96.0);

        assert_eq!(
            attempted_action_readiness_failure_reason(ActionReadiness::Missing),
            Some(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING),
        );
        assert_eq!(
            attempted_action_readiness_failure_reason(ActionReadiness::PatternMismatch),
            Some(GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH),
        );
        assert_eq!(
            attempted_action_readiness_failure_reason(ActionReadiness::CoolingDown),
            Some(GAMEPLAY_ACTION_FAILURE_COOLING_DOWN),
        );
        assert_eq!(
            attempted_action_readiness_failure_reason(ActionReadiness::Ready(prepared_action(
                Entity {
                    id: 0,
                    generation: 0,
                },
                action
            ))),
            None,
        );
    }

    #[derive(Default)]
    struct TestActionFailureSink {
        events: Vec<ActionFailureEventData>,
    }

    impl ActionFailureEventSink for TestActionFailureSink {
        fn push_action_failure(&mut self, data: ActionFailureEventData) {
            self.events.push(data);
        }
    }

    #[test]
    fn action_failure_event_helper_pushes_only_when_sink_exists() {
        let actor = Entity {
            id: 1,
            generation: 2,
        };
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let data = action_failure_event_data(
            actor,
            source,
            21,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
        );
        let mut sink = TestActionFailureSink::default();

        push_action_failure_event(Some(&mut sink), data);
        push_action_failure_event::<TestActionFailureSink>(None, data);

        assert_eq!(sink.events, vec![data]);
    }

    #[test]
    fn action_trigger_failure_push_helpers_use_trigger_mapping() {
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let trigger = ActionTriggerCommand::timer(source, 21);
        let mut sink = TestActionFailureSink::default();

        push_action_trigger_failure_event(
            Some(&mut sink),
            trigger,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
        push_action_trigger_failure_event(
            Some(&mut sink),
            trigger,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );
        push_action_trigger_failure_event::<TestActionFailureSink>(
            None,
            trigger,
            GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
        );
        push_action_trigger_failure_event::<TestActionFailureSink>(
            None,
            trigger,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );

        assert_eq!(
            sink.events,
            vec![
                ActionFailureEventData {
                    actor: source,
                    source,
                    action_id: 21,
                    reason_code: GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
                },
                ActionFailureEventData {
                    actor: source,
                    source,
                    action_id: 21,
                    reason_code: GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
                },
            ],
        );
    }

    #[test]
    fn action_failure_gameplay_event_uses_failure_data_fields() {
        let actor = Entity {
            id: 1,
            generation: 2,
        };
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let event = action_failure_gameplay_event(action_failure_event_data(
            actor,
            source,
            21,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
        ));

        assert_eq!(
            event.kind,
            crate::gameplay_event::GAMEPLAY_EVENT_ACTION_FAILED
        );
        assert_eq!(event.actor_id, actor.id);
        assert_eq!(event.actor_generation, actor.generation);
        assert_eq!(event.source_id, source.id);
        assert_eq!(event.source_generation, source.generation);
        assert_eq!(event.token_id, 21);
        assert_eq!(
            event.payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING
        );
    }

    #[test]
    fn action_trigger_failure_event_helpers_use_trigger_subject_and_action() {
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let trigger = ActionTriggerCommand::wave(source, 21);

        assert_eq!(
            action_trigger_failure_event_data(
                trigger,
                GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
            ),
            ActionFailureEventData {
                actor: source,
                source,
                action_id: 21,
                reason_code: GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
            },
        );
        assert_eq!(
            action_trigger_queue_full_event_data(trigger),
            ActionFailureEventData {
                actor: source,
                source,
                action_id: 21,
                reason_code: GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
            },
        );
    }

    #[derive(Default)]
    struct TestPreparedActionTriggerDispatcher {
        calls: Vec<(ActionPatternKind, u32, u32)>,
    }

    impl PreparedActionTriggerDispatcher for TestPreparedActionTriggerDispatcher {
        fn dispatch_projectile_action_trigger(
            &mut self,
            trigger: ActionTriggerCommand,
            prepared: PreparedAction,
            payload: ProjectileActionPayload,
        ) {
            assert_eq!(payload.damage, 3.0);
            self.calls.push((
                ActionPatternKind::Projectile,
                trigger.action_id,
                prepared.action_id,
            ));
        }

        fn dispatch_dash_action_trigger(
            &mut self,
            trigger: ActionTriggerCommand,
            prepared: PreparedAction,
            payload: DashActionPayload,
        ) {
            assert_eq!(payload.distance, 32.0);
            self.calls.push((
                ActionPatternKind::Dash,
                trigger.action_id,
                prepared.action_id,
            ));
        }

        fn dispatch_melee_action_trigger(
            &mut self,
            trigger: ActionTriggerCommand,
            prepared: PreparedAction,
            payload: MeleeActionPayload,
        ) {
            assert_eq!(payload.range, 24.0);
            self.calls.push((
                ActionPatternKind::Melee,
                trigger.action_id,
                prepared.action_id,
            ));
        }

        fn dispatch_spawn_prefab_action_trigger(
            &mut self,
            trigger: ActionTriggerCommand,
            prepared: PreparedAction,
            payload: SpawnPrefabActionPayload,
        ) {
            assert_eq!(payload.prefab_id, 7);
            self.calls.push((
                ActionPatternKind::SpawnPrefab,
                trigger.action_id,
                prepared.action_id,
            ));
        }
    }

    #[test]
    fn dispatch_prepared_action_trigger_routes_each_payload_variant() {
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let bindings = [
            (
                ActionPatternKind::Projectile,
                ActionBinding::projectile(11, 0.5, 120.0, 3.0, 1.0),
            ),
            (ActionPatternKind::Dash, ActionBinding::dash(12, 0.5, 32.0)),
            (
                ActionPatternKind::Melee,
                ActionBinding::melee(13, 0.5, 24.0, 2.0),
            ),
            (
                ActionPatternKind::SpawnPrefab,
                ActionBinding::spawn_prefab(
                    14,
                    0.5,
                    7,
                    SpawnAnchor::SelfEntity,
                    SpawnPhase::PrePhysics,
                    0.0,
                    0.0,
                ),
            ),
        ];
        let mut dispatcher = TestPreparedActionTriggerDispatcher::default();

        for (kind, binding) in bindings {
            let prepared = PreparedAction::new(source, binding.action_id, kind, binding);
            dispatch_prepared_action_trigger(
                &mut dispatcher,
                PreparedActionTrigger {
                    trigger: ActionTriggerCommand::timer(source, binding.action_id),
                    prepared,
                    payload: prepared_action_payload_from_binding(binding),
                },
            );
        }

        assert_eq!(
            dispatcher.calls,
            vec![
                (ActionPatternKind::Projectile, 11, 11),
                (ActionPatternKind::Dash, 12, 12),
                (ActionPatternKind::Melee, 13, 13),
                (ActionPatternKind::SpawnPrefab, 14, 14),
            ],
        );
    }

    #[test]
    fn action_failure_telemetry_policy_controls_readiness_reporting() {
        assert_eq!(
            action_readiness_failure_decision_for_policy(
                ActionReadiness::Missing,
                ActionAttemptFailurePolicy::Silent,
            ),
            ActionAttemptFailureDecision::Noop,
        );
        assert_eq!(
            action_readiness_failure_decision_for_policy(
                ActionReadiness::Missing,
                ActionAttemptFailurePolicy::ReportGenericReadinessFailures,
            ),
            ActionAttemptFailureDecision::Failure(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING),
        );
        assert_eq!(
            action_readiness_failure_decision_for_policy(
                ActionReadiness::CoolingDown,
                ActionAttemptFailurePolicy::ReportPatternMismatchOnly,
            ),
            ActionAttemptFailureDecision::Noop,
        );
        assert_eq!(
            action_readiness_failure_decision_for_policy(
                ActionReadiness::PatternMismatch,
                ActionAttemptFailurePolicy::ReportPatternMismatchOnly,
            ),
            ActionAttemptFailureDecision::Failure(GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH),
        );
        assert_eq!(
            action_readiness_failure_decision_for_policy(
                ActionReadiness::Missing,
                ActionAttemptFailurePolicy::PrimaryInputWithMissingFallback,
            ),
            ActionAttemptFailureDecision::Fallback,
        );
    }

    #[test]
    fn input_action_failure_telemetry_policy_keeps_inactive_silent() {
        let source = Entity {
            id: 0,
            generation: 0,
        };
        let action = ActionBinding::dash(21, 0.5, 96.0);

        assert_eq!(
            input_action_trigger_failure_decision_for_policy(
                InputActionTrigger::Inactive,
                ActionAttemptFailurePolicy::ReportGenericReadinessFailures,
            ),
            ActionAttemptFailureDecision::Noop,
        );
        assert_eq!(
            input_action_trigger_failure_decision_for_policy(
                InputActionTrigger::PatternMismatch,
                ActionAttemptFailurePolicy::ReportPatternMismatchOnly,
            ),
            ActionAttemptFailureDecision::Failure(GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH),
        );
        assert_eq!(
            input_action_trigger_failure_decision_for_policy(
                InputActionTrigger::Missing,
                ActionAttemptFailurePolicy::ReportPatternMismatchOnly,
            ),
            ActionAttemptFailureDecision::Noop,
        );
        assert_eq!(
            input_action_trigger_failure_decision_for_policy(
                InputActionTrigger::Missing,
                ActionAttemptFailurePolicy::PrimaryInputWithMissingFallback,
            ),
            ActionAttemptFailureDecision::Fallback,
        );
        assert_eq!(
            input_action_trigger_failure_decision_for_policy(
                InputActionTrigger::Ready(prepared_action(source, action)),
                ActionAttemptFailurePolicy::ReportGenericReadinessFailures,
            ),
            ActionAttemptFailureDecision::Noop,
        );
    }

    #[test]
    fn fixed_action_pattern_mismatch_report_guard_suppresses_spawn_prefab_only() {
        assert!(should_report_fixed_action_pattern_mismatch(None));
        assert!(should_report_fixed_action_pattern_mismatch(Some(
            ActionPatternKind::Dash,
        )));
        assert!(!should_report_fixed_action_pattern_mismatch(Some(
            ActionPatternKind::SpawnPrefab,
        )));
    }

    #[test]
    fn prepare_input_action_readiness_adds_input_activation_policy() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, 96.0);
        let mut input_actions = InputActionRegistry::empty();
        assert!(input_actions.set_binding(
            21,
            0,
            INPUT_ACTION_CONTROL_ENTER,
            INPUT_ACTION_ACTIVATION_PRESSED,
        ));
        let pressed = InputState {
            enter: 1,
            ..InputState::default()
        };

        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::current_only(InputState::default()),
                source,
                21,
                ActionPatternKind::Dash,
            ),
            InputActionTrigger::Inactive,
        );
        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(pressed, InputState::default()),
                source,
                21,
                ActionPatternKind::Dash,
            ),
            InputActionTrigger::Missing,
        );
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(pressed, InputState::default()),
                source,
                21,
                ActionPatternKind::Projectile,
            ),
            InputActionTrigger::PatternMismatch,
        );
        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(pressed, pressed),
                source,
                21,
                ActionPatternKind::Dash,
            ),
            InputActionTrigger::Inactive,
        );
        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(pressed, InputState::default()),
                source,
                21,
                ActionPatternKind::Dash,
            ),
            InputActionTrigger::Ready(prepared_action(source, action)),
        );
    }

    #[test]
    fn prepare_input_action_readiness_supports_held_down_activation() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(22, 0.5, 96.0);
        assert!(world.upsert_action_binding(source, action));
        let mut input_actions = InputActionRegistry::empty();
        assert!(input_actions.set_binding(
            22,
            0,
            INPUT_ACTION_CONTROL_ENTER,
            INPUT_ACTION_ACTIVATION_DOWN,
        ));
        let held = InputState {
            enter: 1,
            ..InputState::default()
        };

        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(held, held),
                source,
                22,
                ActionPatternKind::Dash,
            ),
            InputActionTrigger::Ready(prepared_action(source, action)),
        );
    }

    #[test]
    fn prepare_dash_action_payload_returns_payload_after_readiness_checks() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash_with_aim(21, 0.5, 96.0, ActionAimSource::TargetPlayer);

        assert_eq!(
            prepare_dash_action_payload(&world, source, 21),
            Err(ActionReadiness::Missing),
        );
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::spawn_prefab(
                21,
                0.5,
                7,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                0.0,
                0.0,
            ),
        ));
        assert_eq!(
            prepare_dash_action_payload(&world, source, 21),
            Err(ActionReadiness::PatternMismatch),
        );
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(
            prepare_dash_action_payload(&world, source, 21),
            Ok(DashActionPayload {
                distance: 96.0,
                aim: ActionAimSource::TargetPlayer,
            }),
        );
        assert_eq!(
            world
                .action_binding(source, 21)
                .expect("dash binding should still exist")
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, action)
        ));
        assert_eq!(
            prepare_dash_action_payload(&world, source, 21),
            Err(ActionReadiness::CoolingDown),
        );
    }

    #[test]
    fn plan_dash_action_transform_plans_target_player_dash_without_mutation() {
        let source = Entity {
            id: 1,
            generation: 1,
        };
        let target = Entity {
            id: 2,
            generation: 1,
        };
        let source_t = Transform2D { x: 100.0, y: 0.0 };
        let target_t = Transform2D { x: 0.0, y: 0.0 };

        assert_eq!(
            plan_dash_action_transform(
                DashActionPayload {
                    distance: 40.0,
                    aim: ActionAimSource::Input,
                },
                source,
                source_t,
                Some((target, target_t)),
            ),
            Err(DashActionPlanError::UnsupportedAimSource),
        );
        assert_eq!(
            plan_dash_action_transform(
                DashActionPayload {
                    distance: 40.0,
                    aim: ActionAimSource::TargetPlayer,
                },
                source,
                source_t,
                None,
            ),
            Err(DashActionPlanError::MissingActionTarget),
        );
        assert_eq!(
            plan_dash_action_transform(
                DashActionPayload {
                    distance: 40.0,
                    aim: ActionAimSource::TargetPlayer,
                },
                source,
                source_t,
                Some((source, source_t)),
            ),
            Err(DashActionPlanError::MissingActionTarget),
        );
        assert_eq!(
            plan_dash_action_transform(
                DashActionPayload {
                    distance: 40.0,
                    aim: ActionAimSource::TargetPlayer,
                },
                source,
                source_t,
                Some((target, source_t)),
            ),
            Err(DashActionPlanError::MissingActionTarget),
        );

        let planned = plan_dash_action_transform(
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::TargetPlayer,
            },
            source,
            source_t,
            Some((target, target_t)),
        )
        .expect("target-player dash should produce final transform");
        assert!((planned.x - 60.0).abs() < 0.001);
        assert!(planned.y.abs() < 0.001);

        let diagonal = plan_dash_action_transform(
            DashActionPayload {
                distance: 10.0,
                aim: ActionAimSource::TargetPlayer,
            },
            source,
            Transform2D { x: 0.0, y: 0.0 },
            Some((target, Transform2D { x: 3.0, y: 4.0 })),
        )
        .expect("3-4-5 target direction should normalize");
        assert!((diagonal.x - 6.0).abs() < 0.001);
        assert!((diagonal.y - 8.0).abs() < 0.001);
    }

    #[test]
    fn plan_input_dash_action_transform_uses_input_then_aim_target_then_fallback() {
        let source_t = Transform2D { x: 10.0, y: 20.0 };
        let payload = DashActionPayload {
            distance: 10.0,
            aim: ActionAimSource::Input,
        };

        assert_eq!(
            plan_input_dash_action_transform(
                DashActionPayload {
                    distance: 10.0,
                    aim: ActionAimSource::TargetPlayer,
                },
                source_t,
                Velocity { vx: 1.0, vy: 0.0 },
                Transform2D { x: 10.0, y: 20.0 },
            ),
            Err(DashActionPlanError::UnsupportedAimSource),
        );

        let input_dash = plan_input_dash_action_transform(
            payload,
            source_t,
            Velocity { vx: 0.0, vy: -1.0 },
            Transform2D { x: 13.0, y: 24.0 },
        )
        .expect("input direction should produce final transform");
        assert!((input_dash.x - 10.0).abs() < 0.001);
        assert!((input_dash.y - 10.0).abs() < 0.001);

        let diagonal_input_dash = plan_input_dash_action_transform(
            payload,
            source_t,
            Velocity { vx: 3.0, vy: 4.0 },
            Transform2D { x: 10.0, y: 20.0 },
        )
        .expect("input direction should be normalized before applying distance");
        assert!((diagonal_input_dash.x - 16.0).abs() < 0.001);
        assert!((diagonal_input_dash.y - 28.0).abs() < 0.001);

        let target_dash = plan_input_dash_action_transform(
            payload,
            source_t,
            Velocity { vx: 0.0, vy: 0.0 },
            Transform2D { x: 13.0, y: 24.0 },
        )
        .expect("aim target should produce final transform");
        assert!((target_dash.x - 16.0).abs() < 0.001);
        assert!((target_dash.y - 28.0).abs() < 0.001);

        let fallback_dash = plan_input_dash_action_transform(
            payload,
            source_t,
            Velocity { vx: 0.0, vy: 0.0 },
            source_t,
        )
        .expect("zero input and zero target direction should use fallback");
        assert!((fallback_dash.x - 20.0).abs() < 0.001);
        assert!((fallback_dash.y - 20.0).abs() < 0.001);
    }

    #[test]
    fn dash_action_core_data_combines_entity_and_transform() {
        let entity = Entity {
            id: 7,
            generation: 2,
        };
        let transform = Transform2D { x: 12.0, y: -8.0 };

        assert_eq!(
            dash_action_core_data_from_plan(entity, transform),
            DashActionCoreData { entity, transform },
        );
    }

    #[test]
    fn apply_dash_action_core_data_writes_target_transform() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x: 1.0, y: 2.0 });

        let transform = Transform2D { x: 32.0, y: 48.0 };
        apply_dash_action_core_data(
            &mut world,
            dash_action_core_data_from_plan(entity, transform),
        );

        assert_eq!(world.transform(entity), Some(transform));
    }

    #[test]
    fn prepare_projectile_action_payload_returns_payload_after_readiness_checks() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::projectile_with_target(
            31,
            0.5,
            ProjectileActionConfig {
                speed: 120.0,
                damage: 2.0,
                lifetime_seconds: 3.0,
                aim: ActionAimSource::TargetPlayer,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Bounce,
            },
        );

        assert_eq!(
            prepare_projectile_action_payload(&world, source, 31),
            Err(ActionReadiness::Missing),
        );
        assert!(world.upsert_action_binding(source, ActionBinding::dash(31, 0.5, 96.0)));
        assert_eq!(
            prepare_projectile_action_payload(&world, source, 31),
            Err(ActionReadiness::PatternMismatch),
        );
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(
            prepare_projectile_action_payload(&world, source, 31),
            Ok(ProjectileActionPayload {
                speed: 120.0,
                damage: 2.0,
                lifetime_seconds: 3.0,
                aim: ActionAimSource::TargetPlayer,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Bounce,
            }),
        );
        assert_eq!(
            world
                .action_binding(source, 31)
                .expect("projectile binding should still exist")
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, action)
        ));
        assert_eq!(
            prepare_projectile_action_payload(&world, source, 31),
            Err(ActionReadiness::CoolingDown),
        );
    }

    #[test]
    fn plan_projectile_action_toward_target_plans_spawn_transform_without_mutation() {
        let source = Entity {
            id: 1,
            generation: 1,
        };
        let target = Entity {
            id: 2,
            generation: 1,
        };
        let source_t = Transform2D { x: 100.0, y: 0.0 };
        let target_t = Transform2D { x: 0.0, y: 0.0 };
        let payload = ProjectileActionPayload {
            speed: 120.0,
            damage: 2.0,
            lifetime_seconds: 3.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
        };

        assert_eq!(
            plan_projectile_action_toward_target(
                ProjectileActionPayload {
                    aim: ActionAimSource::Input,
                    ..payload
                },
                source,
                source_t,
                Some((target, target_t)),
                12.0,
            ),
            Err(ProjectileActionPlanError::UnsupportedAimSource),
        );
        assert_eq!(
            validate_projectile_action_support(ProjectileActionPayload {
                aim: ActionAimSource::Input,
                ..payload
            }),
            Err(ProjectileActionPlanError::UnsupportedAimSource),
        );
        assert_eq!(
            plan_projectile_action_toward_target(
                ProjectileActionPayload {
                    collision_target: ProjectileCollisionTarget::Enemies,
                    ..payload
                },
                source,
                source_t,
                Some((target, target_t)),
                12.0,
            ),
            Err(ProjectileActionPlanError::UnsupportedCollisionTarget),
        );
        assert_eq!(
            validate_projectile_action_support(ProjectileActionPayload {
                collision_target: ProjectileCollisionTarget::Enemies,
                ..payload
            }),
            Err(ProjectileActionPlanError::UnsupportedCollisionTarget),
        );
        assert_eq!(validate_projectile_action_support(payload), Ok(()));
        assert_eq!(
            plan_projectile_action_toward_target(payload, source, source_t, None, 12.0),
            Err(ProjectileActionPlanError::MissingActionTarget),
        );
        assert_eq!(
            plan_projectile_action_toward_target(
                payload,
                source,
                source_t,
                Some((source, source_t)),
                12.0,
            ),
            Err(ProjectileActionPlanError::MissingActionTarget),
        );
        assert_eq!(
            plan_projectile_action_toward_target(
                payload,
                source,
                source_t,
                Some((target, source_t)),
                12.0,
            ),
            Err(ProjectileActionPlanError::MissingActionTarget),
        );

        let planned = plan_projectile_action_toward_target(
            payload,
            source,
            source_t,
            Some((target, target_t)),
            14.0,
        )
        .expect("target-player projectile should produce direction");
        assert!((planned.direction_x + 1.0).abs() < 0.001);
        assert!(planned.direction_y.abs() < 0.001);
        assert!((planned.transform.x - 86.0).abs() < 0.001);
        assert!(planned.transform.y.abs() < 0.001);
        assert!((planned.velocity.vx + 120.0).abs() < 0.001);
        assert!(planned.velocity.vy.abs() < 0.001);

        let diagonal = plan_projectile_action_toward_target(
            ProjectileActionPayload {
                speed: 10.0,
                ..payload
            },
            source,
            Transform2D { x: 0.0, y: 0.0 },
            Some((target, Transform2D { x: 3.0, y: 4.0 })),
            10.0,
        )
        .expect("3-4-5 target direction should normalize");
        assert!((diagonal.direction_x - 0.6).abs() < 0.001);
        assert!((diagonal.direction_y - 0.8).abs() < 0.001);
        assert!((diagonal.transform.x - 6.0).abs() < 0.001);
        assert!((diagonal.transform.y - 8.0).abs() < 0.001);
        assert!((diagonal.velocity.vx - 6.0).abs() < 0.001);
        assert!((diagonal.velocity.vy - 8.0).abs() < 0.001);
    }

    #[test]
    fn plan_input_projectile_action_plans_spawn_transform_and_velocity() {
        let payload = ProjectileActionPayload {
            speed: 120.0,
            damage: 2.0,
            lifetime_seconds: 3.0,
            aim: ActionAimSource::Input,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Despawn,
        };
        let source_t = Transform2D { x: 10.0, y: 20.0 };

        assert_eq!(
            plan_input_projectile_action(
                ProjectileActionPayload {
                    aim: ActionAimSource::TargetPlayer,
                    ..payload
                },
                source_t,
                Transform2D { x: 13.0, y: 24.0 },
                8.0,
            ),
            Err(ProjectileActionPlanError::UnsupportedAimSource),
        );
        assert_eq!(
            plan_input_projectile_action(
                ProjectileActionPayload {
                    collision_target: ProjectileCollisionTarget::Player,
                    ..payload
                },
                source_t,
                Transform2D { x: 13.0, y: 24.0 },
                8.0,
            ),
            Err(ProjectileActionPlanError::UnsupportedCollisionTarget),
        );

        let planned =
            plan_input_projectile_action(payload, source_t, Transform2D { x: 13.0, y: 24.0 }, 10.0)
                .expect("input projectile should produce spawn plan");
        assert!((planned.direction_x - 0.6).abs() < 0.001);
        assert!((planned.direction_y - 0.8).abs() < 0.001);
        assert!((planned.transform.x - 16.0).abs() < 0.001);
        assert!((planned.transform.y - 28.0).abs() < 0.001);
        assert!((planned.velocity.vx - 72.0).abs() < 0.001);
        assert!((planned.velocity.vy - 96.0).abs() < 0.001);

        let fallback = plan_input_projectile_action(payload, source_t, source_t, 10.0)
            .expect("zero target direction should use +X fallback");
        assert!((fallback.direction_x - 1.0).abs() < 0.001);
        assert!(fallback.direction_y.abs() < 0.001);
        assert!((fallback.transform.x - 20.0).abs() < 0.001);
        assert!((fallback.transform.y - 20.0).abs() < 0.001);
        assert!((fallback.velocity.vx - 120.0).abs() < 0.001);
        assert!(fallback.velocity.vy.abs() < 0.001);
    }

    #[test]
    fn projectile_planners_return_shared_spawn_plan_type() {
        let source = Entity {
            id: 1,
            generation: 1,
        };
        let target = Entity {
            id: 2,
            generation: 1,
        };
        let source_t = Transform2D { x: 0.0, y: 0.0 };
        let target_t = Transform2D { x: 4.0, y: 0.0 };
        let queued_payload = ProjectileActionPayload {
            speed: 10.0,
            damage: 1.0,
            lifetime_seconds: 1.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Despawn,
        };
        let input_payload = ProjectileActionPayload {
            aim: ActionAimSource::Input,
            collision_target: ProjectileCollisionTarget::Enemies,
            ..queued_payload
        };

        let _: ProjectileSpawnPlan = plan_projectile_action_toward_target(
            queued_payload,
            source,
            source_t,
            Some((target, target_t)),
            8.0,
        )
        .expect("queued projectile planner should return shared spawn plan");
        let _: ProjectileSpawnPlan =
            plan_input_projectile_action(input_payload, source_t, target_t, 8.0)
                .expect("input projectile planner should return shared spawn plan");
    }

    #[test]
    fn projectile_spawn_core_data_combines_plan_and_payload_without_scene_fields() {
        let payload = ProjectileActionPayload {
            speed: 120.0,
            damage: 2.0,
            lifetime_seconds: 3.0,
            aim: ActionAimSource::Input,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Bounce,
        };
        let plan = ProjectileSpawnPlan {
            direction_x: 1.0,
            direction_y: 0.0,
            transform: Transform2D { x: 10.0, y: 20.0 },
            velocity: Velocity { vx: 120.0, vy: 0.0 },
        };

        assert_eq!(
            projectile_spawn_core_data_from_plan(plan, payload),
            ProjectileSpawnCoreData {
                transform: Transform2D { x: 10.0, y: 20.0 },
                velocity: Velocity { vx: 120.0, vy: 0.0 },
                lifetime_seconds: 3.0,
                damage: 2.0,
                collision_target: ProjectileCollisionTarget::Enemies,
                tile_impact: ProjectileTileImpact::Bounce,
            },
        );
    }

    #[test]
    fn spawn_projectile_entity_spawns_bullet_and_applies_arc() {
        let mut world = World::default();
        let arc = ProjectileArc::new(
            crate::components::PhysicsFloorId(2),
            6.0,
            3.0,
            4.0,
            9.8,
            1.5,
        )
        .expect("test projectile arc values are finite and valid");
        let request = ProjectileSpawnRequest {
            transform: Transform2D { x: 10.0, y: 20.0 },
            velocity: Velocity { vx: 30.0, vy: 0.0 },
            texture_id: 4,
            lifetime: 2.0,
            template: EntityTemplate::new(6.0, 8.0),
            damage: 3.0,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Bounce,
            source_faction: None,
        };

        let result = spawn_projectile_entity(
            &mut world,
            ProjectileEntitySpawnData {
                request,
                arc: Some(arc),
            },
        );

        assert_eq!(
            result,
            ProjectileEntitySpawnResult {
                spawned: Entity {
                    id: 0,
                    generation: world
                        .generation_at_index(0)
                        .expect("test entity index should exist"),
                },
                arc_applied: true,
            }
        );
        assert_eq!(world.collider_layer_at(0), Some(CollisionLayer::Bullet));
        assert_eq!(world.transforms[0], Some(request.transform));
        assert_eq!(world.velocities[0], Some(request.velocity));
        assert_eq!(world.projectile_arc(result.spawned), Some(arc));
        assert_eq!(world.height_span(result.spawned), arc.height_span());
    }

    #[test]
    fn spawn_prefab_enemy_entity_spawns_enemy_from_data() {
        let mut world = World::default();
        let data = PrefabEnemyEntitySpawnData {
            transform: Transform2D { x: 12.0, y: 24.0 },
            texture_id: 5,
            template: EntityTemplate::new(14.0, 18.0),
            health: 9.0,
            score_reward: 13,
        };

        let result = spawn_prefab_enemy_entity(&mut world, data);
        let spawned_index = result.spawned.id as usize;

        assert_eq!(
            result,
            PrefabEnemyEntitySpawnResult {
                spawned: Entity {
                    id: spawned_index as u32,
                    generation: world
                        .generation_at_index(spawned_index)
                        .expect("test entity index should exist"),
                },
            }
        );
        assert_eq!(
            world.collider_layer_at(spawned_index),
            Some(CollisionLayer::Enemy)
        );
        assert_eq!(world.transforms[spawned_index], Some(data.transform));
        assert_eq!(world.health_at_index(spawned_index), Some(data.health));
        assert_eq!(
            world.score_reward_at_index(spawned_index),
            Some(data.score_reward)
        );
    }

    #[test]
    fn prepare_melee_action_payload_returns_payload_after_readiness_checks() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player);

        assert_eq!(
            prepare_melee_action_payload(&world, source, 41),
            Err(ActionReadiness::Missing),
        );
        assert!(world.upsert_action_binding(source, ActionBinding::dash(41, 0.5, 96.0)));
        assert_eq!(
            prepare_melee_action_payload(&world, source, 41),
            Err(ActionReadiness::PatternMismatch),
        );
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(
            prepare_melee_action_payload(&world, source, 41),
            Ok(MeleeActionPayload {
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Player,
            }),
        );
        assert_eq!(
            world
                .action_binding(source, 41)
                .expect("melee binding should still exist")
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, action)
        ));
        assert_eq!(
            prepare_melee_action_payload(&world, source, 41),
            Err(ActionReadiness::CoolingDown),
        );
    }

    #[test]
    fn plan_melee_action_plans_supported_queued_targets_without_mutation() {
        let source = Entity {
            id: 1,
            generation: 1,
        };
        let target = Entity {
            id: 2,
            generation: 1,
        };
        let source_t = Transform2D { x: 16.0, y: -4.0 };
        let payload = MeleeActionPayload {
            range: 32.0,
            damage: 2.0,
            target: MeleeTarget::Player,
        };

        assert_eq!(validate_queued_melee_action_support(payload), Ok(()));
        assert_eq!(
            plan_melee_action(payload, source, source_t, None),
            Err(MeleeActionPlanError::MissingActionTarget),
        );
        assert_eq!(
            plan_melee_action(payload, source, source_t, Some(source)),
            Err(MeleeActionPlanError::MissingActionTarget),
        );

        assert_eq!(
            plan_melee_action(payload, source, source_t, Some(target)),
            Ok(MeleeActionPlan {
                center: source_t,
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Player,
            }),
        );
        let enemy_target_payload = MeleeActionPayload {
            target: MeleeTarget::Enemies,
            ..payload
        };
        assert_eq!(
            validate_queued_melee_action_support(enemy_target_payload),
            Ok(()),
        );
        assert_eq!(
            plan_melee_action(enemy_target_payload, source, source_t, None),
            Ok(MeleeActionPlan {
                center: source_t,
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Enemies,
            }),
        );
    }

    #[test]
    fn plan_input_melee_action_plans_supported_enemy_target_without_mutation() {
        let source_t = Transform2D { x: 16.0, y: -4.0 };
        let payload = MeleeActionPayload {
            range: 32.0,
            damage: 2.0,
            target: MeleeTarget::Enemies,
        };

        assert_eq!(
            validate_input_melee_action_support(MeleeActionPayload {
                target: MeleeTarget::Player,
                ..payload
            }),
            Err(MeleeActionPlanError::UnsupportedTarget),
        );
        assert_eq!(
            plan_input_melee_action(
                MeleeActionPayload {
                    target: MeleeTarget::Player,
                    ..payload
                },
                source_t,
            ),
            Err(MeleeActionPlanError::UnsupportedTarget),
        );
        assert_eq!(validate_input_melee_action_support(payload), Ok(()));
        assert_eq!(
            plan_input_melee_action(payload, source_t),
            Ok(MeleeActionPlan {
                center: source_t,
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Enemies,
            }),
        );
    }

    #[test]
    fn melee_attack_core_data_combines_attacker_plan_and_height_span() {
        let attacker = Entity {
            id: 4,
            generation: 2,
        };
        let plan = MeleeActionPlan {
            center: Transform2D { x: 10.0, y: 20.0 },
            range: 16.0,
            damage: 3.0,
            target: MeleeTarget::Enemies,
        };
        let height_span = Some(HeightSpan {
            floor: crate::components::PhysicsFloorId::DEFAULT,
            elevation: 1.5,
            height: 2.0,
        });

        assert_eq!(
            melee_attack_core_data_from_plan(attacker, plan, height_span),
            MeleeAttackCoreData {
                attacker,
                center: plan.center,
                range: plan.range,
                damage: plan.damage,
                target: plan.target,
                height_span,
            },
        );
    }

    #[test]
    fn melee_attack_query_mask_matches_target_layer() {
        assert_eq!(
            melee_attack_query_mask(MeleeTarget::Enemies),
            CollisionMask::ENEMY
        );
        assert_eq!(
            melee_attack_query_mask(MeleeTarget::Player),
            CollisionMask::PLAYER
        );
    }

    #[test]
    fn run_melee_attack_query_uses_target_mask_and_reuses_hit_buffer() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let enemy = world.spawn_enemy(8.0, 0.0, 0);
        let far_enemy = world.spawn_enemy(64.0, 0.0, 0);
        let mut hits = Vec::with_capacity(4);

        assert_eq!(
            run_melee_attack_query(
                &world,
                Transform2D { x: 0.0, y: 0.0 },
                16.0,
                MeleeTarget::Enemies,
                None,
                &mut hits,
            ),
            1,
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entity, enemy);

        assert_eq!(
            run_melee_attack_query(
                &world,
                Transform2D { x: 0.0, y: 0.0 },
                16.0,
                MeleeTarget::Player,
                None,
                &mut hits,
            ),
            1,
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entity, player);
        assert_ne!(hits[0].entity, far_enemy);
    }

    #[test]
    fn run_melee_attack_query_respects_height_span_filter() {
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let low_enemy = world.spawn_enemy(8.0, 0.0, 0);
        let high_enemy = world.spawn_enemy(8.0, 0.0, 0);
        world.set_height_span(low_enemy, HeightSpan::on_default_floor(0.0, 8.0).unwrap());
        world.set_height_span(high_enemy, HeightSpan::on_default_floor(16.0, 8.0).unwrap());
        let mut hits = Vec::with_capacity(4);

        assert_eq!(
            run_melee_attack_query(
                &world,
                Transform2D { x: 0.0, y: 0.0 },
                16.0,
                MeleeTarget::Enemies,
                HeightSpan::on_default_floor(4.0, 4.0),
                &mut hits,
            ),
            1,
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entity, low_enemy);
        assert_ne!(hits[0].entity, high_enemy);
    }

    #[test]
    fn melee_attack_live_predicates_preserve_target_layer_policy() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let enemy = world.spawn_enemy(16.0, 0.0, 0);
        let plain = world.spawn_entity();
        let mut marked_for_despawn = vec![false; world.entity_capacity()];

        assert!(melee_attack_attacker_can_resolve(
            &world,
            player,
            MeleeTarget::Enemies,
            &marked_for_despawn,
        ));
        assert!(melee_attack_attacker_can_resolve(
            &world,
            enemy,
            MeleeTarget::Enemies,
            &marked_for_despawn,
        ));
        assert!(melee_attack_attacker_can_resolve(
            &world,
            plain,
            MeleeTarget::Player,
            &marked_for_despawn,
        ));

        assert!(melee_attack_target_can_receive_hit(
            &world,
            enemy,
            MeleeTarget::Enemies,
            &marked_for_despawn,
        ));
        assert!(!melee_attack_target_can_receive_hit(
            &world,
            player,
            MeleeTarget::Enemies,
            &marked_for_despawn,
        ));
        assert!(melee_attack_target_can_receive_hit(
            &world,
            player,
            MeleeTarget::Player,
            &marked_for_despawn,
        ));

        marked_for_despawn[player.id as usize] = true;
        assert!(!melee_attack_attacker_can_resolve(
            &world,
            player,
            MeleeTarget::Enemies,
            &marked_for_despawn,
        ));
        assert!(!melee_attack_target_can_receive_hit(
            &world,
            player,
            MeleeTarget::Player,
            &marked_for_despawn,
        ));

        let out_of_range = Entity {
            id: world.entity_capacity() as u32,
            generation: 0,
        };
        assert!(!melee_attack_attacker_can_resolve(
            &world,
            out_of_range,
            MeleeTarget::Player,
            &marked_for_despawn,
        ));
        assert!(!melee_attack_target_can_receive_hit(
            &world,
            out_of_range,
            MeleeTarget::Enemies,
            &marked_for_despawn,
        ));
    }

    #[test]
    fn prepare_spawn_prefab_action_payload_returns_payload_after_readiness_checks() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::spawn_prefab(
            11,
            0.5,
            7,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            16.0,
            -4.0,
        );

        assert_eq!(
            prepare_spawn_prefab_action_payload(&world, source, 11),
            Err(ActionReadiness::Missing),
        );
        assert!(world.upsert_action_binding(source, ActionBinding::dash(11, 0.5, 96.0)));
        assert_eq!(
            prepare_spawn_prefab_action_payload(&world, source, 11),
            Err(ActionReadiness::PatternMismatch),
        );
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(
            prepare_spawn_prefab_action_payload(&world, source, 11),
            Ok(SpawnPrefabActionPayload {
                prefab_id: 7,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 16.0,
                offset_y: -4.0,
            }),
        );
        assert_eq!(
            world
                .action_binding(source, 11)
                .expect("spawn prefab binding should still exist")
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, action)
        ));
        assert_eq!(
            prepare_spawn_prefab_action_payload(&world, source, 11),
            Err(ActionReadiness::CoolingDown),
        );
    }

    #[test]
    fn plan_spawn_prefab_action_plans_supported_self_anchor_without_mutation() {
        let payload = SpawnPrefabActionPayload {
            prefab_id: 7,
            projectile: None,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: 16.0,
            offset_y: -4.0,
        };
        let source_t = Transform2D { x: 32.0, y: 40.0 };

        assert_eq!(validate_spawn_prefab_action_support(payload), Ok(()));
        assert_eq!(
            plan_spawn_prefab_action(payload, None),
            Err(SpawnPrefabActionPlanError::MissingSourceTransform),
        );
        assert_eq!(
            plan_spawn_prefab_action(payload, Some(source_t)),
            Ok(SpawnPrefabActionPlan {
                prefab_id: 7,
                projectile: None,
                placement: payload.placement(),
                transform: Transform2D { x: 48.0, y: 36.0 },
            }),
        );
        assert_eq!(
            plan_supported_spawn_prefab_action(
                payload,
                Some(source_t),
                SpawnPrefabSupport::Unsupported
            ),
            Err(SpawnPrefabActionPlanError::UnsupportedPrefab),
        );
        assert_eq!(
            plan_supported_spawn_prefab_action(payload, None, SpawnPrefabSupport::Unsupported),
            Err(SpawnPrefabActionPlanError::UnsupportedPrefab),
        );
        assert_eq!(
            plan_supported_spawn_prefab_action(
                payload,
                Some(source_t),
                SpawnPrefabSupport::Supported
            ),
            Ok(SpawnPrefabActionPlan {
                prefab_id: 7,
                projectile: None,
                placement: payload.placement(),
                transform: Transform2D { x: 48.0, y: 36.0 },
            }),
        );
    }

    #[test]
    fn spawn_prefab_core_data_combines_source_action_and_plan() {
        let source = Entity {
            id: 9,
            generation: 2,
        };
        let plan = SpawnPrefabActionPlan {
            prefab_id: 7,
            projectile: None,
            placement: SpawnPrefabPlacement {
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 16.0,
                offset_y: -4.0,
            },
            transform: Transform2D { x: 48.0, y: 36.0 },
        };

        assert_eq!(
            spawn_prefab_core_data_from_plan(source, 13, plan),
            SpawnPrefabCoreData {
                source,
                action_id: 13,
                prefab_id: 7,
                projectile: None,
                transform: Transform2D { x: 48.0, y: 36.0 },
            },
        );
    }

    #[test]
    fn prefab_spawned_event_payload_preserves_spawn_context() {
        let spawned = Entity {
            id: 21,
            generation: 3,
        };
        let source = Entity {
            id: 9,
            generation: 2,
        };

        assert_eq!(
            prefab_spawned_event_payload(spawned, source, 7, 13),
            PrefabSpawnedEventPayload {
                spawned,
                source,
                prefab_id: 7,
                action_id: 13,
            },
        );
    }

    #[test]
    fn spawn_prefab_placement_collider_preserves_template_footprint() {
        let template = EntityTemplate::new(16.0, 16.0).with_collider(
            crate::world::EntityTemplateCollider::aabb(6.0, 8.0, 3.0, -2.0, false, true, None),
        );

        assert_eq!(
            spawn_prefab_placement_collider(template, CollisionLayer::Enemy),
            AabbCollider {
                half_width: 6.0,
                half_height: 8.0,
                offset_x: 3.0,
                offset_y: -2.0,
                enabled: false,
                is_trigger: true,
                layer: CollisionLayer::Enemy,
            },
        );
    }

    #[test]
    fn spawn_prefab_placement_collider_uses_aabb_envelope_for_non_aabb_template() {
        let template =
            EntityTemplate::new(16.0, 16.0).with_collider(crate::world::EntityTemplateCollider {
                shape: crate::world::EntityTemplateColliderShape::Circle { radius: 5.0 },
                half_width: 0.0,
                half_height: 0.0,
                offset_x: -1.0,
                offset_y: 2.0,
                enabled: true,
                is_trigger: false,
                material: None,
            });

        assert_eq!(
            spawn_prefab_placement_collider(template, CollisionLayer::Enemy),
            AabbCollider {
                half_width: 5.0,
                half_height: 5.0,
                offset_x: -1.0,
                offset_y: 2.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Enemy,
            },
        );
    }

    #[test]
    fn spawn_prefab_placement_query_reports_blocked_and_reuses_scratch() {
        let template = EntityTemplate::new(16.0, 16.0);
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 48.0, 48.0, true, vec![1]);
        let transform = Transform2D { x: 64.0, y: 64.0 };
        let mut contacts = Vec::new();

        assert!(spawn_prefab_placement_is_blocked_by_tilemap(
            &tilemap,
            template,
            transform,
            CollisionLayer::Enemy,
            &mut contacts,
        ));
        assert!(!contacts.is_empty());

        assert!(!spawn_prefab_placement_is_blocked_by_tilemap(
            &Tilemap::default(),
            template,
            transform,
            CollisionLayer::Enemy,
            &mut contacts,
        ));
        assert!(contacts.is_empty());
    }

    #[test]
    fn spawn_prefab_pre_commit_gates_preserve_capacity_before_placement() {
        let mut placement_checked = false;

        assert_eq!(
            validate_spawn_prefab_pre_commit_gates(false, || {
                placement_checked = true;
                false
            }),
            Err(SpawnPrefabPreCommitError::SpawnQueueFull),
        );
        assert!(!placement_checked);

        assert_eq!(
            validate_spawn_prefab_pre_commit_gates(true, || true),
            Err(SpawnPrefabPreCommitError::BlockedPlacement),
        );
        assert_eq!(
            validate_spawn_prefab_pre_commit_gates(true, || false),
            Ok(()),
        );
    }

    #[test]
    fn action_trigger_command_constructors_set_pre_physics_phase() {
        let source = Entity {
            id: 7,
            generation: 2,
        };
        assert_eq!(
            ActionTriggerCommand::timer(source, 11),
            ActionTriggerCommand {
                source,
                action_id: 11,
                trigger_kind: ActionTriggerKind::Timer,
                phase: ActionTriggerPhase::PrePhysics,
            },
        );
        assert_eq!(
            ActionTriggerCommand::wave(source, 12).trigger_kind,
            ActionTriggerKind::Wave,
        );
        assert_eq!(
            ActionTriggerCommand::behavior_state_enter(source, 13).trigger_kind,
            ActionTriggerKind::BehaviorStateEnter,
        );
        assert_eq!(
            ActionTriggerCommand::wave(source, 12).phase,
            ActionTriggerPhase::PrePhysics,
        );
        assert_eq!(
            ActionTriggerCommand::behavior_state_enter(source, 13).phase,
            ActionTriggerPhase::PrePhysics,
        );
        assert!(action_trigger_runs_in_phase(
            ActionTriggerCommand::timer(source, 11),
            ActionTriggerPhase::PrePhysics,
        ));
        assert!(action_trigger_runs_in_phase(
            ActionTriggerCommand::wave(source, 12),
            ActionTriggerPhase::PrePhysics,
        ));
        assert!(action_trigger_runs_in_phase(
            ActionTriggerCommand::behavior_state_enter(source, 13),
            ActionTriggerPhase::PrePhysics,
        ));
    }

    #[test]
    fn bounded_deferred_command_helpers_preserve_capacity_and_order() {
        let mut queue = Vec::with_capacity(2);
        let initial_capacity = queue.capacity();

        assert!(has_bounded_deferred_command_capacity(&queue, 2));
        assert!(try_push_bounded_deferred_command(&mut queue, 2, 11_u32));
        assert!(try_push_bounded_deferred_command(&mut queue, 2, 12_u32));
        assert_eq!(queue.capacity(), initial_capacity);
        assert!(!has_bounded_deferred_command_capacity(&queue, 2));

        let len_before_reject = queue.len();
        let capacity_before_reject = queue.capacity();
        assert!(!try_push_bounded_deferred_command(&mut queue, 2, 13_u32));
        assert_eq!(queue.len(), len_before_reject);
        assert_eq!(queue.capacity(), capacity_before_reject);
        assert_eq!(queue, vec![11, 12]);

        let mut zero_capacity_queue = Vec::with_capacity(1);
        assert!(!has_bounded_deferred_command_capacity(
            &zero_capacity_queue,
            0
        ));
        assert!(!try_push_bounded_deferred_command(
            &mut zero_capacity_queue,
            0,
            21_u32
        ));
        assert!(zero_capacity_queue.is_empty());
    }

    #[test]
    fn drain_deferred_commands_into_preserves_order_and_reuses_scratch() {
        let mut queue = Vec::with_capacity(3);
        queue.push(11_u32);
        queue.push(12_u32);
        let mut commands = Vec::with_capacity(3);
        commands.push(99_u32);
        let initial_queue_capacity = queue.capacity();
        let initial_command_capacity = commands.capacity();

        assert_eq!(drain_deferred_commands_into(&mut queue, &mut commands), 2);
        assert_eq!(commands, vec![11, 12]);
        assert!(queue.is_empty());
        assert_eq!(queue.capacity(), initial_queue_capacity);
        assert_eq!(commands.capacity(), initial_command_capacity);

        queue.push(21_u32);
        assert_eq!(drain_deferred_commands_into(&mut queue, &mut commands), 1);
        assert_eq!(commands, vec![21]);
        assert!(queue.is_empty());
        assert_eq!(queue.capacity(), initial_queue_capacity);
        assert_eq!(commands.capacity(), initial_command_capacity);
    }

    #[test]
    fn action_trigger_queue_is_bounded_frame_local_and_reuses_storage() {
        let mut queue = ActionTriggerQueue::with_capacity(2);

        assert!(queue.queue(11_u32));
        assert!(queue.queue(12_u32));
        assert!(!queue.queue(13_u32));
        assert_eq!(queue.pending_len(), 2);
        assert!(queue.begin_processing());
        assert_eq!(queue.pending_len(), 0);
        assert_eq!(queue.processing_len(), 2);
        assert_eq!(queue.processing_at(0), Some(11));
        assert_eq!(queue.processing_at(1), Some(12));

        assert!(queue.queue(21_u32));
        assert_eq!(queue.pending_len(), 1);
        queue.finish_processing();
        assert_eq!(queue.processing_len(), 0);
        assert!(queue.pending_capacity() >= 2);
        assert!(queue.processing_capacity() >= 2);

        assert!(queue.begin_processing());
        assert_eq!(queue.processing_at(0), Some(21));
        queue.clear();
        assert_eq!(queue.pending_len(), 0);
        assert_eq!(queue.processing_len(), 0);
    }

    #[test]
    fn action_trigger_queue_filters_processing_commands_by_phase() {
        let source = Entity {
            id: 7,
            generation: 2,
        };
        let mut queue = ActionTriggerQueue::with_capacity(3);

        assert!(queue.queue(ActionTriggerCommand::timer(source, 11)));
        assert!(queue.queue(ActionTriggerCommand::wave(source, 12)));
        assert!(queue.queue(ActionTriggerCommand::behavior_state_enter(source, 13)));

        assert!(queue.begin_processing());
        assert_eq!(
            queue.processing_at_phase(0, ActionTriggerPhase::PrePhysics),
            Some(ActionTriggerCommand::timer(source, 11)),
        );
        assert_eq!(
            queue.processing_at_phase(1, ActionTriggerPhase::PrePhysics),
            Some(ActionTriggerCommand::wave(source, 12)),
        );
        assert_eq!(
            queue.processing_at_phase(2, ActionTriggerPhase::PrePhysics),
            Some(ActionTriggerCommand::behavior_state_enter(source, 13)),
        );
        assert_eq!(
            queue.processing_at_phase(3, ActionTriggerPhase::PrePhysics),
            None,
        );
    }

    #[test]
    fn action_trigger_queue_returns_failure_data_when_full() {
        let source = Entity {
            id: 7,
            generation: 2,
        };
        let mut queue = ActionTriggerQueue::with_capacity(1);
        let first = ActionTriggerCommand::timer(source, 11);
        let rejected = ActionTriggerCommand::wave(source, 12);

        assert_eq!(queue.queue_action_trigger(first), Ok(()));
        assert_eq!(
            queue.queue_action_trigger(rejected),
            Err(action_trigger_queue_full_event_data(rejected)),
        );
        assert_eq!(queue.pending_len(), 1);
        assert!(queue.begin_processing());
        assert_eq!(queue.processing_at(0), Some(first));
        assert_eq!(queue.processing_at(1), None);
    }

    #[test]
    fn collect_action_triggers_for_phase_drains_processing_queue_and_reuses_scratch() {
        let source = Entity {
            id: 7,
            generation: 2,
        };
        let mut queue = ActionTriggerQueue::with_capacity(3);
        let mut commands = Vec::with_capacity(3);
        let initial_capacity = commands.capacity();

        assert!(queue.queue(ActionTriggerCommand::timer(source, 11)));
        assert!(queue.queue(ActionTriggerCommand::wave(source, 12)));

        assert_eq!(
            collect_action_triggers_for_phase(
                &mut queue,
                ActionTriggerPhase::PrePhysics,
                &mut commands,
            ),
            2,
        );
        assert_eq!(
            commands,
            vec![
                ActionTriggerCommand::timer(source, 11),
                ActionTriggerCommand::wave(source, 12),
            ],
        );
        assert_eq!(commands.capacity(), initial_capacity);
        assert_eq!(queue.pending_len(), 0);
        assert_eq!(queue.processing_len(), 0);

        assert!(queue.queue(ActionTriggerCommand::behavior_state_enter(source, 13)));
        assert_eq!(
            collect_action_triggers_for_phase(
                &mut queue,
                ActionTriggerPhase::PrePhysics,
                &mut commands,
            ),
            1,
        );
        assert_eq!(
            commands,
            vec![ActionTriggerCommand::behavior_state_enter(source, 13)],
        );
        assert_eq!(commands.capacity(), initial_capacity);
    }

    #[test]
    fn commit_prepared_action_wrong_kind_does_not_consume_cooldown() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, 96.0);
        assert!(world.upsert_action_binding(source, action));

        assert!(!commit_prepared_action(
            &mut world,
            PreparedAction::new(source, 21, ActionPatternKind::Projectile, action)
        ));
        assert_eq!(
            world
                .action_binding(source, 21)
                .expect("action binding should remain")
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, action)
        ));
        assert!(
            (world
                .action_binding(source, 21)
                .expect("action binding should remain")
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );
    }

    #[test]
    fn commit_prepared_action_rejects_changed_binding_between_prepare_and_commit() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let prepared_binding = ActionBinding::dash(21, 0.5, 96.0);
        let replacement = ActionBinding::dash(21, 0.5, 128.0);
        assert!(world.upsert_action_binding(source, prepared_binding));
        let ActionReadiness::Ready(prepared) =
            prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
        else {
            panic!("dash action should be ready");
        };

        assert!(world.upsert_action_binding(source, replacement));
        assert!(!commit_prepared_action(&mut world, prepared));
        assert_eq!(
            world
                .action_binding(source, 21)
                .expect("replacement binding should remain")
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert!(commit_prepared_action(
            &mut world,
            prepared_action(source, replacement)
        ));
    }

    #[test]
    fn commit_prepared_action_accepts_same_nan_payload_bit_identity() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, f32::NAN);
        assert!(world.upsert_action_binding(source, action));
        let ActionReadiness::Ready(prepared) =
            prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
        else {
            panic!("dash action should be ready");
        };

        assert!(commit_prepared_action(&mut world, prepared));
        assert!(
            world
                .action_binding(source, 21)
                .expect("action binding should remain")
                .cooldown
                .remaining_seconds
                > 0.0
        );
    }

    #[test]
    fn commit_prepared_action_rejects_different_nan_payload_bit_identity() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, f32::from_bits(0x7fc0_0001));
        assert!(world.upsert_action_binding(source, action));

        assert!(!commit_prepared_action(
            &mut world,
            PreparedAction::new(
                source,
                21,
                ActionPatternKind::Dash,
                ActionBinding::dash(21, 0.5, f32::from_bits(0x7fc0_0002))
            )
        ));
        assert_eq!(
            world
                .action_binding(source, 21)
                .expect("action binding should remain")
                .cooldown
                .remaining_seconds,
            0.0,
        );
    }

    #[test]
    fn commit_prepared_action_rejects_binding_action_id_mismatch() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, 96.0);
        assert!(world.upsert_action_binding(source, action));

        assert!(!commit_prepared_action(
            &mut world,
            PreparedAction::new(
                source,
                21,
                ActionPatternKind::Dash,
                ActionBinding::dash(22, 0.5, 96.0)
            )
        ));
        assert_eq!(
            world
                .action_binding(source, 21)
                .expect("action binding should remain")
                .cooldown
                .remaining_seconds,
            0.0,
        );
    }

    #[test]
    fn commit_prepared_action_rejects_consumed_cooldown_before_commit() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, 96.0);
        assert!(world.upsert_action_binding(source, action));
        let ActionReadiness::Ready(prepared) =
            prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
        else {
            panic!("dash action should be ready");
        };

        assert!(world.commit_action_cooldown_if_ready(source, 21).is_some());
        assert!(!commit_prepared_action(&mut world, prepared));
    }

    #[test]
    fn commit_prepared_action_rejects_reused_entity_between_prepare_and_commit() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::dash(21, 0.5, 96.0);
        assert!(world.upsert_action_binding(source, action));
        let ActionReadiness::Ready(prepared) =
            prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
        else {
            panic!("dash action should be ready");
        };

        world.despawn(source);
        let reused = world.spawn_entity();
        assert_eq!(reused.id, source.id);
        assert_ne!(reused.generation, source.generation);
        assert!(world.upsert_action_binding(reused, action));
        assert!(!commit_prepared_action(&mut world, prepared));
        assert_eq!(
            world
                .action_binding(reused, 21)
                .expect("reused entity binding should remain")
                .cooldown
                .remaining_seconds,
            0.0,
        );
    }

    #[test]
    fn collision_contact_tracker_reports_enter_once_and_preserves_current_contacts() {
        let first = Entity {
            id: 4,
            generation: 1,
        };
        let second = Entity {
            id: 9,
            generation: 2,
        };
        let mut previous = Vec::new();
        let mut current = Vec::new();

        assert!(register_collision_contact(
            &previous,
            &mut current,
            8,
            first,
            second,
        ));
        assert!(!register_collision_contact(
            &previous,
            &mut current,
            8,
            second,
            first,
        ));
        assert_eq!(current.len(), 1);

        finish_collision_contacts(&mut previous, &mut current);
        assert!(current.is_empty());
        assert!(!register_collision_contact(
            &previous,
            &mut current,
            8,
            second,
            first,
        ));
        assert_eq!(current.len(), 1);
    }

    #[test]
    fn collision_contact_tracker_state_object_preserves_enter_and_capacity() {
        let first = Entity {
            id: 4,
            generation: 1,
        };
        let second = Entity {
            id: 9,
            generation: 2,
        };
        let mut tracker = CollisionContactTracker::with_capacity(1);

        assert!(tracker.register(first, second));
        assert!(!tracker.register(second, first));
        assert_eq!(tracker.current_len(), 1);
        assert!(tracker.current_capacity() >= 1);

        tracker.finish();
        assert!(!tracker.register(first, second));
        assert!(!tracker.register(
            Entity {
                id: 10,
                generation: 0
            },
            second
        ));
        assert_eq!(tracker.current_len(), 1);

        tracker.clear();
        assert!(tracker.register(first, second));
    }

    #[test]
    fn collision_contact_tracker_respects_capacity_without_recording_contact() {
        let first = Entity {
            id: 1,
            generation: 0,
        };
        let second = Entity {
            id: 2,
            generation: 0,
        };
        let mut current = Vec::new();

        assert!(!register_collision_contact(
            &[],
            &mut current,
            0,
            first,
            second,
        ));
        assert!(current.is_empty());
    }

    #[test]
    fn damage_reduces_health_and_returns_reward_only_on_kill() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(0.0, 0.0, 1);
        let enemy_index = enemy.id as usize;
        world.set_health(enemy, 3.0);
        world.set_score_reward(enemy, 7);

        let first = apply_damage_to_health(&mut world, enemy_index, 1.0, 5.0, 1);
        assert_eq!(
            first,
            DamageOutcome {
                remaining_health: 2.0,
                killed: false,
                score_reward: 0,
            }
        );

        let second = apply_damage_to_health(&mut world, enemy_index, 2.0, 5.0, 1);
        assert_eq!(
            second,
            DamageOutcome {
                remaining_health: 0.0,
                killed: true,
                score_reward: 7,
            }
        );
    }

    #[test]
    fn lifetime_helpers_tick_and_detect_expiry() {
        let mut world = World::default();
        let bullet = world.spawn_bullet_with_lifetime(0.0, 0.0, 0.0, 0.0, 1, 0.5);
        let bullet_index = bullet.id as usize;

        assert_eq!(tick_lifetime(&mut world, bullet_index, 0.25), Some(0.25));
        assert!(!has_expired_lifetime(&world, bullet_index));
        assert_eq!(tick_lifetime(&mut world, bullet_index, 0.25), Some(0.0));
        assert!(has_expired_lifetime(&world, bullet_index));
    }

    #[test]
    fn lifetime_system_ticks_all_lifetimes_and_queues_expired_entities() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(0.0, 0.0, 1);
        let actor = world.spawn_entity();
        let persistent = world.spawn_entity();
        world.set_gameplay_lifetime(enemy, 0.25);
        world.set_gameplay_lifetime(actor, 0.5);
        world.set_gameplay_lifetime(persistent, 1.0);

        let mut pending = Vec::new();
        assert_eq!(run_lifetime_system(&mut world, 0.5, &mut pending), 2);
        assert_eq!(pending, vec![enemy, actor]);
        assert_eq!(world.gameplay_lifetime(persistent), Some(0.5));
    }

    #[test]
    fn collision_reaction_pair_resolves_targets_and_reverses_direction() {
        let source = Entity {
            id: 2,
            generation: 7,
        };
        let other = Entity {
            id: 5,
            generation: 11,
        };
        let pair = CollisionReactionPair::new(2, 5, source, other);

        assert_eq!(pair.target_index(CollisionTarget::SelfEntity), 2);
        assert_eq!(pair.target_index(CollisionTarget::OtherEntity), 5);
        assert_eq!(pair.target_entity(CollisionTarget::SelfEntity), source);
        assert_eq!(pair.target_entity(CollisionTarget::OtherEntity), other);
        assert_eq!(
            pair.reversed(),
            CollisionReactionPair::new(5, 2, other, source),
        );
    }

    #[test]
    fn collision_damage_allowed_respects_optional_faction_masks() {
        use crate::components::gameplay::{
            GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_NEUTRAL,
            GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();

        assert!(collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));

        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
        );
        world.set_gameplay_faction(
            target,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
        );
        assert!(!collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));
        let denial = faction_damage_denial(&world, source.id as usize, target.id as usize)
            .expect("damage should be denied by source faction mask");
        assert_eq!(denial.source, source);
        assert_eq!(denial.target, target);
        assert_eq!(denial.source_faction_id, GAMEPLAY_FACTION_PLAYER);
        assert_eq!(denial.target_faction_id, GAMEPLAY_FACTION_ENEMY);

        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
        );
        assert!(collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));
        assert_eq!(
            faction_damage_denial(&world, source.id as usize, target.id as usize),
            None
        );

        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_NEUTRAL, 0).unwrap(),
        );
        assert!(!collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));
        let neutral_denial = faction_damage_denial(&world, source.id as usize, target.id as usize)
            .expect("neutral source with empty damage mask should be denied");
        assert_eq!(neutral_denial.source, source);
        assert_eq!(neutral_denial.target, target);
        assert_eq!(neutral_denial.source_faction_id, GAMEPLAY_FACTION_NEUTRAL);
        assert_eq!(neutral_denial.target_faction_id, GAMEPLAY_FACTION_ENEMY);
    }

    #[test]
    fn collision_damage_allowed_uses_relation_table_when_enabled() {
        use crate::components::gameplay::{
            FactionRelation, GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();
        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
        );
        world.set_gameplay_faction(
            target,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
        );

        assert!(!collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));

        assert!(world.set_gameplay_faction_relation(
            GAMEPLAY_FACTION_PLAYER,
            GAMEPLAY_FACTION_ENEMY,
            FactionRelation::Hostile,
        ));
        assert!(collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));

        assert!(world.set_gameplay_faction_relation(
            GAMEPLAY_FACTION_PLAYER,
            GAMEPLAY_FACTION_ENEMY,
            FactionRelation::Friendly,
        ));
        let friendly_denial = faction_damage_denial(&world, source.id as usize, target.id as usize)
            .expect("friendly relation should deny damage");
        assert_eq!(friendly_denial.source_faction_id, GAMEPLAY_FACTION_PLAYER);
        assert_eq!(friendly_denial.target_faction_id, GAMEPLAY_FACTION_ENEMY);

        assert!(world.set_gameplay_faction_relation(
            GAMEPLAY_FACTION_PLAYER,
            GAMEPLAY_FACTION_ENEMY,
            FactionRelation::Neutral,
        ));
        assert!(!collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));

        world.clear_gameplay_faction(target);
        assert!(collision_damage_allowed(
            &world,
            source.id as usize,
            target.id as usize,
        ));
    }

    #[test]
    fn collision_damage_allowed_respects_directed_relation_table() {
        use crate::components::gameplay::{
            FactionRelation, GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let player = world.spawn_entity();
        let enemy = world.spawn_entity();
        world.set_gameplay_faction(
            player,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
        );
        world.set_gameplay_faction(
            enemy,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
        );
        world.set_gameplay_faction_default_relation(FactionRelation::Neutral);
        assert!(world.set_gameplay_faction_relation(
            GAMEPLAY_FACTION_PLAYER,
            GAMEPLAY_FACTION_ENEMY,
            FactionRelation::Hostile,
        ));

        assert!(collision_damage_allowed(
            &world,
            player.id as usize,
            enemy.id as usize,
        ));
        assert!(!collision_damage_allowed(
            &world,
            enemy.id as usize,
            player.id as usize,
        ));
    }

    #[test]
    fn default_projectile_damage_allowed_checks_target_and_faction_gate() {
        use crate::components::gameplay::{
            GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let projectile = world.spawn_entity();
        let enemy = world.spawn_entity();

        assert_eq!(
            projectile_collision_target_at(&world, projectile.id as usize),
            ProjectileCollisionTarget::Enemies,
        );
        assert!(default_projectile_damage_allowed(
            &world,
            projectile.id as usize,
            enemy.id as usize,
            ProjectileCollisionTarget::Enemies,
        ));
        assert!(!default_projectile_damage_allowed(
            &world,
            projectile.id as usize,
            enemy.id as usize,
            ProjectileCollisionTarget::Player,
        ));

        world.set_projectile_collision_target_at(
            projectile.id as usize,
            ProjectileCollisionTarget::Player,
        );
        assert_eq!(
            projectile_collision_target_at(&world, projectile.id as usize),
            ProjectileCollisionTarget::Player,
        );
        assert!(default_projectile_damage_allowed(
            &world,
            projectile.id as usize,
            enemy.id as usize,
            ProjectileCollisionTarget::Player,
        ));

        world.set_gameplay_faction(
            projectile,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
        );
        world.set_gameplay_faction(
            enemy,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
        );
        assert!(!default_projectile_damage_allowed(
            &world,
            projectile.id as usize,
            enemy.id as usize,
            ProjectileCollisionTarget::Player,
        ));
    }

    #[test]
    fn default_melee_damage_allowed_checks_optional_faction_gate() {
        use crate::components::gameplay::{
            GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let attacker = world.spawn_entity();
        let target = world.spawn_entity();

        assert!(default_melee_damage_allowed(
            &world,
            attacker.id as usize,
            target.id as usize,
        ));

        world.set_gameplay_faction(
            attacker,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
        );
        world.set_gameplay_faction(
            target,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
        );
        assert!(!default_melee_damage_allowed(
            &world,
            attacker.id as usize,
            target.id as usize,
        ));

        world.set_gameplay_faction(
            attacker,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
        );
        assert!(default_melee_damage_allowed(
            &world,
            attacker.id as usize,
            target.id as usize,
        ));
    }

    #[test]
    fn collision_pair_query_helpers_reuse_scratch_and_match_requested_layers() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 1);
        let enemy = world.spawn_enemy(0.0, 0.0, 1);
        let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let mut scratch = CollisionScratch::default();
        let mut pairs = Vec::new();

        build_collision_layer_pairs(
            &mut scratch,
            &world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
            &mut pairs,
        );
        assert_eq!(
            pairs,
            vec![CollisionPair {
                a: player,
                b: enemy
            }]
        );

        build_swept_collision_layer_pairs(
            &mut scratch,
            &world,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            0.016,
            &mut pairs,
        );
        assert_eq!(
            pairs,
            vec![CollisionPair {
                a: bullet,
                b: enemy
            }]
        );
    }

    #[test]
    fn collision_reaction_pair_for_layer_pair_filters_stale_layer_and_marked_pairs() {
        let mut world = World::default();
        let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let enemy = world.spawn_enemy(0.0, 0.0, 1);
        let pair = CollisionPair {
            a: bullet,
            b: enemy,
        };
        let mut marked = vec![false; world.entity_capacity()];

        assert_eq!(
            collision_reaction_pair_for_layer_pair(
                &world,
                pair,
                CollisionLayer::Bullet,
                CollisionLayer::Enemy,
                &marked,
            ),
            Some(CollisionReactionPair::new(
                bullet.id as usize,
                enemy.id as usize,
                bullet,
                enemy,
            )),
        );

        marked[bullet.id as usize] = true;
        assert_eq!(
            collision_reaction_pair_for_layer_pair(
                &world,
                pair,
                CollisionLayer::Bullet,
                CollisionLayer::Enemy,
                &marked,
            ),
            None,
        );
        marked[bullet.id as usize] = false;

        assert_eq!(
            collision_reaction_pair_for_layer_pair(
                &world,
                pair,
                CollisionLayer::Player,
                CollisionLayer::Enemy,
                &marked,
            ),
            None,
        );

        world.despawn(bullet);
        assert_eq!(
            collision_reaction_pair_for_layer_pair(
                &world,
                pair,
                CollisionLayer::Bullet,
                CollisionLayer::Enemy,
                &marked,
            ),
            None,
        );
    }

    #[test]
    fn collision_despawn_reaction_for_pair_queues_target_once() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        assert_eq!(
            apply_collision_despawn_reaction_for_pair(
                &world,
                pair,
                CollisionTarget::OtherEntity,
                &mut marked,
                &mut pending,
            ),
            Some(CollisionDespawnReactionOutcome {
                target_index: target.id as usize,
                target,
            }),
        );
        assert_eq!(pending, vec![target]);
        assert_eq!(
            apply_collision_despawn_reaction_for_pair(
                &world,
                pair,
                CollisionTarget::OtherEntity,
                &mut marked,
                &mut pending,
            ),
            None,
        );
        assert_eq!(pending, vec![target]);
    }

    #[test]
    fn collision_pickup_reaction_for_pair_collects_score_pickup_once() {
        let mut world = World::default();
        let collector = world.spawn_player(0.0, 0.0, 1);
        let pickup = world.spawn_entity();
        world.set_aabb_collider(
            pickup,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true)));
        let pair = CollisionReactionPair::new(
            pickup.id as usize,
            collector.id as usize,
            pickup,
            collector,
        );
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        assert_eq!(
            apply_collision_pickup_reaction_for_pair(
                &world,
                pair,
                CollisionTarget::SelfEntity,
                &mut marked,
                &mut pending,
            ),
            Some(CollisionPickupReactionOutcome {
                pickup_index: pickup.id as usize,
                pickup,
                collector_index: collector.id as usize,
                collector,
                item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
                count: 3,
                target_removed: true,
            }),
        );
        assert_eq!(pending, vec![pickup]);
        assert_eq!(
            apply_collision_pickup_reaction_for_pair(
                &world,
                pair,
                CollisionTarget::SelfEntity,
                &mut marked,
                &mut pending,
            ),
            None,
        );
        assert_eq!(pending, vec![pickup]);
    }

    #[test]
    fn collision_pickup_reaction_for_pair_rejects_non_pickup_targets() {
        let mut world = World::default();
        let collector = world.spawn_player(0.0, 0.0, 1);
        let enemy = world.spawn_enemy(4.0, 0.0, 1);
        let pair =
            CollisionReactionPair::new(enemy.id as usize, collector.id as usize, enemy, collector);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        assert_eq!(
            apply_collision_pickup_reaction_for_pair(
                &world,
                pair,
                CollisionTarget::SelfEntity,
                &mut marked,
                &mut pending,
            ),
            None,
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn pickup_collision_reaction_set_handles_pickup_and_side_effects_only() {
        let mut world = World::default();
        let collector = world.spawn_player(0.0, 0.0, 1);
        let pickup = world.spawn_entity();
        world.set_aabb_collider(
            pickup,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 5, true)));
        let pair = CollisionReactionPair::new(
            pickup.id as usize,
            collector.id as usize,
            pickup,
            collector,
        );
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Pickup {
            target: CollisionTarget::SelfEntity,
        }));
        assert!(reactions.push(CollisionReaction::PlaySound {
            sound_id: 12,
            volume: 0.25,
            pitch: 1.5,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        }));
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        }));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        let outcome = apply_pickup_collision_reaction_set_for_pair(
            &world,
            pair,
            &mut reactions,
            false,
            &mut marked,
            &mut pending,
        );

        assert!(outcome.handled_pickup);
        assert_eq!(
            outcome.pickup_outcomes().collect::<Vec<_>>(),
            vec![CollisionPickupReactionOutcome {
                pickup_index: pickup.id as usize,
                pickup,
                collector_index: collector.id as usize,
                collector,
                item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
                count: 5,
                target_removed: true,
            }],
        );
        assert_eq!(
            outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: true,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 12,
                    volume: 0.25,
                    pitch: 1.5,
                }),
            }],
        );
        assert_eq!(pending, vec![pickup]);
    }

    #[test]
    fn pickup_collision_reaction_set_side_effects_are_additive_and_wrong_pickup_suppresses_fallback(
    ) {
        let mut world = World::default();
        let collector = world.spawn_player(0.0, 0.0, 1);
        let pickup = world.spawn_entity();
        world.set_aabb_collider(
            pickup,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 1, true)));
        let pair = CollisionReactionPair::new(
            collector.id as usize,
            pickup.id as usize,
            collector,
            pickup,
        );
        let mut side_effect_only = CollisionReactionSet::default();
        assert!(side_effect_only.push(CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.25),
            replace_default: true,
            trigger: CollisionReactionTrigger::Enter,
        }));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        let additive = apply_pickup_collision_reaction_set_for_pair(
            &world,
            pair,
            &mut side_effect_only,
            false,
            &mut marked,
            &mut pending,
        );
        assert!(!additive.handled_pickup);
        assert_eq!(
            additive.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: true,
                effect: None,
            }],
        );
        assert!(pending.is_empty());

        let additive_enter = apply_pickup_collision_reaction_set_for_pair(
            &world,
            pair,
            &mut side_effect_only,
            true,
            &mut marked,
            &mut pending,
        );
        assert!(!additive_enter.handled_pickup);
        assert_eq!(
            additive_enter.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: true,
                effect: Some(CollisionSideEffect::SpawnParticle {
                    preset_id: 3,
                    target_index: pickup.id as usize,
                }),
            }],
        );

        let mut wrong_pickup = CollisionReactionSet::default();
        assert!(wrong_pickup.push(CollisionReaction::Pickup {
            target: CollisionTarget::SelfEntity,
        }));
        let wrong = apply_pickup_collision_reaction_set_for_pair(
            &world,
            pair,
            &mut wrong_pickup,
            true,
            &mut marked,
            &mut pending,
        );
        assert!(wrong.handled_pickup);
        assert!(wrong.pickup_outcomes().collect::<Vec<_>>().is_empty());
        assert!(pending.is_empty());
    }

    #[test]
    fn pickup_collision_reaction_sets_for_pair_applies_both_sides_and_writes_cooldowns_back() {
        let mut world = World::default();
        let collector = world.spawn_player(0.0, 0.0, 1);
        let pickup = world.spawn_entity();
        world.set_aabb_collider(
            pickup,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 5, true)));
        let pair = CollisionReactionPair::new(
            collector.id as usize,
            pickup.id as usize,
            collector,
            pickup,
        );
        let mut collector_reactions = CollisionReactionSet::default();
        assert!(collector_reactions.push(CollisionReaction::PlaySound {
            sound_id: 12,
            volume: 0.25,
            pitch: 1.5,
            cooldown: Cooldown::ready(0.25),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        }));
        let mut pickup_reactions = CollisionReactionSet::default();
        assert!(pickup_reactions.push(CollisionReaction::Pickup {
            target: CollisionTarget::SelfEntity,
        }));
        world.replace_collision_reactions(collector, Some(collector_reactions));
        world.replace_collision_reactions(pickup, Some(pickup_reactions));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        assert!(has_collision_reaction_sets_for_pair(&world, pair));
        let outcome = apply_pickup_collision_reaction_sets_for_pair(
            &mut world,
            pair,
            false,
            &mut marked,
            &mut pending,
        )
        .expect("reaction sets are present");

        assert!(outcome.handled_pickup);
        let applied = outcome.outcomes().collect::<Vec<_>>();
        assert_eq!(applied.len(), 2);
        assert_eq!(applied[0].pair, pair);
        assert_eq!(
            applied[0].outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: true,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 12,
                    volume: 0.25,
                    pitch: 1.5,
                }),
            }],
        );
        assert_eq!(applied[1].pair, pair.reversed());
        assert_eq!(
            applied[1].outcome.pickup_outcomes().collect::<Vec<_>>(),
            vec![CollisionPickupReactionOutcome {
                pickup_index: pickup.id as usize,
                pickup,
                collector_index: collector.id as usize,
                collector,
                item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
                count: 5,
                target_removed: true,
            }],
        );
        assert_eq!(pending, vec![pickup]);
        assert_eq!(
            world
                .collision_reactions(collector)
                .expect("collector reactions are written back")
                .iter()
                .collect::<Vec<_>>(),
            vec![CollisionReaction::PlaySound {
                sound_id: 12,
                volume: 0.25,
                pitch: 1.5,
                cooldown: Cooldown {
                    duration_seconds: 0.25,
                    remaining_seconds: 0.25,
                },
                replace_default: true,
                trigger: CollisionReactionTrigger::Contact,
            }],
        );
    }

    #[test]
    fn pickup_collision_reaction_sets_for_pair_preserves_wrong_target_fallback_suppression() {
        let mut world = World::default();
        let collector = world.spawn_player(0.0, 0.0, 1);
        let pickup = world.spawn_entity();
        world.set_aabb_collider(
            pickup,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        assert!(world.set_pickup(pickup, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 1, true)));
        let pair = CollisionReactionPair::new(
            collector.id as usize,
            pickup.id as usize,
            collector,
            pickup,
        );
        let mut collector_reactions = CollisionReactionSet::default();
        assert!(collector_reactions.push(CollisionReaction::Pickup {
            target: CollisionTarget::SelfEntity,
        }));
        world.replace_collision_reactions(collector, Some(collector_reactions));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        let outcome = apply_pickup_collision_reaction_sets_for_pair(
            &mut world,
            pair,
            true,
            &mut marked,
            &mut pending,
        )
        .expect("reaction set is present");

        assert!(outcome.handled_pickup);
        let applied = outcome.outcomes().collect::<Vec<_>>();
        assert_eq!(applied.len(), 1);
        assert!(applied[0].outcome.pickup_outcomes().next().is_none());
        assert!(pending.is_empty());
    }

    #[test]
    fn collision_reaction_set_for_pair_applies_damage_and_despawn_outcomes() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_enemy(4.0, 0.0, 1);
        world.set_damage(source, 2.0);
        world.set_health(target, 2.0);
        world.set_score_reward(target, 9);
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        }));
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            true,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 1,
                despawn_on_kill: true,
            },
        );

        assert!(outcome.overrides_default_gameplay);
        assert_eq!(
            outcome.damage_outcomes().collect::<Vec<_>>(),
            vec![CollisionDamageReactionOutcome {
                target_index: target.id as usize,
                target,
                damage: 2.0,
                killed: true,
                target_removed: true,
                score_reward: 9,
            }],
        );
        assert_eq!(
            outcome.despawn_outcomes().collect::<Vec<_>>(),
            vec![CollisionDespawnReactionOutcome {
                target_index: source.id as usize,
                target: source,
            }],
        );
        assert_eq!(pending, vec![target, source]);
    }

    #[test]
    fn collision_reaction_set_for_pair_applies_knockback_without_overriding_gameplay() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 0.0, y: 0.0 });
        world.set_transform(target, Transform2D { x: 3.0, y: 4.0 });
        world.set_velocity(target, Velocity { vx: 1.0, vy: -1.0 });
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Knockback {
            target: CollisionTarget::OtherEntity,
            impulse: 10.0,
        }));
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            true,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        );

        assert!(!outcome.overrides_default_gameplay);
        assert_eq!(
            outcome.knockback_outcomes().collect::<Vec<_>>(),
            vec![CollisionKnockbackReactionOutcome {
                target_index: target.id as usize,
                target,
                impulse: Velocity { vx: 6.0, vy: 8.0 },
            }],
        );
        assert_eq!(
            world.velocities[target.id as usize],
            Some(Velocity { vx: 7.0, vy: 7.0 })
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn collision_area_damage_reaction_damages_enemy_layer_targets_in_radius() {
        let mut world = World::default();
        let source = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let direct = world.spawn_enemy(4.0, 0.0, 1);
        let splash = world.spawn_enemy(18.0, 0.0, 1);
        let far = world.spawn_enemy(96.0, 0.0, 1);
        let pickup = world.spawn_entity();
        world.set_transform(pickup, Transform2D { x: 10.0, y: 0.0 });
        world.set_aabb_collider(
            pickup,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        world.set_damage(source, 2.0);
        world.set_health(direct, 2.0);
        world.set_health(splash, 3.0);
        world.set_health(far, 2.0);
        world.set_score_reward(direct, 7);
        world.set_score_reward(splash, 5);
        let pair =
            CollisionReactionPair::new(source.id as usize, direct.id as usize, source, direct);
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::AreaDamage {
            radius: 24.0,
            target_layer: CollisionLayer::Enemy,
        }));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            true,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 1,
                despawn_on_kill: true,
            },
        );

        assert!(outcome.overrides_default_gameplay);
        assert_eq!(
            outcome.damage_outcomes().collect::<Vec<_>>(),
            vec![
                CollisionDamageReactionOutcome {
                    target_index: direct.id as usize,
                    target: direct,
                    damage: 2.0,
                    killed: true,
                    target_removed: true,
                    score_reward: 7,
                },
                CollisionDamageReactionOutcome {
                    target_index: splash.id as usize,
                    target: splash,
                    damage: 2.0,
                    killed: false,
                    target_removed: false,
                    score_reward: 0,
                },
            ],
        );
        assert_eq!(world.health(splash), Some(1.0));
        assert_eq!(world.health(far), Some(2.0));
        assert_eq!(world.health(pickup), None);
        assert_eq!(pending, vec![direct]);
    }

    #[test]
    fn collision_area_damage_reaction_reports_faction_denials() {
        use crate::components::gameplay::{
            GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let source = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let blocked = world.spawn_enemy(4.0, 0.0, 1);
        world.set_damage(source, 2.0);
        world.set_health(blocked, 2.0);
        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
        );
        world.set_gameplay_faction(
            blocked,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
        );
        let pair =
            CollisionReactionPair::new(source.id as usize, blocked.id as usize, source, blocked);
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::AreaDamage {
            radius: 24.0,
            target_layer: CollisionLayer::Enemy,
        }));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            true,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 1,
                despawn_on_kill: true,
            },
        );

        assert!(outcome.damage_outcomes().next().is_none());
        assert_eq!(
            outcome.faction_damage_denials().collect::<Vec<_>>(),
            vec![FactionDamageDenial {
                source,
                target: blocked,
                source_faction_id: GAMEPLAY_FACTION_PLAYER,
                target_faction_id: GAMEPLAY_FACTION_ENEMY,
            }],
        );
        assert_eq!(world.health(blocked), Some(2.0));
        assert!(pending.is_empty());
    }

    #[test]
    fn collision_reaction_set_for_pair_keeps_side_effects_additive() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let other = world.spawn_entity();
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::PlaySound {
            sound_id: 5,
            volume: 0.75,
            pitch: 1.25,
            cooldown: Cooldown::ready(0.1),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        }));
        let pair = CollisionReactionPair::new(source.id as usize, other.id as usize, source, other);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            false,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        );

        assert!(!outcome.overrides_default_gameplay);
        assert!(outcome.replace_default_audio);
        assert_eq!(
            outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: true,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 5,
                    volume: 0.75,
                    pitch: 1.25,
                }),
            }],
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn collision_reaction_set_for_pair_preserves_reversed_target_orientation() {
        let mut world = World::default();
        let first = world.spawn_entity();
        let second = world.spawn_entity();
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::SpawnParticle {
            preset_id: 11,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Enter,
        }));
        let pair = CollisionReactionPair::new(first.id as usize, second.id as usize, first, second)
            .reversed();
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            true,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        );

        assert_eq!(
            outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: true,
                effect: Some(CollisionSideEffect::SpawnParticle {
                    preset_id: 11,
                    target_index: first.id as usize,
                }),
            }],
        );
    }

    #[test]
    fn collision_reaction_sets_for_pair_applies_both_sides_and_writes_back_cooldowns() {
        let mut world = World::default();
        let first = world.spawn_entity();
        let second = world.spawn_entity();
        let mut first_reactions = CollisionReactionSet::default();
        assert!(first_reactions.push(CollisionReaction::PlaySound {
            sound_id: 7,
            volume: 0.5,
            pitch: 1.0,
            cooldown: Cooldown::ready(0.5),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        }));
        let mut second_reactions = CollisionReactionSet::default();
        assert!(second_reactions.push(CollisionReaction::SpawnParticle {
            preset_id: 13,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        }));
        world.replace_collision_reactions(first, Some(first_reactions));
        world.replace_collision_reactions(second, Some(second_reactions));
        let pair = CollisionReactionPair::new(first.id as usize, second.id as usize, first, second);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let outcome = apply_collision_reaction_sets_for_pair(
            &mut world,
            pair,
            false,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        )
        .expect("pair has authored reactions");
        let applied = outcome.outcomes().collect::<Vec<_>>();
        assert_eq!(applied.len(), 2);
        assert_eq!(applied[0].pair, pair);
        assert_eq!(
            applied[0].outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 7,
                    volume: 0.5,
                    pitch: 1.0,
                }),
            }],
        );
        assert_eq!(applied[1].pair, pair.reversed());
        assert_eq!(
            applied[1].outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::SpawnParticle {
                    preset_id: 13,
                    target_index: first.id as usize,
                }),
            }],
        );

        let second_outcome = apply_collision_reaction_sets_for_pair(
            &mut world,
            pair,
            false,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        )
        .expect("pair still has authored reactions");
        let second_applied = second_outcome.outcomes().collect::<Vec<_>>();
        assert_eq!(
            second_applied[0].outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: None,
            }],
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn collision_reaction_outcome_summary_tracks_default_flags_and_target_roles() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let enemy = world.spawn_enemy(4.0, 0.0, 1);
        world.set_damage(source, 3.0);
        world.set_health(enemy, 3.0);
        world.set_score_reward(enemy, 5);
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::PlaySound {
            sound_id: 2,
            volume: 1.0,
            pitch: 1.0,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        }));
        let pair = CollisionReactionPair::new(source.id as usize, enemy.id as usize, source, enemy);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let reaction_outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            false,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: true,
            },
        );
        let summary = summarize_collision_reaction_set_outcome(&reaction_outcome, |target_index| {
            if target_index == enemy.id as usize {
                CollisionReactionTargetRole::Enemy
            } else {
                CollisionReactionTargetRole::Other
            }
        });

        assert_eq!(
            summary,
            CollisionReactionOutcomeSummary {
                total_damage: 3.0,
                score_delta: 5,
                overrides_default_gameplay: true,
                faction_damage_denied: false,
                enemy_damaged: true,
                enemy_removed: true,
                player_game_over: false,
                pickup_collected: false,
                replace_default_audio: true,
                replace_default_particle: false,
            },
        );
    }

    #[test]
    fn collision_gameplay_event_payloads_preserve_outcome_order_and_sources() {
        let mut world = World::default();
        let source = world.spawn_player(0.0, 0.0, 1);
        world.set_damage(source, 3.0);
        let target = world.spawn_enemy(4.0, 0.0, 1);
        world.set_health(target, 3.0);
        world.set_score_reward(target, 5);
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        }));
        world.set_pickup(
            target,
            Pickup {
                item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
                count: 2,
                despawn_on_collect: true,
            },
        );
        world.set_aabb_collider(
            target,
            AabbCollider::new(4.0, 4.0, true, CollisionLayer::Pickup),
        );
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let reaction_outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            false,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        );

        assert_eq!(
            collision_gameplay_events_for_reaction_outcome(pair, &reaction_outcome)
                .events()
                .collect::<Vec<_>>(),
            vec![
                CollisionGameplayEventPayload::Damage {
                    target,
                    source,
                    damage: 3.0,
                    target_removed: false,
                },
                CollisionGameplayEventPayload::PickupCollected {
                    collector: source,
                    pickup: target,
                    item_id: GAMEPLAY_PICKUP_ITEM_SCORE,
                    count: 2,
                    target_removed: true,
                },
                CollisionGameplayEventPayload::Despawn {
                    target: source,
                    source,
                },
            ],
        );
    }

    #[test]
    fn collision_damage_reaction_denial_reports_faction_payload() {
        use crate::components::gameplay::{
            GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();
        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
        );
        world.set_gameplay_faction(
            target,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
        );
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }));
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let reaction_outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            false,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        );

        assert!(reaction_outcome.damage_outcomes().next().is_none());
        let summary = summarize_collision_reaction_set_outcome(&reaction_outcome, |target_index| {
            if target_index == target.id as usize {
                CollisionReactionTargetRole::Player
            } else {
                CollisionReactionTargetRole::Other
            }
        });
        assert!(summary.overrides_default_gameplay);
        assert!(summary.faction_damage_denied);
        assert_eq!(summary.total_damage, 0.0);
        assert_eq!(
            reaction_outcome
                .faction_damage_denials()
                .collect::<Vec<_>>(),
            vec![FactionDamageDenial {
                source,
                target,
                source_faction_id: GAMEPLAY_FACTION_ENEMY,
                target_faction_id: GAMEPLAY_FACTION_PLAYER,
            }],
        );
        assert_eq!(
            collision_gameplay_events_for_reaction_outcome(pair, &reaction_outcome)
                .events()
                .collect::<Vec<_>>(),
            vec![CollisionGameplayEventPayload::FactionDamageDenied {
                target,
                source,
                source_faction_id: GAMEPLAY_FACTION_ENEMY,
                target_faction_id: GAMEPLAY_FACTION_PLAYER,
            }],
        );
    }

    #[test]
    fn collision_damage_reaction_denial_skips_marked_target() {
        use crate::components::gameplay::{
            GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
        };

        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();
        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
        );
        world.set_gameplay_faction(
            target,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
        );
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }));
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_damage_hits = Vec::new();

        let reaction_outcome = apply_collision_reaction_set_for_pair(
            &mut world,
            pair,
            &mut reactions,
            false,
            &mut area_damage_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
        );

        assert_eq!(reaction_outcome.despawn_outcomes().count(), 1);
        assert!(reaction_outcome.damage_outcomes().next().is_none());
        assert!(reaction_outcome.faction_damage_denials().next().is_none());
        assert!(
            collision_gameplay_events_for_reaction_outcome(pair, &reaction_outcome)
                .events()
                .all(|payload| !matches!(
                    payload,
                    CollisionGameplayEventPayload::FactionDamageDenied { .. }
                )),
        );
    }

    #[test]
    fn default_collision_presentation_policy_respects_authored_replace_flags() {
        assert_eq!(
            default_collision_presentation_policy(None),
            DefaultCollisionPresentationPolicy {
                emit_audio: true,
                emit_particle: true,
            },
        );

        let authored_outcome = CollisionReactionOutcomeSummary {
            replace_default_audio: true,
            replace_default_particle: false,
            ..CollisionReactionOutcomeSummary::default()
        };
        assert_eq!(
            default_collision_presentation_policy(Some(&authored_outcome)),
            DefaultCollisionPresentationPolicy {
                emit_audio: false,
                emit_particle: true,
            },
        );

        let authored_outcome = CollisionReactionOutcomeSummary {
            replace_default_audio: false,
            replace_default_particle: true,
            ..CollisionReactionOutcomeSummary::default()
        };
        assert_eq!(
            default_collision_presentation_policy(Some(&authored_outcome)),
            DefaultCollisionPresentationPolicy {
                emit_audio: true,
                emit_particle: false,
            },
        );
    }

    #[test]
    fn should_emit_default_game_over_audio_requires_transition_and_audio_policy() {
        assert!(should_emit_default_game_over_audio(true, None));
        assert!(!should_emit_default_game_over_audio(false, None));

        let authored_outcome = CollisionReactionOutcomeSummary {
            replace_default_audio: true,
            ..CollisionReactionOutcomeSummary::default()
        };
        assert!(!should_emit_default_game_over_audio(
            true,
            Some(&authored_outcome)
        ));
        assert!(!should_emit_default_game_over_audio(
            false,
            Some(&authored_outcome)
        ));

        let authored_outcome = CollisionReactionOutcomeSummary {
            replace_default_particle: true,
            ..CollisionReactionOutcomeSummary::default()
        };
        assert!(should_emit_default_game_over_audio(
            true,
            Some(&authored_outcome)
        ));
    }

    #[test]
    fn collision_hit_presentation_payload_prefers_target_transform_and_emits_defaults() {
        let mut world = World::default();
        let source = world.spawn_entity();
        world.transforms[source.id as usize] = Some(Transform2D { x: 1.0, y: 2.0 });
        let target = world.spawn_enemy(4.0, 5.0, 1);
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);

        assert_eq!(
            collision_hit_presentation_payload(&world, pair, 3.0, None),
            CollisionHitPresentationPayload {
                source,
                target,
                damage: 3.0,
                emit_audio: true,
                particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
            },
        );
    }

    #[test]
    fn collision_hit_presentation_payload_falls_back_to_source_transform() {
        let mut world = World::default();
        let source = world.spawn_entity();
        world.transforms[source.id as usize] = Some(Transform2D { x: 1.0, y: 2.0 });
        let target = world.spawn_enemy(4.0, 5.0, 1);
        world.transforms[target.id as usize] = None;
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);

        assert_eq!(
            collision_hit_presentation_payload(&world, pair, 2.5, None).particle_position,
            Some(Transform2D { x: 1.0, y: 2.0 }),
        );
    }

    #[test]
    fn collision_hit_presentation_payload_respects_replace_default_flags() {
        let mut world = World::default();
        let source = world.spawn_entity();
        world.transforms[source.id as usize] = Some(Transform2D { x: 1.0, y: 2.0 });
        let target = world.spawn_enemy(4.0, 5.0, 1);
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let authored_outcome = CollisionReactionOutcomeSummary {
            replace_default_audio: true,
            replace_default_particle: true,
            ..CollisionReactionOutcomeSummary::default()
        };

        assert_eq!(
            collision_hit_presentation_payload(&world, pair, 3.0, Some(&authored_outcome)),
            CollisionHitPresentationPayload {
                source,
                target,
                damage: 3.0,
                emit_audio: false,
                particle_position: None,
            },
        );
    }

    #[test]
    fn default_collision_damage_hit_queues_source_and_killed_target_once() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_enemy(4.0, 0.0, 1);
        world.set_health(target, 2.0);
        world.set_score_reward(target, 8);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        let outcome = apply_default_collision_damage_hit(
            &mut world,
            source.id as usize,
            target.id as usize,
            2.0,
            5.0,
            1,
            true,
            true,
            &mut marked,
            &mut pending,
        )
        .expect("source and target are alive");

        assert_eq!(
            outcome,
            DefaultCollisionDamageHitOutcome {
                source_index: source.id as usize,
                source,
                source_removed: true,
                target_index: target.id as usize,
                target,
                damage: 2.0,
                killed: true,
                target_removed: true,
                score_reward: 8,
            },
        );
        assert_eq!(pending, vec![source, target]);

        let duplicate = apply_default_collision_damage_hit(
            &mut world,
            source.id as usize,
            target.id as usize,
            2.0,
            5.0,
            1,
            true,
            true,
            &mut marked,
            &mut pending,
        )
        .expect("entities are still alive until deferred despawn flush");
        assert!(!duplicate.source_removed);
        assert!(!duplicate.target_removed);
        assert_eq!(pending, vec![source, target]);
    }

    #[test]
    fn default_collision_damage_hit_can_preserve_source_and_queue_killed_target() {
        let mut world = World::default();
        let source = world.spawn_player(0.0, 0.0, 1);
        let target = world.spawn_enemy(4.0, 0.0, 1);
        world.set_health(target, 1.0);
        world.set_score_reward(target, 5);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        let outcome = apply_default_collision_damage_hit(
            &mut world,
            source.id as usize,
            target.id as usize,
            1.0,
            3.0,
            1,
            false,
            true,
            &mut marked,
            &mut pending,
        )
        .expect("source and target are alive");

        assert_eq!(
            outcome,
            DefaultCollisionDamageHitOutcome {
                source_index: source.id as usize,
                source,
                source_removed: false,
                target_index: target.id as usize,
                target,
                damage: 1.0,
                killed: true,
                target_removed: true,
                score_reward: 5,
            },
        );
        assert_eq!(pending, vec![target]);
        assert!(!marked[source.id as usize]);
        assert!(marked[target.id as usize]);
    }

    #[test]
    fn default_collision_damage_gameplay_event_payload_uses_target_removed_flag() {
        let source = Entity {
            id: 1,
            generation: 2,
        };
        let target = Entity {
            id: 3,
            generation: 4,
        };
        let outcome = DefaultCollisionDamageHitOutcome {
            source_index: source.id as usize,
            source,
            source_removed: false,
            target_index: target.id as usize,
            target,
            damage: 2.5,
            killed: true,
            target_removed: false,
            score_reward: 7,
        };

        assert_eq!(
            default_collision_damage_gameplay_event_payload(outcome),
            CollisionGameplayEventPayload::Damage {
                target,
                source,
                damage: 2.5,
                target_removed: false,
            },
        );
    }

    #[test]
    fn default_collision_damage_score_delta_uses_killed_flag() {
        let source = Entity {
            id: 1,
            generation: 2,
        };
        let target = Entity {
            id: 3,
            generation: 4,
        };
        let killed_outcome = DefaultCollisionDamageHitOutcome {
            source_index: source.id as usize,
            source,
            source_removed: false,
            target_index: target.id as usize,
            target,
            damage: 2.5,
            killed: true,
            target_removed: false,
            score_reward: 7,
        };
        let damaged_outcome = DefaultCollisionDamageHitOutcome {
            killed: false,
            score_reward: 7,
            ..killed_outcome
        };
        let unrewarded_kill_outcome = DefaultCollisionDamageHitOutcome {
            score_reward: 0,
            ..killed_outcome
        };

        assert_eq!(default_collision_damage_score_delta(killed_outcome), 7);
        assert_eq!(default_collision_damage_score_delta(damaged_outcome), 0);
        assert_eq!(
            default_collision_damage_score_delta(unrewarded_kill_outcome),
            0
        );
    }

    #[test]
    fn commit_score_delta_uses_saturating_add_policy() {
        let mut score = 3;
        commit_score_delta(&mut score, 4);
        assert_eq!(score, 7);

        commit_score_delta(&mut score, 0);
        assert_eq!(score, 7);

        score = u32::MAX - 1;
        commit_score_delta(&mut score, 3);
        assert_eq!(score, u32::MAX);
    }

    #[test]
    fn target_only_default_collision_damage_hit_presentation_payload_uses_target_transform_only() {
        let mut world = World::default();
        let source = world.spawn_player(1.0, 2.0, 1);
        let target = world.spawn_enemy(4.0, 5.0, 1);
        let outcome = DefaultCollisionDamageHitOutcome {
            source_index: source.id as usize,
            source,
            source_removed: false,
            target_index: target.id as usize,
            target,
            damage: 2.5,
            killed: true,
            target_removed: true,
            score_reward: 7,
        };

        assert_eq!(
            target_only_default_collision_damage_hit_presentation_payload(&world, outcome),
            CollisionHitPresentationPayload {
                source,
                target,
                damage: 2.5,
                emit_audio: true,
                particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
            },
        );

        world.transforms[target.id as usize] = None;
        assert_eq!(
            target_only_default_collision_damage_hit_presentation_payload(&world, outcome)
                .particle_position,
            None,
        );
    }

    #[test]
    fn default_collision_game_over_hit_can_queue_source_without_mutating_target() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_player(4.0, 0.0, 1);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        let outcome = apply_default_collision_game_over_hit(
            &world,
            source.id as usize,
            target.id as usize,
            4.0,
            true,
            &mut marked,
            &mut pending,
        )
        .expect("source and target are alive");

        assert_eq!(
            outcome,
            DefaultCollisionGameOverHitOutcome {
                source_index: source.id as usize,
                source,
                source_removed: true,
                target_index: target.id as usize,
                target,
                damage: 4.0,
            },
        );
        assert_eq!(pending, vec![source]);
        assert_eq!(world.health(target), None);

        let repeated = apply_default_collision_game_over_hit(
            &world,
            source.id as usize,
            target.id as usize,
            4.0,
            true,
            &mut marked,
            &mut pending,
        )
        .expect("source and target are alive until deferred despawn flush");
        assert!(!repeated.source_removed);
        assert_eq!(pending, vec![source]);
    }

    #[test]
    fn collision_side_effect_reaction_for_pair_commits_sound_cooldown() {
        let source = Entity {
            id: 1,
            generation: 0,
        };
        let other = Entity {
            id: 2,
            generation: 0,
        };
        let pair = CollisionReactionPair::new(1, 2, source, other);
        let mut reaction = CollisionReaction::PlaySound {
            sound_id: 9,
            volume: 0.6,
            pitch: 1.2,
            cooldown: Cooldown::ready(0.25),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        };

        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: true,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 9,
                    volume: 0.6,
                    pitch: 1.2,
                }),
            }),
        );
        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: true,
                replace_default_particle: false,
                effect: None,
            }),
        );
    }

    #[test]
    fn collision_side_effect_reaction_for_pair_respects_enter_trigger_and_particle_target() {
        let source = Entity {
            id: 1,
            generation: 0,
        };
        let other = Entity {
            id: 4,
            generation: 0,
        };
        let pair = CollisionReactionPair::new(1, 4, source, other);
        let mut reaction = CollisionReaction::SpawnParticle {
            preset_id: 3,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.5),
            replace_default: true,
            trigger: CollisionReactionTrigger::Enter,
        };

        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: true,
                effect: None,
            }),
        );
        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, true),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: true,
                effect: Some(CollisionSideEffect::SpawnParticle {
                    preset_id: 3,
                    target_index: 4,
                }),
            }),
        );
    }

    #[test]
    fn collision_side_effect_reaction_for_pair_commits_camera_shake_only_once_with_cooldown() {
        let source = Entity {
            id: 1,
            generation: 0,
        };
        let other = Entity {
            id: 4,
            generation: 0,
        };
        let pair = CollisionReactionPair::new(1, 4, source, other);
        let mut reaction = CollisionReaction::CameraShake {
            cooldown: Cooldown::ready(0.25),
            trigger: CollisionReactionTrigger::Contact,
        };

        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::CameraShake),
            }),
        );
        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: None,
            }),
        );
    }

    #[test]
    fn collision_side_effect_reaction_for_pair_commits_emit_effect_with_target_actor() {
        let source = Entity {
            id: 1,
            generation: 0,
        };
        let other = Entity {
            id: 4,
            generation: 0,
        };
        let pair = CollisionReactionPair::new(1, 4, source, other);
        let mut reaction = CollisionReaction::EmitEffect {
            effect_id: 99,
            effect_type: 4,
            target: CollisionTarget::OtherEntity,
            intensity: 0.75,
            radius: 32.0,
            cooldown: Cooldown::ready(0.25),
            trigger: CollisionReactionTrigger::Enter,
        };

        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: None,
            }),
        );
        assert_eq!(
            commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, true),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::EmitEffect {
                    effect_id: 99,
                    effect_type: 4,
                    target_index: 4,
                    intensity: 0.75,
                    radius: 32.0,
                }),
            }),
        );
    }

    #[test]
    fn collision_spawn_prefab_reaction_for_pair_respects_enter_trigger_and_anchor_target() {
        let source = Entity {
            id: 1,
            generation: 0,
        };
        let other = Entity {
            id: 4,
            generation: 0,
        };
        let pair = CollisionReactionPair::new(1, 4, source, other);
        let reaction = CollisionReaction::SpawnPrefab {
            action_id: 17,
            prefab_id: 3,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.5),
            trigger: CollisionReactionTrigger::Enter,
            offset_x: 6.0,
            offset_y: -3.0,
        };

        assert_eq!(
            collision_spawn_prefab_reaction_for_pair(pair, reaction, false),
            None,
        );
        assert_eq!(
            collision_spawn_prefab_reaction_for_pair(pair, reaction, true),
            Some(CollisionSpawnPrefabEvaluation {
                reaction_owner_index: 1,
                source,
                action_id: 17,
                prefab_id: 3,
                target: CollisionTarget::OtherEntity,
                anchor_index: 4,
                anchor: other,
                offset_x: 6.0,
                offset_y: -3.0,
            }),
        );
    }

    #[test]
    fn collision_spawn_prefab_cooldown_commits_only_after_successful_runtime_queue() {
        let mut world = World::default();
        let source = world.spawn_player(0.0, 0.0, 1);
        let other = world.spawn_enemy(4.0, 0.0, 1);
        assert!(world.add_collision_reaction(
            source,
            CollisionReaction::SpawnPrefab {
                action_id: 17,
                prefab_id: 1,
                target: CollisionTarget::OtherEntity,
                cooldown: Cooldown::ready(0.5),
                trigger: CollisionReactionTrigger::Contact,
                offset_x: 6.0,
                offset_y: -3.0,
            },
        ));
        let pair = CollisionReactionPair::new(source.id as usize, other.id as usize, source, other);
        let evaluation = collision_spawn_prefab_reaction_for_pair(
            pair,
            world
                .collision_reactions(source)
                .expect("source has reactions")
                .iter()
                .next()
                .expect("spawn reaction exists"),
            false,
        )
        .expect("spawn prefab reaction should be ready");

        assert!(commit_collision_spawn_prefab_reaction_cooldown(
            &mut world, evaluation,
        ));
        let mut reactions = world
            .collision_reactions(source)
            .expect("source reactions are written back");
        let reaction = reactions.iter_mut().next().expect("spawn reaction remains");
        let CollisionReaction::SpawnPrefab { cooldown, .. } = reaction else {
            panic!("expected spawn prefab reaction");
        };
        assert_eq!(
            *cooldown,
            Cooldown {
                duration_seconds: 0.5,
                remaining_seconds: 0.5,
            },
        );
        world.replace_collision_reactions(source, Some(reactions));
        assert!(!commit_collision_spawn_prefab_reaction_cooldown(
            &mut world, evaluation,
        ));
    }

    #[test]
    fn collision_side_effect_payload_maps_sound_without_runtime_sink() {
        let world = World::default();

        assert_eq!(
            collision_side_effect_payload(
                &world,
                CollisionSideEffectEvaluation {
                    replace_default_audio: true,
                    replace_default_particle: false,
                    effect: Some(CollisionSideEffect::PlaySound {
                        sound_id: 9,
                        volume: 0.6,
                        pitch: 1.2,
                    }),
                },
            ),
            Some(CollisionSideEffectPayload::PlaySound {
                sound_id: 9,
                volume: 0.6,
                pitch: 1.2,
            }),
        );
    }

    #[test]
    fn collision_side_effect_payload_resolves_particle_target_transform() {
        let mut world = World::default();
        let target = world.spawn_player(12.0, -3.0, 1);

        assert_eq!(
            collision_side_effect_payload(
                &world,
                CollisionSideEffectEvaluation {
                    replace_default_audio: false,
                    replace_default_particle: true,
                    effect: Some(CollisionSideEffect::SpawnParticle {
                        preset_id: 3,
                        target_index: target.id as usize,
                    }),
                },
            ),
            Some(CollisionSideEffectPayload::SpawnParticleAt {
                preset_id: 3,
                position: Transform2D { x: 12.0, y: -3.0 },
            }),
        );

        world.transforms[target.id as usize] = None;

        assert_eq!(
            collision_side_effect_payload(
                &world,
                CollisionSideEffectEvaluation {
                    replace_default_audio: false,
                    replace_default_particle: true,
                    effect: Some(CollisionSideEffect::SpawnParticle {
                        preset_id: 3,
                        target_index: target.id as usize,
                    }),
                },
            ),
            None,
        );
    }

    #[test]
    fn collision_side_effect_payload_maps_camera_shake() {
        assert_eq!(
            collision_side_effect_payload(
                &World::default(),
                CollisionSideEffectEvaluation {
                    replace_default_audio: false,
                    replace_default_particle: false,
                    effect: Some(CollisionSideEffect::CameraShake),
                },
            ),
            Some(CollisionSideEffectPayload::CameraShake),
        );
    }

    #[test]
    fn collision_side_effect_payload_maps_emit_effect_actor() {
        let mut world = World::default();
        let target = world.spawn_enemy(12.0, -3.0, 1);

        assert_eq!(
            collision_side_effect_payload(
                &world,
                CollisionSideEffectEvaluation {
                    replace_default_audio: false,
                    replace_default_particle: false,
                    effect: Some(CollisionSideEffect::EmitEffect {
                        effect_id: 99,
                        effect_type: 4,
                        target_index: target.id as usize,
                        intensity: 0.5,
                        radius: 24.0,
                    }),
                },
            ),
            Some(CollisionSideEffectPayload::PresentationEffect {
                actor: target,
                effect_id: 99,
                effect_type: 4,
                intensity: 0.5,
                radius: 24.0,
            }),
        );

        world.despawn(target);
        assert_eq!(
            collision_side_effect_payload(
                &world,
                CollisionSideEffectEvaluation {
                    replace_default_audio: false,
                    replace_default_particle: false,
                    effect: Some(CollisionSideEffect::EmitEffect {
                        effect_id: 99,
                        effect_type: 4,
                        target_index: target.id as usize,
                        intensity: 1.0,
                        radius: 0.0,
                    }),
                },
            ),
            None,
        );
    }

    #[test]
    fn tile_collision_side_effect_reaction_is_self_only_and_ignores_replace_policy() {
        let mut sound = CollisionReaction::PlaySound {
            sound_id: 7,
            volume: 0.5,
            pitch: 1.1,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Enter,
        };
        assert_eq!(
            commit_tile_collision_side_effect_reaction(3, &mut sound),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 7,
                    volume: 0.5,
                    pitch: 1.1,
                }),
            }),
        );

        let mut particle = CollisionReaction::SpawnParticle {
            preset_id: 4,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.5),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        };
        assert_eq!(
            commit_tile_collision_side_effect_reaction(3, &mut particle),
            None,
        );
        assert_eq!(
            particle,
            CollisionReaction::SpawnParticle {
                preset_id: 4,
                target: CollisionTarget::OtherEntity,
                cooldown: Cooldown::ready(0.5),
                replace_default: true,
                trigger: CollisionReactionTrigger::Contact,
            },
        );

        let mut emit = CollisionReaction::EmitEffect {
            effect_id: 77,
            effect_type: 4,
            target: CollisionTarget::SelfEntity,
            intensity: 0.25,
            radius: 18.0,
            cooldown: Cooldown::ready(0.0),
            trigger: CollisionReactionTrigger::Contact,
        };
        assert_eq!(
            commit_tile_collision_side_effect_reaction(3, &mut emit),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::EmitEffect {
                    effect_id: 77,
                    effect_type: 4,
                    target_index: 3,
                    intensity: 0.25,
                    radius: 18.0,
                }),
            }),
        );

        let mut other_emit = CollisionReaction::EmitEffect {
            effect_id: 78,
            effect_type: 4,
            target: CollisionTarget::OtherEntity,
            intensity: 1.0,
            radius: 0.0,
            cooldown: Cooldown::ready(0.0),
            trigger: CollisionReactionTrigger::Contact,
        };
        assert_eq!(
            commit_tile_collision_side_effect_reaction(3, &mut other_emit),
            None,
        );
    }

    #[test]
    fn tile_collision_side_effect_reaction_ignores_non_self_particle_and_queues_camera_shake() {
        let mut shake = CollisionReaction::CameraShake {
            cooldown: Cooldown::ready(0.5),
            trigger: CollisionReactionTrigger::Contact,
        };
        assert_eq!(
            commit_tile_collision_side_effect_reaction(3, &mut shake),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::CameraShake),
            }),
        );

        let mut shake_enter = CollisionReaction::CameraShake {
            cooldown: Cooldown::ready(0.5),
            trigger: CollisionReactionTrigger::Enter,
        };
        assert_eq!(
            commit_tile_collision_side_effect_reaction(3, &mut shake_enter),
            Some(CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::CameraShake),
            }),
        );
    }

    #[test]
    fn tile_collision_reaction_set_queues_self_despawn_and_side_effects() {
        let mut world = World::default();
        let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let bullet_index = bullet.id as usize;
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::PlaySound {
            sound_id: 7,
            volume: 0.5,
            pitch: 1.1,
            cooldown: Cooldown::ready(0.0),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        }));
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        }));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_hits = Vec::new();

        let outcome = apply_tile_collision_reaction_set(
            &mut world,
            bullet_index,
            Transform2D { x: 0.0, y: 0.0 },
            &mut reactions,
            &mut area_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: true,
            },
        );

        assert!(outcome.queued_self_despawn);
        assert_eq!(
            outcome.despawn_outcome,
            Some(CollisionDespawnReactionOutcome {
                target_index: bullet_index,
                target: bullet,
            }),
        );
        assert_eq!(pending, vec![bullet]);
        assert_eq!(
            outcome.side_effects().collect::<Vec<_>>(),
            vec![CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 7,
                    volume: 0.5,
                    pitch: 1.1,
                }),
            }],
        );
    }

    #[test]
    fn tile_collision_reaction_set_ignores_entity_only_targets_without_cooldown_commit() {
        let mut world = World::default();
        let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::SpawnParticle {
            preset_id: 4,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.5),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        }));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_hits = Vec::new();

        let outcome = apply_tile_collision_reaction_set(
            &mut world,
            bullet.id as usize,
            Transform2D { x: 0.0, y: 0.0 },
            &mut reactions,
            &mut area_hits,
            &mut marked,
            &mut pending,
            |_, _| CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: true,
            },
        );

        assert!(!outcome.queued_self_despawn);
        assert_eq!(outcome.despawn_outcome, None);
        assert!(outcome.side_effects().collect::<Vec<_>>().is_empty());
        assert!(pending.is_empty());
        assert_eq!(
            reactions.iter().collect::<Vec<_>>(),
            vec![
                CollisionReaction::Despawn {
                    target: CollisionTarget::OtherEntity,
                },
                CollisionReaction::SpawnParticle {
                    preset_id: 4,
                    target: CollisionTarget::OtherEntity,
                    cooldown: Cooldown::ready(0.5),
                    replace_default: true,
                    trigger: CollisionReactionTrigger::Contact,
                },
            ],
        );
    }

    #[test]
    fn tile_collision_area_damage_reaction_uses_impact_center() {
        let mut world = World::default();
        let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let direct = world.spawn_enemy(10.0, 0.0, 1);
        let splash = world.spawn_enemy(15.0, 0.0, 1);
        let far = world.spawn_enemy(40.0, 0.0, 1);
        world.set_damage(bullet, 2.0);
        world.set_health(direct, 2.0);
        world.set_health(splash, 3.0);
        world.set_health(far, 2.0);
        world.set_score_reward(direct, 7);
        world.set_score_reward(splash, 11);
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::AreaDamage {
            radius: 12.0,
            target_layer: CollisionLayer::Enemy,
        }));
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();
        let mut area_hits = Vec::new();

        let outcome = apply_tile_collision_reaction_set(
            &mut world,
            bullet.id as usize,
            Transform2D { x: 5.0, y: 0.0 },
            &mut reactions,
            &mut area_hits,
            &mut marked,
            &mut pending,
            |world, target_index| CollisionDamageReactionDefaults {
                health: world.health_at_index(target_index).unwrap_or(1.0),
                score_reward: world.score_reward_at_index(target_index).unwrap_or(0),
                despawn_on_kill: true,
            },
        );

        assert_eq!(
            outcome
                .reaction_outcome()
                .damage_outcomes()
                .map(|outcome| (outcome.target, outcome.damage, outcome.killed))
                .collect::<Vec<_>>(),
            vec![(direct, 2.0, true), (splash, 2.0, false)],
        );
        assert!(marked[direct.id as usize]);
        assert_eq!(pending, vec![direct]);
        assert_eq!(world.health(splash), Some(1.0));
        assert_eq!(world.health(far), Some(2.0));
    }

    #[test]
    fn collision_damage_reaction_for_pair_damages_and_queues_kill() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_enemy(0.0, 0.0, 1);
        world.set_damage(source, 2.0);
        world.set_health(target, 2.0);
        world.set_score_reward(target, 7);
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        assert_eq!(
            apply_collision_damage_reaction_for_pair(
                &mut world,
                pair,
                CollisionTarget::OtherEntity,
                CollisionDamageReactionDefaults {
                    health: 5.0,
                    score_reward: 7,
                    despawn_on_kill: true,
                },
                &mut marked,
                &mut pending,
            ),
            Some(CollisionDamageReactionOutcome {
                target_index: target.id as usize,
                target,
                damage: 2.0,
                killed: true,
                target_removed: true,
                score_reward: 7,
            }),
        );
        assert_eq!(world.health(target), Some(0.0));
        assert_eq!(pending, vec![target]);
    }

    #[test]
    fn collision_damage_reaction_for_pair_can_leave_killed_target_in_place() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();
        world.set_damage(source, 1.0);
        world.set_health(target, 1.0);
        let pair =
            CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        let outcome = apply_collision_damage_reaction_for_pair(
            &mut world,
            pair,
            CollisionTarget::OtherEntity,
            CollisionDamageReactionDefaults {
                health: 1.0,
                score_reward: 0,
                despawn_on_kill: false,
            },
            &mut marked,
            &mut pending,
        )
        .unwrap();

        assert!(outcome.killed);
        assert!(!outcome.target_removed);
        assert!(pending.is_empty());
    }

    #[test]
    fn evaluate_movement_pattern_resolves_common_velocity_patterns() {
        let world = World::default();
        let transform = Transform2D { x: 0.0, y: 0.0 };

        assert_eq!(
            evaluate_movement_pattern(&world, None, transform, None, MovementPattern::Static),
            Some(MovementPatternEvaluation::Velocity(Velocity::default())),
        );
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::Linear { vx: 3.0, vy: -4.0 },
            ),
            Some(MovementPatternEvaluation::Velocity(Velocity {
                vx: 3.0,
                vy: -4.0
            })),
        );
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::Oscillate {
                    origin_x: 0.0,
                    origin_y: 0.0,
                    amplitude_x: 10.0,
                    amplitude_y: 0.0,
                    phase_speed: 1.0,
                },
            ),
            None,
        );
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::PlatformerInput {
                    horizontal_speed: 210.0,
                    gravity: 900.0,
                    jump_speed: 420.0,
                    max_fall_speed: 760.0,
                    ground_probe_distance: 2.0,
                    step_offset: 12.0,
                    coyote_time_seconds: 0.08,
                    jump_buffer_seconds: 0.10,
                },
            ),
            None,
        );
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::MoveToPoint {
                    x: 0.0,
                    y: 10.0,
                    speed: 5.0,
                },
            ),
            Some(MovementPatternEvaluation::Velocity(Velocity {
                vx: 0.0,
                vy: 5.0
            })),
        );
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::TopdownInput { speed: 5.0 },
            ),
            None,
        );
    }

    #[test]
    fn default_movement_pattern_builds_common_enemy_fallback_patterns() {
        let base = DefaultMovementPatternConfig {
            kind: DefaultMovementPatternKind::ChasePlayer,
            speed: 7.0,
            world_width: 200.0,
            world_height: 120.0,
            orbit_radius: 32.0,
            orbit_radial_band: 6.0,
        };

        assert_eq!(
            default_movement_pattern(base),
            MovementPattern::Chase {
                target: MovementTarget::Player,
                speed: 7.0,
            },
        );
        assert_eq!(
            default_movement_pattern(DefaultMovementPatternConfig {
                kind: DefaultMovementPatternKind::MoveToWorldCenter,
                ..base
            }),
            MovementPattern::MoveToPoint {
                x: 100.0,
                y: 60.0,
                speed: 7.0,
            },
        );
        assert_eq!(
            default_movement_pattern(DefaultMovementPatternConfig {
                kind: DefaultMovementPatternKind::Static,
                ..base
            }),
            MovementPattern::Static,
        );
        assert_eq!(
            default_movement_pattern(DefaultMovementPatternConfig {
                kind: DefaultMovementPatternKind::OrbitPlayer,
                ..base
            }),
            MovementPattern::Orbit {
                target: MovementTarget::Player,
                speed: 7.0,
                radius: 32.0,
                radial_band: 6.0,
            },
        );
    }

    #[test]
    fn layer_movement_phase_config_with_default_fallback_builds_common_contract() {
        let navigation_policy = MovementNavigationPolicy {
            repath_interval_seconds: 0.5,
            reached_distance_squared: 4.0,
        };
        let player_transform = Some(Transform2D { x: 12.0, y: 34.0 });

        assert_eq!(
            layer_movement_pattern_phase_config_with_default_fallback(
                LayerMovementPatternDefaultFallbackConfig {
                    layer: CollisionLayer::Enemy,
                    player_transform,
                    navigation_policy,
                    fallback: DefaultMovementPatternConfig {
                        kind: DefaultMovementPatternKind::OrbitPlayer,
                        speed: 7.0,
                        world_width: 200.0,
                        world_height: 120.0,
                        orbit_radius: 32.0,
                        orbit_radial_band: 6.0,
                    },
                },
            ),
            LayerMovementPatternPhaseConfig {
                layer: CollisionLayer::Enemy,
                player_transform,
                navigation_policy,
                fallback_pattern: MovementPattern::Orbit {
                    target: MovementTarget::Player,
                    speed: 7.0,
                    radius: 32.0,
                    radial_band: 6.0,
                },
            },
        );
    }

    #[test]
    fn evaluate_movement_pattern_resolves_targets_without_scene_navigation() {
        use crate::components::gameplay::{GameplayFaction, GameplayTags, GAMEPLAY_FACTION_ENEMY};

        let mut world = World::default();
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 24.0, y: 8.0 });
        let transform = Transform2D { x: 4.0, y: 8.0 };

        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::Entity(target),
                    speed: 7.0,
                },
            ),
            Some(MovementPatternEvaluation::Chase {
                target: MovementTarget::Entity(target),
                target_transform: Transform2D { x: 24.0, y: 8.0 },
                speed: 7.0,
            }),
        );

        assert_eq!(
            evaluate_movement_pattern(
                &world,
                Some(Transform2D { x: 30.0, y: 8.0 }),
                transform,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::NearestPlayer,
                    speed: 9.0,
                },
            ),
            Some(MovementPatternEvaluation::Chase {
                target: MovementTarget::NearestPlayer,
                target_transform: Transform2D { x: 30.0, y: 8.0 },
                speed: 9.0,
            }),
        );

        let _source_enemy = world.spawn_enemy(4.0, 8.0, 0);
        let _far_enemy = world.spawn_enemy(40.0, 8.0, 0);
        let _near_enemy = world.spawn_enemy(8.0, 8.0, 0);
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                Some(Velocity { vx: 1.0, vy: 0.0 }),
                MovementPattern::SeekTarget {
                    target: MovementTarget::NearestEnemy,
                    speed: 12.0,
                    turn_rate: 0.5,
                },
            ),
            Some(MovementPatternEvaluation::SeekTarget {
                target_transform: Transform2D { x: 8.0, y: 8.0 },
                current_velocity: Velocity { vx: 1.0, vy: 0.0 },
                speed: 12.0,
                turn_rate: 0.5,
            }),
        );

        let _near_bullet = world.spawn_bullet(6.0, 8.0, 0.0, 0.0, 0);
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::NearestLayer(CollisionLayer::Bullet),
                    speed: 10.0,
                },
            ),
            Some(MovementPatternEvaluation::Chase {
                target: MovementTarget::NearestLayer(CollisionLayer::Bullet),
                target_transform: Transform2D { x: 6.0, y: 8.0 },
                speed: 10.0,
            }),
        );

        let far_faction = world.spawn_entity();
        world.set_transform(far_faction, Transform2D { x: 32.0, y: 8.0 });
        world.set_gameplay_faction(
            far_faction,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
        );
        let near_faction = world.spawn_entity();
        world.set_transform(near_faction, Transform2D { x: 7.0, y: 8.0 });
        world.set_gameplay_faction(
            near_faction,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
        );
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::NearestFaction(GAMEPLAY_FACTION_ENEMY),
                    speed: 11.0,
                },
            ),
            Some(MovementPatternEvaluation::Chase {
                target: MovementTarget::NearestFaction(GAMEPLAY_FACTION_ENEMY),
                target_transform: Transform2D { x: 7.0, y: 8.0 },
                speed: 11.0,
            }),
        );

        let near_untagged = world.spawn_entity();
        world.set_transform(near_untagged, Transform2D { x: 5.0, y: 8.0 });
        let far_tagged = world.spawn_entity();
        world.set_transform(far_tagged, Transform2D { x: 34.0, y: 8.0 });
        world.set_gameplay_tags(far_tagged, GameplayTags::new(1 << 5).unwrap());
        let near_tagged = world.spawn_entity();
        world.set_transform(near_tagged, Transform2D { x: 9.0, y: 8.0 });
        world.set_gameplay_tags(near_tagged, GameplayTags::new(1 << 5).unwrap());
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::NearestTag(5),
                    speed: 13.0,
                },
            ),
            Some(MovementPatternEvaluation::Chase {
                target: MovementTarget::NearestTag(5),
                target_transform: Transform2D { x: 9.0, y: 8.0 },
                speed: 13.0,
            }),
        );

        world.despawn(target);
        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::Entity(target),
                    speed: 7.0,
                },
            ),
            Some(MovementPatternEvaluation::Velocity(Velocity::default())),
        );
    }

    #[test]
    fn evaluate_movement_pattern_handles_seek_target_and_accelerate_variants() {
        let mut world = World::default();
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
        let transform = Transform2D { x: 0.0, y: 0.0 };

        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                Some(Velocity { vx: 4.0, vy: 0.0 }),
                MovementPattern::SeekTarget {
                    target: MovementTarget::Entity(target),
                    speed: 10.0,
                    turn_rate: 2.0,
                },
            ),
            Some(MovementPatternEvaluation::SeekTarget {
                target_transform: Transform2D { x: 10.0, y: 0.0 },
                current_velocity: Velocity { vx: 4.0, vy: 0.0 },
                speed: 10.0,
                turn_rate: 1.0,
            }),
        );

        assert_eq!(
            evaluate_movement_pattern(
                &world,
                None,
                transform,
                Some(Velocity { vx: 1.0, vy: 1.0 }),
                MovementPattern::Accelerate {
                    acceleration_x: 2.0,
                    acceleration_y: 2.0,
                    max_speed: 10.0,
                },
            ),
            Some(MovementPatternEvaluation::Accelerate {
                current_velocity: Velocity { vx: 1.0, vy: 1.0 },
                acceleration_x: 2.0,
                acceleration_y: 2.0,
                max_speed: 10.0,
            }),
        );
    }

    #[test]
    fn movement_navigation_target_cache_reuses_until_repath_interval() {
        let mut caches = Vec::new();
        let source = MovementNavigationSource {
            index: 2,
            generation: 7,
            transform: Transform2D { x: 0.0, y: 0.0 },
        };
        let target = Transform2D { x: 20.0, y: 0.0 };
        let waypoint = Transform2D { x: 0.0, y: 10.0 };
        let mut resolve_count = 0;

        assert_eq!(
            resolve_movement_navigation_target(
                &mut caches,
                source,
                MovementNavigationTargetIdentity::Player,
                target,
                0.25,
                4.0,
                |_, _| {
                    resolve_count += 1;
                    Some(waypoint)
                },
            ),
            waypoint,
        );
        tick_movement_navigation_targets(&mut caches, 0.1);
        assert_eq!(
            resolve_movement_navigation_target(
                &mut caches,
                source,
                MovementNavigationTargetIdentity::Player,
                target,
                0.25,
                4.0,
                |_, _| {
                    resolve_count += 1;
                    None
                },
            ),
            waypoint,
        );
        assert_eq!(resolve_count, 1);

        tick_movement_navigation_targets(&mut caches, 0.25);
        assert_eq!(
            resolve_movement_navigation_target(
                &mut caches,
                source,
                MovementNavigationTargetIdentity::Player,
                target,
                0.25,
                4.0,
                |_, _| {
                    resolve_count += 1;
                    None
                },
            ),
            target,
        );
        assert_eq!(resolve_count, 2);
    }

    #[test]
    fn movement_navigation_target_cache_separates_identity_generation_and_reached_target() {
        let source = MovementNavigationSource {
            index: 1,
            generation: 3,
            transform: Transform2D { x: 0.0, y: 0.0 },
        };
        let target = Transform2D { x: 20.0, y: 0.0 };
        let waypoint = Transform2D { x: 0.0, y: 10.0 };
        let mut caches = vec![None; 2];
        caches[1] = Some(MovementNavigationTargetCache {
            generation: 3,
            target_identity: MovementNavigationTargetIdentity::Player,
            target: waypoint,
            remaining_seconds: 0.25,
        });

        assert_eq!(
            resolve_movement_navigation_target(
                &mut caches,
                source,
                MovementNavigationTargetIdentity::Entity(Entity {
                    id: 9,
                    generation: 1,
                }),
                target,
                0.25,
                4.0,
                |_, _| None,
            ),
            target,
        );

        caches[1] = Some(MovementNavigationTargetCache {
            generation: 99,
            target_identity: MovementNavigationTargetIdentity::Player,
            target: waypoint,
            remaining_seconds: 0.25,
        });
        assert_eq!(
            resolve_movement_navigation_target(
                &mut caches,
                source,
                MovementNavigationTargetIdentity::Player,
                target,
                0.25,
                4.0,
                |_, _| None,
            ),
            target,
        );

        caches[1] = Some(MovementNavigationTargetCache {
            generation: 3,
            target_identity: MovementNavigationTargetIdentity::Player,
            target: Transform2D { x: 1.0, y: 1.0 },
            remaining_seconds: 0.25,
        });
        assert_eq!(
            resolve_movement_navigation_target(
                &mut caches,
                source,
                MovementNavigationTargetIdentity::Player,
                target,
                0.25,
                4.0,
                |_, _| None,
            ),
            target,
        );
    }

    #[test]
    fn apply_scene_neutral_movement_pattern_writes_velocity_or_defers_chase() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 4.0, y: 0.0 });

        assert_eq!(
            apply_scene_neutral_movement_pattern(
                &mut world,
                actor.id as usize,
                None,
                MovementPattern::MoveToPoint {
                    x: 0.0,
                    y: 10.0,
                    speed: 5.0,
                },
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[actor.id as usize],
            Some(Velocity { vx: 0.0, vy: 5.0 }),
        );

        assert_eq!(
            apply_scene_neutral_movement_pattern(
                &mut world,
                actor.id as usize,
                None,
                MovementPattern::SeekTarget {
                    target: MovementTarget::Entity(target),
                    speed: 10.0,
                    turn_rate: 0.25,
                },
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[actor.id as usize],
            Some(Velocity { vx: 2.5, vy: 3.75 }),
        );

        assert_eq!(
            apply_scene_neutral_movement_pattern(
                &mut world,
                actor.id as usize,
                None,
                MovementPattern::Accelerate {
                    acceleration_x: 1.0,
                    acceleration_y: 0.0,
                    max_speed: 10.0,
                },
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[actor.id as usize],
            Some(Velocity { vx: 3.5, vy: 3.75 }),
        );

        world.velocities[actor.id as usize] = Some(Velocity::default());
        assert_eq!(
            apply_scene_neutral_movement_pattern(
                &mut world,
                actor.id as usize,
                None,
                MovementPattern::Accelerate {
                    acceleration_x: 10.0,
                    acceleration_y: 0.0,
                    max_speed: 5.0,
                },
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[actor.id as usize],
            Some(Velocity { vx: 5.0, vy: 0.0 }),
        );

        world.velocities[actor.id as usize] = Some(Velocity::default());
        assert_eq!(
            apply_scene_neutral_movement_pattern(
                &mut world,
                actor.id as usize,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::Entity(target),
                    speed: 8.0,
                },
            ),
            MovementPatternApplication::DeferredChase {
                target: MovementTarget::Entity(target),
                target_transform: Transform2D { x: 4.0, y: 0.0 },
                speed: 8.0,
            },
        );

        assert_eq!(
            apply_scene_neutral_movement_pattern(
                &mut world,
                actor.id as usize,
                None,
                MovementPattern::TopdownInput { speed: 8.0 },
            ),
            MovementPatternApplication::Unsupported,
        );
    }

    #[test]
    fn apply_movement_pattern_with_navigation_resolves_chase_and_writes_velocity() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
        let mut caches = Vec::new();
        let mut resolve_waypoint =
            |_: Transform2D, _: Transform2D| Some(Transform2D { x: 0.0, y: 10.0 });

        assert_eq!(
            apply_movement_pattern_with_navigation(
                &mut world,
                actor.id as usize,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::Entity(target),
                    speed: 5.0,
                },
                &mut caches,
                MovementNavigationPolicy {
                    repath_interval_seconds: 0.25,
                    reached_distance_squared: 0.01,
                },
                &mut resolve_waypoint,
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[actor.id as usize],
            Some(Velocity { vx: 0.0, vy: 5.0 }),
        );
        assert_eq!(
            caches[actor.id as usize],
            Some(MovementNavigationTargetCache {
                generation: actor.generation,
                target_identity: MovementNavigationTargetIdentity::Entity(target),
                target: Transform2D { x: 0.0, y: 10.0 },
                remaining_seconds: 0.25,
            }),
        );

        let unsupported = apply_movement_pattern_with_navigation(
            &mut world,
            actor.id as usize,
            None,
            MovementPattern::TopdownInput { speed: 5.0 },
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            &mut |_, _| None,
        );
        assert_eq!(unsupported, MovementPatternApplication::Unsupported);
    }

    #[test]
    fn run_movement_pattern_with_navigation_system_checks_entity_generation() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
        let mut caches = Vec::new();
        let policy = MovementNavigationPolicy {
            repath_interval_seconds: 0.25,
            reached_distance_squared: 0.01,
        };
        let pattern = MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 5.0,
        };
        world.set_movement_pattern(actor, pattern);

        assert_eq!(
            run_movement_pattern_with_navigation_system(
                &mut world,
                actor,
                None,
                &mut caches,
                policy,
                |_, _| Some(Transform2D { x: 0.0, y: 10.0 }),
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[actor.id as usize],
            Some(Velocity { vx: 0.0, vy: 5.0 }),
        );

        let stale_actor = Entity {
            generation: actor.generation + 1,
            ..actor
        };
        let cache_len = caches.len();
        let mut resolver_calls = 0;
        world.velocities[actor.id as usize] = Some(Velocity { vx: 3.0, vy: 4.0 });
        assert_eq!(
            run_movement_pattern_with_navigation_system(
                &mut world,
                stale_actor,
                None,
                &mut caches,
                policy,
                |_, _| {
                    resolver_calls += 1;
                    Some(Transform2D { x: 5.0, y: 0.0 })
                },
            ),
            MovementPatternApplication::Unsupported,
        );
        assert_eq!(
            world.velocities[actor.id as usize],
            Some(Velocity { vx: 3.0, vy: 4.0 }),
        );
        assert_eq!(resolver_calls, 0);
        assert_eq!(caches.len(), cache_len);

        world.despawn(actor);
        assert!(!world.is_alive_index(actor.id as usize));
        resolver_calls = 0;
        assert_eq!(
            run_movement_pattern_with_navigation_system(
                &mut world,
                actor,
                None,
                &mut caches,
                policy,
                |_, _| {
                    resolver_calls += 1;
                    Some(Transform2D { x: 5.0, y: 0.0 })
                },
            ),
            MovementPatternApplication::Unsupported,
        );
        assert_eq!(resolver_calls, 0);
        assert_eq!(caches.len(), cache_len);
    }

    #[test]
    fn run_movement_pattern_with_navigation_system_ignores_entities_without_pattern() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
        let mut caches = Vec::new();
        let mut resolver_calls = 0;
        world.set_velocity(actor, Velocity { vx: 3.0, vy: 4.0 });

        assert_eq!(
            run_movement_pattern_with_navigation_system(
                &mut world,
                actor,
                None,
                &mut caches,
                MovementNavigationPolicy {
                    repath_interval_seconds: 0.25,
                    reached_distance_squared: 0.01,
                },
                |_, _| {
                    resolver_calls += 1;
                    Some(Transform2D { x: 5.0, y: 0.0 })
                },
            ),
            MovementPatternApplication::Unsupported,
        );
        assert_eq!(world.velocity(actor), Some(Velocity { vx: 3.0, vy: 4.0 }));
        assert_eq!(resolver_calls, 0);
        assert!(caches.is_empty());
    }

    #[test]
    fn movement_pattern_with_navigation_fallback_uses_fallback_when_pattern_missing_or_unsupported()
    {
        let mut world = World::default();
        let missing = world.spawn_entity();
        world.set_transform(missing, Transform2D { x: 0.0, y: 0.0 });
        let unsupported = world.spawn_entity();
        world.set_transform(unsupported, Transform2D { x: 0.0, y: 0.0 });
        world.set_movement_pattern(unsupported, MovementPattern::TopdownInput { speed: 999.0 });
        let mut caches = Vec::new();
        let policy = MovementNavigationPolicy {
            repath_interval_seconds: 0.25,
            reached_distance_squared: 0.01,
        };

        assert_eq!(
            run_movement_pattern_with_navigation_or_fallback_system(
                &mut world,
                missing,
                None,
                MovementPattern::Linear { vx: 3.0, vy: 4.0 },
                &mut caches,
                policy,
                |_, _| None,
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(world.velocity(missing), Some(Velocity { vx: 3.0, vy: 4.0 }));

        assert_eq!(
            run_movement_pattern_with_navigation_or_fallback_system(
                &mut world,
                unsupported,
                None,
                MovementPattern::Linear { vx: 5.0, vy: 6.0 },
                &mut caches,
                policy,
                |_, _| None,
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocity(unsupported),
            Some(Velocity { vx: 5.0, vy: 6.0 }),
        );
    }

    #[test]
    fn movement_pattern_with_navigation_fallback_prefers_authored_pattern() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
        world.set_movement_pattern(actor, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
        let mut caches = Vec::new();

        assert_eq!(
            run_movement_pattern_with_navigation_or_fallback_system(
                &mut world,
                actor,
                None,
                MovementPattern::Linear { vx: 5.0, vy: 6.0 },
                &mut caches,
                MovementNavigationPolicy {
                    repath_interval_seconds: 0.25,
                    reached_distance_squared: 0.01,
                },
                |_, _| None,
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(world.velocity(actor), Some(Velocity { vx: 1.0, vy: 2.0 }));
    }

    #[test]
    fn movement_pattern_with_navigation_fallback_reuses_navigation_resolver() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
        world.set_movement_pattern(actor, MovementPattern::TopdownInput { speed: 999.0 });
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 10.0, y: 0.0 });
        let mut caches = Vec::new();
        let mut resolver_calls = 0;

        assert_eq!(
            run_movement_pattern_with_navigation_or_fallback_system(
                &mut world,
                actor,
                None,
                MovementPattern::Chase {
                    target: MovementTarget::Entity(target),
                    speed: 5.0,
                },
                &mut caches,
                MovementNavigationPolicy {
                    repath_interval_seconds: 0.25,
                    reached_distance_squared: 0.01,
                },
                |_, _| {
                    resolver_calls += 1;
                    Some(Transform2D { x: 0.0, y: 10.0 })
                },
            ),
            MovementPatternApplication::Applied,
        );
        assert_eq!(resolver_calls, 1);
        assert_eq!(world.velocity(actor), Some(Velocity { vx: 0.0, vy: 5.0 }));
    }

    #[test]
    fn movement_pattern_with_navigation_fallback_rejects_stale_or_despawned_entities() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        world.set_transform(actor, Transform2D { x: 0.0, y: 0.0 });
        world.set_velocity(actor, Velocity { vx: 3.0, vy: 4.0 });
        let mut caches = Vec::new();
        let policy = MovementNavigationPolicy {
            repath_interval_seconds: 0.25,
            reached_distance_squared: 0.01,
        };
        let fallback = MovementPattern::Linear { vx: 5.0, vy: 6.0 };
        let stale_actor = Entity {
            generation: actor.generation + 1,
            ..actor
        };
        let mut resolver_calls = 0;

        assert_eq!(
            run_movement_pattern_with_navigation_or_fallback_system(
                &mut world,
                stale_actor,
                None,
                fallback,
                &mut caches,
                policy,
                |_, _| {
                    resolver_calls += 1;
                    None
                },
            ),
            MovementPatternApplication::Unsupported,
        );
        assert_eq!(world.velocity(actor), Some(Velocity { vx: 3.0, vy: 4.0 }));
        assert_eq!(resolver_calls, 0);
        assert!(caches.is_empty());

        world.despawn(actor);
        assert_eq!(
            run_movement_pattern_with_navigation_or_fallback_system(
                &mut world,
                actor,
                None,
                fallback,
                &mut caches,
                policy,
                |_, _| {
                    resolver_calls += 1;
                    None
                },
            ),
            MovementPatternApplication::Unsupported,
        );
        assert_eq!(resolver_calls, 0);
        assert!(caches.is_empty());
    }

    #[test]
    fn movement_pattern_with_navigation_batch_filters_and_reports_stats() {
        let mut world = World::default();
        let fallback = world.spawn_entity();
        world.set_transform(fallback, Transform2D { x: 0.0, y: 0.0 });
        let authored = world.spawn_entity();
        world.set_transform(authored, Transform2D { x: 0.0, y: 0.0 });
        world.set_movement_pattern(authored, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
        let no_transform = world.spawn_entity();
        let excluded = world.spawn_entity();
        world.set_transform(excluded, Transform2D { x: 0.0, y: 0.0 });
        let mut caches = Vec::new();
        let mut unsupported = Vec::new();
        let mut fallback_calls = 0;

        let stats = run_movement_pattern_with_navigation_batch_system(
            &mut world,
            None,
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            |_, entity_index| entity_index != excluded.id as usize,
            |_, _| {
                fallback_calls += 1;
                MovementPattern::Linear { vx: 5.0, vy: 6.0 }
            },
            |world, entity_index| {
                unsupported.push(entity_index);
                world.velocities[entity_index] = Some(Velocity::default());
            },
            |_, _| None,
        );

        assert_eq!(
            stats,
            MovementPatternBatchRunStats {
                candidates: 3,
                applied: 2,
                unsupported: 1,
            },
        );
        assert_eq!(
            world.velocity(fallback),
            Some(Velocity { vx: 5.0, vy: 6.0 })
        );
        assert_eq!(
            world.velocity(authored),
            Some(Velocity { vx: 1.0, vy: 2.0 })
        );
        assert_eq!(world.velocity(no_transform), Some(Velocity::default()));
        assert_eq!(world.velocity(excluded), None);
        assert_eq!(fallback_calls, 2);
        assert_eq!(unsupported, vec![no_transform.id as usize]);
        assert!(caches.is_empty());
    }

    #[test]
    fn layer_movement_pattern_with_navigation_batch_filters_layer_and_transform() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(0.0, 0.0, 1);
        let authored = world.spawn_enemy(0.0, 0.0, 1);
        world.set_movement_pattern(authored, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
        let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let no_transform = world.spawn_enemy(0.0, 0.0, 1);
        world.transforms[no_transform.id as usize] = None;
        world.set_velocity(no_transform, Velocity { vx: 7.0, vy: 8.0 });
        let mut caches = Vec::new();
        let mut fallback_calls = 0;

        let stats = run_layer_movement_pattern_with_navigation_batch_system(
            &mut world,
            CollisionLayer::Enemy,
            None,
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            |_, _| {
                fallback_calls += 1;
                MovementPattern::Linear { vx: 5.0, vy: 6.0 }
            },
            |_, _| None,
        );

        assert_eq!(
            stats,
            MovementPatternBatchRunStats {
                candidates: 2,
                applied: 2,
                unsupported: 0,
            },
        );
        assert_eq!(world.velocity(enemy), Some(Velocity { vx: 5.0, vy: 6.0 }));
        assert_eq!(
            world.velocity(authored),
            Some(Velocity { vx: 1.0, vy: 2.0 })
        );
        assert_eq!(world.velocity(bullet), Some(Velocity::default()));
        assert_eq!(
            world.velocity(no_transform),
            Some(Velocity { vx: 7.0, vy: 8.0 }),
        );
        assert_eq!(fallback_calls, 1);
        assert!(caches.is_empty());
    }

    #[test]
    fn layer_movement_pattern_with_navigation_batch_zeros_unsupported_velocity() {
        let mut world = World::default();
        let unsupported = world.spawn_enemy(0.0, 0.0, 1);
        world.set_velocity(unsupported, Velocity { vx: 7.0, vy: 8.0 });
        let mut caches = Vec::new();

        let stats = run_layer_movement_pattern_with_navigation_batch_system(
            &mut world,
            CollisionLayer::Enemy,
            None,
            &mut caches,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.25,
                reached_distance_squared: 0.01,
            },
            |_, _| MovementPattern::TopdownInput { speed: 100.0 },
            |_, _| None,
        );

        assert_eq!(
            stats,
            MovementPatternBatchRunStats {
                candidates: 1,
                applied: 0,
                unsupported: 1,
            },
        );
        assert_eq!(world.velocity(unsupported), Some(Velocity::default()));
        assert!(caches.is_empty());
    }

    #[test]
    fn layer_movement_pattern_phase_config_applies_layer_fallback_contract() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(0.0, 0.0, 1);
        let authored = world.spawn_enemy(0.0, 0.0, 1);
        world.set_movement_pattern(authored, MovementPattern::Linear { vx: 1.0, vy: 2.0 });
        let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
        let mut caches = Vec::new();

        let stats = run_layer_movement_pattern_phase(
            &mut world,
            &mut caches,
            LayerMovementPatternPhaseConfig {
                layer: CollisionLayer::Enemy,
                player_transform: None,
                navigation_policy: MovementNavigationPolicy {
                    repath_interval_seconds: 0.25,
                    reached_distance_squared: 0.01,
                },
                fallback_pattern: MovementPattern::Linear { vx: 5.0, vy: 6.0 },
            },
            |_, _| None,
        );

        assert_eq!(
            stats,
            MovementPatternBatchRunStats {
                candidates: 2,
                applied: 2,
                unsupported: 0,
            },
        );
        assert_eq!(world.velocity(enemy), Some(Velocity { vx: 5.0, vy: 6.0 }));
        assert_eq!(
            world.velocity(authored),
            Some(Velocity { vx: 1.0, vy: 2.0 }),
        );
        assert_eq!(world.velocity(bullet), Some(Velocity::default()));
        assert!(caches.is_empty());
    }

    #[test]
    fn layer_movement_pattern_phase_config_propagates_navigation_inputs() {
        let mut world = World::default();
        let player = world.spawn_player(10.0, 0.0, 1);
        let enemy = world.spawn_enemy(0.0, 0.0, 1);
        let player_transform = world.transform(player);
        let mut caches = Vec::new();
        let config = LayerMovementPatternPhaseConfig {
            layer: CollisionLayer::Enemy,
            player_transform,
            navigation_policy: MovementNavigationPolicy {
                repath_interval_seconds: 0.5,
                reached_distance_squared: 0.01,
            },
            fallback_pattern: MovementPattern::Chase {
                target: MovementTarget::Player,
                speed: 10.0,
            },
        };
        let mut resolver_calls = 0;

        let stats = run_layer_movement_pattern_phase(&mut world, &mut caches, config, |_, _| {
            resolver_calls += 1;
            Some(Transform2D { x: 0.0, y: 5.0 })
        });

        assert_eq!(
            stats,
            MovementPatternBatchRunStats {
                candidates: 1,
                applied: 1,
                unsupported: 0,
            },
        );
        assert_eq!(world.velocity(enemy), Some(Velocity { vx: 0.0, vy: 10.0 }));
        assert_eq!(resolver_calls, 1);

        let stats = run_layer_movement_pattern_phase(&mut world, &mut caches, config, |_, _| {
            resolver_calls += 1;
            Some(Transform2D { x: 10.0, y: 0.0 })
        });

        assert_eq!(
            stats,
            MovementPatternBatchRunStats {
                candidates: 1,
                applied: 1,
                unsupported: 0,
            },
        );
        assert_eq!(world.velocity(enemy), Some(Velocity { vx: 0.0, vy: 10.0 }));
        assert_eq!(resolver_calls, 1);

        tick_movement_navigation_targets(&mut caches, 0.5);
        let stats = run_layer_movement_pattern_phase(&mut world, &mut caches, config, |_, _| {
            resolver_calls += 1;
            Some(Transform2D { x: 10.0, y: 0.0 })
        });

        assert_eq!(
            stats,
            MovementPatternBatchRunStats {
                candidates: 1,
                applied: 1,
                unsupported: 0,
            },
        );
        assert_eq!(world.velocity(enemy), Some(Velocity { vx: 10.0, vy: 0.0 }));
        assert_eq!(resolver_calls, 2);
    }

    #[test]
    fn topdown_input_velocity_normalizes_direction_and_applies_speed() {
        let velocity = topdown_input_velocity(
            InputState {
                w: 1,
                d: 1,
                ..InputState::default()
            },
            10.0,
        );
        let expected = std::f32::consts::FRAC_1_SQRT_2 * 10.0;
        assert!((velocity.vx - expected).abs() < 0.0001);
        assert!((velocity.vy + expected).abs() < 0.0001);
        assert_eq!(
            topdown_input_velocity(InputState::default(), 10.0),
            Velocity::default(),
        );
    }

    #[test]
    fn apply_topdown_input_movement_uses_pattern_speed_or_default() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 1);
        let input = InputState {
            d: 1,
            ..InputState::default()
        };

        assert_eq!(
            apply_topdown_input_movement(&mut world, player.id as usize, input, 120.0),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[player.id as usize],
            Some(Velocity { vx: 120.0, vy: 0.0 }),
        );

        world.set_movement_pattern(player, MovementPattern::TopdownInput { speed: 200.0 });
        assert_eq!(
            apply_topdown_input_movement(&mut world, player.id as usize, input, 120.0),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[player.id as usize],
            Some(Velocity { vx: 200.0, vy: 0.0 }),
        );
        assert_eq!(
            apply_topdown_input_movement(&mut world, 99_999, input, 120.0),
            MovementPatternApplication::Unsupported,
        );
    }

    #[test]
    fn run_topdown_input_movement_system_checks_entity_generation() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 1);
        let input = InputState {
            d: 1,
            ..InputState::default()
        };

        assert_eq!(
            run_topdown_input_movement_system(&mut world, player, input, 120.0),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[player.id as usize],
            Some(Velocity { vx: 120.0, vy: 0.0 }),
        );

        let stale_player = Entity {
            generation: player.generation + 1,
            ..player
        };
        world.velocities[player.id as usize] = Some(Velocity { vx: 3.0, vy: 4.0 });
        assert_eq!(
            run_topdown_input_movement_system(&mut world, stale_player, input, 120.0),
            MovementPatternApplication::Unsupported,
        );
        assert_eq!(
            world.velocities[player.id as usize],
            Some(Velocity { vx: 3.0, vy: 4.0 }),
        );

        world.despawn(player);
        assert!(!world.is_alive_index(player.id as usize));
        assert_eq!(
            run_topdown_input_movement_system(&mut world, player, input, 120.0),
            MovementPatternApplication::Unsupported,
        );
    }

    #[test]
    fn topdown_input_movement_phase_config_applies_input_snapshot() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 1);
        let config = TopdownInputMovementPhaseConfig {
            entity: player,
            input: FrameInputSnapshot::current_only(InputState {
                d: 1,
                ..InputState::default()
            }),
            default_speed: 120.0,
        };

        assert_eq!(
            apply_topdown_input_movement_phase(&mut world, config),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[player.id as usize],
            Some(Velocity { vx: 120.0, vy: 0.0 }),
        );

        let stale_config = TopdownInputMovementPhaseConfig {
            entity: Entity {
                generation: player.generation + 1,
                ..player
            },
            ..config
        };
        world.velocities[player.id as usize] = Some(Velocity { vx: 3.0, vy: 4.0 });
        assert_eq!(
            apply_topdown_input_movement_phase(&mut world, stale_config),
            MovementPatternApplication::Unsupported,
        );
        assert_eq!(
            world.velocities[player.id as usize],
            Some(Velocity { vx: 3.0, vy: 4.0 }),
        );
    }

    #[test]
    fn frame_input_snapshot_keeps_current_and_previous_inputs() {
        let current = InputState {
            d: 1,
            mouse_x: 10.0,
            ..InputState::default()
        };
        let previous = InputState {
            mouse_left: 1,
            mouse_y: 20.0,
            ..InputState::default()
        };

        assert_eq!(
            FrameInputSnapshot::new(current, previous),
            FrameInputSnapshot { current, previous },
        );
        assert_eq!(
            FrameInputSnapshot::current_only(current),
            FrameInputSnapshot {
                current,
                previous: current,
            },
        );
    }

    #[test]
    fn run_topdown_input_movement_system_uses_default_for_non_topdown_pattern() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 1);
        world.set_movement_pattern(player, MovementPattern::Linear { vx: 3.0, vy: 4.0 });
        let input = InputState {
            d: 1,
            ..InputState::default()
        };

        assert_eq!(
            run_topdown_input_movement_system(&mut world, player, input, 120.0),
            MovementPatternApplication::Applied,
        );
        assert_eq!(
            world.velocities[player.id as usize],
            Some(Velocity { vx: 120.0, vy: 0.0 }),
        );
    }

    #[test]
    fn marked_despawn_queues_once() {
        let mut world = World::default();
        let entity = world.spawn_enemy(0.0, 0.0, 1);
        let mut marked = vec![false; world.entity_capacity()];
        let mut pending = Vec::new();

        assert!(queue_marked_despawn(
            &world,
            entity.id as usize,
            &mut marked,
            &mut pending,
        ));
        assert!(!queue_marked_despawn(
            &world,
            entity.id as usize,
            &mut marked,
            &mut pending,
        ));
        assert_eq!(pending, vec![entity]);
    }

    #[test]
    fn behavior_state_machine_events_transition_once_in_transition_order() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let mut machine = BehaviorStateMachine::new(1);
        assert!(machine.push_transition(BehaviorStateTransition::new(1, 2, 7)));
        assert!(machine.push_transition(BehaviorStateTransition::new(1, 3, 7)));
        assert!(machine.push_transition(BehaviorStateTransition::new(2, 4, 7)));
        assert!(world.set_behavior_state_machine(source, machine));
        let actor = world.spawn_entity();
        let mut events = vec![GameplayEvent::interaction(actor, source, 7, false, false)];

        apply_behavior_state_machine_events(&mut world, &mut events);

        assert_eq!(
            world
                .behavior_state_machine(source)
                .map(|machine| machine.current_state()),
            Some(2)
        );
        assert_eq!(
            events,
            vec![
                GameplayEvent::interaction(actor, source, 7, false, false),
                GameplayEvent::behavior_state_changed(source, 1, 2),
            ]
        );
    }

    #[test]
    fn behavior_state_machine_events_require_matching_source_generation() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let mut machine = BehaviorStateMachine::new(1);
        assert!(machine.push_transition(BehaviorStateTransition::new(1, 2, 7)));
        assert!(world.set_behavior_state_machine(source, machine));
        let actor = world.spawn_entity();
        let stale_source = Entity {
            id: source.id,
            generation: source.generation + 1,
        };
        let mut events = vec![GameplayEvent::interaction(
            actor,
            stale_source,
            7,
            false,
            false,
        )];

        apply_behavior_state_machine_events(&mut world, &mut events);

        assert_eq!(
            world
                .behavior_state_machine(source)
                .map(|machine| machine.current_state()),
            Some(1)
        );
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn behavior_state_machine_events_can_match_collision_event_kind() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let actor = world.spawn_entity();
        let mut machine = BehaviorStateMachine::new(1);
        assert!(machine.push_transition(BehaviorStateTransition::new_event(
            1,
            2,
            crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE,
            0,
        )));
        assert!(world.set_behavior_state_machine(source, machine));
        let mut events = vec![GameplayEvent::collision_damage(actor, source, 1.0, false)];

        apply_behavior_state_machine_events(&mut world, &mut events);

        assert_eq!(
            world
                .behavior_state_machine(source)
                .map(|machine| machine.current_state()),
            Some(2)
        );
        assert_eq!(
            events[1],
            GameplayEvent::behavior_state_changed(source, 1, 2)
        );
    }

    #[test]
    fn behavior_state_machine_events_can_match_tile_impact_policy() {
        let mut world = World::default();
        let projectile = world.spawn_entity();
        let mut machine = BehaviorStateMachine::new(1);
        assert!(machine.push_transition(BehaviorStateTransition::new_event(
            1,
            2,
            GAMEPLAY_EVENT_TILE_IMPACT,
            ProjectileTileImpact::Bounce.code(),
        )));
        assert!(world.set_behavior_state_machine(projectile, machine));
        let mut events = vec![GameplayEvent::tile_impact(GameplayTileImpactEventPayload {
            projectile,
            tile_impact_code: ProjectileTileImpact::Bounce.code(),
            layer_index: 0,
            tile_index: 0,
            normal_x: 1.0,
            normal_y: 0.0,
            bounced: true,
            target_removed: false,
        })];

        apply_behavior_state_machine_events(&mut world, &mut events);

        assert_eq!(
            world
                .behavior_state_machine(projectile)
                .map(|machine| machine.current_state()),
            Some(2)
        );
        assert_eq!(
            events[1],
            GameplayEvent::behavior_state_changed(projectile, 1, 2)
        );
    }

    #[test]
    fn timer_trigger_dispatch_preserves_event_and_action_command() {
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let mut timer = GameplayTimerTrigger::with_action(9, 0.25, 21);

        assert_eq!(
            tick_gameplay_timer_trigger_for_dispatch(source, &mut timer, 0.1),
            None,
        );
        let dispatch = tick_gameplay_timer_trigger_for_dispatch(source, &mut timer, 0.15)
            .expect("timer should dispatch after reaching zero");

        assert_eq!(
            dispatch,
            GameplayTimerDispatch {
                source,
                timer_id: 9,
                duration_seconds: 0.25,
                action_id: Some(21),
            },
        );
        assert_eq!(dispatch.event(), GameplayEvent::timer(source, 9, 0.25));
        assert_eq!(
            dispatch.action_trigger(),
            Some(ActionTriggerCommand::timer(source, 21)),
        );
        assert_eq!(
            tick_gameplay_timer_trigger_for_dispatch(source, &mut timer, 1.0),
            None,
        );
    }

    #[test]
    fn timer_trigger_dispatch_does_not_make_zero_action_id_command() {
        let source = Entity {
            id: 3,
            generation: 4,
        };
        let mut timer = GameplayTimerTrigger::with_action(9, 0.1, 0);

        let dispatch = tick_gameplay_timer_trigger_for_dispatch(source, &mut timer, 0.1)
            .expect("timer should still emit its timer event");

        assert_eq!(dispatch.event(), GameplayEvent::timer(source, 9, 0.1));
        assert_eq!(dispatch.action_trigger(), None);
    }

    #[test]
    fn timer_trigger_emits_once_and_can_drive_behavior_state_machine() {
        let mut world = World::default();
        let source = world.spawn_entity();
        assert!(world.set_gameplay_timer_trigger(source, GameplayTimerTrigger::new(9, 0.25)));
        let mut machine = BehaviorStateMachine::new(1);
        assert!(machine.push_transition(BehaviorStateTransition::new_event(
            1,
            2,
            GAMEPLAY_EVENT_TIMER,
            9,
        )));
        assert!(world.set_behavior_state_machine(source, machine));
        let mut events = Vec::new();

        tick_gameplay_timer_triggers(&mut world, 0.1, &mut events);
        assert!(events.is_empty());
        tick_gameplay_timer_triggers(&mut world, 0.15, &mut events);
        apply_behavior_state_machine_events(&mut world, &mut events);

        assert_eq!(
            world
                .behavior_state_machine(source)
                .map(|machine| machine.current_state()),
            Some(2)
        );
        assert_eq!(
            events,
            vec![
                GameplayEvent::timer(source, 9, 0.25),
                GameplayEvent::behavior_state_changed(source, 1, 2),
            ]
        );

        events.clear();
        tick_gameplay_timer_triggers(&mut world, 1.0, &mut events);
        assert!(events.is_empty());
    }

    #[test]
    fn pickup_collected_events_transition_collector_behavior_state_machine() {
        let mut world = World::default();
        let collector = world.spawn_entity();
        let pickup = world.spawn_entity();
        let mut collector_machine = BehaviorStateMachine::new(1);
        assert!(
            collector_machine.push_transition(BehaviorStateTransition::new_event(
                1,
                2,
                GAMEPLAY_EVENT_PICKUP_COLLECTED,
                1,
            ))
        );
        assert!(world.set_behavior_state_machine(collector, collector_machine));
        let mut pickup_machine = BehaviorStateMachine::new(1);
        assert!(
            pickup_machine.push_transition(BehaviorStateTransition::new_event(
                1,
                2,
                GAMEPLAY_EVENT_PICKUP_COLLECTED,
                1,
            ))
        );
        assert!(world.set_behavior_state_machine(pickup, pickup_machine));
        let mut events = vec![GameplayEvent::pickup_collected(
            collector, pickup, 1, 3, true,
        )];

        apply_behavior_state_machine_events(&mut world, &mut events);

        assert_eq!(
            world
                .behavior_state_machine(collector)
                .map(|machine| machine.current_state()),
            Some(2)
        );
        assert_eq!(
            world
                .behavior_state_machine(pickup)
                .map(|machine| machine.current_state()),
            Some(1)
        );
        assert_eq!(
            events,
            vec![
                GameplayEvent::pickup_collected(collector, pickup, 1, 3, true),
                GameplayEvent::behavior_state_changed(collector, 1, 2),
            ]
        );
    }
}
