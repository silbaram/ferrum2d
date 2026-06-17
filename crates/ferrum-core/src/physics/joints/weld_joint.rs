use super::prismatic_joint::{
    prismatic_joint_constraint_context, solve_prismatic_joint_angular_position_constraint,
    solve_prismatic_joint_angular_velocity_constraint,
    solve_prismatic_joint_limit_position_constraint,
    solve_prismatic_joint_limit_velocity_constraint,
    solve_prismatic_joint_linear_position_constraint,
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
    if stiffness > 0.0 && angular_stiffness > 0.0 {
        if solve_weld_joint_coupled_position_constraint(
            world,
            prismatic,
            stiffness,
            angular_stiffness,
        ) {
            applied = true;
        } else {
            if solve_weld_joint_anchor_position_constraint(world, prismatic, stiffness) {
                applied = true;
            }
            if solve_prismatic_joint_angular_position_constraint(
                world,
                prismatic,
                angular_stiffness,
            ) {
                applied = true;
            }
        }
    } else {
        if stiffness > 0.0
            && solve_weld_joint_anchor_position_constraint(world, prismatic, stiffness)
        {
            applied = true;
        }
        if angular_stiffness > 0.0
            && solve_prismatic_joint_angular_position_constraint(
                world,
                prismatic,
                angular_stiffness,
            )
        {
            applied = true;
        }
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
    let mut applied = false;
    if solve_prismatic_joint_linear_position_constraint(world, joint, stiffness) {
        applied = true;
    }
    if solve_prismatic_joint_limit_position_constraint(world, joint, stiffness) {
        applied = true;
    }
    applied
}

pub(in crate::physics) fn solve_weld_joint_coupled_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
    angular_stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let error = Velocity {
        vx: context.anchor_b.x - context.anchor_a.x,
        vy: context.anchor_b.y - context.anchor_a.y,
    };
    let linear_error = velocity_len_squared(error) > KINEMATIC_EPSILON * KINEMATIC_EPSILON;
    let angular_error = context.angular_error.abs() > KINEMATIC_EPSILON;
    if !linear_error && !angular_error {
        return false;
    }

    let radius_a_perpendicular = Velocity {
        vx: -context.radius_a.vy,
        vy: context.radius_a.vx,
    };
    let radius_b_perpendicular = Velocity {
        vx: -context.radius_b.vy,
        vy: context.radius_b.vx,
    };
    let inverse_mass_sum = context.inverse_mass_a + context.inverse_mass_b;
    let mass = WeldPositionMass {
        k11: inverse_mass_sum
            + context.inverse_inertia_a * radius_a_perpendicular.vx * radius_a_perpendicular.vx
            + context.inverse_inertia_b * radius_b_perpendicular.vx * radius_b_perpendicular.vx,
        k12: context.inverse_inertia_a * radius_a_perpendicular.vx * radius_a_perpendicular.vy
            + context.inverse_inertia_b * radius_b_perpendicular.vx * radius_b_perpendicular.vy,
        k13: context.inverse_inertia_a * radius_a_perpendicular.vx
            + context.inverse_inertia_b * radius_b_perpendicular.vx,
        k22: inverse_mass_sum
            + context.inverse_inertia_a * radius_a_perpendicular.vy * radius_a_perpendicular.vy
            + context.inverse_inertia_b * radius_b_perpendicular.vy * radius_b_perpendicular.vy,
        k23: context.inverse_inertia_a * radius_a_perpendicular.vy
            + context.inverse_inertia_b * radius_b_perpendicular.vy,
        k33: context.inverse_inertia_a + context.inverse_inertia_b,
    };
    let rhs = WeldPositionRhs {
        x: -error.vx * stiffness,
        y: -error.vy * stiffness,
        angle: -context.angular_error * angular_stiffness,
    };

    let Some(correction) = solve_weld_joint_position_system(mass, rhs) else {
        return false;
    };
    if velocity_len_squared(correction.impulse) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON
        && correction.angular_impulse.abs() <= KINEMATIC_EPSILON
    {
        return false;
    }

    apply_prismatic_joint_anchor_position_correction(world, context, correction.impulse);
    apply_prismatic_joint_angular_position_correction(world, context, correction.angular_impulse);
    true
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct WeldPositionMass {
    k11: f32,
    k12: f32,
    k13: f32,
    k22: f32,
    k23: f32,
    k33: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct WeldPositionRhs {
    x: f32,
    y: f32,
    angle: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct WeldPositionCorrection {
    impulse: Velocity,
    angular_impulse: f32,
}

fn solve_weld_joint_position_system(
    mass: WeldPositionMass,
    rhs: WeldPositionRhs,
) -> Option<WeldPositionCorrection> {
    let determinant = mass.k11 * (mass.k22 * mass.k33 - mass.k23 * mass.k23)
        - mass.k12 * (mass.k12 * mass.k33 - mass.k23 * mass.k13)
        + mass.k13 * (mass.k12 * mass.k23 - mass.k22 * mass.k13);
    if !determinant.is_finite() || determinant.abs() <= KINEMATIC_EPSILON {
        return None;
    }

    let impulse_x = (rhs.x * (mass.k22 * mass.k33 - mass.k23 * mass.k23)
        - mass.k12 * (rhs.y * mass.k33 - mass.k23 * rhs.angle)
        + mass.k13 * (rhs.y * mass.k23 - mass.k22 * rhs.angle))
        / determinant;
    let impulse_y = (mass.k11 * (rhs.y * mass.k33 - mass.k23 * rhs.angle)
        - rhs.x * (mass.k12 * mass.k33 - mass.k23 * mass.k13)
        + mass.k13 * (mass.k12 * rhs.angle - rhs.y * mass.k13))
        / determinant;
    let angular_impulse = (mass.k11 * (mass.k22 * rhs.angle - rhs.y * mass.k23)
        - mass.k12 * (mass.k12 * rhs.angle - rhs.y * mass.k13)
        + rhs.x * (mass.k12 * mass.k23 - mass.k22 * mass.k13))
        / determinant;

    if !impulse_x.is_finite() || !impulse_y.is_finite() || !angular_impulse.is_finite() {
        return None;
    }
    Some(WeldPositionCorrection {
        impulse: Velocity {
            vx: impulse_x,
            vy: impulse_y,
        },
        angular_impulse,
    })
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
