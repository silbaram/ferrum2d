//! Read-only admission of island membership, locations, and ordered joint edits.
use super::{INVALID_ISLAND, INVALID_LOC, ImpulseJointIslandEvent, JointLinkKey};
use crate::alloc_prelude::*;
use crate::dynamics::{RigidBodyChanges, RigidBodyHandle};
use crate::pipeline::PhysicsWorld;
use core::{fmt, mem};
use parry::utils::VecMap;

#[derive(Copy, Clone, Debug)]
#[doc(hidden)]
pub struct StoredIslandLimits {
    pub max_work: usize,
    pub max_scratch_bytes: usize,
}
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[doc(hidden)]
pub enum StoredIslandError {
    WorkLimit,
    ScratchLimit,
    Allocation,
    FreeList,
    ActiveMapping,
    PersistentMapping,
    ContactLink,
    JointLink,
    Event,
    UnsupportedLink,
}
impl fmt::Display for StoredIslandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid stored island state: {self:?}")
    }
}
impl core::error::Error for StoredIslandError {}
type Result<T> = core::result::Result<T, StoredIslandError>;
struct Budget {
    work: usize,
    scratch: usize,
}
impl Budget {
    fn charge(&mut self, n: usize) -> Result<()> {
        self.work = self
            .work
            .checked_sub(n)
            .ok_or(StoredIslandError::WorkLimit)?;
        Ok(())
    }
    fn vector<T>(&mut self, n: usize) -> Result<Vec<T>> {
        self.charge(n)?;
        self.scratch = self
            .scratch
            .checked_sub(
                n.checked_mul(mem::size_of::<T>())
                    .ok_or(StoredIslandError::ScratchLimit)?,
            )
            .ok_or(StoredIslandError::ScratchLimit)?;
        let mut v = Vec::new();
        v.try_reserve_exact(n)
            .map_err(|_| StoredIslandError::Allocation)?;
        Ok(v)
    }
    fn sort(&mut self, n: usize) -> Result<()> {
        self.charge(
            n.checked_mul((usize::BITS - n.leading_zeros()) as usize + 1)
                .ok_or(StoredIslandError::WorkLimit)?,
        )
    }
}
fn slots<T>(
    map: &VecMap<T>,
    free: impl ExactSizeIterator<Item = usize>,
    budget: &mut Budget,
) -> Result<()> {
    budget.charge(map.capacity())?;
    budget.charge(free.len())?;
    let span = map
        .len()
        .checked_add(free.len())
        .ok_or(StoredIslandError::FreeList)?;
    if span >= u32::MAX as usize || span > map.capacity() {
        return Err(StoredIslandError::FreeList);
    }
    let mut flags = budget.vector::<u8>(span)?;
    flags.resize(span, 0);
    for (key, _) in map.iter() {
        let flag = flags.get_mut(key).ok_or(StoredIslandError::FreeList)?;
        *flag = 1;
    }
    for key in free {
        let flag = flags.get_mut(key).ok_or(StoredIslandError::FreeList)?;
        if *flag != 0 {
            return Err(StoredIslandError::FreeList);
        }
        *flag = 2;
    }
    Ok(())
}
#[derive(Copy, Clone)]
struct Edit {
    key: (u32, u32),
    last: u32,
    unlink: bool,
}
fn edit<'a>(edits: &'a [Edit], key: (u32, u32), budget: &mut Budget) -> Result<Option<&'a Edit>> {
    budget.charge((usize::BITS - edits.len().leading_zeros()) as usize + 1)?;
    Ok(edits
        .binary_search_by_key(&key, |edit| edit.key)
        .ok()
        .map(|i| &edits[i]))
}
fn raw_body(world: &PhysicsWorld, handle: RigidBodyHandle, invalid: bool) -> bool {
    invalid && handle == RigidBodyHandle::invalid()
        || (handle.into_raw_parts().0 as usize) < world.bodies.bodies.capacity()
}

/// Validates stored reference structure without rebuilding or changing history.
///
/// Arena/VecMap and collision/joint graph Deserialize/reference guards are separate
/// prerequisites. Raw slots, scans, scratch initialization and sorting units are
/// prepaid; work units are not a CPU-instruction/RSS bound. Full component/contact
/// eligibility semantics and multibody/soft link contracts remain outside this
/// rigid-body/impulse-joint foundation. Scheduler integers accept their full u32
/// domain: runtime operations saturate dirty counts and reserve clock headroom;
/// this read-only boundary never rebases or canonicalizes saved scheduling history.
#[doc(hidden)]
pub fn validate_stored_islands(world: &PhysicsWorld, limits: StoredIslandLimits) -> Result<usize> {
    use StoredIslandError as E;
    let mut budget = Budget {
        work: limits.max_work,
        scratch: limits.max_scratch_bytes,
    };
    let manager = &world.islands;
    let persistent = &manager.persistent;
    let raw = world.bodies.bodies.capacity();
    budget.charge(raw)?;
    let mut body_flags = budget.vector::<u8>(raw)?;
    body_flags.resize(raw, 0);
    budget.charge(world.bodies.modified_bodies.len())?;
    for &handle in world.bodies.modified_bodies.iter() {
        let flag = body_flags
            .get_mut(handle.into_raw_parts().0 as usize)
            .ok_or(E::ActiveMapping)?;
        if world.bodies.contains(handle) {
            *flag |= 1;
        }
    }
    slots(
        &manager.islands,
        manager.free_islands.iter().copied(),
        &mut budget,
    )?;
    if manager
        .awake_island
        .is_some_and(|id| manager.islands.get(id).is_none())
    {
        return Err(E::ActiveMapping);
    }
    budget.charge(manager.islands.capacity())?;
    for (id, island) in manager.islands.iter() {
        // Simultaneous sleep of several components extracts each into its own
        // chunk and can leave the designated awake container empty. It remains
        // a valid wake/insert target; preserve its identity and free-list order.
        if island.bodies().is_empty() && manager.awake_island != Some(id) {
            return Err(E::ActiveMapping);
        }
        budget.charge(island.bodies().len())?;
        for (index, &handle) in island.bodies().iter().enumerate() {
            let body = world.bodies.get(handle).ok_or(E::ActiveMapping)?;
            let flag = &mut body_flags[handle.into_raw_parts().0 as usize];
            if *flag & 2 != 0
                || body.ids.active_island_id as usize != id
                || body.ids.active_set_id as usize != index
            {
                return Err(E::ActiveMapping);
            }
            if manager.awake_island != Some(id)
                && !body.is_sleeping()
                && !(*flag & 1 != 0
                    && body.changes.intersects(
                        RigidBodyChanges::SLEEP
                            | RigidBodyChanges::TYPE
                            | RigidBodyChanges::ENABLED_OR_DISABLED,
                    ))
            {
                return Err(E::ActiveMapping);
            }
            *flag |= 2;
        }
    }
    budget.charge(raw)?;
    for (handle, body) in world.bodies.iter() {
        let flag = body_flags[handle.into_raw_parts().0 as usize];
        if body.ids.active_island_id == u32::MAX {
            if body.ids.active_set_id != u32::MAX || flag & 2 != 0 {
                return Err(E::ActiveMapping);
            }
        } else if flag & 2 == 0 {
            return Err(E::ActiveMapping);
        }
        if persistent.bootstrapped
            && body.is_enabled()
            && !body.is_fixed()
            && flag & 2 == 0
            && flag & 1 == 0
        {
            return Err(E::ActiveMapping);
        }
    }
    slots(
        &persistent.islands,
        persistent.free_islands.iter().map(|&id| id as usize),
        &mut budget,
    )?;
    budget.charge(persistent.islands.capacity())?;
    let mut joint_count = 0usize;
    for (_, island) in persistent.islands.iter() {
        joint_count = joint_count
            .checked_add(island.joint_links.len())
            .ok_or(E::WorkLimit)?;
    }
    let mut joint_locations = budget.vector::<(u32, u32, u32, u32)>(joint_count)?;
    budget.charge(persistent.islands.capacity())?;
    for (id, island) in persistent.islands.iter() {
        if island.bodies.is_empty() {
            return Err(E::PersistentMapping);
        }
        budget.charge(island.bodies.len())?;
        budget.charge(island.contact_links.len())?;
        budget.charge(island.joint_links.len())?;
        for (index, &handle) in island.bodies.iter().enumerate() {
            let body = world.bodies.get(handle).ok_or(E::PersistentMapping)?;
            let flag = &mut body_flags[handle.into_raw_parts().0 as usize];
            if *flag & 4 != 0
                || body.ids.island_id as usize != id
                || body.ids.island_index as usize != index
            {
                return Err(E::PersistentMapping);
            }
            if body.is_fixed() && !(*flag & 1 != 0 && body.changes.contains(RigidBodyChanges::TYPE))
            {
                return Err(E::PersistentMapping);
            }
            if !body.is_enabled()
                && !(*flag & 1 != 0 && body.changes.contains(RigidBodyChanges::ENABLED_OR_DISABLED))
            {
                return Err(E::PersistentMapping);
            }
            if island.sleeping
                && !body.is_sleeping()
                && !(*flag & 1 != 0
                    && body
                        .changes
                        .intersects(RigidBodyChanges::SLEEP | RigidBodyChanges::TYPE))
            {
                return Err(E::PersistentMapping);
            }
            *flag |= 4;
        }
        for (index, link) in island.contact_links.iter().enumerate() {
            if persistent.contact_link_locs.get(link.edge_id as usize)
                != Some(&(id as u32, index as u32))
            {
                return Err(E::ContactLink);
            }
            let pair = &world
                .narrow_phase
                .contact_graph()
                .graph
                .edges
                .get(link.edge_id as usize)
                .ok_or(E::ContactLink)?
                .weight;
            if !raw_body(world, link.body1, true) || !raw_body(world, link.body2, true) {
                return Err(E::ContactLink);
            }
            eligibility::owner(
                world,
                &body_flags,
                [link.body1, link.body2],
                id as u32,
                E::ContactLink,
                &mut budget,
            )?;
            if pair.solver_manifolds().first().is_some_and(|m| {
                m.data.rigid_body1.unwrap_or(RigidBodyHandle::invalid()) != link.body1
                    || m.data.rigid_body2.unwrap_or(RigidBodyHandle::invalid()) != link.body2
            }) {
                return Err(E::ContactLink);
            }
        }
        for (index, link) in island.joint_links.iter().enumerate() {
            if !raw_body(world, link.body1, false) || !raw_body(world, link.body2, false) {
                return Err(E::JointLink);
            }
            eligibility::owner(
                world,
                &body_flags,
                [link.body1, link.body2],
                id as u32,
                E::JointLink,
                &mut budget,
            )?;
            let JointLinkKey::Impulse(handle) = link.key else {
                return Err(E::UnsupportedLink);
            };
            let (slot, generation) = handle.into_raw_parts();
            joint_locations.push((slot, generation, id as u32, index as u32));
        }
    }
    budget.charge(raw)?;
    for (handle, body) in world.bodies.iter() {
        let flag = body_flags[handle.into_raw_parts().0 as usize];
        if body.ids.island_id == INVALID_ISLAND {
            if body.ids.island_index != u32::MAX || flag & 4 != 0 {
                return Err(E::PersistentMapping);
            }
        } else if flag & 4 == 0 {
            return Err(E::PersistentMapping);
        }
        if persistent.bootstrapped
            && body.is_enabled()
            && !body.is_fixed()
            && flag & 4 == 0
            && flag & 1 == 0
        {
            return Err(E::PersistentMapping);
        }
    }
    budget.charge(persistent.contact_link_locs.len())?;
    for (edge, &loc) in persistent.contact_link_locs.iter().enumerate() {
        if loc != INVALID_LOC
            && persistent
                .islands
                .get(loc.0 as usize)
                .and_then(|island| island.contact_links.get(loc.1 as usize))
                .is_none_or(|link| link.edge_id as usize != edge)
        {
            return Err(E::ContactLink);
        }
    }
    budget.sort(joint_locations.len())?;
    joint_locations.sort_unstable();
    budget.charge(joint_locations.len())?;
    if joint_locations
        .windows(2)
        .any(|pair| (pair[0].0, pair[0].1) == (pair[1].0, pair[1].1))
        || joint_locations.len() != persistent.joint_link_locs.len()
    {
        return Err(E::JointLink);
    }
    budget.charge(
        persistent
            .joint_link_locs
            .capacity()
            .checked_mul(2)
            .and_then(|n| n.checked_add(1))
            .ok_or(E::WorkLimit)?,
    )?;
    for (key, &loc) in persistent.joint_link_locs.iter() {
        let JointLinkKey::Impulse(handle) = key else {
            return Err(E::UnsupportedLink);
        };
        let (slot, generation) = handle.into_raw_parts();
        budget.charge((usize::BITS - joint_locations.len().leading_zeros()) as usize + 1)?;
        if joint_locations
            .binary_search(&(slot, generation, loc.0, loc.1))
            .is_err()
        {
            return Err(E::JointLink);
        }
    }

    budget.charge(persistent.removal_journal.len())?;
    for removal in &persistent.removal_journal {
        if !raw_body(world, removal.body1, true) || !raw_body(world, removal.body2, true) {
            return Err(E::PersistentMapping);
        }
    }
    // split_island is a scheduling hint: run_pending_split safely ignores absent
    // ids. Preserve even stale history instead of rewriting it to today's map.
    let (modified, all_modified, joint_slots) = world.impulse_joints.stored_island_edits();
    budget.charge(modified.len())?;
    let mut dirty = budget.vector::<(u32, u32)>(modified.len())?;
    for &handle in modified {
        if handle.into_raw_parts().0 as usize >= joint_slots {
            return Err(E::Event);
        }
        dirty.push(handle.into_raw_parts());
    }
    budget.sort(dirty.len())?;
    dirty.sort_unstable();
    let events = &world.impulse_joints.island_events;
    budget.charge(events.len())?;
    let mut edits = budget.vector::<Edit>(events.len())?;
    for (ordinal, &event) in events.iter().enumerate() {
        let (handle, unlink) = match event {
            ImpulseJointIslandEvent::Link {
                handle,
                body1,
                body2,
            } => {
                if !raw_body(world, body1, false) || !raw_body(world, body2, false) {
                    return Err(E::Event);
                }
                (handle, false)
            }
            ImpulseJointIslandEvent::Unlink { handle } => (handle, true),
        };
        if handle.into_raw_parts().0 as usize >= joint_slots {
            return Err(E::Event);
        }
        edits.push(Edit {
            key: handle.into_raw_parts(),
            last: u32::try_from(ordinal).map_err(|_| E::Event)?,
            unlink,
        });
    }
    budget.sort(edits.len())?;
    edits.sort_unstable_by_key(|e| (e.key, e.last));
    budget.charge(edits.len())?;
    let mut count = 0;
    for i in 0..edits.len() {
        let e = edits[i];
        if count > 0 && edits[count - 1].key == e.key {
            edits[count - 1].last = e.last;
            edits[count - 1].unlink |= e.unlink;
        } else {
            edits[count] = e;
            count += 1;
        }
    }
    edits.truncate(count);
    let is_dirty = |key: (u32, u32), budget: &mut Budget| -> Result<bool> {
        budget.charge((usize::BITS - dirty.len().leading_zeros()) as usize + 1)?;
        Ok(all_modified || dirty.binary_search(&key).is_ok())
    };
    budget.charge(edits.len())?;
    for e in &edits {
        match events[e.last as usize] {
            ImpulseJointIslandEvent::Link {
                handle,
                body1,
                body2,
            } => {
                let joint = world.impulse_joints.get(handle).ok_or(E::Event)?;
                if !is_dirty(e.key, &mut budget)?
                    && (!joint.data.is_enabled() || joint.body1 != body1 || joint.body2 != body2)
                {
                    return Err(E::Event);
                }
            }
            ImpulseJointIslandEvent::Unlink { handle } => {
                if world
                    .impulse_joints
                    .get(handle)
                    .is_some_and(|joint| joint.data.is_enabled())
                    && !is_dirty(e.key, &mut budget)?
                {
                    return Err(E::Event);
                }
            }
        }
    }
    budget.charge(persistent.islands.capacity())?;
    for (_, island) in persistent.islands.iter() {
        budget.charge(island.joint_links.len())?;
        for link in &island.joint_links {
            let JointLinkKey::Impulse(handle) = link.key else {
                return Err(E::UnsupportedLink);
            };
            let pending_unlink =
                edit(&edits, handle.into_raw_parts(), &mut budget)?.is_some_and(|e| e.unlink);
            let changed = is_dirty(handle.into_raw_parts(), &mut budget)?;
            match world.impulse_joints.get(handle) {
                Some(_) if pending_unlink || changed => {}
                Some(joint)
                    if joint.body1 == link.body1
                        && joint.body2 == link.body2
                        && joint.data.is_enabled() => {}
                _ if pending_unlink => {}
                _ => return Err(E::JointLink),
            }
        }
    }
    eligibility::validate(
        world,
        &body_flags,
        &joint_locations,
        &edits,
        &dirty,
        all_modified,
        &mut budget,
    )?;
    Ok(limits.max_work - budget.work)
}

#[cfg(all(test, feature = "dim3", feature = "f32"))]
mod tests;

#[cfg(all(test, feature = "dim3", feature = "f32"))]
mod eligibility_tests;

mod eligibility;
