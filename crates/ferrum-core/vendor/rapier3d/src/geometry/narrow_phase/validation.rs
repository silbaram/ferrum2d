use super::NarrowPhase;
use crate::data::{Index, graph::NodeIndex};
use crate::geometry::stored_references::{ReferenceBudget, ReferenceContext, StoredReferenceError};
use crate::geometry::{BroadPhaseBvh, ColliderHandle, ContactPair, InteractionGraph};

fn pair_key(
    a: ColliderHandle,
    b: ColliderHandle,
) -> Result<(u32, u32, u32, u32), StoredReferenceError> {
    let (a, b) = (a.into_raw_parts(), b.into_raw_parts());
    if a.0 == b.0 {
        return Err(StoredReferenceError::NarrowPhase);
    }
    let (a, b) = if a.0 < b.0 { (a, b) } else { (b, a) };
    Ok((a.0, a.1, b.0, b.1))
}

impl NarrowPhase {
    fn validate_graph_nodes<E>(
        &self,
        graph: &InteractionGraph<ColliderHandle, E>,
        contact: bool,
        context: &ReferenceContext<'_>,
        budget: &mut ReferenceBudget,
    ) -> Result<(), StoredReferenceError> {
        budget.graph(&graph.graph)?;
        budget.charge(graph.graph.nodes.len())?;
        for (index, node) in graph.graph.nodes.iter().enumerate() {
            let indices = self
                .graph_indices
                .get(node.weight.0)
                .ok_or(StoredReferenceError::NarrowPhase)?;
            let reverse = if contact {
                indices.contact_graph_index
            } else {
                indices.intersection_graph_index
            };
            if !context.known(node.weight) || reverse.index() != index {
                return Err(StoredReferenceError::NarrowPhase);
            }
        }
        Ok(())
    }

    pub(crate) fn validate_references(
        &self,
        context: &ReferenceContext<'_>,
        broad_phase: &BroadPhaseBvh,
        budget: &mut ReferenceBudget,
    ) -> Result<(), StoredReferenceError> {
        let invalid = StoredReferenceError::NarrowPhase;
        self.validate_graph_nodes(&self.contact_graph, true, context, budget)?;
        self.validate_graph_nodes(&self.intersection_graph, false, context, budget)?;
        let indices = self.graph_indices.stored_entries();
        budget.charge(indices.len())?;
        for (slot, &(generation, indices)) in indices.iter().enumerate() {
            let handle = ColliderHandle(Index::from_raw_parts(
                u32::try_from(slot).map_err(|_| invalid)?,
                generation,
            ));
            if generation == u32::MAX && !context.known(handle) {
                // Narrowphase growth/removal initializes both fields to end().
                // Unknown-generation queries consume this payload directly.
                if indices != super::ColliderGraphIndices::invalid() {
                    return Err(invalid);
                }
                continue;
            }
            if !context.known(handle) {
                return Err(invalid);
            }
            for (index, graph) in [
                (indices.contact_graph_index, &self.contact_graph.graph.nodes),
                (
                    indices.intersection_graph_index,
                    &self.intersection_graph.graph.nodes,
                ),
            ] {
                if index != NodeIndex::end()
                    && graph
                        .get(index.index())
                        .is_none_or(|node| node.weight != handle)
                {
                    return Err(invalid);
                }
            }
        }
        let edge_count = self
            .contact_graph
            .graph
            .edges
            .len()
            .checked_add(self.intersection_graph.graph.edges.len())
            .ok_or(StoredReferenceError::WorkLimit)?;
        budget.charge(edge_count)?;
        let mut pairs = budget.vector(edge_count)?;
        let mut masks = budget.vector::<u128>(self.body_solver_color_masks.len())?;
        masks.resize(self.body_solver_color_masks.len(), 0);
        budget.charge(self.body_solver_color_masks.len())?;
        // Ferrum2D modified: solver hints are a stored derived cache. Removals
        // mirror them and the next update resizes them, so a stored list is
        // either cleared or aligned with the contact edges.
        let edges = self.contact_graph.graph.edges.len();
        let hints_aligned = self.pair_solver_hints.len() == edges;
        if !hints_aligned && !self.pair_solver_hints.is_empty() {
            return Err(StoredReferenceError::SolverGraph);
        }
        let graph_ready = hints_aligned
            && self.solver_graph_valid
            && self.solver_graph_epoch == context.world.islands.active_set_epoch
            && self.solver_graph_mb_epoch == context.world.multibody_joints.topology_epoch;
        for (edge_index, edge) in self.contact_graph.graph.edges.iter().enumerate() {
            let a = self.contact_graph.graph.nodes[edge.source().index()].weight;
            let b = self.contact_graph.graph.nodes[edge.target().index()].weight;
            let pair = &edge.weight;
            if pair.collider1 != a || pair.collider2 != b {
                return Err(invalid);
            }
            if !broad_phase.has_stored_pair(a, b) {
                return Err(invalid);
            }
            pairs.push(pair_key(a, b)?);
            budget.charge(pair.solver_manifolds().len())?;
            // A stored count is cleared (sleep/deserialization) or the live
            // qualified count; a ready graph holds only selectable pairs.
            let hint = self.pair_solver_hints.get(edge_index).copied().unwrap_or(0);
            let count = hint & super::PAIR_HINT_COUNT_MASK;
            if count != 0 && count != super::pair_qualified_manifold_count(pair) {
                return Err(StoredReferenceError::SolverGraph);
            }
            let selectable = hint & super::PAIR_HINT_DYN_BIT != 0 && count != 0;
            for manifold in pair.solver_manifolds() {
                if graph_ready && manifold.data.graph_pos.is_some() && !selectable {
                    return Err(StoredReferenceError::SolverGraph);
                }
                for (collider, body) in [
                    (a, manifold.data.rigid_body1),
                    (b, manifold.data.rigid_body2),
                ] {
                    if let Some(body) = body {
                        if body.into_raw_parts().0 as usize >= context.bodies.bodies.capacity() {
                            return Err(invalid);
                        }
                        if !context.pending_parent(collider) && context.bodies.get(body).is_none() {
                            return Err(invalid);
                        }
                    }
                    if !context.pending_parent(collider)
                        && context
                            .colliders
                            .get(collider)
                            .and_then(|collider| collider.parent())
                            != body
                    {
                        return Err(invalid);
                    }
                }
                // Solver-body ids are reused only in the same active-set and
                // multibody epochs. On an epoch change maintenance restamps them.
                if self.solver_graph_valid
                    && manifold.data.graph_pos.is_some()
                    && self.solver_graph_epoch == context.world.islands.active_set_epoch
                    && self.solver_graph_mb_epoch == context.world.multibody_joints.topology_epoch
                {
                    for (id, body) in manifold
                        .data
                        .solver_body_ids
                        .into_iter()
                        .zip([manifold.data.rigid_body1, manifold.data.rigid_body2])
                    {
                        let expected = body
                            .and_then(|handle| {
                                context
                                    .bodies
                                    .get(handle)
                                    .map(|body| (handle, body.ids.active_set_id))
                            })
                            .filter(|&(handle, id)| context.active_body(id) == Some(handle))
                            .map_or(u32::MAX, |(_, id)| id);
                        if id != expected {
                            return Err(StoredReferenceError::SolverGraph);
                        }
                    }
                }
            }
            self.validate_pair_color(pair, context, budget, &mut masks)?;
        }
        for edge in &self.intersection_graph.graph.edges {
            let a = self.intersection_graph.graph.nodes[edge.source().index()].weight;
            let b = self.intersection_graph.graph.nodes[edge.target().index()].weight;
            if !broad_phase.has_stored_pair(a, b) {
                return Err(invalid);
            }
            pairs.push(pair_key(a, b)?);
        }
        pairs.sort_unstable();
        if pairs.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(invalid);
        }
        // Clearing a removed collider's graph node can leave extra historical
        // mask bits. Missing bits or two live pairs sharing a color are unsafe;
        // unused extra bits only reserve colors and must not be canonicalized.
        for (expected, stored) in masks.iter().zip(&self.body_solver_color_masks) {
            if expected & stored != *expected {
                return Err(StoredReferenceError::SolverGraph);
            }
        }
        self.validate_solver_references(context, budget, &mut masks)?;
        self.validate_force_references(budget)?;
        budget.charge(self.pair_solver_hints.len())?;
        Ok(())
    }

    fn validate_pair_color(
        &self,
        pair: &ContactPair,
        context: &ReferenceContext<'_>,
        budget: &mut ReferenceBudget,
        masks: &mut [u128],
    ) -> Result<(), StoredReferenceError> {
        let Some(rigid) = pair.rigid() else {
            return Ok(());
        };
        let color = rigid.solver_color;
        if color >= 128 {
            return if color == 128 || color == 255 {
                Ok(())
            } else {
                Err(StoredReferenceError::SolverGraph)
            };
        }
        budget.charge(2)?;
        let mut actual = rigid.solver_color_bodies;
        for id in actual {
            if id != u32::MAX {
                if id as usize >= context.bodies.bodies.capacity() {
                    return Err(StoredReferenceError::SolverGraph);
                }
                let mask = masks
                    .get_mut(id as usize)
                    .ok_or(StoredReferenceError::SolverGraph)?;
                if *mask & (1u128 << color) != 0 {
                    return Err(StoredReferenceError::SolverGraph);
                }
                *mask |= 1u128 << color;
            }
        }
        if !context.pending_color(pair.collider1) && !context.pending_color(pair.collider2) {
            let mut expected = [u32::MAX; 2];
            let mut count = 0;
            for collider in [pair.collider1, pair.collider2] {
                if let Some(parent) = context
                    .colliders
                    .get(collider)
                    .and_then(|collider| collider.parent())
                {
                    let body = context
                        .bodies
                        .get(parent)
                        .ok_or(StoredReferenceError::SolverGraph)?;
                    if !body.is_fixed() {
                        expected[count] = parent.into_raw_parts().0;
                        count += 1;
                    }
                }
            }
            actual.sort_unstable();
            expected.sort_unstable();
            if actual != expected {
                return Err(StoredReferenceError::SolverGraph);
            }
        }
        Ok(())
    }

    fn validate_solver_references(
        &self,
        context: &ReferenceContext<'_>,
        budget: &mut ReferenceBudget,
        actual_body_colors: &mut [u128],
    ) -> Result<(), StoredReferenceError> {
        use crate::dynamics::solver::solver_contact_graph::{GENERIC_BUCKET, GraphPos};
        let buckets = self.solver_contact_graph.stored_buckets();
        budget.charge(buckets.len())?;
        if !(buckets.len() == GENERIC_BUCKET as usize + 1
            || !self.solver_graph_valid && buckets.is_empty())
        {
            return Err(StoredReferenceError::SolverGraph);
        }
        if self.solver_graph_valid {
            // Reuse only our scratch, never the persisted color masks. Charge
            // the complete zeroing pass before initializing the body slots.
            budget.charge(actual_body_colors.len())?;
            actual_body_colors.fill(0);
        }
        for (bucket, contacts) in buckets.iter().enumerate() {
            budget.charge(contacts.len())?;
            if contacts.len() > 1 << 22 {
                return Err(StoredReferenceError::SolverGraph);
            }
            if !self.solver_graph_valid {
                continue;
            }
            for (local, reference) in contacts.iter().enumerate() {
                let pair = &self
                    .contact_graph
                    .graph
                    .edges
                    .get(reference.edge as usize)
                    .ok_or(StoredReferenceError::SolverGraph)?
                    .weight;
                let manifold = pair
                    .solver_manifolds()
                    .get(reference.manifold as usize)
                    .ok_or(StoredReferenceError::SolverGraph)?;
                if manifold.data.graph_pos != GraphPos::new(bucket as u16, local as u32)
                    || bucket < GENERIC_BUCKET as usize
                        && manifold.data.solver_color as usize != bucket
                {
                    return Err(StoredReferenceError::SolverGraph);
                }
                if bucket < 128 {
                    // Only the first qualifying manifold may use the pair's
                    // parallel color. Further manifolds go to overflow; generic
                    // and overflow buckets regroup shared bodies separately.
                    if pair.solver_color() as usize != bucket {
                        return Err(StoredReferenceError::SolverGraph);
                    }
                    budget.charge(2)?;
                    for handle in [manifold.data.rigid_body1, manifold.data.rigid_body2]
                        .into_iter()
                        .flatten()
                    {
                        let Some(body) = context.bodies.get(handle) else {
                            continue;
                        };
                        if !body.is_dynamic() {
                            continue;
                        }
                        // A type change can leave an old non-dynamic side with
                        // a real frontier slot. Only an exactly queued TYPE
                        // change may defer this check: user-change processing
                        // releases/reassigns its pair colors before consumption.
                        if body
                            .changes
                            .contains(crate::dynamics::RigidBodyChanges::TYPE)
                        {
                            budget.charge(context.bodies.modified_bodies.len())?;
                            if context.bodies.modified_bodies.contains(&handle) {
                                continue;
                            }
                        }
                        let mask = actual_body_colors
                            .get_mut(handle.into_raw_parts().0 as usize)
                            .ok_or(StoredReferenceError::SolverGraph)?;
                        let bit = 1u128 << bucket;
                        if *mask & bit != 0 {
                            return Err(StoredReferenceError::SolverGraph);
                        }
                        *mask |= bit;
                    }
                }
            }
        }
        if self.solver_graph_valid {
            budget.charge(self.contact_graph.graph.edges.len())?;
            for (edge, pair) in self.contact_graph.graph.edges.iter().enumerate() {
                budget.charge(pair.weight.solver_manifolds().len())?;
                for (ordinal, manifold) in pair.weight.solver_manifolds().iter().enumerate() {
                    let position = manifold.data.graph_pos;
                    if position.is_some() {
                        let reference = buckets
                            .get(position.bucket() as usize)
                            .and_then(|bucket| bucket.get(position.local() as usize))
                            .ok_or(StoredReferenceError::SolverGraph)?;
                        if reference.edge as usize != edge || reference.manifold as usize != ordinal
                        {
                            return Err(StoredReferenceError::SolverGraph);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn validate_force_references(
        &self,
        budget: &mut ReferenceBudget,
    ) -> Result<(), StoredReferenceError> {
        budget.charge(self.force_event_pairs.len())?;
        budget.charge(self.force_event_pos.len())?;
        budget.charge(self.force_event_flagged.len())?;
        if self.force_list_valid
            && self.force_event_pos.len() != self.contact_graph.graph.edges.len()
        {
            return Err(StoredReferenceError::SolverGraph);
        }
        // Even an invalidated list participates in pair-removal fixups before
        // the rebuild; bounds and its own inverse are always required.
        for (position, &edge) in self.force_event_pairs.iter().enumerate() {
            if self.force_event_pos.get(edge as usize).copied()
                != Some(u32::try_from(position).map_err(|_| StoredReferenceError::SolverGraph)?)
                || self.force_list_valid && edge as usize >= self.contact_graph.graph.edges.len()
            {
                return Err(StoredReferenceError::SolverGraph);
            }
        }
        for (edge, &position) in self.force_event_pos.iter().enumerate() {
            if position != u32::MAX
                && self.force_event_pairs.get(position as usize).copied()
                    != Some(u32::try_from(edge).map_err(|_| StoredReferenceError::SolverGraph)?)
            {
                return Err(StoredReferenceError::SolverGraph);
            }
        }
        Ok(())
    }
}

#[cfg(all(test, feature = "dim3", feature = "f32"))]
mod tests;
