//! Completed-step capture reserves work before publishing a query BVH.
//! Failure keeps the existing unavailable-capture contract, never a no-hit.
use super::*;
use crate::physics3d::{motion_error::TrajectoryError, motion_work::Work};

impl StepMotion {
    pub(in crate::physics3d) fn invalidate_capture(&mut self) {
        self.capture_failed = true;
        self.ready = false;
    }

    fn prepay_finish(&self, work: &mut Work) -> Result<(), TrajectoryError> {
        // This scan only reads keys/counts, not shapes or motion bounds. Cold
        // admission already limits the same counts to 2^20; checked arithmetic
        // also protects a live owner before its first completed capture.
        let scanned = self.segments.len().max(self.leaves) as u64;
        work.charge(scanned.checked_add(16).ok_or(TrajectoryError::WorkLimit)?)?;
        let mut leaves = u64::from(self.bvh.leaf_count());
        let mut visits = 1u64;
        for index in 0..self.segments.len() {
            let key = u32::try_from(index).map_err(|_| TrajectoryError::WorkLimit)?;
            if self.bvh.leaf_node(key).is_some() {
                // Existing-key partial updates are constant-time indexed writes.
                visits = visits.checked_add(1).ok_or(TrajectoryError::WorkLimit)?;
            } else {
                // A new insert descends at most the current leaf count; each
                // descent has a fixed local SAH/rotation phase. No balanced
                // tree or logarithmic worst-case assumption is made.
                leaves = leaves.checked_add(1).ok_or(TrajectoryError::WorkLimit)?;
                visits = visits
                    .checked_add(leaves)
                    .ok_or(TrajectoryError::WorkLimit)?;
            }
        }
        for index in self.segments.len()..self.leaves {
            let key = u32::try_from(index).map_err(|_| TrajectoryError::WorkLimit)?;
            if self.bvh.leaf_node(key).is_some() {
                // Removal can traverse every remaining ancestor. Use the
                // current leaf bound, independent of previous rotations.
                visits = visits
                    .checked_add(leaves.checked_add(1).ok_or(TrajectoryError::WorkLimit)?)
                    .ok_or(TrajectoryError::WorkLimit)?;
                leaves = leaves.saturating_sub(1);
            }
        }
        let topology = visits
            .checked_mul(8)
            // Refit visits old storage (including orphaned slots) and at most
            // one new wide node per segment; prepay before any partial update.
            .and_then(|v| v.checked_add(self.bvh.total_memory_size() as u64))
            .and_then(|v| {
                v.checked_add(
                    (self.segments.len() as u64)
                        .checked_add(1)?
                        .checked_mul(128)?,
                )
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        // These are logical node/storage/phase units, not CPU instructions or
        // allocator/RSS guarantees. It covers the complete tree update.
        work.charge(topology)
    }

    pub(super) fn finish(&mut self, colliders: &rp::ColliderSet, work: &mut Work) {
        if !self.enabled {
            return;
        }
        self.ready = false;
        if self.prepay_finish(work).is_err() {
            // No tree mutation has happened. The old valid owner remains
            // serializable, but cannot answer this tick's captured queries.
            self.invalidate_capture();
            return;
        }
        for (index, target) in self.segments.iter().enumerate() {
            let Some(collider) = colliders.get(target.collider) else {
                continue;
            };
            let bounds = motion_bounds(collider.shape(), &target.motion);
            self.bvh
                .insert_or_update_partially(bounds, index as u32, 0.);
        }
        // All topology work was admitted before the first partial write.
        for index in self.segments.len()..self.leaves {
            self.bvh.remove(index as u32);
        }
        self.leaves = self.segments.len();
        self.bvh.refit(&mut self.workspace);
        self.ready = !self.capture_failed;
    }
}

#[cfg(test)]
mod tests;
