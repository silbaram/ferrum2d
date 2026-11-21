//! Finite navigation distance results; ordinary f32 results retain their bits.

use crate::components::Transform2D;

pub(super) fn segment(from: Transform2D, to: Transform2D) -> Option<f32> {
    let legacy = ((to.x - from.x).powi(2) + (to.y - from.y).powi(2)).sqrt();
    finish(legacy, from, std::iter::once(to))
}

/// The caller accumulated `legacy` over these points using the existing f32
/// order. The ordinary path is O(1); only former overflow revisits the chain.
pub(super) fn finish(
    legacy: f32,
    from: Transform2D,
    points: impl Iterator<Item = Transform2D>,
) -> Option<f32> {
    if !from.x.is_finite() || !from.y.is_finite() {
        return None;
    }
    if legacy.is_finite() {
        return Some(legacy);
    }
    // Revisit only the former overflow/nonfinite range. Widen original operands
    // before subtraction; finite endpoints can themselves have an f32-overflowing
    // delta. Never saturate an unrepresentable total into a plausible result.
    let mut previous = from;
    let mut wide = 0.0f64;
    for point in points {
        if !point.x.is_finite() || !point.y.is_finite() {
            return None;
        }
        wide += (f64::from(point.x) - f64::from(previous.x))
            .hypot(f64::from(point.y) - f64::from(previous.y));
        previous = point;
    }
    if wide > f64::from(f32::MAX) {
        return None;
    }
    let distance = wide as f32;
    distance.is_finite().then_some(distance)
}

#[cfg(test)]
mod tests;
