use crate::components::{Rotation2D, Transform2D, Velocity};
use crate::world::World;

use super::super::math::{
    cross_velocity, finite_angular_velocity, finite_rotation, finite_transform, finite_velocity,
};
use super::super::{apply_contact_impulse, contact_point_velocity};
use super::{
    GearJointConstraintContext, PrismaticJointConstraintContext, PulleyJointConstraintContext,
    RevoluteJointConstraintContext,
};

pub(super) fn relative_anchor_velocity(
    world: &World,
    context: RevoluteJointConstraintContext,
) -> Velocity {
    let velocity_a = anchor_velocity(world, context.a_index, context.anchor_a);
    let velocity_b = anchor_velocity(world, context.b_index, context.anchor_b);
    Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    }
}

pub(super) fn prismatic_joint_relative_anchor_velocity(
    world: &World,
    context: PrismaticJointConstraintContext,
) -> Velocity {
    let velocity_a = anchor_velocity(world, context.a_index, context.anchor_a);
    let velocity_b = anchor_velocity(world, context.b_index, context.anchor_b);
    Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    }
}

pub(super) fn revolute_joint_relative_angular_velocity(
    world: &World,
    context: RevoluteJointConstraintContext,
) -> f32 {
    let angular_velocity_a = world
        .angular_velocities
        .get(context.a_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    let angular_velocity_b = world
        .angular_velocities
        .get(context.b_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    angular_velocity_b.radians_per_second - angular_velocity_a.radians_per_second
}

pub(super) fn prismatic_joint_relative_angular_velocity(
    world: &World,
    context: PrismaticJointConstraintContext,
) -> f32 {
    let angular_velocity_a = world
        .angular_velocities
        .get(context.a_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    let angular_velocity_b = world
        .angular_velocities
        .get(context.b_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    angular_velocity_b.radians_per_second - angular_velocity_a.radians_per_second
}

pub(super) fn gear_joint_relative_angular_velocity(
    world: &World,
    context: GearJointConstraintContext,
) -> f32 {
    let angular_velocity_a = world
        .angular_velocities
        .get(context.a_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    let angular_velocity_b = world
        .angular_velocities
        .get(context.b_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    angular_velocity_b.radians_per_second + context.ratio * angular_velocity_a.radians_per_second
}

pub(super) fn anchor_velocity(world: &World, index: usize, anchor: Transform2D) -> Velocity {
    contact_point_velocity(world, index, anchor)
}

pub(super) fn apply_revolute_joint_anchor_impulse(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    impulse: Velocity,
) {
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        impulse,
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    apply_angular_impulse_delta(
        world,
        context.a_index,
        -cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_angular_impulse_delta(
        world,
        context.b_index,
        cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_pulley_joint_anchor_impulse(
    world: &mut World,
    context: PulleyJointConstraintContext,
    impulse_magnitude: f32,
) {
    let impulse_a = Velocity {
        vx: context.normal_a.vx * impulse_magnitude,
        vy: context.normal_a.vy * impulse_magnitude,
    };
    let impulse_b = Velocity {
        vx: context.normal_b.vx * impulse_magnitude * context.ratio,
        vy: context.normal_b.vy * impulse_magnitude * context.ratio,
    };
    apply_single_body_anchor_impulse(
        world,
        context.a_index,
        context.radius_a,
        impulse_a,
        context.inverse_mass_a,
        context.inverse_inertia_a,
    );
    apply_single_body_anchor_impulse(
        world,
        context.b_index,
        context.radius_b,
        impulse_b,
        context.inverse_mass_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_single_body_anchor_impulse(
    world: &mut World,
    index: usize,
    radius: Velocity,
    impulse: Velocity,
    inverse_mass: f32,
    inverse_inertia: f32,
) {
    if inverse_mass > 0.0 {
        let mut velocity = world.velocities[index].unwrap_or_default();
        velocity.vx += impulse.vx * inverse_mass;
        velocity.vy += impulse.vy * inverse_mass;
        world.velocities[index] = Some(finite_velocity(velocity));
    }
    apply_angular_impulse_delta(
        world,
        index,
        cross_velocity(radius, impulse) * inverse_inertia,
        inverse_inertia,
    );
}

pub(super) fn apply_revolute_joint_angular_impulse(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    angular_impulse: f32,
) {
    apply_angular_impulse_delta(
        world,
        context.a_index,
        -angular_impulse * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_angular_impulse_delta(
        world,
        context.b_index,
        angular_impulse * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_prismatic_joint_anchor_impulse(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    impulse: Velocity,
) {
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        impulse,
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    apply_angular_impulse_delta(
        world,
        context.a_index,
        -cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_angular_impulse_delta(
        world,
        context.b_index,
        cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_prismatic_joint_angular_impulse(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    angular_impulse: f32,
) {
    apply_angular_impulse_delta(
        world,
        context.a_index,
        -angular_impulse * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_angular_impulse_delta(
        world,
        context.b_index,
        angular_impulse * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_gear_joint_angular_impulse(
    world: &mut World,
    context: GearJointConstraintContext,
    angular_impulse: f32,
) {
    apply_angular_impulse_delta(
        world,
        context.a_index,
        angular_impulse * context.ratio * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_angular_impulse_delta(
        world,
        context.b_index,
        angular_impulse * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_revolute_joint_anchor_position_correction(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    impulse: Velocity,
) {
    apply_pair_position_delta(
        world,
        context.a_index,
        context.b_index,
        impulse,
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    apply_rotation_delta(
        world,
        context.a_index,
        -cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_rotation_delta(
        world,
        context.b_index,
        cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_pulley_joint_anchor_position_correction(
    world: &mut World,
    context: PulleyJointConstraintContext,
    impulse_magnitude: f32,
) {
    let impulse_a = Velocity {
        vx: context.normal_a.vx * impulse_magnitude,
        vy: context.normal_a.vy * impulse_magnitude,
    };
    let impulse_b = Velocity {
        vx: context.normal_b.vx * impulse_magnitude * context.ratio,
        vy: context.normal_b.vy * impulse_magnitude * context.ratio,
    };
    apply_single_body_anchor_position_correction(
        world,
        context.a_index,
        context.radius_a,
        impulse_a,
        context.inverse_mass_a,
        context.inverse_inertia_a,
    );
    apply_single_body_anchor_position_correction(
        world,
        context.b_index,
        context.radius_b,
        impulse_b,
        context.inverse_mass_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_single_body_anchor_position_correction(
    world: &mut World,
    index: usize,
    radius: Velocity,
    impulse: Velocity,
    inverse_mass: f32,
    inverse_inertia: f32,
) {
    if inverse_mass > 0.0 {
        if let Some(transform) = world.transforms[index].as_mut() {
            *transform = finite_transform(Transform2D {
                x: transform.x + impulse.vx * inverse_mass,
                y: transform.y + impulse.vy * inverse_mass,
            });
        }
    }
    apply_rotation_delta(
        world,
        index,
        cross_velocity(radius, impulse) * inverse_inertia,
        inverse_inertia,
    );
}

pub(super) fn apply_revolute_joint_angular_position_correction(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    angular_impulse: f32,
) {
    apply_rotation_delta(
        world,
        context.a_index,
        -angular_impulse * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_rotation_delta(
        world,
        context.b_index,
        angular_impulse * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_prismatic_joint_anchor_position_correction(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    impulse: Velocity,
) {
    apply_pair_position_delta(
        world,
        context.a_index,
        context.b_index,
        impulse,
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    apply_rotation_delta(
        world,
        context.a_index,
        -cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_rotation_delta(
        world,
        context.b_index,
        cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_prismatic_joint_angular_position_correction(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    angular_impulse: f32,
) {
    apply_rotation_delta(
        world,
        context.a_index,
        -angular_impulse * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_rotation_delta(
        world,
        context.b_index,
        angular_impulse * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

pub(super) fn apply_gear_joint_angular_position_correction(
    world: &mut World,
    context: GearJointConstraintContext,
    angular_impulse: f32,
) {
    apply_rotation_delta(
        world,
        context.a_index,
        angular_impulse * context.ratio * context.inverse_inertia_a,
        context.inverse_inertia_a,
    );
    apply_rotation_delta(
        world,
        context.b_index,
        angular_impulse * context.inverse_inertia_b,
        context.inverse_inertia_b,
    );
}

fn apply_angular_impulse_delta(
    world: &mut World,
    index: usize,
    delta_radians_per_second: f32,
    inverse_inertia: f32,
) {
    if inverse_inertia <= 0.0 {
        return;
    }
    let mut angular_velocity = world.angular_velocities[index].unwrap_or_default();
    angular_velocity.radians_per_second += delta_radians_per_second;
    world.angular_velocities[index] = Some(finite_angular_velocity(angular_velocity));
}

fn apply_pair_position_delta(
    world: &mut World,
    a_index: usize,
    b_index: usize,
    impulse: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
) {
    if inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[a_index].as_mut() {
            transform.x -= impulse.vx * inverse_mass_a;
            transform.y -= impulse.vy * inverse_mass_a;
        }
    }
    if inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[b_index].as_mut() {
            transform.x += impulse.vx * inverse_mass_b;
            transform.y += impulse.vy * inverse_mass_b;
        }
    }
}

fn apply_rotation_delta(world: &mut World, index: usize, delta_radians: f32, inverse_inertia: f32) {
    if inverse_inertia <= 0.0 {
        return;
    }
    let rotation = world.rotations[index].get_or_insert_with(Rotation2D::default);
    rotation.radians = finite_rotation(Rotation2D {
        radians: rotation.radians + delta_radians,
    })
    .radians;
}
