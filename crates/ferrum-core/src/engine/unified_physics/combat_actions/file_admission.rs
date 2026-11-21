use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl NativeMeleeHit {
    pub(in crate::engine) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            entity: _,
            collider: _,
            point: _,
            distance: _,
        } = self;
        b.work(8)?;
        require(
            finite(&self.point) && self.distance.is_finite() && self.distance >= 0.,
            "combat_actions",
            "native_hit",
            0,
            Problem::Number,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl NativeMeleeHit {
        pub(in crate::engine) fn invalid_file_fixture() -> Self {
            Self {
                entity: Entity {
                    id: 0,
                    generation: 0,
                },
                collider: ColliderId {
                    slot: 0,
                    generation: 0,
                },
                point: [0.; 3],
                distance: f32::NAN,
            }
        }
    }
}
