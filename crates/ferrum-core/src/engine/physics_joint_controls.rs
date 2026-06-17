use wasm_bindgen::prelude::*;

use crate::components::{
    DistanceJoint, DistanceJointId, GearJoint, GearJointId, PrismaticJoint, PrismaticJointId,
    PulleyJoint, PulleyJointId, RevoluteJoint, RevoluteJointId, RopeJoint, RopeJointId,
    SpringJoint, SpringJointId, WeldJoint, WeldJointId,
};

use super::physics_bridge::PhysicsJointSnapshot;
use super::{
    Engine, PHYSICS_JOINT_DISTANCE, PHYSICS_JOINT_GEAR, PHYSICS_JOINT_PRISMATIC,
    PHYSICS_JOINT_PULLEY, PHYSICS_JOINT_REVOLUTE, PHYSICS_JOINT_ROPE, PHYSICS_JOINT_SPRING,
    PHYSICS_JOINT_WELD,
};

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_distance_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        rest_length: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_non_negative(rest_length)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = DistanceJoint::new(entity_a, entity_b, rest_length)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_enabled(enabled);
        let id = self.world.add_distance_joint(joint);
        self.store_distance_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_rope_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        max_length: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_non_negative(max_length)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = RopeJoint::new(entity_a, entity_b, max_length)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_enabled(enabled);
        let id = self.world.add_rope_joint(joint);
        self.store_rope_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_spring_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        rest_length: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_non_negative(rest_length)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = SpringJoint::new(entity_a, entity_b, rest_length)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_enabled(enabled);
        let id = self.world.add_spring_joint(joint);
        self.store_spring_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_pulley_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        ground_anchor_a_x: f32,
        ground_anchor_a_y: f32,
        ground_anchor_b_x: f32,
        ground_anchor_b_y: f32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        rest_length: f32,
        ratio: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        slack: bool,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(ground_anchor_a_x, ground_anchor_a_y)
            || !Self::valid_transform(ground_anchor_b_x, ground_anchor_b_y)
            || !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_non_negative(rest_length)
            || !Self::valid_positive(ratio)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = PulleyJoint::new(entity_a, entity_b, rest_length)
            .with_ground_anchor_a(ground_anchor_a_x, ground_anchor_a_y)
            .with_ground_anchor_b(ground_anchor_b_x, ground_anchor_b_y)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_ratio(ratio)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_slack(slack)
            .with_enabled(enabled);
        let id = self.world.add_pulley_joint(joint);
        self.store_pulley_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_revolute_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        limit_enabled: bool,
        continuous_limit: bool,
        lower_angle: f32,
        upper_angle: f32,
        motor_enabled: bool,
        motor_speed: f32,
        max_motor_torque: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
            || !lower_angle.is_finite()
            || !upper_angle.is_finite()
            || !motor_speed.is_finite()
            || !Self::valid_non_negative(max_motor_torque)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = RevoluteJoint::new(entity_a, entity_b)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_angle_limits(lower_angle, upper_angle)
            .with_angle_limit_enabled(limit_enabled)
            .with_continuous_limit(continuous_limit)
            .with_motor(motor_speed, max_motor_torque)
            .with_motor_enabled(motor_enabled)
            .with_enabled(enabled);
        let id = self.world.add_revolute_joint(joint);
        self.store_revolute_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_prismatic_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        local_axis_a_x: f32,
        local_axis_a_y: f32,
        reference_angle: f32,
        stiffness: f32,
        damping: f32,
        angular_stiffness: f32,
        angular_damping: f32,
        break_distance: f32,
        limit_enabled: bool,
        lower_translation: f32,
        upper_translation: f32,
        motor_enabled: bool,
        motor_speed: f32,
        max_motor_force: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_transform(local_axis_a_x, local_axis_a_y)
            || !reference_angle.is_finite()
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_unit_interval(angular_stiffness)
            || !Self::valid_unit_interval(angular_damping)
            || !Self::valid_break_limit(break_distance)
            || !lower_translation.is_finite()
            || !upper_translation.is_finite()
            || !motor_speed.is_finite()
            || !Self::valid_non_negative(max_motor_force)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = PrismaticJoint::new(entity_a, entity_b)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_local_axis_a(local_axis_a_x, local_axis_a_y)
            .with_reference_angle(reference_angle)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_angular_stiffness(angular_stiffness)
            .with_angular_damping(angular_damping)
            .with_break_distance(break_distance)
            .with_translation_limits(lower_translation, upper_translation)
            .with_translation_limit_enabled(limit_enabled)
            .with_motor(motor_speed, max_motor_force)
            .with_motor_enabled(motor_enabled)
            .with_enabled(enabled);
        let id = self.world.add_prismatic_joint(joint);
        self.store_prismatic_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_weld_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        reference_angle: f32,
        stiffness: f32,
        damping: f32,
        angular_stiffness: f32,
        angular_damping: f32,
        break_distance: f32,
        break_angle: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !reference_angle.is_finite()
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_unit_interval(angular_stiffness)
            || !Self::valid_unit_interval(angular_damping)
            || !Self::valid_break_limit(break_distance)
            || !Self::valid_break_limit(break_angle)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = WeldJoint::new(entity_a, entity_b)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_reference_angle(reference_angle)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_angular_stiffness(angular_stiffness)
            .with_angular_damping(angular_damping)
            .with_break_distance(break_distance)
            .with_break_angle(break_angle)
            .with_enabled(enabled);
        let id = self.world.add_weld_joint(joint);
        self.store_weld_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_gear_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        ratio: f32,
        reference_angle: f32,
        stiffness: f32,
        damping: f32,
        break_angle: f32,
        enabled: bool,
    ) -> bool {
        if !ratio.is_finite()
            || !reference_angle.is_finite()
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_angle)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = GearJoint::new(entity_a, entity_b, ratio)
            .with_reference_angle(reference_angle)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_angle(break_angle)
            .with_enabled(enabled);
        let id = self.world.add_gear_joint(joint);
        self.store_gear_joint_snapshot(id, joint)
    }

    pub fn clear_physics_joint(
        &mut self,
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
    ) -> bool {
        let cleared = match joint_type {
            PHYSICS_JOINT_DISTANCE => self
                .world
                .clear_distance_joint(DistanceJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_ROPE => self
                .world
                .clear_rope_joint(RopeJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_SPRING => self
                .world
                .clear_spring_joint(SpringJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_PULLEY => self
                .world
                .clear_pulley_joint(PulleyJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_REVOLUTE => self
                .world
                .clear_revolute_joint(RevoluteJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_PRISMATIC => self
                .world
                .clear_prismatic_joint(PrismaticJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_WELD => self
                .world
                .clear_weld_joint(WeldJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_GEAR => self
                .world
                .clear_gear_joint(GearJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            _ => false,
        };
        if cleared {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
        }
        cleared
    }

    pub fn set_physics_joint_enabled(
        &mut self,
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
        enabled: bool,
    ) -> bool {
        match joint_type {
            PHYSICS_JOINT_DISTANCE => {
                let id = DistanceJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.distance_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_distance_joint(id, joint);
                self.store_distance_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_ROPE => {
                let id = RopeJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.rope_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_rope_joint(id, joint);
                self.store_rope_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_SPRING => {
                let id = SpringJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.spring_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_spring_joint(id, joint);
                self.store_spring_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_PULLEY => {
                let id = PulleyJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.pulley_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_pulley_joint(id, joint);
                self.store_pulley_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_REVOLUTE => {
                let id = RevoluteJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.revolute_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_revolute_joint(id, joint);
                self.store_revolute_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_PRISMATIC => {
                let id = PrismaticJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.prismatic_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_prismatic_joint(id, joint);
                self.store_prismatic_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_WELD => {
                let id = WeldJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.weld_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_weld_joint(id, joint);
                self.store_weld_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_GEAR => {
                let id = GearJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.gear_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_gear_joint(id, joint);
                self.store_gear_joint_snapshot(id, joint)
            }
            _ => {
                self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                false
            }
        }
    }
}
