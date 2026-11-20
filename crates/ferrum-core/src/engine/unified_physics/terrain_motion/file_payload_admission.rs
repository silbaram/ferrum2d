use super::super::file_payload_admission as payload;
use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
fn knots(v: &Vec<(f32, Pose)>, space: Space, b: &mut Budget) -> Result<(), Error> {
    b.vector(v)?;
    require(
        !v.is_empty() && v.len() <= 4,
        "runtime_platform",
        "knots_len",
        0,
        Problem::Length,
    )?;
    b.product(v.len(), 2)?;
    for (i, (t, p)) in v.iter().enumerate() {
        require(
            t.is_finite() && *t > v.get(i.wrapping_sub(1)).map_or(0., |k| k.0) && *t <= 1.,
            "runtime_platform",
            "knot_time",
            i,
            Problem::Number,
        )?;
        payload::pose(*p, space, b)?;
    }
    require(
        v.last().is_some_and(|k| k.0 == 1.),
        "runtime_platform",
        "knot_end",
        0,
        Problem::Layout,
    )
}
impl PlatformMotion {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        space: Space,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            history: _,
            prepared: _,
            paths: _,
            phases: _,
        } = self;
        b.work(4)?;
        b.vector(&self.history)?;
        require(
            self.history.len() <= 16,
            "runtime_platform",
            "history_len",
            0,
            Problem::Length,
        )?;
        b.product(self.history.len(), 9)?;
        for (i, h) in self.history.iter().enumerate() {
            b.work(i)?;
            require(
                h.id > 0
                    && h.id <= 65535
                    && h.start.is_finite()
                    && h.start >= 0.
                    && h.end_phase.is_finite()
                    && h.end_phase >= 0.
                    && h.dt.is_finite()
                    && h.dt > 0.
                    && h.dt <= 0.1
                    && h.stop.is_finite()
                    && (0. ..=1.).contains(&h.stop)
                    && !self.history[..i].iter().any(|p| p.id == h.id),
                "runtime_platform",
                "history",
                i,
                Problem::Number,
            )?;
            payload::pose(h.end, space, b)?;
        }
        b.vector(&self.prepared)?;
        b.vector(&self.paths)?;
        b.vector(&self.phases)?;
        require(
            self.prepared.len() <= 16 && self.paths.len() <= 16 && self.phases.len() <= 16,
            "runtime_platform",
            "lengths",
            0,
            Problem::Length,
        )?;
        for (i, p) in self.prepared.iter().enumerate() {
            let PreparedPlatform {
                id: _,
                phase: _,
                start: _,
                period: _,
                knots: _,
            } = p;
            b.work(5)?;
            if p.id == 0 {
                b.vector(&p.knots)?;
                require(
                    p.phase == 0. && p.start == 0. && p.period == 0. && p.knots.is_empty(),
                    "runtime_platform",
                    "default_suffix",
                    i,
                    Problem::Layout,
                )?;
                continue;
            }
            require(
                p.id <= 65535
                    && p.phase.is_finite()
                    && p.start.is_finite()
                    && p.period.is_finite()
                    && p.period > 0.
                    && p.phase >= 0.
                    && p.phase < p.period
                    && p.start >= 0.
                    && p.start < p.period,
                "runtime_platform",
                "prepared",
                i,
                Problem::Number,
            )?;
            knots(&p.knots, space, b)?;
        }
        for p in &self.paths {
            let KinematicPath {
                body: _,
                sweep_sensors: _,
                knots: _,
            } = p;
            b.work(3)?;
            knots(&p.knots, space, b)?;
        }
        b.product(self.phases.len(), 3)?;
        for (i, (id, t)) in self.phases.iter().enumerate() {
            require(
                *id > 0 && *id <= 65535 && t.is_finite() && *t >= 0.,
                "runtime_platform",
                "phase",
                i,
                Problem::Number,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl PlatformMotion {
        pub(in crate::engine::unified_physics) fn assert_runtime_payload_failed_prefix_fixture(
            &self,
        ) {
            assert_eq!(self.prepared.len(), 2);
            assert!(self.prepared[0].knots[0].1.position[0] > 1e6);
            assert!(self.prepared[0].knots[0]
                .1
                .position
                .iter()
                .all(|v| v.is_finite()));
            assert_eq!(self.prepared[1].id, 0);
            assert!(self.prepared[1].knots.is_empty());
        }
    }
}
