use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
pub(in crate::engine) fn validate_bodies(
    rows: &Vec<BodyStateRecord>,
    b: &mut Budget,
) -> Result<(), Error> {
    b.vector(rows)?;
    f::require(
        rows.len() <= MAX_BATCH,
        "unified_body",
        "rows",
        0,
        Problem::Length,
    )?;
    for (i, v) in rows.iter().enumerate() {
        let BodyStateRecord {
            entity_id: _,
            generation: _,
            flags: _,
            position: _,
            rotation: _,
            linear_velocity: _,
            angular_velocity: _,
        } = v;
        b.work(STATE_WORDS)?;
        f::require(
            v.flags & !1 == 0
                && f::finite(&v.position)
                && f::finite(&v.rotation)
                && f::finite(&v.linear_velocity)
                && f::finite(&v.angular_velocity),
            "unified_body",
            "record",
            i,
            Problem::Number,
        )?;
    }
    Ok(())
}

#[cfg(test)]
impl BodyStateRecord {
    pub(in crate::engine) fn corrupt_output(&mut self, case: u32) {
        if case == 0 {
            self.position[0] = f32::NAN;
        } else {
            self.flags = 2;
        }
    }
}
