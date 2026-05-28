use crate::components::{PhysicsMaterial, Velocity};
use crate::physics::math::dot_velocity;

pub(super) fn contact_surface_velocity(
    material_a: PhysicsMaterial,
    material_b: PhysicsMaterial,
    tangent: Velocity,
) -> f32 {
    dot_velocity(
        Velocity {
            vx: material_a.surface_velocity.vx - material_b.surface_velocity.vx,
            vy: material_a.surface_velocity.vy - material_b.surface_velocity.vy,
        },
        tangent,
    )
}
