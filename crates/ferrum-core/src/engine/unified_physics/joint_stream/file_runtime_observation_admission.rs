use super::JointStream;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};

impl JointStream {
    pub(in crate::engine::unified_physics) fn validate_file_observations(
        &self,
        max: usize,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            enabled: _,
            limit: _,
            scratch: _,
            pending: _,
            dropped_native: _,
            dropped_events: _,
            legacy_dropped: _,
        } = self;
        b.work(7)?;
        b.vector(&self.scratch)?;
        b.vector(&self.pending)?;
        f::require(
            self.limit == max
                && self.scratch.is_empty()
                && self.pending.len() <= self.limit
                && (self.enabled
                    || (self.pending.is_empty()
                        && self.dropped_native == 0
                        && self.dropped_events == 0)),
            "runtime_joint_stream",
            "limit_enabled_scratch",
            0,
            Problem::Graph,
        )?;
        let mut identities = b.reserve::<[u32; 2]>(self.pending.len())?;
        for (i, row) in self.pending.iter().enumerate() {
            row.validate_file_output_row(b, i, false)?;
            b.work(2)?;
            f::require(
                row.force >= 0. && row.torque >= 0.,
                "runtime_joint_stream",
                "reaction",
                i,
                Problem::Number,
            )?;
            identities.push(row.joint);
        }
        b.sort(identities.len())?;
        identities.sort_unstable();
        b.work(identities.len())?;
        f::require(
            !identities.windows(2).any(|p| p[0] == p[1]),
            "runtime_joint_stream",
            "identity_unique",
            0,
            Problem::Duplicate,
        )
    }
}

#[cfg(test)]
impl JointStream {
    pub(in crate::engine) fn corrupt_runtime_observation_before(&mut self) {
        self.corrupt_runtime_observation(0);
    }
    pub(in crate::engine) fn corrupt_runtime_observation(&mut self, case: usize) {
        assert!(!self.pending.is_empty());
        let row = self.pending[0];
        match case {
            0 => self.pending[0].code = 5,
            1 => self.pending[0].flags = 4,
            2 => self.pending[0].force = f32::NAN,
            3 => self.pending[0].torque = f32::INFINITY,
            4 => self.pending[0].force = -1.,
            5 => self.pending[0].torque = -1.,
            6 => self.limit += 1,
            7 => self.scratch.push(crate::physics3d::JointEvent {
                joint: crate::physics3d::JointId {
                    slot: row.joint[0],
                    generation: row.joint[1],
                },
                body_a: crate::physics3d::BodyId {
                    slot: row.body_a[0],
                    generation: row.body_a[1],
                },
                body_b: crate::physics3d::BodyId {
                    slot: row.body_b[0],
                    generation: row.body_b[1],
                },
                reason: crate::physics3d::JointEventReason::Removed,
                reaction: crate::physics3d::JointState {
                    force: row.force,
                    torque: row.torque,
                },
            }),
            8 => self.enabled = false,
            9 => self.pending.push(row),
            10 => {
                self.pending[0].flags = 0;
                self.pending[0].entity_a = [1, 0];
            }
            11 => {
                self.enabled = false;
                self.pending.clear();
                self.dropped_native = 1;
            }
            12 => self.pending.resize(self.limit + 1, row),
            _ => unreachable!(),
        }
    }
    pub(in crate::engine) fn observation_history_for_test(&self) -> (bool, usize, u32, u32) {
        (
            self.enabled,
            self.pending.len(),
            self.legacy_dropped,
            self.dropped_events,
        )
    }
}
