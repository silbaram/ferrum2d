use super::*;

#[test]
fn prepare_melee_action_payload_returns_payload_after_readiness_checks() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player);

    assert_eq!(
        prepare_melee_action_payload(&world, source, 41),
        Err(ActionReadiness::Missing),
    );
    assert!(world.upsert_action_binding(source, ActionBinding::dash(41, 0.5, 96.0)));
    assert_eq!(
        prepare_melee_action_payload(&world, source, 41),
        Err(ActionReadiness::PatternMismatch),
    );
    assert!(world.upsert_action_binding(source, action));
    assert_eq!(
        prepare_melee_action_payload(&world, source, 41),
        Ok(MeleeActionPayload {
            range: 32.0,
            damage: 2.0,
            target: MeleeTarget::Player,
        }),
    );
    assert_eq!(
        world
            .action_binding(source, 41)
            .expect("melee binding should still exist")
            .cooldown
            .remaining_seconds,
        0.0,
    );
    assert!(commit_prepared_action(
        &mut world,
        prepared_action(source, action)
    ));
    assert_eq!(
        prepare_melee_action_payload(&world, source, 41),
        Err(ActionReadiness::CoolingDown),
    );
}

#[test]
fn plan_melee_action_plans_supported_queued_targets_without_mutation() {
    let source = Entity {
        id: 1,
        generation: 1,
    };
    let target = Entity {
        id: 2,
        generation: 1,
    };
    let source_t = Transform2D { x: 16.0, y: -4.0 };
    let payload = MeleeActionPayload {
        range: 32.0,
        damage: 2.0,
        target: MeleeTarget::Player,
    };

    assert_eq!(validate_queued_melee_action_support(payload), Ok(()));
    assert_eq!(
        plan_melee_action(payload, source, source_t, None),
        Err(MeleeActionPlanError::MissingActionTarget),
    );
    assert_eq!(
        plan_melee_action(payload, source, source_t, Some(source)),
        Err(MeleeActionPlanError::MissingActionTarget),
    );

    assert_eq!(
        plan_melee_action(payload, source, source_t, Some(target)),
        Ok(MeleeActionPlan {
            center: source_t,
            range: 32.0,
            damage: 2.0,
            target: MeleeTarget::Player,
        }),
    );
    let enemy_target_payload = MeleeActionPayload {
        target: MeleeTarget::Enemies,
        ..payload
    };
    assert_eq!(
        validate_queued_melee_action_support(enemy_target_payload),
        Ok(()),
    );
    assert_eq!(
        plan_melee_action(enemy_target_payload, source, source_t, None),
        Ok(MeleeActionPlan {
            center: source_t,
            range: 32.0,
            damage: 2.0,
            target: MeleeTarget::Enemies,
        }),
    );
}

#[test]
fn plan_input_melee_action_plans_supported_enemy_target_without_mutation() {
    let source_t = Transform2D { x: 16.0, y: -4.0 };
    let payload = MeleeActionPayload {
        range: 32.0,
        damage: 2.0,
        target: MeleeTarget::Enemies,
    };

    assert_eq!(
        validate_input_melee_action_support(MeleeActionPayload {
            target: MeleeTarget::Player,
            ..payload
        }),
        Err(MeleeActionPlanError::UnsupportedTarget),
    );
    assert_eq!(
        plan_input_melee_action(
            MeleeActionPayload {
                target: MeleeTarget::Player,
                ..payload
            },
            source_t,
        ),
        Err(MeleeActionPlanError::UnsupportedTarget),
    );
    assert_eq!(validate_input_melee_action_support(payload), Ok(()));
    assert_eq!(
        plan_input_melee_action(payload, source_t),
        Ok(MeleeActionPlan {
            center: source_t,
            range: 32.0,
            damage: 2.0,
            target: MeleeTarget::Enemies,
        }),
    );
}

#[test]
fn melee_attack_core_data_combines_attacker_plan_and_height_span() {
    let attacker = Entity {
        id: 4,
        generation: 2,
    };
    let plan = MeleeActionPlan {
        center: Transform2D { x: 10.0, y: 20.0 },
        range: 16.0,
        damage: 3.0,
        target: MeleeTarget::Enemies,
    };
    let height_span = Some(HeightSpan {
        floor: crate::components::PhysicsFloorId::DEFAULT,
        elevation: 1.5,
        height: 2.0,
    });

    assert_eq!(
        melee_attack_core_data_from_plan(attacker, plan, height_span),
        MeleeAttackCoreData {
            attacker,
            center: plan.center,
            range: plan.range,
            damage: plan.damage,
            target: plan.target,
            height_span,
        },
    );
}

#[test]
fn melee_attack_query_mask_matches_target_layer() {
    assert_eq!(
        melee_attack_query_mask(MeleeTarget::Enemies),
        CollisionMask::ENEMY
    );
    assert_eq!(
        melee_attack_query_mask(MeleeTarget::Player),
        CollisionMask::PLAYER
    );
}

#[test]
fn run_melee_attack_query_uses_target_mask_and_reuses_hit_buffer() {
    let mut world = World::default();
    let player = world.spawn_player(0.0, 0.0, 0);
    let enemy = world.spawn_enemy(8.0, 0.0, 0);
    let far_enemy = world.spawn_enemy(64.0, 0.0, 0);
    let mut hits = Vec::with_capacity(4);

    assert_eq!(
        run_melee_attack_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            16.0,
            MeleeTarget::Enemies,
            None,
            &mut hits,
        ),
        1,
    );
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].entity, enemy);

    assert_eq!(
        run_melee_attack_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            16.0,
            MeleeTarget::Player,
            None,
            &mut hits,
        ),
        1,
    );
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].entity, player);
    assert_ne!(hits[0].entity, far_enemy);
}

#[test]
fn run_melee_attack_query_respects_height_span_filter() {
    let mut world = World::default();
    world.spawn_player(0.0, 0.0, 0);
    let low_enemy = world.spawn_enemy(8.0, 0.0, 0);
    let high_enemy = world.spawn_enemy(8.0, 0.0, 0);
    world.set_height_span(low_enemy, HeightSpan::on_default_floor(0.0, 8.0).unwrap());
    world.set_height_span(high_enemy, HeightSpan::on_default_floor(16.0, 8.0).unwrap());
    let mut hits = Vec::with_capacity(4);

    assert_eq!(
        run_melee_attack_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            16.0,
            MeleeTarget::Enemies,
            HeightSpan::on_default_floor(4.0, 4.0),
            &mut hits,
        ),
        1,
    );
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].entity, low_enemy);
    assert_ne!(hits[0].entity, high_enemy);
}

#[test]
fn melee_attack_live_predicates_preserve_target_layer_policy() {
    let mut world = World::default();
    let player = world.spawn_player(0.0, 0.0, 0);
    let enemy = world.spawn_enemy(16.0, 0.0, 0);
    let plain = world.spawn_entity();
    let mut marked_for_despawn = vec![false; world.entity_capacity()];

    assert!(melee_attack_attacker_can_resolve(
        &world,
        player,
        MeleeTarget::Enemies,
        &marked_for_despawn,
    ));
    assert!(melee_attack_attacker_can_resolve(
        &world,
        enemy,
        MeleeTarget::Enemies,
        &marked_for_despawn,
    ));
    assert!(melee_attack_attacker_can_resolve(
        &world,
        plain,
        MeleeTarget::Player,
        &marked_for_despawn,
    ));

    assert!(melee_attack_target_can_receive_hit(
        &world,
        enemy,
        MeleeTarget::Enemies,
        &marked_for_despawn,
    ));
    assert!(!melee_attack_target_can_receive_hit(
        &world,
        player,
        MeleeTarget::Enemies,
        &marked_for_despawn,
    ));
    assert!(melee_attack_target_can_receive_hit(
        &world,
        player,
        MeleeTarget::Player,
        &marked_for_despawn,
    ));

    marked_for_despawn[player.id as usize] = true;
    assert!(!melee_attack_attacker_can_resolve(
        &world,
        player,
        MeleeTarget::Enemies,
        &marked_for_despawn,
    ));
    assert!(!melee_attack_target_can_receive_hit(
        &world,
        player,
        MeleeTarget::Player,
        &marked_for_despawn,
    ));

    let out_of_range = Entity {
        id: world.entity_capacity() as u32,
        generation: 0,
    };
    assert!(!melee_attack_attacker_can_resolve(
        &world,
        out_of_range,
        MeleeTarget::Player,
        &marked_for_despawn,
    ));
    assert!(!melee_attack_target_can_receive_hit(
        &world,
        out_of_range,
        MeleeTarget::Enemies,
        &marked_for_despawn,
    ));
}
