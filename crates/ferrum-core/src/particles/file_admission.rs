use super::*;
use crate::engine::file_presentation_admission::{invalid, Budget, Error, Owner, Problem};
impl ParticlePreset {
    pub(crate) fn validate_file(&self, index: usize, budget: &mut Budget) -> Result<(), Error> {
        budget.work(1)?;
        // The raw public burst count is legal, including MAX/zero. Reserve its
        // one-emission iteration ceiling, without sampling or advancing RNG.
        budget.work_u64(u64::from(self.burst_count))?;
        if SpriteFrame::from_values(self.frame.u0, self.frame.v0, self.frame.u1, self.frame.v1)
            .is_none()
        {
            return Err(invalid(Owner::Presets, index, Problem::Frame));
        }
        if [
            self.lifetime_seconds.min,
            self.lifetime_seconds.max,
            self.speed.min,
            self.speed.max,
            self.start_size.min,
            self.start_size.max,
            self.end_size.min,
            self.end_size.max,
            self.acceleration_x,
            self.acceleration_y,
            self.damping,
        ]
        .iter()
        .chain(self.start_color.iter())
        .chain(self.end_color.iter())
        .any(|v| !v.is_finite())
        {
            return Err(invalid(Owner::Presets, index, Problem::Number));
        }
        // Reversed/negative ranges, finite HDR colors and negative damping are
        // intentionally left raw: spawn_burst owns their sanitization.
        Ok(())
    }
}
impl ParticleSystem {
    pub(crate) fn validate_file(&self, budget: &mut Budget) -> Result<(), Error> {
        budget.work(self.particles.capacity())?;
        budget.work(self.capacity)?;
        budget.work(1)?; // Every u32 LCG state, including reachable zero, is valid.
                         // derive(Clone) may compact the Vec while retaining logical capacity.
                         // Both costs were charged; their backing sizes need not be identical.
        if self.particles.len() > self.capacity {
            return Err(invalid(Owner::Particles, 0, Problem::Capacity));
        }
        for (index, p) in self.particles.iter().enumerate() {
            if [
                p.x,
                p.y,
                p.velocity_x,
                p.velocity_y,
                p.age_seconds,
                p.lifetime_seconds,
                p.start_size,
                p.end_size,
                p.acceleration_x,
                p.acceleration_y,
                p.damping,
            ]
            .iter()
            .chain(p.start_color.iter())
            .chain(p.end_color.iter())
            .any(|v| !v.is_finite())
            {
                return Err(invalid(Owner::Particles, index, Problem::Number));
            }
            if p.age_seconds < 0.0
                || p.lifetime_seconds <= PARTICLE_EPSILON
                || p.age_seconds >= p.lifetime_seconds
                || p.start_size < 0.0
                || p.end_size < 0.0
                || p.damping < 0.0
            {
                return Err(invalid(Owner::Particles, index, Problem::Range));
            }
            if SpriteFrame::from_values(p.frame.u0, p.frame.v0, p.frame.u1, p.frame.v1).is_none() {
                return Err(invalid(Owner::Particles, index, Problem::Frame));
            }
            if p.spatial.is_some_and(|(elevation, units)| {
                !elevation.is_finite() || !units.is_finite() || units <= 0.0
            }) {
                return Err(invalid(Owner::Particles, index, Problem::Range));
            }
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn corrupt_file_fixture(&mut self) {
        self.particles[0].age_seconds = f32::NAN;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::file_presentation_admission::Limits;
    fn budget() -> Budget {
        Budget::new(Limits {
            max_work: u64::MAX,
            max_scratch_bytes: 4096,
        })
    }
    fn system() -> ParticleSystem {
        let mut s = ParticleSystem::with_capacity(2);
        let mut p = ParticlePreset::new(u32::MAX);
        p.burst_count = 1;
        p.lifetime_seconds = ParticleRange::constant(1.0);
        p.speed = ParticleRange::constant(0.0);
        assert_eq!(s.spawn_burst(p, 0.0, -0.0), 1);
        s
    }
    #[test]
    fn file_presentation_particle_private_capacity_range_frame_and_spatial_checks() {
        let original = system();
        let cases: [fn(&mut ParticleSystem); 6] = [
            |s| s.particles[0].velocity_x = f32::INFINITY,
            |s| s.capacity = 0,
            |s| s.particles[0].age_seconds = s.particles[0].lifetime_seconds,
            |s| s.particles[0].damping = -1.0,
            |s| s.particles[0].frame.u1 = 0.0,
            |s| s.particles[0].spatial = Some((0.0, 0.0)),
        ];
        for corrupt in cases {
            let mut s = original.clone();
            corrupt(&mut s);
            let before = s.clone();
            assert!(matches!(
                s.validate_file(&mut budget()),
                Err(Error::Invalid {
                    owner: Owner::Particles,
                    ..
                })
            ));
            assert_eq!(s, before);
        }
    }
    #[test]
    fn file_presentation_particle_reachable_rng_zero_and_hdr_are_not_normalized() {
        let mut s = ParticleSystem::with_capacity(2);
        let mut p = ParticlePreset::new(u32::MAX);
        p.burst_count = 1;
        p.start_color = [8.0, -1.0, 2.0, -0.0];
        p.lifetime_seconds = ParticleRange::constant(1.0);
        // Five affine LCG draws from this public seed end at state zero.
        s.set_seed(3_468_964_641);
        assert_eq!(s.spawn_burst(p, 0.0, -0.0), 1);
        assert_eq!(s.rng.state, 0);
        let before = s.clone();
        assert_eq!(s.validate_file(&mut budget()), Ok(()));
        assert_eq!(s, before);
        s.particles[0].x = f32::NAN;
        assert_eq!(
            s.validate_file(&mut Budget::new(Limits {
                max_work: 0,
                max_scratch_bytes: 0
            })),
            Err(Error::WorkLimit)
        );
    }
    #[test]
    fn file_presentation_preset_raw_finite_policy_and_typed_nonfinite_frame_rejections() {
        let mut p = ParticlePreset::new(u32::MAX);
        p.burst_count = 0;
        p.speed = ParticleRange::new(100.0, -20.0);
        p.damping = -9.0;
        p.start_color = [99.0, -2.0, 3.0, -0.0];
        assert_eq!(p.validate_file(255, &mut budget()), Ok(()));
        p.damping = f32::INFINITY;
        assert_eq!(
            p.validate_file(255, &mut budget()),
            Err(invalid(Owner::Presets, 255, Problem::Number))
        );
        p.damping = 0.0;
        p.frame.u0 = 2.0;
        assert_eq!(
            p.validate_file(255, &mut budget()),
            Err(invalid(Owner::Presets, 255, Problem::Frame))
        );
    }
}
