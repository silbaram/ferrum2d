use super::FixedTimestepUpdate;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PhysicsCounters {
    pub fixed_steps: u32,
    pub kinematic_moves: u32,
    pub kinematic_hits: u32,
    pub kinematic_entity_hits: u32,
    pub kinematic_tile_hits: u32,
    pub solid_candidate_checks: u32,
    pub tile_candidate_checks: u32,
    pub hd2d_filtered_entity_candidates: u32,
    pub hd2d_filtered_tile_candidates: u32,
    pub collision_pairs: u32,
    pub collision_solid_pairs: u32,
    pub collision_trigger_pairs: u32,
}

impl PhysicsCounters {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn record_fixed_update(&mut self, update: FixedTimestepUpdate) {
        self.fixed_steps = self.fixed_steps.saturating_add(update.steps);
    }
}
