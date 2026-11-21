//! Inclined supporting plane when the axial core intervals start disjoint.
use super::{half_ulp, up_add, Bound, ParallelSource, ToiProxy, TrajectoryError, Work};

fn extent(proxy: &ToiProxy<'_>, i: usize) -> [f32; 2] {
    let a = proxy.points()[0][i];
    let b = proxy.points()[1][i];
    [a.min(b), a.max(b)]
}

// World radius expands a transformed core. The local graph rounds its radial
// offset and local sum before translating it. Enclose both graphs, using the
// extrema of all possible core coordinates, radial offsets and translations.
fn support_error(source: ParallelSource, proxy: &ToiProxy<'_>, i: usize) -> Option<f64> {
    let [lo, hi] = extent(proxy, i);
    let radius = proxy.radius;
    let local = [lo - radius, hi + radius];
    let [x, y] = source.com.map(|v| v[i]);
    let output = [x.min(y) + local[0], x.max(y) + local[1]];
    let world_core = [x.min(y) + lo, x.max(y) + hi];
    let world_output = [world_core[0] - radius, world_core[1] + radius];
    let local_error = up_add(half_ulp(local)?, half_ulp(output)?);
    let world_error = up_add(half_ulp(world_core)?, half_ulp(world_output)?);
    Some(up_add(
        half_ulp([-radius, radius])?,
        local_error.max(world_error),
    ))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    a: ParallelSource,
    pa: &ToiProxy<'_>,
    b: ParallelSource,
    pb: &ToiProxy<'_>,
    axis: usize,
    dt: [f32; 2],
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let exact = |value: f32| Bound::exact(f64::from(value));
    let [a_lo, a_hi] = extent(pa, axis);
    let [b_lo, b_hi] = extent(pb, axis);
    let mut direction: [f64; 3] =
        std::array::from_fn(|i| f64::from(b.com[0][i]) - f64::from(a.com[0][i]));
    let above = direction[axis] + f64::from(b_lo) - f64::from(a_hi);
    let below = direction[axis] + f64::from(b_hi) - f64::from(a_lo);
    let (a_tip, b_tip) = if above > 0. {
        direction[axis] = above;
        (a_hi, b_lo)
    } else if below < 0. {
        direction[axis] = below;
        (a_lo, b_hi)
    } else {
        return Ok(false);
    };

    // The initially closest core endpoints only nominate the normal. Their
    // signed extrema along this fixed plane remain valid at every time. Use
    // a single Native delta for the relative rate before enclosing RN32.
    work.charge(1024)?;
    let mut gap = Bound::exact(0.);
    let mut rate = Bound::exact(0.);
    let mut norm_squared = Bound::exact(0.);
    let mut error = Bound::exact(0.);
    for (i, component) in direction.into_iter().enumerate() {
        let n = Bound::exact(component);
        let mut origin = b.origin(i).sub(a.origin(i));
        if i == axis {
            origin = origin.add(exact(b_tip).sub(exact(a_tip)));
        }
        gap = gap.add(origin.mul(n));
        rate = rate.add(
            exact(b.base.velocity[i])
                .sub(exact(a.base.velocity[i]))
                .mul(n),
        );
        norm_squared = norm_squared.add(n.mul(n));
        for (source, proxy) in [(a, pa), (b, pb)] {
            let (Some(translation), Some(support)) = (
                source.translation_error(i, dt),
                support_error(source, proxy, i),
            ) else {
                return Ok(false);
            };
            error = error
                .add(Bound::exact(up_add(translation, support)).mul(Bound::exact(component.abs())));
        }
    }
    let gap = gap
        .add(rate.mul(Bound {
            lo: f64::from(dt[0]),
            hi: f64::from(dt[1]),
        }))
        .sub(error);
    let target = exact(pa.radius)
        .add(exact(pb.radius))
        .add(exact(clearance))
        .mul(norm_squared.sqrt());
    Ok(gap.finite() && target.finite() && gap.lo > target.hi)
}
