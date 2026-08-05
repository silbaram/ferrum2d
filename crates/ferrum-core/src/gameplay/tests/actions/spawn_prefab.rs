use super::*;

#[test]
fn prepare_spawn_prefab_action_payload_returns_payload_after_readiness_checks() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::spawn_prefab(
        11,
        0.5,
        7,
        SpawnAnchor::SelfEntity,
        SpawnPhase::PrePhysics,
        16.0,
        -4.0,
    );

    assert_eq!(
        prepare_spawn_prefab_action_payload(&world, source, 11),
        Err(ActionReadiness::Missing),
    );
    assert!(world.upsert_action_binding(source, ActionBinding::dash(11, 0.5, 96.0)));
    assert_eq!(
        prepare_spawn_prefab_action_payload(&world, source, 11),
        Err(ActionReadiness::PatternMismatch),
    );
    assert!(world.upsert_action_binding(source, action));
    assert_eq!(
        prepare_spawn_prefab_action_payload(&world, source, 11),
        Ok(SpawnPrefabActionPayload {
            prefab_id: 7,
            projectile: None,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: 16.0,
            offset_y: -4.0,
        }),
    );
    assert_eq!(
        world
            .action_binding(source, 11)
            .expect("spawn prefab binding should still exist")
            .cooldown
            .remaining_seconds,
        0.0,
    );
    assert!(commit_prepared_action(
        &mut world,
        prepared_action(source, action)
    ));
    assert_eq!(
        prepare_spawn_prefab_action_payload(&world, source, 11),
        Err(ActionReadiness::CoolingDown),
    );
}

#[test]
fn plan_spawn_prefab_action_plans_supported_self_anchor_without_mutation() {
    let payload = SpawnPrefabActionPayload {
        prefab_id: 7,
        projectile: None,
        anchor: SpawnAnchor::SelfEntity,
        phase: SpawnPhase::PrePhysics,
        offset_x: 16.0,
        offset_y: -4.0,
    };
    let source_t = Transform2D { x: 32.0, y: 40.0 };

    assert_eq!(validate_spawn_prefab_action_support(payload), Ok(()));
    assert_eq!(
        plan_spawn_prefab_action(payload, None),
        Err(SpawnPrefabActionPlanError::MissingSourceTransform),
    );
    assert_eq!(
        plan_spawn_prefab_action(payload, Some(source_t)),
        Ok(SpawnPrefabActionPlan {
            prefab_id: 7,
            projectile: None,
            placement: payload.placement(),
            transform: Transform2D { x: 48.0, y: 36.0 },
        }),
    );
    assert_eq!(
        plan_supported_spawn_prefab_action(
            payload,
            Some(source_t),
            SpawnPrefabSupport::Unsupported
        ),
        Err(SpawnPrefabActionPlanError::UnsupportedPrefab),
    );
    assert_eq!(
        plan_supported_spawn_prefab_action(payload, None, SpawnPrefabSupport::Unsupported),
        Err(SpawnPrefabActionPlanError::UnsupportedPrefab),
    );
    assert_eq!(
        plan_supported_spawn_prefab_action(payload, Some(source_t), SpawnPrefabSupport::Supported),
        Ok(SpawnPrefabActionPlan {
            prefab_id: 7,
            projectile: None,
            placement: payload.placement(),
            transform: Transform2D { x: 48.0, y: 36.0 },
        }),
    );
}

#[test]
fn spawn_prefab_core_data_combines_source_action_and_plan() {
    let source = Entity {
        id: 9,
        generation: 2,
    };
    let plan = SpawnPrefabActionPlan {
        prefab_id: 7,
        projectile: None,
        placement: SpawnPrefabPlacement {
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: 16.0,
            offset_y: -4.0,
        },
        transform: Transform2D { x: 48.0, y: 36.0 },
    };

    assert_eq!(
        spawn_prefab_core_data_from_plan(source, 13, plan),
        SpawnPrefabCoreData {
            source,
            action_id: 13,
            prefab_id: 7,
            projectile: None,
            transform: Transform2D { x: 48.0, y: 36.0 },
        },
    );
}

#[test]
fn prefab_spawned_event_payload_preserves_spawn_context() {
    let spawned = Entity {
        id: 21,
        generation: 3,
    };
    let source = Entity {
        id: 9,
        generation: 2,
    };

    assert_eq!(
        prefab_spawned_event_payload(spawned, source, 7, 13),
        PrefabSpawnedEventPayload {
            spawned,
            source,
            prefab_id: 7,
            action_id: 13,
        },
    );
}

#[test]
fn spawn_prefab_placement_collider_preserves_template_footprint() {
    let template = EntityTemplate::new(16.0, 16.0).with_collider(
        crate::world::EntityTemplateCollider::aabb(6.0, 8.0, 3.0, -2.0, false, true, None),
    );

    assert_eq!(
        spawn_prefab_placement_collider(template, CollisionLayer::Enemy),
        AabbCollider {
            half_width: 6.0,
            half_height: 8.0,
            offset_x: 3.0,
            offset_y: -2.0,
            enabled: false,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        },
    );
}

#[test]
fn spawn_prefab_placement_collider_uses_aabb_envelope_for_non_aabb_template() {
    let template =
        EntityTemplate::new(16.0, 16.0).with_collider(crate::world::EntityTemplateCollider {
            shape: crate::world::EntityTemplateColliderShape::Circle { radius: 5.0 },
            half_width: 0.0,
            half_height: 0.0,
            offset_x: -1.0,
            offset_y: 2.0,
            enabled: true,
            is_trigger: false,
            material: None,
        });

    assert_eq!(
        spawn_prefab_placement_collider(template, CollisionLayer::Enemy),
        AabbCollider {
            half_width: 5.0,
            half_height: 5.0,
            offset_x: -1.0,
            offset_y: 2.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Enemy,
        },
    );
}

#[test]
fn spawn_prefab_placement_query_reports_blocked_and_reuses_scratch() {
    let template = EntityTemplate::new(16.0, 16.0);
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 32.0, 32.0, 48.0, 48.0, true, vec![1]);
    let transform = Transform2D { x: 64.0, y: 64.0 };
    let mut contacts = Vec::new();

    assert!(spawn_prefab_placement_is_blocked_by_tilemap(
        &tilemap,
        template,
        transform,
        CollisionLayer::Enemy,
        &mut contacts,
    ));
    assert!(!contacts.is_empty());

    assert!(!spawn_prefab_placement_is_blocked_by_tilemap(
        &Tilemap::default(),
        template,
        transform,
        CollisionLayer::Enemy,
        &mut contacts,
    ));
    assert!(contacts.is_empty());
}

#[test]
fn spawn_prefab_pre_commit_gates_preserve_capacity_before_placement() {
    let mut placement_checked = false;

    assert_eq!(
        validate_spawn_prefab_pre_commit_gates(false, || {
            placement_checked = true;
            false
        }),
        Err(SpawnPrefabPreCommitError::SpawnQueueFull),
    );
    assert!(!placement_checked);

    assert_eq!(
        validate_spawn_prefab_pre_commit_gates(true, || true),
        Err(SpawnPrefabPreCommitError::BlockedPlacement),
    );
    assert_eq!(
        validate_spawn_prefab_pre_commit_gates(true, || false),
        Ok(()),
    );
}
