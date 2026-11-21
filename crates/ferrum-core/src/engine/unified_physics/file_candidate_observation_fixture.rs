//! Test-only mutation of stored caches; never executes a damaged candidate.
use super::*;

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn corrupt_candidate_observation_fixture(&mut self, case: u32) {
        match case {
            0 => self.native_ray_hits[0].normal[0] = f32::NAN,
            1 => {
                let entity = Entity {
                    id: 0,
                    generation: 0,
                };
                self.gameplay_collision_pairs
                    .push(crate::collision::CollisionPair {
                        a: entity,
                        b: entity,
                    });
            }
            _ => unreachable!(),
        }
    }
}
