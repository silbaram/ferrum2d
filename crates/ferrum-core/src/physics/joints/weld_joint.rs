use super::prismatic_joint::{
    prismatic_joint_constraint_context, solve_prismatic_joint_angular_position_constraint,
    solve_prismatic_joint_angular_velocity_constraint,
    solve_prismatic_joint_limit_velocity_constraint,
    solve_prismatic_joint_linear_velocity_constraint,
};
use super::*;

pub(in crate::physics) fn solve_weld_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.weld_joints[index] else {
            continue;
        };
        if weld_joint_should_break(world, joint) {
            if clear_weld_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_weld_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_weld_joint_position_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.weld_joints[index] else {
            continue;
        };
        if weld_joint_should_break(world, joint) {
            if clear_weld_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_weld_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_weld_joint_velocity_constraint(
    world: &mut World,
    joint: WeldJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let prismatic = prismatic_joint_from_weld_joint(joint);
    let stiffness = sanitize_unit_interval(joint.stiffness, WeldJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, WeldJoint::DEFAULT_DAMPING);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        WeldJoint::DEFAULT_ANGULAR_STIFFNESS,
    );
    let angular_damping =
        sanitize_unit_interval(joint.angular_damping, WeldJoint::DEFAULT_ANGULAR_DAMPING);

    let mut applied = false;
    if (angular_stiffness > 0.0 || angular_damping > 0.0)
        && solve_prismatic_joint_angular_velocity_constraint(
            world,
            prismatic,
            delta_seconds,
            velocity_iterations,
            angular_stiffness,
            angular_damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_prismatic_joint_linear_velocity_constraint(
            world,
            prismatic,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_prismatic_joint_limit_velocity_constraint(
            world,
            prismatic,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }

    applied
}

pub(in crate::physics) fn solve_weld_joint_position_constraint(
    world: &mut World,
    joint: WeldJoint,
) -> bool {
    let prismatic = prismatic_joint_from_weld_joint(joint);
    let stiffness = sanitize_unit_interval(joint.stiffness, WeldJoint::DEFAULT_STIFFNESS);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        WeldJoint::DEFAULT_ANGULAR_STIFFNESS,
    );

    let mut applied = false;
    if angular_stiffness > 0.0
        && solve_prismatic_joint_angular_position_constraint(world, prismatic, angular_stiffness)
    {
        applied = true;
    }
    if stiffness > 0.0 && solve_weld_joint_anchor_position_constraint(world, prismatic, stiffness) {
        applied = true;
    }

    applied
}

pub(in crate::physics) fn prismatic_joint_from_weld_joint(joint: WeldJoint) -> PrismaticJoint {
    PrismaticJoint::new(joint.entity_a, joint.entity_b)
        .with_local_anchor_a(joint.local_anchor_a_x, joint.local_anchor_a_y)
        .with_local_anchor_b(joint.local_anchor_b_x, joint.local_anchor_b_y)
        .with_local_axis_a(1.0, 0.0)
        .with_reference_angle(joint.reference_angle)
        .with_stiffness(joint.stiffness)
        .with_damping(joint.damping)
        .with_angular_stiffness(joint.angular_stiffness)
        .with_angular_damping(joint.angular_damping)
        .with_translation_limits(0.0, 0.0)
        .with_enabled(joint.enabled)
}

pub(in crate::physics) fn weld_joint_should_break(world: &World, joint: WeldJoint) -> bool {
    let prismatic = prismatic_joint_from_weld_joint(joint);
    let Some(context) = prismatic_joint_constraint_context(world, prismatic) else {
        return false;
    };
    if sanitize_weld_joint_break_limit(joint.break_distance).is_some_and(|break_distance| {
        context.linear_error.hypot(context.translation) > break_distance + KINEMATIC_EPSILON
    }) {
        return true;
    }
    sanitize_weld_joint_break_limit(joint.break_angle)
        .is_some_and(|break_angle| context.angular_error.abs() > break_angle + KINEMATIC_EPSILON)
}

pub(in crate::physics) fn sanitize_weld_joint_break_limit(break_limit: f32) -> Option<f32> {
    (break_limit.is_finite() && break_limit >= 0.0).then_some(break_limit)
}

pub(in crate::physics) fn solve_weld_joint_anchor_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let error = Velocity {
        vx: context.anchor_b.x - context.anchor_a.x,
        vy: context.anchor_b.y - context.anchor_a.y,
    };
    if velocity_len_squared(error) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
        return false;
    }
    let denominator = context.inverse_mass_a + context.inverse_mass_b;
    if denominator <= 0.0 {
        return false;
    }

    let impulse = Velocity {
        vx: -error.vx * stiffness / denominator,
        vy: -error.vy * stiffness / denominator,
    };
    if !impulse.vx.is_finite()
        || !impulse.vy.is_finite()
        || velocity_len_squared(impulse) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON
    {
        return false;
    }

    apply_weld_joint_anchor_position_correction(world, context, impulse);
    true
}

pub(in crate::physics) fn apply_weld_joint_anchor_position_correction(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    impulse: Velocity,
) {
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            transform.x -= impulse.vx * context.inverse_mass_a;
            transform.y -= impulse.vy * context.inverse_mass_a;
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            transform.x += impulse.vx * context.inverse_mass_b;
            transform.y += impulse.vy * context.inverse_mass_b;
        }
    }
}

pub(in crate::physics) fn clear_weld_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.weld_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_weld_joint(WeldJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}
