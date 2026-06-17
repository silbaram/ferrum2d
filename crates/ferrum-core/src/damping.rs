pub(crate) fn damping_factor(damping_per_second: f32, delta_seconds: f32) -> f32 {
    if !damping_per_second.is_finite()
        || damping_per_second <= 0.0
        || !delta_seconds.is_finite()
        || delta_seconds <= 0.0
    {
        return 1.0;
    }

    (-(damping_per_second * delta_seconds))
        .exp()
        .clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn damping_factor_uses_time_stable_exponential_decay() {
        let single_step = damping_factor(0.5, 1.0);
        let four_substeps = damping_factor(0.5, 0.25).powi(4);

        assert!((single_step - (-0.5_f32).exp()).abs() < 0.001);
        assert!((single_step - four_substeps).abs() < 0.001);
    }

    #[test]
    fn damping_factor_sanitizes_invalid_or_disabled_input() {
        assert_eq!(damping_factor(0.0, 1.0), 1.0);
        assert_eq!(damping_factor(-1.0, 1.0), 1.0);
        assert_eq!(damping_factor(f32::NAN, 1.0), 1.0);
        assert_eq!(damping_factor(1.0, 0.0), 1.0);
        assert_eq!(damping_factor(1.0, f32::NAN), 1.0);
    }
}
