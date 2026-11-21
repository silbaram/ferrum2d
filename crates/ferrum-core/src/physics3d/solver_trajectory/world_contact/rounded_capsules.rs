//! Positive contact between independently validated rounded local capsule
//! points under the actual original identity poses.
use super::capsule_ball::ball_coordinate;
use super::rounded_box_ball::{ball_cell_has_preimage, local_in_world_cell};
use super::*;

fn centered(capsule: &Capsule, axes: [usize; 2]) -> bool {
    axes.into_iter()
        .all(|i| capsule.segment.a[i] == 0. && capsule.segment.b[i] == 0.)
}

fn round_step(value: f32) -> f64 {
    f64::from(value.next_up()) - f64::from(value)
}

#[derive(Clone, Copy)]
struct Nominee {
    point: rp::Vector,
    projection: f64,
}

fn rounded_cell_coordinate(
    mut local: rp::Vector,
    center: rp::Vector,
    selected: usize,
    free: usize,
    direction: f32,
    radius: f32,
) -> Option<rp::Vector> {
    let x = local[selected].abs();
    let x = if x == 0. {
        0.
    } else {
        ((f64::from(x) + f64::from(x.next_down())) * 0.5).next_up()
    };
    let rest = (f64::from(radius).powi(2).next_down() - (x * x).next_up()).next_down();
    if rest <= 0. || !rest.is_finite() {
        return None;
    }
    let mut width = rest.sqrt().next_down() as f32;
    for _ in 0..2 {
        local[free] = width.copysign(direction);
        if ball_cell_has_preimage(local - center, radius) {
            return Some(local);
        }
        width = width.next_down();
    }
    None
}

struct Nominees<'a> {
    pose: &'a rp::Pose,
    center: rp::Vector,
    normal: rp::Vector,
    radius: f32,
    selected: usize,
    free: usize,
    nominal: rp::Vector,
    down: f32,
    up: f32,
    len: usize,
    values: [Option<Nominee>; 65],
}

impl<'a> Nominees<'a> {
    fn new(
        pose: &'a rp::Pose,
        center: rp::Vector,
        axes: [usize; 2],
        normal: rp::Vector,
        radius: f32,
    ) -> Self {
        let score = |i| (pose.translation[i] * normal[i]).abs();
        let [mut selected, mut free] = axes;
        if score(selected) < score(free) {
            std::mem::swap(&mut selected, &mut free);
        }
        let nominal = center + normal * radius;
        let base = (pose * nominal)[selected];
        Self {
            pose,
            center,
            normal,
            radius,
            selected,
            free,
            nominal,
            down: base,
            up: base,
            len: 0,
            values: [None; 65],
        }
    }

    fn extend(
        &mut self,
        len: usize,
        axes: [usize; 2],
        exact_cells: bool,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        for i in self.len..len {
            let world = if i == 0 {
                self.down
            } else if i % 2 == 1 {
                self.down = self.down.next_down();
                self.down
            } else {
                self.up = self.up.next_up();
                self.up
            };
            work.charge(256)?;
            let mut local = self.nominal;
            local[self.selected] = local_in_world_cell(world, self.pose.translation[self.selected]);
            let direct = ball_coordinate(
                local,
                self.center,
                self.free,
                self.normal[self.free],
                self.radius,
            );
            let inverse = if exact_cells
                && self.pose.translation[self.selected] + local[self.selected] == world
            {
                work.charge(192)?;
                rounded_cell_coordinate(
                    local,
                    self.center,
                    self.selected,
                    self.free,
                    self.normal[self.free],
                    self.radius,
                )
            } else {
                None
            };
            // Both candidates use the same local axial core. The cell
            // preimage can reach the next free-axis output while staying
            // strictly within the original radius.
            let candidate = [direct, inverse].into_iter().flatten().max_by(|a, b| {
                (a[self.free] * self.normal[self.free])
                    .total_cmp(&(b[self.free] * self.normal[self.free]))
            });
            if let Some(local) = candidate {
                let point = self.pose * local;
                if point.is_finite() {
                    let [x, y] = axes.map(|i| f64::from(point[i]) * f64::from(self.normal[i]));
                    let projection = (x + y).next_up();
                    self.values[i] = Some(Nominee { point, projection });
                }
            }
        }
        self.len = len;
        Ok(())
    }

    fn best(&self) -> Option<Nominee> {
        self.values[..self.len].iter().copied().flatten().fold(
            None,
            |best: Option<Nominee>, nominee| {
                if best.is_none_or(|old| nominee.projection > old.projection) {
                    Some(nominee)
                } else {
                    best
                }
            },
        )
    }
}

fn observe(
    p: rp::Vector,
    q: rp::Vector,
    normal: rp::Vector,
    upper: f64,
    margin: f32,
) -> Option<Witness> {
    if !upper.is_finite() || upper > f64::from(margin) {
        return None;
    }
    let mut dist = upper as f32;
    if f64::from(dist) < upper {
        dist = dist.next_up();
    }
    Some(Witness {
        contact: Contact::new(p, q, normal, -normal, dist),
        strict: upper < f64::from(margin),
    })
}

pub(super) fn at(
    pair: &CapsulePair<'_>,
    a: &rp::Pose,
    b: &rp::Pose,
    margin: f32,
    exact_boundary: bool,
    work: &mut Work,
) -> Result<Option<Witness>, TrajectoryError> {
    let Some(axis) = pair.axis else {
        return Ok(None);
    };
    let axes = [(axis + 1) % 3, (axis + 2) % 3];
    if a.rotation != rp::Rotation::IDENTITY
        || b.rotation != rp::Rotation::IDENTITY
        || !centered(pair.a, axes)
        || !centered(pair.b, axes)
    {
        return Ok(None);
    }
    work.charge(384)?;
    let [ta, tb] = [a.translation, b.translation];
    let mut core_a = rp::Vector::ZERO;
    let mut core_b = rp::Vector::ZERO;
    let clamper = |c: &Capsule, x: f32| {
        x.clamp(
            c.segment.a[axis].min(c.segment.b[axis]),
            c.segment.a[axis].max(c.segment.b[axis]),
        )
    };
    core_a[axis] = clamper(pair.a, tb[axis] - ta[axis]);
    core_b[axis] = clamper(pair.b, (ta[axis] + core_a[axis]) - tb[axis]);
    if ta[axis] + core_a[axis] != tb[axis] + core_b[axis] {
        return Ok(None);
    }
    let gap = gap_upper(
        gap_upper(distance_upper(*a * core_a, *b * core_b), pair.a.radius),
        pair.b.radius,
    );
    let error = |pose: &rp::Pose, r: f32| {
        axes.into_iter().fold(0., |e, i| {
            (e + round_step(pose.translation[i].abs() + r) + round_step(r)).next_up()
        })
    };
    // This is solely an optional search cutoff, with no clearance authority.
    // Outside the rounding shell the original real observer owns contact.
    if gap > (f64::from(margin) + error(a, pair.a.radius) + error(b, pair.b.radius)).next_up() {
        return Ok(None);
    }
    let mut delta = tb - ta;
    delta[axis] = 0.;
    let Some(normal) = unit_normal(delta) else {
        return Ok(None);
    };
    // Along one transverse axis these local points attain the actual radii.
    // Evaluate the original forward transforms before trying nearby cells.
    if delta[axes[0]] == 0. || delta[axes[1]] == 0. {
        work.charge(256)?;
        let p = *a * (core_a + normal * pair.a.radius);
        let q = *b * (core_b - normal * pair.b.radius);
        if let Some(witness) = observe(p, q, normal, distance_upper(p, q), margin) {
            return Ok(Some(witness));
        }
    }
    let mut candidates_a = Nominees::new(a, core_a, axes, normal, pair.a.radius);
    let mut candidates_b = Nominees::new(b, core_b, axes, -normal, pair.b.radius);
    candidates_a.extend(5, axes, exact_boundary, work)?;
    candidates_b.extend(5, axes, exact_boundary, work)?;
    let (Some(a0), Some(b0)) = (candidates_a.best(), candidates_b.best()) else {
        return Ok(None);
    };
    work.charge(64)?;
    let first = distance_upper(a0.point, b0.point);
    if let Some(witness) = observe(a0.point, b0.point, normal, first, margin) {
        return Ok(Some(witness));
    }
    candidates_a.extend(33, axes, exact_boundary, work)?;
    candidates_b.extend(33, axes, exact_boundary, work)?;
    let (Some(a1), Some(b1)) = (candidates_a.best(), candidates_b.best()) else {
        return Ok(None);
    };
    work.charge(64)?;
    let second = distance_upper(a1.point, b1.point);
    if let Some(witness) = observe(a1.point, b1.point, normal, second, margin) {
        return Ok(Some(witness));
    }
    if !exact_boundary && first.min(second) > f64::from(margin.next_up()) {
        return Ok(None);
    }
    // Extend the same ordered candidate sets. A row beyond the plane even
    // with the opposite side's best projection cannot contain any witness.
    candidates_a.extend(65, axes, exact_boundary, work)?;
    candidates_b.extend(65, axes, exact_boundary, work)?;
    let Some(best_b) = candidates_b.best() else {
        return Ok(None);
    };
    let limit = (f64::from(margin) * distance_upper(rp::Vector::ZERO, normal)).next_up();
    for p in candidates_a.values.into_iter().flatten() {
        work.charge(8)?;
        if -(p.projection + best_b.projection).next_up() > limit {
            continue;
        }
        for q in candidates_b.values.into_iter().flatten() {
            work.charge(8)?;
            if -(p.projection + q.projection).next_up() > limit {
                continue;
            }
            work.charge(64)?;
            let upper = distance_upper(p.point, q.point);
            if let Some(witness) = observe(p.point, q.point, normal, upper, margin) {
                return Ok(Some(witness));
            }
        }
    }
    Ok(None)
}
