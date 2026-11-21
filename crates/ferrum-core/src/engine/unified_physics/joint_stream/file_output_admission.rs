use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
impl JointBuffers {
    pub(in crate::engine) fn validate_file_output(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            states: _,
            events: _,
            dropped_native: _,
            dropped_events: _,
        } = self;
        b.work(4)?;
        b.vector(&self.states)?;
        b.vector(&self.events)?;
        for (states, rows) in [(true, &self.states), (false, &self.events)] {
            for (i, v) in rows.iter().enumerate() {
                v.validate_file_output_row(b, i, states)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
impl JointBuffers {
    pub(in crate::engine) fn corrupt_output(&mut self, case: u32) {
        match case {
            0 => self.states[0].code = 13,
            1 => self.states[0].flags = 16,
            _ => self.states[0].force = f32::NAN,
        }
    }
}

impl JointRecord {
    pub(in crate::engine) fn validate_file_output_row(
        &self,
        b: &mut Budget,
        i: usize,
        states: bool,
    ) -> Result<(), Error> {
        let v = self;
        let JointRecord {
            joint: _,
            code: _,
            flags: _,
            entity_a: _,
            entity_b: _,
            body_a: _,
            body_b: _,
            force: _,
            torque: _,
        } = v;
        b.work(14)?;
        f::require(
            v.code <= (if states { 12 } else { 4 })
                && v.flags & !(if states { 15 } else { 3 }) == 0
                && (v.flags & 1 != 0 || v.entity_a == [0; 2])
                && (v.flags & 2 != 0 || v.entity_b == [0; 2]),
            "joint_output",
            "metadata",
            i,
            Problem::Flags,
        )?;
        f::require(
            v.force.is_finite() && v.torque.is_finite(),
            "joint_output",
            "reaction",
            i,
            Problem::Number,
        )?;
        Ok(())
    }
}
