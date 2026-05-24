use ferrum_core::{AabbBounds, AabbCollider, CollisionLayer, CollisionSystem, Transform2D};

fn main() {
    let player_transform = Transform2D { x: 100.0, y: 100.0 };
    let enemy_transform = Transform2D { x: 126.0, y: 100.0 };
    let player_collider = collider(18.0, 18.0, CollisionLayer::Player);
    let enemy_collider = collider(12.0, 12.0, CollisionLayer::Enemy);

    let player_bounds = AabbBounds::from_transform(player_transform, player_collider);
    let enemy_bounds = AabbBounds::from_transform(enemy_transform, enemy_collider);
    let is_overlapping = CollisionSystem::overlaps(
        player_transform,
        player_collider,
        enemy_transform,
        enemy_collider,
    );

    println!("player bounds: {player_bounds:?}");
    println!("enemy bounds:  {enemy_bounds:?}");
    println!("overlap:       {is_overlapping}");

    assert!(is_overlapping);
}

fn collider(half_width: f32, half_height: f32, layer: CollisionLayer) -> AabbCollider {
    AabbCollider::new(half_width, half_height, true, layer)
}
