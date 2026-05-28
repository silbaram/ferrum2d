use crate::entity::Entity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WeldJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WeldJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub reference_angle: f32,
    pub break_distance: f32,
    pub break_angle: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub angular_stiffness: f32,
    pub angular_damping: f32,
    pub enabled: bool,
}

impl WeldJoint {
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
            reference_angle: 0.0,
            break_distance: f32::INFINITY,
            break_angle: f32::INFINITY,
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

    pub const fn with_break_angle(mut self, break_angle: f32) -> Self {
        self.break_angle = break_angle;
        self
    }

    pub const fn without_break_angle(mut self) -> Self {
        self.break_angle = f32::INFINITY;
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GearJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GearJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub ratio: f32,
    pub reference_angle: f32,
    pub break_angle: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl GearJoint {
    pub const DEFAULT_RATIO: f32 = 1.0;
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 1.0;

    pub fn new(entity_a: Entity, entity_b: Entity, ratio: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            ratio: if ratio.is_finite() {
                ratio
            } else {
                Self::DEFAULT_RATIO
            },
            reference_angle: 0.0,
            break_angle: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_ratio(mut self, ratio: f32) -> Self {
        self.ratio = ratio;
        self
    }

    pub const fn with_reference_angle(mut self, reference_angle: f32) -> Self {
        self.reference_angle = reference_angle;
        self
    }

    pub const fn with_break_angle(mut self, break_angle: f32) -> Self {
        self.break_angle = break_angle;
        self
    }

    pub const fn without_break_angle(mut self) -> Self {
        self.break_angle = f32::INFINITY;
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
