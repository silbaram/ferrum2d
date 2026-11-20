//! Complete monotone COM-cell partition of the already qualified Native input.
//! Within one constant COM output, the other original scalar graph is monotone:
//! its adverse endpoint bounds both original supports over every input key.
//! This is a finite partition proof, not pose sampling or an endpoint-only cast.
use super::{Bound, Source, TrajectoryError, Work};

pub(super) enum Certificate {
    Separated,
    Unknown,
    /// An input nomination only; the real point observer must validate it.
    Counter(u32),
}

fn scalar(source: Source, axis: usize, key: u32) -> f32 {
    source.origin[axis] + source.velocity[axis] * f32::from_bits(key)
}

// Stay in one nonzero sign region so raw absolute bits order output magnitude
// and each identical output bit pattern has one contiguous input preimage.
fn span(lo: f32, hi: f32) -> Option<u32> {
    if !lo.is_finite()
        || !hi.is_finite()
        || lo == 0.
        || hi == 0.
        || lo.is_sign_negative() != hi.is_sign_negative()
    {
        return None;
    }
    lo.abs()
        .to_bits()
        .abs_diff(hi.abs().to_bits())
        .checked_add(1)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    a: Source,
    b: Source,
    dt: [f32; 2],
    axis: usize,
    sign: f32,
    point_a: f32,
    point_b: f32,
    radius_a: f32,
    radius_b: f32,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    Ok(matches!(
        certificate(a, b, dt, axis, sign, point_a, point_b, radius_a, radius_b, clearance, work)?,
        Certificate::Separated
    ))
}

#[allow(clippy::too_many_arguments)]
pub(super) fn certificate(
    a: Source,
    b: Source,
    dt: [f32; 2],
    axis: usize,
    sign: f32,
    point_a: f32,
    point_b: f32,
    radius_a: f32,
    radius_b: f32,
    clearance: f32,
    work: &mut Work,
) -> Result<Certificate, TrajectoryError> {
    // Parent admission has already checked both independent native headers,
    // shared clock/endpoint branch identities, all XYZ supports and dt keys.
    work.charge(128)?; // four endpoint scalar graphs and fixed output census.
    let low = dt[0].to_bits();
    let high = dt[1].to_bits();
    let sa = span(scalar(a, axis, low), scalar(a, axis, high)).filter(|n| *n <= 256);
    let sb = span(scalar(b, axis, low), scalar(b, axis, high)).filter(|n| *n <= 256);
    let (partition, partition_a) = match (sa, sb) {
        (Some(x), Some(y)) if y < x => (b, false),
        (Some(_), _) => (a, true),
        (None, Some(_)) => (b, false),
        _ => return Ok(Certificate::Unknown),
    };
    let local_a = point_a + sign * radius_a;
    let local_b = point_b - sign * radius_b;
    let adverse_end = if partition_a {
        sign * b.velocity[axis] < 0.
    } else {
        -sign * a.velocity[axis] < 0.
    };
    // Approaching pairs tend to have their first counter near the right edge.
    // Checking complete cells backwards finds it without paying for every
    // earlier clear cell. NoHit still needs coverage through the original low.
    let mut last = high;
    for _ in 0..256 {
        work.charge(64)?;
        let value = scalar(partition, axis, last).to_bits();
        let mut left = low;
        let mut right = last;
        while left < right {
            // Equality is a suffix of this remaining monotone input interval.
            // Its FIRST key and the prior last enclose the entire output cell.
            let middle = left + (right - left) / 2;
            work.charge(64)?;
            if scalar(partition, axis, middle).to_bits() == value {
                right = middle;
            } else {
                left = middle + 1;
            }
        }
        let first = left;
        let key = if adverse_end { last } else { first };
        work.charge(256)?; // both actual supports and separate real radii.
        let ta = scalar(a, axis, key);
        let tb = scalar(b, axis, key);
        let world = Bound::exact(f64::from((tb + point_b) * sign))
            .sub(Bound::exact(f64::from((ta + point_a) * sign)))
            .sub(Bound::exact(f64::from(radius_a)))
            .sub(Bound::exact(f64::from(radius_b)));
        let local = Bound::exact(f64::from((tb + local_b) * sign))
            .sub(Bound::exact(f64::from((ta + local_a) * sign)));
        if !world.finite() || !local.finite() {
            return Ok(Certificate::Unknown);
        }
        if world.lo <= f64::from(clearance) || local.lo <= f64::from(clearance) {
            return Ok(Certificate::Counter(key));
        }
        if first == low {
            return Ok(Certificate::Separated);
        }
        last = first - 1;
    }
    // The full output span was capped, but keep incomplete walks fail-closed.
    Ok(Certificate::Unknown)
}

#[cfg(test)]
mod tests;
