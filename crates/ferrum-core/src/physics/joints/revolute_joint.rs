use super::*;

pub(in crate::physics) fn solve_revolute_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.revolute_joints[index] else {
            continue;
        };
        if revolute_joint_should_break(world, joint) {
            if clear_revolute_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_revolute_joint_velocity_constraint(
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

pub(in crate::physics) fn solve_revolute_joint_position_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.revolute_joints[index] else {
            continue;
        };
        if revolute_joint_should_break(world, joint) {
            if clear_revolute_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_revolute_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_revolute_joint_velocity_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, RevoluteJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, RevoluteJoint::DEFAULT_DAMPING);

    let mut applied = false;
    if (stiffness > 0.0 || damping > 0.0)
        && solve_revolute_joint_velocity_axis(
            world,
            joint,
            Velocity { vx: 1.0, vy: 0.0 },
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_revolute_joint_velocity_axis(
            world,
            joint,
            Velocity { vx: 0.0, vy: 1.0 },
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_revolute_joint_limit_velocity_constraint(
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
    if solve_revolute_joint_motor_velocity_constraint(
        world,
        joint,
        delta_seconds,
        velocity_iterations,
    ) {
        applied = true;
    }

    applied
}

pub(in crate::physics) fn solve_revolute_joint_position_constraint(
    world: &mut World,
    joint: RevoluteJoint,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, RevoluteJoint::DEFAULT_STIFFNESS);

    let mut applied = false;
    if stiffness > 0.0
        && solve_revolute_joint_position_axis(
            world,
            joint,
            Velocity { vx: 1.0, vy: 0.0 },
            stiffness,
        )
    {
        applied = true;
    }
    if stiffness > 0.0
        && solve_revolute_joint_position_axis(
            world,
            joint,
            Velocity { vx: 0.0, vy: 1.0 },
            stiffness,
        )
    {
        applied = true;
    }
    if stiffness > 0.0 && solve_revolute_joint_limit_position_constraint(world, joint, stiffness) {
        applied = true;
    }

    applied
}

pub(in crate::physics) fn solve_revolute_joint_velocity_axis(
    world: &mut World,
    joint: RevoluteJoint,
    axis: Velocity,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let denominator = revolute_joint_axis_denominator(&context, axis);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = relative_anchor_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity =
        dot_velocity(context.error, axis) * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = dot_velocity(relative_velocity, axis) * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: axis.vx * impulse_magnitude,
            vy: axis.vy * impulse_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_revolute_joint_limit_velocity_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some(limit_error) = revolute_joint_limit_error(context, joint) else {
        return false;
    };
    let denominator = revolute_joint_angular_denominator(&context);
    if denominator <= 0.0 {
        return false;
    }

    let relative_angular_velocity = revolute_joint_relative_angular_velocity(world, context);
    let damping_velocity = if limit_error < 0.0 {
        relative_angular_velocity.min(0.0) * damping
    } else {
        relative_angular_velocity.max(0.0) * damping
    };
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = limit_error * stiffness / (delta_seconds * iteration_count);
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let angular_impulse = -correction_velocity / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_angular_impulse(world, context, angular_impulse);
    true
}

pub(in crate::physics) fn solve_revolute_joint_motor_velocity_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some((motor_speed, max_motor_torque)) =
        revolute_joint_motor_config(context, joint, delta_seconds, velocity_iterations)
    else {
        return false;
    };
    let denominator = revolute_joint_angular_denominator(&context);
    if denominator <= 0.0 {
        return false;
    }

    let relative_angular_velocity = revolute_joint_relative_angular_velocity(world, context);
    let correction_velocity = relative_angular_velocity - motor_speed;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let max_impulse_magnitude =
        max_motor_torque * delta_seconds / velocity_iterations.max(1) as f32;
    if max_impulse_magnitude <= KINEMATIC_EPSILON {
        return false;
    }
    let angular_impulse =
        (-correction_velocity / denominator).clamp(-max_impulse_magnitude, max_impulse_magnitude);
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_angular_impulse(world, context, angular_impulse);
    true
}

pub(in crate::physics) fn solve_revolute_joint_position_axis(
    world: &mut World,
    joint: RevoluteJoint,
    axis: Velocity,
    stiffness: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let error_along_axis = dot_velocity(context.error, axis);
    if error_along_axis.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = revolute_joint_axis_denominator(&context, axis);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = error_along_axis * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_anchor_position_correction(
        world,
        context,
        Velocity {
            vx: -axis.vx * correction_magnitude,
            vy: -axis.vy * correction_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_revolute_joint_limit_position_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some(limit_error) = revolute_joint_limit_error(context, joint) else {
        return false;
    };
    let denominator = revolute_joint_angular_denominator(&context);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = limit_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_angular_position_correction(world, context, -correction_magnitude);
    true
}

pub(in crate::physics) fn revolute_joint_constraint_context(
    world: &World,
    joint: RevoluteJoint,
) -> Option<RevoluteJointConstraintContext> {
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
    let error = Velocity {
        vx: anchor_b.x - anchor_a.x,
        vy: anchor_b.y - anchor_a.y,
    };
    let rotation_a = finite_rotation(world.rotation_at_index_or_default(a_index));
    let rotation_b = finite_rotation(world.rotation_at_index_or_default(b_index));
    let relative_angle = normalize_angle_radians(rotation_b.radians - rotation_a.radians);
    if !error.vx.is_finite() || !error.vy.is_finite() || !relative_angle.is_finite() {
        return None;
    }

    Some(RevoluteJointConstraintContext {
        a_index,
        b_index,
        anchor_a,
        anchor_b,
        radius_a,
        radius_b,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
        relative_angle,
        error,
    })
}

pub(in crate::physics) fn revolute_joint_should_break(world: &World, joint: RevoluteJoint) -> bool {
    let Some(break_distance) = sanitize_revolute_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    context.error.vx.hypot(context.error.vy) > break_distance + KINEMATIC_EPSILON
}

pub(in crate::physics) fn sanitize_revolute_joint_break_distance(
    break_distance: f32,
) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

pub(in crate::physics) fn clear_revolute_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.revolute_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_revolute_joint(RevoluteJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}
