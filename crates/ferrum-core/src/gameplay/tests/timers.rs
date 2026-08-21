use super::*;

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
fn guarded_timer_pauses_until_its_variable_comparison_matches() {
    let mut world = World::default();
    let source = world.spawn_entity();
    assert!(world.configure_gameplay_variable(
        1,
        crate::gameplay_variables::GameplayVariableType::Bool,
        crate::gameplay_variables::GameplayVariableScope::Scene,
        0.0,
        0.0,
    ));
    let guard = crate::gameplay_variables::GameplayVariableComparison::new(
        1,
        crate::gameplay_variables::GameplayVariableComparisonOperator::Equal,
        0,
        1.0,
    )
    .unwrap();
    assert!(world
        .set_gameplay_timer_trigger(source, GameplayTimerTrigger::new(9, 0.25).guarded(guard),));
    let mut events = Vec::new();

    tick_gameplay_timer_triggers(&mut world, 1.0, &mut events);
    assert!(events.is_empty());
    assert!(world.set_gameplay_variable_value(1, 1.0));
    tick_gameplay_timer_triggers(&mut world, 0.25, &mut events);

    assert_eq!(events, vec![GameplayEvent::timer(source, 9, 0.25)]);
}
