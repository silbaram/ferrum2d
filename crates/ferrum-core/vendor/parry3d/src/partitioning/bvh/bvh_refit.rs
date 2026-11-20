// Ferrum2D modified source; see FERRUM-PATCHES.md.
use super::bvh_tree::{BvhNodeIndex, BvhNodeVec, BvhNodeWide};
use super::{Bvh, BvhNode, BvhWorkspace};
use crate::utils::VecMap;
use alloc::vec::Vec;

// Normal balanced trees use a small, bounded call stack. Valid saved trees may
// be arbitrarily deep, so only the tail switches to the stackless walk below.
const REFIT_RECURSION_BUDGET: u32 = 32;

// Keep task fan-out bounded; sequential tails use the iterative helper below.
#[cfg(feature = "parallel")]
const SEQUENTIAL_REFIT_LEAVES: u32 = 2048;

impl Bvh {
    /// Updates the BVH's internal node AABBs after leaf changes.
    ///
    /// Refitting ensures that every internal node's AABB tightly encloses the AABBs of its
    /// children. This operation is essential after updating leaf positions with
    /// [`insert_or_update_partially`] and is much faster than rebuilding the entire tree.
    ///
    /// In addition to updating AABBs, this method:
    /// - Reorders nodes in depth-first order for better cache locality during queries
    /// - Ensures leaf counts on each node are correct
    /// - Propagates change flags from leaves to ancestors (for change detection)
    ///
    /// # When to Use
    ///
    /// Call `refit` after:
    /// - Bulk updates with [`insert_or_update_partially`]
    /// - Any operation that modifies leaf AABBs without updating ancestor nodes
    /// - When you want to optimize tree layout for better query performance
    ///
    /// **Don't call `refit` after**:
    /// - Regular [`insert`] calls (they already update ancestors)
    /// - [`remove`] calls (they already maintain tree validity)
    ///
    /// # Arguments
    ///
    /// * `workspace` - A reusable workspace to avoid allocations. Can be shared across
    ///   multiple BVH operations for better performance.
    ///
    /// # Performance
    ///
    /// - **Time**: O(n) where n is the number of nodes
    /// - **Space**: O(n) temporary storage in workspace
    /// - Much faster than rebuilding the tree from scratch
    /// - Essential for maintaining good query performance in dynamic scenes
    ///
    /// # Examples
    ///
    /// ## After bulk updates
    ///
    /// ```
    /// # #[cfg(all(feature = "dim3", feature = "f32"))] {
    /// use parry3d::partitioning::{Bvh, BvhWorkspace};
    /// use parry3d::bounding_volume::Aabb;
    /// use parry3d::math::Vector;
    ///
    /// let mut bvh = Bvh::new();
    /// let mut workspace = BvhWorkspace::default();
    ///
    /// // Insert initial objects
    /// for i in 0..100 {
    ///     let aabb = Aabb::new(
    ///         Vector::new(i as f32, 0.0, 0.0),
    ///         Vector::new(i as f32 + 1.0, 1.0, 1.0)
    ///     );
    ///     bvh.insert(aabb, i);
    /// }
    ///
    /// // Update all objects without tree propagation (faster)
    /// for i in 0..100 {
    ///     let offset = 0.1;
    ///     let aabb = Aabb::new(
    ///         Vector::new(i as f32 + offset, 0.0, 0.0),
    ///         Vector::new(i as f32 + 1.0 + offset, 1.0, 1.0)
    ///     );
    ///     bvh.insert_or_update_partially(aabb, i, 0.0);
    /// }
    ///
    /// // Now update the tree in one efficient pass
    /// bvh.refit(&mut workspace);
    /// # }
    /// ```
    ///
    /// ## In a game loop
    ///
    /// ```
    /// # #[cfg(all(feature = "dim3", feature = "f32"))] {
    /// use parry3d::partitioning::{Bvh, BvhWorkspace};
    /// use parry3d::bounding_volume::Aabb;
    /// use parry3d::math::Vector;
    ///
    /// let mut bvh = Bvh::new();
    /// let mut workspace = BvhWorkspace::default();
    ///
    /// // Game initialization - add objects
    /// for i in 0..1000 {
    ///     let aabb = Aabb::new(
    ///         Vector::new(i as f32, 0.0, 0.0),
    ///         Vector::new(i as f32 + 1.0, 1.0, 1.0)
    ///     );
    ///     bvh.insert(aabb, i);
    /// }
    ///
    /// // Game loop - update objects each frame
    /// for frame in 0..100 {
    ///     // Update physics, AI, etc.
    ///     for i in 0..1000 {
    ///         let time = frame as f32 * 0.016; // ~60 FPS
    ///         let pos = time.sin() * 10.0;
    ///         let aabb = Aabb::new(
    ///             Vector::new(i as f32 + pos, 0.0, 0.0),
    ///             Vector::new(i as f32 + pos + 1.0, 1.0, 1.0)
    ///         );
    ///         bvh.insert_or_update_partially(aabb, i, 0.0);
    ///     }
    ///
    ///     // Refit once per frame for all updates
    ///     bvh.refit(&mut workspace);
    ///
    ///     // Now perform collision detection queries...
    /// }
    /// # }
    /// ```
    ///
    /// ## With change detection margin
    ///
    /// ```
    /// # #[cfg(all(feature = "dim3", feature = "f32"))] {
    /// use parry3d::partitioning::{Bvh, BvhWorkspace};
    /// use parry3d::bounding_volume::Aabb;
    /// use parry3d::math::Vector;
    ///
    /// let mut bvh = Bvh::new();
    /// let mut workspace = BvhWorkspace::default();
    ///
    /// // Add an object
    /// let aabb = Aabb::new(Vector::ZERO, Vector::new(1.0, 1.0, 1.0));
    /// bvh.insert(aabb, 0);
    ///
    /// // Update with a margin - tree won't update if movement is small
    /// let margin = 0.5;
    /// let new_aabb = Aabb::new(Vector::new(0.1, 0.0, 0.0), Vector::new(1.1, 1.0, 1.0));
    /// bvh.insert_or_update_partially(new_aabb, 0, margin);
    ///
    /// // Refit propagates the change detection flags
    /// bvh.refit(&mut workspace);
    /// # }
    /// ```
    ///
    /// # Comparison with `refit_without_opt`
    ///
    /// This method reorganizes the tree in memory for better cache performance.
    /// If you only need to update AABBs without reordering, use [`refit_without_opt`](Self::refit_without_opt)
    /// which is faster but doesn't improve memory layout.
    ///
    /// # Notes
    ///
    /// - Reuses the provided `workspace` to avoid allocations
    /// - Safe to call even if no leaves were modified (just reorganizes tree)
    /// - Does not change the tree's topology, only AABBs and layout
    /// - Call this before [`optimize_incremental`] for best results
    ///
    /// # See Also
    ///
    /// - [`insert_or_update_partially`](Bvh::insert_or_update_partially) - Update leaves
    ///   without propagation
    /// - [`refit_without_opt`](Self::refit_without_opt) - Faster refit without memory
    ///   reorganization
    /// - [`optimize_incremental`](Bvh::optimize_incremental) - Improve tree quality
    /// - [`BvhWorkspace`] - Reusable workspace for operations
    ///
    /// [`insert_or_update_partially`]: Bvh::insert_or_update_partially
    /// [`insert`]: Bvh::insert
    /// [`remove`]: Bvh::remove
    /// [`optimize_incremental`]: Bvh::optimize_incremental
    pub fn refit(&mut self, workspace: &mut BvhWorkspace) {
        Self::refit_buffers::<true>(
            &mut self.nodes,
            &mut workspace.refit_tmp,
            &mut self.leaf_node_indices,
            &mut self.parents,
        );

        // Swap the old nodes with the refitted ones.
        core::mem::swap(&mut self.nodes, &mut workspace.refit_tmp);
        // The refit rebuilt the node array in depth-first order, dropping the
        // orphaned slots the free list pointed to.
        self.free_wide_nodes.clear();
    }

    /// Same as [`Self::refit`], but processes independent subtrees in parallel.
    ///
    /// The result is identical to [`Self::refit`] (same node layout, same flags);
    /// only the work distribution differs.
    #[cfg(feature = "parallel")]
    pub fn refit_parallel(&mut self, workspace: &mut BvhWorkspace) {
        Self::refit_buffers_parallel::<true>(
            &mut self.nodes,
            &mut workspace.refit_tmp,
            &mut self.leaf_node_indices,
            &mut self.parents,
        );

        // Swap the old nodes with the refitted ones.
        core::mem::swap(&mut self.nodes, &mut workspace.refit_tmp);
        // The refit rebuilt the node array in depth-first order, dropping the
        // orphaned slots the free list pointed to.
        self.free_wide_nodes.clear();
    }

    #[cfg(feature = "parallel")]
    fn refit_buffers_parallel<const RESOLVE: bool>(
        source: &mut BvhNodeVec,
        target: &mut BvhNodeVec,
        leaf_data: &mut VecMap<BvhNodeIndex>,
        parents: &mut Vec<BvhNodeIndex>,
    ) {
        if source.is_empty() || source[0].leaf_count() <= SEQUENTIAL_REFIT_LEAVES {
            return Self::refit_buffers::<RESOLVE>(source, target, leaf_data, parents);
        }
        let final_len = source[0].leaf_count() as usize - 1;
        target.resize(source.len(), BvhNodeWide::zeros());
        parents.resize(source.len(), BvhNodeIndex::default());
        let root_parent = parents[0];
        // The old implementation split once at the root, then six levels per
        // branch. Preserve that bounded fan-out with safe disjoint slices.
        let (_, layout_changed) = Self::refit_subtree_parallel::<RESOLVE>(
            source,
            &mut target.0[..final_len],
            &mut parents[..final_len],
            0,
            0,
            root_parent,
            7,
        );
        // Leaf keys are sparse and need not follow subtree order. Remap only
        // after all tasks join, avoiding shared mutable VecMap/container aliases.
        // An unchanged preorder layout keeps all leaf indices. Detect this in
        // the existing traversal, avoiding an extra serial pass between ticks.
        if layout_changed {
            for (id, wide) in target.iter().take(final_len).enumerate() {
                for (right, node) in [(false, &wide.left), (true, &wide.right)] {
                    if node.is_leaf() {
                        leaf_data[node.children as usize] = BvhNodeIndex::new(id as u32, right);
                    }
                }
            }
        }
        source.truncate(final_len);
        target.truncate(final_len);
        parents.truncate(final_len);
    }

    #[cfg(feature = "parallel")]
    fn refit_subtree_parallel<const RESOLVE: bool>(
        source: &BvhNodeVec,
        target: &mut [BvhNodeWide],
        parents: &mut [BvhNodeIndex],
        source_id: u32,
        target_base: u32,
        parent: BvhNodeIndex,
        depth: u32,
    ) -> (BvhNode, bool) {
        let node = source[source_id as usize];
        if depth == 0 || node.leaf_count() <= SEQUENTIAL_REFIT_LEAVES {
            // Mapping is deliberately deferred to the post-join pass above.
            let mut layout_changed = false;
            let merged = Self::refit_subtree::<RESOLVE, true>(
                source,
                target,
                parents,
                source_id,
                target_base,
                parent,
                |_, _| {},
                &mut layout_changed,
            );
            return (merged, layout_changed);
        }
        let left_size = if node.left.is_leaf() {
            0
        } else {
            node.left.leaf_count() as usize - 1
        };
        let (root, descendants) = target.split_at_mut(1);
        let (root_parent, child_parents) = parents.split_at_mut(1);
        root_parent[0] = parent;
        let (left_target, right_target) = descendants.split_at_mut(left_size);
        let (left_parents, right_parents) = child_parents.split_at_mut(left_size);
        let BvhNodeWide { left, right } = &mut root[0];
        let (left_changed, right_changed) = rayon::join(
            || {
                if node.left.is_leaf() {
                    let mut leaf = node.left;
                    if RESOLVE {
                        leaf.data.resolve_pending_change();
                    }
                    *left = leaf;
                    false
                } else {
                    let (merged, changed) = Self::refit_subtree_parallel::<RESOLVE>(
                        source,
                        left_target,
                        left_parents,
                        node.left.children,
                        target_base + 1,
                        BvhNodeIndex::left(target_base),
                        depth - 1,
                    );
                    *left = merged;
                    changed
                }
            },
            || {
                if node.right.is_leaf() {
                    let mut leaf = node.right;
                    if RESOLVE {
                        leaf.data.resolve_pending_change();
                    }
                    *right = leaf;
                    false
                } else {
                    let (merged, changed) = Self::refit_subtree_parallel::<RESOLVE>(
                        source,
                        right_target,
                        right_parents,
                        node.right.children,
                        target_base + 1 + left_size as u32,
                        BvhNodeIndex::right(target_base),
                        depth - 1,
                    );
                    *right = merged;
                    changed
                }
            },
        );
        (
            root[0].merged(target_base),
            source_id != target_base || left_changed || right_changed,
        )
    }

    /// Same as [`Self::refit`], but leaves every change-detection flag untouched.
    ///
    /// Use this to make the tree valid for queries after a batch of
    /// [`Self::insert_or_update_partially`] without consuming the pending change
    /// flags: a later flag-resolving [`Self::refit`] (or
    /// [`Self::refit_partial`]) will promote them as if this call never happened.
    pub fn refit_without_resolve(&mut self, workspace: &mut BvhWorkspace) {
        Self::refit_buffers::<false>(
            &mut self.nodes,
            &mut workspace.refit_tmp,
            &mut self.leaf_node_indices,
            &mut self.parents,
        );
        core::mem::swap(&mut self.nodes, &mut workspace.refit_tmp);
        // The refit rebuilt the node array in depth-first order, dropping the
        // orphaned slots the free list pointed to.
        self.free_wide_nodes.clear();
    }

    /// Parallel version of [`Self::refit_without_resolve`].
    #[cfg(feature = "parallel")]
    pub fn refit_without_resolve_parallel(&mut self, workspace: &mut BvhWorkspace) {
        Self::refit_buffers_parallel::<false>(
            &mut self.nodes,
            &mut workspace.refit_tmp,
            &mut self.leaf_node_indices,
            &mut self.parents,
        );
        core::mem::swap(&mut self.nodes, &mut workspace.refit_tmp);
        // The refit rebuilt the node array in depth-first order, dropping the
        // orphaned slots the free list pointed to.
        self.free_wide_nodes.clear();
    }

    pub(super) fn refit_buffers<const RESOLVE: bool>(
        source: &mut BvhNodeVec,
        target: &mut BvhNodeVec,
        leaf_data: &mut VecMap<BvhNodeIndex>,
        parents: &mut Vec<BvhNodeIndex>,
    ) {
        if source.is_empty() {
            target.clear();
            parents.clear();
        } else if source[0].leaf_count() <= 2 {
            // No actual refit to apply, just copy the root wide node.
            target.clear();
            parents.clear();
            target.push(source[0]);
            if RESOLVE {
                target[0].left.data.resolve_pending_change();
                if target[0].right.leaf_count() > 0 {
                    target[0].right.data.resolve_pending_change();
                }
            }
            parents.push(BvhNodeIndex::default());
        } else if !source.is_empty() && source[0].leaf_count() > 2 {
            target.resize(
                source.len(),
                BvhNodeWide {
                    left: BvhNode::zeros(),
                    right: BvhNode::zeros(),
                },
            );

            let final_len = source[0].leaf_count() as usize - 1;
            // Root parent metadata is unused; preserve its pre-existing bytes,
            // as the old >2-leaf refit did. Small roots use the branch above.
            let root_parent = parents[0];
            let _ = Self::refit_subtree::<RESOLVE, false>(
                source,
                &mut target.0[..final_len],
                &mut parents[..final_len],
                0,
                0,
                root_parent,
                |key, index| leaf_data[key as usize] = index,
                &mut false,
            );
            source.truncate(final_len);
            target.truncate(final_len);
            parents.truncate(final_len);
        }
    }

    // Shallow trees keep the original indexed preorder pass. Recursion has a
    // fixed budget; deep tails reuse the stackless destination/parent walk.
    fn refit_subtree<const RESOLVE: bool, const TRACK_LAYOUT: bool>(
        source: &BvhNodeVec,
        target: &mut [BvhNodeWide],
        parents: &mut [BvhNodeIndex],
        source_id: u32,
        target_base: u32,
        parent: BvhNodeIndex,
        mut leaf_data: impl FnMut(u32, BvhNodeIndex),
        layout_changed: &mut bool,
    ) -> BvhNode {
        let mut next = 0;
        Self::refit_subtree_bounded::<RESOLVE, TRACK_LAYOUT>(
            source,
            target,
            parents,
            source_id,
            target_base,
            parent,
            &mut next,
            &mut leaf_data,
            layout_changed,
            REFIT_RECURSION_BUDGET,
        );
        debug_assert_eq!(next, target.len());
        target[0].merged(target_base)
    }

    #[allow(clippy::too_many_arguments)]
    fn refit_subtree_bounded<const RESOLVE: bool, const TRACK_LAYOUT: bool>(
        source: &BvhNodeVec,
        target: &mut [BvhNodeWide],
        parents: &mut [BvhNodeIndex],
        source_id: u32,
        target_base: u32,
        parent: BvhNodeIndex,
        next: &mut usize,
        leaf_data: &mut impl FnMut(u32, BvhNodeIndex),
        layout_changed: &mut bool,
        budget: u32,
    ) {
        let id = *next;
        *next += 1;
        let target_id = target_base + id as u32;
        if TRACK_LAYOUT {
            *layout_changed |= source_id != target_id;
        }
        if budget == 0 {
            // Rare deep tails may conservatively remap; no extra traversal is
            // needed to establish whether their internal indices moved.
            if TRACK_LAYOUT {
                *layout_changed = true;
            }
            let len = source[source_id as usize].leaf_count() as usize - 1;
            let _ = Self::refit_subtree_iterative::<RESOLVE>(
                source,
                &mut target[id..id + len],
                &mut parents[id..id + len],
                source_id,
                target_id,
                parent,
                leaf_data,
            );
            *next = id + len;
        } else {
            let node = &source[source_id as usize];
            let (left, right) = (node.left.children, node.right.children);
            let (left_leaf, right_leaf) = (node.left.is_leaf(), node.right.is_leaf());
            if left_leaf {
                target[id].left = node.left;
                if RESOLVE {
                    target[id].left.data.resolve_pending_change();
                }
                leaf_data(left, BvhNodeIndex::left(target_id));
            } else {
                Self::refit_subtree_bounded::<RESOLVE, TRACK_LAYOUT>(
                    source,
                    target,
                    parents,
                    left,
                    target_base,
                    BvhNodeIndex::left(target_id),
                    next,
                    leaf_data,
                    layout_changed,
                    budget - 1,
                );
            }
            if right_leaf {
                target[id].right = source[source_id as usize].right;
                if RESOLVE {
                    target[id].right.data.resolve_pending_change();
                }
                leaf_data(right, BvhNodeIndex::right(target_id));
            } else {
                Self::refit_subtree_bounded::<RESOLVE, TRACK_LAYOUT>(
                    source,
                    target,
                    parents,
                    right,
                    target_base,
                    BvhNodeIndex::right(target_id),
                    next,
                    leaf_data,
                    layout_changed,
                    budget - 1,
                );
            }
            parents[id] = parent;
        }
        if id != 0 {
            let merged = target[id].merged(target_id);
            let (parent_id, right) = parent.decompose();
            let parent_id = parent_id - target_base as usize;
            if right {
                target[parent_id].right = merged;
            } else {
                target[parent_id].left = merged;
            }
        }
    }

    // The destination is also the traversal workspace: source child IDs stay
    // in copied nodes until completed children replace them. Parent links allow
    // a stackless postorder walk with no traversal allocation.
    #[cold]
    #[inline(never)]
    fn refit_subtree_iterative<const RESOLVE: bool>(
        source: &BvhNodeVec,
        target: &mut [BvhNodeWide],
        parents: &mut [BvhNodeIndex],
        source_id: u32,
        target_base: u32,
        parent: BvhNodeIndex,
        mut leaf_data: impl FnMut(u32, BvhNodeIndex),
    ) -> BvhNode {
        target[0] = source[source_id as usize];
        parents[0] = parent;
        let (mut id, mut phase, mut next) = (0usize, 0u8, 1usize);
        loop {
            if phase < 2 {
                let right = phase == 1;
                let node = if right {
                    target[id].right
                } else {
                    target[id].left
                };
                let index = BvhNodeIndex::new(target_base + id as u32, right);
                phase += 1;
                if node.is_leaf() {
                    let mut leaf = node;
                    if RESOLVE {
                        leaf.data.resolve_pending_change();
                    }
                    if right {
                        target[id].right = leaf;
                    } else {
                        target[id].left = leaf;
                    }
                    leaf_data(leaf.children, index);
                } else {
                    target[next] = source[node.children as usize];
                    parents[next] = index;
                    id = next;
                    next += 1;
                    phase = 0;
                }
            } else {
                let merged = target[id].merged(target_base + id as u32);
                if id == 0 {
                    debug_assert_eq!(next, target.len());
                    return merged;
                }
                let (parent, right) = parents[id].decompose();
                id = parent - target_base as usize;
                if right {
                    target[id].right = merged;
                } else {
                    target[id].left = merged;
                }
                phase = if right { 2 } else { 1 };
            }
        }
    }

    /// Incrementally refits the tree after a small number of leaf updates or
    /// insertions.
    ///
    /// This is a faster alternative to [`Self::refit`] valid only if, since the last
    /// refit, the only tree modifications were calls to
    /// [`Self::insert_or_update_partially`], [`Self::insert`],
    /// [`Self::insert_with_change_detection`], or
    /// [`Self::reinsert_or_update_with_change_detection`] (in-place updates,
    /// insertions, or removal-based relocations of leaves). In particular, no leaf
    /// was removed without being re-inserted in the same batch, and no optimization
    /// ran. Otherwise, call [`Self::refit`] instead.
    ///
    /// Insertions are safe here because `insert_new_unchecked` keeps the tree
    /// geometrically valid on its own (it enlarges the ancestor AABBs and increments
    /// their leaf counts during its descent) and creates the new leaf with a pending
    /// change flag. Any transient change-flag state it leaves behind (the pending
    /// flag inherited by the wide node that used to hold the insertion sibling, the
    /// raw-merged flags written by its SAH rotations) lies on the inserted leaf's
    /// ancestor path, which the walk below rewrites all the way to the root — see
    /// `refit_path`.
    ///
    /// [`BvhLeafUpdateStatus::Inserted`]: super::BvhLeafUpdateStatus::Inserted
    ///
    /// `previously_changed` must contain (a superset of) the leaves whose change flag
    /// was set by the previous refit: their change flag gets cleared. `newly_changed`
    /// must contain (a superset of) the leaves updated in-place or inserted since the
    /// last refit: their change flag gets set if their fat AABB actually changed
    /// (inserted leaves always count as changed).
    ///
    /// Unlike [`Self::refit`], this runs in `O(changed * tree_height)` instead of
    /// `O(node_count)`, but doesn't reorder nodes in memory.
    pub fn refit_partial(&mut self, previously_changed: &[u32], newly_changed: &[u32]) {
        // First resolve the change flags of every impacted leaf, and only then walk
        // their ancestor paths. Walking while some leaves still hold an unresolved
        // pending flag would propagate that transient state into internal nodes
        // (a pending internal node reads as "unchanged" during traversals).
        for leaf in previously_changed {
            let Some(leaf_node_id) = self.leaf_node_indices.get(*leaf as usize).copied() else {
                continue;
            };
            let data = &mut self.nodes[leaf_node_id].data;

            // Clear the flag of leaves that were changed at the previous refit and
            // didn't move since. Leaves that moved again (pending) are promoted by
            // the next loop instead.
            if !data.is_change_pending() && data.is_changed() {
                data.resolve_pending_change();
            }
        }

        for leaf in newly_changed {
            let Some(leaf_node_id) = self.leaf_node_indices.get(*leaf as usize).copied() else {
                continue;
            };
            let data = &mut self.nodes[leaf_node_id].data;

            // Promote pending leaves to CHANGED. Leaves whose update stayed within
            // the change-detection margin have no flag to update.
            if data.is_change_pending() {
                data.resolve_pending_change();
            }
        }

        for leaf in previously_changed.iter().chain(newly_changed) {
            let Some(leaf_node_id) = self.leaf_node_indices.get(*leaf as usize).copied() else {
                continue;
            };
            self.refit_path(leaf_node_id);
        }
    }

    /// Propagates AABB and change-flag updates from the given node up to the root.
    ///
    /// The walk deliberately does NOT stop early when an ancestor's recomputed value
    /// matches its stored one: leaf insertions can leave transient change-flag state
    /// (pending flags inherited by the wide node that used to hold the insertion
    /// sibling, raw-merged flags written by the insertion's SAH rotations) anywhere
    /// on the inserted leaf's ancestor path. Walking the whole path rewrites every
    /// ancestor with an exact, normalized recomputation, which is what keeps the
    /// internal change flags exactly equal to the OR of their descendant leaves'
    /// flags. An early-out could strand a stale pending flag above the break point,
    /// and a pending internal node reads as "unchanged" during change-detection
    /// traversals — hiding every changed leaf underneath. The full walk costs
    /// O(tree height) per changed leaf, which is fine in the small-change regime
    /// partial refits are meant for.
    fn refit_path(&mut self, node: BvhNodeIndex) {
        let (mut wide_id, _) = node.decompose();

        while wide_id != 0 {
            let parent = self.parents[wide_id];
            let wide = &self.nodes[wide_id];
            let mut recomputed = wide.left.merged(&wide.right, wide_id as u32);
            recomputed.data.normalize_change_flag();

            self.nodes[parent] = recomputed;
            (wide_id, _) = parent.decompose();
        }
    }

    /// Similar to [`Self::refit`] but without any optimization of the internal node storage layout.
    ///
    /// This can be faster than [`Self::refit`] but doesn’t reorder node to be more cache-efficient
    /// on tree traversals.
    pub fn refit_without_opt(&mut self) {
        if self.leaf_count() <= 2 {
            return;
        }
        // Root leaves deliberately retain their old flags. Every leaf below an
        // internal root child is resolved, matching the original convention.
        let root = self.nodes[0];
        if !root.left.is_leaf() {
            self.refit_in_place_bounded(
                root.left.children,
                BvhNodeIndex::left(0),
                REFIT_RECURSION_BUDGET,
            );
        }
        if !root.right.is_leaf() {
            self.refit_in_place_bounded(
                root.right.children,
                BvhNodeIndex::right(0),
                REFIT_RECURSION_BUDGET,
            );
        }
    }

    fn refit_in_place_bounded(&mut self, id: u32, parent: BvhNodeIndex, budget: u32) {
        if budget == 0 {
            let merged = self.refit_in_place_iterative(id);
            self.nodes[parent] = merged;
            return;
        }
        let node = &self.nodes[id as usize];
        let (left, right) = (node.left.children, node.right.children);
        let (left_is_leaf, right_is_leaf) = (node.left.is_leaf(), node.right.is_leaf());
        if left_is_leaf {
            self.nodes[id as usize].left.data.resolve_pending_change();
        } else {
            self.refit_in_place_bounded(left, BvhNodeIndex::left(id), budget - 1);
        }
        if right_is_leaf {
            self.nodes[id as usize].right.data.resolve_pending_change();
        } else {
            self.refit_in_place_bounded(right, BvhNodeIndex::right(id), budget - 1);
        }
        self.nodes[parent] = self.nodes[id as usize].merged(id);
    }

    #[cold]
    #[inline(never)]
    fn refit_in_place_iterative(&mut self, root: u32) -> BvhNode {
        let (mut id, mut phase) = (root, 0u8);
        loop {
            if phase < 2 {
                let index = BvhNodeIndex::new(id, phase == 1);
                let node = self.nodes[index];
                phase += 1;
                if node.is_leaf() {
                    self.nodes[index].data.resolve_pending_change();
                } else {
                    id = node.children;
                    phase = 0;
                }
            } else {
                if id == root {
                    return self.nodes[id as usize].merged(id);
                }
                let parent = self.parents[id as usize];
                let merged = self.nodes[id as usize].merged(id);
                self.nodes[parent] = merged;
                let (parent, right) = parent.decompose();
                id = parent as u32;
                phase = if right { 2 } else { 1 };
            }
        }
    }
}
