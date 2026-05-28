use crate::components::{Rotation2D, Transform2D, Velocity};
use crate::physics::{apply_contact_impulse, rigid_body_inverse_inertia, rigid_body_inverse_mass};
use crate::world::World;

use super::super::math::{
    cross_scalar_velocity, cross_velocity, finite_angular_velocity, finite_rotation,
    finite_transform, finite_velocity,
};
use super::contact_filter::should_solve_rigid_contact;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct RigidContactMassContext {
    pub(super) a_index: usize,
    pub(super) b_index: usize,
    pub(super) transform_a: Transform2D,
    pub(super) transform_b: Transform2D,
    pub(super) inverse_mass_a: f32,
    pub(super) inverse_mass_b: f32,
    pub(super) inverse_inertia_a: f32,
    pub(super) inverse_inertia_b: f32,
}

impl RigidContactMassContext {
    pub(super) fn inverse_mass_sum(self) -> f32 {
        self.inverse_mass_a + self.inverse_mass_b
    }

    pub(super) fn radius_a(self, point: Transform2D) -> Velocity {
        Velocity {
            vx: point.x - self.transform_a.x,
            vy: point.y - self.transform_a.y,
        }
    }

    pub(super) fn radius_b(self, point: Transform2D) -> Velocity {
        Velocity {
            vx: point.x - self.transform_b.x,
            vy: point.y - self.transform_b.y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct RigidContactBlockMatrix {
    pub(super) k11: f32,
    pub(super) k12: f32,
    pub(super) k22: f32,
}

pub(super) fn rigid_contact_mass_context(
    world: &World,
    a_index: usize,
    b_index: usize,
) -> Option<RigidContactMassContext> {
    if !should_solve_rigid_contact(world, a_index, b_index) {
        return None;
    }

    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    if inverse_mass_a + inverse_mass_b <= 0.0 {
        return None;
    }

    Some(RigidContactMassContext {
        a_index,
        b_index,
        transform_a: world
            .transforms
            .get(a_index)
            .copied()
            .flatten()
            .unwrap_or_default(),
        transform_b: world
            .transforms
            .get(b_index)
            .copied()
            .flatten()
            .unwrap_or_default(),
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a: rigid_body_inverse_inertia(world, a_index),
        inverse_inertia_b: rigid_body_inverse_inertia(world, b_index),
    })
}

pub(super) fn contact_normal_block_matrix(
    context: RigidContactMassContext,
    point_a: Transform2D,
    point_b: Transform2D,
    normal: Velocity,
) -> Option<RigidContactBlockMatrix> {
    let radius_a1 = context.radius_a(point_a);
    let radius_a2 = context.radius_a(point_b);
    let radius_b1 = context.radius_b(point_a);
    let radius_b2 = context.radius_b(point_b);
    let radius_a1_cross_normal = cross_velocity(radius_a1, normal);
    let radius_a2_cross_normal = cross_velocity(radius_a2, normal);
    let radius_b1_cross_normal = cross_velocity(radius_b1, normal);
    let radius_b2_cross_normal = cross_velocity(radius_b2, normal);
    let inverse_mass_sum = context.inverse_mass_sum();
    let matrix = RigidContactBlockMatrix {
        k11: inverse_mass_sum
            + context.inverse_inertia_a * radius_a1_cross_normal * radius_a1_cross_normal
            + context.inverse_inertia_b * radius_b1_cross_normal * radius_b1_cross_normal,
        k12: inverse_mass_sum
            + context.inverse_inertia_a * radius_a1_cross_normal * radius_a2_cross_normal
            + context.inverse_inertia_b * radius_b1_cross_normal * radius_b2_cross_normal,
        k22: inverse_mass_sum
            + context.inverse_inertia_a * radius_a2_cross_normal * radius_a2_cross_normal
            + context.inverse_inertia_b * radius_b2_cross_normal * radius_b2_cross_normal,
    };

    (matrix.k11.is_finite()
        && matrix.k12.is_finite()
        && matrix.k22.is_finite()
        && matrix.k11 > 0.0
        && matrix.k22 > 0.0)
        .then_some(matrix)
}

pub(super) fn contact_constraint_tangent(normal: Velocity) -> Velocity {
    Velocity {
        vx: -normal.vy,
        vy: normal.vx,
    }
}

pub(super) fn relative_contact_velocity(
    world: &World,
    context: RigidContactMassContext,
    point: Transform2D,
) -> Velocity {
    let velocity_a =
        contact_point_velocity_at_radius(world, context.a_index, context.radius_a(point));
    let velocity_b =
        contact_point_velocity_at_radius(world, context.b_index, context.radius_b(point));
    Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    }
}

fn contact_point_velocity_at_radius(world: &World, index: usize, radius: Velocity) -> Velocity {
    let linear_velocity = finite_velocity(world.velocities[index].unwrap_or_default());
    let angular_velocity = finite_angular_velocity(
        world
            .angular_velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    )
    .radians_per_second;
    let angular_velocity_at_point = cross_scalar_velocity(angular_velocity, radius);
    Velocity {
        vx: linear_velocity.vx + angular_velocity_at_point.vx,
        vy: linear_velocity.vy + angular_velocity_at_point.vy,
    }
}

pub(super) fn contact_impulse_denominator(
    context: RigidContactMassContext,
    point: Transform2D,
    direction: Velocity,
) -> f32 {
    let radius_a = context.radius_a(point);
    let radius_b = context.radius_b(point);
    let radius_a_cross_direction = cross_velocity(radius_a, direction);
    let radius_b_cross_direction = cross_velocity(radius_b, direction);
    context.inverse_mass_sum()
        + context.inverse_inertia_a * radius_a_cross_direction * radius_a_cross_direction
        + context.inverse_inertia_b * radius_b_cross_direction * radius_b_cross_direction
}

pub(super) fn apply_contact_impulse_at_point(
    world: &mut World,
    context: RigidContactMassContext,
    point: Transform2D,
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
    let radius_a = context.radius_a(point);
    let radius_b = context.radius_b(point);
    if context.inverse_inertia_a > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.a_index].unwrap_or_default();
        angular_velocity.radians_per_second -=
            cross_velocity(radius_a, impulse) * context.inverse_inertia_a;
        world.angular_velocities[context.a_index] = Some(finite_angular_velocity(angular_velocity));
    }
    if context.inverse_inertia_b > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.b_index].unwrap_or_default();
        angular_velocity.radians_per_second +=
            cross_velocity(radius_b, impulse) * context.inverse_inertia_b;
        world.angular_velocities[context.b_index] = Some(finite_angular_velocity(angular_velocity));
    }
}

pub(super) fn apply_contact_position_impulse_at_point(
    world: &mut World,
    context: RigidContactMassContext,
    point: Transform2D,
    impulse: Velocity,
) {
    let radius_a = context.radius_a(point);
    let radius_b = context.radius_b(point);
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            *transform = finite_transform(Transform2D {
                x: transform.x - impulse.vx * context.inverse_mass_a,
                y: transform.y - impulse.vy * context.inverse_mass_a,
            });
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            *transform = finite_transform(Transform2D {
                x: transform.x + impulse.vx * context.inverse_mass_b,
                y: transform.y + impulse.vy * context.inverse_mass_b,
            });
        }
    }
    if context.inverse_inertia_a > 0.0 {
        let rotation = world.rotations[context.a_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians
                - cross_velocity(radius_a, impulse) * context.inverse_inertia_a,
        })
        .radians;
    }
    if context.inverse_inertia_b > 0.0 {
        let rotation = world.rotations[context.b_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians
                + cross_velocity(radius_b, impulse) * context.inverse_inertia_b,
        })
        .radians;
    }
}
