use crate::components::{Rotation2D, Transform2D, Velocity};
use crate::world::World;

use super::super::math::{
    cross_scalar_velocity, cross_velocity, finite_rotation, finite_transform, finite_velocity,
    sanitize_finite, velocity_len_squared,
};
use super::CONTACT_IMPULSE_EPSILON;

#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::physics) struct RigidSplitImpulseState {
    linear_velocities: Vec<Velocity>,
    angular_velocities: Vec<f32>,
}

impl RigidSplitImpulseState {
    pub(in crate::physics) fn reset_from_world(&mut self, world: &World) {
        self.linear_velocities
            .resize(world.transforms.len(), Velocity::default());
        self.linear_velocities.fill(Velocity::default());
        self.angular_velocities.resize(world.transforms.len(), 0.0);
        self.angular_velocities.fill(0.0);
    }

    pub(super) fn relative_contact_velocity_with_radii(
        &self,
        a_index: usize,
        b_index: usize,
        radius_a: Velocity,
        radius_b: Velocity,
    ) -> Velocity {
        let velocity_a = self.contact_point_velocity_at_radius(a_index, radius_a);
        let velocity_b = self.contact_point_velocity_at_radius(b_index, radius_b);
        Velocity {
            vx: velocity_b.vx - velocity_a.vx,
            vy: velocity_b.vy - velocity_a.vy,
        }
    }

    fn contact_point_velocity_at_radius(&self, index: usize, radius: Velocity) -> Velocity {
        let linear_velocity = self
            .linear_velocities
            .get(index)
            .copied()
            .unwrap_or_default();
        let angular_velocity = self.angular_velocities.get(index).copied().unwrap_or(0.0);
        let angular_velocity_at_point = cross_scalar_velocity(angular_velocity, radius);
        Velocity {
            vx: linear_velocity.vx + angular_velocity_at_point.vx,
            vy: linear_velocity.vy + angular_velocity_at_point.vy,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn apply_contact_impulse_at_radii(
        &mut self,
        a_index: usize,
        b_index: usize,
        radius_a: Velocity,
        radius_b: Velocity,
        impulse: Velocity,
        inverse_mass_a: f32,
        inverse_mass_b: f32,
        inverse_inertia_a: f32,
        inverse_inertia_b: f32,
    ) {
        if inverse_mass_a > 0.0 {
            if let Some(velocity) = self.linear_velocities.get_mut(a_index) {
                velocity.vx -= impulse.vx * inverse_mass_a;
                velocity.vy -= impulse.vy * inverse_mass_a;
                *velocity = finite_velocity(*velocity);
            }
        }
        if inverse_mass_b > 0.0 {
            if let Some(velocity) = self.linear_velocities.get_mut(b_index) {
                velocity.vx += impulse.vx * inverse_mass_b;
                velocity.vy += impulse.vy * inverse_mass_b;
                *velocity = finite_velocity(*velocity);
            }
        }

        if inverse_inertia_a > 0.0 {
            if let Some(angular_velocity) = self.angular_velocities.get_mut(a_index) {
                *angular_velocity = sanitize_finite(
                    *angular_velocity - cross_velocity(radius_a, impulse) * inverse_inertia_a,
                );
            }
        }
        if inverse_inertia_b > 0.0 {
            if let Some(angular_velocity) = self.angular_velocities.get_mut(b_index) {
                *angular_velocity = sanitize_finite(
                    *angular_velocity + cross_velocity(radius_b, impulse) * inverse_inertia_b,
                );
            }
        }
    }

    pub(in crate::physics) fn apply_to_world(&self, world: &mut World, delta_seconds: f32) {
        if !delta_seconds.is_finite() || delta_seconds <= 0.0 {
            return;
        }

        for (index, split_velocity) in self.linear_velocities.iter().copied().enumerate() {
            if velocity_len_squared(split_velocity)
                > CONTACT_IMPULSE_EPSILON * CONTACT_IMPULSE_EPSILON
            {
                if let Some(transform) = world.transforms.get_mut(index).and_then(Option::as_mut) {
                    *transform = finite_transform(Transform2D {
                        x: transform.x + split_velocity.vx * delta_seconds,
                        y: transform.y + split_velocity.vy * delta_seconds,
                    });
                }
            }
        }

        for (index, split_angular_velocity) in self.angular_velocities.iter().copied().enumerate() {
            if split_angular_velocity.abs() > CONTACT_IMPULSE_EPSILON {
                let rotation = world.rotations[index].get_or_insert_with(Rotation2D::default);
                rotation.radians = finite_rotation(Rotation2D {
                    radians: rotation.radians + split_angular_velocity * delta_seconds,
                })
                .radians;
            }
        }
    }
}
