// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
use super::*;
use crate::data::AdjacencyCredit;
use core::mem::{size_of, swap};

/// The spatial tree is copied as flat native arrays. Adjacency and pair stamps
/// retain their original slot order; no broad-phase sorting or geometry copy.
#[derive(Default)]
pub(crate) struct BroadStepCredit {
    tree: Bvh,
    pairs: Vec<((ColliderHandle, ColliderHandle), u32)>,
    adjacency: AdjacencyCredit<ColliderHandle>,
    edge_count: usize,
    previous_leaves: Vec<u32>,
    pending: Vec<ColliderHandle>,
    changes: u32,
    reinsert: bool,
    frame: u32,
    deferred: bool,
}

impl BroadStepCredit {
    pub(crate) fn initial_visits(source: &BroadPhaseBvh) -> Option<usize> {
        source
            .pairs
            .capacity()
            .checked_add(source.pair_adjacency.step_credit_slots())
    }

    pub(crate) fn trim_and_size(&mut self, source: &BroadPhaseBvh) -> Option<usize> {
        let (slots, edges) = AdjacencyCredit::layout(&source.pair_adjacency)?;
        self.edge_count = edges;
        self.adjacency.trim(slots, edges);
        self.tree.trim_step_credit(&source.tree);
        if self.pairs.capacity() > source.pairs.len() {
            self.pairs = Vec::new();
        }
        if self.previous_leaves.capacity() > source.prev_updated_leaves.len() {
            self.previous_leaves = Vec::new();
        }
        if self.pending.capacity() > source.pending_set_aabb.len() {
            self.pending = Vec::new();
        }
        [
            source.tree.step_credit_bytes()?,
            source
                .pairs
                .len()
                .checked_mul(size_of::<((ColliderHandle, ColliderHandle), u32)>())?,
            AdjacencyCredit::<ColliderHandle>::bytes(slots, edges)?,
            source
                .prev_updated_leaves
                .len()
                .checked_mul(size_of::<u32>())?,
            source
                .pending_set_aabb
                .len()
                .checked_mul(size_of::<ColliderHandle>())?,
        ]
        .into_iter()
        .try_fold(0usize, usize::checked_add)
    }

    pub(crate) fn retained(&self) -> Option<usize> {
        [
            self.tree.retained_step_credit_bytes()?,
            self.pairs
                .capacity()
                .checked_mul(size_of::<((ColliderHandle, ColliderHandle), u32)>())?,
            self.adjacency.retained()?,
            self.previous_leaves
                .capacity()
                .checked_mul(size_of::<u32>())?,
            self.pending
                .capacity()
                .checked_mul(size_of::<ColliderHandle>())?,
        ]
        .into_iter()
        .try_fold(0usize, usize::checked_add)
    }

    pub(crate) fn capture(&mut self, source: &BroadPhaseBvh) -> Option<()> {
        self.tree.try_copy_step_credit(&source.tree)?;
        self.pairs.clear();
        self.pairs.try_reserve_exact(source.pairs.len()).ok()?;
        self.pairs
            .extend(source.pairs.iter().map(|(p, stamp)| (*p, *stamp)));
        self.adjacency
            .capture(&source.pair_adjacency, self.edge_count)?;
        self.previous_leaves.clear();
        self.previous_leaves
            .try_reserve_exact(source.prev_updated_leaves.len())
            .ok()?;
        self.previous_leaves
            .extend_from_slice(&source.prev_updated_leaves);
        self.pending.clear();
        self.pending
            .try_reserve_exact(source.pending_set_aabb.len())
            .ok()?;
        self.pending.extend_from_slice(&source.pending_set_aabb);
        self.changes = source.changes_since_optimize;
        self.reinsert = source.reinsert_leaf_updates;
        self.frame = source.frame_index;
        self.deferred = source.deferred_optimize_pending;
        Some(())
    }

    pub(crate) fn restore(&mut self, dest: &mut BroadPhaseBvh) {
        swap(&mut dest.tree, &mut self.tree);
        // An update may insert or remove entries but never shrinks this map.
        dest.pairs.clear();
        dest.pairs.extend(self.pairs.iter().copied());
        self.adjacency.restore(&mut dest.pair_adjacency);
        swap(&mut dest.prev_updated_leaves, &mut self.previous_leaves);
        swap(&mut dest.pending_set_aabb, &mut self.pending);
        dest.changes_since_optimize = self.changes;
        dest.reinsert_leaf_updates = self.reinsert;
        dest.frame_index = self.frame;
        dest.deferred_optimize_pending = self.deferred;
    }
}
