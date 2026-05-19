use ferrum_core::{CollisionLayer, CollisionPair, CollisionSystem, World};

fn main() {
    let mut world = World::default();
    let player = world.spawn_player(100.0, 100.0, 0);
    let overlapping_enemy = world.spawn_enemy(126.0, 100.0, 0);
    let _far_enemy = world.spawn_enemy(220.0, 100.0, 0);

    let pairs =
        CollisionSystem::build_layer_pairs(&world, CollisionLayer::Player, CollisionLayer::Enemy);

    println!("player/enemy pairs: {pairs:?}");

    assert_eq!(
        pairs,
        vec![CollisionPair {
            a: player,
            b: overlapping_enemy,
        }]
    );
}
