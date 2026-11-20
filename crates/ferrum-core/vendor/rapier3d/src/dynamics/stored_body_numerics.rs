//! Ferrum's read-only, allocation-free stored rigid body/collider numeric checks.
//! This is not a shape, complete numerical/overflow, or untrusted-file proof.
use super::{MassProperties, RigidBodyAdditionalMassProps, RigidBodySet};
use crate::geometry::{ColliderMassProps, ColliderSet};
use crate::math::{AngularInertia, Pose, Rotation, Vector};
use core::fmt;

// Fixed-size record work, in addition to visiting every raw arena slot. No
// geometry, variable-size list, eigen decomposition, or numeric-value loop runs.
const BODY_WORK: usize = 128;
const COLLIDER_WORK: usize = 64;
const INPUT_ROTATION_TOLERANCE: f64 = 1.0e-5;
// An attached world pose or a single explicit collider mass frame can compose
// two independently admitted input rotations. Allow product rounding history.
const DERIVED_ROTATION_TOLERANCE: f64 = 3.0e-5;
const TENSOR_TOLERANCE: f64 = 64.0 * f32::EPSILON as f64;

#[doc(hidden)]
#[derive(Copy, Clone, Debug)]
pub struct StoredBodyNumericLimits {
    /// Raw arena slots plus fixed record work; not CPU instructions or RSS.
    pub max_work: usize,
    /// Trusted caller policy for additional per-body solver substeps.
    pub max_additional_solver_iterations: usize,
    /// Trusted caller policy for additional per-body PGS iterations.
    pub max_additional_pgs_iterations: usize,
}

#[doc(hidden)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StoredBodyNumericError {
    WorkLimit,
    BodyPose,
    BodyVelocity,
    BodyForces,
    BodyDamping,
    BodyMass,
    BodyActivation,
    BodyCcd,
    Iterations,
    ColliderPose,
    ColliderMass,
    ColliderMaterial,
    UnsupportedBody,
    UnsupportedCollider,
}
impl fmt::Display for StoredBodyNumericError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "invalid stored rigid-body/collider numerical state: {self:?}"
        )
    }
}
impl core::error::Error for StoredBodyNumericError {}

fn nonnegative(value: f32) -> bool {
    value.is_finite() && value >= 0.0
}
fn nonnegative_vector(value: Vector) -> bool {
    value.is_finite() && value.min_element() >= 0.0
}
fn rotation(value: Rotation, tolerance: f64) -> bool {
    let components = value.to_array();
    components.iter().all(|value| value.is_finite())
        && (components
            .iter()
            .map(|&value| f64::from(value) * f64::from(value))
            .sum::<f64>()
            - 1.0)
            .abs()
            <= tolerance
}
fn pose(value: Pose, tolerance: f64) -> bool {
    value.translation.is_finite() && rotation(value.rotation, tolerance)
}
fn mass(value: &MassProperties, tolerance: f64) -> bool {
    value.local_com.is_finite()
        && nonnegative(value.inv_mass)
        && nonnegative_vector(value.inv_principal_inertia)
        && rotation(value.principal_inertia_local_frame, tolerance)
}
fn inertia(value: &AngularInertia) -> bool {
    let entries = [
        value.m11, value.m12, value.m13, value.m22, value.m23, value.m33,
    ];
    if !entries.iter().all(|value| value.is_finite())
        || value.m11 < 0.0
        || value.m22 < 0.0
        || value.m33 < 0.0
    {
        return false;
    }
    let scale = entries
        .iter()
        .map(|value| f64::from(value.abs()))
        .fold(0.0, f64::max);
    if scale == 0.0 {
        return true;
    }
    let [a, b, c, d, e, f] = entries.map(|value| f64::from(value) / scale);
    // All principal minors characterize a symmetric PSD matrix. A relative
    // f32 rounding band preserves rank-deficient, rotated, axis-locked tensors.
    [
        a * d - b * b,
        a * f - c * c,
        d * f - e * e,
        a * d * f + 2.0 * b * c * e - a * e * e - d * c * c - f * b * b,
    ]
    .iter()
    .all(|value| *value >= -TENSOR_TOLERANCE)
}

/// Checks only supported 3D/f32 rigid-body and collider numeric records.
///
/// Arena Deserialize guards and the separate stored-reference checker remain
/// necessary. All work is admitted before iteration, uses fixed-size stack
/// values, and allocates nothing. Pending poses, signed forces, zero inertia,
/// disabled/sleep/lock history and negative never-sleep thresholds are retained.
/// Derived cache equality is not required. No field is repaired or normalized.
///
/// Geometry, global integration settings, joint/manifold/island numerics,
/// numerical overflow of later arithmetic and allocator/RSS remain out of scope.
#[doc(hidden)]
pub fn validate_stored_body_numerics(
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    limits: StoredBodyNumericLimits,
) -> Result<usize, StoredBodyNumericError> {
    use StoredBodyNumericError as E;
    // Iterators scan vacancies. Counts are trustworthy only after Arena's own
    // storage guard; this precharge includes even disabled and empty raw slots.
    let work = bodies
        .bodies
        .capacity()
        .checked_add(colliders.colliders.capacity())
        .and_then(|work| {
            bodies
                .len()
                .checked_mul(BODY_WORK)
                .and_then(|n| work.checked_add(n))
        })
        .and_then(|work| {
            colliders
                .len()
                .checked_mul(COLLIDER_WORK)
                .and_then(|n| work.checked_add(n))
        })
        .ok_or(E::WorkLimit)?;
    if work > limits.max_work {
        return Err(E::WorkLimit);
    }
    for (_, body) in bodies.iter() {
        if body.is_soft_frame() || !body.soft_body.is_invalid() || body.soft_cluster != u32::MAX {
            return Err(E::UnsupportedBody);
        }
        if !pose(body.pos.position, INPUT_ROTATION_TOLERANCE)
            || !pose(body.pos.next_position, INPUT_ROTATION_TOLERANCE)
        {
            return Err(E::BodyPose);
        }
        if !body.vels.linvel.is_finite()
            || !body.vels.angvel.is_finite()
            || !body.ccd_vels.linvel.is_finite()
            || !body.ccd_vels.angvel.is_finite()
        {
            return Err(E::BodyVelocity);
        }
        if ![
            body.forces.force,
            body.forces.torque,
            body.forces.user_force,
            body.forces.user_torque,
        ]
        .iter()
        .all(|value| value.is_finite())
            || !body.forces.gravity_scale.is_finite()
        {
            return Err(E::BodyForces);
        }
        if !nonnegative(body.damping.linear_damping) || !nonnegative(body.damping.angular_damping) {
            return Err(E::BodyDamping);
        }
        let properties = &body.mprops;
        if !properties.world_com.is_finite()
            || !nonnegative_vector(properties.effective_inv_mass)
            || !inertia(&properties.effective_world_inv_inertia)
            || !mass(&properties.local_mprops, DERIVED_ROTATION_TOLERANCE)
            || !nonnegative(properties.max_extent)
            || !nonnegative(body.soft_motion_margin)
        {
            return Err(E::BodyMass);
        }
        if let Some(additional) = &properties.additional_local_mprops {
            let valid = match **additional {
                RigidBodyAdditionalMassProps::Mass(value) => nonnegative(value),
                RigidBodyAdditionalMassProps::MassProps(ref value) => {
                    mass(value, INPUT_ROTATION_TOLERANCE)
                }
            };
            if !valid {
                return Err(E::BodyMass);
            }
        }
        let activation = &body.activation;
        if !activation.normalized_linear_threshold.is_finite()
            || !activation.angular_threshold.is_finite()
            || !nonnegative(activation.time_until_sleep)
            || !nonnegative(activation.time_since_can_sleep)
            || !pose(activation.sleep_prev_pose, INPUT_ROTATION_TOLERANCE)
        {
            return Err(E::BodyActivation);
        }
        if !nonnegative(body.ccd.ccd_thickness) || !nonnegative(body.ccd.soft_ccd_prediction) {
            return Err(E::BodyCcd);
        }
        if body.additional_solver_iterations > limits.max_additional_solver_iterations
            || body.additional_pgs_iterations > limits.max_additional_pgs_iterations
        {
            return Err(E::Iterations);
        }
    }
    for (_, collider) in colliders.iter() {
        if collider.is_deformable_collider() {
            return Err(E::UnsupportedCollider);
        }
        if !pose(collider.pos.0, DERIVED_ROTATION_TOLERANCE)
            || collider
                .parent
                .as_ref()
                .is_some_and(|parent| !pose(parent.pos_wrt_parent, INPUT_ROTATION_TOLERANCE))
        {
            return Err(E::ColliderPose);
        }
        let valid_mass = match &collider.mprops {
            ColliderMassProps::Density(value) | ColliderMassProps::Mass(value) => {
                nonnegative(*value)
            }
            ColliderMassProps::MassProperties(value) => mass(value, INPUT_ROTATION_TOLERANCE),
        };
        if !valid_mass {
            return Err(E::ColliderMass);
        }
        if !nonnegative(collider.material.friction)
            || !nonnegative(collider.material.restitution)
            || !nonnegative(collider.contact_skin())
            || collider.contact_force_event_threshold().is_nan()
            || collider.contact_force_event_threshold() < 0.0
        {
            return Err(E::ColliderMaterial);
        }
    }
    Ok(work)
}

#[cfg(test)]
mod tests;
