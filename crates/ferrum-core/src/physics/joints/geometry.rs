use crate::components::Velocity;
use crate::world::World;

use super::super::math::{finite_rotation, sanitize_finite, velocity_len_squared};
use super::super::KINEMATIC_EPSILON;

pub(super) fn revolute_joint_world_radius(
    world: &World,
    index: usize,
    local_anchor_x: f32,
    local_anchor_y: f32,
) -> Velocity {
    let rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    rotate_velocity(
        Velocity {
            vx: sanitize_finite(local_anchor_x),
            vy: sanitize_finite(local_anchor_y),
        },
        rotation.radians,
    )
}

pub(super) fn prismatic_joint_world_axis(
    world: &World,
    index: usize,
    local_axis_x: f32,
    local_axis_y: f32,
) -> Velocity {
    let local_axis = normalized_prismatic_joint_axis(local_axis_x, local_axis_y);
    let rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let axis = rotate_velocity(local_axis, rotation.radians);
    normalized_prismatic_joint_axis(axis.vx, axis.vy)
}

pub(super) fn normalized_prismatic_joint_axis(axis_x: f32, axis_y: f32) -> Velocity {
    let axis = Velocity {
        vx: sanitize_finite(axis_x),
        vy: sanitize_finite(axis_y),
    };
    let length_squared = velocity_len_squared(axis);
    if length_squared <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
        return Velocity { vx: 1.0, vy: 0.0 };
    }

    let length = length_squared.sqrt();
    Velocity {
        vx: axis.vx / length,
        vy: axis.vy / length,
    }
}

pub(super) fn normalize_angle_radians(radians: f32) -> f32 {
    const PI: f32 = std::f32::consts::PI;
    const TAU: f32 = std::f32::consts::PI * 2.0;
    (sanitize_finite(radians) + PI).rem_euclid(TAU) - PI
}

pub(super) fn rotate_velocity(velocity: Velocity, radians: f32) -> Velocity {
    let radians = sanitize_finite(radians);
    let (sin, cos) = radians.sin_cos();
    Velocity {
        vx: velocity.vx * cos - velocity.vy * sin,
        vy: velocity.vx * sin + velocity.vy * cos,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_prismatic_joint_axis_falls_back_to_positive_x() {
        assert_eq!(
            normalized_prismatic_joint_axis(0.0, 0.0),
            Velocity { vx: 1.0, vy: 0.0 }
        );
        assert_eq!(
            normalized_prismatic_joint_axis(f32::NAN, f32::INFINITY),
            Velocity { vx: 1.0, vy: 0.0 }
        );
    }

    #[test]
    fn normalize_angle_radians_wraps_and_sanitizes() {
        let normalized = normalize_angle_radians(std::f32::consts::PI * 3.0);
        assert!((normalized + std::f32::consts::PI).abs() < 0.001);
        assert_eq!(normalize_angle_radians(f32::NAN), 0.0);
    }
}
