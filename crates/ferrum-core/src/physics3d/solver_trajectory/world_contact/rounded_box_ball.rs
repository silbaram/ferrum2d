//! Positive contact witnesses inside an already admitted first-contact bracket.
use super::*;

type PoseContact = ([u32; 7], bool, Option<Contact>);
type GridContact = ([u64; 2], Option<(Time, Contact)>);

#[derive(Default)]
pub(in crate::physics3d::solver_trajectory) struct RoundedBoxBallProbes {
    grid: Option<GridContact>,
    searched_through: Option<Time>,
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
        sliding: bool,
        mut native: impl FnMut(Time, &mut Work) -> Result<Option<Contact>, TrajectoryError>,
    ) -> Result<Option<(Time, Contact)>, TrajectoryError> {
        // Test the changing interval endpoint first. The remaining grid belongs
        // to the safe/probe bracket and is often identical across subdivisions.
        work.charge(8)?;
        if right > safe && right <= probe && right - safe <= time_tolerance {
            if let Some(point) =
                pair.rounded_box_ball_at([a, b], right, margin, sliding, work, self)?
            {
                return Ok(Some((right, point)));
            }
        }
        let key = [safe, probe].map(Time::to_bits);
        if let Some((previous, result)) = self.grid {
            if previous == key {
                return Ok(result);
            }
        }
        let mut result = None;
        // Successive tiny subdivisions have overlapping tolerance windows.
        // Positive nominees in the previous window already had their turn.
        // Search the new part at the original density and keep its endpoint.
        // A missing point has no bearing on any separation certificate.
        let from = self
            .searched_through
            .filter(|t| sliding && *t >= safe && *t <= probe)
            .unwrap_or(safe);
        let slices = if sliding {
            (((probe - from) / time_tolerance) * 32.)
                .ceil()
                .clamp(1., 32.) as u32
        } else {
            32
        };
        for step in 1..=slices {
            work.charge(8)?;
            let at = from + (probe - from) * (f64::from(step) / f64::from(slices));
            if at <= safe || at > probe || at - safe > time_tolerance {
                continue;
            }
            if sliding {
                if let Some(point) = native(at, work)? {
                    result = Some((at, point));
                    break;
                }
            }
            if let Some(point) = pair.rounded_box_ball_at([a, b], at, margin, false, work, self)? {
                result = Some((at, point));
                break;
            }
        }
        if result.is_none() && sliding && from < probe {
            if let PairKind::BoxBall(shapes) = &pair.kind {
                let (cube, target) = if shapes.flipped { (b, a) } else { (a, b) };
                super::super::rounded::rotating_box_clock_times(
                    cube,
                    shapes.cuboid,
                    target,
                    shapes.ball,
                    from,
                    probe,
                    margin,
                    work,
                    |at, work| {
                        if at <= safe || at > probe || at - safe > time_tolerance {
                            return Ok(true);
                        }
                        if let Some(point) =
                            pair.rounded_box_ball_at([a, b], at, margin, true, work, self)?
                        {
                            result = Some((at, point));
                            return Ok(false);
                        }
                        Ok(true)
                    },
                )?;
            }
        }
        self.searched_through = Some(probe);
        self.grid = Some((key, result));
        Ok(result)
    }
}

impl Pair<'_> {
    // Called only inside the existing first-contact time bracket. Nominate
    // represented tangent points near the original box-face projection and
    // test a sphere point in each nearby rounded world coordinate cell.
    fn rounded_box_ball_at(
        &self,
        [a, b]: [ShapeMotion; 2],
        at: Time,
        margin: f32,
        wide_columns: bool,
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
        if let Some((_, _, result)) =
            cache.cells.iter().flatten().find(|(old, wide, result)| {
                *old == key && (*wide || !wide_columns || result.is_some())
            })
        {
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
                // A large common offset perpendicular to the face normal
                // cannot improve its support. Nominate a cell whose rounding
                // can actually influence the gap on this face.
                let contribution = |axis: usize| {
                    let coordinate = ball.translation[axis].abs();
                    (f64::from(coordinate.next_up()) - f64::from(coordinate))
                        * f64::from(normal[axis].abs())
                };
                contribution(i)
                    .total_cmp(&contribution(j))
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
                work.charge(64)?;
                let mut local = nearest;
                local[tangent] = tangent_value;
                let point = cube * local;
                if rounded_ball_point_clear(point, ball.translation, r, margin) {
                    continue;
                }
                work.charge(1024)?;
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
                        *slot = Some((key, wide_columns, result));
                        return Ok(result);
                    }
                    continue;
                }

                let delta = point - ball.translation;
                let Some(direction) = delta.try_normalize() else {
                    continue;
                };
                let extended =
                    box_motion.has_integrated_spin() && !box_motion.is_single_axis_spin();
                if extended {
                    let world_upper = gap_upper(distance_upper(point, ball.translation), r);
                    if world_upper < f64::from(margin) {
                        if let Some(sphere) = ball_point(ball.translation, direction, r) {
                            let mut d = world_upper as f32;
                            if f64::from(d) < world_upper {
                                d = d.next_up();
                            }
                            let contact = Contact::new(point, sphere, normal, -normal, d);
                            let result = Some(if pair.flipped {
                                contact.flipped()
                            } else {
                                contact
                            });
                            *slot = Some((key, wide_columns, result));
                            return Ok(result);
                        }
                    }
                }
                let guess = direction * r;
                let shifted = ball.translation[rounded_axis] + guess[rounded_axis];
                let origin = ball.translation[rounded_axis];
                let local_third = guess[third];
                let mut lo = shifted;
                let mut hi = shifted;
                for index in 0..if wide_columns { 17 } else { 3 } {
                    let shifted = if index == 0 {
                        shifted
                    } else if index % 2 == 1 {
                        lo = lo.next_down();
                        lo
                    } else {
                        hi = hi.next_up();
                        hi
                    };
                    if index >= 3 {
                        work.charge(48)?;
                    }

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
                    *slot = Some((key, wide_columns, result));
                    return Ok(result);
                }
            }
            lower = lower.next_down();
            higher = higher.next_up();
        }
        *slot = Some((key, wide_columns, None));
        Ok(None)
    }
}

// A true point within the world margin has a real local sphere preimage.
// Reflection toward the nominated box point cannot increase distance, so
// only the corresponding half of each rounded coordinate is needed here.
fn rounded_ball_point_clear(
    point: rp::Vector,
    center: rp::Vector,
    radius: f32,
    margin: f32,
) -> bool {
    let half = |x: f32| 0.5 * (f64::from(x.next_up()) - f64::from(x));
    let local = half(radius);
    let mut squared = 0.;
    for i in 0..3 {
        let delta = f64::from(point[i]) - f64::from(center[i]);
        let toward = if delta >= 0. {
            center[i] + radius
        } else {
            center[i] - radius
        };
        let world = if center[i] == 0. {
            0.
        } else {
            half(center[i].abs().max(toward.abs()))
        };
        let lower = ((delta.abs().next_down() - local).next_down() - world)
            .next_down()
            .max(0.);
        squared = (squared + (lower * lower).next_down()).next_down();
    }
    let reach = (f64::from(radius) + f64::from(margin)).next_up();
    squared.is_finite() && squared > (reach * reach).next_up()
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
