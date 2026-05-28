use super::*;

#[test]
fn build_manifolds_reports_two_oriented_box_circle_face_points() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
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
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: oriented_entity,
            b: circle_entity,
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
        .any(|point| (point.point_y - 0.866).abs() < 0.001));
    assert!(manifold
        .points()
        .iter()
        .any(|point| (point.point_y + 0.866).abs() < 0.001));
}

#[test]
fn build_manifolds_reports_two_aabb_oriented_box_face_points() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        8.0,
        0.0,
        oriented_box(5.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(
        manifolds,
        vec![CollisionManifold {
            pair: CollisionPair {
                a: aabb_entity,
                b: oriented_entity,
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
fn build_manifolds_reports_two_oriented_box_face_points() {
    let mut world = World::default();
    let first = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_oriented_box(
        &mut world,
        3.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
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
            penetration: 1.0,
            point_count: 2,
            points: [
                CollisionContactPoint {
                    point_x: 2.0,
                    point_y: -1.0,
                    penetration: 1.0,
                },
                CollisionContactPoint {
                    point_x: 2.0,
                    point_y: 1.0,
                    penetration: 1.0,
                },
            ],
        }]
    );
    assert_eq!(manifolds[0].points().len(), 2);
}

#[test]
fn build_manifolds_reports_two_oriented_box_capsule_side_points() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(5.0, 5.0, 0.0),
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
                a: oriented_entity,
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
}

#[test]
fn build_manifolds_reports_two_oriented_box_capsule_arc_clipped_face_points() {
    let mut world = World::default();
    let rotation = 0.35;
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(5.0, 5.0, rotation),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let geometry =
        oriented_box_geometry(Transform2D { x: 0.0, y: 0.0 }, 5.0, 5.0, rotation).unwrap();
    let start = oriented_box_world_point(geometry, Transform2D { x: -8.0, y: 4.5 });
    let end = oriented_box_world_point(geometry, Transform2D { x: 8.0, y: 5.5 });
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(start.x, start.y, end.x, end.y, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let expected_first = oriented_box_world_point(geometry, Transform2D { x: -5.0, y: 5.0 });
    let expected_second = oriented_box_world_point(geometry, Transform2D { x: 5.0, y: 5.0 });

    let manifolds = CollisionSystem::build_manifolds(&world);

    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(
        manifold.pair,
        CollisionPair {
            a: capsule_entity,
            b: oriented_entity,
        }
    );
    assert!((manifold.normal_x + geometry.axis_y_x).abs() < 0.001);
    assert!((manifold.normal_y + geometry.axis_y_y).abs() < 0.001);
    assert_eq!(manifold.point_count, 2);
    assert!(manifold
        .points()
        .iter()
        .all(|point| point.penetration > 0.6));
    assert!(manifold.points().iter().any(|point| {
        (point.point_x - expected_first.x).abs() < 0.001
            && (point.point_y - expected_first.y).abs() < 0.001
    }));
    assert!(manifold.points().iter().any(|point| {
        (point.point_x - expected_second.x).abs() < 0.001
            && (point.point_y - expected_second.y).abs() < 0.001
    }));
}
