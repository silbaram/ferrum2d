//! Tick-local exact-kernel trajectories and continuous separating-plane proof.
//! A successful proof covers the full interval, not sampled endpoint poses.
use rapier3d::parry::query::sweep_toi::{Sweep, ToiProxy};
use rapier3d::prelude as rp;
mod box_capsule_sensor;
mod clock;
mod feature_contact;
mod positive_initial_support;
mod rounded;
mod supported_capsule_face;
pub(in crate::physics3d) use rounded::static_signed_support_lower;
pub(super) use rounded::{offset_box_ball_separated, tight_face_fits};
mod world_contact;
use super::geometry::same_pose_bits;
pub(super) use super::motion_error::TrajectoryError;
pub(super) use super::motion_time::{Domain, Time};
pub(super) use clock::Kernel;
pub(super) use rounded::{normal_action_range, straight_primitive_bounds};

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub(super) enum Curve {
    Integrated(Kernel),
    /// A stationary or instantaneous endpoint placement, with no invented dt.
    Constant {
        pose: rp::Pose,
        start_time: Time,
        end_time: Time,
    },
    Ccd {
        sweep: Sweep,
        start_time: Time,
        end_time: Time,
    },
    /// An upright character's COM follows a carrier point without rotating the
    /// capsule. Relative locomotion stays world-space; this is not a chord.
    Anchored {
        carrier: Kernel,
        anchor: rp::Vector,
        offset: rp::Vector,
        linear_velocity: rp::Vector,
        rotation: rp::Rotation,
    },
}

#[derive(Clone, Copy, Debug, serde::Serialize, serde::Deserialize)]
pub(super) struct ShapeMotion {
    pub curve: Curve,
    /// Local body COM; the integration's poses are already at the world COM.
    pub local_center: rp::Vector,
    /// Original full-shape frame relative to the body origin.
    pub local_pose: rp::Pose,
}

pub(super) use super::motion_work::Work;

#[cfg(test)]
pub(super) fn test_work_failure_selected() -> bool {
    matches!(std::thread::current().name(),
        Some("physics3d::character_coupling_tests::coupled_push_preserves_tangential_input_and_planar_locks"
        | "physics3d::character_coupling_tests::excluded_capsule_pairs_do_not_transmit_pushes_or_consume_pair_query_work"
        | "physics3d::character_coupling_tests::incoming_wall_push_propagates_to_another_capsule_with_free_space"
        | "physics3d::character_coupling_tests::oblique_wall_normals_push_a_capsule_pair_in_the_actual_world_direction"
        | "physics3d::character_tests::elevator_support_is_evaluated_after_the_platform_moves"
        | "physics3d::angular_ccd_bounds_tests::angular_ccd_small_angle_long_offset_sparse_and_dense_candidate_cost"))
}
#[cfg(test)]
#[track_caller]
pub(super) fn test_work_failure(requested: u64, used: u64, limit: u64) {
    let caller = std::panic::Location::caller();
    eprintln!(
        "ACTUAL_WORK_DENIED case={:?} caller={}:{} requested={requested} used={used} limit={limit}",
        std::thread::current().name(),
        caller.file(),
        caller.line()
    );
    if matches!(
        std::thread::current().name(),
        Some("physics3d::character_tests::elevator_support_is_evaluated_after_the_platform_moves")
    ) {
        eprintln!(
            "ACTUAL_WORK_BACKTRACE case={:?}\n{}",
            std::thread::current().name(),
            std::backtrace::Backtrace::force_capture()
        );
    }
}

/// Prove numeric invariance of the separate post-add expression
/// `actual_com + RN(rate * elapsed)` for the complete original COM curve.
/// The caller must bound *that added term's* F32 elapsed by
/// `max_addition_seconds`, including any logical/native clock distinction.
/// This neither changes a safe pose nor proves `(velocity + rate)` kernel
/// equivalence, support lifetime, or physical momentum/impulse ownership.
pub(super) fn linear_com_addition_invisible(
    curve: Curve,
    rate: rp::Vector,
    start: Time,
    end: Time,
    max_addition_seconds: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    rounded::linear_com_addition_invisible(curve, rate, start, end, max_addition_seconds, work)
}

// A rebased zero-rate kernel may have different clock labels while every
// original COM pose bit is unchanged. This is a complete expression proof:
// for every positive finite dt both zero products have the same signed-zero
// bits, so the original quaternion normalization and translation are constant.
// Check the two stored branches and the one interior expression separately;
// equal endpoint poses alone are insufficient for a rotating/normalizing body.
pub(super) fn constant_pose(curve: Curve) -> Option<rp::Pose> {
    match curve {
        Curve::Constant { pose, .. } => pose.is_finite().then_some(pose),
        Curve::Integrated(k) => {
            let native = k.native;
            if native.linear_velocity != rp::Vector::ZERO
                || native.angular_velocity != rp::Vector::ZERO
                || !native.integration_seconds.is_finite()
                || native.integration_seconds <= 0.
                || !native.motion.start.is_finite()
                || !same_pose_bits(native.motion.start, native.motion.end)
            {
                return None;
            }
            // No positive representable interior dt exists for the smallest
            // positive h. Otherwise this evaluates the same fixed zero-rate
            // expression as every positive interior dt, not a sampled path.
            let dt = native.integration_seconds.next_down();
            if dt > 0.
                && !same_pose_bits(native.motion.start, native.position_at_integration_time(dt))
            {
                return None;
            }
            Some(native.motion.start)
        }
        Curve::Anchored { .. } | Curve::Ccd { .. } => None,
    }
}

impl Curve {
    /// Move the observation clock without changing its geometric time law.
    #[cfg(test)]
    pub fn shifted(self, offset: Time) -> Self {
        let shift = |m: Kernel| m.shifted(offset);
        match self {
            Self::Integrated(m) => Self::Integrated(shift(m)),
            Self::Constant {
                pose,
                start_time,
                end_time,
            } => Self::Constant {
                pose,
                start_time: start_time + offset,
                end_time: end_time + offset,
            },
            Self::Ccd {
                sweep,
                start_time,
                end_time,
            } => Self::Ccd {
                sweep,
                start_time: start_time + offset,
                end_time: end_time + offset,
            },
            Self::Anchored {
                carrier,
                anchor,
                offset: position,
                linear_velocity,
                rotation,
            } => Self::Anchored {
                carrier: shift(carrier),
                anchor,
                offset: position,
                linear_velocity,
                rotation,
            },
        }
    }

    pub fn times(self) -> (Time, Time) {
        match self {
            Self::Integrated(m) => (m.domain.start, m.domain.end),
            Self::Constant {
                start_time,
                end_time,
                ..
            } => (start_time, end_time),
            Self::Anchored { carrier, .. } => (carrier.domain.start, carrier.domain.end),
            Self::Ccd {
                start_time,
                end_time,
                ..
            } => (start_time, end_time),
        }
    }
    /// The accepted solver/CCD kernel, with no endpoint slerp substitution.
    pub fn com_pose(self, time: Time) -> rp::Pose {
        match self {
            Self::Integrated(m) => m.position_at_time(time),
            Self::Constant { pose, .. } => pose,
            Self::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            } => {
                let pose = carrier.position_at_time(time);
                let dt = (time - carrier.domain.start).clamp(0., carrier.domain.duration());
                rp::Pose::from_parts(
                    pose.translation
                        + pose.rotation * anchor
                        + offset
                        + linear_velocity * dt as f32,
                    rotation,
                )
            }
            Self::Ccd {
                sweep,
                start_time,
                end_time,
            } => {
                let t = ((time - start_time) / (end_time - start_time)).clamp(0., 1.);
                sweep
                    .transform_at(t as f32)
                    .prepend_translation(sweep.local_center)
            }
        }
    }
}

impl ShapeMotion {
    fn translation_kernel(self) -> Option<Kernel> {
        let Curve::Integrated(kernel) = self.curve else {
            return None;
        };
        let native = kernel.native;
        (kernel.has_identity_orientation()
            && self.local_pose.rotation == rp::Rotation::IDENTITY
            && native.motion.start.translation
                + native.linear_velocity * native.integration_seconds
                == native.motion.end.translation)
            .then_some(kernel)
    }

    pub fn pose(self, time: Time) -> rp::Pose {
        self.curve
            .com_pose(time)
            .prepend_translation(-self.local_center)
            * self.local_pose
    }

    /// Original collider pose with the cost of the evaluated Native branch.
    /// An interior logical time can still round to a stored physical endpoint.
    pub(in crate::physics3d) fn metered_pose(
        self,
        time: Time,
        work: &mut Work,
    ) -> Result<rp::Pose, TrajectoryError> {
        let translation = match self.curve {
            Curve::Constant { pose, .. }
                if pose.rotation.to_array().map(f32::to_bits)
                    == rp::Rotation::IDENTITY.to_array().map(f32::to_bits) =>
            {
                work.charge(64)?;
                pose.translation
            }
            Curve::Integrated(k) if k.has_identity_orientation() => {
                work.charge(64)?;
                let dt = k.local_delta(time);
                if time <= k.domain.start || dt <= 0. {
                    k.native.motion.start.translation
                } else if time >= k.domain.end || dt >= k.native.integration_seconds {
                    k.native.motion.end.translation
                } else {
                    k.native.motion.start.translation + k.native.linear_velocity * dt
                }
            }
            _ => {
                work.charge(256)?;
                return Ok(self.pose(time));
            }
        };
        let origin = rp::Pose::from_translation(translation);
        Ok(origin.prepend_translation(-self.local_center) * self.local_pose)
    }

    pub fn linear_angular_velocity(self, time: Time) -> (rp::Vector, rp::Vector) {
        match self.curve {
            Curve::Integrated(m) => (
                m.linear_velocity_at_time(),
                m.angular_velocity_at_time(time),
            ),
            Curve::Constant { .. } => (rp::Vector::ZERO, rp::Vector::ZERO),
            Curve::Anchored {
                carrier,
                anchor,
                linear_velocity,
                ..
            } => {
                let pose = carrier.position_at_time(time);
                (
                    carrier.linear_velocity_at_time()
                        + linear_velocity
                        + carrier
                            .angular_velocity_at_time(time)
                            .cross(pose.rotation * anchor),
                    rp::Vector::ZERO,
                )
            }
            Curve::Ccd {
                sweep,
                start_time,
                end_time,
            } => {
                let dt = end_time - start_time;
                let t = ((time - start_time) / dt).clamp(0., 1.) as f32;
                let mut q2 = sweep.q2;
                if sweep.q1.dot(q2) < 0. {
                    q2 = -q2;
                }
                let q = sweep.q1 * (1. - t) + q2 * t;
                let derivative = (q2 - sweep.q1) * (1. / dt) as f32;
                let angular = derivative * q.conjugate();
                let norm = q.length_squared();
                (
                    (sweep.c2 - sweep.c1) / dt as f32,
                    rp::Vector::new(angular.x, angular.y, angular.z) * (2. / norm),
                )
            }
        }
    }
    pub fn point_velocity(self, time: Time, point: rp::Vector) -> rp::Vector {
        let (linear, angular) = self.linear_angular_velocity(time);
        let center = self.curve.com_pose(time).translation;
        linear + angular.cross(point - center)
    }

    fn has_integrated_spin(self) -> bool {
        matches!(self.curve, Curve::Integrated(kernel)
            if kernel.native.angular_velocity != rp::Vector::ZERO)
    }

    fn is_single_axis_spin(self) -> bool {
        let Curve::Integrated(kernel) = self.curve else {
            return false;
        };
        if self.local_pose.rotation != rp::Rotation::IDENTITY
            || kernel.native.angular_velocity == rp::Vector::ZERO
        {
            return false;
        }
        let start = kernel.native.motion.start.rotation.to_array();
        let end = kernel.native.motion.end.rotation.to_array();
        (0..3)
            .filter(|&i| start[i] != 0. || end[i] != 0. || kernel.native.angular_velocity[i] != 0.)
            .count()
            == 1
    }

    fn is_fixed_axis_aligned(self) -> bool {
        self.local_pose.rotation == rp::Rotation::IDENTITY
            && constant_pose(self.curve).is_some_and(|pose| pose.rotation == rp::Rotation::IDENTITY)
    }

    /// A ball whose collider frame is its body's center of mass has a
    /// rotation-invariant ToiProxy image: one center point plus its world
    /// radius. The Integrated kernel advances translation as
    /// `T0 + v * dt` without reading orientation, so the same kernel without
    /// spin keeps every logical-time center. Any other shape, offset or
    /// already translation-only kernel has no twin.
    fn centered_ball_translation_twin(self, shape: &dyn rp::Shape) -> Option<Self> {
        let Curve::Integrated(kernel) = self.curve else {
            return None;
        };
        if shape.as_ball().is_none()
            || self.local_center != rp::Vector::ZERO
            || self.local_pose.translation != rp::Vector::ZERO
            || self.local_pose.rotation != rp::Rotation::IDENTITY
            || kernel.has_identity_orientation()
        {
            return None;
        }
        let mut native = kernel.native;
        native.angular_velocity = rp::Vector::ZERO;
        native.motion.start.rotation = rp::Rotation::IDENTITY;
        native.motion.end.rotation = rp::Rotation::IDENTITY;
        Some(Self {
            curve: Curve::Integrated(Kernel::from_native(native, kernel.domain).ok()?),
            ..self
        })
    }

    /// An enclosure of every original F32 full-shape output in this interval.
    /// It includes stored Native endpoints, the normalized interior law and
    /// both original local/world-radius paths. This is only broad phase;
    /// disjoint endpoint poses or a presumed unit quaternion are insufficient.
    /// All preparation and adaptive subdivision use the caller's Work ledger.
    pub fn bounds(
        self,
        shape: &dyn rp::Shape,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<rapier3d::parry::bounding_volume::Aabb, TrajectoryError> {
        rounded::whole_bounds(self, shape, start, end, work)
    }

    fn speed_bounds(self) -> Result<(f64, f64), TrajectoryError> {
        let (linear, angular) = match self.curve {
            Curve::Constant { .. } => (0., 0.),
            Curve::Integrated(m) => (
                f64::from(m.linear_velocity_at_time().length()),
                f64::from(m.native.angular_velocity.length())
                    * f64::from(m.native.integration_seconds)
                    / m.domain.duration(),
            ),
            Curve::Anchored {
                carrier,
                anchor,
                linear_velocity,
                ..
            } => {
                let angular = f64::from(carrier.native.angular_velocity.length())
                    * f64::from(carrier.native.integration_seconds)
                    / carrier.domain.duration();
                (
                    f64::from(carrier.linear_velocity_at_time().length())
                        + f64::from(linear_velocity.length())
                        + angular * f64::from(anchor.length()),
                    0.,
                )
            }
            Curve::Ccd {
                start_time,
                end_time,
                ..
            } => {
                let m = self.polynomial(start_time, end_time)?;
                let [a, b, c] = m.denominator;
                let t = if c > 0. {
                    (-b / (2. * c)).clamp(0., 1.)
                } else {
                    0.
                };
                let norm = (a + b * t + c * t * t).sqrt();
                (
                    dot3(m.delta, m.delta).sqrt() / (end_time - start_time),
                    2. * dot4(m.dq, m.dq).sqrt() / norm / (end_time - start_time),
                )
            }
        };
        if !linear.is_finite() || !angular.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok((linear, angular))
    }

    /// Encloses an entire other full shape in this shape's local frame for
    /// every time in the interval. The radius uses derivative bounds, not
    /// sampled orientations; it is only broad-phase culling.
    fn relative_query_bounds(
        self,
        other: Self,
        shape: &dyn rp::Shape,
        start: Time,
        end: Time,
    ) -> Result<rapier3d::parry::bounding_volume::Aabb, TrajectoryError> {
        let sphere = shape.compute_local_bounding_sphere();
        let center = other.pose(start) * sphere.center;
        let arm = (other.local_pose * sphere.center - other.local_center).length();
        let (va, wa) = other.speed_bounds()?;
        let (vb, wb) = self.speed_bounds()?;
        let dt = end - start;
        let speed = va + wa * f64::from(arm);
        let distance = f64::from((center - self.curve.com_pose(start).translation).length())
            + (speed + vb) * dt;
        let radius = f64::from(sphere.radius) + (speed + vb + wb * distance) * dt;
        if !radius.is_finite() || radius > f64::from(f32::MAX) {
            return Err(TrajectoryError::NonFinite);
        }
        let radius = radius as f32;
        // Round broad-phase radius outward instead of silently narrowing the
        // f64 derivative bound during conversion to f32.
        let radius =
            if f64::from(radius) < f64::from(sphere.radius) + (speed + vb + wb * distance) * dt {
                f32::from_bits(radius.to_bits() + 1)
            } else {
                radius
            };
        let center = self.pose(start).inverse_transform_point(center);
        Ok(rapier3d::parry::bounding_volume::Aabb::from_half_extents(
            center,
            rp::Vector::splat(radius),
        ))
    }

    /// Exact support-cloud certificate for one fixed world separating axis.
    /// Both shapes must be represented by their full point cloud plus original
    /// radius (sphere/capsule/box/hull/triangle). Compound/terrain callers must
    /// visit every applicable real leaf; a missing leaf is never certified.
    ///
    /// Each normalized affine-quaternion vertex projection is N3(u)/D2(u).
    /// D2=|q0+dq*u|²>0. Clearing the two positive denominators gives P5(u).
    /// Nonnegative Bernstein coefficients prove separation for every u∈[0,1].
    /// A false result means only "not certified", never "collision".
    #[allow(clippy::too_many_arguments)]
    pub fn separated(
        self,
        shape: &dyn rp::Shape,
        other: Self,
        other_shape: &dyn rp::Shape,
        normal: rp::Vector,
        start: Time,
        end: Time,
        clearance: f32,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        // For balls the query's two rounded radius subtractions can report
        // contact while an ideal support-plane gap is positive. Use the
        // complete original F32 query-output certificate for this pair.
        if shape.as_ball().is_some() && other_shape.as_ball().is_some() {
            return rounded::separated(
                self,
                shape,
                other,
                other_shape,
                normal,
                start,
                end,
                clearance,
                work,
            );
        }
        if self.analytic_separated(
            shape,
            other,
            other_shape,
            normal,
            start,
            end,
            clearance,
            work,
        )? {
            return Ok(true);
        }
        rounded::separated(
            self,
            shape,
            other,
            other_shape,
            normal,
            start,
            end,
            clearance,
            work,
        )
    }

    // Retain the original continuous polynomial proof. The additional owner
    // below only certifies an exhaustively bounded image of the original
    // rounded kernel, never an endpoint interpolation or sampled no-hit.
    #[allow(clippy::too_many_arguments)]
    fn analytic_separated(
        self,
        shape: &dyn rp::Shape,
        other: Self,
        other_shape: &dyn rp::Shape,
        normal: rp::Vector,
        start: Time,
        end: Time,
        clearance: f32,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        work.charge(1)?;
        if !start.is_finite()
            || !end.is_finite()
            || start > end
            || !normal.is_finite()
            || !clearance.is_finite()
        {
            return Err(TrajectoryError::InvalidTime);
        }
        let norm = normal.length();
        if norm == 0. || !norm.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let normal = normal / norm;
        let a = ToiProxy::from_shape(shape).ok_or(TrajectoryError::UnsupportedShape)?;
        let b = ToiProxy::from_shape(other_shape).ok_or(TrajectoryError::UnsupportedShape)?;
        let ma = self.polynomial(start, end)?;
        let mb = other.polynomial(start, end)?;
        // Admitted Rotation values are unit within a tolerance, not an
        // exact unit-type invariant. The linearized kernel normalizes interior
        // quaternions but returns its stored endpoints verbatim. Certify those
        // actual endpoint support clouds too when either norm is not exactly1.
        for time in [start, end] {
            let qa = self.pose(time);
            let qb = other.pose(time);
            if qa.rotation.length_squared() == 1. && qb.rotation.length_squared() == 1. {
                continue;
            }
            work.charge(
                u64::try_from(a.points().len() + b.points().len())
                    .map_err(|_| TrajectoryError::WorkLimit)?
                    .checked_mul(128)
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            let axis = normal.to_array().map(f64::from);
            let project = |p: rp::Vector| dot3(p.to_array().map(f64::from), axis);
            let hi = a
                .points()
                .iter()
                .map(|&p| project(qa * p))
                .fold(f64::NEG_INFINITY, f64::max);
            let lo = b
                .points()
                .iter()
                .map(|&p| project(qb * p))
                .fold(f64::INFINITY, f64::min);
            if lo - hi
                < (f64::from(a.radius) + f64::from(b.radius) + f64::from(clearance))
                    * dot3(axis, axis).sqrt()
            {
                return Ok(false);
            }
        }
        let origin = ma.center;
        let axis = normal.to_array().map(f64::from);
        let radius = (f64::from(a.radius) + f64::from(b.radius) + f64::from(clearance))
            * dot3(axis, axis).sqrt();
        let denominator = mul(&ma.denominator, &mb.denominator);
        // Validate denominator on this entire interval. This is a quaternion
        // norm squared, not an arbitrary fitted polynomial. Integrated q0·dq=0;
        // CCD shortest-arc endpoint quaternions cannot cross the zero vector.
        if !ma.positive_norm() || !mb.positive_norm() {
            return Err(TrajectoryError::NonFinite);
        }
        // Integrated translation evaluates RN(T0 + RN(v * Native_dt)); equal
        // velocities can still change a relative gap across different COM
        // binades. Anchored additionally regroups the original COM add chain.
        // Neither ideal polynomial encloses those original F32 output cells.
        // A translation-only shared Native-dt proof can still enclose both
        // original radius graphs with explicit RN errors. Otherwise preserve
        // the existing rounded fallback, never the unqualified ideal result.
        if matches!(self.curve, Curve::Anchored { .. })
            || matches!(other.curve, Curve::Anchored { .. })
        {
            return rounded::monotone_capsules_separated(
                self,
                shape,
                other,
                other_shape,
                normal,
                start,
                end,
                clearance,
                work,
            );
        }
        if matches!(self.curve, Curve::Integrated(_)) || matches!(other.curve, Curve::Integrated(_))
        {
            return rounded::integrated_linear_separated(
                self, &a, other, &b, normal, start, end, clearance, work,
            );
        }
        for &pa in a.points() {
            for &pb in b.points() {
                // Precharge each complete point-pair/degree-5 proof before
                // transforming or traversing its coordinates. No heap scratch.
                work.charge(128)?;
                let na = ma.project(self.local_pose * pa - self.local_center, normal, origin);
                let nb = mb.project(other.local_pose * pb - other.local_center, normal, origin);
                let an = mul(&na, &mb.denominator);
                let bn = mul(&nb, &ma.denominator);
                let mut separation = [0.; 6];
                for i in 0..6 {
                    separation[i] = bn[i] - an[i] - radius * denominator[i];
                }
                if !nonnegative_bernstein(separation)? {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }

    fn polynomial(self, start: Time, end: Time) -> Result<PolynomialMotion, TrajectoryError> {
        let (from, to) = self.curve.times();
        if start < from
            || end > to
            || to < from
            || (to == from && !matches!(self.curve, Curve::Constant { .. }))
        {
            return Err(TrajectoryError::InvalidTime);
        }
        let duration = to - from;
        let offset = start - from;
        let span = end - start;
        let mut anchored = None;
        let (q, dq, center, velocity) = match self.curve {
            Curve::Constant { pose, .. } => {
                anchored = Some((rp::Vector::ZERO, pose.rotation));
                (
                    [0., 0., 0., 1.],
                    [0.; 4],
                    pose.translation.to_array().map(f64::from),
                    [0.; 3],
                )
            }
            Curve::Integrated(m) => {
                let q = m.native.motion.start.rotation.to_array().map(f64::from);
                let ratio = f64::from(m.native.integration_seconds) / duration;
                let w = m
                    .native
                    .angular_velocity
                    .to_array()
                    .map(|v| f64::from(v) * 0.5 * ratio);
                let dq = quaternion_product([w[0], w[1], w[2], 0.], q);
                (
                    q,
                    dq,
                    m.native.motion.start.translation.to_array().map(f64::from),
                    m.native
                        .linear_velocity
                        .to_array()
                        .map(|v| f64::from(v) * ratio),
                )
            }
            Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            } => {
                let q = carrier
                    .native
                    .motion
                    .start
                    .rotation
                    .to_array()
                    .map(f64::from);
                let ratio = f64::from(carrier.native.integration_seconds) / duration;
                let w = carrier
                    .native
                    .angular_velocity
                    .to_array()
                    .map(|v| f64::from(v) * 0.5 * ratio);
                let dq = quaternion_product([w[0], w[1], w[2], 0.], q);
                anchored = Some((anchor, rotation));
                (
                    q,
                    dq,
                    (carrier.native.motion.start.translation + offset)
                        .to_array()
                        .map(f64::from),
                    std::array::from_fn(|i| {
                        f64::from(carrier.native.linear_velocity[i]) * ratio
                            + f64::from(linear_velocity[i])
                    }),
                )
            }
            Curve::Ccd { sweep, .. } => {
                let q = sweep.q1.to_array().map(f64::from);
                let mut next = sweep.q2.to_array().map(f64::from);
                if q.iter().zip(next).map(|(a, b)| a * b).sum::<f64>() < 0. {
                    next = next.map(|v| -v);
                }
                let dq = std::array::from_fn(|i| (next[i] - q[i]) / duration);
                let center = sweep.c1.to_array().map(f64::from);
                let velocity = ((sweep.c2 - sweep.c1) / (to - from) as f32)
                    .to_array()
                    .map(f64::from);
                (q, dq, center, velocity)
            }
        };
        let q = std::array::from_fn(|i| q[i] + dq[i] * offset);
        let dq = dq.map(|v| v * span);
        let center = std::array::from_fn(|i| center[i] + velocity[i] * offset);
        let delta = velocity.map(|v| v * span);
        let denominator = [dot4(q, q), 2. * dot4(q, dq), dot4(dq, dq)];
        if q.iter()
            .chain(dq.iter())
            .chain(center.iter())
            .chain(delta.iter())
            .chain(denominator.iter())
            .any(|v| !v.is_finite())
        {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(PolynomialMotion {
            q,
            dq,
            center,
            delta,
            denominator,
            anchored,
        })
    }
}

struct PolynomialMotion {
    q: [f64; 4],
    dq: [f64; 4],
    center: [f64; 3],
    delta: [f64; 3],
    denominator: [f64; 3],
    anchored: Option<(rp::Vector, rp::Rotation)>,
}
impl PolynomialMotion {
    fn positive_norm(&self) -> bool {
        let [a, b, c] = self.denominator;
        let t = if c > 0. {
            (-b / (2. * c)).clamp(0., 1.)
        } else {
            0.
        };
        a + b * t + c * t * t > 0.
    }
    fn project(&self, point: rp::Vector, normal: rp::Vector, origin: [f64; 3]) -> [f64; 4] {
        let (rotating, constant) = self
            .anchored
            .map_or((point, rp::Vector::ZERO), |(anchor, rotation)| {
                (anchor, rotation * point)
            });
        let point = rotating.to_array().map(f64::from);
        let constant = constant.to_array().map(f64::from);
        let normal = normal.to_array().map(f64::from);
        let a = rotate_numerator(self.q, point);
        let c = rotate_numerator(self.dq, point);
        let sum = std::array::from_fn(|i| self.q[i] + self.dq[i]);
        let middle = rotate_numerator(sum, point);
        let b = std::array::from_fn(|i| middle[i] - a[i] - c[i]);
        let p = dot3(
            std::array::from_fn(|i| self.center[i] + constant[i] - origin[i]),
            normal,
        );
        let v = dot3(self.delta, normal);
        let d = self.denominator;
        [
            p * d[0] + dot3(a, normal),
            p * d[1] + v * d[0] + dot3(b, normal),
            p * d[2] + v * d[1] + dot3(c, normal),
            v * d[2],
        ]
    }
}

fn quaternion_product(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}
fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn dot4(a: [f64; 4], b: [f64; 4]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn rotate_numerator(q: [f64; 4], v: [f64; 3]) -> [f64; 3] {
    let u = [q[0], q[1], q[2]];
    let uv = dot3(u, v);
    let k = q[3] * q[3] - dot3(u, u);
    let cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    std::array::from_fn(|i| k * v[i] + 2. * u[i] * uv + 2. * q[3] * cross[i])
}
fn mul<const A: usize, const B: usize>(a: &[f64; A], b: &[f64; B]) -> [f64; 6] {
    let mut out = [0.; 6];
    for (i, a) in a.iter().enumerate() {
        for (j, b) in b.iter().enumerate() {
            out[i + j] += a * b;
        }
    }
    out
}
fn nonnegative_bernstein(power: [f64; 6]) -> Result<bool, TrajectoryError> {
    const CHOOSE: [[u32; 6]; 6] = [
        [1, 0, 0, 0, 0, 0],
        [1, 1, 0, 0, 0, 0],
        [1, 2, 1, 0, 0, 0],
        [1, 3, 3, 1, 0, 0],
        [1, 4, 6, 4, 1, 0],
        [1, 5, 10, 10, 5, 1],
    ];
    if power.iter().any(|v| !v.is_finite()) {
        return Err(TrajectoryError::NonFinite);
    }
    // Forward-error guard for these fixed-degree f64 sums. It does not claim
    // interval-rounded f32 world geometry or an exact real-arithmetic engine.
    let error = power.iter().map(|v| v.abs()).sum::<f64>() * 64. * f64::EPSILON;
    for (k, choose) in CHOOSE.iter().enumerate() {
        let b = (0..=k)
            .map(|i| power[i] * f64::from(choose[i]) / f64::from(CHOOSE[5][i]))
            .sum::<f64>();
        if !b.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if b < error && b != 0. {
            return Ok(false);
        }
    }
    Ok(true)
}

/// First actual contact bracket. `safe_time` is the last certified prefix;
/// `hit_time` has actual geometry within `clearance`. They are not a fabricated
/// TOI or an assertion that the two values are mathematically identical.
#[derive(Clone, Copy, Debug)]
pub(super) struct CastHit {
    pub safe_time: Time,
    pub hit_time: Time,
    pub contact: rapier3d::parry::query::Contact,
    pub subshape_a: u32,
    pub subshape_b: u32,
}

#[derive(Clone, Copy)]
struct SearchInterval {
    start: Time,
    end: Time,
    left: rapier3d::parry::query::Contact,
    right: rapier3d::parry::query::Contact,
    left_world_strict: bool,
    right_world_strict: bool,
    depth: u8,
}

impl SearchInterval {
    fn close_at_point(mut self, time: Time, contact: rapier3d::parry::query::Contact) -> Self {
        // Only a verified strict interior point reaches this method. First
        // contact is no later than it; the suffix cannot affect that search.
        // The caller still admits the whole earlier prefix and original tol.
        self.end = time;
        self.right = contact;
        self.right_world_strict = true;
        self
    }
}

/// Initial overlap allowance in the original full support geometry. A later
/// certificate still proves a fixed plane over the entire interval. This does
/// not shrink a shape or use a scalar contact distance as a geometry oracle.
#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn initial_support_clearance(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    time: Time,
    work: &mut Work,
) -> Result<f32, TrajectoryError> {
    rounded::initial_support_clearance(a, shape_a, b, shape_b, normal, time, work)
}

/// Expose the original margin to sibling test diagnostics without duplicating
/// its geometry or replacing its caller-owned work budget.
#[cfg(test)]
pub(super) fn test_initial_support_clearance(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    time: Time,
    work: &mut Work,
) -> Result<f32, TrajectoryError> {
    initial_support_clearance(a, shape_a, b, shape_b, normal, time, work)
}

// A private complete-state result. A witness is only a candidate for the
// existing cast predicate; boolean support APIs accept Separated alone.
#[derive(Clone, Copy, Debug)]
enum IntervalCertificate {
    Unproven,
    Separated,
    Hit(CastHit),
    // An actual strict world point, with no admitted preceding prefix. It
    // may select a split pivot, never publish a hit or a clear interval.
    Point {
        time: Time,
        contact: rapier3d::parry::query::Contact,
    },
}

type PointObserver<'a> = dyn FnMut(Time, &mut Work) -> Result<Option<rapier3d::parry::query::Contact>, TrajectoryError>
    + 'a;

fn observed_contact_after_native(
    time: Time,
    native: rapier3d::parry::query::Contact,
    clearance: f32,
    prior: Option<(Time, f32, Option<world_contact::Witness>)>,
    work: &mut Work,
    query_world: impl FnOnce(&mut Work) -> Result<Option<world_contact::Witness>, TrajectoryError>,
) -> Result<(rapier3d::parry::query::Contact, bool), TrajectoryError> {
    if native.dist <= clearance {
        return Ok((native, false)); // Preserve Native priority, including overlap.
    }
    let same_request = prior
        .filter(|(at, margin, _)| {
            at.to_bits() == time.to_bits() && margin.to_bits() == clearance.to_bits()
        })
        .map(|(_, _, witness)| witness);
    let witness = if let Some(observed) = same_request {
        observed // Some(None) is an observed absence, not an unobserved query.
    } else {
        query_world(work)?
    };
    Ok(witness.map_or((native, false), |w| (w.contact, w.strict)))
}

// A noninitial search boundary also needs the real world's strict marker.
// A Native contact is still the returned contact; only an actual verified
// point can make a whole-interval NoHit proof impossible. Initial Native
// classification/outgoing policy deliberately retains the old helper above.
fn noninitial_observed_contact_after_native(
    time: Time,
    native: rapier3d::parry::query::Contact,
    clearance: f32,
    prior: Option<(Time, f32, Option<world_contact::Witness>)>,
    work: &mut Work,
    query_world: impl FnOnce(&mut Work) -> Result<Option<world_contact::Witness>, TrajectoryError>,
) -> Result<(rapier3d::parry::query::Contact, bool), TrajectoryError> {
    if native.dist > clearance {
        return observed_contact_after_native(time, native, clearance, prior, work, query_world);
    }
    let same_request = prior
        .filter(|(at, margin, _)| {
            at.to_bits() == time.to_bits() && margin.to_bits() == clearance.to_bits()
        })
        .map(|(_, _, witness)| witness);
    let witness = if let Some(observed) = same_request {
        observed // An actual None remains reusable at precisely this request.
    } else {
        query_world(work)?
    };
    Ok((native, witness.is_some_and(|w| w.strict)))
}

// One interval's axes, in original first-appearance order. Repeated box
// faces on the right-witness retry denote the same immutable predicate.
// Two witnesses + two cuboids' six faces bound the complete census.
const MAX_SEPARATION_AXES: usize = 14;
#[derive(Clone, Copy)]
struct SeparationAxis {
    normal: rp::Vector,
    full_support: Option<bool>,
    upper: f64,
    lower: f64,
}
impl SeparationAxis {
    const EMPTY: Self = Self {
        normal: rp::Vector::ZERO,
        full_support: None,
        upper: f64::NEG_INFINITY,
        lower: f64::INFINITY,
    };
}
#[derive(Clone, Copy)]
struct AxisSource {
    a: ShapeMotion,
    b: ShapeMotion,
    box_a: bool,
    box_b: bool,
    start: Time,
    right: Option<rp::Vector>,
}
struct SeparationAxes {
    values: [SeparationAxis; MAX_SEPARATION_AXES],
    len: usize,
    source: Option<AxisSource>,
}
impl SeparationAxes {
    fn single(normal: rp::Vector) -> Self {
        let mut result = Self {
            values: [SeparationAxis::EMPTY; MAX_SEPARATION_AXES],
            len: 1,
            source: None,
        };
        result.values[0].normal = normal;
        result
    }
    fn push(&mut self, normal: rp::Vector) -> Result<(), TrajectoryError> {
        if self.values[..self.len].iter().any(|v| v.normal == normal) {
            return Ok(());
        }
        if self.len == self.values.len() {
            return Err(TrajectoryError::WorkLimit);
        }
        self.values[self.len].normal = normal;
        self.len += 1;
        Ok(())
    }
    fn ensure_all(&mut self, work: &mut Work) -> Result<(), TrajectoryError> {
        let Some(source) = self.source else {
            return Ok(());
        };
        // Source expansion is lazy: a prior analytic/cube/finite-image proof
        // does not pay for future axes. Bound the actual six-vector work
        // before evaluating either immutable start rotation.
        work.charge(6 * (u64::from(source.box_a) + u64::from(source.box_b)))?;
        let first = self.values[0].normal;
        for (motion, enabled) in [(source.a, source.box_a), (source.b, source.box_b)] {
            if !enabled {
                continue;
            }
            let rotation = motion.pose(source.start).rotation;
            for local in [
                rp::Vector::X,
                -rp::Vector::X,
                rp::Vector::Y,
                -rp::Vector::Y,
                rp::Vector::Z,
                -rp::Vector::Z,
            ] {
                let axis = rotation * local;
                if axis != first {
                    self.push(axis)?;
                }
            }
        }
        if let Some(right) = source.right {
            if right != first {
                self.push(right)?;
            }
            // Its box-face retry contains only predicates already above.
            // A repeated false predicate is cached, never newly sampled.
        }
        self.source = None;
        Ok(())
    }

    // Optional independent directions occupy only unused slots of the same
    // original 14-axis census. Call after every original axis has failed, so
    // neither its order nor its batched full-support preparation price changes.
    fn append_cardinals(&mut self, work: &mut Work) -> Result<(), TrajectoryError> {
        if self.len == self.values.len() {
            return Ok(());
        }
        work.charge(6)?;
        for normal in [
            rp::Vector::X,
            -rp::Vector::X,
            rp::Vector::Y,
            -rp::Vector::Y,
            rp::Vector::Z,
            -rp::Vector::Z,
        ] {
            if self.values[..self.len].iter().any(|v| v.normal == normal) {
                continue;
            }
            if self.len == self.values.len() {
                break;
            }
            self.push(normal)?;
        }
        Ok(())
    }
}

/// A GJK witness normal is not itself a support certificate. Keep the
/// original witness/box-face order and share only interval-local immutable
/// preparation; a future axis error is consumed only at that axis.
#[allow(clippy::too_many_arguments)]
fn certified_separation(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    certified_separation_axes(
        a, shape_a, b, shape_b, normal, None, start, end, clearance, work,
    )
    .map(|proof| matches!(proof, IntervalCertificate::Separated))
}
#[allow(clippy::too_many_arguments)]
fn certified_separation_axes(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    right: Option<rp::Vector>,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<IntervalCertificate, TrajectoryError> {
    certified_separation_axes_observed(
        a, shape_a, b, shape_b, normal, right, start, end, clearance, work, None,
    )
}
#[allow(clippy::too_many_arguments)]
fn certified_separation_axes_observed(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    right: Option<rp::Vector>,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
    observe_point: Option<&mut PointObserver<'_>>,
) -> Result<IntervalCertificate, TrajectoryError> {
    let proof = certified_separation_axes_proof(
        a,
        shape_a,
        b,
        shape_b,
        normal,
        right,
        start,
        end,
        clearance,
        work,
        observe_point,
    )?;
    if !matches!(proof, IntervalCertificate::Unproven) {
        return Ok(proof);
    }
    rounded::timeline_certificate(a, shape_a, b, shape_b, start, end, clearance, work)
}
#[allow(clippy::too_many_arguments)]
fn certified_separation_axes_only(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    right: Option<rp::Vector>,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    certified_separation_axes_proof(
        a, shape_a, b, shape_b, normal, right, start, end, clearance, work, None,
    )
    .map(|proof| matches!(proof, IntervalCertificate::Separated))
}
/// The established interval proofs applied to translation-only twins of every
/// spinning centered ball in the pair. Each twin has the original ball's
/// ToiProxy image at every logical time, so its proof covers the actual pair.
/// Pairs without such a ball have no additional certificate.
#[allow(clippy::too_many_arguments)]
fn centered_ball_twins_separated(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    right: Option<rp::Vector>,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let twin_a = a.centered_ball_translation_twin(shape_a);
    let twin_b = b.centered_ball_translation_twin(shape_b);
    if twin_a.is_none() && twin_b.is_none() {
        return Ok(false);
    }
    certified_separation_axes_only(
        twin_a.unwrap_or(a),
        shape_a,
        twin_b.unwrap_or(b),
        shape_b,
        normal,
        right,
        start,
        end,
        clearance,
        work,
    )
}
// A fixed-direction proof is independent of the supplied contact normal.
// Keep the old first-axis analytic success/price; only its failed non-cardinal
// Native case can reach this prepass before any expensive rounded image.
#[allow(clippy::too_many_arguments)]
fn certified_native_cardinals(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    original: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if original.to_array().iter().filter(|&&v| v != 0.).count() <= 1
        || (shape_a.as_ball().is_some() && shape_b.as_ball().is_some())
    {
        return Ok(false);
    }
    let native = |m: ShapeMotion| matches!(m.curve, Curve::Integrated(_) | Curve::Anchored { .. });
    if !native(a) && !native(b) {
        return Ok(false);
    }
    // Do not add this attempt to CCD, general rotations or the existing
    // Anchored Box/Capsule scalar certificates. The actual helper still
    // validates the complete original clock and stored translation branches.
    let capsule_pair = shape_a.as_capsule().is_some() && shape_b.as_capsule().is_some();
    if !capsule_pair
        && (matches!(a.curve, Curve::Anchored { .. }) || matches!(b.curve, Curve::Anchored { .. }))
    {
        return Ok(false);
    }
    let qualifies = |m: ShapeMotion| {
        let qi = |q: rp::Rotation| {
            q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
        };
        if m.local_center != rp::Vector::ZERO
            || m.local_pose.translation != rp::Vector::ZERO
            || !qi(m.local_pose.rotation)
        {
            return false;
        }
        let kernel = match m.curve {
            Curve::Constant { pose, .. } => return qi(pose.rotation),
            Curve::Integrated(k) => k,
            Curve::Anchored {
                carrier, rotation, ..
            } if capsule_pair && qi(rotation) => carrier,
            _ => return false,
        };
        kernel.native.angular_velocity.to_array().map(f32::to_bits) == [0; 3]
            && qi(kernel.native.motion.start.rotation)
            && qi(kernel.native.motion.end.rotation)
    };
    work.charge(64)?; // fixed two-descriptor eligibility and six directions.
    if !qualifies(a) || !qualifies(b) {
        return Ok(false);
    }
    for direction in [
        rp::Vector::X,
        -rp::Vector::X,
        rp::Vector::Y,
        -rp::Vector::Y,
        rp::Vector::Z,
        -rp::Vector::Z,
    ] {
        if a.analytic_separated(shape_a, b, shape_b, direction, start, end, clearance, work)? {
            return Ok(true);
        }
    }
    Ok(false)
}

#[allow(clippy::too_many_arguments)]
fn certified_separation_axes_proof(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    right: Option<rp::Vector>,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
    mut observe_point: Option<&mut PointObserver<'_>>,
) -> Result<IntervalCertificate, TrajectoryError> {
    let mut axes = SeparationAxes::single(normal);
    axes.source = Some(AxisSource {
        a,
        b,
        box_a: shape_a.as_cuboid().is_some(),
        box_b: shape_b.as_cuboid().is_some(),
        start,
        right,
    });
    let mut cache = rounded::AxisCache::new(a, shape_a, b, shape_b, start, end, clearance);
    if rounded::fixed_wall_rider_separated(&cache, normal, work)? {
        return Ok(IntervalCertificate::Separated);
    }
    if supported_capsule_face::box_motion(a, shape_a, b, shape_b).is_some()
        && rounded::anchored_capsule_face_separated(&cache, normal, work)?
    {
        return Ok(IntervalCertificate::Separated);
    }
    if rounded::ramp_capsule_separated(&mut cache, normal, work)? {
        return Ok(IntervalCertificate::Separated);
    }
    let anchored = rounded::has_rigid_anchor(a, b);
    if anchored && rounded::corotating_separated(&cache, work)? {
        return Ok(IntervalCertificate::Separated);
    }
    if rounded::planar_rotating_box_separated(&cache, work)? {
        return Ok(IntervalCertificate::Separated);
    }
    let early_product = rounded::early_common_product(&cache, normal, work)?;
    if early_product == Some(true) || rounded::moving_face_separated(&cache, work)? {
        return Ok(IntervalCertificate::Separated);
    }
    let mut index = 0;
    loop {
        let normal = axes.values[index].normal;
        if !(shape_a.as_ball().is_some() && shape_b.as_ball().is_some())
            && a.analytic_separated(shape_a, b, shape_b, normal, start, end, clearance, work)?
        {
            return Ok(IntervalCertificate::Separated);
        }
        if index == 0 && rounded::cardinal_box_ball_separated(&mut cache, work)? {
            return Ok(IntervalCertificate::Separated);
        }
        if index == 0
            && (rounded::rotating_box_ball_face_separated(&mut cache, normal, work)?
                || rounded::rotating_capsule_ball_separated(&mut cache, normal, work)?
                || rounded::rotating_capsule_polyhedron_separated(&mut cache, normal, work)?
                || rounded::rotating_cardinal_box_face_separated(&mut cache, normal, work)?
                || rounded::rotating_box_capsule_separated(&mut cache, normal, work)?)
        {
            return Ok(IntervalCertificate::Separated);
        }
        if index == 0
            && certified_native_cardinals(
                a, shape_a, b, shape_b, normal, start, end, clearance, work,
            )?
        {
            return Ok(IntervalCertificate::Separated);
        }
        let proof = if let Some(observe) = observe_point.as_mut() {
            rounded::separated_cached_observed(
                index,
                work,
                &mut axes,
                &mut cache,
                Some(&mut **observe),
            )?
        } else {
            rounded::separated_cached_observed(index, work, &mut axes, &mut cache, None)?
        };
        if !matches!(proof, IntervalCertificate::Unproven) {
            return Ok(proof);
        }
        axes.ensure_all(work)?;
        index += 1;
        if index == axes.len {
            break;
        }
    }
    let original_count = axes.len;
    axes.append_cardinals(work)?;
    for index in original_count..axes.len {
        // This is a fresh fixed direction, never a snapped contact normal.
        // Reuse the original whole-F32 full-point enclosure only. In
        // particular do not extend the already-priced full-support batch or
        // repeat native leaf queries/timeline traversal behind another axis.
        if rounded::closed_plane_cached(index, work, &axes, &mut cache)? {
            return Ok(IntervalCertificate::Separated);
        }
    }
    if (!anchored && rounded::corotating_separated(&cache, work)?)
        || rounded::exact_box_separated(&mut cache, normal, work)?
        || rounded::common_product_separated(&cache, &axes, early_product.is_some(), work)?
    {
        return Ok(IntervalCertificate::Separated);
    }
    // Only a tiny pair of original integrated clock cells may spend the
    // expanded witness census after the established interval proofs decline.
    let same_clock_interval = [a, b].into_iter().all(|m| {
        matches!(m.curve, Curve::Integrated(k)
            if (u32::abs_diff(k.local_delta(start).to_bits(),k.local_delta(end).to_bits())) <= 2)
    });
    if same_clock_interval && clearance > 0. && observe_point.is_some() {
        let mut local = Work {
            used: 0,
            limit: (work.limit - work.used).min(3 * 1024 * 1024),
        };
        let complete = rounded::corotating_projected_prefix(&cache, &mut local);
        work.charge(local.used)?;
        return match complete {
            Err(TrajectoryError::WorkLimit) => Ok(IntervalCertificate::Unproven),
            result => result,
        };
    }
    Ok(IntervalCertificate::Unproven)
}

/// Distance witnesses for the same full point cloud plus its original radius.
/// Keeping the round radius out of GJK avoids a smooth-support convergence
/// gap between the closest-point upper bound and the support-plane proof.
/// Core overlap still uses the original penetration dispatcher; it is never
/// turned into an arbitrary zero-distance contact.
pub(super) fn leaf_contact(
    pose_a: &rp::Pose,
    shape_a: &dyn rp::Shape,
    pose_b: &rp::Pose,
    shape_b: &dyn rp::Shape,
    work: &mut Work,
) -> Result<rapier3d::parry::query::Contact, TrajectoryError> {
    use rapier3d::parry::query::sweep_toi::{
        proxy_distance_with_local_witness_metered, ProxyDistanceWork, SimplexCache,
    };
    if let (Some(a), Some(b)) = (shape_a.as_cuboid(), shape_b.as_cuboid()) {
        // Both zero and tiny positive core witness distances can have a
        // purely in-plane normal at a touching box face. Always use the real
        // full cuboid SAT/finite-feature query for this exact shape pair.
        work.charge(32)?;
        let local = rapier3d::parry::query::details::contact_cuboid_cuboid(
            &pose_a.inv_mul(pose_b),
            a,
            b,
            f32::MAX,
        )
        .ok_or(TrajectoryError::Unresolved)?;
        if local.dist > 0. {
            // The selected positive SAT face's arbitrary support vertex need
            // not be a closest point of the finite boxes (a large wall's
            // tangent corner can lie outside the other face). Enumerate the
            // original vertex/face and edge/edge features instead.
            if let Some(contact) = feature_contact::cuboids(pose_a, a, pose_b, b, work)? {
                return Ok(contact);
            }
        }
        let point1 = *pose_a * local.point1;
        let point2 = *pose_b * local.point2;
        let normal1 = (pose_a.rotation * local.normal1)
            .try_normalize()
            .ok_or(TrajectoryError::NonFinite)?;
        // Each witness uses its original frame. Reusing the relative
        // signed distance would reintroduce the A06 rounding gap.
        return Ok(rapier3d::parry::query::Contact::new(
            point1,
            point2,
            normal1,
            -normal1,
            (point2 - point1).dot(normal1),
        ));
    }
    if let (Some(a), Some(b)) = (shape_a.as_cuboid(), shape_b.as_capsule()) {
        if let Some(contact) = feature_contact::cuboid_capsule(pose_a, a, pose_b, b, work)? {
            return Ok(contact);
        }
    } else if let (Some(a), Some(b)) = (shape_a.as_capsule(), shape_b.as_cuboid()) {
        if let Some(contact) = feature_contact::cuboid_capsule(pose_b, b, pose_a, a, work)? {
            return Ok(contact.flipped());
        }
    } else if let (Some(a), Some(b)) = (
        feature_contact::RampFaces::from_shape(shape_a),
        shape_b.as_capsule(),
    ) {
        if let Some(contact) =
            feature_contact::ramp_capsule_contact(pose_a, a, pose_b, b, None, work)?
        {
            return Ok(contact);
        }
    } else if let (Some(a), Some(b)) = (
        shape_a.as_capsule(),
        feature_contact::RampFaces::from_shape(shape_b),
    ) {
        if let Some(contact) =
            feature_contact::ramp_capsule_contact(pose_b, b, pose_a, a, None, work)?
        {
            return Ok(contact.flipped());
        }
    }
    let a = ToiProxy::from_shape(shape_a).ok_or(TrajectoryError::UnsupportedShape)?;
    let b = ToiProxy::from_shape(shape_b).ok_or(TrajectoryError::UnsupportedShape)?;
    // Original relative-pose and returned-world-witness work is fixed and
    // separate from actual GJK loop/support admission. Specialized finite
    // queries above neither construct these proxies nor pay unused GJK.
    work.charge(128)?;
    let (core, local_a, local_b) = proxy_distance_with_local_witness_metered(
        &pose_a.inv_mul(pose_b),
        &a,
        &b,
        &mut SimplexCache::default(),
        &mut |stage| {
            let amount = match stage {
                ProxyDistanceWork::Bootstrap | ProxyDistanceWork::Finish => 256,
                ProxyDistanceWork::Iteration { simplex_vertices } => match simplex_vertices {
                    1 => 128,
                    2 | 3 => 512,
                    4 => 1024,
                    _ => return Err(TrajectoryError::Unresolved),
                },
                ProxyDistanceWork::Support { points_a, points_b } => points_a
                    .checked_add(points_b)
                    .and_then(|n| u64::try_from(n).ok())
                    .ok_or(TrajectoryError::WorkLimit)?,
            };
            work.charge(amount)
        },
    )?;
    if core.distance > 0. && core.normal != rp::Vector::ZERO {
        let point_a = *pose_a * local_a;
        // B's world witness must come from its original local simplex points.
        // Reapplying pose_a to an already rounded relative-frame witness can
        // manufacture a positive gap even when the actual full shapes touch.
        let point_b = *pose_b * local_b;
        let delta = point_b - point_a;
        if let Some(normal) = delta.try_normalize() {
            let dist = delta.length() - a.radius - b.radius;
            let contact = rapier3d::parry::query::Contact::new(
                point_a + normal * a.radius,
                point_b - normal * b.radius,
                normal,
                -normal,
                dist,
            );
            if !contact.dist.is_finite()
                || !contact.point1.is_finite()
                || !contact.point2.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            return Ok(contact);
        }
    }
    let contact = rapier3d::parry::query::contact_point_cloud_metered(
        pose_a,
        shape_a,
        pose_b,
        shape_b,
        f32::MAX,
        &mut |event| native_contact_work(event, work),
    )
    .map_err(|error| match error {
        rapier3d::parry::query::NativeContactError::Admission(error) => error,
        rapier3d::parry::query::NativeContactError::Allocation => TrajectoryError::WorkLimit,
        rapier3d::parry::query::NativeContactError::Unsupported => {
            TrajectoryError::UnsupportedShape
        }
    })?
    .ok_or(TrajectoryError::Unresolved)?;

    Ok(contact)
}

/// The same Work allowance pays for every Native phase and requested backing
/// byte. Requested bytes are logical requests, not allocator capacity or RSS.
fn native_contact_work(
    event: rapier3d::parry::query::NativeContactWork,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    use rapier3d::parry::query::{NativeContactPhase as Phase, NativeContactWork as Event};
    let count = |n: usize| u64::try_from(n).map_err(|_| TrajectoryError::WorkLimit);
    let amount = match event {
        Event::Fixed(phase) => Some(match phase {
            Phase::Dispatch => 256,
            Phase::GjkBootstrap | Phase::PointQuery => 512,
            Phase::GjkIteration | Phase::EpaBootstrap | Phase::EpaExpansion => 1024,
            Phase::EpaFinish | Phase::Feature => 256,
        }),
        Event::Support { points_a, points_b } => count(
            points_a
                .checked_add(points_b)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?
        .checked_add(128),
        Event::PointVisits(n) => count(n)?.checked_mul(32),
        Event::FaceVisit => Some(256),
        Event::EdgeVisit => Some(128),
        Event::HeapVisits(n) => count(n)?.checked_add(1).and_then(|n| n.checked_mul(16)),
        Event::Storage {
            requested_bytes,
            relocated_bytes,
            ..
        } => count(requested_bytes)?.checked_add(count(relocated_bytes)?),
    }
    .ok_or(TrajectoryError::WorkLimit)?;
    let result = work.charge(amount);
    #[cfg(test)]
    if result.is_err() && test_work_failure_selected() {
        eprintln!(
            "NATIVE_CONTACT_WORK_DENIED case={:?} event={event:?} requested={amount} used={} limit={}",
            std::thread::current().name(), work.used, work.limit
        );
    }
    result
}

/// Continuous convex-leaf cast with whole-interval separating certificates.
/// Midpoint contacts only select/refine uncertain intervals; they never prove
/// that unsampled times are collision-free. Composite owners must retain their
/// complete leaf/filter census and pass each applicable pair through this call.
#[allow(clippy::too_many_arguments)]
#[cfg(test)]
pub(super) fn cast(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
) -> Result<Option<CastHit>, TrajectoryError> {
    cast_policy(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        time_tolerance,
        work,
        false,
    )
}
#[allow(clippy::too_many_arguments)]
#[cfg(test)]
fn cast_policy(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
    allow_existing_penetration: bool,
) -> Result<Option<CastHit>, TrajectoryError> {
    cast_policy_observed(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        time_tolerance,
        work,
        allow_existing_penetration,
        &mut None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn cast_policy_observed(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
    allow_existing_penetration: bool,
    initially_clear: &mut Option<bool>,
    strict_prefix: Option<StrictPrefix>,
) -> Result<Option<CastHit>, TrajectoryError> {
    let result = cast_policy_impl(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        time_tolerance,
        work,
        allow_existing_penetration,
        initially_clear,
        strict_prefix,
        None,
    )?;
    if let Some(hit) =
        result.filter(|_| allow_existing_penetration && *initially_clear == Some(true))
    {
        let initial =
            positive_initial_support::allowance(a, shape_a, b, shape_b, start, clearance, work)?;
        let initial = match initial {
            Some(initial) => Some(initial),
            None => positive_initial_support::witnessed_allowance(
                a, shape_a, b, shape_b, start, hit, work,
            )?,
        };
        if let Some(initial) = initial {
            // A positive existing margin has its own full-future proof. It
            // cannot establish the requested-clearance prefix used by memo.
            return cast_policy_impl(
                a,
                shape_a,
                b,
                shape_b,
                start,
                end,
                clearance,
                time_tolerance,
                work,
                allow_existing_penetration,
                initially_clear,
                None,
                Some(initial),
            );
        }
    }
    Ok(result)
}

/// An accepted capsule pair may reuse the ordinary existing-contact band
/// when the refreshed complete suffix is proved nonpenetrating at that band.
#[allow(clippy::too_many_arguments)]
pub(super) fn accepted_capsules_separated(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    rounded::parallel_capsules_stable_existing(a, sa, b, sb, start, end, clearance, true, work)
}

/// A confirmed conflict can reject a rotating support proposal without
/// asking for the earliest contact or publishing a prefix. Keep the original
/// margin after any positive initial-support retry.
#[allow(clippy::too_many_arguments)]
pub(super) fn rotating_support_conflict(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    prior_hit: Option<Time>,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    if !matches!(
        (a.curve, b.curve),
        (Curve::Integrated(_), Curve::Anchored { .. })
            | (Curve::Anchored { .. }, Curve::Integrated(_))
    ) || !(start < end && clearance > 0.)
    {
        return Ok(None);
    }
    let Some(pair) = world_contact::Pair::new(shape_a, shape_b, work)? else {
        return Ok(None);
    };
    world_contact::validate_interval(a, b, start, end, work)?;
    let initial = leaf_contact(&a.pose(start), shape_a, &b.pose(start), shape_b, work)?;
    if !initial.dist.is_finite()
        || !initial.normal1.is_finite()
        || !initial.point1.is_finite()
        || !initial.point2.is_finite()
    {
        return Err(TrajectoryError::NonFinite);
    }
    if initial.dist <= clearance {
        return Ok(None);
    }
    work.charge(64)?;
    let mut selected = None;
    let mut confirm = |at, work: &mut Work| {
        if !(start < at && at < end) {
            return Ok(false);
        }
        let requested = selected.unwrap_or(clearance);
        if !pair.native_strict_at(a, b, at, requested, work)? {
            return Ok(false);
        }
        if selected.is_some() {
            return Ok(true);
        }
        let retry =
            positive_initial_support::allowance(a, shape_a, b, shape_b, start, clearance, work)?;
        let Some((geometry, stability)) = retry else {
            return Ok(true);
        };
        let margin = clearance.min(geometry).min(stability);
        if pair.native_strict_at(a, b, at, margin, work)? {
            return Ok(true);
        }
        selected = Some(margin);
        Ok(false)
    };
    if let Some(at) = prior_hit {
        if confirm(at, work)? {
            return Ok(Some(at));
        }
        return rounded::nearby_rotating_conflict(
            a,
            shape_a,
            b,
            shape_b,
            start,
            end,
            clearance,
            initial.normal1,
            at,
            work,
            confirm,
        );
    }
    for fraction in [1. / 512., 1. / 128., 1. / 32., 1. / 16., 0.25, 0.5, 0.75] {
        let at = start + (end - start) * fraction;
        if confirm(at, work)? {
            return Ok(Some(at));
        }
    }
    rounded::nearby_rotating_conflict(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        initial.normal1,
        start,
        work,
        confirm,
    )
}

// Exact original finite-impact thread only. Separate caps keep the selected
// margin visible even if an earlier Native error or terminal branch is noisy.
#[cfg(test)]
fn finite_search_trace(slot: usize, stage: &str, values: std::fmt::Arguments<'_>) {
    const CASE: &str = "physics3d::character_dynamic_tests::incoming_dynamic_impact_transfers_normal_momentum_and_preserves_tangent";
    if std::thread::current().name() != Some(CASE) {
        return;
    }
    std::thread_local! {
        static COUNTS: std::cell::Cell<[usize; 3]> = const { std::cell::Cell::new([0; 3]) };
    }
    COUNTS.with(|state| {
        let mut counts = state.get();
        if counts[slot] < [16, 8, 8][slot] {
            counts[slot] += 1;
            state.set(counts);
            eprintln!(
                "C84_FINITE_SEARCH stage={stage} ordinal={} {values}",
                counts[slot]
            );
        }
    });
}

#[allow(clippy::too_many_arguments)]
fn cast_policy_impl(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
    allow_existing_penetration: bool,
    initially_clear: &mut Option<bool>,
    strict_prefix: Option<StrictPrefix>,
    positive_initial: Option<(f32, f32)>,
) -> Result<Option<CastHit>, TrajectoryError> {
    const MAX_DEPTH: usize = 48;
    if !time_tolerance.is_finite()
        || time_tolerance <= 0.
        || !clearance.is_finite()
        || clearance < 0.
        || start > end
    {
        return Err(TrajectoryError::InvalidTime);
    }
    let contact_at = |time: Time, work: &mut Work| {
        let c = leaf_contact(&a.pose(time), shape_a, &b.pose(time), shape_b, work)
            .inspect_err(|_error| {
                #[cfg(test)]
                if (0.048..=0.05).contains(&start) {
                    finite_search_trace(1, "native-leaf-error", format_args!(
                        "error={_error:?} query=[{start:.18e},{end:.18e}] at={time:.18e} requested={clearance:?} work={}/{}", work.used, work.limit));
                }
            })?;
        if !c.dist.is_finite()
            || !c.normal1.is_finite()
            || !c.point1.is_finite()
            || !c.point2.is_finite()
        {
            return Err(TrajectoryError::NonFinite);
        }
        Ok::<_, TrajectoryError>(c)
    };
    let ramp_contact_at = |time, margin, work: &mut Work| {
        let contact = |hull: ShapeMotion, poly, cap: ShapeMotion, capsule, work: &mut Work| {
            feature_contact::ramp_capsule_contact(
                &hull.metered_pose(time, work)?,
                poly,
                &cap.metered_pose(time, work)?,
                capsule,
                Some(margin),
                work,
            )
        };
        if let (Some(poly), Some(cap)) = (
            feature_contact::RampFaces::from_shape(shape_a),
            shape_b.as_capsule(),
        ) {
            contact(a, poly, b, cap, work)
        } else if let (Some(cap), Some(poly)) = (
            shape_a.as_capsule(),
            feature_contact::RampFaces::from_shape(shape_b),
        ) {
            Ok(contact(b, poly, a, cap, work)?.map(|contact| contact.flipped()))
        } else {
            Ok(None)
        }
    };
    let left = contact_at(start, work)?;
    // A replay's positive existing-contact margin cannot qualify as an
    // original requested-clearance prefix. Errors expose no partial coverage.
    *initially_clear = Some(left.dist > clearance && positive_initial.is_none());
    // The owner matched the entire original primitive expression and a
    // previously certified prefix. Reexecute this original initial leaf first:
    // only its strict predicate preserves margin=clearance, without entering
    // the existing-contact/outgoing policy. Equality follows the original cast.
    if left.dist > clearance && positive_initial.is_none() && strict_prefix.is_some() {
        match strict_prefix {
            Some(StrictPrefix::Clear) => return Ok(None),
            Some(StrictPrefix::Hit(hit)) => return Ok(Some(hit)),
            _ => {}
        }
    }
    if allow_existing_penetration
        && positive_initial.is_none()
        && (positive_initial_support::shared_face_stable(
            a,
            shape_a,
            b,
            shape_b,
            left,
            start,
            end,
            clearance,
            time_tolerance,
            work,
        )? || positive_initial_support::fixed_ramp_stable(
            a, shape_a, b, shape_b, left, start, end, clearance, work,
        )?)
    {
        *initially_clear = Some(false);
        return Ok(None);
    }
    // One face witness can recede while another corner approaches during
    // rotation. A real initial contact is a closed-set hit unless the original
    // full-shape interval certificate proves its clearance is preserved.
    // A single point derivative cannot stand in for all touching features.
    let initial = if allow_existing_penetration && left.dist <= clearance {
        Some(rounded::initial_support_allowances(
            a,
            shape_a,
            b,
            shape_b,
            left.normal1,
            start,
            work,
        )?)
    } else {
        None
    };
    // A noninward existing contact may preserve the complete admitted margin
    // for a prefix before a later rotation approaches it. Refine that prefix
    // with the ordinary full-shape certificates below instead of turning a
    // failed whole-interval proof into an unconditional start/start bracket.
    // The point rate only chooses whether to search; it certifies no motion.
    // Genuine initial inward response and strict query policy keep their
    // original immediate-contact behavior.
    let existing = left.dist <= clearance || positive_initial.is_some();
    let refine_existing = if !allow_existing_penetration || !existing || start >= end {
        false
    } else if positive_initial.is_some()
        && (rounded::has_rigid_anchor(a, b)
            || [(a, shape_a, b, shape_b), (b, shape_b, a, shape_a)]
                .into_iter()
                .any(|(bar, sa, capsule, sb)| {
                    sa.as_cuboid().is_some()
                        && sb.as_capsule().is_some()
                        && matches!((bar.curve, capsule.curve),
                            (Curve::Integrated(r), Curve::Integrated(t))
                            if r.native.angular_velocity.z > 0.
                                && r.native.angular_velocity.x == 0.
                                && r.native.angular_velocity.y == 0.
                                && t.native.angular_velocity == rp::Vector::ZERO
                                && ((t.native.linear_velocity.x != 0.
                                    && t.native.linear_velocity.y != 0.)
                                    || (r.domain.start < start && t.domain.start < start)))
                }))
    {
        // The selected positive margin already owns an outgoing witness
        // on these shapes at this time. A different native point cannot
        // reclassify that contact while retrying the full original interval.
        true
    } else {
        work.charge(1024)?;
        let rate = (b.point_velocity(start, left.point2) - a.point_velocity(start, left.point1))
            .dot(left.normal1);
        if !rate.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        rate >= 0.
    };
    // The original noninward predicate alone may select a finite translation-
    // cell stability band. Strict/inward casts keep static geometry; an initial
    // Native-clear starts keep requested clearance unless the wrapper already
    // paid for a matching positive support-cell override after an original hit.
    let proof_clearance = initial
        .map(|initial| (initial.geometry, initial.noninward_stability))
        .or(positive_initial)
        .map_or(clearance, |(geometry, noninward_stability)| {
            if refine_existing {
                noninward_stability
            } else {
                geometry
            }
            .min(clearance)
        });
    #[cfg(test)]
    if (0.048..=0.05).contains(&start) {
        finite_search_trace(0, "selected-margin", format_args!(
            "query=[{start:.18e},{end:.18e}] native_initial={:?} requested={clearance:?} selected={proof_clearance:?} existing={existing} refine={refine_existing} initial={:?} positive_initial={positive_initial:?} allow_existing={allow_existing_penetration} tolerance={time_tolerance:?} work={}/{}", left.dist, initial.map(|v| (v.geometry, v.noninward_stability)), work.used, work.limit));
    }
    // At a proven unchanged pose the already-paid full-shape lower bound
    // remains strict for the entire selected outgoing band. The original
    // Native observation must clear that same band before reusing it.
    if refine_existing
        && proof_clearance > 0.
        && left.dist > proof_clearance
        && initial.is_some_and(|initial| initial.geometry > proof_clearance)
        && rounded::stationary::retains_initial_band(a, shape_a, b, shape_b, start, end, work)?
    {
        return Ok(None);
    }
    if allow_existing_penetration
        && (!existing || refine_existing)
        && positive_initial.is_none()
        && rounded::parallel_capsules_stable_existing(
            a, shape_a, b, shape_b, start, end, clearance, false, work,
        )?
    {
        *initially_clear = Some(false);
        return Ok(None);
    }
    if existing && !refine_existing {
        // A strict real point on a pair of upright capsules already
        // contradicts complete separation at the selected margin. Keep
        // the original initial Native contact; the probes only avoid
        // spending the interval proof on an impossible result.
        let mut strict_world = false;
        if left.dist <= clearance
            && shape_a.as_capsule().is_some()
            && shape_b.as_capsule().is_some()
        {
            if let Some(pair) = world_contact::Pair::new(shape_a, shape_b, work)? {
                work.charge(64)?;
                for fraction in [0., 0.25, 0.5, 0.75, 1.] {
                    let at = if fraction == 1. {
                        end
                    } else {
                        start + (end - start) * fraction
                    };
                    if pair
                        .at(a, b, at, proof_clearance, work)?
                        .is_some_and(|w| w.strict)
                    {
                        strict_world = true;
                        break;
                    }
                }
            }
        }
        // Only a real support-plane proof can contradict a noisy contact
        // normal. In particular this does not turn worsening overlap into no-hit.
        if !strict_world
            && certified_separation(
                a,
                shape_a,
                b,
                shape_b,
                left.normal1,
                start,
                end,
                proof_clearance,
                work,
            )?
        {
            return Ok(None);
        }
        return Ok(Some(CastHit {
            safe_time: start,
            hit_time: start,
            contact: left,
            subshape_a: 0,
            subshape_b: 0,
        }));
    }
    // Initial Native classification/metadata, its existing-contact policy and
    // margin selection above are unchanged. Only now can original world-radius
    // geometry add a positive observation; absence is never a clear result.
    let world_pair = world_contact::Pair::new(shape_a, shape_b, work)?
        .or_else(|| world_contact::Pair::box_ball(a, shape_a, b, shape_b));
    if world_pair.is_some() {
        world_contact::validate_interval(a, b, start, end, work)?;
    }
    let observe = |time: Time,
                   native: rapier3d::parry::query::Contact,
                   work: &mut Work,
                   prior: Option<(Time, f32, Option<world_contact::Witness>)>,
                   search_boundary: bool|
     -> Result<_, TrajectoryError> {
        // This closure owns one immutable a/b, full shape pair and selected
        // clearance. The only prior value is local to the current interval;
        // a cropped Point midpoint can reuse it only at the exact same time.
        let mut actual_world = prior
            .filter(|(at, margin, _)| {
                at.to_bits() == time.to_bits() && margin.to_bits() == proof_clearance.to_bits()
            })
            .map(|(_, _, witness)| witness);
        let query_world = |work: &mut Work| {
            let observed = if let Some(pair) = &world_pair {
                match pair.at(a, b, time, proof_clearance, work)? {
                    Some(witness) => Some(witness),
                    None => pair.normal_axis_at(a, b, time, proof_clearance, work)?,
                }
            } else {
                None
            };
            actual_world = Some(observed);
            Ok(observed)
        };
        let observed = if search_boundary {
            noninitial_observed_contact_after_native(
                time,
                native,
                proof_clearance,
                prior,
                work,
                query_world,
            )?
        } else {
            observed_contact_after_native(time, native, proof_clearance, prior, work, query_world)?
        };
        if search_boundary
            && native.dist <= proof_clearance
            && !observed.1
            && matches!(actual_world, Some(None))
        {
            if let Some(pair) = &world_pair {
                // A separate positive-existence proof does not create contact
                // data or change the cached Pair.at observation. Native contact
                // stays first; false remains unknown, never a NoHit result.
                return Ok((
                    native,
                    pair.native_strict_at(a, b, time, proof_clearance, work)?,
                ));
            }
        }
        Ok(observed)
    };
    let (left, left_world_strict) = observe(start, left, work, None, false)?;
    let mut edge_prefix = start;
    if !left_world_strict
        && !start.is_sign_negative()
        && proof_clearance > 0.
        && left.dist > proof_clearance
        && left
            .normal1
            .to_array()
            .into_iter()
            .filter(|v| *v != 0.)
            .count()
            > 1
        && ((shape_a.as_cuboid().is_some() && shape_b.as_capsule().is_some())
            || (shape_a.as_capsule().is_some() && shape_b.as_cuboid().is_some()))
    {
        let cache = rounded::AxisCache::new(a, shape_a, b, shape_b, start, end, proof_clearance);
        let mut proof = Work {
            used: 0,
            limit: (work.limit - work.used).min(24 * 1024 * 1024),
        };
        let prefix = rounded::fixed_box_capsule_edge_prefix(&cache, time_tolerance, &mut proof);
        work.charge(proof.used)?;
        match prefix {
            Ok(through) if through == end => return Ok(None),
            Ok(through) => {
                edge_prefix = through;
                let next = through.next_up();
                if through > start && next <= end && next - through <= time_tolerance {
                    let native = contact_at(next, work)?;
                    let (contact, strict) = observe(next, native, work, None, true)?;
                    if native.dist <= proof_clearance || strict {
                        return Ok(Some(CastHit {
                            safe_time: through,
                            hit_time: next,
                            contact,
                            subshape_a: 0,
                            subshape_b: 0,
                        }));
                    }
                }
            }
            Err(TrajectoryError::WorkLimit) => {}
            Err(error) => return Err(error),
        }
    }
    if allow_existing_penetration
        && positive_initial.is_none()
        && !left_world_strict
        && start < end
        && proof_clearance > 0.
        && left.dist > proof_clearance
        && rounded::has_rigid_anchor(a, b)
    {
        let selected = if let (Some(cube), Some(cap)) = (shape_a.as_cuboid(), shape_b.as_capsule())
        {
            Some((a.pose(start), cube.half_extents, b.pose(start), cap, false))
        } else if let (Some(cap), Some(cube)) = (shape_a.as_capsule(), shape_b.as_cuboid()) {
            Some((b.pose(start), cube.half_extents, a.pose(start), cap, true))
        } else {
            None
        };
        if let Some((cube, half, cap_pos, cap, flipped)) = selected {
            let mut proof = Work {
                used: 0,
                limit: (work.limit - work.used).min(1024 * 1024),
            };
            let result = rounded::initial_capsule_cell(
                cube,
                half,
                cap_pos,
                cap,
                proof_clearance,
                &mut proof,
            );
            work.charge(proof.used)?;
            let result = match result {
                Ok(result) => result,
                Err(TrajectoryError::WorkLimit) => rounded::PlanarCell::Unknown,
                Err(error) => return Err(error),
            };
            if let rounded::PlanarCell::Hit(contact) = result {
                return Ok(Some(CastHit {
                    safe_time: start,
                    hit_time: start,
                    contact: if flipped { contact.flipped() } else { contact },
                    subshape_a: 0,
                    subshape_b: 0,
                }));
            }
        }
    }
    if left_world_strict {
        return Ok(Some(CastHit {
            safe_time: start,
            hit_time: start,
            contact: left,
            subshape_a: 0,
            subshape_b: 0,
        }));
    }
    // The initial rounded cap can reach the skin even when the usual face
    // witness misses it. Outgoing contacts keep the existing support policy.
    let fixed_ramp_entry = !existing
        && proof_clearance > 0.
        && left
            .normal1
            .to_array()
            .into_iter()
            .filter(|&v| v != 0.)
            .count()
            == 2
        && [(a, shape_a, b, shape_b), (b, shape_b, a, shape_a)]
            .into_iter()
            .any(|(hull, poly, cap, shape)| {
                feature_contact::RampFaces::from_shape(poly).is_some()
                    && shape.as_capsule().is_some()
                    && matches!(hull.curve, Curve::Constant { .. })
                    && matches!(cap.curve, Curve::Integrated(k) if k.has_identity_orientation())
            });
    if fixed_ramp_entry {
        if let Some(contact) = ramp_contact_at(start, proof_clearance, work)?
            .filter(|contact| contact.dist <= proof_clearance)
        {
            if allow_existing_penetration
                && positive_initial_support::fixed_ramp_stable(
                    a, shape_a, b, shape_b, contact, start, end, clearance, work,
                )?
            {
                *initially_clear = Some(false);
                return Ok(None);
            }
            let rate = (b.point_velocity(start, contact.point2)
                - a.point_velocity(start, contact.point1))
            .dot(contact.normal1);
            if !allow_existing_penetration || (rate.is_finite() && rate < 0.) {
                *initially_clear = Some(false);
                return Ok(Some(CastHit {
                    safe_time: start,
                    hit_time: start,
                    contact,
                    subshape_a: 0,
                    subshape_b: 0,
                }));
            }
        }
    }
    if !allow_existing_penetration && proof_clearance == 0. && !existing {
        match box_capsule_sensor::sweep(a, shape_a, b, shape_b, start, end, time_tolerance, work)? {
            IntervalCertificate::Separated => return Ok(None),
            IntervalCertificate::Hit(hit) => {
                if hit.hit_time == start {
                    *initially_clear = Some(false);
                }
                return Ok(Some(hit));
            }
            _ => {}
        }
    }
    if start == end {
        return Ok(None);
    }
    // Before walking represented time cells, try the shared normal action
    // over the entire selected interval. Observe the original initial leaf
    // and its margin first so coverage retains its existing policy authority.
    if rounded::shared_normal_complete(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        proof_clearance,
        left.normal1,
        work,
    )? {
        return Ok(None);
    }
    if refine_existing
        && rounded::vertical_capsule_separated(
            a,
            shape_a,
            b,
            shape_b,
            start,
            end,
            proof_clearance,
            left.normal1,
            work,
        )?
    {
        return Ok(None);
    }
    if positive_initial.is_some() && refine_existing {
        if let Some(hit) = rounded::shared_planar_capsule_hit(
            a,
            shape_a,
            b,
            shape_b,
            start,
            end,
            proof_clearance,
            time_tolerance,
            work,
        )? {
            return Ok(Some(hit));
        }
    }
    let mut face_prefix = if !existing && left.dist > proof_clearance {
        supported_capsule_face::prefix(
            a,
            shape_a,
            b,
            shape_b,
            left.normal1,
            start,
            end,
            proof_clearance,
            work,
        )?
    } else {
        None
    };
    if face_prefix == Some(end) {
        return Ok(None);
    }
    let prefix = if shape_a.as_cuboid().is_some() && shape_b.as_cuboid().is_some() {
        rounded::native_box_face_cast(
            a,
            shape_a,
            b,
            shape_b,
            left,
            start,
            end,
            proof_clearance,
            time_tolerance,
            work,
        )?
    } else {
        rounded::cardinal_box_capsule_prefix(
            a,
            shape_a,
            b,
            shape_b,
            left.normal1,
            start,
            end,
            proof_clearance,
            time_tolerance,
            work,
        )?
    };
    match prefix {
        Some(rounded::FacePrefix::Through(through)) => {
            face_prefix = Some(face_prefix.map_or(through, |old| old.max(through)))
        }
        Some(rounded::FacePrefix::Separated) => return Ok(None),
        Some(rounded::FacePrefix::Boundary {
            safe_time,
            hit_time,
            witness,
        }) => {
            let native = contact_at(hit_time, work)?;
            let contact = if native.dist <= proof_clearance {
                Some(native)
            } else if witness.is_some() {
                witness
            } else {
                // The real radius around the rounded capsule core can reach
                // the face before its rounded local pole. Verify the actual
                // world witness at the first certified boundary.
                let (actual, strict) = observe(hit_time, native, work, None, true)?;
                strict.then_some(actual)
            };
            if let Some(contact) = contact {
                return Ok(Some(CastHit {
                    safe_time,
                    hit_time,
                    contact,
                    subshape_a: 0,
                    subshape_b: 0,
                }));
            }
            face_prefix = Some(face_prefix.map_or(safe_time, |old| old.max(safe_time)));
        }
        None => {}
    }
    // A near-start rotating face can cross the selected margin in a
    // single rounded translation cell. Inspect the first leftmost
    // tolerance bracket and its midpoint before proving a long suffix.
    // Only a verified strict point can shorten the original search;
    // the usual prefix checks still own the returned bracket.
    let mut early = None;
    if !existing && left.dist > proof_clearance && end - start > time_tolerance {
        let kernels = match (a.curve, b.curve) {
            (Curve::Integrated(ka), Curve::Integrated(kb)) => Some((ka, kb)),
            (Curve::Integrated(ka), Curve::Anchored { carrier, .. })
                if shape_a.as_cuboid().is_some()
                    && carrier.native.motion.body == ka.native.motion.body =>
            {
                Some((ka, carrier))
            }
            (Curve::Anchored { carrier, .. }, Curve::Integrated(kb))
                if shape_b.as_cuboid().is_some()
                    && carrier.native.motion.body == kb.native.motion.body =>
            {
                Some((carrier, kb))
            }
            _ => None,
        };
        if let (Some(pair), Some((ka, kb))) = (&world_pair, kernels) {
            work.charge(64)?;
            let box_direction = if shape_a.as_capsule().is_some()
                && shape_b.as_cuboid().is_some()
                && kb.native.angular_velocity != rp::Vector::ZERO
            {
                Some(kb.native.linear_velocity.dot(left.normal1))
            } else if shape_a.as_cuboid().is_some()
                && shape_b.as_capsule().is_some()
                && ka.native.angular_velocity != rp::Vector::ZERO
            {
                Some(-ka.native.linear_velocity.dot(left.normal1))
            } else {
                None
            };
            let coordinate = left.point1.abs().max(left.point2.abs()).max_element();
            let spacing = f64::from(coordinate.next_up()) - f64::from(coordinate);
            if box_direction.is_some()
                && spacing.is_finite()
                && f64::from(left.dist) - f64::from(proof_clearance) <= spacing
            {
                let mut near = end;
                for _ in 0..MAX_DEPTH {
                    work.charge(4)?;
                    let middle = start + (near - start) * 0.5;
                    if middle <= start || middle >= near {
                        break;
                    }
                    near = middle;
                    if near - start <= time_tolerance {
                        let midpoint = start + (near - start) * 0.5;
                        // Incoming motion can cross and leave the
                        // first cell before the right endpoint. Otherwise
                        // preserve the original near-right observation first.
                        let targets = if box_direction.is_some_and(|rate| rate < 0.) {
                            [midpoint, near]
                        } else {
                            [near, midpoint]
                        };
                        for at in targets {
                            if at <= start {
                                continue;
                            }
                            let native = contact_at(at, work)?;
                            let (contact, strict) = observe(at, native, work, None, true)?;
                            if strict {
                                early = Some((at, contact, true));
                                break;
                            }
                            if native.dist <= proof_clearance
                                && pair.native_strict_at(a, b, at, proof_clearance, work)?
                            {
                                early = Some((at, native, true));
                                break;
                            }
                        }
                        break;
                    }
                }
            }
        }
    }
    let rotating_box_ball = proof_clearance >= 0.
        && ((shape_a.as_cuboid().is_some()
            && shape_b.as_ball().is_some()
            && a.has_integrated_spin()
            && b.is_fixed_axis_aligned())
            || (shape_b.as_cuboid().is_some()
                && shape_a.as_ball().is_some()
                && b.has_integrated_spin()
                && a.is_fixed_axis_aligned()));
    if rotating_box_ball && early.is_none() && !existing && left.dist > proof_clearance {
        let point = left.point1.abs().max(left.point2.abs()).max_element();
        let spacing = f64::from(point.next_up()) - f64::from(point);
        let gap = f64::from(left.dist) - f64::from(proof_clearance);
        if spacing.is_finite() && gap <= spacing {
            for span in [4., 8., 16., 32.] {
                work.charge(8)?;
                let at = start + time_tolerance * span;
                if at <= start || at >= end {
                    break;
                }
                let native = contact_at(at, work)?;
                let (contact, strict) = observe(at, native, work, None, true)?;
                if strict {
                    early = Some((at, contact, true));
                    break;
                }
            }
        }
    }
    let mut wall_prefix = None;
    if early.is_none() && !existing && left.dist > proof_clearance {
        let cache = rounded::AxisCache::new(a, shape_a, b, shape_b, start, end, proof_clearance);
        if let Some(hint) = rounded::fixed_wall_time_hint(&cache) {
            work.charge(256)?;
            let right = (hint + 16. * time_tolerance).min(end);
            let candidate = contact_at(right, work)?;
            let (hit, strict) = observe(right, candidate, work, None, true)?;
            let strict = strict
                || (candidate.dist < 0. && rounded::fixed_wall_overlap(&cache, right, work)?);
            if strict {
                for width in [16., 64.] {
                    let through = hint - width * time_tolerance;
                    if through <= start {
                        break;
                    }
                    let cache = rounded::AxisCache::new(
                        a,
                        shape_a,
                        b,
                        shape_b,
                        start,
                        through,
                        proof_clearance,
                    );
                    let proved = rounded::planar_rotating_box_separated(&cache, work)?;
                    if proved {
                        early = Some((right, hit, strict));
                        wall_prefix = Some((through, contact_at(through, work)?));
                        break;
                    }
                }
            }
        }
    }
    // Rebased short paths can have only a few original XY states.
    // Check those states before the linear-sweep fallback repeats them.
    let independent_rebase = [a, b].into_iter().any(|s| {
        matches!(s.curve,Curve::Anchored{carrier,anchor,linear_velocity,..}
            if anchor==rp::Vector::ZERO && linear_velocity==rp::Vector::ZERO
                && carrier.native.angular_velocity==rp::Vector::ZERO
                && carrier.native.linear_velocity.x!=0. && carrier.native.linear_velocity.y!=0.)
    });
    if independent_rebase && end - start <= time_tolerance * 4. {
        let cache = rounded::AxisCache::new(a, shape_a, b, shape_b, start, end, proof_clearance);
        let mut proof = Work {
            used: 0,
            limit: (work.limit - work.used).min(8 * 1024 * 1024),
        };
        let answer = rounded::corotating_projected_prefix(&cache, &mut proof);
        work.charge(proof.used)?;
        match answer {
            Ok(IntervalCertificate::Separated) => return Ok(None),
            Ok(IntervalCertificate::Hit(hit)) => return Ok(Some(hit)),
            Ok(_) | Err(TrajectoryError::WorkLimit) => {}
            Err(error) => return Err(error),
        }
    }
    let (upper, right, right_world_strict) = match early {
        Some(observed) => observed,
        None => {
            let (right, strict) = observe(end, contact_at(end, work)?, work, None, true)?;
            (end, right, strict)
        }
    };
    let rigid_anchor = rounded::has_rigid_anchor(a, b);
    if rigid_anchor {
        let cache = rounded::AxisCache::new(a, shape_a, b, shape_b, start, upper, proof_clearance);
        if !right_world_strict && rounded::corotating_separated(&cache, work)? {
            return Ok(None);
        }
    }
    if (!rigid_anchor || rounded::has_stationary_anchor(a, b))
        && (!existing || refine_existing)
        && left.dist > proof_clearance
    {
        match rounded::planar_capsule_sweep(
            a,
            shape_a,
            b,
            shape_b,
            start,
            upper,
            proof_clearance,
            left.normal1,
            time_tolerance,
            matches!(strict_prefix, Some(StrictPrefix::FirstCell))
                && positive_initial.is_none()
                && left.dist > clearance,
            work,
        )? {
            IntervalCertificate::Hit(hit) => return Ok(Some(hit)),
            IntervalCertificate::Separated if !right_world_strict => return Ok(None),
            _ => {}
        }
    }
    let (mut search_start, mut initial_left) = wall_prefix.unwrap_or((start, left));
    if edge_prefix > search_start && edge_prefix < upper {
        search_start = edge_prefix;
        initial_left = contact_at(edge_prefix, work)?;
    }
    if let Some(through) = face_prefix.filter(|&t| search_start < t && t < upper) {
        search_start = through;
        initial_left = contact_at(through, work)?;
    }
    if !rigid_anchor || (refine_existing && positive_initial.is_some()) {
        let near = upper.min(start + time_tolerance * if rigid_anchor { 32. } else { 12. });
        if near > start {
            let cache =
                rounded::AxisCache::new(a, shape_a, b, shape_b, start, near, proof_clearance);
            let available = work.limit - work.used;
            let mut proof = Work {
                used: 0,
                limit: available.min(8 * 1024 * 1024),
            };
            let clear = rounded::corotating_projected_prefix(&cache, &mut proof);
            work.charge(proof.used)?;
            match clear {
                Ok(IntervalCertificate::Separated) => {
                    if near == upper {
                        if !right_world_strict {
                            return Ok(None);
                        }
                    } else if near > search_start {
                        search_start = near;
                        initial_left = contact_at(near, work)?;
                    }
                }
                Ok(IntervalCertificate::Hit(hit)) => return Ok(Some(hit)),
                Ok(IntervalCertificate::Unproven | IntervalCertificate::Point { .. })
                | Err(TrajectoryError::WorkLimit) => {}
                Err(error) => return Err(error),
            }
        }
    }
    let mut initial = SearchInterval {
        start: search_start,
        end: upper,
        left: initial_left,
        right,
        left_world_strict,
        right_world_strict,
        depth: 0,
    };
    let mut stack = [None; MAX_DEPTH + 1];
    let mut count = 1;
    let mut safe = search_start;
    if search_start == start && !existing && left.dist > proof_clearance {
        let mut frontier = rounded::staggered_prefix(
            a,
            shape_a,
            b,
            shape_b,
            start,
            upper,
            proof_clearance,
            left.normal1,
            time_tolerance,
            work,
        )?;
        let shared_normal = frontier.is_none();
        if shared_normal {
            frontier = rounded::shared_normal_prefix(
                a,
                shape_a,
                b,
                shape_b,
                start,
                upper,
                proof_clearance,
                left.normal1,
                work,
            )?;
        }
        let shared_normal = shared_normal && frontier.is_some();
        if frontier.is_none() {
            frontier = rounded::rotating_box_ball_prefix(
                a,
                shape_a,
                b,
                shape_b,
                start,
                upper,
                proof_clearance,
                left.normal1,
                time_tolerance,
                work,
            )?;
        }
        if let Some(frontier) = frontier {
            if frontier == upper && !right_world_strict {
                // Any shortened upper is the result of a verified strict
                // point, so this path only clears the original full range.
                return Ok(None);
            }
            if frontier < upper {
                let (new_left, strict) =
                    observe(frontier, contact_at(frontier, work)?, work, None, true)?;
                if !strict {
                    // A proved clear prefix followed by a strict actual
                    // contact at the next represented time admits an exact
                    // bracket. The scalar projection alone cannot nominate
                    // points or normals and never returns a contact.
                    let next = frontier.next_up();
                    if shared_normal && next <= upper {
                        let (mut contact, mut strict) =
                            observe(next, contact_at(next, work)?, work, None, true)?;
                        if !strict {
                            if let Some(pair) = &world_pair {
                                if let Some(witness) = pair.signed_normal_axis_poses(
                                    &a.pose(next),
                                    &b.pose(next),
                                    proof_clearance,
                                    work,
                                )? {
                                    if witness.strict {
                                        strict = true;
                                        if contact.dist > proof_clearance {
                                            contact = witness.contact;
                                        }
                                    }
                                }
                            }
                        }
                        if strict {
                            return Ok(Some(CastHit {
                                safe_time: frontier,
                                hit_time: next,
                                contact,
                                subshape_a: 0,
                                subshape_b: 0,
                            }));
                        }
                    }
                    safe = frontier;
                    initial.start = frontier;
                    initial.left = new_left;
                    // Visit a bounded neighborhood of the proved frontier
                    // first. The untouched later interval stays on the same
                    // chronological stack with its original right witness.
                    work.charge(8)?;
                    let near = (frontier + time_tolerance * 32.).min(upper);
                    if near > frontier && near < upper {
                        let (edge, edge_strict) =
                            observe(near, contact_at(near, work)?, work, None, true)?;
                        stack[0] = Some(SearchInterval {
                            start: near,
                            left: edge,
                            left_world_strict: edge_strict,
                            depth: 1,
                            ..initial
                        });
                        initial.end = near;
                        initial.right = edge;
                        initial.right_world_strict = edge_strict;
                        initial.depth = 1;
                        count = 2;
                    }
                }
            }
        }
    }
    stack[count - 1] = Some(initial);
    let mut rounded_probes = world_contact::RoundedBoxBallProbes::default();
    let mut capsule_ball =
        world_contact::RoundedCapsuleBall::new(a, shape_a, b, shape_b, proof_clearance);
    while count > 0 {
        count -= 1;
        let mut interval = stack[count].take().ok_or(TrajectoryError::Unresolved)?;
        let mut middle = interval.start + (interval.end - interval.start) * 0.5;
        // Look for a genuine strict interior point before spending the whole
        // budget on an impossible >= proof. This is only a positive cue: it
        // never certifies a clear interval or publishes a hit before its full
        // chronological prefix and original tolerance have been admitted.
        let mut middle_observation = None;
        let mut middle_world_observation = None;
        if middle > interval.start && middle < interval.end {
            if let Some(pair) = &world_pair {
                let witness = match pair.at(a, b, middle, proof_clearance, work)? {
                    Some(witness) => Some(witness),
                    None => pair.normal_axis_at(a, b, middle, proof_clearance, work)?,
                };
                middle_world_observation = Some((middle, proof_clearance, witness));
                if let Some(witness) = witness {
                    if witness.strict {
                        let native = contact_at(middle, work)?;
                        middle_observation = Some((
                            if native.dist <= proof_clearance {
                                native
                            } else {
                                witness.contact
                            },
                            true,
                        ));
                    }
                }
            }
        }
        if let Some((contact, true)) = middle_observation {
            // The actual strict midpoint is already an upper bound for first
            // contact. Retain it before the tolerance/right/probe fast return;
            // none of those paths may publish a later upper bound instead.
            // Its prefix is still unproved and follows the same chronology.
            interval = interval.close_at_point(middle, contact);
            middle = interval.start + (interval.end - interval.start) * 0.5;
            middle_observation = None;
            // The saved world observation keeps its OLD exact time tag. A
            // new midpoint can only reuse it if those original bits match.
        }
        let witnessed = interval.left_world_strict
            || interval.right_world_strict
            || middle_observation.is_some();
        // A single same world axis separating every pair of proxy vertices
        // over this interval certifies all of its interior times too. A strict
        // actual point inside the selected margin contradicts such a proof;
        // a Native contact alone can still be refuted by the original proof.
        let separation = if interval.right_world_strict
            && !interval.left_world_strict
            && interval.end - interval.start <= time_tolerance
        {
            // The real strict right point rules out NoHit, but the original
            // finite-state walker can still recover an exact first-cell Hit.
            // Keep its old consumption/refutation gates below; a clear or
            // unavailable walker result has no authority over this point.
            rounded::timeline_certificate(
                a,
                shape_a,
                b,
                shape_b,
                interval.start,
                interval.end,
                proof_clearance,
                work,
            )
            .map(|proof| match proof {
                IntervalCertificate::Hit(_) => proof,
                _ => IntervalCertificate::Unproven,
            })
        } else if interval.left_world_strict
            || interval.right_world_strict
            || middle_observation.is_some()
        {
            Ok(IntervalCertificate::Unproven)
        } else if interval.right_world_strict && rotating_box_ball {
            // A real in-margin point prevents a whole-interval clear proof.
            // Continue chronologically so earlier subintervals still prove safe.
            Ok(IntervalCertificate::Unproven)
        } else {
            let mut point_observer = |time: Time, work: &mut Work| {
                // The original midpoint's world observation already ran.
                // A nominated time is only another positive lookup, never
                // evidence of clearance when no strict witness is found.
                if !time.is_finite()
                    || time <= interval.start
                    || time >= interval.end
                    || time == middle
                {
                    return Ok(None);
                }
                let Some(pair) = &world_pair else {
                    return Ok(None);
                };
                let witness = match pair.at(a, b, time, proof_clearance, work)? {
                    Some(witness) => Some(witness),
                    None => pair.normal_axis_at(a, b, time, proof_clearance, work)?,
                };
                let Some(witness) = witness else {
                    return Ok(None);
                };
                if !witness.strict {
                    return Ok(None);
                }
                let native = contact_at(time, work)?;
                Ok(Some(if native.dist <= proof_clearance {
                    native
                } else {
                    witness.contact
                }))
            };
            certified_separation_axes_observed(
                a,
                shape_a,
                b,
                shape_b,
                interval.left.normal1,
                (interval.right.normal1 != interval.left.normal1).then_some(interval.right.normal1),
                interval.start,
                interval.end,
                proof_clearance,
                work,
                if world_pair.is_some() {
                    Some(&mut point_observer)
                } else {
                    None
                },
            )
        };
        let proof = separation.inspect_err(|_error| {
            #[cfg(test)]
            eprintln!(
                "ACTUAL_CAST_CERTIFICATE_ERR case={:?} error={_error:?} depth={} pending={} interval=[{:?},{:?}] proof_clearance={:?} safe={:?} time_tolerance={:?} work={}/{} left={:?} right={:?} shapeA={:?} shapeB={:?} motionA={a:?} motionB={b:?}",
                std::thread::current().name(), interval.depth, count, interval.start, interval.end, proof_clearance,
                safe, time_tolerance, work.used, work.limit, interval.left, interval.right, shape_a.shape_type(), shape_b.shape_type(),
            );
        })?;
        let separated = match proof {
            IntervalCertificate::Separated => true,
            // A spinning centered ball within its f32 rotation error of the
            // margin defeats both the rotated-sphere enclosures and the
            // translation-only proofs that reject spin, so bisection would
            // stall at its depth/midpoint limit. Only an interval observed
            // clear at both ends, with no strict witness, tries the twin.
            IntervalCertificate::Unproven => {
                !witnessed
                    && interval.left.dist > proof_clearance
                    && interval.right.dist > proof_clearance
                    && centered_ball_twins_separated(
                        a,
                        shape_a,
                        b,
                        shape_b,
                        interval.left.normal1,
                        (interval.right.normal1 != interval.left.normal1)
                            .then_some(interval.right.normal1),
                        interval.start,
                        interval.end,
                        proof_clearance,
                        work,
                    )?
            }
            IntervalCertificate::Point { time, contact } => {
                // This proves an upper bound for first contact, not its
                // prefix. Narrow that bound then bisect normally, so even a
                // cue near the old end preserves the original depth progress.
                interval = interval.close_at_point(time, contact);
                middle = interval.start + (interval.end - interval.start) * 0.5;
                middle_observation = None;
                false
            }
            IntervalCertificate::Hit(hit) => {
                if interval.start == safe
                    && hit.safe_time >= interval.start
                    && hit.hit_time > hit.safe_time
                    && hit.hit_time <= interval.end
                    && hit.hit_time - hit.safe_time <= time_tolerance
                    && hit.contact.dist <= proof_clearance
                {
                    // The exact walker covered every preceding F64 cell. Do
                    // not turn a noisy leaf contact into a new hit policy:
                    // the original whole-support proof gets the same narrow
                    // bracket and original left/right normal order first.
                    let left = contact_at(hit.safe_time, work)?;
                    if left.dist > proof_clearance
                        && !certified_separation_axes_only(
                            a,
                            shape_a,
                            b,
                            shape_b,
                            left.normal1,
                            (hit.contact.normal1 != left.normal1).then_some(hit.contact.normal1),
                            hit.safe_time,
                            hit.hit_time,
                            proof_clearance,
                            work,
                        )?
                    {
                        return Ok(Some(hit));
                    }
                }
                // First-state contact, a wider bracket or a refuted witness
                // still follows the original chronological search/outgoing
                // contact policy. No clear prefix becomes a whole proof.
                false
            }
        };
        if separated {
            safe = interval.end;
            continue;
        }
        if interval.end - interval.start <= time_tolerance {
            if interval.left.dist > proof_clearance && interval.right.dist > proof_clearance {
                let edge_separated = |hull: ShapeMotion,
                                      poly,
                                      cap: ShapeMotion,
                                      capsule,
                                      point,
                                      inward,
                                      work: &mut Work| {
                    if !matches!(hull.curve, Curve::Constant { .. })
                        || cap.translation_kernel().is_none()
                    {
                        return Ok(false);
                    }
                    rounded::rounded_cap_edge_separated(
                        poly,
                        hull.metered_pose(interval.start, work)?,
                        point,
                        capsule,
                        [
                            cap.metered_pose(interval.start, work)?.translation,
                            cap.metered_pose(interval.end, work)?.translation,
                        ],
                        inward,
                        proof_clearance,
                        work,
                    )
                };
                let right = interval.right;
                let separated = if let (Some(poly), Some(cap)) =
                    (shape_a.as_convex_polyhedron(), shape_b.as_capsule())
                {
                    edge_separated(a, poly, b, cap, right.point1, right.normal2, work)?
                } else if let (Some(cap), Some(poly)) =
                    (shape_a.as_capsule(), shape_b.as_convex_polyhedron())
                {
                    edge_separated(b, poly, a, cap, right.point2, right.normal1, work)?
                } else {
                    false
                };
                if separated {
                    safe = interval.end;
                    continue;
                }
            }
            let ramp_boundary =
                |through, contact: rapier3d::parry::query::Contact, work: &mut Work| {
                    let (hull, cap) = if feature_contact::RampFaces::from_shape(shape_a).is_some()
                        && shape_b.as_capsule().is_some()
                    {
                        (a, b)
                    } else if shape_a.as_capsule().is_some()
                        && feature_contact::RampFaces::from_shape(shape_b).is_some()
                    {
                        (b, a)
                    } else {
                        return Ok(None);
                    };
                    if interval.start != safe
                        || !matches!(hull.curve, Curve::Constant { .. })
                        || cap.translation_kernel().is_none()
                    {
                        return Ok(None);
                    }
                    let (mut before, mut after) = (interval.start, through);
                    let pose = cap.metered_pose(after, work)?;
                    let at_plane = |sample: rp::Pose| {
                        (0..3).all(|i| {
                            contact.normal1[i] == 0. || sample.translation[i] == pose.translation[i]
                        })
                    };
                    if at_plane(cap.metered_pose(before, work)?) {
                        return Ok(None);
                    }
                    // Follow the coordinates that move the support plane. An
                    // independent tangent step must not delay its first contact.
                    while before.next_up() < after {
                        work.charge(32)?;
                        let mid = before.midpoint(after);
                        if mid <= before || mid >= after {
                            return Ok(None);
                        }
                        if at_plane(cap.metered_pose(mid, work)?) {
                            after = mid;
                        } else {
                            before = mid;
                        }
                    }
                    let mut cache = rounded::AxisCache::new(
                        a,
                        shape_a,
                        b,
                        shape_b,
                        interval.start,
                        before,
                        proof_clearance,
                    );
                    if !rounded::ramp_capsule_separated(&mut cache, contact.normal1, work)? {
                        return Ok(None);
                    }
                    // The finite face still needs a witness at the new time if
                    // an in-plane coordinate took a different rounding step.
                    let contact = if same_pose_bits(cap.metered_pose(after, work)?, pose) {
                        Some(contact)
                    } else {
                        ramp_contact_at(after, proof_clearance, work)?
                            .filter(|witness| witness.dist <= proof_clearance)
                    };
                    Ok(contact.map(|contact| (before, after, contact)))
                };
            let right_hits = interval.right.dist <= proof_clearance;
            let ramp_witness = if right_hits {
                Some(interval.right)
            } else if interval.start == safe
                && interval.end - interval.start <= time_tolerance / 16.
            {
                ramp_contact_at(interval.end, proof_clearance, work)?
                    .filter(|contact| contact.dist <= proof_clearance)
            } else {
                None
            };
            if let Some(contact) = ramp_witness {
                if let Some((before, after, contact)) = ramp_boundary(interval.end, contact, work)?
                {
                    return Ok(Some(CastHit {
                        safe_time: before,
                        hit_time: after,
                        contact,
                        subshape_a: 0,
                        subshape_b: 0,
                    }));
                }
            }
            if right_hits {
                return Ok(Some(CastHit {
                    safe_time: safe,
                    hit_time: interval.end,
                    contact: interval.right,
                    subshape_a: 0,
                    subshape_b: 0,
                }));
            }
            // A small unproved interval is not a hit. Look only for a real
            // witness within the existing safe-prefix bracket; this query can
            // establish a hit, never a sampled no-hit. If absent, refine the
            // interval further instead of confusing tolerance with failure.
            let mut probe = (safe + time_tolerance).min(end);
            if probe - safe > time_tolerance {
                probe = probe.next_down();
            }
            if probe > interval.end {
                let (mut contact, _) = observe(probe, contact_at(probe, work)?, work, None, true)?;
                let mut hit_time = probe;
                if contact.dist > proof_clearance
                    && interval.end - interval.start <= time_tolerance / 16.
                    && rotating_box_ball
                {
                    if let Some(pair) = &world_pair {
                        let sliding = (a.has_integrated_spin() && !a.is_single_axis_spin())
                            || (b.has_integrated_spin() && !b.is_single_axis_spin());
                        let rounded = rounded_probes.contact(
                            pair,
                            a,
                            b,
                            safe,
                            interval.end,
                            probe,
                            time_tolerance,
                            proof_clearance,
                            work,
                            sliding,
                            |at, work| {
                                let native = contact_at(at, work)?;
                                if native.dist > proof_clearance {
                                    return Ok(None);
                                }
                                let (candidate, strict) = observe(at, native, work, None, true)?;
                                Ok(strict.then_some(candidate))
                            },
                        )?;
                        if let Some((at, rounded)) = rounded {
                            if at > safe && at - safe <= time_tolerance {
                                contact = rounded;
                                hit_time = at;
                            }
                        }
                    }
                }
                if contact.dist > proof_clearance
                    && interval.end - interval.start <= time_tolerance / 16.
                {
                    if let Some(pair) = &mut capsule_ball {
                        if let Some(rounded) = pair.contact(probe, work)? {
                            contact = rounded;
                        }
                    } else if let Some(rounded) = world_contact::rotating_capsule_box_contact(
                        a,
                        shape_a,
                        b,
                        shape_b,
                        probe,
                        proof_clearance,
                        work,
                    )? {
                        contact = rounded;
                    }
                }
                if contact.dist <= proof_clearance {
                    let (safe_time, hit_time, contact) = ramp_boundary(hit_time, contact, work)?
                        .unwrap_or((safe, hit_time, contact));
                    return Ok(Some(CastHit {
                        safe_time,
                        hit_time,
                        contact,
                        subshape_a: 0,
                        subshape_b: 0,
                    }));
                }
            }
        }
        // Two adjacent logical times have no midpoint to search. Finish
        // only when both original shapes prove a clear left state and an
        // actual contact at the right state.
        if interval.start == safe && interval.start.next_up() == interval.end {
            if let Some(pair) = &world_pair {
                if let Some(witness) = pair.capsule_boundary_at(
                    a,
                    b,
                    interval.start,
                    interval.end,
                    interval.left.normal1,
                    proof_clearance,
                    work,
                )? {
                    return Ok(Some(CastHit {
                        safe_time: interval.start,
                        hit_time: interval.end,
                        contact: witness.contact,
                        subshape_a: 0,
                        subshape_b: 0,
                    }));
                }
            }
        }
        if usize::from(interval.depth) == MAX_DEPTH || count + 2 > stack.len() {
            #[cfg(test)]
            eprintln!(
                "ACTUAL_CAST_FRONTIER_LIMIT depth={} pending={} cap={} interval=[{:?},{:?}] left={:?} right={:?} proof_clearance={:?} safe={:?} time_tolerance={:?} work={}/{} left_witness={:?} right_witness={:?}",
                interval.depth, count, stack.len(), interval.start, interval.end,
                interval.left.dist, interval.right.dist, proof_clearance, safe,
                time_tolerance, work.used, work.limit, interval.left, interval.right,
            );
            return Err(TrajectoryError::WorkLimit);
        }
        if middle <= interval.start || middle >= interval.end {
            #[cfg(test)]
            if (0.048..=0.05).contains(&start) {
                finite_search_trace(2, "no-representable-midpoint", format_args!(
                    "query=[{start:.18e},{end:.18e}] interval=[{:.18e},{:.18e}] middle={middle:.18e} depth={} pending={count} safe={safe:.18e} selected={proof_clearance:?} left={:?} right={:?} left_world={} right_world={} work={}/{}", interval.start, interval.end, interval.depth, interval.left, interval.right, interval.left_world_strict, interval.right_world_strict, work.used, work.limit));
            }
            return Err(TrajectoryError::Unresolved);
        }
        let (contact, world_strict) = if let Some(observation) = middle_observation {
            observation // The original midpoint Native query executes once.
        } else {
            observe(
                middle,
                contact_at(middle, work).inspect_err(|_error| {
                    #[cfg(test)]
                    if matches!(
                        std::thread::current().name(),
                        Some("physics3d::character_tests::elevator_support_is_evaluated_after_the_platform_moves")
                    ) {
                        eprintln!(
                            "C71_MIDPOINT_CONTACT_ERR case={:?} error={_error:?} interval=[{:?},{:?}] middle={middle:?} proof_clearance={proof_clearance:?} depth={} pending={count} safe={safe:?} work={}/{} motion_a={a:?} motion_b={b:?}",
                            std::thread::current().name(),
                            interval.start,
                            interval.end,
                            interval.depth,
                            work.used,
                            work.limit,
                        );
                    }
                })?,
                work,
                middle_world_observation,
                true,
            )?
        };
        // Right first, then left: LIFO visitation remains deterministic and
        // chronological, independently of shape/BVH candidate ordering.
        stack[count] = Some(SearchInterval {
            start: middle,
            left: contact,
            left_world_strict: world_strict,
            depth: interval.depth + 1,
            ..interval
        });
        stack[count + 1] = Some(SearchInterval {
            end: middle,
            right: contact,
            right_world_strict: world_strict,
            depth: interval.depth + 1,
            ..interval
        });
        count += 2;
    }
    Ok(None)
}

type LeafVisitor<'a> =
    dyn FnMut(&dyn rp::Shape, ShapeMotion, u32, &mut Work) -> Result<(), TrajectoryError> + 'a;

type ContactVisitor<'a> = dyn FnMut(rapier3d::parry::query::Contact, u32, u32, &mut Work) -> Result<(), TrajectoryError>
    + 'a;

/// Full supported geometry, including every real compound/terrain leaf.
/// `visit` borrows temporary triangles only during the call; geometry is never
/// cloned, rebuilt, shrunk, normalized or ignored.
#[allow(clippy::too_many_arguments)]
fn leaves(
    shape: &dyn rp::Shape,
    motion: ShapeMotion,
    query: ShapeMotion,
    query_shape: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
    visit: &mut LeafVisitor<'_>,
) -> Result<(), TrajectoryError> {
    use rapier3d::parry::bounding_volume::BoundingVolume;
    use rapier3d::parry::shape::TypedShape;
    work.charge(1)?;
    match shape.as_typed_shape() {
        TypedShape::Compound(compound) => {
            let bounds = motion
                .relative_query_bounds(query, query_shape, start, end)?
                .loosened(clearance);
            visit_bvh(compound.bvh(), &bounds, work, &mut |index, work| {
                let (local, part) = &compound.shapes()[index as usize];
                let child = ShapeMotion {
                    local_pose: motion.local_pose * *local,
                    ..motion
                };
                // Core admits only convex non-nested compound parts. Unknown
                // nested geometry is rejected, not treated as a missing leaf.
                ToiProxy::from_shape(part.as_ref()).ok_or(TrajectoryError::UnsupportedShape)?;
                visit(part.as_ref(), child, index, work)
            })?;
        }
        TypedShape::TriMesh(mesh) => {
            let bounds = motion
                .relative_query_bounds(query, query_shape, start, end)?
                .loosened(clearance);
            visit_bvh(mesh.bvh(), &bounds, work, &mut |index, work| {
                let triangle = mesh.triangle(index);
                visit(&triangle, motion, index, work)
            })?;
        }
        TypedShape::HeightField(field) => {
            let bounds = motion
                .relative_query_bounds(query, query_shape, start, end)?
                .loosened(clearance);
            let lo = field.closest_cell_at_point(bounds.mins);
            let hi = field.closest_cell_at_point(bounds.maxs);
            let cells =
                lo.0.abs_diff(hi.0)
                    .checked_add(2)
                    .and_then(|a| {
                        lo.1.abs_diff(hi.1)
                            .checked_add(2)
                            .and_then(|b| a.checked_mul(b))
                    })
                    .and_then(|n| n.checked_mul(16))
                    .ok_or(TrajectoryError::WorkLimit)?;
            work.charge(u64::try_from(cells).map_err(|_| TrajectoryError::WorkLimit)?)?;
            let mut failure = None;
            field.map_elements_in_local_aabb(&bounds, &mut |id, triangle| {
                if failure.is_none() {
                    failure = visit(triangle, motion, id, work).err();
                }
            });
            if let Some(error) = failure {
                return Err(error);
            }
        }
        _ => {
            ToiProxy::from_shape(shape).ok_or(TrajectoryError::UnsupportedShape)?;
            visit(shape, motion, 0, work)?;
        }
    }
    Ok(())
}

fn visit_bvh(
    tree: &rapier3d::parry::partitioning::Bvh,
    bounds: &rapier3d::parry::bounding_volume::Aabb,
    work: &mut Work,
    visit: &mut dyn FnMut(u32, &mut Work) -> Result<(), TrajectoryError>,
) -> Result<(), TrajectoryError> {
    use rapier3d::parry::bounding_volume::BoundingVolume;
    use std::cell::Cell;
    let used = Cell::new(work.used);
    let failed = Cell::new(false);
    let limit = work.limit;
    let mut result = Ok(());
    {
        let candidates = tree.leaves(|node| {
            let next = used.get().checked_add(1);
            if let Some(next) = next.filter(|n| *n <= limit) {
                used.set(next);
                node.aabb().intersects(bounds)
            } else {
                failed.set(true);
                false
            }
        });
        for index in candidates {
            let mut local = Work {
                used: used.get(),
                limit,
            };
            result = visit(index, &mut local);
            used.set(local.used);
            if result.is_err() {
                break;
            }
        }
    }
    work.used = used.get();
    if failed.get() {
        return Err(TrajectoryError::WorkLimit);
    }
    result
}

#[allow(clippy::too_many_arguments)]
pub(super) fn cast_full_shapes(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
) -> Result<Option<CastHit>, TrajectoryError> {
    cast_full_shapes_policy(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        time_tolerance,
        work,
        false,
    )
}
#[allow(clippy::too_many_arguments)]
pub(super) fn cast_full_shapes_policy(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
    allow_existing_penetration: bool,
) -> Result<Option<CastHit>, TrajectoryError> {
    cast_full_shapes_policy_coverage(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        time_tolerance,
        work,
        allow_existing_penetration,
    )
    .map(|result| result.hit)
}

/// Private provenance of the original complete query. A clear prefix is reusable
/// only when its initial leaf predicate is also known unchanged by the consumer.
#[derive(Clone, Copy)]
pub(super) struct CastCoverage {
    pub hit: Option<CastHit>,
    pub strictly_clear_start: bool,
    pub reused: bool,
}

/// Validated only by the same immutable-context query owner. The interval,
/// complete expressions, shape owners and policy must match that owner's old
/// certificate; the original new-start leaf is still mandatory before use.
#[derive(Clone, Copy)]
pub(super) enum StrictPrefix {
    Clear,
    FirstCell,
    /// The original chronological bracket and its actual contact.
    Hit(CastHit),
}

#[allow(clippy::too_many_arguments)]
pub(super) fn cast_full_shapes_policy_coverage(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
    allow_existing_penetration: bool,
) -> Result<CastCoverage, TrajectoryError> {
    cast_full_shapes_policy_reusing(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        time_tolerance,
        work,
        allow_existing_penetration,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn cast_full_shapes_policy_reusing(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
    allow_existing_penetration: bool,
    strict_prefix: Option<StrictPrefix>,
) -> Result<CastCoverage, TrajectoryError> {
    cast_full_shapes_policy_reusing_bounds(
        a,
        shape_a,
        b,
        shape_b,
        start,
        end,
        clearance,
        time_tolerance,
        work,
        allow_existing_penetration,
        strict_prefix,
        [None; 2],
    )
}

/// The exact primitive bounds were already proved by the immutable scene
/// owner. Leaf, initial-contact and interval policy still execute normally.
#[allow(clippy::too_many_arguments)]
pub(super) fn cast_full_shapes_policy_reusing_bounds(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    time_tolerance: Time,
    work: &mut Work,
    allow_existing_penetration: bool,
    strict_prefix: Option<StrictPrefix>,
    prepared: [Option<rp::Aabb>; 2],
) -> Result<CastCoverage, TrajectoryError> {
    use rapier3d::parry::bounding_volume::BoundingVolume;
    let mut first: Option<CastHit> = None;
    let primitive = |shape: &dyn rp::Shape| {
        shape.as_ball().is_some() || shape.as_cuboid().is_some() || shape.as_capsule().is_some()
    };
    let mut strictly_clear_start = primitive(shape_a) && primitive(shape_b);
    let mut observed_leaves = 0_usize;
    let [prepared_a, prepared_b] = if strictly_clear_start {
        prepared
    } else {
        [None; 2]
    };
    let strict_prefix = strictly_clear_start.then_some(strict_prefix).flatten();
    let mut reused = false;
    leaves(
        shape_a,
        a,
        b,
        shape_b,
        start,
        end,
        clearance,
        work,
        &mut |sa, ma, ia, work| {
            leaves(
                shape_b,
                b,
                ma,
                sa,
                start,
                end,
                clearance,
                work,
                &mut |sb, mb, ib, work| {
                    work.charge(1)?;
                    let end = first.as_ref().map_or(end, |h| h.hit_time);
                    let a_bounds = match prepared_a {
                        Some(bounds) => bounds,
                        None => ma.bounds(sa, start, end, work)?,
                    };
                    if !a_bounds.loosened(clearance).intersects(&match prepared_b {
                        Some(bounds) => bounds,
                        None => mb.bounds(sb, start, end, work)?,
                    }) {
                        return Ok(());
                    }
                    let mut initially_clear = None;
                    let result = cast_policy_observed(
                        ma,
                        sa,
                        mb,
                        sb,
                        start,
                        end,
                        clearance,
                        time_tolerance,
                        work,
                        allow_existing_penetration,
                        &mut initially_clear,
                        strict_prefix,
                    )?;
                    reused |= matches!(
                        strict_prefix,
                        Some(StrictPrefix::Clear | StrictPrefix::Hit(_))
                    ) && initially_clear == Some(true);
                    observed_leaves = observed_leaves.saturating_add(1);
                    strictly_clear_start &= initially_clear == Some(true);
                    if let Some(mut hit) = result {
                        hit.subshape_a = ia;
                        hit.subshape_b = ib;
                        if first.as_ref().is_none_or(|old| {
                            hit.hit_time < old.hit_time
                                || (hit.hit_time == old.hit_time
                                    && (ia, ib) < (old.subshape_a, old.subshape_b))
                        }) {
                            first = Some(hit);
                        }
                    }
                    Ok(())
                },
            )
        },
    )?;
    Ok(CastCoverage {
        hit: first,
        strictly_clear_start: strictly_clear_start && observed_leaves == 1,
        reused,
    })
}

/// Actual geometric contacts at one time, without inventing a cast TOI.
/// Every real candidate leaf uses the original shape/filter supplied by its owner.
#[allow(clippy::too_many_arguments)]
pub(super) fn contacts_full_shapes(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    time: Time,
    distance: f32,
    work: &mut Work,
    visit: &mut ContactVisitor<'_>,
) -> Result<(), TrajectoryError> {
    contacts_full_shapes_with_manifold(
        a, shape_a, b, shape_b, time, distance, work, &mut None, visit,
    )
}
#[allow(clippy::too_many_arguments)]
pub(super) fn contacts_full_shapes_with_manifold(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    time: Time,
    distance: f32,
    work: &mut Work,
    manifold: &mut Option<&mut rapier3d::parry::query::ContactManifold<(), ()>>,
    visit: &mut ContactVisitor<'_>,
) -> Result<(), TrajectoryError> {
    contacts_full_shapes_impl(
        a, shape_a, b, shape_b, time, distance, distance, work, manifold, visit,
    )
}

/// A broad leaf census with a separate actual world-contact threshold.
/// The broad distance only enumerates/observes original Native candidates; it
/// must not suppress a genuine world-radius contact at the pair's clearance.
/// This measurement path has no manifold, and executes each Native leaf once.
#[allow(clippy::too_many_arguments)]
pub(super) fn contacts_full_shapes_measured(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    time: Time,
    distance: f32,
    world_clearance: f32,
    work: &mut Work,
    visit: &mut ContactVisitor<'_>,
) -> Result<(), TrajectoryError> {
    work.charge(1)?;
    if !distance.is_finite() || !world_clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if world_clearance > distance {
        return Err(TrajectoryError::InvalidReference);
    }
    contacts_full_shapes_impl(
        a,
        shape_a,
        b,
        shape_b,
        time,
        distance,
        world_clearance,
        work,
        &mut None,
        visit,
    )
}

#[allow(clippy::too_many_arguments)]
fn contacts_full_shapes_impl(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    time: Time,
    distance: f32,
    world_clearance: f32,
    work: &mut Work,
    manifold: &mut Option<&mut rapier3d::parry::query::ContactManifold<(), ()>>,
    visit: &mut ContactVisitor<'_>,
) -> Result<(), TrajectoryError> {
    leaves(
        shape_a,
        a,
        b,
        shape_b,
        time,
        time,
        distance,
        work,
        &mut |sa, ma, ia, work| {
            leaves(
                shape_b,
                b,
                ma,
                sa,
                time,
                time,
                distance,
                work,
                &mut |sb, mb, ib, work| {
                    work.charge(1)?;
                    let pa = ma.pose(time);
                    let pb = mb.pose(time);
                    if let Some(manifold) = manifold.as_deref_mut() {
                        use rapier3d::parry::query::{
                            DefaultQueryDispatcher, PersistentQueryDispatcher,
                        };
                        manifold.clear();
                        manifold.local_n1 = rp::Vector::ZERO;
                        manifold.local_n2 = rp::Vector::ZERO;
                        work.charge(32)?;
                        let full_box_capsule = (sa.as_cuboid().is_some()
                            && sb.as_capsule().is_some())
                            || (sa.as_capsule().is_some() && sb.as_cuboid().is_some());
                        let generated = if full_box_capsule {
                            // Select the original full cuboid/capsule SAT
                            // features and clip their finite contact patch.
                            // The generic smooth GJK normal can turn a flat
                            // tangent into a small spurious vertical impulse.
                            rapier3d::parry::query::details::contact_manifold_cuboid_capsule_shapes(
                                &pa.inv_mul(&pb),
                                sa,
                                sb,
                                // Generate the finite feature candidates
                                // independently of the rounded relative gap.
                                // Original world-space distance is enforced
                                // below before any row is emitted.
                                f32::MAX,
                                manifold,
                            );
                            true
                        } else {
                            DefaultQueryDispatcher
                                .contact_manifold_convex_convex(
                                    &pa.inv_mul(&pb),
                                    sa,
                                    sb,
                                    None,
                                    None,
                                    distance,
                                    manifold,
                                )
                                .is_ok()
                        };
                        if generated && !manifold.points.is_empty() {
                            if manifold.points.len() > 32 {
                                return Err(TrajectoryError::WorkLimit);
                            }
                            let normal1 = pa.rotation * manifold.local_n1;
                            if !normal1.is_finite() {
                                return Err(TrajectoryError::NonFinite);
                            }
                            let mut emitted = false;
                            for point in &manifold.points {
                                let point1 = pa * point.local_p1;
                                let point2 = pb * point.local_p2;
                                // SAT feature witnesses belong to the original
                                // local shapes. Evaluate their signed distance
                                // in the same world frame as the response; the
                                // relative-frame prediction distance can have
                                // a different rounded gap at exactly the skin.
                                let dist = if full_box_capsule {
                                    (point2 - point1).dot(normal1)
                                } else {
                                    point.dist
                                };
                                if dist > distance {
                                    continue;
                                }
                                let contact = rapier3d::parry::query::Contact {
                                    point1,
                                    point2,
                                    normal1,
                                    normal2: -normal1,
                                    dist,
                                    subshape1: ia,
                                    subshape2: ib,
                                };
                                if !contact.point1.is_finite()
                                    || !contact.point2.is_finite()
                                    || !contact.dist.is_finite()
                                {
                                    return Err(TrajectoryError::NonFinite);
                                }
                                visit(contact, ia, ib, work)?;
                                emitted = true;
                            }
                            if emitted {
                                return Ok(());
                            }
                        }
                    }
                    // A manifold containing only prediction points outside
                    // this distance has emitted no row. Use the same original
                    // local-witness query as the cast before declaring no
                    // contact; its independently rounded distance/normal may
                    // otherwise disagree at the original skin boundary.
                    let contact = leaf_contact(&pa, sa, &pb, sb, work)?;
                    if contact.dist > world_clearance {
                        if !contact.dist.is_finite()
                            || !contact.normal1.is_finite()
                            || !contact.point1.is_finite()
                            || !contact.point2.is_finite()
                        {
                            return Err(TrajectoryError::NonFinite);
                        }
                        // Preserve the original manifold and Native priority.
                        // The selected full-shape world radius can nevertheless
                        // contain an actual point missed by the rounded local
                        // radius query. Emit that validated witness directly;
                        // a local capsule patch must not rebuild its geometry.
                        if let Some(pair) = world_contact::Pair::new(sa, sb, work)? {
                            let witness = match pair.poses(&pa, &pb, world_clearance, work)? {
                                Some(witness) => Some(witness),
                                None => {
                                    match pair.normal_axis_poses(&pa, &pb, world_clearance, work)? {
                                        Some(witness) => Some(witness),
                                        None => pair.signed_normal_axis_poses(
                                            &pa,
                                            &pb,
                                            world_clearance,
                                            work,
                                        )?,
                                    }
                                }
                            };
                            if let Some(witness) = witness {
                                // This distance is <= actual clearance and
                                // strictly below the observed Native distance.
                                visit(witness.contact.with_subshapes(ia, ib), ia, ib, work)?;
                                return Ok(());
                            }
                        }
                    }
                    if contact.dist > distance {
                        return Ok(());
                    }
                    if !contact.dist.is_finite()
                        || !contact.normal1.is_finite()
                        || !contact.point1.is_finite()
                        || !contact.point2.is_finite()
                    {
                        return Err(TrajectoryError::NonFinite);
                    }
                    if let Some(points) = super::character_dynamics::capsule_face_patch_at(
                        sa,
                        &pa,
                        sb,
                        &pb,
                        contact.normal1,
                    ) {
                        for point in points.into_iter().flatten() {
                            visit(
                                rapier3d::parry::query::Contact {
                                    point1: point,
                                    point2: point + contact.normal1 * contact.dist,
                                    ..contact
                                },
                                ia,
                                ib,
                                work,
                            )?;
                        }
                    } else if let Some(points) = super::character_dynamics::capsule_face_patch_at(
                        sb,
                        &pb,
                        sa,
                        &pa,
                        -contact.normal1,
                    ) {
                        for point in points.into_iter().flatten() {
                            visit(
                                rapier3d::parry::query::Contact {
                                    point2: point,
                                    point1: point - contact.normal1 * contact.dist,
                                    ..contact
                                },
                                ia,
                                ib,
                                work,
                            )?;
                        }
                    } else {
                        visit(contact, ia, ib, work)?;
                    }
                    Ok(())
                },
            )
        },
    )
}

#[cfg(test)]
mod cardinal_tests;
#[cfg(test)]
mod query_work_tests;
#[cfg(test)]
mod tests;

/// Admit a zero-time placement by comparing the same immutable shape leaves.
/// A previous penetration in another compound/mesh leaf cannot excuse a new
/// penetration here. This is an endpoint policy, never an invented time sweep.
#[allow(clippy::too_many_arguments)]
pub(super) fn admit_endpoint_pair(
    shape_a: &dyn rp::Shape,
    old_a: rp::Pose,
    new_a: rp::Pose,
    shape_b: &dyn rp::Shape,
    old_b: rp::Pose,
    new_b: rp::Pose,
    allowed_error: f32,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    if !allowed_error.is_finite()
        || allowed_error < 0.
        || [old_a, new_a, old_b, new_b].iter().any(|p| !p.is_finite())
    {
        return Err(TrajectoryError::NonFinite);
    }
    let motion = |pose| ShapeMotion {
        curve: Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 0.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let a = motion(new_a);
    let b = motion(new_b);
    leaves(
        shape_a,
        a,
        b,
        shape_b,
        0.,
        0.,
        allowed_error,
        work,
        &mut |sa, ma, _, work| {
            leaves(
                shape_b,
                b,
                ma,
                sa,
                0.,
                0.,
                allowed_error,
                work,
                &mut |sb, mb, _, work| {
                    work.charge(1)?;
                    let next = rapier3d::parry::query::contact(
                        &ma.pose(0.),
                        sa,
                        &mb.pose(0.),
                        sb,
                        f32::MAX,
                    )
                    .map_err(|_| TrajectoryError::UnsupportedShape)?
                    .ok_or(TrajectoryError::Unresolved)?;
                    if !next.dist.is_finite() {
                        return Err(TrajectoryError::NonFinite);
                    }
                    if next.dist >= -allowed_error {
                        return Ok(());
                    }
                    work.charge(1)?;
                    let before = rapier3d::parry::query::contact(
                        &(old_a * ma.local_pose),
                        sa,
                        &(old_b * mb.local_pose),
                        sb,
                        f32::MAX,
                    )
                    .map_err(|_| TrajectoryError::UnsupportedShape)?
                    .ok_or(TrajectoryError::Unresolved)?;
                    if !before.dist.is_finite() {
                        return Err(TrajectoryError::NonFinite);
                    }
                    if next.dist < before.dist {
                        return Err(TrajectoryError::Unresolved);
                    }
                    Ok(())
                },
            )
        },
    )
}
