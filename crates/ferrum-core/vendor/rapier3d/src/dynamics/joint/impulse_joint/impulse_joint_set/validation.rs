use super::ImpulseJointSet;
use crate::data::{Index, graph::NodeIndex};
use crate::dynamics::{RigidBodyHandle, RigidBodySet};
use crate::geometry::stored_references::{ReferenceBudget, StoredReferenceError};

impl ImpulseJointSet {
    pub(crate) fn validate_references(
        &self,
        bodies: &RigidBodySet,
        budget: &mut ReferenceBudget,
    ) -> Result<(), StoredReferenceError> {
        let invalid = StoredReferenceError::JointGraph;
        let graph = &self.joint_graph.graph;
        budget.graph(graph)?;
        budget.charge(graph.nodes.len())?;
        budget.charge(graph.edges.len())?;
        budget.charge(self.joint_ids.capacity())?;
        let indices = self.rb_graph_ids.stored_entries();
        budget.charge(indices.len())?;
        for (slot, &(generation, index)) in indices.iter().enumerate() {
            let handle = RigidBodyHandle(Index::from_raw_parts(
                u32::try_from(slot).map_err(|_| invalid)?,
                generation,
            ));
            if generation == u32::MAX && !bodies.contains(handle) {
                continue;
            }
            if !bodies.contains(handle)
                || index != NodeIndex::end()
                    && graph
                        .nodes
                        .get(index.index())
                        .is_none_or(|node| node.weight != handle)
            {
                return Err(invalid);
            }
        }
        for (index, node) in graph.nodes.iter().enumerate() {
            if !bodies.contains(node.weight)
                || self
                    .rb_graph_ids
                    .get(node.weight.0)
                    .is_none_or(|reverse| reverse.index() != index)
            {
                return Err(invalid);
            }
        }
        for (handle, index) in self.joint_ids.iter() {
            if graph
                .edges
                .get(index.index())
                .is_none_or(|edge| edge.weight.handle.0 != handle)
            {
                return Err(invalid);
            }
        }
        for (index, edge) in graph.edges.iter().enumerate() {
            let joint = &edge.weight;
            if self
                .joint_ids
                .get(joint.handle.0)
                .is_none_or(|reverse| reverse.index() != index)
                || joint.body1 != graph.nodes[edge.source().index()].weight
                || joint.body2 != graph.nodes[edge.target().index()].weight
            {
                return Err(invalid);
            }
        }
        // Wake/join queues intentionally retain old generations after a body or
        // just-created joint is removed. Their consumers use generational gets;
        // only impossible raw slots are rejected here, without sorting history.
        budget.charge(
            self.to_wake_up
                .capacity()
                .checked_mul(2)
                .and_then(|n| n.checked_add(1))
                .ok_or(StoredReferenceError::WorkLimit)?,
        )?;
        budget.charge(
            self.to_join
                .capacity()
                .checked_mul(2)
                .and_then(|n| n.checked_add(1))
                .ok_or(StoredReferenceError::WorkLimit)?,
        )?;
        for handle in self
            .to_wake_up
            .iter()
            .chain(self.to_join.iter().flat_map(|(a, b)| [a, b]))
        {
            if handle.into_raw_parts().0 as usize >= bodies.bodies.capacity() {
                return Err(invalid);
            }
        }
        Ok(())
    }
}

#[cfg(all(test, feature = "dim3", feature = "f32"))]
mod tests {
    use super::*;
    use crate::geometry::stored_references::tests::{limits, scene};
    use crate::geometry::validate_stored_references;

    #[test]
    fn stored_references_joint_arena_and_graph_maps_must_be_reciprocal() {
        let mut world = scene();
        let body1 = world.bodies.iter().next().unwrap().0;
        let body2 = world.bodies.iter().nth(1).unwrap().0;
        let joint = world.impulse_joints.insert(
            body1,
            body2,
            crate::dynamics::FixedJointBuilder::new(),
            false,
        );
        validate_stored_references(&world, limits()).unwrap();
        let index = *world.impulse_joints.joint_ids.get(joint.0).unwrap();
        world.impulse_joints.joint_graph.graph.edges[index.index()]
            .weight
            .body1 = RigidBodyHandle::invalid();
        assert_eq!(
            validate_stored_references(&world, limits()),
            Err(StoredReferenceError::JointGraph)
        );
    }
    #[test]
    fn stored_references_joint_removal_and_body_slot_reuse_keep_lazy_wake_queues() {
        let mut world = scene();
        let body1 = world.bodies.iter().next().unwrap().0;
        let body2 = world.bodies.iter().nth(1).unwrap().0;
        let joint = world.impulse_joints.insert(
            body1,
            body2,
            crate::dynamics::FixedJointBuilder::new(),
            true,
        );
        validate_stored_references(&world, limits()).unwrap();
        world.impulse_joints.remove(joint, true).unwrap();
        validate_stored_references(&world, limits()).unwrap();
        world.impulse_joints.insert(
            body1,
            body2,
            crate::dynamics::FixedJointBuilder::new(),
            true,
        );
        world.remove_body(body2).unwrap();
        let fresh = world.insert_body(crate::dynamics::RigidBodyBuilder::dynamic());
        assert_eq!(fresh.into_raw_parts().0, body2.into_raw_parts().0);
        let bytes = bincode::serialize(&world).unwrap();
        validate_stored_references(&world, limits()).unwrap();
        assert_eq!(bincode::serialize(&world).unwrap(), bytes);
        let mut expected: crate::pipeline::PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        world.step();
        expected.step();
        validate_stored_references(&world, limits()).unwrap();
        assert_eq!(
            bincode::serialize(&world).unwrap(),
            bincode::serialize(&expected).unwrap()
        );
    }
}
