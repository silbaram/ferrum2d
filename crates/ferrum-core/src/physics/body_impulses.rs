use crate::components::{Transform2D, Velocity};
use crate::world::World;

use super::math::{cross_scalar_velocity, finite_angular_velocity, finite_velocity};

pub(in crate::physics) fn contact_point_velocity(
    world: &World,
    index: usize,
    point: Transform2D,
) -> Velocity {
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
    let transform = world
        .transforms
        .get(index)
        .copied()
        .flatten()
        .unwrap_or_default();
    let radius = Velocity {
        vx: point.x - transform.x,
        vy: point.y - transform.y,
    };
    let angular_velocity_at_point = cross_scalar_velocity(angular_velocity, radius);
    Velocity {
        vx: linear_velocity.vx + angular_velocity_at_point.vx,
        vy: linear_velocity.vy + angular_velocity_at_point.vy,
    }
}

pub(in crate::physics) fn apply_contact_impulse(
    world: &mut World,
    a_index: usize,
    b_index: usize,
    impulse: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
) {
    if inverse_mass_a > 0.0 {
        let mut velocity = world.velocities[a_index].unwrap_or_default();
        velocity.vx -= impulse.vx * inverse_mass_a;
        velocity.vy -= impulse.vy * inverse_mass_a;
        world.velocities[a_index] = Some(finite_velocity(velocity));
    }
    if inverse_mass_b > 0.0 {
        let mut velocity = world.velocities[b_index].unwrap_or_default();
        velocity.vx += impulse.vx * inverse_mass_b;
        velocity.vy += impulse.vy * inverse_mass_b;
        world.velocities[b_index] = Some(finite_velocity(velocity));
    }
}
