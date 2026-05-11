use crate::components::{AabbCollider, Transform2D};
use crate::entity::Entity;
use crate::world::World;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionPair {
    pub a: Entity,
    pub b: Entity,
}

#[derive(Default)]
pub struct CollisionSystem;

impl CollisionSystem {
    pub fn overlaps(at: Transform2D, ac: AabbCollider, bt: Transform2D, bc: AabbCollider) -> bool {
        let ax_min = at.x - ac.half_width;
        let ax_max = at.x + ac.half_width;
        let ay_min = at.y - ac.half_height;
        let ay_max = at.y + ac.half_height;
        let bx_min = bt.x - bc.half_width;
        let bx_max = bt.x + bc.half_width;
        let by_min = bt.y - bc.half_height;
        let by_max = bt.y + bc.half_height;
        ax_min <= bx_max && ax_max >= bx_min && ay_min <= by_max && ay_max >= by_min
    }

    pub fn build_pairs(world: &World) -> Vec<CollisionPair> {
        let mut out = Vec::new();
        let n = world.transforms.len();
        for i in 0..n {
            let Some(at) = world.transforms[i] else {
                continue;
            };
            let Some(ac) = world.colliders[i] else {
                continue;
            };
            for j in (i + 1)..n {
                let Some(bt) = world.transforms[j] else {
                    continue;
                };
                let Some(bc) = world.colliders[j] else {
                    continue;
                };
                if Self::overlaps(at, ac, bt, bc) {
                    out.push(CollisionPair {
                        a: Entity {
                            id: i as u32,
                            generation: world.generations[i],
                        },
                        b: Entity {
                            id: j as u32,
                            generation: world.generations[j],
                        },
                    });
                }
            }
        }
        out
    }
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
}
