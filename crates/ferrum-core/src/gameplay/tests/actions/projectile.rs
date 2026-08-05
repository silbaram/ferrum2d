use super::*;

#[test]
fn prepare_projectile_action_payload_returns_payload_after_readiness_checks() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::projectile_with_target(
        31,
        0.5,
        ProjectileActionConfig {
            speed: 120.0,
            damage: 2.0,
            lifetime_seconds: 3.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
        },
    );

    assert_eq!(
        prepare_projectile_action_payload(&world, source, 31),
        Err(ActionReadiness::Missing),
    );
    assert!(world.upsert_action_binding(source, ActionBinding::dash(31, 0.5, 96.0)));
    assert_eq!(
        prepare_projectile_action_payload(&world, source, 31),
        Err(ActionReadiness::PatternMismatch),
    );
    assert!(world.upsert_action_binding(source, action));
    assert_eq!(
        prepare_projectile_action_payload(&world, source, 31),
        Ok(ProjectileActionPayload {
            speed: 120.0,
            damage: 2.0,
            lifetime_seconds: 3.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
        }),
    );
    assert_eq!(
        world
            .action_binding(source, 31)
            .expect("projectile binding should still exist")
            .cooldown
            .remaining_seconds,
        0.0,
    );
    assert!(commit_prepared_action(
        &mut world,
        prepared_action(source, action)
    ));
    assert_eq!(
        prepare_projectile_action_payload(&world, source, 31),
        Err(ActionReadiness::CoolingDown),
    );
}

#[test]
fn plan_projectile_action_toward_target_plans_spawn_transform_without_mutation() {
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
    let payload = ProjectileActionPayload {
        speed: 120.0,
        damage: 2.0,
        lifetime_seconds: 3.0,
        aim: ActionAimSource::TargetPlayer,
        collision_target: ProjectileCollisionTarget::Player,
        tile_impact: ProjectileTileImpact::Bounce,
    };

    assert_eq!(
        plan_projectile_action_toward_target(
            ProjectileActionPayload {
                aim: ActionAimSource::Input,
                ..payload
            },
            source,
            source_t,
            Some((target, target_t)),
            12.0,
        ),
        Err(ProjectileActionPlanError::UnsupportedAimSource),
    );
    assert_eq!(
        validate_projectile_action_support(ProjectileActionPayload {
            aim: ActionAimSource::Input,
            ..payload
        }),
        Err(ProjectileActionPlanError::UnsupportedAimSource),
    );
    assert_eq!(
        plan_projectile_action_toward_target(
            ProjectileActionPayload {
                collision_target: ProjectileCollisionTarget::Enemies,
                ..payload
            },
            source,
            source_t,
            Some((target, target_t)),
            12.0,
        ),
        Err(ProjectileActionPlanError::UnsupportedCollisionTarget),
    );
    assert_eq!(
        validate_projectile_action_support(ProjectileActionPayload {
            collision_target: ProjectileCollisionTarget::Enemies,
            ..payload
        }),
        Err(ProjectileActionPlanError::UnsupportedCollisionTarget),
    );
    assert_eq!(validate_projectile_action_support(payload), Ok(()));
    assert_eq!(
        plan_projectile_action_toward_target(payload, source, source_t, None, 12.0),
        Err(ProjectileActionPlanError::MissingActionTarget),
    );
    assert_eq!(
        plan_projectile_action_toward_target(
            payload,
            source,
            source_t,
            Some((source, source_t)),
            12.0,
        ),
        Err(ProjectileActionPlanError::MissingActionTarget),
    );
    assert_eq!(
        plan_projectile_action_toward_target(
            payload,
            source,
            source_t,
            Some((target, source_t)),
            12.0,
        ),
        Err(ProjectileActionPlanError::MissingActionTarget),
    );

    let planned = plan_projectile_action_toward_target(
        payload,
        source,
        source_t,
        Some((target, target_t)),
        14.0,
    )
    .expect("target-player projectile should produce direction");
    assert!((planned.direction_x + 1.0).abs() < 0.001);
    assert!(planned.direction_y.abs() < 0.001);
    assert!((planned.transform.x - 86.0).abs() < 0.001);
    assert!(planned.transform.y.abs() < 0.001);
    assert!((planned.velocity.vx + 120.0).abs() < 0.001);
    assert!(planned.velocity.vy.abs() < 0.001);

    let diagonal = plan_projectile_action_toward_target(
        ProjectileActionPayload {
            speed: 10.0,
            ..payload
        },
        source,
        Transform2D { x: 0.0, y: 0.0 },
        Some((target, Transform2D { x: 3.0, y: 4.0 })),
        10.0,
    )
    .expect("3-4-5 target direction should normalize");
    assert!((diagonal.direction_x - 0.6).abs() < 0.001);
    assert!((diagonal.direction_y - 0.8).abs() < 0.001);
    assert!((diagonal.transform.x - 6.0).abs() < 0.001);
    assert!((diagonal.transform.y - 8.0).abs() < 0.001);
    assert!((diagonal.velocity.vx - 6.0).abs() < 0.001);
    assert!((diagonal.velocity.vy - 8.0).abs() < 0.001);
}

#[test]
fn plan_input_projectile_action_plans_spawn_transform_and_velocity() {
    let payload = ProjectileActionPayload {
        speed: 120.0,
        damage: 2.0,
        lifetime_seconds: 3.0,
        aim: ActionAimSource::Input,
        collision_target: ProjectileCollisionTarget::Enemies,
        tile_impact: ProjectileTileImpact::Despawn,
    };
    let source_t = Transform2D { x: 10.0, y: 20.0 };

    assert_eq!(
        plan_input_projectile_action(
            ProjectileActionPayload {
                aim: ActionAimSource::TargetPlayer,
                ..payload
            },
            source_t,
            Transform2D { x: 13.0, y: 24.0 },
            8.0,
        ),
        Err(ProjectileActionPlanError::UnsupportedAimSource),
    );
    assert_eq!(
        plan_input_projectile_action(
            ProjectileActionPayload {
                collision_target: ProjectileCollisionTarget::Player,
                ..payload
            },
            source_t,
            Transform2D { x: 13.0, y: 24.0 },
            8.0,
        ),
        Err(ProjectileActionPlanError::UnsupportedCollisionTarget),
    );

    let planned =
        plan_input_projectile_action(payload, source_t, Transform2D { x: 13.0, y: 24.0 }, 10.0)
            .expect("input projectile should produce spawn plan");
    assert!((planned.direction_x - 0.6).abs() < 0.001);
    assert!((planned.direction_y - 0.8).abs() < 0.001);
    assert!((planned.transform.x - 16.0).abs() < 0.001);
    assert!((planned.transform.y - 28.0).abs() < 0.001);
    assert!((planned.velocity.vx - 72.0).abs() < 0.001);
    assert!((planned.velocity.vy - 96.0).abs() < 0.001);

    let fallback = plan_input_projectile_action(payload, source_t, source_t, 10.0)
        .expect("zero target direction should use +X fallback");
    assert!((fallback.direction_x - 1.0).abs() < 0.001);
    assert!(fallback.direction_y.abs() < 0.001);
    assert!((fallback.transform.x - 20.0).abs() < 0.001);
    assert!((fallback.transform.y - 20.0).abs() < 0.001);
    assert!((fallback.velocity.vx - 120.0).abs() < 0.001);
    assert!(fallback.velocity.vy.abs() < 0.001);
}

#[test]
fn projectile_planners_return_shared_spawn_plan_type() {
    let source = Entity {
        id: 1,
        generation: 1,
    };
    let target = Entity {
        id: 2,
        generation: 1,
    };
    let source_t = Transform2D { x: 0.0, y: 0.0 };
    let target_t = Transform2D { x: 4.0, y: 0.0 };
    let queued_payload = ProjectileActionPayload {
        speed: 10.0,
        damage: 1.0,
        lifetime_seconds: 1.0,
        aim: ActionAimSource::TargetPlayer,
        collision_target: ProjectileCollisionTarget::Player,
        tile_impact: ProjectileTileImpact::Despawn,
    };
    let input_payload = ProjectileActionPayload {
        aim: ActionAimSource::Input,
        collision_target: ProjectileCollisionTarget::Enemies,
        ..queued_payload
    };

    let _: ProjectileSpawnPlan = plan_projectile_action_toward_target(
        queued_payload,
        source,
        source_t,
        Some((target, target_t)),
        8.0,
    )
    .expect("queued projectile planner should return shared spawn plan");
    let _: ProjectileSpawnPlan =
        plan_input_projectile_action(input_payload, source_t, target_t, 8.0)
            .expect("input projectile planner should return shared spawn plan");
}

#[test]
fn projectile_spawn_core_data_combines_plan_and_payload_without_scene_fields() {
    let payload = ProjectileActionPayload {
        speed: 120.0,
        damage: 2.0,
        lifetime_seconds: 3.0,
        aim: ActionAimSource::Input,
        collision_target: ProjectileCollisionTarget::Enemies,
        tile_impact: ProjectileTileImpact::Bounce,
    };
    let plan = ProjectileSpawnPlan {
        direction_x: 1.0,
        direction_y: 0.0,
        transform: Transform2D { x: 10.0, y: 20.0 },
        velocity: Velocity { vx: 120.0, vy: 0.0 },
    };

    assert_eq!(
        projectile_spawn_core_data_from_plan(plan, payload),
        ProjectileSpawnCoreData {
            transform: Transform2D { x: 10.0, y: 20.0 },
            velocity: Velocity { vx: 120.0, vy: 0.0 },
            lifetime_seconds: 3.0,
            damage: 2.0,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Bounce,
        },
    );
}

#[test]
fn spawn_projectile_entity_spawns_bullet_and_applies_arc() {
    let mut world = World::default();
    let arc = ProjectileArc::new(
        crate::components::PhysicsFloorId(2),
        6.0,
        3.0,
        4.0,
        9.8,
        1.5,
    )
    .expect("test projectile arc values are finite and valid");
    let request = ProjectileSpawnRequest {
        transform: Transform2D { x: 10.0, y: 20.0 },
        velocity: Velocity { vx: 30.0, vy: 0.0 },
        texture_id: 4,
        lifetime: 2.0,
        template: EntityTemplate::new(6.0, 8.0),
        damage: 3.0,
        collision_target: ProjectileCollisionTarget::Enemies,
        tile_impact: ProjectileTileImpact::Bounce,
        source_faction: None,
    };

    let result = spawn_projectile_entity(
        &mut world,
        ProjectileEntitySpawnData {
            request,
            arc: Some(arc),
        },
    );

    assert_eq!(
        result,
        ProjectileEntitySpawnResult {
            spawned: Entity {
                id: 0,
                generation: world
                    .generation_at_index(0)
                    .expect("test entity index should exist"),
            },
            arc_applied: true,
        }
    );
    assert_eq!(world.collider_layer_at(0), Some(CollisionLayer::Bullet));
    assert_eq!(world.transform(result.spawned), Some(request.transform));
    assert_eq!(world.velocity(result.spawned), Some(request.velocity));
    assert_eq!(world.projectile_arc(result.spawned), Some(arc));
    assert_eq!(world.height_span(result.spawned), arc.height_span());
}

#[test]
fn spawn_prefab_enemy_entity_spawns_enemy_from_data() {
    let mut world = World::default();
    let data = PrefabEnemyEntitySpawnData {
        transform: Transform2D { x: 12.0, y: 24.0 },
        texture_id: 5,
        template: EntityTemplate::new(14.0, 18.0),
        health: 9.0,
        score_reward: 13,
    };

    let result = spawn_prefab_enemy_entity(&mut world, data);
    let spawned_index = result.spawned.id as usize;

    assert_eq!(
        result,
        PrefabEnemyEntitySpawnResult {
            spawned: Entity {
                id: spawned_index as u32,
                generation: world
                    .generation_at_index(spawned_index)
                    .expect("test entity index should exist"),
            },
        }
    );
    assert_eq!(
        world.collider_layer_at(spawned_index),
        Some(CollisionLayer::Enemy)
    );
    assert_eq!(world.transform(result.spawned), Some(data.transform));
    assert_eq!(world.health_at_index(spawned_index), Some(data.health));
    assert_eq!(
        world.score_reward_at_index(spawned_index),
        Some(data.score_reward)
    );
}
