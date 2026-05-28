use crate::components::PhysicsMaterial;
use crate::physics::math::sanitize_non_negative;
use crate::physics::solver::CONTACT_IMPULSE_EPSILON;
use crate::physics::RigidBodyStepConfig;

pub(super) fn contact_velocity_baumgarte_bias(
    penetration: f32,
    config: RigidBodyStepConfig,
    material_a: PhysicsMaterial,
    material_b: PhysicsMaterial,
    delta_seconds: f32,
    velocity_along_normal: f32,
) -> f32 {
    if config.contact_split_impulse {
        0.0
    } else {
        contact_baumgarte_bias_velocity(
            penetration,
            config,
            material_a,
            material_b,
            delta_seconds,
            velocity_along_normal,
        )
    }
}

pub(super) fn contact_baumgarte_bias_velocity(
    penetration: f32,
    config: RigidBodyStepConfig,
    material_a: PhysicsMaterial,
    material_b: PhysicsMaterial,
    delta_seconds: f32,
    velocity_along_normal: f32,
) -> f32 {
    if !penetration.is_finite()
        || !delta_seconds.is_finite()
        || !velocity_along_normal.is_finite()
        || delta_seconds <= 0.0
        || velocity_along_normal < -CONTACT_IMPULSE_EPSILON
    {
        return 0.0;
    }

    let bias_scale = material_a
        .contact_baumgarte_bias_scale
        .min(material_b.contact_baumgarte_bias_scale);
    let max_velocity_scale = material_a
        .max_contact_baumgarte_bias_velocity_scale
        .min(material_b.max_contact_baumgarte_bias_velocity_scale);
    if bias_scale <= 0.0 || max_velocity_scale <= 0.0 {
        return 0.0;
    }

    let corrected_penetration =
        sanitize_non_negative(penetration - config.position_correction_slop);
    if corrected_penetration <= 0.0 {
        return 0.0;
    }

    (corrected_penetration * config.contact_baumgarte_bias_factor * bias_scale / delta_seconds)
        .clamp(
            0.0,
            config.max_contact_baumgarte_bias_velocity * max_velocity_scale,
        )
}
