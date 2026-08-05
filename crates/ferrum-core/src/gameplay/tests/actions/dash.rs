use super::*;

#[test]
fn prepare_dash_action_payload_returns_payload_after_readiness_checks() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::dash_with_aim(21, 0.5, 96.0, ActionAimSource::TargetPlayer);

    assert_eq!(
        prepare_dash_action_payload(&world, source, 21),
        Err(ActionReadiness::Missing),
    );
    assert!(world.upsert_action_binding(
        source,
        ActionBinding::spawn_prefab(
            21,
            0.5,
            7,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        ),
    ));
    assert_eq!(
        prepare_dash_action_payload(&world, source, 21),
        Err(ActionReadiness::PatternMismatch),
    );
    assert!(world.upsert_action_binding(source, action));
    assert_eq!(
        prepare_dash_action_payload(&world, source, 21),
        Ok(DashActionPayload {
            distance: 96.0,
            aim: ActionAimSource::TargetPlayer,
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
    assert!(commit_prepared_action(
        &mut world,
        prepared_action(source, action)
    ));
    assert_eq!(
        prepare_dash_action_payload(&world, source, 21),
        Err(ActionReadiness::CoolingDown),
    );
}

#[test]
fn plan_dash_action_transform_plans_target_player_dash_without_mutation() {
    let source = Entity {
        id: 1,
        generation: 1,
    };
    let target = Entity {
        id: 2,
        generation: 1,
    };
    let source_t = Transform2D { x: 100.0, y: 0.0 };
    let target_t = Transform2D { x: 0.0, y: 0.0 };

    assert_eq!(
        plan_dash_action_transform(
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::Input,
            },
            source,
            source_t,
            Some((target, target_t)),
        ),
        Err(DashActionPlanError::UnsupportedAimSource),
    );
    assert_eq!(
        plan_dash_action_transform(
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::TargetPlayer,
            },
            source,
            source_t,
            None,
        ),
        Err(DashActionPlanError::MissingActionTarget),
    );
    assert_eq!(
        plan_dash_action_transform(
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::TargetPlayer,
            },
            source,
            source_t,
            Some((source, source_t)),
        ),
        Err(DashActionPlanError::MissingActionTarget),
    );
    assert_eq!(
        plan_dash_action_transform(
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::TargetPlayer,
            },
            source,
            source_t,
            Some((target, source_t)),
        ),
        Err(DashActionPlanError::MissingActionTarget),
    );

    let planned = plan_dash_action_transform(
        DashActionPayload {
            distance: 40.0,
            aim: ActionAimSource::TargetPlayer,
        },
        source,
        source_t,
        Some((target, target_t)),
    )
    .expect("target-player dash should produce final transform");
    assert!((planned.x - 60.0).abs() < 0.001);
    assert!(planned.y.abs() < 0.001);

    let diagonal = plan_dash_action_transform(
        DashActionPayload {
            distance: 10.0,
            aim: ActionAimSource::TargetPlayer,
        },
        source,
        Transform2D { x: 0.0, y: 0.0 },
        Some((target, Transform2D { x: 3.0, y: 4.0 })),
    )
    .expect("3-4-5 target direction should normalize");
    assert!((diagonal.x - 6.0).abs() < 0.001);
    assert!((diagonal.y - 8.0).abs() < 0.001);
}

#[test]
fn plan_input_dash_action_transform_uses_input_then_aim_target_then_fallback() {
    let source_t = Transform2D { x: 10.0, y: 20.0 };
    let payload = DashActionPayload {
        distance: 10.0,
        aim: ActionAimSource::Input,
    };

    assert_eq!(
        plan_input_dash_action_transform(
            DashActionPayload {
                distance: 10.0,
                aim: ActionAimSource::TargetPlayer,
            },
            source_t,
            Velocity { vx: 1.0, vy: 0.0 },
            Transform2D { x: 10.0, y: 20.0 },
        ),
        Err(DashActionPlanError::UnsupportedAimSource),
    );

    let input_dash = plan_input_dash_action_transform(
        payload,
        source_t,
        Velocity { vx: 0.0, vy: -1.0 },
        Transform2D { x: 13.0, y: 24.0 },
    )
    .expect("input direction should produce final transform");
    assert!((input_dash.x - 10.0).abs() < 0.001);
    assert!((input_dash.y - 10.0).abs() < 0.001);

    let diagonal_input_dash = plan_input_dash_action_transform(
        payload,
        source_t,
        Velocity { vx: 3.0, vy: 4.0 },
        Transform2D { x: 10.0, y: 20.0 },
    )
    .expect("input direction should be normalized before applying distance");
    assert!((diagonal_input_dash.x - 16.0).abs() < 0.001);
    assert!((diagonal_input_dash.y - 28.0).abs() < 0.001);

    let target_dash = plan_input_dash_action_transform(
        payload,
        source_t,
        Velocity { vx: 0.0, vy: 0.0 },
        Transform2D { x: 13.0, y: 24.0 },
    )
    .expect("aim target should produce final transform");
    assert!((target_dash.x - 16.0).abs() < 0.001);
    assert!((target_dash.y - 28.0).abs() < 0.001);

    let fallback_dash = plan_input_dash_action_transform(
        payload,
        source_t,
        Velocity { vx: 0.0, vy: 0.0 },
        source_t,
    )
    .expect("zero input and zero target direction should use fallback");
    assert!((fallback_dash.x - 20.0).abs() < 0.001);
    assert!((fallback_dash.y - 20.0).abs() < 0.001);
}

#[test]
fn dash_action_core_data_combines_entity_and_transform() {
    let entity = Entity {
        id: 7,
        generation: 2,
    };
    let transform = Transform2D { x: 12.0, y: -8.0 };

    assert_eq!(
        dash_action_core_data_from_plan(entity, transform),
        DashActionCoreData { entity, transform },
    );
}

#[test]
fn apply_dash_action_core_data_writes_target_transform() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x: 1.0, y: 2.0 });

    let transform = Transform2D { x: 32.0, y: 48.0 };
    apply_dash_action_core_data(
        &mut world,
        dash_action_core_data_from_plan(entity, transform),
    );

    assert_eq!(world.transform(entity), Some(transform));
}
