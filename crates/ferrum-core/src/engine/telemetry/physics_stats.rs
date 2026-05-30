use wasm_bindgen::prelude::*;

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn rigid_body_step_substeps(&self) -> u32 {
        self.rigid_body_step_stats.substeps
    }

    pub fn rigid_body_step_dynamic_bodies(&self) -> u32 {
        self.rigid_body_step_stats.dynamic_bodies
    }

    pub fn rigid_body_step_angular_bodies(&self) -> u32 {
        self.rigid_body_step_stats.angular_bodies
    }

    pub fn rigid_body_step_island_count(&self) -> u32 {
        self.rigid_body_step_stats.island_count
    }

    pub fn rigid_body_step_island_bodies(&self) -> u32 {
        self.rigid_body_step_stats.island_bodies
    }

    pub fn rigid_body_step_active_islands(&self) -> u32 {
        self.rigid_body_step_stats.active_islands
    }

    pub fn rigid_body_step_sleeping_islands(&self) -> u32 {
        self.rigid_body_step_stats.sleeping_islands
    }

    pub fn rigid_body_step_largest_island_bodies(&self) -> u32 {
        self.rigid_body_step_stats.largest_island_bodies
    }

    pub fn rigid_body_step_contact_checks(&self) -> u32 {
        self.rigid_body_step_stats.contact_checks
    }

    pub fn rigid_body_step_velocity_impulses(&self) -> u32 {
        self.rigid_body_step_stats.velocity_impulses
    }

    pub fn rigid_body_step_contact_block_solves(&self) -> u32 {
        self.rigid_body_step_stats.contact_block_solves
    }

    pub fn rigid_body_step_baumgarte_velocity_biases(&self) -> u32 {
        self.rigid_body_step_stats.baumgarte_velocity_biases
    }

    pub fn rigid_body_step_split_velocity_impulses(&self) -> u32 {
        self.rigid_body_step_stats.split_velocity_impulses
    }

    pub fn rigid_body_step_restitution_velocity_threshold_skips(&self) -> u32 {
        self.rigid_body_step_stats
            .restitution_velocity_threshold_skips
    }

    pub fn rigid_body_step_warm_start_impulses(&self) -> u32 {
        self.rigid_body_step_stats.warm_start_impulses
    }

    pub fn rigid_body_step_contact_cache_entries(&self) -> u32 {
        self.rigid_body_step_stats.contact_cache_entries
    }

    pub fn rigid_body_step_sleeping_bodies(&self) -> u32 {
        self.rigid_body_step_stats.sleeping_bodies
    }

    pub fn rigid_body_step_bodies_put_to_sleep(&self) -> u32 {
        self.rigid_body_step_stats.bodies_put_to_sleep
    }

    pub fn rigid_body_step_bodies_woken(&self) -> u32 {
        self.rigid_body_step_stats.bodies_woken
    }

    pub fn rigid_body_step_islands_woken(&self) -> u32 {
        self.rigid_body_step_stats.islands_woken
    }

    pub fn rigid_body_step_islands_put_to_sleep(&self) -> u32 {
        self.rigid_body_step_stats.islands_put_to_sleep
    }

    pub fn rigid_body_step_ccd_checks(&self) -> u32 {
        self.rigid_body_step_stats.ccd_checks
    }

    pub fn rigid_body_step_ccd_hits(&self) -> u32 {
        self.rigid_body_step_stats.ccd_hits
    }

    pub fn rigid_body_step_position_corrections(&self) -> u32 {
        self.rigid_body_step_stats.position_corrections
    }

    pub fn rigid_body_step_split_position_corrections(&self) -> u32 {
        self.rigid_body_step_stats.split_position_corrections
    }

    pub fn rigid_body_step_constraint_velocity_corrections(&self) -> u32 {
        self.rigid_body_step_stats.constraint_velocity_corrections
    }

    pub fn rigid_body_step_constraint_position_corrections(&self) -> u32 {
        self.rigid_body_step_stats.constraint_position_corrections
    }

    pub fn rigid_body_step_broken_joints(&self) -> u32 {
        self.rigid_body_step_stats.broken_joints
    }

    pub fn fixed_timestep_enabled(&self) -> bool {
        self.fixed_timestep_enabled
    }

    pub fn fixed_timestep_alpha(&self) -> f32 {
        self.last_fixed_update.alpha
    }

    pub fn fixed_timestep_consumed_seconds(&self) -> f32 {
        self.last_fixed_update.consumed_seconds
    }

    pub fn fixed_timestep_dropped_seconds(&self) -> f32 {
        self.last_fixed_update.dropped_seconds
    }

    pub fn physics_fixed_steps(&self) -> u32 {
        self.physics_counters.fixed_steps
    }

    pub fn physics_kinematic_moves(&self) -> u32 {
        self.physics_counters.kinematic_moves
    }

    pub fn physics_kinematic_hits(&self) -> u32 {
        self.physics_counters.kinematic_hits
    }

    pub fn physics_kinematic_entity_hits(&self) -> u32 {
        self.physics_counters.kinematic_entity_hits
    }

    pub fn physics_kinematic_tile_hits(&self) -> u32 {
        self.physics_counters.kinematic_tile_hits
    }

    pub fn physics_solid_candidate_checks(&self) -> u32 {
        self.physics_counters.solid_candidate_checks
    }

    pub fn physics_tile_candidate_checks(&self) -> u32 {
        self.physics_counters.tile_candidate_checks
    }

    pub fn physics_hd2d_filtered_entity_candidates(&self) -> u32 {
        self.physics_counters.hd2d_filtered_entity_candidates
    }

    pub fn physics_hd2d_filtered_tile_candidates(&self) -> u32 {
        self.physics_counters.hd2d_filtered_tile_candidates
    }

    pub fn physics_collision_pairs(&self) -> u32 {
        self.physics_counters.collision_pairs
    }

    pub fn physics_collision_solid_pairs(&self) -> u32 {
        self.physics_counters.collision_solid_pairs
    }

    pub fn physics_collision_trigger_pairs(&self) -> u32 {
        self.physics_counters.collision_trigger_pairs
    }

    pub fn collision_enter_count(&self) -> u32 {
        self.collision_event_counts.enter
    }

    pub fn collision_stay_count(&self) -> u32 {
        self.collision_event_counts.stay
    }

    pub fn collision_exit_count(&self) -> u32 {
        self.collision_event_counts.exit
    }

    pub fn collision_hit_count(&self) -> u32 {
        self.collision_event_counts.hit
    }

    pub fn collision_trigger_enter_count(&self) -> u32 {
        self.collision_event_counts.trigger_enter
    }

    pub fn collision_trigger_stay_count(&self) -> u32 {
        self.collision_event_counts.trigger_stay
    }

    pub fn collision_trigger_exit_count(&self) -> u32 {
        self.collision_event_counts.trigger_exit
    }
}
