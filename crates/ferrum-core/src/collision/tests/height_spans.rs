use super::*;

#[test]
fn build_pairs_excludes_overlapping_entities_on_different_floors() {
    let mut world = World::default();
    let first = world.spawn_enemy(10.0, 10.0, 0);
    let second = world.spawn_enemy(10.0, 10.0, 0);
    world.set_height_span_parts(first, 0, 0.0, 16.0);
    world.set_height_span_parts(second, 1, 0.0, 16.0);

    assert!(CollisionSystem::build_pairs(&world).is_empty());
}

#[test]
fn build_pairs_excludes_overlapping_entities_with_separated_height_spans() {
    let mut world = World::default();
    let first = world.spawn_enemy(10.0, 10.0, 0);
    let second = world.spawn_enemy(10.0, 10.0, 0);
    world.set_height_span(first, HeightSpan::on_default_floor(0.0, 8.0).unwrap());
    world.set_height_span(second, HeightSpan::on_default_floor(12.0, 8.0).unwrap());

    assert!(CollisionSystem::build_pairs(&world).is_empty());
}

#[test]
fn build_pairs_allows_entities_with_overlapping_height_spans() {
    let mut world = World::default();
    let first = world.spawn_enemy(10.0, 10.0, 0);
    let second = world.spawn_enemy(10.0, 10.0, 0);
    world.set_height_span(first, HeightSpan::on_default_floor(0.0, 16.0).unwrap());
    world.set_height_span(second, HeightSpan::on_default_floor(8.0, 16.0).unwrap());

    assert_eq!(
        CollisionSystem::build_pairs(&world),
        vec![CollisionPair {
            a: first,
            b: second
        }]
    );
}

#[test]
fn missing_height_span_preserves_legacy_collision_behavior() {
    let mut world = World::default();
    let first = world.spawn_enemy(10.0, 10.0, 0);
    let second = world.spawn_enemy(10.0, 10.0, 0);
    world.set_height_span(first, HeightSpan::on_default_floor(64.0, 8.0).unwrap());

    assert_eq!(
        CollisionSystem::build_pairs(&world),
        vec![CollisionPair {
            a: first,
            b: second
        }]
    );
}

#[test]
fn swept_pairs_respect_height_span_filter() {
    let mut world = World::default();
    let moving = world.spawn_enemy(0.0, 0.0, 0);
    let target = world.spawn_enemy(8.0, 0.0, 0);
    world.set_velocity(moving, Velocity { vx: 80.0, vy: 0.0 });
    world.set_height_span_parts(moving, 0, 0.0, 8.0);
    world.set_height_span_parts(target, 0, 16.0, 8.0);

    assert!(CollisionSystem::build_swept_layer_pairs(
        &world,
        CollisionLayer::Enemy,
        CollisionLayer::Enemy,
        0.1,
    )
    .is_empty());
}

#[test]
fn explicit_body_queries_respect_height_span_filter() {
    let mut world = World::default();
    let same_floor = world.spawn_enemy(0.0, 0.0, 0);
    let upper_floor = world.spawn_enemy(0.0, 0.0, 0);
    let legacy = world.spawn_enemy(0.0, 0.0, 0);
    world.set_height_span_parts(same_floor, 1, 0.0, 8.0);
    world.set_height_span_parts(upper_floor, 1, 16.0, 8.0);

    let mut hits = Vec::new();
    CollisionSystem::point_query_with_height_span_into(
        &world,
        Transform2D { x: 0.0, y: 0.0 },
        CollisionMask::ALL,
        HeightSpan::new(PhysicsFloorId(1), 4.0, 4.0),
        &mut hits,
    );

    assert_eq!(hits, vec![PointQueryHit { entity: same_floor }]);
    assert!(!hits.iter().any(|hit| hit.entity == upper_floor));
    assert!(!hits.iter().any(|hit| hit.entity == legacy));
}

#[test]
fn explicit_cast_queries_respect_height_span_filter() {
    let mut world = World::default();
    let same_floor = world.spawn_enemy(8.0, 0.0, 0);
    let other_floor = world.spawn_enemy(4.0, 0.0, 0);
    world.set_height_span_parts(same_floor, 2, 0.0, 8.0);
    world.set_height_span_parts(other_floor, 3, 0.0, 8.0);
    let height_span = HeightSpan::new(PhysicsFloorId(2), 0.0, 8.0);

    let mut ray_hits = Vec::new();
    CollisionSystem::raycast_all_with_height_span_into(
        &world,
        Transform2D { x: -16.0, y: 0.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        32.0,
        CollisionMask::ALL,
        height_span,
        &mut ray_hits,
    );
    assert_eq!(ray_hits.len(), 1);
    assert_eq!(ray_hits[0].entity, same_floor);

    let mut shape_hits = Vec::new();
    CollisionSystem::shape_cast_all_with_height_span_into(
        &world,
        CollisionQueryShape::Circle {
            center: Transform2D { x: -16.0, y: 0.0 },
            radius: 2.0,
        },
        Velocity { vx: 1.0, vy: 0.0 },
        32.0,
        CollisionMask::ALL,
        height_span,
        &mut shape_hits,
    );
    assert_eq!(shape_hits.len(), 1);
    assert_eq!(shape_hits[0].entity, same_floor);
}
