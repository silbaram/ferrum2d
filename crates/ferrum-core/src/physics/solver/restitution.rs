use crate::components::PhysicsMaterial;
use crate::physics::math::sanitize_non_negative;
use crate::physics::solver::CONTACT_IMPULSE_EPSILON;

pub(super) fn contact_restitution_coefficient(
    material_a: PhysicsMaterial,
    material_b: PhysicsMaterial,
) -> f32 {
    material_a.restitution.max(material_b.restitution)
}

pub(super) fn contact_restitution(
    restitution: f32,
    velocity_along_normal: f32,
    velocity_threshold: f32,
) -> f32 {
    if restitution <= 0.0 || !velocity_along_normal.is_finite() {
        return 0.0;
    }

    if velocity_along_normal < -sanitize_non_negative(velocity_threshold) {
        restitution
    } else {
        0.0
    }
}

pub(super) fn contact_restitution_threshold_skipped(
    restitution: f32,
    velocity_along_normal: f32,
    velocity_threshold: f32,
) -> bool {
    let velocity_threshold = sanitize_non_negative(velocity_threshold);
    restitution > 0.0
        && velocity_along_normal.is_finite()
        && velocity_threshold > CONTACT_IMPULSE_EPSILON
        && (-velocity_threshold..-CONTACT_IMPULSE_EPSILON).contains(&velocity_along_normal)
}
