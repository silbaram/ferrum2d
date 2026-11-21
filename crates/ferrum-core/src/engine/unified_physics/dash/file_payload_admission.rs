use super::super::file_payload_admission::unique;
use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl DashState {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        space: Space,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            queued: _,
            requests: _,
            backups: _,
        } = self;
        b.work(3)?;
        b.vector(&self.queued)?;
        b.vector(&self.requests)?;
        b.vector(&self.backups)?;
        require(
            self.queued.len() <= 128 && self.requests.len() <= 128,
            "runtime_dash",
            "lengths",
            0,
            Problem::Length,
        )?;
        require(
            self.backups.is_empty(),
            "runtime_dash",
            "backups_boundary",
            0,
            Problem::History,
        )?;
        unique(
            self.queued
                .iter()
                .map(|d| (d.entity.id, d.entity.generation)),
            b,
            "runtime_dash",
            "queued_identity",
        )?;
        unique(
            self.requests.iter().map(|d| d.body),
            b,
            "runtime_dash",
            "request_identity",
        )?;
        b.product(self.queued.len(), 8)?;
        b.product(self.requests.len(), 5)?;
        for d in &self.queued {
            let Dash {
                entity: _,
                translation: _,
                result: _,
            } = d;
            require(
                finite(&d.translation)
                    && match space {
                        Space::PlanarXy => d.translation[2] == 0.,
                        Space::Spatial => d.translation[1] == 0.,
                    },
                "runtime_dash",
                "queued_translation",
                0,
                Problem::Number,
            )?;
        }
        for r in &self.requests {
            let TickMotion {
                body: _,
                translation: _,
            } = r;
            require(
                finite(&r.translation)
                    && match space {
                        Space::PlanarXy => r.translation[2] == 0.,
                        Space::Spatial => r.translation[1] == 0.,
                    },
                "runtime_dash",
                "request_translation",
                0,
                Problem::Number,
            )?;
        }
        // Request translations predate the current dt; do not validate_tick_motion
        // again or bind stale results back to the current queue/body roster.
        Ok(())
    }
}
