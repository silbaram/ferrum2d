//! Actual-interval scene queries shared by character response and angular CCD.
//! Sleeping targets remain explicit query participants; a hit against one must
//! join backend continuation, not be resolved as an infinite-mass substitute.
use crate::physics3d::solver_trajectory::{
    self, CastHit, Curve, ShapeMotion, Time, TrajectoryError, Work,
};
use crate::physics3d::{character::CharacterRuntime, contact_policy::ContactPolicies, BodyId};
use rapier3d::parry::bounding_volume::{Aabb, BoundingVolume};
use rapier3d::prelude as rp;
use std::collections::BTreeMap;
mod bounds_cache;
pub(super) use bounds_cache::{BoundsCache, Layout as BoundsLayout};
mod pair_queries;
pub(super) use pair_queries::{PairQueries, ReplayPairs};
mod stationary_pairs;

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct BodyTrajectory {
    pub body: rp::RigidBodyHandle,
    pub curve: Curve,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::physics3d) enum Role {
    Fixed,
    Prescribed,
    Character(BodyId),
    Dynamic,
    SleepingDynamic,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct ColliderTrajectory {
    pub collider: rp::ColliderHandle,
    pub parent: Option<rp::RigidBodyHandle>,
    pub role: Role,
    pub motion: ShapeMotion,
    pub bounds: Aabb,
    pub sensor: bool,
}

#[derive(Clone, Copy)]
pub(super) enum PairClearance {
    Distance(f32),
    Tight { epsilon: f32, up: rp::Vector },
}

impl PairClearance {
    pub(super) fn distance(self) -> f32 {
        match self {
            Self::Distance(distance) => distance,
            Self::Tight { .. } => 0.,
        }
    }

    fn retains_tight_fit(
        self,
        a: (&ColliderTrajectory, &dyn rp::Shape),
        b: (&ColliderTrajectory, &dyn rp::Shape),
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let Self::Tight { epsilon, up } = self else {
            return Ok(false);
        };
        if a.0.sensor || b.0.sensor {
            return Ok(false);
        }
        let (wall, actor) = match (a.0.role, b.0.role) {
            (Role::Fixed, Role::Character(_)) => (a, b),
            (Role::Character(_), Role::Fixed) => (b, a),
            _ => return Ok(false),
        };
        solver_trajectory::tight_face_fits(
            wall.0.motion,
            wall.1,
            actor.0.motion,
            actor.1,
            up,
            epsilon,
            work,
        )
    }
}

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct Hit {
    pub a: ColliderTrajectory,
    pub b: ColliderTrajectory,
    pub cast: CastHit,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct ContactSample {
    pub a: ColliderTrajectory,
    pub b: ColliderTrajectory,
    pub contact: rapier3d::parry::query::Contact,
}

type SensorHitVisitor<'a> = dyn FnMut(ColliderTrajectory, ColliderTrajectory, Time, &mut Work) -> Result<(), TrajectoryError>
    + 'a;

/// One executed cast invocation or that same invocation's error. These are
/// internal path-usage observations; they never stand in for geometry approval.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::physics3d) enum QueryEvent {
    Cast,
    Failure,
}

#[derive(Default)]
pub(in crate::physics3d) struct Scratch {
    colliders: Vec<ColliderTrajectory>,
    contact_manifold: rapier3d::parry::query::ContactManifold<(), ()>,
    prepare_fixed_prefix: bool,
    ready: bool,
    start: Time,
    end: Time,
    // Diagnostic only: at most one failed pair per reusable scene owner,
    // including callers that keep stepping after their first rejected tick.
    #[cfg(test)]
    first_cast_failure_logged: std::sync::atomic::AtomicBool,
}

fn horizontal_character(collider: &ColliderTrajectory) -> bool {
    matches!(collider.role, Role::Character(_))
        && !collider.sensor
        && matches!(collider.motion.curve, Curve::Integrated(k)
            if k.native.angular_velocity == rp::Vector::ZERO
                && k.native.linear_velocity.x != 0.
                && k.native.linear_velocity.y == 0.
                && k.native.linear_velocity.z == 0.)
}

/// A stationary box face can retain a Native rigid contact when the full proposed
/// motion remains within the solver's existing penetration allowance.
fn retains_native_box_contact(
    a: (&ColliderTrajectory, &rp::Collider, &rp::Pose),
    b: (&ColliderTrajectory, &rp::Collider, &rp::Pose),
    error: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let ((fixed, fixed_collider, fixed_pose), (body, collider, pose)) = match (a.0.role, b.0.role) {
        (Role::Fixed | Role::Prescribed, Role::Dynamic) => (a, b),
        (Role::Dynamic, Role::Fixed | Role::Prescribed) => (b, a),
        _ => return Ok(false),
    };
    if fixed.sensor
        || body.sensor
        || fixed_pose.rotation != rp::Rotation::IDENTITY
        || !fixed_collider
            .solver_groups()
            .test(collider.solver_groups())
        || fixed_collider.shape().as_cuboid().is_none()
        || collider.shape().as_cuboid().is_none()
    {
        return Ok(false);
    }
    if fixed.role == Role::Prescribed {
        work.charge(128)?;
        if solver_trajectory::constant_pose(fixed.motion.curve).is_none() {
            return Ok(false);
        }
    }
    let fits = |axis: usize, positive: bool| {
        let (face, bound) = if positive {
            (fixed.bounds.maxs[axis], body.bounds.mins[axis])
        } else {
            (-fixed.bounds.mins[axis], -body.bounds.maxs[axis])
        };
        (f64::from(face) - f64::from(bound)).next_up() <= f64::from(error)
    };
    work.charge(32)?;
    if !(0..3).any(|i| fits(i, true) || fits(i, false)) {
        return Ok(false);
    }
    let contact = solver_trajectory::leaf_contact(
        fixed_pose,
        fixed_collider.shape(),
        pose,
        collider.shape(),
        work,
    )?;
    let normal = contact.normal1;
    let axis = normal.abs().max_position();
    Ok(contact.dist <= 0.
        && contact.dist >= -error
        && normal[axis].abs() == 1.
        && (0..3).all(|i| i == axis || normal[i] == 0.)
        && fits(axis, normal[axis] > 0.))
}

impl Scratch {
    pub(super) fn required_bytes(count: usize) -> Result<usize, TrajectoryError> {
        count
            .checked_mul(std::mem::size_of::<ColliderTrajectory>())
            .and_then(|n| {
                n.checked_add(
                    32 * std::mem::size_of::<rapier3d::parry::query::TrackedContact<()>>(),
                )
            })
            .ok_or(TrajectoryError::WorkLimit)
    }
    /// Build from a complete, sorted actual proposal/continuation census.
    /// No force integration, body query, normalization, clone of a shape or
    /// user callback occurs. Missing awake motion is rejected before querying.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare(
        &mut self,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        trajectories: &[BodyTrajectory],
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        start: Time,
        end: Time,
        max_scratch: usize,
        work: &mut Work,
    ) -> Result<usize, TrajectoryError> {
        self.prepare_impl(
            bodies,
            colliders,
            trajectories,
            characters,
            start,
            end,
            max_scratch,
            work,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn prepare_cached(
        &mut self,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        trajectories: &[BodyTrajectory],
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        start: Time,
        end: Time,
        max_scratch: usize,
        work: &mut Work,
        cache: &mut BoundsCache,
    ) -> Result<usize, TrajectoryError> {
        let result = self.prepare_impl(
            bodies,
            colliders,
            trajectories,
            characters,
            start,
            end,
            max_scratch,
            work,
            Some(&mut *cache),
        );
        if result.is_err() {
            cache.invalidate();
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_impl(
        &mut self,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        trajectories: &[BodyTrajectory],
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        start: Time,
        end: Time,
        max_scratch: usize,
        work: &mut Work,
        mut cache: Option<&mut BoundsCache>,
    ) -> Result<usize, TrajectoryError> {
        self.ready = false;
        if !start.is_finite() || !end.is_finite() || end <= start {
            return Err(TrajectoryError::InvalidTime);
        }
        let count = colliders.len();
        let bytes = Self::required_bytes(count)?;
        if bytes > max_scratch {
            return Err(TrajectoryError::WorkLimit);
        }
        let lookup = if !trajectories.is_empty() {
            usize::BITS - trajectories.len().leading_zeros()
        } else {
            0
        };
        let work_bound = count
            .checked_mul(
                usize::try_from(lookup)
                    .unwrap_or(usize::MAX)
                    .saturating_add(4),
            )
            .and_then(|n| n.checked_add(trajectories.len()))
            .and_then(|n| n.checked_add(colliders.motion_storage_slots()))
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(work_bound).map_err(|_| TrajectoryError::WorkLimit)?)?;
        for pair in trajectories.windows(2) {
            if pair[0].body.into_raw_parts() >= pair[1].body.into_raw_parts() {
                return Err(TrajectoryError::InvalidReference);
            }
        }
        for trajectory in trajectories {
            let (lo, hi) = trajectory.curve.times();
            if lo > start || hi < end || !bodies.contains(trajectory.body) {
                return Err(TrajectoryError::InvalidReference);
            }
        }
        self.colliders
            .try_reserve(count.saturating_sub(self.colliders.len()))
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.contact_manifold.points.clear();
        self.contact_manifold
            .points
            .try_reserve(32)
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.colliders.clear();
        let mut has_rotating_box = false;
        let mut has_horizontal_character = false;
        for (id, collider) in colliders.iter() {
            if !collider.is_enabled() {
                continue;
            }
            let parent = collider.parent();
            let (role, motion) = if let Some(body) = parent {
                let body_value = bodies.get(body).ok_or(TrajectoryError::InvalidReference)?;
                if !body_value.is_enabled() {
                    continue;
                }
                let (slot, generation) = body.into_raw_parts();
                let identity = BodyId { slot, generation };
                let role = if characters.contains_key(&identity) {
                    Role::Character(identity)
                } else if body_value.is_fixed() {
                    Role::Fixed
                } else if body_value.is_kinematic() {
                    Role::Prescribed
                } else if body_value.is_sleeping() {
                    Role::SleepingDynamic
                } else {
                    Role::Dynamic
                };
                let actual = trajectories
                    .binary_search_by_key(&body.into_raw_parts(), |m| m.body.into_raw_parts())
                    .ok()
                    .map(|i| trajectories[i].curve);
                let curve = if let Some(curve) = actual {
                    curve
                } else if body_value.is_fixed()
                    || body_value.is_sleeping()
                    || (body_value.is_kinematic()
                        && body_value.position() == body_value.next_position()
                        && body_value.linvel() == rp::Vector::ZERO
                        && body_value.angvel() == rp::Vector::ZERO)
                {
                    Curve::Constant {
                        pose: body_value
                            .position()
                            .prepend_translation(body_value.local_center_of_mass()),
                        start_time: start,
                        end_time: end,
                    }
                } else {
                    return Err(TrajectoryError::MissingBodyMotion);
                };
                (
                    role,
                    ShapeMotion {
                        curve,
                        local_center: body_value.local_center_of_mass(),
                        local_pose: collider
                            .position_wrt_parent()
                            .copied()
                            .ok_or(TrajectoryError::InvalidReference)?,
                    },
                )
            } else {
                (
                    Role::Fixed,
                    ShapeMotion {
                        curve: Curve::Constant {
                            pose: *collider.position(),
                            start_time: start,
                            end_time: end,
                        },
                        local_center: rp::Vector::ZERO,
                        local_pose: rp::Pose::IDENTITY,
                    },
                )
            };
            let mut actual = ColliderTrajectory {
                collider: id,
                parent,
                role,
                motion,
                // Descriptor only; never consumed as a geometric bound.
                bounds: Aabb::new(rp::Vector::ZERO, rp::Vector::ZERO),
                sensor: collider.is_sensor(),
            };
            actual.bounds = if let Some(cache) = cache.as_deref_mut() {
                cache.bounds(&actual, collider.shape(), start, end, work)?
            } else {
                motion.bounds(collider.shape(), start, end, work)?
            };
            has_rotating_box |= actual.role == Role::Prescribed
                && !actual.sensor
                && matches!(actual.motion.curve, Curve::Integrated(kernel)
                    if kernel.native.angular_velocity.x == 0.
                        && kernel.native.angular_velocity.y == 0.
                        && kernel.native.angular_velocity.z != 0.)
                && collider.shape().as_cuboid().is_some();
            has_horizontal_character |=
                horizontal_character(&actual) && collider.shape().as_capsule().is_some();
            self.colliders.push(actual);
        }
        // Fixed n-based precharge, independent of source handles/allocator or
        // the library sort's compare/swap count. No new heap is used by sort.
        let n = self.colliders.len();
        let log = if n > 0 {
            usize::BITS - n.leading_zeros()
        } else {
            0
        };
        let sort_work = n
            .checked_mul(8)
            .and_then(|n| n.checked_mul(log as usize + 1))
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(sort_work).map_err(|_| TrajectoryError::WorkLimit)?)?;
        self.prepare_fixed_prefix = has_rotating_box && has_horizontal_character;
        self.colliders.sort_unstable_by(|a, b| {
            a.bounds.mins.x.total_cmp(&b.bounds.mins.x).then(
                a.collider
                    .into_raw_parts()
                    .cmp(&b.collider.into_raw_parts()),
            )
        });
        self.start = start;
        self.end = end;
        self.ready = true;
        Ok(bytes)
    }

    /// Actual first solid impact. The trusted owner supplies existing CCD/path
    /// tier and connected-joint eligibility; this method always enforces the
    /// original full collider groups, enabled state, floors and both one-ways.
    /// Broad-phase prefix pruning covers full motion bounds, not sampled poses.
    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub fn first_hit(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        start: Time,
        end: Time,
        clearance: f32,
        time_tolerance: Time,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
    ) -> Result<Option<Hit>, TrajectoryError> {
        self.first_hit_policy(
            colliders,
            policies,
            start,
            end,
            clearance,
            time_tolerance,
            work,
            eligible,
            &|_, _| clearance,
        )
    }
    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub fn first_hit_policy(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        start: Time,
        end: Time,
        clearance: f32,
        time_tolerance: Time,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
        pair_clearance: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> f32,
    ) -> Result<Option<Hit>, TrajectoryError> {
        self.first_hit_origin_policy(
            colliders,
            policies,
            start,
            end,
            clearance,
            time_tolerance,
            work,
            eligible,
            pair_clearance,
            &|_| false,
        )
    }

    /// Explicit prescribed origin-sensor sweep; target sensors remain nonblocking.
    /// Sensor hits provide stop geometry only, never a physical contact row.
    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub fn first_hit_origin_policy(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        start: Time,
        end: Time,
        clearance: f32,
        time_tolerance: Time,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
        pair_clearance: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> f32,
        sweep_origin_sensor: &impl Fn(&ColliderTrajectory) -> bool,
    ) -> Result<Option<Hit>, TrajectoryError> {
        self.first_hit_observed_policy(
            colliders,
            policies,
            start,
            end,
            clearance,
            time_tolerance,
            work,
            eligible,
            pair_clearance,
            sweep_origin_sensor,
            &mut |_, _, _, _| Ok(()),
        )
    }

    /// Caller telemetry precharges its lookup/counter allowance on Cast. Failure
    /// reuses that cached classification and cannot mask the geometry error.
    /// The callback is Rust-internal and may not reenter physics or user code.
    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub fn first_hit_observed_policy(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        start: Time,
        end: Time,
        clearance: f32,
        time_tolerance: Time,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
        pair_clearance: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> f32,
        sweep_origin_sensor: &impl Fn(&ColliderTrajectory) -> bool,
        query_visit: &mut impl FnMut(
            &ColliderTrajectory,
            &ColliderTrajectory,
            QueryEvent,
            &mut Work,
        ) -> Result<(), TrajectoryError>,
    ) -> Result<Option<Hit>, TrajectoryError> {
        self.first_hit_impl(
            colliders,
            policies,
            start,
            end,
            clearance,
            time_tolerance,
            work,
            eligible,
            &|a, b| PairClearance::Distance(pair_clearance(a, b)),
            sweep_origin_sensor,
            query_visit,
            None,
            None,
            0.,
            &[],
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn first_hit_memoized_policy(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        start: Time,
        end: Time,
        clearance: f32,
        time_tolerance: Time,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
        pair_clearance: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> PairClearance,
        sweep_origin_sensor: &impl Fn(&ColliderTrajectory) -> bool,
        query_visit: &mut impl FnMut(
            &ColliderTrajectory,
            &ColliderTrajectory,
            QueryEvent,
            &mut Work,
        ) -> Result<(), TrajectoryError>,
        memo: &mut PairQueries<'_>,
        bounds_cache: Option<&BoundsCache>,
        native_contact_error: f32,
        accepted_peers: &[super::backend::active_constraints::ActiveContact],
    ) -> Result<Option<Hit>, TrajectoryError> {
        if !memo.bound_to(colliders, policies) {
            return Err(TrajectoryError::InvalidReference);
        }
        self.first_hit_impl(
            colliders,
            policies,
            start,
            end,
            clearance,
            time_tolerance,
            work,
            eligible,
            pair_clearance,
            sweep_origin_sensor,
            query_visit,
            Some(memo),
            bounds_cache,
            native_contact_error,
            accepted_peers,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn first_hit_impl(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        start: Time,
        end: Time,
        clearance: f32,
        time_tolerance: Time,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
        pair_clearance: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> PairClearance,
        sweep_origin_sensor: &impl Fn(&ColliderTrajectory) -> bool,
        query_visit: &mut impl FnMut(
            &ColliderTrajectory,
            &ColliderTrajectory,
            QueryEvent,
            &mut Work,
        ) -> Result<(), TrajectoryError>,
        mut memo: Option<&mut PairQueries<'_>>,
        bounds_cache: Option<&BoundsCache>,
        native_contact_error: f32,
        accepted_peers: &[super::backend::active_constraints::ActiveContact],
    ) -> Result<Option<Hit>, TrajectoryError> {
        if !self.ready {
            return Err(TrajectoryError::InvalidReference);
        }
        if !start.is_finite()
            || !end.is_finite()
            || start < self.start
            || end > self.end
            || start >= end
            || !clearance.is_finite()
            || clearance < 0.
            || !native_contact_error.is_finite()
            || native_contact_error < 0.
            || !time_tolerance.is_finite()
            || time_tolerance <= 0.
        {
            return Err(TrajectoryError::InvalidTime);
        }
        #[cfg(test)]
        let diagnostic_first_hit_work_start = work.used;
        let mut first: Option<Hit> = None;
        // A fixed-face hit supplies an upper bound for a horizontal capsule
        // near a rotating driver. Each pair is cast once with the original
        // chronological comparison and pair-key tie break.
        let fixed_prefix = policies.planar && self.prepare_fixed_prefix;
        let order = [true, false].into_iter().skip(usize::from(!fixed_prefix));
        for (fixed_first, i) in
            order.flat_map(|fixed| (0..self.colliders.len()).map(move |i| (fixed, i)))
        {
            let a = self.colliders[i];
            for b in &self.colliders[i + 1..] {
                work.charge(1)?;
                if b.bounds.mins.x > a.bounds.maxs.x + clearance {
                    break;
                }
                let fixed_pair = fixed_prefix
                    && ((a.role == Role::Fixed && horizontal_character(b))
                        || (b.role == Role::Fixed && horizontal_character(&a)));
                if fixed_pair != fixed_first {
                    continue;
                }
                if a.parent.is_some() && a.parent == b.parent {
                    continue;
                }
                if (a.sensor || b.sensor)
                    && !((a.sensor && !b.sensor && sweep_origin_sensor(&a))
                        || (b.sensor && !a.sensor && sweep_origin_sensor(b)))
                {
                    continue;
                }
                if !a.bounds.loosened(clearance).intersects(&b.bounds) || !eligible(&a, b) {
                    continue;
                }
                if a.sensor || b.sensor {
                    // The path-stop sweep only responds to motion. Static
                    // intersections still use the independent sensor events.
                    work.charge(128)?;
                    if solver_trajectory::constant_pose(a.motion.curve).is_some()
                        && solver_trajectory::constant_pose(b.motion.curve).is_some()
                    {
                        continue;
                    }
                }
                let ca = colliders
                    .get(a.collider)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let cb = colliders
                    .get(b.collider)
                    .ok_or(TrajectoryError::InvalidReference)?;
                if !ca.collision_groups().test(cb.collision_groups())
                    || !policies.pair_allows(a.parent, b.parent)
                {
                    continue;
                }
                let margin = pair_clearance(&a, b);
                let distance = margin.distance();
                if !distance.is_finite() || distance < 0. || distance > clearance {
                    return Err(TrajectoryError::InvalidTime);
                }
                let pa = a.motion.pose(start);
                let pb = b.motion.pose(start);
                if !policies.one_way_allows_at(a.collider, &pa, cb.shape(), &pb)
                    || !policies.one_way_allows_at(b.collider, &pb, ca.shape(), &pa)
                {
                    continue;
                }
                if margin.retains_tight_fit((&a, ca.shape()), (b, cb.shape()), work)? {
                    continue;
                }
                if native_contact_error > 0.
                    && distance == 0.
                    && retains_native_box_contact(
                        (&a, ca, &pa),
                        (b, cb, &pb),
                        native_contact_error,
                        work,
                    )?
                {
                    continue;
                }
                let until = first.as_ref().map_or(end, |hit| hit.cast.hit_time);
                if super::backend::finite_coasting::retains_gap(
                    (&a, ca.shape()),
                    (b, cb.shape()),
                    start,
                    until,
                    distance,
                    work,
                )? {
                    continue;
                }
                if !accepted_peers.is_empty()
                    && ca.shape().as_capsule().is_some()
                    && cb.shape().as_capsule().is_some()
                    && matches!((a.role, b.role), (Role::Character(_), Role::Character(_)))
                {
                    work.charge(accepted_peers.len() as u64)?;
                    if accepted_peers
                        .iter()
                        .any(|row| row.is_accepted_peer(&a, b, start))
                        && solver_trajectory::accepted_capsules_separated(
                            a.motion,
                            ca.shape(),
                            b.motion,
                            cb.shape(),
                            start,
                            until,
                            distance,
                            work,
                        )?
                    {
                        continue;
                    }
                }
                let lookup = if let Some(memo) = memo.as_deref_mut() {
                    memo.lookup(&a, b, start, until, distance, time_tolerance, true, work)?
                } else {
                    pair_queries::Lookup::Miss(None)
                };
                let strict_prefix = match &lookup {
                    pair_queries::Lookup::Recheck(_, prefix) => Some(*prefix),
                    _ => None,
                };
                let cast = match lookup {
                    pair_queries::Lookup::Reuse(hit) => hit,
                    pair_queries::Lookup::Miss(slot) | pair_queries::Lookup::Recheck(slot, _) => {
                        // A failed Cast precharge executes no geometry and records no
                        // successful invocation. Error counters need no new lookup.
                        query_visit(&a, b, QueryEvent::Cast, work)?;
                        #[cfg(test)]
                        let diagnostic_query_work_start = work.used;
                        let result = (|| {
                            let stationary = bounds_cache.and_then(BoundsCache::stationary);
                            let mut candidate = None;
                            if let Some(cache) = stationary {
                                candidate = cache.candidate(
                                    &a, ca.shape(), b, cb.shape(), start, until, distance, work,
                                )?;
                                if let Some(result) =
                                    candidate.as_ref().and_then(|candidate| candidate.reused)
                                {
                                    return Ok(result);
                                }
                            }
                            let prepared = if let Some(cache) = bounds_cache
                                .filter(|_| start.to_bits() == self.start.to_bits()
                                    && until.to_bits() == self.end.to_bits())
                            {
                                [
                                    cache.prepared(&a, ca.shape(), start, until, work)?,
                                    cache.prepared(b, cb.shape(), start, until, work)?,
                                ]
                            } else {
                                [None; 2]
                            };
                            let result = solver_trajectory::cast_full_shapes_policy_reusing_bounds(
                                a.motion, ca.shape(), b.motion, cb.shape(), start, until,
                                distance, time_tolerance, work, true, strict_prefix, prepared,
                            )?;
                            if let (Some(cache), Some(candidate)) = (stationary, candidate) {
                                cache.remember(candidate, &result, work)?;
                            }
                            Ok(result)
                        })().inspect_err(|_error| {
                    // Preserve the original typed query error even if a caller
                    // misuses its already-prepaid Failure observation.
                    let _ = query_visit(&a,b,QueryEvent::Failure,work);
                    #[cfg(test)]
                    if !self.first_cast_failure_logged.swap(true,std::sync::atomic::Ordering::Relaxed) {
                        eprintln!("ACTUAL_FIRST_CAST_ERR case={:?} error={_error:?} a={:?} roleA={:?} shapeA={:?} motionA={:?} b={:?} roleB={:?} shapeB={:?} motionB={:?} start={start:.18e} end={until:.18e} clearance={distance} work={}/{} first_hit_work_start={diagnostic_first_hit_work_start} query_work_start={diagnostic_query_work_start} query_work_spent={}",
                            std::thread::current().name(),a.collider,a.role,ca.shape().shape_type(),a.motion,
                            b.collider,b.role,cb.shape().shape_type(),b.motion,work.used,work.limit,
                            work.used-diagnostic_query_work_start);
                        if super::backend::diagnostic_first_hit_case() {
                            eprintln!("C24_QUERY_PHASE case={:?} interval=[{start},{until}] pair={:?}/{:?} native_primary_relative_bits_a={:?} native_primary_relative_bits_b={:?}",
                                std::thread::current().name(),a.collider,b.collider,
                                super::backend::diagnostic_kernel_phases(a.motion.curve,start,until),
                                super::backend::diagnostic_kernel_phases(b.motion.curve,start,until));
                        }
                    }
                });
                        #[cfg(test)]
                        {
                            // Bounded exact-case telemetry from already executed
                            // values only: no pose, query, policy or ledger work.
                            std::thread_local! {
                                static FREE_PAIR_LOGS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
                            }
                            if std::thread::current().name() == Some("physics3d::character_coupling_tests::free_capsule_chain_is_pushed_without_a_false_squeeze_stop") {
                                FREE_PAIR_LOGS.with(|count| {
                                    if count.get() < 512 {
                                        count.set(count.get() + 1);
                                        let observed = result.as_ref().map(|v| (v.hit, v.strictly_clear_start, v.reused));
                                        eprintln!("C81_FREE_PAIR case={:?} ordinal={} context=[{:.18e},{:.18e}] query=[{start:.18e},{until:.18e}] pair={:?}/{:?} roles={:?}/{:?} result={observed:?} work_start={diagnostic_query_work_start} work_end={} spent={} motion_a={:?} motion_b={:?}",
                                            std::thread::current().name(), count.get(), self.start, self.end,
                                            a.collider, b.collider, a.role, b.role, work.used,
                                            work.used - diagnostic_query_work_start, a.motion, b.motion);
                                    }
                                });
                            }
                        }
                        let result = result?;
                        if let Some(memo) = memo.as_deref_mut() {
                            memo.store(
                                slot,
                                a,
                                *b,
                                start,
                                until,
                                distance,
                                time_tolerance,
                                true,
                                result,
                                work,
                            )?;
                        }
                        result.hit
                    }
                };
                if let Some(cast) = cast {
                    // Recheck both policies at actual query-hit geometry too.
                    // An old pose may not invent a blocking one-way face.
                    let pa = a.motion.pose(cast.hit_time);
                    let pb = b.motion.pose(cast.hit_time);
                    if !policies.one_way_allows_at(a.collider, &pa, cb.shape(), &pb)
                        || !policies.one_way_allows_at(b.collider, &pb, ca.shape(), &pa)
                    {
                        continue;
                    }
                    let key = |a: &ColliderTrajectory, b: &ColliderTrajectory| {
                        (a.collider.into_raw_parts(), b.collider.into_raw_parts())
                    };
                    if first.as_ref().is_none_or(|old| {
                        cast.hit_time < old.cast.hit_time
                            || (cast.hit_time == old.cast.hit_time
                                && key(&a, b) < key(&old.a, &old.b))
                    }) {
                        first = Some(Hit { a, b: *b, cast });
                    }
                }
            }
        }
        Ok(first)
    }
    /// Full simultaneous contact census. Contacts are point queries, not TOI0
    /// cast records; caller owns row accumulation and its fallible storage.
    // Geometry, filtering, time, work and result sink remain separate inputs
    // at this geometric query boundary.
    #[allow(clippy::too_many_arguments)]
    pub fn contacts_at(
        &mut self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        time: Time,
        distance: f32,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
        visit: &mut dyn FnMut(ContactSample, &mut Work) -> Result<(), TrajectoryError>,
    ) -> Result<(), TrajectoryError> {
        if !self.ready
            || !time.is_finite()
            || time < self.start
            || time > self.end
            || !distance.is_finite()
            || distance < 0.
        {
            return Err(TrajectoryError::InvalidTime);
        }
        for i in 0..self.colliders.len() {
            let a = self.colliders[i];
            for &b in &self.colliders[i + 1..] {
                work.charge(1)?;
                if b.bounds.mins.x > a.bounds.maxs.x + distance {
                    break;
                }
                if a.parent.is_some() && a.parent == b.parent || a.sensor || b.sensor {
                    continue;
                }
                if !a.bounds.loosened(distance).intersects(&b.bounds) || !eligible(&a, &b) {
                    continue;
                }
                let ca = colliders
                    .get(a.collider)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let cb = colliders
                    .get(b.collider)
                    .ok_or(TrajectoryError::InvalidReference)?;
                if !ca.collision_groups().test(cb.collision_groups())
                    || !policies.pair_allows(a.parent, b.parent)
                {
                    continue;
                }
                let pa = a.motion.pose(time);
                let pb = b.motion.pose(time);
                if !policies.one_way_allows_at(a.collider, &pa, cb.shape(), &pb)
                    || !policies.one_way_allows_at(b.collider, &pb, ca.shape(), &pa)
                {
                    continue;
                }
                solver_trajectory::contacts_full_shapes_with_manifold(
                    a.motion,
                    ca.shape(),
                    b.motion,
                    cb.shape(),
                    time,
                    distance,
                    work,
                    &mut Some(&mut self.contact_manifold),
                    &mut |contact, subshape_a, subshape_b, work| {
                        visit(
                            ContactSample {
                                a,
                                b,
                                contact: contact.with_subshapes(subshape_a, subshape_b),
                            },
                            work,
                        )
                    },
                )?;
            }
        }
        Ok(())
    }

    /// Re-read one previously encountered pair from the current scene. A
    /// retained identity is not a contact: generations, filters, one-way
    /// policy and original full shapes are checked again before emitting it.
    /// The caller supplies a previously witnessed distance, never an enlarged
    /// global skin. This query does not approve any future motion.
    #[allow(clippy::too_many_arguments)]
    pub fn contact_pair_at(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        pair: (rp::ColliderHandle, rp::ColliderHandle),
        time: Time,
        distance: f32,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
    ) -> Result<Option<ContactSample>, TrajectoryError> {
        if !self.ready
            || time < self.start
            || time > self.end
            || !time.is_finite()
            || !distance.is_finite()
            || distance < 0.
        {
            return Err(TrajectoryError::InvalidTime);
        }
        let policy_records = policies.one_way.len().max(policies.spans.len()).max(1);
        let policy_log = usize::BITS - policy_records.leading_zeros();
        work.charge(
            (self.colliders.len() as u64)
                .checked_mul(2)
                .and_then(|n| n.checked_add(32 + 8 * u64::from(policy_log)))
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        let Some(a) = self
            .colliders
            .iter()
            .find(|v| v.collider == pair.0)
            .copied()
        else {
            return Ok(None);
        };
        let Some(b) = self
            .colliders
            .iter()
            .find(|v| v.collider == pair.1)
            .copied()
        else {
            return Ok(None);
        };
        if a.sensor || b.sensor || (a.parent.is_some() && a.parent == b.parent) || !eligible(&a, &b)
        {
            return Ok(None);
        }
        let (Some(ca), Some(cb)) = (colliders.get(a.collider), colliders.get(b.collider)) else {
            return Ok(None);
        };
        if !ca.collision_groups().test(cb.collision_groups())
            || !policies.pair_allows(a.parent, b.parent)
        {
            return Ok(None);
        }
        let pa = a.motion.pose(time);
        let pb = b.motion.pose(time);
        if !policies.one_way_allows_at(a.collider, &pa, cb.shape(), &pb)
            || !policies.one_way_allows_at(b.collider, &pb, ca.shape(), &pa)
        {
            return Ok(None);
        }
        let mut closest: Option<ContactSample> = None;
        solver_trajectory::contacts_full_shapes(
            a.motion,
            ca.shape(),
            b.motion,
            cb.shape(),
            time,
            distance,
            work,
            &mut |contact, subshape_a, subshape_b, work| {
                work.charge(1)?;
                if closest
                    .as_ref()
                    .is_none_or(|old| contact.dist < old.contact.dist)
                {
                    closest = Some(ContactSample {
                        a,
                        b,
                        contact: contact.with_subshapes(subshape_a, subshape_b),
                    });
                }
                Ok(())
            },
        )?;
        Ok(closest)
    }

    /// Actual sensor candidates. Layer/intersection filtering is preserved;
    /// one-way solid-response policy does not suppress sensor intersections.
    // Geometry, filtering, interval, work and result sink remain explicit at
    // this geometric query boundary.
    #[allow(clippy::too_many_arguments)]
    pub fn sensor_hits(
        &self,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        start: Time,
        end: Time,
        work: &mut Work,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
        visit: &mut SensorHitVisitor<'_>,
    ) -> Result<(), TrajectoryError> {
        if !self.ready || start < self.start || end > self.end || start >= end {
            return Err(TrajectoryError::InvalidTime);
        }
        for i in 0..self.colliders.len() {
            let a = self.colliders[i];
            for &b in &self.colliders[i + 1..] {
                work.charge(1)?;
                if b.bounds.mins.x > a.bounds.maxs.x {
                    break;
                }
                if a.parent.is_some() && a.parent == b.parent
                    || !(a.sensor || b.sensor)
                    || !a.bounds.intersects(&b.bounds)
                    || !eligible(&a, &b)
                {
                    continue;
                }
                let ca = colliders
                    .get(a.collider)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let cb = colliders
                    .get(b.collider)
                    .ok_or(TrajectoryError::InvalidReference)?;
                if !ca.collision_groups().test(cb.collision_groups())
                    || !policies.pair_allows(a.parent, b.parent)
                    || !(ca.active_events() | cb.active_events())
                        .contains(rp::ActiveEvents::COLLISION_EVENTS)
                {
                    continue;
                }
                if let Some(hit) = solver_trajectory::cast_full_shapes(
                    a.motion,
                    ca.shape(),
                    b.motion,
                    cb.shape(),
                    start,
                    end,
                    0.,
                    ((end - start) * 1e-6).max(f64::from(f32::MIN_POSITIVE)),
                    work,
                )? {
                    visit(a, b, hit.hit_time, work)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
