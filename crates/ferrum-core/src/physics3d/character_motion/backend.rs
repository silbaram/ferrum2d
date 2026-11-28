//! Actual solver proposals are planned locally and published as one checked batch.
//! This workspace is transient: no force, input, clock or persistent body is
//! changed by geometric queries or an unsuccessful response plan.
use super::actual_scene::{self, BodyTrajectory, ColliderTrajectory, Role};
use crate::physics3d::character::CharacterRuntime;
use crate::physics3d::character_contacts::actual_rows;
use crate::physics3d::character_dynamics::actual_impulse::{self, MassPolicy, Participant};
use crate::physics3d::contact_policy::ContactPolicies;
use crate::physics3d::events::EventCollector;
use crate::physics3d::geometry::same_pose_bits;
use crate::physics3d::motion_time::native_duration;
use crate::physics3d::motion_trace::AcceptedCurve;
use crate::physics3d::solver_trajectory::{
    self, Curve, Domain, Kernel, ShapeMotion, Time, TrajectoryError, Work,
};
use crate::physics3d::{BodyId, PhysicsWorld3d};
use rapier3d::pipeline::{
    SolverBodyIntegration, SolverMotionBody, SolverMotionContext, SolverMotionDecision,
};
use rapier3d::prelude as rp;
use rp::EventHandler as _;
use std::collections::BTreeMap;
use std::sync::Mutex;

pub(super) mod active_constraints;
mod classification;
mod clock_phase;
mod confined_push;
pub(super) mod finite_coasting;
mod opposed_rider;
mod physical_momentum;
mod representable;

const MAX_INTERVALS: usize = 1 << 20;

/// Exact-case observation only: 16 local-plan assignments plus one separately
/// reserved first stop record, so discarded plans cannot consume its slot.
#[cfg(test)]
fn authored_platform_stop_trace(published: bool, reason: &str, values: std::fmt::Arguments<'_>) {
    use std::sync::atomic::{AtomicUsize, Ordering};
    const CASE: &str = "engine::unified_physics::platform_tests::authored_platform_carries_capsule_in_xyz_through_reversals_without_query_teleports";
    let thread = std::thread::current();
    if thread.name() != Some(CASE) {
        return;
    }
    static ASSIGNMENTS: AtomicUsize = AtomicUsize::new(0);
    static FIRST_STOP: AtomicUsize = AtomicUsize::new(0);
    let (counter, limit) = if published {
        (&FIRST_STOP, 1)
    } else {
        (&ASSIGNMENTS, 16)
    };
    if let Ok(sequence) = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
        (n < limit).then_some(n + 1)
    }) {
        eprintln!("B52_AUTHORED_STOP case={:?} published={published} seq={sequence} reason={reason} {values}", thread.name());
    }
}

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct IncomingMotion {
    pub start: rp::Pose,
    pub linear: rp::Vector,
    pub angular: rp::Vector,
}
impl IncomingMotion {
    pub fn from_motion(
        motion: crate::physics3d::solver_trajectory::ShapeMotion,
        time: Time,
    ) -> Self {
        let (linear, angular) = motion.linear_angular_velocity(time);
        Self {
            start: motion.curve.com_pose(time),
            linear,
            angular,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct WakeJoin {
    pub body: rp::RigidBodyHandle,
    pub safe_time: Time,
    pub hit_time: Time,
    pub a: rp::ColliderHandle,
    pub b: rp::ColliderHandle,
    pub incoming_a: IncomingMotion,
    pub incoming_b: IncomingMotion,
}

pub(in crate::physics3d) enum WakeRetry {
    Joined,
    Prefix(Time),
    /// A new contact consumer requires a fresh, uncommitted Native proposal.
    Promoted,
}

#[derive(Default)]
pub(in crate::physics3d) struct BackendMotionScratch {
    proposals: Vec<SolverBodyIntegration>,
    entries: Vec<Entry>,
    trajectories: Vec<BodyTrajectory>,
    accepted: Vec<AcceptedCurve>,
    publish: Vec<(usize, SolverMotionBody)>,
    participants: Vec<Participant>,
    rows: Vec<actual_impulse::Row>,
    row_restitution: Vec<f32>,
    row_impulses: Vec<f32>,
    row_sources: Vec<Option<crate::physics3d::ContactImpulse>>,
    impulses: crate::physics3d::contact_impulses::actual::Staging,
    impulse_limit: usize,
    contacts: Vec<actual_scene::ContactSample>,
    // Current Native context only; never a physical impulse source.
    active_contacts: Vec<active_constraints::ActiveContact>,
    character_values: Vec<(BodyId, rp::Vector)>,
    character_rows: Vec<actual_rows::Row>,
    character_carry: Vec<rp::Vector>,
    carry_rows: Vec<Option<rp::Vector>>,
    character_response: actual_rows::Scratch,
    disabled_pairs: Vec<(BodyId, BodyId)>,
    affected: Vec<BodyId>,
    affected_checkpoint: Vec<BodyId>,
    prescribed_paths: Vec<BodyId>,
    sweep_sensor_paths: Vec<BodyId>,
    /// Current consumers of an actual finite path, independent of CCD flags.
    mixed: Vec<BodyId>,
    /// Monotonic within a tick; retained when an uncommitted slice is retried.
    promoted: Vec<BodyId>,
    promotions: Vec<BodyId>,
    promotion_pending: bool,
    separate_virtual_components: bool,
    ccd_source: Vec<AcceptedCurve>,
    ccd_clipped: Vec<AcceptedCurve>,
    ccd_trace: Vec<Trace>,
    stops: Vec<(BodyId, Time)>,
    stops_checkpoint: Vec<(BodyId, Time)>,
    trace: Vec<Trace>,
    pass_marker: Option<usize>,
    prepared_clamps_left: usize,
    path_casts: u32,
    path_failures: u32,
    origins: Vec<CharacterOrigin>,
    pub feedback: Vec<super::BackendCharacterFeedback>,
    origin_checkpoint: Vec<CharacterOrigin>,
    sensors: super::sensors::Scratch,
    final_origins: Vec<(BodyId, rp::Pose)>,
    endpoint_current: Vec<(BodyId, rp::Pose)>,
    endpoint_targets: Vec<(BodyId, rp::Pose)>,
    endpoint_active: Vec<bool>,
    pub committed_seconds: Time,
    scene: actual_scene::Scratch,
    scene_bounds: actual_scene::BoundsCache,
    replay_pairs: actual_scene::ReplayPairs,
    last_pair_count: usize,
    response: actual_impulse::Scratch,
    #[cfg(test)]
    response_failure_logged: bool,
    error: Option<TrajectoryError>,
    pub wake_join: Option<WakeJoin>,
    used: u64,
}

enum Trace {
    Pass {
        observer_duration: f32,
        domain: Domain,
        actual_duration: Time,
    },
    Curve {
        actual: AcceptedCurve,
        observer_start: f32,
        observer_end: f32,
    },
    Sensor(rp::ColliderHandle, rp::ColliderHandle),
    Clamp {
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        sweep: rapier3d::parry::query::sweep_toi::Sweep,
        fraction: f32,
    },
    PreparedClamp {
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        cutoff: Time,
        duration: Time,
    },
}

#[derive(Clone, Copy)]
struct Entry {
    slot: usize,
    value: SolverMotionBody,
    curve: Curve,
    domain_start: Time,
    original: SolverBodyIntegration,
    /// Physical ground can remain attached while the world-space curve is held still.
    support: Option<rp::RigidBodyHandle>,
    velocity_delta: rp::Vector,
    /// Momentum ledger; these are never inferred from a geometric target rate.
    momentum_before: rp::Vector,
    momentum_carry: rp::Vector,
    carry_correction: rp::Vector,
    /// Geometry response from real physical rows only, after consumed credit.
    geometry_delta: rp::Vector,
    geometry_credit: rp::Vector,
    response_geometry_delta: rp::Vector,
    response_geometry_credit: rp::Vector,
    blocked_moving: bool,
    blocked_character: bool,
    hit_ceiling: bool,
    stopped_at: Option<Time>,
}

#[derive(Clone, Copy)]
struct CharacterOrigin {
    body: BodyId,
    coasting_frame: Option<BodyId>,
    confined_receiver: Option<confined_push::Receiver>,
    start: rp::Vector,
    carry: rp::Vector,
    anchored: bool,
    velocity_delta: rp::Vector,
    published_velocity_delta: rp::Vector,
    relative_momentum: rp::Vector,
    momentum_carry: rp::Vector,
    finite_mass: bool,
    tight_static_epsilon: Option<f32>,
    blocked_moving: bool,
    blocked_character: bool,
    hit_ceiling: bool,
    support: Option<(BodyId, Option<rp::Vector>)>,
    /// Immutable free geometry, captured once at controller entry.
    relative_plan: rp::Vector,
    /// Accepted physical-row geometry changes; virtual projections never enter.
    geometry_delta: rp::Vector,
    /// Canonical geometric projection already applied over physical momentum.
    geometry_credit: rp::Vector,
}

#[cfg(test)]
pub(super) fn diagnostic_first_hit_case() -> bool {
    std::thread::current().name().is_some_and(|name| {
        [
            "physics3d::character_coupling_tests::coupled_push_preserves_tangential_input_and_planar_locks",
            "physics3d::character_coupling_tests::excluded_capsule_pairs_do_not_transmit_pushes_or_consume_pair_query_work",
            "physics3d::character_coupling_tests::incoming_wall_push_propagates_to_another_capsule_with_free_space",
            "physics3d::character_coupling_tests::oblique_wall_normals_push_a_capsule_pair_in_the_actual_world_direction",
            "physics3d::angular_ccd_bounds_tests::angular_ccd_small_angle_long_offset_sparse_and_dense_candidate_cost",
        ]
        .contains(&name)
    })
}

// Observation only: keep the existing first-two verbose records unchanged.
// The two selected original cases get at most 256 response before/after pairs and 257
// first-hit summaries per Native context; no curve or contact is re-evaluated.
#[cfg(test)]
fn diagnostic_response_flow_case() -> bool {
    std::thread::current().name().is_some_and(|name| {
        [
            "physics3d::character_coupling_tests::free_capsule_chain_is_pushed_without_a_false_squeeze_stop",
            "physics3d::character_coupling_tests::coupled_push_preserves_tangential_input_and_planar_locks",
            "physics3d::character_dynamic_tests::simultaneous_capsules_share_one_dynamic_body_without_duplicate_impulses",
        ]
        .contains(&name)
    })
}

#[cfg(test)]
pub(super) fn diagnostic_kernel_phases(
    curve: Curve,
    start: Time,
    end: Time,
) -> Option<([u32; 2], Option<[u32; 2]>)> {
    let (kernel, anchored) = match curve {
        Curve::Integrated(kernel) => (kernel, false),
        Curve::Anchored { carrier, .. } => (carrier, true),
        _ => return None,
    };
    let primary = [start, end].map(|time| kernel.local_delta(time).to_bits());
    let relative = anchored.then(|| {
        [start, end].map(|time| {
            ((time - kernel.domain.start).clamp(0., kernel.domain.duration()) as f32).to_bits()
        })
    });
    Some((primary, relative))
}

fn identity(handle: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = handle.into_raw_parts();
    BodyId { slot, generation }
}

fn curve_velocity(curve: Curve, time: Time) -> Result<(rp::Vector, rp::Vector), TrajectoryError> {
    let motion = crate::physics3d::solver_trajectory::ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let (linear, angular) = motion.linear_angular_velocity(time);
    if !linear.is_finite() || !angular.is_finite() {
        Err(TrajectoryError::NonFinite)
    } else {
        Ok((linear, angular))
    }
}

/// Allocate consumed geometry credit along one solved row's linear impulse
/// model. Distinct contact normals settle independently; net response direction
/// is never used to erase an unrelated normal or tangent. The model is used
/// only for debit allocation. Actual participant output remains authoritative;
/// the physical impulse, mass and participant velocity are not changed.
fn settle_geometry_credit(
    credit: rp::Vector,
    delta: rp::Vector,
) -> Result<(rp::Vector, rp::Vector), TrajectoryError> {
    if !credit.is_finite() || !delta.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let d = delta.to_array().map(f64::from);
    let squared = d.iter().map(|v| v * v).sum::<f64>();
    if squared == 0. {
        return Ok((credit, delta));
    }
    let magnitude = squared.sqrt();
    let projection = credit
        .to_array()
        .into_iter()
        .zip(d)
        .map(|(c, d)| f64::from(c) * d)
        .sum::<f64>()
        / magnitude;
    let consumed = projection.max(0.).min(magnitude) / magnitude;
    if !magnitude.is_finite() || !projection.is_finite() || !consumed.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    // Widen only bookkeeping arithmetic. Actual J and all solver operations
    // remain the original F32 values, including native axis locks.
    let used = rp::Vector::from(d.map(|v| (v * consumed) as f32));
    let remaining = credit - used;
    let effective = delta - used;
    if !remaining.is_finite() || !effective.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    Ok((remaining, effective))
}

/// Admission for the two new geometry metadata buffers, before any backing
/// request or element write. The same amount is deducted from solver scratch.
fn geometry_metadata_bytes(characters: usize, rows: usize) -> Result<usize, TrajectoryError> {
    characters
        .checked_mul(std::mem::size_of::<rp::Vector>())
        .and_then(|n| {
            rows.checked_mul(std::mem::size_of::<Option<rp::Vector>>())
                .and_then(|r| n.checked_add(r))
        })
        .ok_or(TrajectoryError::WorkLimit)
}

fn physical_geometry_row(
    rows: &[actual_impulse::Row],
    impulses: &[f32],
    participants: &[Participant],
    body: BodyId,
    point: rp::Vector,
    normal: rp::Vector,
) -> bool {
    rows.iter().zip(impulses).any(|(row, j)| {
        *j > 0.
            && row.point == point
            && ((participants[row.a].body == body && row.normal == normal)
                || (row.b.is_some_and(|b| participants[b].body == body) && -row.normal == normal))
    })
}

fn pair(a: BodyId, b: BodyId) -> (BodyId, BodyId) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

#[allow(clippy::too_many_arguments)]
fn eligible_pair(
    disabled_pairs: &[(BodyId, BodyId)],
    affected: &[BodyId],
    prescribed: &[BodyId],
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
    bodies: &rp::RigidBodySet,
    continuous: bool,
    contact_mode: bool,
) -> bool {
    if let (Some(a), Some(b)) = (a.parent, b.parent) {
        if disabled_pairs
            .binary_search(&pair(identity(a), identity(b)))
            .is_ok()
        {
            return false;
        }
    }
    if matches!(a.role, Role::Character(_)) || matches!(b.role, Role::Character(_)) {
        return true;
    }
    let guarded = |collider: &ColliderTrajectory| {
        collider
            .parent
            .and_then(|id| bodies.get(id))
            .is_some_and(|body| continuous && body.is_dynamic() && body.is_ccd_enabled())
    };
    // An authored path guards prescribed geometry and controller coupling.
    // Ordinary rigid contacts with its platform still belong to the Native
    // solver, just as with a direct kinematic target. A CCD origin or a
    // rigid body already in the actual-motion component keeps its sweep.
    if !contact_mode
        && !prescribed.is_empty()
        && [(a, b), (b, a)].into_iter().any(|(path, other)| {
            path.role == Role::Prescribed
                && path
                    .parent
                    .is_some_and(|h| prescribed.binary_search(&identity(h)).is_ok())
                && matches!(other.role, Role::Dynamic | Role::SleepingDynamic)
                && other.parent.is_some_and(|h| {
                    affected.binary_search(&identity(h)).is_err() && !guarded(other)
                })
        })
    {
        return false;
    }
    if [a.parent, b.parent]
        .into_iter()
        .flatten()
        .any(|body| affected.binary_search(&identity(body)).is_ok())
    {
        return true;
    }
    if [a.parent, b.parent]
        .into_iter()
        .flatten()
        .any(|body| prescribed.binary_search(&identity(body)).is_ok())
    {
        return true;
    }
    if contact_mode
        && [a.role, b.role]
            .into_iter()
            .any(|role| matches!(role, Role::Dynamic | Role::SleepingDynamic))
    {
        return true;
    }
    // Pure Native CCD remains pending until its final position-only plan.
    // A mixed consumer must instead approve the whole actual finite path.
    if super::native_ccd::defer_pair(a, b, bodies, continuous, affected) {
        return false;
    }
    if continuous
        && matches!(
            (a.role, b.role),
            (Role::Dynamic, Role::Fixed) | (Role::Fixed, Role::Dynamic)
        )
    {
        return true;
    }
    guarded(a) || guarded(b)
}

fn pair_clearance(
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
) -> f32 {
    let skin = |role| match role {
        Role::Character(id) => characters
            .get(&id)
            .map_or(f32::NAN, |r| r.config.skin_width),
        _ => 0.,
    };
    skin(a.role).max(skin(b.role))
}

fn effective_pair_clearance(
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    origins: &[CharacterOrigin],
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
) -> f32 {
    pair_clearance_policy(characters, origins, a, b).distance()
}

fn pair_clearance_policy(
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    origins: &[CharacterOrigin],
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
) -> actual_scene::PairClearance {
    for (character, other) in [(a, b), (b, a)] {
        let Role::Character(body) = character.role else {
            continue;
        };
        let Some(epsilon) = origins
            .binary_search_by_key(&body, |o| o.body)
            .ok()
            .and_then(|i| origins[i].tight_static_epsilon)
        else {
            continue;
        };
        let (start, end) = other.motion.curve.times();
        if matches!(other.role, Role::Fixed | Role::Prescribed)
            && other.motion.pose(start) == other.motion.pose(end)
            && other.motion.linear_angular_velocity(start) == (rp::Vector::ZERO, rp::Vector::ZERO)
        {
            // The same current full-shape headroom predicate as the existing
            // tight controller selected physical clearance. Every actual
            // interval still needs its original full-geometry certificate.
            if let Some(runtime) = characters.get(&body) {
                return actual_scene::PairClearance::Tight {
                    epsilon,
                    up: rp::Vector::from(runtime.config.up),
                };
            }
        }
    }
    actual_scene::PairClearance::Distance(pair_clearance(characters, a, b))
}

fn uncoupled_character(
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
) -> bool {
    [a.role, b.role].into_iter().any(|role| {
        matches!(role,Role::Character(id)
        if characters.get(&id).is_some_and(|r|r.config.push_mass==0.))
    })
}

fn reserve<T>(values: &mut Vec<T>, count: usize) -> Result<(), TrajectoryError> {
    values
        .try_reserve(count.saturating_sub(values.len()))
        .map_err(|_| TrajectoryError::WorkLimit)
}

/// Instantaneous placements use real complete leaf geometry; they do not
/// create a sweep or let one compound leaf's old overlap excuse another leaf.
#[allow(clippy::too_many_arguments)]
fn admit_positions(
    bodies: &rp::RigidBodySet,
    colliders: &rp::ColliderSet,
    policies: &ContactPolicies,
    current: &[(BodyId, rp::Pose)],
    positions: &[(BodyId, rp::Pose)],
    subject: Option<BodyId>,
    prescribed_policy: bool,
    continuous: bool,
    allowed_error: f32,
    scratch: &BackendMotionScratch,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    use rapier3d::parry::bounding_volume::BoundingVolume;
    if !allowed_error.is_finite() || allowed_error < 0. {
        return Err(TrajectoryError::NonFinite);
    }
    work.charge(positions.len() as u64)?;
    let old_at = |id: BodyId| {
        current
            .binary_search_by_key(&id, |p| p.0)
            .ok()
            .map(|i| current[i].1)
            .or_else(|| {
                bodies
                    .get(crate::physics3d::world::native_id(id))
                    .map(|b| *b.position())
            })
    };
    let new_at = |id: BodyId| {
        positions
            .iter()
            .find(|p| p.0 == id)
            .map(|p| p.1)
            .or_else(|| old_at(id))
    };
    let controlled = |id: BodyId| {
        scratch
            .origins
            .binary_search_by_key(&id, |o| o.body)
            .is_ok()
            || scratch.prescribed_paths.binary_search(&id).is_ok()
            || scratch.mixed.binary_search(&id).is_ok()
    };
    for &(id, pose) in positions {
        if subject.is_some_and(|s| s != id) {
            continue;
        }
        if !pose.is_finite() || (pose.rotation.length_squared() - 1.).abs() > 1e-5 {
            return Err(TrajectoryError::NonFinite);
        }
        let handle = crate::physics3d::world::native_id(id);
        let body = bodies
            .get(handle)
            .ok_or(TrajectoryError::InvalidReference)?;
        let scan = body
            .colliders()
            .len()
            .checked_mul(colliders.motion_storage_slots() + 1)
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(scan).map_err(|_| TrajectoryError::WorkLimit)?)?;
        for &a_handle in body.colliders() {
            let a = colliders
                .get(a_handle)
                .ok_or(TrajectoryError::InvalidReference)?;
            let origin_sensor = prescribed_policy
                && a.is_sensor()
                && scratch.sweep_sensor_paths.binary_search(&id).is_ok();
            if !a.is_enabled() || (a.is_sensor() && !origin_sensor) {
                continue;
            }
            let local = a
                .position_wrt_parent()
                .ok_or(TrajectoryError::InvalidReference)?;
            let old = old_at(id).ok_or(TrajectoryError::InvalidReference)? * *local;
            let next = pose * *local;
            let bounds = a.shape().compute_aabb(&next);
            for (b_handle, b) in colliders.iter() {
                if a_handle == b_handle
                    || b.parent() == Some(handle)
                    || !b.is_enabled()
                    || b.is_sensor()
                    || !a.collision_groups().test(b.collision_groups())
                    || !policies.pair_allows(Some(handle), b.parent())
                {
                    continue;
                }
                if origin_sensor
                    && b.parent()
                        .and_then(|id| bodies.get(id))
                        .is_some_and(|body| body.is_dynamic())
                {
                    // Match the existing virtual prescribed-path query tier.
                    continue;
                }
                if b.parent().is_some_and(|p| {
                    scratch
                        .disabled_pairs
                        .binary_search(&pair(id, identity(p)))
                        .is_ok()
                }) {
                    continue;
                }
                if prescribed_policy
                    && !controlled(id)
                    && !b.parent().is_some_and(|p| controlled(identity(p)))
                    && !b.parent().and_then(|p| bodies.get(p)).is_some_and(|body| {
                        continuous && body.is_dynamic() && body.is_ccd_enabled()
                    })
                {
                    continue;
                }
                let (old_b, next_b) = if let Some(parent) = b.parent() {
                    let id = identity(parent);
                    let local = b
                        .position_wrt_parent()
                        .ok_or(TrajectoryError::InvalidReference)?;
                    (
                        old_at(id).ok_or(TrajectoryError::InvalidReference)? * *local,
                        new_at(id).ok_or(TrajectoryError::InvalidReference)? * *local,
                    )
                } else {
                    (*b.position(), *b.position())
                };
                if !bounds.intersects(&b.shape().compute_aabb(&next_b)) {
                    continue;
                }
                if !policies.one_way_allows_at(a_handle, &next, b.shape(), &next_b)
                    || !policies.one_way_allows_at(b_handle, &next_b, a.shape(), &next)
                {
                    continue;
                }
                crate::physics3d::solver_trajectory::admit_endpoint_pair(
                    a.shape(),
                    old,
                    next,
                    b.shape(),
                    old_b,
                    next_b,
                    if origin_sensor { 0. } else { allowed_error },
                    work,
                )?;
            }
        }
    }
    Ok(())
}

pub(in crate::physics3d) fn admit_ratio_positions(
    bodies: &rp::RigidBodySet,
    colliders: &rp::ColliderSet,
    policies: &ContactPolicies,
    positions: &[(rp::RigidBodyHandle, rp::Pose)],
    allowed_error: f32,
    scratch: &mut BackendMotionScratch,
) -> Result<(), TrajectoryError> {
    if positions.len() > 2 {
        return Err(TrajectoryError::InvalidReference);
    }
    let mut converted = [(
        BodyId {
            slot: 0,
            generation: 0,
        },
        rp::Pose::IDENTITY,
    ); 2];
    for (out, &(body, pose)) in converted.iter_mut().zip(positions) {
        *out = (identity(body), pose);
    }
    let mut work = Work {
        used: scratch.used,
        limit: super::trajectory::MAX_PROOF_WORK,
    };
    let result = admit_positions(
        bodies,
        colliders,
        policies,
        &[],
        &converted[..positions.len()],
        None,
        false,
        false,
        allowed_error,
        scratch,
        &mut work,
    );
    scratch.used = work.used;
    result
}

impl BackendMotionScratch {
    pub fn error(&self) -> Option<TrajectoryError> {
        self.error
    }

    pub fn fail(&mut self, error: TrajectoryError) {
        self.error = Some(error);
    }

    pub fn prepare_diagnostic_work(&mut self, records: usize) -> Result<(), TrajectoryError> {
        self.charge(
            (records as u64)
                .checked_add(1)
                .ok_or(TrajectoryError::WorkLimit)?,
        )
    }

    pub fn needs_promotion(&self) -> bool {
        self.promotion_pending
    }

    fn charge(&mut self, amount: u64) -> Result<(), TrajectoryError> {
        self.used = self
            .used
            .checked_add(amount)
            .filter(|n| *n <= super::trajectory::MAX_PROOF_WORK)
            .ok_or(TrajectoryError::WorkLimit)?;
        Ok(())
    }

    fn prepare_mixed(&mut self) -> Result<(), TrajectoryError> {
        let count = self
            .origins
            .len()
            .checked_mul(2)
            .and_then(|n| n.checked_add(self.mixed.len()))
            .and_then(|n| n.checked_add(self.affected.len()))
            .and_then(|n| n.checked_add(self.prescribed_paths.len()))
            .and_then(|n| n.checked_add(self.promoted.len()))
            .ok_or(TrajectoryError::WorkLimit)?;
        let log = usize::BITS - count.max(1).leading_zeros();
        self.charge(
            (count as u64)
                .checked_mul(8 * (u64::from(log) + 1))
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        reserve(&mut self.mixed, count)?;
        for origin in &self.origins {
            self.mixed.push(origin.body);
            if let Some((carrier, _)) = origin.support {
                self.mixed.push(carrier);
            }
        }
        self.mixed.extend_from_slice(&self.affected);
        self.mixed.extend_from_slice(&self.prescribed_paths);
        self.mixed.extend_from_slice(&self.promoted);
        self.mixed.sort_unstable();
        self.mixed.dedup();
        Ok(())
    }

    /// The monotonic tags survive rollback; no command or physical impulse does.
    fn request_promotions(&mut self, work: &mut Work) -> Result<bool, TrajectoryError> {
        let target = self
            .promoted
            .len()
            .checked_add(self.promotions.len())
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(
            (self.promotions.len() as u64)
                .checked_mul(target as u64 + 1)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        reserve(&mut self.promoted, target)?;
        let mut changed = false;
        for &id in &self.promotions {
            if let Err(index) = self.promoted.binary_search(&id) {
                self.promoted.insert(index, id);
                changed = true;
            }
        }
        if changed {
            self.promotion_pending = true;
        }
        Ok(changed)
    }

    /// Discover only the actual touching component. Fixed walls cannot join
    /// two otherwise unrelated Native components through their shared identity.
    fn contact_component(
        &mut self,
        work: &mut Work,
        body_limit: usize,
    ) -> Result<bool, TrajectoryError> {
        self.promotions.clear();
        if self.mixed.len() > body_limit {
            return Err(TrajectoryError::InvalidReference);
        }
        work.charge(body_limit as u64)?;
        reserve(&mut self.mixed, body_limit)?;
        reserve(&mut self.promotions, body_limit)?;
        let log = usize::BITS - body_limit.max(1).leading_zeros();
        loop {
            work.charge(
                (self.contacts.len() as u64)
                    .checked_mul(8 * (u64::from(log) + 1))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            let mut grew = false;
            for sample in &self.contacts {
                let connected = [sample.a, sample.b].into_iter().any(|c| {
                    c.parent
                        .is_some_and(|id| self.mixed.binary_search(&identity(id)).is_ok())
                });
                if !connected {
                    continue;
                }
                for collider in [sample.a, sample.b] {
                    if matches!(collider.role, Role::Fixed) {
                        continue;
                    }
                    let Some(body) = collider.parent.map(identity) else {
                        continue;
                    };
                    if let Err(index) = self.mixed.binary_search(&body) {
                        if self.mixed.len() == body_limit {
                            return Err(TrajectoryError::InvalidReference);
                        }
                        work.charge(self.mixed.len() as u64 + 1)?;
                        self.mixed.insert(index, body);
                        self.promotions.push(body);
                        grew = true;
                    }
                }
            }
            if !grew {
                break;
            }
        }
        if self.request_promotions(work)? {
            return Ok(true);
        }
        work.charge(
            (self.contacts.len() as u64)
                .checked_mul(2 * u64::from(log) + 1)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        self.contacts.retain(|sample| {
            [sample.a, sample.b].into_iter().any(|c| {
                c.parent
                    .is_some_and(|id| self.mixed.binary_search(&identity(id)).is_ok())
            })
        });
        Ok(false)
    }

    /// Find the movable component of a proved virtual pressure conflict.
    /// Fixed colliders can constrain several actors without coupling them.
    fn virtual_pressure_component(
        &mut self,
        hit: actual_scene::Hit,
        bodies: &rp::RigidBodySet,
        planar: bool,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        if !self.separate_virtual_components || self.promotions.capacity() < bodies.len() {
            return Ok(false);
        }
        // Incompatible bounds on one exact coordinate prove that a selected
        // character's simultaneous rows are infeasible.
        let mut conflict = false;
        for role in [hit.a.role, hit.b.role] {
            let Role::Character(body) = role else {
                continue;
            };
            work.charge(self.character_rows.len() as u64 * 8)?;
            let (mut lower, mut upper) = (
                rp::Vector::splat(f32::NEG_INFINITY),
                rp::Vector::splat(f32::INFINITY),
            );
            for row in &self.character_rows {
                if row.b.is_some() || self.character_values[row.a].0 != body {
                    continue;
                }
                let Some(axis) = row
                    .normal
                    .to_array()
                    .into_iter()
                    .position(|v| v.abs() == 1.)
                else {
                    continue;
                };
                if (planar && axis == 2) || (0..3).any(|i| i != axis && row.normal[i] != 0.) {
                    continue;
                }
                if row.normal[axis] > 0. {
                    lower[axis] = lower[axis].max(row.velocity[axis]);
                } else {
                    upper[axis] = upper[axis].min(row.velocity[axis]);
                }
            }
            conflict |= lower.cmpgt(upper).any();
        }
        if !conflict {
            return Ok(false);
        }
        self.collect_virtual_hit_component(hit, bodies, work)
    }

    /// Find the actual movable dependencies of the selected virtual response.
    /// Fixed surfaces contribute rows without coupling unrelated actors.
    fn collect_virtual_hit_component(
        &mut self,
        hit: actual_scene::Hit,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        if !self.separate_virtual_components
            || self.promotions.capacity() < bodies.len()
            || ![hit.a.role, hit.b.role]
                .into_iter()
                .any(|role| matches!(role, Role::Character(_)))
        {
            return Ok(false);
        }
        let motion_is_linear = |curve| match curve {
            Curve::Integrated(k) | Curve::Anchored { carrier: k, .. } => {
                k.native.angular_velocity == rp::Vector::ZERO
            }
            Curve::Constant { .. } => true,
            Curve::Ccd { .. } => false,
        };
        work.charge(self.entries.len() as u64 * 8)?;
        if self.entries.iter().any(|entry| {
            !bodies[entry.value.handle].is_kinematic() || !motion_is_linear(entry.curve)
        }) {
            return Ok(false);
        }
        let movable = |shape: ColliderTrajectory| {
            (!matches!(shape.role, Role::Fixed))
                .then(|| shape.parent.map(identity))
                .flatten()
        };
        let dynamic = |sample: &actual_scene::ContactSample| {
            [sample.a.role, sample.b.role]
                .into_iter()
                .any(|role| matches!(role, Role::Dynamic | Role::SleepingDynamic))
        };
        let row_count = self.contacts.len() + self.active_contacts.len();
        work.charge(row_count as u64 * 8)?;
        if self.contacts.iter().any(dynamic)
            || self.active_contacts.iter().any(|row| dynamic(&row.sample))
        {
            return Ok(false);
        }

        // contact_component has already reserved this backing and applied any
        // promotions. Reuse it for the sorted response component.
        let members = &mut self.promotions;
        members.clear();
        let body_limit = bodies.len();
        let add = |members: &mut Vec<BodyId>, body, work: &mut Work| {
            let Err(index) = members.binary_search(&body) else {
                return Ok(false);
            };
            if members.len() >= body_limit || members.len() == members.capacity() {
                return Err(TrajectoryError::InvalidReference);
            }
            work.charge(members.len() as u64 + 1)?;
            members.insert(index, body);
            Ok(true)
        };
        for body in [movable(hit.a), movable(hit.b)].into_iter().flatten() {
            add(members, body, work)?;
        }
        loop {
            let before = members.len();
            let lookup = usize::BITS - members.len().max(1).leading_zeros();
            work.charge((row_count + 2 * self.entries.len()) as u64 * (2 * u64::from(lookup) + 1))?;
            for sample in self.contacts.iter().chain(
                self.active_contacts
                    .iter()
                    .filter(|row| row.visible)
                    .map(|row| &row.sample),
            ) {
                let pair = [movable(sample.a), movable(sample.b)];
                if pair
                    .into_iter()
                    .flatten()
                    .any(|body| members.binary_search(&body).is_ok())
                {
                    for body in pair.into_iter().flatten() {
                        add(members, body, work)?;
                    }
                }
            }
            for entry in &self.entries {
                let anchor = match entry.curve {
                    Curve::Anchored { carrier, .. } => Some(carrier.native.motion.body),
                    _ => None,
                };
                for carrier in [entry.support, anchor].into_iter().flatten() {
                    if !bodies.get(carrier).is_some_and(|b| b.is_kinematic()) {
                        // Preserve the original solver for external carry.
                        return Ok(false);
                    }
                    let body = identity(entry.value.handle);
                    let carrier = identity(carrier);
                    if members.binary_search(&body).is_ok() {
                        add(members, carrier, work)?;
                    } else if members.binary_search(&carrier).is_ok() {
                        add(members, body, work)?;
                    }
                }
            }
            if members.len() == before || members.len() >= body_limit {
                break;
            }
        }
        Ok(true)
    }

    fn isolate_virtual_hit_component(
        &mut self,
        hit: actual_scene::Hit,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        if !self.collect_virtual_hit_component(hit, bodies, work)? {
            return Ok(false);
        }
        let movable_member = |shape: ColliderTrajectory| {
            !matches!(shape.role, Role::Fixed)
                && shape
                    .parent
                    .is_some_and(|body| self.promotions.binary_search(&identity(body)).is_ok())
        };
        let in_component = |sample: &actual_scene::ContactSample| {
            movable_member(sample.a) || movable_member(sample.b)
        };
        let row_count = self.contacts.len() + self.active_contacts.len();
        let lookup = usize::BITS - self.promotions.len().max(1).leading_zeros();
        work.charge(row_count as u64 * (2 * u64::from(lookup) + 1))?;
        // The full census already handled wake and promotion. A disconnected
        // row can only constrain its own separate response.
        self.contacts.retain(in_component);
        for row in &mut self.active_contacts {
            row.visible &= in_component(&row.sample);
        }
        Ok(true)
    }

    fn sweeps_origin_sensor(&self, collider: &ColliderTrajectory) -> bool {
        collider.sensor
            && collider
                .parent
                .is_some_and(|id| self.sweep_sensor_paths.binary_search(&identity(id)).is_ok())
    }

    fn sensor_path_pair(&self, a: &ColliderTrajectory, b: &ColliderTrajectory) -> bool {
        [(a, b), (b, a)].into_iter().any(|(origin, target)| {
            self.sweeps_origin_sensor(origin)
                && !target.sensor
                && !matches!(target.role, Role::Dynamic | Role::SleepingDynamic)
        })
    }

    /// Requested moving-origin sensors constrain a path, never finite momentum.
    fn stop_sensor_path(
        &mut self,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        work.charge(
            (self.entries.len() as u64)
                .checked_mul(8)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        let target = self
            .accepted
            .len()
            .checked_add(self.entries.len())
            .filter(|n| *n <= MAX_INTERVALS)
            .ok_or(TrajectoryError::WorkLimit)?;
        reserve(&mut self.accepted, target)?;
        let mut changed = false;
        for (origin, other) in [(hit.a, hit.b), (hit.b, hit.a)] {
            if !self.sweeps_origin_sensor(&origin)
                || other.sensor
                || matches!(other.role, Role::Dynamic | Role::SleepingDynamic)
            {
                continue;
            }
            for collider in [origin, other] {
                let incoming = collider.collider == origin.collider
                    || (matches!(collider.role, Role::Prescribed)
                        && self
                            .prescribed_paths
                            .binary_search(&identity(
                                collider.parent.ok_or(TrajectoryError::InvalidReference)?,
                            ))
                            .is_err()
                        && collider.motion.linear_angular_velocity(hit.cast.hit_time)
                            != (rp::Vector::ZERO, rp::Vector::ZERO));
                if !incoming {
                    continue;
                }
                let index = self
                    .entry_index(collider.parent)
                    .ok_or(TrajectoryError::MissingBodyMotion)?;
                let entry = self.entries[index];
                if curve_velocity(entry.curve, time)? == (rp::Vector::ZERO, rp::Vector::ZERO) {
                    continue;
                }
                let pose = entry.curve.com_pose(time);
                self.stage_curve(entry, entry.domain_start, time, bodies, work)?;
                let entry = &mut self.entries[index];
                entry.curve = Curve::Constant {
                    pose,
                    start_time: time,
                    end_time: end,
                };
                entry.domain_start = time;
                entry.value.end = pose;
                entry.value.linear_velocity = rp::Vector::ZERO;
                entry.value.angular_velocity = rp::Vector::ZERO;
                entry.value.keep_integrated_endpoint = true;
                #[cfg(test)]
                authored_platform_stop_trace(
                    false,
                    "sensor_path",
                    format_args!(
                    "safe={time:.18e} end={end:.18e} body={:?} original={:?} current={:?} hit={:?}",
                    entry.value.handle, entry.original, entry.value, hit),
                );
                entry.stopped_at = Some(time);
                changed = true;
            }
        }
        if !changed {
            return Err(TrajectoryError::Unresolved);
        }
        self.refresh_anchors(time, end, bodies, work)
    }

    pub fn begin_tick(&mut self) {
        self.scene_bounds.invalidate();
        self.last_pair_count = 0;
        self.replay_pairs = actual_scene::ReplayPairs::default();
        self.active_contacts.clear();
        self.origins.clear();
        self.feedback.clear();
        self.error = None;
        self.wake_join = None;
        self.used = 0;
        self.prescribed_paths.clear();
        self.sweep_sensor_paths.clear();
        self.mixed.clear();
        self.promoted.clear();
        self.promotions.clear();
        self.promotion_pending = false;
        self.stops.clear();
        self.stops_checkpoint.clear();
        self.affected.clear();
        self.affected_checkpoint.clear();
        self.committed_seconds = 0.;
    }

    pub fn begin_controller_interval(&mut self) {
        self.active_contacts.clear();
        self.origins.clear();
        self.feedback.clear();
    }

    fn begin_pass(&mut self) {
        self.active_contacts.clear();
        self.pass_marker = None;
        self.prepared_clamps_left = 0;
        self.sensors.begin_pass();
        if let Err(error) = self
            .charge(self.stops.len() as u64)
            .and_then(|()| reserve(&mut self.stops_checkpoint, self.stops.len()))
        {
            self.error = Some(error);
            return;
        }
        self.stops_checkpoint.clear();
        self.stops_checkpoint.extend_from_slice(&self.stops);
        if self.error.is_some() {
            return;
        }
        if let Err(error) = self
            .charge(self.origins.len() as u64)
            .and_then(|()| reserve(&mut self.origin_checkpoint, self.origins.len()))
        {
            self.error = Some(error);
            return;
        }
        if let Err(error) = self
            .charge(self.affected.len() as u64)
            .and_then(|()| reserve(&mut self.affected_checkpoint, self.affected.len()))
        {
            self.error = Some(error);
            return;
        }
        self.affected_checkpoint.clear();
        self.affected_checkpoint.extend_from_slice(&self.affected);
        self.origin_checkpoint.clear();
        self.origin_checkpoint.extend_from_slice(&self.origins);
    }

    pub fn reject_current_pass(&mut self) {
        self.active_contacts.clear();
        std::mem::swap(&mut self.origins, &mut self.origin_checkpoint);
        std::mem::swap(&mut self.affected, &mut self.affected_checkpoint);
        std::mem::swap(&mut self.stops, &mut self.stops_checkpoint);
    }

    pub fn finish_feedback(
        &mut self,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        bodies: &rp::RigidBodySet,
    ) -> Result<(), TrajectoryError> {
        // Precharge this read and the subsequent commit of the same ledger.
        self.charge((self.origins.len() as u64) * 2)?;
        reserve(&mut self.feedback, self.origins.len())?;
        self.feedback.clear();
        for origin in &self.origins {
            let r = characters
                .get(&origin.body)
                .ok_or(TrajectoryError::InvalidReference)?;
            let body = bodies
                .get(crate::physics3d::world::native_id(origin.body))
                .ok_or(TrajectoryError::InvalidReference)?;
            let translation = body.center_of_mass() - origin.start;
            if !translation.is_finite()
                || !origin.carry.is_finite()
                || !origin.velocity_delta.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            self.feedback.push(super::BackendCharacterFeedback {
                body: origin.body,
                translation,
                carry_translation: if origin.anchored {
                    origin.carry
                } else {
                    rp::Vector::from(r.state.carry_translation)
                },
                velocity_delta: origin.velocity_delta - origin.published_velocity_delta,
                blocked_moving: origin.blocked_moving,
                blocked_character: origin.blocked_character,
                hit_ceiling: origin.hit_ceiling,
            });
        }
        Ok(())
    }

    pub fn publish_impulses(&mut self, collector: &EventCollector) -> Result<(), TrajectoryError> {
        self.impulses
            .publish_committed(self.committed_seconds, collector)
    }

    pub fn commit_feedback(&mut self) {
        for origin in &mut self.origins {
            origin.published_velocity_delta = origin.velocity_delta;
        }
    }

    fn record_feedback(&mut self, work: &mut Work) -> Result<(), TrajectoryError> {
        work.charge((self.entries.len() + self.accepted.len()) as u64)?;
        let stop_target = self
            .stops
            .len()
            .checked_add(self.entries.len())
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(
            (self.entries.len() as u64)
                .checked_mul(stop_target as u64 + 1)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        reserve(&mut self.stops, stop_target)?;
        for entry in &self.entries {
            if let Some(time) = entry.stopped_at {
                let id = identity(entry.value.handle);
                let at = time;
                match self.stops.binary_search_by_key(&id, |s| s.0) {
                    Ok(index) => self.stops[index].1 = self.stops[index].1.min(at),
                    Err(index) => self.stops.insert(index, (id, at)),
                }
                #[cfg(test)]
                authored_platform_stop_trace(true, "feedback_some", format_args!(
                    "stop={at:.18e} body={id:?} committed={:.18e} original={:?} current={:?} curve={:?}",
                    self.committed_seconds, entry.original, entry.value, entry.curve));
            }
        }
        for entry in &self.entries {
            if let Ok(index) = self
                .origins
                .binary_search_by_key(&identity(entry.value.handle), |o| o.body)
            {
                let origin = &mut self.origins[index];
                // Only the finite/equal-weight momentum solve contributes.
                // A suffix path projection supplies no impulse or feedback.
                origin.velocity_delta += entry.velocity_delta;
                origin.geometry_delta += entry.geometry_delta;
                origin.geometry_credit = entry.geometry_credit;
                origin.momentum_carry = entry.momentum_carry;
                origin.blocked_moving |= entry.blocked_moving;
                origin.blocked_character |= entry.blocked_character;
                origin.hit_ceiling |= entry.hit_ceiling;
                if !origin.velocity_delta.is_finite()
                    || !origin.geometry_delta.is_finite()
                    || !origin.geometry_credit.is_finite()
                {
                    return Err(TrajectoryError::NonFinite);
                }
            }
        }
        Ok(())
    }

    fn trace(&mut self, event: Trace) {
        if self.error.is_some() {
            return;
        }
        if let Err(error) = self.charge(1) {
            self.error = Some(error);
            return;
        }
        if self.trace.len() == MAX_INTERVALS || self.trace.try_reserve(1).is_err() {
            self.error = Some(TrajectoryError::WorkLimit);
        } else {
            self.trace.push(event);
        }
    }

    /// Callback approval lives in private solver buffers. Publish observations
    /// only for fully advanced CCD slices, using the pipeline's actual clock.
    pub fn finish_trace(
        &self,
        collector: &EventCollector,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        committed: Time,
    ) {
        let observe = collector.wants_body_motion();
        let mut complete = false;
        for event in &self.trace {
            match event {
                Trace::Pass {
                    observer_duration,
                    domain,
                    actual_duration,
                } => {
                    complete = *actual_duration > 0. && domain.end <= committed;
                    if complete && observe {
                        collector
                            .2
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .begin_precise_domain(*observer_duration, *domain);
                    }
                }
                Trace::Curve {
                    actual,
                    observer_start,
                    observer_end,
                } if complete && observe => {
                    collector.handle_solver_body_motion(rapier3d::pipeline::SolverBodyMotion {
                        body: actual.body,
                        start_time: *observer_start,
                        end_time: *observer_end,
                        start: actual.curve.com_pose(actual.start_time),
                        end: actual.curve.com_pose(actual.end_time),
                    });
                    collector
                        .2
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .record_global_curve(*actual);
                }
                Trace::Clamp {
                    body,
                    start,
                    end,
                    sweep,
                    fraction,
                } if complete && observe => {
                    collector.handle_body_motion_clamped(*body, *start, *end, sweep, *fraction)
                }
                Trace::PreparedClamp {
                    body,
                    start,
                    end,
                    cutoff,
                    duration,
                } if complete && observe => {
                    collector.handle_body_motion_clamp(
                        *body,
                        *start,
                        *end,
                        (*cutoff / *duration) as f32,
                    );
                }
                Trace::Sensor(a, b) if complete => {
                    let flags = rapier3d::geometry::CollisionEventFlags::SENSOR;
                    collector.handle_collision_event(
                        bodies,
                        colliders,
                        rp::CollisionEvent::Started(*a, *b, flags),
                        None,
                    );
                    collector.handle_collision_event(
                        bodies,
                        colliders,
                        rp::CollisionEvent::Stopped(*a, *b, flags),
                        None,
                    );
                }
                _ => {}
            }
        }
    }

    pub fn prepare_disabled_pairs(
        &mut self,
        joints: &BTreeMap<crate::physics3d::JointId, crate::physics3d::joints::JointRuntime>,
    ) -> Result<(), TrajectoryError> {
        let n = joints.len();
        let log = if n == 0 {
            0
        } else {
            usize::BITS - n.leading_zeros()
        } as u64;
        let bound = (n as u64)
            .checked_mul(8 * (log + 1))
            .ok_or(TrajectoryError::WorkLimit)?;
        let next = self
            .used
            .checked_add(bound)
            .filter(|n| *n <= super::trajectory::MAX_PROOF_WORK)
            .ok_or(TrajectoryError::WorkLimit)?;
        reserve(&mut self.disabled_pairs, n)?;
        self.disabled_pairs.clear();
        for runtime in joints.values().filter(|r| !r.desc.contacts_enabled) {
            self.disabled_pairs
                .push(pair(runtime.desc.body_a, runtime.desc.body_b));
        }
        self.disabled_pairs.sort_unstable();
        self.disabled_pairs.dedup();
        self.used = next;
        Ok(())
    }

    pub fn path_query_counts(&self) -> (u32, u32) {
        (self.path_casts, self.path_failures)
    }

    fn reset(&mut self) {
        self.active_contacts.clear();
        self.path_casts = 0;
        self.path_failures = 0;
        self.proposals.clear();
        self.accepted.clear();
        self.trace.clear();
        self.impulses.reset(self.impulse_limit);
        self.error = None;
        self.wake_join = None;
        self.promotion_pending = false;
        for origin in &mut self.origins {
            // Physical responses span all backend passes of this controller
            // interval; begin_controller_interval owns their reset.
            origin.blocked_moving = false;
            origin.blocked_character = false;
            origin.hit_ceiling = false;
        }
    }

    fn proposal(&mut self, integration: SolverBodyIntegration) {
        if self.error.is_some() {
            return;
        }
        if let Err(error) = self.charge(1) {
            self.error = Some(error);
            return;
        }
        if self.proposals.len() == MAX_INTERVALS || self.proposals.try_reserve(1).is_err() {
            self.error = Some(TrajectoryError::WorkLimit);
        } else {
            self.proposals.push(integration);
        }
    }

    fn entry_index(&self, parent: Option<rp::RigidBodyHandle>) -> Option<usize> {
        let key = parent?.into_raw_parts();
        self.entries
            .binary_search_by_key(&key, |e| e.value.handle.into_raw_parts())
            .ok()
    }

    fn rotating_contact_anchor(
        carrier: rp::SolverBodyIntegration,
        point: rp::Vector,
    ) -> rp::Vector {
        let start = carrier.motion.start;
        // Saved Native rotations can be a few F32 steps from unit length.
        // Invert the rigid frame without adding that error to each local arm.
        let q = start.rotation.as_dquat().normalize();
        let relative = point.as_dvec3() - start.translation.as_dvec3();
        (q.conjugate() * relative).as_vec3()
    }

    // With a single-axis spin the axial part of the rider's arm produces no
    // physical rotation velocity. Attach that component to the actual box
    // face when the upright capsule is already inside its positive skin. The
    // face and rider then evaluate the same rounded rotation at every time.
    fn rotating_rider_anchor(
        carrier: Kernel,
        rider: SolverBodyIntegration,
        runtime: &CharacterRuntime,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        let start = rider.motion.start;
        let arm = Self::rotating_contact_anchor(carrier.native, start.translation);
        let up = rp::Vector::from(runtime.config.up);
        let Some(axis) = representable::normal_phase_axis(carrier, up, work)? else {
            return Ok(arm);
        };
        work.charge(96)?;
        let support = bodies
            .get(carrier.native.motion.body)
            .ok_or(TrajectoryError::InvalidReference)?;
        let character = bodies
            .get(rider.motion.body)
            .ok_or(TrajectoryError::InvalidReference)?;
        if up[axis].abs() != 1.
            || !support.is_kinematic()
            || support.local_center_of_mass() != rp::Vector::ZERO
            || character.local_center_of_mass() != rp::Vector::ZERO
        {
            return Ok(arm);
        }
        let [handle] = support.colliders() else {
            return Ok(arm);
        };
        let centered = |handle| {
            colliders
                .get(handle)
                .filter(|c| c.position_wrt_parent() == Some(&rp::Pose::IDENTITY))
        };
        let Some(cube) = centered(*handle).and_then(|c| c.shape().as_cuboid()) else {
            return Ok(arm);
        };
        let Some(capsule) = centered(crate::physics3d::colliders::native_collider(
            runtime.collider,
        ))
        .and_then(|c| c.shape().as_capsule()) else {
            return Ok(arm);
        };
        if up[axis] * arm[axis] < cube.half_extents[axis] {
            return Ok(arm);
        }
        let base = carrier.native.motion.start;
        let contact = match solver_trajectory::leaf_contact(&base, cube, &start, capsule, work) {
            Err(TrajectoryError::Unresolved) => return Ok(arm),
            result => result?,
        };
        if !(0. < contact.dist && contact.dist <= runtime.config.skin_width)
            || contact.normal1[axis] * up[axis] <= 0.
            || (0..3).any(|i| i != axis && contact.normal1[i] != 0.)
        {
            return Ok(arm);
        }
        let mut face = arm;
        face[axis] = up[axis] * cube.half_extents[axis];
        let world_face = base.translation + base.rotation * face;
        let offset = start.translation - world_face;
        // Accept only an exact reconstruction of this native starting pose.
        if (world_face + offset).to_array().map(f32::to_bits)
            == start.translation.to_array().map(f32::to_bits)
        {
            Ok(face)
        } else {
            Ok(arm)
        }
    }

    fn anchor_characters(
        &mut self,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        controller_seconds: f32,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        if !controller_seconds.is_finite() || controller_seconds <= 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        work.charge(self.entries.len() as u64)?;
        for index in 0..self.entries.len() {
            let entry = self.entries[index];
            let Some(runtime) = characters.get(&identity(entry.value.handle)) else {
                continue;
            };
            if runtime.state.vertical_speed > 0. {
                continue;
            }
            let origin_index = self
                .origins
                .binary_search_by_key(&identity(entry.value.handle), |o| o.body)
                .map_err(|_| TrajectoryError::InvalidReference)?;
            let origin = &self.origins[origin_index];
            let Some((support, local_anchor)) = origin.support else {
                continue;
            };
            let carrier_handle = crate::physics3d::world::native_id(support);
            let Some(carrier_index) = self.entry_index(Some(carrier_handle)) else {
                // A stationary sleeping support has no awake proposal and no
                // actual moving carry to replace. Its wake is a separate join.
                continue;
            };
            let carrier = match self.entries[carrier_index].curve {
                Curve::Integrated(carrier) => carrier,
                Curve::Constant { .. } => continue,
                _ => return Err(TrajectoryError::InvalidReference),
            };
            let body = bodies
                .get(carrier_handle)
                .ok_or(TrajectoryError::InvalidReference)?;
            let start = entry.original.motion.start;
            let anchor = match local_anchor {
                Some(local) => local - body.local_center_of_mass(),
                None if carrier.native.angular_velocity != rp::Vector::ZERO => {
                    Self::rotating_rider_anchor(
                        carrier,
                        entry.original,
                        runtime,
                        bodies,
                        colliders,
                        work,
                    )?
                }
                None => {
                    body.position().inverse_transform_point(start.translation)
                        - body.local_center_of_mass()
                }
            };
            let offset = start.translation
                - (carrier.native.motion.start.translation
                    + carrier.native.motion.start.rotation * anchor);
            let relative = origin.relative_plan + origin.geometry_delta;
            let proposal = |linear_velocity| Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation: start.rotation,
            };
            let relative = match origin.confined_receiver {
                Some(receiver)
                    if solver_trajectory::constant_pose(Curve::Integrated(carrier)).is_some() =>
                {
                    receiver.project(
                        self,
                        entry,
                        proposal(relative),
                        runtime,
                        carrier_handle,
                        bodies,
                        colliders,
                        work,
                    )?
                }
                _ => relative,
            };
            // A new actual context re-proposes canonical geometry. Old wall
            // compensation must be re-established by the full-shape guard.
            self.entries[index].carry_correction = rp::Vector::ZERO;
            self.entries[index].curve = proposal(relative);
            self.entries[index].support = Some(carrier_handle);
        }
        Ok(())
    }

    #[cfg(test)]
    fn log_response_failure(&mut self, stage: &str, hit: actual_scene::Hit, time: Time) {
        if self.response_failure_logged {
            return;
        }
        self.response_failure_logged = true;
        let thread = std::thread::current();
        let case = thread.name();
        eprintln!("C18_RESPONSE case={case:?} stage={stage} safe={time:.18e} hit={:.18e} pair={:?}/{:?} physical_rows={} geometry_rows={}",hit.cast.hit_time,hit.a.collider,hit.b.collider,self.rows.len(),self.character_rows.len());
        eprintln!("C18_CONTACT case={case:?} hit={hit:?}");
        for (entry, p) in self.entries.iter().zip(&self.participants).take(8) {
            eprintln!("C18_VALUE case={case:?} body={:?} mass={:?} curve={:?} support={:?} physical={:?} before={:?} physical_delta={:?} geometry_delta={:?} geometry_credit={:?} pending_delta={:?} pending_credit={:?} projected={:?}",
                p.body,p.mass,entry.curve,entry.support,p.linear_velocity,entry.momentum_before,entry.velocity_delta,
                entry.geometry_delta,entry.geometry_credit,entry.response_geometry_delta,entry.response_geometry_credit,
                self.character_values.binary_search_by_key(&p.body,|v|v.0).ok().map(|i|self.character_values[i].1));
            if let Ok(i) = self.origins.binary_search_by_key(&p.body, |o| o.body) {
                let o = self.origins[i];
                eprintln!("C18_ORIGIN case={case:?} body={:?} plan={:?} momentum={:?} carry={:?} physical_delta={:?} geometry_delta={:?} credit={:?}",
                    o.body,o.relative_plan,o.relative_momentum,o.momentum_carry,o.velocity_delta,o.geometry_delta,o.geometry_credit);
            }
        }
        for row in self.rows.iter().take(16) {
            eprintln!("C18_PHYSICAL_ROW case={case:?} row={row:?}");
        }
        for row in self.character_rows.iter().take(16) {
            eprintln!(
                "C18_GEOMETRY_ROW case={case:?} a={} b={:?} normal={:?} target={:?}",
                row.a, row.b, row.normal, row.velocity
            );
        }
    }

    /// Original real-support point, expressed about its Native COM. Geometry
    /// phase fitting must never move this physical point or create momentum.
    fn physical_support_anchor(
        &self,
        entry: Entry,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        let support = entry.support.ok_or(TrajectoryError::InvalidReference)?;
        work.charge(u64::from(usize::BITS - self.origins.len().max(1).leading_zeros()) + 16)?;
        let origin = self
            .origins
            .binary_search_by_key(&identity(entry.value.handle), |o| o.body)
            .map_err(|_| TrajectoryError::InvalidReference)?;
        let (original, local) = self.origins[origin]
            .support
            .ok_or(TrajectoryError::InvalidReference)?;
        if original != identity(support) {
            return Err(TrajectoryError::InvalidReference);
        }
        let body = bodies
            .get(support)
            .ok_or(TrajectoryError::InvalidReference)?;
        let anchor = match local {
            Some(local) => local - body.local_center_of_mass(),
            None if matches!(entry.curve, Curve::Anchored { carrier, .. }
                if carrier.native.angular_velocity != rp::Vector::ZERO) =>
            {
                work.charge(
                    256 + u64::from(usize::BITS - self.entries.len().max(1).leading_zeros()),
                )?;
                let index = self
                    .entry_index(Some(support))
                    .ok_or(TrajectoryError::MissingBodyMotion)?;
                // The published body pose can lag this Native integration.
                Self::rotating_contact_anchor(
                    self.entries[index].original,
                    entry.original.motion.start.translation,
                )
            }
            None => {
                work.charge(256)?;
                body.position()
                    .inverse_transform_point(entry.original.motion.start.translation)
                    - body.local_center_of_mass()
            }
        };
        if !anchor.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(anchor)
    }

    /// Current non-Character physical baseline. Dynamic bodies keep the raw
    /// already-solved/capped Native state; external drivers keep the actual
    /// prescribed curve rate. Never reconstruct a raw baseline from its nlerp
    /// derivative, even when no physical row changes that body.
    fn native_physical_seed(
        &self,
        entry: Entry,
        time: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<physical_momentum::State, TrajectoryError> {
        work.charge(512)?;
        let body = bodies
            .get(entry.value.handle)
            .ok_or(TrajectoryError::InvalidReference)?;
        physical_momentum::participant_seed(
            body,
            entry.value,
            physical_momentum::State::from_curve(entry.curve, time)?,
        )
    }

    /// Read the geometric consequence of a solved physical state through the
    /// original continuation law. This is a temporary proposal: no Entry,
    /// body, impulse or accepted prefix is changed here. After final rebase the
    /// same function reads that installed curve, without applying J twice.
    fn native_geometry_curve(
        &self,
        index: usize,
        safe: Time,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<Curve, TrajectoryError> {
        work.charge(16)?;
        let entry = self.entries[index];
        let before = self.native_physical_seed(entry, time, bodies, work)?;
        let after = physical_momentum::State::from_participant(&self.participants[index])?;
        if before == after {
            return Ok(entry.curve);
        }
        work.charge(512)?;
        physical_momentum::continuation(
            entry.value.handle,
            entry.curve,
            Domain::new(safe, end)?,
            entry.curve.com_pose(safe),
            before,
            after,
        )
        .map(|kernel| kernel.map_or(entry.curve, Curve::Integrated))
    }

    #[allow(clippy::too_many_arguments)]
    fn geometric_point_rate(
        &self,
        index: usize,
        safe: Time,
        time: Time,
        end: Time,
        point: rp::Vector,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        work.charge(512)?;
        let curve = self.native_geometry_curve(index, safe, time, end, bodies, work)?;
        physical_momentum::State::from_curve(curve, time)?
            .point_rate(point - curve.com_pose(time).translation)
    }

    #[allow(clippy::too_many_arguments)]
    fn geometric_surface_rate(
        &self,
        other: &ColliderTrajectory,
        safe: Time,
        time: Time,
        end: Time,
        point: rp::Vector,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        work.charge(u64::from(usize::BITS - self.entries.len().max(1).leading_zeros()) + 256)?;
        if let Some(index) = self.entry_index(other.parent) {
            self.geometric_point_rate(index, safe, time, end, point, bodies, work)
        } else {
            let rate = other.motion.point_velocity(time, point);
            if !rate.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            Ok(rate)
        }
    }

    fn baseline_support_rate(
        &self,
        entry: Entry,
        time: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        let Some(support) = entry.support else {
            return Ok(rp::Vector::ZERO);
        };
        work.charge(u64::from(usize::BITS - self.entries.len().max(1).leading_zeros()) + 512)?;
        let index = self
            .entry_index(Some(support))
            .ok_or(TrajectoryError::MissingBodyMotion)?;
        let carrier = self.entries[index];
        let anchor = self.physical_support_anchor(entry, bodies, work)?;
        self.native_physical_seed(carrier, time, bodies, work)?
            .point_rate(carrier.curve.com_pose(time).rotation * anchor)
    }

    /// Physical support point rate uses the actual impulse participant pose and
    /// solved raw state. A later geometric phase/rebase cannot move this arm.
    fn actual_carrier_rate(
        &self,
        entry: Entry,
        _time: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        let Some(support) = entry.support else {
            return Ok(rp::Vector::ZERO);
        };
        work.charge(u64::from(usize::BITS - self.entries.len().max(1).leading_zeros()) + 32)?;
        let index = self
            .entry_index(Some(support))
            .ok_or(TrajectoryError::MissingBodyMotion)?;
        let participant = self.participants[index];
        let anchor = self.physical_support_anchor(entry, bodies, work)?;
        physical_momentum::State::from_participant(&participant)?
            .point_rate(participant.pose.rotation * anchor)
    }

    /// Geometry transport is measured from the proposed original-law Native
    /// curve, independently of physical point velocity used by the J solve.
    fn geometric_carrier_rate(
        &self,
        entry: Entry,
        safe: Time,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        let Some(support) = entry.support else {
            return Ok(rp::Vector::ZERO);
        };
        work.charge(u64::from(usize::BITS - self.entries.len().max(1).leading_zeros()) + 512)?;
        let index = self
            .entry_index(Some(support))
            .ok_or(TrajectoryError::MissingBodyMotion)?;
        let curve = self.native_geometry_curve(index, safe, time, end, bodies, work)?;
        let anchor = self.physical_support_anchor(entry, bodies, work)?;
        physical_momentum::State::from_curve(curve, time)?
            .point_rate(curve.com_pose(time).rotation * anchor)
    }

    /// Re-propose all characters, including recipients of another rider's
    /// virtual transport. Only canonical intent and accepted finite momentum
    /// survive a response; wall/pair geometry is rebuilt from all current rows.
    /// Nothing is reconstructed from a carry/noncarry decomposition of the
    /// previously solved F32 total.
    fn geometry_after_carrier_response(
        &self,
        entry: Entry,
        safe: Time,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        let id = identity(entry.value.handle);
        work.charge(u64::from(usize::BITS - self.origins.len().max(1).leading_zeros()) + 4)?;
        let index = self
            .origins
            .binary_search_by_key(&id, |o| o.body)
            .map_err(|_| TrajectoryError::InvalidReference)?;
        let origin = self.origins[index];
        let value = origin.relative_plan
            + origin.geometry_delta
            + entry.geometry_delta
            + entry.response_geometry_delta
            + self.geometric_carrier_rate(entry, safe, time, end, bodies, work)?;
        if !value.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(value)
    }

    /// Only the same live support contributes carry at an affine row. An
    /// unrelated moving wall is a pusher, not a carrier. Character-pair rows
    /// obtain the other actor's already-tagged carry inside the fair solve.
    fn surface_carry(
        &self,
        actor: BodyId,
        other: &ColliderTrajectory,
        velocity: rp::Vector,
    ) -> rp::Vector {
        self.entry_index(Some(crate::physics3d::world::native_id(actor)))
            .filter(|&i| {
                self.entries[i].support.is_some() && self.entries[i].support == other.parent
            })
            .map_or(rp::Vector::ZERO, |_| velocity)
    }

    #[allow(clippy::too_many_arguments)]
    fn project_character_suffix(
        &mut self,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        planar: bool,
        work: &mut Work,
        scratch: usize,
    ) -> Result<bool, TrajectoryError> {
        // Project only the character suffix path. This virtual correction
        // never changes a finite participant's momentum or native reaction.
        if !self.character_values.is_empty() {
            let contact_count = self
                .contacts
                .len()
                .checked_add(self.active_contacts.len())
                .ok_or(TrajectoryError::WorkLimit)?;
            let entry_log = usize::BITS - self.entries.len().max(1).leading_zeros();
            work.charge(
                (contact_count as u64)
                    .checked_mul(4 * u64::from(entry_log) + 8)
                    .and_then(|n| n.checked_add(self.entries.len() as u64))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            let row_backing = contact_count
                .checked_mul(std::mem::size_of::<actual_rows::Row>())
                .and_then(|n| {
                    geometry_metadata_bytes(self.character_values.len(), contact_count)
                        .ok()
                        .and_then(|meta| n.checked_add(meta))
                })
                .ok_or(TrajectoryError::WorkLimit)?;
            if row_backing > scratch {
                return Err(TrajectoryError::WorkLimit);
            }
            // Row-net mapping allocates only consumed credit. The actual
            // participant output remains the sole physical response authority.
            work.charge(self.entries.len() as u64)?;
            for (entry, participant) in self.entries.iter_mut().zip(&self.participants) {
                entry.response_geometry_delta =
                    if matches!(participant.mass, MassPolicy::Character(_)) {
                        (participant.linear_velocity - entry.momentum_before)
                            - (entry.geometry_credit - entry.response_geometry_credit)
                    } else {
                        rp::Vector::ZERO
                    };
                if !entry.response_geometry_delta.is_finite() {
                    return Err(TrajectoryError::NonFinite);
                }
            }
            reserve(&mut self.character_carry, self.character_values.len())?;
            self.character_values.clear();
            self.character_carry.clear();
            for (entry, participant) in self.entries.iter().zip(&self.participants) {
                if characters.contains_key(&participant.body) {
                    self.character_carry.push(self.geometric_carrier_rate(
                        *entry,
                        time,
                        hit.cast.hit_time,
                        end,
                        bodies,
                        work,
                    )?);
                    self.character_values.push((
                        participant.body,
                        // Surface constraints already contain the physical
                        // post-solve response. Preserve the authored geometric
                        // rate instead of applying that impulse a second time.
                        self.geometry_after_carrier_response(
                            *entry,
                            time,
                            hit.cast.hit_time,
                            end,
                            bodies,
                            work,
                        )?,
                    ));
                }
            }
            self.character_rows.clear();
            reserve(&mut self.carry_rows, contact_count)?;
            reserve(&mut self.character_rows, contact_count)?;
            self.carry_rows.clear();
            work.charge(
                (contact_count as u64)
                    .checked_mul(2 * (self.rows.len() as u64 + 1))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            for sample in self.contacts.iter().chain(
                self.active_contacts
                    .iter()
                    .filter(|v| v.visible)
                    .map(|v| &v.sample),
            ) {
                let point = (sample.contact.point1 + sample.contact.point2) * 0.5;
                let a = match sample.a.role {
                    Role::Character(id) => self
                        .character_values
                        .binary_search_by_key(&id, |v| v.0)
                        .ok(),
                    _ => None,
                };
                let b = match sample.b.role {
                    Role::Character(id) => self
                        .character_values
                        .binary_search_by_key(&id, |v| v.0)
                        .ok(),
                    _ => None,
                };
                if let (Some(a), Some(b)) = (a, b) {
                    self.character_rows.push(actual_rows::Row {
                        a,
                        b: Some(b),
                        normal: -sample.contact.normal1,
                        velocity: rp::Vector::ZERO,
                    });
                    self.carry_rows.push(Some(rp::Vector::ZERO));
                } else {
                    if let Some(a) = a {
                        let velocity = self.geometric_surface_rate(
                            &sample.b,
                            time,
                            hit.cast.hit_time,
                            end,
                            point,
                            bodies,
                            work,
                        )?;
                        self.character_rows.push(actual_rows::Row {
                            a,
                            b: None,
                            normal: -sample.contact.normal1,
                            velocity,
                        });
                        self.carry_rows.push(
                            (!physical_geometry_row(
                                &self.rows,
                                &self.row_impulses,
                                &self.participants,
                                self.character_values[a].0,
                                point,
                                -sample.contact.normal1,
                            ))
                            .then(|| {
                                self.surface_carry(self.character_values[a].0, &sample.b, velocity)
                            }),
                        );
                    }
                    if let Some(a) = b {
                        let velocity = self.geometric_surface_rate(
                            &sample.a,
                            time,
                            hit.cast.hit_time,
                            end,
                            point,
                            bodies,
                            work,
                        )?;
                        self.character_rows.push(actual_rows::Row {
                            a,
                            b: None,
                            normal: sample.contact.normal1,
                            velocity,
                        });
                        self.carry_rows.push(
                            (!physical_geometry_row(
                                &self.rows,
                                &self.row_impulses,
                                &self.participants,
                                self.character_values[a].0,
                                point,
                                sample.contact.normal1,
                            ))
                            .then(|| {
                                self.surface_carry(self.character_values[a].0, &sample.a, velocity)
                            }),
                        );
                    }
                }
            }
            self.angular_suffix_rows(time, end, bodies, colliders, characters, work, scratch)?;
            let meta = self
                .character_rows
                .len()
                .checked_mul(std::mem::size_of::<actual_rows::Row>())
                .and_then(|n| {
                    geometry_metadata_bytes(self.character_carry.len(), self.character_rows.len())
                        .ok()
                        .and_then(|meta| n.checked_add(meta))
                })
                .ok_or(TrajectoryError::WorkLimit)?;
            if meta > scratch {
                return Err(TrajectoryError::WorkLimit);
            }
            let projection = self.character_response.solve_with_carry(
                &mut self.character_values,
                &self.character_carry,
                &self.carry_rows,
                &self.character_rows,
                planar,
                work,
                scratch - meta,
            );
            match projection {
                Ok(Some(_)) => {}
                Err(error) => {
                    #[cfg(test)]
                    self.log_response_failure("strict geometry proposal error", hit, time);
                    return Err(error);
                }
                Ok(None) => {
                    #[cfg(test)]
                    self.log_response_failure("suffix row infeasible", hit, time);
                    return Ok(false);
                }
            }
            for ((value, carry), (body, projected)) in self
                .character_values
                .iter()
                .zip(&mut self.character_carry)
                .zip(self.character_response.solved_carry())
            {
                if value.0 != body {
                    return Err(TrajectoryError::InvalidReference);
                }
                *carry = projected;
            }
        }
        Ok(true)
    }

    /// Restore only real instantaneous virtual constraints after a stopped
    /// prescribed driver invalidated a geometry-only endpoint proposal.
    fn rebuild_virtual_rows(
        &mut self,
        safe: Time,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        let contact_count = self
            .contacts
            .len()
            .checked_add(self.active_contacts.len())
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(
            (contact_count as u64)
                .checked_mul(9)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        self.character_rows.clear();
        for sample in self.contacts.iter().chain(
            self.active_contacts
                .iter()
                .filter(|v| v.visible)
                .map(|v| &v.sample),
        ) {
            let slot = |role| match role {
                Role::Character(id) => self
                    .character_values
                    .binary_search_by_key(&id, |v| v.0)
                    .ok(),
                _ => None,
            };
            if let (Some(a), Some(b)) = (slot(sample.a.role), slot(sample.b.role)) {
                self.character_rows.push(actual_rows::Row {
                    a,
                    b: Some(b),
                    normal: -sample.contact.normal1,
                    velocity: rp::Vector::ZERO,
                });
                continue;
            }
            let point = (sample.contact.point1 + sample.contact.point2) * 0.5;
            for (source, other, normal) in [
                (sample.a, sample.b, -sample.contact.normal1),
                (sample.b, sample.a, sample.contact.normal1),
            ] {
                let Role::Character(body) = source.role else {
                    continue;
                };
                if !characters
                    .get(&body)
                    .is_some_and(|r| r.config.push_mass == 0.)
                {
                    continue;
                }
                let a = slot(source.role).ok_or(TrajectoryError::InvalidReference)?;
                let velocity =
                    self.geometric_surface_rate(&other, safe, time, end, point, bodies, work)?;
                self.character_rows.push(actual_rows::Row {
                    a,
                    b: None,
                    normal,
                    velocity,
                });
            }
        }
        Ok(())
    }

    /// A proposal for passive capsule motion against an angular velocity
    /// kinematic, matching the existing controller's endpoint-plane planning.
    /// It uses the actual original kernel endpoint and never approves a curve:
    /// the outer loop must still certify its whole suffix and final placement.
    #[allow(clippy::too_many_arguments)]
    fn angular_suffix_rows(
        &mut self,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        work: &mut Work,
        scratch: usize,
    ) -> Result<(), TrajectoryError> {
        let remaining = end - time;
        if remaining <= 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        work.charge(self.contacts.len() as u64 * 4)?;
        let mut last = None;
        for index in 0..self.contacts.len() {
            let sample = self.contacts[index];
            let pair = (sample.a.collider, sample.b.collider);
            if last == Some(pair) {
                continue;
            }
            last = Some(pair);
            for (source, target) in [(sample.a, sample.b), (sample.b, sample.a)] {
                let Role::Character(body) = source.role else {
                    continue;
                };
                let Some(runtime) = characters.get(&body).filter(|r| r.config.push_mass == 0.)
                else {
                    continue;
                };
                let Some(target_index) = self.entry_index(target.parent) else {
                    continue;
                };
                let target_body = &bodies[self.entries[target_index].value.handle];
                if target_body.body_type() != rp::RigidBodyType::KinematicVelocityBased
                    || self.participants[target_index].angular_velocity == rp::Vector::ZERO
                {
                    continue;
                }
                let actor = self
                    .entry_index(source.parent)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let value = self
                    .character_values
                    .binary_search_by_key(&body, |v| v.0)
                    .map_err(|_| TrajectoryError::InvalidReference)?;
                let velocity = self.character_values[value].1;
                let mut proposed = source.motion;
                proposed.curve = Curve::Integrated(Kernel::from_velocity(
                    self.entries[actor].value.handle,
                    Domain::new(time, end)?,
                    self.entries[actor].curve.com_pose(time),
                    velocity,
                    rp::Vector::ZERO,
                )?);
                let source_shape = colliders
                    .get(source.collider)
                    .ok_or(TrajectoryError::InvalidReference)?
                    .shape();
                let target_shape = colliders
                    .get(target.collider)
                    .ok_or(TrajectoryError::InvalidReference)?
                    .shape();
                // Reuse only the same real leaf's current tight-contact gap;
                // another compound child cannot exempt a new endpoint contact.
                // This remains a proposal, not a clearance certificate.
                let baseline = &self.contacts;
                let source_first = source.collider == sample.a.collider;
                let rows = &mut self.character_rows;
                let character_count = self.character_values.len();
                let tags = &mut self.carry_rows;
                // An endpoint can clear past a finite tip while the curved
                // face still approaches an earlier part of the suffix. These
                // original shape observations only nominate velocity rows.
                let angular_span =
                    self.participants[target_index].angular_velocity.length() as f64 * remaining;
                let fractions: &[Time] = if angular_span >= 0.001 {
                    &[1. / 24., 1.]
                } else {
                    &[1.]
                };
                for &fraction in fractions {
                    let at = if fraction == 1. {
                        end
                    } else {
                        time + remaining * fraction
                    };
                    if at <= time {
                        continue;
                    }
                    crate::physics3d::solver_trajectory::contacts_full_shapes(
                        target.motion,
                        target_shape,
                        proposed,
                        source_shape,
                        at,
                        runtime.config.skin_width,
                        work,
                        &mut |contact, _, _, work| {
                            work.charge(8 + baseline.len() as u64 * 4)?;
                            let desired = baseline
                                .iter()
                                .filter(|old| {
                                    old.a.collider == sample.a.collider
                                        && old.b.collider == sample.b.collider
                                        && if source_first {
                                            old.contact.subshape1 == contact.subshape2
                                                && old.contact.subshape2 == contact.subshape1
                                        } else {
                                            old.contact.subshape1 == contact.subshape1
                                                && old.contact.subshape2 == contact.subshape2
                                        }
                                })
                                .fold(runtime.config.skin_width, |gap, old| {
                                    gap.min(old.contact.dist)
                                });
                            let correction =
                                (f64::from(desired) - f64::from(contact.dist)) / (at - time);
                            if correction <= 0. {
                                return Ok(());
                            }
                            let normal = contact.normal1;
                            let norm = normal.length_squared();
                            if !normal.is_finite()
                                || !norm.is_finite()
                                || norm <= 0.
                                || !correction.is_finite()
                            {
                                return Err(TrajectoryError::NonFinite);
                            }
                            let target =
                                velocity + normal * ((correction / f64::from(norm)) as f32);
                            if !target.is_finite() {
                                return Err(TrajectoryError::NonFinite);
                            }
                            let count = rows
                                .len()
                                .checked_add(1)
                                .filter(|n| *n <= MAX_INTERVALS)
                                .ok_or(TrajectoryError::WorkLimit)?;
                            let metadata = geometry_metadata_bytes(character_count, count)?;
                            if count
                                .checked_mul(std::mem::size_of::<actual_rows::Row>())
                                .and_then(|n| n.checked_add(metadata))
                                .is_none_or(|n| n > scratch)
                            {
                                return Err(TrajectoryError::WorkLimit);
                            }
                            reserve(rows, count)?;
                            reserve(tags, count)?;
                            tags.push(Some(rp::Vector::ZERO)); // A pusher proposal, not support carry or finite J.
                            rows.push(actual_rows::Row {
                                a: value,
                                b: None,
                                normal,
                                velocity: target,
                            });
                            Ok(())
                        },
                    )?;
                }
            }
        }
        Ok(())
    }

    /// Preserve a support attachment only while the same actual ground witness
    /// remains walkable and the response has not separated the rider from it.
    /// The resulting suffix is still passed through the full continuous scene.
    fn retained_support_suffix(
        &self,
        index: usize,
        time: Time,
        hit_time: Time,
        bodies: &rp::RigidBodySet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        work: &mut Work,
    ) -> Result<Option<(Curve, rp::Vector)>, TrajectoryError> {
        let entry = self.entries[index];
        let id = identity(entry.value.handle);
        let Some(runtime) = characters.get(&id) else {
            return Ok(None);
        };
        let Some(support) = entry.support else {
            return Ok(None);
        };
        if runtime.state.vertical_speed > 0.
            || !bodies
                .get(support)
                .is_some_and(|b| b.is_enabled() && (b.is_dynamic() || b.is_kinematic()))
        {
            return Ok(None);
        }
        let lookup = usize::BITS - self.entries.len().max(1).leading_zeros();
        work.charge(self.contacts.len() as u64 * 4 + u64::from(lookup) * 3 + 16)?;
        let up = rp::Vector::from(runtime.config.up);
        let Some(carrier_index) = self.entry_index(Some(support)) else {
            return Ok(None);
        };
        let Curve::Integrated(carrier) = self.entries[carrier_index].curve else {
            return Ok(None);
        };
        let (anchor, rotation) = match entry.curve {
            Curve::Anchored {
                anchor, rotation, ..
            } => (anchor, rotation),
            Curve::Constant { pose, .. } => (
                self.physical_support_anchor(entry, bodies, work)?,
                pose.rotation,
            ),
            _ => return Ok(None),
        };
        let row = self
            .character_values
            .binary_search_by_key(&id, |v| v.0)
            .ok();
        let geometry = row.map_or(self.participants[index].linear_velocity, |i| {
            self.character_values[i].1
        });
        let base = carrier.position_at_time(hit_time);
        let carried = carrier.linear_velocity_at_time()
            + carrier
                .angular_velocity_at_time(hit_time)
                .cross(base.rotation * anchor);
        let relative = geometry - carried;
        let physical_carry = self.actual_carrier_rate(entry, hit_time, bodies, work)?;
        let physical_relative = self.participants[index].linear_velocity - physical_carry;
        let mut supported = false;
        for sample in &self.contacts {
            let normal = if sample.a.parent == Some(entry.value.handle)
                && sample.b.parent == Some(support)
            {
                Some(-sample.contact.normal1)
            } else if sample.b.parent == Some(entry.value.handle)
                && sample.a.parent == Some(support)
            {
                Some(sample.contact.normal1)
            } else {
                None
            };
            let Some(normal) = normal else {
                continue;
            };
            if normal.dot(up) < runtime.config.max_slope_angle.cos() - 1e-5
                || relative.dot(normal) > 0.
            {
                continue;
            }
            let separating = physical_relative.dot(normal);
            if !separating.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            let unrepresented = if separating > 0. {
                work.charge(64)?;
                let squared = normal.length_squared();
                let rate = normal * (separating / squared);
                let (logical_start, logical_end) = entry.curve.times();
                // Anchored relative_dt uses the original logical domain,
                // independently of the carrier's physical integration h.
                // Bound both clocks; the post-add proof does not infer one
                // clock from the other or replace a Native velocity kernel.
                let logical_seconds = (logical_end - logical_start) as f32;
                let max_addition_seconds = entry
                    .original
                    .integration_seconds
                    .max(carrier.native.integration_seconds)
                    .max(logical_seconds);
                if !squared.is_finite()
                    || squared <= 0.
                    || !rate.is_finite()
                    || !logical_seconds.is_finite()
                    || logical_seconds <= 0.
                    || !max_addition_seconds.is_finite()
                    || max_addition_seconds <= 0.
                {
                    return Err(TrajectoryError::NonFinite);
                }
                // Support lifetime only: this additive normal displacement
                // has no represented COM output over the remaining actual
                // interval. Physical momentum/J are left intact. This neither
                // claims a (velocity+rate) Native-kernel equivalence nor admits
                // a suffix; all continuous and endpoint guards still run.
                crate::physics3d::solver_trajectory::linear_com_addition_invisible(
                    entry.curve,
                    rate,
                    time,
                    carrier.domain.end,
                    max_addition_seconds,
                    work,
                )?
            } else {
                false
            };
            if separating <= 0. || unrepresented {
                supported = true;
                break;
            }
        }
        if !supported {
            return Ok(None);
        }
        // An independent contact can consume the entire horizontal carry.
        // Hold the safe world pose directly: adding platform travel and its
        // opposite in F32 can otherwise move the rider across the same wall.
        if geometry == rp::Vector::ZERO
            && row.is_some_and(|i| self.character_carry.get(i) == Some(&rp::Vector::ZERO))
            && runtime.config.push_mass == 0.
            && bodies[support].is_kinematic()
            && carrier.native.angular_velocity == rp::Vector::ZERO
            && carried != rp::Vector::ZERO
            && carried.dot(up) == 0.
            && self.independent_carry_opponent(
                entry.value.handle,
                support,
                carried,
                -carried,
                time,
                hit_time,
                carrier.domain.end,
                bodies,
                work,
            )?
        {
            return Ok(Some((
                Curve::Constant {
                    pose: entry.curve.com_pose(time),
                    start_time: time,
                    end_time: carrier.domain.end,
                },
                relative,
            )));
        }
        if let Curve::Anchored {
            carrier: original,
            linear_velocity,
            ..
        } = entry.curve
        {
            if representable::same_kernel(original, carrier)
                && curve_velocity(entry.curve, hit_time)?.0 == geometry
            {
                // A validated unchanged attachment already owns its exact
                // add/rounding phase. Do not erase it by inverse subtraction.
                return Ok(Some((entry.curve, linear_velocity)));
            }
        }
        let pose = entry.curve.com_pose(time);
        let at = carrier.position_at_time(time);
        let anchor_world = at.translation + at.rotation * anchor;
        let relative_dt = relative * (time - carrier.domain.start) as f32;
        let offset = if matches!(entry.curve, Curve::Constant { .. }) {
            // Reattaching a held rider must reproduce its last safe pose.
            work.charge(128)?;
            let Some(fitted) =
                representable::fit_offset(anchor_world, relative_dt, pose.translation)
            else {
                return Ok(None);
            };
            fitted
        } else {
            pose.translation - anchor_world - relative_dt
        };
        Ok(Some((
            Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity: relative,
                rotation,
            },
            relative,
        )))
    }

    fn refresh_anchors(
        &mut self,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        work.charge(self.entries.len() as u64)?;
        for index in 0..self.entries.len() {
            let entry = self.entries[index];
            let Some(support) = entry.support else {
                continue;
            };
            let Some(carrier_index) = self.entry_index(Some(support)) else {
                return Err(TrajectoryError::MissingBodyMotion);
            };
            if matches!(entry.curve, Curve::Constant { .. }) {
                // This world-space hold has no geometric carrier dependency.
                continue;
            }
            if matches!(self.entries[carrier_index].curve, Curve::Constant { .. }) {
                let Curve::Anchored {
                    linear_velocity, ..
                } = entry.curve
                else {
                    return Err(TrajectoryError::InvalidReference);
                };
                let pose = entry.curve.com_pose(time);
                let target = self
                    .accepted
                    .len()
                    .checked_add(1)
                    .filter(|n| *n <= MAX_INTERVALS)
                    .ok_or(TrajectoryError::WorkLimit)?;
                work.charge(1)?;
                reserve(&mut self.accepted, target)?;
                self.stage_curve(entry, entry.domain_start, time, bodies, work)?;
                let suffix = if linear_velocity == rp::Vector::ZERO {
                    Curve::Constant {
                        pose,
                        start_time: time,
                        end_time: end,
                    }
                } else {
                    Curve::Integrated(Kernel::from_velocity(
                        entry.value.handle,
                        Domain::new(time, end)?,
                        pose,
                        linear_velocity,
                        rp::Vector::ZERO,
                    )?)
                };
                let rider = &mut self.entries[index];
                rider.curve = suffix;
                rider.domain_start = time;
                rider.support = None;
                rider.momentum_carry = rp::Vector::ZERO;
                rider.value.end = suffix.com_pose(end);
                if let Ok(origin) = self
                    .origins
                    .binary_search_by_key(&identity(entry.value.handle), |o| o.body)
                {
                    self.origins[origin].support = None;
                    self.origins[origin].momentum_carry = rp::Vector::ZERO;
                }
                continue;
            }
            let Curve::Integrated(carrier) = self.entries[carrier_index].curve else {
                return Err(TrajectoryError::InvalidReference);
            };
            let Curve::Anchored {
                carrier: old,
                anchor,
                linear_velocity,
                rotation,
                ..
            } = entry.curve
            else {
                return Err(TrajectoryError::InvalidReference);
            };
            if old.domain().start == carrier.domain().start
                && old.domain().end == carrier.domain().end
                && old.native.motion.start == carrier.native.motion.start
                && old.native.integration_seconds == carrier.native.integration_seconds
                && old.native.motion.end == carrier.native.motion.end
                && old.native.linear_velocity == carrier.native.linear_velocity
                && old.native.angular_velocity == carrier.native.angular_velocity
            {
                continue;
            }
            let pose = entry.curve.com_pose(time);
            if time > entry.domain_start {
                if self.accepted.len() == MAX_INTERVALS {
                    return Err(TrajectoryError::WorkLimit);
                }
                self.accepted
                    .try_reserve(1)
                    .map_err(|_| TrajectoryError::WorkLimit)?;
                self.stage_curve(entry, entry.domain_start, time, bodies, work)?;
            }
            let base = carrier.position_at_time(time);
            self.entries[index].curve = Curve::Anchored {
                carrier,
                anchor,
                offset: pose.translation
                    - (base.translation + base.rotation * anchor)
                    - linear_velocity * (time - carrier.domain.start) as f32,
                linear_velocity,
                rotation,
            };
            self.entries[index].domain_start = time;
            self.entries[index].value.end = self.entries[index].curve.com_pose(end);
        }
        Ok(())
    }

    fn eligible(
        &self,
        a: &ColliderTrajectory,
        b: &ColliderTrajectory,
        bodies: &rp::RigidBodySet,
        continuous: bool,
    ) -> bool {
        // An immobile kinematic floor can enter the mixed set solely because
        // it supports a rider. It transmits no motion between the rider and
        // unrelated rigid bodies resting elsewhere on that floor. Native owns
        // their contact; character, promoted and CCD sweeps still run.
        if [(a, b), (b, a)].into_iter().any(|(platform, other)| {
            if platform.role != Role::Prescribed
                || !matches!(other.role, Role::Dynamic | Role::SleepingDynamic)
            {
                return false;
            }
            let (Some(base), Some(target)) = (platform.parent, other.parent) else {
                return false;
            };
            let base = identity(base);
            self.mixed.binary_search(&base).is_ok()
                && self.affected.binary_search(&base).is_err()
                && self.promoted.binary_search(&base).is_err()
                && self.prescribed_paths.binary_search(&base).is_err()
                && self.mixed.binary_search(&identity(target)).is_err()
                && !bodies
                    .get(target)
                    .is_some_and(|body| continuous && body.is_ccd_enabled())
                && solver_trajectory::constant_pose(platform.motion.curve).is_some()
        }) {
            return false;
        }
        eligible_pair(
            &self.disabled_pairs,
            &self.mixed,
            &self.prescribed_paths,
            a,
            b,
            bodies,
            continuous,
            false,
        )
    }

    fn stage_curve(
        &mut self,
        entry: Entry,
        start: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        if start >= end {
            return Ok(());
        }
        if self.accepted.len() == self.accepted.capacity() || self.accepted.len() == MAX_INTERVALS {
            return Err(TrajectoryError::WorkLimit);
        }
        work.charge(u64::from(usize::BITS - self.origins.len().max(1).leading_zeros()) + 12)?;
        let id = identity(entry.value.handle);
        if let Ok(index) = self.origins.binary_search_by_key(&id, |o| o.body) {
            let mut transport = entry.carry_correction * (end - start) as f32;
            let attributed = entry.carry_correction != rp::Vector::ZERO || entry.support.is_some();
            if let Curve::Anchored { carrier, .. } = entry.curve {
                if entry.support.is_some() {
                    let anchor = self.physical_support_anchor(entry, bodies, work)?;
                    let from = carrier.position_at_time(start);
                    let to = carrier.position_at_time(end);
                    transport += (to.translation + to.rotation * anchor)
                        - (from.translation + from.rotation * anchor);
                }
            }
            let value = self.origins[index].carry + transport;
            if !value.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            self.origins[index].carry = value;
            self.origins[index].anchored |= attributed;
        }
        self.accepted.push(AcceptedCurve {
            body: entry.value.handle,
            curve: entry.curve,
            start_time: start,
            end_time: end,
        });
        Ok(())
    }

    fn append_prefix(
        &mut self,
        time: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        work.charge(self.entries.len() as u64)?;
        if self
            .accepted
            .len()
            .checked_add(self.entries.len())
            .is_none_or(|n| n > MAX_INTERVALS)
        {
            return Err(TrajectoryError::WorkLimit);
        }
        let target = self
            .accepted
            .len()
            .checked_add(self.entries.len())
            .ok_or(TrajectoryError::WorkLimit)?;
        reserve(&mut self.accepted, target)?;
        for index in 0..self.entries.len() {
            let entry = self.entries[index];
            self.stage_curve(entry, entry.domain_start, time, bodies, work)?;
        }
        Ok(())
    }

    fn stop_pressure_kinematics(
        &mut self,
        time: Time,
        hit: actual_scene::Hit,
        threshold: f32,
        bodies: &rp::RigidBodySet,
        planar: bool,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let hit_time = hit.cast.hit_time;
        let scoped = self.virtual_pressure_component(hit, bodies, planar, work)?;
        let contact_count = self
            .contacts
            .len()
            .checked_add(self.active_contacts.len())
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(
            (contact_count as u64)
                .checked_mul(
                    (self.character_rows.len() as u64)
                        .checked_add(2)
                        .ok_or(TrajectoryError::WorkLimit)?,
                )
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        let mut stopped = false;
        // Validated active geometry can be the opposing driver that made
        // these simultaneous planes infeasible. Stop only its prescribed
        // participant through the existing pressure policy; never replay J.
        for sample in self.contacts.iter().chain(
            self.active_contacts
                .iter()
                .filter(|v| v.visible)
                .map(|v| &v.sample),
        ) {
            let target = match (sample.a.role, sample.b.role) {
                (Role::Character(_), Role::Prescribed) => sample.b.parent,
                (Role::Prescribed, Role::Character(_)) => sample.a.parent,
                _ => None,
            };
            let Some(index) = self.entry_index(target) else {
                continue;
            };
            if scoped
                && self
                    .promotions
                    .binary_search(&identity(self.entries[index].value.handle))
                    .is_err()
            {
                continue;
            }
            let p = &mut self.participants[index];
            if p.linear_velocity != rp::Vector::ZERO || p.angular_velocity != rp::Vector::ZERO {
                #[cfg(test)]
                authored_platform_stop_trace(false, "pressure_kinematics", format_args!(
                    "safe={time:.18e} hit={hit_time:.18e} body={:?} before={p:?} original={:?} current={:?} curve={:?} pair={:?}/{:?} contact={:?} rows={}",
                    self.entries[index].value.handle, self.entries[index].original,
                    self.entries[index].value, self.entries[index].curve,
                    sample.a.collider, sample.b.collider, sample.contact, self.character_rows.len()));
                p.linear_velocity = rp::Vector::ZERO;
                p.angular_velocity = rp::Vector::ZERO;
                self.entries[index].stopped_at = Some(time);
                stopped = true;
            }
        }
        if stopped {
            self.reset_stopped_plan(hit_time, threshold, bodies, work)?;
            for row in &mut self.character_rows {
                if row.b.is_some() {
                    continue;
                }
                let body = self.character_values[row.a].0;
                if scoped && self.promotions.binary_search(&body).is_err() {
                    continue;
                }
                for sample in self.contacts.iter().chain(
                    self.active_contacts
                        .iter()
                        .filter(|v| v.visible)
                        .map(|v| &v.sample),
                ) {
                    let normal = match (sample.a.role, sample.b.role) {
                        (Role::Character(id), Role::Prescribed) if id == body => {
                            -sample.contact.normal1
                        }
                        (Role::Prescribed, Role::Character(id)) if id == body => {
                            sample.contact.normal1
                        }
                        _ => continue,
                    };
                    if normal.dot(row.normal) > 1. - 1e-5 {
                        row.velocity = rp::Vector::ZERO;
                    }
                }
            }
        }
        Ok(stopped)
    }

    fn reset_stopped_plan(
        &mut self,
        time: Time,
        threshold: f32,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        work.charge((self.entries.len() + self.rows.len()) as u64)?;
        self.row_impulses.fill(0.);
        for entry in &mut self.entries {
            entry.response_geometry_delta = rp::Vector::ZERO;
            entry.response_geometry_credit = entry.geometry_credit;
        }
        if self.rows.is_empty() {
            work.charge(2 * self.entries.len() as u64)?;
            if self.entries.iter().all(|entry| entry.support.is_none()) {
                // The virtual solve only changes linear velocity. With no
                // physical rows or supports, the hit-time seed already holds
                // the original linear and angular rates for every live entry.
                for (entry, p) in self.entries.iter().zip(&mut self.participants) {
                    if entry.stopped_at.is_some() {
                        p.linear_velocity = rp::Vector::ZERO;
                        p.angular_velocity = rp::Vector::ZERO;
                    } else {
                        p.linear_velocity = entry.momentum_before;
                    }
                }
                return Ok(());
            }
        }
        for index in 0..self.entries.len() {
            work.charge(u64::from(usize::BITS - self.origins.len().max(1).leading_zeros()) + 16)?;
            let original = self.entries[index];
            let origin = self
                .origins
                .binary_search_by_key(&identity(original.value.handle), |o| o.body)
                .ok()
                .map(|i| self.origins[i]);
            let stopped_support = original.support.is_some_and(|support| {
                self.entry_index(Some(support))
                    .is_some_and(|i| self.entries[i].stopped_at.is_some())
            });
            let baseline = if original.stopped_at.is_some() {
                physical_momentum::State::new(rp::Vector::ZERO, rp::Vector::ZERO)?
            } else if origin.is_some() {
                work.charge(512)?;
                physical_momentum::State::from_curve(original.curve, time)?
            } else {
                self.native_physical_seed(original, time, bodies, work)?
            };
            let entry = &mut self.entries[index];
            let p = &mut self.participants[index];
            if entry.stopped_at.is_some() {
                p.linear_velocity = rp::Vector::ZERO;
                p.angular_velocity = rp::Vector::ZERO;
            } else if origin.is_some_and(|o| o.finite_mass) {
                if stopped_support {
                    entry.momentum_before -= entry.momentum_carry;
                    entry.momentum_carry = rp::Vector::ZERO;
                }
                p.linear_velocity = entry.momentum_before;
                p.angular_velocity = baseline.angular;
            } else {
                // The previous anchored rate still includes the stopped
                // carrier. Keep the rider's own motion in the next solve.
                p.linear_velocity = match original.curve {
                    Curve::Anchored {
                        linear_velocity, ..
                    } if stopped_support => linear_velocity,
                    _ => baseline.linear,
                };
                p.angular_velocity = baseline.angular;
            }
        }
        let velocity = |p: &Participant, point: rp::Vector| {
            p.linear_velocity + p.angular_velocity.cross(point - p.pose.translation)
        };
        for ((row, restitution), source) in self
            .rows
            .iter_mut()
            .zip(&self.row_restitution)
            .zip(&mut self.row_sources)
        {
            let target = row.b.map_or(row.target_velocity, |b| {
                velocity(&self.participants[b], row.point)
            });
            let approach =
                (velocity(&self.participants[row.a], row.point) - target).dot(row.normal);
            if let Some(source) = source {
                source.approach_speed = (-approach).max(0.);
            }
            row.minimum_velocity = if approach < -threshold {
                -approach * restitution
            } else {
                0.
            };
        }
        Ok(())
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    fn response_at(
        &mut self,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        planar: bool,
        restitution_threshold: f32,
        work: &mut Work,
        scratch: usize,
    ) -> Result<(), TrajectoryError> {
        self.response_at_reusing(
            hit,
            time,
            end,
            bodies,
            colliders,
            characters,
            planar,
            restitution_threshold,
            work,
            scratch,
            false,
            None,
        )
        .map(|_| ())
    }

    #[allow(clippy::too_many_arguments)]
    fn response_at_reusing(
        &mut self,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        planar: bool,
        restitution_threshold: f32,
        work: &mut Work,
        scratch: usize,
        repeated_adjacent: bool,
        mut memo: Option<&mut actual_scene::PairQueries<'_>>,
    ) -> Result<Time, TrajectoryError> {
        let isolated_component = self.isolate_virtual_hit_component(hit, bodies, work)?;
        let origin_log = if self.origins.is_empty() {
            0
        } else {
            usize::BITS - self.origins.len().leading_zeros()
        };
        work.charge(
            (self.entries.len() as u64)
                .checked_mul(u64::from(origin_log) + 1)
                .and_then(|n| n.checked_add(1))
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        // A support-free virtual component cannot consume disconnected
        // participant poses or finite momentum. Keep the slots/rates for the
        // original iterative solver's ordering and actor count.
        let support_free = if isolated_component {
            work.charge(self.entries.len() as u64)?;
            self.entries.iter().all(|entry| entry.support.is_none())
        } else {
            false
        };
        let component_lookup =
            u64::from(usize::BITS - self.promotions.len().max(1).leading_zeros());
        reserve(&mut self.participants, self.entries.len())?;
        self.participants.clear();
        for index in 0..self.entries.len() {
            let value = self.entries[index];
            let id = identity(value.value.handle);
            if support_free {
                work.charge(component_lookup + 1)?;
                if self.promotions.binary_search(&id).is_err()
                    && !characters.get(&id).is_some_and(|r| r.config.push_mass > 0.)
                {
                    let rate = match value.curve {
                        Curve::Constant { .. } => Some(rp::Vector::ZERO),
                        Curve::Integrated(k)
                            if k.native.angular_velocity.to_array().map(f32::to_bits) == [0; 3] =>
                        {
                            Some(k.linear_velocity_at_time())
                        }
                        _ => None,
                    };
                    if let Some(rate) = rate {
                        work.charge(32)?;
                        if !rate.is_finite() {
                            return Err(TrajectoryError::NonFinite);
                        }
                        let entry = &mut self.entries[index];
                        entry.momentum_before = rate;
                        entry.response_geometry_delta = rp::Vector::ZERO;
                        entry.response_geometry_credit = entry.geometry_credit;
                        self.participants.push(Participant {
                            body: id,
                            pose: value.value.end,
                            linear_velocity: rate,
                            angular_velocity: rp::Vector::ZERO,
                            mass: MassPolicy::Native,
                        });
                        continue;
                    }
                }
            }
            work.charge(512)?;
            let physical_carry =
                self.baseline_support_rate(value, hit.cast.hit_time, bodies, work)?;
            let entry = &mut self.entries[index];
            let geometric = physical_momentum::State::from_curve(entry.curve, hit.cast.hit_time)?;
            let physical = if characters.get(&id).is_some_and(|r| r.config.push_mass > 0.) {
                let origin = self
                    .origins
                    .binary_search_by_key(&id, |o| o.body)
                    .map_err(|_| TrajectoryError::InvalidReference)?;
                // A geometry-only reference is not a ground attachment and
                // never creates physical carry or external momentum.
                if entry.support.is_some() && matches!(entry.curve, Curve::Anchored { .. }) {
                    entry.momentum_carry = physical_carry;
                }
                let origin = &self.origins[origin];
                physical_momentum::State::new(
                    origin.relative_momentum
                        + entry.momentum_carry
                        + origin.velocity_delta
                        + entry.velocity_delta,
                    geometric.angular,
                )?
            } else if characters.contains_key(&id) {
                geometric
            } else {
                physical_momentum::participant_seed(
                    bodies
                        .get(entry.value.handle)
                        .ok_or(TrajectoryError::InvalidReference)?,
                    entry.value,
                    geometric,
                )?
            };
            if !physical.linear.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            entry.momentum_before = physical.linear;
            entry.response_geometry_delta = rp::Vector::ZERO;
            entry.response_geometry_credit = entry.geometry_credit;
            self.participants.push(Participant {
                // The witness/inertia use the actual hit pose. Character
                // momentum is independent of its skin-limited target's rate.
                body: id,
                pose: entry.curve.com_pose(hit.cast.hit_time),
                linear_velocity: physical.linear,
                angular_velocity: physical.angular,
                mass: characters
                    .get(&id)
                    .filter(|r| r.config.push_mass > 0.)
                    .map_or(MassPolicy::Native, |r| {
                        MassPolicy::Character(r.config.push_mass)
                    }),
            });
        }
        self.rows.clear();
        self.row_restitution.clear();
        self.row_impulses.clear();
        self.row_sources.clear();
        let impulse_mark = self.impulses.mark();
        self.character_rows.clear();
        self.character_values.clear();
        reserve(&mut self.rows, self.contacts.len())?;
        reserve(&mut self.row_restitution, self.contacts.len())?;
        let source_bytes = self
            .contacts
            .len()
            .checked_mul(
                std::mem::size_of::<Option<crate::physics3d::ContactImpulse>>()
                    + std::mem::size_of::<f32>(),
            )
            .ok_or(TrajectoryError::WorkLimit)?;
        if source_bytes > scratch {
            return Err(TrajectoryError::WorkLimit);
        }
        reserve(&mut self.row_impulses, self.contacts.len())?;
        reserve(&mut self.row_sources, self.contacts.len())?;
        reserve(&mut self.character_rows, self.contacts.len())?;
        reserve(&mut self.character_values, characters.len())?;
        for p in &self.participants {
            if characters.contains_key(&p.body) {
                self.character_values.push((p.body, p.linear_velocity));
            }
        }
        work.charge(
            (self.contacts.len() as u64)
                .checked_mul(9)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        for sample in &self.contacts {
            let normal = -sample.contact.normal1;
            let point = (sample.contact.point1 + sample.contact.point2) * 0.5;
            let ai = self.entry_index(sample.a.parent);
            let bi = self.entry_index(sample.b.parent);
            let va = sample.a.motion.point_velocity(hit.cast.hit_time, point);
            let vb = sample.b.motion.point_velocity(hit.cast.hit_time, point);
            let approach = (va - vb).dot(normal);
            if let (Role::Character(a), Role::Character(b)) = (sample.a.role, sample.b.role) {
                let a = self
                    .character_values
                    .binary_search_by_key(&a, |v| v.0)
                    .map_err(|_| TrajectoryError::InvalidReference)?;
                let b = self
                    .character_values
                    .binary_search_by_key(&b, |v| v.0)
                    .map_err(|_| TrajectoryError::InvalidReference)?;
                self.character_rows.push(actual_rows::Row {
                    a,
                    b: Some(b),
                    normal,
                    velocity: rp::Vector::ZERO,
                });
                continue;
            }
            let zero = |role| matches!(role,Role::Character(id) if characters.get(&id).is_some_and(|r|r.config.push_mass==0.));
            if zero(sample.a.role) || zero(sample.b.role) {
                // No native impulse/wake for push_mass0. All of this
                // character's simultaneous surface planes share one solve.
                for (role, n, velocity) in
                    [(sample.a.role, normal, vb), (sample.b.role, -normal, va)]
                {
                    let Role::Character(body) = role else {
                        continue;
                    };
                    if !characters
                        .get(&body)
                        .is_some_and(|r| r.config.push_mass == 0.)
                    {
                        continue;
                    }
                    let a = self
                        .character_values
                        .binary_search_by_key(&body, |v| v.0)
                        .map_err(|_| TrajectoryError::InvalidReference)?;
                    self.character_rows.push(actual_rows::Row {
                        a,
                        b: None,
                        normal: n,
                        velocity,
                    });
                }
                continue;
            }
            if matches!(
                (sample.a.role, sample.b.role),
                (Role::Prescribed, Role::Fixed | Role::Prescribed)
                    | (Role::Fixed, Role::Prescribed)
            ) {
                if approach < 0. {
                    for index in [ai, bi].into_iter().flatten() {
                        if bodies[self.entries[index].value.handle].is_kinematic() {
                            #[cfg(test)]
                            authored_platform_stop_trace(false, "prescribed_inward", format_args!(
                                "safe={time:.18e} hit={:.18e} end={end:.18e} approach={approach:?} body={:?} original={:?} current={:?} curve={:?} roles={:?}/{:?} pair={:?}/{:?} contact={:?}",
                                hit.cast.hit_time, self.entries[index].value.handle,
                                self.entries[index].original, self.entries[index].value,
                                self.entries[index].curve, sample.a.role, sample.b.role,
                                sample.a.collider, sample.b.collider, sample.contact));
                            self.participants[index].linear_velocity = rp::Vector::ZERO;
                            self.participants[index].angular_velocity = rp::Vector::ZERO;
                            self.entries[index].stopped_at = Some(time);
                        }
                    }
                }
                continue;
            }
            let ca = colliders
                .get(sample.a.collider)
                .ok_or(TrajectoryError::InvalidReference)?;
            let cb = colliders
                .get(sample.b.collider)
                .ok_or(TrajectoryError::InvalidReference)?;
            let physical_velocity = |index: Option<usize>, fallback: rp::Vector| {
                index.map_or(fallback, |i| {
                    let p = &self.participants[i];
                    p.linear_velocity + p.angular_velocity.cross(point - p.pose.translation)
                })
            };
            let physical_a = physical_velocity(ai, va);
            let physical_b = physical_velocity(bi, vb);
            let physical_approach = (physical_a - physical_b).dot(normal);
            if !physical_approach.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            let character = matches!(sample.a.role, Role::Character(_))
                || matches!(sample.b.role, Role::Character(_));
            let restitution = rp::CoefficientCombineRule::combine(
                ca.restitution(),
                cb.restitution(),
                ca.restitution_combine_rule(),
                cb.restitution_combine_rule(),
            );
            let minimum = if !character && physical_approach < -restitution_threshold {
                -physical_approach * restitution
            } else {
                0.
            };
            if !minimum.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            let (a, b, n, target) = match (ai, bi) {
                (Some(a), b) => (a, b, normal, physical_b),
                (None, Some(b)) => (b, None, -normal, physical_a),
                (None, None) => continue,
            };
            self.row_impulses.push(0.);
            self.rows.push(actual_impulse::Row {
                a,
                b,
                point,
                normal: n,
                target_velocity: target,
                minimum_velocity: minimum,
            });
            self.row_restitution
                .push(if character { 0. } else { restitution });
            let physical_approach = (physical_a - physical_b)
                .dot(sample.contact.normal1)
                .max(0.);
            self.row_sources.push(
                crate::physics3d::events::collider_ref(sample.a.collider, ca)
                    .zip(crate::physics3d::events::collider_ref(
                        sample.b.collider,
                        cb,
                    ))
                    .map(|(first, second)| crate::physics3d::ContactImpulse {
                        first,
                        second,
                        categories: (ca.collision_groups().memberships
                            | cb.collision_groups().memberships)
                            .bits(),
                        point: point.to_array(),
                        normal: sample.contact.normal1.to_array(),
                        normal_impulse: 0.,
                        tangent_impulse: [0.; 3],
                        approach_speed: physical_approach,
                    }),
            );
        }
        let point_velocity = |p: &Participant, point: rp::Vector| {
            p.linear_velocity + p.angular_velocity.cross(point - p.pose.translation)
        };
        let mut feasible = false;
        // Reuse both existing bounded kernels. Their shared work ledger limits
        // alternating mixed virtual/native contact plans; no response escapes
        // until every simultaneous normal row is feasible together.
        for _ in 0..64 {
            if !self.rows.is_empty() {
                if let Err(error) = self.response.solve(
                    bodies,
                    &mut self.participants,
                    &self.rows,
                    planar,
                    work,
                    scratch,
                ) {
                    if error == TrajectoryError::Unresolved
                        && self.stop_pressure_kinematics(
                            time,
                            hit,
                            restitution_threshold,
                            bodies,
                            planar,
                            work,
                        )?
                    {
                        self.impulses.rewind(impulse_mark)?;
                        continue;
                    }
                    #[cfg(test)]
                    self.log_response_failure("physical solve", hit, time);
                    return Err(error);
                }
                if self.response.solved_row_impulses().len() != self.row_sources.len() {
                    return Err(TrajectoryError::InvalidReference);
                }
                let entry_log = u64::from(usize::BITS - self.entries.len().max(1).leading_zeros());
                work.charge(
                    (self.rows.len() as u64)
                        .checked_mul(64 + 2 * entry_log)
                        .ok_or(TrajectoryError::WorkLimit)?,
                )?;
                for (body_a, model_a, body_b) in self.response.solved_row_linear_contributions() {
                    for (body, model) in [Some((body_a, model_a)), body_b].into_iter().flatten() {
                        let index = self
                            .entries
                            .binary_search_by_key(&body, |entry| identity(entry.value.handle))
                            .map_err(|_| TrajectoryError::InvalidReference)?;
                        if !matches!(self.participants[index].mass, MassPolicy::Character(_)) {
                            continue;
                        }
                        let entry = &mut self.entries[index];
                        let (credit, _) =
                            settle_geometry_credit(entry.response_geometry_credit, model)?;
                        entry.response_geometry_credit = credit;
                    }
                }
                work.charge(self.row_impulses.len() as u64)?;
                for ((source, total), impulse) in self
                    .row_sources
                    .iter()
                    .zip(&mut self.row_impulses)
                    .zip(self.response.solved_row_impulses())
                {
                    *total += impulse;
                    if !total.is_finite() {
                        return Err(TrajectoryError::NonFinite);
                    }
                    if impulse > 0. {
                        if let Some(source) = source {
                            let mut value = source.clone();
                            value.normal_impulse = impulse;
                            self.impulses.push(value, work, scratch)?;
                        }
                    }
                }
            }
            if !self.character_rows.is_empty() {
                for value in &mut self.character_values {
                    let index = self
                        .participants
                        .binary_search_by_key(&value.0, |p| p.body)
                        .map_err(|_| TrajectoryError::InvalidReference)?;
                    value.1 = self.participants[index].linear_velocity;
                }
                if let Err(error) = self.character_response.solve(
                    &mut self.character_values,
                    &self.character_rows,
                    planar,
                    work,
                    scratch,
                ) {
                    if error == TrajectoryError::Unresolved
                        && self.stop_pressure_kinematics(
                            time,
                            hit,
                            restitution_threshold,
                            bodies,
                            planar,
                            work,
                        )?
                    {
                        self.impulses.rewind(impulse_mark)?;
                        continue;
                    }
                    #[cfg(test)]
                    self.log_response_failure("zero/equal mass solve", hit, time);
                    return Err(error);
                }
                for p in &mut self.participants {
                    if let Ok(index) = self.character_values.binary_search_by_key(&p.body, |v| v.0)
                    {
                        p.linear_velocity = self.character_values[index].1;
                    }
                }
            }
            feasible = self.rows.iter().all(|row| {
                let target = row.b.map_or(row.target_velocity, |b| {
                    point_velocity(&self.participants[b], row.point)
                });
                (point_velocity(&self.participants[row.a], row.point) - target).dot(row.normal)
                    >= row.minimum_velocity - 1e-5
            });
            if feasible {
                // A rider whose actual carry is opposed by a solid obstacle stops a
                // prescribed carrier at this certified prefix. Dynamic carriers keep
                // finite native response ownership instead of being frozen as fixed.
                work.charge(self.entries.len() as u64)?;
                let mut rider_stopped = false;
                for index in 0..self.entries.len() {
                    let Some(support) = self.entries[index].support else {
                        continue;
                    };
                    let Some(carrier) = self.entry_index(Some(support)) else {
                        continue;
                    };
                    if self
                        .prescribed_paths
                        .binary_search(&identity(support))
                        .is_err()
                        || !bodies[support].is_kinematic()
                        || self.entries[carrier].stopped_at.is_some()
                    {
                        // Ordinary kinematic targets may move under blocked
                        // riders. Only a registered path stops with its rider.
                        continue;
                    }
                    let before = curve_velocity(self.entries[index].curve, hit.cast.hit_time)?.0;
                    let delta = self.participants[index].linear_velocity - before;
                    let carried = match self.entries[index].curve {
                        Curve::Anchored {
                            linear_velocity, ..
                        } => before - linear_velocity,
                        _ => rp::Vector::ZERO,
                    };
                    if delta.dot(carried) < -1e-7
                        && self.independent_carry_opponent(
                            self.entries[index].value.handle,
                            support,
                            carried,
                            delta,
                            time,
                            hit.cast.hit_time,
                            end,
                            bodies,
                            work,
                        )?
                    {
                        #[cfg(test)]
                        authored_platform_stop_trace(false, "opposed_rider", format_args!(
                            "safe={time:.18e} hit={:.18e} end={end:.18e} rider={:?} carrier={support:?} before={before:?} delta={delta:?} carried={carried:?} original={:?} current={:?} curve={:?} contact={:?}",
                            hit.cast.hit_time, self.entries[index].value.handle,
                            self.entries[carrier].original, self.entries[carrier].value,
                            self.entries[carrier].curve, hit.cast.contact));
                        self.participants[carrier].linear_velocity = rp::Vector::ZERO;
                        self.participants[carrier].angular_velocity = rp::Vector::ZERO;
                        self.entries[carrier].stopped_at = Some(time);
                        rider_stopped = true;
                    }
                }

                if rider_stopped {
                    self.reset_stopped_plan(
                        hit.cast.hit_time,
                        restitution_threshold,
                        bodies,
                        work,
                    )?;
                    self.impulses.rewind(impulse_mark)?;
                    feasible = false;
                    continue;
                }
                let project = self.project_character_suffix(
                    hit, time, end, bodies, colliders, characters, planar, work, scratch,
                );
                let feasible_suffix = match project {
                    Ok(feasible) => feasible,
                    Err(TrajectoryError::Unresolved)
                        if self.rows.is_empty()
                            && uncoupled_character(characters, &hit.a, &hit.b) =>
                    {
                        work.charge(4 * self.contacts.len() as u64)?;
                        let blocked = self.contacts.iter().any(|sample| {
                            [(sample.a, sample.b), (sample.b, sample.a)]
                                .into_iter()
                                .any(|(actor, blocker)| {
                                    matches!(actor.role, Role::Character(_))
                                        && (actor.collider == hit.a.collider
                                            || actor.collider == hit.b.collider)
                                        && blocker.role == Role::Fixed
                                })
                        });
                        if !blocked {
                            return Err(TrajectoryError::Unresolved);
                        }
                        // The existing pressure-stop route must still find a
                        // real prescribed driver and recertify the suffix.
                        false
                    }
                    Err(error) => return Err(error),
                };
                if !feasible_suffix {
                    if self.stop_pressure_kinematics(
                        time,
                        hit,
                        restitution_threshold,
                        bodies,
                        planar,
                        work,
                    )? {
                        self.impulses.rewind(impulse_mark)?;
                        self.rebuild_virtual_rows(
                            time,
                            hit.cast.hit_time,
                            end,
                            bodies,
                            characters,
                            work,
                        )?;
                        feasible = false;
                        continue;
                    }
                    return Err(TrajectoryError::Unresolved);
                }
                break;
            }
        }
        if !feasible {
            #[cfg(test)]
            self.log_response_failure("mixed physical/virtual iteration exhausted", hit, time);
            return Err(TrajectoryError::Unresolved);
        }
        let mut changed = false;
        let target = self
            .accepted
            .len()
            .checked_add(self.entries.len())
            .ok_or(TrajectoryError::WorkLimit)?;
        if target > MAX_INTERVALS {
            return Err(TrajectoryError::WorkLimit);
        }
        reserve(&mut self.accepted, target)?;
        // An isolated component contains kinematics only. This response
        // cannot add an affected Native dynamic to the feedback ledger.
        if !isolated_component {
            let affected_target = self
                .affected
                .len()
                .checked_add(self.entries.len())
                .ok_or(TrajectoryError::WorkLimit)?;
            work.charge(
                (self.entries.len() as u64)
                    .checked_mul(affected_target as u64 + 1)
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            reserve(&mut self.affected, affected_target)?;
        }
        // Rebase actual carrier kernels before dependent anchored riders. This
        // changes only the suffix representation, never the momentum solve.
        work.charge(self.entries.len() as u64)?;
        for character in [false, true] {
            for index in 0..self.entries.len() {
                let previous = self.entries[index];
                let p = self.participants[index];
                if isolated_component && self.promotions.binary_search(&p.body).is_err() {
                    continue;
                }
                if characters.contains_key(&p.body) != character {
                    continue;
                }
                if !character {
                    if self.rows.is_empty() && previous.stopped_at.is_none() {
                        // Only the stopped drivers can have received a change
                        // during a geometry-only response.
                        continue;
                    }
                    if previous.stopped_at == Some(time)
                        && matches!(previous.curve, Curve::Integrated(k) if k.native.angular_velocity != rp::Vector::ZERO)
                        && bodies[previous.value.handle].body_type()
                            == rp::RigidBodyType::KinematicVelocityBased
                        && p.linear_velocity == rp::Vector::ZERO
                        && p.angular_velocity == rp::Vector::ZERO
                    {
                        let pose = previous.curve.com_pose(time);
                        self.stage_curve(previous, previous.domain_start, time, bodies, work)?;
                        let entry = &mut self.entries[index];
                        entry.curve = Curve::Constant {
                            pose,
                            start_time: time,
                            end_time: end,
                        };
                        entry.domain_start = time;
                        entry.value.end = pose;
                        entry.value.linear_velocity = rp::Vector::ZERO;
                        entry.value.angular_velocity = rp::Vector::ZERO;
                        entry.value.keep_integrated_endpoint = true;
                        changed = true;
                        continue;
                    }
                    let before =
                        self.native_physical_seed(previous, hit.cast.hit_time, bodies, work)?;
                    let after = physical_momentum::State::from_participant(&p)?;
                    if before == after {
                        // Preserve original raw values, Kernel and endpoint bits
                        // even when the logical/nlerp derivative differs.
                        continue;
                    }
                    work.charge(512)?;
                    let Some(kernel) = physical_momentum::continuation(
                        previous.value.handle,
                        previous.curve,
                        Domain::new(time, end)?,
                        previous.curve.com_pose(time),
                        before,
                        after,
                    )?
                    else {
                        return Err(TrajectoryError::InvalidReference);
                    };
                    self.stage_curve(previous, previous.domain_start, time, bodies, work)?;
                    if bodies[previous.value.handle].is_dynamic() {
                        if let Err(slot) = self.affected.binary_search(&p.body) {
                            self.affected.insert(slot, p.body);
                        }
                    }
                    let entry = &mut self.entries[index];
                    entry.curve = Curve::Integrated(kernel);
                    entry.domain_start = time;
                    entry.value.end = kernel.position_at_time(end);
                    // Raw solved physical values and geometric endpoint have
                    // different authorities. No derivative-to-raw offset repair.
                    entry.value.linear_velocity = after.linear;
                    entry.value.angular_velocity = after.angular;
                    changed = true;
                    continue;
                }
                let retained = self.retained_support_suffix(
                    index,
                    time,
                    hit.cast.hit_time,
                    bodies,
                    characters,
                    work,
                )?;
                let mut geometric = self
                    .character_values
                    .binary_search_by_key(&p.body, |v| v.0)
                    .map_or(p.linear_velocity, |i| self.character_values[i].1);
                let actual_carry = self.geometric_carrier_rate(
                    previous,
                    time,
                    hit.cast.hit_time,
                    end,
                    bodies,
                    work,
                )?;
                let held = matches!(retained, Some((Curve::Constant { .. }, _)));
                let was_held =
                    previous.support.is_some() && matches!(previous.curve, Curve::Constant { .. });
                let correction = if let Ok(value) =
                    self.character_values.binary_search_by_key(&p.body, |v| v.0)
                {
                    self.character_carry[value]
                        - if retained.is_some() && !held {
                            actual_carry
                        } else {
                            rp::Vector::ZERO
                        }
                } else {
                    rp::Vector::ZERO
                };
                let carry_changed = correction != previous.carry_correction;
                let previous_rate = curve_velocity(previous.curve, hit.cast.hit_time)?;
                let hit_participant =
                    [hit.a.parent, hit.b.parent].contains(&Some(previous.value.handle));
                // A zero-mass participant's first, fresh-row solve is virtual.
                // Its temporary value cannot erase an already valid driver
                // phase when the complete current/active row set admits it.
                let keep_driver_phase = hit_participant
                    && !carry_changed
                    && self.retain_driver_phase(
                        index,
                        hit,
                        time,
                        end,
                        bodies,
                        colliders,
                        characters,
                        geometric,
                        previous_rate,
                        planar,
                        work,
                    )?;
                if keep_driver_phase {
                    geometric = previous_rate.0;
                    let value = self
                        .character_values
                        .binary_search_by_key(&p.body, |v| v.0)
                        .map_err(|_| TrajectoryError::InvalidReference)?;
                    self.character_values[value].1 = geometric;
                }
                let unchanged = held == was_held
                    && previous_rate == (geometric, p.angular_velocity)
                    && (p.linear_velocity == previous.momentum_before || keep_driver_phase)
                    && !carry_changed;
                // An unchanged suffix can try the existing evaluation frames.
                // A new passive normal rate can also leave the represented
                // COM fixed. Test its fitted face before publishing a rebase.
                let mut rebased = None;
                // Off-pair anchors still need the existing driver-lifecycle
                // check. First-pair proposals have no authority off the pair.
                let can_propose =
                    hit_participant || matches!(previous.curve, Curve::Anchored { .. });
                let side_phase = if hit_participant
                    && previous.support.is_none()
                    && retained.is_none()
                    && !carry_changed
                    && self.rows.is_empty()
                    && p.angular_velocity == rp::Vector::ZERO
                {
                    self.native_side_face_suffix(
                        index,
                        hit,
                        time,
                        end,
                        bodies,
                        colliders,
                        characters,
                        geometric,
                        planar,
                        work,
                        memo.as_deref_mut(),
                    )?
                } else {
                    None
                };
                let proposal = if side_phase.is_some() {
                    side_phase
                } else if unchanged && !keep_driver_phase && can_propose {
                    let proposal = self.representable_suffix_reusing(
                        index,
                        hit,
                        time,
                        end,
                        bodies,
                        colliders,
                        characters,
                        geometric,
                        work,
                        planar,
                        memo.as_deref_mut(),
                    )?;
                    if proposal.is_some() || !hit_participant {
                        proposal
                    } else {
                        self.clock_phase_suffix(
                            index, hit, time, end, bodies, colliders, characters, geometric,
                            planar, work,
                        )?
                    }
                } else if !unchanged
                    && previous.support.is_none()
                    && retained.is_none()
                    && self.rows.is_empty()
                    && matches!(previous.curve, Curve::Integrated(_))
                    && p.angular_velocity == rp::Vector::ZERO
                {
                    let own = Kernel::from_velocity(
                        previous.value.handle,
                        Domain::new(time, end)?,
                        previous.curve.com_pose(time),
                        geometric,
                        p.angular_velocity,
                    )?;
                    rebased = Some(own);
                    if hit_participant {
                        self.stationary_face_suffix(
                            index,
                            hit,
                            time,
                            end,
                            bodies,
                            colliders,
                            characters,
                            geometric,
                            rebased,
                            planar,
                            work,
                            memo.as_deref_mut(),
                        )?
                    } else {
                        None
                    }
                } else {
                    None
                };
                if let Some(proposal) = proposal {
                    // Record the actual derivative of this geometry-only
                    // expression. Physical participants and transport tags
                    // stay unchanged; this virtual choice is not a new seed.
                    geometric = proposal.rate;
                    let value = self
                        .character_values
                        .binary_search_by_key(&p.body, |v| v.0)
                        .map_err(|_| TrajectoryError::InvalidReference)?;
                    self.character_values[value].1 = geometric;
                }
                // Republishing the same Native descriptor at the same
                // logical time cannot advance a virtual response.
                let identical_zero_mass_rebase = matches!((previous.curve, rebased),
                        (Curve::Integrated(old), Some(new)) if representable::same_kernel(old, new))
                    && !carry_changed
                    && previous.domain_start.to_bits() == time.to_bits()
                    && p.linear_velocity.to_array().map(f32::to_bits)
                        == previous.value.linear_velocity.to_array().map(f32::to_bits)
                    && p.angular_velocity.to_array().map(f32::to_bits)
                        == previous.value.angular_velocity.to_array().map(f32::to_bits)
                    && characters
                        .get(&p.body)
                        .is_some_and(|r| r.config.push_mass == 0.);
                if proposal.is_none() && (unchanged || identical_zero_mass_rebase) {
                    // Preserve the original kernel and endpoint bits of every
                    // participant untouched by this response. Rebasing its curve
                    // would change an unrelated body's normalized rotation law.
                    continue;
                }
                let safe_pose = previous.curve.com_pose(time);
                self.stage_curve(previous, previous.domain_start, time, bodies, work)?;
                let entry = &mut self.entries[index];
                if let Some(runtime) = characters.get(&p.body) {
                    if runtime.config.push_mass > 0. {
                        entry.velocity_delta += p.linear_velocity - entry.momentum_before;
                    }
                    for sample in &self.contacts {
                        let touches_a = sample.a.parent == Some(entry.value.handle);
                        let touches_b = sample.b.parent == Some(entry.value.handle);
                        if touches_a || touches_b {
                            let other = if touches_a {
                                sample.b.role
                            } else {
                                sample.a.role
                            };
                            entry.blocked_character |= matches!(other, Role::Character(_));
                            entry.blocked_moving |= !matches!(other, Role::Character(_));
                            let toward = if touches_a {
                                -sample.contact.normal1
                            } else {
                                sample.contact.normal1
                            };
                            entry.hit_ceiling |=
                                toward.dot(rp::Vector::from(runtime.config.up)) < -0.01;
                        }
                    }
                }
                changed = true;
                if let Some(proposal) = proposal {
                    entry.curve = proposal.curve;
                    entry.value.keep_integrated_endpoint = true;
                    entry.carry_correction = correction;
                } else if let Some((curve, _)) = retained {
                    entry.curve = curve;
                    entry.support = previous.support;
                    entry.carry_correction = correction;
                } else {
                    entry.curve = Curve::Integrated(match rebased {
                        Some(kernel) => kernel,
                        None => Kernel::from_velocity(
                            entry.value.handle,
                            Domain::new(time, end)?,
                            safe_pose,
                            geometric,
                            p.angular_velocity,
                        )?,
                    });
                    entry.support = None;
                    entry.carry_correction = correction;
                    if let Ok(origin) = self.origins.binary_search_by_key(&p.body, |o| o.body) {
                        self.origins[origin].support = None;
                    }
                }
                entry.domain_start = time;
                entry.value.end = entry.curve.com_pose(end);
                entry.value.linear_velocity = p.linear_velocity;
                entry.value.angular_velocity = p.angular_velocity;
            }
        }
        if !changed {
            if self.passive_adjacent_cell(hit, time, end, colliders, characters, false, work)? {
                return Ok(hit.cast.hit_time);
            }
            changed = self.angular_grazing_response(
                hit, time, end, bodies, colliders, characters, planar, work, scratch,
            )?;
        }
        if !changed {
            #[cfg(test)]
            self.log_response_failure("unchanged suffix", hit, time);
            return Err(TrajectoryError::Unresolved);
        }
        self.refresh_anchors(time, end, bodies, work)?;
        self.verify_selected_geometry_rows(work)?;
        work.charge(self.entries.len() as u64)?;
        for entry in &mut self.entries {
            entry.geometry_delta += entry.response_geometry_delta;
            entry.geometry_credit = entry.response_geometry_credit;
            entry.response_geometry_delta = rp::Vector::ZERO;
            if !entry.geometry_delta.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
        }
        if repeated_adjacent
            && self.passive_adjacent_cell(hit, time, end, colliders, characters, true, work)?
        {
            return Ok(hit.cast.hit_time);
        }
        Ok(time)
    }

    #[allow(clippy::too_many_arguments)]
    fn passive_adjacent_cell(
        &self,
        hit: actual_scene::Hit,
        time: Time,
        end: Time,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        rebased: bool,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let next = hit.cast.hit_time;
        if !self.rows.is_empty()
            || hit.cast.contact.dist <= 0.
            || next != time.next_up()
            || next >= end
        {
            return Ok(false);
        }
        let passive = [(hit.a, hit.b), (hit.b, hit.a)]
            .into_iter()
            .any(|(driver, actor)| {
                matches!(driver.role, Role::Fixed | Role::Prescribed)
                    && (!rebased || driver.role == Role::Prescribed)
                    && matches!(actor.role, Role::Character(id)
                        if characters.get(&id).is_some_and(|r| r.config.push_mass == 0.))
            });
        if !passive {
            return Ok(false);
        }
        let mut prior = None;
        for sample in &self.contacts {
            work.charge(1)?;
            let pair = (sample.a.collider, sample.b.collider);
            if prior == Some(pair) {
                continue;
            }
            prior = Some(pair);
            let a = colliders
                .get(pair.0)
                .ok_or(TrajectoryError::InvalidReference)?;
            let b = colliders
                .get(pair.1)
                .ok_or(TrajectoryError::InvalidReference)?;
            if rebased {
                work.charge(2048)?;
                // Replacing the descriptor is not clock progress if both
                // represented poses are unchanged. Only that already observed
                // adjacent cell can use the same zero-skin check below.
                for source in [sample.a, sample.b] {
                    if let Some(i) = self.entry_index(source.parent) {
                        let new = ShapeMotion {
                            curve: self.entries[i].curve,
                            ..source.motion
                        };
                        if ![time, next]
                            .into_iter()
                            .all(|at| same_pose_bits(source.motion.pose(at), new.pose(at)))
                        {
                            return Ok(false);
                        }
                    }
                }
            }
            if solver_trajectory::cast_full_shapes(
                sample.a.motion,
                a.shape(),
                sample.b.motion,
                b.shape(),
                time,
                next,
                0.,
                next - time,
                work,
            )?
            .is_some()
            {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

pub(in crate::physics3d) struct BackendEvents<'a> {
    pub collector: &'a EventCollector,
    pub characters: &'a BTreeMap<BodyId, CharacterRuntime>,
    pub policies: &'a ContactPolicies,
    pub scratch: Mutex<&'a mut BackendMotionScratch>,
    pub max_scratch: usize,
    pub restitution_threshold: f32,
    pub controller_seconds: f32,
    pub logical_domain: Domain,
    pub continuous: bool,
    pub contact_error: f32,
    pub path_clearance: f32,
    pub has_sensors: bool,
}

impl BackendEvents<'_> {
    fn finalize_native_ccd(
        &self,
        context: &dyn SolverMotionContext,
        params: &rp::IntegrationParameters,
        output: &mut rp::SolverCcdPlan,
        s: &mut BackendMotionScratch,
    ) -> Result<SolverMotionDecision, TrajectoryError> {
        let mut work = Work {
            used: s.used,
            limit: super::trajectory::MAX_PROOF_WORK,
        };
        #[cfg(test)]
        let mut diagnostic_stage = "census";
        let result = (|| {
            let marker = s.pass_marker.ok_or(TrajectoryError::InvalidReference)?;
            if !matches!(s.trace.get(marker), Some(Trace::Pass { .. })) {
                return Err(TrajectoryError::InvalidReference);
            }
            let pass_domain =
                Domain::new(context.precise_start_time(), context.precise_end_time())?;
            if pass_domain.duration() <= 0. {
                return Err(TrajectoryError::InvalidTime);
            }
            let count = s.trace.len() - marker - 1;
            work.charge(count as u64)?;
            reserve(&mut s.ccd_source, count)?;
            s.ccd_source.clear();
            for event in &s.trace[marker + 1..] {
                if let Trace::Curve { actual, .. } = event {
                    s.ccd_source.push(*actual);
                }
            }
            let log = usize::BITS - s.ccd_source.len().max(1).leading_zeros();
            work.charge(
                (s.ccd_source.len() as u64)
                    .checked_mul(8 * (u64::from(log) + 1))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            s.ccd_source.sort_unstable_by(|a, b| {
                a.body
                    .into_raw_parts()
                    .cmp(&b.body.into_raw_parts())
                    .then(a.start_time.total_cmp(&b.start_time))
                    .then(a.end_time.total_cmp(&b.end_time))
            });
            // Timeline records retain their existing independent interval cap;
            // their typed layouts are distinct from body-count geometry scratch.
            let records = s
                .ccd_source
                .len()
                .checked_add(context.body_count())
                .filter(|n| *n <= MAX_INTERVALS)
                .ok_or(TrajectoryError::WorkLimit)?;
            let timeline_bytes = records
                .checked_mul(
                    2 * std::mem::size_of::<AcceptedCurve>() + std::mem::size_of::<Trace>(),
                )
                .ok_or(TrajectoryError::WorkLimit)?;
            let scratch = s
                .active_remaining(self.max_scratch)?
                .saturating_add(timeline_bytes);
            s.promotions.clear();
            #[cfg(test)]
            {
                diagnostic_stage = "native_ccd::plan";
            }
            match super::native_ccd::plan(
                context,
                params,
                self.policies,
                self.characters,
                &s.ccd_source,
                &s.mixed,
                &s.disabled_pairs,
                output,
                &mut s.promotions,
                &mut work,
                scratch,
            )? {
                super::native_ccd::PlanStatus::Promote => {
                    if !s.request_promotions(&mut work)? {
                        return Err(TrajectoryError::Unresolved);
                    }
                    return Ok(SolverMotionDecision::Rejected);
                }
                super::native_ccd::PlanStatus::Approved => {}
            }
            #[cfg(test)]
            {
                diagnostic_stage = "native_ccd::clip_curves";
            }
            super::native_ccd::clip_curves(
                output,
                &s.ccd_source,
                &mut s.ccd_clipped,
                &mut work,
                scratch,
            )?;
            let bodies = context.body_count();
            let log = usize::BITS - bodies.max(1).leading_zeros();
            work.charge(
                (bodies as u64)
                    .checked_mul(8 * (u64::from(log) + 1) + output.clamps.len() as u64)
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            reserve(&mut s.final_origins, bodies)?;
            s.final_origins.clear();
            for slot in 0..bodies {
                let value = context
                    .body(slot)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let body = context
                    .bodies()
                    .get(value.handle)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let end = output
                    .clamps
                    .iter()
                    .find(|cut| cut.body == value.handle)
                    .map_or(value.end, |cut| cut.end);
                s.final_origins.push((
                    identity(value.handle),
                    end.prepend_translation(-body.local_center_of_mass()),
                ));
            }
            s.final_origins.sort_unstable_by_key(|p| p.0);
            if self.has_sensors {
                s.sensors.begin_pass();
                #[cfg(test)]
                {
                    diagnostic_stage = "final-sensor-coverage";
                }
                s.sensors.plan_interval(
                    context.bodies(),
                    context.colliders(),
                    self.policies,
                    self.characters,
                    &s.ccd_clipped,
                    pass_domain.start,
                    pass_domain.end,
                    Some(&s.final_origins),
                    &mut work,
                    scratch,
                    &|a, b| {
                        super::native_ccd::sensor_pair(
                            context,
                            params,
                            self.policies,
                            a,
                            b,
                            &s.mixed,
                            &s.disabled_pairs,
                        )
                    },
                )?;
            }
            let crossings = if self.has_sensors {
                s.sensors.crossings().count()
            } else {
                0
            };
            let new_count = s
                .ccd_clipped
                .len()
                .checked_add(crossings)
                .ok_or(TrajectoryError::WorkLimit)?;
            let full_count = marker
                .checked_add(1)
                .and_then(|n| n.checked_add(new_count))
                .and_then(|n| n.checked_add(output.clamps.len()))
                .filter(|n| *n <= MAX_INTERVALS)
                .ok_or(TrajectoryError::WorkLimit)?;
            // Prepay lookup/rewriting, later callback pushes and every crossing.
            work.charge(
                (s.ccd_clipped.len() as u64)
                    .checked_mul(count as u64 + 1)
                    .and_then(|n| n.checked_add((new_count + output.clamps.len()) as u64))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            reserve(&mut s.ccd_trace, new_count)?;
            reserve(&mut s.trace, full_count)?;
            reserve(&mut output.crossings, crossings)?;
            output.crossings.clear();
            s.ccd_trace.clear();
            let observer = |time: Time| -> Result<f32, TrajectoryError> {
                for event in &s.trace[marker + 1..] {
                    if let Trace::Curve {
                        actual,
                        observer_start,
                        observer_end,
                    } = event
                    {
                        if time == actual.start_time {
                            return Ok(*observer_start);
                        }
                        if time == actual.end_time {
                            return Ok(*observer_end);
                        }
                        if time > actual.start_time && time < actual.end_time {
                            let fraction = ((time - actual.start_time)
                                / (actual.end_time - actual.start_time))
                                as f32;
                            return Ok(observer_start + fraction * (observer_end - observer_start));
                        }
                    }
                }
                Err(TrajectoryError::MissingBodyMotion)
            };
            for &actual in &s.ccd_clipped {
                s.ccd_trace.push(Trace::Curve {
                    observer_start: observer(actual.start_time)?,
                    observer_end: observer(actual.end_time)?,
                    actual,
                });
            }
            if self.has_sensors {
                for (moving, target) in s.sensors.crossings() {
                    output
                        .crossings
                        .push(rp::SolverCcdCrossing { moving, target });
                    s.ccd_trace.push(Trace::Sensor(moving, target));
                }
            }
            // All fallible geometry/allocation is complete. Final worker approval
            // still precedes persistent impulses and body writeback.
            s.trace.truncate(marker + 1);
            s.trace.append(&mut s.ccd_trace);
            if let Trace::Pass {
                actual_duration, ..
            } = &mut s.trace[marker]
            {
                *actual_duration = pass_domain.duration();
            }
            s.prepared_clamps_left = output.clamps.len();
            Ok(SolverMotionDecision::Approved)
        })();
        #[cfg(test)]
        if let Err(error) = &result {
            eprintln!("C12_STAGE case={:?} phase=final stage={diagnostic_stage} raw={error:?} work={}/{} committed={} proposals={} entries={} accepted={}",
                std::thread::current().name(),work.used,work.limit,s.committed_seconds,
                s.proposals.len(),s.entries.len(),s.accepted.len());
        }
        s.used = work.used;
        if !matches!(result, Ok(SolverMotionDecision::Approved)) {
            output.covered = false;
            output.clamps.clear();
            output.crossings.clear();
        }
        result
    }

    fn resolve_backend_interval(
        &self,
        context: &mut dyn SolverMotionContext,
        s: &mut BackendMotionScratch,
    ) -> Result<SolverMotionDecision, TrajectoryError> {
        if let Some(error) = s.error {
            return Err(error);
        }
        let start = context.precise_start_time();
        let end = context.precise_end_time();
        if !start.is_finite() || !end.is_finite() || start >= end {
            return Err(TrajectoryError::InvalidTime);
        }
        let count = context.body_count();
        let mut work = Work {
            used: s.used,
            limit: super::trajectory::MAX_PROOF_WORK,
        };
        #[cfg(test)]
        let mut diagnostic_stage = "census";
        #[cfg(test)]
        let diagnostic_interval_work_start = work.used;
        #[cfg(test)]
        let mut diagnostic_query_count = 0_u64;
        #[cfg(test)]
        let mut diagnostic_query_work = 0_u64;
        #[cfg(test)]
        let mut diagnostic_response_count = 0_u64;
        s.active_contacts.clear();
        let result = (|| {
            let log = if count == 0 {
                0
            } else {
                usize::BITS - count.leading_zeros()
            } as u64;
            work.charge(
                (count as u64)
                    .checked_mul(8 * (log + 1))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            reserve(&mut s.entries, count)?;
            reserve(&mut s.trajectories, count)?;
            reserve(&mut s.publish, count)?;
            s.entries.clear();
            s.accepted.clear();
            s.publish.clear();
            s.proposals
                .sort_unstable_by_key(|m| m.motion.body.into_raw_parts());
            if s.proposals.len() != count {
                return Err(TrajectoryError::MissingBodyMotion);
            }
            for slot in 0..count {
                let value = context
                    .body(slot)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let index = s
                    .proposals
                    .binary_search_by_key(&value.handle.into_raw_parts(), |m| {
                        m.motion.body.into_raw_parts()
                    })
                    .map_err(|_| TrajectoryError::MissingBodyMotion)?;
                let curve = s.proposals[index];
                if curve.motion.start_time != context.start_time()
                    || curve.motion.end_time != context.end_time()
                    || !curve.motion.start.is_finite()
                    || !curve.motion.end.is_finite()
                    || !curve.linear_velocity.is_finite()
                    || !curve.angular_velocity.is_finite()
                    || !curve.integration_seconds.is_finite()
                    || curve.integration_seconds <= 0.
                    || curve.motion.end != value.end
                {
                    return Err(TrajectoryError::InvalidReference);
                }
                let mut value = value;
                let saved_stop = s
                    .stops
                    .binary_search_by_key(&identity(value.handle), |v| v.0)
                    .ok()
                    .map(|i| s.stops[i].1)
                    .filter(|at| *at <= start);
                let frozen = saved_stop.is_some()
                    && context.bodies()[value.handle].body_type()
                        == rp::RigidBodyType::KinematicVelocityBased
                    && value.angular_velocity == rp::Vector::ZERO
                    && value.linear_velocity == rp::Vector::ZERO
                    && curve.angular_velocity == rp::Vector::ZERO
                    && curve.linear_velocity == rp::Vector::ZERO;
                let motion = if frozen {
                    let pose = curve.motion.start;
                    value.end = pose;
                    value.keep_integrated_endpoint = true;
                    Curve::Constant {
                        pose,
                        start_time: start,
                        end_time: end,
                    }
                } else {
                    Curve::Integrated(Kernel::from_native(curve, Domain::new(start, end)?)?)
                };
                s.entries.push(Entry {
                    slot,
                    value,
                    curve: motion,
                    domain_start: start,
                    original: curve,
                    support: None,
                    velocity_delta: rp::Vector::ZERO,
                    momentum_before: rp::Vector::ZERO,
                    carry_correction: rp::Vector::ZERO,
                    geometry_delta: rp::Vector::ZERO,
                    geometry_credit: s
                        .origins
                        .binary_search_by_key(&identity(value.handle), |o| o.body)
                        .ok()
                        .map_or(rp::Vector::ZERO, |i| s.origins[i].geometry_credit),
                    response_geometry_delta: rp::Vector::ZERO,
                    response_geometry_credit: rp::Vector::ZERO,
                    momentum_carry: s
                        .origins
                        .binary_search_by_key(&identity(value.handle), |o| o.body)
                        .ok()
                        .map_or(rp::Vector::ZERO, |i| s.origins[i].momentum_carry),
                    blocked_moving: false,
                    blocked_character: false,
                    hit_ceiling: false,
                    stopped_at: if frozen { saved_stop } else { None },
                });
            }
            s.entries
                .sort_unstable_by_key(|e| e.value.handle.into_raw_parts());
            if s.entries
                .windows(2)
                .any(|p| p[0].value.handle == p[1].value.handle)
            {
                return Err(TrajectoryError::InvalidReference);
            }
            #[cfg(test)]
            {
                diagnostic_stage = "anchor";
            }
            s.anchor_characters(
                self.characters,
                context.bodies(),
                context.colliders(),
                self.controller_seconds,
                &mut work,
            )?;
            finite_coasting::align(s, self.characters, &mut work)?;
            let mut time = start;
            // One borrowed immutable Native context is the entire memo epoch.
            // Body/shape/policy publication cannot occur while these borrows
            // are live. Changed private curves still invalidate exact keys.
            let mut pair_queries =
                actual_scene::PairQueries::new(context.colliders(), self.policies, start, end)?;
            pair_queries.set_reserve_hint(s.last_pair_count);
            let mut unclassified_bodies = None;
            let mut previous_scan = None;
            let mut previous_bracket = None;
            loop {
                s.trajectories.clear();
                s.trajectories
                    .extend(s.entries.iter().map(|e| BodyTrajectory {
                        body: e.value.handle,
                        curve: e.curve,
                    }));
                #[cfg(test)]
                {
                    diagnostic_stage = "scene.prepare";
                }
                let mut scene_scratch = pair_queries.fit_for_scene(
                    s.active_remaining(self.max_scratch)?,
                    context.colliders().len(),
                    &mut work,
                )?;
                if previous_scan != Some(time) {
                    scene_scratch = scene_scratch
                        .checked_sub(pair_queries.restore_scan(&s.replay_pairs, time, &mut work)?)
                        .ok_or(TrajectoryError::WorkLimit)?;
                }
                s.scene.prepare_cached(
                    context.bodies(),
                    context.colliders(),
                    &s.trajectories,
                    self.characters,
                    time,
                    end,
                    scene_scratch,
                    &mut work,
                    &mut s.scene_bounds,
                )?;
                let max_clearance = self
                    .characters
                    .values()
                    .map(|r| r.config.skin_width)
                    .fold(self.path_clearance, f32::max);
                #[cfg(test)]
                {
                    diagnostic_stage = "scene.first_hit";
                }
                let mut path_casts = 0_u32;
                let mut path_failures = 0_u32;
                let mut observed_path = false;
                let scan_work_start = work.used;
                #[cfg(test)]
                let diagnostic_query_work_start = work.used;
                #[cfg(test)]
                {
                    diagnostic_query_count += 1;
                }
                let hit = s.scene.first_hit_memoized_policy(
                    context.colliders(),
                    self.policies,
                    time,
                    end,
                    max_clearance,
                    // Preserve the original context's f32 tolerance bits;
                    // only the absolute clock and bracket authority are widened.
                    Time::from(
                        ((context.end_time() - context.start_time()) * 1e-6).max(f32::MIN_POSITIVE),
                    ),
                    &mut work,
                    &|a, b| {
                        if a.sensor || b.sensor {
                            s.sensor_path_pair(a, b)
                        } else {
                            s.eligible(a, b, context.bodies(), self.continuous)
                        }
                    },
                    &|a, b| {
                        if a.sensor || b.sensor {
                            actual_scene::PairClearance::Distance(self.path_clearance)
                        } else {
                            pair_clearance_policy(self.characters, &s.origins, a, b)
                        }
                    },
                    &|origin| s.sweeps_origin_sensor(origin),
                    &mut |a, b, event, work| {
                        match event {
                            actual_scene::QueryEvent::Cast => {
                                let related = |collider: &ColliderTrajectory| {
                                    collider.parent.is_some_and(|handle| {
                                        let body = identity(handle);
                                        s.prescribed_paths.binary_search(&body).is_ok()
                                            || s.origins
                                                .binary_search_by_key(&body, |o| o.body)
                                                .ok()
                                                .and_then(|i| s.origins[i].support)
                                                .is_some_and(|(support, _)| {
                                                    s.prescribed_paths
                                                        .binary_search(&support)
                                                        .is_ok()
                                                })
                                    })
                                };
                                let lookup = usize::BITS - s.origins.len().max(1).leading_zeros();
                                work.charge(u64::from(lookup) * 2 + 16)?;
                                observed_path = related(a) || related(b);
                                if observed_path {
                                    path_casts = path_casts.saturating_add(1);
                                }
                            }
                            actual_scene::QueryEvent::Failure => {
                                if observed_path {
                                    path_failures = path_failures.saturating_add(1);
                                }
                            }
                        }
                        Ok(())
                    },
                    &mut pair_queries,
                    Some(&s.scene_bounds),
                    self.contact_error,
                    &s.active_contacts,
                );
                // Complete scans can be reused when a promotion replays the
                // immutable geometry of this Native interval.
                const REPLAY_SCAN_WORK: u64 = 192 * 1024;
                if matches!(hit, Ok(Some(_))) && work.used - scan_work_start >= REPLAY_SCAN_WORK {
                    // Replaying a scan is useful only when Native can still
                    // acquire a new consumer. Every live non-fixed body in a
                    // fully classified pure kinematic scene already has one.
                    let possible = if let Some(possible) = unclassified_bodies {
                        possible
                    } else {
                        let bodies = context.bodies();
                        let log = usize::BITS - s.mixed.len().max(1).leading_zeros();
                        work.charge(bodies.motion_storage_slots() as u64 * (u64::from(log) + 4))?;
                        let possible = bodies.iter().any(|(handle, body)| {
                            body.is_enabled()
                                && !body.is_fixed()
                                && (!body.is_kinematic()
                                    || s.mixed.binary_search(&identity(handle)).is_err())
                        });
                        unclassified_bodies = Some(possible);
                        possible
                    };
                    if possible {
                        pair_queries.remember_scan(&mut s.replay_pairs, time, &mut work)?;
                    }
                }
                previous_scan = Some(time);
                #[cfg(test)]
                {
                    diagnostic_query_work += work.used - diagnostic_query_work_start;
                    if diagnostic_response_flow_case() && diagnostic_query_count <= 257 {
                        let observed = hit.as_ref().map(|hit| {
                            hit.as_ref().map(|hit| {
                                (
                                    hit.a.collider,
                                    hit.b.collider,
                                    hit.cast.safe_time,
                                    hit.cast.hit_time,
                                    hit.cast.contact.dist,
                                )
                            })
                        });
                        eprintln!("C79_FIRST_HIT case={:?} context=[{start:.18e},{end:.18e}] query={diagnostic_query_count} time={time:.18e} result={observed:?} work_start={diagnostic_query_work_start} work_end={} spent={} cumulative_query_work={diagnostic_query_work} responses={diagnostic_response_count} pair_memo={:?}",
                            std::thread::current().name(), work.used, work.used-diagnostic_query_work_start, pair_queries.diagnostics());
                    } else if diagnostic_response_flow_case() && diagnostic_query_count == 258 {
                        eprintln!("C79_TRACE_LIMIT case={:?} context=[{start:.18e},{end:.18e}] kind=first_hit limit=257",
                            std::thread::current().name());
                    }
                }
                s.path_casts = s.path_casts.saturating_add(path_casts);
                s.path_failures = s.path_failures.saturating_add(path_failures);
                let Some(hit) = hit? else {
                    s.append_prefix(end, context.bodies(), &mut work)?;
                    break;
                };
                if hit.a.sensor || hit.b.sensor {
                    #[cfg(test)]
                    {
                        diagnostic_stage = "sensor-path-stop";
                    }
                    s.stop_sensor_path(hit, hit.cast.safe_time, end, context.bodies(), &mut work)?;
                    time = hit.cast.safe_time;
                    continue;
                }
                let sleeper = [hit.a, hit.b]
                    .into_iter()
                    .find(|c| c.role == Role::SleepingDynamic);
                if let Some(sleeper) =
                    sleeper.filter(|_| !uncoupled_character(self.characters, &hit.a, &hit.b))
                {
                    s.wake_join = Some(WakeJoin {
                        body: sleeper.parent.ok_or(TrajectoryError::InvalidReference)?,
                        a: hit.a.collider,
                        b: hit.b.collider,
                        safe_time: hit.cast.safe_time,
                        hit_time: hit.cast.hit_time,
                        incoming_a: IncomingMotion::from_motion(hit.a.motion, time),
                        incoming_b: IncomingMotion::from_motion(hit.b.motion, time),
                    });
                    return Ok(SolverMotionDecision::NeedsWakeJoin);
                }
                // A pair outside Native's tier (for example two bullets) is
                // an actual finite interaction even without an earlier motor
                // consumer. Promote its real hit before constructing rows.
                let classified = [hit.a.parent, hit.b.parent]
                    .into_iter()
                    .flatten()
                    .any(|body| s.mixed.binary_search(&identity(body)).is_ok());
                if !classified {
                    work.charge(2)?;
                    reserve(&mut s.promotions, 2)?;
                    s.promotions.clear();
                    for collider in [hit.a, hit.b] {
                        if !matches!(collider.role, Role::Fixed) {
                            if let Some(body) = collider.parent {
                                s.promotions.push(identity(body));
                            }
                        }
                    }
                    if s.request_promotions(&mut work)? {
                        return Ok(SolverMotionDecision::Rejected);
                    }
                    return Err(TrajectoryError::Unresolved);
                }
                s.contacts.clear();
                {
                    let disabled = &s.disabled_pairs;
                    let affected = &s.mixed;
                    let prescribed = &s.prescribed_paths;
                    let remaining = s.active_remaining(self.max_scratch)?;
                    let contacts = &mut s.contacts;
                    let origins = &s.origins;
                    let distance = max_clearance.max(self.contact_error);
                    let eligible = |a: &ColliderTrajectory, b: &ColliderTrajectory| {
                        eligible_pair(
                            disabled,
                            affected,
                            prescribed,
                            a,
                            b,
                            context.bodies(),
                            self.continuous,
                            true,
                        )
                    };
                    let first_pair_emitted = std::cell::Cell::new(false);
                    let mut accept = |sample: actual_scene::ContactSample, work: &mut Work| {
                        let threshold = if matches!(sample.a.role, Role::Character(_))
                            || matches!(sample.b.role, Role::Character(_))
                        {
                            effective_pair_clearance(self.characters, origins, &sample.a, &sample.b)
                        } else {
                            self.contact_error
                        };
                        if sample.contact.dist > threshold {
                            return Ok(());
                        }
                        work.charge(1)?;
                        let bytes = contacts
                            .len()
                            .checked_add(1)
                            .and_then(|n| {
                                n.checked_mul(std::mem::size_of::<actual_scene::ContactSample>())
                            })
                            .ok_or(TrajectoryError::WorkLimit)?;
                        if bytes > remaining || contacts.len() == MAX_INTERVALS {
                            return Err(TrajectoryError::WorkLimit);
                        }
                        contacts
                            .try_reserve(1)
                            .map_err(|_| TrajectoryError::WorkLimit)?;
                        if sample.a.collider == hit.a.collider
                            && sample.b.collider == hit.b.collider
                        {
                            first_pair_emitted.set(true);
                        }
                        contacts.push(sample);
                        Ok(())
                    };
                    #[cfg(test)]
                    {
                        diagnostic_stage = "scene.contacts_at";
                    }
                    s.scene.contacts_at(
                        context.colliders(),
                        self.policies,
                        hit.cast.hit_time,
                        distance,
                        &mut work,
                        &eligible,
                        &mut accept,
                    )?;
                    // The accepted cast already validated this contact at the
                    // same pose and time in the unchanged scene. Round-shape
                    // feature selection in the point census can miss it.
                    if !first_pair_emitted.get() && eligible(&hit.a, &hit.b) {
                        accept(
                            actual_scene::ContactSample {
                                a: hit.a,
                                b: hit.b,
                                contact: hit
                                    .cast
                                    .contact
                                    .with_subshapes(hit.cast.subshape_a, hit.cast.subshape_b),
                            },
                            &mut work,
                        )?;
                    }
                }
                if s.contact_component(&mut work, context.bodies().len())? {
                    return Ok(SolverMotionDecision::Rejected);
                }
                if s.contacts.is_empty() {
                    return Err(TrajectoryError::Unresolved);
                }
                let n = s.contacts.len();
                let log = usize::BITS - n.leading_zeros();
                work.charge(
                    (n as u64)
                        .checked_mul(8 * (u64::from(log) + 1))
                        .ok_or(TrajectoryError::WorkLimit)?,
                )?;
                s.contacts.sort_unstable_by(|a, b| {
                    a.a.collider
                        .into_raw_parts()
                        .cmp(&b.a.collider.into_raw_parts())
                        .then(
                            a.b.collider
                                .into_raw_parts()
                                .cmp(&b.b.collider.into_raw_parts()),
                        )
                        .then(a.contact.subshape1.cmp(&b.contact.subshape1))
                        .then(a.contact.subshape2.cmp(&b.contact.subshape2))
                        .then_with(|| a.contact.point1.x.total_cmp(&b.contact.point1.x))
                        .then_with(|| a.contact.point1.y.total_cmp(&b.contact.point1.y))
                        .then_with(|| a.contact.point1.z.total_cmp(&b.contact.point1.z))
                });
                for sample in &s.contacts {
                    let approach = (sample
                        .b
                        .motion
                        .point_velocity(hit.cast.hit_time, sample.contact.point2)
                        - sample
                            .a
                            .motion
                            .point_velocity(hit.cast.hit_time, sample.contact.point1))
                    .dot(sample.contact.normal1);
                    if approach < 0. && !uncoupled_character(self.characters, &sample.a, &sample.b)
                    {
                        if let Some(sleeper) = [sample.a, sample.b]
                            .into_iter()
                            .find(|c| c.role == Role::SleepingDynamic)
                        {
                            s.wake_join = Some(WakeJoin {
                                body: sleeper.parent.ok_or(TrajectoryError::InvalidReference)?,
                                a: sample.a.collider,
                                b: sample.b.collider,
                                safe_time: hit.cast.safe_time,
                                hit_time: hit.cast.hit_time,
                                incoming_a: IncomingMotion::from_motion(sample.a.motion, time),
                                incoming_b: IncomingMotion::from_motion(sample.b.motion, time),
                            });
                            return Ok(SolverMotionDecision::NeedsWakeJoin);
                        }
                    }
                }
                let next = hit.cast.safe_time;
                if next < time || next >= end {
                    return Err(TrajectoryError::InvalidTime);
                }
                #[cfg(test)]
                let diagnostic_response_work_start = work.used;
                #[cfg(test)]
                {
                    diagnostic_stage = "response_at";
                    diagnostic_response_count += 1;
                    if diagnostic_response_flow_case() && diagnostic_response_count <= 256 {
                        eprintln!("C79_RESPONSE_BEFORE case={:?} context=[{start:.18e},{end:.18e}] response={diagnostic_response_count} previous_time={time:.18e} safe={next:.18e} hit={:.18e} pair={:?}/{:?} work={} curve_a={:?} curve_b={:?}",
                            std::thread::current().name(), hit.cast.hit_time, hit.a.collider, hit.b.collider,
                            work.used, hit.a.motion.curve, hit.b.motion.curve);
                    } else if diagnostic_response_flow_case() && diagnostic_response_count == 257 {
                        eprintln!("C79_TRACE_LIMIT case={:?} context=[{start:.18e},{end:.18e}] kind=response limit=256",
                            std::thread::current().name());
                    }
                    if diagnostic_first_hit_case() && diagnostic_response_count <= 2 {
                        eprintln!("C24_RESPONSE_BEFORE case={:?} context=[{start},{end}] response={diagnostic_response_count} safe={next} hit={} pair={:?}/{:?} work={} previous_geometry={:?}",
                            std::thread::current().name(),hit.cast.hit_time,hit.a.collider,hit.b.collider,
                            work.used,s.character_values);
                        for sample in s.contacts.iter().take(6) {
                            eprintln!("C24_RESPONSE_CONTACT case={:?} response={diagnostic_response_count} pair={:?}/{:?} contact={:?}",
                                std::thread::current().name(),sample.a.collider,sample.b.collider,sample.contact);
                        }
                    }
                }
                s.refresh_active_contacts(
                    hit.cast.hit_time,
                    context.bodies(),
                    context.colliders(),
                    self.characters,
                    self.policies,
                    self.continuous,
                    &mut work,
                )?;
                let response_scratch = s.active_remaining(self.max_scratch)?;
                let bracket = (hit.a.collider, hit.b.collider, next, hit.cast.hit_time);
                let next = s.response_at_reusing(
                    hit,
                    next,
                    end,
                    context.bodies(),
                    context.colliders(),
                    self.characters,
                    self.policies.planar,
                    self.restitution_threshold,
                    &mut work,
                    response_scratch,
                    previous_bracket == Some(bracket),
                    Some(&mut pair_queries),
                )
                .inspect_err(|_error| {
                    #[cfg(test)]
                    {
                        s.log_response_failure("response_at error", hit, next);
                        if diagnostic_response_flow_case() && diagnostic_response_count <= 256 {
                            eprintln!("C79_RESPONSE_ERR case={:?} context=[{start:.18e},{end:.18e}] response={diagnostic_response_count} safe={next:.18e} hit={:.18e} pair={:?}/{:?} error={_error:?} work_start={diagnostic_response_work_start} work_end={} spent={}",
                                std::thread::current().name(), hit.cast.hit_time, hit.a.collider, hit.b.collider,
                                work.used, work.used-diagnostic_response_work_start);
                        }
                    }
                })?;
                s.remember_active_contacts(
                    next,
                    hit.cast.hit_time,
                    context.bodies(),
                    context.colliders(),
                    self.characters,
                    &mut work,
                    self.max_scratch,
                )?;
                #[cfg(test)]
                if diagnostic_first_hit_case() && diagnostic_response_count <= 2 {
                    for active in s.active_contacts.iter().take(6) {
                        eprintln!("C25_ACTIVE_GEOMETRY case={:?} response={diagnostic_response_count} active={active:?}",
                            std::thread::current().name());
                    }
                }
                #[cfg(test)]
                if diagnostic_first_hit_case() && diagnostic_response_count <= 2 {
                    eprintln!("C24_RESPONSE_AFTER case={:?} context=[{start},{end}] response={diagnostic_response_count} work={} candidate_geometry={:?} physical_rows={} geometric_rows={} normal_impulses={:?}",
                        std::thread::current().name(),work.used,s.character_values,
                        s.rows.len(),s.character_rows.len(),&s.row_impulses[..s.row_impulses.len().min(6)]);
                    for (entry, participant) in s.entries.iter().zip(&s.participants).take(3) {
                        eprintln!("C24_RESPONSE_LEDGER case={:?} response={diagnostic_response_count} body={:?} momentum_before={:?} participant_after={:?} physical_delta={:?} curve_after={:?}",
                            std::thread::current().name(),participant.body,entry.momentum_before,
                            participant.linear_velocity,entry.velocity_delta,entry.curve);
                    }
                }
                #[cfg(test)]
                if diagnostic_response_flow_case() && diagnostic_response_count <= 256 {
                    let current = |parent| {
                        s.entries
                            .iter()
                            .find(|entry| Some(entry.value.handle) == parent)
                            .map(|entry| entry.curve)
                    };
                    eprintln!("C79_RESPONSE_AFTER case={:?} context=[{start:.18e},{end:.18e}] response={diagnostic_response_count} next_time={next:.18e} pair={:?}/{:?} work_start={diagnostic_response_work_start} work_end={} spent={} accepted={} physical_rows={} geometric_rows={} active={} curve_a={:?} curve_b={:?}",
                        std::thread::current().name(), hit.a.collider, hit.b.collider,
                        work.used, work.used-diagnostic_response_work_start, s.accepted.len(),
                        s.rows.len(), s.character_rows.len(), s.active_contacts.len(), current(hit.a.parent), current(hit.b.parent));
                }
                previous_bracket =
                    (next == bracket.2 && bracket.3 == next.next_up()).then_some(bracket);
                time = next;
            }
            #[cfg(test)]
            if std::thread::current().name().is_some_and(|name| [
                "physics3d::character_squeeze_tests::more_than_sixteen_independent_external_commands_can_stop_in_one_tick",
                "physics3d::character_coupling_tests::capsule_chain_transmits_fixed_wall_obstruction_back_to_the_prescribed_pusher",
                "physics3d::character_coupling_tests::free_capsule_chain_is_pushed_without_a_false_squeeze_stop",
            ].contains(&name)) {
                eprintln!("A43_PAIR_MEMO case={:?} context=[{start},{end}] hit_entries_bytes={:?} work={}/{}",
                    std::thread::current().name(), pair_queries.diagnostics(), work.used, work.limit);
            }
            s.last_pair_count = pair_queries.observed_pairs();
            pair_queries.finish_scan(&mut s.replay_pairs);
            // The source owners become mutable only after memo provenance and
            // all cached results have left this Native context's query phase.
            drop(pair_queries);
            work.charge(count as u64)?;
            for entry in &mut s.entries {
                if matches!(entry.curve, Curve::Anchored { .. }) {
                    entry.value.end = entry.curve.com_pose(end);
                    let (linear, angular) = curve_velocity(entry.curve, end)?;
                    entry.value.linear_velocity = linear;
                    entry.value.angular_velocity = angular;
                }
                s.publish.push((entry.slot, entry.value));
            }
            s.publish.sort_unstable_by_key(|e| e.0);
            s.final_origins.clear();
            if context.is_last_interval() {
                reserve(&mut s.endpoint_current, s.entries.len())?;
                reserve(&mut s.endpoint_targets, s.entries.len())?;
                reserve(&mut s.endpoint_active, s.entries.len())?;
                s.endpoint_current.clear();
                s.endpoint_targets.clear();
                s.endpoint_active.clear();
                for entry in &s.entries {
                    let body = context
                        .bodies()
                        .get(entry.value.handle)
                        .ok_or(TrajectoryError::InvalidReference)?;
                    let raw = entry
                        .value
                        .end
                        .prepend_translation(-body.local_center_of_mass());
                    let same = entry.value.end.translation.to_array().map(f32::to_bits)
                        == entry
                            .original
                            .motion
                            .end
                            .translation
                            .to_array()
                            .map(f32::to_bits)
                        && entry.value.end.rotation.to_array().map(f32::to_bits)
                            == entry
                                .original
                                .motion
                                .end
                                .rotation
                                .to_array()
                                .map(f32::to_bits)
                        && entry.value.linear_velocity.to_array().map(f32::to_bits)
                            == entry.original.linear_velocity.to_array().map(f32::to_bits)
                        && entry.value.angular_velocity.to_array().map(f32::to_bits)
                            == entry.original.angular_velocity.to_array().map(f32::to_bits);
                    let resolved = context
                        .prescribed_motion_resolved(entry.slot)
                        .ok_or(TrajectoryError::InvalidReference)?
                        || entry.value.keep_integrated_endpoint;
                    let authored = body.body_type() == rp::RigidBodyType::KinematicPositionBased
                        && !resolved
                        && same;
                    let target = if authored { *body.next_position() } else { raw };
                    let changed = raw.translation.to_array().map(f32::to_bits)
                        != target.translation.to_array().map(f32::to_bits)
                        || raw.rotation.to_array().map(f32::to_bits)
                            != target.rotation.to_array().map(f32::to_bits);
                    let id = identity(entry.value.handle);
                    s.endpoint_current.push((id, raw));
                    s.endpoint_targets.push((id, target));
                    s.endpoint_active.push(authored && changed);
                }
                // Placements only move authored->already-certified raw poses.
                // Recheck the remaining candidates after each rejection so two
                // endpoints cannot invalidate each other's final placement.
                loop {
                    work.charge(s.entries.len() as u64)?;
                    let mut changed = false;
                    for index in 0..s.entries.len() {
                        if !s.endpoint_active[index] {
                            continue;
                        }
                        let id = s.endpoint_targets[index].0;
                        match admit_positions(
                            context.bodies(),
                            context.colliders(),
                            self.policies,
                            &s.endpoint_current,
                            &s.endpoint_targets,
                            Some(id),
                            true,
                            self.continuous,
                            self.contact_error,
                            s,
                            &mut work,
                        ) {
                            Ok(()) => {}
                            Err(TrajectoryError::Unresolved) => {
                                #[cfg(test)]
                                authored_platform_stop_trace(false, "endpoint_rejected", format_args!(
                                    "context_start={start:.18e} stop_end={end:.18e} body={id:?} error={:?} original={:?} current={:?} authored_target={:?} raw_current={:?} entry={:?} curve={:?}",
                                    TrajectoryError::Unresolved, s.entries[index].original,
                                    s.entries[index].value, s.endpoint_targets[index].1,
                                    s.endpoint_current[index].1, s.entries[index].value,
                                    s.entries[index].curve));
                                s.endpoint_targets[index].1 = s.endpoint_current[index].1;
                                s.endpoint_active[index] = false;
                                s.entries[index].value.keep_integrated_endpoint = true;
                                s.entries[index].stopped_at = Some(end);
                                changed = true;
                            }
                            Err(error) => return Err(error),
                        }
                    }
                    if !changed {
                        break;
                    }
                }
                let active = s.endpoint_active.iter().filter(|v| **v).count();
                let target = s
                    .accepted
                    .len()
                    .checked_add(active)
                    .filter(|n| *n <= MAX_INTERVALS)
                    .ok_or(TrajectoryError::WorkLimit)?;
                reserve(&mut s.accepted, target)?;
                work.charge(s.entries.len() as u64)?;
                for (index, entry) in s.entries.iter().enumerate() {
                    if s.endpoint_active[index] {
                        let body = &context.bodies()[entry.value.handle];
                        let pose = s.endpoint_targets[index]
                            .1
                            .prepend_translation(body.local_center_of_mass());
                        s.accepted.push(AcceptedCurve {
                            body: entry.value.handle,
                            curve: Curve::Constant {
                                pose,
                                start_time: end,
                                end_time: end,
                            },
                            start_time: end,
                            end_time: end,
                        });
                    }
                }
                s.publish.clear();
                s.publish
                    .extend(s.entries.iter().map(|e| (e.slot, e.value)));
                s.publish.sort_unstable_by_key(|e| e.0);
            }
            // Internal trajectories are needed by the final Native CCD plan
            // even when public step-motion observation is disabled.
            let curve_count = s.accepted.len();
            let target = s
                .trace
                .len()
                .checked_add(curve_count)
                .filter(|n| *n <= MAX_INTERVALS)
                .ok_or(TrajectoryError::WorkLimit)?;
            work.charge(curve_count as u64)?;
            reserve(&mut s.trace, target)?;
            if context.is_last_interval()
                && s.pass_marker
                    .is_some_and(|marker| !matches!(s.trace.get(marker), Some(Trace::Pass { .. })))
            {
                return Err(TrajectoryError::InvalidReference);
            }
            #[cfg(test)]
            {
                diagnostic_stage = "record_feedback";
            }
            s.record_feedback(&mut work)?;
            let remaining = s.active_remaining(self.max_scratch)?;
            s.impulses.seal(end, &mut work, remaining)?;
            #[cfg(test)]
            {
                diagnostic_stage = "write_bodies";
            }
            context
                .write_bodies(&s.publish)
                .map_err(|_| TrajectoryError::NonFinite)?;
            {
                let observer_label = |time: Time| {
                    if time == start {
                        context.start_time()
                    } else if time == end {
                        context.end_time()
                    } else {
                        // Observation only. The actual curve/domain never
                        // consumes this original f32 context-label mapping.
                        let fraction = ((time - start) / (end - start)) as f32;
                        context.start_time()
                            + fraction * (context.end_time() - context.start_time())
                    }
                };
                for &curve in &s.accepted {
                    s.trace.push(Trace::Curve {
                        actual: curve,
                        observer_start: observer_label(curve.start_time),
                        observer_end: observer_label(curve.end_time),
                    });
                }
            }
            if let Some(Trace::Pass {
                actual_duration,
                domain,
                ..
            }) = s
                .pass_marker
                .filter(|_| context.is_last_interval())
                .and_then(|marker| s.trace.get_mut(marker))
            {
                *actual_duration = domain.duration();
            }
            Ok(SolverMotionDecision::Approved)
        })();
        #[cfg(test)]
        if let Err(error) = &result {
            eprintln!("C12_STAGE case={:?} phase=interval stage={diagnostic_stage} raw={error:?} work={}/{} committed={} proposals={} entries={} accepted={} bound_memo={:?}",
                std::thread::current().name(),work.used,work.limit,s.committed_seconds,
                s.proposals.len(),s.entries.len(),s.accepted.len(),s.scene_bounds.diagnostics());
            if diagnostic_first_hit_case() {
                eprintln!("C24_INTERVAL_COST case={:?} context=[{start},{end}] stage={diagnostic_stage} raw={error:?} work_start={diagnostic_interval_work_start} work_end={} query_count={diagnostic_query_count} query_work={diagnostic_query_work} response_attempts={diagnostic_response_count}",
                    std::thread::current().name(),work.used);
            }
        }
        s.used = work.used;
        s.proposals.clear();
        s.active_contacts.clear();
        result
    }
}

impl rp::EventHandler for BackendEvents<'_> {
    fn wants_body_motion(&self) -> bool {
        true
    }
    fn resolves_solver_motion(&self) -> bool {
        true
    }
    fn handle_solver_body_proposal(&self, proposal: SolverBodyIntegration) {
        self.scratch
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .proposal(proposal);
    }
    fn resolve_solver_motion(&self, context: &mut dyn SolverMotionContext) -> SolverMotionDecision {
        let mut scratch = self.scratch.lock().unwrap_or_else(|p| p.into_inner());
        match self.resolve_backend_interval(context, &mut scratch) {
            Ok(decision) => decision,
            Err(error) => {
                scratch.error = Some(error);
                SolverMotionDecision::Rejected
            }
        }
    }
    fn plan_solver_ccd(
        &self,
        context: &dyn SolverMotionContext,
        params: &rp::IntegrationParameters,
        plan: &mut rp::SolverCcdPlan,
    ) -> SolverMotionDecision {
        let mut scratch = self.scratch.lock().unwrap_or_else(|p| p.into_inner());
        match self.finalize_native_ccd(context, params, plan, &mut scratch) {
            Ok(decision) => decision,
            Err(error) => {
                scratch.fail(error);
                SolverMotionDecision::Rejected
            }
        }
    }
    fn handle_prepared_ccd_clamp(
        &self,
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        cutoff_time: f64,
        duration: f64,
    ) {
        let mut scratch = self.scratch.lock().unwrap_or_else(|p| p.into_inner());
        // Exact callback count and capacity were prepaid by the final plan.
        // Post-writeback observation performs no fallible work or allocation.
        debug_assert!(
            scratch.prepared_clamps_left > 0 && scratch.trace.len() < scratch.trace.capacity()
        );
        if scratch.prepared_clamps_left > 0 && scratch.trace.len() < scratch.trace.capacity() {
            scratch.prepared_clamps_left -= 1;
            scratch.trace.push(Trace::PreparedClamp {
                body,
                start,
                end,
                cutoff: cutoff_time,
                duration,
            });
        }
    }
    fn solver_motion_step_domain(&self, _duration: f32) -> (Time, Time) {
        (self.logical_domain.start, self.logical_domain.end)
    }
    fn handle_body_motion_pass_started(&self, duration: f32) {
        self.handle_body_motion_pass_domain_started(duration, 0., Time::from(duration));
    }
    fn handle_body_motion_pass_domain_started(&self, duration: f32, start: Time, end: Time) {
        let mut scratch = self.scratch.lock().unwrap_or_else(|p| p.into_inner());
        scratch.begin_pass();
        let domain = match Domain::new(start, end) {
            Ok(domain) if domain.duration() > 0. && duration.is_finite() && duration > 0. => domain,
            _ => {
                scratch.fail(TrajectoryError::InvalidTime);
                return;
            }
        };
        let marker = scratch.trace.len();
        scratch.trace(Trace::Pass {
            observer_duration: duration,
            domain,
            actual_duration: 0.,
        });
        if scratch.trace.len() == marker + 1 {
            scratch.pass_marker = Some(marker);
        }
    }
    fn handle_body_motion_clamped(
        &self,
        body: rp::RigidBodyHandle,
        start: rp::Pose,
        end: rp::Pose,
        sweep: &rapier3d::parry::query::sweep_toi::Sweep,
        fraction: f32,
    ) {
        if self.collector.wants_body_motion() {
            self.scratch
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .trace(Trace::Clamp {
                    body,
                    start,
                    end,
                    sweep: *sweep,
                    fraction,
                });
        }
    }
    fn handle_collision_event(
        &self,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        event: rp::CollisionEvent,
        pair: Option<&rp::ContactPair>,
    ) {
        self.collector
            .handle_collision_event(bodies, colliders, event, pair);
    }
    fn handle_contact_force_event(
        &self,
        dt: f32,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        pair: &rp::ContactPair,
        magnitude: f32,
    ) {
        self.collector
            .handle_contact_force_event(dt, bodies, colliders, pair, magnitude);
    }
    fn handle_soft_body_tear_event(&self, bodies: &rp::SoftBodySet, event: &rp::SoftBodyTearEvent) {
        self.collector.handle_soft_body_tear_event(bodies, event);
    }
}

impl PhysicsWorld3d {
    #[cfg(test)]
    pub(crate) fn diagnostic_actual_motion(&self, label: &str) {
        let s = &self.character_motion.backend_motion;
        eprintln!("C12_WORLD case={:?} label={label} raw={:?} wake={:?} promote={} committed={} used={} bodies={} mixed={:?} stops={:?} statistics={:?}",
            std::thread::current().name(),s.error,s.wake_join,s.promotion_pending,
            s.committed_seconds,s.used,self.backend.bodies.len(),s.mixed,s.stops,self.step_statistics());
        for (id, body) in self.backend.bodies.iter().take(8) {
            eprintln!("C12_NATIVE case={:?} body={id:?} kind={:?} pose={:?} next={:?} linear={:?} angular={:?}",
                std::thread::current().name(),body.body_type(),body.position(),body.next_position(),body.linvel(),body.angvel());
        }
        for (id, r) in self.characters.iter().take(8) {
            eprintln!("C12_CHARACTER case={:?} body={id:?} state={:?} free={:?} geometric={:?} external={:?} contact={:?} pending={:?} support={:?}",
                std::thread::current().name(),r.state,r.free_velocity,r.free_translation,
                r.external_velocity,r.contact_velocity,r.pending_impulse,r.support_motion);
        }
        for entry in s.entries.iter().take(8) {
            eprintln!(
                "C12_ENTRY case={:?} body={:?} curve={:?} value={:?} support={:?} delta={:?}",
                std::thread::current().name(),
                entry.value.handle,
                entry.curve,
                entry.value,
                entry.support,
                entry.velocity_delta
            );
        }
        for origin in s.origins.iter().take(8) {
            eprintln!("C12_ORIGIN case={:?} body={:?} start={:?} support={:?} carry={:?} delta={:?} published={:?}",
                std::thread::current().name(),origin.body,origin.start,origin.support,
                origin.carry,origin.velocity_delta,origin.published_velocity_delta);
        }
    }

    pub(in crate::physics3d) fn charge_actual_stop_work(
        &mut self,
        records: usize,
        existing: usize,
    ) -> Result<(), crate::physics3d::PhysicsError> {
        let amount = (records as u64)
            .checked_mul((existing as u64) + (records as u64) + (self.characters.len() as u64) + 1);
        let result = amount
            .ok_or(TrajectoryError::WorkLimit)
            .and_then(|n| self.character_motion.backend_motion.charge(n));
        if let Err(error) = result {
            self.character_motion.backend_motion.fail(error);
            Err(crate::physics3d::PhysicsError::CapacityExceeded)
        } else {
            Ok(())
        }
    }
    pub(in crate::physics3d) fn configure_actual_paths(
        &mut self,
        paths: &[crate::physics3d::KinematicPath],
    ) -> Result<(), crate::physics3d::PhysicsError> {
        let scratch = &mut self.character_motion.backend_motion;
        let result = (|| {
            let log = usize::BITS - paths.len().max(1).leading_zeros();
            scratch.charge(
                (paths.len() as u64)
                    .checked_mul(16 * (u64::from(log) + 1))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            reserve(&mut scratch.prescribed_paths, paths.len())?;
            scratch.prescribed_paths.clear();
            scratch
                .prescribed_paths
                .extend(paths.iter().map(|p| p.body));
            scratch.prescribed_paths.sort_unstable();
            reserve(&mut scratch.sweep_sensor_paths, paths.len())?;
            scratch.sweep_sensor_paths.clear();
            scratch
                .sweep_sensor_paths
                .extend(paths.iter().filter(|p| p.sweep_sensors).map(|p| p.body));
            scratch.sweep_sensor_paths.sort_unstable();
            Ok::<_, TrajectoryError>(())
        })();
        if let Err(error) = result {
            scratch.fail(error);
        }
        self.actual_motion_result()
    }

    pub(in crate::physics3d) fn end_backend_motion_tick(&mut self) {
        self.character_motion
            .backend_motion
            .prescribed_paths
            .clear();
        self.character_motion
            .backend_motion
            .sweep_sensor_paths
            .clear();
    }
    pub(in crate::physics3d) fn actual_prescribed_stop(&self, body: BodyId) -> Option<Time> {
        let scratch = &self.character_motion.backend_motion;
        scratch
            .stops
            .binary_search_by_key(&body, |s| s.0)
            .ok()
            .map(|i| scratch.stops[i].1)
    }

    /// Configured paths are approved from every original full-shape kernel and
    /// their final endpoint. A controller preview may observe them, but cannot
    /// shorten the command before that approval boundary.
    pub(in crate::physics3d) fn actual_path_is_guarded(&self, body: BodyId) -> bool {
        self.character_motion
            .backend_motion
            .prescribed_paths
            .binary_search(&body)
            .is_ok()
            && self
                .backend
                .bodies
                .get(crate::physics3d::world::native_id(body))
                .is_some_and(|b| b.is_enabled() && b.is_kinematic())
    }

    pub(in crate::physics3d) fn actual_prescribed_rotation(body: &rp::RigidBody) -> bool {
        body.is_kinematic()
            && (body.angvel() != rp::Vector::ZERO
                || body.position().rotation != body.next_position().rotation)
    }

    pub(in crate::physics3d) fn retry_actual_wake(
        &mut self,
        current_seconds: Time,
    ) -> Result<Option<WakeRetry>, crate::physics3d::PhysicsError> {
        if self.character_motion.backend_motion.promotion_pending {
            let scratch = &mut self.character_motion.backend_motion;
            scratch.promotion_pending = false;
            scratch.error = None;
            return Ok(Some(WakeRetry::Promoted));
        }
        let Some(join) = self.character_motion.backend_motion.wake_join else {
            return Ok(None);
        };
        let mut work = Work {
            used: self.character_motion.backend_motion.used,
            limit: super::trajectory::MAX_PROOF_WORK,
        };
        let result = self.actual_motion_scratch_bound().and_then(|limit| {
            if self.try_join_sleeping_motion(&join, &mut work, limit)? {
                Ok(WakeRetry::Joined)
            } else {
                crate::physics3d::kinematic_paths::wake_join::wake_prefix_seconds(
                    &join,
                    current_seconds,
                )
                .map(WakeRetry::Prefix)
            }
        });
        self.character_motion.backend_motion.used = work.used;
        match result {
            Ok(retry) => {
                self.character_motion.backend_motion.error = None;
                self.character_motion.backend_motion.wake_join = None;
                Ok(Some(retry))
            }
            Err(error) => {
                self.character_motion.backend_motion.fail(error);
                self.actual_motion_result().map(|()| None)
            }
        }
    }
    pub(crate) fn clear_actual_motion_outcome(&mut self) {
        let scratch = &mut self.character_motion.backend_motion;
        scratch.error = None;
        scratch.wake_join = None;
        scratch.committed_seconds = 0.;
    }
    pub(in crate::physics3d) fn capture_actual_interval_credit(
        &mut self,
    ) -> Result<(), crate::physics3d::PhysicsError> {
        if !self.backend_motion_enabled() {
            return Ok(());
        }
        let mut credit = std::mem::take(&mut self.character_motion.credit);
        let mut work = Work {
            used: self.character_motion.backend_motion.used,
            limit: super::trajectory::MAX_PROOF_WORK,
        };
        let result = self
            .actual_motion_scratch_bound()
            .and_then(|limit| credit.capture(self, &mut work, limit).map(|_| ()));
        self.character_motion.backend_motion.used = work.used;
        self.character_motion.credit = credit;
        if let Err(error) = result {
            self.character_motion.backend_motion.fail(error);
        }
        self.actual_motion_result()
    }

    pub(in crate::physics3d) fn finish_actual_interval_credit(
        &mut self,
        before: Time,
    ) -> Result<(), crate::physics3d::PhysicsError> {
        let mut credit = std::mem::take(&mut self.character_motion.credit);
        if self.actual_motion_result().is_err() && self.actual_motion_completed_time() == before {
            if let Err(error) = credit.rollback(self) {
                self.character_motion.backend_motion.fail(error);
            }
        } else {
            credit.commit();
        }
        self.character_motion.credit = credit;
        self.actual_motion_result()
    }

    pub(in crate::physics3d) fn actual_motion_scratch_bound(
        &self,
    ) -> Result<usize, TrajectoryError> {
        self.actual_motion_scratch_layout(
            self.character_motion
                .backend_motion
                .scene_bounds
                .retained_bytes()?,
        )
        .map(|(remaining, _)| remaining)
    }

    fn actual_motion_scratch_layout(
        &self,
        retained: usize,
    ) -> Result<(usize, actual_scene::BoundsLayout), TrajectoryError> {
        let full = self
            .config
            .max_bodies
            .checked_mul(
                std::mem::size_of::<Entry>()
                    + std::mem::size_of::<BodyTrajectory>()
                    + std::mem::size_of::<Participant>()
                    + std::mem::size_of::<(usize, SolverMotionBody)>()
                    + 5 * std::mem::size_of::<BodyId>(),
            )
            .and_then(|n| {
                self.config
                    .max_colliders
                    .checked_mul(std::mem::size_of::<ColliderTrajectory>())
                    .and_then(|c| n.checked_add(c))
            })
            .and_then(|n| {
                self.config
                    .max_characters
                    .checked_mul(
                        std::mem::size_of::<CharacterRuntime>()
                            + std::mem::size_of::<CharacterOrigin>(),
                    )
                    .and_then(|c| n.checked_add(c))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        let layout =
            actual_scene::BoundsCache::layout(full, self.backend.colliders.len(), retained)?;
        let remaining = full
            .checked_sub(layout.reserved())
            .and_then(|n| n.checked_sub(self.character_motion.rollback.reserved()))
            .and_then(|n| n.checked_sub(self.tick_outputs.reserved_bytes()))
            .ok_or(TrajectoryError::WorkLimit)?;
        Ok((remaining, layout))
    }
    /// Continue saved-query capture on the current tick's existing proof
    /// ledger. This is not a fresh allowance or an additional physics step.
    pub(in crate::physics3d) fn saved_motion_proof_work(&self) -> Work {
        Work {
            used: self.character_motion.backend_motion.used,
            limit: super::trajectory::MAX_PROOF_WORK,
        }
    }

    /// Commit only monotonically consumed proof work. An invalid local ledger
    /// leaves both the counter and the actual motion outcome/clock unchanged.
    pub(in crate::physics3d) fn commit_saved_motion_proof_work(
        &mut self,
        work: Work,
    ) -> Result<(), TrajectoryError> {
        let scratch = &mut self.character_motion.backend_motion;
        if work.limit != super::trajectory::MAX_PROOF_WORK || work.used < scratch.used {
            return Err(TrajectoryError::InvalidReference);
        }
        if work.used > work.limit {
            return Err(TrajectoryError::WorkLimit);
        }
        scratch.used = work.used;
        Ok(())
    }

    pub(crate) fn actual_motion_completed_seconds(&self) -> f32 {
        self.actual_motion_completed_time() as f32
    }
    pub(crate) fn actual_motion_completed_time(&self) -> Time {
        self.character_motion.backend_motion.committed_seconds
    }

    pub(crate) fn actual_motion_result(&self) -> Result<(), crate::physics3d::PhysicsError> {
        use crate::physics3d::PhysicsError as E;
        let scratch = &self.character_motion.backend_motion;
        match scratch.error {
            None if scratch.promotion_pending => Err(E::UnresolvedMotion),
            None if scratch.wake_join.is_none() => Ok(()),
            None => Err(E::InvalidBody),
            Some(TrajectoryError::WorkLimit) => Err(E::CapacityExceeded),
            Some(TrajectoryError::UnsupportedShape) => Err(E::UnsupportedShape),
            Some(TrajectoryError::Unresolved) => Err(E::UnresolvedMotion),
            Some(_) => Err(E::InvalidBody),
        }
    }
    pub(in crate::physics3d) fn begin_backend_motion_tick(&mut self) {
        self.character_motion.backend_motion.begin_tick();
    }
    pub(in crate::physics3d) fn backend_motion_enabled(&self) -> bool {
        #[cfg(test)]
        if self.experimental_character_kcc_enabled() {
            return false;
        }
        #[cfg(test)]
        if self.rigid_motion_proof_is_forced() || self.character_motion_proof_is_forced() {
            return true;
        }
        false
    }

    pub(in crate::physics3d) fn prepare_backend_motion(
        &self,
        s: &mut BackendMotionScratch,
        controller_seconds: f32,
    ) -> Result<usize, TrajectoryError> {
        if !controller_seconds.is_finite() || controller_seconds <= 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        s.impulse_limit = self.config.max_events;
        s.reset();
        let (records, bounds_layout) =
            self.actual_motion_scratch_layout(s.scene_bounds.retained_bytes()?)?;
        let mut memo_work = Work {
            used: s.used,
            limit: super::trajectory::MAX_PROOF_WORK,
        };
        let memo_ready = s.scene_bounds.prepare_epoch(bounds_layout, &mut memo_work);
        s.used = memo_work.used;
        memo_ready?;
        // Persistent output backing has its existing max_events owner bound;
        // it is not charged to the body-count-derived transient layout bound.
        let max_output_bytes = self
            .config
            .max_events
            .checked_mul(std::mem::size_of::<crate::physics3d::ContactImpulse>())
            .ok_or(TrajectoryError::WorkLimit)?;
        let mut output_work = Work {
            used: s.used,
            limit: super::trajectory::MAX_PROOF_WORK,
        };
        let output_ready = self.events.prepare_actual_contact_impulses(
            self.config.max_events,
            &mut output_work,
            max_output_bytes,
        );
        s.used = output_work.used;
        output_ready?;
        if s.origins.is_empty() {
            let census = (|| -> Result<(), TrajectoryError> {
                // Keep the original raw arena/direct-compound census admission.
                // Each enabled character pays records*64 before its support scan;
                // only an actual support permits and pays the second geometry scan.
                // Both executed scans retain the original records*128 total.
                s.charge(self.backend.colliders.motion_storage_slots() as u64)?;
                let mut records = self.backend.colliders.len();
                for (_, collider) in self.backend.colliders.iter() {
                    records = records
                        .checked_add(
                            collider
                                .shape()
                                .as_compound()
                                .map_or(1, |c| c.shapes().len()),
                        )
                        .ok_or(TrajectoryError::WorkLimit)?;
                }
                let scan_price = (records as u64)
                    .checked_mul(64)
                    .ok_or(TrajectoryError::WorkLimit)?;
                s.charge(self.characters.len() as u64)?;
                reserve(&mut s.origins, self.characters.len())?;
                for (&body, runtime) in &self.characters {
                    let native = self
                        .backend
                        .bodies
                        .get(crate::physics3d::world::native_id(body))
                        .ok_or(TrajectoryError::InvalidReference)?;
                    if !native.is_enabled() {
                        continue;
                    }
                    let collider = self
                        .backend
                        .colliders
                        .get(crate::physics3d::colliders::native_collider(
                            runtime.collider,
                        ))
                        .ok_or(TrajectoryError::InvalidReference)?;
                    let shape_pose = *collider.position();
                    let allows = |handle, target: &rp::Collider| {
                        self.contact_policies.one_way_allows(
                            handle,
                            target,
                            collider.shape(),
                            &shape_pose,
                        ) && self.contact_policies.pair_allows(
                            Some(crate::physics3d::world::native_id(body)),
                            target.parent(),
                        )
                    };
                    let query = self.backend.query_pipeline_with_filter(rp::QueryFilter {
                        flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
                        groups: Some(collider.collision_groups()),
                        exclude_rigid_body: Some(crate::physics3d::world::native_id(body)),
                        predicate: Some(&allows),
                        ..Default::default()
                    });
                    let mut ground_work = Work {
                        used: s.used,
                        limit: super::trajectory::MAX_PROOF_WORK,
                    };
                    let tight = crate::physics3d::character_query::certified_tight_ground_admitted(
                        &self.backend,
                        &query,
                        collider.shape(),
                        &shape_pose,
                        &runtime.config,
                        scan_price,
                        &mut ground_work,
                    );
                    // Success and failure retain the same tick's monotonically
                    // consumed work. No per-character allowance is introduced.
                    s.used = ground_work.used;
                    let tight_static_epsilon = tight?.map(|_| {
                        crate::physics3d::character_query::tight_epsilon(
                            self.backend.integration_parameters.length_unit,
                            &runtime.config,
                        )
                    });
                    let relative_plan = (rp::Vector::from(runtime.free_translation)
                        - rp::Vector::from(runtime.free_carry_translation))
                        / controller_seconds;
                    let relative_momentum = rp::Vector::from(runtime.free_velocity)
                        - rp::Vector::from(runtime.free_carry_translation) / controller_seconds;
                    let geometry_credit = if runtime.config.push_mass > 0. {
                        relative_plan - relative_momentum
                    } else {
                        rp::Vector::ZERO
                    };
                    if !relative_plan.is_finite()
                        || !relative_momentum.is_finite()
                        || !geometry_credit.is_finite()
                    {
                        return Err(TrajectoryError::NonFinite);
                    }
                    let confined_receiver = if tight_static_epsilon.is_some()
                        && runtime.config.push_mass > 0.
                        && relative_plan != rp::Vector::ZERO
                    {
                        let choice = confined_push::select(
                            self,
                            body,
                            runtime,
                            collider,
                            &query,
                            relative_plan.length() * controller_seconds,
                            scan_price,
                            &mut ground_work,
                        );
                        s.used = ground_work.used;
                        choice?
                    } else {
                        None
                    };
                    s.origins.push(CharacterOrigin {
                        body,
                        coasting_frame: self.character_dynamics.coasting_frame(body),
                        confined_receiver,
                        start: native.center_of_mass(),
                        carry: rp::Vector::ZERO,
                        anchored: false,
                        velocity_delta: rp::Vector::ZERO,
                        published_velocity_delta: rp::Vector::ZERO,
                        finite_mass: runtime.config.push_mass > 0.,
                        relative_momentum,
                        momentum_carry: rp::Vector::from(runtime.free_carry_translation)
                            / controller_seconds,
                        tight_static_epsilon,
                        blocked_moving: false,
                        blocked_character: false,
                        hit_ceiling: false,
                        support: runtime
                            .support_motion
                            .map(|(body, anchor, _)| (body, Some(anchor)))
                            .or_else(|| runtime.state.carried_by.map(|body| (body, None)))
                            .or_else(|| {
                                self.character_motion
                                    .credit
                                    .original_carry_support(body)
                                    .map(|body| (body, None))
                            })
                            .filter(|(body, _)| {
                                self.backend
                                    .bodies
                                    .get(crate::physics3d::world::native_id(*body))
                                    .is_some_and(|b| {
                                        b.is_enabled() && (b.is_dynamic() || b.is_kinematic())
                                    })
                            }),
                        relative_plan,
                        geometry_delta: rp::Vector::ZERO,
                        geometry_credit,
                    });
                }
                Ok(())
            })();
            if let Err(error) = census {
                // This branch started empty. Never mistake a partial new
                // census for the complete retained controller-interval one.
                s.origins.clear();
                return Err(error);
            }
        }
        let scan = self.character_dynamics.coupled_native_scan_len();
        let target = s
            .affected
            .len()
            .checked_add(scan)
            .ok_or(TrajectoryError::WorkLimit)?;
        s.charge(
            (scan as u64)
                .checked_mul(target as u64 + 1)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        reserve(&mut s.affected, target)?;
        for body in self.character_dynamics.coupled_native_bodies() {
            if let Err(index) = s.affected.binary_search(&body) {
                s.affected.insert(index, body);
            }
        }
        s.prepare_mixed()?;
        s.separate_virtual_components =
            self.joints.is_empty() && self.characters.values().all(|r| r.config.push_mass == 0.);
        s.prepare_disabled_pairs(&self.joints)?;
        Ok(records)
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod momentum_tests;

#[cfg(test)]
mod native_ccd_tests;

#[cfg(test)]
mod tight_ground_tests;
