use super::*;

#[test]
fn spawn_from_template_applies_sprite_and_collider_sizes() {
    let mut world = World::default();
    let material =
        PhysicsMaterial::new(0.2, 0.8).with_surface_velocity(Velocity { vx: 2.0, vy: 0.0 });
    let template = EntityTemplate::new(48.0, 30.0).with_collider(EntityTemplateCollider::aabb(
        10.0,
        12.0,
        3.0,
        -2.0,
        false,
        false,
        Some(material),
    ));

    let enemy = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 3.0, 2);

    assert_eq!(world.sprites[enemy.id as usize].unwrap().width, 48.0);
    assert_eq!(world.sprites[enemy.id as usize].unwrap().height, 30.0);
    let collider = world.colliders[enemy.id as usize].unwrap();
    assert_eq!(collider.half_width, 10.0);
    assert_eq!(collider.half_height, 12.0);
    assert_eq!(collider.offset_x, 3.0);
    assert_eq!(collider.offset_y, -2.0);
    assert!(!collider.enabled);
    assert!(!collider.is_trigger);
    assert_eq!(world.collider_material(enemy), Some(material));
    assert_eq!(world.healths[enemy.id as usize], Some(3.0));
    assert_eq!(world.score_rewards[enemy.id as usize], Some(2));
}

#[test]
fn spawn_from_template_applies_non_aabb_collider_shape() {
    let mut world = World::default();
    let material = PhysicsMaterial::new(0.1, 0.6);
    let template = EntityTemplate::new(32.0, 28.0).with_collider(EntityTemplateCollider {
        shape: EntityTemplateColliderShape::Capsule {
            start_x: -6.0,
            start_y: 0.0,
            end_x: 6.0,
            end_y: 0.0,
            radius: 4.0,
        },
        half_width: 0.0,
        half_height: 0.0,
        offset_x: 1.0,
        offset_y: -1.0,
        enabled: true,
        is_trigger: false,
        material: Some(material),
    });

    let enemy = world.spawn_enemy_from_template(10.0, 20.0, 7, template, 3.0, 2);
    let index = enemy.id as usize;

    assert!(world.colliders[index].is_none());
    let collider = world.capsule_colliders[index].unwrap();
    assert_eq!(collider.start_x, -6.0);
    assert_eq!(collider.end_x, 6.0);
    assert_eq!(collider.radius, 4.0);
    assert_eq!(collider.offset_x, 1.0);
    assert_eq!(collider.offset_y, -1.0);
    assert!(!collider.is_trigger);
    assert_eq!(collider.layer, CollisionLayer::Enemy);
    assert_eq!(world.collider_layer_at(index), Some(CollisionLayer::Enemy));
    assert_eq!(world.collider_material(enemy), Some(material));
}
