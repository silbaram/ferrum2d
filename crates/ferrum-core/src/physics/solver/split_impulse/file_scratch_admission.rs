use super::*;
use crate::collision::file_scratch_admission::{self as f, Budget, Error, Owner, Problem};
impl RigidSplitImpulseState {
    pub(in crate::physics) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            linear_velocities: _,
            angular_velocities: _,
        } = self;
        b.work(2)?;
        b.vector(&self.linear_velocities)?;
        b.vector(&self.angular_velocities)?;
        f::require(
            self.linear_velocities.len() == self.angular_velocities.len()
                && u32::try_from(self.linear_velocities.len()).is_ok(),
            Owner::Split,
            "vectors",
            0,
            Problem::Length,
        )?;
        for (i, v) in self.linear_velocities.iter().enumerate() {
            f::require(
                f::finite(&[v.vx, v.vy, self.angular_velocities[i]]),
                Owner::Split,
                "velocities",
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
    use crate::collision::file_scratch_admission::test_support as t;
    #[test]
    fn file_scratch_split_real_reset_impulse_and_stale_world_capacity_are_preserved() {
        let (mut w, es) = t::fixture();
        let mut s = RigidSplitImpulseState::default();
        s.reset_from_world(&w);
        s.apply_contact_impulse_at_radii(
            es[1].id as usize,
            es[2].id as usize,
            Velocity { vx: 1.0, vy: 0.0 },
            Velocity { vx: 0.0, vy: 1.0 },
            Velocity { vx: -2.0, vy: 3.0 },
            1.0,
            1.0,
            1.0,
            1.0,
        );
        assert!(s.linear_velocities.iter().any(|v| v.vx != 0.0));
        let before = t::bytes(&s);
        w.despawn(es[1]);
        s.validate_file(&mut Budget::new(t::limits())).unwrap();
        let r: RigidSplitImpulseState = t::restored(&s);
        r.validate_file(&mut Budget::new(t::limits())).unwrap();
        assert_eq!(t::bytes(&r), before);
        for case in 0..2 {
            let mut c = s.clone();
            if case == 0 {
                c.angular_velocities.pop();
            } else {
                c.linear_velocities[0].vx = f32::NAN;
            }
            let before = t::bytes(&c);
            assert!(matches!(
                c.validate_file(&mut Budget::new(t::limits())),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(t::bytes(&c), before);
        }
        t::check_budgets(|limits| {
            let mut b = Budget::new(limits);
            s.validate_file(&mut b)?;
            Ok(b.usage)
        });
    }
}
