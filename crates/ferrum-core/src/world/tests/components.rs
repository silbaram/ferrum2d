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
