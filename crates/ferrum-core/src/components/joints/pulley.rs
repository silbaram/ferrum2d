use crate::entity::Entity;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PulleyJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PulleyJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub ground_anchor_a_x: f32,
    pub ground_anchor_a_y: f32,
    pub ground_anchor_b_x: f32,
    pub ground_anchor_b_y: f32,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub rest_length: f32,
    pub ratio: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub slack: bool,
    pub enabled: bool,
}

impl PulleyJoint {
    pub const DEFAULT_RATIO: f32 = 1.0;
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, rest_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            ground_anchor_a_x: 0.0,
            ground_anchor_a_y: 0.0,
            ground_anchor_b_x: 0.0,
            ground_anchor_b_y: 0.0,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            rest_length: if rest_length.is_finite() && rest_length >= 0.0 {
                rest_length
            } else {
                0.0
            },
            ratio: Self::DEFAULT_RATIO,
            break_distance: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            slack: false,
            enabled: true,
        }
    }

    pub const fn with_ground_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.ground_anchor_a_x = x;
        self.ground_anchor_a_y = y;
        self
    }

    pub const fn with_ground_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.ground_anchor_b_x = x;
        self.ground_anchor_b_y = y;
        self
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

    pub const fn with_ratio(mut self, ratio: f32) -> Self {
        self.ratio = ratio;
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

    pub const fn with_slack(mut self, slack: bool) -> Self {
        self.slack = slack;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}
