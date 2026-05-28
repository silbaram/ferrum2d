use crate::components::{GearJoint, PulleyJoint};

use super::super::math::sanitize_non_negative;
use super::super::KINEMATIC_EPSILON;

pub(super) fn sanitize_distance_joint_rest_length(rest_length: f32) -> f32 {
    sanitize_non_negative(rest_length)
}

pub(super) fn sanitize_rope_joint_max_length(max_length: f32) -> f32 {
    sanitize_non_negative(max_length)
}

pub(super) fn sanitize_spring_joint_rest_length(rest_length: f32) -> f32 {
    sanitize_non_negative(rest_length)
}

pub(super) fn sanitize_pulley_joint_rest_length(rest_length: f32) -> f32 {
    sanitize_non_negative(rest_length)
}

pub(super) fn sanitize_unit_interval(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        default
    }
}

pub(super) fn sanitize_gear_joint_ratio(ratio: f32) -> f32 {
    if ratio.is_finite() {
        ratio
    } else {
        GearJoint::DEFAULT_RATIO
    }
}

pub(super) fn sanitize_pulley_joint_ratio(ratio: f32) -> f32 {
    if ratio.is_finite() && ratio > KINEMATIC_EPSILON {
        ratio
    } else {
        PulleyJoint::DEFAULT_RATIO
    }
}
