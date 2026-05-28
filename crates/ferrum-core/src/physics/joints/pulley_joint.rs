use super::*;

pub(in crate::physics) fn solve_pulley_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.pulley_joints[index] else {
            continue;
        };
        if pulley_joint_should_break(world, joint) {
            if clear_pulley_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_pulley_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations)
        {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_pulley_joint_position_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.pulley_joints[index] else {
            continue;
        };
        if pulley_joint_should_break(world, joint) {
            if clear_pulley_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_pulley_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_pulley_joint_velocity_constraint(
    world: &mut World,
    joint: PulleyJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PulleyJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, PulleyJoint::DEFAULT_DAMPING);
    if stiffness <= 0.0 && damping <= 0.0 {
        return false;
    }
    let Some(context) = pulley_joint_constraint_context(world, joint, false) else {
        return false;
    };
    let denominator = pulley_joint_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = pulley_joint_constraint_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = if stiffness > 0.0 && delta_seconds > 0.0 {
        context.error * stiffness / (delta_seconds * iteration_count)
    } else {
        0.0
    };
    let damping_velocity = relative_velocity * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_pulley_joint_anchor_impulse(world, context, impulse_magnitude);
    true
}

pub(in crate::physics) fn solve_pulley_joint_position_constraint(
    world: &mut World,
    joint: PulleyJoint,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PulleyJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = pulley_joint_constraint_context(world, joint, true) else {
        return false;
    };
    let denominator = pulley_joint_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let impulse_magnitude = -context.error * stiffness / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_pulley_joint_anchor_position_correction(world, context, impulse_magnitude);
    true
}

pub(in crate::physics) fn pulley_joint_constraint_context(
    world: &World,
    joint: PulleyJoint,
    require_position_error: bool,
) -> Option<PulleyJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
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
    let ground_anchor_a = Transform2D {
        x: sanitize_finite(joint.ground_anchor_a_x),
        y: sanitize_finite(joint.ground_anchor_a_y),
    };
    let ground_anchor_b = Transform2D {
        x: sanitize_finite(joint.ground_anchor_b_x),
        y: sanitize_finite(joint.ground_anchor_b_y),
    };
    let delta_a = Velocity {
        vx: anchor_a.x - ground_anchor_a.x,
        vy: anchor_a.y - ground_anchor_a.y,
    };
    let delta_b = Velocity {
        vx: anchor_b.x - ground_anchor_b.x,
        vy: anchor_b.y - ground_anchor_b.y,
    };
    let length_a = delta_a.vx.hypot(delta_a.vy);
    let length_b = delta_b.vx.hypot(delta_b.vy);
    if !length_a.is_finite() || !length_b.is_finite() {
        return None;
    }
    let ratio = sanitize_pulley_joint_ratio(joint.ratio);
    let rest_length = sanitize_pulley_joint_rest_length(joint.rest_length);
    let error = length_a + ratio * length_b - rest_length;
    if !error.is_finite() || (require_position_error && error.abs() <= KINEMATIC_EPSILON) {
        return None;
    }

    Some(PulleyJointConstraintContext {
        a_index,
        b_index,
        anchor_a,
        anchor_b,
        radius_a,
        radius_b,
        normal_a: normalized_pulley_segment(delta_a),
        normal_b: normalized_pulley_segment(delta_b),
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
        ratio,
        error,
    })
}

pub(in crate::physics) fn pulley_joint_constraint_velocity(
    world: &World,
    context: PulleyJointConstraintContext,
) -> f32 {
    let velocity_a = anchor_velocity(world, context.a_index, context.anchor_a);
    let velocity_b = anchor_velocity(world, context.b_index, context.anchor_b);
    dot_velocity(velocity_a, context.normal_a)
        + context.ratio * dot_velocity(velocity_b, context.normal_b)
}

pub(in crate::physics) fn pulley_joint_denominator(context: PulleyJointConstraintContext) -> f32 {
    let radius_a_cross_normal = cross_velocity(context.radius_a, context.normal_a);
    let radius_b_cross_normal = cross_velocity(context.radius_b, context.normal_b);
    let effective_mass_a = context.inverse_mass_a
        + context.inverse_inertia_a * radius_a_cross_normal * radius_a_cross_normal;
    let effective_mass_b = context.inverse_mass_b
        + context.inverse_inertia_b * radius_b_cross_normal * radius_b_cross_normal;
    effective_mass_a + context.ratio * context.ratio * effective_mass_b
}

pub(in crate::physics) fn normalized_pulley_segment(segment: Velocity) -> Velocity {
    let length_squared = velocity_len_squared(segment);
    if length_squared <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
        return Velocity { vx: 1.0, vy: 0.0 };
    }

    let length = length_squared.sqrt();
    Velocity {
        vx: segment.vx / length,
        vy: segment.vy / length,
    }
}

pub(in crate::physics) fn pulley_joint_should_break(world: &World, joint: PulleyJoint) -> bool {
    let Some(break_distance) = sanitize_pulley_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = pulley_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error.abs() > break_distance + KINEMATIC_EPSILON
}

pub(in crate::physics) fn sanitize_pulley_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

pub(in crate::physics) fn clear_pulley_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.pulley_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_pulley_joint(PulleyJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_pulley_segment_falls_back_to_positive_x() {
        assert_eq!(
            normalized_pulley_segment(Velocity { vx: 0.0, vy: 0.0 }),
            Velocity { vx: 1.0, vy: 0.0 }
        );
    }
}
