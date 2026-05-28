use crate::entity::Entity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RevoluteJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RevoluteJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub break_distance: f32,
    pub limit_enabled: bool,
    pub lower_angle: f32,
    pub upper_angle: f32,
    pub motor_enabled: bool,
    pub motor_speed: f32,
    pub max_motor_torque: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl RevoluteJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 1.0;

    pub const fn new(entity_a: Entity, entity_b: Entity) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            break_distance: f32::INFINITY,
            limit_enabled: false,
            lower_angle: 0.0,
            upper_angle: 0.0,
            motor_enabled: false,
            motor_speed: 0.0,
            max_motor_torque: 0.0,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_local_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_a_x = x;
        self.local_anchor_a_y = y;
        self
    }

    pub const fn with_local_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_b_x = x;
        self.local_anchor_b_y = y;
        self
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_angle_limits(mut self, lower_angle: f32, upper_angle: f32) -> Self {
        self.limit_enabled = true;
        self.lower_angle = lower_angle;
        self.upper_angle = upper_angle;
        self
    }

    pub const fn with_angle_limit_enabled(mut self, limit_enabled: bool) -> Self {
        self.limit_enabled = limit_enabled;
        self
    }

    pub const fn with_motor(mut self, motor_speed: f32, max_motor_torque: f32) -> Self {
        self.motor_enabled = true;
        self.motor_speed = motor_speed;
        self.max_motor_torque = max_motor_torque;
        self
    }

    pub const fn with_motor_enabled(mut self, motor_enabled: bool) -> Self {
        self.motor_enabled = motor_enabled;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PrismaticJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PrismaticJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub local_axis_a_x: f32,
    pub local_axis_a_y: f32,
    pub break_distance: f32,
    pub reference_angle: f32,
    pub limit_enabled: bool,
    pub lower_translation: f32,
    pub upper_translation: f32,
    pub motor_enabled: bool,
    pub motor_speed: f32,
    pub max_motor_force: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub angular_stiffness: f32,
    pub angular_damping: f32,
    pub enabled: bool,
}

impl PrismaticJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 1.0;
    pub const DEFAULT_ANGULAR_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_ANGULAR_DAMPING: f32 = 1.0;

    pub const fn new(entity_a: Entity, entity_b: Entity) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            local_axis_a_x: 1.0,
            local_axis_a_y: 0.0,
            break_distance: f32::INFINITY,
            reference_angle: 0.0,
            limit_enabled: false,
            lower_translation: 0.0,
            upper_translation: 0.0,
            motor_enabled: false,
            motor_speed: 0.0,
            max_motor_force: 0.0,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            angular_stiffness: Self::DEFAULT_ANGULAR_STIFFNESS,
            angular_damping: Self::DEFAULT_ANGULAR_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_local_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_a_x = x;
        self.local_anchor_a_y = y;
        self
    }

    pub const fn with_local_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_b_x = x;
        self.local_anchor_b_y = y;
        self
    }

    pub const fn with_local_axis_a(mut self, x: f32, y: f32) -> Self {
        self.local_axis_a_x = x;
        self.local_axis_a_y = y;
        self
    }

    pub const fn with_reference_angle(mut self, reference_angle: f32) -> Self {
        self.reference_angle = reference_angle;
        self
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_translation_limits(
        mut self,
        lower_translation: f32,
        upper_translation: f32,
    ) -> Self {
        self.limit_enabled = true;
        self.lower_translation = lower_translation;
        self.upper_translation = upper_translation;
        self
    }

    pub const fn with_translation_limit_enabled(mut self, limit_enabled: bool) -> Self {
        self.limit_enabled = limit_enabled;
        self
    }

    pub const fn with_motor(mut self, motor_speed: f32, max_motor_force: f32) -> Self {
        self.motor_enabled = true;
        self.motor_speed = motor_speed;
        self.max_motor_force = max_motor_force;
        self
    }

    pub const fn with_motor_enabled(mut self, motor_enabled: bool) -> Self {
        self.motor_enabled = motor_enabled;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_angular_stiffness(mut self, angular_stiffness: f32) -> Self {
        self.angular_stiffness = angular_stiffness;
        self
    }

    pub const fn with_angular_damping(mut self, angular_damping: f32) -> Self {
        self.angular_damping = angular_damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}
