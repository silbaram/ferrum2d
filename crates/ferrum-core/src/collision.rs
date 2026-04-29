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
