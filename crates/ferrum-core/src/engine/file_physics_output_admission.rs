//! Readonly admission of exactly forty stored physics output roots. World/native,
//! Engine collision/rigid scratch, frame buffers and publication are separate.
use super::Engine;
use crate::collision::file_scratch_admission::{Budget as ScratchBudget, Error as ScratchError};
pub(crate) use crate::collision::file_scratch_admission::{Limits, Usage};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    Length,
    Number,
    Flags,
    Code,
    Order,
    Duplicate,
    Reference,
    Graph,
    History,
    Canonical,
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
        write!(f, "physics output file admission rejected: {self:?}")
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
pub(crate) struct Budget {
    limits: Limits,
    inner: ScratchBudget,
}
impl Budget {
    pub(crate) fn new(limits: Limits) -> Self {
        Self {
            limits,
            inner: ScratchBudget::new(limits),
        }
    }
    pub(crate) fn work(&mut self, n: usize) -> Result<(), Error> {
        self.inner.work(n).map_err(Into::into)
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
    pub(crate) fn usage(&self) -> Usage {
        self.inner.usage
    }
    pub(crate) fn remaining(&self) -> Limits {
        Limits {
            max_work: self.limits.max_work - self.inner.usage.work,
            max_scratch_bytes: self.limits.max_scratch_bytes - self.inner.usage.scratch_bytes,
        }
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
    /// Bounded fixed stack buffers are charged too; this is cumulative logical
    /// temporary payload, not an allocator/RSS guarantee or a variable stack size.
    pub(crate) fn fixed(&mut self, bytes: usize) -> Result<(), Error> {
        if bytes > self.remaining().max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.inner.usage.scratch_bytes += bytes;
        Ok(())
    }
}
pub(crate) fn finite(v: &[f32]) -> bool {
    v.iter().all(|x| x.is_finite())
}
pub(crate) fn finite_or_pos_inf(v: f32) -> bool {
    v.is_finite() || v == f32::INFINITY
}
pub(crate) fn validate(engine: &Engine, limits: Limits) -> Result<Usage, Error> {
    let mut b = Budget::new(limits);
    b.work(40)?;
    engine
        .collision_event_tracker
        .validate_file_output(&engine.world, &mut b)?;
    engine.collision_event_counts.validate_file_output(&mut b)?;
    engine.physics_counters.validate_file_output(&mut b)?;
    super::physics_bridge::file_output_admission::validate_legacy(engine, &mut b)?;
    super::physics_bridge::file_output_admission::validate_snapshots(engine, &mut b)?;
    super::physics_bridge::file_output_admission::validate_packed(engine, &mut b)?;
    crate::shooter_scene::ShooterScene::validate_file_output_parts(
        &engine.shooter_snapshot_header_floats,
        &engine.shooter_snapshot_header_u32s,
        &engine.shooter_snapshot_entity_floats,
        &engine.shooter_snapshot_entity_u32s,
        &mut b,
    )?;
    engine.rigid_body_step_stats.validate_file_output(&mut b)?;
    let super::RigidBodyFrameStats {
        ccd_checks: _,
        ccd_hits: _,
        sleeping_bodies: _,
        broken_joints: _,
    } = engine.rigid_body_frame_stats;
    b.work(4)?;
    super::unified_physics::web_bridge::file_output_admission::validate_bodies(
        &engine.unified_physics_body_states,
        &mut b,
    )?;
    super::unified_physics::web_bridge::CharacterStateRecord::validate_file_output_rows(
        &engine.unified_physics_character_states,
        &mut b,
    )?;
    engine
        .unified_physics_queries
        .validate_file_output(&mut b)?;
    engine
        .unified_physics_collisions
        .validate_file_output(&mut b)?;
    engine
        .unified_physics_observations
        .validate_file_output(&mut b)?;
    engine.unified_physics_joints.validate_file_output(&mut b)?;
    Ok(b.usage())
}
#[cfg(test)]
mod tests;
