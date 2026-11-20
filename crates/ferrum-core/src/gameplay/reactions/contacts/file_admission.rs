use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
impl CollisionContactTracker {
    pub(crate) fn validate_file(
        &self,
        b: &mut Budget,
        expected_max: usize,
        current_empty: bool,
    ) -> Result<(), Error> {
        let Self {
            previous_contacts: _,
            current_contacts: _,
            max_contacts: _,
        } = self;
        b.work(3)?;
        b.vector(&self.previous_contacts)?;
        b.vector(&self.current_contacts)?;
        require(
            self.max_contacts == expected_max
                && self.previous_contacts.len() <= expected_max
                && self.current_contacts.len() <= expected_max
                && self.previous_contacts.capacity() >= expected_max
                && self.current_contacts.capacity() >= expected_max,
            "contact_tracker",
            "bounds",
            0,
            Problem::Length,
        )?;
        require(
            !current_empty || self.current_contacts.is_empty(),
            "contact_tracker",
            "current",
            0,
            Problem::History,
        )?;
        for rows in [&self.previous_contacts, &self.current_contacts] {
            b.product(rows.len(), 4)?;
            for (i, k) in rows.iter().enumerate() {
                require(
                    (k.a_id, k.a_generation) <= (k.b_id, k.b_generation)
                        && (i == 0 || rows[i - 1] < *k),
                    "contact_tracker",
                    "keys",
                    i,
                    Problem::Order,
                )?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::file_admission as f;
    fn limits() -> f::Limits {
        f::Limits {
            max_work: 100000,
            max_scratch_bytes: 100000,
        }
    }
    fn validate(t: &CollisionContactTracker, empty: bool, l: f::Limits) -> Result<f::Usage, Error> {
        let mut b = Budget::new(l);
        t.validate_file(&mut b, 16, empty)?;
        Ok(b.usage())
    }
    #[test]
    fn file_gameplay_shared_contacts_actual_register_finish_old_generation_and_self_key() {
        let mut t = CollisionContactTracker::with_capacity(16);
        let a = Entity {
            id: 91,
            generation: u32::MAX,
        };
        let z = Entity {
            id: 2,
            generation: 7,
        };
        assert!(t.register(a, z));
        assert!(t.register(a, a));
        let pending = crate::checkpoint_codec::encode(&t).unwrap();
        validate(&t, false, limits()).unwrap();
        assert!(matches!(
            validate(&t, true, limits()),
            Err(Error::Invalid {
                problem: Problem::History,
                ..
            })
        ));
        assert_eq!(crate::checkpoint_codec::encode(&t).unwrap(), pending);
        t.finish();
        let old = crate::checkpoint_codec::encode(&t).unwrap();
        let d: CollisionContactTracker = crate::checkpoint_codec::decode(&old).unwrap();
        let u = validate(&d, true, limits()).unwrap();
        assert_eq!(
            validate(
                &d,
                true,
                f::Limits {
                    max_work: u.work,
                    max_scratch_bytes: 0
                }
            ),
            Ok(u)
        );
        assert_eq!(
            validate(
                &d,
                true,
                f::Limits {
                    max_work: u.work - 1,
                    max_scratch_bytes: 0
                }
            ),
            Err(Error::WorkLimit)
        );
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), old);
    }
    #[test]
    fn file_gameplay_shared_contacts_valid_crc_order_and_duplicate_reject() {
        let mut t = CollisionContactTracker::with_capacity(16);
        t.register(
            Entity {
                id: 0,
                generation: 0,
            },
            Entity {
                id: 1,
                generation: 4,
            },
        );
        t.register(
            Entity {
                id: 2,
                generation: 0,
            },
            Entity {
                id: 3,
                generation: 4,
            },
        );
        t.finish();
        for duplicate in [false, true] {
            let mut d = t.clone();
            if duplicate {
                d.previous_contacts.push(d.previous_contacts[0]);
            } else {
                d.previous_contacts.reverse();
            }
            let bad = crate::checkpoint_codec::encode(&d).unwrap();
            let r = crate::checkpoint_codec::decode(&bad).unwrap();
            assert!(matches!(
                validate(&r, true, limits()),
                Err(Error::Invalid {
                    problem: Problem::Order,
                    ..
                })
            ));
            assert_eq!(crate::checkpoint_codec::encode(&r).unwrap(), bad);
        }
    }
}
