//! Ferrum cold admission of stored rigid contact records. Read-only and allocation-free.
//! This does not validate feature/workspace shape semantics or later arithmetic overflow.
use crate::geometry::{ContactCorrection, ContactManifold, PairContacts};
use crate::math::{Pose, Rotation, Vector};
use crate::pipeline::PhysicsWorld;
use core::fmt;

// Fixed record work, not a CPU-instruction or allocator/RSS estimate.
const PAIR_WORK: usize = 32;
const MANIFOLD_WORK: usize = 64;
const POINT_WORK: usize = 32;
const SOLVER_WORK: usize = 16;
// Relative recycling poses can compose two admitted collider world rotations
// (each squared-norm error <=3e-5). This admits their product and f32 rounding.
const CACHED_ROTATION_TOLERANCE: f64 = 1.0e-4;
const INPUT_ROTATION_TOLERANCE: f64 = 1.0e-5;
const WORLD_ROTATION_TOLERANCE: f64 = 3.0e-5;
// A cold numerical policy for approximately unit normals. Composite conversion
// and collider world conversion need not reproduce exact unit-length bits.
const NORMAL_TOLERANCE: f64 = 1.0e-3;

#[doc(hidden)]
#[derive(Copy, Clone, Debug)]
pub struct StoredContactNumericLimits {
    /// Stored pair/manifold/point/solver records and ready-graph slots visited.
    pub max_work: usize,
}

#[doc(hidden)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StoredContactNumericError {
    WorkLimit,
    UnsupportedPair,
    ContactPoint,
    ContactImpulse,
    ManifoldNormal,
    ManifoldPose,
    Material,
    Correction,
    SolverContact,
    ContactIndex,
    RecycleState,
    ReadyGraph,
}
impl fmt::Display for StoredContactNumericError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid stored rigid contact numerical state: {self:?}")
    }
}
impl core::error::Error for StoredContactNumericError {}

type Error = StoredContactNumericError;
struct Budget(usize);
impl Budget {
    fn charge(&mut self, count: usize, record_work: usize) -> Result<(), Error> {
        self.0 = self
            .0
            .checked_sub(count.checked_mul(record_work).ok_or(Error::WorkLimit)?)
            .ok_or(Error::WorkLimit)?;
        Ok(())
    }
}
fn nonnegative(value: f32) -> bool {
    value.is_finite() && value >= 0.0
}
fn rotation(value: Rotation, tolerance: f64) -> bool {
    let components = value.to_array();
    components.iter().all(|x| x.is_finite())
        && (components
            .iter()
            .map(|&x| f64::from(x) * f64::from(x))
            .sum::<f64>()
            - 1.0)
            .abs()
            <= tolerance
}
fn pose(value: Pose, tolerance: f64) -> bool {
    value.translation.is_finite() && rotation(value.rotation, tolerance)
}
fn normal(value: Vector, used: bool) -> bool {
    if !value.is_finite() {
        return false;
    }
    if !used && value == Vector::ZERO {
        return true;
    }
    let length2 = value
        .to_array()
        .iter()
        .map(|&x| f64::from(x) * f64::from(x))
        .sum::<f64>();
    (length2 - 1.0).abs() <= NORMAL_TOLERANCE
}
fn correction(value: &ContactCorrection<f32>) -> bool {
    let ContactCorrection {
        enabled,
        retain_velocity,
        velocity_rate,
        max_velocity,
        position_rate,
        position_slop,
        velocity_slop,
    } = *value;
    [enabled, retain_velocity]
        .iter()
        .all(|&x| x == 0.0 || x == 1.0)
        && [
            velocity_rate,
            max_velocity,
            position_rate,
            position_slop,
            velocity_slop,
        ]
        .iter()
        .all(|&x| nonnegative(x))
}
fn manifold(value: &ContactManifold, budget: &mut Budget) -> Result<(), Error> {
    // Check both actual variable-size vectors before walking either payload.
    budget.charge(value.points.len(), POINT_WORK)?;
    budget.charge(value.data.solver_contacts.len(), SOLVER_WORK)?;
    if value.data.solver_contacts.len() > crate::math::MAX_MANIFOLD_POINTS {
        return Err(Error::SolverContact);
    }
    if !normal(value.local_n1, !value.points.is_empty())
        || !normal(value.local_n2, !value.points.is_empty())
        || !normal(value.data.normal, !value.data.solver_contacts.is_empty())
    {
        return Err(Error::ManifoldNormal);
    }
    if [value.subshape_pos1(), value.subshape_pos2()]
        .into_iter()
        .flatten()
        .any(|value| !pose(*value, INPUT_ROTATION_TOLERANCE))
    {
        return Err(Error::ManifoldPose);
    }
    if !nonnegative(value.data.friction) || !nonnegative(value.data.restitution) {
        return Err(Error::Material);
    }
    if !correction(&value.data.contact_correction) {
        return Err(Error::Correction);
    }
    for point in &value.points {
        if !point.local_p1.is_finite() || !point.local_p2.is_finite() || !point.dist.is_finite() {
            return Err(Error::ContactPoint);
        }
        let data = &point.data;
        if !data.impulse.is_finite()
            || !data.warmstart_impulse.is_finite()
            || !data.tangent_impulse.iter().all(|value| value.is_finite())
            || !data
                .warmstart_tangent_impulse
                .iter()
                .all(|value| value.is_finite())
            || !data.warmstart_twist_impulse.is_finite()
            || !data.warmstart_tangent_world.is_finite()
            || !data.solver_dp1.is_finite()
            || !data.solver_dp2.is_finite()
        {
            return Err(Error::ContactImpulse);
        }
    }
    for contact in &value.data.solver_contacts {
        if !contact.anchor1.is_finite()
            || !contact.anchor2.is_finite()
            || !contact.dist.is_finite()
            || !contact.tangent_velocity.is_finite()
        {
            return Err(Error::SolverContact);
        }
        // NEW_CONTACT_BIT is legitimate persistent history. Only the masked
        // index is bounded; 255 is the SIMD writeback padding sentinel.
        let [index] = contact.contact_indices();
        if index >= 255 || index as usize >= value.points.len() {
            return Err(Error::ContactIndex);
        }
    }
    Ok(())
}

/// Checks all persistent rigid contact records, including plain manifolds that
/// are not currently selected because solver clusters are present. No state is
/// rebuilt, repaired, normalized, reordered, or allocated. Inactive empty
/// manifolds, signed impulses/distance/velocity, restitution >1, and pending
/// recycling history are retained. Serde-skipped solver observations, stored unused SIMD padding,
/// and opaque query workspaces are not physical payload checked by this pass.
///
/// Structural/reference admission must run separately. Ready-graph empty-list
/// checks apply only when both stored epochs match the actual world; stale
/// graphs are rebuilt before consumption. All variable-size scans are precharged.
#[doc(hidden)]
pub fn validate_stored_contact_numerics(
    world: &PhysicsWorld,
    limits: StoredContactNumericLimits,
) -> Result<usize, Error> {
    let narrow = &world.narrow_phase;
    let mut budget = Budget(limits.max_work);
    budget.charge(narrow.contact_graph.graph.edges.len(), PAIR_WORK)?;
    for edge in &narrow.contact_graph.graph.edges {
        let PairContacts::Rigid(pair) = &edge.weight.contacts else {
            return Err(Error::UnsupportedPair);
        };
        budget.charge(pair.manifolds.len(), MANIFOLD_WORK)?;
        budget.charge(pair.solver_clusters.len(), MANIFOLD_WORK)?;
        for value in pair.manifolds.iter().chain(&pair.solver_clusters) {
            manifold(value, &mut budget)?;
        }
        if let Some(state) = &pair.recycle_state {
            if !pose(state.pos12, CACHED_ROTATION_TOLERANCE)
                || !rotation(state.rot1, WORLD_ROTATION_TOLERANCE)
                || !rotation(state.rot2, WORLD_ROTATION_TOLERANCE)
                || !nonnegative(state.max_extent)
                || !nonnegative(state.max_drift)
            {
                return Err(Error::RecycleState);
            }
        }
    }
    let buckets = narrow.solver_contact_graph.stored_buckets();
    budget.charge(buckets.len(), 1)?;
    let ready = narrow.solver_graph_valid
        && narrow.solver_graph_epoch == world.islands.active_set_epoch
        && narrow.solver_graph_mb_epoch == world.multibody_joints.topology_epoch;
    for bucket in buckets {
        budget.charge(bucket.len(), 1)?;
        if !ready {
            continue;
        }
        for reference in bucket {
            let pair = &narrow
                .contact_graph
                .graph
                .edges
                .get(reference.edge as usize)
                .ok_or(Error::ReadyGraph)?
                .weight;
            let manifold = pair
                .solver_manifolds()
                .get(reference.manifold as usize)
                .ok_or(Error::ReadyGraph)?;
            if manifold.data.solver_contacts.is_empty() {
                return Err(Error::ReadyGraph);
            }
        }
    }
    Ok(limits.max_work - budget.0)
}

#[cfg(test)]
mod tests;
