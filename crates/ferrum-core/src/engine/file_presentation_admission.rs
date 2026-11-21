//! Read-only admission of the five presentation leaves. World storage/history
//! must already be admitted. Frame buffers, assets/GPU, other Engine fields and
//! publication remain separate obligations. No rebuild, clear, step or render.
use super::Engine;
use crate::{entity::Entity, world::World};

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Usage {
    pub work: u64,
    /// Cumulative explicit reservation requests, not allocator capacity or RSS.
    pub scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Owner {
    Particles,
    Presets,
    Fonts,
    Texts,
    Tweens,
    ImpactProfiles,
    ImpactCooldowns,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    Capacity,
    Count,
    Number,
    Frame,
    Range,
    Reference,
    Duplicate,
    Order,
    Font,
    Cache,
    Clock,
    Sentinel,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    Invalid {
        owner: Owner,
        index: usize,
        problem: Problem,
    },
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "presentation file admission rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
pub(crate) fn invalid(owner: Owner, index: usize, problem: Problem) -> Error {
    Error::Invalid {
        owner,
        index,
        problem,
    }
}
pub(crate) struct Budget {
    limits: Limits,
    usage: Usage,
}
impl Budget {
    pub(crate) fn new(limits: Limits) -> Self {
        Self {
            limits,
            usage: Usage::default(),
        }
    }
    pub(crate) fn work(&mut self, value: usize) -> Result<(), Error> {
        self.work_u64(u64::try_from(value).map_err(|_| Error::WorkLimit)?)
    }
    pub(crate) fn work_u64(&mut self, value: u64) -> Result<(), Error> {
        let total = self.usage.work.checked_add(value).ok_or(Error::WorkLimit)?;
        if total > self.limits.max_work {
            return Err(Error::WorkLimit);
        }
        self.usage.work = total;
        Ok(())
    }
    pub(crate) fn sort_work(&mut self, count: usize) -> Result<(), Error> {
        let levels = usize::BITS - count.saturating_sub(1).leading_zeros();
        self.work(
            count
                .checked_mul(levels as usize + 1)
                .ok_or(Error::WorkLimit)?,
        )
    }
    pub(crate) fn scratch<T>(&mut self, count: usize) -> Result<Vec<T>, Error> {
        let bytes = count
            .checked_mul(std::mem::size_of::<T>())
            .ok_or(Error::ScratchLimit)?;
        let total = self
            .usage
            .scratch_bytes
            .checked_add(bytes)
            .ok_or(Error::ScratchLimit)?;
        if total > self.limits.max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.usage.scratch_bytes = total;
        let mut values = Vec::new();
        values
            .try_reserve_exact(count)
            .map_err(|_| Error::Allocation)?;
        Ok(values)
    }
}
/// Allows allocated current/older generations, including retired MAX history.
/// Never treats a stale reference as a reason to remove/rebind the record.
pub(crate) fn entity_history(world: &World, entity: Entity) -> bool {
    world
        .generation_at_index(entity.id as usize)
        .is_some_and(|generation| {
            entity.generation <= generation
                && (world.is_alive_index(entity.id as usize)
                    || entity.generation < generation
                    || generation == u32::MAX)
        })
}
pub(crate) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = Budget::new(limits);
    budget.work(5)?;
    engine.particles.validate_file(&mut budget)?;
    engine
        .bitmap_text
        .validate_file(&engine.world, &mut budget)?;
    engine.tweens.validate_file(&engine.world, &mut budget)?;
    budget.work(engine.particle_presets.capacity())?;
    if engine.particle_presets.len() > super::MAX_PARTICLE_PRESETS {
        return Err(invalid(Owner::Presets, 0, Problem::Count));
    }
    for (index, preset) in engine.particle_presets.iter().enumerate() {
        if let Some(preset) = preset {
            preset.validate_file(index, &mut budget)?;
        }
    }
    engine
        .impact_feedback
        .validate_file(&engine.world, &mut budget)?;
    Ok(budget.usage)
}
#[cfg(test)]
mod tests;
