use super::*;
use crate::engine::file_presentation_admission::{
    entity_history, invalid, Budget, Error, Owner, Problem,
};
impl TweenSystem {
    pub(crate) fn validate_file(&self, world: &World, budget: &mut Budget) -> Result<(), Error> {
        budget.work(self.tweens.capacity())?;
        budget.work(self.capacity)?;
        // Native clone/rollback may compact backing without changing the limit.
        if self.tweens.len() > self.capacity {
            return Err(invalid(Owner::Tweens, 0, Problem::Capacity));
        }
        budget.sort_work(self.tweens.len())?;
        let mut keys = budget.scratch::<(u32, u32)>(self.tweens.len())?;
        for (index, tween) in self.tweens.iter().enumerate() {
            let TweenTarget::SpriteTint { entity } = tween.target;
            if !entity_history(world, entity) {
                return Err(invalid(Owner::Tweens, index, Problem::Reference));
            }
            if [
                tween.start_tint.r,
                tween.start_tint.g,
                tween.start_tint.b,
                tween.start_tint.a,
                tween.end_tint.r,
                tween.end_tint.g,
                tween.end_tint.b,
                tween.end_tint.a,
                tween.duration_seconds,
                tween.elapsed_seconds,
            ]
            .iter()
            .any(|v| !v.is_finite())
            {
                return Err(invalid(Owner::Tweens, index, Problem::Number));
            }
            if tween.duration_seconds <= 0.0
                || tween.elapsed_seconds < 0.0
                || tween.elapsed_seconds >= tween.duration_seconds
            {
                return Err(invalid(Owner::Tweens, index, Problem::Range));
            }
            keys.push((entity.id, entity.generation));
        }
        keys.sort_unstable();
        if keys.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(invalid(Owner::Tweens, 0, Problem::Duplicate));
        }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn corrupt_file_fixture(&mut self) {
        self.tweens[0].duration_seconds = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::file_presentation_admission::Limits;
    fn budget() -> Budget {
        Budget::new(Limits {
            max_work: 10000,
            max_scratch_bytes: 4096,
        })
    }
    fn fixture() -> (World, TweenSystem) {
        let mut world = World::default();
        let entity = world.spawn_enemy(0.0, 0.0, 1);
        let mut s = TweenSystem::new();
        assert!(s.flash_sprite_tint(
            &mut world,
            entity,
            SpriteTint::new(3.0, -1.0, 2.0, -0.0),
            1.0,
            TweenEasing::Linear
        ));
        (world, s)
    }
    #[test]
    fn file_presentation_tween_duplicate_and_foreign_generation_are_typed_readonly() {
        let (world, mut s) = fixture();
        s.tweens.push(s.tweens[0]);
        let before = crate::checkpoint_codec::encode(&s).unwrap();
        assert_eq!(
            s.validate_file(&world, &mut budget()),
            Err(invalid(Owner::Tweens, 0, Problem::Duplicate))
        );
        assert_eq!(crate::checkpoint_codec::encode(&s).unwrap(), before);
        s.tweens.pop();
        let TweenTarget::SpriteTint { entity } = &mut s.tweens[0].target;
        entity.generation += 100;
        assert_eq!(
            s.validate_file(&world, &mut budget()),
            Err(invalid(Owner::Tweens, 0, Problem::Reference))
        );
    }
    #[test]
    fn file_presentation_tween_capacity_pending_and_nonfinite_elapsed_checks() {
        let (world, s) = fixture();
        assert_eq!(s.validate_file(&world, &mut budget()), Ok(()));
        let mut bad = s.clone();
        bad.capacity = 0;
        assert_eq!(
            bad.validate_file(&world, &mut budget()),
            Err(invalid(Owner::Tweens, 0, Problem::Capacity))
        );
        let mut bad = s.clone();
        bad.tweens[0].elapsed_seconds = f32::NAN;
        assert_eq!(
            bad.validate_file(&world, &mut budget()),
            Err(invalid(Owner::Tweens, 0, Problem::Number))
        );
        let mut bad = s;
        bad.tweens[0].elapsed_seconds = bad.tweens[0].duration_seconds;
        assert_eq!(
            bad.validate_file(&world, &mut budget()),
            Err(invalid(Owner::Tweens, 0, Problem::Range))
        );
    }
}
