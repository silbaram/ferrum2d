use super::*;

#[test]
fn build_manifolds_reports_two_convex_polygon_circle_face_points() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        2.5,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    assert_eq!(
        manifolds[0].pair,
        CollisionPair {
            a: polygon_entity,
            b: circle_entity,
        }
    );
    assert_eq!(manifolds[0].normal_x, 1.0);
    assert_eq!(manifolds[0].normal_y, 0.0);
    assert_eq!(manifolds[0].penetration, 0.5);
    assert_eq!(manifolds[0].point_count, 2);
    assert!(manifolds[0].points().iter().all(
        |point| (point.point_x - 2.0).abs() < 0.001 && (point.penetration - 0.5).abs() < 0.001
    ));
    assert!(manifolds[0]
        .points()
        .iter()
        .any(|point| (point.point_y - 0.866).abs() < 0.001));
    assert!(manifolds[0]
        .points()
        .iter()
        .any(|point| (point.point_y + 0.866).abs() < 0.001));
}

#[test]
fn build_manifolds_reports_two_convex_polygon_capsule_side_points() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::PLAYER,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        2.5,
        0.0,
        capsule(0.0, -0.5, 0.0, 0.5, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::PLAYER,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: polygon_entity,
            b: capsule_entity,
        }
    );
    assert_eq!(manifold.normal_x, 1.0);
    assert_eq!(manifold.normal_y, 0.0);
    assert_eq!(manifold.penetration, 0.5);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold.points().iter().all(
        |point| (point.point_x - 2.0).abs() < 0.001 && (point.penetration - 0.5).abs() < 0.001
    ));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y - 0.5).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y + 0.5).abs() < 0.001));
}

#[test]
fn build_manifolds_reports_two_convex_polygon_face_points() {
    let mut world = World::default();
    let first = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::PLAYER,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_convex_polygon(
        &mut world,
        3.5,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::PLAYER,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: first,
            b: second
        }
    );
    assert_eq!(manifold.normal_x, 1.0);
    assert_eq!(manifold.normal_y, 0.0);
    assert_eq!(manifold.penetration, 0.5);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold.points().iter().all(
        |point| (point.point_x - 2.0).abs() < 0.001 && (point.penetration - 0.5).abs() < 0.001
    ));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y - 1.0).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y + 1.0).abs() < 0.001));
}

#[test]
fn build_manifolds_reports_two_convex_polygon_capsule_arc_clipped_face_points() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-4.0, 0.6, 4.0, 1.4, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: capsule_entity,
            b: polygon_entity,
        }
    );
    assert!(manifold.normal_x.abs() < 0.11);
    assert!(manifold.normal_y < -0.99);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold
        .points()
        .iter()
        .all(|point| (point.point_y - 1.0).abs() < 0.001 && point.penetration > 0.7));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x + 2.0).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x - 2.0).abs() < 0.001));
}
