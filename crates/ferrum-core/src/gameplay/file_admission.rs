//! Shared cold ledger for stored gameplay queues, contact histories and target caches.
//! Byte/collection decode and World/native admission precede these checks. No
//! query, normalization, current-world rebind or runtime callback occurs here.
use crate::collision::file_scratch_admission::{Budget as Inner, Error as ScratchError};
pub(crate) use crate::collision::file_scratch_admission::{Limits, Usage};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    Length,
    Number,
    Range,
    Reference,
    Order,
    Duplicate,
    History,
    Layout,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    NestedScratch(ScratchError),
    Invalid {
        owner: &'static str,
        field: &'static str,
        index: usize,
        problem: Problem,
    },
}
impl From<ScratchError> for Error {
    fn from(v: ScratchError) -> Self {
        match v {
            ScratchError::WorkLimit => Self::WorkLimit,
            ScratchError::ScratchLimit => Self::ScratchLimit,
            ScratchError::Allocation => Self::Allocation,
            v => Self::NestedScratch(v),
        }
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "gameplay file admission rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
pub(crate) fn require(
    ok: bool,
    owner: &'static str,
    field: &'static str,
    index: usize,
    problem: Problem,
) -> Result<(), Error> {
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid {
            owner,
            field,
            index,
            problem,
        })
    }
}
pub(crate) fn finite(values: &[f32]) -> bool {
    values.iter().all(|v| v.is_finite())
}
pub(crate) struct Budget {
    limits: Limits,
    inner: Inner,
}
impl Budget {
    pub(crate) fn new(limits: Limits) -> Self {
        Self {
            limits,
            inner: Inner::new(limits),
        }
    }
    pub(crate) fn usage(&self) -> Usage {
        self.inner.usage
    }
    pub(crate) fn remaining(&self) -> Limits {
        Limits {
            max_work: self.limits.max_work - self.inner.usage.work,
            max_scratch_bytes: self.limits.max_scratch_bytes - self.inner.usage.scratch_bytes,
        }
    }
    pub(crate) fn work(&mut self, n: usize) -> Result<(), Error> {
        self.inner.work(n).map_err(Into::into)
    }
    pub(crate) fn product(&mut self, n: usize, each: usize) -> Result<(), Error> {
        self.work(n.checked_mul(each).ok_or(Error::WorkLimit)?)
    }
    pub(crate) fn vector<T>(&mut self, v: &Vec<T>) -> Result<(), Error> {
        self.inner.vector(v).map_err(Into::into)
    }
    pub(crate) fn sort(&mut self, n: usize) -> Result<(), Error> {
        self.inner.sort(n).map_err(Into::into)
    }
    pub(crate) fn reserve<T>(&mut self, n: usize) -> Result<Vec<T>, Error> {
        self.inner.reserve(n).map_err(Into::into)
    }
    pub(crate) fn nested(&mut self, v: Usage) -> Result<(), Error> {
        let left = self.remaining();
        if v.work > left.max_work {
            return Err(Error::WorkLimit);
        }
        if v.scratch_bytes > left.max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.inner.usage.work += v.work;
        self.inner.usage.scratch_bytes += v.scratch_bytes;
        Ok(())
    }
}
/// Both current users store this exact core command (Shooter reexports it).
/// Constructor/queue permit any raw action ID, including a later missing binding;
/// enum payloads are checked by Serde and dispatch produces failure events.
pub(crate) fn action_command(
    command: &super::ActionTriggerCommand,
    b: &mut Budget,
) -> Result<(), Error> {
    let super::ActionTriggerCommand {
        source: _,
        action_id: _,
        trigger_kind: _,
        phase: _,
    } = command;
    b.work(5)
}
