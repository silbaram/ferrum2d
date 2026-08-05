use super::*;

#[test]
fn default_collision_game_over_hit_can_queue_source_without_mutating_target() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_player(4.0, 0.0, 1);
    let mut marked = vec![false; world.entity_capacity()];
    let mut pending = Vec::new();

    let outcome = apply_default_collision_game_over_hit(
        &world,
        source.id as usize,
        target.id as usize,
        4.0,
        true,
        &mut marked,
        &mut pending,
    )
    .expect("source and target are alive");

    assert_eq!(
        outcome,
        DefaultCollisionGameOverHitOutcome {
            source_index: source.id as usize,
            source,
            source_removed: true,
            target_index: target.id as usize,
            target,
            damage: 4.0,
        },
    );
    assert_eq!(pending, vec![source]);
    assert_eq!(world.health(target), None);

    let repeated = apply_default_collision_game_over_hit(
        &world,
        source.id as usize,
        target.id as usize,
        4.0,
        true,
        &mut marked,
        &mut pending,
    )
    .expect("source and target are alive until deferred despawn flush");
    assert!(!repeated.source_removed);
    assert_eq!(pending, vec![source]);
}

#[test]
fn collision_side_effect_reaction_for_pair_commits_sound_cooldown() {
    let source = Entity {
        id: 1,
        generation: 0,
    };
    let other = Entity {
        id: 2,
        generation: 0,
    };
    let pair = CollisionReactionPair::new(1, 2, source, other);
    let mut reaction = CollisionReaction::PlaySound {
        sound_id: 9,
        volume: 0.6,
        pitch: 1.2,
        cooldown: Cooldown::ready(0.25),
        replace_default: true,
        trigger: CollisionReactionTrigger::Contact,
    };

    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: true,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::PlaySound {
                sound_id: 9,
                volume: 0.6,
                pitch: 1.2,
            }),
        }),
    );
    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: true,
            replace_default_particle: false,
            effect: None,
        }),
    );
}

#[test]
fn collision_side_effect_reaction_for_pair_respects_enter_trigger_and_particle_target() {
    let source = Entity {
        id: 1,
        generation: 0,
    };
    let other = Entity {
        id: 4,
        generation: 0,
    };
    let pair = CollisionReactionPair::new(1, 4, source, other);
    let mut reaction = CollisionReaction::SpawnParticle {
        preset_id: 3,
        target: CollisionTarget::OtherEntity,
        cooldown: Cooldown::ready(0.5),
        replace_default: true,
        trigger: CollisionReactionTrigger::Enter,
    };

    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: true,
            effect: None,
        }),
    );
    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, true),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: true,
            effect: Some(CollisionSideEffect::SpawnParticle {
                preset_id: 3,
                target_index: 4,
            }),
        }),
    );
}

#[test]
fn collision_side_effect_reaction_for_pair_commits_camera_shake_only_once_with_cooldown() {
    let source = Entity {
        id: 1,
        generation: 0,
    };
    let other = Entity {
        id: 4,
        generation: 0,
    };
    let pair = CollisionReactionPair::new(1, 4, source, other);
    let mut reaction = CollisionReaction::CameraShake {
        cooldown: Cooldown::ready(0.25),
        trigger: CollisionReactionTrigger::Contact,
    };

    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::CameraShake),
        }),
    );
    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: None,
        }),
    );
}

#[test]
fn collision_side_effect_reaction_for_pair_commits_emit_effect_with_target_actor() {
    let source = Entity {
        id: 1,
        generation: 0,
    };
    let other = Entity {
        id: 4,
        generation: 0,
    };
    let pair = CollisionReactionPair::new(1, 4, source, other);
    let mut reaction = CollisionReaction::EmitEffect {
        effect_id: 99,
        effect_type: 4,
        target: CollisionTarget::OtherEntity,
        intensity: 0.75,
        radius: 32.0,
        cooldown: Cooldown::ready(0.25),
        trigger: CollisionReactionTrigger::Enter,
    };

    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, false),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: None,
        }),
    );
    assert_eq!(
        commit_collision_side_effect_reaction_for_pair(pair, &mut reaction, true),
        Some(CollisionSideEffectEvaluation {
            replace_default_audio: false,
            replace_default_particle: false,
            effect: Some(CollisionSideEffect::EmitEffect {
                effect_id: 99,
                effect_type: 4,
                target_index: 4,
                intensity: 0.75,
                radius: 32.0,
            }),
        }),
    );
}

#[test]
fn collision_spawn_prefab_reaction_for_pair_respects_enter_trigger_and_anchor_target() {
    let source = Entity {
        id: 1,
        generation: 0,
    };
    let other = Entity {
        id: 4,
        generation: 0,
    };
    let pair = CollisionReactionPair::new(1, 4, source, other);
    let reaction = CollisionReaction::SpawnPrefab {
        action_id: 17,
        prefab_id: 3,
        target: CollisionTarget::OtherEntity,
        cooldown: Cooldown::ready(0.5),
        trigger: CollisionReactionTrigger::Enter,
        offset_x: 6.0,
        offset_y: -3.0,
    };

    assert_eq!(
        collision_spawn_prefab_reaction_for_pair(pair, reaction, false),
        None,
    );
    assert_eq!(
        collision_spawn_prefab_reaction_for_pair(pair, reaction, true),
        Some(CollisionSpawnPrefabEvaluation {
            reaction_owner_index: 1,
            source,
            action_id: 17,
            prefab_id: 3,
            target: CollisionTarget::OtherEntity,
            anchor_index: 4,
            anchor: other,
            offset_x: 6.0,
            offset_y: -3.0,
        }),
    );
}

#[test]
fn collision_spawn_prefab_cooldown_commits_only_after_successful_runtime_queue() {
    let mut world = World::default();
    let source = world.spawn_player(0.0, 0.0, 1);
    let other = world.spawn_enemy(4.0, 0.0, 1);
    assert!(world.add_collision_reaction(
        source,
        CollisionReaction::SpawnPrefab {
            action_id: 17,
            prefab_id: 1,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.5),
            trigger: CollisionReactionTrigger::Contact,
            offset_x: 6.0,
            offset_y: -3.0,
        },
    ));
    let pair = CollisionReactionPair::new(source.id as usize, other.id as usize, source, other);
    let evaluation = collision_spawn_prefab_reaction_for_pair(
        pair,
        world
            .collision_reactions(source)
            .expect("source has reactions")
            .iter()
            .next()
            .expect("spawn reaction exists"),
        false,
    )
    .expect("spawn prefab reaction should be ready");

    assert!(commit_collision_spawn_prefab_reaction_cooldown(
        &mut world, evaluation,
    ));
    let mut reactions = world
        .collision_reactions(source)
        .expect("source reactions are written back");
    let reaction = reactions.iter_mut().next().expect("spawn reaction remains");
    let CollisionReaction::SpawnPrefab { cooldown, .. } = reaction else {
        panic!("expected spawn prefab reaction");
    };
    assert_eq!(
        *cooldown,
        Cooldown {
            duration_seconds: 0.5,
            remaining_seconds: 0.5,
        },
    );
    world.replace_collision_reactions(source, Some(reactions));
    assert!(!commit_collision_spawn_prefab_reaction_cooldown(
        &mut world, evaluation,
    ));
}

#[test]
fn collision_side_effect_payload_maps_sound_without_runtime_sink() {
    let world = World::default();

    assert_eq!(
        collision_side_effect_payload(
            &world,
            CollisionSideEffectEvaluation {
                replace_default_audio: true,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::PlaySound {
                    sound_id: 9,
                    volume: 0.6,
                    pitch: 1.2,
                }),
            },
        ),
        Some(CollisionSideEffectPayload::PlaySound {
            sound_id: 9,
            volume: 0.6,
            pitch: 1.2,
        }),
    );
}

#[test]
fn collision_side_effect_payload_resolves_particle_target_transform() {
    let mut world = World::default();
    let target = world.spawn_player(12.0, -3.0, 1);

    assert_eq!(
        collision_side_effect_payload(
            &world,
            CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: true,
                effect: Some(CollisionSideEffect::SpawnParticle {
                    preset_id: 3,
                    target_index: target.id as usize,
                }),
            },
        ),
        Some(CollisionSideEffectPayload::SpawnParticleAt {
            preset_id: 3,
            position: Transform2D { x: 12.0, y: -3.0 },
        }),
    );

    assert!(world.clear_transform_for_test(target));

    assert_eq!(
        collision_side_effect_payload(
            &world,
            CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: true,
                effect: Some(CollisionSideEffect::SpawnParticle {
                    preset_id: 3,
                    target_index: target.id as usize,
                }),
            },
        ),
        None,
    );
}

#[test]
fn collision_side_effect_payload_maps_camera_shake() {
    assert_eq!(
        collision_side_effect_payload(
            &World::default(),
            CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::CameraShake),
            },
        ),
        Some(CollisionSideEffectPayload::CameraShake),
    );
}

#[test]
fn collision_side_effect_payload_maps_emit_effect_actor() {
    let mut world = World::default();
    let target = world.spawn_enemy(12.0, -3.0, 1);

    assert_eq!(
        collision_side_effect_payload(
            &world,
            CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::EmitEffect {
                    effect_id: 99,
                    effect_type: 4,
                    target_index: target.id as usize,
                    intensity: 0.5,
                    radius: 24.0,
                }),
            },
        ),
        Some(CollisionSideEffectPayload::PresentationEffect {
            actor: target,
            effect_id: 99,
            effect_type: 4,
            intensity: 0.5,
            radius: 24.0,
        }),
    );

    world.despawn(target);
    assert_eq!(
        collision_side_effect_payload(
            &world,
            CollisionSideEffectEvaluation {
                replace_default_audio: false,
                replace_default_particle: false,
                effect: Some(CollisionSideEffect::EmitEffect {
                    effect_id: 99,
                    effect_type: 4,
                    target_index: target.id as usize,
                    intensity: 1.0,
                    radius: 0.0,
                }),
            },
        ),
        None,
    );
}
