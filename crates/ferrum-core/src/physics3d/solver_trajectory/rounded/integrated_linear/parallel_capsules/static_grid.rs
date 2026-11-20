//! Exclude every possible rounded point difference in a close, finite, static
//! capsule cell. The transverse disk is exact because the accepted core lies
//! on the other axis. All coordinate ranges widen the actual F32 image.
use super::*;

fn interval(value: [f32; 2]) -> Option<f64> {
    if value[0].is_normal()
        && value[1].is_normal()
        && value[0].is_sign_negative() == value[1].is_sign_negative()
        && grid(value[0]) == grid(value[1])
    {
        Some(2_f64.powi(grid(value[0])))
    } else {
        None
    }
}

fn grid_keys(bounds: [f64; 2], step: f64, cap: i64) -> Option<std::ops::RangeInclusive<i64>> {
    let lo = (bounds[0] / step).ceil();
    let hi = (bounds[1] / step).floor();
    if !lo.is_finite() || !hi.is_finite() || lo.abs().max(hi.abs()) > f64::from(i32::MAX) {
        return None;
    }
    let [lo, hi] = [lo as i64, hi as i64];
    (hi - lo < cap).then_some(lo..=hi)
}

/// Minimum magnitude of an ideal coordinate that can round to `world`
/// through the original local and world translations. Endpoint ties remain
/// included. The inverse is a nominee until the neighboring output excludes
/// an earlier F32 preimage under the same monotone original addition.
fn local_lower(origin: f32, world: f32) -> Option<f64> {
    if world == origin {
        return Some(0.);
    }
    let sign = if world > origin { 1. } else { -1. };
    let [origin, world] = [sign * origin, sign * world];
    let boundary = (f64::from(world) + f64::from(world.next_down())) * 0.5;
    let mut local = (boundary - f64::from(origin)) as f32;
    if origin + local < world {
        local = local.next_up();
    }
    let before = local.next_down();
    if !local.is_finite() || origin + local != world || origin + before >= world {
        return None;
    }
    // Adjacent F32 values have an exactly representable F64 midpoint.
    Some((f64::from(local).abs() + f64::from(before).abs()) * 0.5)
}

fn free_axis_range(center: [f32; 2], radius: f32, world: f32) -> Option<[f32; 2]> {
    let nearest = local_lower(center[0], world)?;
    let nearest = Bound::exact(nearest);
    let r = Bound::exact(f64::from(radius));
    let left = r.mul(r).sub(nearest.mul(nearest));
    // An empty transverse disk slice cannot contribute. An unproved
    // preimage on the other hand exits the candidate at the caller.
    if left.hi < 0. {
        return Some([f32::INFINITY, f32::NEG_INFINITY]);
    }
    let outer = Bound::exact(left.hi.max(0.)).sqrt().hi as f32;
    Some([center[1] - outer, center[1] + outer])
}

/// For a nominated world difference, lower the four true signed radial
/// offsets by the maximum of their admitted output rounding errors. The
/// resulting two nonnegative vectors are still in their original disks and
/// have a fixed sum. Their intersection narrows the integer X search.
fn lens_x(
    centers: [[f32; 2]; 2],
    errors: [[f64; 2]; 2],
    difference: [Bound; 2],
    radii: [f32; 2],
) -> [f64; 2] {
    let total = std::array::from_fn(|i| {
        Bound::exact(f64::from(centers[1][i]))
            .sub(Bound::exact(f64::from(centers[0][i])))
            .sub(difference[i])
            .sub(Bound::exact(errors[0][i]))
            .sub(Bound::exact(errors[1][i]))
    });
    let len = dot(total, total).sqrt();
    let [ra, rb] = radii.map(f64::from);
    let projection = len.sub(Bound::exact(rb)).lo;
    if projection > ra {
        return [f64::INFINITY, f64::NEG_INFINITY];
    }
    if projection <= 0. || len.lo <= 0. {
        return [f64::NEG_INFINITY, f64::INFINITY];
    }
    let r = Bound::exact(ra);
    let t = Bound::exact(projection);
    let tangent = Bound::exact(r.mul(r).sub(t.mul(t)).hi.max(0.)).sqrt();
    let reciprocal = Bound {
        lo: (1. / len.hi).next_down(),
        hi: (1. / len.lo).next_up(),
    };
    let x_axis = total[0].mul(reciprocal);
    let z_axis = total[1].mul(reciprocal);
    let tangential = tangent
        .mul(Bound::exact(z_axis.lo.abs().max(z_axis.hi.abs())))
        .hi;
    let x = Bound {
        lo: projection,
        hi: ra,
    }
    .mul(x_axis)
    .add(Bound {
        lo: -tangential,
        hi: tangential,
    })
    .add(Bound::exact(f64::from(centers[0][0])))
    .add(Bound::exact(errors[0][0]));
    [x.lo, x.hi]
}

pub(super) fn separated(
    poses: [super::super::rp::Vector; 2],
    mut axes: [usize; 2],
    radii: [f32; 2],
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(768)?;
    let span = |axis: usize| f64::from(poses[1][axis]) - f64::from(poses[0][axis]);
    if span(axes[0]).abs() < span(axes[1]).abs() {
        axes.swap(0, 1);
    }
    let signs = axes.map(|i| if span(i) < 0. { -1. } else { 1. });
    // Nearest-even is odd under reflection. The signs only keep all
    // projection coordinates positive for the two signed lattice ranges.
    let centers = poses.map(|p| std::array::from_fn(|j| p[axes[j]] * signs[j]));
    let direction = std::array::from_fn(|j| Bound::exact(span(axes[j]).abs()));
    if direction[1].lo <= 0. {
        return Ok(false);
    }
    let delta = std::array::from_fn(|j| {
        Bound::exact(f64::from(centers[1][j])).sub(Bound::exact(f64::from(centers[0][j])))
    });
    let norm = dot(direction, direction).sqrt();
    let gap = dot(delta, direction).sub(
        Bound::exact(f64::from(radii[0]))
            .add(Bound::exact(f64::from(radii[1])))
            .mul(norm),
    );
    let margin = Bound::exact(f64::from(clearance));
    let target = margin.mul(norm);
    // Also independently verify clearance of the original real world radii.
    if !norm.finite() || norm.lo <= 0. || gap.lo <= target.hi {
        return Ok(false);
    }
    let cap_width = |radius: f64, slack: f64| {
        let square = Bound::exact(2. * radius).mul(Bound::exact(slack.max(0.)));
        Bound::exact((square.hi / norm.lo).next_up()).sqrt().hi
    };
    let pole = |radius: f64, value: Bound| {
        Bound {
            lo: (radius / norm.hi).next_down(),
            hi: (radius / norm.lo).next_up(),
        }
        .mul(value)
    };
    let mut lower = gap.lo;
    let mut total_slack = 0.;
    let mut ranges = [[[0.; 2]; 2]; 2];
    let mut errors = [[0.; 2]; 2];
    for round in 0..3 {
        work.charge(384)?;
        let mut error = Bound::exact(0.);
        for i in 0..2 {
            let radius = f64::from(radii[i]);
            let width = if round == 0 {
                2. * radius
            } else {
                cap_width(radius, total_slack)
            };
            let r0 = radii[i].next_down();
            let Some(global_local) = half_ulp([-r0, r0]) else {
                return Ok(false);
            };
            for j in 0..2 {
                let dir = if i == 0 {
                    direction[j]
                } else {
                    Bound::exact(-direction[j].lo)
                };
                let u = pole(radius, dir);
                let limits = [
                    (u.lo - width).next_down().max(-radius) as f32,
                    (u.hi + width).next_up().min(radius) as f32,
                ];
                let world = limits.map(|x| centers[i][j] + x);
                let (Some(local), Some(translated)) = (half_ulp(limits), half_ulp(world)) else {
                    return Ok(false);
                };
                errors[i][j] = up_add(global_local.min(local), translated);
                error = error.add(direction[j].mul(Bound::exact(errors[i][j])));
                ranges[i][j] = world;
            }
        }
        lower = gap.sub(error).lo;
        total_slack = target.sub(Bound::exact(lower)).hi;
        if total_slack < 0. {
            return Ok(true);
        }
    }
    let [Some(ax), Some(az), Some(bx), Some(bz)] =
        [ranges[0][0], ranges[0][1], ranges[1][0], ranges[1][1]].map(interval)
    else {
        return Ok(false);
    };
    let [dx, dz] = [ax.min(bx), az.min(bz)];
    let u = pole(f64::from(clearance), direction[0]);
    let width = cap_width(f64::from(clearance), total_slack);
    let Some(x_keys) = grid_keys(
        [(u.lo - width).next_down(), (u.hi + width).next_up()],
        dx,
        512,
    ) else {
        return Ok(false);
    };
    let a_range = ranges[0][0].map(f64::from);
    let lens_eligible = (0..2).all(|j| {
        Bound::exact(f64::from(ranges[0][j][0]))
            .sub(Bound::exact(f64::from(centers[0][j])))
            .lo
            > errors[0][j]
            && Bound::exact(f64::from(centers[1][j]))
                .sub(Bound::exact(f64::from(ranges[1][j][1])))
                .lo
                > errors[1][j]
    });
    let mut candidates = 0;
    for key in x_keys {
        work.charge(64)?;
        let x = Bound::exact(key as f64 * dx);
        let remaining = margin.mul(margin).sub(x.mul(x)).hi;
        if remaining < 0. {
            continue;
        }
        let z_lower =
            (Bound::exact(lower).sub(direction[0].mul(x)).lo / direction[1].lo).next_down();
        let z_upper = Bound::exact(remaining).sqrt().hi;
        let Some(z_keys) = grid_keys([z_lower.max(-z_upper), z_upper], dz, 16) else {
            return Ok(false);
        };
        for key in z_keys {
            candidates += 1;
            if candidates > 16 {
                return Ok(false);
            }
            let shift = key as f64 * dz;
            let lens = if lens_eligible {
                work.charge(128)?;
                lens_x(centers, errors, [x, Bound::exact(shift)], radii)
            } else {
                a_range
            };
            let a_bounds = [a_range[0].max(lens[0]), a_range[1].min(lens[1])];
            if a_bounds[0] > a_bounds[1] {
                continue;
            }
            let Some(a_keys) = grid_keys(a_bounds, ax, 2048) else {
                return Ok(false);
            };
            for key in a_keys {
                work.charge(64)?;
                let a = (key as f64 * ax) as f32;
                let b = (f64::from(a) + x.lo) as f32;
                if b < ranges[1][0][0] || b > ranges[1][0][1] || f64::from(b) - f64::from(a) != x.lo
                {
                    continue;
                }
                let (Some(a), Some(b)) = (
                    free_axis_range(centers[0], radii[0], a),
                    free_axis_range(centers[1], radii[1], b),
                ) else {
                    return Ok(false);
                };
                if a[0] > a[1] || b[0] > b[1] {
                    continue;
                }
                let [lo, hi] = b.map(|v| Bound::exact(f64::from(v)).sub(Bound::exact(shift)));
                if f64::from(a[0]) <= hi.hi && f64::from(a[1]) >= lo.lo {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rapier3d::prelude as rp;

    #[test]
    fn recorded_peer_cell_separates_before_the_next_rounded_shape_state() {
        let a = rp::Vector::from_array([0x3f570dd2, 0x3f42955a, 0x3fa7ac5c].map(f32::from_bits));
        let b = rp::Vector::from_array([0x3facbdd4, 0x3f4294f8, 0x3faa98c4].map(f32::from_bits));
        let mut work = Work {
            used: 0,
            limit: 32 * 1024,
        };
        // This exact output is less than 1nm clear in the rounded graph,
        // even though the analytic projection alone cannot separate it.
        assert!(separated([a, b], [0, 2], [0.25; 2], 0.01, &mut work).unwrap());
        let nearer = rp::Vector::new(b.x, b.y, b.z.next_down());
        assert!(!separated([a, nearer], [0, 2], [0.25; 2], 0.01, &mut work).unwrap());
    }
}
