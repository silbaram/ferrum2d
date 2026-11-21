use super::*;
use crate::collision::file_scratch_admission::{self as f, Budget, Error, Owner, Problem};
impl RigidBodySleepScratch {
    pub(in crate::physics) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            graph: _,
            collision: _,
            manifolds: _,
            root_flags: _,
            secondary_root_flags: _,
            node_flags: _,
            seen_roots: _,
            body_indices: _,
        } = self;
        b.work(8)?;
        self.graph.validate_file(b)?;
        self.collision.validate_file_with_budget(b)?;
        b.vector(&self.manifolds)?;
        for (i, &v) in self.manifolds.iter().enumerate() {
            b.work(16)?;
            f::require(
                f::manifold(v),
                Owner::Sleep,
                "manifolds",
                i,
                Problem::Number,
            )?;
        }
        b.vector(&self.root_flags)?;
        b.vector(&self.secondary_root_flags)?;
        b.vector(&self.node_flags)?;
        b.vector(&self.seen_roots)?;
        // Flags are cleared/resized independently on wake/sleep/early-return paths.
        // Their retained lengths need not equal the most recently rebuilt graph.
        f::unique_indices(&self.body_indices, b, Owner::Sleep, "body_indices")?;
        self.graph
            .validate_file_entity_indices(&self.body_indices, b)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::file_scratch_admission::test_support as t;
    #[test]
    fn file_scratch_sleep_real_graph_flags_early_clear_and_stale_body_history() {
        let (mut w, es) = t::warm_world();
        let mut s = RigidBodySleepScratch::default();
        let mut stats = RigidBodyStepStats::default();
        for &e in &es[1..3] {
            let mut body = w.rigid_body(e).unwrap();
            body.can_sleep = true;
            body.sleep_timer_seconds = 10.0;
            w.set_rigid_body(e, body);
            w.set_velocity(e, Velocity::default());
        }
        update_rigid_body_sleep_states(&mut w, 0.01, &mut stats, &mut s);
        assert!(s.graph.file_node_count() > 0);
        let before = t::bytes(&s);
        w.despawn(es[1]);
        s.validate_file(&mut Budget::new(t::limits())).unwrap();
        let r: RigidBodySleepScratch = t::restored(&s);
        r.validate_file(&mut Budget::new(t::limits())).unwrap();
        assert_eq!(t::bytes(&r), before);
        let graph_before = t::bytes(&s.graph);
        s.clear_transient_results();
        assert_eq!(t::bytes(&s.graph), graph_before);
        s.validate_file(&mut Budget::new(t::limits())).unwrap();
        s.body_indices.push(usize::MAX);
        let before = t::bytes(&s);
        assert!(matches!(
            s.validate_file(&mut Budget::new(t::limits())),
            Err(Error::Invalid { .. })
        ));
        assert_eq!(t::bytes(&s), before);
        t::check_budgets(|limits| {
            let mut b = Budget::new(limits);
            r.validate_file(&mut b)?;
            Ok(b.usage)
        });
    }
}
