use super::BroadPhaseBvh;
use crate::data::Index;
use crate::geometry::ColliderHandle;
use crate::geometry::stored_references::{ReferenceBudget, ReferenceContext, StoredReferenceError};

type DirectedPair = (u32, u32, u32, u32);

fn directed(a: ColliderHandle, b: ColliderHandle) -> DirectedPair {
    let (ai, ag) = a.into_raw_parts();
    let (bi, bg) = b.into_raw_parts();
    (ai, ag, bi, bg)
}

impl BroadPhaseBvh {
    pub(crate) fn has_stored_pair(&self, a: ColliderHandle, b: ColliderHandle) -> bool {
        let pair = if a.into_raw_parts().0 < b.into_raw_parts().0 {
            (a, b)
        } else {
            (b, a)
        };
        self.pairs.contains_key(&pair)
    }

    pub(crate) fn validate_references(
        &self,
        context: &ReferenceContext<'_>,
        budget: &mut ReferenceBudget,
    ) -> Result<(), StoredReferenceError> {
        let invalid = StoredReferenceError::BroadPhase;
        // Hash-table iteration also scans vacant buckets. Charge a conservative
        // bucket bound, independently of live pair count.
        budget.charge(
            self.pairs
                .capacity()
                .checked_mul(2)
                .and_then(|n| n.checked_add(1))
                .ok_or(StoredReferenceError::WorkLimit)?,
        )?;
        let entries = self.pair_adjacency.stored_entries();
        budget.charge(entries.len())?;
        let mut adjacency_count = 0usize;
        for (_, others) in entries {
            budget.charge(others.len())?;
            adjacency_count = adjacency_count
                .checked_add(others.len())
                .ok_or(StoredReferenceError::WorkLimit)?;
        }
        if adjacency_count != self.pairs.len().checked_mul(2).ok_or(invalid)? {
            return Err(invalid);
        }
        let mut adjacency = budget.vector::<DirectedPair>(adjacency_count)?;
        budget.charge(entries.len())?;
        for (slot, (generation, others)) in entries.iter().enumerate() {
            let handle = ColliderHandle(Index::from_raw_parts(
                u32::try_from(slot).map_err(|_| invalid)?,
                *generation,
            ));
            if *generation == u32::MAX && !context.known(handle) {
                if !others.is_empty() {
                    return Err(invalid);
                }
                continue;
            }
            if !context.known(handle) {
                return Err(invalid);
            }
            for &other in others {
                if !context.known(other) || handle.into_raw_parts().0 == other.into_raw_parts().0 {
                    return Err(invalid);
                }
                let pair = if handle.into_raw_parts().0 < other.into_raw_parts().0 {
                    (handle, other)
                } else {
                    (other, handle)
                };
                if !self.pairs.contains_key(&pair) {
                    return Err(invalid);
                }
                adjacency.push(directed(handle, other));
            }
        }
        adjacency.sort_unstable();
        if adjacency.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(invalid);
        }
        for &(a, b) in self.pairs.keys() {
            if a.into_raw_parts().0 >= b.into_raw_parts().0
                || !context.known(a)
                || !context.known(b)
                || self.tree.leaf_node(a.into_raw_parts().0).is_none()
                || self.tree.leaf_node(b.into_raw_parts().0).is_none()
                || adjacency.binary_search(&directed(a, b)).is_err()
                || adjacency.binary_search(&directed(b, a)).is_err()
            {
                return Err(invalid);
            }
        }
        // The BVH's own Deserialize guard checks its rooted graph and lookup
        // reciprocity. Scanning the collider arena avoids a depth-sized BVH
        // traversal stack or any uncharged traversal workspace here.
        let slots = context.colliders.colliders.capacity();
        budget.charge(slots)?;
        let mut present = 0u32;
        for slot in 0..slots {
            let slot = u32::try_from(slot).map_err(|_| invalid)?;
            if let Some(node) = self.tree.leaf_node(slot) {
                if node.leaf_data() != Some(slot) || !context.known_slot(slot) {
                    return Err(invalid);
                }
                present = present.checked_add(1).ok_or(invalid)?;
            }
        }
        if present != self.tree.leaf_count() {
            return Err(invalid);
        }
        budget.charge(self.pending_set_aabb.len())?;
        for &handle in &self.pending_set_aabb {
            if !context.known(handle) {
                return Err(invalid);
            }
        }
        // Removed leaves can remain in this history until a later partial
        // refit. The refitter checks presence: do not rewrite or require them
        // to be live references to today's colliders.
        budget.charge(self.prev_updated_leaves.len())?;
        Ok(())
    }
}

#[cfg(all(test, feature = "dim3", feature = "f32"))]
mod tests {
    use super::*;
    use crate::geometry::stored_references::tests::{limits, scene, validate};

    #[test]
    fn stored_references_broadphase_rejects_pair_generation_and_adjacency_corruption() {
        let world = scene();
        let (&(a, b), &stamp) = world.broad_phase.pairs.iter().next().unwrap();
        let mut bad = world.broad_phase.clone();
        bad.pairs.retain(|&pair, _| pair != (a, b));
        bad.pairs.insert(
            (
                ColliderHandle::from_raw_parts(
                    a.into_raw_parts().0,
                    a.into_raw_parts().1.wrapping_add(1),
                ),
                b,
            ),
            stamp,
        );
        assert!(validate(&world, &bad, &world.narrow_phase, limits()).is_err());
        let mut bad = world.broad_phase.clone();
        bad.pair_adjacency.get_mut(a.0).unwrap().push(b);
        assert_eq!(
            validate(&world, &bad, &world.narrow_phase, limits()),
            Err(StoredReferenceError::BroadPhase)
        );
        let mut bad = world.broad_phase.clone();
        bad.pair_adjacency.get_mut(a.0).unwrap().clear();
        assert_eq!(
            validate(&world, &bad, &world.narrow_phase, limits()),
            Err(StoredReferenceError::BroadPhase)
        );
    }

    #[test]
    fn stored_references_broadphase_leaf_and_narrowphase_membership_are_cross_checked() {
        let world = scene();
        let mut bad = world.broad_phase.clone();
        let aabb = bad.tree.leaf_node(0).unwrap().aabb();
        bad.tree
            .insert(aabb, world.colliders.colliders.capacity() as u32 + 1);
        assert_eq!(
            validate(&world, &bad, &world.narrow_phase, limits()),
            Err(StoredReferenceError::BroadPhase)
        );
        let pair = world.narrow_phase.contact_pairs().next().unwrap();
        let (a, b) = (pair.collider1, pair.collider2);
        let mut bad = world.broad_phase.clone();
        bad.pairs
            .retain(|&(x, y), _| !((x == a && y == b) || (x == b && y == a)));
        bad.pair_adjacency
            .get_mut(a.0)
            .unwrap()
            .retain(|&other| other != b);
        bad.pair_adjacency
            .get_mut(b.0)
            .unwrap()
            .retain(|&other| other != a);
        // Each broadphase container remains internally reciprocal. Only the
        // narrowphase-to-broadphase ownership check exposes this missing pair.
        assert_eq!(
            validate(&world, &bad, &world.narrow_phase, limits()),
            Err(StoredReferenceError::NarrowPhase)
        );
    }

    #[test]
    fn stored_references_broadphase_checks_pending_handles_but_preserves_removed_leaf_history() {
        let world = scene();
        let mut bad = world.broad_phase.clone();
        bad.pending_set_aabb
            .push(ColliderHandle::from_raw_parts(999_999, 0));
        assert_eq!(
            validate(&world, &bad, &world.narrow_phase, limits()),
            Err(StoredReferenceError::BroadPhase)
        );
        let mut historical = world.broad_phase.clone();
        historical.prev_updated_leaves.push(u32::MAX);
        validate(&world, &historical, &world.narrow_phase, limits()).unwrap();
    }
}
