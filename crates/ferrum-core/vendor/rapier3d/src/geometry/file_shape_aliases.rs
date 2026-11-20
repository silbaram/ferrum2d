// Ferrum2D file-only cold extension; see FERRUM-PATCHES.md.
//! Cold, transactional identity-only restoration of stored collider geometry.
//! Every root is enumerated, every requested group is validated before mutation,
//! and only equal-value Arc backing is rebound. Never calls a shape setter,
//! mutation-tracked ColliderSet accessor, BVH builder, query or pipeline step.

use super::{ColliderHandle, ColliderSet, SharedShape};
use crate::parry::shape::file_aliases::{self as shapes, Budget, EquivalentShape, Kind};
use alloc::{sync::Arc, vec::Vec};
use core::fmt;

pub use shapes::Usage;

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
    pub max_roots: usize,
    pub max_compare_bytes: usize,
}

impl Limits {
    fn budget(self) -> Budget {
        Budget::new(shapes::Limits {
            max_work: self.max_work,
            max_scratch_bytes: self.max_scratch_bytes,
            max_compare_bytes: self.max_compare_bytes,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RootLocation {
    Collider {
        slot: u32,
        generation: u32,
    },
    CompoundChild {
        slot: u32,
        generation: u32,
        index: u32,
    },
}

impl RootLocation {
    fn handle(self) -> ColliderHandle {
        let (slot, generation) = match self {
            Self::Collider { slot, generation }
            | Self::CompoundChild {
                slot, generation, ..
            } => (slot, generation),
        };
        ColliderHandle::from_raw_parts(slot, generation)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Entry {
    pub location: RootLocation,
    /// First occurrence's ordinal, including itself. Never an address/hash.
    pub first: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Table {
    pub version: u32,
    pub roots: Vec<Entry>,
}

impl Table {
    pub fn root_count(&self) -> usize {
        self.roots.len()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    WorkLimit,
    ScratchLimit,
    CompareLimit,
    Allocation,
    RootLimit,
    UnsupportedShape,
    Encoding,
    DifferentValue,
    Version,
    RootLocation,
    Group,
    ChildTopology,
    ExistingSharing,
    ParentNotUnique,
}
impl Error {
    pub fn is_resource_limit(self) -> bool {
        matches!(
            self,
            Self::WorkLimit
                | Self::ScratchLimit
                | Self::CompareLimit
                | Self::Allocation
                | Self::RootLimit
        )
    }
}
impl fmt::Display for Error {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(out, "stored shape aliases: {self:?}")
    }
}
impl core::error::Error for Error {}
impl From<shapes::Error> for Error {
    fn from(error: shapes::Error) -> Self {
        match error {
            shapes::Error::WorkLimit => Self::WorkLimit,
            shapes::Error::ScratchLimit => Self::ScratchLimit,
            shapes::Error::CompareLimit => Self::CompareLimit,
            shapes::Error::Allocation => Self::Allocation,
            shapes::Error::UnsupportedShape => Self::UnsupportedShape,
            shapes::Error::Encoding => Self::Encoding,
            shapes::Error::DifferentValue => Self::DifferentValue,
            shapes::Error::ParentNotUnique => Self::ParentNotUnique,
            shapes::Error::StaleProof | shapes::Error::ChildIndex => Self::RootLocation,
        }
    }
}

struct Root<'a> {
    location: RootLocation,
    shape: &'a SharedShape,
    kind: Kind,
    children: usize,
}

// Raw Arena iterators visit vacant slots. Count and collect are two separately
// precharged scans; neither an arbitrary table nor live-count hides vacancies.
fn census<'a>(
    colliders: &'a ColliderSet,
    max: usize,
    budget: &mut Budget,
) -> Result<Vec<Root<'a>>, Error> {
    if colliders.len() > max {
        return Err(Error::RootLimit);
    }
    budget.work(colliders.colliders.capacity())?;
    let mut count = 0usize;
    for (_, collider) in colliders.iter() {
        let children = collider
            .shared_shape()
            .as_compound()
            .map_or(0, |shape| shape.shapes().len());
        count = count
            .checked_add(1)
            .and_then(|n| n.checked_add(children))
            .ok_or(Error::RootLimit)?;
        if count > max || u32::try_from(count).is_err() {
            return Err(Error::RootLimit);
        }
    }
    let mut roots = budget.vector(count)?;
    budget.work(colliders.colliders.capacity())?;
    for (handle, collider) in colliders.iter() {
        let (slot, generation) = handle.into_raw_parts();
        let shape = collider.shared_shape();
        let kind = shapes::kind(shape)?;
        let children = shape.as_compound().map_or(0, |shape| shape.shapes().len());
        roots.push(Root {
            location: RootLocation::Collider { slot, generation },
            shape,
            kind,
            children,
        });
        if let Some(compound) = shape.as_compound() {
            // count records were charged before collection/allocation.
            for (index, (_, shape)) in compound.shapes().iter().enumerate() {
                let kind = shapes::kind(shape)?;
                if !shapes::convex(kind) {
                    return Err(Error::UnsupportedShape);
                }
                roots.push(Root {
                    location: RootLocation::CompoundChild {
                        slot,
                        generation,
                        index: index as u32,
                    },
                    shape,
                    kind,
                    children: 0,
                });
            }
        }
    }
    Ok(roots)
}

fn sort_work(count: usize) -> Result<usize, Error> {
    let levels = if count <= 1 {
        0
    } else {
        (usize::BITS - (count - 1).leading_zeros()) as usize
    };
    count.checked_mul(levels).ok_or(Error::WorkLimit)
}

fn identity_groups(roots: &[Root<'_>], budget: &mut Budget) -> Result<Vec<u32>, Error> {
    let mut sorted = budget.vector(roots.len())?;
    for (index, root) in roots.iter().enumerate() {
        sorted.push((Arc::as_ptr(&root.shape.0) as *const () as usize, index));
    }
    budget.work(sort_work(sorted.len())?)?;
    sorted.sort_unstable();
    let mut groups = budget.vector(roots.len())?;
    groups.resize(roots.len(), 0);
    budget.work(roots.len())?;
    let mut previous: Option<usize> = None;
    let mut first = 0;
    for (_, ordinal) in sorted {
        if previous.is_none_or(|index| !Arc::ptr_eq(&roots[index].shape.0, &roots[ordinal].shape.0))
        {
            first = ordinal;
        }
        groups[ordinal] = first as u32;
        previous = Some(ordinal);
    }
    Ok(groups)
}

/// Stable raw collider slot order, then the collider root and ascending child
/// index. Distinct equal-valued allocations keep distinct first ordinals.
pub fn capture(colliders: &ColliderSet, limits: Limits) -> Result<(Table, Usage), Error> {
    let mut budget = limits.budget();
    let roots = census(colliders, limits.max_roots, &mut budget)?;
    let groups = identity_groups(&roots, &mut budget)?;
    let mut entries = budget.vector(roots.len())?;
    for (root, first) in roots.iter().zip(groups) {
        entries.push(Entry {
            location: root.location,
            first,
        });
    }
    Ok((
        Table {
            version: 1,
            roots: entries,
        },
        budget.usage(),
    ))
}

struct LeafPlan {
    location: RootLocation,
    proof: EquivalentShape,
}
struct ParentPlan {
    target: ColliderHandle,
    first: ColliderHandle,
}

/// Intended for a fresh ordinary-memory-decoded unpublished candidate. Existing
/// aliases are accepted if compatible; splitting an existing Arc group or COW
/// cloning a non-unique parent is rejected before any mutation/allocation repair.
pub fn restore(colliders: &mut ColliderSet, table: &Table, limits: Limits) -> Result<Usage, Error> {
    if table.version != 1 {
        return Err(Error::Version);
    }
    if table.roots.len() > limits.max_roots {
        return Err(Error::RootLimit);
    }
    let mut budget = limits.budget();
    budget.work(table.roots.len())?;
    let roots = census(colliders, limits.max_roots, &mut budget)?;
    if roots.len() != table.roots.len() {
        return Err(Error::RootLocation);
    }
    let existing = identity_groups(&roots, &mut budget)?;
    budget.work(roots.len())?;
    for (index, (root, entry)) in roots.iter().zip(&table.roots).enumerate() {
        if root.location != entry.location {
            return Err(Error::RootLocation);
        }
        let first = entry.first as usize;
        if first > index || table.roots[first].first != entry.first {
            return Err(Error::Group);
        }
        // A new group must really remain separate. Memory decode provides this
        // naturally; never silently coalesce table groups or allocate a repair.
        if table.roots[existing[index] as usize].first != entry.first {
            return Err(Error::ExistingSharing);
        }
    }
    budget.work(roots.len())?;
    for (index, root) in roots.iter().enumerate() {
        let first = table.roots[index].first as usize;
        if root.kind != Kind::Compound || first == index {
            continue;
        }
        if roots[first].kind != Kind::Compound || roots[first].children != root.children {
            return Err(Error::ChildTopology);
        }
        budget.work(root.children)?;
        for child in 1..=root.children {
            if table.roots[index + child].first != table.roots[first + child].first {
                return Err(Error::ChildTopology);
            }
        }
    }
    let mut leaves = budget.vector(roots.len())?;
    let mut parents = budget.vector(roots.len())?;
    budget.work(roots.len())?;
    for (index, root) in roots.iter().enumerate() {
        let first = table.roots[index].first as usize;
        if first == index || Arc::ptr_eq(&root.shape.0, &roots[first].shape.0) {
            continue;
        }
        if root.kind == Kind::Compound {
            // No parent Arc is cloned/pinned here: its children must remain
            // uniquely mutable until all same-value child swaps have committed.
            shapes::equal_value(root.shape, roots[first].shape, &mut budget)?;
            parents.push(ParentPlan {
                target: root.location.handle(),
                first: roots[first].location.handle(),
            });
        } else {
            leaves.push(LeafPlan {
                location: root.location,
                proof: EquivalentShape::prepare(root.shape, roots[first].shape, &mut budget)?,
            });
        }
    }
    budget.work(leaves.len())?;
    for plan in &leaves {
        if let RootLocation::CompoundChild { .. } = plan.location {
            let parent = colliders
                .get(plan.location.handle())
                .ok_or(Error::RootLocation)?
                .shared_shape();
            if Arc::strong_count(&parent.0) != 1 || Arc::weak_count(&parent.0) != 0 {
                return Err(Error::ParentNotUnique);
            }
        }
    }
    // All fallible validation/resource/scratch preparation finishes here. The
    // exclusive set borrow, real concrete shapes and pinned leaf proofs prevent
    // an intervening value/identity edit. Child writes target unique parents;
    // canonical first parent roots are never parent-plan targets themselves.
    budget.work(
        leaves
            .len()
            .checked_add(parents.len())
            .ok_or(Error::WorkLimit)?,
    )?;
    drop(roots);
    for plan in leaves {
        let collider = colliders
            .get_mut_internal(plan.location.handle())
            .expect("validated collider root");
        match plan.location {
            RootLocation::Collider { .. } => plan
                .proof
                .apply(&mut collider.shape)
                .expect("pinned same-value leaf"),
            RootLocation::CompoundChild { index, .. } => {
                shapes::rebind_child(&mut collider.shape, index as usize, plan.proof)
                    .expect("validated unique parent and pinned child")
            }
        }
    }
    for plan in parents {
        let replacement = colliders
            .get(plan.first)
            .expect("canonical parent root")
            .shape
            .clone();
        colliders
            .get_mut_internal(plan.target)
            .expect("validated parent target")
            .shape = replacement;
    }
    Ok(budget.usage())
}
