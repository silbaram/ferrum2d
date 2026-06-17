use crate::entity::Entity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DistanceJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DistanceJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub rest_length: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl DistanceJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, rest_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            rest_length: if rest_length.is_finite() && rest_length >= 0.0 {
                rest_length
            } else {
                0.0
            },
            break_distance: f32::INFINITY,
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
pub struct RopeJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RopeJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub max_length: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl RopeJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, max_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            max_length: if max_length.is_finite() && max_length >= 0.0 {
                max_length
            } else {
                0.0
            },
            break_distance: f32::INFINITY,
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
pub struct SpringJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpringJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub rest_length: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl SpringJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, rest_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            rest_length: if rest_length.is_finite() && rest_length >= 0.0 {
                rest_length
            } else {
                0.0
            },
            break_distance: f32::INFINITY,
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
