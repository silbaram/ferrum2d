//! Cold native controller state admission. World/native and alias validation are
//! prerequisites. Never executes a query, repairs state, replans or normalizes.
use super::Engine;
use crate::physics3d::Pose;
use std::mem::size_of;
#[derive(Clone, Copy, Debug)]
pub(super) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Usage {
    pub work: u64,
    pub scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::engine) enum Owner {
    Actor,
    Search,
    Cache,
    Combat,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    Work,
    Scratch,
    Allocation,
    Invalid {
        owner: Owner,
        field: &'static str,
        index: usize,
    },
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "native controller file state rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
pub(in crate::engine) type Result<T = ()> = std::result::Result<T, Error>;
pub(in crate::engine) struct Budget {
    limits: Limits,
    usage: Usage,
}
impl Budget {
    pub(in crate::engine) fn new(limits: Limits) -> Self {
        Self {
            limits,
            usage: Usage::default(),
        }
    }
    pub(in crate::engine) fn usage(&self) -> Usage {
        self.usage
    }

    pub(in crate::engine) fn work(&mut self, n: u64) -> Result {
        let next = self.usage.work.checked_add(n).ok_or(Error::Work)?;
        if next > self.limits.max_work {
            return Err(Error::Work);
        }
        self.usage.work = next;
        Ok(())
    }
    pub(in crate::engine) fn vector<T: Clone>(&mut self, n: usize, value: T) -> Result<Vec<T>> {
        self.work(n as u64)?;
        let bytes = n.checked_mul(size_of::<T>()).ok_or(Error::Scratch)?;
        let next = self
            .usage
            .scratch_bytes
            .checked_add(bytes)
            .ok_or(Error::Scratch)?;
        if next > self.limits.max_scratch_bytes {
            return Err(Error::Scratch);
        }
        self.usage.scratch_bytes = next;
        let mut v = Vec::new();
        v.try_reserve_exact(n).map_err(|_| Error::Allocation)?;
        v.resize(n, value);
        Ok(v)
    }
    pub(in crate::engine) fn require(
        &self,
        yes: bool,
        owner: Owner,
        field: &'static str,
        index: usize,
    ) -> Result {
        if yes {
            Ok(())
        } else {
            Err(Error::Invalid {
                owner,
                field,
                index,
            })
        }
    }
}
pub(in crate::engine) fn finite(v: &[f32]) -> bool {
    v.iter().all(|v| v.is_finite())
}
pub(in crate::engine) fn pose(p: Pose) -> bool {
    finite(&p.position)
        && p.position.iter().all(|v| v.abs() <= 1e6)
        && finite(&p.rotation)
        && (p
            .rotation
            .iter()
            .map(|v| f64::from(*v).powi(2))
            .sum::<f64>()
            - 1.)
            .abs()
            <= 1e-5
}
pub(super) fn validate(engine: &Engine, limits: Limits) -> Result<Usage> {
    let mut budget = Budget::new(limits);
    budget.work(4)?;
    if let Some(runtime) = &engine.unified_physics {
        runtime.validate_file_controller(&engine.spatial_scene, &mut budget)?;
    }
    engine
        .data_scene
        .gameplay
        .combat
        .file_native_routes()
        .validate_file_controller(&engine.spatial_scene, &mut budget)?;
    Ok(budget.usage)
}
#[cfg(test)]
mod tests;
