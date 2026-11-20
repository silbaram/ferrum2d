use super::*;
use crate::components::{
    AabbCollider, CircleCollider, CollisionFilter, CollisionLayer, CollisionMask, CompoundCollider,
    CompoundColliderShape, RigidBody,
};
use crate::physics3d::{BodyKind, Shape};

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
fn wall(e: &mut Engine, x: f32, y: f32) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [x, y, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.5, 2.0, 0.5],
        }),
        [20.0, 10.0, 0.0],
    )
    .unwrap()
}
fn authored(e: &mut Engine, x: f32) -> Entity {
    let id = e.world.spawn_entity();
    e.world.set_transform(id, Transform2D { x, y: 0.0 });
    e.world
        .set_aabb_collider(id, AabbCollider::new(0.5, 2.0, true, CollisionLayer::Wall));
    id
}
fn quad(x: f32, y: f32) -> Vec<f32> {
    vec![
        x - 0.5,
        y - 0.5,
        x + 0.5,
        y - 0.5,
        x + 0.5,
        y + 0.5,
        x - 0.5,
        y + 0.5,
    ]
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.0005, "{a} != {b}");
}
fn area_ids(e: &Engine) -> Vec<u32> {
    e.physics_query_hits.iter().map(|h| h.entity_id).collect()
}

#[test]
fn five_area_shapes_read_native_geometry_and_handle_degenerate_aabbs() {
    let mut e = engine(Space::PlanarXy);
    let body = wall(&mut e, 5.0, 0.0);
    assert_eq!(e.query_aabb_bodies(5.0, 0.0, 0.0, 0.0, u32::MAX), 1);
    assert_eq!(area_ids(&e), [body.id]);
    assert_eq!(e.query_aabb_bodies(4.5, 0.0, 0.0, 3.0, u32::MAX), 1);
    assert_eq!(e.query_aabb_bodies(4.49, 0.0, 0.0, 3.0, u32::MAX), 0);
    assert_eq!(e.query_circle_bodies(5.0, 0.0, 0.2, u32::MAX), 1);
    assert_eq!(
        e.query_oriented_box_bodies(5.0, 0.0, 0.3, 0.8, 1.2, u32::MAX),
        1
    );
    assert_eq!(e.query_capsule_bodies(4.0, 0.0, 6.0, 0.0, 0.1, u32::MAX), 1);
    assert_eq!(e.query_convex_polygon_bodies(quad(5.0, 0.0), u32::MAX), 1);
    assert_eq!(e.query_aabb_bodies(25.0, 10.0, 0.5, 0.5, u32::MAX), 0); // render anchor is separate.
    e.set_unified_body_pose(
        body,
        Pose {
            position: [40000.0, 20000.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    assert_eq!(
        e.query_convex_polygon_bodies(quad(40000.0, 20000.0), u32::MAX),
        1
    );
    assert_eq!(e.query_circle_bodies(5.0, 0.0, 0.2, u32::MAX), 0);
}

#[test]
fn five_sweep_shapes_keep_moving_reference_point_and_all_hit_order() {
    let mut e = engine(Space::PlanarXy);
    let far = wall(&mut e, 8.0, 0.0);
    let near_body = wall(&mut e, 5.0, 0.0);
    let casts: [fn(&mut Engine) -> u32; 5] = [
        |e| e.shape_cast_aabb_bodies(0.0, 0.0, 0.5, 0.5, 9.0, 0.0, 10.0, u32::MAX),
        |e| e.shape_cast_circle_bodies(0.0, 0.0, 0.5, 9.0, 0.0, 10.0, u32::MAX),
        |e| e.shape_cast_oriented_box_bodies(0.0, 0.0, 0.5, 0.5, 0.0, 9.0, 0.0, 10.0, u32::MAX),
        |e| e.shape_cast_capsule_bodies(0.0, -0.5, 0.0, 0.5, 0.5, 9.0, 0.0, 10.0, u32::MAX),
        |e| e.shape_cast_convex_polygon_bodies(quad(0.0, 0.0), 9.0, 0.0, 10.0, u32::MAX),
    ];
    for cast in casts {
        assert_eq!(cast(&mut e), 2);
        assert_eq!(
            e.physics_raycast_hits
                .iter()
                .map(|h| h.entity_id)
                .collect::<Vec<_>>(),
            [near_body.id, far.id]
        );
        near(e.physics_raycast_hits[0].distance, 4.0);
        near(e.physics_raycast_hits[0].point_x, 4.0); // target surface is x=4.5.
        near(e.physics_raycast_hits[0].point_y, 0.0);
        near(e.physics_raycast_hits[0].normal_x, -1.0);
        near(e.physics_raycast_hits[1].distance, 7.0);
    }
    assert_eq!(
        e.shape_cast_aabb_bodies(0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 10.0, u32::MAX),
        2
    );
    near(e.physics_raycast_hits[0].distance, 4.5);
    assert_eq!(
        e.shape_cast_circle_bodies(5.0, 0.0, 0.5, 1.0, 0.0, 0.0, u32::MAX),
        1
    );
    near(e.physics_raycast_hits[0].distance, 0.0);
    near(e.physics_raycast_hits[0].point_x, 5.0);
    assert_eq!(
        e.shape_cast_oriented_box_bodies(
            0.0,
            0.0,
            0.25,
            0.5,
            std::f32::consts::FRAC_PI_2,
            1.0,
            0.0,
            10.0,
            u32::MAX
        ),
        2
    );
    near(e.physics_raycast_hits[0].distance, 4.0);
    assert_eq!(
        e.shape_cast_capsule_bodies(-0.5, 0.0, 0.5, 0.0, 0.25, 1.0, 0.0, 10.0, u32::MAX),
        2
    );
    near(e.physics_raycast_hits[0].distance, 3.75);
}

#[test]
fn height_aware_area_and_sweep_entrypoints_keep_category_only_sensor_filters() {
    let mut e = engine(Space::PlanarXy);
    let entity = authored(&mut e, 5.0);
    let filter = CollisionFilter::new(CollisionMask::from_bits(8), CollisionMask::from_bits(0));
    e.world.set_collision_filter(entity, filter);
    e.world.set_height_span(
        entity,
        HeightSpan::new(PhysicsFloorId(3), 2.0, 1.0).unwrap(),
    );
    let other = authored(&mut e, 8.0);
    e.world.set_collision_filter(other, filter); // Explicit height query excludes this unspanned body.
    let areas = [
        e.query_aabb_bodies_with_height_span(5.0, 0.0, 5.0, 1.0, 8, 3, 3.0, 0.0),
        e.query_circle_bodies_with_height_span(5.0, 0.0, 5.0, 8, 3, 3.0, 0.0),
        e.query_oriented_box_bodies_with_height_span(5.0, 0.0, 5.0, 1.0, 0.0, 8, 3, 3.0, 0.0),
        e.query_capsule_bodies_with_height_span(5.0, 0.0, 8.0, 0.0, 1.0, 8, 3, 3.0, 0.0),
        e.query_convex_polygon_bodies_with_height_span(quad(5.0, 0.0), 8, 3, 3.0, 0.0),
    ];
    assert_eq!(areas, [1; 5]);
    let casts = [
        e.shape_cast_aabb_bodies_with_height_span(
            0.0, 0.0, 0.5, 0.5, 1.0, 0.0, 10.0, 8, 3, 3.0, 0.0,
        ),
        e.shape_cast_circle_bodies_with_height_span(0.0, 0.0, 0.5, 1.0, 0.0, 10.0, 8, 3, 3.0, 0.0),
        e.shape_cast_oriented_box_bodies_with_height_span(
            0.0, 0.0, 0.5, 0.5, 0.0, 1.0, 0.0, 10.0, 8, 3, 3.0, 0.0,
        ),
        e.shape_cast_capsule_bodies_with_height_span(
            0.0, -0.5, 0.0, 0.5, 0.5, 1.0, 0.0, 10.0, 8, 3, 3.0, 0.0,
        ),
        e.shape_cast_convex_polygon_bodies_with_height_span(
            quad(0.0, 0.0),
            1.0,
            0.0,
            10.0,
            8,
            3,
            3.0,
            0.0,
        ),
    ];
    assert_eq!(casts, [1; 5]);
    assert_eq!(e.physics_raycast_hits[0].entity_id, entity.id);
    assert_eq!(
        e.query_circle_bodies_with_height_span(5.0, 0.0, 5.0, 4, 3, 3.0, 0.0),
        0
    );
    assert_eq!(
        e.query_circle_bodies_with_height_span(5.0, 0.0, 5.0, 8, 4, 3.0, 0.0),
        0
    );
    assert_eq!(
        e.shape_cast_circle_bodies_with_height_span(0.0, 0.0, 0.5, 1.0, 0.0, 10.0, 8, 4, 3.0, 0.0),
        0
    );
    assert!(e.query_nearest_body_with_height_span(0.0, 0.0, 10.0, 8, 3, 3.0, 0.0));
    assert_eq!(e.physics_query_result.entity_id, entity.id);
    assert!(!e.query_nearest_body_with_height_span(0.0, 0.0, 10.0, 8, 4, 3.0, 0.0));
}

#[test]
fn nearest_query_uses_fixture_surface_interior_and_stable_entity_ties() {
    let mut e = engine(Space::PlanarXy);
    let first = authored(&mut e, 5.0);
    let second = wall(&mut e, 5.0, 0.0); // Native body inserted before the older authored entity.
    assert!(e.query_nearest_body(0.0, 0.0, 4.5, u32::MAX));
    assert_eq!(e.physics_query_result.entity_id, first.id);
    near(e.physics_query_result.distance, 4.5);
    near(e.physics_query_result.point_x, 4.5);
    assert!(!e.query_nearest_body(0.0, 0.0, 4.49, u32::MAX));
    assert!(e.query_nearest_body(5.0, 0.0, 0.0, u32::MAX));
    near(e.physics_query_result.distance, 0.0);
    near(e.physics_query_result.point_x, 5.0);
    let mut fixture = CircleCollider::new(0.5, false, CollisionLayer::Wall);
    fixture.offset_x = -3.0;
    e.world
        .add_compound_collider(
            first,
            CompoundCollider::new(CompoundColliderShape::Circle(fixture)),
        )
        .unwrap();
    assert!(e.query_nearest_body(0.0, 0.0, 10.0, u32::MAX));
    assert_eq!(e.physics_query_result.entity_id, first.id);
    near(e.physics_query_result.distance, 1.5);
    e.world.despawn(first);
    assert!(e.query_nearest_body(0.0, 0.0, 10.0, u32::MAX));
    assert_eq!(e.physics_query_result.entity_id, second.id);
    near(e.physics_query_result.distance, 4.5);
}

#[test]
fn new_queries_preserve_pending_inputs_and_observe_disable_and_removal() {
    let mut e = engine(Space::PlanarXy);
    let entity = authored(&mut e, 5.0);
    e.world.set_rigid_body(entity, RigidBody::dynamic(2.0));
    e.world.apply_impulse(entity, Velocity { vx: 4.0, vy: 0.0 });
    e.world.apply_force(entity, Velocity { vx: 12.0, vy: 0.0 });
    let pending = e.world.rigid_body(entity).unwrap();
    for _ in 0..3 {
        assert_eq!(e.query_circle_bodies(5.0, 0.0, 1.0, u32::MAX), 1);
        assert_eq!(
            e.shape_cast_circle_bodies(0.0, 0.0, 0.5, 1.0, 0.0, 10.0, u32::MAX),
            1
        );
        assert!(e.query_nearest_body(0.0, 0.0, 10.0, u32::MAX));
        assert_eq!(e.world.rigid_body(entity).unwrap(), pending);
        assert_eq!(
            e.unified_body_state(entity).unwrap().linear_velocity,
            [0.0; 3]
        );
    }
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    near(
        e.unified_body_state(entity).unwrap().linear_velocity[0],
        2.1,
    );
    let mut rigid = e.world.rigid_body(entity).unwrap();
    rigid.enabled = false;
    e.world.set_rigid_body(entity, rigid);
    assert_eq!(e.query_circle_bodies(5.0, 0.0, 1.0, u32::MAX), 0);
    assert_eq!(
        e.shape_cast_circle_bodies(0.0, 0.0, 0.5, 1.0, 0.0, 10.0, u32::MAX),
        0
    );
    assert!(!e.query_nearest_body(0.0, 0.0, 10.0, u32::MAX));
    e.world.despawn(entity);
    assert!(!e.query_nearest_body(0.0, 0.0, 10.0, u32::MAX));
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .entities_by_body
        .is_empty());
}

#[test]
fn invalid_and_spatial_requests_clear_results_without_legacy_fallback() {
    let mut e = engine(Space::PlanarXy);
    wall(&mut e, 5.0, 0.0);
    assert_eq!(e.query_circle_bodies(5.0, 0.0, 1.0, u32::MAX), 1);
    assert_eq!(
        e.query_oriented_box_bodies(5.0, 0.0, 0.0, 1.0, 0.0, u32::MAX),
        0
    );
    assert!(e.physics_query_hits.is_empty());
    assert_eq!(
        e.query_convex_polygon_bodies(
            vec![4.0, -1.0, 6.0, -1.0, 5.0, 0.0, 6.0, 1.0, 4.0, 1.0],
            u32::MAX
        ),
        0
    ); // Concave polygon.
    assert_eq!(
        e.shape_cast_circle_bodies(0.0, 0.0, 0.5, 0.0, 0.0, 10.0, u32::MAX),
        0
    );
    assert!(e.physics_raycast_hits.is_empty());
    assert!(!e.query_nearest_body(0.0, 0.0, f32::NAN, u32::MAX));
    assert_eq!(e.physics_query_result.distance, 0.0);
    assert_eq!(
        e.unified_physics_error(),
        Some(PhysicsError::InvalidQuery.into())
    );
    let mut spatial = engine(Space::Spatial);
    wall(&mut spatial, 5.0, 0.0);
    assert_eq!(spatial.query_circle_bodies(5.0, 0.0, 1.0, u32::MAX), 0);
    assert_eq!(
        spatial.shape_cast_circle_bodies(0.0, 0.0, 0.5, 1.0, 0.0, 10.0, u32::MAX),
        0
    );
    assert!(!spatial.query_nearest_body(0.0, 0.0, 10.0, u32::MAX));
    assert_eq!(
        spatial.unified_physics_error(),
        Some(UnifiedPhysicsError::SpatialQueryRequires3d)
    );
}

#[test]
fn self_crossing_polygon_is_rejected_in_queries_and_planar_body_migration() {
    use crate::components::{ConvexPolygonCollider, MAX_CONVEX_POLYGON_VERTICES};
    let points: Vec<_> = [0, 2, 4, 1, 3]
        .map(|i| {
            let angle = i as f32 * std::f32::consts::TAU / 5.0;
            Transform2D {
                x: angle.cos(),
                y: angle.sin(),
            }
        })
        .into_iter()
        .collect();
    let mut e = engine(Space::PlanarXy);
    wall(&mut e, 0.0, 0.0);
    let values = points.iter().flat_map(|p| [p.x, p.y]).collect();
    assert_eq!(e.query_convex_polygon_bodies(values, u32::MAX), 0);
    let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    vertices[..points.len()].copy_from_slice(&points);
    let bad = e.world.spawn_entity();
    e.world.set_transform(bad, Transform2D { x: 5.0, y: 0.0 });
    e.world.set_convex_polygon_collider(
        bad,
        ConvexPolygonCollider::new(vertices, 5, false, CollisionLayer::Wall),
    );
    assert_eq!(e.query_circle_bodies(5.0, 0.0, 1.0, u32::MAX), 0);
    assert_eq!(
        e.unified_physics_error(),
        Some(PhysicsError::InvalidCollider.into())
    );
    assert_eq!(
        e.unified_body_id(bad),
        Err(UnifiedPhysicsError::StaleEntity)
    );
}
