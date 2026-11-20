//! Safe borrowed access at the exclusive solver integration barrier.
//! No solver storage or body reference may outlive this call.
use crate::dynamics::{RigidBodyHandle, RigidBodySet};
use crate::geometry::ColliderSet;
use crate::math::{AngVector, Pose, Real, Vector};

/// Decision for a complete actual solver interval. A non-approved interval is
/// never written to rigid body poses, velocities or persistent contact impulses.
/// This is not a rollback of earlier pipeline bookkeeping or accepted intervals.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum SolverMotionDecision {
    /// Every proposal/response in this interval has been admitted.
    #[default]
    Approved = 0,
    /// Geometry, work, or response validation failed.
    Rejected = 1,
    /// A real first hit requires joining a sleeping dynamic participant.
    NeedsWakeJoin = 2,
}

impl SolverMotionDecision {
    pub(crate) fn from_code(code: u8) -> Self {
        match code {
            0 => Self::Approved,
            2 => Self::NeedsWakeJoin,
            _ => Self::Rejected,
        }
    }
}

/// One already integrated solver body. Poses are at the center of mass.
#[derive(Clone, Copy, Debug)]
pub struct SolverMotionBody {
    /// Live identity of the solver slot.
    pub handle: RigidBodyHandle,
    /// Already integrated center-of-mass pose at the interval end.
    pub end: Pose,
    /// Solved COM velocity; forces have already been integrated.
    pub linear_velocity: Vector,
    /// Solved angular rate; forces have already been integrated.
    pub angular_velocity: AngVector,
    /// Keep this approved integrated endpoint even when an authored
    /// position-kinematic target would otherwise replace it at pass end.
    /// False on an unchanged, previously unresolved proposal preserves the
    /// original exact-target native writeback.
    pub keep_integrated_endpoint: bool,
}

/// Rejected write; no body or solver field has changed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolverMotionWriteError {
    /// The slot is out of range or the generational identity differs.
    Index,
    /// A pose or velocity contains a non-finite component.
    NonFinite,
    /// The rotation is not unit within the existing body-input norm policy.
    InvalidRotation,
    /// A batch repeats or reorders a solver slot.
    IndexOrder,
}

/// All mutation is confined to the current group's solver slots. This API
/// exposes neither raw pointers nor internal SIMD/solver representation.
pub trait SolverMotionContext {
    /// Immutable original body/shape metadata during this solver scope.
    fn bodies(&self) -> &RigidBodySet;
    /// Immutable full collider geometry during this solver scope.
    fn colliders(&self) -> &ColliderSet;
    /// Seconds since the current CCD time slice began.
    fn start_time(&self) -> Real;
    /// Exclusive interval end in the same CCD-slice clock.
    fn end_time(&self) -> Real;
    /// Tick-local logical time in the caller's exact current CCD pass domain.
    /// Shared f64 boundaries partition that domain; physical integration_seconds
    /// and f32 observer labels are unchanged.
    fn precise_start_time(&self) -> f64;
    /// Exclusive logical interval end; the last interval uses the original end bits.
    fn precise_end_time(&self) -> f64;
    /// Whether this is the last actual internal interval of this pipeline slice.
    fn is_last_interval(&self) -> bool;
    /// Whether an earlier explicit replacement already overrode this
    /// position-kinematic target's final authored-pose writeback.
    fn prescribed_motion_resolved(&self, index: usize) -> Option<bool>;
    /// Rigid slots in this actual constraint-closed solver group.
    fn body_count(&self) -> usize;
    /// Read an already integrated body without borrowing internal storage.
    fn body(&self, index: usize) -> Option<SolverMotionBody>;
    /// Atomically replace one finite pose/velocity with matching identity.
    fn write_body(
        &mut self,
        index: usize,
        body: SolverMotionBody,
    ) -> Result<(), SolverMotionWriteError>;
    /// Validate an entire strictly increasing slot batch before any publication.
    /// The implementation performs no query/callback/allocation while committing
    /// the prevalidated rows, so a late invalid row cannot partly publish.
    fn write_bodies(
        &mut self,
        bodies: &[(usize, SolverMotionBody)],
    ) -> Result<(), SolverMotionWriteError>;
}

/// One position-only override approved before persistent solver writeback.
/// The COM pose is evaluated on the original kernel, not reconstructed from
/// the lossy diagnostic fraction. No velocity or force is part of this row.
#[derive(Clone, Copy, Debug)]
pub struct SolverCcdClamp {
    /// Body owning the moving collider.
    pub body: RigidBodyHandle,
    /// Original moving full-shape collider.
    pub moving: crate::geometry::ColliderHandle,
    /// Original limiting full-shape collider.
    pub target: crate::geometry::ColliderHandle,
    /// Approved original-kernel COM pose.
    pub end: Pose,
    /// Tick-local seconds within this CCD slice; geometry never reads f32 labels.
    pub cutoff_time: f64,
    /// World-space witness point.
    pub point: Vector,
    /// Unit world-space separating axis from target toward moving shape.
    pub normal: Vector,
}

/// A fully checked sensor crossing for the prepared CCD application phase.
#[derive(Clone, Copy, Debug)]
pub struct SolverCcdCrossing {
    /// Moving collider.
    pub moving: crate::geometry::ColliderHandle,
    /// Crossed collider.
    pub target: crate::geometry::ColliderHandle,
}

/// Reusable transient plan. Its vectors are populated with fallible reserves
/// charged to the opting-in caller's existing work/scratch budget. The default
/// handler leaves `covered` false and uses the unchanged native CCD path.
#[derive(Default, Debug)]
pub struct SolverCcdPlan {
    /// All origins in this Core CCD slice were considered, including mixed
    /// actual paths. A true value disables the old endpoint-sweep fallback.
    pub covered: bool,
    /// Real collider-pair sweep calls; internal kernel/leaf work is separate.
    pub checks: usize,
    /// At most one approved position-only override per body, sorted by identity.
    pub clamps: crate::alloc_prelude::Vec<SolverCcdClamp>,
    /// Crossings checked before any persistent publication.
    pub crossings: crate::alloc_prelude::Vec<SolverCcdCrossing>,
}
impl SolverCcdPlan {
    /// Discard a candidate without dropping reusable allocations.
    pub fn clear(&mut self) {
        self.covered = false;
        self.checks = 0;
        self.clamps.clear();
        self.crossings.clear();
    }
    /// Check only structure, identity and finite placement. Geometry, filtering
    /// and all allocation were already checked by the caller. No mutation occurs.
    pub(crate) fn valid(&self, context: &dyn SolverMotionContext) -> bool {
        if !self.covered {
            return self.clamps.is_empty() && self.crossings.is_empty() && self.checks == 0;
        }
        let mut previous = None;
        for row in &self.clamps {
            let key = row.body.into_raw_parts();
            if previous.is_some_and(|p| p >= key)
                || !row.cutoff_time.is_finite()
                || row.cutoff_time < context.precise_start_time()
                || row.cutoff_time >= context.precise_end_time()
                || !row.end.translation.is_finite()
                || !row.end.rotation.is_finite()
                || !row.point.is_finite()
                || !row.normal.is_finite()
                || (row.normal.length_squared() - 1.).abs() > 1e-5
            {
                return false;
            }
            #[cfg(feature = "dim3")]
            if (row.end.rotation.length_squared() - 1.).abs() > 1e-5 {
                return false;
            }
            let Some(body) = context.bodies().get(row.body) else {
                return false;
            };
            if !body.is_enabled()
                || !body.is_dynamic()
                || context.colliders().get(row.moving).and_then(|c| c.parent()) != Some(row.body)
                || context.colliders().get(row.target).is_none()
            {
                return false;
            }
            previous = Some(key);
        }
        self.crossings.iter().all(|row| {
            context.colliders().get(row.moving).is_some()
                && context.colliders().get(row.target).is_some()
        })
    }
}

#[cfg(all(test, feature = "dim3", feature = "serde-serialize"))]
mod tests;
