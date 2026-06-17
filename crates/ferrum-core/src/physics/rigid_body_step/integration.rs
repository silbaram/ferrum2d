use crate::collision::CollisionScratch;
use crate::components::{RigidBodyType, Rotation2D, Velocity};
use crate::damping::damping_factor;
use crate::world::World;

use super::super::ccd::{integrate_dynamic_rigid_body_position_with_ccd, RigidBodyCcdScratch};
use super::super::math::{finite_angular_velocity, finite_rotation, finite_velocity};
use super::super::rigid_body::{RigidBodyStepConfig, RigidBodyStepStats};
use super::super::rigid_body_properties::{
    sanitized_angular_damping, sanitized_gravity_scale, sanitized_inverse_inertia,
    sanitized_inverse_mass, sanitized_linear_damping,
};
use super::super::sleep::{clear_rigid_body_accumulators, rigid_body_has_pending_wake_input};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct RigidBodyAccumulatorMode {
    pub(super) apply_impulses: bool,
    pub(super) clear_forces: bool,
}

pub(super) fn integrate_rigid_body_velocities(
    world: &mut World,
    delta_seconds: f32,
    gravity: Velocity,
    accumulator_mode: RigidBodyAccumulatorMode,
    stats: &mut RigidBodyStepStats,
) {
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let index = world.alive_indices()[alive_position];
        let Some(mut body) = world.rigid_bodies[index] else {
            continue;
        };
        if !body.enabled {
            clear_rigid_body_accumulators(&mut body);
            body.is_sleeping = false;
            body.sleep_timer_seconds = 0.0;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if body.body_type != RigidBodyType::Dynamic {
            continue;
        }
        if body.is_sleeping && rigid_body_has_pending_wake_input(body) {
            body.is_sleeping = false;
            body.sleep_timer_seconds = 0.0;
            stats.bodies_woken = stats.bodies_woken.saturating_add(1);
        }
        if body.is_sleeping {
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        let inverse_mass = sanitized_inverse_mass(body);
        if inverse_mass <= 0.0 {
            continue;
        }

        let mut velocity = world.velocity_at_index_or_default(index);
        let mut angular_velocity = world.angular_velocity_at_index_or_default(index);
        let impulse = if accumulator_mode.apply_impulses {
            body.impulse
        } else {
            Velocity::default()
        };
        velocity.vx += (gravity.vx * sanitized_gravity_scale(body) + body.force.vx * inverse_mass)
            * delta_seconds
            + impulse.vx * inverse_mass;
        velocity.vy += (gravity.vy * sanitized_gravity_scale(body) + body.force.vy * inverse_mass)
            * delta_seconds
            + impulse.vy * inverse_mass;

        let inverse_inertia = sanitized_inverse_inertia(body);
        if inverse_inertia > 0.0 {
            let angular_impulse = if accumulator_mode.apply_impulses {
                body.angular_impulse
            } else {
                0.0
            };
            angular_velocity.radians_per_second +=
                body.torque * inverse_inertia * delta_seconds + angular_impulse * inverse_inertia;
        }

        let damping = sanitized_linear_damping(body);
        if damping > 0.0 {
            let factor = damping_factor(damping, delta_seconds);
            velocity.vx *= factor;
            velocity.vy *= factor;
        }

        let angular_damping = sanitized_angular_damping(body);
        if angular_damping > 0.0 {
            angular_velocity.radians_per_second *= damping_factor(angular_damping, delta_seconds);
        }

        if accumulator_mode.clear_forces {
            body.force = Velocity::default();
            body.torque = 0.0;
        }
        if accumulator_mode.apply_impulses {
            body.impulse = Velocity::default();
            body.angular_impulse = 0.0;
        }
        world.set_velocity_at_index(index, finite_velocity(velocity));
        world.set_angular_velocity_at_index(index, finite_angular_velocity(angular_velocity));
        world.rigid_bodies[index] = Some(body);
        stats.dynamic_bodies = stats.dynamic_bodies.saturating_add(1);
        if inverse_inertia > 0.0 {
            stats.angular_bodies = stats.angular_bodies.saturating_add(1);
        }
    }
}

pub(super) fn integrate_rigid_body_positions(
    world: &mut World,
    delta_seconds: f32,
    config: RigidBodyStepConfig,
    stats: &mut RigidBodyStepStats,
    integrated: &mut Vec<bool>,
    ccd_collision: &mut CollisionScratch,
    ccd_candidates: &mut Vec<usize>,
) {
    integrated.clear();
    integrated.resize(world.rigid_bodies.len(), false);
    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let index = world.alive_indices()[alive_position];
        if integrated.get(index).copied().unwrap_or(false) {
            continue;
        }
        let Some(body) = world.rigid_bodies[index] else {
            continue;
        };
        if !body.enabled
            || body.is_sleeping
            || !matches!(
                body.body_type,
                RigidBodyType::Dynamic | RigidBodyType::Kinematic
            )
        {
            continue;
        }
        if config.continuous && body.body_type == RigidBodyType::Dynamic && {
            let mut ccd_scratch = RigidBodyCcdScratch {
                collision: &mut *ccd_collision,
                candidate_indices: &mut *ccd_candidates,
            };
            integrate_dynamic_rigid_body_position_with_ccd(
                world,
                index,
                delta_seconds,
                config,
                integrated,
                stats,
                &mut ccd_scratch,
            )
        } {
            integrated[index] = true;
            continue;
        }
        let velocity = finite_velocity(world.velocity_at_index_or_default(index));
        let angular_velocity = world
            .angular_velocity_at_index(index)
            .map(finite_angular_velocity);
        let Some(transform) = world.transform_mut_at_index(index) else {
            continue;
        };
        transform.x += velocity.vx * delta_seconds;
        transform.y += velocity.vy * delta_seconds;
        if let (Some(rotation), Some(angular_velocity)) =
            (world.rotation_mut_at_index(index), angular_velocity)
        {
            rotation.radians = finite_rotation(Rotation2D {
                radians: rotation.radians + angular_velocity.radians_per_second * delta_seconds,
            })
            .radians;
        }
        integrated[index] = true;
    }
}
