use super::*;

pub(in crate::physics) fn solve_spring_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.spring_joints[index] else {
            continue;
        };
        if spring_joint_should_break(world, joint) {
            if clear_spring_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_spring_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations)
        {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_spring_joint_velocity_constraint(
    world: &mut World,
    joint: SpringJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, SpringJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, SpringJoint::DEFAULT_DAMPING);
    if stiffness <= 0.0 && damping <= 0.0 {
        return false;
    }
    let Some(context) = spring_joint_constraint_context(world, joint) else {
        return false;
    };

    let velocity_a = world.velocities[context.a_index].unwrap_or_default();
    let velocity_b = world.velocities[context.b_index].unwrap_or_default();
    let relative_velocity = Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    };
    let velocity_along_axis = dot_velocity(relative_velocity, context.normal);
    let iteration_count = velocity_iterations.max(1) as f32;
    let spring_velocity = context.error * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = velocity_along_axis * damping;
    let correction_velocity = spring_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / context.inverse_mass_sum;
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

pub(in crate::physics) fn spring_joint_constraint_context(
    world: &World,
    joint: SpringJoint,
) -> Option<SpringJointConstraintContext> {
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
    if !length.is_finite() {
        return None;
    }
    let rest_length = sanitize_spring_joint_rest_length(joint.rest_length);
    let error = length - rest_length;
    if !error.is_finite() {
        return None;
    }

    let normal = if length > KINEMATIC_EPSILON {
        Velocity {
            vx: dx / length,
            vy: dy / length,
        }
    } else if rest_length > KINEMATIC_EPSILON {
        Velocity { vx: 1.0, vy: 0.0 }
    } else {
        return None;
    };

    Some(SpringJointConstraintContext {
        a_index,
        b_index,
        normal,
        inverse_mass_a,
        inverse_mass_b,
        inverse_mass_sum,
        error,
    })
}

pub(in crate::physics) fn spring_joint_should_break(world: &World, joint: SpringJoint) -> bool {
    let Some(break_distance) = sanitize_spring_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = spring_joint_constraint_context(world, joint) else {
        return false;
    };
    context.error.abs() > break_distance + KINEMATIC_EPSILON
}

pub(in crate::physics) fn sanitize_spring_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

pub(in crate::physics) fn clear_spring_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.spring_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_spring_joint(SpringJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spring_joint_zero_length_uses_positive_x_normal_when_rest_length_is_positive() {
        let mut world = World::default();
        let entity_a = world.spawn_entity();
        let entity_b = world.spawn_entity();
        world.set_transform(entity_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_transform(entity_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(entity_a, crate::components::RigidBody::dynamic(1.0));
        world.set_rigid_body(entity_b, crate::components::RigidBody::dynamic(1.0));

        let context =
            spring_joint_constraint_context(&world, SpringJoint::new(entity_a, entity_b, 8.0))
                .expect("positive rest length should produce a fallback constraint");

        assert_eq!(context.normal, Velocity { vx: 1.0, vy: 0.0 });
        assert_eq!(context.error, -8.0);
    }
}
