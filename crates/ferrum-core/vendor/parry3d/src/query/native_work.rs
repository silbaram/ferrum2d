//! Shared logical admission types; no simulation or persistent state.
#[cfg(feature = "alloc")]
use alloc::{collections::BinaryHeap, vec::Vec};

/// Fixed-size phases of the original Native contact algorithms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeContactPhase {
    /// Validate leaf dispatch and perform fixed relative/world pose work.
    Dispatch,
    /// Prepare the original GJK simplex and initial direction.
    GjkBootstrap,
    /// Execute one GJK loop body, including perturb-only retries.
    GjkIteration,
    /// Construct the bounded initial EPA polytope.
    EpaBootstrap,
    /// Execute fixed work for one nondeleted expansion face.
    EpaExpansion,
    /// Reconstruct the final selected face witnesses.
    EpaFinish,
    /// Perform fixed point-projection bookkeeping; iterative work is separate.
    PointQuery,
    /// Perform fixed feature-normal and feature-selection bookkeeping.
    Feature,
}

/// Local backing storage whose growth is about to be requested.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeContactStorage {
    /// EPA support vertices.
    Vertices,
    /// EPA polytope faces.
    Faces,
    /// Visible-boundary edges of an EPA expansion.
    Silhouette,
    /// EPA candidate-face priority heap.
    Heap,
    /// Local iterative silhouette traversal stack.
    Traversal,
}

/// Work about to run. These are logical visits/requested bytes, not CPU, RSS,
/// allocator capacity, or wall-clock bounds. Notifications precede execution.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeContactWork {
    /// Admit one bounded fixed-size phase.
    Fixed(NativeContactPhase),
    /// Admit an original pair of support-map calls before either executes.
    Support {
        /// Original first support-map cloud size.
        points_a: usize,
        /// Original second support-map cloud size.
        points_b: usize,
    },
    /// Admit a conservative point/adjacency bound for one feature phase.
    PointVisits(usize),
    /// Visit one silhouette edge and potentially construct one new face.
    FaceVisit,
    /// Visit one silhouette traversal edge, including deleted-face checks.
    EdgeVisit,
    /// Admit a heap operation with this current entry bound, including stale faces.
    HeapVisits(usize),
    /// Request backing storage after this event succeeds.
    Storage {
        /// Local container that may grow.
        storage: NativeContactStorage,
        /// Total target backing bytes requested, including spare capacity.
        requested_bytes: usize,
        /// Live elements the reservation may relocate.
        relocated_elements: usize,
        /// Live payload bytes the reservation may relocate.
        relocated_bytes: usize,
    },
}

/// A metered query never substitutes an arbitrary contact on failure.
#[derive(Debug)]
pub enum NativeContactError<E> {
    /// The caller declined the next operation.
    Admission(E),
    /// Checked capacity arithmetic or fallible reservation failed.
    Allocation,
    /// The shape pair is outside this point-cloud leaf entry.
    Unsupported,
}

// Match the original containers' amortized growth instead of introducing a
// per-element reallocation path. The target is a logical request, not a claim
// about the allocator's resulting capacity. No new allowance is created.
#[cfg(feature = "alloc")]
fn growth_target(len: usize, capacity: usize) -> Option<usize> {
    Some(len.checked_add(1)?.max(capacity.checked_mul(2)?).max(4))
}

pub(crate) struct Meter<'a, F> {
    pub(crate) admit: &'a mut F,
}
impl<'a, F> Meter<'a, F> {
    pub(crate) fn charge<E>(&mut self, work: NativeContactWork) -> Result<(), NativeContactError<E>>
    where
        F: FnMut(NativeContactWork) -> Result<(), E>,
    {
        (self.admit)(work).map_err(NativeContactError::Admission)
    }

    pub(crate) fn support<E>(&mut self, points: [usize; 2]) -> Result<(), NativeContactError<E>>
    where
        F: FnMut(NativeContactWork) -> Result<(), E>,
    {
        self.charge(NativeContactWork::Support {
            points_a: points[0],
            points_b: points[1],
        })
    }

    #[cfg(feature = "alloc")]
    pub(crate) fn before_push<T, E>(
        &mut self,
        values: &mut Vec<T>,
        storage: NativeContactStorage,
    ) -> Result<(), NativeContactError<E>>
    where
        F: FnMut(NativeContactWork) -> Result<(), E>,
    {
        if values.len() == values.capacity() {
            let target = growth_target(values.len(), values.capacity())
                .ok_or(NativeContactError::Allocation)?;
            let additional = target
                .checked_sub(values.len())
                .ok_or(NativeContactError::Allocation)?;
            let requested_bytes = target
                .checked_mul(size_of::<T>())
                .ok_or(NativeContactError::Allocation)?;
            self.charge(NativeContactWork::Storage {
                storage,
                requested_bytes,
                relocated_elements: values.len(),
                relocated_bytes: values
                    .len()
                    .checked_mul(size_of::<T>())
                    .ok_or(NativeContactError::Allocation)?,
            })?;
            values
                .try_reserve_exact(additional)
                .map_err(|_| NativeContactError::Allocation)?;
        }
        Ok(())
    }

    #[cfg(feature = "alloc")]
    pub(crate) fn push<T, E>(
        &mut self,
        values: &mut Vec<T>,
        value: T,
        storage: NativeContactStorage,
    ) -> Result<(), NativeContactError<E>>
    where
        F: FnMut(NativeContactWork) -> Result<(), E>,
    {
        self.before_push(values, storage)?;
        values.push(value);
        Ok(())
    }

    #[cfg(feature = "alloc")]
    pub(crate) fn before_heap_push<T: Ord, E>(
        &mut self,
        heap: &mut BinaryHeap<T>,
    ) -> Result<(), NativeContactError<E>>
    where
        F: FnMut(NativeContactWork) -> Result<(), E>,
    {
        self.charge(NativeContactWork::HeapVisits(heap.len().saturating_add(1)))?;
        if heap.len() == heap.capacity() {
            let target =
                growth_target(heap.len(), heap.capacity()).ok_or(NativeContactError::Allocation)?;
            let additional = target
                .checked_sub(heap.len())
                .ok_or(NativeContactError::Allocation)?;
            let requested_bytes = target
                .checked_mul(size_of::<T>())
                .ok_or(NativeContactError::Allocation)?;
            self.charge(NativeContactWork::Storage {
                storage: NativeContactStorage::Heap,
                requested_bytes,
                relocated_elements: heap.len(),
                relocated_bytes: heap
                    .len()
                    .checked_mul(size_of::<T>())
                    .ok_or(NativeContactError::Allocation)?,
            })?;
            heap.try_reserve_exact(additional)
                .map_err(|_| NativeContactError::Allocation)?;
        }
        Ok(())
    }
}
