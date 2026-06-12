use crate::collision::{
    ColliderCollisionContact, ColliderCollisionManifold, CollisionScratch, CollisionSystem,
};
use crate::world::World;

mod config;
mod integration;

use super::islands::{
    union_contact_islands, union_contact_manifold_islands, union_joint_islands,
    RigidBodyIslandGraph, RigidBodyIslandSchedule, RigidBodyJointIslandBuckets,
};
use super::joints::{
    solve_distance_joint_position_constraints, solve_distance_joint_velocity_constraints,
    solve_gear_joint_position_constraints, solve_gear_joint_velocity_constraints,
    solve_prismatic_joint_position_constraints, solve_prismatic_joint_velocity_constraints,
    solve_pulley_joint_position_constraints, solve_pulley_joint_velocity_constraints,
    solve_revolute_joint_position_constraints, solve_revolute_joint_velocity_constraints,
    solve_rope_joint_position_constraints, solve_rope_joint_velocity_constraints,
    solve_spring_joint_velocity_constraints, solve_weld_joint_position_constraints,
    solve_weld_joint_velocity_constraints,
};
use super::math::sanitize_delta_seconds;
use super::rigid_body::{RigidBodyIslandStats, RigidBodyStepConfig, RigidBodyStepStats};
use super::sleep::{
    update_rigid_body_sleep_states, wake_sleeping_rigid_body_islands, RigidBodySleepScratch,
};
use super::solver::{
    build_rigid_contact_constraints_into, solve_rigid_body_position_contacts,
    solve_rigid_body_split_impulse_contacts, solve_rigid_body_velocity_contacts,
    store_rigid_contact_impulses, warm_start_rigid_contact_constraints, RigidContactConstraint,
    RigidContactConstraintScratch, RigidSplitImpulseState,
};
use super::system::PhysicsSystem;
use config::{sanitize_rigid_body_step_config, sanitize_rigid_body_substeps};
use integration::{
    integrate_rigid_body_positions, integrate_rigid_body_velocities, RigidBodyAccumulatorMode,
};

#[derive(Debug)]
struct RigidBodyConstraintBatch {
    contact_constraints: Vec<RigidContactConstraint>,
    island_schedule: RigidBodyIslandSchedule,
    joint_buckets: RigidBodyJointIslandBuckets,
    split_impulses: Option<RigidSplitImpulseState>,
}

#[derive(Debug, Default)]
pub(crate) struct RigidBodyStepScratch {
    integrated_bodies: Vec<bool>,
    position_collision: CollisionScratch,
    position_contacts: Vec<ColliderCollisionContact>,
    contact_constraint_scratch: RigidContactConstraintScratch,
    contact_constraints: Vec<RigidContactConstraint>,
    island_graph: RigidBodyIslandGraph,
    island_seen_roots: Vec<bool>,
    island_collision: CollisionScratch,
    island_manifolds: Vec<ColliderCollisionManifold>,
    island_schedule: RigidBodyIslandSchedule,
    joint_buckets: RigidBodyJointIslandBuckets,
    sleep: RigidBodySleepScratch,
    split_impulses: Option<RigidSplitImpulseState>,
}

impl PhysicsSystem {
    pub fn step_rigid_bodies(world: &mut World, delta_seconds: f32) -> RigidBodyStepStats {
        Self::step_rigid_bodies_with_config(world, delta_seconds, RigidBodyStepConfig::default())
    }

    pub fn step_rigid_bodies_with_config(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
    ) -> RigidBodyStepStats {
        Self::step_rigid_bodies_substepped_with_config(world, delta_seconds, 1, config)
    }

    pub fn step_rigid_bodies_substepped(
        world: &mut World,
        delta_seconds: f32,
        substeps: u32,
    ) -> RigidBodyStepStats {
        Self::step_rigid_bodies_substepped_with_config(
            world,
            delta_seconds,
            substeps,
            RigidBodyStepConfig::default(),
        )
    }

    pub fn step_rigid_bodies_substepped_with_config(
        world: &mut World,
        delta_seconds: f32,
        substeps: u32,
        config: RigidBodyStepConfig,
    ) -> RigidBodyStepStats {
        let mut scratch = RigidBodyStepScratch::default();
        Self::step_rigid_bodies_substepped_with_config_and_scratch(
            world,
            delta_seconds,
            substeps,
            config,
            &mut scratch,
        )
    }

    pub(crate) fn step_rigid_bodies_with_config_and_scratch(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
        scratch: &mut RigidBodyStepScratch,
    ) -> RigidBodyStepStats {
        Self::step_rigid_bodies_substepped_with_config_and_scratch(
            world,
            delta_seconds,
            1,
            config,
            scratch,
        )
    }

    fn step_rigid_bodies_substepped_with_config_and_scratch(
        world: &mut World,
        delta_seconds: f32,
        substeps: u32,
        config: RigidBodyStepConfig,
        scratch: &mut RigidBodyStepScratch,
    ) -> RigidBodyStepStats {
        world.clear_rigid_body_ccd_debug_hits();
        let delta_seconds = sanitize_delta_seconds(delta_seconds);
        if delta_seconds <= 0.0 {
            return RigidBodyStepStats::default();
        }

        let config = sanitize_rigid_body_step_config(config);
        let substeps = sanitize_rigid_body_substeps(substeps);
        let substep_seconds = delta_seconds / substeps as f32;
        let mut stats = RigidBodyStepStats {
            substeps,
            ..RigidBodyStepStats::default()
        };

        for substep_index in 0..substeps {
            let is_first_substep = substep_index == 0;
            let is_last_substep = substep_index + 1 == substeps;
            Self::step_rigid_bodies_once(
                world,
                substep_seconds,
                config,
                RigidBodyAccumulatorMode {
                    apply_impulses: is_first_substep,
                    clear_forces: is_last_substep,
                },
                &mut stats,
                scratch,
            );
        }

        let island_stats = Self::analyze_rigid_body_islands_with_scratch(world, scratch);
        stats.island_count = island_stats.island_count;
        stats.island_bodies = island_stats.island_bodies;
        stats.active_islands = island_stats.active_islands;
        stats.sleeping_islands = island_stats.sleeping_islands;
        stats.largest_island_bodies = island_stats.largest_island_bodies;

        stats
    }

    pub fn analyze_rigid_body_islands(world: &World) -> RigidBodyIslandStats {
        let mut graph = RigidBodyIslandGraph::from_world(world);
        union_contact_islands(world, &mut graph);
        union_joint_islands(world, &mut graph);
        graph.stats()
    }

    fn analyze_rigid_body_islands_with_scratch(
        world: &World,
        scratch: &mut RigidBodyStepScratch,
    ) -> RigidBodyIslandStats {
        scratch.island_graph.rebuild_from_world(world);
        CollisionSystem::build_rigid_collider_manifolds_into(
            &mut scratch.island_collision,
            world,
            &mut scratch.island_manifolds,
        );
        union_contact_manifold_islands(world, &scratch.island_manifolds, &mut scratch.island_graph);
        union_joint_islands(world, &mut scratch.island_graph);
        scratch
            .island_graph
            .stats_into(&mut scratch.island_seen_roots)
    }

    fn step_rigid_bodies_once(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
        accumulator_mode: RigidBodyAccumulatorMode,
        stats: &mut RigidBodyStepStats,
        scratch: &mut RigidBodyStepScratch,
    ) {
        Self::integrate_rigid_body_step(
            world,
            delta_seconds,
            config,
            accumulator_mode,
            stats,
            scratch,
        );
        wake_sleeping_rigid_body_islands(world, stats, &mut scratch.sleep);
        let mut constraints = Self::prepare_rigid_body_constraints(world, config, stats, scratch);
        Self::solve_rigid_body_velocity_phase(
            world,
            delta_seconds,
            config,
            &mut constraints,
            stats,
        );
        Self::solve_rigid_body_position_phase(world, config, &constraints, stats, scratch);
        let RigidBodyConstraintBatch {
            contact_constraints,
            island_schedule,
            joint_buckets,
            split_impulses,
        } = constraints;
        scratch.contact_constraints = contact_constraints;
        scratch.island_schedule = island_schedule;
        scratch.joint_buckets = joint_buckets;
        scratch.split_impulses = split_impulses;
        update_rigid_body_sleep_states(world, delta_seconds, stats, &mut scratch.sleep);
    }

    fn integrate_rigid_body_step(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
        accumulator_mode: RigidBodyAccumulatorMode,
        stats: &mut RigidBodyStepStats,
        scratch: &mut RigidBodyStepScratch,
    ) {
        integrate_rigid_body_velocities(
            world,
            delta_seconds,
            config.gravity,
            accumulator_mode,
            stats,
        );
        integrate_rigid_body_positions(
            world,
            delta_seconds,
            config,
            stats,
            &mut scratch.integrated_bodies,
        );
    }

    fn prepare_rigid_body_constraints(
        world: &mut World,
        config: RigidBodyStepConfig,
        stats: &mut RigidBodyStepStats,
        scratch: &mut RigidBodyStepScratch,
    ) -> RigidBodyConstraintBatch {
        build_rigid_contact_constraints_into(
            &mut scratch.contact_constraint_scratch,
            world,
            &mut scratch.contact_constraints,
        );
        let contact_constraints = std::mem::take(&mut scratch.contact_constraints);
        let mut island_schedule = std::mem::take(&mut scratch.island_schedule);
        island_schedule.rebuild_from_world_and_contacts(
            world,
            &contact_constraints,
            &mut scratch.island_graph,
            &mut scratch.island_seen_roots,
        );
        let mut joint_buckets = std::mem::take(&mut scratch.joint_buckets);
        joint_buckets.rebuild_from_world_and_schedule(world, &island_schedule);
        let split_impulses = if config.contact_split_impulse {
            let mut split_impulses = scratch.split_impulses.take().unwrap_or_default();
            split_impulses.reset_from_world(world);
            Some(split_impulses)
        } else {
            None
        };
        warm_start_rigid_contact_constraints(world, &contact_constraints, stats);
        RigidBodyConstraintBatch {
            contact_constraints,
            island_schedule,
            joint_buckets,
            split_impulses,
        }
    }

    fn solve_rigid_body_velocity_phase(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
        constraints: &mut RigidBodyConstraintBatch,
        stats: &mut RigidBodyStepStats,
    ) {
        for _ in 0..config.velocity_iterations {
            for island in constraints.island_schedule.islands() {
                let island_root = island.root();
                solve_prismatic_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.prismatic(island),
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_weld_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.weld(island),
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_revolute_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.revolute(island),
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_gear_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.gear(island),
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_spring_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.spring(island),
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_pulley_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.pulley(island),
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_distance_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.distance(island),
                    stats,
                );
                solve_rope_joint_velocity_constraints(
                    world,
                    constraints.joint_buckets.rope(island),
                    stats,
                );
                solve_rigid_body_velocity_contacts(
                    world,
                    &mut constraints.contact_constraints,
                    &constraints.island_schedule,
                    island_root,
                    config,
                    delta_seconds,
                    stats,
                );
                if let Some(split_impulses) = constraints.split_impulses.as_mut() {
                    solve_rigid_body_split_impulse_contacts(
                        world,
                        split_impulses,
                        &mut constraints.contact_constraints,
                        &constraints.island_schedule,
                        island_root,
                        config,
                        delta_seconds,
                        stats,
                    );
                }
            }
        }
        if let Some(split_impulses) = constraints.split_impulses.as_ref() {
            split_impulses.apply_to_world(world, delta_seconds);
        }
        stats.contact_cache_entries =
            store_rigid_contact_impulses(world, &constraints.contact_constraints);
    }

    fn solve_rigid_body_position_phase(
        world: &mut World,
        config: RigidBodyStepConfig,
        constraints: &RigidBodyConstraintBatch,
        stats: &mut RigidBodyStepStats,
        scratch: &mut RigidBodyStepScratch,
    ) {
        for _ in 0..config.position_iterations {
            CollisionSystem::build_rigid_collider_contacts_into(
                &mut scratch.position_collision,
                world,
                &mut scratch.position_contacts,
            );
            stats.record_position_contact_rebuild(scratch.position_contacts.len());
            for island in constraints.island_schedule.islands() {
                let island_root = island.root();
                solve_prismatic_joint_position_constraints(
                    world,
                    constraints.joint_buckets.prismatic(island),
                    stats,
                );
                solve_weld_joint_position_constraints(
                    world,
                    constraints.joint_buckets.weld(island),
                    stats,
                );
                solve_revolute_joint_position_constraints(
                    world,
                    constraints.joint_buckets.revolute(island),
                    stats,
                );
                solve_gear_joint_position_constraints(
                    world,
                    constraints.joint_buckets.gear(island),
                    stats,
                );
                solve_pulley_joint_position_constraints(
                    world,
                    constraints.joint_buckets.pulley(island),
                    stats,
                );
                solve_distance_joint_position_constraints(
                    world,
                    constraints.joint_buckets.distance(island),
                    stats,
                );
                solve_rope_joint_position_constraints(
                    world,
                    constraints.joint_buckets.rope(island),
                    stats,
                );
                solve_rigid_body_position_contacts(
                    world,
                    &scratch.position_contacts,
                    &constraints.island_schedule,
                    island_root,
                    config,
                    stats,
                );
            }
        }
    }
}
