use super::*;

#[test]
fn build_manifolds_keeps_circle_circle_contact_single_point() {
    let mut world = World::default();
    let first = spawn_custom_circle(
        &mut world,
        0.0,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_circle(
        &mut world,
        1.5,
        0.0,
        1.0,
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
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_count: 1,
            points: [
                CollisionContactPoint {
                    point_x: 1.0,
                    point_y: 0.0,
                    penetration: 0.5,
                },
                CollisionContactPoint {
                    point_x: 0.0,
                    point_y: 0.0,
                    penetration: 0.0,
                },
            ],
        }]
    );
    assert_eq!(manifolds[0].points().len(), 1);
}

#[test]
fn build_manifolds_keeps_convex_polygon_circle_corner_contact_single_point() {
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
            a: polygon_entity,
            b: circle_entity,
        }
    );
    assert_eq!(manifold.point_count, 1);
    assert!((manifold.normal_x - 0.707).abs() < 0.001);
    assert!((manifold.normal_y - 0.707).abs() < 0.001);
    assert!((manifold.penetration - 0.293).abs() < 0.001);
    assert!((manifold.points()[0].point_x - 2.0).abs() < 0.001);
    assert!((manifold.points()[0].point_y - 1.0).abs() < 0.001);
}

#[test]
fn build_manifolds_supports_capsule_contacts_as_single_point() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        7.5,
        0.0,
        2.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(
        manifolds,
        vec![CollisionManifold {
            pair: CollisionPair {
                a: capsule_entity,
                b: circle_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_count: 1,
            points: [
                CollisionContactPoint {
                    point_x: 6.0,
                    point_y: 0.0,
                    penetration: 0.5,
                },
                CollisionContactPoint {
                    point_x: 0.0,
                    point_y: 0.0,
                    penetration: 0.0,
                },
            ],
        }]
    );
    assert_eq!(manifolds[0].points().len(), 1);
}

#[test]
fn build_manifolds_reports_two_aabb_face_points() {
    let mut world = World::default();
    let first = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_body(
        &mut world,
        8.0,
        0.0,
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
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 2.0,
            point_count: 2,
            points: [
                CollisionContactPoint {
                    point_x: 5.0,
                    point_y: -5.0,
                    penetration: 2.0,
                },
                CollisionContactPoint {
                    point_x: 5.0,
                    point_y: 5.0,
                    penetration: 2.0,
                },
            ],
        }]
    );
    assert_eq!(manifolds[0].points().len(), 2);
}

#[test]
fn build_manifolds_reports_two_aabb_circle_face_points() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        5.5,
        0.0,
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
            a: aabb_entity,
            b: circle_entity,
        }
    );
    assert_eq!(manifold.normal_x, 1.0);
    assert_eq!(manifold.normal_y, 0.0);
    assert_eq!(manifold.penetration, 0.5);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold.points().iter().all(
        |point| (point.point_x - 5.0).abs() < 0.001 && (point.penetration - 0.5).abs() < 0.001
    ));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y - 0.866).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y + 0.866).abs() < 0.001));
}
