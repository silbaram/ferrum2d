use super::*;

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
