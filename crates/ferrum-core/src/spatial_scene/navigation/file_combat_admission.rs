//! Combat-owned follower/search history. Root noncombat admission stays strict.
use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem, Usage};
use crate::spatial_scene::file_admission as spatial;
pub(super) fn waypoint(
    p: Waypoint,
    scene: Option<&SpatialScene>,
    b: &mut Budget,
) -> Result<(), Error> {
    b.work(8)?;
    require(
        finite(&[p.at.x, p.at.y]) && spatial::span(p.span) && p.surface < 256,
        "combat_route",
        "waypoint",
        0,
        Problem::Number,
    )?;
    if let Some(scene) = scene {
        require(
            scene
                .surfaces
                .get(p.surface)
                .is_some_and(|s| s.walkable && s.floor == p.span.floor.0),
            "combat_route",
            "surface",
            p.surface,
            Problem::Reference,
        )?;
    }
    Ok(())
}
fn map_spatial(e: spatial::Error) -> Error {
    match e {
        spatial::Error::WorkLimit => Error::WorkLimit,
        spatial::Error::ScratchLimit => Error::ScratchLimit,
        spatial::Error::Allocation => Error::Allocation,
        _ => Error::Invalid {
            owner: "combat_route",
            field: "search",
            index: 0,
            problem: Problem::Layout,
        },
    }
}
impl SpatialNavigation {
    pub(crate) fn file_actor(&self) -> Option<Entity> {
        self.actor
    }
    pub(crate) fn file_job_source(&self) -> Option<(Transform2D, HeightSpan)> {
        self.job.as_ref().map(|j| j.file_source())
    }
    pub(crate) fn validate_file_combat(
        &self,
        scene: Option<&SpatialScene>,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            status: _,
            actor: _,
            points: _,
            next: _,
            planned: _,
            speed: _,
            radius: _,
            cancel_on_input: _,
            cell_size: _,
            pending: _,
            last: _,
            last_motion: _,
            search: _,
            searches: _,
            request_status: _,
            requests: _,
            target_count: _,
            preparation_work: _,
            combat: _,
            combat_step: _,
            combat_drop: _,
            work_limit: _,
            frame_limit: _,
            update_work: _,
            precise_stop: _,
            crowd_step: _,
            crowd_candidates: _,
            crowd_detour: _,
            search_peers: _,
            search_padding: _,
            search_neighbors: _,
            job: _,
            steering: _,
        } = self;
        b.work(40)?;
        b.vector(&self.points)?;
        b.vector(&self.search_peers)?;
        require(
            self.points.len() <= MAX_NODES + 2
                && self.next <= self.points.len()
                && self.planned <= MAX_NODES + 2
                && self.search_peers.len() <= 64,
            "combat_route",
            "lengths",
            0,
            Problem::Length,
        )?;
        require(
            finite(&[
                self.speed,
                self.radius,
                self.cell_size,
                self.combat_step,
                self.combat_drop,
                self.search_padding,
            ]) && self.speed >= 0.
                && self.radius >= 0.
                && self.cell_size >= 0.
                && self.combat_step >= 0.
                && self.combat_drop >= 0.
                && self.search_padding >= 0.
                && self.pending.is_finite()
                && self.work_limit <= MAX_WORK,
            "combat_route",
            "scalars",
            0,
            Problem::Number,
        )?;
        // Velocity-only movement intentionally reports Moving with no follower.
        if self.actor.is_some() {
            require(
                self.status == SpatialMoveStatus::Moving
                    && !self.points.is_empty()
                    && self.planned == self.points.len()
                    && self.speed > 0.
                    && self.cell_size > 0.
                    && self.last.is_some(),
                "combat_route",
                "follower",
                0,
                Problem::Reference,
            )?;
        } else {
            require(
                self.points.is_empty() && self.next == 0 && self.pending == 0.,
                "combat_route",
                "inactive_follower",
                0,
                Problem::History,
            )?;
        }
        for &p in &self.points {
            waypoint(p, scene, b)?;
        }
        b.work(32)?;
        require(
            self.last
                .is_none_or(|(p, h)| finite(&[p.x, p.y]) && spatial::span(h))
                && self
                    .last_motion
                    .is_none_or(|(x, y)| x.is_finite() && y.is_finite())
                && self.steering.is_none_or(|(v, r)| finite(&[v.vx, v.vy, r]))
                && self
                    .crowd_step
                    .steering_velocity
                    .is_none_or(|v| finite(&[v.vx, v.vy]))
                && self
                    .crowd_detour
                    .is_none_or(|((x, y), r)| x.is_finite() && y.is_finite() && r.is_finite()),
            "combat_route",
            "motion",
            0,
            Problem::Number,
        )?;
        // Reuse owner Search semantics, including +INF unvisited-cost sentinels and
        // bounded acyclic parent validation, under the same remaining allowance.
        let l = b.remaining();
        let mut nested = spatial::Budget::new(spatial::Limits {
            max_work: l.max_work,
            max_scratch_bytes: l.max_scratch_bytes,
        });
        self.search
            .validate_file(&mut nested)
            .map_err(map_spatial)?;
        b.nested(Usage {
            work: nested.usage.work,
            scratch_bytes: nested.usage.scratch_bytes,
        })?;
        if let Some(job) = &self.job {
            if scene.is_some() {
                for node in &self.search.nodes {
                    waypoint(node.pose, scene, b)?;
                }
            }
            job.validate_file_combat(&self.search, scene, b)?;
            require(
                self.search.work <= self.work_limit,
                "combat_route",
                "job_work",
                0,
                Problem::Range,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl SpatialNavigation {
        pub(crate) fn corrupt_file_combat_fixture(&mut self, case: u32) {
            match case {
                7 => self.job.as_mut().unwrap().corrupt_file_combat_fixture(),
                8 => {
                    self.search.nodes[0].parent = 0;
                }
                _ => unreachable!(),
            }
        }
    }
}
