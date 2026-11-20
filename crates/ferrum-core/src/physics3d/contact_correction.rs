//! Explicit correction controls shared by spatial and planar contacts.
use super::PhysicsError;

/// An optional collider contact response, independent of friction and restitution.
/// Two explicit responses combine by minimum for every numeric field; split impulse
/// is enabled if either participant requests it. An unspecified participant adopts
/// the other response. With neither specified, native contact softness is retained.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ContactCorrection {
    /// Penetration-to-separating-speed gain in inverse seconds, in [0, 1,000,000].
    pub velocity_rate: f32,
    /// Maximum added separating speed, in [0, 1,000,000] engine units/s.
    pub max_velocity: f32,
    /// Penetration-to-position-correction gain in inverse seconds, in [0, 1,000,000].
    /// The backend's corrective speed budget still bounds position recovery.
    pub position_rate: f32,
    /// Position-correction deadzone in [0, 1,000,000] engine units.
    pub position_slop: f32,
    /// Velocity-bias deadzone in [0, 1,000,000] engine units.
    pub velocity_slop: f32,
    /// When true, velocity bias corrects position without retaining separating speed.
    pub split_impulse: bool,
}

impl ContactCorrection {
    /// Validates all rates and distances before a body/collider mutation.
    pub fn validate(self) -> Result<(), PhysicsError> {
        if [
            self.velocity_rate,
            self.max_velocity,
            self.position_rate,
            self.position_slop,
            self.velocity_slop,
        ]
        .iter()
        .all(|v| v.is_finite() && (0.0..=1e6).contains(v))
        {
            Ok(())
        } else {
            Err(PhysicsError::InvalidCollider)
        }
    }

    pub(super) fn combine(self, other: Self) -> Self {
        Self {
            velocity_rate: self.velocity_rate.min(other.velocity_rate),
            max_velocity: self.max_velocity.min(other.max_velocity),
            position_rate: self.position_rate.min(other.position_rate),
            position_slop: self.position_slop.min(other.position_slop),
            velocity_slop: self.velocity_slop.min(other.velocity_slop),
            split_impulse: self.split_impulse || other.split_impulse,
        }
    }

    pub(super) fn native(self) -> rapier3d::geometry::ContactCorrection<f32> {
        rapier3d::geometry::ContactCorrection {
            enabled: 1.0,
            velocity_rate: self.velocity_rate,
            max_velocity: self.max_velocity,
            position_rate: self.position_rate,
            position_slop: self.position_slop,
            velocity_slop: self.velocity_slop,
            retain_velocity: f32::from(!self.split_impulse),
        }
    }
}
