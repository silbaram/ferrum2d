use super::super::math::{finite_velocity, sanitize_non_negative};
use super::super::rigid_body::RigidBodyStepConfig;
use super::super::MAX_RIGID_BODY_SUBSTEPS;

pub(super) fn sanitize_rigid_body_step_config(config: RigidBodyStepConfig) -> RigidBodyStepConfig {
    let default = RigidBodyStepConfig::default();
    RigidBodyStepConfig {
        gravity: finite_velocity(config.gravity),
        velocity_iterations: config.velocity_iterations.clamp(1, 32),
        position_iterations: config.position_iterations.clamp(1, 32),
        position_correction_percent: if config.position_correction_percent.is_finite()
            && config.position_correction_percent >= 0.0
        {
            config.position_correction_percent.min(1.0)
        } else {
            default.position_correction_percent
        },
        position_correction_slop: sanitize_non_negative(config.position_correction_slop),
        restitution_velocity_threshold: if config.restitution_velocity_threshold.is_finite()
            && config.restitution_velocity_threshold >= 0.0
        {
            config.restitution_velocity_threshold
        } else {
            default.restitution_velocity_threshold
        },
        contact_baumgarte_bias_factor: if config.contact_baumgarte_bias_factor.is_finite()
            && config.contact_baumgarte_bias_factor >= 0.0
        {
            config.contact_baumgarte_bias_factor.min(1.0)
        } else {
            default.contact_baumgarte_bias_factor
        },
        max_contact_baumgarte_bias_velocity: if config
            .max_contact_baumgarte_bias_velocity
            .is_finite()
            && config.max_contact_baumgarte_bias_velocity >= 0.0
        {
            config.max_contact_baumgarte_bias_velocity
        } else {
            default.max_contact_baumgarte_bias_velocity
        },
        contact_split_impulse: config.contact_split_impulse,
        continuous: config.continuous,
    }
}

pub(super) fn sanitize_rigid_body_substeps(substeps: u32) -> u32 {
    substeps.clamp(1, MAX_RIGID_BODY_SUBSTEPS)
}
