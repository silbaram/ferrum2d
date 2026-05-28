use super::World;
use crate::components::{
    DistanceJoint, DistanceJointId, GearJoint, GearJointId, PrismaticJoint, PrismaticJointId,
    PulleyJoint, PulleyJointId, RevoluteJoint, RevoluteJointId, RopeJoint, RopeJointId,
    SpringJoint, SpringJointId, WeldJoint, WeldJointId,
};

impl World {
    pub fn add_distance_joint(&mut self, joint: DistanceJoint) -> DistanceJointId {
        if let Some(index) = self.distance_joint_free_list.pop() {
            let index = index as usize;
            self.distance_joints[index] = Some(joint);
            return DistanceJointId {
                index: index as u32,
                generation: self.distance_joint_generations[index],
            };
        }

        let index = self.distance_joints.len();
        self.distance_joints.push(Some(joint));
        self.distance_joint_generations.push(0);
        DistanceJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn distance_joint(&self, id: DistanceJointId) -> Option<DistanceJoint> {
        let index = self.valid_distance_joint_index(id)?;
        self.distance_joints[index]
    }

    pub fn set_distance_joint(&mut self, id: DistanceJointId, joint: DistanceJoint) {
        let Some(index) = self.valid_distance_joint_index(id) else {
            return;
        };
        self.distance_joints[index] = Some(joint);
    }

    pub fn clear_distance_joint(&mut self, id: DistanceJointId) -> Option<DistanceJoint> {
        let index = self.valid_distance_joint_index(id)?;
        let joint = self.distance_joints[index].take();
        self.distance_joint_generations[index] =
            self.distance_joint_generations[index].wrapping_add(1);
        self.distance_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_distance_joints(&mut self) {
        for (index, joint) in self.distance_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.distance_joint_generations[index] =
                    self.distance_joint_generations[index].wrapping_add(1);
                self.distance_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn distance_joint_count(&self) -> usize {
        self.distance_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_rope_joint(&mut self, joint: RopeJoint) -> RopeJointId {
        if let Some(index) = self.rope_joint_free_list.pop() {
            let index = index as usize;
            self.rope_joints[index] = Some(joint);
            return RopeJointId {
                index: index as u32,
                generation: self.rope_joint_generations[index],
            };
        }

        let index = self.rope_joints.len();
        self.rope_joints.push(Some(joint));
        self.rope_joint_generations.push(0);
        RopeJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn rope_joint(&self, id: RopeJointId) -> Option<RopeJoint> {
        let index = self.valid_rope_joint_index(id)?;
        self.rope_joints[index]
    }

    pub fn set_rope_joint(&mut self, id: RopeJointId, joint: RopeJoint) {
        let Some(index) = self.valid_rope_joint_index(id) else {
            return;
        };
        self.rope_joints[index] = Some(joint);
    }

    pub fn clear_rope_joint(&mut self, id: RopeJointId) -> Option<RopeJoint> {
        let index = self.valid_rope_joint_index(id)?;
        let joint = self.rope_joints[index].take();
        self.rope_joint_generations[index] = self.rope_joint_generations[index].wrapping_add(1);
        self.rope_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_rope_joints(&mut self) {
        for (index, joint) in self.rope_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.rope_joint_generations[index] =
                    self.rope_joint_generations[index].wrapping_add(1);
                self.rope_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn rope_joint_count(&self) -> usize {
        self.rope_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_spring_joint(&mut self, joint: SpringJoint) -> SpringJointId {
        if let Some(index) = self.spring_joint_free_list.pop() {
            let index = index as usize;
            self.spring_joints[index] = Some(joint);
            return SpringJointId {
                index: index as u32,
                generation: self.spring_joint_generations[index],
            };
        }

        let index = self.spring_joints.len();
        self.spring_joints.push(Some(joint));
        self.spring_joint_generations.push(0);
        SpringJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn spring_joint(&self, id: SpringJointId) -> Option<SpringJoint> {
        let index = self.valid_spring_joint_index(id)?;
        self.spring_joints[index]
    }

    pub fn set_spring_joint(&mut self, id: SpringJointId, joint: SpringJoint) {
        let Some(index) = self.valid_spring_joint_index(id) else {
            return;
        };
        self.spring_joints[index] = Some(joint);
    }

    pub fn clear_spring_joint(&mut self, id: SpringJointId) -> Option<SpringJoint> {
        let index = self.valid_spring_joint_index(id)?;
        let joint = self.spring_joints[index].take();
        self.spring_joint_generations[index] = self.spring_joint_generations[index].wrapping_add(1);
        self.spring_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_spring_joints(&mut self) {
        for (index, joint) in self.spring_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.spring_joint_generations[index] =
                    self.spring_joint_generations[index].wrapping_add(1);
                self.spring_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn spring_joint_count(&self) -> usize {
        self.spring_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_pulley_joint(&mut self, joint: PulleyJoint) -> PulleyJointId {
        if let Some(index) = self.pulley_joint_free_list.pop() {
            let index = index as usize;
            self.pulley_joints[index] = Some(joint);
            return PulleyJointId {
                index: index as u32,
                generation: self.pulley_joint_generations[index],
            };
        }

        let index = self.pulley_joints.len();
        self.pulley_joints.push(Some(joint));
        self.pulley_joint_generations.push(0);
        PulleyJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn pulley_joint(&self, id: PulleyJointId) -> Option<PulleyJoint> {
        let index = self.valid_pulley_joint_index(id)?;
        self.pulley_joints[index]
    }

    pub fn set_pulley_joint(&mut self, id: PulleyJointId, joint: PulleyJoint) {
        let Some(index) = self.valid_pulley_joint_index(id) else {
            return;
        };
        self.pulley_joints[index] = Some(joint);
    }

    pub fn clear_pulley_joint(&mut self, id: PulleyJointId) -> Option<PulleyJoint> {
        let index = self.valid_pulley_joint_index(id)?;
        let joint = self.pulley_joints[index].take();
        self.pulley_joint_generations[index] = self.pulley_joint_generations[index].wrapping_add(1);
        self.pulley_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_pulley_joints(&mut self) {
        for (index, joint) in self.pulley_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.pulley_joint_generations[index] =
                    self.pulley_joint_generations[index].wrapping_add(1);
                self.pulley_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn pulley_joint_count(&self) -> usize {
        self.pulley_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_revolute_joint(&mut self, joint: RevoluteJoint) -> RevoluteJointId {
        if let Some(index) = self.revolute_joint_free_list.pop() {
            let index = index as usize;
            self.revolute_joints[index] = Some(joint);
            return RevoluteJointId {
                index: index as u32,
                generation: self.revolute_joint_generations[index],
            };
        }

        let index = self.revolute_joints.len();
        self.revolute_joints.push(Some(joint));
        self.revolute_joint_generations.push(0);
        RevoluteJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn revolute_joint(&self, id: RevoluteJointId) -> Option<RevoluteJoint> {
        let index = self.valid_revolute_joint_index(id)?;
        self.revolute_joints[index]
    }

    pub fn set_revolute_joint(&mut self, id: RevoluteJointId, joint: RevoluteJoint) {
        let Some(index) = self.valid_revolute_joint_index(id) else {
            return;
        };
        self.revolute_joints[index] = Some(joint);
    }

    pub fn clear_revolute_joint(&mut self, id: RevoluteJointId) -> Option<RevoluteJoint> {
        let index = self.valid_revolute_joint_index(id)?;
        let joint = self.revolute_joints[index].take();
        self.revolute_joint_generations[index] =
            self.revolute_joint_generations[index].wrapping_add(1);
        self.revolute_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_revolute_joints(&mut self) {
        for (index, joint) in self.revolute_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.revolute_joint_generations[index] =
                    self.revolute_joint_generations[index].wrapping_add(1);
                self.revolute_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn revolute_joint_count(&self) -> usize {
        self.revolute_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_prismatic_joint(&mut self, joint: PrismaticJoint) -> PrismaticJointId {
        if let Some(index) = self.prismatic_joint_free_list.pop() {
            let index = index as usize;
            self.prismatic_joints[index] = Some(joint);
            return PrismaticJointId {
                index: index as u32,
                generation: self.prismatic_joint_generations[index],
            };
        }

        let index = self.prismatic_joints.len();
        self.prismatic_joints.push(Some(joint));
        self.prismatic_joint_generations.push(0);
        PrismaticJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn prismatic_joint(&self, id: PrismaticJointId) -> Option<PrismaticJoint> {
        let index = self.valid_prismatic_joint_index(id)?;
        self.prismatic_joints[index]
    }

    pub fn set_prismatic_joint(&mut self, id: PrismaticJointId, joint: PrismaticJoint) {
        let Some(index) = self.valid_prismatic_joint_index(id) else {
            return;
        };
        self.prismatic_joints[index] = Some(joint);
    }

    pub fn clear_prismatic_joint(&mut self, id: PrismaticJointId) -> Option<PrismaticJoint> {
        let index = self.valid_prismatic_joint_index(id)?;
        let joint = self.prismatic_joints[index].take();
        self.prismatic_joint_generations[index] =
            self.prismatic_joint_generations[index].wrapping_add(1);
        self.prismatic_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_prismatic_joints(&mut self) {
        for (index, joint) in self.prismatic_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.prismatic_joint_generations[index] =
                    self.prismatic_joint_generations[index].wrapping_add(1);
                self.prismatic_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn prismatic_joint_count(&self) -> usize {
        self.prismatic_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_weld_joint(&mut self, joint: WeldJoint) -> WeldJointId {
        if let Some(index) = self.weld_joint_free_list.pop() {
            let index = index as usize;
            self.weld_joints[index] = Some(joint);
            return WeldJointId {
                index: index as u32,
                generation: self.weld_joint_generations[index],
            };
        }

        let index = self.weld_joints.len();
        self.weld_joints.push(Some(joint));
        self.weld_joint_generations.push(0);
        WeldJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn weld_joint(&self, id: WeldJointId) -> Option<WeldJoint> {
        let index = self.valid_weld_joint_index(id)?;
        self.weld_joints[index]
    }

    pub fn set_weld_joint(&mut self, id: WeldJointId, joint: WeldJoint) {
        let Some(index) = self.valid_weld_joint_index(id) else {
            return;
        };
        self.weld_joints[index] = Some(joint);
    }

    pub fn clear_weld_joint(&mut self, id: WeldJointId) -> Option<WeldJoint> {
        let index = self.valid_weld_joint_index(id)?;
        let joint = self.weld_joints[index].take();
        self.weld_joint_generations[index] = self.weld_joint_generations[index].wrapping_add(1);
        self.weld_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_weld_joints(&mut self) {
        for (index, joint) in self.weld_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.weld_joint_generations[index] =
                    self.weld_joint_generations[index].wrapping_add(1);
                self.weld_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn weld_joint_count(&self) -> usize {
        self.weld_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    pub fn add_gear_joint(&mut self, joint: GearJoint) -> GearJointId {
        if let Some(index) = self.gear_joint_free_list.pop() {
            let index = index as usize;
            self.gear_joints[index] = Some(joint);
            return GearJointId {
                index: index as u32,
                generation: self.gear_joint_generations[index],
            };
        }

        let index = self.gear_joints.len();
        self.gear_joints.push(Some(joint));
        self.gear_joint_generations.push(0);
        GearJointId {
            index: index as u32,
            generation: 0,
        }
    }

    pub fn gear_joint(&self, id: GearJointId) -> Option<GearJoint> {
        let index = self.valid_gear_joint_index(id)?;
        self.gear_joints[index]
    }

    pub fn set_gear_joint(&mut self, id: GearJointId, joint: GearJoint) {
        let Some(index) = self.valid_gear_joint_index(id) else {
            return;
        };
        self.gear_joints[index] = Some(joint);
    }

    pub fn clear_gear_joint(&mut self, id: GearJointId) -> Option<GearJoint> {
        let index = self.valid_gear_joint_index(id)?;
        let joint = self.gear_joints[index].take();
        self.gear_joint_generations[index] = self.gear_joint_generations[index].wrapping_add(1);
        self.gear_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_gear_joints(&mut self) {
        for (index, joint) in self.gear_joints.iter_mut().enumerate() {
            if joint.take().is_some() {
                self.gear_joint_generations[index] =
                    self.gear_joint_generations[index].wrapping_add(1);
                self.gear_joint_free_list.push(index as u32);
            }
        }
    }

    pub fn gear_joint_count(&self) -> usize {
        self.gear_joints
            .iter()
            .filter(|joint| joint.is_some())
            .count()
    }

    fn valid_distance_joint_index(&self, id: DistanceJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.distance_joints.len()
            && self.distance_joint_generations[index] == id.generation
            && self.distance_joints[index].is_some())
        .then_some(index)
    }

    fn valid_rope_joint_index(&self, id: RopeJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.rope_joints.len()
            && self.rope_joint_generations[index] == id.generation
            && self.rope_joints[index].is_some())
        .then_some(index)
    }

    fn valid_spring_joint_index(&self, id: SpringJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.spring_joints.len()
            && self.spring_joint_generations[index] == id.generation
            && self.spring_joints[index].is_some())
        .then_some(index)
    }

    fn valid_pulley_joint_index(&self, id: PulleyJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.pulley_joints.len()
            && self.pulley_joint_generations[index] == id.generation
            && self.pulley_joints[index].is_some())
        .then_some(index)
    }

    fn valid_revolute_joint_index(&self, id: RevoluteJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.revolute_joints.len()
            && self.revolute_joint_generations[index] == id.generation
            && self.revolute_joints[index].is_some())
        .then_some(index)
    }

    fn valid_prismatic_joint_index(&self, id: PrismaticJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.prismatic_joints.len()
            && self.prismatic_joint_generations[index] == id.generation
            && self.prismatic_joints[index].is_some())
        .then_some(index)
    }

    fn valid_weld_joint_index(&self, id: WeldJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.weld_joints.len()
            && self.weld_joint_generations[index] == id.generation
            && self.weld_joints[index].is_some())
        .then_some(index)
    }

    fn valid_gear_joint_index(&self, id: GearJointId) -> Option<usize> {
        let index = id.index as usize;
        (index < self.gear_joints.len()
            && self.gear_joint_generations[index] == id.generation
            && self.gear_joints[index].is_some())
        .then_some(index)
    }
}
