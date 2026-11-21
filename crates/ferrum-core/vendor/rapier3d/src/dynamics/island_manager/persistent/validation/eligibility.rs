//! Settled eligible links and stable endpoint/owner correspondence, without component rebuilds.
use super::{Budget, Edit, Result, StoredIslandError as E, edit};
use crate::dynamics::{RigidBodyChanges, RigidBodyHandle};
use crate::geometry::{ColliderChanges, ColliderHandle};
use crate::pipeline::PhysicsWorld;

fn stable_island(
    world: &PhysicsWorld,
    body_flags: &[u8],
    handle: RigidBodyHandle,
) -> Result<Option<u32>> {
    let Some(body) = world.bodies.get(handle) else {
        // A removed generation can still be an endpoint of a pending cached link.
        return Ok(None);
    };
    let flag = body_flags
        .get(handle.into_raw_parts().0 as usize)
        .ok_or(E::PersistentMapping)?;
    if flag & 1 != 0
        && body
            .changes
            .intersects(RigidBodyChanges::TYPE | RigidBodyChanges::ENABLED_OR_DISABLED)
    {
        return Ok(None);
    }
    Ok((body.is_enabled() && !body.is_fixed()).then_some(body.ids.island_id))
}

pub(super) fn owner(
    world: &PhysicsWorld,
    body_flags: &[u8],
    endpoints: [RigidBodyHandle; 2],
    island: u32,
    error: E,
    budget: &mut Budget,
) -> Result<()> {
    budget.charge(endpoints.len())?;
    for handle in endpoints {
        if stable_island(world, body_flags, handle)?.is_some_and(|id| id != island) {
            return Err(error);
        }
    }
    Ok(())
}

struct Side {
    island: Option<u32>,
    parent: Option<RigidBodyHandle>,
    current: bool,
}
fn side(
    world: &PhysicsWorld,
    body_flags: &[u8],
    pending: &[(u32, u32)],
    handle: ColliderHandle,
    budget: &mut Budget,
) -> Result<Side> {
    budget.charge(1)?;
    let Some(collider) = world.colliders.get(handle) else {
        // Exact pending removed-collider references are checked by the reference guard first.
        return Ok(Side {
            island: None,
            parent: None,
            current: false,
        });
    };
    let parent = collider.parent.map(|parent| parent.handle);
    budget.charge((usize::BITS - pending.len().leading_zeros()) as usize + 1)?;
    if pending.binary_search(&handle.into_raw_parts()).is_ok() {
        return Ok(Side {
            island: None,
            parent,
            current: false,
        });
    }
    budget.charge(1)?;
    let island = match parent {
        Some(handle) => stable_island(world, body_flags, handle)?,
        None => None,
    };
    Ok(Side {
        island,
        parent,
        current: true,
    })
}

pub(super) fn validate(
    world: &PhysicsWorld,
    body_flags: &[u8],
    joint_locations: &[(u32, u32, u32, u32)],
    edits: &[Edit],
    dirty: &[(u32, u32)],
    all_modified: bool,
    budget: &mut Budget,
) -> Result<()> {
    if !world.islands.persistent.bootstrapped {
        return Ok(());
    }
    let persistent = &world.islands.persistent;
    // ImpulseJointSet::len is exactly the dense joint-graph edge count, not body/arena count.
    budget.charge(world.impulse_joints.len())?;
    for (handle, joint) in world.impulse_joints.iter() {
        if !joint.data.is_enabled() || all_modified {
            continue;
        }
        let key = handle.into_raw_parts();
        budget.charge((usize::BITS - dirty.len().leading_zeros()) as usize + 1)?;
        if dirty.binary_search(&key).is_ok() || edit(edits, key, budget)?.is_some() {
            continue;
        }
        budget.charge(2)?;
        let members = [
            stable_island(world, body_flags, joint.body1)?,
            stable_island(world, body_flags, joint.body2)?,
        ];
        if members.iter().all(Option::is_none) {
            continue;
        }
        budget.charge((usize::BITS - joint_locations.len().leading_zeros()) as usize + 1)?;
        let index = joint_locations
            .binary_search_by_key(&key, |location| (location.0, location.1))
            .map_err(|_| E::JointLink)?;
        let owner = joint_locations[index].2;
        if members.into_iter().flatten().any(|member| member != owner) {
            return Err(E::JointLink);
        }
    }

    let pairs = &world.narrow_phase.contact_graph().graph.edges;
    budget.charge(pairs.len())?;
    if pairs.is_empty() {
        return Ok(());
    }
    let modified = &world.colliders.modified_colliders;
    budget.charge(modified.len())?;
    let mut pending = budget.vector::<(u32, u32)>(modified.len())?;
    for &handle in modified.iter() {
        if world.colliders.get(handle).is_some_and(|collider| {
            collider.changes.intersects(
                ColliderChanges::PARENT
                    | ColliderChanges::PARENT_EFFECTIVE_DOMINANCE
                    | ColliderChanges::TYPE
                    | ColliderChanges::ENABLED_OR_DISABLED,
            )
        }) {
            pending.push(handle.into_raw_parts());
        }
    }
    budget.sort(pending.len())?;
    pending.sort_unstable();
    for (edge, pair) in pairs.iter().enumerate() {
        let pair = &pair.weight;
        let Some(rigid) = pair.rigid() else { continue };
        budget.charge(rigid.solver_manifolds().len())?;
        if !rigid.has_any_active_contact() {
            continue;
        }
        let a = side(world, body_flags, &pending, pair.collider1, budget)?;
        let b = side(world, body_flags, &pending, pair.collider2, budget)?;
        if a.island.is_none() && b.island.is_none() {
            continue;
        }
        budget.charge(1)?;
        let &(owner, index) = persistent
            .contact_link_locs
            .get(edge)
            .ok_or(E::ContactLink)?;
        let link = persistent
            .islands
            .get(owner as usize)
            .and_then(|island| island.contact_links.get(index as usize))
            .filter(|link| link.edge_id as usize == edge)
            .ok_or(E::ContactLink)?;
        if [a.island, b.island]
            .into_iter()
            .flatten()
            .any(|id| id != owner)
            || a.current && link.body1 != a.parent.unwrap_or(RigidBodyHandle::invalid())
            || b.current && link.body2 != b.parent.unwrap_or(RigidBodyHandle::invalid())
        {
            return Err(E::ContactLink);
        }
    }
    Ok(())
}
