use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
use crate::physics3d::BodyPrototype;
impl Projectile {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        space: Space,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            body: _,
            source: _,
            shape: _,
            mask: _,
            start: _,
            hit: _,
        } = self;
        b.work(6)?;
        BodyPrototype::validate_file_shape(&self.shape, space, b)?;
        super::super::file_payload_admission::pose(self.start, space, b)?;
        b.work(8)?;
        if let Some(hit) = self.hit {
            match hit {
                ProjectileHit::Entity { entity: _, wall: _ } => {}
                ProjectileHit::Terrain { record } => {
                    b.work(24)?;
                    require(
                        record.kind == 2
                            && record.actor[0] != u32::MAX
                            && record.flags == 4
                            && (record.terrain[0] == 1
                                || record.terrain[0] == 2
                                    && record.terrain[1] > 0
                                    && record.terrain[1] <= 65535
                                    && record.terrain[2] == 0)
                            && finite(&record.point)
                            && finite(&record.normal)
                            && record.fraction.is_finite()
                            && (0. ..=1.).contains(&record.fraction)
                            && record.impulse == 0.
                            && record.approach_speed == 0.,
                        "runtime_projectile",
                        "terrain_hit",
                        0,
                        Problem::Number,
                    )?;
                }
            }
        }
        Ok(())
    }
}
