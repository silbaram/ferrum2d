use super::BreakoutBodies;
use crate::engine::file_builtin_scenes_admission::{entity, require, Budget, Error, Problem};
use crate::world::World;
impl BreakoutBodies {
    pub(in crate::engine) fn validate_file(&self, w: &World, b: &mut Budget) -> Result<(), Error> {
        let Self { paddle: _, ball: _ } = self;
        b.work(2)?;
        require(
            self.paddle.is_some() == self.ball.is_some()
                && (self.paddle.is_none() || self.paddle != self.ball),
            "native_breakout_leaf",
            "entities",
            0,
            Problem::Reference,
        )?;
        // Scene edits/removal can leave an old-generation profile until refresh.
        // No latest Scene equality or current body-kind/liveness is imposed here.
        for (i, &e) in self.paddle.iter().chain(&self.ball).enumerate() {
            entity(w, e, "native_breakout_leaf", "entities", i)?;
        }
        Ok(())
    }
}
