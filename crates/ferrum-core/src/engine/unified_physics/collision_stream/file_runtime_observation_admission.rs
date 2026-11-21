use super::CollisionStream;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};

impl CollisionStream {
    pub(in crate::engine::unified_physics) fn validate_file_observations(
        &self,
        max: usize,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            enabled: _,
            limit: _,
            pending: _,
            dropped_transitions: _,
            dropped_events: _,
        } = self;
        b.work(5)?;
        b.vector(&self.pending)?;
        f::require(
            self.limit == max
                && self.pending.len() <= self.limit
                && (self.enabled
                    || (self.pending.is_empty()
                        && self.dropped_transitions == 0
                        && self.dropped_events == 0)),
            "runtime_collision_stream",
            "limits_enabled",
            0,
            Problem::Graph,
        )?;
        for (i, row) in self.pending.iter().enumerate() {
            row.validate_file_output_row(b, i, false)?;
            b.work(1)?;
            f::require(
                row.phase != 0 || row.flags & 2 == 0,
                "runtime_collision_stream",
                "removed_enter",
                i,
                Problem::Flags,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
impl CollisionStream {
    pub(in crate::engine::unified_physics) fn corrupt_runtime_observation(&mut self, case: usize) {
        assert!(!self.pending.is_empty());
        match case {
            0 => self.limit += 1,
            1 => self.pending[0].phase = 2,
            2 => self.pending[0].flags = 4,
            3 => self.pending[0].first.terrain = [3, 0, 0],
            4 => {
                self.pending[0].first.flags = 0;
                self.pending[0].first.entity = [1, 0];
            }
            5 => self.pending[0].second.collider = self.pending[0].first.collider,
            6 => self.enabled = false,
            7 => {
                self.enabled = false;
                self.pending.clear();
                self.dropped_events = 1;
            }
            8 => self.pending.resize(self.limit + 1, self.pending[0]),
            9 => {
                self.pending[0].phase = 0;
                self.pending[0].flags = 2;
            }
            _ => unreachable!(),
        }
    }
}
