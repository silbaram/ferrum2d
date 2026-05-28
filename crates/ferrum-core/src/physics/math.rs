use crate::components::{AngularVelocity, Rotation2D, Transform2D, Velocity};

pub(super) fn dot_velocity(a: Velocity, b: Velocity) -> f32 {
    a.vx * b.vx + a.vy * b.vy
}

pub(super) fn cross_velocity(a: Velocity, b: Velocity) -> f32 {
    a.vx * b.vy - a.vy * b.vx
}

pub(super) fn cross_scalar_velocity(scalar: f32, velocity: Velocity) -> Velocity {
    Velocity {
        vx: -scalar * velocity.vy,
        vy: scalar * velocity.vx,
    }
}

pub(super) fn finite_velocity(velocity: Velocity) -> Velocity {
    Velocity {
        vx: if velocity.vx.is_finite() {
            velocity.vx
        } else {
            0.0
        },
        vy: if velocity.vy.is_finite() {
            velocity.vy
        } else {
            0.0
        },
    }
}

pub(super) fn finite_transform(transform: Transform2D) -> Transform2D {
    Transform2D {
        x: if transform.x.is_finite() {
            transform.x
        } else {
            0.0
        },
        y: if transform.y.is_finite() {
            transform.y
        } else {
            0.0
        },
    }
}

pub(super) fn sanitize_finite(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

pub(super) fn finite_angular_velocity(angular_velocity: AngularVelocity) -> AngularVelocity {
    AngularVelocity {
        radians_per_second: if angular_velocity.radians_per_second.is_finite() {
            angular_velocity.radians_per_second
        } else {
            0.0
        },
    }
}

pub(super) fn finite_rotation(rotation: Rotation2D) -> Rotation2D {
    Rotation2D {
        radians: if rotation.radians.is_finite() {
            rotation.radians
        } else {
            0.0
        },
    }
}

pub(super) fn velocity_len_squared(velocity: Velocity) -> f32 {
    velocity.vx * velocity.vx + velocity.vy * velocity.vy
}

pub(super) fn sanitize_delta_seconds(delta_seconds: f32) -> f32 {
    if delta_seconds.is_finite() && delta_seconds > 0.0 {
        delta_seconds
    } else {
        0.0
    }
}

pub(super) fn sanitize_non_negative(value: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finite_helpers_replace_non_finite_components() {
        assert_eq!(
            finite_velocity(Velocity {
                vx: f32::NAN,
                vy: f32::INFINITY,
            }),
            Velocity { vx: 0.0, vy: 0.0 }
        );
        assert_eq!(
            finite_transform(Transform2D {
                x: f32::NEG_INFINITY,
                y: 3.0,
            }),
            Transform2D { x: 0.0, y: 3.0 }
        );
        assert_eq!(
            finite_angular_velocity(AngularVelocity {
                radians_per_second: f32::NAN,
            }),
            AngularVelocity {
                radians_per_second: 0.0,
            }
        );
        assert_eq!(
            finite_rotation(Rotation2D {
                radians: f32::INFINITY,
            }),
            Rotation2D { radians: 0.0 }
        );
        assert_eq!(sanitize_finite(f32::NEG_INFINITY), 0.0);
    }

    #[test]
    fn sanitize_helpers_reject_non_positive_or_invalid_values() {
        assert_eq!(sanitize_delta_seconds(0.016), 0.016);
        assert_eq!(sanitize_delta_seconds(0.0), 0.0);
        assert_eq!(sanitize_delta_seconds(-0.016), 0.0);
        assert_eq!(sanitize_delta_seconds(f32::NAN), 0.0);

        assert_eq!(sanitize_non_negative(1.5), 1.5);
        assert_eq!(sanitize_non_negative(0.0), 0.0);
        assert_eq!(sanitize_non_negative(-1.0), 0.0);
        assert_eq!(sanitize_non_negative(f32::INFINITY), 0.0);
    }

    #[test]
    fn vector_helpers_match_2d_operations() {
        let a = Velocity { vx: 2.0, vy: 3.0 };
        let b = Velocity { vx: 4.0, vy: -5.0 };

        assert_eq!(dot_velocity(a, b), -7.0);
        assert_eq!(cross_velocity(a, b), -22.0);
        assert_eq!(
            cross_scalar_velocity(2.0, a),
            Velocity { vx: -6.0, vy: 4.0 }
        );
        assert_eq!(velocity_len_squared(b), 41.0);
    }
}
