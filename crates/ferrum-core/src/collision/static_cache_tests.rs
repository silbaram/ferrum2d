use super::*;
use crate::components::{CollisionFilter, RigidBody};

fn fixture(count: usize) -> (World, Vec<Entity>) {
    let mut world = World::default();
    let mut entities = Vec::new();
    for i in 0..count {
        let e = world.spawn_entity();
        world.set_transform(
            e,
            Transform2D {
                x: ((i * 7919) % count) as f32 * 3.0,
                y: 0.0,
            },
        );
        world.set_oriented_box_collider(
            e,
            OrientedBoxCollider::new(1.0, 2.0, i as f32 * 0.1, false, CollisionLayer::Wall),
        );
        world.set_rigid_body(
            e,
            if i % 64 == 0 {
                RigidBody::dynamic(1.0)
            } else {
                RigidBody::static_body()
            },
        );
        entities.push(e);
    }
    (world, entities)
}

fn assert_matches(world: &World, scratch: &mut CollisionScratch) {
    fill_cached_current_proxies(world, scratch);
    let mut expected = Vec::new();
    fill_current_proxies(world, &mut expected);
    let signature = |proxies: &[CollisionProxy]| {
        proxies
            .iter()
            .map(|p| (p.key, p.bounds))
            .collect::<Vec<_>>()
    };
    assert_eq!(signature(&scratch.current_proxies), signature(&expected));
    let mut actual = Vec::new();
    CollisionSystem::build_pairs_into(scratch, world, &mut actual);
    assert_eq!(actual, CollisionSystem::build_pairs(world));
}

#[test]
fn static_cache_matches_uncached_geometry_after_every_invalidation() {
    let (mut world, entities) = fixture(80);
    let mut scratch = CollisionScratch::default();
    assert_matches(&world, &mut scratch);
    world.set_transform(entities[1], Transform2D { x: 500.0, y: 100.0 });
    assert_matches(&world, &mut scratch);
    world.set_rotation(entities[2], crate::components::Rotation2D { radians: 1.2 });
    assert_matches(&world, &mut scratch);
    world.set_oriented_box_collider(
        entities[3],
        OrientedBoxCollider::new(5.0, 3.0, 0.7, false, CollisionLayer::Wall).with_enabled(false),
    );
    assert_matches(&world, &mut scratch);
    world.set_collision_filter(
        entities[4],
        CollisionFilter::new(CollisionMask::ALL, CollisionMask::NONE),
    );
    assert_matches(&world, &mut scratch);
    world.set_rigid_body(entities[5], RigidBody::dynamic(1.0));
    assert_matches(&world, &mut scratch);
    world.despawn(entities[6]);
    let recycled = world.spawn_entity();
    world.set_transform(recycled, Transform2D { x: -80.0, y: 0.0 });
    world.set_aabb_collider(
        recycled,
        AabbCollider::new(8.0, 4.0, false, CollisionLayer::Wall),
    );
    assert_matches(&world, &mut scratch);
}

#[test]
#[ignore = "manual release-mode before/after timing; correctness is checked separately"]
fn static_proxy_reuse_benchmark() {
    let (world, _) = fixture(8192);
    let mut scratch = CollisionScratch::default();
    let mut baseline = Vec::new();
    fill_cached_current_proxies(&world, &mut scratch);
    let start = std::time::Instant::now();
    for _ in 0..200 {
        fill_current_proxies(std::hint::black_box(&world), &mut baseline);
        std::hint::black_box(&baseline);
    }
    let uncached = start.elapsed();
    let start = std::time::Instant::now();
    for _ in 0..200 {
        fill_cached_current_proxies(std::hint::black_box(&world), &mut scratch);
        std::hint::black_box(&scratch.current_proxies);
    }
    eprintln!(
        "8192 colliders / 128 dynamic / 200 builds: uncached={uncached:?}, cached={:?}",
        start.elapsed()
    );
}
