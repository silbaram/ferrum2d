use crate::entity::Entity;
use crate::world::World;

use super::{RigidBodyIsland, RigidBodyIslandSchedule};

#[derive(Debug, Default)]
pub(in crate::physics) struct RigidBodyJointIslandBuckets {
    distance: Vec<Vec<usize>>,
    rope: Vec<Vec<usize>>,
    spring: Vec<Vec<usize>>,
    pulley: Vec<Vec<usize>>,
    revolute: Vec<Vec<usize>>,
    prismatic: Vec<Vec<usize>>,
    weld: Vec<Vec<usize>>,
    gear: Vec<Vec<usize>>,
}

impl RigidBodyJointIslandBuckets {
    #[cfg(test)]
    pub(in crate::physics) fn from_world_and_schedule(
        world: &World,
        schedule: &RigidBodyIslandSchedule,
    ) -> Self {
        let mut buckets = Self::default();
        buckets.rebuild_from_world_and_schedule(world, schedule);
        buckets
    }

    pub(in crate::physics) fn rebuild_from_world_and_schedule(
        &mut self,
        world: &World,
        schedule: &RigidBodyIslandSchedule,
    ) {
        self.reset_island_count(schedule.island_count());
        for (index, joint) in world.distance_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_distance(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
        for (index, joint) in world.rope_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_rope(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
        for (index, joint) in world.spring_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_spring(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
        for (index, joint) in world.pulley_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_pulley(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
        for (index, joint) in world.revolute_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_revolute(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
        for (index, joint) in world.prismatic_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_prismatic(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
        for (index, joint) in world.weld_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_weld(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
        for (index, joint) in world.gear_joints.iter().copied().enumerate() {
            let Some(joint) = joint else {
                continue;
            };
            self.push_gear(
                schedule,
                index,
                joint.enabled,
                joint.entity_a,
                joint.entity_b,
            );
        }
    }

    fn reset_island_count(&mut self, island_count: usize) {
        reset_bucket(&mut self.distance, island_count);
        reset_bucket(&mut self.rope, island_count);
        reset_bucket(&mut self.spring, island_count);
        reset_bucket(&mut self.pulley, island_count);
        reset_bucket(&mut self.revolute, island_count);
        reset_bucket(&mut self.prismatic, island_count);
        reset_bucket(&mut self.weld, island_count);
        reset_bucket(&mut self.gear, island_count);
    }

    pub(in crate::physics) fn distance(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.distance, island)
    }

    pub(in crate::physics) fn rope(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.rope, island)
    }

    pub(in crate::physics) fn spring(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.spring, island)
    }

    pub(in crate::physics) fn pulley(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.pulley, island)
    }

    pub(in crate::physics) fn revolute(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.revolute, island)
    }

    pub(in crate::physics) fn prismatic(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.prismatic, island)
    }

    pub(in crate::physics) fn weld(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.weld, island)
    }

    pub(in crate::physics) fn gear(&self, island: RigidBodyIsland) -> &[usize] {
        self.indices_for_island(&self.gear, island)
    }

    fn indices_for_island<'a>(
        &'a self,
        indices_by_island: &'a [Vec<usize>],
        island: RigidBodyIsland,
    ) -> &'a [usize] {
        indices_by_island
            .get(island.slot)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    fn push_distance(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(
            &mut self.distance,
            schedule,
            index,
            enabled,
            entity_a,
            entity_b,
        );
    }

    fn push_rope(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(&mut self.rope, schedule, index, enabled, entity_a, entity_b);
    }

    fn push_spring(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(
            &mut self.spring,
            schedule,
            index,
            enabled,
            entity_a,
            entity_b,
        );
    }

    fn push_pulley(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(
            &mut self.pulley,
            schedule,
            index,
            enabled,
            entity_a,
            entity_b,
        );
    }

    fn push_revolute(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(
            &mut self.revolute,
            schedule,
            index,
            enabled,
            entity_a,
            entity_b,
        );
    }

    fn push_prismatic(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(
            &mut self.prismatic,
            schedule,
            index,
            enabled,
            entity_a,
            entity_b,
        );
    }

    fn push_weld(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(&mut self.weld, schedule, index, enabled, entity_a, entity_b);
    }

    fn push_gear(
        &mut self,
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        Self::push_joint(&mut self.gear, schedule, index, enabled, entity_a, entity_b);
    }

    fn push_joint(
        indices_by_island: &mut [Vec<usize>],
        schedule: &RigidBodyIslandSchedule,
        index: usize,
        enabled: bool,
        entity_a: Entity,
        entity_b: Entity,
    ) {
        if !enabled || entity_a == entity_b {
            return;
        }
        let Some(slot) =
            schedule.root_slot_for_pair_indices(entity_a.id as usize, entity_b.id as usize)
        else {
            return;
        };
        if let Some(indices) = indices_by_island.get_mut(slot) {
            indices.push(index);
        }
    }
}

fn reset_bucket(bucket: &mut Vec<Vec<usize>>, island_count: usize) {
    for indices in bucket.iter_mut() {
        indices.clear();
    }
    if bucket.len() < island_count {
        bucket.resize_with(island_count, Vec::new);
    } else {
        bucket.truncate(island_count);
    }
}
