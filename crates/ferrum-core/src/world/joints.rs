use super::{JointIncidentCount, World};
use crate::components::{
    DistanceJoint, DistanceJointId, GearJoint, GearJointId, PrismaticJoint, PrismaticJointId,
    PulleyJoint, PulleyJointId, RevoluteJoint, RevoluteJointId, RopeJoint, RopeJointId,
    SpringJoint, SpringJointId, WeldJoint, WeldJointId,
};
use crate::entity::Entity;

impl World {
    /// Adds a distance joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_distance_joint`] when endpoint validity is recoverable input.
    pub fn add_distance_joint(&mut self, joint: DistanceJoint) -> DistanceJointId {
        self.try_add_distance_joint(joint)
            .expect("distance joint endpoints must reference current entities")
    }

    /// Adds a distance joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_distance_joint(&mut self, joint: DistanceJoint) -> Option<DistanceJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.distance_joint_free_list.pop() {
            let index = index as usize;
            self.distance_joints[index] = Some(joint);
            DistanceJointId {
                index: index as u32,
                generation: self.distance_joint_generations[index],
            }
        } else {
            let index = self.distance_joints.len();
            self.distance_joints.push(Some(joint));
            self.distance_joint_generations.push(0);
            reserve_joint_free_list_capacity(
                &self.distance_joints,
                &mut self.distance_joint_free_list,
            );
            DistanceJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn distance_joint(&self, id: DistanceJointId) -> Option<DistanceJoint> {
        let index = self.valid_distance_joint_index(id)?;
        self.distance_joints[index]
    }

    /// Replaces a distance joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use
    /// [`World::try_set_distance_joint`] when the result must be observed.
    pub fn set_distance_joint(&mut self, id: DistanceJointId, joint: DistanceJoint) {
        let _ = self.try_set_distance_joint(id, joint);
    }

    /// Tries to replace a distance joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_distance_joint(&mut self, id: DistanceJointId, joint: DistanceJoint) -> bool {
        let Some(index) = self.valid_distance_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.distance_joints[index] else {
            return false;
        };
        self.distance_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_distance_joint(&mut self, id: DistanceJointId) -> Option<DistanceJoint> {
        let index = self.valid_distance_joint_index(id)?;
        let joint = self.distance_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.distance_joint_generations[index] =
            self.distance_joint_generations[index].wrapping_add(1);
        debug_assert!(
            self.distance_joint_free_list.len() < self.distance_joint_free_list.capacity()
        );
        self.distance_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_distance_joints(&mut self) {
        for (index, joint) in self.distance_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.distance_joint_generations[index] =
                    self.distance_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.distance_joint_free_list.len() < self.distance_joint_free_list.capacity()
                );
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

    /// Adds a rope joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_rope_joint`] when endpoint validity is recoverable input.
    pub fn add_rope_joint(&mut self, joint: RopeJoint) -> RopeJointId {
        self.try_add_rope_joint(joint)
            .expect("rope joint endpoints must reference current entities")
    }

    /// Adds a rope joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_rope_joint(&mut self, joint: RopeJoint) -> Option<RopeJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.rope_joint_free_list.pop() {
            let index = index as usize;
            self.rope_joints[index] = Some(joint);
            RopeJointId {
                index: index as u32,
                generation: self.rope_joint_generations[index],
            }
        } else {
            let index = self.rope_joints.len();
            self.rope_joints.push(Some(joint));
            self.rope_joint_generations.push(0);
            reserve_joint_free_list_capacity(&self.rope_joints, &mut self.rope_joint_free_list);
            RopeJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn rope_joint(&self, id: RopeJointId) -> Option<RopeJoint> {
        let index = self.valid_rope_joint_index(id)?;
        self.rope_joints[index]
    }

    /// Replaces a rope joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use [`World::try_set_rope_joint`]
    /// when the result must be observed.
    pub fn set_rope_joint(&mut self, id: RopeJointId, joint: RopeJoint) {
        let _ = self.try_set_rope_joint(id, joint);
    }

    /// Tries to replace a rope joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_rope_joint(&mut self, id: RopeJointId, joint: RopeJoint) -> bool {
        let Some(index) = self.valid_rope_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.rope_joints[index] else {
            return false;
        };
        self.rope_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_rope_joint(&mut self, id: RopeJointId) -> Option<RopeJoint> {
        let index = self.valid_rope_joint_index(id)?;
        let joint = self.rope_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.rope_joint_generations[index] = self.rope_joint_generations[index].wrapping_add(1);
        debug_assert!(self.rope_joint_free_list.len() < self.rope_joint_free_list.capacity());
        self.rope_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_rope_joints(&mut self) {
        for (index, joint) in self.rope_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.rope_joint_generations[index] =
                    self.rope_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.rope_joint_free_list.len() < self.rope_joint_free_list.capacity()
                );
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

    /// Adds a spring joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_spring_joint`] when endpoint validity is recoverable input.
    pub fn add_spring_joint(&mut self, joint: SpringJoint) -> SpringJointId {
        self.try_add_spring_joint(joint)
            .expect("spring joint endpoints must reference current entities")
    }

    /// Adds a spring joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_spring_joint(&mut self, joint: SpringJoint) -> Option<SpringJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.spring_joint_free_list.pop() {
            let index = index as usize;
            self.spring_joints[index] = Some(joint);
            SpringJointId {
                index: index as u32,
                generation: self.spring_joint_generations[index],
            }
        } else {
            let index = self.spring_joints.len();
            self.spring_joints.push(Some(joint));
            self.spring_joint_generations.push(0);
            reserve_joint_free_list_capacity(&self.spring_joints, &mut self.spring_joint_free_list);
            SpringJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn spring_joint(&self, id: SpringJointId) -> Option<SpringJoint> {
        let index = self.valid_spring_joint_index(id)?;
        self.spring_joints[index]
    }

    /// Replaces a spring joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use
    /// [`World::try_set_spring_joint`] when the result must be observed.
    pub fn set_spring_joint(&mut self, id: SpringJointId, joint: SpringJoint) {
        let _ = self.try_set_spring_joint(id, joint);
    }

    /// Tries to replace a spring joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_spring_joint(&mut self, id: SpringJointId, joint: SpringJoint) -> bool {
        let Some(index) = self.valid_spring_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.spring_joints[index] else {
            return false;
        };
        self.spring_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_spring_joint(&mut self, id: SpringJointId) -> Option<SpringJoint> {
        let index = self.valid_spring_joint_index(id)?;
        let joint = self.spring_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.spring_joint_generations[index] = self.spring_joint_generations[index].wrapping_add(1);
        debug_assert!(self.spring_joint_free_list.len() < self.spring_joint_free_list.capacity());
        self.spring_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_spring_joints(&mut self) {
        for (index, joint) in self.spring_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.spring_joint_generations[index] =
                    self.spring_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.spring_joint_free_list.len() < self.spring_joint_free_list.capacity()
                );
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

    /// Adds a pulley joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_pulley_joint`] when endpoint validity is recoverable input.
    pub fn add_pulley_joint(&mut self, joint: PulleyJoint) -> PulleyJointId {
        self.try_add_pulley_joint(joint)
            .expect("pulley joint endpoints must reference current entities")
    }

    /// Adds a pulley joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_pulley_joint(&mut self, joint: PulleyJoint) -> Option<PulleyJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.pulley_joint_free_list.pop() {
            let index = index as usize;
            self.pulley_joints[index] = Some(joint);
            PulleyJointId {
                index: index as u32,
                generation: self.pulley_joint_generations[index],
            }
        } else {
            let index = self.pulley_joints.len();
            self.pulley_joints.push(Some(joint));
            self.pulley_joint_generations.push(0);
            reserve_joint_free_list_capacity(&self.pulley_joints, &mut self.pulley_joint_free_list);
            PulleyJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn pulley_joint(&self, id: PulleyJointId) -> Option<PulleyJoint> {
        let index = self.valid_pulley_joint_index(id)?;
        self.pulley_joints[index]
    }

    /// Replaces a pulley joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use
    /// [`World::try_set_pulley_joint`] when the result must be observed.
    pub fn set_pulley_joint(&mut self, id: PulleyJointId, joint: PulleyJoint) {
        let _ = self.try_set_pulley_joint(id, joint);
    }

    /// Tries to replace a pulley joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_pulley_joint(&mut self, id: PulleyJointId, joint: PulleyJoint) -> bool {
        let Some(index) = self.valid_pulley_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.pulley_joints[index] else {
            return false;
        };
        self.pulley_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_pulley_joint(&mut self, id: PulleyJointId) -> Option<PulleyJoint> {
        let index = self.valid_pulley_joint_index(id)?;
        let joint = self.pulley_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.pulley_joint_generations[index] = self.pulley_joint_generations[index].wrapping_add(1);
        debug_assert!(self.pulley_joint_free_list.len() < self.pulley_joint_free_list.capacity());
        self.pulley_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_pulley_joints(&mut self) {
        for (index, joint) in self.pulley_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.pulley_joint_generations[index] =
                    self.pulley_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.pulley_joint_free_list.len() < self.pulley_joint_free_list.capacity()
                );
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

    /// Adds a revolute joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_revolute_joint`] when endpoint validity is recoverable input.
    pub fn add_revolute_joint(&mut self, joint: RevoluteJoint) -> RevoluteJointId {
        self.try_add_revolute_joint(joint)
            .expect("revolute joint endpoints must reference current entities")
    }

    /// Adds a revolute joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_revolute_joint(&mut self, joint: RevoluteJoint) -> Option<RevoluteJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.revolute_joint_free_list.pop() {
            let index = index as usize;
            self.revolute_joints[index] = Some(joint);
            RevoluteJointId {
                index: index as u32,
                generation: self.revolute_joint_generations[index],
            }
        } else {
            let index = self.revolute_joints.len();
            self.revolute_joints.push(Some(joint));
            self.revolute_joint_generations.push(0);
            reserve_joint_free_list_capacity(
                &self.revolute_joints,
                &mut self.revolute_joint_free_list,
            );
            RevoluteJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn revolute_joint(&self, id: RevoluteJointId) -> Option<RevoluteJoint> {
        let index = self.valid_revolute_joint_index(id)?;
        self.revolute_joints[index]
    }

    /// Replaces a revolute joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use
    /// [`World::try_set_revolute_joint`] when the result must be observed.
    pub fn set_revolute_joint(&mut self, id: RevoluteJointId, joint: RevoluteJoint) {
        let _ = self.try_set_revolute_joint(id, joint);
    }

    /// Tries to replace a revolute joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_revolute_joint(&mut self, id: RevoluteJointId, joint: RevoluteJoint) -> bool {
        let Some(index) = self.valid_revolute_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.revolute_joints[index] else {
            return false;
        };
        self.revolute_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_revolute_joint(&mut self, id: RevoluteJointId) -> Option<RevoluteJoint> {
        let index = self.valid_revolute_joint_index(id)?;
        let joint = self.revolute_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.revolute_joint_generations[index] =
            self.revolute_joint_generations[index].wrapping_add(1);
        debug_assert!(
            self.revolute_joint_free_list.len() < self.revolute_joint_free_list.capacity()
        );
        self.revolute_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_revolute_joints(&mut self) {
        for (index, joint) in self.revolute_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.revolute_joint_generations[index] =
                    self.revolute_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.revolute_joint_free_list.len() < self.revolute_joint_free_list.capacity()
                );
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

    /// Adds a prismatic joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_prismatic_joint`] when endpoint validity is recoverable input.
    pub fn add_prismatic_joint(&mut self, joint: PrismaticJoint) -> PrismaticJointId {
        self.try_add_prismatic_joint(joint)
            .expect("prismatic joint endpoints must reference current entities")
    }

    /// Adds a prismatic joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_prismatic_joint(&mut self, joint: PrismaticJoint) -> Option<PrismaticJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.prismatic_joint_free_list.pop() {
            let index = index as usize;
            self.prismatic_joints[index] = Some(joint);
            PrismaticJointId {
                index: index as u32,
                generation: self.prismatic_joint_generations[index],
            }
        } else {
            let index = self.prismatic_joints.len();
            self.prismatic_joints.push(Some(joint));
            self.prismatic_joint_generations.push(0);
            reserve_joint_free_list_capacity(
                &self.prismatic_joints,
                &mut self.prismatic_joint_free_list,
            );
            PrismaticJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn prismatic_joint(&self, id: PrismaticJointId) -> Option<PrismaticJoint> {
        let index = self.valid_prismatic_joint_index(id)?;
        self.prismatic_joints[index]
    }

    /// Replaces a prismatic joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use
    /// [`World::try_set_prismatic_joint`] when the result must be observed.
    pub fn set_prismatic_joint(&mut self, id: PrismaticJointId, joint: PrismaticJoint) {
        let _ = self.try_set_prismatic_joint(id, joint);
    }

    /// Tries to replace a prismatic joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_prismatic_joint(&mut self, id: PrismaticJointId, joint: PrismaticJoint) -> bool {
        let Some(index) = self.valid_prismatic_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.prismatic_joints[index] else {
            return false;
        };
        self.prismatic_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_prismatic_joint(&mut self, id: PrismaticJointId) -> Option<PrismaticJoint> {
        let index = self.valid_prismatic_joint_index(id)?;
        let joint = self.prismatic_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.prismatic_joint_generations[index] =
            self.prismatic_joint_generations[index].wrapping_add(1);
        debug_assert!(
            self.prismatic_joint_free_list.len() < self.prismatic_joint_free_list.capacity()
        );
        self.prismatic_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_prismatic_joints(&mut self) {
        for (index, joint) in self.prismatic_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.prismatic_joint_generations[index] =
                    self.prismatic_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.prismatic_joint_free_list.len()
                        < self.prismatic_joint_free_list.capacity()
                );
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

    /// Adds a weld joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_weld_joint`] when endpoint validity is recoverable input.
    pub fn add_weld_joint(&mut self, joint: WeldJoint) -> WeldJointId {
        self.try_add_weld_joint(joint)
            .expect("weld joint endpoints must reference current entities")
    }

    /// Adds a weld joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_weld_joint(&mut self, joint: WeldJoint) -> Option<WeldJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.weld_joint_free_list.pop() {
            let index = index as usize;
            self.weld_joints[index] = Some(joint);
            WeldJointId {
                index: index as u32,
                generation: self.weld_joint_generations[index],
            }
        } else {
            let index = self.weld_joints.len();
            self.weld_joints.push(Some(joint));
            self.weld_joint_generations.push(0);
            reserve_joint_free_list_capacity(&self.weld_joints, &mut self.weld_joint_free_list);
            WeldJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn weld_joint(&self, id: WeldJointId) -> Option<WeldJoint> {
        let index = self.valid_weld_joint_index(id)?;
        self.weld_joints[index]
    }

    /// Replaces a weld joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use [`World::try_set_weld_joint`]
    /// when the result must be observed.
    pub fn set_weld_joint(&mut self, id: WeldJointId, joint: WeldJoint) {
        let _ = self.try_set_weld_joint(id, joint);
    }

    /// Tries to replace a weld joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_weld_joint(&mut self, id: WeldJointId, joint: WeldJoint) -> bool {
        let Some(index) = self.valid_weld_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.weld_joints[index] else {
            return false;
        };
        self.weld_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_weld_joint(&mut self, id: WeldJointId) -> Option<WeldJoint> {
        let index = self.valid_weld_joint_index(id)?;
        let joint = self.weld_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.weld_joint_generations[index] = self.weld_joint_generations[index].wrapping_add(1);
        debug_assert!(self.weld_joint_free_list.len() < self.weld_joint_free_list.capacity());
        self.weld_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_weld_joints(&mut self) {
        for (index, joint) in self.weld_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.weld_joint_generations[index] =
                    self.weld_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.weld_joint_free_list.len() < self.weld_joint_free_list.capacity()
                );
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

    /// Adds a gear joint whose endpoints are both current entities.
    ///
    /// # Panics
    ///
    /// Panics if either endpoint is not alive at its supplied generation. Use
    /// [`World::try_add_gear_joint`] when endpoint validity is recoverable input.
    pub fn add_gear_joint(&mut self, joint: GearJoint) -> GearJointId {
        self.try_add_gear_joint(joint)
            .expect("gear joint endpoints must reference current entities")
    }

    /// Adds a gear joint when both endpoints are current entities.
    ///
    /// Returns `None` without changing joint storage when either endpoint is stale,
    /// dead, or has not been spawned yet.
    pub fn try_add_gear_joint(&mut self, joint: GearJoint) -> Option<GearJointId> {
        let endpoints = (joint.entity_a, joint.entity_b);
        if !self.has_current_joint_endpoints(endpoints.0, endpoints.1) {
            return None;
        }
        let id = if let Some(index) = self.gear_joint_free_list.pop() {
            let index = index as usize;
            self.gear_joints[index] = Some(joint);
            GearJointId {
                index: index as u32,
                generation: self.gear_joint_generations[index],
            }
        } else {
            let index = self.gear_joints.len();
            self.gear_joints.push(Some(joint));
            self.gear_joint_generations.push(0);
            reserve_joint_free_list_capacity(&self.gear_joints, &mut self.gear_joint_free_list);
            GearJointId {
                index: index as u32,
                generation: 0,
            }
        };
        increment_joint_incidents(&mut self.joint_incident_counts, endpoints.0, endpoints.1);
        Some(id)
    }

    pub fn gear_joint(&self, id: GearJointId) -> Option<GearJoint> {
        let index = self.valid_gear_joint_index(id)?;
        self.gear_joints[index]
    }

    /// Replaces a gear joint when its handle and both new endpoints are current.
    ///
    /// Invalid input leaves joint storage unchanged. Use [`World::try_set_gear_joint`]
    /// when the result must be observed.
    pub fn set_gear_joint(&mut self, id: GearJointId, joint: GearJoint) {
        let _ = self.try_set_gear_joint(id, joint);
    }

    /// Tries to replace a gear joint after validating its handle and endpoints.
    ///
    /// Returns `false` without changing joint storage for an invalid joint handle or
    /// endpoint.
    #[must_use = "joint updates can be rejected for stale handles or endpoints"]
    pub fn try_set_gear_joint(&mut self, id: GearJointId, joint: GearJoint) -> bool {
        let Some(index) = self.valid_gear_joint_index(id) else {
            return false;
        };
        if !self.has_current_joint_endpoints(joint.entity_a, joint.entity_b) {
            return false;
        }
        let Some(previous) = self.gear_joints[index] else {
            return false;
        };
        self.gear_joints[index] = Some(joint);
        decrement_joint_incidents(
            &mut self.joint_incident_counts,
            previous.entity_a,
            previous.entity_b,
        );
        increment_joint_incidents(
            &mut self.joint_incident_counts,
            joint.entity_a,
            joint.entity_b,
        );
        true
    }

    pub fn clear_gear_joint(&mut self, id: GearJointId) -> Option<GearJoint> {
        let index = self.valid_gear_joint_index(id)?;
        let joint = self.gear_joints[index].take();
        if let Some(joint) = joint {
            decrement_joint_incidents(
                &mut self.joint_incident_counts,
                joint.entity_a,
                joint.entity_b,
            );
        }
        self.gear_joint_generations[index] = self.gear_joint_generations[index].wrapping_add(1);
        debug_assert!(self.gear_joint_free_list.len() < self.gear_joint_free_list.capacity());
        self.gear_joint_free_list.push(id.index);
        joint
    }

    pub fn clear_gear_joints(&mut self) {
        for (index, joint) in self.gear_joints.iter_mut().enumerate() {
            if let Some(joint) = joint.take() {
                decrement_joint_incidents(
                    &mut self.joint_incident_counts,
                    joint.entity_a,
                    joint.entity_b,
                );
                self.gear_joint_generations[index] =
                    self.gear_joint_generations[index].wrapping_add(1);
                debug_assert!(
                    self.gear_joint_free_list.len() < self.gear_joint_free_list.capacity()
                );
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

    fn has_current_joint_endpoints(&self, entity_a: Entity, entity_b: Entity) -> bool {
        self.is_current_entity(entity_a) && self.is_current_entity(entity_b)
    }

    pub(super) fn has_incident_joints(&self, entity: Entity) -> bool {
        self.joint_incident_counts
            .get(entity.id as usize)
            .is_some_and(|slot| slot.generation == entity.generation && slot.count > 0)
    }

    pub(super) fn reset_joint_incident_count(&mut self, entity: Entity) {
        let index = entity.id as usize;
        let slot = JointIncidentCount {
            generation: entity.generation,
            count: 0,
        };
        if index == self.joint_incident_counts.len() {
            self.joint_incident_counts.push(slot);
        } else if let Some(current) = self.joint_incident_counts.get_mut(index) {
            *current = slot;
        } else {
            debug_assert!(false, "joint incident storage must track every entity slot");
        }
    }

    pub(super) fn rebuild_joint_runtime_state(&mut self) {
        reserve_joint_free_list_capacity(&self.distance_joints, &mut self.distance_joint_free_list);
        reserve_joint_free_list_capacity(&self.rope_joints, &mut self.rope_joint_free_list);
        reserve_joint_free_list_capacity(&self.spring_joints, &mut self.spring_joint_free_list);
        reserve_joint_free_list_capacity(&self.pulley_joints, &mut self.pulley_joint_free_list);
        reserve_joint_free_list_capacity(&self.revolute_joints, &mut self.revolute_joint_free_list);
        reserve_joint_free_list_capacity(
            &self.prismatic_joints,
            &mut self.prismatic_joint_free_list,
        );
        reserve_joint_free_list_capacity(&self.weld_joints, &mut self.weld_joint_free_list);
        reserve_joint_free_list_capacity(&self.gear_joints, &mut self.gear_joint_free_list);

        self.joint_incident_counts.clear();
        self.joint_incident_counts
            .extend(
                self.generations
                    .iter()
                    .copied()
                    .map(|generation| JointIncidentCount {
                        generation,
                        count: 0,
                    }),
            );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.distance_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.rope_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.spring_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.pulley_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.revolute_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.prismatic_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.weld_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
        rebuild_joint_incidents(
            &mut self.joint_incident_counts,
            &self.gear_joints,
            |joint| (joint.entity_a, joint.entity_b),
        );
    }

    pub(super) fn clear_joints_for_entity(&mut self, entity: Entity) {
        clear_joint_storage_for_entity(
            &mut self.distance_joints,
            &mut self.distance_joint_generations,
            &mut self.distance_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        clear_joint_storage_for_entity(
            &mut self.rope_joints,
            &mut self.rope_joint_generations,
            &mut self.rope_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        clear_joint_storage_for_entity(
            &mut self.spring_joints,
            &mut self.spring_joint_generations,
            &mut self.spring_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        clear_joint_storage_for_entity(
            &mut self.pulley_joints,
            &mut self.pulley_joint_generations,
            &mut self.pulley_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        clear_joint_storage_for_entity(
            &mut self.revolute_joints,
            &mut self.revolute_joint_generations,
            &mut self.revolute_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        clear_joint_storage_for_entity(
            &mut self.prismatic_joints,
            &mut self.prismatic_joint_generations,
            &mut self.prismatic_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        clear_joint_storage_for_entity(
            &mut self.weld_joints,
            &mut self.weld_joint_generations,
            &mut self.weld_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        clear_joint_storage_for_entity(
            &mut self.gear_joints,
            &mut self.gear_joint_generations,
            &mut self.gear_joint_free_list,
            &mut self.joint_incident_counts,
            entity,
            |joint| (joint.entity_a, joint.entity_b),
        );
        debug_assert!(!self.has_incident_joints(entity));
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

fn reserve_joint_free_list_capacity<T>(joints: &[Option<T>], free_list: &mut Vec<u32>) {
    if free_list.capacity() < joints.len() {
        free_list.reserve(joints.len().saturating_sub(free_list.len()));
    }
    debug_assert!(free_list.capacity() >= joints.len());
}

fn increment_joint_incidents(
    incident_counts: &mut [JointIncidentCount],
    entity_a: Entity,
    entity_b: Entity,
) {
    increment_joint_incident(incident_counts, entity_a);
    if entity_b != entity_a {
        increment_joint_incident(incident_counts, entity_b);
    }
}

fn increment_joint_incident(incident_counts: &mut [JointIncidentCount], entity: Entity) {
    let Some(slot) = incident_counts.get_mut(entity.id as usize) else {
        return;
    };
    if slot.generation == entity.generation {
        slot.count = slot.count.saturating_add(1);
    }
}

fn decrement_joint_incidents(
    incident_counts: &mut [JointIncidentCount],
    entity_a: Entity,
    entity_b: Entity,
) {
    decrement_joint_incident(incident_counts, entity_a);
    if entity_b != entity_a {
        decrement_joint_incident(incident_counts, entity_b);
    }
}

fn decrement_joint_incident(incident_counts: &mut [JointIncidentCount], entity: Entity) {
    let Some(slot) = incident_counts.get_mut(entity.id as usize) else {
        return;
    };
    if slot.generation == entity.generation {
        debug_assert!(slot.count > 0);
        slot.count = slot.count.saturating_sub(1);
    }
}

fn rebuild_joint_incidents<T>(
    incident_counts: &mut [JointIncidentCount],
    joints: &[Option<T>],
    endpoints: impl Fn(&T) -> (Entity, Entity),
) {
    for joint in joints.iter().flatten() {
        let (entity_a, entity_b) = endpoints(joint);
        increment_joint_incidents(incident_counts, entity_a, entity_b);
    }
}

fn clear_joint_storage_for_entity<T>(
    joints: &mut [Option<T>],
    generations: &mut [u32],
    free_list: &mut Vec<u32>,
    incident_counts: &mut [JointIncidentCount],
    entity: Entity,
    endpoints: impl Fn(&T) -> (Entity, Entity),
) {
    for (index, joint) in joints.iter_mut().enumerate() {
        let Some((entity_a, entity_b)) = joint.as_ref().map(&endpoints) else {
            continue;
        };
        if entity_a != entity && entity_b != entity {
            continue;
        }
        joint.take();
        decrement_joint_incidents(incident_counts, entity_a, entity_b);
        generations[index] = generations[index].wrapping_add(1);
        debug_assert!(free_list.len() < free_list.capacity());
        free_list.push(index as u32);
    }
}
