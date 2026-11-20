//! Read-only validation of the stored linked adjacency representation.
use super::{EdgeIndex, Graph};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum StoredGraphError {
    WorkLimit,
    InvalidLinks,
}

impl<N, E> Graph<N, E> {
    /// Checks both adjacency directions without following an unchecked pointer,
    /// allocating a visited table, or changing iteration order.
    pub(crate) fn validate_stored_links(
        &self,
        remaining: &mut usize,
    ) -> Result<(), StoredGraphError> {
        fn charge(remaining: &mut usize, amount: usize) -> Result<(), StoredGraphError> {
            *remaining = remaining
                .checked_sub(amount)
                .ok_or(StoredGraphError::WorkLimit)?;
            Ok(())
        }
        if self.nodes.len() >= u32::MAX as usize || self.edges.len() >= u32::MAX as usize {
            return Err(StoredGraphError::InvalidLinks);
        }
        charge(remaining, self.nodes.len())?;
        charge(remaining, self.edges.len())?;
        let valid_edge =
            |edge: EdgeIndex| edge == EdgeIndex::end() || edge.index() < self.edges.len();
        for edge in &self.edges {
            if edge
                .node
                .iter()
                .any(|node| node.index() >= self.nodes.len())
                || edge
                    .next
                    .iter()
                    .chain(&edge.prev)
                    .any(|edge| !valid_edge(*edge))
            {
                return Err(StoredGraphError::InvalidLinks);
            }
        }
        for direction in 0..2 {
            charge(remaining, self.nodes.len())?;
            let mut reached = 0usize;
            for (node_index, node) in self.nodes.iter().enumerate() {
                let mut current = node.next[direction];
                let mut previous = EdgeIndex::end();
                while current != EdgeIndex::end() {
                    charge(remaining, 1)?;
                    reached += 1;
                    // A cycle or a duplicate visit cannot run indefinitely.
                    if reached > self.edges.len() {
                        return Err(StoredGraphError::InvalidLinks);
                    }
                    let edge = self
                        .edges
                        .get(current.index())
                        .ok_or(StoredGraphError::InvalidLinks)?;
                    if edge.node[direction].index() != node_index
                        || edge.prev[direction] != previous
                    {
                        return Err(StoredGraphError::InvalidLinks);
                    }
                    previous = current;
                    current = edge.next[direction];
                }
            }
            // Each edge has exactly one owner in each direction. Reciprocal
            // ownership plus this complete walk also rejects disconnected cycles.
            if reached != self.edges.len() {
                return Err(StoredGraphError::InvalidLinks);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alloc_prelude::*;
    use crate::data::graph::NodeIndex;

    #[test]
    fn stored_graph_links_keep_self_loops_parallel_edges_and_wire_order() {
        let mut graph = Graph::with_capacity(3, 5);
        let a = graph.add_node(1u32);
        let b = graph.add_node(2u32);
        graph.add_node(3u32);
        graph.add_edge(a, a, 10u32);
        graph.add_edge(a, b, 20);
        graph.add_edge(a, b, 30);
        let before = bincode::serialize(&graph).unwrap();
        let mut remaining = 100;
        graph.validate_stored_links(&mut remaining).unwrap();
        assert_eq!(bincode::serialize(&graph).unwrap(), before);
        assert_eq!(
            graph
                .edges(a)
                .map(|edge| *edge.weight())
                .collect::<Vec<_>>(),
            vec![30, 20, 10]
        );
        let restored: Graph<u32, u32> = bincode::deserialize(&before).unwrap();
        restored.validate_stored_links(&mut 100).unwrap();
    }

    #[test]
    fn stored_graph_links_reject_cycles_missing_and_reciprocal_out_of_range_edges() {
        let mut graph = Graph::with_capacity(2, 2);
        let a = graph.add_node(1u32);
        let b = graph.add_node(2u32);
        let e = graph.add_edge(a, b, 1u32);
        let mut bad = graph.clone();
        bad.edges[0].node[0] = NodeIndex::new(9);
        assert_eq!(
            bad.validate_stored_links(&mut 100),
            Err(StoredGraphError::InvalidLinks)
        );
        let mut bad = graph.clone();
        bad.nodes[a.index()].next[0] = EdgeIndex::new(7);
        assert_eq!(
            bad.validate_stored_links(&mut 100),
            Err(StoredGraphError::InvalidLinks)
        );
        let mut bad = graph.clone();
        bad.edges[0].prev[0] = e;
        assert_eq!(
            bad.validate_stored_links(&mut 100),
            Err(StoredGraphError::InvalidLinks)
        );
        let mut bad = graph;
        bad.nodes[a.index()].next[0] = EdgeIndex::end();
        bad.edges[0].next[0] = e;
        bad.edges[0].prev[0] = e;
        assert_eq!(
            bad.validate_stored_links(&mut 100),
            Err(StoredGraphError::InvalidLinks)
        );
        assert_eq!(
            bad.validate_stored_links(&mut 1),
            Err(StoredGraphError::WorkLimit)
        );
    }
    #[test]
    fn stored_graph_work_limit_counts_parallel_edges_and_isolated_nodes() {
        let mut graph = Graph::with_capacity(2, 256);
        let a = graph.add_node(0u32);
        let b = graph.add_node(1u32);
        for value in 0..256 {
            graph.add_edge(a, b, value);
        }
        assert_eq!(
            graph.validate_stored_links(&mut 100),
            Err(StoredGraphError::WorkLimit)
        );
        graph.validate_stored_links(&mut 10_000).unwrap();
        for value in 0..1024 {
            graph.add_node(value);
        }
        assert_eq!(
            graph.validate_stored_links(&mut 1_000),
            Err(StoredGraphError::WorkLimit)
        );
        graph.validate_stored_links(&mut 10_000).unwrap();
    }
}
