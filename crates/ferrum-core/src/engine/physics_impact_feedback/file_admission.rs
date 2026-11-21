use super::*;
use crate::engine::file_presentation_admission::{
    entity_history, invalid, Budget, Error, Owner, Problem,
};
use crate::{entity::Entity, world::World};
impl ImpactFeedback {
    pub(in crate::engine) fn validate_file(
        &self,
        world: &World,
        budget: &mut Budget,
    ) -> Result<(), Error> {
        budget.work(self.profiles.capacity())?;
        budget.work(self.cooldowns.len())?;
        budget.work(self.terrain_cooldowns.len())?;
        budget.work(1)?;
        if self.profiles.len() > 32 || self.cooldowns.len() + self.terrain_cooldowns.len() > 1024 {
            return Err(invalid(Owner::ImpactProfiles, 0, Problem::Count));
        }
        if !self.time.is_finite() || self.time < 0.0 || self.emitted > 32 {
            return Err(invalid(Owner::ImpactCooldowns, 0, Problem::Clock));
        }
        for (index, p) in self.profiles.iter().enumerate() {
            if p.mask == 0
                || !p.min_impulse.is_finite()
                || p.min_impulse < 0.0
                || !p.cooldown.is_finite()
                || !(0.0..=60.0).contains(&p.cooldown)
                || !p.volume.is_finite()
                || !(0.0..=1.0).contains(&p.volume)
            {
                return Err(invalid(Owner::ImpactProfiles, index, Problem::Range));
            }
            if (p.sound != u32::MAX && p.sound > 16_777_216)
                || (p.particle != u32::MAX
                    && p.particle >= super::super::MAX_PARTICLE_PRESETS as u32)
            {
                return Err(invalid(Owner::ImpactProfiles, index, Problem::Sentinel));
            }
            // A once registered preset may since have been cleared. Its presence,
            // audio resource bytes and GPU readiness are not invariants here.
        }
        for (index, (&(a, ag, b, bg), &end)) in self.cooldowns.iter().enumerate() {
            if (a, ag) > (b, bg)
                || !entity_history(
                    world,
                    Entity {
                        id: a,
                        generation: ag,
                    },
                )
                || !entity_history(
                    world,
                    Entity {
                        id: b,
                        generation: bg,
                    },
                )
            {
                return Err(invalid(Owner::ImpactCooldowns, index, Problem::Reference));
            }
            // f64 rounding can make a newly inserted deadline equal to time.
            if !end.is_finite() || end < self.time {
                return Err(invalid(Owner::ImpactCooldowns, index, Problem::Clock));
            }
        }
        for (index, (&key, &end)) in self.terrain_cooldowns.iter().enumerate() {
            budget.work(8)?;
            if !entity_history(
                world,
                Entity {
                    id: key[0],
                    generation: key[1],
                },
            ) || !(key[4] == 1 || key[4] == 2 && key[5] > 0 && key[5] <= 65535 && key[6] == 0)
            {
                return Err(invalid(Owner::ImpactCooldowns, index, Problem::Reference));
            }
            if !end.is_finite() || end < self.time {
                return Err(invalid(Owner::ImpactCooldowns, index, Problem::Clock));
            }
        }
        Ok(())
    }
    #[cfg(test)]
    pub(in crate::engine) fn corrupt_file_fixture(&mut self) {
        self.time = f64::NAN;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::file_presentation_admission::Limits;
    fn budget() -> Budget {
        Budget::new(Limits {
            max_work: 10000,
            max_scratch_bytes: 0,
        })
    }
    fn fixture() -> (World, ImpactFeedback) {
        let mut world = World::default();
        let a = world.spawn_entity();
        let b = world.spawn_entity();
        let mut f = ImpactFeedback {
            profiles: vec![Profile {
                mask: u32::MAX,
                min_impulse: 0.0,
                cooldown: 0.0,
                sound: u32::MAX,
                particle: 255,
                volume: 0.0,
            }],
            time: 1.0,
            emitted: 32,
            dropped: u32::MAX,
            ..Default::default()
        };
        f.cooldowns
            .insert((a.id, a.generation, b.id, b.generation), 1.0);
        world.despawn(a);
        (world, f)
    }
    #[test]
    fn file_presentation_impact_stale_pair_equal_deadline_sentinels_and_history_are_legal() {
        let (world, f) = fixture();
        let before = crate::checkpoint_codec::encode(&f).unwrap();
        assert_eq!(f.validate_file(&world, &mut budget()), Ok(()));
        assert_eq!(crate::checkpoint_codec::encode(&f).unwrap(), before);
    }
    #[test]
    fn file_presentation_impact_profile_and_pair_private_corruption_are_typed() {
        let (world, source) = fixture();
        let cases: [fn(&mut ImpactFeedback); 6] = [
            |f| f.profiles[0].mask = 0,
            |f| f.profiles[0].sound = u32::MAX - 1,
            |f| f.profiles[0].particle = 256,
            |f| f.emitted = 33,
            |f| {
                f.cooldowns.clear();
                f.cooldowns.insert((u32::MAX, 0, 0, 0), 2.0);
            },
            |f| {
                *f.cooldowns.values_mut().next().unwrap() = 0.5;
            },
        ];
        for corrupt in cases {
            let mut f = source.clone();
            corrupt(&mut f);
            let before = crate::checkpoint_codec::encode(&f).unwrap();
            assert!(matches!(
                f.validate_file(&world, &mut budget()),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(crate::checkpoint_codec::encode(&f).unwrap(), before);
        }
    }
}
