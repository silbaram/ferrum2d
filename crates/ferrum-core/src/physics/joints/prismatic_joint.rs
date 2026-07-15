use super::*;

#[cfg(test)]
std::thread_local! {
    static PRISMATIC_JOINT_CONTEXT_BUILD_COUNT: std::cell::Cell<usize> = const {
        std::cell::Cell::new(0)
    };
}

#[cfg(test)]
pub(in crate::physics) fn reset_prismatic_joint_context_build_count() {
    PRISMATIC_JOINT_CONTEXT_BUILD_COUNT.with(|count| count.set(0));
}

#[cfg(test)]
pub(in crate::physics) fn prismatic_joint_context_build_count() -> usize {
    PRISMATIC_JOINT_CONTEXT_BUILD_COUNT.with(std::cell::Cell::get)
}

pub(in crate::physics) fn solve_prismatic_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.prismatic_joints[index] else {
            continue;
        };
        if prismatic_joint_should_break(world, joint) {
            if clear_prismatic_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_prismatic_joint_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
        ) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_prismatic_joint_position_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.prismatic_joints[index] else {
            continue;
        };
        if prismatic_joint_should_break(world, joint) {
            if clear_prismatic_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_prismatic_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_prismatic_joint_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PrismaticJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, PrismaticJoint::DEFAULT_DAMPING);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        PrismaticJoint::DEFAULT_ANGULAR_STIFFNESS,
    );
    let angular_damping = sanitize_unit_interval(
        joint.angular_damping,
        PrismaticJoint::DEFAULT_ANGULAR_DAMPING,
    );

    let mut applied = false;
    if (stiffness > 0.0 || damping > 0.0)
        && solve_prismatic_joint_linear_velocity_constraint(
            world,
            joint,
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
            joint,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if solve_prismatic_joint_motor_velocity_constraint(
        world,
        joint,
        delta_seconds,
        velocity_iterations,
    ) {
        applied = true;
    }
    if (angular_stiffness > 0.0 || angular_damping > 0.0)
        && solve_prismatic_joint_angular_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
            angular_stiffness,
            angular_damping,
        )
    {
        applied = true;
    }

    applied
}

pub(in crate::physics) fn solve_prismatic_joint_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PrismaticJoint::DEFAULT_STIFFNESS);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        PrismaticJoint::DEFAULT_ANGULAR_STIFFNESS,
    );

    let mut applied = false;
    if stiffness > 0.0 && solve_prismatic_joint_linear_position_constraint(world, joint, stiffness)
    {
        applied = true;
    }
    if stiffness > 0.0 && solve_prismatic_joint_limit_position_constraint(world, joint, stiffness) {
        applied = true;
    }
    if angular_stiffness > 0.0
        && solve_prismatic_joint_angular_position_constraint(world, joint, angular_stiffness)
    {
        applied = true;
    }

    applied
}

pub(in crate::physics) fn solve_prismatic_joint_linear_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let denominator = prismatic_joint_axis_denominator(&context, context.perpendicular);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = prismatic_joint_relative_anchor_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = context.linear_error * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = dot_velocity(relative_velocity, context.perpendicular) * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: context.perpendicular.vx * impulse_magnitude,
            vy: context.perpendicular.vy * impulse_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_prismatic_joint_limit_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some(limit_error) = prismatic_joint_limit_error(context, joint) else {
        return false;
    };
    let denominator = prismatic_joint_axis_denominator(&context, context.axis);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = prismatic_joint_relative_anchor_velocity(world, context);
    let relative_velocity_along_axis = dot_velocity(relative_velocity, context.axis);
    let damping_velocity = if limit_error < 0.0 {
        relative_velocity_along_axis.min(0.0) * damping
    } else {
        relative_velocity_along_axis.max(0.0) * damping
    };
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = limit_error * stiffness / (delta_seconds * iteration_count);
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: context.axis.vx * impulse_magnitude,
            vy: context.axis.vy * impulse_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_prismatic_joint_motor_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some((motor_speed, max_motor_force)) =
        prismatic_joint_motor_config(context, joint, delta_seconds, velocity_iterations)
    else {
        return false;
    };
    let denominator = prismatic_joint_axis_denominator(&context, context.axis);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = prismatic_joint_relative_anchor_velocity(world, context);
    let relative_velocity_along_axis = dot_velocity(relative_velocity, context.axis);
    let correction_velocity = relative_velocity_along_axis - motor_speed;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let max_impulse_magnitude = max_motor_force * delta_seconds / velocity_iterations.max(1) as f32;
    if max_impulse_magnitude <= KINEMATIC_EPSILON {
        return false;
    }
    let impulse_magnitude =
        (-correction_velocity / denominator).clamp(-max_impulse_magnitude, max_impulse_magnitude);
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: context.axis.vx * impulse_magnitude,
            vy: context.axis.vy * impulse_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_prismatic_joint_angular_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let denominator = context.inverse_inertia_a + context.inverse_inertia_b;
    if denominator <= 0.0 {
        return false;
    }

    let relative_angular_velocity = prismatic_joint_relative_angular_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = context.angular_error * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = relative_angular_velocity * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let angular_impulse = -correction_velocity / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_angular_impulse(world, context, angular_impulse);
    true
}

pub(in crate::physics) fn solve_prismatic_joint_linear_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    solve_prismatic_joint_linear_position_constraint_with_context(world, &context, stiffness)
}

pub(super) fn solve_prismatic_joint_linear_position_constraint_with_context(
    world: &mut World,
    context: &PrismaticJointConstraintContext,
    stiffness: f32,
) -> bool {
    if context.linear_error.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = prismatic_joint_axis_denominator(context, context.perpendicular);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = context.linear_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_position_correction(
        world,
        *context,
        Velocity {
            vx: -context.perpendicular.vx * correction_magnitude,
            vy: -context.perpendicular.vy * correction_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_prismatic_joint_limit_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    solve_prismatic_joint_limit_position_constraint_with_context(world, joint, &context, stiffness)
}

pub(super) fn solve_prismatic_joint_limit_position_constraint_with_context(
    world: &mut World,
    joint: PrismaticJoint,
    context: &PrismaticJointConstraintContext,
    stiffness: f32,
) -> bool {
    let Some(limit_error) = prismatic_joint_limit_error(*context, joint) else {
        return false;
    };
    if limit_error.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = prismatic_joint_axis_denominator(context, context.axis);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = limit_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_position_correction(
        world,
        *context,
        Velocity {
            vx: -context.axis.vx * correction_magnitude,
            vy: -context.axis.vy * correction_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_prismatic_joint_angular_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    solve_prismatic_joint_angular_position_constraint_with_context(world, &context, stiffness)
}

pub(super) fn solve_prismatic_joint_angular_position_constraint_with_context(
    world: &mut World,
    context: &PrismaticJointConstraintContext,
    stiffness: f32,
) -> bool {
    if context.angular_error.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = context.inverse_inertia_a + context.inverse_inertia_b;
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = context.angular_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_angular_position_correction(world, *context, -correction_magnitude);
    true
}

pub(in crate::physics) fn prismatic_joint_constraint_context(
    world: &World,
    joint: PrismaticJoint,
) -> Option<PrismaticJointConstraintContext> {
    #[cfg(test)]
    PRISMATIC_JOINT_CONTEXT_BUILD_COUNT.with(|count| count.set(count.get().saturating_add(1)));

    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transform_at_index(a_index)?;
    let transform_b = world.transform_at_index(b_index)?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
    let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
    if inverse_mass_a + inverse_mass_b + inverse_inertia_a + inverse_inertia_b <= 0.0 {
        return None;
    }

    let radius_a = revolute_joint_world_radius(
        world,
        a_index,
        joint.local_anchor_a_x,
        joint.local_anchor_a_y,
    );
    let radius_b = revolute_joint_world_radius(
        world,
        b_index,
        joint.local_anchor_b_x,
        joint.local_anchor_b_y,
    );
    let anchor_a = Transform2D {
        x: transform_a.x + radius_a.vx,
        y: transform_a.y + radius_a.vy,
    };
    let anchor_b = Transform2D {
        x: transform_b.x + radius_b.vx,
        y: transform_b.y + radius_b.vy,
    };
    let axis =
        prismatic_joint_world_axis(world, a_index, joint.local_axis_a_x, joint.local_axis_a_y);
    let perpendicular = Velocity {
        vx: -axis.vy,
        vy: axis.vx,
    };
    let error = Velocity {
        vx: anchor_b.x - anchor_a.x,
        vy: anchor_b.y - anchor_a.y,
    };
    let translation = dot_velocity(error, axis);
    let linear_error = dot_velocity(error, perpendicular);
    let rotation_a = finite_rotation(world.rotation_at_index_or_default(a_index));
    let rotation_b = finite_rotation(world.rotation_at_index_or_default(b_index));
    let angular_error = normalize_angle_radians(
        rotation_b.radians - rotation_a.radians - sanitize_finite(joint.reference_angle),
    );
    if !translation.is_finite() || !linear_error.is_finite() || !angular_error.is_finite() {
        return None;
    }

    Some(PrismaticJointConstraintContext {
        a_index,
        b_index,
        anchor_a,
        anchor_b,
        radius_a,
        radius_b,
        axis,
        perpendicular,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
        translation,
        linear_error,
        angular_error,
    })
}

pub(in crate::physics) fn prismatic_joint_should_break(
    world: &World,
    joint: PrismaticJoint,
) -> bool {
    let Some(break_distance) = sanitize_prismatic_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    context.linear_error.abs() > break_distance + KINEMATIC_EPSILON
}

pub(in crate::physics) fn sanitize_prismatic_joint_break_distance(
    break_distance: f32,
) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

pub(in crate::physics) fn clear_prismatic_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.prismatic_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_prismatic_joint(PrismaticJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}
