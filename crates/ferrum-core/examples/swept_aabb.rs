use ferrum_core::{
    AabbCollider, CollisionLayer, CollisionPair, CollisionSystem, Transform2D, Velocity, World,
};

fn main() {
    let delta = 0.1;
    let bullet_start = Transform2D { x: 100.0, y: 50.0 };
    let bullet_velocity = Velocity {
        vx: 1000.0,
        vy: 0.0,
    };
    let bullet_collider = collider(4.0, 4.0, CollisionLayer::Bullet);
    let enemy_transform = Transform2D { x: 150.0, y: 50.0 };
    let enemy_collider = collider(12.0, 12.0, CollisionLayer::Enemy);

    let hit = CollisionSystem::swept_aabb_time(
        bullet_start,
        bullet_velocity,
        bullet_collider,
        enemy_transform,
        Velocity::default(),
        enemy_collider,
        delta,
    )
    .expect("fast bullet path should cross the enemy AABB");

    println!("direct swept hit time: {:.3}", hit.time);
    assert!((hit.time - 0.34).abs() < 0.01);

    let mut world = World::default();
    let bullet = world.spawn_bullet(
        bullet_start.x,
        bullet_start.y,
        bullet_velocity.vx,
        bullet_velocity.vy,
        0,
    );
    let enemy = world.spawn_enemy(enemy_transform.x, enemy_transform.y, 0);
    world.update(delta);

    let current_pairs =
        CollisionSystem::build_layer_pairs(&world, CollisionLayer::Bullet, CollisionLayer::Enemy);
    let swept_pairs = CollisionSystem::build_swept_layer_pairs(
        &world,
        CollisionLayer::Bullet,
        CollisionLayer::Enemy,
        delta,
    );

    println!("current-frame pairs: {current_pairs:?}");
    println!("swept path pairs:    {swept_pairs:?}");

    assert!(current_pairs.is_empty());
    assert_eq!(
        swept_pairs,
        vec![CollisionPair {
            a: bullet,
            b: enemy,
        }]
    );
}

fn collider(half_width: f32, half_height: f32, layer: CollisionLayer) -> AabbCollider {
    AabbCollider {
        half_width,
        half_height,
        is_trigger: true,
        layer,
    }
}
