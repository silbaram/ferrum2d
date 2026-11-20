//! Complete common-input image, not paired pose/output samples.
use super::{Curve, Image, Parameter, Time};
use crate::physics3d::solver_trajectory::Kernel;

pub(super) struct Pairs {
    pub(super) values: [(usize, usize); 4],
    pub(super) len: usize,
}
fn equal_time(a: Time, b: Time) -> bool {
    a.to_bits() == b.to_bits()
}
fn kernel(curve: Curve) -> Option<Kernel> {
    match curve {
        Curve::Integrated(k) | Curve::Anchored { carrier: k, .. } => Some(k),
        Curve::Constant { .. } | Curve::Ccd { .. } => None,
    }
}
fn equal_parameter(a: Parameter, b: Parameter) -> bool {
    a.len == b.len
        && a.values[..a.len]
            .iter()
            .zip(&b.values[..b.len])
            .all(|(x, y)| x.to_bits() == y.to_bits())
}
pub(super) fn pairs(a: &Image, b: &Image) -> Option<Pairs> {
    let (Some((a_start, a_end)), Some((b_start, b_end))) = (a.input_interval, b.input_interval)
    else {
        return None;
    };
    if !equal_time(a_start, b_start) || !equal_time(a_end, b_end) {
        return None;
    }
    let (ka, kb) = (kernel(a.curve)?, kernel(b.curve)?);
    if !equal_time(ka.domain.start, kb.domain.start)
        || !equal_time(ka.domain.end, kb.domain.end)
        || ka.native.integration_seconds.to_bits() != kb.native.integration_seconds.to_bits()
        || !equal_parameter(a.primary, b.primary)
    {
        return None;
    }
    // Their primary mapping is the identical f64 local fraction times the
    // identical original native h, rounded once to F32. Thus every actual t
    // selects the same primary index. No compressed representative is used.
    let both_anchored =
        matches!(a.curve, Curve::Anchored { .. }) && matches!(b.curve, Curve::Anchored { .. });
    if both_anchored && !equal_parameter(a.relative, b.relative) {
        return None;
    }
    let mut result = Pairs {
        values: [(0, 0); 4],
        len: 0,
    };
    for primary in 0..a.primary.len {
        for ra in 0..a.relative.len {
            for rb in 0..b.relative.len {
                // Anchored relative time is a different mapping from native
                // dt. Share only its independently identical logical-domain
                // map; retain the primary x relative Cartesian product.
                if both_anchored && ra != rb {
                    continue;
                }
                if result.len == result.values.len() {
                    return None;
                }
                result.values[result.len] =
                    (primary * a.relative.len + ra, primary * b.relative.len + rb);
                result.len += 1;
            }
        }
    }
    Some(result)
}

#[cfg(test)]
mod tests;
