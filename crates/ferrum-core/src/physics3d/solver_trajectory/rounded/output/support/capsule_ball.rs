//! Limit rounded support errors to points near the pole of a round shape.
use super::*;

fn projection(values: [Bound; 3], direction: rp::Vector) -> Bound {
    values
        .into_iter()
        .zip(direction.to_array())
        .fold(Bound::exact(0.), |sum, (x, n)| {
            sum.add(x.mul(Bound::exact(f64::from(n))))
        })
}

fn projected_error(values: [Value; 3], direction: rp::Vector) -> Option<f64> {
    if values.iter().any(|value| !value.finite()) {
        return None;
    }
    Some(
        values
            .into_iter()
            .zip(direction.to_array())
            .fold(0., |sum, (x, n)| {
                upper_add(sum, upper_mul(x.error, f64::from(n).abs()))
            }),
    )
}

fn span(lo: f64, hi: f64) -> Bound {
    Bound { lo, hi }
}

fn rounded_input(ideal: Bound) -> Value {
    let actual = Float::span(ideal.lo as f32, ideal.hi as f32);
    Value {
        actual,
        ideal,
        error: half_ulp(actual),
    }
}

// For unit n and |u| <= r, n·u <= r - |u-r*n|²/(2*r).
// Outside the coordinate cap, the resulting projection deficit must
// cover the complete original rounding error before it can be omitted.
fn radial_cap(n: [Bound; 3], length: Bound, radius: f32, error: f64) -> Option<[Bound; 3]> {
    let r = f64::from(radius);
    let width = r / 32.;
    if !length.finite()
        || length.lo <= 0.
        || (Bound::exact(width)
            .mul(Bound::exact(width))
            .mul(length)
            .mul(Bound::exact((0.5 / r).next_down())))
        .lo < error
    {
        return None;
    }
    let scale = span((r / length.hi).next_down(), (r / length.lo).next_up());
    Some(n.map(|component| component.mul(scale).add(span(-width, width))))
}

/// Maximum projection of a complete round shape, for both original radius paths.
pub(super) fn rounded_support(
    frame: Frame,
    points: [rp::Vector; 2],
    radius: f32,
    n: rp::Vector,
) -> Option<f64> {
    support(frame, points, radius, n, false)
}

/// Reach from the represented COM. The final translation still participates
/// in every rounded output bound on both the local and world radius paths.
pub(super) fn centered_support(
    frame: Frame,
    points: [rp::Vector; 2],
    radius: f32,
    n: rp::Vector,
) -> Option<f64> {
    support(frame, points, radius, n, true)
}

fn support(
    frame: Frame,
    points: [rp::Vector; 2],
    radius: f32,
    n: rp::Vector,
    centered: bool,
) -> Option<f64> {
    if radius <= 0. || !radius.is_finite() || points.iter().any(|point| !point.is_finite()) {
        return None;
    }
    let rotation = Frame {
        translation: [Float::ZERO; 3],
        ..frame
    };
    let linear = IdealTransform::new(rotation);
    let ideal = if centered {
        &linear
    } else {
        &IdealTransform::new(frame)
    };
    let local_n =
        [rp::Vector::X, rp::Vector::Y, rp::Vector::Z].map(|axis| projection(linear.point(axis), n));
    let length = super::super::super::dot(n, n).sqrt();
    // The represented quaternion acts by a scaled orthogonal map.
    let mut q2 = Bound::exact(0.);
    for value in ideal.q {
        q2 = q2.add(value.mul(value));
    }
    let local_length = length.mul(q2);
    let base = points
        .into_iter()
        .map(|point| projection(ideal.point(point), n).hi)
        .fold(f64::NEG_INFINITY, f64::max);
    let norm = n.to_array().map(|x| Bound::exact(f64::from(x)));
    let whole_local = projected_error(transform(frame, local_hull(&points, radius)), n)?;
    let whole_world = projected_error(
        transform(frame, local_hull(&points, 0.)).map(|value| value.add(Value::local(0., radius))),
        n,
    )?;
    let width = f64::from(radius) / 32.;
    let mut core = local_hull(&points, 0.).map(|x| x.ideal);
    let varying = (0..3).filter(|&i| points[0][i] != points[1][i]).count();
    if varying == 1 {
        let i = (0..3).find(|&i| points[0][i] != points[1][i])?;
        let min = f64::from(points[0][i].min(points[1][i]));
        let max = f64::from(points[0][i].max(points[1][i]));
        let e = whole_local.max(whole_world);
        if Bound::exact(width).mul(local_n[i]).lo > e {
            core[i].lo = core[i].lo.max((max - width).next_down());
        } else if Bound::exact(width).mul(negate(local_n[i])).lo > e {
            core[i].hi = core[i].hi.min((min + width).next_up());
        }
    }
    let local = radial_cap(local_n, local_length, radius, whole_local)
        .and_then(|cap| {
            let limits = std::array::from_fn(|i| rounded_input(core[i].add(cap[i])));
            projected_error(transform(frame, limits), n)
        })
        .unwrap_or(whole_local);
    let world = radial_cap(norm, length, radius, whole_world)
        .and_then(|cap| {
            let limits = core.map(|x| Value::input(Float::span(x.lo as f32, x.hi as f32)));
            let c = transform(frame, limits);
            projected_error(std::array::from_fn(|i| c[i].add(rounded_input(cap[i]))), n)
        })
        .unwrap_or(whole_world);
    let r = Bound::exact(f64::from(radius));
    let local = r.mul(local_length).add(Bound::exact(local)).hi;
    let world = r.mul(length).add(Bound::exact(world)).hi;
    let result = (base + local.max(world)).next_up();
    result.is_finite().then_some(result)
}

pub(in crate::physics3d::solver_trajectory::rounded::output) fn separated(
    capsule_frames: &Frames,
    capsule: &rp::Capsule,
    ball_frames: &Frames,
    ball: &rp::Ball,
    normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if capsule_frames.len == 0 || ball_frames.len == 0 || !normal.is_finite() {
        return Ok(false);
    }
    work.charge(4096 + (capsule_frames.len + ball_frames.len) as u64 * 64)?;
    let normal_length = super::super::super::dot(normal, normal).sqrt();
    let Some(a) = rounded_support(
        union(capsule_frames),
        [capsule.segment.a, capsule.segment.b],
        capsule.radius,
        normal,
    ) else {
        return Ok(false);
    };
    let Some(b) = rounded_support(
        union(ball_frames),
        [rp::Vector::ZERO; 2],
        ball.radius,
        -normal,
    ) else {
        return Ok(false);
    };
    Ok(Bound::exact(-b)
        .sub(Bound::exact(a))
        .sub(Bound::exact(f64::from(clearance)).mul(normal_length))
        .lo
        > 0.)
}

/// Separate the full capsule on one fixed world axis from every original
/// polyhedron vertex. Both local and world radius paths remain enclosed.
pub(in crate::physics3d::solver_trajectory::rounded::output) fn polyhedron_separated(
    cap_frames: &Frames,
    capsule: &rp::Capsule,
    poly_frames: &Frames,
    points: &[rp::Vector],
    normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if cap_frames.len == 0 || poly_frames.len == 0 || points.is_empty() {
        return Ok(false);
    }
    work.charge(4096 + cap_frames.len as u64 * 64)?;
    let Some(cap_upper) = rounded_support(
        union(cap_frames),
        [capsule.segment.a, capsule.segment.b],
        capsule.radius,
        normal,
    ) else {
        return Ok(false);
    };
    let required = Bound::exact(cap_upper).add(
        Bound::exact(f64::from(clearance)).mul(super::super::super::dot(normal, normal).sqrt()),
    );
    for frame in &poly_frames.values[..poly_frames.len] {
        for &point in points {
            work.charge(128)?;
            let Some(p) = project(frame.point(point), normal) else {
                return Ok(false);
            };
            if p.lo <= required.hi {
                return Ok(false);
            }
        }
    }
    Ok(required.finite())
}
