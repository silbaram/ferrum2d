//! Logical time within a physics tick and conversion to native integration seconds.

use super::PhysicsError;

pub(in crate::physics3d) type Time = f64;

/// The sole controller-duration conversion at the native physical boundary.
/// Reject underflow before a physics tick can consume input.
pub(in crate::physics3d) fn native_duration(seconds: Time) -> Result<f32, PhysicsError> {
    let value = seconds as f32;
    if !seconds.is_finite() || seconds <= 0. || !value.is_finite() || value <= 0. {
        return Err(PhysicsError::InvalidBody);
    }
    Ok(value)
}
