//! Ferrum cold supported contact workspace admission. Call after reference and
//! shape/BVH structural admission. This pass neither updates nor repairs history.
use crate::alloc_prelude::*;
use crate::geometry::{ColliderChanges, PairContacts};
use crate::pipeline::PhysicsWorld;
use parry::query::{
    StoredWorkspaceError, StoredWorkspaceLimits, StoredWorkspaceUsage,
    validate_stored_contact_manifolds_without_workspace, validate_stored_contact_workspace,
};

#[doc(hidden)]
pub fn validate_stored_contact_workspaces(
    world: &PhysicsWorld,
    limits: StoredWorkspaceLimits,
) -> Result<StoredWorkspaceUsage, StoredWorkspaceError> {
    let narrow = &world.narrow_phase;
    let mut work = limits
        .max_work
        .checked_sub(narrow.contact_graph.graph.edges.len())
        .ok_or(StoredWorkspaceError::WorkLimit)?;
    let mut scratch = limits.max_scratch_bytes;
    // A removed collider remains in the contact graph until the next pipeline
    // pass. Reference admission has checked this queue; keep exact generations
    // here too, including old handles whose arena slot has already been reused.
    // Charge the queue scan and scratch initialization before any allocation.
    let removed_count = world.colliders.removed_colliders.len();
    // Logical comparison levels, not std sort comparisons or CPU instructions.
    let sort_levels = (usize::BITS - removed_count.saturating_sub(1).leading_zeros()) as usize;
    let lookup_levels = (usize::BITS - removed_count.leading_zeros()) as usize;
    work = work
        .checked_sub(
            removed_count
                .checked_mul(2 + sort_levels)
                .ok_or(StoredWorkspaceError::WorkLimit)?,
        )
        .ok_or(StoredWorkspaceError::WorkLimit)?;
    scratch = scratch
        .checked_sub(
            removed_count
                .checked_mul(size_of::<crate::geometry::ColliderHandle>())
                .ok_or(StoredWorkspaceError::ScratchLimit)?,
        )
        .ok_or(StoredWorkspaceError::ScratchLimit)?;
    let mut removed = Vec::new();
    removed
        .try_reserve_exact(removed_count)
        .map_err(|_| StoredWorkspaceError::Allocation)?;
    for &handle in &world.colliders.removed_colliders {
        if handle.into_raw_parts().0 as usize >= world.colliders.colliders.capacity()
            || world.colliders.contains(handle)
        {
            return Err(StoredWorkspaceError::Context);
        }
        removed.push(handle);
    }
    removed.sort_unstable_by_key(|handle| handle.into_raw_parts());
    for edge in &narrow.contact_graph.graph.edges {
        let PairContacts::Rigid(pair) = &edge.weight.contacts else {
            return Err(StoredWorkspaceError::Unsupported);
        };
        let a = world.colliders.get(edge.weight.collider1);
        let b = world.colliders.get(edge.weight.collider2);
        for (handle, collider) in [(edge.weight.collider1, a), (edge.weight.collider2, b)] {
            if collider.is_none() {
                // Charge the bounded logical binary-search levels before lookup.
                work = work
                    .checked_sub(lookup_levels)
                    .ok_or(StoredWorkspaceError::WorkLimit)?;
                if removed
                    .binary_search_by_key(&handle.into_raw_parts(), |handle| {
                        handle.into_raw_parts()
                    })
                    .is_err()
                {
                    return Err(StoredWorkspaceError::Context);
                }
            }
        }
        // Pending removal has no current geometry to compare. Just like a
        // pending SHAPE change, validate all internal cache correspondence with
        // context None; never skip the cached data or borrow a reused slot's shape.
        let context = a.zip(b).and_then(|(a, b)| {
            let pending = a.changes.contains(ColliderChanges::SHAPE)
                || b.changes.contains(ColliderChanges::SHAPE);
            (!pending).then_some((&*a.shape, &*b.shape))
        });
        let remaining = StoredWorkspaceLimits {
            max_work: work,
            max_scratch_bytes: scratch,
        };
        let used = if let Some(workspace) = &pair.workspace {
            validate_stored_contact_workspace(workspace, &pair.manifolds, context, remaining)?
        } else {
            validate_stored_contact_manifolds_without_workspace(
                &pair.manifolds,
                context,
                remaining,
            )?
        };
        work = work
            .checked_sub(used.work)
            .ok_or(StoredWorkspaceError::WorkLimit)?;
        scratch = scratch
            .checked_sub(used.scratch_bytes)
            .ok_or(StoredWorkspaceError::ScratchLimit)?;
    }
    Ok(StoredWorkspaceUsage {
        work: limits.max_work - work,
        scratch_bytes: limits.max_scratch_bytes - scratch,
    })
}

#[cfg(test)]
mod tests;
