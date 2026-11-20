// Ferrum2D modified source; see FERRUM-PATCHES.md.
use super::Bvh;
use crate::bounding_volume::Aabb;

fn valid(aabb: &Aabb) -> bool {
    aabb.mins.is_finite() && aabb.maxs.is_finite() && aabb.mins.cmple(aabb.maxs).all()
}
fn contains(outer: &Aabb, inner: &Aabb) -> bool {
    valid(outer)
        && valid(inner)
        && outer.mins.cmple(inner.mins).all()
        && outer.maxs.cmpge(inner.maxs).all()
}
impl Bvh {
    // Immutable shape trees have contiguous geometry IDs and no pending refit,
    // free slots or retired optimization nodes. Generic dynamic BVHs may have
    // those states, so this is a separate context check after checked Decode.
    pub(crate) fn validate_geometry(
        &self,
        leaves: usize,
        mut bounds: impl FnMut(u32) -> Result<Aabb, &'static str>,
    ) -> Result<(), &'static str> {
        let required = if leaves == 0 {
            0
        } else {
            leaves.saturating_sub(1).max(1)
        };
        if leaves > 0x3fff_ffff
            || self.nodes.len() != required
            || self.leaf_node_indices.len() != leaves
            || !self.free_wide_nodes.is_empty()
        {
            return Err("invalid immutable geometry BVH storage");
        }
        for id in 0..leaves {
            let index = self
                .leaf_node_indices
                .get(id)
                .ok_or("missing geometry BVH leaf")?;
            let (wide, right) = index.decompose();
            let wide = self
                .nodes
                .get(wide)
                .ok_or("invalid geometry BVH leaf index")?;
            let node = if right { &wide.right } else { &wide.left };
            if node.data.leaf_count() != 1
                || node.children as usize != id
                || !contains(&node.aabb(), &bounds(id as u32)?)
            {
                return Err("geometry BVH leaf does not cover its shape");
            }
        }
        for wide in self.nodes.iter() {
            for node in [&wide.left, &wide.right] {
                if node.data.leaf_count() > 1 {
                    let child = self
                        .nodes
                        .get(node.children as usize)
                        .ok_or("invalid geometry BVH child")?;
                    if !contains(&node.aabb(), &child.left.aabb())
                        || !contains(&node.aabb(), &child.right.aabb())
                    {
                        return Err("geometry BVH needs a refit");
                    }
                }
            }
        }
        Ok(())
    }
}
