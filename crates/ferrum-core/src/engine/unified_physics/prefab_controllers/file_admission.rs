use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl ActorPhysicsPrototype {
    pub(in crate::engine) fn validate_file_definition(&self, b: &mut Budget) -> Result<u64, Error> {
        b.work(1)?;
        match self {
            Self::Automatic(settings) => {
                settings.validate_file_configuration(b)?;
                Ok(1)
            }
            Self::Native {
                body,
                space,
                render_offset,
            } => {
                b.work(3)?;
                require(
                    finite(render_offset),
                    "actor_physics_prototype",
                    "render_offset",
                    0,
                    Problem::Number,
                )?;
                body.validate_file_definition(*space, b)
            }
        }
    }
}
