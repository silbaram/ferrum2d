//! Closed contact between a translating cuboid and an axial capsule.
//! The swept box encloses the original rounded box. For each world
//! axis, invert F32 rounding of the local point and its translation and test
//! the real radius at the translated core.
use super::*;
use rapier3d::parry::{
    query::Contact,
    shape::{Capsule, Cuboid},
};

struct AxialCast<'a> {
    box_motion: ShapeMotion,
    half: rp::Vector,
    capsule_motion: ShapeMotion,
    capsule: &'a Capsule,
    axis: usize,
    flipped: bool,
}

fn translating(m: ShapeMotion) -> bool {
    m.local_center == rp::Vector::ZERO
        && m.local_pose == rp::Pose::IDENTITY
        && (m.is_fixed_axis_aligned() || m.translation_kernel().is_some())
}

impl<'a> AxialCast<'a> {
    fn new(
        box_motion: ShapeMotion,
        cuboid: &Cuboid,
        capsule_motion: ShapeMotion,
        capsule: &'a Capsule,
        flipped: bool,
    ) -> Option<Self> {
        let a = capsule.segment.a;
        let b = capsule.segment.b;
        let axis = (b - a).abs().max_position();
        (translating(box_motion)
            && translating(capsule_motion)
            && cuboid.half_extents.is_finite()
            && cuboid.half_extents.min_element() > 0.
            && capsule.radius.is_finite()
            && capsule.radius > 0.
            && a.is_finite()
            && b.is_finite()
            && a[axis] != b[axis]
            && (0..3).all(|i| i == axis || a[i] == 0. && b[i] == 0.))
        .then_some(Self {
            box_motion,
            half: cuboid.half_extents,
            capsule_motion,
            capsule,
            axis,
            flipped,
        })
    }

    fn centers(&self, at: Time, work: &mut Work) -> Result<[rp::Vector; 2], TrajectoryError> {
        Ok([
            self.box_motion.metered_pose(at, work)?.translation,
            self.capsule_motion.metered_pose(at, work)?.translation,
        ])
    }

    fn separated(
        &self,
        from: [rp::Vector; 2],
        to: [rp::Vector; 2],
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        work.charge(384)?;
        let mut local2 = 0.;
        let mut world2 = 0.;
        let segment = self.capsule.segment;
        for i in 0..3 {
            let box_low = from[0][i].min(to[0][i]) - self.half[i];
            let box_high = from[0][i].max(to[0][i]) + self.half[i];
            let low = from[1][i].min(to[1][i]);
            let high = from[1][i].max(to[1][i]);
            let a = segment.a[i].min(segment.b[i]);
            let b = segment.a[i].max(segment.b[i]);
            let (goal, shift, endpoint) = if high + b < box_low {
                (box_low, high, b)
            } else if low + a > box_high {
                (-box_high, -low, -a)
            } else {
                continue;
            };
            let gap = (f64::from(goal) - f64::from(shift + endpoint))
                .next_down()
                .max(0.);
            world2 = (world2 + (gap * gap).next_down()).next_down();
            let Some((_, boundary)) = cell_start(goal, shift) else {
                return Ok(false);
            };
            let gap = (boundary - f64::from(endpoint)).next_down().max(0.);
            local2 = (local2 + (gap * gap).next_down()).next_down();
        }
        let radius2 = f64::from(self.capsule.radius).powi(2);
        Ok(local2 > radius2 && world2 > radius2)
    }

    fn witness(
        &self,
        centers: [rp::Vector; 2],
        work: &mut Work,
    ) -> Result<Option<Contact>, TrajectoryError> {
        work.charge(640)?;
        let [box_center, cap_center] = centers;
        let axis = self.axis;
        let mut axial = rp::Vector::ZERO;
        let segment = self.capsule.segment;
        axial[axis] = (box_center[axis] - cap_center[axis]).clamp(
            segment.a[axis].min(segment.b[axis]),
            segment.a[axis].max(segment.b[axis]),
        );
        let core = cap_center + axial;
        let mut point = box_center + (core - box_center).clamp(-self.half, self.half);
        let radius = self.capsule.radius;
        if super::world_contact::distance_upper(core, point) > f64::from(radius) {
            let mut squared = 0.;
            for i in 0..3 {
                if point[i] == core[i] {
                    continue;
                }
                let sign = if point[i] > core[i] { 1. } else { -1. };
                let goal = point[i] * sign;
                let shift = cap_center[i] * sign;
                let Some((local, boundary)) = cell_start(goal, shift) else {
                    return Ok(None);
                };
                // A coarse capsule coordinate can step past the box face. Its
                // first reachable point is admissible only when a real box
                // coordinate maps back to that same interior output.
                point[i] = sign * (shift + local);
                let box_local = (point[i] - box_center[i]).clamp(-self.half[i], self.half[i]);
                if box_center[i] + box_local != point[i] {
                    return Ok(None);
                }
                // A point inside each local input cell avoids a dependence on
                // tie ownership. The common point is also an actual cuboid output.
                let gap = (boundary - f64::from(sign * axial[i])).next_up().max(0.);
                squared = (squared + (gap * gap).next_up()).next_up();
            }
            if squared > f64::from(radius).powi(2) {
                return Ok(None);
            }
        }
        let Some(normal) = (core - point).try_normalize() else {
            return Ok(None);
        };
        let hit = Contact::new(point, point, normal, -normal, 0.);
        Ok(Some(if self.flipped { hit.flipped() } else { hit }))
    }

    fn sweep(
        &self,
        start: Time,
        end: Time,
        tolerance: Time,
        work: &mut Work,
    ) -> Result<IntervalCertificate, TrajectoryError> {
        let mut low = start;
        let mut high = end;
        let mut from = self.centers(low, work)?;
        let mut pending = [0.; 64];
        let mut depth = 0;
        // Each retained upper endpoint owns its unvisited right half. When
        // both shapes move, an interval's swept boxes can overlap even when
        // the shapes never coincide there. Certify it in chronological pieces.
        for _ in 0..192 {
            let to = self.centers(high, work)?;
            if self.separated(from, to, work)? {
                low = high;
                from = to;
                if depth == 0 {
                    return Ok(IntervalCertificate::Separated);
                }
                depth -= 1;
                high = pending[depth];
                continue;
            }
            if low == start {
                if let Some(contact) = self.witness(from, work)? {
                    return Ok(IntervalCertificate::Hit(CastHit {
                        safe_time: start,
                        hit_time: start,
                        contact,
                        subshape_a: 0,
                        subshape_b: 0,
                    }));
                }
            }
            if high - low <= tolerance {
                let mut probe = (low + tolerance).min(end);
                if probe - low > tolerance {
                    probe = probe.next_down();
                }
                for time in [high, probe] {
                    if time <= low || time - low > tolerance {
                        continue;
                    }
                    if let Some(contact) = self.witness(self.centers(time, work)?, work)? {
                        return Ok(IntervalCertificate::Hit(CastHit {
                            safe_time: low,
                            hit_time: time,
                            contact,
                            subshape_a: 0,
                            subshape_b: 0,
                        }));
                    }
                }
            }
            let mid = low.midpoint(high);
            if depth == pending.len() || mid <= low || mid >= high {
                break;
            }
            pending[depth] = high;
            depth += 1;
            high = mid;
        }
        Ok(IntervalCertificate::Unproven)
    }
}

// Find the first F32 local coordinate whose translated output reaches the
// half-space. Its own input cell starts halfway to its predecessor. Verifying
// both translated neighbors includes round-to-nearest ties in the lower bound.
fn cell_start(goal: f32, shift: f32) -> Option<(f32, f64)> {
    if !goal.is_finite() || !shift.is_finite() {
        return None;
    }
    let boundary = (f64::from(goal) + f64::from(goal.next_down())) * 0.5 - f64::from(shift);
    let mut local = boundary as f32;
    if shift + local < goal {
        local = local.next_up();
    }
    if !local.is_finite() || shift + local < goal || shift + local.next_down() >= goal {
        return None;
    }
    Some((
        local,
        (f64::from(local) + f64::from(local.next_down())) * 0.5,
    ))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn sweep(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    tolerance: Time,
    work: &mut Work,
) -> Result<IntervalCertificate, TrajectoryError> {
    let pair = if let (Some(cube), Some(cap)) = (sa.as_cuboid(), sb.as_capsule()) {
        AxialCast::new(a, cube, b, cap, false)
    } else if let (Some(cap), Some(cube)) = (sa.as_capsule(), sb.as_cuboid()) {
        AxialCast::new(b, cube, a, cap, true)
    } else {
        None
    };
    match pair {
        Some(pair) => pair.sweep(start, end, tolerance, work),
        None => Ok(IntervalCertificate::Unproven),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn village_projectile_corner_hits_capsule_shaft_in_both_orders() {
        let domain = Domain::new(0., 1. / 128.).unwrap();
        let movement = |position, velocity| ShapeMotion {
            curve: Curve::Integrated(
                Kernel::from_velocity(
                    rp::RigidBodyHandle::invalid(),
                    domain,
                    rp::Pose::from_translation(position),
                    velocity,
                    rp::Vector::ZERO,
                )
                .unwrap(),
            ),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let actor = movement(rp::Vector::new(-30., 11.255805, 102.), rp::Vector::ZERO);
        let projectile = movement(
            rp::Vector::new(-24.03379, 6.754816, 105.8514),
            rp::Vector::new(-168.02917, 0., -108.4721),
        );
        let capsule = rp::SharedShape::capsule_y(6.5, 4.);
        let cuboid = rp::SharedShape::cuboid(2., 0.005, 2.);
        let dt = domain.duration();
        let tolerance = dt * 1e-6;
        let query = |a, sa: &dyn rp::Shape, b, sb: &dyn rp::Shape| {
            let mut work = Work {
                used: 0,
                limit: 256 * 1024,
            };
            cast(a, sa, b, sb, 0., dt, 0., tolerance, &mut work)
                .unwrap()
                .unwrap()
        };
        let hit = query(actor, capsule.as_ref(), projectile, cuboid.as_ref());
        let reverse = query(projectile, cuboid.as_ref(), actor, capsule.as_ref());
        assert_eq!(hit.safe_time, reverse.safe_time);
        assert_eq!(hit.hit_time, reverse.hit_time);
        assert_eq!(hit.contact.normal1, reverse.contact.normal2);
        assert!(hit.safe_time > 0.0019 && hit.hit_time < 0.00191);
        assert!(hit.hit_time - hit.safe_time <= tolerance);
        assert!(hit.contact.dist <= 0.);
        let box_pose = projectile.pose(hit.hit_time);
        let corner = box_pose.translation - rp::Vector::new(2., 0., 2.);
        assert_eq!(hit.contact.point1, corner);
        assert_eq!(hit.contact.point2, corner);
        // A point query at the certified contact cannot cache a clear start.
        let single = cast_full_shapes_policy_reusing(
            actor,
            capsule.as_ref(),
            projectile,
            cuboid.as_ref(),
            hit.hit_time,
            hit.hit_time,
            0.,
            tolerance,
            &mut Work {
                used: 0,
                limit: 256 * 1024,
            },
            false,
            None,
        )
        .unwrap();
        assert_eq!(single.hit.unwrap().hit_time, hit.hit_time);
        assert!(!single.strictly_clear_start);

        let mut work = Work {
            used: 0,
            limit: 256 * 1024,
        };
        assert!(cast(
            actor,
            capsule.as_ref(),
            projectile,
            cuboid.as_ref(),
            0.,
            hit.safe_time,
            0.,
            tolerance,
            &mut work
        )
        .unwrap()
        .is_none());
    }
    #[test]
    fn independently_translating_projectile_hits_the_shaft_and_rounded_end() {
        let projectile = rp::SharedShape::cuboid(2., 0.005, 2.);
        let capsule = rp::SharedShape::capsule_y(6.5, 4.);
        for (start, actor, actor_v, shot, shot_v, first) in [
            (
                1. / 128.,
                [-30.915133, 11.255805, 104.41365],
                [-7.262268, 0., 18.278564],
                [-24.471436, 6.756837, 100.98881],
                [-196.73792, 0., 35.974888],
                0.011414,
            ),
            (
                2. / 128.,
                [-24.549057, 15.426773, 192.00032],
                [72., -50., 0.],
                [-24.626863, 6.7565856, 197.91801],
                [-194.93658, 0., -44.71831],
                0.023223,
            ),
        ] {
            let domain = Domain::new(start, start + 1. / 128.).unwrap();
            let movement = |position: [f32; 3], velocity: [f32; 3]| ShapeMotion {
                curve: Curve::Integrated(
                    Kernel::from_velocity(
                        rp::RigidBodyHandle::invalid(),
                        domain,
                        rp::Pose::from_translation(position.into()),
                        velocity.into(),
                        rp::Vector::ZERO,
                    )
                    .unwrap(),
                ),
                local_center: rp::Vector::ZERO,
                local_pose: rp::Pose::IDENTITY,
            };
            let mut work = Work {
                used: 0,
                limit: 256 * 1024,
            };
            let shot = movement(shot, shot_v);
            let actor = movement(actor, actor_v);
            let tol = domain.duration() * 1e-6;
            let contact = cast(
                shot,
                projectile.as_ref(),
                actor,
                capsule.as_ref(),
                domain.start,
                domain.end,
                0.,
                tol,
                &mut work,
            )
            .unwrap()
            .unwrap();
            assert!((contact.hit_time - first).abs() < 1e-6, "{contact:?}");
            assert!(contact.hit_time - contact.safe_time <= tol);
            assert_eq!(contact.contact.point1, contact.contact.point2);
            let mut work = Work {
                used: 0,
                limit: 256 * 1024,
            };
            assert!(cast(
                shot,
                projectile.as_ref(),
                actor,
                capsule.as_ref(),
                domain.start,
                contact.safe_time,
                0.,
                tol,
                &mut work
            )
            .unwrap()
            .is_none());
        }
    }
}
