use super::*;
use crate::components::{CompoundColliderShapeRef, MAX_CHAIN_COLLIDER_VERTICES};

#[test]
fn circle_collider_setter_replaces_aabb_and_defaults_filter() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let aabb = AabbCollider {
        half_width: 6.0,
        half_height: 7.0,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: false,
        layer: CollisionLayer::Enemy,
    };
    let circle = CircleCollider {
        radius: 5.0,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: true,
        layer: CollisionLayer::Player,
    };

    world.set_aabb_collider(entity, aabb);
    world.clear_collider(entity);
    world.set_circle_collider(entity, circle);

    assert_eq!(world.collider(entity), None);
    assert_eq!(world.circle_collider(entity), Some(circle));
    assert_eq!(
        world.collision_filter(entity),
        Some(CollisionFilter::from_layer(CollisionLayer::Player))
    );
}

#[test]
fn capsule_collider_setter_replaces_other_colliders_and_defaults_filter() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let aabb = AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy);
    let circle = CircleCollider::new(5.0, true, CollisionLayer::Player);
    let capsule = CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 2.0, true, CollisionLayer::Enemy);

    world.set_aabb_collider(entity, aabb);
    world.set_circle_collider(entity, circle);
    world.clear_collider(entity);
    world.set_capsule_collider(entity, capsule);

    assert_eq!(world.collider(entity), None);
    assert_eq!(world.circle_collider(entity), None);
    assert_eq!(world.capsule_collider(entity), Some(capsule));
    assert_eq!(
        world.collision_filter(entity),
        Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
    );
}

#[test]
fn edge_collider_setter_replaces_other_colliders_and_defaults_filter() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let aabb = AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy);
    let circle = CircleCollider::new(5.0, true, CollisionLayer::Player);
    let edge = EdgeCollider::new(-4.0, 0.0, 4.0, 0.0, true, CollisionLayer::Wall);

    world.set_aabb_collider(entity, aabb);
    world.set_circle_collider(entity, circle);
    world.clear_collider(entity);
    world.set_edge_collider(entity, edge);

    assert_eq!(world.collider(entity), None);
    assert_eq!(world.circle_collider(entity), None);
    assert_eq!(world.capsule_collider(entity), None);
    assert_eq!(world.edge_collider(entity), Some(edge));
    assert_eq!(
        world.collision_filter(entity),
        Some(CollisionFilter::from_layer(CollisionLayer::Wall))
    );
}

#[test]
fn oriented_box_collider_setter_replaces_other_colliders_and_defaults_filter() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let aabb = AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy);
    let circle = CircleCollider::new(5.0, true, CollisionLayer::Player);
    let capsule = CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 2.0, true, CollisionLayer::Enemy);
    let oriented_box = OrientedBoxCollider::new(
        6.0,
        2.0,
        core::f32::consts::FRAC_PI_4,
        false,
        CollisionLayer::Wall,
    );

    world.set_aabb_collider(entity, aabb);
    world.set_circle_collider(entity, circle);
    world.set_capsule_collider(entity, capsule);
    world.clear_collider(entity);
    world.set_oriented_box_collider(entity, oriented_box);

    assert_eq!(world.collider(entity), None);
    assert_eq!(world.circle_collider(entity), None);
    assert_eq!(world.capsule_collider(entity), None);
    assert_eq!(world.oriented_box_collider(entity), Some(oriented_box));
    assert_eq!(
        world.collision_filter(entity),
        Some(CollisionFilter::from_layer(CollisionLayer::Wall))
    );
}

#[test]
fn convex_polygon_collider_setter_replaces_other_colliders_and_defaults_filter() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let aabb = AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy);
    let circle = CircleCollider::new(5.0, true, CollisionLayer::Player);
    let capsule = CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 2.0, true, CollisionLayer::Enemy);
    let oriented_box = OrientedBoxCollider::new(
        6.0,
        2.0,
        core::f32::consts::FRAC_PI_4,
        false,
        CollisionLayer::Wall,
    );
    let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    vertices[0] = Transform2D { x: -1.0, y: -1.0 };
    vertices[1] = Transform2D { x: 1.0, y: -1.0 };
    vertices[2] = Transform2D { x: 1.0, y: 1.0 };
    vertices[3] = Transform2D { x: -1.0, y: 1.0 };
    let polygon = ConvexPolygonCollider::new(vertices, 4, true, CollisionLayer::Enemy);

    world.set_aabb_collider(entity, aabb);
    world.set_circle_collider(entity, circle);
    world.set_capsule_collider(entity, capsule);
    world.set_oriented_box_collider(entity, oriented_box);
    world.clear_collider(entity);
    world.set_convex_polygon_collider(entity, polygon);

    assert_eq!(world.collider(entity), None);
    assert_eq!(world.circle_collider(entity), None);
    assert_eq!(world.capsule_collider(entity), None);
    assert_eq!(world.oriented_box_collider(entity), None);
    assert_eq!(world.convex_polygon_collider(entity), Some(polygon));
    assert_eq!(
        world.collision_filter(entity),
        Some(CollisionFilter::from_layer(CollisionLayer::Enemy))
    );
}

#[test]
fn large_collider_ref_getters_match_owned_getters() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let mut chain_vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CHAIN_COLLIDER_VERTICES];
    chain_vertices[0] = Transform2D { x: -2.0, y: 0.0 };
    chain_vertices[1] = Transform2D { x: 0.0, y: 1.0 };
    chain_vertices[2] = Transform2D { x: 2.0, y: 0.0 };
    let chain = ChainCollider::new(chain_vertices, 3, false, true, CollisionLayer::Wall)
        .with_offset(1.0, -1.0);

    world.set_chain_collider(entity, chain);

    assert_eq!(world.chain_collider(entity), Some(chain));
    assert_eq!(world.chain_collider_ref(entity), Some(&chain));

    let mut polygon_vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    polygon_vertices[0] = Transform2D { x: -1.0, y: -1.0 };
    polygon_vertices[1] = Transform2D { x: 1.0, y: -1.0 };
    polygon_vertices[2] = Transform2D { x: 1.0, y: 1.0 };
    polygon_vertices[3] = Transform2D { x: -1.0, y: 1.0 };
    let polygon = ConvexPolygonCollider::new(polygon_vertices, 4, false, CollisionLayer::Enemy)
        .with_offset(-2.0, 3.0);

    world.set_convex_polygon_collider(entity, polygon);

    assert_eq!(world.convex_polygon_collider(entity), Some(polygon));
    assert_eq!(world.convex_polygon_collider_ref(entity), Some(&polygon));
}

#[test]
fn compound_collider_ref_at_preserves_primary_fallback_metadata() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CHAIN_COLLIDER_VERTICES];
    vertices[0] = Transform2D { x: -3.0, y: 0.0 };
    vertices[1] = Transform2D { x: 0.0, y: 2.0 };
    vertices[2] = Transform2D { x: 3.0, y: 0.0 };
    let chain = ChainCollider::new(vertices, 3, true, true, CollisionLayer::Wall);
    let material = PhysicsMaterial::new(0.25, 0.75);
    let filter = CollisionFilter::new(CollisionMask::PLAYER, CollisionMask::WALL);

    world.set_chain_collider(entity, chain);
    world.set_collider_material(entity, material);
    world.set_collision_filter(entity, filter);
    world.compound_colliders[entity.id as usize].clear();

    let collider = world
        .compound_collider_ref_at(entity.id as usize, 0)
        .expect("primary collider fallback should be available");

    assert_eq!(collider.material(), Some(material));
    assert_eq!(collider.filter(), Some(filter));
    assert_eq!(collider.layer(), CollisionLayer::Wall);
    assert!(collider.is_trigger());
    match collider.shape {
        CompoundColliderShapeRef::Chain(actual) => assert_eq!(*actual, chain),
        _ => panic!("expected chain compound collider ref"),
    }
}
