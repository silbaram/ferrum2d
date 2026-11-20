use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
impl Participant {
    pub(in crate::engine) fn validate_file_output(
        &self,
        b: &mut Budget,
        index: usize,
    ) -> Result<(), Error> {
        let Self {
            flags: _,
            entity: _,
            body: _,
            collider: _,
            terrain: _,
        } = self;
        b.work(10)?;
        f::require(
            self.flags & !3 == 0
                && (self.flags & 1 != 0 || self.entity == [0; 2])
                && match self.terrain[0] {
                    0 => self.terrain == [0; 3],
                    1 => true,
                    2 => self.terrain[2] == 0,
                    _ => false,
                },
            "participant",
            "flags_terrain",
            index,
            Problem::Flags,
        )
    }
}
fn active_key(v: &ActiveCollisionPair) -> ([u32; 2], [u32; 2]) {
    (
        [v.first.collider.slot, v.first.collider.generation],
        [v.second.collider.slot, v.second.collider.generation],
    )
}
impl CollisionBuffers {
    pub(in crate::engine) fn validate_file_output(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            rows: _,
            active: _,
            dropped_transitions: _,
            dropped_events: _,
        } = self;
        b.work(4)?;
        b.vector(&self.rows)?;
        b.vector(&self.active)?;
        for (i, v) in self.active.iter().enumerate() {
            b.work(13)?;
            let key = active_key(v);
            f::require(
                key.0 < key.1 && (i == 0 || active_key(&self.active[i - 1]) < key),
                "collision_output",
                "active",
                i,
                Problem::Order,
            )?;
        }
        let is_active = self.rows.first().is_some_and(|r| r.phase == 2);
        if is_active {
            f::require(
                self.rows.len() == self.active.len(),
                "collision_output",
                "active_rows",
                0,
                Problem::Graph,
            )?;
        }
        for (i, v) in self.rows.iter().enumerate() {
            v.validate_file_output_row(b, i, is_active)?;
            if is_active {
                let a = &self.active[i];
                f::require(
                    (v.first.collider, v.second.collider) == active_key(a)
                        && v.flags == u32::from(a.sensor)
                        && v.first.body == [a.first.body.slot, a.first.body.generation]
                        && v.second.body == [a.second.body.slot, a.second.body.generation],
                    "collision_output",
                    "active_rows",
                    i,
                    Problem::Graph,
                )?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
impl CollisionBuffers {
    pub(in crate::engine) fn corrupt_output(&mut self, case: u32) {
        match case {
            0 => self.active.push(self.active[0]),
            1 => self.rows[0].flags = 4,
            2 => self.rows[0].second.collider = self.rows[0].first.collider,
            _ => self.rows[0].first.terrain = [0, 1, 0],
        }
    }
}

impl CollisionRecord {
    pub(in crate::engine) fn validate_file_output_row(
        &self,
        b: &mut Budget,
        i: usize,
        is_active: bool,
    ) -> Result<(), Error> {
        let v = self;
        let CollisionRecord {
            phase: _,
            flags: _,
            first: _,
            second: _,
        } = v;
        b.work(2)?;
        v.first.validate_file_output(b, i)?;
        v.second.validate_file_output(b, i)?;
        f::require(
            v.phase <= 2
                && v.first.collider < v.second.collider
                && v.flags & !(if v.phase == 2 { 1 } else { 3 }) == 0
                && (v.phase == 2) == is_active,
            "collision_output",
            "rows",
            i,
            Problem::Flags,
        )?;
        Ok(())
    }
}
