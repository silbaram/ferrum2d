//! Cold admission of Data Scene's grid, obstacle overlay, route and animation.
//! Stored caches describe their own producer history, not the current World.
//! This private pass does not execute, rebuild, bind SDK resources or publish.
use super::Engine;
use crate::collision::file_scratch_admission as scratch;
use crate::tilemap::file_admission as tilemap;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Usage {
    pub work: u64,
    pub scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Owner {
    Grid,
    Obstacles,
    Movement,
    Animation,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    Invalid {
        owner: Owner,
        field: &'static str,
        index: usize,
    },
    Tilemap {
        owner: Owner,
        error: tilemap::Error,
    },
    Sweep(scratch::Error),
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Data Scene movement file admission rejected: {self:?}")
    }
}
impl std::error::Error for Error {}

pub(super) fn invalid(owner: Owner, field: &'static str, index: usize) -> Error {
    Error::Invalid {
        owner,
        field,
        index,
    }
}

pub(super) struct Budget {
    limits: Limits,
    pub(super) usage: Usage,
}
impl Budget {
    fn new(limits: Limits) -> Self {
        Self {
            limits,
            usage: Usage::default(),
        }
    }
    pub(super) fn work(&mut self, n: usize) -> Result<(), Error> {
        self.consume(Usage {
            work: u64::try_from(n).map_err(|_| Error::WorkLimit)?,
            scratch_bytes: 0,
        })
    }
    pub(super) fn sort(&mut self, n: usize) -> Result<(), Error> {
        let log = (usize::BITS - n.saturating_sub(1).leading_zeros()) as usize;
        self.work(n.checked_mul(log + 1).ok_or(Error::WorkLimit)?)
    }
    pub(super) fn reserve<T>(&mut self, n: usize) -> Result<Vec<T>, Error> {
        self.consume(Usage {
            work: 0,
            scratch_bytes: n
                .checked_mul(std::mem::size_of::<T>())
                .ok_or(Error::ScratchLimit)?,
        })?;
        let mut result = Vec::new();
        result.try_reserve_exact(n).map_err(|_| Error::Allocation)?;
        Ok(result)
    }
    pub(super) fn remaining(&self) -> Limits {
        Limits {
            max_work: self.limits.max_work - self.usage.work,
            max_scratch_bytes: self.limits.max_scratch_bytes - self.usage.scratch_bytes,
        }
    }
    pub(super) fn consume(&mut self, usage: Usage) -> Result<(), Error> {
        let work = self
            .usage
            .work
            .checked_add(usage.work)
            .ok_or(Error::WorkLimit)?;
        let scratch_bytes = self
            .usage
            .scratch_bytes
            .checked_add(usage.scratch_bytes)
            .ok_or(Error::ScratchLimit)?;
        if work > self.limits.max_work {
            return Err(Error::WorkLimit);
        }
        if scratch_bytes > self.limits.max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.usage = Usage {
            work,
            scratch_bytes,
        };
        Ok(())
    }
    pub(super) fn tilemap_usage(&mut self, usage: tilemap::Usage) -> Result<(), Error> {
        self.consume(Usage {
            work: usage.work,
            scratch_bytes: usage.scratch_bytes,
        })
    }
}

pub(crate) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = Budget::new(limits);
    let remaining = budget.remaining();
    let grid = tilemap::validate(
        &engine.data_scene.navigation,
        tilemap::Limits {
            max_work: remaining.max_work,
            max_scratch_bytes: remaining.max_scratch_bytes,
        },
    )
    .map_err(|error| Error::Tilemap {
        owner: Owner::Grid,
        error,
    })?;
    budget.tilemap_usage(grid)?;
    engine
        .data_scene
        .navigation_obstacles
        .validate_file(&engine.data_scene.navigation, &mut budget)?;
    engine
        .data_scene
        .movement
        .validate_file(&engine.world, &mut budget)?;
    engine
        .data_scene
        .movement_animation
        .validate_file(&mut budget)?;
    Ok(budget.usage)
}

#[cfg(test)]
pub(super) mod tests;
