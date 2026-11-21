use super::*;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
impl ObservationBuffers {
    pub(in crate::engine) fn validate_file_output(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            manifolds: _,
            points: _,
            truncated: _,
            total_manifolds: _,
            total_points: _,
            impulses: _,
            clamps: _,
            diagnostics: _,
        } = self;
        b.work(8)?;
        b.vector(&self.manifolds)?;
        b.vector(&self.points)?;
        b.vector(&self.impulses)?;
        b.vector(&self.clamps)?;
        f::require(
            self.manifolds.len() <= 65536
                && self.points.len() <= 65536
                && self.total_manifolds as usize >= self.manifolds.len()
                && self.total_points as usize >= self.points.len()
                && (self.truncated
                    || (self.total_manifolds as usize == self.manifolds.len()
                        && self.total_points as usize == self.points.len())),
            "observations",
            "totals",
            0,
            Problem::Graph,
        )?;
        let mut end = 0usize;
        for (i, v) in self.manifolds.iter().enumerate() {
            let ManifoldRecord {
                first: _,
                second: _,
                subshapes: _,
                normal: _,
                offset: _,
                count: _,
            } = v;
            b.work(7)?;
            v.first.validate_file_output(b, i)?;
            v.second.validate_file_output(b, i)?;
            let next = (v.offset as usize)
                .checked_add(v.count as usize)
                .ok_or(Error::WorkLimit)?;
            f::require(
                v.offset as usize == end && next <= self.points.len() && f::finite(&v.normal),
                "observations",
                "manifold",
                i,
                Problem::Graph,
            )?;
            end = next;
        }
        f::require(
            end == self.points.len(),
            "observations",
            "point_coverage",
            0,
            Problem::Graph,
        )?;
        for (i, v) in self.points.iter().enumerate() {
            let PointRecord {
                first: _,
                second: _,
                penetration: _,
            } = v;
            b.work(7)?;
            f::require(
                f::finite(&v.first) && f::finite(&v.second) && v.penetration.is_finite(),
                "observations",
                "points",
                i,
                Problem::Number,
            )?;
        }
        for (i, v) in self.impulses.iter().enumerate() {
            v.validate_file_output_row(b, i)?;
        }
        for (i, v) in self.clamps.iter().enumerate() {
            v.validate_file_output_row(b, i)?;
        }
        let DiagnosticsRecord {
            backend: _,
            capabilities: _,
            fixed_steps: _,
            authored_joint_breaks: _,
            ccd_observations_dropped: _,
            solved_contacts: _,
            impulses_dropped: _,
            step: _,
            frame: _,
        } = self.diagnostics;
        b.work(71)?;
        f::require(
            self.diagnostics.backend <= 1,
            "observations",
            "backend",
            0,
            Problem::Code,
        )
    }
}

#[cfg(test)]
impl ObservationBuffers {
    pub(in crate::engine) fn corrupt_output(&mut self, case: u32) {
        match case {
            0 => self.manifolds[0].offset = 1,
            1 => self.points[0].penetration = f32::NAN,
            2 => self.total_points = 0,
            4 => self.clamps[0].fraction = 2.,
            5 => self.impulses[0].normal_impulse = f32::NAN,
            _ => self.diagnostics.backend = 2,
        }
    }
}

impl ImpulseRecord {
    pub(in crate::engine) fn validate_file_output_row(
        &self,
        b: &mut Budget,
        i: usize,
    ) -> Result<(), Error> {
        let v = self;
        let ImpulseRecord {
            first: _,
            second: _,
            categories: _,
            point: _,
            normal: _,
            normal_impulse: _,
            tangent_impulse: _,
            approach_speed: _,
        } = v;
        b.work(12)?;
        v.first.validate_file_output(b, i)?;
        v.second.validate_file_output(b, i)?;
        f::require(
            f::finite(&v.point)
                && f::finite(&v.normal)
                && v.normal_impulse.is_finite()
                && f::finite(&v.tangent_impulse)
                && v.approach_speed.is_finite(),
            "observations",
            "impulses",
            i,
            Problem::Number,
        )?;
        Ok(())
    }
}

impl CcdRecord {
    pub(in crate::engine) fn validate_file_output_row(
        &self,
        b: &mut Budget,
        i: usize,
    ) -> Result<(), Error> {
        let v = self;
        let CcdRecord {
            moving: _,
            target: _,
            fraction: _,
            sweep_seconds: _,
            point: _,
            normal: _,
        } = v;
        b.work(8)?;
        v.moving.validate_file_output(b, i)?;
        v.target.validate_file_output(b, i)?;
        f::require(
            v.fraction.is_finite()
                && (0.0..=1.0).contains(&v.fraction)
                && v.sweep_seconds.is_finite()
                && v.sweep_seconds >= 0.0
                && f::finite(&v.point)
                && f::finite(&v.normal),
            "observations",
            "ccd",
            i,
            Problem::Number,
        )?;
        Ok(())
    }
}
