use super::*;

pub(crate) fn apply_behavior_state_machine_events(
    world: &mut World,
    events: &mut Vec<GameplayEvent>,
) {
    if !world.has_behavior_state_machines() {
        return;
    }

    let input_event_count = events.len();
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let index = world.alive_indices()[alive_position];
        let Some(source) = world.entity_at_index(index) else {
            continue;
        };
        let Some(machine) = world.behavior_state_machine_ref(source) else {
            continue;
        };
        let previous_state = machine.current_state();
        let Some(next_state) =
            next_behavior_state(world, machine, source, &events[..input_event_count])
        else {
            continue;
        };
        if !world.set_behavior_state_machine_current_state(source, next_state) {
            continue;
        }
        events.push(GameplayEvent::behavior_state_changed(
            source,
            previous_state,
            next_state,
        ));
    }
}

pub(in crate::gameplay) fn next_behavior_state(
    world: &World,
    machine: &crate::components::gameplay::BehaviorStateMachine,
    source: Entity,
    events: &[GameplayEvent],
) -> Option<u32> {
    machine
        .iter_transitions()
        .find(|transition| {
            transition.from_state == machine.current_state()
                && world.gameplay_variable_comparison_matches(transition.guard)
                && (transition.event_kind == 0
                    || events.iter().any(|event| {
                        event.kind == transition.event_kind
                            && event_subject_matches_entity(event, source)
                            && event.token_id == transition.token_id
                    }))
        })
        .map(|transition| transition.to_state)
}

pub(crate) fn event_subject_matches_entity(event: &GameplayEvent, entity: Entity) -> bool {
    if event.kind == crate::gameplay_event::GAMEPLAY_EVENT_PICKUP_COLLECTED {
        return event.actor_id == entity.id && event.actor_generation == entity.generation;
    }
    event.source_id == entity.id && event.source_generation == entity.generation
}
