use super::*;
use crate::components::{
    CircleCollider, CollisionFilter, CollisionLayer, CollisionMask, CompoundCollider,
    CompoundColliderShape, RigidBody,
};
use crate::physics3d::{BodyKind, QueryFilter, RayCast, Shape};

fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn authored(e: &mut Engine, x: f32) -> Entity {
    let entity = e.world.spawn_entity();
    e.world.set_transform(entity, Transform2D { x, y: 0.0 });
    e.world.set_circle_collider(
        entity,
        CircleCollider::new(0.5, false, CollisionLayer::Wall),
    );
    entity
}
fn ray(e: &mut Engine) -> u32 {
    e.raycast_bodies(0.0, 0.0, 7.0, 0.0, 100.0, u32::MAX)
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 1e-4, "{a} != {b}");
}

#[test]
fn explicit_native_geometry_is_queried_without_render_anchor_offsets() {
    let mut e = engine(Space::PlanarXy);
    let entity = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [10.0, 4.0, 0.0],
        )
        .unwrap();
    assert_eq!(ray(&mut e), 1); // No legacy collider component exists for this body.
    assert_eq!(e.physics_raycast_hits[0].entity_id, entity.id);
    near(e.physics_raycast_hits[0].distance, 1.5);
    near(e.physics_raycast_hits[0].point_x, 1.5);
    near(e.physics_raycast_hits[0].normal_x, -1.0);
    assert_eq!(e.query_point_bodies(2.0, 0.0, u32::MAX), 1);
    assert_eq!(e.query_point_bodies(12.0, 4.0, u32::MAX), 0);
    assert_eq!(e.segment_cast_bodies(0.0, 0.0, 1.4, 0.0, u32::MAX), 0);
    assert_eq!(e.segment_cast_bodies(0.0, 0.0, 1.6, 0.0, u32::MAX), 1);
    e.set_unified_body_pose(
        entity,
        Pose {
            position: [5.0, 0.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    assert_eq!(ray(&mut e), 1);
    near(e.physics_raycast_hits[0].distance, 4.5);
}

#[test]
fn query_imports_authored_edits_without_consuming_inputs_or_advancing_time() {
    let mut e = engine(Space::PlanarXy);
    let entity = authored(&mut e, 2.0);
    e.world
        .set_rigid_body(entity, RigidBody::dynamic(2.0).with_inertia(4.0));
    e.world.apply_impulse(entity, Velocity { vx: 4.0, vy: 0.0 });
    e.world.apply_force(entity, Velocity { vx: 12.0, vy: 0.0 });
    e.world.apply_angular_impulse(entity, 8.0);
    e.world.apply_torque(entity, 24.0);
    let pending = e.world.rigid_body(entity).unwrap();
    for _ in 0..3 {
        assert_eq!(ray(&mut e), 1);
        assert_eq!(e.query_point_bodies(2.0, 0.0, u32::MAX), 1);
        assert_eq!(e.world.rigid_body(entity).unwrap(), pending);
        let s = e.unified_body_state(entity).unwrap();
        assert_eq!(s.pose.position, [2.0, 0.0, 0.0]);
        assert_eq!(s.linear_velocity, [0.0; 3]);
        assert_eq!(s.angular_velocity, [0.0; 3]);
    }
    e.world
        .set_transform(entity, Transform2D { x: 7.0, y: 0.0 });
    e.world.set_circle_collider(
        entity,
        CircleCollider::new(1.0, false, CollisionLayer::Wall),
    );
    assert_eq!(ray(&mut e), 1);
    near(e.physics_raycast_hits[0].distance, 6.0);
    let dt = f64::from(e.fixed_timestep.config().step_seconds);
    e.update(dt / 2.0);
    ray(&mut e);
    assert_eq!(
        e.unified_body_state(entity).unwrap().pose.position,
        [7.0, 0.0, 0.0]
    );
    e.update(dt / 2.0);
    near(
        e.unified_body_state(entity).unwrap().linear_velocity[0],
        2.1,
    );
    near(
        e.unified_body_state(entity).unwrap().angular_velocity[2],
        2.1,
    );
    ray(&mut e);
    e.update(dt);
    near(
        e.unified_body_state(entity).unwrap().linear_velocity[0],
        2.1,
    );
    near(
        e.unified_body_state(entity).unwrap().angular_velocity[2],
        2.1,
    );
}

#[test]
fn planar_queries_preserve_category_sensor_height_and_per_entity_point_contracts() {
    let mut e = engine(Space::PlanarXy);
    let entity = authored(&mut e, 2.0);
    let filter = CollisionFilter::new(CollisionMask::from_bits(8), CollisionMask::from_bits(0));
    e.world
        .set_circle_collider(entity, CircleCollider::new(1.0, true, CollisionLayer::Wall));
    e.world.set_collision_filter(entity, filter);
    e.world
        .add_compound_collider(
            entity,
            CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider::new(
                0.5,
                false,
                CollisionLayer::Wall,
            )))
            .with_filter(filter),
        )
        .unwrap();
    let height = HeightSpan::new(PhysicsFloorId(3), 4.0, 2.0).unwrap();
    e.world.set_height_span(entity, height);
    let unspanned = authored(&mut e, 6.0);
    e.world.set_collision_filter(unspanned, filter);
    assert_eq!(e.raycast_bodies(0.0, 0.0, 1.0, 0.0, 10.0, 8), 3);
    assert_eq!(e.raycast_bodies(0.0, 0.0, 1.0, 0.0, 10.0, 4), 0);
    assert_eq!(
        e.raycast_bodies_with_height_span(0.0, 0.0, 1.0, 0.0, 10.0, 8, 3, 6.0, 0.0),
        2
    );
    assert_eq!(
        e.segment_cast_bodies_with_height_span(0.0, 0.0, 10.0, 0.0, 8, 3, 6.0, 0.0),
        2
    );
    assert_eq!(e.query_point_bodies(2.0, 0.0, 8), 1);
    assert_eq!(
        e.query_point_bodies_with_height_span(2.0, 0.0, 8, 3, 6.0, 0.0),
        1
    );
    assert_eq!(
        e.query_point_bodies_with_height_span(2.0, 0.0, 8, 4, 6.0, 0.0),
        0
    );
    e.world.set_height_span(
        entity,
        HeightSpan::new(PhysicsFloorId(4), 4.0, 2.0).unwrap(),
    );
    assert_eq!(
        e.query_point_bodies_with_height_span(2.0, 0.0, 8, 3, 6.0, 0.0),
        0
    );
    assert_eq!(
        e.query_point_bodies_with_height_span(2.0, 0.0, 8, 4, 6.0, 0.0),
        1
    );
}

#[test]
fn query_identity_mapping_tracks_component_removal_deletion_and_arena_reuse() {
    let mut e = engine(Space::PlanarXy);
    let first = authored(&mut e, 2.0);
    assert_eq!(ray(&mut e), 1);
    let original_body = e.unified_body_id(first).unwrap();
    e.world.clear_collider(first);
    assert_eq!(ray(&mut e), 0);
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .entities_by_body
        .is_empty());
    e.world
        .set_circle_collider(first, CircleCollider::new(0.5, false, CollisionLayer::Wall));
    assert_eq!(ray(&mut e), 1);
    assert_ne!(e.unified_body_id(first).unwrap(), original_body);
    e.world.despawn(first);
    let second = authored(&mut e, 4.0);
    assert_ne!(first, second);
    assert_eq!(ray(&mut e), 1);
    assert_eq!(
        e.physics_raycast_hits[0].entity_generation,
        second.generation
    );
    assert_eq!(e.physics_raycast_hits[0].entity_id, second.id);
    let runtime = e.unified_physics.as_ref().unwrap();
    assert_eq!(runtime.bindings.len(), 1);
    assert_eq!(runtime.entities_by_body.len(), 1);
    e.remove_unified_body(second).unwrap();
    assert_eq!(ray(&mut e), 0);
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .entities_by_body
        .is_empty());
}

#[test]
fn rejected_query_batch_never_falls_back_or_erases_a_previous_diagnostic() {
    let mut e = engine(Space::PlanarXy);
    let good = authored(&mut e, 2.0);
    let bad = authored(&mut e, 5.0);
    e.world.set_circle_collider(
        bad,
        CircleCollider::new(f32::NAN, false, CollisionLayer::Wall),
    );
    assert_eq!(ray(&mut e), 0);
    assert!(e.physics_raycast_hits.is_empty());
    let error = e.unified_physics_error();
    assert!(error.is_some());
    assert!(e.unified_physics.as_ref().unwrap().bindings.is_empty());
    e.world.despawn(bad);
    assert_eq!(ray(&mut e), 1);
    assert_eq!(e.physics_raycast_hits[0].entity_id, good.id);
    assert_eq!(e.unified_physics_error(), error);
    assert_eq!(e.raycast_bodies(0.0, 0.0, 0.0, 0.0, 10.0, u32::MAX), 0);
    assert_eq!(
        e.unified_physics_error(),
        Some(PhysicsError::InvalidQuery.into())
    );
    assert_eq!(e.query_point_bodies(f32::NAN, 0.0, u32::MAX), 0);
    assert!(e.physics_query_hits.is_empty());
}

#[test]
fn spatial_queries_require_xyz_and_return_native_geometry_with_entity_identity() {
    let mut e = engine(Space::Spatial);
    let entity = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2.0, 4.0, 6.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.0, -2.0, 0.0],
        )
        .unwrap();
    let ray = RayCast {
        origin: [0.0, 4.0, 6.0],
        direction: [5.0, 0.0, 0.0],
        max_distance: 10.0,
        solid: true,
    };
    let mut out = Vec::new();
    assert!(!e
        .cast_unified_ray_all(&ray, &QueryFilter::default(), &mut out, 10)
        .unwrap());
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].entity, entity);
    assert_eq!(out[0].hit.point, [1.5, 4.0, 6.0]);
    let prior = out.clone();
    let mut invalid = ray.clone();
    invalid.max_distance = -1.0;
    assert_eq!(
        e.cast_unified_ray_all(&invalid, &QueryFilter::default(), &mut out, 10),
        Err(PhysicsError::InvalidQuery.into())
    );
    assert_eq!(out, prior);
    assert_eq!(
        e.cast_unified_ray_all(&ray, &QueryFilter::default(), &mut out, 0),
        Err(PhysicsError::InvalidQuery.into())
    );
    assert_eq!(out, prior);
    assert_eq!(e.raycast_bodies(0.0, -6.0, 1.0, 0.0, 10.0, u32::MAX), 0);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::SpatialQueryRequires3d)
    );
    assert_eq!(e.query_point_bodies(2.0, -6.0, u32::MAX), 0);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::SpatialQueryRequires3d)
    );
}

#[test]
fn equal_distance_limits_use_entity_identity_instead_of_native_arena_order() {
    let mut e = engine(Space::PlanarXy);
    let authored = authored(&mut e, 2.0); // Older entity, imported after the explicit body.
    let explicit = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.0; 3],
        )
        .unwrap();
    assert!(authored.id < explicit.id);
    let cast = RayCast {
        origin: [0.0; 3],
        direction: [1.0, 0.0, 0.0],
        max_distance: 10.0,
        solid: true,
    };
    let mut out = Vec::new();
    assert!(e
        .cast_unified_ray_all(&cast, &QueryFilter::default(), &mut out, 1)
        .unwrap());
    assert_eq!(out[0].entity, authored);
    assert!(e.unified_body_id(explicit).unwrap() < e.unified_body_id(authored).unwrap());
    assert_eq!(ray(&mut e), 2);
    assert_eq!(e.physics_raycast_hits[0].entity_id, authored.id);
    assert_eq!(e.physics_raycast_hits[1].entity_id, explicit.id);
    assert_eq!(e.query_point_bodies(2.0, 0.0, u32::MAX), 2);
    assert_eq!(e.physics_query_hits[0].entity_id, authored.id);
    assert_eq!(e.physics_query_hits[1].entity_id, explicit.id);
}
