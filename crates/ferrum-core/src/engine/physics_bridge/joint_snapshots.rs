use crate::components::{
    DistanceJoint, DistanceJointId, GearJoint, GearJointId, PrismaticJoint, PrismaticJointId,
    PulleyJoint, PulleyJointId, RevoluteJoint, RevoluteJointId, RopeJoint, RopeJointId,
    SpringJoint, SpringJointId, WeldJoint, WeldJointId,
};
use crate::entity::Entity;

use super::super::{
    Engine, PHYSICS_JOINT_DISTANCE, PHYSICS_JOINT_GEAR, PHYSICS_JOINT_PRISMATIC,
    PHYSICS_JOINT_PULLEY, PHYSICS_JOINT_REVOLUTE, PHYSICS_JOINT_ROPE, PHYSICS_JOINT_SPRING,
    PHYSICS_JOINT_WELD,
};
use super::snapshot_types::PhysicsJointSnapshot;

impl Engine {
    fn joint_snapshot_base(
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
        entity_a: Entity,
        entity_b: Entity,
        enabled: bool,
    ) -> PhysicsJointSnapshot {
        PhysicsJointSnapshot {
            joint_type,
            joint_index,
            joint_generation,
            entity_a_id: entity_a.id,
            entity_a_generation: entity_a.generation,
            entity_b_id: entity_b.id,
            entity_b_generation: entity_b.generation,
            enabled,
            ..PhysicsJointSnapshot::default()
        }
    }

    pub(in crate::engine) fn store_distance_joint_snapshot(
        &mut self,
        id: DistanceJointId,
        joint: DistanceJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            rest_length: joint.rest_length,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_DISTANCE,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    pub(in crate::engine) fn store_rope_joint_snapshot(
        &mut self,
        id: RopeJointId,
        joint: RopeJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            max_length: joint.max_length,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_ROPE,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    pub(in crate::engine) fn store_spring_joint_snapshot(
        &mut self,
        id: SpringJointId,
        joint: SpringJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            rest_length: joint.rest_length,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_SPRING,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    pub(in crate::engine) fn store_pulley_joint_snapshot(
        &mut self,
        id: PulleyJointId,
        joint: PulleyJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            rest_length: joint.rest_length,
            ratio: joint.ratio,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            ground_anchor_a_x: joint.ground_anchor_a_x,
            ground_anchor_a_y: joint.ground_anchor_a_y,
            ground_anchor_b_x: joint.ground_anchor_b_x,
            ground_anchor_b_y: joint.ground_anchor_b_y,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_PULLEY,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    pub(in crate::engine) fn store_revolute_joint_snapshot(
        &mut self,
        id: RevoluteJointId,
        joint: RevoluteJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            limit_enabled: joint.limit_enabled,
            lower_angle: joint.lower_angle,
            upper_angle: joint.upper_angle,
            motor_enabled: joint.motor_enabled,
            motor_speed: joint.motor_speed,
            max_motor_torque: joint.max_motor_torque,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_REVOLUTE,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    pub(in crate::engine) fn store_prismatic_joint_snapshot(
        &mut self,
        id: PrismaticJointId,
        joint: PrismaticJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            reference_angle: joint.reference_angle,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            angular_stiffness: joint.angular_stiffness,
            angular_damping: joint.angular_damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            local_axis_a_x: joint.local_axis_a_x,
            local_axis_a_y: joint.local_axis_a_y,
            limit_enabled: joint.limit_enabled,
            lower_translation: joint.lower_translation,
            upper_translation: joint.upper_translation,
            motor_enabled: joint.motor_enabled,
            motor_speed: joint.motor_speed,
            max_motor_force: joint.max_motor_force,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_PRISMATIC,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    pub(in crate::engine) fn store_weld_joint_snapshot(
        &mut self,
        id: WeldJointId,
        joint: WeldJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            reference_angle: joint.reference_angle,
            break_distance: joint.break_distance,
            break_angle: joint.break_angle,
            stiffness: joint.stiffness,
            damping: joint.damping,
            angular_stiffness: joint.angular_stiffness,
            angular_damping: joint.angular_damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_WELD,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    pub(in crate::engine) fn store_gear_joint_snapshot(
        &mut self,
        id: GearJointId,
        joint: GearJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            ratio: joint.ratio,
            reference_angle: joint.reference_angle,
            break_angle: joint.break_angle,
            stiffness: joint.stiffness,
            damping: joint.damping,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_GEAR,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }
}
