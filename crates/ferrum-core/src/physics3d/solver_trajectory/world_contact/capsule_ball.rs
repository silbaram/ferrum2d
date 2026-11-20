//! Positive contact from the existing time bracket, using represented points
//! that admit original local sphere preimages.
use super::rounded_box_ball::local_in_world_cell;
use super::*;

pub(in crate::physics3d::solver_trajectory) struct RoundedCapsuleBall<'a> {
    moving: ShapeMotion,
    target: ShapeMotion,
    capsule: &'a Capsule,
    ball: &'a rp::Ball,
    capsule_axis: usize,
    flipped: bool,
    clearance: f32,
    observed: Option<(Time, Option<Contact>)>,
}

impl<'a> RoundedCapsuleBall<'a> {
    pub fn new(
        a: ShapeMotion,
        sa: &'a dyn rp::Shape,
        b: ShapeMotion,
        sb: &'a dyn rp::Shape,
        clearance: f32,
    ) -> Option<Self> {
        let (moving, target, capsule, ball, flipped) =
            if let (Some(c), Some(s)) = (sa.as_capsule(), sb.as_ball()) {
                (a, b, c, s, false)
            } else {
                (b, a, sb.as_capsule()?, sa.as_ball()?, true)
            };
        if !moving.is_single_axis_spin()
            || !target.is_fixed_axis_aligned()
            || !clearance.is_finite()
            || clearance <= 0.
            || !capsule.radius.is_finite()
            || capsule.radius <= 0.
            || !ball.radius.is_finite()
            || ball.radius <= 0.
        {
            return None;
        }
        let mut axes = (0..3).filter(|&i| capsule.segment.a[i] != capsule.segment.b[i]);
        let capsule_axis = axes.next()?;
        if axes.next().is_some() {
            return None;
        }
        Some(Self {
            moving,
            target,
            capsule,
            ball,
            capsule_axis,
            flipped,
            clearance,
            observed: None,
        })
    }

    pub fn contact(
        &mut self,
        at: Time,
        work: &mut Work,
    ) -> Result<Option<Contact>, TrajectoryError> {
        work.charge(8)?;
        if let Some((time, observation)) = self.observed {
            if time == at {
                return Ok(observation);
            }
        }
        let contact = self.contact_at(at, work)?;
        self.observed = Some((at, contact));
        Ok(contact)
    }

    fn contact_at(&self, at: Time, work: &mut Work) -> Result<Option<Contact>, TrajectoryError> {
        validate_interval(self.moving, self.target, at, at, work)?;
        work.charge(2048)?;
        let capsule_pose = self.moving.pose(at);
        let sphere_pose = self.target.pose(at);
        let sphere = sphere_pose.translation;
        if !capsule_pose.is_finite()
            || !sphere_pose.is_finite()
            || sphere_pose.rotation != rp::Rotation::IDENTITY
        {
            return Ok(None);
        }
        let mut ends = [self.capsule.segment.a, self.capsule.segment.b];
        let [first, second] = ends.map(|end| (sphere - capsule_pose * end).length_squared());
        if second.total_cmp(&first).is_lt() {
            ends.swap(0, 1);
        }
        let axis = self.capsule_axis;
        let radius = self.capsule.radius;
        let r = self.ball.radius;
        for center in ends {
            let Some(normal) = (sphere - capsule_pose * center).try_normalize() else {
                continue;
            };
            let Some(direction) = (capsule_pose.rotation.inverse() * normal).try_normalize() else {
                continue;
            };
            let free_axis = largest_other_axis(direction, axis);
            let shifted_axis = (0..3)
                .max_by(|&i, &j| {
                    let priority = |k: usize| sphere[k].abs() * normal[k].abs();
                    priority(i).total_cmp(&priority(j))
                })
                .ok_or(TrajectoryError::InvalidReference)?;
            let sphere_free = largest_other_axis(normal, shifted_axis);
            let nominal = center + radius * direction;
            let mut low = nominal[axis];
            let mut high = low;
            for _ in 0..=32 {
                for selected in [low, high] {
                    work.charge(1536)?;
                    let mut nominee = nominal;
                    nominee[axis] = selected;
                    let Some(local) =
                        ball_coordinate(nominee, center, free_axis, direction[free_axis], radius)
                    else {
                        continue;
                    };
                    let point = capsule_pose * local;
                    let Some(unit) = (point - sphere).try_normalize() else {
                        continue;
                    };
                    let guess = unit * r;
                    let shifted = sphere[shifted_axis] + guess[shifted_axis];
                    for candidate in [shifted, shifted.next_down(), shifted.next_up()] {
                        let mut guess = guess;
                        guess[shifted_axis] = local_in_world_cell(candidate, sphere[shifted_axis]);
                        let Some(local) = ball_coordinate(
                            guess,
                            rp::Vector::ZERO,
                            sphere_free,
                            unit[sphere_free],
                            r,
                        ) else {
                            continue;
                        };
                        let other = sphere_pose * local;
                        let upper = distance_upper(point, other);
                        if upper.is_finite() && upper <= f64::from(self.clearance) {
                            let mut dist = upper as f32;
                            if f64::from(dist) < upper {
                                dist = dist.next_up();
                            }
                            let contact = Contact::new(point, other, normal, -normal, dist);
                            return Ok(Some(if self.flipped {
                                contact.flipped()
                            } else {
                                contact
                            }));
                        }
                    }
                }
                low = low.next_down();
                high = high.next_up();
            }
        }
        Ok(None)
    }
}

fn largest_other_axis(normal: rp::Vector, axis: usize) -> usize {
    let a = (axis + 1) % 3;
    let b = (axis + 2) % 3;
    if normal[a].abs() >= normal[b].abs() {
        a
    } else {
        b
    }
}

// An interior representative nearest the center rounds to the nominated
// local coordinate without depending on a tie. Both midpoint operands
// are adjacent finite F32 values, so their mean is exact in F64.
fn cell_offset(value: f32, center: f32) -> f64 {
    if value == center {
        return 0.;
    }
    let adjacent = if value < center {
        value.next_up()
    } else {
        value.next_down()
    };
    let middle = (f64::from(value) + f64::from(adjacent)) * 0.5;
    let interior = if value < center {
        middle.next_down()
    } else {
        middle.next_up()
    };
    (interior - f64::from(center)).abs().next_up()
}

pub(super) fn ball_coordinate(
    mut p: rp::Vector,
    center: rp::Vector,
    axis: usize,
    direction: f32,
    radius: f32,
) -> Option<rp::Vector> {
    let mut remaining = f64::from(radius).powi(2);
    for i in (0..3).filter(|&i| i != axis) {
        remaining -= cell_offset(p[i], center[i]).powi(2);
    }
    if remaining < 0. || !remaining.is_finite() {
        return None;
    }
    let level = (f64::from(center[axis]) + remaining.sqrt().copysign(f64::from(direction))) as f32;
    for value in [level, level.next_down(), level.next_up()] {
        p[axis] = value;
        if !p.is_finite() {
            continue;
        }
        let squared = (0..3).fold(0., |sum, i| {
            let offset = cell_offset(p[i], center[i]);
            (sum + (offset * offset).next_up()).next_up()
        });
        if squared <= f64::from(radius).powi(2) {
            return Some(p);
        }
    }
    None
}
