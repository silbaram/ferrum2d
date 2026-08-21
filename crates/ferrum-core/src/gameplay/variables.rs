use crate::entity::Entity;
use crate::gameplay_event::GameplayEvent;
use crate::gameplay_variables::GameplayVariableMutationOperation;
use crate::world::World;

pub(crate) fn apply_gameplay_variable_mutation_events(world: &mut World, events: &[GameplayEvent]) {
    if events.is_empty() {
        return;
    }
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let index = world.alive_indices()[alive_position];
        let Some(source) = world.entity_at_index(index) else {
            continue;
        };
        let Some(triggers) = world.gameplay_variable_mutation_triggers_at_index(index) else {
            continue;
        };
        apply_trigger_set(world, source, triggers, events);
    }
    let retired_count = world.retired_gameplay_variable_mutation_trigger_count();
    for retired_index in 0..retired_count {
        let Some((source, triggers)) =
            world.retired_gameplay_variable_mutation_trigger(retired_index)
        else {
            continue;
        };
        apply_trigger_set(world, source, triggers, events);
    }
}

fn apply_trigger_set(
    world: &mut World,
    owner: Entity,
    triggers: crate::gameplay_variables::GameplayVariableMutationTriggerSet,
    events: &[GameplayEvent],
) {
    for trigger in triggers.iter() {
        for _event in events.iter().filter(|event| {
            event.kind == trigger.event_kind
                && event.token_id == trigger.token_id
                && event_participant_matches_entity(event, owner)
        }) {
            match trigger.operation {
                GameplayVariableMutationOperation::Set => {
                    world.set_gameplay_variable_value(trigger.slot, trigger.value);
                }
                GameplayVariableMutationOperation::Increment => {
                    world.increment_gameplay_variable_value(trigger.slot, trigger.value);
                }
            }
        }
    }
}

fn event_participant_matches_entity(event: &GameplayEvent, entity: Entity) -> bool {
    (event.actor_id == entity.id && event.actor_generation == entity.generation)
        || (event.source_id == entity.id && event.source_generation == entity.generation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::gameplay::{BehaviorStateMachine, BehaviorStateTransition};
    use crate::gameplay_variables::{
        GameplayVariableComparison, GameplayVariableComparisonOperator,
        GameplayVariableMutationTrigger, GameplayVariableScope, GameplayVariableType,
    };

    #[test]
    fn matching_events_mutate_variables_inside_rust_runtime() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        assert!(world.configure_gameplay_variable(
            1,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            0.0,
            0.0,
        ));
        assert!(world.configure_gameplay_variable(
            2,
            GameplayVariableType::Bool,
            GameplayVariableScope::Scene,
            0.0,
            0.0,
        ));
        assert!(world.add_gameplay_variable_mutation_trigger(
            entity,
            GameplayVariableMutationTrigger::new(
                crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE,
                0,
                1,
                GameplayVariableMutationOperation::Increment,
                1.0,
            )
            .unwrap(),
        ));
        assert!(world.add_gameplay_variable_mutation_trigger(
            entity,
            GameplayVariableMutationTrigger::new(
                crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE,
                0,
                2,
                GameplayVariableMutationOperation::Set,
                1.0,
            )
            .unwrap(),
        ));

        apply_gameplay_variable_mutation_events(
            &mut world,
            &[
                GameplayEvent::collision_damage(entity, entity, 1.0, false),
                GameplayEvent::collision_damage(entity, entity, 1.0, false),
            ],
        );
        assert_eq!(world.gameplay_variable_value(1), Some(2.0));
        assert_eq!(world.gameplay_variable_value(2), Some(1.0));
    }

    #[test]
    fn collision_damage_mutations_match_both_actor_and_source_recipes() {
        let mut world = World::default();
        let actor = world.spawn_entity();
        let source = world.spawn_entity();
        assert!(world.configure_gameplay_variable(
            1,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            0.0,
            0.0,
        ));
        assert!(world.configure_gameplay_variable(
            2,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            0.0,
            0.0,
        ));
        assert!(world.add_gameplay_variable_mutation_trigger(
            actor,
            GameplayVariableMutationTrigger::new(
                crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE,
                0,
                1,
                GameplayVariableMutationOperation::Increment,
                1.0,
            )
            .unwrap(),
        ));
        assert!(world.add_gameplay_variable_mutation_trigger(
            source,
            GameplayVariableMutationTrigger::new(
                crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE,
                0,
                2,
                GameplayVariableMutationOperation::Increment,
                1.0,
            )
            .unwrap(),
        ));

        apply_gameplay_variable_mutation_events(
            &mut world,
            &[GameplayEvent::collision_damage(actor, source, 1.0, false)],
        );

        assert_eq!(world.gameplay_variable_value(1), Some(1.0));
        assert_eq!(world.gameplay_variable_value(2), Some(1.0));
    }

    #[test]
    fn event_mutation_can_drive_variable_fsm_transition_in_the_same_frame() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        assert!(world.configure_gameplay_variable(
            1,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            0.0,
            2.0,
        ));
        assert!(world.add_gameplay_variable_mutation_trigger(
            entity,
            GameplayVariableMutationTrigger::new(
                crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE,
                0,
                1,
                GameplayVariableMutationOperation::Increment,
                1.0,
            )
            .unwrap(),
        ));
        let mut machine = BehaviorStateMachine::new(1);
        assert!(
            machine.push_transition(BehaviorStateTransition::new_variable(
                1,
                2,
                GameplayVariableComparison::new(
                    1,
                    GameplayVariableComparisonOperator::GreaterThanOrEqual,
                    0,
                    3.0,
                )
                .unwrap(),
            ))
        );
        assert!(world.set_behavior_state_machine(entity, machine));
        let mut events = vec![GameplayEvent::collision_damage(entity, entity, 1.0, false)];

        apply_gameplay_variable_mutation_events(&mut world, &events);
        crate::gameplay::apply_behavior_state_machine_events(&mut world, &mut events);

        assert_eq!(world.gameplay_variable_value(1), Some(3.0));
        assert_eq!(
            world
                .behavior_state_machine(entity)
                .map(|machine| machine.current_state()),
            Some(2),
        );
        assert_eq!(
            events.last(),
            Some(&GameplayEvent::behavior_state_changed(entity, 1, 2))
        );
    }

    #[test]
    fn matching_event_mutates_variable_after_source_despawns() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let target = world.spawn_entity();
        assert!(world.configure_gameplay_variable(
            1,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            0.0,
            0.0,
        ));
        assert!(world.add_gameplay_variable_mutation_trigger(
            source,
            GameplayVariableMutationTrigger::new(
                crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE,
                0,
                1,
                GameplayVariableMutationOperation::Increment,
                1.0,
            )
            .unwrap(),
        ));
        let events = [GameplayEvent::collision_damage(target, source, 1.0, false)];

        world.despawn(source);
        apply_gameplay_variable_mutation_events(&mut world, &events);

        assert_eq!(world.gameplay_variable_value(1), Some(1.0));
    }
}
