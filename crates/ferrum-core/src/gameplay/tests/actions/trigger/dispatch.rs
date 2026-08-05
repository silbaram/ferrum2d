use super::*;

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
