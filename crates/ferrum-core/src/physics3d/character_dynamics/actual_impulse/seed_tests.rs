//! Test-only view of the actual immediately preceding successful solve.
//! A body is returned only when that exact input row referenced its cached node.
use super::*;

impl Scratch {
    pub(in crate::physics3d) fn test_solved_row_seed(
        &self,
        row: usize,
        body: BodyId,
    ) -> Option<(rp::Vector, rp::Vector)> {
        let row = self.rows.get(row)?;
        [Some(row.a), row.b]
            .into_iter()
            .flatten()
            .map(|index| &self.nodes[index])
            .find(|node| node.id == body)
            .map(|node| (node.initial_linear, node.initial_angular))
    }
}
