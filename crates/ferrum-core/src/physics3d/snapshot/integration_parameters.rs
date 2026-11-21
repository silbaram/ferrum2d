//! Cold admission for the integration settings produced by Ferrum's rigid API.
//! No input is repaired and no simulation state is advanced or canonicalized.
use super::{PhysicsSnapshotError, WorldConfig};
use rapier3d::prelude as rp;

// CCD work is independent of body/event capacity. Existing native tuning uses
// one or four passes; keep bounded tuning without exposing a new setting API.
const MAX_CCD_SUBSTEPS: usize = 32;

pub(super) fn validate(
    stored: &rp::IntegrationParameters,
    config: &WorldConfig,
) -> Result<(), PhysicsSnapshotError> {
    let invalid = PhysicsSnapshotError::InvalidState;
    if !stored.warmstart_coefficient.is_finite()
        || !(0.0..=1.0).contains(&stored.warmstart_coefficient)
        || if config.solver.continuous {
            !(1..=MAX_CCD_SUBSTEPS).contains(&stored.max_ccd_substeps)
        } else {
            stored.max_ccd_substeps != 0
        }
    {
        return Err(invalid);
    }

    let mut expected = super::super::world::integration_parameters(config);
    // These three native tuning controls have valid non-default producers in
    // the supported rigid tests. Preserve their exact values, including -0.0.
    expected.max_ccd_substeps = stored.max_ccd_substeps;
    expected.warmstart_coefficient = stored.warmstart_coefficient;
    expected.friction_model = stored.friction_model;

    // Full structural equality covers every current scalar/flag and the whole
    // otherwise-unused soft-body settings block. Config-owned fields must match
    // their validated producer; backend-only fields retain Ferrum's defaults.
    // In particular num_solver_iterations is four at a public cold boundary:
    // the joint wrapper's one-pass setting is transient and always restored.
    if *stored != expected {
        return Err(invalid);
    }
    Ok(())
}
