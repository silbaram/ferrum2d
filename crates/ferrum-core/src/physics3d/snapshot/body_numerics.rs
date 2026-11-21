//! Cold numerical policy for supported body/collider records. The separate
//! visit limit and additional-iteration caps do not bound total simulation cost.
use super::{rp, PhysicsSnapshotError};

const LIMITS: rp::StoredBodyNumericLimits = rp::StoredBodyNumericLimits {
    max_work: 128 * 1024 * 1024,
    max_additional_solver_iterations: 32,
    max_additional_pgs_iterations: 32,
};

pub(super) fn validate(world: &rp::PhysicsWorld) -> Result<(), PhysicsSnapshotError> {
    rp::validate_stored_body_numerics(&world.bodies, &world.colliders, LIMITS)
        .map(|_| ())
        .map_err(|error| match error {
            rp::StoredBodyNumericError::WorkLimit => PhysicsSnapshotError::Capacity,
            _ => PhysicsSnapshotError::InvalidState,
        })
}
