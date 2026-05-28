use crate::collision::{ColliderCollisionManifold, CollisionScratch, CollisionSystem};
use crate::components::{AngularVelocity, RigidBody, RigidBodyType, Velocity};
use crate::world::World;

use super::math::{
    finite_angular_velocity, finite_velocity, sanitize_non_negative, velocity_len_squared,
};
use super::{
    union_contact_manifold_islands, union_joint_islands, RigidBodyIslandGraph, RigidBodyStepStats,
    DEFAULT_SLEEP_ANGULAR_THRESHOLD, DEFAULT_SLEEP_LINEAR_THRESHOLD,
    DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS,
};

#[derive(Debug, Default)]
pub(super) struct RigidBodySleepScratch {
    graph: RigidBodyIslandGraph,
    collision: CollisionScratch,
    manifolds: Vec<ColliderCollisionManifold>,
    root_flags: Vec<bool>,
    secondary_root_flags: Vec<bool>,
    node_flags: Vec<bool>,
    seen_roots: Vec<bool>,
    body_indices: Vec<usize>,
}

pub(super) fn wake_sleeping_rigid_body_islands(
    world: &mut World,
    stats: &mut RigidBodyStepStats,
    scratch: &mut RigidBodySleepScratch,
) {
    rebuild_sleep_island_graph(world, scratch);
    let islands_woken = scratch
        .graph
        .sleeping_body_indices_in_wake_source_islands_into(
            world,
            &mut scratch.root_flags,
            &mut scratch.secondary_root_flags,
            &mut scratch.body_indices,
        );

    let mut bodies_woken = 0_u32;
    for index in scratch.body_indices.iter().copied() {
        if wake_sleeping_rigid_body_at(world, index) {
            bodies_woken = bodies_woken.saturating_add(1);
        }
    }
    if bodies_woken > 0 {
        stats.bodies_woken = stats.bodies_woken.saturating_add(bodies_woken);
        stats.islands_woken = stats.islands_woken.saturating_add(islands_woken);
    }
}

pub(super) fn update_rigid_body_sleep_states(
    world: &mut World,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
    scratch: &mut RigidBodySleepScratch,
) {
    update_rigid_body_sleep_timers(world, delta_seconds, stats);
    put_ready_rigid_body_islands_to_sleep(world, stats, scratch);
    stats.sleeping_bodies = stats
        .sleeping_bodies
        .saturating_add(count_sleeping_dynamic_rigid_bodies(world));
}

fn rebuild_sleep_island_graph(world: &World, scratch: &mut RigidBodySleepScratch) {
    scratch.graph.rebuild_from_world(world);
    CollisionSystem::build_rigid_collider_manifolds_into(
        &mut scratch.collision,
        world,
        &mut scratch.manifolds,
    );
    union_contact_manifold_islands(world, &scratch.manifolds, &mut scratch.graph);
    union_joint_islands(world, &mut scratch.graph);
}

fn update_rigid_body_sleep_timers(
    world: &mut World,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.rigid_bodies.len() {
        if !world.alive.get(index).copied().unwrap_or(false) {
            continue;
        }
        let Some(mut body) = world.rigid_bodies[index] else {
            continue;
        };
        if !body.enabled {
            body.sleep_timer_seconds = 0.0;
            body.is_sleeping = false;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if body.body_type != RigidBodyType::Dynamic {
            body.sleep_timer_seconds = 0.0;
            body.is_sleeping = false;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if !body.can_sleep {
            if body.is_sleeping {
                body.is_sleeping = false;
                stats.bodies_woken = stats.bodies_woken.saturating_add(1);
            }
            body.sleep_timer_seconds = 0.0;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if body.is_sleeping {
            world.rigid_bodies[index] = Some(body);
            continue;
        }

        let velocity = finite_velocity(world.velocities[index].unwrap_or_default());
        let angular_velocity = finite_angular_velocity(
            world
                .angular_velocities
                .get(index)
                .copied()
                .flatten()
                .unwrap_or_default(),
        );
        if rigid_body_is_below_sleep_thresholds(velocity, angular_velocity) {
            body.sleep_timer_seconds =
                sanitize_non_negative(body.sleep_timer_seconds + delta_seconds)
                    .min(DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS);
        } else {
            body.sleep_timer_seconds = 0.0;
        }
        world.rigid_bodies[index] = Some(body);
    }
}

fn put_ready_rigid_body_islands_to_sleep(
    world: &mut World,
    stats: &mut RigidBodyStepStats,
    scratch: &mut RigidBodySleepScratch,
) {
    rebuild_sleep_island_graph(world, scratch);
    let islands_put_to_sleep = scratch.graph.body_indices_ready_for_island_sleep_into(
        world,
        &mut scratch.root_flags,
        &mut scratch.secondary_root_flags,
        &mut scratch.node_flags,
        &mut scratch.seen_roots,
        &mut scratch.body_indices,
    );

    let mut bodies_put_to_sleep = 0_u32;
    for index in scratch.body_indices.iter().copied() {
        if put_rigid_body_to_sleep_at(world, index) {
            bodies_put_to_sleep = bodies_put_to_sleep.saturating_add(1);
        }
    }

    if bodies_put_to_sleep > 0 {
        stats.bodies_put_to_sleep = stats
            .bodies_put_to_sleep
            .saturating_add(bodies_put_to_sleep);
        stats.islands_put_to_sleep = stats
            .islands_put_to_sleep
            .saturating_add(islands_put_to_sleep);
    }
}

pub(super) fn clear_rigid_body_accumulators(body: &mut RigidBody) {
    body.force = Velocity::default();
    body.impulse = Velocity::default();
    body.torque = 0.0;
    body.angular_impulse = 0.0;
}

pub(super) fn rigid_body_has_pending_wake_input(body: RigidBody) -> bool {
    body.force.vx != 0.0
        || body.force.vy != 0.0
        || body.impulse.vx != 0.0
        || body.impulse.vy != 0.0
        || body.torque != 0.0
        || body.angular_impulse != 0.0
}

fn wake_sleeping_rigid_body_at(world: &mut World, index: usize) -> bool {
    let Some(mut body) = world.rigid_bodies.get(index).copied().flatten() else {
        return false;
    };
    if !body.enabled || body.body_type != RigidBodyType::Dynamic || !body.is_sleeping {
        return false;
    }
    body.is_sleeping = false;
    body.sleep_timer_seconds = 0.0;
    world.rigid_bodies[index] = Some(body);
    true
}

fn put_rigid_body_to_sleep_at(world: &mut World, index: usize) -> bool {
    let Some(mut body) = world.rigid_bodies.get(index).copied().flatten() else {
        return false;
    };
    if !body.enabled || body.body_type != RigidBodyType::Dynamic || body.is_sleeping {
        return false;
    }
    body.is_sleeping = true;
    body.sleep_timer_seconds = DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS;
    world.velocities[index] = Some(Velocity::default());
    world.angular_velocities[index] = Some(AngularVelocity::default());
    world.rigid_bodies[index] = Some(body);
    true
}

pub(super) fn is_sleeping_dynamic_rigid_body(world: &World, index: usize) -> bool {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .is_some_and(|body| {
            body.enabled && body.body_type == RigidBodyType::Dynamic && body.is_sleeping
        })
}

fn count_sleeping_dynamic_rigid_bodies(world: &World) -> u32 {
    world
        .rigid_bodies
        .iter()
        .enumerate()
        .filter(|(index, _)| world.alive.get(*index).copied().unwrap_or(false))
        .filter(|(index, _)| is_sleeping_dynamic_rigid_body(world, *index))
        .count() as u32
}

pub(super) fn is_rigid_body_wake_source(world: &World, index: usize) -> bool {
    let Some(body) = world.rigid_bodies.get(index).copied().flatten() else {
        return false;
    };
    if !body.enabled {
        return false;
    }
    match body.body_type {
        RigidBodyType::Dynamic => {
            if body.is_sleeping {
                return false;
            }
        }
        RigidBodyType::Kinematic => {}
        RigidBodyType::Static => return false,
    }

    let velocity = finite_velocity(
        world
            .velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    let angular_velocity = finite_angular_velocity(
        world
            .angular_velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    !rigid_body_is_below_sleep_thresholds(velocity, angular_velocity)
}

pub(super) fn rigid_body_is_ready_for_sleep(world: &World, index: usize, body: RigidBody) -> bool {
    if !body.enabled
        || body.body_type != RigidBodyType::Dynamic
        || !body.can_sleep
        || body.is_sleeping
        || body.sleep_timer_seconds < DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS
    {
        return false;
    }

    let velocity = finite_velocity(
        world
            .velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    let angular_velocity = finite_angular_velocity(
        world
            .angular_velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    rigid_body_is_below_sleep_thresholds(velocity, angular_velocity)
}

fn rigid_body_is_below_sleep_thresholds(
    velocity: Velocity,
    angular_velocity: AngularVelocity,
) -> bool {
    velocity_len_squared(velocity)
        <= DEFAULT_SLEEP_LINEAR_THRESHOLD * DEFAULT_SLEEP_LINEAR_THRESHOLD
        && angular_velocity.radians_per_second.abs() <= DEFAULT_SLEEP_ANGULAR_THRESHOLD
}
