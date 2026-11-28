use super::{Statistics, UnifiedCcdClamp, UnifiedPhysicsFrameStatistics};
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
use crate::engine::unified_physics::file_observation_admission::native_records as n;
use crate::physics3d::StepStatistics;

fn step(v: StepStatistics, max: usize, b: &mut Budget) -> Result<(), Error> {
    let StepStatistics {
        kinematic_character_stops: _,
        kinematic_path_casts: _,
        kinematic_path_failures: _,
        kinematic_path_stops: _,
        character_preview_passes: _,
        character_preview_pair_casts: _,
        character_preview_pair_contacts: _,
        character_preview_coupling_visits: _,
        character_preview_coupling_limits: _,
        character_preview_obstacle_casts: _,
        character_preview_obstacle_contacts: _,
        character_preview_obstacle_failures: _,
        backend_steps: _,
        ccd_substeps: _,
        solver_contacts: _,
        solver_constraints: _,
        tracked_contact_pairs: _,
        dynamic_bodies: _,
        angular_bodies: _,
        sleeping_bodies: _,
        bodies_woken: _,
        bodies_put_to_sleep: _,
        islands: _,
        island_bodies: _,
        active_islands: _,
        sleeping_islands: _,
        largest_island_bodies: _,
        broken_joints: _,
        ccd_prediction_checks: _,
        ccd_clamp_checks: _,
        ccd_clamps: _,
        ccd_clamps_dropped: _,
    } = v;
    b.work(32)?;
    f::require(
        v.angular_bodies <= v.dynamic_bodies
            && v.sleeping_bodies <= v.dynamic_bodies
            && v.dynamic_bodies as usize <= max
            && v.island_bodies as usize <= max
            && v.active_islands.checked_add(v.sleeping_islands) == Some(v.islands)
            && v.islands <= v.island_bodies
            && v.largest_island_bodies <= v.island_bodies
            && ((v.islands == 0 && v.island_bodies == 0 && v.largest_island_bodies == 0)
                || (v.islands > 0 && v.largest_island_bodies > 0))
            && v.kinematic_path_failures <= v.kinematic_path_casts
            && v.reserved_diagnostics_are_zero()
            && v.ccd_clamps_dropped <= v.ccd_clamps,
        "runtime_statistics",
        "step_gauges",
        0,
        Problem::Graph,
    )
}

#[cfg(test)]
impl Statistics {
    pub(in crate::engine) fn corrupt_runtime_observation_before(&mut self) {
        self.corrupt_runtime_observation(0);
    }
    pub(in crate::engine) fn corrupt_runtime_observation(&mut self, case: usize) {
        match case {
            0 => self.frame.totals.angular_bodies = u32::MAX,
            1 => self.frame.totals.sleeping_bodies = u32::MAX,
            2 => self.frame.totals.active_islands = u32::MAX,
            3 => self.frame.totals.island_bodies = 0,
            4 => self.frame.totals.largest_island_bodies = self.frame.totals.island_bodies + 1,
            5 => self.frame.fixed_steps = 0,
            6 => self.frame.totals.ccd_clamps_dropped = self.frame.totals.ccd_clamps + 1,
            7 => {
                self.frame.totals.ccd_clamps_dropped = 1;
                self.frame.ccd_observations_dropped = 0;
            }
            8 => self.frame.totals.backend_steps = 0,
            9 => self.observations[0].fraction = 2.,
            10 => self.observations[0].point[0] = f32::NAN,
            11 => self.clamps[0].clamp.fraction = f32::NAN,
            12 => self.clamps[0].clamp.normal[2] = f32::INFINITY,
            13 => self.clamps[0].moving.id += 1,
            14 => self.observations[0].moving.body[0] += 1,
            15 => {
                self.clamps.pop();
            }
            16 => {
                self.observations.pop();
            }
            17 => self.observations[0].sweep_seconds = -1.,
            18 => self.clamps[0].clamp.sweep_seconds += 1.,
            19 => self.observations[0].moving.terrain = [3, 0, 0],
            20 => self.frame.totals.dynamic_bodies = u32::MAX,
            21 => {
                self.frame.totals.kinematic_path_failures =
                    self.frame.totals.kinematic_path_casts + 1
            }
            22 => {
                self.frame.totals.character_preview_obstacle_failures =
                    self.frame.totals.character_preview_obstacle_casts
                        + self.frame.totals.character_preview_obstacle_contacts
                        + 1
            }
            23 => self.observations.resize(4097, self.observations[0]),
            24 => self.clamps.push(self.clamps[0].clone()),
            25 => {
                self.observations[0].moving.flags = 0;
                self.observations[0].moving.entity = [1, 0];
            }
            26 => self.observations[0].normal[0] += 1.,
            27 => self.clamps[0].clamp.target.collider.slot += 100,
            28 => self.observations[0].sweep_seconds = f32::NAN,
            _ => unreachable!(),
        }
    }
}

impl Statistics {
    pub(in crate::engine::unified_physics) fn validate_file_observations(
        &self,
        max: usize,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            frame: _,
            observations: _,
            clamps: _,
        } = self;
        let UnifiedPhysicsFrameStatistics {
            fixed_steps: _,
            totals: _,
            authored_joint_breaks: _,
            ccd_observations_dropped: _,
        } = self.frame;
        b.work(7)?;
        b.vector(&self.observations)?;
        b.vector(&self.clamps)?;
        step(self.frame.totals, max, b)?;
        f::require(
            self.observations.len() <= 4096
                && self.clamps.len() <= self.observations.len()
                && self.frame.totals.backend_steps >= self.frame.fixed_steps
                && self.frame.ccd_observations_dropped >= self.frame.totals.ccd_clamps_dropped
                && self.observations.len() as u64 <= u64::from(self.frame.totals.ccd_clamps),
            "runtime_statistics",
            "frame_counts",
            0,
            Problem::Graph,
        )?;
        if self.frame.fixed_steps == 0 {
            f::require(
                self.frame == Default::default()
                    && self.observations.is_empty()
                    && self.clamps.is_empty(),
                "runtime_statistics",
                "empty_frame",
                0,
                Problem::History,
            )?;
        }
        b.work(
            self.observations
                .len()
                .checked_mul(48)
                .ok_or(Error::WorkLimit)?,
        )?;
        let mut clamps = 0;
        for (i, row) in self.observations.iter().enumerate() {
            row.validate_file_output_row(b, i)?;
            if row.moving.flags & 1 != 0 && row.target.flags & 1 != 0 {
                let Some(clamp) = self.clamps.get(clamps) else {
                    return f::require(
                        false,
                        "runtime_statistics",
                        "mapped_coverage",
                        i,
                        Problem::Graph,
                    );
                };
                let UnifiedCcdClamp {
                    moving: _,
                    target: _,
                    clamp: _,
                } = clamp;
                n::ccd(&clamp.clamp, b, i)?;
                f::require(
                    [clamp.moving.id, clamp.moving.generation] == row.moving.entity
                        && [clamp.target.id, clamp.target.generation] == row.target.entity
                        && n::participant_matches(&row.moving, clamp.clamp.moving)
                        && n::participant_matches(&row.target, clamp.clamp.target)
                        && row.fraction.to_bits() == clamp.clamp.fraction.to_bits()
                        && row.sweep_seconds.to_bits() == clamp.clamp.sweep_seconds.to_bits()
                        && n::bits(&row.point, &clamp.clamp.point)
                        && n::bits(&row.normal, &clamp.clamp.normal),
                    "runtime_statistics",
                    "mapped_copy",
                    i,
                    Problem::Graph,
                )?;
                clamps += 1;
            }
        }
        f::require(
            clamps == self.clamps.len(),
            "runtime_statistics",
            "clamp_coverage",
            0,
            Problem::Graph,
        )
    }
}
