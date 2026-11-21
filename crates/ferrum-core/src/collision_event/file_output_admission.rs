use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
impl CollisionEventTracker {
    pub(crate) fn validate_file_output(&self, world: &World, b: &mut Budget) -> Result<(), Error> {
        let Self {
            scratch: _,
            pairs: _,
            previous: _,
            current: _,
        } = self;
        b.work(4)?;
        let used = self
            .scratch
            .validate_file(world, b.remaining())
            .map_err(Error::from)?;
        b.nested(used)?;
        b.vector(&self.pairs)?;
        b.vector(&self.previous)?;
        b.vector(&self.current)?;
        f::require(
            self.current.is_empty(),
            "tracker",
            "current",
            0,
            Problem::History,
        )?;
        b.sort(self.pairs.len())?;
        let mut expected = b.reserve::<(u32, u32, u32, u32)>(self.pairs.len())?;
        for (i, p) in self.pairs.iter().enumerate() {
            f::require(p.a.id != p.b.id, "tracker", "pairs", i, Problem::Reference)?;
            let (a, z) = if entity_key(p.a) < entity_key(p.b) {
                (p.a, p.b)
            } else {
                (p.b, p.a)
            };
            expected.push((a.id, a.generation, z.id, z.generation));
        }
        expected.sort_unstable();
        expected.dedup();
        f::require(
            expected.len() == self.previous.len(),
            "tracker",
            "previous",
            0,
            Problem::Graph,
        )?;
        for (i, k) in self.previous.iter().enumerate() {
            f::require(
                k.a_id < k.b_id
                    && (i == 0 || self.previous[i - 1] < *k)
                    && expected[i] == (k.a_id, k.a_generation, k.b_id, k.b_generation),
                "tracker",
                "previous",
                i,
                Problem::Order,
            )?;
        }
        Ok(())
    }
}
impl CollisionEventCounts {
    pub(crate) fn validate_file_output(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            enter: _,
            stay: _,
            exit: _,
            hit: _,
            trigger_enter: _,
            trigger_stay: _,
            trigger_exit: _,
        } = self;
        b.work(7)
    }
}

#[cfg(test)]
impl CollisionEventTracker {
    pub(crate) fn corrupt_output(&mut self, case: u32) {
        match case {
            0 => self.previous.push(self.previous[0]),
            1 => self.current.push(self.previous[0]),
            _ => self.pairs.clear(),
        }
    }
}
