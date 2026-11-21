use super::*;
use crate::collision::file_scratch_admission::{self as f, Budget, Error, Owner, Problem};
impl RigidBodyJointIslandBuckets {
    pub(in crate::physics) fn validate_file(
        &self,
        islands: usize,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            distance: _,
            rope: _,
            spring: _,
            pulley: _,
            revolute: _,
            prismatic: _,
            weld: _,
            gear: _,
        } = self;
        b.work(8)?;
        for (name, outer) in [
            ("distance", &self.distance),
            ("rope", &self.rope),
            ("spring", &self.spring),
            ("pulley", &self.pulley),
            ("revolute", &self.revolute),
            ("prismatic", &self.prismatic),
            ("weld", &self.weld),
            ("gear", &self.gear),
        ] {
            b.vector(outer)?;
            f::require(
                outer.len() == islands,
                Owner::Buckets,
                name,
                0,
                Problem::Length,
            )?;
            let mut count = 0usize;
            for inner in outer {
                b.vector(inner)?;
                count = count.checked_add(inner.len()).ok_or(Error::WorkLimit)?;
            }
            b.sort(count)?;
            let mut all = b.reserve::<usize>(count)?;
            for inner in outer {
                for (i, &index) in inner.iter().enumerate() {
                    f::require(
                        u32::try_from(index).is_ok() && (i == 0 || inner[i - 1] < index),
                        Owner::Buckets,
                        name,
                        i,
                        Problem::Order,
                    )?;
                    all.push(index);
                }
            }
            all.sort_unstable();
            f::require(
                !all.windows(2).any(|w| w[0] == w[1]),
                Owner::Buckets,
                name,
                0,
                Problem::Duplicate,
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
    fn file_scratch_joint_buckets_actual_joint_stale_slot_nested_wire_and_corruption() {
        let (mut w, es) = t::fixture();
        w.add_distance_joint(crate::components::DistanceJoint::new(es[1], es[2], 2.0));
        let mut g = crate::physics::islands::RigidBodyIslandGraph::default();
        let mut schedule = RigidBodyIslandSchedule::default();
        schedule.rebuild_from_world_and_contacts(&w, &[], &mut g, &mut Vec::new());
        let mut buckets = RigidBodyJointIslandBuckets::default();
        buckets.rebuild_from_world_and_schedule(&w, &schedule);
        assert!(buckets.distance.iter().any(|v| !v.is_empty()));
        let islands = schedule.file_island_count();
        let before = t::bytes(&buckets);
        w.despawn(es[1]);
        buckets
            .validate_file(islands, &mut Budget::new(t::limits()))
            .unwrap();
        let r: RigidBodyJointIslandBuckets = t::restored(&buckets);
        r.validate_file(islands, &mut Budget::new(t::limits()))
            .unwrap();
        assert_eq!(t::bytes(&r), before);
        assert_eq!(t::bytes(&buckets), before);
        let mut c = buckets.clone();
        c.distance[0].extend([0, 0]);
        let before = t::bytes(&c);
        assert!(matches!(
            c.validate_file(islands, &mut Budget::new(t::limits())),
            Err(Error::Invalid { .. })
        ));
        assert_eq!(t::bytes(&c), before);
        let mut c = buckets.clone();
        c.gear.pop();
        assert!(matches!(
            c.validate_file(islands, &mut Budget::new(t::limits())),
            Err(Error::Invalid {
                problem: Problem::Length,
                ..
            })
        ));
        t::check_budgets(|limits| {
            let mut b = Budget::new(limits);
            buckets.validate_file(islands, &mut b)?;
            Ok(b.usage)
        });
    }
}
