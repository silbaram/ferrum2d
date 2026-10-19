use super::*;

pub(crate) fn topdown_input_direction(input: InputState) -> Velocity {
    let mut x: f32 = 0.0;
    let mut y: f32 = 0.0;
    if input.w == 1 {
        y -= 1.0;
    }
    if input.s == 1 {
        y += 1.0;
    }
    if input.a == 1 {
        x -= 1.0;
    }
    if input.d == 1 {
        x += 1.0;
    }
    let len = (x * x + y * y).sqrt();
    if len > 0.0 {
        Velocity {
            vx: x / len,
            vy: y / len,
        }
    } else {
        Velocity::default()
    }
}

pub(crate) fn topdown_input_velocity(input: InputState, speed: f32) -> Velocity {
    let direction = topdown_input_direction(input);
    Velocity {
        vx: direction.vx * speed,
        vy: direction.vy * speed,
    }
}

pub(crate) fn velocity_toward(from: Transform2D, to: Transform2D, speed: f32) -> Velocity {
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    let len = (dx * dx + dy * dy).sqrt();
    if !len.is_finite() {
        let dx = f64::from(to.x) - f64::from(from.x);
        let dy = f64::from(to.y) - f64::from(from.y);
        let length = dx.hypot(dy);
        return if length.is_finite() && length > 0.0001 {
            Velocity {
                vx: (dx / length * f64::from(speed)) as f32,
                vy: (dy / length * f64::from(speed)) as f32,
            }
        } else {
            Velocity::default()
        };
    }
    if len > 0.0001 {
        Velocity {
            vx: dx / len * speed,
            vy: dy / len * speed,
        }
    } else {
        Velocity::default()
    }
}

pub(in crate::gameplay) fn clamp_turn_rate(turn_rate: f32) -> f32 {
    if !turn_rate.is_finite() {
        0.0
    } else {
        turn_rate.clamp(0.0, 1.0)
    }
}

pub(crate) fn velocity_interpolate(
    current: Velocity,
    desired: Velocity,
    turn_rate: f32,
) -> Velocity {
    if turn_rate <= 0.0 {
        return current;
    }
    if turn_rate >= 1.0 {
        return desired;
    }
    let velocity = Velocity {
        vx: current.vx + (desired.vx - current.vx) * turn_rate,
        vy: current.vy + (desired.vy - current.vy) * turn_rate,
    };
    if velocity.vx.is_finite() && velocity.vy.is_finite() {
        return velocity;
    }
    Velocity {
        vx: (f64::from(current.vx)
            + (f64::from(desired.vx) - f64::from(current.vx)) * f64::from(turn_rate))
            as f32,
        vy: (f64::from(current.vy)
            + (f64::from(desired.vy) - f64::from(current.vy)) * f64::from(turn_rate))
            as f32,
    }
}

pub(crate) fn velocity_with_acceleration_and_speed_cap(
    current: Velocity,
    acceleration_x: f32,
    acceleration_y: f32,
    max_speed: f32,
) -> Velocity {
    let mut velocity = Velocity {
        vx: current.vx + acceleration_x,
        vy: current.vy + acceleration_y,
    };
    let speed_sq = velocity.vx * velocity.vx + velocity.vy * velocity.vy;
    let max_speed_sq = max_speed * max_speed;
    if !speed_sq.is_finite()
        || !max_speed_sq.is_finite()
        || speed_sq.is_subnormal()
        || max_speed_sq.is_subnormal()
        || max_speed_sq == 0.
        || speed_sq == 0. && (velocity.vx != 0. || velocity.vy != 0.)
    {
        // Keep the ordinary f32 path bit-compatible. Finite authored f32 inputs can
        // overflow their sum/square; normalize those exceptional values in f64.
        let x = f64::from(current.vx) + f64::from(acceleration_x);
        let y = f64::from(current.vy) + f64::from(acceleration_y);
        let speed = x.hypot(y);
        if !speed.is_finite() || !max_speed.is_finite() || max_speed <= 0. {
            return Velocity::default();
        }
        let scale = if speed > f64::from(max_speed) {
            f64::from(max_speed) / speed
        } else {
            1.
        };
        return Velocity {
            vx: (x * scale) as f32,
            vy: (y * scale) as f32,
        };
    }
    if speed_sq > max_speed_sq {
        let current_speed = speed_sq.sqrt();
        if current_speed > 0.0 {
            let scale = max_speed / current_speed;
            velocity.vx *= scale;
            velocity.vy *= scale;
        }
    }
    velocity
}

pub(crate) fn orbit_velocity_with_band(
    transform: Transform2D,
    target_transform: Transform2D,
    speed: f32,
    radius: f32,
    radial_band: f32,
) -> Velocity {
    let dx = transform.x - target_transform.x;
    let dy = transform.y - target_transform.y;
    let distance = (dx * dx + dy * dy).sqrt();
    if distance <= 0.0001 {
        return Velocity { vx: speed, vy: 0.0 };
    }

    let radial_x = dx / distance;
    let radial_y = dy / distance;
    let mut vx = -radial_y;
    let mut vy = radial_x;

    if distance < radius - radial_band {
        vx += radial_x;
        vy += radial_y;
    } else if distance > radius + radial_band {
        vx -= radial_x;
        vy -= radial_y;
    }

    let len = (vx * vx + vy * vy).sqrt();
    if len <= 0.0001 {
        return Velocity::default();
    }
    Velocity {
        vx: vx / len * speed,
        vy: vy / len * speed,
    }
}

#[cfg(test)]
mod acceleration_tests {
    use super::*;
    #[test]
    fn acceleration_caps_finite_extreme_vectors_without_overflow() {
        for max in [f32::from_bits(1), 64., 1e30, f32::MAX] {
            let v = velocity_with_acceleration_and_speed_cap(
                Velocity {
                    vx: f32::MAX,
                    vy: f32::MAX,
                },
                f32::MAX,
                -f32::MAX,
                max,
            );
            assert!(v.vx.is_finite() && v.vy.is_finite());
            assert!(f64::from(v.vx).hypot(f64::from(v.vy)) <= f64::from(max));
        }
        assert_eq!(
            velocity_with_acceleration_and_speed_cap(Velocity { vx: 3., vy: 4. }, 0., 0., 10.),
            Velocity { vx: 3., vy: 4. }
        );
    }
}

#[cfg(test)]
mod seeking_tests {
    use super::*;
    #[test]
    fn seeking_normalizes_and_interpolates_extreme_finite_vectors() {
        let desired = velocity_toward(
            Transform2D { x: f32::MAX, y: 0. },
            Transform2D {
                x: -f32::MAX,
                y: 0.,
            },
            64.,
        );
        assert_eq!(desired, Velocity { vx: -64., vy: 0. });
        let v = velocity_interpolate(
            Velocity {
                vx: f32::MAX,
                vy: -f32::MAX,
            },
            Velocity {
                vx: -f32::MAX,
                vy: f32::MAX,
            },
            0.5,
        );
        assert_eq!(v, Velocity::default());
    }
}
