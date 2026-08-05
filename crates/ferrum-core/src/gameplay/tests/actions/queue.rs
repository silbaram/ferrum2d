use super::*;

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
