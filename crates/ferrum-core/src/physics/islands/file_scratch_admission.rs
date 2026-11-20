use super::*;
use crate::collision::file_scratch_admission::{self as f, Budget, Error, Owner, Problem};
impl RigidBodyIslandGraph {
    pub(in crate::physics) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            node_for_entity: _,
            entity_indices: _,
            parents: _,
            sizes: _,
            active: _,
            sleeping: _,
        } = self;
        b.work(6)?;
        b.vector(&self.node_for_entity)?;
        b.vector(&self.entity_indices)?;
        b.vector(&self.parents)?;
        b.vector(&self.sizes)?;
        b.vector(&self.active)?;
        b.vector(&self.sleeping)?;
        let n = self.parents.len();
        f::require(
            self.entity_indices.len() == n
                && self.sizes.len() == n
                && self.active.len() == n
                && self.sleeping.len() == n
                && u32::try_from(self.node_for_entity.len()).is_ok(),
            Owner::Graph,
            "vectors",
            0,
            Problem::Length,
        )?;
        for (i, &entry) in self.node_for_entity.iter().enumerate() {
            if let Some(node) = entry {
                f::require(
                    node < n && self.entity_indices[node] == i,
                    Owner::Graph,
                    "node_for_entity",
                    i,
                    Problem::Reference,
                )?;
            }
        }
        for (i, &entity) in self.entity_indices.iter().enumerate() {
            f::require(
                self.node_for_entity.get(entity) == Some(&Some(i)),
                Owner::Graph,
                "entity_indices",
                i,
                Problem::Reference,
            )?;
        }
        for (i, &parent) in self.parents.iter().enumerate() {
            f::require(
                parent < n && self.sizes[i] > 0 && self.sizes[i] as usize <= n,
                Owner::Graph,
                "parents_sizes",
                i,
                Problem::Range,
            )?;
        }
        b.work(n.checked_mul(6).ok_or(Error::WorkLimit)?)?;
        let mut colors = b.reserve::<u8>(n)?;
        colors.resize(n, 0);
        let mut roots = b.reserve::<usize>(n)?;
        roots.resize(n, usize::MAX);
        let mut path = b.reserve::<usize>(n)?;
        for node in 0..n {
            if colors[node] == 2 {
                continue;
            }
            let mut current = node;
            let root;
            loop {
                if colors[current] == 2 {
                    root = roots[current];
                    break;
                }
                f::require(
                    colors[current] == 0,
                    Owner::Graph,
                    "parents",
                    current,
                    Problem::Cycle,
                )?;
                colors[current] = 1;
                path.push(current);
                let parent = self.parents[current];
                if parent == current {
                    root = current;
                    break;
                }
                current = parent;
            }
            while let Some(node) = path.pop() {
                colors[node] = 2;
                roots[node] = root;
            }
        }
        let mut counts = b.reserve::<u32>(n)?;
        counts.resize(n, 0);
        let mut active = b.reserve::<bool>(n)?;
        active.resize(n, false);
        let mut sleeping = b.reserve::<bool>(n)?;
        sleeping.resize(n, false);
        for (i, &root) in roots.iter().enumerate() {
            counts[root] = counts[root].checked_add(1).ok_or(Error::WorkLimit)?;
            active[root] |= self.active[i];
            sleeping[root] |= self.sleeping[i];
            f::require(
                self.parents[i] == i
                    || (u64::from(self.sizes[self.parents[i]]) >= 2 * u64::from(self.sizes[i])),
                Owner::Graph,
                "sizes",
                i,
                Problem::History,
            )?;
        }
        for i in 0..n {
            if self.parents[i] == i {
                f::require(
                    self.sizes[i] == counts[i]
                        && self.active[i] == active[i]
                        && self.sleeping[i] == sleeping[i],
                    Owner::Graph,
                    "roots",
                    i,
                    Problem::Membership,
                )?;
            }
        }
        Ok(())
    }
    pub(in crate::physics) fn file_node_count(&self) -> usize {
        self.parents.len()
    }
    pub(in crate::physics) fn validate_file_entity_indices(
        &self,
        indices: &[usize],
        b: &mut Budget,
    ) -> Result<(), Error> {
        b.work(indices.len())?;
        for (i, &index) in indices.iter().enumerate() {
            f::require(
                self.node_for_entity.get(index).is_some_and(Option::is_some),
                Owner::Graph,
                "body_indices",
                i,
                Problem::Reference,
            )?;
        }
        Ok(())
    }
}
impl RigidBodyIslandSchedule {
    pub(in crate::physics) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            root_for_entity: _,
            roots: _,
            slot_for_root: _,
        } = self;
        b.work(3)?;
        b.vector(&self.root_for_entity)?;
        b.vector(&self.roots)?;
        b.vector(&self.slot_for_root)?;
        f::require(
            self.slot_for_root.len() <= self.root_for_entity.len()
                && u32::try_from(self.root_for_entity.len()).is_ok(),
            Owner::Schedule,
            "vectors",
            0,
            Problem::Length,
        )?;
        for (i, &root) in self.roots.iter().enumerate() {
            f::require(
                self.slot_for_root.get(root) == Some(&Some(i)),
                Owner::Schedule,
                "roots",
                i,
                Problem::Reference,
            )?;
        }
        for (i, &slot) in self.slot_for_root.iter().enumerate() {
            if let Some(slot) = slot {
                f::require(
                    self.roots.get(slot) == Some(&i),
                    Owner::Schedule,
                    "slot_for_root",
                    i,
                    Problem::Reference,
                )?;
            }
        }
        b.work(self.roots.len())?;
        let mut seen = b.reserve::<bool>(self.roots.len())?;
        seen.resize(self.roots.len(), false);
        for (i, &root) in self.root_for_entity.iter().enumerate() {
            if let Some(root) = root {
                let slot =
                    self.slot_for_root
                        .get(root)
                        .copied()
                        .flatten()
                        .ok_or(Error::Invalid {
                            owner: Owner::Schedule,
                            field: "root_for_entity",
                            index: i,
                            problem: Problem::Reference,
                        })?;
                seen[slot] = true;
            }
        }
        f::require(
            seen.iter().all(|x| *x),
            Owner::Schedule,
            "roots",
            0,
            Problem::Membership,
        )
    }
    pub(in crate::physics) fn file_island_count(&self) -> usize {
        self.roots.len()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::file_scratch_admission::{test_support as t, Limits, Usage};
    fn check(g: &RigidBodyIslandGraph) -> Result<Usage, Error> {
        let mut b = Budget::new(t::limits());
        g.validate_file(&mut b)?;
        Ok(b.usage)
    }
    #[test]
    fn file_scratch_island_real_union_compression_and_schedule_keep_memory_bytes() {
        let (w, _) = t::fixture();
        let mut g = RigidBodyIslandGraph::from_world(&w);
        assert!(g.parents.len() >= 2);
        g.union_nodes(0, 1);
        g.stats();
        let before = t::bytes(&g);
        check(&g).unwrap();
        let r: RigidBodyIslandGraph = t::restored(&g);
        check(&r).unwrap();
        assert_eq!(t::bytes(&r), before);
        let mut s = RigidBodyIslandSchedule::default();
        s.rebuild_from_world_and_contacts(&w, &[], &mut g, &mut Vec::new());
        let before = t::bytes(&s);
        let mut b = Budget::new(t::limits());
        s.validate_file(&mut b).unwrap();
        let r: RigidBodyIslandSchedule = t::restored(&s);
        r.validate_file(&mut Budget::new(t::limits())).unwrap();
        assert_eq!(t::bytes(&s), before);
        assert_eq!(t::bytes(&r), before);
        t::check_budgets(|limits| {
            let mut b = Budget::new(limits);
            g.validate_file(&mut b)?;
            s.validate_file(&mut b)?;
            Ok(b.usage)
        });
    }
    #[test]
    fn file_scratch_island_cycles_and_unproducible_deep_parent_chain_are_typed_readonly() {
        let (w, _) = t::fixture();
        let mut g = RigidBodyIslandGraph::from_world(&w);
        g.parents[0] = 1;
        g.parents[1] = 0;
        let before = t::bytes(&g);
        assert!(matches!(
            check(&g),
            Err(Error::Invalid {
                problem: Problem::Cycle,
                ..
            })
        ));
        assert_eq!(t::bytes(&g), before);
        let n = 16384;
        let g = RigidBodyIslandGraph {
            node_for_entity: (0..n).map(Some).collect(),
            entity_indices: (0..n).collect(),
            parents: (1..n).chain([n - 1]).collect(),
            sizes: (0..n)
                .map(|i| if i == n - 1 { n as u32 } else { 1 })
                .collect(),
            active: vec![false; n],
            sleeping: vec![false; n],
        };
        let before = t::bytes(&g);
        assert!(matches!(
            check(&g),
            Err(Error::Invalid {
                problem: Problem::History,
                ..
            })
        ));
        assert_eq!(t::bytes(&g), before);
    }
    #[test]
    fn file_scratch_island_map_sizes_and_schedule_refs_reject_without_repair() {
        let (w, _) = t::fixture();
        let g = RigidBodyIslandGraph::from_world(&w);
        for case in 0..4 {
            let mut c = g.clone();
            match case {
                0 => c.node_for_entity.clear(),
                1 => c.sizes[0] = 0,
                2 => c.parents[0] = 999,
                _ => c.entity_indices[0] = 999,
            };
            let before = t::bytes(&c);
            assert!(matches!(check(&c), Err(Error::Invalid { .. })));
            assert_eq!(t::bytes(&c), before);
        }
        let mut s = RigidBodyIslandSchedule::default();
        s.rebuild_from_world_and_contacts(&w, &[], &mut g.clone(), &mut Vec::new());
        for case in 0..3 {
            let mut c = s.clone();
            match case {
                0 => c.roots.push(c.roots[0]),
                1 => c.slot_for_root[0] = None,
                _ => c.root_for_entity[0] = Some(999),
            };
            let before = t::bytes(&c);
            assert!(matches!(
                c.validate_file(&mut Budget::new(Limits {
                    max_work: 10_000_000,
                    max_scratch_bytes: 10_000_000
                })),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(t::bytes(&c), before);
        }
    }
}
