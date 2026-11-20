use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
impl CharacterStateRecord {
    pub(in crate::engine) fn validate_file_output_rows(
        rows: &Vec<Self>,
        b: &mut Budget,
    ) -> Result<(), Error> {
        b.vector(rows)?;
        f::require(
            rows.len() <= 65536,
            "unified_character",
            "rows",
            0,
            Problem::Length,
        )?;
        for (i, v) in rows.iter().enumerate() {
            let Self {
                entity_id: _,
                generation: _,
                flags: _,
                ground_collider: _,
                ground_body: _,
                carried_by: _,
                translation: _,
                velocity: _,
                carry_translation: _,
                vertical_speed: _,
                counters: _,
            } = v;
            b.work(WORDS)?;
            f::require(
                v.flags & !511 == 0
                    && (v.flags & 128 != 0
                        || (v.ground_collider == [0; 2] && v.ground_body == [0; 2]))
                    && (v.flags & 256 != 0 || v.carried_by == [0; 2]),
                "unified_character",
                "flags",
                i,
                Problem::Flags,
            )?;
            f::require(
                f::finite(&v.translation)
                    && f::finite(&v.velocity)
                    && f::finite(&v.carry_translation)
                    && v.vertical_speed.is_finite(),
                "unified_character",
                "values",
                i,
                Problem::Number,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
impl CharacterStateRecord {
    pub(in crate::engine) fn corrupt_output(&mut self, case: u32) {
        match case {
            0 => self.flags |= 1 << 9,
            1 => {
                self.flags &= !(1 << 8);
                self.carried_by = [7, 8];
            }
            _ => self.carry_translation[0] = f32::NAN,
        }
    }
}
