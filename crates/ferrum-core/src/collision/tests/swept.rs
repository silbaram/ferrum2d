use super::*;

#[test]
fn swept_aabb_contact_reports_entry_normal() {
    let hit = CollisionSystem::swept_aabb_contact(
        Transform2D { x: 0.0, y: 0.0 },
        Velocity { vx: 100.0, vy: 0.0 },
        collider(1.0, 1.0),
        Transform2D { x: 50.0, y: 0.0 },
        Velocity::default(),
        collider(5.0, 5.0),
        1.0,
    )
    .unwrap();

    assert!((hit.time - 0.44).abs() < 0.01);
    assert_eq!(hit.normal_x, 1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn swept_aabb_contact_rejects_disabled_colliders() {
    assert!(CollisionSystem::swept_aabb_contact(
        Transform2D { x: 0.0, y: 0.0 },
        Velocity { vx: 10.0, vy: 0.0 },
        collider(1.0, 1.0).with_enabled(false),
        Transform2D { x: 5.0, y: 0.0 },
        Velocity::default(),
        collider(1.0, 1.0),
        1.0,
    )
    .is_none());
}

#[test]
fn swept_aabb_contact_respects_collider_offsets() {
    let hit = CollisionSystem::swept_aabb_contact(
        Transform2D { x: 0.0, y: 0.0 },
        Velocity { vx: 10.0, vy: 0.0 },
        collider(1.0, 1.0).with_offset(4.0, 0.0),
        Transform2D { x: 8.0, y: 0.0 },
        Velocity::default(),
        collider(1.0, 1.0),
        1.0,
    )
    .unwrap();

    assert!((hit.time - 0.2).abs() < 0.01);
    assert_eq!(hit.normal_x, 1.0);
    assert_eq!(hit.normal_y, 0.0);
}

#[test]
fn build_pairs_into_reuses_scratch_and_pair_buffers() {
    let mut world = World::default();
    world.spawn_player(10.0, 10.0, 0);
    world.spawn_enemy(12.0, 10.0, 0);
    let mut scratch = CollisionScratch::default();
    let mut pairs = Vec::with_capacity(4);

    CollisionSystem::build_layer_pairs_into(
        &mut scratch,
        &world,
        CollisionLayer::Player,
        CollisionLayer::Enemy,
        &mut pairs,
    );
    let proxy_capacity = scratch.current_proxies.capacity();
    let pair_capacity = pairs.capacity();

    CollisionSystem::build_layer_pairs_into(
        &mut scratch,
        &World::default(),
        CollisionLayer::Player,
        CollisionLayer::Enemy,
        &mut pairs,
    );

    assert!(pairs.is_empty());
    assert_eq!(scratch.current_proxies.capacity(), proxy_capacity);
    assert_eq!(pairs.capacity(), pair_capacity);
}

#[test]
fn rigid_collider_contacts_into_reuses_buffers_and_matches_allocating_api() {
    let mut world = World::default();
    let player = spawn_custom_body(
        &mut world,
        10.0,
        10.0,
        CollisionLayer::Player.mask(),
        CollisionMask::ALL,
    );
    world.set_aabb_collider(
        player,
        AabbCollider::new(5.0, 5.0, false, CollisionLayer::Player),
    );
    world.set_collision_filter(
        player,
        CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
    );
    let enemy = spawn_custom_body(
        &mut world,
        12.0,
        10.0,
        CollisionLayer::Enemy.mask(),
        CollisionMask::ALL,
    );
    world.set_aabb_collider(
        enemy,
        AabbCollider::new(5.0, 5.0, false, CollisionLayer::Enemy),
    );
    world.set_collision_filter(
        enemy,
        CollisionFilter::new(CollisionLayer::Enemy.mask(), CollisionMask::ALL),
    );
    let mut scratch = CollisionScratch::default();
    let mut contacts = Vec::with_capacity(4);

    let allocating_contacts = CollisionSystem::build_rigid_collider_contacts(&world);
    CollisionSystem::build_rigid_collider_contacts_into(&mut scratch, &world, &mut contacts);

    assert_eq!(contacts, allocating_contacts);
    let proxy_capacity = scratch.current_proxies.capacity();
    let pair_capacity = scratch.collider_pairs.capacity();
    let contact_capacity = contacts.capacity();

    CollisionSystem::build_rigid_collider_contacts_into(
        &mut scratch,
        &World::default(),
        &mut contacts,
    );

    assert!(contacts.is_empty());
    assert_eq!(scratch.current_proxies.capacity(), proxy_capacity);
    assert_eq!(scratch.collider_pairs.capacity(), pair_capacity);
    assert_eq!(contacts.capacity(), contact_capacity);
}

#[test]
fn rigid_collider_manifolds_into_reuses_buffers_and_excludes_trigger_convex_colliders() {
    let mut world = World::default();
    let trigger = spawn_custom_convex_polygon(
        &mut world,
        10.0,
        10.0,
        convex_polygon_collider(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
        CollisionLayer::Enemy.mask(),
        CollisionMask::ALL,
    );
    let solid = spawn_custom_body(
        &mut world,
        10.0,
        10.0,
        CollisionLayer::Player.mask(),
        CollisionMask::ALL,
    );
    world.set_aabb_collider(
        solid,
        AabbCollider::new(5.0, 5.0, false, CollisionLayer::Player),
    );
    world.set_collision_filter(
        solid,
        CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
    );
    assert!(!CollisionSystem::build_contacts(&world).is_empty());

    let mut scratch = CollisionScratch::default();
    let mut manifolds = Vec::with_capacity(4);
    CollisionSystem::build_rigid_collider_manifolds_into(&mut scratch, &world, &mut manifolds);
    let proxy_capacity = scratch.current_proxies.capacity();
    let pair_capacity = scratch.collider_pairs.capacity();
    let manifold_capacity = manifolds.capacity();

    assert!(world.convex_polygon_collider(trigger).unwrap().is_trigger);
    assert!(manifolds.is_empty());

    CollisionSystem::build_rigid_collider_manifolds_into(
        &mut scratch,
        &World::default(),
        &mut manifolds,
    );

    assert!(manifolds.is_empty());
    assert_eq!(scratch.current_proxies.capacity(), proxy_capacity);
    assert_eq!(scratch.collider_pairs.capacity(), pair_capacity);
    assert_eq!(manifolds.capacity(), manifold_capacity);
}

#[test]
fn swept_aabb_time_detects_fast_pass_through() {
    let hit = CollisionSystem::swept_aabb_time(
        Transform2D { x: 0.0, y: 0.0 },
        Velocity { vx: 100.0, vy: 0.0 },
        collider(1.0, 1.0),
        Transform2D { x: 50.0, y: 0.0 },
        Velocity::default(),
        collider(5.0, 5.0),
        1.0,
    )
    .unwrap();

    assert!((hit.time - 0.44).abs() < 0.01);
}

#[test]
fn swept_layer_pairs_detects_fast_bullet_enemy_pass_through() {
    let mut world = World::default();
    let bullet = world.spawn_bullet(100.0, 50.0, 1000.0, 0.0, 0);
    let enemy = world.spawn_enemy(150.0, 50.0, 0);
    world.set_transform(bullet, Transform2D { x: 200.0, y: 50.0 });

    let pairs = CollisionSystem::build_swept_layer_pairs(
        &world,
        CollisionLayer::Bullet,
        CollisionLayer::Enemy,
        0.1,
    );

    assert_eq!(
        pairs,
        vec![CollisionPair {
            a: bullet,
            b: enemy
        }]
    );
}
