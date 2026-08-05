use super::*;

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
    world.set_transform(source, Transform2D { x: 1.0, y: 2.0 });
    let target = world.spawn_enemy(4.0, 5.0, 1);
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);

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
    world.set_transform(source, Transform2D { x: 1.0, y: 2.0 });
    let target = world.spawn_enemy(4.0, 5.0, 1);
    assert!(world.clear_transform_for_test(target));
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);

    assert_eq!(
        collision_hit_presentation_payload(&world, pair, 2.5, None).particle_position,
        Some(Transform2D { x: 1.0, y: 2.0 }),
    );
}

#[test]
fn collision_hit_presentation_payload_respects_replace_default_flags() {
    let mut world = World::default();
    let source = world.spawn_entity();
    world.set_transform(source, Transform2D { x: 1.0, y: 2.0 });
    let target = world.spawn_enemy(4.0, 5.0, 1);
    let pair = CollisionReactionPair::new(source.id as usize, target.id as usize, source, target);
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

    assert!(world.clear_transform_for_test(target));
    assert_eq!(
        target_only_default_collision_damage_hit_presentation_payload(&world, outcome)
            .particle_position,
        None,
    );
}
