//! Complete Rust runtime rollback. External assets/JS services and file persistence
//! have separate contracts; this value is opaque and tied to its owning Engine.
use super::Engine;
use crate::physics3d::PhysicsSnapshotError;
use std::{fmt, sync::Arc};
use wasm_bindgen::prelude::*;

#[cfg(test)]
pub(in crate::engine) mod tests;

/// A checkpoint operation rejected before replacing any live state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeCheckpointError {
    /// Complete encoded runtime exceeds its byte/allocation budget.
    Capacity,
    /// Runtime state cannot be encoded or decoded by this private schema.
    InvalidState,
    /// Complete checkpoint has an invalid length, magic or trailing payload.
    InvalidEnvelope,
    /// Internal schema/source/target build differs.
    IncompatibleBuild,
    /// Complete encoded payload failed its checksum.
    Corrupt,
    /// Finish the existing legacy restore transaction first.
    RestoreInProgress,
    /// Opaque checkpoints can only be restored into their original Engine.
    WrongEngine,
    /// The monotonic rollback revision cannot wrap.
    RevisionExhausted,
    /// Native solver state could not be captured or decoded.
    Physics(PhysicsSnapshotError),
}
impl From<PhysicsSnapshotError> for RuntimeCheckpointError {
    fn from(error: PhysicsSnapshotError) -> Self {
        Self::Physics(error)
    }
}
impl fmt::Display for RuntimeCheckpointError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "runtime checkpoint rejected: {self:?}")
    }
}
impl std::error::Error for RuntimeCheckpointError {}

/// Owned, same-Engine in-memory checkpoint of the complete Rust runtime.
///
/// Includes native solver, entity arenas, fixed clock/input, AI/search/cache,
/// terrain/platforms, projectiles, particles/tweens, interpolation and queued
/// output buffers. This is not a JSON/file save or a snapshot of external JS/GPU
/// resources. Discard handles/views from the abandoned future after restore.
#[wasm_bindgen]
pub struct EngineRuntimeCheckpoint {
    owner: Arc<()>,
    captured_revision: u32,
    bytes: Vec<u8>,
}
impl fmt::Debug for EngineRuntimeCheckpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EngineRuntimeCheckpoint")
            .field("captured_revision", &self.captured_revision)
            .field("encoded_bytes", &self.bytes.len())
            .finish_non_exhaustive()
    }
}
impl Engine {
    /// Capture without advancing the clock or consuming any pending input/output.
    /// Allocation is cold; the native encoded checkpoint budget still applies.
    pub fn runtime_checkpoint(&self) -> Result<EngineRuntimeCheckpoint, RuntimeCheckpointError> {
        if self.physics_restore_transaction.is_some() {
            return Err(RuntimeCheckpointError::RestoreInProgress);
        }
        Ok(EngineRuntimeCheckpoint {
            owner: Arc::clone(&self.checkpoint_owner),
            captured_revision: self.checkpoint_revision,
            bytes: super::persistence::encode(self)?,
        })
    }
    /// Prepare the complete candidate before atomically replacing the runtime.
    /// Native/entity handles rewind; a separate monotonic revision records rollback.
    pub fn restore_runtime_checkpoint_native(
        &mut self,
        checkpoint: &EngineRuntimeCheckpoint,
    ) -> Result<(), RuntimeCheckpointError> {
        self.restore_runtime_checkpoint_with_limits(
            checkpoint,
            crate::checkpoint_decode::Limits::default(),
        )
    }
    fn restore_runtime_checkpoint_with_limits(
        &mut self,
        checkpoint: &EngineRuntimeCheckpoint,
        limits: crate::checkpoint_decode::Limits,
    ) -> Result<(), RuntimeCheckpointError> {
        if self.physics_restore_transaction.is_some() {
            return Err(RuntimeCheckpointError::RestoreInProgress);
        }
        if !Arc::ptr_eq(&self.checkpoint_owner, &checkpoint.owner) {
            return Err(RuntimeCheckpointError::WrongEngine);
        }
        let revision = self
            .checkpoint_revision
            .checked_add(1)
            .ok_or(RuntimeCheckpointError::RevisionExhausted)?;
        let mut candidate = super::persistence::decode_with_limits(&checkpoint.bytes, limits)?;
        candidate.checkpoint_owner = Arc::clone(&self.checkpoint_owner);
        candidate.checkpoint_revision = revision;
        std::mem::swap(self, candidate.as_mut());
        Ok(())
    }
}
#[wasm_bindgen]
impl Engine {
    /// In-memory checkpoint capability; this does not enable JSON native saves.
    pub fn runtime_checkpoint_version(&self) -> u32 {
        1
    }
    /// Number of successful rollbacks; capture/failed restore never changes it.
    pub fn runtime_checkpoint_revision(&self) -> u32 {
        self.checkpoint_revision
    }
    /// Cold same-Engine checkpoint. None means capture was rejected.
    pub fn capture_runtime_checkpoint(&self) -> Option<EngineRuntimeCheckpoint> {
        self.runtime_checkpoint().ok()
    }
    /// False rejects a foreign checkpoint or active legacy transaction atomically.
    pub fn restore_runtime_checkpoint(&mut self, checkpoint: &EngineRuntimeCheckpoint) -> bool {
        self.restore_runtime_checkpoint_native(checkpoint).is_ok()
    }
}
