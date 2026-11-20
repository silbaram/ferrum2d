use super::*;
use crate::collision::file_scratch_admission::{self as f, Budget, Error, Owner, Problem};
impl RigidContactConstraintScratch {
    pub(in crate::physics) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            collision: _,
            collider_manifolds: _,
            contact_cache: _,
        } = self;
        b.work(3)?;
        self.collision.validate_file_with_budget(b)?;
        b.vector(&self.collider_manifolds)?;
        for (i, &v) in self.collider_manifolds.iter().enumerate() {
            b.work(16)?;
            f::require(
                f::manifold(v),
                Owner::Constraint,
                "collider_manifolds",
                i,
                Problem::Number,
            )?;
        }
        self.contact_cache.validate_file(b)
    }
}
impl RigidContactConstraint {
    pub(in crate::physics) fn validate_file(
        &self,
        b: &mut Budget,
        index: usize,
    ) -> Result<(), Error> {
        let Self {
            pair: _,
            collider_pair: _,
            point: _,
            normal: _,
            penetration: _,
            normal_impulse: _,
            tangent_impulse: _,
            split_normal_impulse: _,
            approach_speed: _,
        } = self;
        b.work(9)?;
        f::require(
            f::pair_corresponds(self.collider_pair, self.pair)
                && f::finite(&[
                    self.point.x,
                    self.point.y,
                    self.normal.vx,
                    self.normal.vy,
                    self.penetration,
                    self.normal_impulse,
                    self.tangent_impulse,
                    self.split_normal_impulse,
                    self.approach_speed,
                ])
                && self.penetration >= 0.0
                && self.normal_impulse >= 0.0
                && self.split_normal_impulse >= 0.0,
            Owner::Constraint,
            "values",
            index,
            Problem::Number,
        )
    }
}
#[cfg(test)]
impl RigidContactConstraint {
    pub(in crate::physics) fn file_corrupt_fixture(&mut self) {
        self.normal.vx = f32::NAN;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::file_scratch_admission::test_support as t;
    fn source() -> (RigidContactConstraintScratch, Vec<RigidContactConstraint>) {
        let (w, _) = t::warm_world();
        let mut scratch = RigidContactConstraintScratch::default();
        let mut out = Vec::new();
        build_rigid_contact_constraints_into(&mut scratch, &w, &mut out);
        assert!(!scratch.collider_manifolds.is_empty() && !out.is_empty());
        (scratch, out)
    }
    #[test]
    fn file_scratch_constraint_real_manifolds_cache_and_signed_approach_are_preserved() {
        let (s, mut values) = source();
        values[0].approach_speed = -3.0;
        values[0].tangent_impulse = -2.0;
        let before = t::bytes(&s);
        s.validate_file(&mut Budget::new(t::limits())).unwrap();
        let r: RigidContactConstraintScratch = t::restored(&s);
        r.validate_file(&mut Budget::new(t::limits())).unwrap();
        assert_eq!(t::bytes(&r), before);
        for v in values {
            let before = t::bytes(&v);
            v.validate_file(&mut Budget::new(t::limits()), 0).unwrap();
            let r: RigidContactConstraint = t::restored(&v);
            r.validate_file(&mut Budget::new(t::limits()), 0).unwrap();
            assert_eq!(t::bytes(&r), before);
        }
        t::check_budgets(|limits| {
            let mut b = Budget::new(limits);
            s.validate_file(&mut b)?;
            Ok(b.usage)
        });
    }
    #[test]
    fn file_scratch_constraint_full_manifold_slots_and_pair_correspondence_are_checked() {
        let (s, values) = source();
        let mut c = s.clone();
        c.collider_manifolds[0].manifold.point_count = 1;
        c.collider_manifolds[0].manifold.points[1].point_x = f32::NAN;
        let before = t::bytes(&c);
        assert!(matches!(
            c.validate_file(&mut Budget::new(t::limits())),
            Err(Error::Invalid { .. })
        ));
        assert_eq!(t::bytes(&c), before);
        for case in 0..3 {
            let mut c = values[0];
            match case {
                0 => c.normal_impulse = -1.0,
                1 => c.collider_pair.a.entity_index = 999,
                _ => c.normal.vx = f32::NAN,
            };
            let before = t::bytes(&c);
            assert!(matches!(
                c.validate_file(&mut Budget::new(t::limits()), 0),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(t::bytes(&c), before);
        }
    }
}
