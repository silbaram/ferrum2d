use crate::components::{AabbCollider, CollisionLayer, Transform2D, Velocity};
use crate::entity::Entity;
use crate::world::World;

const SWEPT_EPSILON: f32 = 0.0001;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionPair {
    pub a: Entity,
    pub b: Entity,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbBounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

impl AabbBounds {
    pub fn from_transform(transform: Transform2D, collider: AabbCollider) -> Self {
        Self {
            min_x: transform.x - collider.half_width,
            min_y: transform.y - collider.half_height,
            max_x: transform.x + collider.half_width,
            max_y: transform.y + collider.half_height,
        }
    }

    pub fn swept(start: Transform2D, end: Transform2D, collider: AabbCollider) -> Self {
        let start_bounds = Self::from_transform(start, collider);
        let end_bounds = Self::from_transform(end, collider);
        Self {
            min_x: start_bounds.min_x.min(end_bounds.min_x),
            min_y: start_bounds.min_y.min(end_bounds.min_y),
            max_x: start_bounds.max_x.max(end_bounds.max_x),
            max_y: start_bounds.max_y.max(end_bounds.max_y),
        }
    }

    pub fn overlaps(self, other: Self) -> bool {
        self.min_x <= other.max_x
            && self.max_x >= other.min_x
            && self.min_y <= other.max_y
            && self.max_y >= other.min_y
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SweptAabbHit {
    pub time: f32,
}

#[derive(Clone, Copy, Debug)]
struct CollisionProxy {
    index: usize,
    bounds: AabbBounds,
}

#[derive(Default)]
pub struct CollisionSystem;

impl CollisionSystem {
    pub fn overlaps(at: Transform2D, ac: AabbCollider, bt: Transform2D, bc: AabbCollider) -> bool {
        AabbBounds::from_transform(at, ac).overlaps(AabbBounds::from_transform(bt, bc))
    }

    pub fn swept_aabb_time(
        moving_start: Transform2D,
        moving_velocity: Velocity,
        moving_collider: AabbCollider,
        target_start: Transform2D,
        target_velocity: Velocity,
        target_collider: AabbCollider,
        delta: f32,
    ) -> Option<SweptAabbHit> {
        if !is_valid_delta(delta) {
            return Self::overlaps(moving_start, moving_collider, target_start, target_collider)
                .then_some(SweptAabbHit { time: 0.0 });
        }

        if Self::overlaps(moving_start, moving_collider, target_start, target_collider) {
            return Some(SweptAabbHit { time: 0.0 });
        }

        let relative_dx = (moving_velocity.vx - target_velocity.vx) * delta;
        let relative_dy = (moving_velocity.vy - target_velocity.vy) * delta;
        let expanded = AabbBounds {
            min_x: target_start.x - target_collider.half_width - moving_collider.half_width,
            min_y: target_start.y - target_collider.half_height - moving_collider.half_height,
            max_x: target_start.x + target_collider.half_width + moving_collider.half_width,
            max_y: target_start.y + target_collider.half_height + moving_collider.half_height,
        };
        let (entry_x, exit_x) =
            axis_entry_exit(moving_start.x, relative_dx, expanded.min_x, expanded.max_x)?;
        let (entry_y, exit_y) =
            axis_entry_exit(moving_start.y, relative_dy, expanded.min_y, expanded.max_y)?;
        let entry = entry_x.max(entry_y);
        let exit = exit_x.min(exit_y);

        if entry <= exit && exit >= 0.0 && entry <= 1.0 {
            Some(SweptAabbHit {
                time: entry.max(0.0),
            })
        } else {
            None
        }
    }

    pub fn build_pairs(world: &World) -> Vec<CollisionPair> {
        let proxies = sorted_current_proxies(world);
        let mut pairs = Vec::new();
        for i in 0..proxies.len() {
            let a = proxies[i];
            for b in proxies.iter().copied().skip(i + 1) {
                if b.bounds.min_x > a.bounds.max_x {
                    break;
                }
                if a.bounds.overlaps(b.bounds) {
                    pairs.push(pair_from_indices(world, a.index, b.index));
                }
            }
        }
        pairs
    }

    pub fn build_layer_pairs(
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
    ) -> Vec<CollisionPair> {
        Self::build_pairs(world)
            .into_iter()
            .filter_map(|pair| orient_pair(world, pair, layer_a, layer_b))
            .collect()
    }

    pub fn build_swept_layer_pairs(
        world: &World,
        moving_layer: CollisionLayer,
        target_layer: CollisionLayer,
        delta: f32,
    ) -> Vec<CollisionPair> {
        let moving = sorted_swept_layer_proxies(world, moving_layer, delta);
        let targets = sorted_swept_layer_proxies(world, target_layer, delta);
        let mut pairs = Vec::new();

        for moving_proxy in moving {
            for target_proxy in targets.iter().copied() {
                if target_proxy.bounds.max_x < moving_proxy.bounds.min_x {
                    continue;
                }
                if target_proxy.bounds.min_x > moving_proxy.bounds.max_x {
                    break;
                }
                if !moving_proxy.bounds.overlaps(target_proxy.bounds) {
                    continue;
                }
                if precise_swept_overlap(world, moving_proxy.index, target_proxy.index, delta) {
                    pairs.push(pair_from_indices(
                        world,
                        moving_proxy.index,
                        target_proxy.index,
                    ));
                }
            }
        }

        pairs
    }
}

fn sorted_current_proxies(world: &World) -> Vec<CollisionProxy> {
    let mut proxies = Vec::new();
    for index in 0..world.transforms.len() {
        if let Some(proxy) = current_proxy(world, index) {
            proxies.push(proxy);
        }
    }
    proxies.sort_by(proxy_order);
    proxies
}

fn sorted_swept_layer_proxies(
    world: &World,
    layer: CollisionLayer,
    delta: f32,
) -> Vec<CollisionProxy> {
    let mut proxies = Vec::new();
    for index in 0..world.transforms.len() {
        if !world.alive.get(index).copied().unwrap_or(false) {
            continue;
        }
        let Some(collider) = world.colliders[index] else {
            continue;
        };
        if collider.layer != layer {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let bounds = if is_valid_delta(delta) {
            let velocity = world.velocities[index].unwrap_or_default();
            let start = previous_transform(transform, velocity, delta);
            AabbBounds::swept(start, transform, collider)
        } else {
            AabbBounds::from_transform(transform, collider)
        };
        proxies.push(CollisionProxy { index, bounds });
    }
    proxies.sort_by(proxy_order);
    proxies
}

fn current_proxy(world: &World, index: usize) -> Option<CollisionProxy> {
    if !world.alive.get(index).copied().unwrap_or(false) {
        return None;
    }
    let transform = world.transforms[index]?;
    let collider = world.colliders[index]?;
    Some(CollisionProxy {
        index,
        bounds: AabbBounds::from_transform(transform, collider),
    })
}

fn proxy_order(a: &CollisionProxy, b: &CollisionProxy) -> std::cmp::Ordering {
    a.bounds
        .min_x
        .total_cmp(&b.bounds.min_x)
        .then_with(|| a.index.cmp(&b.index))
}

fn pair_from_indices(world: &World, a: usize, b: usize) -> CollisionPair {
    CollisionPair {
        a: Entity {
            id: a as u32,
            generation: world.generations[a],
        },
        b: Entity {
            id: b as u32,
            generation: world.generations[b],
        },
    }
}

fn orient_pair(
    world: &World,
    pair: CollisionPair,
    layer_a: CollisionLayer,
    layer_b: CollisionLayer,
) -> Option<CollisionPair> {
    let a_index = pair.a.id as usize;
    let b_index = pair.b.id as usize;
    let a_layer = world.colliders.get(a_index).copied().flatten()?.layer;
    let b_layer = world.colliders.get(b_index).copied().flatten()?.layer;

    if a_layer == layer_a && b_layer == layer_b {
        Some(pair)
    } else if a_layer == layer_b && b_layer == layer_a {
        Some(CollisionPair {
            a: pair.b,
            b: pair.a,
        })
    } else {
        None
    }
}

fn precise_swept_overlap(
    world: &World,
    moving_index: usize,
    target_index: usize,
    delta: f32,
) -> bool {
    let Some(moving_transform) = world.transforms[moving_index] else {
        return false;
    };
    let Some(moving_collider) = world.colliders[moving_index] else {
        return false;
    };
    let Some(target_transform) = world.transforms[target_index] else {
        return false;
    };
    let Some(target_collider) = world.colliders[target_index] else {
        return false;
    };
    if CollisionSystem::overlaps(
        moving_transform,
        moving_collider,
        target_transform,
        target_collider,
    ) {
        return true;
    }

    let moving_velocity = world.velocities[moving_index].unwrap_or_default();
    let target_velocity = world.velocities[target_index].unwrap_or_default();
    let moving_start = previous_transform(moving_transform, moving_velocity, delta);
    let target_start = previous_transform(target_transform, target_velocity, delta);
    CollisionSystem::swept_aabb_time(
        moving_start,
        moving_velocity,
        moving_collider,
        target_start,
        target_velocity,
        target_collider,
        delta,
    )
    .is_some()
}

fn previous_transform(transform: Transform2D, velocity: Velocity, delta: f32) -> Transform2D {
    Transform2D {
        x: transform.x - velocity.vx * delta,
        y: transform.y - velocity.vy * delta,
    }
}

fn axis_entry_exit(start: f32, delta: f32, min: f32, max: f32) -> Option<(f32, f32)> {
    if delta.abs() <= SWEPT_EPSILON {
        return (start >= min && start <= max).then_some((f32::NEG_INFINITY, f32::INFINITY));
    }
    let t1 = (min - start) / delta;
    let t2 = (max - start) / delta;
    Some((t1.min(t2), t1.max(t2)))
}

fn is_valid_delta(delta: f32) -> bool {
    delta.is_finite() && delta > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::CollisionLayer;

    fn collider(half_width: f32, half_height: f32) -> AabbCollider {
        AabbCollider {
            half_width,
            half_height,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        }
    }

    #[test]
    fn overlapping_aabbs_are_detected() {
        let a = Transform2D { x: 10.0, y: 10.0 };
        let b = Transform2D { x: 18.0, y: 10.0 };

        assert!(CollisionSystem::overlaps(
            a,
            collider(5.0, 5.0),
            b,
            collider(5.0, 5.0),
        ));
    }

    #[test]
    fn separated_aabbs_are_not_detected() {
        let a = Transform2D { x: 10.0, y: 10.0 };
        let b = Transform2D { x: 30.1, y: 10.0 };

        assert!(!CollisionSystem::overlaps(
            a,
            collider(10.0, 10.0),
            b,
            collider(10.0, 10.0),
        ));
    }

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

        let pairs = CollisionSystem::build_layer_pairs(
            &world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
        );

        assert_eq!(
            pairs,
            vec![CollisionPair {
                a: player,
                b: enemy
            }]
        );
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
        world.transforms[bullet.id as usize] = Some(Transform2D { x: 200.0, y: 50.0 });

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
}
