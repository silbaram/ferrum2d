use super::BuiltInSceneSlots;
use crate::engine::file_builtin_scenes_admission::{Budget, Error};
use crate::world::World;
impl BuiltInSceneSlots {
    pub(in crate::engine) fn validate_file(
        &self,
        world: &World,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            active: _,
            shooter: _,
            breakout: _,
            platformer: _,
        } = self;
        b.work(4)?; // ActiveScene is a closed Serde enum, including inactive slots.
        self.shooter.validate_file(world, b)?;
        self.breakout.validate_file(world, b)?;
        self.platformer.validate_file(world, b)
    }
}
