use std::collections::HashMap;

use crate::collision::CollisionManifold;
use crate::components::{RigidContactImpulse, Velocity};
use crate::entity::Entity;
use crate::world::World;

use super::super::math::{finite_transform, finite_velocity};
use super::contact_impulse::{
    apply_contact_impulse_at_point, contact_constraint_tangent, rigid_contact_mass_context,
};
use super::{RigidBodyStepStats, RigidContactConstraint, CONTACT_IMPULSE_EPSILON};

pub(in crate::physics::solver) const CONTACT_CACHE_NORMAL_DOT_MIN: f32 = 0.95;
const CONTACT_CACHE_POINT_MATCH_DISTANCE_SQUARED: f32 = 4.0;

#[derive(Debug, Default)]
pub(in crate::physics::solver) struct RigidContactImpulseCacheIndex {
    entries: Vec<ContactCacheEntry>,
    buckets: HashMap<ContactCachePairKey, ContactCacheBucket>,
}

impl RigidContactImpulseCacheIndex {
    pub(in crate::physics::solver) fn rebuild_from_world(&mut self, world: &World) {
        self.entries.clear();
        self.buckets.clear();

        for impulse in world.rigid_contact_impulses() {
            let key = ContactCachePairKey::new(impulse.entity_a, impulse.entity_b);
            let entry_index = self.entries.len();
            self.entries.push(ContactCacheEntry {
                impulse,
                next_index: None,
            });
            if let Some(bucket) = self.buckets.get_mut(&key) {
                self.entries[bucket.tail_index].next_index = Some(entry_index);
                bucket.tail_index = entry_index;
            } else {
                self.buckets.insert(
                    key,
                    ContactCacheBucket {
                        head_index: entry_index,
                        tail_index: entry_index,
                    },
                );
            }
        }
    }

    fn cached_contact_impulse_for_point(
        &self,
        manifold: CollisionManifold,
        point_x: f32,
        point_y: f32,
    ) -> Option<(f32, f32)> {
        let key = ContactCachePairKey::new(manifold.pair.a, manifold.pair.b);
        let bucket = self.buckets.get(&key)?;
        let mut current_index = Some(bucket.head_index);
        while let Some(index) = current_index {
            let entry = self.entries[index];
            if entry.impulse.normal_x * manifold.normal_x
                + entry.impulse.normal_y * manifold.normal_y
                >= CONTACT_CACHE_NORMAL_DOT_MIN
                && contact_cache_point_matches(entry.impulse, point_x, point_y)
            {
                return Some((
                    entry.impulse.normal_impulse.max(0.0),
                    entry.impulse.tangent_impulse,
                ));
            }
            current_index = entry.next_index;
        }

        None
    }

    #[cfg(test)]
    fn bucket_len(&self, entity_a: Entity, entity_b: Entity) -> usize {
        let key = ContactCachePairKey::new(entity_a, entity_b);
        let Some(bucket) = self.buckets.get(&key) else {
            return 0;
        };
        let mut len = 0;
        let mut current_index = Some(bucket.head_index);
        while let Some(index) = current_index {
            len += 1;
            current_index = self.entries[index].next_index;
        }
        len
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ContactCacheEntry {
    impulse: RigidContactImpulse,
    next_index: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ContactCacheBucket {
    head_index: usize,
    tail_index: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct ContactCachePairKey {
    entity_a_id: u32,
    entity_a_generation: u32,
    entity_b_id: u32,
    entity_b_generation: u32,
}

impl ContactCachePairKey {
    fn new(entity_a: Entity, entity_b: Entity) -> Self {
        Self {
            entity_a_id: entity_a.id,
            entity_a_generation: entity_a.generation,
            entity_b_id: entity_b.id,
            entity_b_generation: entity_b.generation,
        }
    }
}

pub(in crate::physics::solver) fn cached_contact_impulse_for_point(
    cache: &RigidContactImpulseCacheIndex,
    manifold: CollisionManifold,
    point_x: f32,
    point_y: f32,
) -> Option<(f32, f32)> {
    cache.cached_contact_impulse_for_point(manifold, point_x, point_y)
}

pub(in crate::physics) fn warm_start_rigid_contact_constraints(
    world: &mut World,
    constraints: &[RigidContactConstraint],
    stats: &mut RigidBodyStepStats,
) {
    for constraint in constraints {
        if constraint.normal_impulse.abs() <= CONTACT_IMPULSE_EPSILON
            && constraint.tangent_impulse.abs() <= CONTACT_IMPULSE_EPSILON
        {
            continue;
        }

        let a_index = constraint.pair.a.id as usize;
        let b_index = constraint.pair.b.id as usize;
        let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
            continue;
        };

        let normal = finite_velocity(constraint.normal);
        let tangent = contact_constraint_tangent(normal);
        apply_contact_impulse_at_point(
            world,
            context,
            finite_transform(constraint.point),
            Velocity {
                vx: normal.vx * constraint.normal_impulse + tangent.vx * constraint.tangent_impulse,
                vy: normal.vy * constraint.normal_impulse + tangent.vy * constraint.tangent_impulse,
            },
        );
        stats.warm_start_impulses = stats.warm_start_impulses.saturating_add(1);
    }
}

pub(in crate::physics) fn store_rigid_contact_impulses(
    world: &mut World,
    constraints: &[RigidContactConstraint],
) -> u32 {
    world.clear_rigid_contact_impulses();
    let mut stored_impulses = 0_u32;
    for constraint in constraints {
        if constraint.normal_impulse.abs() <= CONTACT_IMPULSE_EPSILON
            && constraint.tangent_impulse.abs() <= CONTACT_IMPULSE_EPSILON
        {
            continue;
        }
        world.record_rigid_contact_impulse(RigidContactImpulse {
            entity_a: constraint.pair.a,
            entity_b: constraint.pair.b,
            point_x: constraint.point.x,
            point_y: constraint.point.y,
            normal_x: constraint.normal.vx,
            normal_y: constraint.normal.vy,
            normal_impulse: constraint.normal_impulse.max(0.0),
            tangent_impulse: constraint.tangent_impulse,
        });
        stored_impulses = stored_impulses.saturating_add(1);
    }
    stored_impulses
}

fn contact_cache_point_matches(entry: RigidContactImpulse, point_x: f32, point_y: f32) -> bool {
    let dx = entry.point_x - point_x;
    let dy = entry.point_y - point_y;
    dx * dx + dy * dy <= CONTACT_CACHE_POINT_MATCH_DISTANCE_SQUARED
}

#[cfg(test)]
mod tests {
    use crate::collision::{CollisionContactPoint, CollisionManifold, CollisionPair};
    use crate::components::RigidContactImpulse;
    use crate::entity::Entity;
    use crate::world::World;

    use super::*;

    #[test]
    fn contact_impulse_cache_index_groups_entries_by_entity_pair() {
        let matching_a = Entity {
            id: 1,
            generation: 0,
        };
        let matching_b = Entity {
            id: 2,
            generation: 0,
        };
        let mut world = World::default();
        for index in 0..64 {
            world.record_rigid_contact_impulse(RigidContactImpulse {
                entity_a: Entity {
                    id: 100 + index,
                    generation: 0,
                },
                entity_b: Entity {
                    id: 200 + index,
                    generation: 0,
                },
                point_x: index as f32,
                point_y: 0.0,
                normal_x: 1.0,
                normal_y: 0.0,
                normal_impulse: 10.0,
                tangent_impulse: 3.0,
            });
        }
        world.record_rigid_contact_impulse(RigidContactImpulse {
            entity_a: matching_a,
            entity_b: matching_b,
            point_x: 12.0,
            point_y: 3.0,
            normal_x: 0.0,
            normal_y: 1.0,
            normal_impulse: 4.0,
            tangent_impulse: -0.5,
        });

        let mut cache = RigidContactImpulseCacheIndex::default();
        cache.rebuild_from_world(&world);

        assert_eq!(cache.bucket_len(matching_a, matching_b), 1);
        let impulse = cached_contact_impulse_for_point(
            &cache,
            contact_cache_test_manifold(matching_a, matching_b, 0.0, 1.0),
            12.5,
            3.0,
        );
        assert_eq!(impulse, Some((4.0, -0.5)));
    }

    #[test]
    fn contact_impulse_cache_index_rejects_generation_mismatch() {
        let old_a = Entity {
            id: 1,
            generation: 0,
        };
        let current_a = Entity {
            id: 1,
            generation: 1,
        };
        let b = Entity {
            id: 2,
            generation: 0,
        };
        let mut world = World::default();
        world.record_rigid_contact_impulse(RigidContactImpulse {
            entity_a: old_a,
            entity_b: b,
            point_x: 0.0,
            point_y: 0.0,
            normal_x: 0.0,
            normal_y: 1.0,
            normal_impulse: 1.0,
            tangent_impulse: 0.0,
        });

        let mut cache = RigidContactImpulseCacheIndex::default();
        cache.rebuild_from_world(&world);

        assert_eq!(cache.bucket_len(current_a, b), 0);
        assert_eq!(
            cached_contact_impulse_for_point(
                &cache,
                contact_cache_test_manifold(current_a, b, 0.0, 1.0),
                0.0,
                0.0,
            ),
            None
        );
    }

    fn contact_cache_test_manifold(
        entity_a: Entity,
        entity_b: Entity,
        normal_x: f32,
        normal_y: f32,
    ) -> CollisionManifold {
        CollisionManifold {
            pair: CollisionPair {
                a: entity_a,
                b: entity_b,
            },
            normal_x,
            normal_y,
            penetration: 0.0,
            point_count: 0,
            points: [CollisionContactPoint {
                point_x: 0.0,
                point_y: 0.0,
                penetration: 0.0,
            }; crate::collision::MAX_COLLISION_MANIFOLD_POINTS],
        }
    }
}
