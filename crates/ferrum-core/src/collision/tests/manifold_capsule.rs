use super::*;

#[test]
fn build_manifolds_reports_two_capsule_circle_side_points() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        0.0,
        1.5,
        1.0,
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
            b: circle_entity,
        }
    );
    assert_eq!(manifold.normal_x, 0.0);
    assert_eq!(manifold.normal_y, 1.0);
    assert_eq!(manifold.penetration, 0.5);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold.points().iter().all(
        |point| (point.point_y - 1.0).abs() < 0.001 && (point.penetration - 0.5).abs() < 0.001
    ));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x - 0.866).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x + 0.866).abs() < 0.001));
}

#[test]
fn build_manifolds_reports_two_circle_capsule_side_points() {
    let mut world = World::default();
    let circle_entity = spawn_custom_circle(
        &mut world,
        0.0,
        1.5,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-3.0, 0.0, 3.0, 0.0, 1.0, true, CollisionLayer::Player),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_layer_manifolds(
        &world,
        CollisionLayer::Enemy,
        CollisionLayer::Player,
    );

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: circle_entity,
            b: capsule_entity,
        }
    );
    assert_eq!(manifold.normal_x, 0.0);
    assert_eq!(manifold.normal_y, -1.0);
    assert_eq!(manifold.penetration, 0.5);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold.points().iter().all(
        |point| (point.point_y - 1.0).abs() < 0.001 && (point.penetration - 0.5).abs() < 0.001
    ));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x - 0.866).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x + 0.866).abs() < 0.001));
}

#[test]
fn build_manifolds_reports_two_aabb_capsule_side_points() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        5.5,
        capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(
        manifolds,
        vec![CollisionManifold {
            pair: CollisionPair {
                a: aabb_entity,
                b: capsule_entity,
            },
            normal_x: 0.0,
            normal_y: 1.0,
            penetration: 0.5,
            point_count: 2,
            points: [
                CollisionContactPoint {
                    point_x: -3.0,
                    point_y: 5.0,
                    penetration: 0.5,
                },
                CollisionContactPoint {
                    point_x: 3.0,
                    point_y: 5.0,
                    penetration: 0.5,
                },
            ],
        }]
    );
    assert_eq!(manifolds[0].points().len(), 2);

    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        5.5,
        capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_layer_manifolds(
        &world,
        CollisionLayer::Enemy,
        CollisionLayer::Player,
    );

    assert_eq!(
        manifolds,
        vec![CollisionManifold {
            pair: CollisionPair {
                a: capsule_entity,
                b: aabb_entity,
            },
            normal_x: 0.0,
            normal_y: -1.0,
            penetration: 0.5,
            point_count: 2,
            points: [
                CollisionContactPoint {
                    point_x: -3.0,
                    point_y: 5.0,
                    penetration: 0.5,
                },
                CollisionContactPoint {
                    point_x: 3.0,
                    point_y: 5.0,
                    penetration: 0.5,
                },
            ],
        }]
    );
    assert_eq!(manifolds[0].points().len(), 2);
}

#[test]
fn build_manifolds_reports_two_aabb_capsule_endpoint_points() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        5.5,
        capsule(-3.0, 0.0, 3.0, 0.5, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: aabb_entity,
            b: capsule_entity,
        }
    );
    assert_eq!(manifold.normal_x, 0.0);
    assert_eq!(manifold.normal_y, 1.0);
    assert_eq!(manifold.point_count, 2);
    assert_eq!(manifold.points[0].point_x, -3.0);
    assert_eq!(manifold.points[0].point_y, 5.0);
    assert_eq!(manifold.points[1].point_x, 3.0);
    assert_eq!(manifold.points[1].point_y, 5.0);
}

#[test]
fn build_manifolds_reports_two_aabb_capsule_arc_clipped_face_points() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-8.0, 4.5, 8.0, 5.5, 1.0),
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
            b: aabb_entity,
        }
    );
    assert_eq!(manifold.normal_x, 0.0);
    assert_eq!(manifold.normal_y, -1.0);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold
        .points()
        .iter()
        .all(|point| (point.point_y - 5.0).abs() < 0.001 && point.penetration > 0.6));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x + 5.0).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_x - 5.0).abs() < 0.001));
}

#[test]
fn build_manifolds_reports_two_parallel_capsule_side_points() {
    let mut world = World::default();
    let first = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_capsule(
        &mut world,
        0.0,
        1.5,
        capsule(-2.0, 0.0, 4.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(
        manifolds,
        vec![CollisionManifold {
            pair: CollisionPair {
                a: first,
                b: second,
            },
            normal_x: 0.0,
            normal_y: 1.0,
            penetration: 0.5,
            point_count: 2,
            points: [
                CollisionContactPoint {
                    point_x: -2.0,
                    point_y: 0.75,
                    penetration: 0.5,
                },
                CollisionContactPoint {
                    point_x: 3.0,
                    point_y: 0.75,
                    penetration: 0.5,
                },
            ],
        }]
    );
    assert_eq!(manifolds[0].points().len(), 2);
}

#[test]
fn build_manifolds_reports_two_non_parallel_capsule_endpoint_points() {
    let mut world = World::default();
    let first = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-2.0, 1.5, 2.0, 1.75, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: first,
            b: second,
        }
    );
    assert_eq!(manifold.normal_x, 0.0);
    assert_eq!(manifold.normal_y, 1.0);
    assert_eq!(manifold.point_count, 2);
    assert!((manifold.points[0].point_x + 2.0).abs() < 0.001);
    assert!((manifold.points[0].point_y - 0.75).abs() < 0.001);
    assert!((manifold.points[0].penetration - 0.5).abs() < 0.001);
    assert!((manifold.points[1].point_x - 2.0).abs() < 0.001);
    assert!((manifold.points[1].point_y - 0.875).abs() < 0.001);
    assert!((manifold.points[1].penetration - 0.25).abs() < 0.001);
}

#[test]
fn build_manifolds_reports_two_crossing_capsule_curve_points() {
    let mut world = World::default();
    let horizontal = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let vertical = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(0.0, -3.0, 0.0, 3.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: horizontal,
            b: vertical,
        }
    );
    assert_eq!(manifold.normal_x, 1.0);
    assert_eq!(manifold.normal_y, 0.0);
    assert_eq!(manifold.point_count, 2);
    assert!(
        manifold.points().iter().all(|point| {
            point.point_x.abs() < 0.001 && (point.penetration - 2.0).abs() < 0.001
        }),
        "expected crossing capsule curve points on the normal tangent, got {manifold:?}"
    );
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y + 1.0).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y - 1.0).abs() < 0.001));
}
