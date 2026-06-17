use super::*;

pub(in crate::physics) fn solve_distance_joint_velocity_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.distance_joints[index] else {
            continue;
        };
        if distance_joint_should_break(world, joint) {
            if clear_distance_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_distance_joint_velocity_constraint(world, joint) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_distance_joint_position_constraints(
    world: &mut World,
    joint_indices: &[usize],
    stats: &mut RigidBodyStepStats,
) {
    for index in joint_indices.iter().copied() {
        let Some(joint) = world.distance_joints[index] else {
            continue;
        };
        if distance_joint_should_break(world, joint) {
            if clear_distance_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_distance_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

pub(in crate::physics) fn solve_distance_joint_velocity_constraint(
    world: &mut World,
    joint: DistanceJoint,
) -> bool {
    let damping = sanitize_unit_interval(joint.damping, DistanceJoint::DEFAULT_DAMPING);
    if damping <= 0.0 {
        return false;
    }
    let Some(context) = distance_joint_constraint_context(world, joint, false) else {
        return false;
    };

    let velocity_a = anchor_velocity(world, context.a_index, context.anchor_a);
    let velocity_b = anchor_velocity(world, context.b_index, context.anchor_b);
    let relative_velocity = Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    };
    let velocity_along_axis = dot_velocity(relative_velocity, context.normal);
    if velocity_along_axis.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -velocity_along_axis * damping / context.denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    apply_pair_anchor_impulse(
        world,
        PairAnchorConstraintContext {
            a_index: context.a_index,
            b_index: context.b_index,
            radius_a: context.radius_a,
            radius_b: context.radius_b,
            inverse_mass_a: context.inverse_mass_a,
            inverse_mass_b: context.inverse_mass_b,
            inverse_inertia_a: context.inverse_inertia_a,
            inverse_inertia_b: context.inverse_inertia_b,
        },
        Velocity {
            vx: context.normal.vx * impulse_magnitude,
            vy: context.normal.vy * impulse_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn solve_distance_joint_position_constraint(
    world: &mut World,
    joint: DistanceJoint,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, DistanceJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = distance_joint_constraint_context(world, joint, true) else {
        return false;
    };

    let correction_magnitude = context.error * stiffness / context.denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    apply_pair_anchor_position_correction(
        world,
        PairAnchorConstraintContext {
            a_index: context.a_index,
            b_index: context.b_index,
            radius_a: context.radius_a,
            radius_b: context.radius_b,
            inverse_mass_a: context.inverse_mass_a,
            inverse_mass_b: context.inverse_mass_b,
            inverse_inertia_a: context.inverse_inertia_a,
            inverse_inertia_b: context.inverse_inertia_b,
        },
        Velocity {
            vx: -context.normal.vx * correction_magnitude,
            vy: -context.normal.vy * correction_magnitude,
        },
    );
    true
}

pub(in crate::physics) fn distance_joint_constraint_context(
    world: &World,
    joint: DistanceJoint,
    require_position_error: bool,
) -> Option<DistanceJointConstraintContext> {
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

    let radius_a = joint_world_radius(
        world,
        a_index,
        joint.local_anchor_a_x,
        joint.local_anchor_a_y,
    );
    let radius_b = joint_world_radius(
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

    let dx = anchor_b.x - anchor_a.x;
    let dy = anchor_b.y - anchor_a.y;
    let length = dx.hypot(dy);
    if !length.is_finite() {
        return None;
    }
    let rest_length = sanitize_distance_joint_rest_length(joint.rest_length);
    let error = length - rest_length;
    if !error.is_finite() || (require_position_error && error.abs() <= KINEMATIC_EPSILON) {
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
    let denominator = joint_anchor_axis_denominator(
        radius_a,
        radius_b,
        normal,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
    );
    if denominator <= 0.0 {
        return None;
    }

    Some(DistanceJointConstraintContext {
        a_index,
        b_index,
        anchor_a,
        anchor_b,
        radius_a,
        radius_b,
        normal,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
        denominator,
        error,
    })
}

pub(in crate::physics) fn distance_joint_should_break(world: &World, joint: DistanceJoint) -> bool {
    let Some(break_distance) = sanitize_distance_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = distance_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error.abs() > break_distance + KINEMATIC_EPSILON
}

pub(in crate::physics) fn sanitize_distance_joint_break_distance(
    break_distance: f32,
) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

pub(in crate::physics) fn clear_distance_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.distance_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_distance_joint(DistanceJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_joint_zero_length_uses_positive_x_normal_when_rest_length_is_positive() {
        let mut world = World::default();
        let entity_a = world.spawn_entity();
        let entity_b = world.spawn_entity();
        world.set_transform(entity_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_transform(entity_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(entity_a, crate::components::RigidBody::dynamic(1.0));
        world.set_rigid_body(entity_b, crate::components::RigidBody::dynamic(1.0));

        let context = distance_joint_constraint_context(
            &world,
            DistanceJoint::new(entity_a, entity_b, 8.0),
            false,
        )
        .expect("positive rest length should produce a fallback constraint");

        assert_eq!(context.normal, Velocity { vx: 1.0, vy: 0.0 });
        assert_eq!(context.error, -8.0);
    }
}
