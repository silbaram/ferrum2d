//! Ferrum's cold, read-only cross-container reference checks.
//!
//! This is not a general untrusted-file decoder or a numerical/allocator proof.
//! Arena free lists and Parry BVH/shape storage must already have passed their
//! own Deserialize guards. These checks neither rebuild nor canonicalize state.
use super::{BroadPhaseBvh, ColliderHandle, ColliderSet, NarrowPhase};
use crate::alloc_prelude::*;
use crate::data::graph::StoredGraphError;
use crate::dynamics::{RigidBodyHandle, RigidBodySet};
use crate::pipeline::PhysicsWorld;
use core::{fmt, mem};

/// Limits for the cold stored-reference validation used by Ferrum.
#[doc(hidden)]
#[derive(Copy, Clone, Debug)]
pub struct StoredReferenceLimits {
    /// Stored slots/references and initialized scratch elements visited.
    pub max_work: usize,
    /// Cumulative requested scratch bytes; vectors use fallible exact reserve.
    pub max_scratch_bytes: usize,
}

/// A rejected stored-reference structure; no persistent state has been changed.
#[doc(hidden)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StoredReferenceError {
    WorkLimit,
    ScratchLimit,
    Allocation,
    BodyCollider,
    BroadPhase,
    GraphLinks,
    NarrowPhase,
    SolverGraph,
    JointGraph,
}

impl core::error::Error for StoredReferenceError {}

impl fmt::Display for StoredReferenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid stored reference state: {self:?}")
    }
}

pub(crate) struct ReferenceBudget {
    pub(crate) remaining: usize,
    scratch: usize,
}

impl ReferenceBudget {
    pub(crate) fn charge(&mut self, amount: usize) -> Result<(), StoredReferenceError> {
        self.remaining = self
            .remaining
            .checked_sub(amount)
            .ok_or(StoredReferenceError::WorkLimit)?;
        Ok(())
    }

    pub(crate) fn vector<T>(&mut self, count: usize) -> Result<Vec<T>, StoredReferenceError> {
        // Charge initialization work before reserving or scanning an input length.
        self.charge(count)?;
        let bytes = count
            .checked_mul(mem::size_of::<T>())
            .ok_or(StoredReferenceError::ScratchLimit)?;
        self.scratch = self
            .scratch
            .checked_sub(bytes)
            .ok_or(StoredReferenceError::ScratchLimit)?;
        let mut result = Vec::new();
        result
            .try_reserve_exact(count)
            .map_err(|_| StoredReferenceError::Allocation)?;
        Ok(result)
    }

    pub(crate) fn graph<N, E>(
        &mut self,
        graph: &crate::data::graph::Graph<N, E>,
    ) -> Result<(), StoredReferenceError> {
        graph
            .validate_stored_links(&mut self.remaining)
            .map_err(|error| match error {
                StoredGraphError::WorkLimit => StoredReferenceError::WorkLimit,
                StoredGraphError::InvalidLinks => StoredReferenceError::GraphLinks,
            })
    }
}

pub(crate) struct ReferenceContext<'a> {
    pub(crate) world: &'a PhysicsWorld,
    pub(crate) colliders: &'a ColliderSet,
    pub(crate) bodies: &'a RigidBodySet,
    removed: Vec<ColliderHandle>,
}

impl<'a> ReferenceContext<'a> {
    fn new(
        world: &'a PhysicsWorld,
        budget: &mut ReferenceBudget,
    ) -> Result<Self, StoredReferenceError> {
        let (colliders, bodies) = (&world.colliders, &world.bodies);
        // Arena iterators scan vacancies too. Account for all raw slots first.
        budget.charge(colliders.colliders.capacity())?;
        budget.charge(bodies.bodies.capacity())?;
        budget.charge(colliders.removed_colliders.len())?;
        let mut removed = budget.vector(colliders.removed_colliders.len())?;
        for &handle in &colliders.removed_colliders {
            if handle.into_raw_parts().0 as usize >= colliders.colliders.capacity()
                || colliders.contains(handle)
            {
                return Err(StoredReferenceError::BodyCollider);
            }
            removed.push(handle);
        }
        removed.sort_unstable_by_key(|handle| handle.into_raw_parts());
        let result = Self {
            world,
            colliders,
            bodies,
            removed,
        };
        if let Some(index) = world.islands.awake_island {
            let island = world
                .islands
                .islands
                .get(index)
                .ok_or(StoredReferenceError::SolverGraph)?;
            budget.charge(island.bodies().len())?;
            for (ordinal, &handle) in island.bodies().iter().enumerate() {
                let body = bodies
                    .get(handle)
                    .ok_or(StoredReferenceError::SolverGraph)?;
                if body.ids.active_island_id as usize != index
                    || body.ids.active_set_id as usize != ordinal
                {
                    return Err(StoredReferenceError::SolverGraph);
                }
            }
        }
        Ok(result)
    }

    pub(crate) fn known(&self, handle: ColliderHandle) -> bool {
        self.colliders.contains(handle)
            || self
                .removed
                .binary_search_by_key(&handle.into_raw_parts(), |handle| handle.into_raw_parts())
                .is_ok()
    }

    pub(crate) fn known_slot(&self, slot: u32) -> bool {
        self.colliders.get_unknown_gen(slot).is_some()
            || self
                .removed
                .binary_search_by_key(&slot, |handle| handle.into_raw_parts().0)
                .is_ok()
    }

    pub(crate) fn pending_parent(&self, handle: ColliderHandle) -> bool {
        self.colliders.get(handle).is_none_or(|collider| {
            collider.changes.intersects(
                super::ColliderChanges::PARENT | super::ColliderChanges::PARENT_EFFECTIVE_DOMINANCE,
            )
        })
    }

    pub(crate) fn pending_color(&self, handle: ColliderHandle) -> bool {
        self.pending_parent(handle)
            || self
                .colliders
                .get(handle)
                .and_then(|collider| collider.parent())
                .and_then(|parent| self.bodies.get(parent))
                .is_some_and(|body| {
                    body.changes
                        .contains(crate::dynamics::RigidBodyChanges::TYPE)
                })
    }

    pub(crate) fn active_body(&self, id: u32) -> Option<RigidBodyHandle> {
        self.world
            .islands
            .awake_island
            .and_then(|index| self.world.islands.islands.get(index))
            .and_then(|island| island.bodies().get(id as usize))
            .copied()
    }

    fn body_collider_links(
        &self,
        budget: &mut ReferenceBudget,
    ) -> Result<(), StoredReferenceError> {
        budget.charge(self.colliders.modified_colliders.len())?;
        budget.charge(self.bodies.modified_bodies.len())?;
        for handle in self.colliders.modified_colliders.iter() {
            if handle.into_raw_parts().0 as usize >= self.colliders.colliders.capacity() {
                return Err(StoredReferenceError::BodyCollider);
            }
        }
        for handle in self.bodies.modified_bodies.iter() {
            if handle.into_raw_parts().0 as usize >= self.bodies.bodies.capacity() {
                return Err(StoredReferenceError::BodyCollider);
            }
        }
        for (handle, body) in self.bodies.iter() {
            budget.charge(body.colliders.0.len())?;
            for &collider in &body.colliders.0 {
                if self
                    .colliders
                    .get(collider)
                    .is_none_or(|collider| collider.parent() != Some(handle))
                {
                    return Err(StoredReferenceError::BodyCollider);
                }
            }
        }
        for (handle, collider) in self.colliders.iter() {
            if let Some(parent) = collider.parent() {
                let body = self
                    .bodies
                    .get(parent)
                    .ok_or(StoredReferenceError::BodyCollider)?;
                budget.charge(body.colliders.0.len())?;
                let occurrences = body
                    .colliders
                    .0
                    .iter()
                    .filter(|&&attached| attached == handle)
                    .count();
                if occurrences != 1 {
                    return Err(StoredReferenceError::BodyCollider);
                }
            }
        }
        Ok(())
    }
}

/// Checks stored collision and impulse-joint reference structures without repair.
///
/// The visit budget covers raw arena/Coarena/graph slots, stored references, and
/// scratch initialization. Comparison sorting is bounded by the admitted scratch
/// length; this is not a bound on CPU instructions, decoded heap, or process RSS.
/// This does not validate numerical payloads, complete persistent islands,
/// multibody/soft-body topology, decoder allocations, or a public file envelope.
/// Exact pending collider removals and explicitly invalidated solver workspaces
/// retain their original lazy history. No check runs in the simulation hot path.
#[doc(hidden)]
pub fn validate_stored_references(
    world: &PhysicsWorld,
    limits: StoredReferenceLimits,
) -> Result<usize, StoredReferenceError> {
    validate_parts(world, &world.broad_phase, &world.narrow_phase, limits)
}

pub(crate) fn validate_parts(
    world: &PhysicsWorld,
    broad_phase: &BroadPhaseBvh,
    narrow_phase: &NarrowPhase,
    limits: StoredReferenceLimits,
) -> Result<usize, StoredReferenceError> {
    let mut budget = ReferenceBudget {
        remaining: limits.max_work,
        scratch: limits.max_scratch_bytes,
    };
    let context = ReferenceContext::new(world, &mut budget)?;
    context.body_collider_links(&mut budget)?;
    broad_phase.validate_references(&context, &mut budget)?;
    narrow_phase.validate_references(&context, broad_phase, &mut budget)?;
    world
        .impulse_joints
        .validate_references(&world.bodies, &mut budget)?;
    Ok(limits.max_work - budget.remaining)
}

#[cfg(all(test, feature = "dim3", feature = "f32"))]
pub(crate) mod tests;
