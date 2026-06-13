use super::*;

pub(in crate::physics) fn solve_gear_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.gear_joints[index] else {
            continue;
        };
        if gear_joint_should_break(world, joint) {
            if clear_gear_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_gear_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_gear_joint_position_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.gear_joints[index] else {
            continue;
        };
        if gear_joint_should_break(world, joint) {
            if clear_gear_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_gear_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_gear_joint_velocity_constraint(
    world: &mut World,
    joint: GearJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, GearJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, GearJoint::DEFAULT_DAMPING);
    if stiffness <= 0.0 && damping <= 0.0 {
        return false;
    }
    let Some(context) = gear_joint_constraint_context(world, joint, false) else {
        return false;
    };
    let denominator = gear_joint_angular_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = if stiffness > 0.0 && delta_seconds > 0.0 {
        context.error * stiffness / (delta_seconds * iteration_count)
    } else {
        0.0
    };
    let damping_velocity = gear_joint_relative_angular_velocity(world, context) * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let angular_impulse = -correction_velocity / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_gear_joint_angular_impulse(world, context, angular_impulse);
    true
}

pub(in crate::physics) fn solve_gear_joint_position_constraint(
    world: &mut World,
    joint: GearJoint,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, GearJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = gear_joint_constraint_context(world, joint, true) else {
        return false;
    };
    let denominator = gear_joint_angular_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let angular_impulse = -context.error * stiffness / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_gear_joint_angular_position_correction(world, context, angular_impulse);
    true
}

pub(in crate::physics) fn gear_joint_constraint_context(
    world: &World,
    joint: GearJoint,
    require_position_error: bool,
) -> Option<GearJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
    let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
    let ratio = sanitize_gear_joint_ratio(joint.ratio);
    let denominator = inverse_inertia_a * ratio * ratio + inverse_inertia_b;
    if denominator <= 0.0 {
        return None;
    }

    let rotation_a = finite_rotation(world.rotation_at_index_or_default(a_index));
    let rotation_b = finite_rotation(world.rotation_at_index_or_default(b_index));
    let reference_angle = sanitize_finite(joint.reference_angle);
    let error = rotation_b.radians + ratio * rotation_a.radians - reference_angle;
    if !error.is_finite() || (require_position_error && error.abs() <= KINEMATIC_EPSILON) {
        return None;
    }

    Some(GearJointConstraintContext {
        a_index,
        b_index,
        inverse_inertia_a,
        inverse_inertia_b,
        ratio,
        error,
    })
}

pub(in crate::physics) fn gear_joint_should_break(world: &World, joint: GearJoint) -> bool {
    let Some(break_angle) = sanitize_gear_joint_break_angle(joint.break_angle) else {
        return false;
    };
    let Some(context) = gear_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error.abs() > break_angle + KINEMATIC_EPSILON
}

pub(in crate::physics) fn sanitize_gear_joint_break_angle(break_angle: f32) -> Option<f32> {
    (break_angle.is_finite() && break_angle >= 0.0).then_some(break_angle)
}

pub(in crate::physics) fn clear_gear_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.gear_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_gear_joint(GearJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}
