//! Positive observations only, after the original Native margin selection.
//!
//! An actual box point P and an actual capsule core endpoint C prove contact
//! with the original real world radius r when an outward upper bound for
//! |C-P|-r is within the selected margin. Failure to find this witness proves
//! nothing about clearance. In particular an approximate inverse is used only
//! to nominate a closed-box local point, never to measure the distance.
//! Parallel axial capsules also admit a positive observer under exact qI:
//! closed local core nominees, both whole-core support cones and both real
//! ball memberships must pass. Each original pose/time graph is independent.
use super::{rp, ShapeMotion, Time, TrajectoryError, Work};
use rapier3d::parry::{
    query::Contact,
    shape::{Capsule, Cuboid},
};
mod capsule_ball;
mod native_strict;
mod normal_axis;
mod rounded_box_ball;
mod rounded_capsules;
pub(super) use capsule_ball::RoundedCapsuleBall;
pub(super) use rounded_box_ball::RoundedBoxBallProbes;

pub(super) struct Pair<'a> {
    kind: PairKind<'a>,
}
enum PairKind<'a> {
    BoxCapsule(BoxCapsule<'a>),
    BoxBall(BoxBall<'a>),
    Capsules(CapsulePair<'a>),
}
struct BoxBall<'a> {
    cuboid: &'a Cuboid,
    ball: &'a rapier3d::parry::shape::Ball,
    flipped: bool,
}
struct BoxCapsule<'a> {
    cuboid: &'a Cuboid,
    capsule: &'a Capsule,
    flipped: bool,
    segment_axis: Option<usize>,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct Witness {
    pub contact: Contact,
    /// Strict real inequality contradicts a whole-interval >= certificate.
    /// Equality remains eligible for the original closed nonpenetration proof.
    pub strict: bool,
}

impl<'a> Pair<'a> {
    /// Supplemental Contact with a separately proved rotating normal-axis cone.
    /// Call only after the original optional producer returned no witness.
    pub fn normal_axis_at(
        &self,
        a: ShapeMotion,
        b: ShapeMotion,
        time: Time,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        normal_axis::at(self, a, b, time, margin, work)
    }
    pub fn normal_axis_poses(
        &self,
        a: &rp::Pose,
        b: &rp::Pose,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        normal_axis::poses(self, a, b, margin, work)
    }
    pub fn signed_normal_axis_poses(
        &self,
        a: &rp::Pose,
        b: &rp::Pose,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        normal_axis::signed_poses(self, a, b, margin, work)
    }

    /// A strict existence certificate accompanying an already selected Native
    /// contact. This never creates response points/normals or a contact result.
    /// False is an absent certificate, not a separation claim.
    pub fn native_strict_at(
        &self,
        a: ShapeMotion,
        b: ShapeMotion,
        time: Time,
        margin: f32,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        native_strict::at(self, a, b, time, margin, work)
    }

    // A fixed axis-aligned box has one deterministic outward normal for a
    // single clamped coordinate. The ordinary cast already paid to inspect
    // the shape pair before consulting this supplemental producer.
    pub fn box_ball(
        a: ShapeMotion,
        sa: &'a dyn rp::Shape,
        b: ShapeMotion,
        sb: &'a dyn rp::Shape,
    ) -> Option<Self> {
        let supported = |cube: ShapeMotion, ball: ShapeMotion| {
            cube.is_fixed_axis_aligned()
                || (ball.is_fixed_axis_aligned() && cube.is_single_axis_spin())
        };
        let pair = if let (Some(cuboid), Some(ball)) = (sa.as_cuboid(), sb.as_ball()) {
            supported(a, b).then_some(BoxBall {
                cuboid,
                ball,
                flipped: false,
            })
        } else if let (Some(ball), Some(cuboid)) = (sa.as_ball(), sb.as_cuboid()) {
            supported(b, a).then_some(BoxBall {
                cuboid,
                ball,
                flipped: true,
            })
        } else {
            None
        }?;
        Some(Self {
            kind: PairKind::BoxBall(pair),
        })
    }

    pub fn new(
        a: &'a dyn rp::Shape,
        b: &'a dyn rp::Shape,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        work.charge(64)?;
        let mut pair = if let (Some(cuboid), Some(capsule)) = (a.as_cuboid(), b.as_capsule()) {
            Some(BoxCapsule {
                cuboid,
                capsule,
                flipped: false,
                segment_axis: None,
            })
        } else if let (Some(capsule), Some(cuboid)) = (a.as_capsule(), b.as_cuboid()) {
            Some(BoxCapsule {
                cuboid,
                capsule,
                flipped: true,
                segment_axis: None,
            })
        } else {
            None
        };
        if let Some(pair) = &mut pair {
            if !pair.cuboid.half_extents.is_finite()
                || !pair.capsule.radius.is_finite()
                || !pair.capsule.segment.a.is_finite()
                || !pair.capsule.segment.b.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            if pair.capsule.radius <= 0. || pair.cuboid.half_extents.cmplt(rp::Vector::ZERO).any() {
                return Ok(None);
            }
            // A single varying scalar coordinate makes the original core
            // point graph monotone and its -normal support an endpoint. A
            // general rotated/oblique segment keeps the original query path.
            for axis in 0..3 {
                if pair.capsule.segment.a[axis] != pair.capsule.segment.b[axis] {
                    if pair.segment_axis.is_some() {
                        return Ok(None);
                    }
                    pair.segment_axis = Some(axis);
                }
            }
        }
        if let Some(pair) = pair {
            return Ok(Some(Self {
                kind: PairKind::BoxCapsule(pair),
            }));
        }
        let (Some(a), Some(b)) = (a.as_capsule(), b.as_capsule()) else {
            return Ok(None);
        };
        Ok(CapsulePair::new(a, b, work)?.map(|pair| Self {
            kind: PairKind::Capsules(pair),
        }))
    }

    pub fn at(
        &self,
        a: ShapeMotion,
        b: ShapeMotion,
        time: Time,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        if !margin.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        validate_interval(a, b, time, time, work)?;
        // No signed-overlap policy is invented by this optional observation.
        if margin < 0. {
            return Ok(None);
        }
        work.charge(512)?;
        let pa = a.pose(time);
        let pb = b.pose(time);
        let mut observed = self.poses(&pa, &pb, margin, work)?;
        let clock = |curve| match curve {
            super::Curve::Integrated(k) => Some(k),
            super::Curve::Anchored {
                carrier,
                linear_velocity,
                ..
            } if linear_velocity == rp::Vector::ZERO => Some(carrier),
            _ => None,
        };
        if let (None, PairKind::Capsules(pair), Some(a), Some(b)) =
            (observed, &self.kind, clock(a.curve), clock(b.curve))
        {
            if margin > 0. && a.has_identity_orientation() && b.has_identity_orientation() {
                observed = rounded_capsules::at(pair, &pa, &pb, margin, false, work)?;
            }
        }
        Ok(observed)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn capsule_boundary_at(
        &self,
        a: ShapeMotion,
        b: ShapeMotion,
        start: Time,
        end: Time,
        normal: rp::Vector,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        let PairKind::Capsules(pair) = &self.kind else {
            return Ok(None);
        };
        if margin <= 0. || a.translation_kernel().is_none() || b.translation_kernel().is_none() {
            return Ok(None);
        }
        let end_poses = [a.metered_pose(end, work)?, b.metered_pose(end, work)?];
        let witness = rounded_capsules::at(pair, &end_poses[0], &end_poses[1], margin, true, work)?;
        let Some(witness) = witness.filter(|witness| witness.strict) else {
            return Ok(None);
        };
        let start_poses = [a.metered_pose(start, work)?, b.metered_pose(start, work)?];
        let separated = super::rounded::rounded_capsule_pair_separated(
            start_poses,
            [pair.a, pair.b],
            normal,
            margin,
            work,
        )?;
        Ok(separated.then_some(witness))
    }

    pub fn poses(
        &self,
        a: &rp::Pose,
        b: &rp::Pose,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        if !margin.is_finite() || !a.is_finite() || !b.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if margin < 0. {
            return Ok(None);
        }
        match &self.kind {
            PairKind::BoxCapsule(pair) => pair.poses(a, b, margin, work),
            PairKind::BoxBall(pair) => pair.poses(a, b, margin, work),
            PairKind::Capsules(pair) => pair.poses(a, b, margin, work),
        }
    }
}
impl BoxBall<'_> {
    fn poses(
        &self,
        a: &rp::Pose,
        b: &rp::Pose,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        work.charge(1024)?; // finite face nomination, original point and distance
        let (box_pose, ball_pose) = if self.flipped { (b, a) } else { (a, b) };
        let half = self.cuboid.half_extents;
        let radius = self.ball.radius;
        if !half.is_finite() || half.cmplt(rp::Vector::ZERO).any() || !radius.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if radius <= 0. {
            return Ok(None);
        }
        let nominee = box_pose.inv_mul(ball_pose).translation;
        if !nominee.is_finite() {
            return Ok(None);
        }
        let local = nominee.clamp(-half, half);
        let mut normal = rp::Vector::ZERO;
        for i in 0..3 {
            if local[i] != nominee[i] {
                if normal != rp::Vector::ZERO {
                    return Ok(None);
                }
                normal[i] = nominee[i].signum();
            }
        }
        if normal == rp::Vector::ZERO {
            return Ok(None);
        }
        let normal = if box_pose.rotation == rp::Rotation::IDENTITY {
            normal
        } else if let Some(normal) = (box_pose.rotation * normal).try_normalize() {
            normal
        } else {
            return Ok(None);
        };
        let point = *box_pose * local;
        let core = ball_pose.translation;
        if !point.is_finite() || (core - point).dot(normal) <= 0. {
            return Ok(None);
        }
        let world_upper = gap_upper(distance_upper(point, core), radius);
        let mut observed = None;
        if world_upper < f64::from(margin) {
            if let Some(ball) = ball_point(core, -normal, radius) {
                observed = Some((ball, world_upper));
            }
        }
        if observed.is_none() {
            // The nominee must belong to the original local sphere before
            // the original forward transform. Its world rounding can put
            // this point inside the margin while the world radius is clear.
            let Some(direction) = (ball_pose.rotation.inverse() * -normal).try_normalize() else {
                return Ok(None);
            };
            let Some(local) = ball_point(rp::Vector::ZERO, direction, radius) else {
                return Ok(None);
            };
            let ball = *ball_pose * local;
            let upper = distance_upper(point, ball);
            if ball.is_finite() && upper < f64::from(margin) {
                observed = Some((ball, upper));
            }
        }
        let Some((ball, upper)) = observed else {
            return Ok(None);
        };
        let mut dist = upper as f32;
        if f64::from(dist) < upper {
            dist = dist.next_up();
        }
        let mut contact = Contact::new(point, ball, normal, -normal, dist);
        if self.flipped {
            contact.flip();
        }
        Ok(Some(Witness {
            contact,
            strict: true,
        }))
    }
}
impl BoxCapsule<'_> {
    fn poses(
        &self,
        a: &rp::Pose,
        b: &rp::Pose,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        let (box_pose, cap_pose) = if self.flipped { (b, a) } else { (a, b) };
        // Only the original positive scalar rotation graph has a direct
        // axis-wise normal-cone proof here. This restricts an optional witness,
        // never public shape support or the original Native fallback.
        work.charge(640)?; // four original point graphs (128 each) + headers.
        if scalar_rotation(box_pose.rotation).is_none()
            || scalar_rotation(cap_pose.rotation).is_none()
        {
            return Ok(None);
        }
        let high = box_pose * self.cuboid.half_extents;
        let low = box_pose * -self.cuboid.half_extents;
        if !high.is_finite() || !low.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let cores = [
            cap_pose * self.capsule.segment.a,
            cap_pose * self.capsule.segment.b,
        ];
        if cores.iter().any(|core| !core.is_finite()) {
            return Err(TrajectoryError::NonFinite);
        }
        // A positive scalar rotation makes the two original transformed box
        // corners extrema in each world coordinate. Eliminate endpoints whose
        // ball cannot reach any projected point, with both sides rounded
        // outwards. Kept endpoints retain their original order and witness.
        work.charge(64)?;
        let reach = (f64::from(self.capsule.radius) + f64::from(margin)).next_up();
        for (index, &core) in cores.iter().enumerate() {
            if (0..3).any(|axis| {
                let c = f64::from(core[axis]);
                (c - f64::from(high[axis])).next_down() > reach
                    || (f64::from(low[axis]) - c).next_down() > reach
            }) {
                continue;
            }
            // Fixed two endpoints, three coordinate clamps and distance graphs;
            // no cloud scan, allocation, sampled clearance or hidden query.
            work.charge(2048)?;
            let nominee = box_pose.inverse() * core;
            if !nominee.is_finite() {
                continue;
            }
            let local = nominee.clamp(-self.cuboid.half_extents, self.cuboid.half_extents);
            if !local.is_finite()
                || local.cmplt(-self.cuboid.half_extents).any()
                || local.cmpgt(self.cuboid.half_extents).any()
            {
                continue;
            }
            // These are original native point operations on the actual poses.
            // No unit-q or conjugate-is-inverse premise enters the proof.
            let point = box_pose * local;
            if !point.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            let upper = gap_upper(distance_upper(point, core), self.capsule.radius);
            if !upper.is_finite() || upper > f64::from(margin) {
                continue;
            }
            let delta = core - point;
            if !outward_delta(local, self.cuboid.half_extents, delta) {
                continue;
            }
            // Exactly axial data has an exact coordinate unit normal. Avoid
            // manufacturing a subunit axis with the reciprocal-length graph;
            // exact axis equality is also an existing response eligibility key.
            // A near-axis vector still uses the original normalization graph.
            let normal = unit_normal(delta);
            let Some(normal) = normal else {
                continue;
            };
            if !normal.is_finite() {
                continue;
            }
            if let Some(axis) = self.segment_axis {
                let other = cores[1 - index][axis];
                if (normal[axis] > 0. && other < core[axis])
                    || (normal[axis] < 0. && other > core[axis])
                {
                    continue;
                }
            }
            // The contact point is an inward-rounded representative in the
            // original real ball, not a replacement rounded radius. The signed
            // distance is the directed upper bound of the *real* extent above;
            // RN(point2-point1) need not equal it (as with Native contacts).
            let mut ball_point = None;
            for radius in [self.capsule.radius, self.capsule.radius.next_down()] {
                let candidate = core - normal * radius;
                if candidate.is_finite()
                    && distance_upper(candidate, core) <= f64::from(self.capsule.radius)
                {
                    ball_point = Some(candidate);
                    break;
                }
            }
            let Some(ball_point) = ball_point else {
                continue;
            };
            let mut distance = upper as f32;
            if f64::from(distance) < upper {
                distance = distance.next_up();
            }
            if !distance.is_finite() || distance > margin {
                continue;
            }
            let mut contact = Contact::new(point, ball_point, normal, -normal, distance);
            if self.flipped {
                contact.flip();
            }
            return Ok(Some(Witness {
                contact,
                strict: upper < f64::from(margin),
            }));
        }
        Ok(None)
    }
}

fn unit_normal(delta: rp::Vector) -> Option<rp::Vector> {
    if delta.x != 0. && delta.y == 0. && delta.z == 0. {
        Some(rp::Vector::new(delta.x.signum(), 0., 0.))
    } else if delta.x == 0. && delta.y != 0. && delta.z == 0. {
        Some(rp::Vector::new(0., delta.y.signum(), 0.))
    } else if delta.x == 0. && delta.y == 0. && delta.z != 0. {
        Some(rp::Vector::new(0., 0., delta.z.signum()))
    } else {
        delta.try_normalize()
    }
}

struct CapsulePair<'a> {
    a: &'a Capsule,
    b: &'a Capsule,
    axis: Option<usize>,
}
impl<'a> CapsulePair<'a> {
    fn new(
        a: &'a Capsule,
        b: &'a Capsule,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        // New pair metadata only. The original Box/Capsule branch returns
        // before this admission, preserving all its prices and FP operations.
        work.charge(128)?;
        let mut axes = [None; 2];
        for (index, capsule) in [a, b].into_iter().enumerate() {
            if !capsule.radius.is_finite()
                || !capsule.segment.a.is_finite()
                || !capsule.segment.b.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            if capsule.radius <= 0. {
                return Ok(None);
            }
            for axis in 0..3 {
                if capsule.segment.a[axis] != capsule.segment.b[axis] {
                    if axes[index].is_some() {
                        return Ok(None);
                    }
                    axes[index] = Some(axis);
                }
            }
        }
        if matches!(axes, [Some(a), Some(b)] if a != b) {
            return Ok(None);
        }
        Ok(Some(Self {
            a,
            b,
            axis: axes[0].or(axes[1]),
        }))
    }

    fn poses(
        &self,
        a: &rp::Pose,
        b: &rp::Pose,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<Witness>, TrajectoryError> {
        work.charge(128)?; // actual numeric/rotation header only.
        let identity = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
        if a.rotation.to_array().map(f32::to_bits) != identity
            || b.rotation.to_array().map(f32::to_bits) != identity
        {
            return Ok(None);
        }
        work.charge(512)?; // four original endpoint graphs, before evaluation.
        let ends_a = [a * self.a.segment.a, a * self.a.segment.b];
        let ends_b = [b * self.b.segment.a, b * self.b.segment.b];
        if ends_a.iter().chain(&ends_b).any(|p| !p.is_finite()) {
            return Err(TrajectoryError::NonFinite);
        }
        // This is only an early absence of this optional world-ball witness,
        // never a new whole-shape/trajectory separation certificate. Under qI
        // each full axial core graph is coordinate-wise monotone, so its two
        // actual endpoints enclose every valid clamped nominee too.
        work.charge(256)?;
        let radii = (f64::from(self.a.radius) + f64::from(self.b.radius)).next_up();
        let reach = (radii + f64::from(margin)).next_up();
        let mut square = 0_f64;
        for axis in 0..3 {
            let a_lo = ends_a[0][axis].min(ends_a[1][axis]);
            let a_hi = ends_a[0][axis].max(ends_a[1][axis]);
            let b_lo = ends_b[0][axis].min(ends_b[1][axis]);
            let b_hi = ends_b[0][axis].max(ends_b[1][axis]);
            let lower = if b_lo > a_hi {
                difference(b_lo, a_hi).0
            } else if a_lo > b_hi {
                difference(a_lo, b_hi).0
            } else {
                0.
            };
            // Euclidean core distance is at least this real coordinate
            // gap. Each radius and margin was widened before summation;
            // no F32 radius sum or Native distance enters the rejection.
            if lower > reach {
                return Ok(None);
            }
            square = (square + (lower * lower).next_down()).next_down().max(0.);
        }
        if square > (reach * reach).next_up() {
            return Ok(None);
        }
        for candidate in 0..4 {
            // One endpoint, one closed axial clamp/forward graph, distance,
            // both whole-core support cones and two bounded ball admissions.
            // Logical fixed work, not an instruction or elapsed-time bound.
            // The first candidate's old2048 admission now contains the
            // executed256 gate; positive prices and later candidates stay
            // unchanged. Far pairs pay for no unvisited nominee.
            work.charge(if candidate == 0 { 1792 } else { 2048 })?;
            let (core_a, core_b) = if candidate < 2 {
                let core = ends_a[candidate];
                let Some(other) = self.clamped_core(self.b, b, core) else {
                    continue;
                };
                (core, other)
            } else {
                let core = ends_b[candidate - 2];
                let Some(other) = self.clamped_core(self.a, a, core) else {
                    continue;
                };
                (other, core)
            };
            // Each radius stays an individual exact F32 real operand. A
            // rounded F32 radius sum could manufacture an inward upper bound.
            let upper = gap_upper(
                gap_upper(distance_upper(core_a, core_b), self.a.radius),
                self.b.radius,
            );
            if !upper.is_finite() || upper > f64::from(margin) {
                continue;
            }
            let delta = core_b - core_a;
            if !delta.is_finite() {
                continue;
            }
            // Canonicalize only this new pair's zero signs. Reversing the
            // operands negates the same normalized direction (also its zero
            // components); the original Box path keeps its exact expression.
            let reversed = delta
                .to_array()
                .into_iter()
                .find(|&v| v != 0.)
                .is_some_and(|v| v < 0.);
            let canonical = if reversed { -delta } else { delta };
            let canonical =
                rp::Vector::from_array(canonical.to_array().map(|v| if v == 0. { 0. } else { v }));
            let Some(normal) = unit_normal(canonical) else {
                continue;
            };
            let normal = if reversed { -normal } else { normal };
            if !normal.is_finite()
                || !self.supports(core_a, ends_a, normal)
                || !self.supports(core_b, ends_b, -normal)
            {
                continue;
            }
            // Both are validated representatives in their original real
            // balls. Their RN difference need not equal the real gap upper.
            let Some(point_a) = ball_point(core_a, normal, self.a.radius) else {
                continue;
            };
            let Some(point_b) = ball_point(core_b, -normal, self.b.radius) else {
                continue;
            };
            let mut distance = upper as f32;
            if f64::from(distance) < upper {
                distance = distance.next_up();
            }
            if !distance.is_finite() || distance > margin {
                continue;
            }
            return Ok(Some(Witness {
                contact: Contact::new(point_a, point_b, normal, -normal, distance),
                strict: upper < f64::from(margin),
            }));
        }
        Ok(None)
    }

    fn clamped_core(
        &self,
        capsule: &Capsule,
        pose: &rp::Pose,
        toward: rp::Vector,
    ) -> Option<rp::Vector> {
        let mut local = capsule.segment.a;
        if let Some(axis) = self.axis {
            // This subtraction merely nominates a closed local point. Its
            // distance is evaluated only after the original forward graph.
            let nominee = toward[axis] - pose.translation[axis];
            if !nominee.is_finite() {
                return None;
            }
            local[axis] = nominee.clamp(
                capsule.segment.a[axis].min(capsule.segment.b[axis]),
                capsule.segment.a[axis].max(capsule.segment.b[axis]),
            );
        }
        let core = pose * local;
        core.is_finite().then_some(core)
    }

    fn supports(&self, core: rp::Vector, ends: [rp::Vector; 2], normal: rp::Vector) -> bool {
        let Some(axis) = self.axis else {
            return true;
        };
        // Under exact qI every other component is constant and the original
        // axial RN point graph is monotone. These endpoint inequalities thus
        // prove the normal cone for the whole segment, not just the nominee.
        if normal[axis] > 0. {
            core[axis] >= ends[0][axis].max(ends[1][axis])
        } else if normal[axis] < 0. {
            core[axis] <= ends[0][axis].min(ends[1][axis])
        } else {
            true
        }
    }
}

fn ball_point(core: rp::Vector, normal: rp::Vector, radius: f32) -> Option<rp::Vector> {
    for value in [radius, radius.next_down()] {
        let candidate = core + normal * value;
        if candidate.is_finite() && distance_upper(candidate, core) <= f64::from(radius) {
            return Some(candidate);
        }
    }
    None
}

// q.xyz==0 leaves RN(RN(p * RN(w*w)) + T), coordinate by coordinate.
// All cross/dot additions are numerical zero. Positive scaling and RN are
// monotone, so an active local face remains that coordinate's whole-box support.
fn scalar_rotation(q: rp::Rotation) -> Option<f32> {
    if q.x != 0. || q.y != 0. || q.z != 0. {
        return None;
    }
    let scale = q.w * q.w;
    (scale.is_finite() && scale > 0.).then_some(scale)
}

fn outward_delta(local: rp::Vector, half: rp::Vector, delta: rp::Vector) -> bool {
    if !delta.is_finite() {
        return false;
    }
    for axis in 0..3 {
        if half[axis] == 0. {
            continue;
        } // both faces: every sign supports.
        if local[axis] == half[axis] {
            if delta[axis] < 0. {
                return false;
            }
        } else if local[axis] == -half[axis] {
            if delta[axis] > 0. {
                return false;
            }
        } else if delta[axis] != 0. {
            return false;
        }
    }
    true
}

/// A supplemental hit may not bypass the original proof's time admission.
/// Only numeric headers are read; the original clock map is not rewritten.
pub(super) fn validate_interval(
    a: ShapeMotion,
    b: ShapeMotion,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    work.charge(32)?;
    if !start.is_finite() || !end.is_finite() || start > end || !(end - start).is_finite() {
        return Err(TrajectoryError::InvalidTime);
    }
    for curve in [a.curve, b.curve] {
        let (from, to) = curve.times();
        if !from.is_finite()
            || !to.is_finite()
            || from > to
            || (from == to && !matches!(curve, super::Curve::Constant { .. }))
            || !(to - from).is_finite()
            || start < from
            || end > to
        {
            return Err(TrajectoryError::InvalidTime);
        }
    }
    Ok(())
}

/// Exact f32 inputs widened to f64. TwoSum's residual detects exact subtraction
/// without claiming general f64 exactness: all nonzero intermediates are on the
/// 2^-149 lattice and below 2^130, so neither f64 underflow nor overflow occurs.
fn difference(a: f32, b: f32) -> (f64, f64) {
    let a = f64::from(a);
    let b = -f64::from(b);
    let sum = a + b;
    let bv = sum - a;
    let error = (a - (sum - bv)) + (b - bv);
    if error == 0. {
        (sum, sum)
    } else {
        (sum.next_down(), sum.next_up())
    }
}

fn gap_upper(length: f64, radius: f32) -> f64 {
    let b = -f64::from(radius);
    let sum = length + b;
    let bv = sum - length;
    let error = (length - (sum - bv)) + (b - bv);
    // These inputs only come from finite F32 point coordinates/radius.
    // Nonzero distance_upper lies in [2^-149, 2^130); its F64 lattice and
    // the F32 radius have no bit below 2^-201. All TwoSum intermediates are
    // on that lattice and below 2^132, so F64 under/overflow is excluded.
    // sum+error is therefore the exact subtraction of the directed distance
    // upper and original radius (including a previous radius subtraction).
    // Only a positive residual needs next_up.
    if error > 0. {
        sum.next_up()
    } else {
        sum
    }
}

fn distance_upper(a: rp::Vector, b: rp::Vector) -> f64 {
    let d = [
        difference(a.x, b.x),
        difference(a.y, b.y),
        difference(a.z, b.z),
    ];
    let mut count = 0;
    let mut only = 0.;
    for (lo, hi) in d {
        if lo != 0. || hi != 0. {
            count += 1;
            only = lo.abs().max(hi.abs());
        }
    }
    // Exact axis distance also preserves r==distance membership at a pole.
    if count <= 1 {
        return only;
    }
    let mut square = 0_f64;
    for (lo, hi) in d {
        let m = lo.abs().max(hi.abs());
        if m != 0. {
            square = (square + (m * m).next_up()).next_up();
        }
    }
    square.sqrt().next_up()
}

#[cfg(test)]
mod tests;
