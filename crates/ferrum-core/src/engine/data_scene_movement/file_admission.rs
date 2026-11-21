use super::*;
use crate::collision::file_scratch_admission as scratch;
use crate::engine::file_data_movement_admission::{invalid, Budget, Error, Owner, Usage};
use crate::tilemap::file_admission as tilemap;

impl DataSceneMovement {
    pub(in crate::engine) fn validate_file(
        &self,
        world: &World,
        budget: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            status: _,
            actor: _,
            destination: _,
            speed: _,
            arrival_radius: _,
            solid_mask: _,
            cancel_on_input: _,
            points: _,
            next: _,
            dirty: _,
            last_position: _,
            pending_distance: _,
            last_motion: _,
            search: _,
            sweep: _,
        } = self;
        budget.work(15)?;
        budget.work(self.points.capacity())?;
        if ![
            self.destination.x,
            self.destination.y,
            self.speed,
            self.arrival_radius,
            self.last_position.x,
            self.last_position.y,
        ]
        .iter()
        .all(|v| v.is_finite())
            || self.speed < 0.0
            || self.arrival_radius < 0.0
            || !self.pending_distance.is_finite()
            || self
                .last_motion
                .is_some_and(|(x, y)| !x.is_finite() || !y.is_finite())
        {
            return Err(invalid(Owner::Movement, "number", 0));
        }
        // plan adds at most a start center and an exact destination to4096 cells.
        if self.points.len() > 4098 || self.next > self.points.len() {
            return Err(invalid(Owner::Movement, "route-length", 0));
        }
        let moving = self.status == MoveStatus::Moving;
        if moving != self.actor.is_some()
            || (moving && (self.speed <= 0.0 || self.next == self.points.len()))
            || (!moving
                && (!self.points.is_empty() || self.next != 0 || self.pending_distance != 0.0))
        {
            return Err(invalid(Owner::Movement, "route-state", 0));
        }
        for (index, point) in self.points.iter().enumerate() {
            if !point.x.is_finite() || !point.y.is_finite() {
                return Err(invalid(Owner::Movement, "point", index));
            }
        }
        // Signed distance credit, arbitrary mask bits, stale actors, dirty paths
        // and last_motion from a completed route are producer history. Do not
        // resolve against today's grid/body or replan it to admit a file.
        let remaining = budget.remaining();
        let mut search = tilemap::Budget::new(tilemap::Limits {
            max_work: remaining.max_work,
            max_scratch_bytes: remaining.max_scratch_bytes,
        });
        self.search
            .validate_file(&mut search)
            .map_err(|error| Error::Tilemap {
                owner: Owner::Movement,
                error,
            })?;
        budget.tilemap_usage(search.usage)?;
        let remaining = budget.remaining();
        let sweep = self
            .sweep
            .validate_file(
                world,
                scratch::Limits {
                    max_work: remaining.max_work,
                    max_scratch_bytes: remaining.max_scratch_bytes,
                },
            )
            .map_err(Error::Sweep)?;
        budget.consume(Usage {
            work: sweep.work,
            scratch_bytes: sweep.scratch_bytes,
        })?;
        Ok(())
    }

    #[cfg(test)]
    pub(in crate::engine) fn corrupt_file_movement_fixture(&mut self, case: u32) {
        match case {
            0 => self.destination.x = f32::NAN,
            1 => self.next = self.points.len() + 1,
            2 => self.actor = None,
            3 => self.pending_distance = f64::INFINITY,
            4 => self.points[0].y = f32::NAN,
            5 => self.sweep.debug_truncated = true,
            _ => unreachable!("known file movement test case"),
        }
    }

    #[cfg(test)]
    pub(in crate::engine) fn file_distance_credit(&self) -> f64 {
        self.pending_distance
    }
}
