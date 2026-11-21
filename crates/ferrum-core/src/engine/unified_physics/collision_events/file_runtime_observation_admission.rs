use super::{Lifecycle, PairKey};
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};

fn key(pair: PairKey) -> bool {
    pair.a < pair.b
}

impl Lifecycle {
    pub(in crate::engine::unified_physics) fn validate_file_observations(
        &self,
        max: usize,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            enabled: _,
            stream: _,
            limit: _,
            fixtures: _,
            counts: _,
            changed: _,
            transitions: _,
            snapshot: _,
            pending: _,
            pending_dropped: _,
            frame_dropped: _,
            published: _,
        } = self;
        b.work(12)?;
        b.vector(&self.transitions)?;
        b.vector(&self.snapshot)?;
        b.vector(&self.pending)?;
        b.work(self.fixtures.len().checked_mul(9).ok_or(Error::WorkLimit)?)?;
        b.work(self.counts.len().checked_mul(6).ok_or(Error::WorkLimit)?)?;
        b.work(self.changed.len().checked_mul(5).ok_or(Error::WorkLimit)?)?;
        f::require(
            self.limit == max
                && self.published <= self.limit
                && self.pending.len() <= self.limit
                && self.transitions.is_empty()
                && (self.enabled
                    || (self.pending.is_empty() && self.pending_dropped == Default::default())),
            "runtime_lifecycle",
            "limit_pending_transitions",
            0,
            Problem::Graph,
        )?;
        self.stream.validate_file_observations(max, b)?;
        let mut pairs = b.reserve::<PairKey>(self.fixtures.len())?;
        for (i, (&(a, z), &pair)) in self.fixtures.iter().enumerate() {
            f::require(
                a < z && key(pair),
                "runtime_lifecycle",
                "fixture_key",
                i,
                Problem::Order,
            )?;
            pairs.push(pair);
        }
        b.sort(pairs.len())?;
        pairs.sort_unstable();
        b.work(pairs.len())?;
        let mut cursor = 0;
        for (i, (&pair, &count)) in self.counts.iter().enumerate() {
            f::require(
                key(pair) && count > 0,
                "runtime_lifecycle",
                "count_key",
                i,
                Problem::Graph,
            )?;
            let start = cursor;
            while cursor < pairs.len() && pairs[cursor] == pair {
                cursor += 1;
            }
            f::require(
                cursor - start == count as usize,
                "runtime_lifecycle",
                "multiplicity",
                i,
                Problem::Graph,
            )?;
        }
        f::require(
            cursor == pairs.len(),
            "runtime_lifecycle",
            "fixture_coverage",
            0,
            Problem::Graph,
        )?;
        for (i, &pair) in self.changed.iter().enumerate() {
            f::require(
                key(pair),
                "runtime_lifecycle",
                "changed_key",
                i,
                Problem::Order,
            )?;
        }
        for (i, pair) in self.snapshot.iter().enumerate() {
            let crate::physics3d::ActiveCollisionPair {
                first: _,
                second: _,
                sensor: _,
            } = pair;
            b.work(11)?;
            let order = (pair.first.collider, pair.second.collider);
            f::require(
                order.0 < order.1
                    && (i == 0
                        || (
                            self.snapshot[i - 1].first.collider,
                            self.snapshot[i - 1].second.collider,
                        ) < order),
                "runtime_lifecycle",
                "snapshot",
                i,
                Problem::Order,
            )?;
        }
        for (i, event) in self.pending.iter().enumerate() {
            let crate::collision_event::CollisionEvent {
                kind: _,
                a_id: _,
                a_generation: _,
                b_id: _,
                b_generation: _,
                damage_bits: _,
            } = event;
            b.work(6)?;
            f::require(
                matches!(event.kind, 1 | 2 | 3 | 5 | 6 | 7)
                    && (event.a_id, event.a_generation) < (event.b_id, event.b_generation)
                    && event.damage_bits == 0,
                "runtime_lifecycle",
                "pending",
                i,
                Problem::Code,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
impl Lifecycle {
    pub(in crate::engine) fn corrupt_runtime_observation_before(&mut self) {
        self.corrupt_runtime_observation(0);
    }
    pub(in crate::engine) fn corrupt_runtime_observation(&mut self, case: usize) {
        if case >= 16 {
            self.stream.corrupt_runtime_observation(case - 16);
            return;
        }
        let pair = *self.counts.keys().next().unwrap();
        let event = pair.event(1, 5);
        let (&(a, z), _) = self.fixtures.first_key_value().unwrap();
        let first = crate::physics3d::ColliderRef {
            collider: a,
            body: crate::physics3d::BodyId {
                slot: 0,
                generation: 0,
            },
            sensor: false,
        };
        let second = crate::physics3d::ColliderRef {
            collider: z,
            body: crate::physics3d::BodyId {
                slot: 1,
                generation: 0,
            },
            sensor: false,
        };
        let snapshot = crate::physics3d::ActiveCollisionPair {
            first,
            second,
            sensor: false,
        };
        match case {
            0 => *self.counts.values_mut().next().unwrap() = 0,
            1 => self.limit += 1,
            2 => self.published = self.limit + 1,
            3 => {
                self.fixtures.remove(&(a, z));
            }
            4 => *self.counts.values_mut().next().unwrap() += 1,
            5 => {
                self.changed.insert(PairKey {
                    a: pair.b,
                    b: pair.a,
                    trigger: pair.trigger,
                });
            }
            6 => self.transitions.push(crate::physics3d::CollisionEvent {
                first,
                second,
                phase: crate::physics3d::CollisionPhase::Enter,
                sensor: false,
                removed: false,
            }),
            7 => {
                let mut bad = snapshot;
                std::mem::swap(&mut bad.first, &mut bad.second);
                self.snapshot = vec![bad];
            }
            8 => {
                let mut bad = event;
                bad.kind = 4;
                self.pending.push(bad);
            }
            9 => {
                let mut bad = event;
                bad.damage_bits = 1;
                self.pending.push(bad);
            }
            10 => {
                let mut bad = event;
                bad.b_id = bad.a_id;
                bad.b_generation = bad.a_generation;
                self.pending.push(bad);
            }
            11 => {
                self.enabled = false;
                self.pending.push(event);
            }
            12 => self.snapshot = vec![snapshot, snapshot],
            13 => {
                self.counts.insert(
                    PairKey {
                        trigger: !pair.trigger,
                        ..pair
                    },
                    1,
                );
            }
            14 => {
                self.enabled = false;
                self.pending.clear();
                self.pending_dropped.dropped_events = 1;
            }
            15 => self.pending.resize(self.limit + 1, event),
            _ => unreachable!(),
        }
    }
    pub(in crate::engine) fn observation_history_for_test(&self) -> (usize, usize, u32, usize) {
        (
            self.snapshot.len(),
            self.fixtures.len(),
            self.frame_dropped.dropped_transitions,
            self.published,
        )
    }
}
