use super::*;

#[test]
fn collision_filter_defaults_to_spawn_layer_and_can_be_overridden() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(10.0, 20.0, 7);

    assert_eq!(
        world.collision_filter(enemy),
        Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
    );

    let filter = CollisionFilter::new(CollisionMask::ENEMY, CollisionMask::PLAYER);
    world.set_collision_filter(enemy, filter);

    assert_eq!(world.collision_filter(enemy), Some(filter));
}

#[test]
fn collider_material_is_collider_scoped_and_can_be_cleared() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let material =
        PhysicsMaterial::new(0.25, 0.75).with_surface_velocity(Velocity { vx: 3.0, vy: 0.0 });

    world.set_collider_material(entity, material);

    assert_eq!(world.collider_material(entity), None);

    world.set_aabb_collider(
        entity,
        AabbCollider::new(2.0, 3.0, false, CollisionLayer::Wall),
    );
    world.set_collider_material(entity, material);

    assert_eq!(world.collider_material(entity), Some(material));

    world.clear_collider_material(entity);
    assert_eq!(world.collider_material(entity), None);

    world.set_collider_material(entity, material);
    world.clear_collider(entity);

    assert_eq!(world.collider_material(entity), None);
}

#[test]
fn generic_component_setters_update_entity_components() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let transform = Transform2D { x: 4.0, y: 8.0 };
    let velocity = Velocity { vx: 2.0, vy: 3.0 };
    let rotation = Rotation2D { radians: 1.5 };
    let angular_velocity = AngularVelocity {
        radians_per_second: 2.0,
    };
    let collider = AabbCollider {
        half_width: 6.0,
        half_height: 7.0,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: false,
        layer: CollisionLayer::Enemy,
    };

    world.set_transform(entity, transform);
    world.set_velocity(entity, velocity);
    world.set_rotation(entity, rotation);
    world.set_angular_velocity(entity, angular_velocity);
    world.set_aabb_collider(entity, collider);
    world.set_rigid_body(entity, RigidBody::dynamic(2.0));

    assert_eq!(world.transform(entity), Some(transform));
    assert_eq!(world.velocity(entity), Some(velocity));
    assert_eq!(world.rotation(entity), Some(rotation));
    assert_eq!(world.angular_velocity(entity), Some(angular_velocity));
    assert_eq!(world.collider(entity), Some(collider));
    assert_eq!(
        world.rigid_body(entity).map(|body| body.body_type),
        Some(RigidBodyType::Dynamic)
    );
    assert_eq!(
        world.rigid_body(entity).map(|body| body.enabled),
        Some(true)
    );
    assert_eq!(
        world.collision_filter(entity),
        Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
    );
}

#[test]
fn gameplay_component_setters_update_movement_and_collision_reactions() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let movement = MovementPattern::Chase {
        target: MovementTarget::Player,
        speed: 90.0,
    };
    let action = ActionBinding::melee(7, 0.12, 32.0, 2.0);
    let interaction = Interaction::new(5, 32.0, true);
    let state_enter_action =
        BehaviorStateEnterAction::new(2, 7, BehaviorStateEnterActionPhase::NextFramePrePhysics);
    let mut machine = BehaviorStateMachine::new(1);
    assert!(machine.push_transition(BehaviorStateTransition::new(1, 2, 5)));

    world.set_movement_pattern(entity, movement);
    world.set_gameplay_tags(entity, GameplayTags::new(1 << 5).unwrap());
    assert!(world.upsert_action_binding(entity, action));
    assert!(world.set_interaction(entity, interaction));
    assert!(world.set_behavior_state_machine(entity, machine));
    assert!(world.add_behavior_state_enter_action(entity, state_enter_action));
    assert_eq!(world.movement_pattern(entity), Some(movement));
    assert_eq!(world.gameplay_tags(entity), GameplayTags::new(1 << 5));
    assert_eq!(
        world
            .action_bindings(entity)
            .map(|bindings| bindings.iter().collect::<Vec<_>>()),
        Some(vec![action])
    );
    assert_eq!(world.interaction(entity), Some(interaction));
    assert_eq!(world.behavior_state_machine(entity), Some(machine));
    assert_eq!(
        world
            .behavior_state_enter_actions(entity)
            .map(|actions| actions.iter_for_state(2).collect::<Vec<_>>()),
        Some(vec![state_enter_action])
    );
    assert!(world.add_behavior_state_transition(entity, BehaviorStateTransition::new(2, 3, 6),));
    assert_eq!(world.behavior_state_machine(entity).unwrap().len(), 2);

    assert!(world.add_collision_reaction(
        entity,
        CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        },
    ));
    assert!(world.add_collision_reaction(
        entity,
        CollisionReaction::Despawn {
            target: CollisionTarget::SelfEntity,
        },
    ));

    let reactions = world.collision_reactions(entity).unwrap();
    assert_eq!(reactions.len(), 2);
    assert_eq!(
        reactions.iter().collect::<Vec<_>>(),
        vec![
            CollisionReaction::Damage {
                target: CollisionTarget::OtherEntity,
            },
            CollisionReaction::Despawn {
                target: CollisionTarget::SelfEntity,
            },
        ]
    );

    world.clear_movement_pattern(entity);
    world.clear_gameplay_tags(entity);
    world.clear_action_bindings(entity);
    world.clear_interaction(entity);
    world.clear_collision_reactions(entity);
    world.clear_behavior_state_machine(entity);
    world.clear_behavior_state_enter_actions(entity);
    assert_eq!(world.movement_pattern(entity), None);
    assert_eq!(world.gameplay_tags(entity), None);
    assert_eq!(world.action_bindings(entity), None);
    assert_eq!(world.interaction(entity), None);
    assert_eq!(world.collision_reactions(entity), None);
    assert_eq!(world.behavior_state_machine(entity), None);
    assert_eq!(world.behavior_state_enter_actions(entity), None);
}

#[test]
fn gameplay_query_indices_follow_faction_and_tag_mutations() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let index = entity.id as usize;
    let faction_a = GameplayFaction::new(5, 0).unwrap();
    let faction_b = GameplayFaction::new(6, 0).unwrap();
    let tags_a = GameplayTags::new((1 << 5) | (1 << 6)).unwrap();
    let tags_b = GameplayTags::new((1 << 6) | (1 << 7)).unwrap();

    world.set_gameplay_faction(entity, faction_a);
    world.set_gameplay_tags(entity, tags_a);

    assert_eq!(world.gameplay_faction_query_indices(5), &[index]);
    assert_eq!(world.gameplay_faction_query_indices(6), &[]);
    assert_eq!(world.gameplay_tag_query_indices(5), &[index]);
    assert_eq!(world.gameplay_tag_query_indices(6), &[index]);
    assert_eq!(world.gameplay_tag_query_indices(7), &[]);

    world.set_gameplay_faction(entity, faction_b);
    world.set_gameplay_tags(entity, tags_b);

    assert_eq!(world.gameplay_faction_query_indices(5), &[]);
    assert_eq!(world.gameplay_faction_query_indices(6), &[index]);
    assert_eq!(world.gameplay_tag_query_indices(5), &[]);
    assert_eq!(world.gameplay_tag_query_indices(6), &[index]);
    assert_eq!(world.gameplay_tag_query_indices(7), &[index]);

    world.clear_gameplay_faction(entity);
    world.clear_gameplay_tags(entity);

    assert_eq!(world.gameplay_faction_query_indices(6), &[]);
    assert_eq!(world.gameplay_tag_query_indices(6), &[]);
    assert_eq!(world.gameplay_tag_query_indices(7), &[]);
}

#[test]
fn gameplay_query_indices_remove_despawned_and_reused_entities() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let index = entity.id as usize;

    world.set_gameplay_faction(entity, GameplayFaction::new(5, 0).unwrap());
    world.set_gameplay_tags(entity, GameplayTags::new(1 << 5).unwrap());
    assert_eq!(world.gameplay_faction_query_indices(5), &[index]);
    assert_eq!(world.gameplay_tag_query_indices(5), &[index]);

    world.despawn(entity);
    assert_eq!(world.gameplay_faction_query_indices(5), &[]);
    assert_eq!(world.gameplay_tag_query_indices(5), &[]);

    let reused = world.spawn_entity();
    assert_eq!(reused.id as usize, index);
    world.set_gameplay_faction(reused, GameplayFaction::new(5, 0).unwrap());
    world.set_gameplay_tags(reused, GameplayTags::new(1 << 5).unwrap());

    assert_eq!(world.gameplay_faction_query_indices(5), &[index]);
    assert_eq!(world.gameplay_tag_query_indices(5), &[index]);
}

#[test]
fn gameplay_query_indices_track_projectile_source_faction() {
    let mut world = World::default();
    let faction = GameplayFaction::new(5, 0).unwrap();

    let projectile = world.spawn_projectile_from_request(ProjectileSpawnRequest {
        transform: Transform2D { x: 4.0, y: 8.0 },
        velocity: Velocity { vx: 1.0, vy: 2.0 },
        texture_id: 7,
        lifetime: 1.5,
        template: DEFAULT_BULLET_TEMPLATE,
        damage: 2.0,
        collision_target: ProjectileCollisionTarget::Enemies,
        tile_impact: ProjectileTileImpact::Despawn,
        source_faction: Some(faction),
    });

    assert_eq!(world.gameplay_faction(projectile), Some(faction));
    assert_eq!(
        world.gameplay_faction_query_indices(5),
        &[projectile.id as usize]
    );
}

#[test]
fn lifetime_and_projectile_policy_components_mirror_legacy_storage() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let index = entity.id as usize;
    let policy = ProjectilePolicy::new(
        ProjectileCollisionTarget::Player,
        ProjectileTileImpact::Bounce,
    );

    assert!(world.set_gameplay_lifetime_at(index, 1.5));
    assert!(world.set_projectile_policy_at(index, policy));

    assert_eq!(world.lifetimes[index], Some(GameplayLifetime::new(1.5)));
    assert_eq!(world.bullet_lifetimes[index], Some(1.5));
    assert_eq!(world.projectile_policies[index], Some(policy));
    assert_eq!(
        world.projectile_collision_targets[index],
        Some(ProjectileCollisionTarget::Player)
    );
    assert_eq!(
        world.projectile_tile_impacts[index],
        Some(ProjectileTileImpact::Bounce)
    );
    assert_eq!(world.gameplay_lifetime_at(index), Some(1.5));
    assert_eq!(
        world.projectile_collision_target_at(index),
        ProjectileCollisionTarget::Player
    );
    assert_eq!(
        world.projectile_tile_impact_at(index),
        ProjectileTileImpact::Bounce
    );
}

#[test]
fn lifetime_helper_syncs_legacy_direct_writes_to_component_storage() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let index = entity.id as usize;

    world.bullet_lifetimes[index] = Some(0.75);

    assert_eq!(world.tick_gameplay_lifetime_at(index, 0.25), Some(0.5));
    assert_eq!(world.lifetimes[index], Some(GameplayLifetime::new(0.5)));
    assert_eq!(world.bullet_lifetimes[index], Some(0.5));
}

#[test]
fn world_ticks_and_triggers_action_binding_cooldowns() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let action = ActionBinding::projectile(7, 0.12, 420.0, 2.0, 1.5);
    assert!(world.upsert_action_binding(entity, action));

    assert_eq!(world.action_binding(entity, 7), Some(action));
    assert_eq!(
        world.commit_action_cooldown_if_ready(entity, 7),
        Some(action)
    );
    assert_eq!(world.commit_action_cooldown_if_ready(entity, 7), None);

    world.tick_action_cooldowns(0.06);
    assert_eq!(world.commit_action_cooldown_if_ready(entity, 7), None);

    world.tick_action_cooldowns(0.06);
    let triggered = world.commit_action_cooldown_if_ready(entity, 7).unwrap();
    assert_eq!(triggered.action_id, action.action_id);
    assert_eq!(triggered.pattern, action.pattern);
}

#[test]
fn set_rigid_body_fills_missing_motion_components_without_overwriting_existing_values() {
    let mut world = World::default();
    let existing = world.spawn_entity();
    let missing = world.spawn_entity();
    let velocity = Velocity { vx: 2.0, vy: 3.0 };
    let rotation = Rotation2D { radians: 1.5 };
    let angular_velocity = AngularVelocity {
        radians_per_second: 2.0,
    };

    world.set_velocity(existing, velocity);
    world.set_rotation(existing, rotation);
    world.set_angular_velocity(existing, angular_velocity);

    world.set_rigid_body(existing, RigidBody::dynamic(2.0));
    world.set_rigid_body(missing, RigidBody::dynamic(4.0));

    assert_eq!(world.velocity(existing), Some(velocity));
    assert_eq!(world.rotation(existing), Some(rotation));
    assert_eq!(world.angular_velocity(existing), Some(angular_velocity));
    assert_eq!(world.velocity(missing), Some(Velocity::default()));
    assert_eq!(world.rotation(missing), Some(Rotation2D::default()));
    assert_eq!(
        world.angular_velocity(missing),
        Some(AngularVelocity::default())
    );
}

#[test]
fn rigid_body_force_and_impulse_accumulate_on_component() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_rigid_body(entity, RigidBody::dynamic(4.0));

    world.apply_force(entity, Velocity { vx: 8.0, vy: -2.0 });
    world.apply_impulse(entity, Velocity { vx: 4.0, vy: 1.0 });

    let body = world.rigid_body(entity).unwrap();
    assert_eq!(body.force, Velocity { vx: 8.0, vy: -2.0 });
    assert_eq!(body.impulse, Velocity { vx: 4.0, vy: 1.0 });
}

#[test]
fn disabled_rigid_body_ignores_force_and_impulse_accumulation() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_rigid_body(entity, RigidBody::dynamic(4.0).with_enabled(false));

    world.apply_force(entity, Velocity { vx: 8.0, vy: -2.0 });
    world.apply_impulse(entity, Velocity { vx: 4.0, vy: 1.0 });

    let body = world.rigid_body(entity).unwrap();
    assert!(!body.enabled);
    assert_eq!(body.force, Velocity::default());
    assert_eq!(body.impulse, Velocity::default());
}

#[test]
fn non_dynamic_rigid_body_ignores_force_and_impulse_accumulation() {
    let mut world = World::default();
    let static_entity = world.spawn_entity();
    let kinematic_entity = world.spawn_entity();
    world.set_rigid_body(static_entity, RigidBody::static_body());
    world.set_rigid_body(kinematic_entity, RigidBody::kinematic());

    for entity in [static_entity, kinematic_entity] {
        world.apply_force(entity, Velocity { vx: 8.0, vy: -2.0 });
        world.apply_impulse(entity, Velocity { vx: 4.0, vy: 1.0 });
        let body = world.rigid_body(entity).unwrap();
        assert_eq!(body.force, Velocity::default());
        assert_eq!(body.impulse, Velocity::default());
    }
}

#[test]
fn rigid_body_torque_and_angular_impulse_accumulate_on_component() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_rigid_body(entity, RigidBody::dynamic(4.0));

    world.apply_torque(entity, 8.0);
    world.apply_angular_impulse(entity, 2.0);
    world.apply_torque(entity, f32::NAN);
    world.apply_angular_impulse(entity, f32::INFINITY);

    let body = world.rigid_body(entity).unwrap();
    assert_eq!(body.torque, 8.0);
    assert_eq!(body.angular_impulse, 2.0);
}

#[test]
fn disabled_rigid_body_ignores_torque_and_angular_impulse_accumulation() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_rigid_body(entity, RigidBody::dynamic(4.0).with_enabled(false));

    world.apply_torque(entity, 8.0);
    world.apply_angular_impulse(entity, 2.0);

    let body = world.rigid_body(entity).unwrap();
    assert!(!body.enabled);
    assert_eq!(body.torque, 0.0);
    assert_eq!(body.angular_impulse, 0.0);
}
