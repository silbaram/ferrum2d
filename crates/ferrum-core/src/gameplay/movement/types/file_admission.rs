use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl MovementNavigationTargetCache {
    pub(crate) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            generation: _,
            target_identity: _,
            target: _,
            remaining_seconds: _,
        } = self;
        b.work(8)?;
        require(
            finite(&[self.target.x, self.target.y, self.remaining_seconds])
                && self.remaining_seconds >= 0.,
            "target_cache",
            "numbers",
            0,
            Problem::Number,
        )?;
        require(
            match self.target_identity {
                MovementNavigationTargetIdentity::NearestFaction(id)
                | MovementNavigationTargetIdentity::NearestTag(id) => id < 32,
                _ => true,
            },
            "target_cache",
            "target",
            0,
            Problem::Range,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::{file_admission as f, tick_movement_navigation_targets};
    fn budget() -> Budget {
        Budget::new(f::Limits {
            max_work: 10000,
            max_scratch_bytes: 0,
        })
    }
    #[test]
    fn file_gameplay_shared_target_cache_actual_producer_old_token_ticks_and_signed_zero() {
        let mut caches = Vec::new();
        crate::gameplay::resolve_movement_navigation_target(
            &mut caches,
            MovementNavigationSource {
                index: 3,
                generation: 99,
                transform: Transform2D { x: 1., y: 2. },
            },
            MovementNavigationTargetIdentity::Entity(Entity {
                id: u32::MAX,
                generation: 6,
            }),
            Transform2D { x: -0., y: 3. },
            0.25,
            4.,
            |_, _| None,
        );
        let old = crate::checkpoint_codec::encode(&caches).unwrap();
        let mut d: Vec<Option<MovementNavigationTargetCache>> =
            crate::checkpoint_codec::decode(&old).unwrap();
        d[3].unwrap().validate_file(&mut budget()).unwrap();
        assert_eq!(d[3].unwrap().target.x.to_bits(), (-0.0f32).to_bits());
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), old);
        for dt in [0., 0.1, 0.2, 1., 0.01, 0.] {
            tick_movement_navigation_targets(&mut caches, dt);
            tick_movement_navigation_targets(&mut d, dt);
            d[3].unwrap().validate_file(&mut budget()).unwrap();
            assert_eq!(
                crate::checkpoint_codec::encode(&caches).unwrap(),
                crate::checkpoint_codec::encode(&d).unwrap()
            );
        }
    }
    #[test]
    fn file_gameplay_shared_target_cache_valid_crc_nonfinite_rejected() {
        let cache = MovementNavigationTargetCache {
            generation: 0,
            target_identity: MovementNavigationTargetIdentity::PrimaryActor,
            target: Transform2D {
                x: 0.,
                y: f32::INFINITY,
            },
            remaining_seconds: 0.,
        };
        let bad = crate::checkpoint_codec::encode(&cache).unwrap();
        let d: MovementNavigationTargetCache = crate::checkpoint_codec::decode(&bad).unwrap();
        assert!(matches!(
            d.validate_file(&mut budget()),
            Err(Error::Invalid {
                problem: Problem::Number,
                ..
            })
        ));
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), bad);
    }
}
