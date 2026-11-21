use super::*;
use crate::collision::file_scratch_admission::{
    self as f, Budget, Error, Limits, Owner, Problem, Usage,
};
#[allow(dead_code)]
impl RigidBodyStepScratch {
    pub(crate) fn validate_file(&self, _world: &World, limits: Limits) -> Result<Usage, Error> {
        let mut b = Budget::new(limits);
        self.validate_file_with_budget(&mut b)?;
        Ok(b.usage)
    }
    pub(crate) fn validate_file_with_budget(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            integrated_bodies: _,
            ccd_collision: _,
            ccd_candidates: _,
            position_collision: _,
            position_contacts: _,
            contact_constraint_scratch: _,
            contact_constraints: _,
            island_graph: _,
            island_seen_roots: _,
            island_collision: _,
            island_manifolds: _,
            island_schedule: _,
            joint_buckets: _,
            sleep: _,
            split_impulses: _,
        } = self;
        b.work(15)?;
        b.vector(&self.integrated_bodies)?;
        self.ccd_collision.validate_file_with_budget(b)?;
        f::keys(&self.ccd_candidates, b, Owner::Rigid, "ccd_candidates")?;
        self.position_collision.validate_file_with_budget(b)?;
        b.vector(&self.position_contacts)?;
        for (i, &v) in self.position_contacts.iter().enumerate() {
            b.work(12)?;
            f::require(
                f::contact(v),
                Owner::Rigid,
                "position_contacts",
                i,
                Problem::Number,
            )?;
        }
        self.contact_constraint_scratch.validate_file(b)?;
        b.vector(&self.contact_constraints)?;
        for (i, v) in self.contact_constraints.iter().enumerate() {
            v.validate_file(b, i)?;
        }
        self.island_graph.validate_file(b)?;
        b.vector(&self.island_seen_roots)?;
        f::require(
            self.island_seen_roots.len() == self.island_graph.file_node_count(),
            Owner::Rigid,
            "island_seen_roots",
            0,
            Problem::Length,
        )?;
        self.island_collision.validate_file_with_budget(b)?;
        b.vector(&self.island_manifolds)?;
        for (i, &v) in self.island_manifolds.iter().enumerate() {
            b.work(16)?;
            f::require(
                f::manifold(v),
                Owner::Rigid,
                "island_manifolds",
                i,
                Problem::Number,
            )?;
        }
        self.island_schedule.validate_file(b)?;
        self.joint_buckets
            .validate_file(self.island_schedule.file_island_count(), b)?;
        self.sleep.validate_file(b)?;
        if let Some(v) = &self.split_impulses {
            v.validate_file(b)?;
        }
        Ok(())
    }
}
#[cfg(test)]
impl RigidBodyStepScratch {
    pub(crate) fn file_test_populated_counts(&self) -> [usize; 4] {
        [
            self.contact_constraints.len(),
            self.island_graph.file_node_count(),
            self.position_contacts.len(),
            self.island_manifolds.len(),
        ]
    }
    pub(crate) fn file_corrupt_fixture(&mut self) {
        self.contact_constraints[0].file_corrupt_fixture();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::file_scratch_admission::test_support as t;
    #[test]
    fn file_scratch_rigid_real_steps_all_nested_payloads_stale_world_and_six_step_replay() {
        let (mut w, es) = t::fixture();
        let mut s = RigidBodyStepScratch::default();
        for _ in 0..2 {
            PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
                &mut w,
                0.01,
                t::config(),
                &mut s,
            );
        }
        assert!(
            !s.contact_constraints.is_empty()
                && s.island_graph.file_node_count() > 0
                && s.split_impulses.is_some()
        );
        let before = t::bytes(&s);
        s.validate_file(&w, t::limits()).unwrap();
        let mut r: RigidBodyStepScratch = t::restored(&s);
        assert_eq!(t::bytes(&r), before);
        r.validate_file(&w, t::limits()).unwrap();
        w.despawn(es[1]);
        s.validate_file(&w, t::limits()).unwrap();
        assert_eq!(t::bytes(&s), before);
        let mut w2 = t::restored_world(&w);
        for dt in [0.0, 0.001, 0.01, 0.025, 0.01, 0.0] {
            let a = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
                &mut w,
                dt,
                t::config(),
                &mut s,
            );
            let c = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
                &mut w2,
                dt,
                t::config(),
                &mut r,
            );
            assert_eq!(a, c);
            s.validate_file(&w, t::limits()).unwrap();
            r.validate_file(&w2, t::limits()).unwrap();
            assert_eq!(t::bytes(&s), t::bytes(&r));
            assert_eq!(t::world_bytes(&w), t::world_bytes(&w2));
            assert_eq!(
                w.rigid_contact_impulses().collect::<Vec<_>>(),
                w2.rigid_contact_impulses().collect::<Vec<_>>()
            );
        }
        t::check_budgets(|limits| s.validate_file(&w, limits));
    }
    #[test]
    fn file_scratch_rigid_nested_history_and_typed_rejection_leave_bytes() {
        let (mut w, _) = t::fixture();
        let mut s = RigidBodyStepScratch::default();
        PhysicsSystem::step_rigid_bodies_with_config_and_scratch(&mut w, 0.01, t::config(), &mut s);
        for case in 0..3 {
            let mut c = s.clone();
            match case {
                0 => c.contact_constraints[0].file_corrupt_fixture(),
                1 => {
                    c.island_seen_roots.push(false);
                }
                _ => c.ccd_candidates.push(ColliderKey {
                    entity_index: 0,
                    collider_index: 0,
                    segment_index: 64,
                }),
            };
            let before = t::bytes(&c);
            assert!(matches!(
                c.validate_file(&w, t::limits()),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(t::bytes(&c), before);
        }
    }
}
