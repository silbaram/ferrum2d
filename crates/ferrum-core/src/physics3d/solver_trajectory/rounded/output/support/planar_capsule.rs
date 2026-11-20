//! Narrow exact planar image of the original rounded cuboid and capsule cap.
use super::*;
use rapier3d::parry::query::Contact;

pub(in crate::physics3d::solver_trajectory) enum PlanarCell {
    Separated,
    Hit(Contact),
    Unknown,
}

#[derive(Clone, Copy)]
struct Point {
    x: f32,
    y: f32,
}

fn f(value: f32) -> Bound {
    Bound::exact(f64::from(value))
}

fn norm_squared(x: Bound, y: Bound) -> Bound {
    x.mul(x).add(y.mul(y))
}

fn dot(point: Point, nx: Bound, ny: Bound) -> Bound {
    f(point.x).mul(nx).add(f(point.y).mul(ny))
}

// The positive output range allows a single directed product per
// coordinate. Sterbenz also makes every difference exactly a F32 value,
// so its square is exact after widening to F64.
fn exact_face_differences(range: Float, center: f32) -> bool {
    let lo = f64::from(range.lo);
    let hi = f64::from(range.hi);
    let center = f64::from(center);
    if lo <= 0. || lo * 2. < center || hi > center * 2. || (lo <= 1. && hi >= 1.) {
        return false;
    }
    let from = lo - center;
    let to = hi - center;
    // Match the original Bound product's exact-zero and unit fast paths.
    (from > -1. && to < 0.) || (from > 0. && to < 1.)
}

fn exact_face_distance(point: Point, center: Point) -> Bound {
    let x = f64::from(point.x) - f64::from(center.x);
    let y = f64::from(point.y) - f64::from(center.y);
    let x = x * x;
    let y = y * y;
    Bound {
        lo: (x.next_down() + y.next_down()).next_down(),
        hi: (x.next_up() + y.next_up()).next_up(),
    }
}

fn radius_in_cell(y: f32, shift: f32, core: f32, r2: Bound) -> Option<(f32, f32)> {
    // Return the extremal represented local Y reachable in this world cell,
    // taking the closed rounding cell as an outer bound for ties.
    let boundary = f(y).add(f(y.next_up())).mul(Bound::exact(0.5));
    let local_upper = boundary.sub(f(shift)).hi;
    let mut local_y = local_upper as f32;
    if f64::from(local_y) > local_upper {
        local_y = local_y.next_down();
    }
    if shift + local_y > y {
        local_y = local_y.next_down();
    }
    if shift + local_y != y || shift + local_y.next_up() <= y {
        return None;
    }
    let p = f(local_y)
        .add(f(local_y.next_up()))
        .mul(Bound::exact(0.5))
        .sub(f(core));
    if !p.finite() || p.hi >= 0. {
        return None;
    }
    let p = Bound::exact(p.hi);
    let left = r2.sub(p.mul(p));
    let x = left.hi.max(0.).sqrt().next_up() as f32;
    x.is_finite().then_some((x, local_y))
}

fn contains_cap(x: f32, y: f32, core: f32, radius2: Bound) -> bool {
    let x = f(x).add(f(x.next_down())).mul(Bound::exact(0.5)).hi;
    let y = f(y)
        .add(f(y.next_up()))
        .mul(Bound::exact(0.5))
        .sub(f(core))
        .lo;
    if x <= 0. || y >= 0. {
        return false;
    }
    // Strict interior in both cells is available if the closest corner of
    // their closures is strictly inside the disk.
    norm_squared(Bound::exact(x), Bound::exact(y)).hi < radius2.lo
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn planar_capsule_cell(
    cube: rp::Pose,
    half: rp::Vector,
    cap: rp::Pose,
    capsule: &rp::Capsule,
    margin: f32,
    work: &mut Work,
) -> Result<PlanarCell, TrajectoryError> {
    capsule_cell(cube, half, cap, capsule, margin, false, work)
}

pub(in crate::physics3d::solver_trajectory) fn initial_capsule_cell(
    cube: rp::Pose,
    half: rp::Vector,
    cap: rp::Pose,
    capsule: &rp::Capsule,
    margin: f32,
    work: &mut Work,
) -> Result<PlanarCell, TrajectoryError> {
    capsule_cell(cube, half, cap, capsule, margin, true, work)
}

fn capsule_cell(
    cube: rp::Pose,
    half: rp::Vector,
    cap: rp::Pose,
    capsule: &rp::Capsule,
    margin: f32,
    expanded_witness: bool,
    work: &mut Work,
) -> Result<PlanarCell, TrajectoryError> {
    use PlanarCell::*;
    let [qx, qy, z, w] = cube.rotation.to_array();
    let [a, b] = [capsule.segment.a, capsule.segment.b];
    if qx != 0.
        || qy != 0.
        || z <= 0.
        || w <= z
        || cap.rotation != rp::Rotation::IDENTITY
        || a.x != 0.
        || a.z != 0.
        || b.x != 0.
        || b.z != 0.
        || capsule.radius <= 0.
        || margin < 0.
        || !cube.is_finite()
        || !cap.is_finite()
        || !half.is_finite()
        || half.min_element() < 0.
        || !a.is_finite()
        || !b.is_finite()
    {
        return Ok(Unknown);
    }
    work.charge(2048)?;
    let radius = f(capsule.radius);
    let r2 = radius.mul(radius);
    let m = f(margin);
    let m2 = m.mul(m);
    let base = a.y.min(b.y);
    let cap0 = f(cap.translation.y).add(f(base));
    let nx = f(z).mul(f(w)).mul(Bound::exact(-2.));
    let ny = f(w).mul(f(w)).sub(f(z).mul(f(z)));
    let s = f(w).mul(f(w)).add(f(z).mul(f(z)));
    let s2 = s.mul(s);
    if ny.lo <= 0. || s.lo <= 0. {
        return Ok(Unknown);
    }

    let whole_box = transform(
        Frame::exact(cube),
        half.to_array().map(|h| Value::input(Float::span(-h, h))),
    );
    let whole_cap = transform(Frame::exact(cap), local_hull(&[a, b], capsule.radius));
    if whole_box.iter().chain(&whole_cap).any(|v| !v.finite()) {
        return Ok(Unknown);
    }
    let xy_error = |values: [Value; 3]| {
        norm_squared(Bound::exact(values[0].error), Bound::exact(values[1].error)).sqrt()
    };
    // An actual point within margin would have ideal distance at most R from
    // its core. The world-radius graph uses exact real offsets from rounded
    // core positions, so its center error is bounded separately as well.
    let world_core = transform(Frame::exact(cap), local_hull(&[a, b], 0.));
    let er = xy_error(whole_cap).hi.max(xy_error(world_core).hi);
    let e = m
        .add(Bound::exact(xy_error(whole_box).hi))
        .add(Bound::exact(er));
    let outer = radius.add(e).mul(s);
    let dx = f(cap.translation.x).sub(f(cube.translation.x));
    let dy = cap0.sub(f(cube.translation.y));
    let face = nx.mul(dx).add(ny.mul(dy)).sub(s2.mul(f(half.y)));
    if !face.finite() || face.lo <= 0. || !outer.finite() {
        return Ok(Unknown);
    }
    if face.lo > outer.hi {
        return Ok(Separated);
    }
    let slack = outer.sub(face).hi;
    let face_slack = Bound::exact(slack);
    let core_width = (slack / ny.lo).next_up();
    let tangent_width = outer.mul(outer).sub(face.mul(face)).sqrt().hi;
    let tangent_end = ny.mul(dx).sub(nx.mul(dy));
    let widen = Bound::exact(tangent_width)
        .add(negate(nx).mul(Bound::exact(core_width)))
        .hi;
    let span = Bound {
        lo: -widen,
        hi: widen,
    };
    let tangent = tangent_end.add(span).mul(Bound {
        lo: (1. / s2.hi).next_down(),
        hi: (1. / s2.lo).next_up(),
    });
    let lo = (tangent.lo as f32).max(-half.x);
    let hi = (tangent.hi as f32).min(half.x);
    if !lo.is_finite() || !hi.is_finite() || lo <= 0. || lo > hi {
        return Ok(Unknown);
    }

    // A close cap point must lie near the radial pole. Convexity gives
    // |offset + r*n/s|² <= 2*r*slack/s for a point in the disk.
    let radial_width = radius
        .mul(Bound::exact(2.))
        .mul(face_slack)
        .mul(Bound::exact((1. / s.lo).next_up()))
        .sqrt()
        .hi;
    let radial_scale = radius.mul(Bound {
        lo: (1. / s.hi).next_down(),
        hi: (1. / s.lo).next_up(),
    });
    let radial = |n: Bound| {
        negate(n.mul(radial_scale)).add(Bound {
            lo: -radial_width,
            hi: radial_width,
        })
    };
    let core_y = f(base).add(Bound {
        lo: 0.,
        hi: core_width,
    });
    let rounded = |b: Bound| Float::span(b.lo as f32, b.hi as f32);
    let cap_x = rounded(radial(nx)).add(Float::exact(cap.translation.x));
    let cap_y = rounded(core_y.add(radial(ny))).add(Float::exact(cap.translation.y));
    let depth = (slack / s2.lo).next_up();
    let face_y = rounded(f(half.y).add(Bound { lo: -depth, hi: 0. }));
    let strip = transform(
        Frame::exact(cube),
        [
            Value::input(Float::span(lo, hi)),
            Value::input(face_y),
            Value::input(Float::ZERO),
        ],
    );
    if strip.iter().any(|v| !v.finite())
        || !cap_x.finite()
        || !cap_y.finite()
        || cap_y.lo <= 0.
        || cap_y.hi >= cap.translation.y + base
        || cap_x.hi >= strip[0].actual.lo
        || cap_y.lo <= strip[1].actual.hi
    {
        return Ok(Unknown);
    }
    // Within the possible closest strip the rounded X/Y box outputs move
    // toward the cap as local Y increases. The cap X/Y outputs move toward
    // the box as core Y decreases, so retain only the two facing surfaces.
    let cap_y = rounded(f(base).add(radial(ny))).add(Float::exact(cap.translation.y));
    if !cap_y.finite() || cap_y.lo <= 0. {
        return Ok(Unknown);
    }
    let lower = cap_y.lo.to_bits();
    let upper = cap_y.hi.to_bits();
    let l = lo.to_bits();
    let h = hi.to_bits();
    const MAX_POINTS: u32 = 32768;
    if h - l > MAX_POINTS || upper - lower > MAX_POINTS {
        return Ok(Unknown);
    }
    let core = Point {
        x: cap.translation.x,
        y: cap.translation.y + base,
    };
    let exact_face = exact_face_differences(strip[0].actual, core.x)
        && exact_face_differences(strip[1].actual, core.y);
    // Direct dyadic squares and one directed dot extremum replace full
    // interval subtraction, multiplication, and projection for each point.
    let box_cost = if exact_face { 32 } else { 40 };
    work.charge(128 + u64::from(h - l + 1) * box_cost + u64::from(upper - lower + 1) * 40)?;

    let box_point = |i| {
        let p = cube * rp::Vector::new(f32::from_bits(i), half.y, 0.);
        Point { x: p.x, y: p.y }
    };
    let cap_point = |i| {
        let y = f32::from_bits(i);
        let (x, y_local) = radius_in_cell(y, cap.translation.y, base, r2)?;
        Some((
            Point {
                x: cap.translation.x + x,
                y,
            },
            x,
            y_local,
        ))
    };
    let mut box_upper = f64::NEG_INFINITY;
    let mut world_uncertain = false;
    let world_reach = radius.add(m);
    let world_reach_squared = world_reach.mul(world_reach).hi;
    for i in l..=h {
        let p = box_point(i);
        let world = if exact_face {
            exact_face_distance(p, core)
        } else {
            norm_squared(f(p.x).sub(f(core.x)), f(p.y).sub(f(core.y)))
        };
        if !world.finite() || world.lo <= world_reach_squared {
            world_uncertain = true;
            if cube.translation.z == cap.translation.z {
                let gap = world.sqrt().sub(radius);
                if let Some(contact) =
                    real_radius_contact(cube, cap, p, base, capsule.radius, gap, m)
                {
                    return Ok(Hit(contact));
                }
            }
        }
        let support = if exact_face {
            let x = (f64::from(p.x) * nx.hi).next_up();
            let y = (f64::from(p.y) * ny.hi).next_up();
            (x + y).next_up()
        } else {
            dot(p, nx, ny).hi
        };
        box_upper = box_upper.max(support);
    }
    // Build the support lower bound and collect the original near points
    // from the same rounded cap image. Validate every cap cell before either
    // using the candidates or entering the unchanged overflow search.
    const MAX_NEAR: usize = 64;
    let mut closest = [(Point { x: 0., y: 0. }, 0., 0.); MAX_NEAR];
    let mut found = 0;
    let mut overflow = false;
    let mut cap_lower = f64::INFINITY;
    let nmargin = m.mul(s);
    let search_limit = Bound::exact(box_upper).add(nmargin).hi;
    work.charge(64 + u64::from(upper - lower + 1) * 4)?;
    for i in lower..=upper {
        let Some((p, x, y)) = cap_point(i) else {
            return Ok(Unknown);
        };
        let support = dot(p, nx, ny).lo;
        cap_lower = cap_lower.min(support);
        if support <= search_limit && !overflow {
            if let Some(slot) = closest.get_mut(found) {
                *slot = (p, x, y);
                found += 1;
            } else {
                overflow = true;
            }
        }
    }
    if !world_uncertain && Bound::exact(cap_lower).sub(Bound::exact(box_upper)).lo > nmargin.hi {
        return Ok(Separated);
    }

    let dz = f(cube.translation.z).sub(f(cap.translation.z));
    let dz2 = if expanded_witness {
        dz.mul(dz)
    } else {
        Bound::exact(0.)
    };
    let witness = |(a, b): (Point, Point), x: f32, y: f32, sq: Bound| {
        let sq = sq.add(dz2);
        if (!expanded_witness && cube.translation.z != cap.translation.z)
            || !sq.finite()
            || sq.hi >= m2.lo
        {
            return None;
        }
        let y = if cap.translation.y + y == b.y {
            y
        } else {
            y.next_down()
        };
        if cap.translation.y + y != b.y {
            return None;
        }
        if ![x, x.next_down(), x.next_down().next_down()]
            .into_iter()
            .any(|x| cap.translation.x + x == b.x && contains_cap(x, y, base, r2))
        {
            return None;
        }
        let from = rp::Vector::new(a.x, a.y, cube.translation.z);
        let to = rp::Vector::new(b.x, b.y, cap.translation.z);
        // Response uses the original cuboid face normal. A small rounded
        // tangential difference between the two witness points carries no
        // independent geometric or impulse direction.
        let n = (cube.rotation * rp::Vector::Y).try_normalize()?;
        let distance = sq.sqrt().hi;
        let d = distance as f32;
        let d = if f64::from(d) < distance {
            d.next_up()
        } else {
            d
        };
        Some(Contact::new(from, to, n, -n, d))
    };
    let distance2 = |a: Point, b: Point| norm_squared(f(a.x).sub(f(b.x)), f(a.y).sub(f(b.y)));
    let separated_by_cap = |p: Point| Bound::exact(cap_lower).sub(dot(p, nx, ny)).lo > nmargin.hi;
    if overflow {
        let half_window = if expanded_witness { 64 } else { 4 };
        // The complete cap census already excludes box points farther than
        // the requested margin from its support plane. Keep the original
        // order for the exact cap witnesses of every remaining point.
        for i in (l..=h).step_by(if expanded_witness { 1 } else { 8 }) {
            work.charge(32)?;
            let a = box_point(i);
            if separated_by_cap(a) {
                continue;
            }
            work.charge(if half_window > 4 {
                48 + 36 * (2 * u64::from(half_window) + 1)
            } else {
                352
            })?;
            let dx = f64::from(a.x) - f64::from(core.x);
            let dy = f64::from(a.y) - f64::from(core.y);
            let guess = (f64::from(core.y) + f64::from(capsule.radius) * dy / dx.hypot(dy)) as f32;
            let bits = guess.to_bits();
            for j in bits.saturating_sub(half_window).max(lower)
                ..=bits.saturating_add(half_window).min(upper)
            {
                if let Some((b, x, y)) = cap_point(j) {
                    if let Some(contact) = witness((a, b), x, y, distance2(a, b)) {
                        return Ok(Hit(contact));
                    }
                }
            }
        }
        return Ok(Unknown);
    }
    work.charge(64 + u64::from(h - l + 1) * 24)?;
    let mut separation = !world_uncertain;
    for i in l..=h {
        let a = box_point(i);
        if separated_by_cap(a) {
            continue;
        }
        for &(b, x, y) in &closest[..found] {
            work.charge(64)?;
            let sq = distance2(a, b);
            if sq.lo > m2.hi {
                continue;
            }
            if let Some(contact) = witness((a, b), x, y, sq) {
                return Ok(Hit(contact));
            }
            separation = false;
        }
    }
    Ok(if separation { Separated } else { Unknown })
}

fn real_radius_contact(
    cube: rp::Pose,
    cap: rp::Pose,
    point: Point,
    base: f32,
    radius: f32,
    gap: Bound,
    margin: Bound,
) -> Option<Contact> {
    if !gap.finite() || gap.hi >= margin.lo {
        return None;
    }
    let core = cap * (rp::Vector::Y * base);
    let from = rp::Vector::new(point.x, point.y, cube.translation.z);
    let radial = (from - core).try_normalize()?;
    let normal = (cube.rotation * rp::Vector::Y).try_normalize()?;
    let r2 = f(radius).mul(f(radius)).lo;
    let to = [radius, radius.next_down(), radius.next_down().next_down()]
        .into_iter()
        .map(|r| core + radial * r)
        .find(|p| {
            let offset = p.to_array().into_iter().zip(core.to_array());
            let squared = offset.fold(Bound::exact(0.), |sum, (p, c)| {
                let d = f(p).sub(f(c));
                sum.add(d.mul(d))
            });
            squared.finite() && squared.hi <= r2
        })?;
    let dist = gap.hi as f32;
    let dist = if f64::from(dist) < gap.hi {
        dist.next_up()
    } else {
        dist
    };
    Some(Contact::new(from, to, normal, -normal, dist))
}
