use super::*;

#[test]
fn build_pairs_returns_overlapping_entities() {
    let mut world = World::default();
    let first = world.spawn_enemy(10.0, 10.0, 0);
    let second = world.spawn_enemy(18.0, 10.0, 0);
    world.spawn_enemy(80.0, 80.0, 0);

    let pairs = CollisionSystem::build_pairs(&world);

    assert_eq!(pairs.len(), 1);
    assert_eq!(
        pairs[0],
        CollisionPair {
            a: first,
            b: second
        }
    );
}

#[test]
fn build_layer_pairs_orients_requested_layers() {
    let mut world = World::default();
    let player = world.spawn_player(10.0, 10.0, 0);
    let enemy = world.spawn_enemy(12.0, 10.0, 0);

    let pairs =
        CollisionSystem::build_layer_pairs(&world, CollisionLayer::Player, CollisionLayer::Enemy);

    assert_eq!(
        pairs,
        vec![CollisionPair {
            a: player,
            b: enemy
        }]
    );
}

#[test]
fn collision_filters_can_exclude_existing_layer_pairs() {
    let mut world = World::default();
    let player = world.spawn_player(10.0, 10.0, 0);
    world.spawn_enemy(12.0, 10.0, 0);
    world.set_collision_filter(
        player,
        CollisionFilter::new(CollisionMask::PLAYER, CollisionMask::BULLET),
    );

    assert!(CollisionSystem::build_pairs(&world).is_empty());
    assert!(CollisionSystem::build_layer_pairs(
        &world,
        CollisionLayer::Player,
        CollisionLayer::Enemy,
    )
    .is_empty());
}

#[test]
fn mask_pairs_support_custom_categories() {
    let mut world = World::default();
    let sensor_category = CollisionMask::bit(8).expect("bit index is valid");
    let actor_category = CollisionMask::bit(9).expect("bit index is valid");
    let sensor = spawn_custom_body(&mut world, 10.0, 10.0, sensor_category, actor_category);
    let actor = spawn_custom_body(&mut world, 12.0, 10.0, actor_category, sensor_category);

    let pairs = CollisionSystem::build_mask_pairs(&world, sensor_category, actor_category);

    assert_eq!(
        pairs,
        vec![CollisionPair {
            a: sensor,
            b: actor
        }]
    );
}

#[test]
fn build_pairs_uses_precise_circle_overlap_after_broadphase() {
    let mut world = World::default();
    spawn_custom_circle(
        &mut world,
        0.0,
        0.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_circle(
        &mut world,
        9.0,
        9.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    assert!(CollisionSystem::build_pairs(&world).is_empty());
}

#[test]
fn build_pairs_supports_capsule_colliders() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        1.4,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
    let circle_entity = spawn_custom_circle(
        &mut world,
        7.0,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        0.0,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let pairs = CollisionSystem::build_pairs(&world);

    assert_eq!(
        pairs,
        vec![
            CollisionPair {
                a: capsule_entity,
                b: aabb_entity,
            },
            CollisionPair {
                a: capsule_entity,
                b: circle_entity,
            },
        ]
    );
}

#[test]
fn build_pairs_supports_edge_colliders() {
    let mut world = World::default();
    let edge_entity = spawn_custom_edge(
        &mut world,
        0.0,
        0.0,
        edge(-5.0, 0.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        0.0,
        0.5,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_circle(
        &mut world,
        0.0,
        4.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let pairs = CollisionSystem::build_pairs(&world);

    assert_eq!(
        pairs,
        vec![CollisionPair {
            a: edge_entity,
            b: circle_entity,
        }]
    );
    assert!(!pairs.iter().any(|pair| pair.a == miss || pair.b == miss));
}

#[test]
fn build_pairs_supports_convex_polygon_colliders() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        2.4,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
    let circle_entity = spawn_custom_circle(
        &mut world,
        -3.0,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        0.0,
        3.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let pairs = CollisionSystem::build_pairs(&world);

    assert_eq!(
        pairs,
        vec![
            CollisionPair {
                a: circle_entity,
                b: polygon_entity,
            },
            CollisionPair {
                a: polygon_entity,
                b: aabb_entity,
            },
        ]
    );
}

#[test]
fn build_pairs_supports_oriented_box_colliders() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(6.0, 1.0, core::f32::consts::FRAC_PI_4),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        4.0,
        4.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
    let circle_entity = spawn_custom_circle(
        &mut world,
        -4.0,
        -4.0,
        0.75,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let miss = spawn_custom_body(
        &mut world,
        0.0,
        12.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(miss, collider(0.5, 0.5));

    let pairs = CollisionSystem::build_pairs(&world);

    assert_eq!(pairs.len(), 2);
    assert!(pairs.contains(&CollisionPair {
        a: oriented_entity,
        b: aabb_entity,
    }));
    assert!(pairs.contains(&CollisionPair {
        a: oriented_entity,
        b: circle_entity,
    }));
}
