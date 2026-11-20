use super::*;
use crate::engine::file_controller_admission::{pose, Budget, Owner, Result};
pub(in crate::engine) fn point_valid(p: Point) -> bool {
    pose(p.pose) && (1..=65535).contains(&p.surface)
}
impl ActorNavigation {
    pub(in crate::engine) fn validate_file_controller(&self, b: &mut Budget) -> Result {
        b.work(96)?;
        b.require(
            self.speed.is_finite()
                && (0. ..=1e6).contains(&self.speed)
                && self.radius.is_finite()
                && self.radius >= 0.
                && self.tolerance.is_finite()
                && self.tolerance >= 0.
                && self.intent_distance.is_finite()
                && self.intent_distance >= 0.,
            Owner::Actor,
            "numeric",
            0,
        )?;
        b.require(
            self.last.is_none_or(pose)
                && self.intent_start.is_none_or(pose)
                && self
                    .last_motion
                    .is_none_or(|(x, z)| x.is_finite() && z.is_finite()),
            Owner::Actor,
            "pose-motion",
            0,
        )?;
        b.require(
            self.planned <= 4096
                && self.expanded <= 4096
                && self.probes <= 32768
                && self.work <= 8_000_000
                && self.target_count <= u32::MAX as usize
                && self.request_status <= 8,
            Owner::Actor,
            "request-status",
            0,
        )?;
        if let Some(points) = &self.points {
            b.work(
                (points.len() as u64)
                    .checked_mul(16)
                    .ok_or(crate::engine::file_controller_admission::Error::Work)?,
            )?;
            b.require(
                self.status == SpatialMoveStatus::Moving
                    && self.actor.is_some()
                    && self.last.is_some()
                    && !points.is_empty()
                    && points.len() <= 4096
                    && self.next < points.len()
                    && self.planned == points.len()
                    && self.tolerance > 0.,
                Owner::Actor,
                "route-index-status",
                0,
            )?;
            for (i, p) in points.iter().enumerate() {
                b.require(point_valid(*p), Owner::Actor, "point", i)?;
            }
        } else {
            b.require(
                self.status != SpatialMoveStatus::Moving
                    && self.next == 0
                    && self.intent_start.is_none(),
                Owner::Actor,
                "empty-route",
                0,
            )?;
        }
        // Counters and planned/target_count are historical diagnostics, not live sizes.
        Ok(())
    }
    pub(in crate::engine) fn file_actor_token(&self) -> Option<Entity> {
        self.actor
    }
}

#[cfg(test)]
mod controller_admission_tests;
