use super::*;

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
