//! Positive contact witnesses inside an already admitted first-contact bracket.
use super::*;

type PoseContact = ([u32; 7], Option<Contact>);
type BracketContact = ([u64; 3], Option<(Time, Contact)>);

#[derive(Default)]
pub(in crate::physics3d::solver_trajectory) struct RoundedBoxBallProbes {
    bracket: Option<BracketContact>,
    cells: [Option<PoseContact>; 16],
    next: usize,
}

impl RoundedBoxBallProbes {
    #[allow(clippy::too_many_arguments)]
    pub fn contact(
        &mut self,
        pair: &Pair<'_>,
        a: ShapeMotion,
        b: ShapeMotion,
        safe: Time,
        right: Time,
        probe: Time,
        time_tolerance: Time,
        margin: f32,
        work: &mut Work,
    ) -> Result<Option<(Time, Contact)>, TrajectoryError> {
        let key = [safe, right, probe].map(Time::to_bits);
        let result = match self.bracket {
            Some((previous, result)) if previous == key => result,
            _ => {
                let mut result = None;
                // All probes stay in the original
                // tolerance bracket. A rounded contact can
                // enter and leave between its two endpoints.
                for step in 0..=32 {
                    work.charge(8)?;
                    let at = if step == 0 {
                        right
                    } else {
                        safe + (probe - safe) * (step as f64 / 32.)
                    };
                    if at <= safe || at > probe || at - safe > time_tolerance {
                        continue;
                    }
                    if let Some(point) = pair.rounded_box_ball_at(a, b, at, margin, work, self)? {
                        result = Some((at, point));
                        break;
                    }
                }
                self.bracket = Some((key, result));
                result
            }
        };
        Ok(result)
    }
}

impl Pair<'_> {
    // Called only inside the existing first-contact time bracket. Nominate
    // represented tangent points near the original box-face projection and
    // test a sphere point in each nearby rounded world coordinate cell.
    fn rounded_box_ball_at(
        &self,
        a: ShapeMotion,
        b: ShapeMotion,
        at: Time,
        margin: f32,
        work: &mut Work,
        cache: &mut RoundedBoxBallProbes,
    ) -> Result<Option<Contact>, TrajectoryError> {
        let PairKind::BoxBall(pair) = &self.kind else {
            return Ok(None);
        };
        let (box_motion, ball_motion) = if pair.flipped { (b, a) } else { (a, b) };
        if !ball_motion.is_fixed_axis_aligned() || box_motion.is_fixed_axis_aligned() || margin < 0.
        {
            return Ok(None);
        }
        validate_interval(a, b, at, at, work)?;
        work.charge(1024)?;
        let cube = box_motion.pose(at);
        let ball = ball_motion.pose(at);
        if !cube.is_finite() || !ball.is_finite() || ball.rotation != rp::Rotation::IDENTITY {
            return Ok(None);
        }
        let key = [
            cube.translation.x,
            cube.translation.y,
            cube.translation.z,
            cube.rotation.x,
            cube.rotation.y,
            cube.rotation.z,
            cube.rotation.w,
        ]
        .map(f32::to_bits);
        // Each cast owns a fixed pair and clearance. The sphere pose is
        // constant, so all probe times reaching these box bits share geometry.
        work.charge((cache.cells.len() * 8) as u64)?;
        if let Some((_, result)) = cache.cells.iter().flatten().find(|(old, _)| *old == key) {
            return Ok(*result);
        }
        let index = cache.next;
        cache.next = (index + 1) % cache.cells.len();
        let slot = &mut cache.cells[index];
        let half = pair.cuboid.half_extents;
        let nominal = cube.inv_mul(&ball).translation;
        let r = pair.ball.radius;
        if !nominal.is_finite()
            || !half.is_finite()
            || half.min_element() < 0.
            || !r.is_finite()
            || r <= 0.
        {
            return Ok(None);
        }
        let nearest = nominal.clamp(-half, half);
        let mut face = (0..3).filter(|&i| nominal[i] != nearest[i]);
        let Some(face_axis) = face.next() else {
            return Ok(None);
        };
        if face.next().is_some() {
            return Ok(None);
        }
        let mut local_normal = rp::Vector::ZERO;
        local_normal[face_axis] = nominal[face_axis].signum();
        let Some(normal) = (cube.rotation * local_normal).try_normalize() else {
            return Ok(None);
        };
        let tangent = (0..3)
            .filter(|&i| i != face_axis)
            .max_by(|&i, &j| nearest[i].abs().total_cmp(&nearest[j].abs()))
            .ok_or(TrajectoryError::InvalidReference)?;
        let largest_normal = (0..3)
            .max_by(|&i, &j| normal[i].abs().total_cmp(&normal[j].abs()))
            .ok_or(TrajectoryError::InvalidReference)?;
        let other = (0..3)
            .filter(|&i| i != largest_normal)
            .max_by(|&i, &j| {
                ball.translation[i]
                    .abs()
                    .total_cmp(&ball.translation[j].abs())
                    .then_with(|| normal[i].abs().total_cmp(&normal[j].abs()))
            })
            .ok_or(TrajectoryError::InvalidReference)?;
        let wide = ball.translation[largest_normal].abs() > ball.translation[other].abs()
            && normal[other].abs() > 0.;
        let (dominant, rounded_axis) = if wide {
            (other, largest_normal)
        } else {
            (largest_normal, other)
        };
        let origin = ball.translation[rounded_axis].abs();
        let spacing = origin.next_up() - origin;
        let span = (spacing * r).sqrt();
        let step = if span.is_finite() { span / 32. } else { 0. };
        let third = 3 - dominant - rounded_axis;
        let mut lower = nearest[tangent];
        let mut higher = lower;
        for offset in 0..=32 {
            let shift = offset as f32 * step;
            let candidates = if wide && step > 0. {
                [nearest[tangent] - shift, nearest[tangent] + shift]
            } else {
                [lower, higher]
            };
            for tangent_value in candidates {
                if tangent_value < -half[tangent] || tangent_value > half[tangent] {
                    continue;
                }
                work.charge(1024)?;
                let mut local = nearest;
                local[tangent] = tangent_value;
                let point = cube * local;
                if margin == 0. {
                    // The box point can itself belong to the sphere's
                    // rounded image. Prove both membership and exact output.
                    let local = rp::Vector::from_array(std::array::from_fn(|i| {
                        local_in_world_cell(point[i], ball.translation[i])
                    }));
                    if ball * local == point && ball_cell_has_preimage(local, r) {
                        let contact = Contact::new(point, point, normal, -normal, 0.);
                        let result = Some(if pair.flipped {
                            contact.flipped()
                        } else {
                            contact
                        });
                        *slot = Some((key, result));
                        return Ok(result);
                    }
                    continue;
                }

                let delta = point - ball.translation;
                let Some(direction) = delta.try_normalize() else {
                    continue;
                };
                let guess = direction * r;
                let shifted = ball.translation[rounded_axis] + guess[rounded_axis];
                let origin = ball.translation[rounded_axis];
                let local_third = guess[third];
                for shifted in [shifted, shifted.next_down(), shifted.next_up()] {
                    // Take the local value nearest zero in the world
                    // coordinate's binade cell. The cell only nominates a
                    // point; complete sphere membership is checked below.
                    let local_axis = local_in_world_cell(shifted, origin);
                    let squared = f64::from(r).powi(2)
                        - f64::from(local_axis).powi(2)
                        - f64::from(local_third).powi(2);
                    if squared <= 0. {
                        continue;
                    }
                    let mut local = rp::Vector::ZERO;
                    local[rounded_axis] = local_axis;
                    local[third] = local_third;
                    let v = squared.sqrt() as f32;
                    let mut contained = false;
                    for candidate in [v.next_up(), v, v.next_down()] {
                        local[dominant] = candidate.copysign(guess[dominant]);
                        if ball_cell_has_preimage(local, r) {
                            contained = true;
                            break;
                        }
                    }
                    if !contained {
                        continue;
                    }
                    let sphere = ball * local;
                    let upper = distance_upper(point, sphere);
                    if !upper.is_finite() || upper >= f64::from(margin) {
                        continue;
                    }
                    let mut dist = upper as f32;
                    if f64::from(dist) < upper {
                        dist = dist.next_up();
                    }
                    let contact = Contact::new(point, sphere, normal, -normal, dist);
                    let result = Some(if pair.flipped {
                        contact.flipped()
                    } else {
                        contact
                    });
                    *slot = Some((key, result));
                    return Ok(result);
                }
            }
            lower = lower.next_down();
            higher = higher.next_up();
        }
        *slot = Some((key, None));
        Ok(None)
    }
}

// The represented offset nearest zero that reaches this world rounding cell.
pub(in crate::physics3d::solver_trajectory) fn local_in_world_cell(
    shifted: f32,
    origin: f32,
) -> f32 {
    if shifted == origin {
        return 0.;
    }
    let adjacent = if shifted < origin {
        shifted.next_up()
    } else {
        shifted.next_down()
    };
    let boundary = (f64::from(shifted) + f64::from(adjacent)) * 0.5 - f64::from(origin);
    let v = boundary as f32;
    if origin + v == shifted {
        v
    } else if shifted < origin {
        v.next_down()
    } else {
        v.next_up()
    }
}

// Choose a real point strictly inside each floating-point input cell,
// as close to zero as possible. It rounds to these coordinates regardless
// of ties. Directed squared distance then proves original sphere membership.
pub(super) fn ball_cell_has_preimage(local: rp::Vector, radius: f32) -> bool {
    if !local.is_finite() {
        return false;
    }
    let mut squared = 0_f64;
    for x in local.to_array() {
        let x = x.abs();
        if x > 0. {
            let preimage = ((f64::from(x) + f64::from(x.next_down())) * 0.5).next_up();
            squared = (squared + (preimage * preimage).next_up()).next_up();
        }
    }
    squared <= f64::from(radius) * f64::from(radius)
}
