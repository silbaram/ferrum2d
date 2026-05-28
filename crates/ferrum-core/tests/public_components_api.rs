use ferrum_core::{components, AabbCollider, CollisionLayer, PhysicsMaterial, RigidBody, Velocity};

#[test]
fn physics_material_reexport_is_shared_by_body_and_compound_collider_api() {
    let material = PhysicsMaterial::new(0.25, 0.75)
        .with_density(2.0)
        .with_surface_velocity(Velocity { vx: 3.0, vy: 0.0 });
    let component_material: components::PhysicsMaterial = material;

    let body = RigidBody::dynamic_box_with_material(component_material, 4.0, 2.0);
    let compound = components::CompoundCollider::new(components::CompoundColliderShape::Aabb(
        AabbCollider::new(2.0, 1.0, false, CollisionLayer::Wall),
    ))
    .with_material(material);

    assert_eq!(body.material, material);
    assert_eq!(compound.material, Some(component_material));
    assert_eq!(
        PhysicsMaterial::default(),
        components::PhysicsMaterial::DEFAULT
    );
}
