//! Signed XY axes point from the box toward the sphere. The caller bounds
//! every box point by p[i] <= corner[i] on both axes. Reflecting a coordinate
//! preserves ties-to-even, including when the original world axis is negative.
use super::{half_ulp, Bound, Float, TrajectoryError, Work};

fn exact(x: f32) -> Bound {
    Bound::exact(f64::from(x))
}

// Restrict the real local disk to the cap that could reach the corner's
// clearance. With u measured from the sphere center toward the box, a
// threatening rounded point satisfies n.u >= d - clearance - n.error.
// n is the unit vector along center - corner. The orthogonal component of u
// has absolute value at most sqrt(r² - (n.u)²).
fn possible_offsets(
    n: [Bound; 2],
    distance: Bound,
    clearance: f32,
    radius: f32,
    errors: [f64; 2],
) -> Option<[[f32; 2]; 2]> {
    let projected = n[0]
        .mul(Bound::exact(errors[0]))
        .add(n[1].mul(Bound::exact(errors[1])));
    let axial = distance.sub(exact(clearance)).sub(projected).lo.max(0.);
    if axial > f64::from(radius) {
        return None;
    }
    let axial = Bound::exact(axial);
    let r = exact(radius);
    let tangent = r.mul(r).sub(axial.mul(axial));
    let width = Bound {
        lo: 0.,
        hi: tangent.hi.max(0.),
    }
    .sqrt();
    Some(std::array::from_fn(|i| {
        let deviation = n[1 - i].mul(width);
        let lo = n[i].mul(axial).sub(deviation).lo.max(0.);
        let hi = n[i].mul(r).add(deviation).hi.min(r.hi);
        [lo as f32, hi as f32]
    }))
}

fn rounding_error(center: f32, radial: [f32; 2]) -> f64 {
    let local = half_ulp(Float::span(radial[0], radial[1]));
    if center == 0. {
        return local;
    }
    let world = Float::span(center - radial[0], center - radial[1]);
    Bound::exact(local).add(Bound::exact(half_ulp(world))).hi
}

fn ordered_bits(v: f32) -> u32 {
    let bits = v.to_bits();
    if v < 0. {
        0x8000_0000 - (bits & 0x7fff_ffff)
    } else {
        0x8000_0000 + (bits & 0x7fff_ffff)
    }
}

// Least real nonnegative local offset that may round to a world coordinate
// <= column. Inverting the world addition first and then the local rounding
// retains the dependence between these two cells. Including both endpoints
// of a tie can only enlarge the disk being tested.
fn minimum_offset(center: f32, column: f32) -> Option<f64> {
    if column >= center {
        return Some(0.);
    }
    let boundary = exact(column)
        .add(exact(column.next_up()))
        .mul(Bound::exact(0.5));
    let cutoff = exact(center).sub(boundary).lo;
    let mut local = cutoff.max(0.) as f32;
    if center - local > column {
        local = local.next_up();
    }
    if !local.is_finite() || center - local > column || center - local.next_down() <= column {
        return None;
    }
    Some(
        exact(local)
            .add(exact(local.next_down()))
            .mul(Bound::exact(0.5))
            .lo
            .max(0.),
    )
}

pub(super) fn sphere_clear(
    corner: [f32; 2],
    center: [f32; 2],
    radius: f32,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    const SETUP_WORK: u64 = 96;
    const MAX_COLUMNS: u32 = 256;
    if !radius.is_finite()
        || !clearance.is_finite()
        || radius < 0.
        || clearance < 0.
        || work.limit.saturating_sub(work.used) < SETUP_WORK
        || (0..2)
            .any(|i| !center[i].is_finite() || !corner[i].is_finite() || center[i] <= corner[i])
    {
        return Ok(false);
    }
    work.charge(SETUP_WORK)?;
    let delta = std::array::from_fn::<_, 2, _>(|i| exact(center[i]).sub(exact(corner[i])));
    let squared = delta[0].mul(delta[0]).add(delta[1].mul(delta[1]));
    let range = exact(radius).add(exact(clearance));
    // The real world-radius disk has an analytic minimum distance to this quadrant.
    if squared.lo <= range.mul(range).hi {
        return Ok(false);
    }
    let distance = squared.sqrt();
    let inverse = Bound {
        lo: (1. / distance.hi).next_down(),
        hi: (1. / distance.lo).next_up(),
    };
    let n = delta.map(|x| x.mul(inverse));
    // Reflection about the center only moves a positive local component closer
    // to the quadrant. It suffices to check the quadrant of local offsets >= 0.
    let mut offsets = [[0., radius]; 2];
    for _ in 0..2 {
        let errors = std::array::from_fn(|i| rounding_error(center[i], offsets[i]));
        if !errors.into_iter().all(f64::is_finite) {
            return Ok(false);
        }
        let Some(tighter) = possible_offsets(n, distance, clearance, radius, errors) else {
            return Ok(true);
        };
        offsets = tighter;
    }
    let world =
        std::array::from_fn::<_, 2, _>(|i| [center[i] - offsets[i][1], center[i] - offsets[i][0]]);
    if world.iter().flatten().any(|x| !x.is_finite()) {
        return Ok(false);
    }
    let spans = world.map(|[lo, hi]| ordered_bits(hi).saturating_sub(ordered_bits(lo)));
    let x = usize::from(spans[1] < spans[0]);
    let y = 1 - x;
    let count = spans[x].saturating_add(1);
    if count > MAX_COLUMNS || u64::from(count) * 24 > work.limit.saturating_sub(work.used) {
        return Ok(false);
    }
    let r2 = exact(radius).mul(exact(radius));
    let c2 = exact(clearance).mul(exact(clearance));
    let mut column = world[x][0];
    for _ in 0..count {
        work.charge(24)?;
        let Some(ux) = minimum_offset(center[x], column) else {
            return Ok(false);
        };
        let ux = Bound::exact(ux);
        let remaining = r2.sub(ux.mul(ux));
        if remaining.hi >= 0. {
            let uy = Bound {
                lo: 0.,
                hi: remaining.hi,
            }
            .sqrt()
            .hi as f32;
            let closest_y = center[y] - uy;
            let dx = Bound::exact(exact(column).sub(exact(corner[x])).lo.max(0.));
            let dy = Bound::exact(exact(closest_y).sub(exact(corner[y])).lo.max(0.));
            if dx.mul(dx).add(dy.mul(dy)).lo <= c2.hi {
                return Ok(false);
            }
        }
        column = column.next_up();
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grazing_sphere_and_neighbors_keep_both_disk_laws() {
        // Third SDK tick at the corner nearest the signed face.
        let corner = [0xbca3_cc57, 0x3ffe_a984].map(f32::from_bits);
        let center = [0., 1.99];
        let mut work = Work {
            used: 0,
            limit: 20_000,
        };
        assert!(sphere_clear(corner, center, 0.015, 0.005, &mut work).unwrap());
        assert!(sphere_clear(
            [corner[1], corner[0]],
            [center[1], center[0]],
            0.015,
            0.005,
            &mut work
        )
        .unwrap());
        assert!(!sphere_clear(
            [corner[0].next_up(), corner[1]],
            center,
            0.015,
            0.005,
            &mut work
        )
        .unwrap());
        assert!(!sphere_clear(
            [corner[0], corner[1].next_up()],
            center,
            0.015,
            0.005,
            &mut work
        )
        .unwrap());
        // This cap overlaps the continuous error enclosure. Comparing the
        // actual output columns certifies the smaller positive clearance.
        let cell_corner = [0xbca3_cc11, 0x3ffe_a954].map(f32::from_bits);
        let mut capped = Work { used: 0, limit: 96 };
        assert!(!sphere_clear(cell_corner, center, 0.015, 0.005, &mut capped).unwrap());
        assert!(sphere_clear(cell_corner, center, 0.015, 0.005, &mut work).unwrap());
    }

    #[test]
    fn world_disk_touch_and_invalid_quadrant_are_never_separated() {
        let mut work = Work {
            used: 0,
            limit: 2000,
        };
        assert!(!sphere_clear([0., 0.], [3., 4.], 4., 1., &mut work).unwrap());
        assert!(sphere_clear([0., 0.], [3., 4.], 3., 1., &mut work).unwrap());
        assert!(!sphere_clear([0., 1.], [3., 0.], 1., 0., &mut work).unwrap());
    }
}
