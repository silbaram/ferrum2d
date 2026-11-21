use super::*;
use crate::engine::file_physics_output_admission::{Budget, Error};
impl PhysicsCounters {
    pub(crate) fn validate_file_output(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            fixed_steps: _,
            kinematic_moves: _,
            kinematic_hits: _,
            kinematic_entity_hits: _,
            kinematic_tile_hits: _,
            solid_candidate_checks: _,
            tile_candidate_checks: _,
            hd2d_filtered_entity_candidates: _,
            hd2d_filtered_tile_candidates: _,
            collision_pairs: _,
            collision_solid_pairs: _,
            collision_trigger_pairs: _,
        } = self;
        b.work(12)
    }
}
