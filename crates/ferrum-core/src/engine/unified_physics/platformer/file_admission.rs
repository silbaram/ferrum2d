use super::PlatformerBodies;
use crate::engine::file_builtin_scenes_admission::{entity, require, Budget, Error, Problem};
use crate::world::World;
impl PlatformerBodies {
    pub(in crate::engine) fn validate_file(&self, w: &World, b: &mut Budget) -> Result<(), Error> {
        let Self {
            player: _,
            platform: _,
            horizontal_axis: _,
            jump_queued: _,
        } = self;
        b.work(4)?;
        require(
            self.horizontal_axis.is_finite() && (-255. ..=255.).contains(&self.horizontal_axis),
            "native_platformer_leaf",
            "horizontal_axis",
            0,
            Problem::Number,
        )?;
        require(
            self.player.is_some() == self.platform.is_some()
                && (self.player.is_none() || self.player != self.platform),
            "native_platformer_leaf",
            "entities",
            0,
            Problem::Reference,
        )?;
        // A manual physical tick consumes jump_queued later. Releasing input,
        // changing the Scene or removing an actor does not justify a repair here.
        for (i, &e) in self.player.iter().chain(&self.platform).enumerate() {
            entity(w, e, "native_platformer_leaf", "entities", i)?;
        }
        Ok(())
    }
}
