use super::*;

#[test]
fn world_snapshot_restores_physics_state_and_storage_generations() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let joint = world.add_distance_joint(DistanceJoint::new(a, b, 12.0).with_damping(0.25));

    world.set_transform(a, Transform2D { x: 2.0, y: 3.0 });
    world.set_transform(b, Transform2D { x: 8.0, y: 13.0 });
    world.set_velocity(a, Velocity { vx: 1.0, vy: -2.0 });
    let action = ActionBinding::projectile(7, 0.12, 420.0, 2.0, 1.5);
    assert!(world.upsert_action_binding(a, action));
    assert_eq!(world.commit_action_cooldown_if_ready(a, 7), Some(action));
    let expected_action = world.action_binding(a, 7).unwrap();
    world.set_movement_pattern(
        a,
        MovementPattern::Orbit {
            target: MovementTarget::Player,
            speed: 80.0,
            radius: 24.0,
            radial_band: 4.0,
        },
    );
    world.set_gameplay_tags(a, GameplayTags::new(1 << 5).unwrap());
    world.set_gameplay_faction(a, GameplayFaction::new(5, 0).unwrap());
    world
        .gameplay_faction_relations
        .set_default_relation(FactionRelation::Friendly);
    assert!(world
        .gameplay_faction_relations
        .set_relation(5, 6, FactionRelation::Hostile));
    assert!(world
        .gameplay_faction_relations
        .set_relation(5, 5, FactionRelation::Neutral));
    let mut state_machine = BehaviorStateMachine::new(1);
    assert!(state_machine.push_transition(BehaviorStateTransition::new(1, 2, 7)));
    assert!(world.set_behavior_state_machine(a, state_machine));
    let expected_state_enter_actions = (0..17)
        .map(|index| {
            BehaviorStateEnterAction::new(
                2,
                11 + index as u32,
                BehaviorStateEnterActionPhase::NextFramePrePhysics,
            )
        })
        .collect::<Vec<_>>();
    assert!(expected_state_enter_actions.len() <= MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY);
    for action in expected_state_enter_actions.iter().copied() {
        assert!(world.add_behavior_state_enter_action(a, action));
    }
    assert!(world.set_pickup(a, Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true)));
    assert!(world.set_interaction(a, Interaction::new(7, 24.0, true)));
    assert!(world.set_gameplay_timer_trigger(a, GameplayTimerTrigger::new(9, 0.5)));
    let expected_collision_reactions = (0..9)
        .map(|index| CollisionReaction::PlaySound {
            sound_id: 100 + index,
            volume: 0.8,
            pitch: 1.1,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        })
        .collect::<Vec<_>>();
    for reaction in expected_collision_reactions.iter().copied() {
        assert!(world.add_collision_reaction(a, reaction));
    }
    world.set_height_span(a, HeightSpan::on_default_floor(4.0, 16.0).unwrap());
    world.set_aabb_collider(
        a,
        AabbCollider::new(4.0, 5.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(a, RigidBody::dynamic(3.0));
    world.apply_force(a, Velocity { vx: 10.0, vy: -4.0 });
    world.apply_impulse(a, Velocity { vx: 2.0, vy: 6.0 });
    world.apply_torque(a, 7.0);
    world.apply_angular_impulse(a, 3.0);
    let body = world.rigid_bodies[a.id as usize].as_mut().unwrap();
    body.sleep_timer_seconds = 0.5;
    body.is_sleeping = true;
    world.rigid_contact_impulses.push(RigidContactImpulse {
        entity_a: a,
        entity_b: b,
        point_x: 4.0,
        point_y: 5.0,
        normal_x: 0.0,
        normal_y: 1.0,
        normal_impulse: 0.75,
        tangent_impulse: 0.25,
    });

    let expected_body = world.rigid_body(a).unwrap();
    let snapshot = world.snapshot();

    let extra = world.spawn_entity();
    world.set_transform(b, Transform2D { x: 99.0, y: 100.0 });
    world.clear_action_bindings(a);
    world.clear_movement_pattern(a);
    world.clear_gameplay_tags(a);
    world.clear_gameplay_faction(a);
    world.gameplay_faction_relations.clear();
    world.clear_behavior_state_machine(a);
    world.clear_behavior_state_enter_actions(a);
    world.clear_pickup(a);
    world.clear_interaction(a);
    world.clear_gameplay_timer_trigger(a);
    world.clear_collision_reactions(a);
    world.clear_distance_joint(joint);
    world.rigid_contact_impulses.clear();
    world.despawn(a);

    assert_ne!(world.rigid_body(a), Some(expected_body));

    world.restore_snapshot(&snapshot);

    assert_eq!(world.alive_count(), 2);
    assert_eq!(world.alive_indices(), &[0, 1]);
    assert_eq!(world.transform(a), Some(Transform2D { x: 2.0, y: 3.0 }));
    assert_eq!(world.transform(b), Some(Transform2D { x: 8.0, y: 13.0 }));
    assert_eq!(world.velocity(a), Some(Velocity { vx: 1.0, vy: -2.0 }));
    assert_eq!(
        world
            .action_bindings(a)
            .map(|bindings| bindings.iter().collect::<Vec<_>>()),
        Some(vec![expected_action])
    );
    assert_eq!(world.commit_action_cooldown_if_ready(a, 7), None);
    world.tick_action_cooldowns(0.12);
    assert_eq!(
        world
            .commit_action_cooldown_if_ready(a, 7)
            .map(|binding| binding.pattern),
        Some(action.pattern)
    );
    assert_eq!(
        world.movement_pattern(a),
        Some(MovementPattern::Orbit {
            target: MovementTarget::Player,
            speed: 80.0,
            radius: 24.0,
            radial_band: 4.0,
        })
    );
    assert_eq!(world.gameplay_tags(a), GameplayTags::new(1 << 5));
    assert_eq!(world.gameplay_faction(a), GameplayFaction::new(5, 0));
    assert_eq!(
        world.gameplay_faction_relations.default_relation(),
        FactionRelation::Friendly
    );
    assert_eq!(
        world.gameplay_faction_relations.relation(5, 6),
        Some(FactionRelation::Hostile)
    );
    assert_eq!(
        world.gameplay_faction_relations.relation(5, 5),
        Some(FactionRelation::Neutral)
    );
    assert_eq!(world.gameplay_tag_query_indices(5), &[a.id as usize]);
    assert_eq!(world.gameplay_faction_query_indices(5), &[a.id as usize]);
    assert_eq!(world.behavior_state_machine(a), Some(state_machine));
    assert_eq!(
        world
            .behavior_state_enter_actions(a)
            .map(|actions| actions.iter_for_state(2).collect::<Vec<_>>()),
        Some(expected_state_enter_actions)
    );
    assert_eq!(
        world.pickup(a),
        Some(Pickup::new(GAMEPLAY_PICKUP_ITEM_SCORE, 3, true))
    );
    assert_eq!(world.interaction(a), Some(Interaction::new(7, 24.0, true)));
    assert_eq!(
        world.gameplay_timer_trigger(a),
        Some(GameplayTimerTrigger::new(9, 0.5))
    );
    assert_eq!(
        world
            .collision_reactions(a)
            .map(|reactions| reactions.iter().collect::<Vec<_>>()),
        Some(expected_collision_reactions)
    );
    assert_eq!(
        world.height_span(a),
        HeightSpan::on_default_floor(4.0, 16.0)
    );
    assert_eq!(world.rigid_body(a), Some(expected_body));
    assert_eq!(
        world.distance_joint(joint),
        Some(DistanceJoint::new(a, b, 12.0).with_damping(0.25))
    );
    assert_eq!(world.rigid_contact_impulse_count(), 1);
    assert_eq!(
        world.rigid_contact_impulse_at(0),
        Some(RigidContactImpulse {
            entity_a: a,
            entity_b: b,
            point_x: 4.0,
            point_y: 5.0,
            normal_x: 0.0,
            normal_y: 1.0,
            normal_impulse: 0.75,
            tangent_impulse: 0.25,
        })
    );

    let after_restore = world.spawn_entity();
    assert_eq!(after_restore, extra);
    assert_eq!(world.alive_count(), 3);
    assert_eq!(world.alive_indices(), &[0, 1, 2]);
}
