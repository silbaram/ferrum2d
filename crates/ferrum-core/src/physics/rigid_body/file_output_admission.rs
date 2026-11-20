use super::*;
use crate::engine::file_physics_output_admission::{Budget, Error};
impl RigidBodyStepStats {
    pub(crate) fn validate_file_output(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            substeps: _,
            dynamic_bodies: _,
            angular_bodies: _,
            island_count: _,
            island_bodies: _,
            active_islands: _,
            sleeping_islands: _,
            largest_island_bodies: _,
            contact_checks: _,
            velocity_impulses: _,
            contact_block_solves: _,
            baumgarte_velocity_biases: _,
            split_velocity_impulses: _,
            restitution_velocity_threshold_skips: _,
            warm_start_impulses: _,
            contact_cache_entries: _,
            sleeping_bodies: _,
            bodies_put_to_sleep: _,
            bodies_woken: _,
            islands_woken: _,
            islands_put_to_sleep: _,
            ccd_checks: _,
            ccd_hits: _,
            position_contact_rebuilds: _,
            position_corrections: _,
            split_position_corrections: _,
            constraint_velocity_corrections: _,
            constraint_position_corrections: _,
            broken_joints: _,
        } = self;
        b.work(29)
    }
}
