use super::*;

pub(in crate::physics) fn solve_rope_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.rope_joints[index] else {
            continue;
        };
        if rope_joint_should_break(world, joint) {
            if clear_rope_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_rope_joint_velocity_constraint(world, joint) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_rope_joint_position_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.rope_joints[index] else {
            continue;
        };
        if rope_joint_should_break(world, joint) {
            if clear_rope_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_rope_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_rope_joint_velocity_constraint(
    world: &mut World,
    joint: RopeJoint,
) -> bool {
    let damping = sanitize_unit_interval(joint.damping, RopeJoint::DEFAULT_DAMPING);
    if damping <= 0.0 {
        return false;
    }
    let Some(context) = rope_joint_constraint_context(world, joint, false) else {
        return false;
    };

    let velocity_a = world.velocities[context.a_index].unwrap_or_default();
    let velocity_b = world.velocities[context.b_index].unwrap_or_default();
    let relative_velocity = Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    };
    let velocity_along_axis = dot_velocity(relative_velocity, context.normal);
    if velocity_along_axis <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -velocity_along_axis * damping / context.inverse_mass_sum;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        Velocity {
            vx: context.normal.vx * impulse_magnitude,
            vy: context.normal.vy * impulse_magnitude,
        },
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    true
}

pub(in crate::physics) fn solve_rope_joint_position_constraint(
    world: &mut World,
    joint: RopeJoint,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, RopeJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = rope_joint_constraint_context(world, joint, true) else {
        return false;
    };

    let correction_magnitude = context.error * stiffness / context.inverse_mass_sum;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            transform.x += context.normal.vx * correction_magnitude * context.inverse_mass_a;
            transform.y += context.normal.vy * correction_magnitude * context.inverse_mass_a;
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            transform.x -= context.normal.vx * correction_magnitude * context.inverse_mass_b;
            transform.y -= context.normal.vy * correction_magnitude * context.inverse_mass_b;
        }
    }
    true
}

pub(in crate::physics) fn rope_joint_constraint_context(
    world: &World,
    joint: RopeJoint,
    require_position_error: bool,
) -> Option<RopeJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_mass_sum = inverse_mass_a + inverse_mass_b;
    if inverse_mass_sum <= 0.0 {
        return None;
    }

    let dx = transform_b.x - transform_a.x;
    let dy = transform_b.y - transform_a.y;
    let length = dx.hypot(dy);
    if !length.is_finite() || length <= KINEMATIC_EPSILON {
        return None;
    }
    let max_length = sanitize_rope_joint_max_length(joint.max_length);
    let error = length - max_length;
    if !error.is_finite()
        || (require_position_error && error <= KINEMATIC_EPSILON)
        || (!require_position_error && error < -KINEMATIC_EPSILON)
    {
        return None;
    }

    Some(RopeJointConstraintContext {
        a_index,
        b_index,
        normal: Velocity {
            vx: dx / length,
            vy: dy / length,
        },
        inverse_mass_a,
        inverse_mass_b,
        inverse_mass_sum,
        error,
    })
}

pub(in crate::physics) fn rope_joint_should_break(world: &World, joint: RopeJoint) -> bool {
    let Some(break_distance) = sanitize_rope_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = rope_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error > break_distance + KINEMATIC_EPSILON
}

pub(in crate::physics) fn sanitize_rope_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

pub(in crate::physics) fn clear_rope_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.rope_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_rope_joint(RopeJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}
