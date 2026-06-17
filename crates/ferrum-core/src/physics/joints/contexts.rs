use crate::components::{Transform2D, Velocity};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct DistanceJointConstraintContext {
    pub(in crate::physics::joints) a_index: usize,
    pub(in crate::physics::joints) b_index: usize,
    pub(in crate::physics::joints) anchor_a: Transform2D,
    pub(in crate::physics::joints) anchor_b: Transform2D,
    pub(in crate::physics::joints) radius_a: Velocity,
    pub(in crate::physics::joints) radius_b: Velocity,
    pub(in crate::physics::joints) normal: Velocity,
    pub(in crate::physics::joints) inverse_mass_a: f32,
    pub(in crate::physics::joints) inverse_mass_b: f32,
    pub(in crate::physics::joints) inverse_inertia_a: f32,
    pub(in crate::physics::joints) inverse_inertia_b: f32,
    pub(in crate::physics::joints) denominator: f32,
    pub(in crate::physics::joints) error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct RopeJointConstraintContext {
    pub(in crate::physics::joints) a_index: usize,
    pub(in crate::physics::joints) b_index: usize,
    pub(in crate::physics::joints) anchor_a: Transform2D,
    pub(in crate::physics::joints) anchor_b: Transform2D,
    pub(in crate::physics::joints) radius_a: Velocity,
    pub(in crate::physics::joints) radius_b: Velocity,
    pub(in crate::physics::joints) normal: Velocity,
    pub(in crate::physics::joints) inverse_mass_a: f32,
    pub(in crate::physics::joints) inverse_mass_b: f32,
    pub(in crate::physics::joints) inverse_inertia_a: f32,
    pub(in crate::physics::joints) inverse_inertia_b: f32,
    pub(in crate::physics::joints) denominator: f32,
    pub(in crate::physics::joints) error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct SpringJointConstraintContext {
    pub(in crate::physics::joints) a_index: usize,
    pub(in crate::physics::joints) b_index: usize,
    pub(in crate::physics::joints) anchor_a: Transform2D,
    pub(in crate::physics::joints) anchor_b: Transform2D,
    pub(in crate::physics::joints) radius_a: Velocity,
    pub(in crate::physics::joints) radius_b: Velocity,
    pub(in crate::physics::joints) normal: Velocity,
    pub(in crate::physics::joints) inverse_mass_a: f32,
    pub(in crate::physics::joints) inverse_mass_b: f32,
    pub(in crate::physics::joints) inverse_inertia_a: f32,
    pub(in crate::physics::joints) inverse_inertia_b: f32,
    pub(in crate::physics::joints) denominator: f32,
    pub(in crate::physics::joints) error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct PulleyJointConstraintContext {
    pub(in crate::physics::joints) a_index: usize,
    pub(in crate::physics::joints) b_index: usize,
    pub(in crate::physics::joints) anchor_a: Transform2D,
    pub(in crate::physics::joints) anchor_b: Transform2D,
    pub(in crate::physics::joints) radius_a: Velocity,
    pub(in crate::physics::joints) radius_b: Velocity,
    pub(in crate::physics::joints) normal_a: Velocity,
    pub(in crate::physics::joints) normal_b: Velocity,
    pub(in crate::physics::joints) inverse_mass_a: f32,
    pub(in crate::physics::joints) inverse_mass_b: f32,
    pub(in crate::physics::joints) inverse_inertia_a: f32,
    pub(in crate::physics::joints) inverse_inertia_b: f32,
    pub(in crate::physics::joints) ratio: f32,
    pub(in crate::physics::joints) error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct RevoluteJointConstraintContext {
    pub(in crate::physics::joints) a_index: usize,
    pub(in crate::physics::joints) b_index: usize,
    pub(in crate::physics::joints) anchor_a: Transform2D,
    pub(in crate::physics::joints) anchor_b: Transform2D,
    pub(in crate::physics::joints) radius_a: Velocity,
    pub(in crate::physics::joints) radius_b: Velocity,
    pub(in crate::physics::joints) inverse_mass_a: f32,
    pub(in crate::physics::joints) inverse_mass_b: f32,
    pub(in crate::physics::joints) inverse_inertia_a: f32,
    pub(in crate::physics::joints) inverse_inertia_b: f32,
    pub(in crate::physics::joints) relative_angle: f32,
    pub(in crate::physics) error: Velocity,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct PrismaticJointConstraintContext {
    pub(in crate::physics::joints) a_index: usize,
    pub(in crate::physics::joints) b_index: usize,
    pub(in crate::physics::joints) anchor_a: Transform2D,
    pub(in crate::physics::joints) anchor_b: Transform2D,
    pub(in crate::physics::joints) radius_a: Velocity,
    pub(in crate::physics::joints) radius_b: Velocity,
    pub(in crate::physics::joints) axis: Velocity,
    pub(in crate::physics::joints) perpendicular: Velocity,
    pub(in crate::physics::joints) inverse_mass_a: f32,
    pub(in crate::physics::joints) inverse_mass_b: f32,
    pub(in crate::physics::joints) inverse_inertia_a: f32,
    pub(in crate::physics::joints) inverse_inertia_b: f32,
    pub(in crate::physics::joints) translation: f32,
    pub(in crate::physics::joints) linear_error: f32,
    pub(in crate::physics::joints) angular_error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct GearJointConstraintContext {
    pub(in crate::physics::joints) a_index: usize,
    pub(in crate::physics::joints) b_index: usize,
    pub(in crate::physics::joints) inverse_inertia_a: f32,
    pub(in crate::physics::joints) inverse_inertia_b: f32,
    pub(in crate::physics::joints) ratio: f32,
    pub(in crate::physics::joints) error: f32,
}
