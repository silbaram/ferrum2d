// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
//! Sweep machinery of the continuous-collision pass: fast-collider descriptions,
//! per-pair time-of-impact casts (proxy sweeps + nonlinear fallback),
//! and the per-body continuous solve.

use crate::alloc_prelude::*;
use crate::dynamics::{
    RigidBody, RigidBodyHandle, RigidBodyPosition, RigidBodySet, RigidBodyVelocity, SoftBodySet,
};
use crate::geometry::{Collider, ColliderHandle, ColliderSet};
use crate::math::{Pose, Real, Vector};
use crate::parry::bounding_volume::Aabb;
use crate::parry::bounding_volume::BoundingVolume;
use crate::parry::partitioning::Bvh;
use crate::pipeline::{ActiveHooks, PairFilterContext, PhysicsHooks};
#[cfg(feature = "dim2")]
use parry::query::sweep_toi::CORE_FRACTION;
use parry::query::sweep_toi::{
    sweep_time_of_impact, sweep_time_of_impact_composite, Sweep, SweepCompositeFastShape,
    SweepToiStatus, ToiProxy,
};
use parry::query::{NonlinearRigidMotion, QueryDispatcher};
use parry::shape::{Shape, TypedShape};

/// Is `rb` a *fixed* CCD target? A parentless collider (`rb == None`) and a
/// `Fixed` parent body are both fixed. Kinematic and dynamic parents are not.
fn is_fixed_target(rb: Option<&RigidBody>) -> bool {
    rb.map(|b| b.is_fixed()).unwrap_or(true)
}

/// Is `rb` a bullet (a dynamic body with the full-CCD upgrade)? Bullets never sweep against
/// other bullets.
pub(super) fn is_bullet(rb: &RigidBody) -> bool {
    rb.is_dynamic() && rb.ccd.ccd_enabled
}

/// The target-selection rule for a fast body `rb1`: a non-bullet fast body only sweeps
/// against automatic targets (fixed geometry and soft-body meshes); a bullet sweeps against
/// every body type except other bullets.
fn tier_allows(rb1: &RigidBody, rb2: Option<&RigidBody>, co2: &Collider) -> bool {
    solver_ccd_body_tier_allows(rb1, rb2, co2.is_deformable_collider())
}
/// Native potential target tier without a speculative speed estimate.
/// Final fast-body activation is checked independently on the solved motion.
pub fn solver_ccd_body_tier_allows(
    rb1: &RigidBody,
    rb2: Option<&RigidBody>,
    deformable: bool,
) -> bool {
    rb1.is_dynamic()
        && if is_bullet(rb1) {
            !rb2.map(is_bullet).unwrap_or(false)
        } else {
            is_fixed_target(rb2) || deformable
        }
}

/// Returns `true` if the user's `filter_contact_pair` hook rejected this pair. Mirrors the
/// narrow-phase filter in `NarrowPhase::compute_contacts` so CCD respects the same user-level
/// filtering (issue #754).
#[inline]
#[allow(clippy::too_many_arguments)]
fn pair_filtered_out_by_hooks(
    hooks: &dyn PhysicsHooks,
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    co1: &Collider,
    co2: &Collider,
    ch1: ColliderHandle,
    ch2: ColliderHandle,
    bh1: RigidBodyHandle,
    bh2: Option<RigidBodyHandle>,
) -> bool {
    let active_hooks = co1.flags.active_hooks | co2.flags.active_hooks;
    if !active_hooks.contains(ActiveHooks::FILTER_CONTACT_PAIRS) {
        return false;
    }
    let context = PairFilterContext {
        bodies,
        colliders,
        rigid_body1: Some(bh1),
        rigid_body2: bh2,
        collider1: ch1,
        collider2: ch2,
    };
    hooks.filter_contact_pair(&context).is_none()
}

/// Apply the native CCD target tier, groups and user hook to one original
/// collider pair. `Some(true)` is a pseudo/sensor pair, `Some(false)` is solid.
/// Fast-body activation is intentionally a separate solved-motion predicate.
#[allow(clippy::too_many_arguments)]
pub fn solver_ccd_pair_kind(
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    origin: RigidBodyHandle,
    moving: ColliderHandle,
    target: ColliderHandle,
    hooks: &dyn PhysicsHooks,
) -> Option<bool> {
    let rb1 = bodies.get(origin)?;
    let co1 = colliders.get(moving)?;
    let co2 = colliders.get(target)?;
    let bh2 = co2.parent();
    if !rb1.is_enabled()
        || !rb1.is_dynamic()
        || !co1.is_enabled()
        || !co2.is_enabled()
        || co1.parent() != Some(origin)
        || moving == target
        || bh2 == Some(origin)
        || !tier_allows(rb1, bh2.and_then(|h| bodies.get(h)), co2)
        || !co1.flags.collision_groups.test(co2.flags.collision_groups)
        || pair_filtered_out_by_hooks(
            hooks, bodies, colliders, co1, co2, moving, target, origin, bh2,
        )
    {
        return None;
    }
    if bh2.is_some_and(|h| !bodies.get(h).is_some_and(|b| b.is_enabled())) {
        return None;
    }
    Some(
        co1.is_sensor()
            || co2.is_sensor()
            || !co1.flags.solver_groups.test(co2.flags.solver_groups),
    )
}

/// Whether the original moving shape is supported by native CCD.
pub fn solver_ccd_shape_supported(shape: &dyn Shape) -> bool {
    !shape_never_ccd_swept(shape)
}

/// Evaluate the post-solve fast criterion on a solved COM endpoint without
/// first writing it to persistent rigid-body storage.
pub fn solver_ccd_active(
    body: &RigidBody,
    colliders: &ColliderSet,
    end_com: Pose,
    params: &crate::dynamics::IntegrationParameters,
) -> bool {
    if params.max_ccd_substeps == 0
        || !body.is_enabled()
        || !body.is_dynamic()
        || body.is_soft_frame()
    {
        return false;
    }
    let position = crate::dynamics::RigidBodyPosition {
        position: body.pos.position,
        next_position: end_com.prepend_translation(-body.mprops.local_mprops.local_com),
    };
    let velocity = position.interpolate_velocity(params.inv_dt(), body.local_center_of_mass());
    post_solve_ccd_active(body, colliders, &position, &velocity, params.dt)
}

pub(crate) fn post_solve_ccd_active(
    body: &RigidBody,
    _colliders: &ColliderSet,
    position: &RigidBodyPosition,
    velocity: &RigidBodyVelocity<Real>,
    dt: Real,
) -> bool {
    let local_com = body.local_center_of_mass();
    let moving_fast = |radius| {
        body.ccd
            .is_moving_fast_with_next_position(dt, velocity, position, local_com, radius)
    };
    if !moving_fast(body.mprops.max_extent()) {
        return false;
    }
    #[cfg(feature = "dim3")]
    if let Some(radius) = planar_cuboid_rotation_radius(body, _colliders, position, velocity) {
        return moving_fast(radius);
    }
    true
}

#[cfg(feature = "dim3")]
fn planar_cuboid_rotation_radius(
    body: &RigidBody,
    colliders: &ColliderSet,
    position: &RigidBodyPosition,
    velocity: &RigidBodyVelocity<Real>,
) -> Option<Real> {
    use crate::dynamics::LockedAxes;

    let locks = LockedAxes::TRANSLATION_LOCKED_Z
        | LockedAxes::ROTATION_LOCKED_X
        | LockedAxes::ROTATION_LOCKED_Y;
    if !body.locked_axes().contains(locks)
        || velocity.angvel.x != 0.0
        || velocity.angvel.y != 0.0
        || velocity.angvel.z == 0.0
        || [position.position.rotation, position.next_position.rotation]
            .into_iter()
            .any(|q| q.x != 0.0 || q.y != 0.0)
    {
        return None;
    }

    // A Z-axis rotation only moves the XY projection of each point. Bound
    // the box about the body's COM, including the collider's offset.
    let [handle] = body.colliders() else {
        return None;
    };
    let collider = colliders.get(*handle)?;
    if !collider.is_enabled() {
        return None;
    }
    let cuboid = collider.shape().as_cuboid()?;
    let bounds = cuboid.compute_aabb(collider.position_wrt_parent()?);
    let local_com = body.local_center_of_mass().truncate();
    let arm = (bounds.mins.truncate() - local_com)
        .abs()
        .max((bounds.maxs.truncate() - local_com).abs());
    let radius = arm.length();
    radius.is_finite().then_some(radius)
}

/// Is this shape one of the composite shapes handled by
/// [`sweep_time_of_impact_composite`]?
fn is_composite_shape(shape: &dyn Shape) -> bool {
    matches!(
        shape.as_typed_shape(),
        TypedShape::TriMesh(_)
            | TypedShape::Polyline(_)
            | TypedShape::HeightField(_)
            | TypedShape::Compound(_)
    )
}

/// Is this a shape the continuous phase never sweeps as the *fast* (moving) shape?
/// Mesh-like bodies rely on speculative contacts only. Also kept out of `ccd_thickness`:
/// a mesh's zero thickness would flag the body fast every step for nothing.
pub(crate) fn shape_never_ccd_swept(shape: &dyn Shape) -> bool {
    matches!(
        shape.as_typed_shape(),
        TypedShape::TriMesh(_)
            | TypedShape::Polyline(_)
            | TypedShape::HeightField(_)
            | TypedShape::Voxels(_)
    )
}

/// The pose a target collider holds during the continuous pass. Targets are stationary at
/// their end-of-step pose (static targets trivially; dynamic/kinematic targets of bullets
/// read the — possibly already clamped — solved `next_position`).
fn target_collider_pose(co: &Collider, rb: Option<&RigidBody>) -> Pose {
    match (rb, co.parent.as_ref()) {
        (Some(rb), Some(parent)) => rb.pos.next_position * parent.pos_wrt_parent,
        _ => co.pos.0,
    }
}

/// Iterates the enabled colliders whose broad-phase (swept) AABB intersects `aabb`. Queries the
/// BVH directly (not via `QueryPipeline`) so the closure stays `Sync` for the parallel per-body
/// sweeps; the CCD sites use the default, pass-everything query filter anyway.
fn intersect_swept_aabb<'a>(
    bvh: &'a Bvh,
    colliders: &'a ColliderSet,
    aabb: Aabb,
) -> impl Iterator<Item = (ColliderHandle, &'a Collider)> + 'a {
    bvh.leaves(move |node| node.aabb().intersects(&aabb))
        .filter_map(move |leaf| {
            // NOTE: do **not** recompute and check the latest collider AABB: checking only
            //       against the one in the BVH is what makes the query conservative (the
            //       leaves hold the swept AABBs).
            let (co, ch) = colliders.get_unknown_gen(leaf)?;
            Some((ch, co))
        })
}

/// The targets a fast body sweeps against. Non-bullets only hit automatic targets, so flat AABB
/// lists skip walking the shared BVH; bullets and fixed-heavy worlds use the full BVH.
#[derive(Copy, Clone)]
pub(super) enum CcdTargets<'a> {
    /// Flat lists of the automatic targets and their (slightly fattened) AABBs: the cached
    /// fixed colliders, and the soft-body collision meshes (rebuilt every step, as they deform).
    Lists {
        /// The fixed colliders.
        fixed: &'a [(ColliderHandle, Aabb)],
        /// The soft-body collision meshes.
        soft: &'a [(ColliderHandle, Aabb)],
    },
    /// The full broad-phase BVH.
    FullBvh(&'a Bvh),
}

/// Maximum number of fixed colliders stored in the flat list before falling back to the
/// full broad-phase BVH.
const FIXED_TARGETS_LIST_MAX: usize = 512;

/// Collects the enabled fixed-target colliders (parentless + attached to `Fixed` bodies),
/// AABBs fattened by the prediction (speculative) distance. Returns `None` when there are
/// more than [`FIXED_TARGETS_LIST_MAX`] of them.
pub(super) fn collect_fixed_targets(
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    prediction_distance: Real,
) -> Option<Vec<(ColliderHandle, Aabb)>> {
    let mut fixed = Vec::new();
    for (ch, co) in colliders.iter_enabled() {
        let rb = co.parent.and_then(|p| bodies.get(p.handle));
        if is_fixed_target(rb) {
            if fixed.len() == FIXED_TARGETS_LIST_MAX {
                return None;
            }
            let aabb = co.shape.compute_aabb(&co.pos).loosened(prediction_distance);
            fixed.push((ch, aabb));
        }
    }
    Some(fixed)
}

/// Collects the enabled soft-body collision meshes and their AABBs, fattened by the prediction
/// (speculative) distance. Rebuilt every step: unlike the fixed targets, a mesh deforms with its
/// particles without any scene change.
pub(super) fn collect_soft_targets(
    soft_bodies: &SoftBodySet,
    colliders: &ColliderSet,
    prediction_distance: Real,
) -> Vec<(ColliderHandle, Aabb)> {
    let mut soft = Vec::new();
    for (_, sb) in soft_bodies.iter() {
        for mesh in sb.meshes() {
            let ch = mesh.collider();
            let Some(co) = colliders.get(ch).filter(|co| co.is_enabled()) else {
                continue;
            };
            let aabb = co.shape.compute_aabb(&co.pos).loosened(prediction_distance);
            soft.push((ch, aabb));
        }
    }
    soft
}

/// A convex piece of the fast collider: its point-cloud proxy plus its own sweep (the
/// collider's sweep composed with the piece's local pose for compound children).
struct FastSubShape<'a> {
    proxy: ToiProxy<'a>,
    sweep: Sweep,
    /// The piece's centroid in its sweep's local frame, used for the initial-overlap core
    /// ball.
    local_centroid: Vector,
    /// The piece's smallest extent (inner radius).
    min_extent: Real,
}

/// How the continuous phase sweeps the fast collider's shape.
// Only ever a stack local, built once per fast collider per step: boxing the convex variant
// to even out the sizes would buy an allocation on that path and nothing else.
#[allow(clippy::large_enum_variant)]
enum FastShapeKind<'a> {
    /// A single convex point-cloud shape: the exact proxy sweep.
    Convex(FastSubShape<'a>),
    /// A compound: each point-cloud child sweeps independently, each running its own TOI.
    /// Children without a point-cloud proxy are skipped.
    Compound(Vec<FastSubShape<'a>>),
    /// Cylinders, cones, half-spaces, custom shapes: nonlinear shape-cast fallback.
    Nonlinear,
}

/// Description of the fast collider shared by all its pair casts.
struct FastColliderInfo<'a> {
    collider: &'a Collider,
    body: &'a RigidBody,
    kind: FastShapeKind<'a>,
}

impl<'a> FastColliderInfo<'a> {
    /// Builds the fast-collider description for a sweep from collider pose `start` to `end`, or
    /// `None` for never-swept shapes (meshes, heightfields, polylines, voxels — and compounds with
    /// no point-cloud child). `local_com` makes every sweep rotate about the true center of mass.
    fn new(
        collider: &'a Collider,
        body: &'a RigidBody,
        start: &Pose,
        end: &Pose,
        local_com: Vector,
    ) -> Option<Self> {
        let shape = collider.shape.as_ref();
        if shape_never_ccd_swept(shape) {
            return None;
        }

        let kind = if let Some(proxy) = ToiProxy::from_shape(shape) {
            FastShapeKind::Convex(FastSubShape {
                proxy,
                sweep: Sweep::from_poses(start, end, local_com),
                local_centroid: shape.mass_properties(1.0).local_com,
                min_extent: shape.ccd_thickness(),
            })
        } else if let TypedShape::Compound(compound) = shape.as_typed_shape() {
            let children: Vec<_> = compound
                .shapes()
                .iter()
                .filter_map(|(child_pose, child_shape)| {
                    let proxy = ToiProxy::from_shape(child_shape.as_ref())?;
                    Some(FastSubShape {
                        proxy,
                        sweep: Sweep::from_poses(
                            &(*start * *child_pose),
                            &(*end * *child_pose),
                            child_pose.inverse_transform_point(local_com),
                        ),
                        local_centroid: child_shape.mass_properties(1.0).local_com,
                        min_extent: child_shape.ccd_thickness(),
                    })
                })
                .collect();
            if children.is_empty() {
                return None;
            }
            FastShapeKind::Compound(children)
        } else {
            FastShapeKind::Nonlinear
        };

        Some(Self {
            collider,
            body,
            kind,
        })
    }
}

/// A target collider's shape, classified once per pair before the per-piece casts.
// Stack-local per pair, like [`FastShapeKind`] — indirection would only add an allocation.
#[allow(clippy::large_enum_variant)]
enum TargetKind<'a> {
    /// Point-cloud target: the exact proxy-vs-proxy sweep.
    Proxy(ToiProxy<'a>),
    /// Composite target handled by [`sweep_time_of_impact_composite`].
    Composite,
}

/// A hit against a sensor (or a pair with mismatched solver groups), recorded during the
/// sweep for later intersection-event emission. Never clamps positions.
pub(super) struct PseudoHit {
    pub(super) ch1: ColliderHandle,
    pub(super) ch2: ColliderHandle,
    pub(super) fraction: Real,
}

/// Result of the continuous solve of one fast body.
pub(super) struct BodyContinuousResult {
    pub(super) checks: usize,
    pub(super) solid_hit: Option<SolidHit>,
    pub(super) handle: RigidBodyHandle,
    /// The earliest solid impact fraction in `[0, 1]`; `1.0` if the body sweeps freely.
    pub(super) fraction: Real,
    pub(super) pseudo_hits: Vec<PseudoHit>,
}

/// Transient CCD evidence; never used to resolve motion.
#[derive(Clone, Copy)]
pub(super) struct PairImpact {
    pub(super) fraction: Real,
    pub(super) point: Vector,
    pub(super) normal: Vector,
}
impl From<parry::query::sweep_toi::SweepToiOutput> for PairImpact {
    fn from(output: parry::query::sweep_toi::SweepToiOutput) -> Self {
        Self {
            fraction: output.fraction,
            point: output.point,
            normal: output.normal,
        }
    }
}
#[derive(Clone, Copy)]
pub(super) struct SolidHit {
    pub(super) moving: ColliderHandle,
    pub(super) target: ColliderHandle,
    pub(super) impact: PairImpact,
}

/// Casts the fast collider against one target and returns the accepted impact fraction.
/// Solid pairs stop only at strictly >0 fractions (on initial overlap, 2D retries with a core
/// ball while 3D advances); pseudo pairs (sensors, mismatched groups) report any genuine impact.
#[allow(clippy::too_many_arguments)]
fn cast_collider_pair(
    dispatcher: &dyn QueryDispatcher,
    fast: &FastColliderInfo,
    co2: &Collider,
    rb2: Option<&RigidBody>,
    max_fraction: Real,
    dt: Real,
    linear_slop: Real,
    is_pseudo: bool,
) -> Option<PairImpact> {
    let target_pose = target_collider_pose(co2, rb2);

    let sub_shapes: &[FastSubShape] = match &fast.kind {
        FastShapeKind::Convex(sub) => core::slice::from_ref(sub),
        FastShapeKind::Compound(children) => children,
        FastShapeKind::Nonlinear => {
            return fallback_nonlinear_fraction(
                dispatcher,
                fast,
                co2,
                &target_pose,
                max_fraction,
                dt,
                is_pseudo,
            );
        }
    };

    let shape2 = co2.shape.as_ref();
    let target = match ToiProxy::from_shape(shape2) {
        Some(proxy) => TargetKind::Proxy(proxy),
        None if is_composite_shape(shape2) => TargetKind::Composite,
        // Targets with neither a point-cloud proxy nor a supported composite sweep
        // (cylinders, cones, voxels, custom shapes): one whole-collider nonlinear cast.
        None => {
            return fallback_nonlinear_fraction(
                dispatcher,
                fast,
                co2,
                &target_pose,
                max_fraction,
                dt,
                is_pseudo,
            );
        }
    };

    // Each accepted piece fraction tightens `max_fraction`, so the returned value is the
    // earliest impact across all the pieces (both the solid and pseudo accept conditions
    // only pass at or below the current bound).
    let mut best = None;
    let mut max_fraction = max_fraction;
    for sub in sub_shapes {
        if let Some(hit) = cast_sub_shape(
            sub,
            &target,
            shape2,
            &target_pose,
            max_fraction,
            linear_slop,
            is_pseudo,
        ) {
            best = Some(hit);
            max_fraction = hit.fraction;
        }
    }
    best
}

/// Casts one convex piece of the fast collider against the target collider's shape and
/// returns the accepted impact fraction (see [`cast_collider_pair`]), or `None`.
fn cast_sub_shape(
    sub: &FastSubShape,
    target: &TargetKind,
    shape2: &dyn Shape,
    target_pose: &Pose,
    max_fraction: Real,
    linear_slop: Real,
    is_pseudo: bool,
) -> Option<PairImpact> {
    let output = match target {
        TargetKind::Proxy(target_proxy) => {
            let target_sweep = Sweep::constant(target_pose, Vector::ZERO);
            sweep_time_of_impact(
                target_proxy,
                &target_sweep,
                &sub.proxy,
                &sub.sweep,
                max_fraction,
                linear_slop,
            )
        }
        TargetKind::Composite => {
            // Heightfields are treated as one-sided in 3D; oriented polylines and
            // oriented meshes enable the one-sided early-outs from their own flags inside
            // the composite dispatch.
            #[cfg(feature = "dim2")]
            let one_sided = false;
            #[cfg(feature = "dim3")]
            let one_sided = matches!(shape2.as_typed_shape(), TypedShape::HeightField(_));

            let fast_desc = SweepCompositeFastShape {
                proxy: &sub.proxy,
                sweep: &sub.sweep,
                local_centroid: sub.local_centroid,
                min_extent: sub.min_extent,
            };
            sweep_time_of_impact_composite(
                shape2,
                target_pose,
                fast_desc,
                one_sided,
                is_pseudo,
                max_fraction,
                linear_slop,
            )?
        }
    };

    if is_pseudo {
        // Any genuine impact counts (initial overlaps are filtered later by the endpoint
        // intersection re-check); `Separated` does not.
        return match output.status {
            SweepToiStatus::Hit | SweepToiStatus::Failed | SweepToiStatus::Overlapped
                if output.fraction <= max_fraction =>
            {
                Some(output.into())
            }
            _ => None,
        };
    }

    if 0.0 < output.fraction && output.fraction < max_fraction {
        return Some(output.into());
    }

    #[cfg(feature = "dim2")]
    if output.fraction == 0.0 {
        // Fallback to the TOI of a small core circle around the fast shape centroid,
        // so a body already touching a surface isn't pinned at fraction 0.
        if let TargetKind::Proxy(target_proxy) = target {
            let core = ToiProxy::point(sub.local_centroid, CORE_FRACTION * sub.min_extent);
            let target_sweep = Sweep::constant(target_pose, Vector::ZERO);
            let output = sweep_time_of_impact(
                target_proxy,
                &target_sweep,
                &core,
                &sub.sweep,
                max_fraction,
                linear_slop,
            );
            if 0.0 < output.fraction && output.fraction < max_fraction {
                return Some(output.into());
            }
        }
    }

    None
}

/// Nonlinear shape-cast fallback for pairs the proxy sweep can't handle (cylinder, cone or
/// custom fast shapes; cylinder, cone, voxels or custom targets). Motion is derived from
/// the solved effective velocities, like rapier's historical CCD.
fn fallback_nonlinear_fraction(
    dispatcher: &dyn QueryDispatcher,
    fast: &FastColliderInfo,
    co2: &Collider,
    target_pose: &Pose,
    max_fraction: Real,
    dt: Real,
    is_pseudo: bool,
) -> Option<PairImpact> {
    if dt == 0.0 {
        return None;
    }

    let rb1 = fast.body;
    let parent1 = fast.collider.parent.as_ref()?;
    let motion1 = NonlinearRigidMotion::new(
        rb1.pos.position,
        rb1.mprops.local_mprops.local_com,
        rb1.ccd_vels.linvel,
        rb1.ccd_vels.angvel,
    )
    .prepend(parent1.pos_wrt_parent);
    let motion2 = NonlinearRigidMotion::constant_position(*target_pose);

    let hit = dispatcher
        .cast_shapes_nonlinear(
            &motion1,
            fast.collider.shape.as_ref(),
            &motion2,
            co2.shape.as_ref(),
            0.0,
            dt,
            is_pseudo, // Sensors stop at the first penetration.
        )
        .ok()??;

    let fraction = hit.time_of_impact / dt;
    let impact = PairImpact {
        fraction,
        point: motion1
            .position_at_time(hit.time_of_impact)
            .transform_point(hit.witness1),
        normal: target_pose.rotation * hit.normal2,
    };
    if is_pseudo {
        (fraction <= max_fraction).then_some(impact)
    } else {
        (0.0 < fraction && fraction < max_fraction).then_some(impact)
    }
}

/// How the per-body sweep treats *pseudo* pairs (a sensor collider, or mismatched solver
/// groups): the continuous pass records them for intersection-event emission; the substep
/// splitter ignores them since they never clamp motion.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum PseudoHitMode {
    Record,
    Ignore,
}

/// The predictor uses force-integrated input; the accepted pass uses the
/// solver's effective COM/pose velocity, never the previous pass's cached value.
#[derive(Clone, Copy)]
pub(super) enum MotionSource {
    Predicted,
    Solved,
}
impl MotionSource {
    fn angular_distance(self, body: &RigidBody, dt: Real) -> f64 {
        let velocity = match self {
            Self::Predicted => body.forces.integrate(dt, &body.vels, &body.mprops),
            Self::Solved => body.ccd_vels,
        };
        // The fast-rotation opt-in removes the ordinary whole-step angle cap.
        // Effective endpoint velocity cannot bound its lost winding. Use the
        // full pivot envelope when the accepted pass has any rotation evidence;
        // do not substitute an unrelated previous CCD velocity into prediction.
        #[cfg(feature = "dim2")]
        let has_angular_input = body.vels.angvel != 0.0;
        #[cfg(feature = "dim3")]
        let has_angular_input = body.vels.angvel != Vector::ZERO;
        #[cfg(feature = "dim2")]
        let speed = velocity.angvel.abs();
        #[cfg(feature = "dim3")]
        let speed = velocity.angvel.length();
        if matches!(self, Self::Solved)
            && body.ccd.allow_fast_rotation
            && (has_angular_input || speed != 0.0)
        {
            return f64::INFINITY;
        }
        speed as f64 * (dt as f64).abs()
    }
}

/// Conservative local query envelope of the existing COM-linear sweep models.
/// No query-BVH leaf, accepted pose, TOI or result order is changed here.
fn rotational_swept_aabb(
    shape: &dyn Shape,
    start: &Pose,
    end: &Pose,
    local_com: Vector,
    angular_distance: f64,
) -> Aabb {
    let linear = shape.compute_aabb(start).merged(&shape.compute_aabb(end));
    if angular_distance == 0.0 && start.rotation == end.rotation {
        return linear;
    }
    #[cfg(feature = "dim2")]
    let endpoint_angle = (end.rotation * start.rotation.inverse()).angle().abs() as f64;
    #[cfg(feature = "dim3")]
    let endpoint_axis = (end.rotation * start.rotation.inverse()).to_scaled_axis();
    #[cfg(feature = "dim3")]
    let endpoint_angle = simba::scalar::ComplexField::sqrt(
        endpoint_axis
            .to_array()
            .iter()
            .map(|v| {
                let x = *v as f64;
                x * x
            })
            .sum::<f64>(),
    );
    let angle = endpoint_angle.max(angular_distance);
    if angle == 0.0 {
        // Preserve the original linear broad phase bit for bit.
        return linear;
    }
    let sphere = shape.compute_local_bounding_sphere();
    let delta = sphere.center - local_com;
    let radius = simba::scalar::ComplexField::sqrt(
        delta
            .to_array()
            .iter()
            .map(|v| {
                let x = *v as f64;
                x * x
            })
            .sum::<f64>(),
    ) + sphere.radius as f64;
    if radius == 0.0 {
        return linear;
    }
    // Bound rounding of the shape's Real-valued sphere/pivot computation, then
    // round each final coordinate outwards. This is a query envelope, not an
    // added contact tolerance or a global scene margin.
    let radius = radius * (1.0 + 8.0 * Real::EPSILON as f64);
    let c1 = start.transform_point(local_com);
    let c2 = end.transform_point(local_com);
    let mut pivot = Aabb {
        mins: Vector::ZERO,
        maxs: Vector::ZERO,
    };
    for axis in 0..c1.to_array().len() {
        pivot.mins[axis] = ((c1[axis].min(c2[axis]) as f64 - radius) as Real).next_down();
        pivot.maxs[axis] = ((c1[axis].max(c2[axis]) as f64 + radius) as Real).next_up();
    }
    if angle >= core::f64::consts::PI || !radius.is_finite() {
        // The COM-pivot sphere covers any winding and any rotation axis.
        // Endpoint effective velocities cannot recover a solver's lost winding;
        // this envelope does not extend the existing narrowphase motion model.
        return pivot;
    }
    // For shortest-arc quaternion nlerp, u=tan(theta/4) bounds rotation angle
    // derivatives by |phi'|<=4u and |phi''|<=16u^3. Hence |p''|<=16R(u^2+u^3).
    // The linear-interpolation error is <= max|p''|/8. Constant-angular motion
    // has the smaller R*theta^2/8 error. COM translation is linear in both.
    let u = simba::scalar::ComplexField::tan(angle * 0.25);
    let padding = 2.0 * radius * u * u * (1.0 + u);
    // Every corresponding endpoint-point chord lies in `linear`; independently
    // every orientation lies in `pivot`. Their intersection stays conservative.
    let mut bounds = linear;
    for axis in 0..c1.to_array().len() {
        // All rotational derivatives are perpendicular to the fixed world
        // axis. Preserve that anisotropy (e.g. a Z rotation does not sweep Z).
        #[cfg(feature = "dim3")]
        let factor = if endpoint_angle > 0.0 {
            let component = endpoint_axis[axis] as f64 / endpoint_angle;
            (simba::scalar::ComplexField::sqrt((1.0 - component * component).max(0.0))
                + 8.0 * Real::EPSILON as f64)
                .min(1.0)
        } else {
            1.0
        };
        #[cfg(feature = "dim2")]
        let factor = 1.0;
        let low = ((linear.mins[axis] as f64 - padding * factor) as Real).next_down();
        let high = ((linear.maxs[axis] as f64 + padding * factor) as Real).next_up();
        bounds.mins[axis] = low.max(pivot.mins[axis]);
        bounds.maxs[axis] = high.min(pivot.maxs[axis]);
    }
    bounds
}

/// Runs the continuous sweep of a single fast body from its current pose to `end_body_pose`:
/// sweeps each of its colliders through `targets`, keeps the earliest solid impact fraction,
/// and records sensor crossings in [`PseudoHitMode::Record`] mode. Shared by the continuous
/// pass (end pose = solved `next_position`) and the substep splitter (end pose = the
/// forces/velocities integration, pseudo pairs ignored).
#[allow(clippy::too_many_arguments)]
pub(super) fn sweep_fast_body(
    handle: RigidBodyHandle,
    bodies: &RigidBodySet,
    colliders: &ColliderSet,
    end_body_pose: Pose,
    targets: CcdTargets,
    dispatcher: &dyn QueryDispatcher,
    hooks: &dyn PhysicsHooks,
    dt: Real,
    linear_slop: Real,
    pseudo_mode: PseudoHitMode,
    motion_source: MotionSource,
) -> BodyContinuousResult {
    let rb1 = &bodies[handle];
    let mut fraction: Real = 1.0;
    let mut checks = 0usize;
    let mut solid_hit = None;
    let mut pseudo_hits = Vec::new();
    let angular_distance = motion_source.angular_distance(rb1, dt);

    for ch1 in &rb1.colliders.0 {
        let co1 = &colliders[*ch1];
        let Some(parent1) = co1.parent.as_ref() else {
            continue;
        };
        if pseudo_mode == PseudoHitMode::Ignore && co1.is_sensor() {
            continue; // Sensors never clamp motion, so they can't affect the earliest impact.
        }

        let start = rb1.pos.position * parent1.pos_wrt_parent;
        let end = end_body_pose * parent1.pos_wrt_parent;
        let local_com = parent1
            .pos_wrt_parent
            .inverse_transform_point(rb1.mprops.local_mprops.local_com);
        let Some(fast) = FastColliderInfo::new(co1, rb1, &start, &end, local_com) else {
            // Never-swept shape (mesh, heightfield, polyline, voxels): no CCD.
            continue;
        };

        // A rotating tip can leave both endpoint AABBs. Query the existing
        // local COM sweep envelope without widening persistent BVH leaves.
        let swept_aabb = rotational_swept_aabb(
            co1.shape.as_ref(),
            &start,
            &end,
            local_com,
            angular_distance,
        );

        let mut handle_candidate = |ch2: ColliderHandle, co2: &Collider| {
            if ch2 == *ch1 {
                return;
            }
            let bh2 = co2.parent.map(|p| p.handle);
            let rb2 = bh2.and_then(|h| bodies.get(h));
            let Some(is_pseudo) = solver_ccd_pair_kind(bodies, colliders, handle, *ch1, ch2, hooks)
            else {
                return;
            };
            if is_pseudo && pseudo_mode == PseudoHitMode::Ignore {
                return;
            }
            checks = checks.saturating_add(1);
            if let Some(impact) = cast_collider_pair(
                dispatcher,
                &fast,
                co2,
                rb2,
                fraction,
                dt,
                linear_slop,
                is_pseudo,
            ) {
                if is_pseudo {
                    pseudo_hits.push(PseudoHit {
                        ch1: *ch1,
                        ch2,
                        fraction: impact.fraction,
                    });
                } else {
                    fraction = impact.fraction;
                    solid_hit = Some(SolidHit {
                        moving: *ch1,
                        target: ch2,
                        impact,
                    });
                }
            }
        };

        match targets {
            CcdTargets::Lists { fixed, soft } => {
                for (ch2, aabb2) in fixed.iter().chain(soft.iter()) {
                    if aabb2.intersects(&swept_aabb) {
                        handle_candidate(*ch2, &colliders[*ch2]);
                    }
                }
            }
            CcdTargets::FullBvh(bvh) => {
                for (ch2, co2) in intersect_swept_aabb(bvh, colliders, swept_aabb) {
                    handle_candidate(ch2, co2);
                }
            }
        }
    }

    BodyContinuousResult {
        checks,
        solid_hit,
        handle,
        fraction,
        pseudo_hits,
    }
}

/// Fake hook that simply detects if hooks are enabled during CCD.
///
/// This lets us know if another pass is needed when the hooks are non-sync.
#[cfg(all(feature = "parallel", feature = "unsync-callbacks"))]
#[derive(Default)]
struct HookProbe(core::sync::atomic::AtomicBool);

#[cfg(all(feature = "parallel", feature = "unsync-callbacks"))]
impl PhysicsHooks for HookProbe {
    fn filter_contact_pair(
        &self,
        _: &crate::pipeline::PairFilterContext,
    ) -> Option<crate::geometry::SolverFlags> {
        self.0.store(true, core::sync::atomic::Ordering::Relaxed);
        // Irrelevant: reaching this discards the whole pass in favour of the serial redo.
        Some(crate::geometry::SolverFlags::COMPUTE_RIGID_IMPULSES)
    }
}

/// Maps `f` (typically an expensive time-of-impact computation) over the given body handles,
/// in parallel when the `parallel` feature is enabled.
///
/// `f` takes the hooks rather than capturing them, so that a non-`Sync` build can hand the
/// workers a stand-in and keep the user's callback on this thread.
#[cfg(feature = "parallel")]
pub(super) fn map_bodies_parallel<T: Send>(
    handles: &[RigidBodyHandle],
    hooks: &dyn PhysicsHooks,
    f: impl Fn(RigidBodyHandle, &dyn PhysicsHooks) -> T + Sync + Send,
) -> Vec<T> {
    // Below a few dozen bodies the rayon fan-out (pool wake + join) costs more
    // than the sweeps themselves.
    let map_with = |hooks: &(dyn PhysicsHooks + Sync)| {
        if handles.len() >= 64 {
            use rayon::prelude::*;
            return handles.par_iter().map(|h| f(*h, hooks)).collect();
        }
        handles.iter().map(|h| f(*h, hooks)).collect()
    };

    #[cfg(not(feature = "unsync-callbacks"))]
    return map_with(hooks);

    #[cfg(feature = "unsync-callbacks")]
    {
        let probe = HookProbe::default();
        let swept = map_with(&probe);
        if !probe.0.load(core::sync::atomic::Ordering::Relaxed) {
            // No sweep met a hook-flagged pair, so the stand-in answered nothing.
            return swept;
        }
        // One did: redo on this thread with the real hooks. Sweeps only read the body and
        // collider sets and return their result — the caller applies it — so throwing the
        // first pass away is free of side effects.
        drop(swept);
        handles.iter().map(|h| f(*h, hooks)).collect()
    }
}

/// Serial fallback for non-`parallel` builds. Keeps the same shape as the parallel one so
/// both call sites read alike; nothing here needs the hooks to be `Sync`.
#[cfg(not(feature = "parallel"))]
pub(super) fn map_bodies_parallel<T>(
    handles: &[RigidBodyHandle],
    hooks: &dyn PhysicsHooks,
    f: impl Fn(RigidBodyHandle, &dyn PhysicsHooks) -> T,
) -> Vec<T> {
    handles.iter().map(|h| f(*h, hooks)).collect()
}

#[cfg(test)]
#[path = "sweeps_tests.rs"]
mod tests;
