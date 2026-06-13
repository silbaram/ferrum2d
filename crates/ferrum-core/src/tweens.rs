use crate::entity::Entity;
use crate::world::World;

const DEFAULT_TWEEN_CAPACITY: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpriteTint {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl SpriteTint {
    pub const fn new(r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { r, g, b, a }
    }

    fn lerp(self, other: Self, amount: f32) -> Self {
        Self {
            r: lerp(self.r, other.r, amount),
            g: lerp(self.g, other.g, amount),
            b: lerp(self.b, other.b, amount),
            a: lerp(self.a, other.a, amount),
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TweenEasing {
    Linear,
    EaseOut,
    EaseInOut,
}

impl TweenEasing {
    fn sample(self, amount: f32) -> f32 {
        let amount = amount.clamp(0.0, 1.0);
        match self {
            Self::Linear => amount,
            Self::EaseOut => 1.0 - (1.0 - amount) * (1.0 - amount),
            Self::EaseInOut => {
                if amount < 0.5 {
                    2.0 * amount * amount
                } else {
                    1.0 - (-2.0 * amount + 2.0).powi(2) * 0.5
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TweenTarget {
    SpriteTint { entity: Entity },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Tween {
    target: TweenTarget,
    start_tint: SpriteTint,
    end_tint: SpriteTint,
    duration_seconds: f32,
    elapsed_seconds: f32,
    easing: TweenEasing,
}

#[derive(Debug)]
pub(crate) struct TweenSystem {
    tweens: Vec<Tween>,
    capacity: usize,
}

impl Default for TweenSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl TweenSystem {
    pub fn new() -> Self {
        Self {
            tweens: Vec::with_capacity(DEFAULT_TWEEN_CAPACITY),
            capacity: DEFAULT_TWEEN_CAPACITY,
        }
    }

    #[cfg(test)]
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            tweens: Vec::with_capacity(capacity),
            capacity,
        }
    }

    pub fn clear(&mut self) {
        self.tweens.clear();
    }

    #[cfg(test)]
    pub fn tween_count(&self) -> usize {
        self.tweens.len()
    }

    pub fn flash_sprite_tint(
        &mut self,
        world: &mut World,
        entity: Entity,
        flash_tint: SpriteTint,
        duration_seconds: f32,
        easing: TweenEasing,
    ) -> bool {
        let Some(base_tint) = self.replacement_end_tint(world, entity) else {
            return false;
        };
        self.start_sprite_tint_internal(
            world,
            entity,
            flash_tint,
            base_tint,
            duration_seconds,
            easing,
        )
    }

    #[cfg(test)]
    pub fn start_sprite_tint(
        &mut self,
        world: &mut World,
        entity: Entity,
        start_tint: SpriteTint,
        end_tint: SpriteTint,
        duration_seconds: f32,
        easing: TweenEasing,
    ) -> bool {
        self.start_sprite_tint_internal(
            world,
            entity,
            start_tint,
            end_tint,
            duration_seconds,
            easing,
        )
    }

    pub fn update(&mut self, world: &mut World, delta_seconds: f32) {
        if delta_seconds <= 0.0 || !delta_seconds.is_finite() {
            return;
        }

        let mut write_index = 0;
        for read_index in 0..self.tweens.len() {
            let mut tween = self.tweens[read_index];
            if !target_is_alive(world, tween.target) {
                continue;
            }

            tween.elapsed_seconds =
                (tween.elapsed_seconds + delta_seconds).min(tween.duration_seconds);
            let amount = tween
                .easing
                .sample(tween.elapsed_seconds / tween.duration_seconds);
            if !apply_tween(world, tween, amount) {
                continue;
            }

            if tween.elapsed_seconds < tween.duration_seconds {
                self.tweens[write_index] = tween;
                write_index += 1;
            }
        }
        self.tweens.truncate(write_index);
    }

    fn replacement_end_tint(&self, world: &World, entity: Entity) -> Option<SpriteTint> {
        let target = TweenTarget::SpriteTint { entity };
        self.tweens
            .iter()
            .find(|tween| tween.target == target)
            .map(|tween| tween.end_tint)
            .or_else(|| sprite_tint(world, entity))
    }

    fn start_sprite_tint_internal(
        &mut self,
        world: &mut World,
        entity: Entity,
        start_tint: SpriteTint,
        end_tint: SpriteTint,
        duration_seconds: f32,
        easing: TweenEasing,
    ) -> bool {
        if duration_seconds <= 0.0 || !duration_seconds.is_finite() {
            return false;
        }
        let target = TweenTarget::SpriteTint { entity };
        if !target_is_alive(world, target) {
            return false;
        }
        let tween = Tween {
            target,
            start_tint,
            end_tint,
            duration_seconds,
            elapsed_seconds: 0.0,
            easing,
        };
        if !self.replace_or_push(tween) {
            return false;
        }
        apply_sprite_tint(world, entity, start_tint)
    }

    fn replace_or_push(&mut self, tween: Tween) -> bool {
        if let Some(existing) = self
            .tweens
            .iter_mut()
            .find(|existing| existing.target == tween.target)
        {
            *existing = tween;
            return true;
        }
        if self.tweens.len() >= self.capacity {
            return false;
        }
        self.tweens.push(tween);
        true
    }
}

fn apply_tween(world: &mut World, tween: Tween, amount: f32) -> bool {
    match tween.target {
        TweenTarget::SpriteTint { entity } => {
            apply_sprite_tint(world, entity, tween.start_tint.lerp(tween.end_tint, amount))
        }
    }
}

fn target_is_alive(world: &World, target: TweenTarget) -> bool {
    match target {
        TweenTarget::SpriteTint { entity } => sprite_tint(world, entity).is_some(),
    }
}

fn sprite_tint(world: &World, entity: Entity) -> Option<SpriteTint> {
    let index = valid_entity_index(world, entity)?;
    world.sprite_at_index(index).map(|sprite| SpriteTint {
        r: sprite.r,
        g: sprite.g,
        b: sprite.b,
        a: sprite.a,
    })
}

fn apply_sprite_tint(world: &mut World, entity: Entity, tint: SpriteTint) -> bool {
    let Some(index) = valid_entity_index(world, entity) else {
        return false;
    };
    let Some(sprite) = world.sprite_mut_at_index(index) else {
        return false;
    };
    sprite.r = tint.r;
    sprite.g = tint.g;
    sprite.b = tint.b;
    sprite.a = tint.a;
    true
}

fn valid_entity_index(world: &World, entity: Entity) -> Option<usize> {
    let index = entity.id as usize;
    world.is_current_entity(entity).then_some(index)
}

fn lerp(start: f32, end: f32, amount: f32) -> f32 {
    start + (end - start) * amount
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shooter_scene::DEFAULT_TEXTURE_ID;

    #[test]
    fn easing_samples_expected_midpoints() {
        assert_eq!(TweenEasing::Linear.sample(0.5), 0.5);
        assert_eq!(TweenEasing::EaseOut.sample(0.5), 0.75);
        assert_eq!(TweenEasing::EaseInOut.sample(0.5), 0.5);
    }

    #[test]
    fn sprite_tint_tween_applies_and_auto_removes() {
        let mut world = World::default();
        let entity = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);
        let mut tweens = TweenSystem::new();
        let start = SpriteTint::new(1.0, 1.0, 1.0, 1.0);
        let end = SpriteTint::new(0.5, 0.25, 0.25, 0.5);

        assert!(tweens.start_sprite_tint(&mut world, entity, start, end, 1.0, TweenEasing::Linear));
        tweens.update(&mut world, 0.5);

        let sprite = world.sprite_at_index(entity.id as usize).unwrap();
        assert_eq!(sprite.r, 0.75);
        assert_eq!(sprite.g, 0.625);
        assert_eq!(sprite.b, 0.625);
        assert_eq!(sprite.a, 0.75);
        assert_eq!(tweens.tween_count(), 1);

        tweens.update(&mut world, 0.5);

        let sprite = world.sprite_at_index(entity.id as usize).unwrap();
        assert_eq!(sprite.r, end.r);
        assert_eq!(sprite.g, end.g);
        assert_eq!(sprite.b, end.b);
        assert_eq!(sprite.a, end.a);
        assert_eq!(tweens.tween_count(), 0);
    }

    #[test]
    fn flash_sprite_tint_replaces_same_target_and_keeps_original_end_tint() {
        let mut world = World::default();
        let entity = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);
        let original = sprite_tint(&world, entity).unwrap();
        let mut tweens = TweenSystem::new();
        let first_flash = SpriteTint::new(1.0, 1.0, 0.5, 1.0);
        let second_flash = SpriteTint::new(1.0, 0.9, 0.4, 1.0);

        assert!(tweens.flash_sprite_tint(
            &mut world,
            entity,
            first_flash,
            1.0,
            TweenEasing::Linear,
        ));
        tweens.update(&mut world, 0.5);
        assert!(tweens.flash_sprite_tint(
            &mut world,
            entity,
            second_flash,
            1.0,
            TweenEasing::Linear,
        ));

        assert_eq!(tweens.tween_count(), 1);
        tweens.update(&mut world, 1.0);
        assert_eq!(sprite_tint(&world, entity), Some(original));
    }

    #[test]
    fn dead_or_reused_entities_are_removed_without_applying() {
        let mut world = World::default();
        let entity = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);
        let mut tweens = TweenSystem::new();

        assert!(tweens.start_sprite_tint(
            &mut world,
            entity,
            SpriteTint::new(1.0, 1.0, 1.0, 1.0),
            SpriteTint::new(0.0, 0.0, 0.0, 0.0),
            1.0,
            TweenEasing::Linear,
        ));
        world.despawn(entity);
        let reused = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);

        tweens.update(&mut world, 0.5);

        assert_ne!(reused.generation, entity.generation);
        assert_eq!(tweens.tween_count(), 0);
        assert_ne!(
            sprite_tint(&world, reused),
            Some(SpriteTint::new(0.5, 0.5, 0.5, 0.5))
        );
    }

    #[test]
    fn capacity_limit_skips_new_targets() {
        let mut world = World::default();
        let first = world.spawn_enemy(10.0, 10.0, DEFAULT_TEXTURE_ID);
        let second = world.spawn_enemy(20.0, 10.0, DEFAULT_TEXTURE_ID);
        let mut tweens = TweenSystem::with_capacity(1);

        assert!(tweens.flash_sprite_tint(
            &mut world,
            first,
            SpriteTint::new(1.0, 1.0, 1.0, 1.0),
            1.0,
            TweenEasing::Linear,
        ));
        assert!(!tweens.flash_sprite_tint(
            &mut world,
            second,
            SpriteTint::new(1.0, 1.0, 1.0, 1.0),
            1.0,
            TweenEasing::Linear,
        ));
        assert_eq!(tweens.tween_count(), 1);
    }
}
