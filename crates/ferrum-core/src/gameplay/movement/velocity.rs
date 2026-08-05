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

pub(in crate::gameplay) fn velocity_interpolate(
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
    Velocity {
        vx: current.vx + (desired.vx - current.vx) * turn_rate,
        vy: current.vy + (desired.vy - current.vy) * turn_rate,
    }
}

pub(in crate::gameplay) fn velocity_with_acceleration_and_speed_cap(
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
