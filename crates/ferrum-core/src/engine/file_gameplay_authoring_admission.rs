//! Stored authoring transaction payload only. No restore/World lookup occurs.
//! Complete Engine/resource/host/session admission remains a separate phase.
use super::Engine;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub max_work: u64,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Usage {
    pub work: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    Invalid { field: &'static str, index: usize },
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "gameplay authoring snapshot file admission rejected: {self:?}"
        )
    }
}
impl std::error::Error for Error {}
pub(super) fn require(ok: bool, field: &'static str, index: usize) -> Result<(), Error> {
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid { field, index })
    }
}
pub(super) struct Budget {
    max_work: u64,
    pub(super) usage: Usage,
}
impl Budget {
    pub(super) fn work(&mut self, amount: u64) -> Result<(), Error> {
        let work = self
            .usage
            .work
            .checked_add(amount)
            .ok_or(Error::WorkLimit)?;
        if work > self.max_work {
            return Err(Error::WorkLimit);
        }
        self.usage.work = work;
        Ok(())
    }
}
pub(crate) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut budget = Budget {
        max_work: limits.max_work,
        usage: Usage::default(),
    };
    budget.work(1)?;
    if let Some(snapshot) = &engine.gameplay_authoring_snapshot {
        snapshot.validate_file(&mut budget)?;
    }
    Ok(budget.usage)
}

#[cfg(test)]
pub(super) mod tests;
