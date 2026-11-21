//! A shared rounded velocity product bounds both support graphs when their
//! additions stay on compatible binary grids.
use super::{grid, quantum, same_clock, Bound, Source, TrajectoryError, Work};

fn aligned(value: f32, exponent: i32) -> bool {
    value == 0. || quantum(value).is_some_and(|q| q >= exponent)
}

// Every multiple of the given step with at most 24 significant bits,
// including the exact upper power-of-two boundary, is representable.
fn grid_contains(values: Bound, exponent: i32) -> bool {
    let limit = 2_f64.powi(exponent + 24).min(f64::from(f32::MAX));
    values.finite() && values.lo >= -limit && values.hi <= limit
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    a: Source,
    b: Source,
    axis: usize,
    sign: f32,
    point_a: f32,
    point_b: f32,
    radius_a: f32,
    radius_b: f32,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    // Work in +world-axis order. The caller has qualified the two original
    // qI transforms and their endpoint translation identities.
    let ((trailing, tp, tr), (leading, lp, lr)) = if sign > 0. {
        ((a, point_a, radius_a), (b, point_b, radius_b))
    } else {
        ((b, point_b, radius_b), (a, point_a, radius_a))
    };
    let origin = trailing.origin[axis];
    let velocity = leading.velocity[axis];
    let (Some(trailing_clock), Some(leading_clock)) = (trailing.clock, leading.clock) else {
        return Ok(false);
    };
    if !same_clock(trailing_clock, leading_clock)
        || leading.origin[axis] != 0.
        || !origin.is_normal()
        || origin >= 0.
        || velocity <= 0.
        || velocity.to_bits() != trailing.velocity[axis].to_bits()
    {
        return Ok(false);
    }
    let g = grid(origin);
    if !trailing
        .com
        .iter()
        .all(|c| c[axis].is_sign_negative() && c[axis].is_normal() && grid(c[axis]) == g)
    {
        return Ok(false);
    }
    work.charge(512)?;
    let unit = 2_f64.powi(g - 1);
    // Sterbenz subtraction on the original coarse binade gives the exact
    // represented displacement D. Both clocks produce the same F32 product p.
    // In this binade RN(origin+p)=origin+D implies p >= D-unit. Admit the
    // half-step tie as well as the ordinary interior of that rounding cell.
    let displacement = trailing.com.map(|v| f64::from(v[axis]) - f64::from(origin));
    let shifts = Bound {
        lo: displacement[0],
        hi: displacement[1],
    };
    if shifts.lo < 0. || shifts.hi < shifts.lo {
        return Ok(false);
    }
    let trailing_local = tp + tr;
    let leading_local = lp - lr;
    let f = |x| Bound::exact(f64::from(x));
    for (trailing_point, leading_point) in [(tp, lp), (trailing_local, leading_local)] {
        // The trailing addition is exact on its coarse grid over the whole
        // interval, including the local-pole addition when radius is nonzero.
        if !aligned(trailing_point, g)
            || !grid_contains(f(origin).add(shifts).add(f(trailing_point)), g)
        {
            return Ok(false);
        }
        if shifts.hi > 0. {
            // For D>0, p_lower=D-unit is a positive multiple of unit.
            // Its sum with the exact leading coordinate is representable.
            // Monotonic RN therefore preserves this lower support bound for
            // every actual p>=p_lower. For D=0, the original p>=0 suffices.
            let positive_floor = Bound {
                lo: unit,
                hi: shifts.hi - unit,
            };
            if !aligned(leading_point, g - 1)
                || !grid_contains(f(leading_point).add(positive_floor), g - 1)
            {
                return Ok(false);
            }
        }
    }
    // The same D cancels from the two exact support bounds. Compare both
    // the original real world radius and the original rounded local poles.
    let translation = f(origin).add(Bound::exact(unit));
    let world = f(lp).sub(f(tp)).sub(f(tr)).sub(f(lr)).sub(translation);
    let local = f(leading_local).sub(f(trailing_local)).sub(translation);
    Ok(world.finite()
        && local.finite()
        && world.lo > f64::from(clearance)
        && local.lo > f64::from(clearance))
}
