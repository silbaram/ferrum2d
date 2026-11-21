use super::*;
use crate::collision::file_scratch_admission::{self as f, Budget, Error, Owner, Problem};
impl RigidContactImpulseCacheIndex {
    pub(in crate::physics) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            entries: _,
            buckets: _,
        } = self;
        b.work(2)?;
        b.vector(&self.entries)?;
        b.work(self.buckets.capacity())?;
        b.work(self.buckets.len())?;
        for (i, e) in self.entries.iter().enumerate() {
            f::require(
                f::impulse(e.impulse)
                    && e.next_index.is_none_or(|n| n > i && n < self.entries.len()),
                Owner::ContactCache,
                "entries",
                i,
                Problem::Reference,
            )?;
        }
        b.work(self.entries.len())?;
        let mut seen = b.reserve::<bool>(self.entries.len())?;
        seen.resize(self.entries.len(), false);
        for (key, bucket) in &self.buckets {
            f::require(
                bucket.head_index <= bucket.tail_index && bucket.tail_index < self.entries.len(),
                Owner::ContactCache,
                "buckets",
                0,
                Problem::Reference,
            )?;
            let mut index = bucket.head_index;
            loop {
                f::require(
                    !seen[index],
                    Owner::ContactCache,
                    "buckets",
                    index,
                    Problem::Cycle,
                )?;
                seen[index] = true;
                let e = self.entries[index];
                f::require(
                    ContactCachePairKey::new(e.impulse.entity_a, e.impulse.entity_b) == *key,
                    Owner::ContactCache,
                    "buckets",
                    index,
                    Problem::Key,
                )?;
                match e.next_index {
                    Some(next) => index = next,
                    None => {
                        f::require(
                            index == bucket.tail_index,
                            Owner::ContactCache,
                            "tail",
                            index,
                            Problem::Reference,
                        )?;
                        break;
                    }
                }
            }
        }
        f::require(
            seen.iter().all(|x| *x),
            Owner::ContactCache,
            "entries",
            0,
            Problem::Membership,
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::file_scratch_admission::test_support as t;
    fn source() -> RigidContactImpulseCacheIndex {
        let (w, _) = t::warm_world();
        let mut c = RigidContactImpulseCacheIndex::default();
        c.rebuild_from_world(&w);
        assert!(!c.entries.is_empty());
        c
    }
    #[test]
    fn file_scratch_contact_cache_real_warm_impulses_raw_signed_values_and_wire() {
        let mut c = source();
        c.entries[0].impulse.normal_impulse = -3.0;
        c.entries[0].impulse.tangent_impulse = -0.0;
        let before = t::bytes(&c);
        c.validate_file(&mut Budget::new(t::limits())).unwrap();
        let r: RigidContactImpulseCacheIndex = t::restored(&c);
        r.validate_file(&mut Budget::new(t::limits())).unwrap();
        assert_eq!(t::bytes(&r), before);
        assert_eq!(t::bytes(&c), before);
        t::check_budgets(|limits| {
            let mut b = Budget::new(limits);
            c.validate_file(&mut b)?;
            Ok(b.usage)
        });
    }
    #[test]
    fn file_scratch_contact_cache_forward_links_bucket_coverage_keys_and_numeric_reject() {
        let s = source();
        for case in 0..6 {
            let mut c = s.clone();
            match case {
                0 => c.entries[0].next_index = Some(0),
                1 => c.entries[0].impulse.point_x = f32::NAN,
                2 => c.buckets.clear(),
                3 => c.buckets.values_mut().next().unwrap().tail_index = usize::MAX,
                4 => c.buckets.values_mut().next().unwrap().head_index = usize::MAX,
                _ => {
                    c.entries[0].impulse.entity_a.generation =
                        c.entries[0].impulse.entity_a.generation.wrapping_add(1);
                }
            }
            let before = t::bytes(&c);
            assert!(matches!(
                c.validate_file(&mut Budget::new(t::limits())),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(t::bytes(&c), before);
        }
    }
}
