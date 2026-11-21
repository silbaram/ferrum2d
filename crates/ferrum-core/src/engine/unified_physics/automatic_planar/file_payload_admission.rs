use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
impl AutomaticPlanarMotion {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            settings: _,
            saved: _,
        } = self;
        b.work(2)?;
        b.work(self.settings.len())?;
        b.vector(&self.saved)?;
        require(
            self.saved.is_empty(),
            "runtime_automatic",
            "saved_boundary",
            0,
            Problem::History,
        )?;
        // A live unbound batch can exceed max native bodies; stale keys survive
        // until the next retirement. Do not rebind stored settings to the World.
        for settings in self.settings.values() {
            settings.validate_file_configuration(b)?;
        }
        Ok(())
    }
}
