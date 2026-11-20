// Ferrum2D extension: independent velocity and split-position contact correction.
use crate::math::{Real, SIMD_WIDTH, SimdReal};
use crate::utils::ScalarType;

/// Optional per-manifold correction. Zero `enabled` preserves the upstream response.
/// Callers must supply finite nonnegative rates, speeds and slop; flags are 0 or 1.
#[derive(Copy, Clone, Debug, Default)]
#[cfg_attr(feature = "serde-serialize", derive(Serialize, Deserialize))]
pub struct ContactCorrection<N> {
    /// One enables the explicit response, zero retains upstream contact softness.
    pub enabled: N,
    /// Penetration-to-velocity gain in inverse seconds.
    pub velocity_rate: N,
    /// Maximum added separating speed.
    pub max_velocity: N,
    /// Penetration-to-position-correction gain in inverse seconds.
    pub position_rate: N,
    /// Deadzone for position correction, in world units.
    pub position_slop: N,
    /// Deadzone for velocity bias, in world units.
    pub velocity_slop: N,
    /// One retains velocity bias in the relaxation pass; zero uses split impulse.
    pub retain_velocity: N,
}

impl ContactCorrection<SimdReal> {
    pub(crate) fn gather(values: [ContactCorrection<Real>; SIMD_WIDTH]) -> Self {
        Self {
            enabled: SimdReal::from(core::array::from_fn(|i| values[i].enabled)),
            velocity_rate: SimdReal::from(core::array::from_fn(|i| values[i].velocity_rate)),
            max_velocity: SimdReal::from(core::array::from_fn(|i| values[i].max_velocity)),
            position_rate: SimdReal::from(core::array::from_fn(|i| values[i].position_rate)),
            position_slop: SimdReal::from(core::array::from_fn(|i| values[i].position_slop)),
            velocity_slop: SimdReal::from(core::array::from_fn(|i| values[i].velocity_slop)),
            retain_velocity: SimdReal::from(core::array::from_fn(|i| values[i].retain_velocity)),
        }
    }
}

impl<N: ScalarType> ContactCorrection<N> {
    /// Added velocity RHS; computed from the current separation in each pass.
    pub(crate) fn velocity_bias(&self, dist: N) -> N {
        ((dist + self.velocity_slop).simd_min(N::zero()) * self.velocity_rate)
            .simd_max(-self.max_velocity)
            * self.enabled
    }

    /// Both corrections act before position integration. Only velocity bias may
    /// remain afterwards; restitution and speculative separation stay independent.
    pub(crate) fn biased_rhs(&self, dist: N, upstream_bias: N, max_speed: N) -> N {
        let position = ((dist + self.position_slop).simd_min(N::zero()) * self.position_rate)
            .simd_max(-max_speed);
        (position + self.velocity_bias(dist)).select(self.enabled.simd_gt(N::zero()), upstream_bias)
    }

    pub(crate) fn relaxed_rhs(&self, dist: N) -> N {
        self.velocity_bias(dist) * self.retain_velocity
    }
}
