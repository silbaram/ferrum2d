//! Cold workspace correspondence; independent visits/scratch policy, not RSS.
use super::{rp, PhysicsSnapshotError};

pub(super) const LIMITS: rp::StoredWorkspaceLimits = rp::StoredWorkspaceLimits {
    max_work: 128 * 1024 * 1024,
    max_scratch_bytes: 64 * 1024 * 1024,
};
pub(super) fn validate(world: &rp::PhysicsWorld) -> Result<(), PhysicsSnapshotError> {
    validate_with_limits(world, LIMITS)
}
pub(super) fn validate_with_limits(
    world: &rp::PhysicsWorld,
    limits: rp::StoredWorkspaceLimits,
) -> Result<(), PhysicsSnapshotError> {
    rp::validate_stored_contact_workspaces(world, limits)
        .map(|_| ())
        .map_err(|error| match error {
            rp::StoredWorkspaceError::WorkLimit
            | rp::StoredWorkspaceError::ScratchLimit
            | rp::StoredWorkspaceError::Allocation => PhysicsSnapshotError::Capacity,
            _ => PhysicsSnapshotError::InvalidState,
        })
}
