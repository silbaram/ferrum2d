//! Prove separation using the original represented points of a planar box face.
use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    frame: Frame,
    sphere: Frame,
    radius: f32,
    margin: f32,
    extents: rp::Vector,
    face: usize,
    tangent: usize,
    sign: f32,
    orientation: f32,
    tangent_points: Float,
    diagonal: Float,
    spin: Float,
    twice_w: Float,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if margin <= 0.
        || ![diagonal, spin, twice_w].into_iter().all(singleton)
        || !sphere.translation.into_iter().all(singleton)
        || !tangent_points.finite()
    {
        return Ok(false);
    }
    let d = diagonal.lo;
    let q = spin.lo;
    let w2 = twice_w.lo;
    let side = extents[face] * sign;
    let signed = [(sign * d).signum(), (sign * orientation * q * w2).signum()];
    if d == 0. || q == 0. || w2 == 0. {
        return Ok(false);
    }
    let ids = [face, tangent];
    let centers = std::array::from_fn::<_, 2, _>(|i| sphere.translation[ids[i]].lo * signed[i]);
    let translate = std::array::from_fn::<_, 2, _>(|i| {
        let t = frame.translation[ids[i]];
        if signed[i] > 0. {
            t.hi
        } else {
            t.lo
        }
    });
    let toward = Float::span(-radius, 0.);
    let offsets = Value {
        error: half_ulp(toward),
        ..Value::input(toward)
    };
    // Reflecting a positive local coordinate across the sphere center only
    // moves its output toward the signed box quadrant in that coordinate.
    let error = centers.map(|center| offsets.add(Value::input(Float::exact(center))).error);
    let radius_and_margin = Bound::exact(f64::from(radius)).add(Bound::exact(f64::from(margin)));
    let threshold = radius_and_margin.mul(radius_and_margin);
    // Both coordinates move monotonically toward this signed face as its local
    // normal coordinate advances. The farthest coordinate on either side of
    // a tangent interval is therefore attained at one of its two face corners.
    let point = |along: f32| {
        let x = (side * d - ((along * q) * orientation) * w2) + translate[0];
        let y = (along * d + ((side * q) * orientation) * w2) + translate[1];
        [x * signed[0], y * signed[1]]
    };
    let middle = ((f64::from(tangent_points.lo) + f64::from(tangent_points.hi)) * 0.5) as f32;
    let p = point(middle);
    let dx = f64::from(centers[0]) - f64::from(p[0]);
    let dy = f64::from(centers[1]) - f64::from(p[1]);
    if dx.max(0.).hypot(dy.max(0.)) <= f64::from(radius) + f64::from(margin) {
        return Ok(false);
    }
    let mut stack = [Float::ZERO; 32];
    stack[0] = tangent_points;
    let mut count = 1;
    for _ in 0..4096 {
        work.charge(64)?;
        count -= 1;
        let along = stack[count];
        let lo = point(along.lo);
        let hi = point(along.hi);
        let corner = [lo[0].max(hi[0]), lo[1].max(hi[1])];
        if corner
            .into_iter()
            .chain(lo)
            .chain(hi)
            .any(|x| !x.is_finite())
        {
            return Ok(false);
        }
        let gap = std::array::from_fn::<_, 2, _>(|i| {
            let gap = Bound::exact(f64::from(centers[i]))
                .sub(Bound::exact(f64::from(corner[i])))
                .sub(Bound::exact(error[i]));
            Bound::exact(gap.lo.max(0.))
        });
        let distance = gap[0].mul(gap[0]).add(gap[1].mul(gap[1]));
        if distance.lo <= threshold.hi {
            let mid = ((f64::from(along.lo) + f64::from(along.hi)) * 0.5) as f32;
            let split = mid.min(along.hi.next_down()).max(along.lo);
            if along.lo < along.hi && split < along.hi && count + 2 <= stack.len() {
                stack[count] = Float::span(split.next_up(), along.hi);
                stack[count + 1] = Float::span(along.lo, split);
                count += 2;
                continue;
            }
            if !super::sphere_cells::sphere_clear(corner, centers, radius, margin, work)? {
                return Ok(false);
            }
        }
        if count == 0 {
            return Ok(true);
        }
    }
    Ok(false)
}
