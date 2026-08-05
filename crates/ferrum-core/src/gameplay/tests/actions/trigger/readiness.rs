use super::*;

#[test]
fn action_pattern_kind_maps_current_action_patterns_exhaustively() {
    assert_eq!(
        ActionPatternKind::from_pattern(ActionBinding::projectile(1, 0.5, 120.0, 1.0, 2.0).pattern),
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
        prepare_action_trigger_for_dispatch(&world, trigger, ActionAttemptFailurePolicy::Silent,),
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
        action_trigger_failure_event_data(trigger, GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,),
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
