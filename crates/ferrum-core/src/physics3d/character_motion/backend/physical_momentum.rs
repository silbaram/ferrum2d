//! Physical momentum and geometric curve rates have separate authorities.
//!
//! A Dynamic Native body enters the finite impulse solve with the accepted raw
//! solver velocity, not the normalized-Euler curve derivative. Prescribed
//! drivers have no finite momentum and retain their actual geometric rate.
//! Character canonical momentum remains owned by the response caller.
use super::{curve_velocity, Curve, Domain, Kernel, Participant, SolverMotionBody, Time};
use crate::physics3d::solver_trajectory::TrajectoryError;
use rapier3d::prelude as rp;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct State {
    pub linear: rp::Vector,
    pub angular: rp::Vector,
}

impl State {
    pub fn new(linear: rp::Vector, angular: rp::Vector) -> Result<Self, TrajectoryError> {
        if !linear.is_finite() || !angular.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(Self { linear, angular })
    }

    pub fn from_native(raw: SolverMotionBody) -> Result<Self, TrajectoryError> {
        Self::new(raw.linear_velocity, raw.angular_velocity)
    }

    pub fn from_curve(curve: Curve, time: Time) -> Result<Self, TrajectoryError> {
        if !time.is_finite() {
            return Err(TrajectoryError::InvalidTime);
        }
        let (linear, angular) = curve_velocity(curve, time)?;
        Self::new(linear, angular)
    }

    pub fn from_participant(value: &Participant) -> Result<Self, TrajectoryError> {
        Self::new(value.linear_velocity, value.angular_velocity)
    }

    /// The arm is measured from the same physical COM as the impulse solve.
    /// Caller work admission covers the fixed arithmetic and its row visits.
    pub fn point_rate(self, arm: rp::Vector) -> Result<rp::Vector, TrajectoryError> {
        if !arm.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let rate = self.linear + self.angular.cross(arm);
        rate.is_finite()
            .then_some(rate)
            .ok_or(TrajectoryError::NonFinite)
    }
}

/// Only for non-Character participants. Both baseline and solved support rates
/// must use this same role policy; swapping just one side creates phantom carry.
/// `raw` belongs to the actual Native context, before response writeback.
/// This does not integrate forces, copy a cap policy, or mutate Native storage.
pub(super) fn participant_seed(
    body: &rp::RigidBody,
    raw: SolverMotionBody,
    geometric: State,
) -> Result<State, TrajectoryError> {
    if body.is_dynamic() {
        State::from_native(raw)
    } else {
        State::new(geometric.linear, geometric.angular)
    }
}

/// Rebuild a changed body's geometric continuation with the existing Native
/// normalized-Euler law. Its derivative must be read back for geometry queries;
/// the physical `after` remains the raw writeback authority. Adding a physical
/// delta to an old geometric rate, or repairing a derivative seed only at final
/// writeback, are neither operations performed by this helper. The source
/// Native Kernel owns the physical remaining duration: logical span alone must
/// not restart its h when h and the precise global domain differ.
///
/// `None` preserves the caller's original Kernel/Constant/anchored expression
/// and exact bytes for an untouched body. Numeric signed-zero equality counts
/// as untouched: the original representation remains the authority.
pub(super) fn continuation(
    body: rp::RigidBodyHandle,
    source: Curve,
    domain: Domain,
    safe_com: rp::Pose,
    before: State,
    after: State,
) -> Result<Option<Kernel>, TrajectoryError> {
    Domain::new(domain.start, domain.end)?;
    if domain.duration() <= 0. {
        return Err(TrajectoryError::InvalidTime);
    }
    State::new(before.linear, before.angular)?;
    State::new(after.linear, after.angular)?;
    if !safe_com.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if before == after {
        return Ok(None);
    }
    // Only an original same-body Native interval owns a physical h/domain
    // mapping. Constant sensor stops and foreign geometry references cannot
    // manufacture one from logical duration or observer F32 timestamps.
    let Curve::Integrated(original) = source else {
        return Err(TrajectoryError::InvalidReference);
    };
    if original.native.motion.body != body {
        return Err(TrajectoryError::InvalidReference);
    }
    let physical_seconds = original.physical_span(domain)?;
    Kernel::from_velocity_seconds(
        body,
        domain,
        physical_seconds,
        safe_com,
        after.linear,
        after.angular,
    )
    .map(Some)
}

#[cfg(test)]
mod tests;
