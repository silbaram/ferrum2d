use super::solver::{should_solve_rigid_contact, RigidContactConstraint};
use super::{
    is_rigid_body_wake_source, is_sleeping_dynamic_rigid_body, rigid_body_is_ready_for_sleep,
    valid_world_entity_index, RigidBodyIslandStats,
};
use crate::collision::{ColliderCollisionManifold, CollisionPair, CollisionSystem};
use crate::components::{RigidBody, RigidBodyType};
use crate::entity::Entity;
use crate::world::World;

mod joint_buckets;
pub(super) use joint_buckets::RigidBodyJointIslandBuckets;

#[derive(Debug, Default)]
pub(super) struct RigidBodyIslandGraph {
    node_for_entity: Vec<Option<usize>>,
    entity_indices: Vec<usize>,
    parents: Vec<usize>,
    sizes: Vec<u32>,
    active: Vec<bool>,
    sleeping: Vec<bool>,
}

#[derive(Debug, Default)]
pub(super) struct RigidBodyIslandSchedule {
    root_for_entity: Vec<Option<usize>>,
    roots: Vec<usize>,
    slot_for_root: Vec<Option<usize>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct RigidBodyIsland {
    root: usize,
    slot: usize,
}

impl RigidBodyIslandGraph {
    pub(super) fn from_world(world: &World) -> Self {
        let mut graph = Self::default();
        graph.rebuild_from_world(world);
        graph
    }

    pub(super) fn rebuild_from_world(&mut self, world: &World) {
        self.node_for_entity.clear();
        self.node_for_entity.resize(world.rigid_bodies.len(), None);
        self.entity_indices.clear();
        self.parents.clear();
        self.sizes.clear();
        self.active.clear();
        self.sleeping.clear();

        for index in 0..world.rigid_bodies.len() {
            let Some(body) = rigid_body_island_candidate(world, index) else {
                continue;
            };
            let node = self.parents.len();
            self.node_for_entity[index] = Some(node);
            self.entity_indices.push(index);
            self.parents.push(node);
            self.sizes.push(1);
            self.active
                .push(body.body_type == RigidBodyType::Kinematic || !body.is_sleeping);
            self.sleeping
                .push(body.body_type == RigidBodyType::Dynamic && body.is_sleeping);
        }
    }

    fn union_entities(&mut self, world: &World, a: Entity, b: Entity) -> bool {
        let Some(a_index) = valid_world_entity_index(world, a) else {
            return false;
        };
        let Some(b_index) = valid_world_entity_index(world, b) else {
            return false;
        };
        let Some(a_node) = self.node_for_entity.get(a_index).copied().flatten() else {
            return false;
        };
        let Some(b_node) = self.node_for_entity.get(b_index).copied().flatten() else {
            return false;
        };

        self.union_nodes(a_node, b_node)
    }

    fn union_nodes(&mut self, a: usize, b: usize) -> bool {
        let mut a_root = self.find_root(a);
        let mut b_root = self.find_root(b);
        if a_root == b_root {
            return false;
        }
        if self.sizes[a_root] < self.sizes[b_root] {
            std::mem::swap(&mut a_root, &mut b_root);
        }

        self.parents[b_root] = a_root;
        self.sizes[a_root] = self.sizes[a_root].saturating_add(self.sizes[b_root]);
        self.active[a_root] = self.active[a_root] || self.active[b_root];
        self.sleeping[a_root] = self.sleeping[a_root] || self.sleeping[b_root];
        true
    }

    fn find_root(&mut self, node: usize) -> usize {
        let parent = self.parents[node];
        if parent == node {
            node
        } else {
            let root = self.find_root(parent);
            self.parents[node] = root;
            root
        }
    }

    pub(super) fn stats(&mut self) -> RigidBodyIslandStats {
        let mut seen_roots = Vec::new();
        self.stats_into(&mut seen_roots)
    }

    pub(super) fn stats_into(&mut self, seen_roots: &mut Vec<bool>) -> RigidBodyIslandStats {
        seen_roots.clear();
        seen_roots.resize(self.parents.len(), false);
        let mut stats = RigidBodyIslandStats::default();

        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            if seen_roots[root] {
                continue;
            }
            seen_roots[root] = true;
            stats.island_count = stats.island_count.saturating_add(1);
            stats.island_bodies = stats.island_bodies.saturating_add(self.sizes[root]);
            stats.largest_island_bodies = stats.largest_island_bodies.max(self.sizes[root]);
            if self.active[root] {
                stats.active_islands = stats.active_islands.saturating_add(1);
            } else if self.sleeping[root] {
                stats.sleeping_islands = stats.sleeping_islands.saturating_add(1);
            }
        }

        stats
    }

    pub(super) fn sleeping_body_indices_in_wake_source_islands_into(
        &mut self,
        world: &World,
        root_has_wake_source: &mut Vec<bool>,
        root_wakes_sleeping_body: &mut Vec<bool>,
        body_indices: &mut Vec<usize>,
    ) -> u32 {
        root_has_wake_source.clear();
        root_has_wake_source.resize(self.parents.len(), false);
        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            let entity_index = self.entity_indices[node];
            if is_rigid_body_wake_source(world, entity_index) {
                root_has_wake_source[root] = true;
            }
        }

        root_wakes_sleeping_body.clear();
        root_wakes_sleeping_body.resize(self.parents.len(), false);
        body_indices.clear();
        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            if !root_has_wake_source[root] {
                continue;
            }
            let entity_index = self.entity_indices[node];
            if is_sleeping_dynamic_rigid_body(world, entity_index) {
                root_wakes_sleeping_body[root] = true;
                body_indices.push(entity_index);
            }
        }
        let islands_woken = root_wakes_sleeping_body
            .iter()
            .filter(|wakes_sleeping_body| **wakes_sleeping_body)
            .count() as u32;

        islands_woken
    }

    pub(super) fn body_indices_ready_for_island_sleep_into(
        &mut self,
        world: &World,
        root_can_sleep: &mut Vec<bool>,
        root_has_candidate: &mut Vec<bool>,
        node_is_candidate: &mut Vec<bool>,
        seen_roots: &mut Vec<bool>,
        body_indices: &mut Vec<usize>,
    ) -> u32 {
        root_can_sleep.clear();
        root_can_sleep.resize(self.parents.len(), true);
        root_has_candidate.clear();
        root_has_candidate.resize(self.parents.len(), false);
        node_is_candidate.clear();
        node_is_candidate.resize(self.parents.len(), false);

        for (node, is_candidate) in node_is_candidate.iter_mut().enumerate() {
            let root = self.find_root(node);
            let entity_index = self.entity_indices[node];
            let Some(body) = world.rigid_bodies.get(entity_index).copied().flatten() else {
                root_can_sleep[root] = false;
                continue;
            };

            match body.body_type {
                RigidBodyType::Static => {
                    root_can_sleep[root] = false;
                }
                RigidBodyType::Kinematic => {
                    root_can_sleep[root] = false;
                }
                RigidBodyType::Dynamic => {
                    if !body.can_sleep {
                        root_can_sleep[root] = false;
                    } else if body.is_sleeping {
                        continue;
                    } else if rigid_body_is_ready_for_sleep(world, entity_index, body) {
                        root_has_candidate[root] = true;
                        *is_candidate = true;
                    } else {
                        root_can_sleep[root] = false;
                    }
                }
            }
        }

        let mut island_count = 0_u32;
        seen_roots.clear();
        seen_roots.resize(self.parents.len(), false);
        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            if seen_roots[root] {
                continue;
            }
            seen_roots[root] = true;
            if root_can_sleep[root] && root_has_candidate[root] {
                island_count = island_count.saturating_add(1);
            }
        }

        body_indices.clear();
        for (node, is_candidate) in node_is_candidate.iter().copied().enumerate() {
            if !is_candidate {
                continue;
            }
            let root = self.find_root(node);
            if root_can_sleep[root] {
                body_indices.push(self.entity_indices[node]);
            }
        }

        island_count
    }
}

impl RigidBodyIslandSchedule {
    #[cfg(test)]
    pub(super) fn from_world_and_contacts(
        world: &World,
        contacts: &[RigidContactConstraint],
    ) -> Self {
        let mut schedule = Self::default();
        let mut graph = RigidBodyIslandGraph::default();
        let mut seen_roots = Vec::new();
        schedule.rebuild_from_world_and_contacts(world, contacts, &mut graph, &mut seen_roots);
        schedule
    }

    pub(super) fn rebuild_from_world_and_contacts(
        &mut self,
        world: &World,
        contacts: &[RigidContactConstraint],
        graph: &mut RigidBodyIslandGraph,
        seen_roots: &mut Vec<bool>,
    ) {
        graph.rebuild_from_world(world);
        union_contact_constraint_islands(world, contacts, graph);
        union_joint_islands(world, graph);

        self.root_for_entity.clear();
        self.root_for_entity.resize(world.rigid_bodies.len(), None);
        self.roots.clear();
        self.slot_for_root.clear();
        self.slot_for_root.resize(graph.parents.len(), None);
        seen_roots.clear();
        seen_roots.resize(graph.parents.len(), false);

        for node in 0..graph.parents.len() {
            let root = graph.find_root(node);
            let entity_index = graph.entity_indices[node];
            if let Some(slot) = self.root_for_entity.get_mut(entity_index) {
                *slot = Some(root);
            }
            if !seen_roots[root] {
                seen_roots[root] = true;
                let slot = self.roots.len();
                self.roots.push(root);
                if let Some(root_slot) = self.slot_for_root.get_mut(root) {
                    *root_slot = Some(slot);
                }
            }
        }
    }

    #[cfg(test)]
    pub(super) fn roots(&self) -> impl Iterator<Item = usize> + '_ {
        self.roots.iter().copied()
    }

    pub(super) fn islands(&self) -> impl Iterator<Item = RigidBodyIsland> + '_ {
        self.roots
            .iter()
            .copied()
            .enumerate()
            .map(|(slot, root)| RigidBodyIsland { root, slot })
    }

    fn island_count(&self) -> usize {
        self.roots.len()
    }

    pub(super) fn contact_in_island(
        &self,
        contact: &RigidContactConstraint,
        island_root: usize,
    ) -> bool {
        self.pair_in_island(contact.pair(), island_root)
    }

    pub(super) fn pair_in_island(&self, pair: CollisionPair, island_root: usize) -> bool {
        self.pair_indices_in_island(pair.a.id as usize, pair.b.id as usize, island_root)
    }

    #[cfg(test)]
    pub(super) fn joint_in_island(
        &self,
        entity_a: Entity,
        entity_b: Entity,
        island_root: usize,
    ) -> bool {
        self.pair_indices_in_island(entity_a.id as usize, entity_b.id as usize, island_root)
    }

    fn pair_indices_in_island(&self, a_index: usize, b_index: usize, island_root: usize) -> bool {
        self.root_for_pair_indices(a_index, b_index)
            .is_some_and(|root| root == island_root)
    }

    pub(super) fn root_for_pair_indices(&self, a_index: usize, b_index: usize) -> Option<usize> {
        match (self.entity_root(a_index), self.entity_root(b_index)) {
            (Some(a_root), Some(b_root)) if a_root == b_root => Some(a_root),
            (Some(a_root), None) => Some(a_root),
            (None, Some(b_root)) => Some(b_root),
            _ => None,
        }
    }

    fn root_slot_for_pair_indices(&self, a_index: usize, b_index: usize) -> Option<usize> {
        self.root_for_pair_indices(a_index, b_index)
            .and_then(|root| self.slot_for_root.get(root).copied().flatten())
    }

    pub(super) fn entity_root(&self, index: usize) -> Option<usize> {
        self.root_for_entity.get(index).copied().flatten()
    }
}

impl RigidBodyIsland {
    pub(super) fn root(self) -> usize {
        self.root
    }
}

fn rigid_body_island_candidate(world: &World, index: usize) -> Option<RigidBody> {
    if !world.alive.get(index).copied().unwrap_or(false) {
        return None;
    }
    let body = world.rigid_bodies.get(index).copied().flatten()?;
    (body.enabled
        && matches!(
            body.body_type,
            RigidBodyType::Dynamic | RigidBodyType::Kinematic
        ))
    .then_some(body)
}

pub(super) fn union_contact_islands(world: &World, graph: &mut RigidBodyIslandGraph) {
    let manifolds = CollisionSystem::build_rigid_collider_manifolds(world);
    union_contact_manifold_islands(world, &manifolds, graph);
}

pub(super) fn union_contact_manifold_islands(
    world: &World,
    manifolds: &[ColliderCollisionManifold],
    graph: &mut RigidBodyIslandGraph,
) {
    for collider_manifold in manifolds {
        let pair = collider_manifold.manifold.pair;
        let a_index = pair.a.id as usize;
        let b_index = pair.b.id as usize;
        if should_solve_rigid_contact(world, a_index, b_index) {
            graph.union_entities(world, pair.a, pair.b);
        }
    }
}

fn union_contact_constraint_islands(
    world: &World,
    contacts: &[RigidContactConstraint],
    graph: &mut RigidBodyIslandGraph,
) {
    for contact in contacts {
        let pair = contact.pair();
        graph.union_entities(world, pair.a, pair.b);
    }
}

pub(super) fn union_joint_islands(world: &World, graph: &mut RigidBodyIslandGraph) {
    for joint in world.distance_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.rope_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.spring_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.pulley_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.revolute_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.prismatic_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.weld_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.gear_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
}

fn union_enabled_joint_island(
    world: &World,
    graph: &mut RigidBodyIslandGraph,
    enabled: bool,
    entity_a: Entity,
    entity_b: Entity,
) {
    if enabled && entity_a != entity_b {
        graph.union_entities(world, entity_a, entity_b);
    }
}
