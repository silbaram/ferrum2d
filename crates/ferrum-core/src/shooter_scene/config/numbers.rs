pub(in crate::shooter_scene) fn positive_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        default
    }
}

pub(in crate::shooter_scene) fn non_negative_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value >= 0.0 {
        value
    } else {
        default
    }
}

pub(in crate::shooter_scene) fn finite_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        default
    }
}
