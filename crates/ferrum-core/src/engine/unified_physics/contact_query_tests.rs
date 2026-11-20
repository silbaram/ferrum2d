use super::*;
use crate::components::{AabbCollider, CollisionLayer, CollisionMask, RigidBody};
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
fn authored(e: &mut Engine, x: f32, layer: CollisionLayer) -> Entity {
    let entity = e.world.spawn_entity();
    e.world.set_transform(entity, Transform2D { x, y: 0.0 });
    e.world
        .set_aabb_collider(entity, AabbCollider::new(5.0, 5.0, false, layer));
    entity
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.002, "{a} != {b}");
}
#[test]
fn authored_boxes_with_deep_overlap_report_xy_contact_and_separate_in_actual_ticks() {
    let mut e = engine(Space::PlanarXy);
    let a = authored(&mut e, 0.0, CollisionLayer::Player);
    let b = authored(&mut e, 8.0, CollisionLayer::Enemy);
    e.world
        .set_rigid_body(a, RigidBody::dynamic_box(1.0, 10.0, 10.0));
    assert_eq!(
        e.query_body_contacts(CollisionMask::PLAYER.bits, CollisionMask::ENEMY.bits),
        1
    );
    let hit = e.physics_body_contact_hits[0];
    assert_eq!((hit.a_entity_id, hit.b_entity_id), (a.id, b.id));
    near(hit.normal_x, 1.0);
    near(hit.normal_y, 0.0);
    near(hit.penetration, 2.0);
    near(hit.point_x, 5.0);
    near(hit.point_y, 0.0);
    assert_eq!(
        e.query_body_manifolds(CollisionMask::ENEMY.bits, CollisionMask::PLAYER.bits),
        1
    );
    let hit = e.physics_body_manifold_hits[0];
    assert_eq!(
        (hit.a_entity_id, hit.b_entity_id, hit.point_count),
        (b.id, a.id, 2)
    );
    near(hit.normal_x, -1.0);
    near(hit.penetration, 2.0);
    near(hit.point0_x, 3.0);
    near(hit.point1_x, 3.0);
    for _ in 0..90 {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    assert!(e.unified_body_state(a).unwrap().pose.position[0] < -1.9);
    assert_eq!(e.unified_body_state(a).unwrap().pose.position[2], 0.0);
}
#[test]
fn spatial_contact_query_keeps_full_xyz_witnesses_and_category_orientation() {
    let mut e = engine(Space::Spatial);
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc {
                category: 2,
                ..ColliderDesc::new(Shape::Sphere { radius: 1.0 })
            },
            [100.0, 20.0, 30.0],
        )
        .unwrap();
    let b = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0.0, 1.5, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                category: 4,
                ..ColliderDesc::new(Shape::Sphere { radius: 1.0 })
            },
            [0.0; 3],
        )
        .unwrap();
    let mut hits = Vec::new();
    e.query_unified_contact_manifolds(4, 2, true, &mut hits)
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!((hits[0].a, hits[0].b), (b, a));
    assert_eq!(hits[0].contact.normal, [0.0, -1.0, 0.0]);
    assert_eq!(hits[0].contact.points[0].first, [0.0, 0.5, 0.0]);
    assert_eq!(hits[0].contact.points[0].second, [0.0, 1.0, 0.0]);
    near(hits[0].contact.points[0].penetration, 0.5);
    assert_eq!(e.query_body_contacts(u32::MAX, u32::MAX), 0);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::SpatialQueryRequires3d)
    );
}

#[test]
fn authored_rotated_polygon_deep_contacts_keep_mass_and_pending_input() {
    use crate::components::{ConvexPolygonCollider, Rotation2D, Velocity};
    let mut e = engine(Space::PlanarXy);
    let a = authored(&mut e, 0.0, CollisionLayer::Player);
    let b = authored(&mut e, 5.0, CollisionLayer::Enemy);
    let vertices = [
        Transform2D { x: -5.0, y: -5.0 },
        Transform2D { x: 5.0, y: -5.0 },
        Transform2D { x: 5.0, y: 5.0 },
        Transform2D { x: -5.0, y: 5.0 },
    ];
    let mut padded = [Transform2D::default(); 16];
    padded[..vertices.len()].copy_from_slice(&vertices);
    e.world.set_convex_polygon_collider(
        a,
        ConvexPolygonCollider::new(padded, 4, false, CollisionLayer::Player),
    );
    e.world.rotations[a.id as usize] = Some(Rotation2D { radians: 0.35 });
    e.world
        .set_rigid_body(a, RigidBody::dynamic(3.0).with_inertia(7.0));
    e.world.apply_impulse(a, Velocity { vx: 6.0, vy: 0.0 });
    assert!(e.query_body_manifolds(CollisionMask::PLAYER.bits, CollisionMask::ENEMY.bits) > 0);
    assert_eq!(e.world.rigid_body(a).unwrap().mass, 3.0);
    assert_eq!(e.world.rigid_body(a).unwrap().inertia, 7.0);
    assert_eq!(e.world.rigid_body(a).unwrap().impulse.vx, 6.0);
    assert_eq!(e.unified_body_state(a).unwrap().pose.position, [0.0; 3]);
    assert!(e.frame_buffers.collision_events.is_empty());
    assert!(e
        .physics_body_manifold_hits
        .iter()
        .all(|h| h.a_entity_id == a.id
            && h.b_entity_id == b.id
            && h.normal_x.hypot(h.normal_y) > 0.99
            && h.penetration > 1.0));
}
#[test]
fn imported_maximum_xy_box_dimensions_keep_valid_derived_extrusion() {
    let mut e = engine(Space::PlanarXy);
    let a = authored(&mut e, 0.0, CollisionLayer::Player);
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(10000.0, 10000.0, false, CollisionLayer::Player),
    );
    assert_eq!(e.query_point_bodies(9999.0, 9999.0, u32::MAX), 1);
    assert_eq!(e.unified_physics_error(), None);
    assert_eq!(
        e.query_aabb_bodies(9999.0, 9999.0, 10000.0, 10000.0, u32::MAX),
        1
    );
}
#[test]
fn native_planar_spheres_return_one_point_and_queries_see_edits_without_steps() {
    let mut e = engine(Space::PlanarXy);
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 1.0 }),
            [100.0, 20.0, 0.0],
        )
        .unwrap();
    let b = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [1.5, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 1.0 }),
            [0.0; 3],
        )
        .unwrap();
    assert_eq!(e.query_body_manifolds(u32::MAX, u32::MAX), 1);
    let h = e.physics_body_manifold_hits[0];
    assert_eq!(h.point_count, 1);
    near(h.point0_x, 1.0);
    near(h.penetration, 0.5);
    assert_eq!(
        (h.point1_x, h.point1_y, h.point1_penetration),
        (0.0, 0.0, 0.0)
    );
    assert_eq!(e.world.transform(a).unwrap().x, 100.0);
    e.set_unified_body_pose(
        b,
        Pose {
            position: [5.0, 0.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    assert_eq!(e.query_body_manifolds(u32::MAX, u32::MAX), 0);
    assert!(e.physics_body_manifold_hits.is_empty());
    e.remove_unified_body(a).unwrap();
    assert_eq!(e.query_body_contacts(u32::MAX, u32::MAX), 0);
}
#[test]
fn invalid_authored_batch_clears_legacy_output_but_preserves_typed_output() {
    let mut e = engine(Space::PlanarXy);
    let a = authored(&mut e, 0.0, CollisionLayer::Player);
    authored(&mut e, 8.0, CollisionLayer::Enemy);
    assert_eq!(e.query_body_contacts(u32::MAX, u32::MAX), 1);
    let mut out = Vec::new();
    e.query_unified_contact_manifolds(u32::MAX, u32::MAX, true, &mut out)
        .unwrap();
    let saved = out.clone();
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(f32::NAN, 5.0, false, CollisionLayer::Player),
    );
    assert!(e
        .query_unified_contact_manifolds(u32::MAX, u32::MAX, true, &mut out)
        .is_err());
    assert_eq!(out, saved);
    assert_eq!(e.query_body_contacts(u32::MAX, u32::MAX), 0);
    assert!(e.physics_body_contact_hits.is_empty());
    assert!(e.unified_physics_error().is_some());
}
#[test]
fn explicitly_flat_native_geometry_reports_unrepresentable_z_contact_without_silent_miss() {
    let mut e = engine(Space::PlanarXy);
    for x in [0.0, 1.0] {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [x, 0.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [5.0, 5.0, 0.1],
            }),
            [0.0; 3],
        )
        .unwrap();
    }
    let mut native = Vec::new();
    e.query_unified_contact_manifolds(u32::MAX, u32::MAX, true, &mut native)
        .unwrap();
    assert!(!native.is_empty());
    assert!(native[0].contact.normal[2].abs() > 0.99);
    assert_eq!(e.query_body_contacts(u32::MAX, u32::MAX), 0);
    assert_eq!(
        e.unified_physics_error(),
        Some(PhysicsError::OutOfPlane.into())
    );
}
