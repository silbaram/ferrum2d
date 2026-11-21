//! Cold contact record admission. This independent visit policy does not
//! bound query-workspace semantics, later arithmetic, or actual allocator/RSS.
use super::{rp, PhysicsSnapshotError};

pub(super) const LIMITS: rp::StoredContactNumericLimits = rp::StoredContactNumericLimits {
    max_work: 128 * 1024 * 1024,
};

pub(super) fn validate(world: &rp::PhysicsWorld) -> Result<(), PhysicsSnapshotError> {
    validate_with_limits(world, LIMITS)
}

pub(super) fn validate_with_limits(
    world: &rp::PhysicsWorld,
    limits: rp::StoredContactNumericLimits,
) -> Result<(), PhysicsSnapshotError> {
    rp::validate_stored_contact_numerics(world, limits)
        .map(|_| ())
        .map_err(|error| match error {
            rp::StoredContactNumericError::WorkLimit => PhysicsSnapshotError::Capacity,
            _ => PhysicsSnapshotError::InvalidState,
        })
}
