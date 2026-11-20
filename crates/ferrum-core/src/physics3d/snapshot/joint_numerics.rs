//! Numerical admission for the actual persistent joint payload, not just its
//! authoring description. Read-only and allocation-free; graph links are checked
//! first by the independent stored-reference validator.
use super::{rp, PhysicsSnapshotError, PhysicsWorld3d};
use crate::physics3d::{types::valid_pose, JointState, Pose};

fn nonnegative(value: f32) -> bool {
    value.is_finite() && value >= 0.0
}

fn pose(value: &rp::Pose) -> bool {
    valid_pose(Pose {
        position: value.translation.to_array(),
        rotation: value.rotation.to_array(),
    })
}

fn axis(value: rp::Vector) -> bool {
    value.is_finite() && (value.as_dvec3().length_squared() - 1.0).abs() <= 1e-5
}

fn state(value: &JointState) -> bool {
    nonnegative(value.force) && nonnegative(value.torque)
}

fn data(value: &rp::GenericJoint, dt: f32) -> bool {
    // Exhaustive fields keep a pinned-backend upgrade from silently skipping a
    // newly persistent field. Typed enums/bools/user data need no float policy.
    let rp::GenericJoint {
        local_frame1,
        local_frame2,
        locked_axes,
        limit_axes,
        motor_axes,
        coupled_axes,
        limits,
        motors,
        softness,
        contacts_enabled: _,
        enabled: _,
        user_data: _,
    } = value;
    if !pose(local_frame1)
        || !pose(local_frame2)
        || [locked_axes, limit_axes, motor_axes, coupled_axes]
            .iter()
            .any(|mask| mask.bits() & !rp::JointAxesMask::all().bits() != 0)
        || !nonnegative(softness.natural_frequency)
        || !nonnegative(softness.damping_ratio)
        || !softness.erp_inv_dt(dt).is_finite()
        || !nonnegative(softness.cfm_coeff(dt))
    {
        return false;
    }
    // Disabled axes retain signed warm-start history too. Never clear those
    // values or force the native frames back to the original authored frame.
    for limit in limits {
        if !limit.min.is_finite()
            || !limit.max.is_finite()
            || limit.min > limit.max
            || !limit.impulse.is_finite()
        {
            return false;
        }
    }
    for motor in motors {
        if !motor.target_pos.is_finite()
            || !motor.target_vel.is_finite()
            || !nonnegative(motor.stiffness)
            || !nonnegative(motor.damping)
            || motor.max_force.is_nan()
            || motor.max_force < 0.0
            || !motor.impulse.is_finite()
        {
            return false;
        }
        // Positive infinity is the backend's intentional unlimited-force
        // sentinel. The finite coefficient computation must still be valid.
        let (erp, cfm, gain) = motor
            .model
            .combine_coefficients(dt, motor.stiffness, motor.damping);
        if !nonnegative(erp) || !nonnegative(cfm) || !nonnegative(gain) {
            return false;
        }
    }
    true
}

impl PhysicsWorld3d {
    pub(super) fn validate_joint_numerics(&self) -> Result<(), PhysicsSnapshotError> {
        // Both iterators below visit dense edge/map entries, not vacant arena
        // slots. Bound actual backend entries before either fixed-size scan.
        let count = self.backend.impulse_joints.len();
        if count != self.joints.len() || count > self.config.max_joints {
            return Err(PhysicsSnapshotError::InvalidState);
        }
        let dt = self.config.step_seconds;
        for (_, joint) in self.backend.impulse_joints.iter() {
            if !data(&joint.data, dt) || joint.impulses.iter().any(|v| !v.is_finite()) {
                return Err(PhysicsSnapshotError::InvalidState);
            }
        }
        for runtime in self.joints.values() {
            if !state(&runtime.state)
                || !runtime.ratio_impulse.is_finite()
                || !state(&runtime.ratio_reaction)
                || runtime.pulley_axes.iter().any(|v| !axis(*v))
                || runtime.radial_direction.is_some_and(|v| !axis(v))
            {
                return Err(PhysicsSnapshotError::InvalidState);
            }
        }
        Ok(())
    }
}
