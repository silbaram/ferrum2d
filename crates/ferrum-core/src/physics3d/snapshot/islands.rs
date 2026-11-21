//! Cold island/reference admission. These independent budgets cover stored
//! visits and requested scratch bytes, not whole-engine CPU or allocator/RSS.
use super::{rp, PhysicsSnapshotError};

pub(super) const LIMITS: rp::StoredIslandLimits = rp::StoredIslandLimits {
    max_work: 128 * 1024 * 1024,
    max_scratch_bytes: 64 * 1024 * 1024,
};

pub(super) fn validate(world: &rp::PhysicsWorld) -> Result<(), PhysicsSnapshotError> {
    validate_with_limits(world, LIMITS)
}

pub(super) fn validate_with_limits(
    world: &rp::PhysicsWorld,
    limits: rp::StoredIslandLimits,
) -> Result<(), PhysicsSnapshotError> {
    rp::validate_stored_islands(world, limits)
        .map(|_| ())
        .map_err(|error| match error {
            rp::StoredIslandError::WorkLimit
            | rp::StoredIslandError::ScratchLimit
            | rp::StoredIslandError::Allocation => PhysicsSnapshotError::Capacity,
            _ => PhysicsSnapshotError::InvalidState,
        })
}
