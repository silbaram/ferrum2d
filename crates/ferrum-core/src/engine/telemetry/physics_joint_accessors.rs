use wasm_bindgen::prelude::*;

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn physics_joint_type(&self) -> u32 {
        self.physics_joint_snapshot.joint_type
    }

    pub fn physics_joint_index(&self) -> u32 {
        self.physics_joint_snapshot.joint_index
    }

    pub fn physics_joint_generation(&self) -> u32 {
        self.physics_joint_snapshot.joint_generation
    }

    pub fn physics_joint_entity_a_id(&self) -> u32 {
        self.physics_joint_snapshot.entity_a_id
    }

    pub fn physics_joint_entity_a_generation(&self) -> u32 {
        self.physics_joint_snapshot.entity_a_generation
    }

    pub fn physics_joint_entity_b_id(&self) -> u32 {
        self.physics_joint_snapshot.entity_b_id
    }

    pub fn physics_joint_entity_b_generation(&self) -> u32 {
        self.physics_joint_snapshot.entity_b_generation
    }

    pub fn physics_joint_rest_length(&self) -> f32 {
        self.physics_joint_snapshot.rest_length
    }

    pub fn physics_joint_max_length(&self) -> f32 {
        self.physics_joint_snapshot.max_length
    }

    pub fn physics_joint_ratio(&self) -> f32 {
        self.physics_joint_snapshot.ratio
    }

    pub fn physics_joint_slack(&self) -> bool {
        self.physics_joint_snapshot.slack
    }

    pub fn physics_joint_reference_angle(&self) -> f32 {
        self.physics_joint_snapshot.reference_angle
    }

    pub fn physics_joint_break_distance(&self) -> f32 {
        self.physics_joint_snapshot.break_distance
    }

    pub fn physics_joint_break_angle(&self) -> f32 {
        self.physics_joint_snapshot.break_angle
    }

    pub fn physics_joint_stiffness(&self) -> f32 {
        self.physics_joint_snapshot.stiffness
    }

    pub fn physics_joint_damping(&self) -> f32 {
        self.physics_joint_snapshot.damping
    }

    pub fn physics_joint_angular_stiffness(&self) -> f32 {
        self.physics_joint_snapshot.angular_stiffness
    }

    pub fn physics_joint_angular_damping(&self) -> f32 {
        self.physics_joint_snapshot.angular_damping
    }

    pub fn physics_joint_local_anchor_a_x(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_a_x
    }

    pub fn physics_joint_local_anchor_a_y(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_a_y
    }

    pub fn physics_joint_local_anchor_b_x(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_b_x
    }

    pub fn physics_joint_local_anchor_b_y(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_b_y
    }

    pub fn physics_joint_local_axis_a_x(&self) -> f32 {
        self.physics_joint_snapshot.local_axis_a_x
    }

    pub fn physics_joint_local_axis_a_y(&self) -> f32 {
        self.physics_joint_snapshot.local_axis_a_y
    }

    pub fn physics_joint_ground_anchor_a_x(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_a_x
    }

    pub fn physics_joint_ground_anchor_a_y(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_a_y
    }

    pub fn physics_joint_ground_anchor_b_x(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_b_x
    }

    pub fn physics_joint_ground_anchor_b_y(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_b_y
    }

    pub fn physics_joint_limit_enabled(&self) -> bool {
        self.physics_joint_snapshot.limit_enabled
    }

    pub fn physics_joint_continuous_limit(&self) -> bool {
        self.physics_joint_snapshot.continuous_limit
    }

    pub fn physics_joint_lower_angle(&self) -> f32 {
        self.physics_joint_snapshot.lower_angle
    }

    pub fn physics_joint_upper_angle(&self) -> f32 {
        self.physics_joint_snapshot.upper_angle
    }

    pub fn physics_joint_lower_translation(&self) -> f32 {
        self.physics_joint_snapshot.lower_translation
    }

    pub fn physics_joint_upper_translation(&self) -> f32 {
        self.physics_joint_snapshot.upper_translation
    }

    pub fn physics_joint_motor_enabled(&self) -> bool {
        self.physics_joint_snapshot.motor_enabled
    }

    pub fn physics_joint_motor_speed(&self) -> f32 {
        self.physics_joint_snapshot.motor_speed
    }

    pub fn physics_joint_max_motor_force(&self) -> f32 {
        self.physics_joint_snapshot.max_motor_force
    }

    pub fn physics_joint_max_motor_torque(&self) -> f32 {
        self.physics_joint_snapshot.max_motor_torque
    }

    pub fn physics_joint_enabled(&self) -> bool {
        self.physics_joint_snapshot.enabled
    }
}
