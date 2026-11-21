//! Search nearby output cells for an actual point on a rounded spherical cap.
use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn witness(
    translation: rp::Vector,
    point: rp::Vector,
    radius: f32,
    normal: rp::Vector,
    limit: f64,
    accepts: impl Fn(rp::Vector) -> bool,
    work: &mut Work,
) -> Result<Option<rp::Vector>, TrajectoryError> {
    work.charge(256)?;
    let i = normal.abs().max_position();
    let (j, k) = ((i + 1) % 3, (i + 2) % 3);
    let sign = normal.signum();
    let n = normal.abs().as_dvec3();
    let length = n.length();
    let planar = n[j].hypot(n[k]);
    if !length.is_finite() || planar <= 0. || !radius.is_finite() || radius <= 0. {
        return Ok(None);
    }
    let base = translation * sign;
    let tip = point * sign;
    let r = f64::from(radius);
    let r2 = Bound::exact(r).mul(Bound::exact(r));
    let output = |axis: usize, offset: f64| base[axis] + (f64::from(tip[axis]) + offset) as f32;
    let inverse = |axis: usize, value: f32| cap_output_cell_start(value, base[axis], tip[axis]);
    let pole = output(i, r * n[i] / length);
    for first in [pole, pole.next_down(), pole.next_up()] {
        work.charge(256)?;
        let Some(a) = inverse(i, first) else { continue };
        if !a.finite() || a.lo <= 0. {
            continue;
        }
        let rest = r2.sub(a.mul(a));
        if rest.lo <= 0. {
            continue;
        }
        let next = output(j, rest.lo.sqrt() * n[j] / planar);
        for second in [next, next.next_down(), next.next_up()] {
            work.charge(128)?;
            let Some(b) = inverse(j, second) else {
                continue;
            };
            if !b.finite() || b.lo <= 0. {
                continue;
            }
            let remaining = rest.sub(b.mul(b));
            if remaining.lo <= 0. {
                continue;
            }
            let last = output(k, remaining.lo.sqrt());
            for third in [last, last.next_down()] {
                work.charge(128)?;
                let Some(c) = inverse(k, third) else { continue };
                if !c.finite() || c.lo <= 0. || a.mul(a).add(b.mul(b)).add(c.mul(c)).hi >= r2.lo {
                    continue;
                }
                // Each inverse bound encloses the lower edge of a nonempty
                // original RN cell. A strictly interior point of their product
                // lies in the real ball, even when a particular tie rounds out.
                let mut p = rp::Vector::ZERO;
                p[i] = sign[i] * first;
                p[j] = sign[j] * second;
                p[k] = sign[k] * third;
                if dot_value(p.to_array().map(|x| Bound::exact(f64::from(x))), normal).lo >= limit
                    && accepts(p)
                {
                    return Ok(Some(p));
                }
            }
        }
    }
    Ok(None)
}
