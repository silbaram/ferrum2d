// Ferrum2D modified source; see FERRUM-PATCHES.md.
use super::bvh_optimize::BvhIncrementalOptimizationState;
use super::bvh_tree::BvhNodeVec;
use super::{Bvh, BvhNode, BvhNodeIndex};
use crate::utils::VecMap;
use alloc::vec::Vec;

impl<'de> serde::Deserialize<'de> for Bvh {
    fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(rename = "Bvh")]
        struct State {
            nodes: BvhNodeVec,
            parents: Vec<BvhNodeIndex>,
            leaf_node_indices: VecMap<BvhNodeIndex>,
            optimization: BvhIncrementalOptimizationState,
            #[serde(default)]
            free_wide_nodes: Vec<u32>,
        }
        let state = <State as serde::Deserialize>::deserialize(source)?;
        Self {
            nodes: state.nodes,
            parents: state.parents,
            leaf_node_indices: state.leaf_node_indices,
            optimization: state.optimization,
            free_wide_nodes: state.free_wide_nodes,
        }
        .validate_deserialized()
        .map_err(serde::de::Error::custom)
    }
}

// Parent indices cannot use these bits: a Vec of wide nodes is bounded by
// isize::MAX bytes, while its index encoding only doubles the node index.
// Reject preexisting tags, mark the owned candidate, then restore its exact
// parent bits. No extra scratch allocation or recursion is needed.
const VISITED: usize = 1usize << (usize::BITS - 1);
const FREE: usize = 1usize << (usize::BITS - 2);
const TAGS: usize = VISITED | FREE;
fn finite_bounds(node: &BvhNode) -> bool {
    node.mins.is_finite() && node.maxs.is_finite() && node.mins.cmple(node.maxs).all()
}
fn total(node: &super::BvhNodeWide) -> Result<u32, &'static str> {
    node.left
        .data
        .leaf_count()
        .checked_add(node.right.data.leaf_count())
        .filter(|n| *n <= 0x3fff_ffff)
        .ok_or("invalid BVH subtree count")
}
impl Bvh {
    fn validate_deserialized(mut self) -> Result<Self, &'static str> {
        if self.nodes.len() != self.parents.len() || u32::try_from(self.nodes.len()).is_err() {
            return Err("invalid BVH node/parent storage");
        }
        if self.nodes.is_empty() {
            return if self.leaf_node_indices.is_empty() && self.free_wide_nodes.is_empty() {
                Ok(self)
            } else {
                Err("nonempty metadata on empty BVH")
            };
        }
        if self.parents.iter().any(|p| p.0 & TAGS != 0) {
            return Err("invalid BVH parent tag bits");
        }
        for wide in self.nodes.iter() {
            for node in [&wide.left, &wide.right] {
                if node.data.0 >> 30 == 2 {
                    return Err("invalid BVH change flags");
                }
                if node.data.leaf_count() != 0 && !finite_bounds(node) {
                    return Err("invalid BVH bounds");
                }
            }
        }
        for &id in &self.free_wide_nodes {
            if id == 0 {
                return Err("free BVH root");
            }
            let wide = self.nodes.get(id as usize).ok_or("invalid BVH free slot")?;
            if self.parents[id as usize].0 & FREE != 0
                || wide.left != BvhNode::zeros()
                || wide.right != BvhNode::zeros()
            {
                return Err("duplicate or nonzero BVH free slot");
            }
            self.parents[id as usize].0 |= FREE;
        }
        for (id, wide) in self.nodes.iter().enumerate() {
            if wide.left == BvhNode::zeros()
                && wide.right == BvhNode::zeros()
                && self.parents[id].0 & FREE == 0
            {
                return Err("unlisted zero BVH slot");
            }
        }
        let root_count = total(&self.nodes[0])?;
        let (mut id, mut phase, mut leaves) = (0usize, 0u8, 0usize);
        let mut steps = 0usize;
        let maximum_steps = self.nodes.len().checked_mul(3).ok_or("invalid BVH size")?;
        loop {
            steps += 1;
            if steps > maximum_steps {
                return Err("cyclic BVH traversal");
            }
            if phase == 0 {
                if self.parents[id].0 & TAGS != 0 {
                    return Err("duplicate, cyclic or free BVH child");
                }
                self.parents[id].0 |= VISITED;
                let wide = &self.nodes[id];
                let count = total(wide)?;
                if count == 0 {
                    return Err("empty reachable BVH slot");
                }
                for (right, node) in [(false, &wide.left), (true, &wide.right)] {
                    let n = node.data.leaf_count();
                    if n == 0 {
                        if id == 0 && right && count == 1 && *node == BvhNode::zeros() {
                            continue;
                        }
                        return Err("invalid empty BVH child");
                    }
                    let index = BvhNodeIndex::new(id as u32, right);
                    if n == 1 {
                        if self.leaf_node_indices.get(node.children as usize) != Some(&index) {
                            return Err("invalid BVH leaf mapping");
                        }
                        leaves = leaves.checked_add(1).ok_or("invalid BVH leaf count")?;
                    } else {
                        let child_id = node.children as usize;
                        if child_id == 0 {
                            return Err("BVH child points at root");
                        }
                        let child = self.nodes.get(child_id).ok_or("invalid BVH child")?;
                        let parent = self.parents[child_id].0;
                        if parent & TAGS != 0
                            || parent != index.0
                            || total(child)? != n
                            || n >= count
                        {
                            return Err("invalid BVH child/parent/count relation");
                        }
                        // Partial updates may leave ancestor AABBs stale even
                        // without a change flag (margin == 0). Preserve them;
                        // context-specific callers still owe a refit/query barrier.
                    }
                }
            }
            if phase < 2 {
                let node = if phase == 0 {
                    &self.nodes[id].left
                } else {
                    &self.nodes[id].right
                };
                phase += 1;
                if node.data.leaf_count() > 1 {
                    id = node.children as usize;
                    phase = 0;
                }
                continue;
            }
            if id == 0 {
                break;
            }
            let (parent_id, right) = BvhNodeIndex(self.parents[id].0 & !TAGS).decompose();
            id = parent_id;
            phase = if right { 2 } else { 1 };
        }
        if leaves != self.leaf_node_indices.len() || leaves != root_count as usize {
            return Err("invalid BVH root/leaf count");
        }
        // Optimization legitimately retains unreachable retired nodes. Keep
        // their bytes and the free-list order; queries/rebuild use the root.
        for parent in &mut self.parents {
            parent.0 &= !TAGS;
        }
        Ok(self)
    }
}
