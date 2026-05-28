use super::*;

#[test]
fn aabb_query_returns_overlapping_mask_hits() {
    let mut world = World::default();
    let enemy = world.spawn_enemy(20.0, 20.0, 0);
    world.spawn_enemy(100.0, 100.0, 0);
    let bounds = AabbBounds::from_center(Transform2D { x: 20.0, y: 20.0 }, 4.0, 4.0)
        .expect("query bounds are valid");

    let hits = CollisionSystem::aabb_query(&world, bounds, CollisionMask::ENEMY);

    assert_eq!(hits, vec![AabbQueryHit { entity: enemy }]);
}

#[test]
fn circle_query_returns_overlapping_circle_and_aabb_hits() {
    let mut world = World::default();
    let circle_entity = spawn_custom_circle(
        &mut world,
        10.0,
        10.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        18.0,
        10.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.spawn_enemy(80.0, 80.0, 0);

    let hits = CollisionSystem::circle_query(
        &world,
        Transform2D { x: 10.0, y: 10.0 },
        6.0,
        CollisionMask::ENEMY,
    );

    assert_eq!(
        hits,
        vec![
            CircleQueryHit {
                entity: circle_entity
            },
            CircleQueryHit {
                entity: aabb_entity
            }
        ]
    );
}

#[test]
fn aabb_and_circle_queries_support_capsule_colliders() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        20.0,
        10.0,
        capsule(-4.0, 0.0, 4.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let aabb_hits = CollisionSystem::aabb_query(
        &world,
        AabbBounds::from_center(Transform2D { x: 24.5, y: 10.0 }, 0.5, 0.5)
            .expect("query bounds are valid"),
        CollisionMask::ENEMY,
    );
    let circle_hits = CollisionSystem::circle_query(
        &world,
        Transform2D { x: 15.0, y: 10.0 },
        1.0,
        CollisionMask::ENEMY,
    );

    assert_eq!(
        aabb_hits,
        vec![AabbQueryHit {
            entity: capsule_entity
        }]
    );
    assert_eq!(
        circle_hits,
        vec![CircleQueryHit {
            entity: capsule_entity
        }]
    );
}

#[test]
fn aabb_and_circle_queries_support_oriented_box_colliders() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        20.0,
        10.0,
        oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let aabb_hits = CollisionSystem::aabb_query(
        &world,
        AabbBounds::from_center(Transform2D { x: 23.0, y: 13.0 }, 0.5, 0.5)
            .expect("query bounds are valid"),
        CollisionMask::ENEMY,
    );
    let circle_hits = CollisionSystem::circle_query(
        &world,
        Transform2D { x: 17.0, y: 7.0 },
        0.75,
        CollisionMask::ENEMY,
    );

    assert_eq!(
        aabb_hits,
        vec![AabbQueryHit {
            entity: oriented_entity
        }]
    );
    assert_eq!(
        circle_hits,
        vec![CircleQueryHit {
            entity: oriented_entity
        }]
    );
}

#[test]
fn aabb_and_circle_queries_support_convex_polygon_colliders() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        20.0,
        10.0,
        convex_polygon_collider(&[(-4.0, -1.0), (4.0, -1.0), (4.0, 1.0), (-4.0, 1.0)])
            .with_rotation(core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let aabb_hits = CollisionSystem::aabb_query(
        &world,
        AabbBounds::from_center(Transform2D { x: 23.0, y: 13.0 }, 0.5, 0.5)
            .expect("query bounds are valid"),
        CollisionMask::ENEMY,
    );
    let circle_hits = CollisionSystem::circle_query(
        &world,
        Transform2D { x: 17.0, y: 7.0 },
        0.75,
        CollisionMask::ENEMY,
    );

    assert_eq!(
        aabb_hits,
        vec![AabbQueryHit {
            entity: polygon_entity
        }]
    );
    assert_eq!(
        circle_hits,
        vec![CircleQueryHit {
            entity: polygon_entity
        }]
    );
}
