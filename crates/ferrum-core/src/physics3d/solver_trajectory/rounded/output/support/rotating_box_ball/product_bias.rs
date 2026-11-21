use super::{rounded_translation_band, upper_mul, Bound, Float, Value};

/// Write a represented product as an exact doubling plus a shift on the
/// output grid. This retains the sign of the last multiply's rounding
/// error when the factor is near two and its input spans several points.
pub(super) fn twice_product(base: Value, factor: Value) -> Option<(Bound, f64)> {
    if !base.finite() || !factor.finite() {
        return None;
    }
    let two = Bound::exact(2.);
    let input = Value::input(base.actual).ideal;
    let multiplier = Value::input(factor.actual).ideal;
    let residual = input.mul(multiplier.sub(two));
    let offset = Float::span(
        (residual.lo as f32).next_down(),
        (residual.hi as f32).next_up(),
    );
    let doubled = base.actual.mul(Float::exact(2.));
    let product = base.actual.mul(factor.actual);
    if !offset.finite() || !doubled.finite() || !product.finite() {
        return None;
    }
    let shift = rounded_translation_band(doubled, offset, product)?;
    // RN(b*w) = 2*b + shift. Subtract the ideal b*w by using its
    // residual around two, keeping 2*(b - ideal_b) as the only
    // symmetric error. The shift already covers all represented w.
    let bias = shift.sub(base.ideal.mul(factor.ideal.sub(two)));
    let error = upper_mul(2., base.error);
    (bias.finite() && error.is_finite()).then_some((bias, error))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_product_band_contains_each_original_rounded_product() {
        let factor = Value::input(Float::span(1.999_872_1, 1.999_872_2));
        let seed = 0.02249287_f32;
        let last = f32::from_bits(seed.to_bits() + 512);
        for sign in [1., -1.] {
            let lo = (sign * seed).min(sign * last);
            let hi = (sign * seed).max(sign * last);
            let actual = Value::input(Float::span(lo, hi));
            let (bias, error) = twice_product(actual, factor).unwrap();
            for bits in seed.to_bits()..=last.to_bits() {
                let base = sign * f32::from_bits(bits);
                for w in [factor.actual.lo, factor.actual.hi] {
                    let residual = f64::from(base * w) - f64::from(base) * f64::from(w);
                    assert!(residual >= bias.lo - error && residual <= bias.hi + error);
                }
            }
        }
        assert!(twice_product(Value::input(Float::span(0.49, 0.51)), factor).is_none());
    }

    #[test]
    fn earlier_rounding_stays_in_the_product_band() {
        let b = 0.02249287_f32;
        let w = 1.9998722_f32;
        let ideal_base = (f64::from(b) + f64::from(b.next_up())) * 0.5;
        let ideal_factor = (f64::from(w) + f64::from(w.next_down())) * 0.5;
        let base = Value {
            ideal: Bound::exact(ideal_base),
            error: ideal_base - f64::from(b),
            ..Value::input(Float::exact(b))
        };
        let factor = Value {
            ideal: Bound::exact(ideal_factor),
            error: f64::from(w) - ideal_factor,
            ..Value::input(Float::exact(w))
        };
        let delta = f64::from(b * w) - ideal_base * ideal_factor;
        let (bias, error) = twice_product(base, factor).unwrap();
        assert!(delta >= bias.lo - error && delta <= bias.hi + error);
    }
}
