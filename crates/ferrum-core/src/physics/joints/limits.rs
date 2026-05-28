use crate::components::{PrismaticJoint, RevoluteJoint, Velocity};

use super::super::math::{cross_velocity, sanitize_finite, sanitize_non_negative};
use super::super::KINEMATIC_EPSILON;
use super::geometry::normalize_angle_radians;
use super::{
    GearJointConstraintContext, PrismaticJointConstraintContext, RevoluteJointConstraintContext,
};

pub(super) fn prismatic_joint_translation_limits(joint: PrismaticJoint) -> Option<(f32, f32)> {
    if !joint.limit_enabled {
        return None;
    }

    let lower_translation = sanitize_finite(joint.lower_translation);
    let upper_translation = sanitize_finite(joint.upper_translation);
    if lower_translation <= upper_translation {
        Some((lower_translation, upper_translation))
    } else {
        Some((upper_translation, lower_translation))
    }
}

pub(super) fn revolute_joint_angle_limits(joint: RevoluteJoint) -> Option<(f32, f32)> {
    if !joint.limit_enabled {
        return None;
    }

    let lower_angle = normalize_angle_radians(joint.lower_angle);
    let upper_angle = normalize_angle_radians(joint.upper_angle);
    if lower_angle <= upper_angle {
        Some((lower_angle, upper_angle))
    } else {
        Some((upper_angle, lower_angle))
    }
}

pub(super) fn revolute_joint_limit_error(
    context: RevoluteJointConstraintContext,
    joint: RevoluteJoint,
) -> Option<f32> {
    let (lower_angle, upper_angle) = revolute_joint_angle_limits(joint)?;
    if context.relative_angle < lower_angle {
        Some(context.relative_angle - lower_angle)
    } else if context.relative_angle > upper_angle {
        Some(context.relative_angle - upper_angle)
    } else {
        None
    }
}

pub(super) fn revolute_joint_motor_config(
    context: RevoluteJointConstraintContext,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> Option<(f32, f32)> {
    if !joint.motor_enabled || delta_seconds <= 0.0 || velocity_iterations == 0 {
        return None;
    }

    let motor_speed = sanitize_finite(joint.motor_speed);
    let max_motor_torque = sanitize_non_negative(joint.max_motor_torque);
    if max_motor_torque <= 0.0 || !revolute_joint_motor_allows_velocity(context, joint, motor_speed)
    {
        return None;
    }

    Some((motor_speed, max_motor_torque))
}

pub(super) fn revolute_joint_motor_allows_velocity(
    context: RevoluteJointConstraintContext,
    joint: RevoluteJoint,
    motor_speed: f32,
) -> bool {
    let Some((lower_angle, upper_angle)) = revolute_joint_angle_limits(joint) else {
        return true;
    };
    if motor_speed > 0.0 && context.relative_angle >= upper_angle - KINEMATIC_EPSILON {
        return false;
    }
    if motor_speed < 0.0 && context.relative_angle <= lower_angle + KINEMATIC_EPSILON {
        return false;
    }
    true
}

pub(super) fn prismatic_joint_limit_error(
    context: PrismaticJointConstraintContext,
    joint: PrismaticJoint,
) -> Option<f32> {
    let (lower_translation, upper_translation) = prismatic_joint_translation_limits(joint)?;
    if context.translation < lower_translation {
        Some(context.translation - lower_translation)
    } else if context.translation > upper_translation {
        Some(context.translation - upper_translation)
    } else {
        None
    }
}

pub(super) fn prismatic_joint_motor_config(
    context: PrismaticJointConstraintContext,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> Option<(f32, f32)> {
    if !joint.motor_enabled || delta_seconds <= 0.0 || velocity_iterations == 0 {
        return None;
    }

    let motor_speed = sanitize_finite(joint.motor_speed);
    let max_motor_force = sanitize_non_negative(joint.max_motor_force);
    if max_motor_force <= 0.0 || !prismatic_joint_motor_allows_velocity(context, joint, motor_speed)
    {
        return None;
    }

    Some((motor_speed, max_motor_force))
}

pub(super) fn prismatic_joint_motor_allows_velocity(
    context: PrismaticJointConstraintContext,
    joint: PrismaticJoint,
    motor_speed: f32,
) -> bool {
    let Some((lower_translation, upper_translation)) = prismatic_joint_translation_limits(joint)
    else {
        return true;
    };
    if motor_speed > 0.0 && context.translation >= upper_translation - KINEMATIC_EPSILON {
        return false;
    }
    if motor_speed < 0.0 && context.translation <= lower_translation + KINEMATIC_EPSILON {
        return false;
    }
    true
}

pub(super) fn revolute_joint_axis_denominator(
    context: &RevoluteJointConstraintContext,
    axis: Velocity,
) -> f32 {
    let radius_a_cross_axis = cross_velocity(context.radius_a, axis);
    let radius_b_cross_axis = cross_velocity(context.radius_b, axis);
    context.inverse_mass_a
        + context.inverse_mass_b
        + context.inverse_inertia_a * radius_a_cross_axis * radius_a_cross_axis
        + context.inverse_inertia_b * radius_b_cross_axis * radius_b_cross_axis
}

pub(super) fn revolute_joint_angular_denominator(context: &RevoluteJointConstraintContext) -> f32 {
    context.inverse_inertia_a + context.inverse_inertia_b
}

pub(super) fn prismatic_joint_axis_denominator(
    context: &PrismaticJointConstraintContext,
    axis: Velocity,
) -> f32 {
    let radius_a_cross_axis = cross_velocity(context.radius_a, axis);
    let radius_b_cross_axis = cross_velocity(context.radius_b, axis);
    context.inverse_mass_a
        + context.inverse_mass_b
        + context.inverse_inertia_a * radius_a_cross_axis * radius_a_cross_axis
        + context.inverse_inertia_b * radius_b_cross_axis * radius_b_cross_axis
}

pub(super) fn gear_joint_angular_denominator(context: GearJointConstraintContext) -> f32 {
    context.inverse_inertia_a * context.ratio * context.ratio + context.inverse_inertia_b
}
