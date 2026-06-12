use super::*;

#[test]
fn compound_collider_secondary_shape_participates_in_queries_contacts_and_debug() {
    let mut world = World::default();
    let compound = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::PLAYER,
    );
    let target = spawn_custom_body(
        &mut world,
        20.0,
        0.0,
        CollisionMask::PLAYER,
        CollisionMask::ENEMY,
    );
    assert_eq!(
        world.add_compound_collider(
            compound,
            CompoundCollider::new(CompoundColliderShape::Circle(
                CircleCollider::new(6.0, false, CollisionLayer::Enemy).with_offset(20.0, 0.0),
            ))
            .with_filter(CollisionFilter::new(
                CollisionMask::ENEMY,
                CollisionMask::PLAYER,
            )),
        ),
        Some(1)
    );

    let point_hits = CollisionSystem::point_query(
        &world,
        Transform2D { x: 20.0, y: 0.0 },
        CollisionMask::ENEMY,
    );
    assert_eq!(point_hits, vec![PointQueryHit { entity: compound }]);

    let contacts = CollisionSystem::build_contacts(&world);
    assert!(
        contacts.iter().any(|contact| {
            (contact.pair.a == compound && contact.pair.b == target)
                || (contact.pair.a == target && contact.pair.b == compound)
        }),
        "secondary compound collider should contact target, got {contacts:?}"
    );

    let collider_lines =
        CollisionSystem::build_physics_debug_lines_with_flags(&world, 4.0, PHYSICS_DEBUG_COLLIDERS);
    assert!(
        collider_lines.len() > 8,
        "compound body should draw primary and secondary collider outlines"
    );

    world.set_aabb_collider(
        compound,
        AabbCollider::new(7.0, 7.0, true, CollisionLayer::Player).with_offset(-10.0, 0.0),
    );
    assert_eq!(
            world.compound_collider_count(compound),
            2,
            "single-collider API should update the primary collider without dropping secondary colliders"
        );
    let point_hits_after_primary_update = CollisionSystem::point_query(
        &world,
        Transform2D { x: 20.0, y: 0.0 },
        CollisionMask::ENEMY,
    );
    assert_eq!(
        point_hits_after_primary_update,
        vec![PointQueryHit { entity: compound }]
    );
}

#[test]
fn queries_return_entity_once_when_multiple_compound_colliders_match() {
    let mut world = World::default();
    let entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::PLAYER,
    );
    let later_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::PLAYER,
    );
    assert_eq!(
        world.add_compound_collider(
            entity,
            CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider::new(
                6.0,
                false,
                CollisionLayer::Enemy,
            )))
            .with_filter(CollisionFilter::new(
                CollisionMask::ENEMY,
                CollisionMask::PLAYER,
            )),
        ),
        Some(1)
    );

    assert_eq!(
        CollisionSystem::point_query(&world, Transform2D { x: 0.0, y: 0.0 }, CollisionMask::ENEMY),
        vec![
            PointQueryHit { entity },
            PointQueryHit {
                entity: later_entity
            }
        ]
    );
    assert_eq!(
        CollisionSystem::aabb_query(
            &world,
            AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
                .expect("valid query bounds"),
            CollisionMask::ENEMY,
        ),
        vec![
            AabbQueryHit { entity },
            AabbQueryHit {
                entity: later_entity
            }
        ]
    );
    assert_eq!(
        CollisionSystem::circle_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            2.0,
            CollisionMask::ENEMY,
        ),
        vec![
            CircleQueryHit { entity },
            CircleQueryHit {
                entity: later_entity
            }
        ]
    );
    assert_eq!(
        CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 2.0,
            },
            CollisionMask::ENEMY,
        ),
        vec![
            ShapeQueryHit { entity },
            ShapeQueryHit {
                entity: later_entity
            }
        ]
    );
}

#[test]
fn build_pairs_dedupes_multiple_compound_collider_pairs_per_entity_pair() {
    let mut world = World::default();
    let first = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::PLAYER,
    );
    let second = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::PLAYER,
        CollisionMask::ENEMY,
    );
    for entity in [first, second] {
        assert_eq!(
            world.add_compound_collider(
                entity,
                CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider::new(
                    6.0,
                    true,
                    CollisionLayer::Enemy,
                )))
                .with_filter(CollisionFilter::new(
                    CollisionMask::ENEMY,
                    CollisionMask::PLAYER
                )),
            ),
            Some(1)
        );
    }

    let collider_pairs = CollisionSystem::build_all_collider_pairs(&world);
    assert!(
        collider_pairs.len() > 1,
        "fixture should generate duplicate collider-level pairs"
    );
    assert_eq!(
        CollisionSystem::build_pairs(&world),
        vec![CollisionPair {
            a: first,
            b: second,
        }]
    );
}

#[test]
fn chain_collider_segments_participate_in_queries_contacts_and_debug_lines() {
    let mut world = World::default();
    let chain = spawn_custom_chain(
        &mut world,
        0.0,
        0.0,
        chain(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)], false),
        CollisionMask::WALL,
        CollisionMask::PLAYER,
    );
    let player = spawn_custom_circle(
        &mut world,
        10.0,
        5.0,
        1.0,
        CollisionMask::PLAYER,
        CollisionMask::WALL,
    );

    let aabb_hits = CollisionSystem::aabb_query(
        &world,
        AabbBounds::from_center(Transform2D { x: 10.0, y: 5.0 }, 1.0, 1.0)
            .expect("valid query bounds"),
        CollisionMask::WALL,
    );
    assert_eq!(aabb_hits, vec![AabbQueryHit { entity: chain }]);

    let contacts = CollisionSystem::build_contacts(&world);
    assert!(
        contacts.iter().any(|contact| {
            (contact.pair.a == chain && contact.pair.b == player)
                || (contact.pair.a == player && contact.pair.b == chain)
        }),
        "chain segment should contact circle body, got {contacts:?}"
    );

    let hits = CollisionSystem::raycast_all(
        &world,
        Transform2D { x: 15.0, y: 5.0 },
        Velocity { vx: -1.0, vy: 0.0 },
        20.0,
        CollisionMask::WALL,
    );
    assert_eq!(hits.first().map(|hit| hit.entity), Some(chain));

    let debug_lines =
        CollisionSystem::build_physics_debug_lines_with_flags(&world, 4.0, PHYSICS_DEBUG_COLLIDERS);
    assert!(debug_lines.iter().any(|line| {
        (line.x0 - 0.0).abs() < 0.0001
            && (line.y0 - 0.0).abs() < 0.0001
            && (line.x1 - 10.0).abs() < 0.0001
            && (line.y1 - 0.0).abs() < 0.0001
    }));
    assert!(debug_lines.iter().any(|line| {
        (line.x0 - 10.0).abs() < 0.0001
            && (line.y0 - 0.0).abs() < 0.0001
            && (line.x1 - 10.0).abs() < 0.0001
            && (line.y1 - 10.0).abs() < 0.0001
    }));
}
