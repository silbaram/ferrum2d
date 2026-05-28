use crate::components::{RigidBody, RigidBodyType};
use crate::world::World;

use super::math::sanitize_non_negative;

#[inline]
pub(in crate::physics) fn has_disabled_rigid_body(world: &World, index: usize) -> bool {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .is_some_and(|body| !body.enabled)
}

#[inline]
pub(in crate::physics) fn rigid_body_inverse_mass(world: &World, index: usize) -> f32 {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .map(sanitized_inverse_mass)
        .unwrap_or(0.0)
}

#[inline]
pub(in crate::physics) fn rigid_body_inverse_inertia(world: &World, index: usize) -> f32 {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .map(sanitized_inverse_inertia)
        .unwrap_or(0.0)
}

#[inline]
pub(super) fn sanitized_inverse_mass(body: RigidBody) -> f32 {
    if !body.enabled
        || body.body_type != RigidBodyType::Dynamic
        || body.is_sleeping
        || !body.inverse_mass.is_finite()
        || body.inverse_mass <= 0.0
    {
        0.0
    } else {
        body.inverse_mass
    }
}

#[inline]
pub(super) fn sanitized_inverse_inertia(body: RigidBody) -> f32 {
    if !body.enabled
        || body.body_type != RigidBodyType::Dynamic
        || body.is_sleeping
        || !body.inverse_inertia.is_finite()
        || body.inverse_inertia <= 0.0
    {
        0.0
    } else {
        body.inverse_inertia
    }
}

#[inline]
pub(super) fn sanitized_gravity_scale(body: RigidBody) -> f32 {
    if body.gravity_scale.is_finite() {
        body.gravity_scale
    } else {
        1.0
    }
}

#[inline]
pub(super) fn sanitized_linear_damping(body: RigidBody) -> f32 {
    sanitize_non_negative(body.linear_damping)
}

#[inline]
pub(super) fn sanitized_angular_damping(body: RigidBody) -> f32 {
    sanitize_non_negative(body.angular_damping)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inverse_mass_and_inertia_are_zero_for_non_dynamic_bodies() {
        assert_eq!(sanitized_inverse_mass(RigidBody::static_body()), 0.0);
        assert_eq!(sanitized_inverse_inertia(RigidBody::static_body()), 0.0);
        assert_eq!(sanitized_inverse_mass(RigidBody::kinematic()), 0.0);
        assert_eq!(sanitized_inverse_inertia(RigidBody::kinematic()), 0.0);
    }

    #[test]
    fn inverse_mass_and_inertia_are_zero_for_sleeping_disabled_or_invalid_dynamic_bodies() {
        let mut sleeping = RigidBody::dynamic(2.0);
        sleeping.is_sleeping = true;
        assert_eq!(sanitized_inverse_mass(sleeping), 0.0);
        assert_eq!(sanitized_inverse_inertia(sleeping), 0.0);

        let disabled = RigidBody::dynamic(2.0).with_enabled(false);
        assert_eq!(sanitized_inverse_mass(disabled), 0.0);
        assert_eq!(sanitized_inverse_inertia(disabled), 0.0);

        let mut invalid = RigidBody::dynamic(2.0);
        invalid.inverse_mass = f32::NAN;
        invalid.inverse_inertia = f32::INFINITY;
        assert_eq!(sanitized_inverse_mass(invalid), 0.0);
        assert_eq!(sanitized_inverse_inertia(invalid), 0.0);
    }

    #[test]
    fn inverse_mass_and_inertia_return_positive_dynamic_values() {
        let body = RigidBody::dynamic(2.0).with_inertia(4.0);

        assert_eq!(sanitized_inverse_mass(body), 0.5);
        assert_eq!(sanitized_inverse_inertia(body), 0.25);
    }

    #[test]
    fn gravity_scale_falls_back_for_non_finite_values() {
        assert_eq!(sanitized_gravity_scale(RigidBody::dynamic(1.0)), 1.0);
        assert_eq!(
            sanitized_gravity_scale(RigidBody::dynamic(1.0).with_gravity_scale(0.5)),
            0.5,
        );
        assert_eq!(
            sanitized_gravity_scale(RigidBody::dynamic(1.0).with_gravity_scale(f32::NAN)),
            1.0,
        );
    }

    #[test]
    fn damping_sanitizers_reject_negative_and_non_finite_values() {
        assert_eq!(
            sanitized_linear_damping(RigidBody::dynamic(1.0).with_linear_damping(0.25)),
            0.25,
        );
        assert_eq!(
            sanitized_angular_damping(RigidBody::dynamic(1.0).with_angular_damping(0.5)),
            0.5,
        );
        assert_eq!(
            sanitized_linear_damping(RigidBody::dynamic(1.0).with_linear_damping(-1.0)),
            0.0,
        );
        assert_eq!(
            sanitized_angular_damping(RigidBody::dynamic(1.0).with_angular_damping(f32::NAN)),
            0.0,
        );
    }
}
