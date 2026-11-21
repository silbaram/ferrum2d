//! First closing contact of two monotone, axis-aligned support coordinates on
//! one Native F32 clock. Within a binade, translating a rounding threshold by
//! two grid steps preserves ties-to-even. A family of translated thresholds
//! can therefore be searched as two integer inequalities on the time index.
use super::{grid, same_clock, Source, Time, TrajectoryError, Work};

#[derive(Clone, Copy)]
struct Support {
    origin: f32,
    rate: f32,
    pole: f32,
}
impl Support {
    fn at(self, t: f32) -> f32 {
        (self.origin + self.rate * t) + self.pole
    }
}

// Inputs here are dyadic. Decline an inversion if the widened subtraction
// was inexact, or rounding a very large/small operand obscures its grid.
fn difference(a: f64, b: f64) -> Option<f64> {
    let d = a - b;
    let v = d - a;
    (d.is_finite() && (a - (d - v)) + (-b - v) == 0.).then_some(d)
}

fn floor_input(limit: f64, inclusive: bool) -> Option<f32> {
    let f = limit as f32;
    let floor = if f64::from(f) > limit || (!inclusive && f64::from(f) == limit) {
        f.next_down()
    } else {
        f
    };
    floor.is_finite().then_some(floor)
}

fn upper_cell(value: f32) -> Option<(f64, bool)> {
    let next = value.next_up();
    next.is_finite().then(|| {
        (
            (f64::from(value) + f64::from(next)) * 0.5,
            value.to_bits() & 1 == 0,
        )
    })
}

#[derive(Clone, Copy)]
struct Cut {
    stages: [f32; 3],
    value: f64,
    inclusive: bool,
}
impl Cut {
    /// RN(origin + RN(rate*t)) + pole, with the final add also rounded.
    /// Walk back through the last acceptable output to the exact upper
    /// threshold on the unrounded product rate*t.
    fn new(s: Support, out: f32) -> Option<Self> {
        let (u, closed) = upper_cell(out)?;
        let com = floor_input(difference(u, f64::from(s.pole))?, closed)?;
        let (u, closed) = upper_cell(com)?;
        let product = floor_input(difference(u, f64::from(s.origin))?, closed)?;
        let (value, inclusive) = upper_cell(product)?;
        Some(Self {
            stages: [out, com, product],
            value,
            inclusive,
        })
    }

    fn period(self, last: Self, stages: usize) -> Option<f64> {
        let mut period: f64 = 0.;
        for (a, b) in self.stages.into_iter().zip(last.stages).take(stages) {
            // Both neighboring spacings must be uniform through the entire
            // inversion, including the float chosen by a directed floor.
            let spacing = f64::from(a.next_up()) - f64::from(a);
            if a.signum() != b.signum()
                || a == 0.
                || b == 0.
                || !spacing.is_finite()
                || spacing != f64::from(b.next_up()) - f64::from(b)
                || spacing != f64::from(a) - f64::from(a.next_down())
                || spacing != f64::from(b) - f64::from(b.next_down())
            {
                return None;
            }
            period = period.max(2. * spacing);
        }
        Some(period)
    }
}

fn cuts(a: Support, b: Support, output: f32, margin: f64) -> Option<(Cut, Cut)> {
    // For A <= output, the first offending B is ceil(output - margin).
    // Invert the complement B < output - margin with the same upper-cell law.
    let below = floor_input(difference(f64::from(output), margin)?, false)?;
    Some((Cut::new(a, output)?, Cut::new(b, below)?))
}

fn float_quantum(v: f64) -> i32 {
    let bits = v.abs().to_bits();
    let mantissa = (bits & ((1u64 << 52) - 1)) | (1u64 << 52);
    ((bits >> 52) as i32) - 1023 - 52 + mantissa.trailing_zeros() as i32
}

// Summed integer floors, Euclidean reduction. n <= 2^24. The caller bounds
// the scaled values to 72 bits, so all products here fit signed i128.
fn floor_sum(
    mut n: i128,
    mut m: i128,
    mut a: i128,
    mut b: i128,
    work: &mut Work,
) -> Result<i128, TrajectoryError> {
    let mut sum = 0;
    loop {
        work.charge(16)?;
        sum += (n * (n - 1) / 2) * a.div_euclid(m) + n * b.div_euclid(m);
        a = a.rem_euclid(m);
        b = b.rem_euclid(m);
        let upper = a * n + b;
        if upper < m {
            return Ok(sum);
        }
        n = upper / m;
        b = upper % m;
        std::mem::swap(&mut m, &mut a);
    }
}

#[derive(Clone, Copy)]
struct Strip {
    a: i128,
    b: i128,
    upper: i128,
    lower: i128,
    period: i128,
}
impl Strip {
    fn new(sa: f64, sb: f64, x: Cut, y: Cut, period: f64) -> Option<Self> {
        let values = [sa, sb, x.value, y.value, period];
        if values
            .iter()
            .any(|v| !v.is_finite() || (*v != 0. && !v.is_normal()))
        {
            return None;
        }
        let q = values
            .into_iter()
            .filter(|v| *v != 0.)
            .map(float_quantum)
            .min()?;
        let scale = 2_f64.powi(-q);
        let scaled = values.map(|v| v * scale);
        if scaled
            .iter()
            .any(|v| !v.is_finite() || v.abs() >= 2_f64.powi(72) || v.fract() != 0.)
        {
            return None;
        }
        let [a, b, u, l, period] = scaled.map(|v| v as i128);
        (period > 0 && a > 0 && b > 0).then_some(Self {
            a,
            b,
            upper: u - i128::from(!x.inclusive),
            lower: l + i128::from(y.inclusive),
            period,
        })
    }

    fn has_hit(self, lo: i128, hi: i128, work: &mut Work) -> Result<bool, TrajectoryError> {
        let n = hi - lo + 1;
        // For each n count the translations k in the closed strip:
        // a*n <= upper+k*period and b*n >= lower+k*period.
        Ok(
            n + floor_sum(n, self.period, self.b, self.b * lo - self.lower, work)?
                + floor_sum(n, self.period, -self.a, self.upper - self.a * lo, work)?
                > 0,
        )
    }

    fn first(
        self,
        mut lo: i128,
        mut hi: i128,
        copies: i128,
        work: &mut Work,
    ) -> Result<Option<i128>, TrajectoryError> {
        let ceil = |x: i128, d: i128| -(-x).div_euclid(d);
        lo = lo.max(ceil(self.lower, self.b));
        hi = hi.min((self.upper + copies * self.period).div_euclid(self.a));
        // Empty real strips must be excluded before summing their integer
        // populations. The other two restrictions intersect k with [0,copies].
        let drift = self.b - self.a;
        let needed = self.lower - self.upper;
        if drift > 0 {
            lo = lo.max(ceil(needed, drift));
        } else if drift < 0 {
            hi = hi.min((-needed).div_euclid(-drift));
        } else if needed > 0 {
            return Ok(None);
        }
        if hi < lo || !self.has_hit(lo, hi, work)? {
            return Ok(None);
        }
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.has_hit(lo, mid, work)? {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        Ok(Some(lo))
    }
}

enum Search {
    Clear,
    Hit(u32),
    Unknown,
}

// An inversion can straddle a binade even when only a few distinct A
// outputs are involved. Invert each of those output thresholds directly.
fn short_image(
    a: Support,
    b: Support,
    margin: f64,
    lo: u32,
    hi: u32,
    work: &mut Work,
) -> Result<Search, TrajectoryError> {
    let t0 = f32::from_bits(lo);
    let last = a.at(f32::from_bits(hi));
    let mut y = a.at(t0);
    let mut best = None;
    for _ in 0..24 {
        work.charge(64)?;
        let Some((_, cut)) = cuts(a, b, y, margin) else {
            return Ok(Search::Unknown);
        };
        let above = |t: f32| {
            let p = f64::from(t) * f64::from(b.rate);
            if cut.inclusive {
                p > cut.value
            } else {
                p >= cut.value
            }
        };
        let key = if above(t0) {
            Some(lo)
        } else {
            // F32 operands multiply exactly in F64. Check the two adjacent
            // keys around the quotient against the original inequalities.
            let approx = (cut.value / f64::from(b.rate)) as f32;
            let t = if above(approx) {
                approx
            } else {
                approx.next_up()
            };
            if !t.is_finite() || !above(t) || above(t.next_down()) {
                return Ok(Search::Unknown);
            }
            let key = t.to_bits();
            (lo <= key && key <= hi).then_some(key)
        };
        if let Some(key) = key {
            let t = f32::from_bits(key);
            if a.at(t) <= y {
                let Some(gap) = difference(f64::from(a.at(t)), f64::from(b.at(t))) else {
                    return Ok(Search::Unknown);
                };
                if gap > margin {
                    return Ok(Search::Unknown);
                }
                best = Some(best.map_or(key, |old: u32| old.min(key)));
            }
        }
        if y == last {
            return Ok(best.map_or(Search::Clear, Search::Hit));
        }
        y = y.next_up();
    }
    Ok(Search::Unknown)
}

// The two rounded velocity products differ by at most the given drift. Invert only
// their two additions. The thresholds then translate by the same amount, so
// disjoint thresholds in one residue class exclude that entire class.
#[allow(clippy::too_many_arguments)] // Keep both support intervals and the proof inputs explicit.
fn common_product_clear(
    a: Support,
    b: Support,
    margin: f64,
    drift: f64,
    low: u32,
    high: u32,
    nodes: &mut usize,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if *nodes == 0 {
        return Ok(false);
    }
    *nodes -= 1;
    work.charge(64)?;
    let unorder = |k: u32| f32::from_bits(if k >> 31 == 0 { !k } else { k ^ 0x8000_0000 });
    let threshold = |s: Support, y: Cut| {
        let (u, inclusive) = upper_cell(y.stages[1])?;
        Some((difference(u, f64::from(s.origin))?, inclusive))
    };
    let disjoint = |key: u32| -> Option<bool> {
        let (xa, xb) = cuts(a, b, unorder(key), margin)?;
        let (ua, ca) = threshold(a, xa)?;
        let (ub, cb) = threshold(b, xb)?;
        let gap = difference(ub, ua)?;
        Some(gap > drift || (gap == drift && (!ca || cb)))
    };
    let mut count = high - low;
    if count >= 16 {
        let range_period = || {
            let first = unorder(low);
            let (xa, xb) = cuts(a, b, first, margin)?;
            let (ya, yb) = cuts(a, b, unorder(high), margin)?;
            let period = xa.period(ya, 2)?.max(xb.period(yb, 2)?);
            let step = f64::from(first.next_up()) - f64::from(first);
            let residues = period / step;
            (1. ..=64.).contains(&residues).then_some(residues as u32)
        };
        if let Some(residues) = range_period() {
            count = count.min(residues - 1);
        } else {
            let mid = low + (high - low) / 2;
            return Ok(
                common_product_clear(a, b, margin, drift, low, mid, nodes, work)?
                    && common_product_clear(a, b, margin, drift, mid + 1, high, nodes, work)?,
            );
        }
    }
    for delta in 0..=count {
        work.charge(80)?;
        if disjoint(low + delta) != Some(true) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn product_drift_clear(
    a: Support,
    b: Support,
    margin: f64,
    dt: [u32; 2],
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    // RN is monotone: when B is slower its rounded product can never
    // overtake A's. Otherwise bound the relative product once for all time
    // cells. F32 products widened to F64 preserve their exact dyadic inputs.
    let drift = if b.rate <= a.rate {
        0.
    } else {
        let t = dt.map(f32::from_bits);
        let (Some(ea), Some(eb)) = (
            super::half_ulp(t.map(|v| v * a.rate)),
            super::half_ulp(t.map(|v| v * b.rate)),
        ) else {
            return Ok(false);
        };
        let difference = (f64::from(b.rate) - f64::from(a.rate)).next_up();
        (((difference * f64::from(t[1])).next_up() + ea).next_up() + eb).next_up()
    };
    let output = dt.map(|k| a.at(f32::from_bits(k)));
    if !output.iter().all(|v| v.is_finite()) {
        return Ok(false);
    }
    let order = |v: f32| {
        let k = v.to_bits();
        if k >> 31 == 1 {
            !k
        } else {
            k ^ 0x8000_0000
        }
    };
    common_product_clear(
        a,
        b,
        margin,
        drift,
        order(output[0]),
        order(output[1]),
        &mut 128,
        work,
    )
}

fn uniform(
    a: Support,
    b: Support,
    margin: f64,
    lo: u32,
    hi: u32,
    work: &mut Work,
) -> Result<Search, TrajectoryError> {
    let dt = [f32::from_bits(lo), f32::from_bits(hi)];
    let [first, last] = dt.map(|t| a.at(t));
    if !first.is_finite() || !last.is_finite() || !b.at(dt[1]).is_finite() {
        return Ok(Search::Unknown);
    }
    if difference(f64::from(first), f64::from(b.at(dt[1]))).is_some_and(|v| v > margin) {
        return Ok(Search::Clear);
    }
    let closed = |key| {
        let t = f32::from_bits(key);
        difference(f64::from(a.at(t)), f64::from(b.at(t))).map(|v| v <= margin)
    };
    if closed(lo) == Some(true) {
        return Ok(Search::Hit(lo));
    }
    if first == last {
        match closed(hi) {
            Some(false) => return Ok(Search::Clear),
            None => return Ok(Search::Unknown),
            _ => {}
        }
        let (mut left, mut right) = (lo, hi);
        while left < right {
            work.charge(16)?;
            let mid = left + (right - left) / 2;
            match closed(mid) {
                Some(true) => right = mid,
                Some(false) => left = mid + 1,
                None => return Ok(Search::Unknown),
            }
        }
        return Ok(Search::Hit(left));
    }
    if lo >> 23 != hi >> 23 || lo >> 23 == 0 {
        return Ok(Search::Unknown);
    }
    let Some((xa, xb)) = cuts(a, b, first, margin) else {
        return Ok(Search::Unknown);
    };
    let Some((ya, yb)) = cuts(a, b, last, margin) else {
        return Ok(Search::Unknown);
    };
    let Some(p) = xa
        .period(ya, 3)
        .zip(xb.period(yb, 3))
        .map(|(x, y)| x.max(y))
    else {
        if first.signum() == last.signum() && first.to_bits().abs_diff(last.to_bits()) < 24 {
            return short_image(a, b, margin, lo, hi, work);
        }
        return Ok(Search::Unknown);
    };
    let step = f64::from(first.next_up()) - f64::from(first);
    let residues = (p / step) as u64;
    if residues == 0 || residues > 32 {
        return Ok(Search::Unknown);
    }
    let dt_unit = 2_f64.powi(grid(dt[0]));
    let n0 = (f64::from(dt[0]) / dt_unit) as i128;
    let n1 = n0 + i128::from(hi - lo);
    let mut hit = None;
    for i in 0..residues {
        work.charge(96)?;
        let y = f64::from(first) + i as f64 * step;
        if y > f64::from(last) {
            break;
        }
        let Some((x, yb)) = cuts(a, b, y as f32, margin) else {
            return Ok(Search::Unknown);
        };
        let copies = ((f64::from(last) - y) / p).floor() as i128;
        let Some(strip) = Strip::new(
            f64::from(a.rate) * dt_unit,
            f64::from(b.rate) * dt_unit,
            x,
            yb,
            p,
        ) else {
            return Ok(Search::Unknown);
        };
        if let Some(n) = strip.first(n0, n1, copies, work)? {
            let candidate = lo + (n - n0) as u32;
            if closed(candidate) != Some(true) {
                return Ok(Search::Unknown);
            }
            hit = Some(hit.map_or(candidate, |old: u32| old.min(candidate)));
        }
    }
    Ok(hit.map_or(Search::Clear, Search::Hit))
}

fn search(
    a: Support,
    b: Support,
    margin: f64,
    lo: u32,
    hi: u32,
    remaining: &mut usize,
    work: &mut Work,
) -> Result<Search, TrajectoryError> {
    if *remaining == 0 {
        return Ok(Search::Unknown);
    }
    *remaining -= 1;
    work.charge(96)?;
    // The whole range may contain a late rounding contact even when the
    // two rounded velocity products are identical. Prove clear subranges
    // with that common product before walking their individual time cells.
    if a.rate == b.rate && hi - lo >= 16 && product_drift_clear(a, b, margin, [lo, hi], work)? {
        return Ok(Search::Clear);
    }
    let found = uniform(a, b, margin, lo, hi, work)?;
    if !matches!(found, Search::Unknown) || lo == hi {
        return Ok(found);
    }
    // Split on an actual binade boundary when spanning several. Bisection
    // on raw keys would keep revisiting the same two different spacings.
    let mid = if lo >> 23 != hi >> 23 {
        (((((lo >> 23) + (hi >> 23)).div_ceil(2)) << 23) - 1).max(lo)
    } else {
        lo + (hi - lo) / 2
    };
    let left = search(a, b, margin, lo, mid, remaining, work)?;
    if matches!(left, Search::Clear) {
        search(a, b, margin, mid + 1, hi, remaining, work)
    } else {
        Ok(left)
    }
}

/// Last observer time in the current box-face cell. The inverse clock is a
/// hint only: both adjacent F64 keys must evaluate to the original face law.
pub(super) fn face_end(
    source: Source,
    axis: usize,
    pole: f32,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<u64>, TrajectoryError> {
    let Some(k) = source.clock else {
        return Ok(None);
    };
    let sign = source.velocity[axis].signum();
    let support = Support {
        origin: sign * source.origin[axis],
        rate: sign * source.velocity[axis],
        pole: sign * pole,
    };
    if support.rate <= 0. {
        return Ok(None);
    }
    work.charge(64)?;
    let at = |t| support.at(k.local_delta(t));
    let y = at(start);
    if y == at(end) {
        return Ok(Some(end.to_bits()));
    }
    let Some(cut) = Cut::new(support, y) else {
        return Ok(None);
    };
    let above = |v: f32| {
        let p = f64::from(v) * f64::from(support.rate);
        if cut.inclusive {
            p > cut.value
        } else {
            p >= cut.value
        }
    };
    let approx = (cut.value / f64::from(support.rate)) as f32;
    let next = if above(approx) {
        approx
    } else {
        approx.next_up()
    };
    let prev = next.next_down();
    if !next.is_finite() || next <= 0. || !above(next) || above(prev) {
        return Ok(None);
    }
    let mid = (f64::from(prev) + f64::from(next)) * 0.5;
    let guess =
        k.domain.start + (mid / f64::from(k.native.integration_seconds)) * k.domain.duration();
    let mut key = guess.clamp(start, end).to_bits();
    for _ in 0..5 {
        work.charge(32)?;
        if at(Time::from_bits(key)) <= y {
            if key == end.to_bits() {
                return Ok(None);
            }
            if at(Time::from_bits(key + 1)) > y {
                return Ok(Some(key));
            }
            key += 1;
        } else {
            if key == start.to_bits() {
                return Ok(None);
            }
            key -= 1;
        }
    }
    Ok(None)
}

#[allow(clippy::too_many_arguments)] // Both shape inputs share the explicit search bounds and work budget.
pub(super) fn first(
    cube: Source,
    cap: Source,
    axis: usize,
    sign: f32,
    face: f32,
    core: f32,
    radius: f32,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<Option<super::FaceSearch>, TrajectoryError> {
    let (Some(k), Some(c)) = (cube.clock, cap.clock) else {
        return Ok(None);
    };
    if !same_clock(k, c) {
        return Ok(None);
    }
    let orient = cap.velocity[axis].signum();
    let support = |s: Source, p: f32| Support {
        origin: orient * s.origin[axis],
        rate: orient * s.velocity[axis],
        pole: orient * p,
    };
    let cube = support(cube, face);
    let dt = [k.local_delta(start).to_bits(), k.local_delta(end).to_bits()];
    if !cube.rate.is_finite() || cube.rate <= 0. || orient * cap.velocity[axis] <= 0. {
        return Ok(None);
    }
    let world_margin = f64::from(clearance) + f64::from(radius);
    if difference(world_margin, f64::from(radius)) != Some(f64::from(clearance)) {
        return Ok(None);
    }
    let mut earliest = None;
    let mut remaining = 512;
    for (index, (pole, margin)) in [
        (core - sign * radius, f64::from(clearance)),
        (core, world_margin),
    ]
    .into_iter()
    .enumerate()
    {
        if index == 1
            && cap.point_error(axis, core) == Some(0.)
            && cap.point_error(axis, core - sign * radius) == Some(0.)
            && difference(f64::from(core), f64::from(sign * radius))
                == Some(f64::from(core - sign * radius))
        {
            break;
        }
        let cap = support(cap, pole);
        let (a, b) = if sign == orient {
            (cap, cube)
        } else {
            (cube, cap)
        };
        // Exact translations of a support pole can be moved into the margin.
        // This retains the true coarser COM lattice when subtracting a radius
        // across a binade or near zero (Sterbenz cancellation).
        let remove_pole = |s: Support| {
            let com = dt.map(|key| s.origin + s.rate * f32::from_bits(key));
            if super::add_error(com, s.pole) == Some(0.) {
                (Support { pole: 0., ..s }, s.pole)
            } else {
                (s, 0.)
            }
        };
        let (base_a, pa) = remove_pole(a);
        let (base_b, pb) = remove_pole(b);
        let (a, b, margin) = difference(margin, f64::from(pa))
            .and_then(|d| difference(d, -f64::from(pb)))
            .map_or((a, b, margin), |m| (base_a, base_b, m));
        if product_drift_clear(a, b, margin, dt, work)? {
            continue;
        }
        match search(
            a,
            b,
            margin,
            dt[0],
            earliest.unwrap_or(dt[1]),
            &mut remaining,
            work,
        )? {
            Search::Unknown => return Ok(None),
            Search::Clear => {}
            Search::Hit(key) => earliest = Some(earliest.map_or(key, |old: u32| old.min(key))),
        }
    }
    let Some(key) = earliest else {
        return Ok(Some(super::FaceSearch::Clear));
    };
    let (mut lo, mut hi) = (start.to_bits(), end.to_bits());
    while lo < hi {
        work.charge(24)?;
        let mid = lo + (hi - lo) / 2;
        if k.local_delta(Time::from_bits(mid)).to_bits() >= key {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    Ok(
        (lo > start.to_bits() && k.local_delta(Time::from_bits(lo)).to_bits() == key)
            .then(|| super::FaceSearch::Boundary(lo - 1, lo)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_velocity_preserves_clear_prefixes_and_the_first_rounded_contact() {
        let driver = Support {
            origin: -0.39458585,
            rate: 67.99995,
            pole: 0.25,
        };
        let center = Support {
            origin: 0.11541417,
            rate: driver.rate,
            pole: 0.,
        };
        let dt = [0, 0.00020637247_f32.to_bits()];
        let margin = f64::from(0.01_f32);
        let mut work = Work {
            used: 0,
            limit: 64 * 1024,
        };
        assert!(product_drift_clear(center, driver, margin + 0.25, dt, &mut work).unwrap());
        assert!(product_drift_clear(
            Support {
                pole: -0.25,
                ..center
            },
            driver,
            margin,
            dt,
            &mut work
        )
        .unwrap());
        // One actual endpoint is now inside the requested clearance.
        let closer = Support {
            origin: center.origin.next_down().next_down().next_down(),
            ..center
        };
        let actual_start = f64::from(closer.at(0.)) - f64::from(driver.at(0.));
        assert!(actual_start <= margin + 0.25);
        assert!(!product_drift_clear(closer, driver, margin + 0.25, dt, &mut work).unwrap());

        let wall = Support {
            origin: -0.0200001,
            rate: 30.2,
            pole: 0.25,
        };
        let actor = Support {
            origin: 0.48999995,
            rate: wall.rate,
            pole: -0.25,
        };
        let first = 0x3c12_7ac5;
        let mut work = Work {
            used: 0,
            limit: 2 * 1024 * 1024,
        };
        let gap = |key| {
            let dt = f32::from_bits(key);
            f64::from(actor.at(dt)) - f64::from(wall.at(dt))
        };
        assert!(gap(first - 1) > margin && gap(first) <= margin);
        assert!(matches!(
            search(actor, wall, margin, 0, 0.025_f32.to_bits(), &mut 512, &mut work).unwrap(),
            Search::Hit(key) if key == first
        ));
    }

    #[test]
    fn common_clock_finds_first_f32_face_crossing_through_a_long_clear_prefix() {
        let actor = Support {
            origin: 0.4396794,
            rate: 61.000015,
            pole: -0.25,
        };
        let wall = Support {
            origin: -0.070320606,
            rate: 61.000088,
            pole: 0.25,
        };
        let first = 0x3857_d8e8;
        let margin = f64::from(0.01_f32);
        let mut work = Work {
            used: 0,
            limit: 128 * 1024,
        };
        assert!(
            matches!(search(actor, wall, margin, 0, 0.00020637247_f32.to_bits(), &mut 512, &mut work).unwrap(),Search::Hit(key) if key==first)
        );
        for begin in [first - 511, first - 9, first, first + 1] {
            let end = begin + 512;
            let expected = (begin..=end).find(|&key| {
                let t = f32::from_bits(key);
                f64::from(actor.at(t)) - f64::from(wall.at(t)) <= margin
            });
            let actual = search(
                actor,
                wall,
                margin,
                begin,
                end,
                &mut 512,
                &mut Work {
                    used: 0,
                    limit: 128 * 1024,
                },
            )
            .unwrap();
            match actual {
                Search::Hit(key) => assert_eq!(Some(key), expected),
                Search::Clear => assert!(expected.is_none()),
                Search::Unknown => panic!("expected supported uniform interval"),
            }
        }
    }
}
