use crate::components::{Transform2D, Velocity};
use crate::world::World;

use super::math::{cross_scalar_velocity, finite_angular_velocity, finite_velocity};

pub(in crate::physics) fn contact_point_velocity(
    world: &World,
    index: usize,
    point: Transform2D,
) -> Velocity {
    let linear_velocity = finite_velocity(world.velocity_at_index_or_default(index));
    let angular_velocity =
        finite_angular_velocity(world.angular_velocity_at_index_or_default(index))
            .radians_per_second;
    let transform = world.transform_at_index(index).unwrap_or_default();
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
        let mut velocity = world.velocity_at_index_or_default(a_index);
        velocity.vx -= impulse.vx * inverse_mass_a;
        velocity.vy -= impulse.vy * inverse_mass_a;
        world.set_velocity_at_index(a_index, finite_velocity(velocity));
    }
    if inverse_mass_b > 0.0 {
        let mut velocity = world.velocity_at_index_or_default(b_index);
        velocity.vx += impulse.vx * inverse_mass_b;
        velocity.vy += impulse.vy * inverse_mass_b;
        world.set_velocity_at_index(b_index, finite_velocity(velocity));
    }
}
