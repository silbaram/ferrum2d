//! Movement-pattern intent stays in Rust; terrain/crowd steering changes only the
//! accepted horizontal input, never the canonical acceleration/turn momentum.
use super::*;
use crate::components::gameplay::MovementTarget;
use crate::gameplay::{velocity_interpolate, velocity_with_acceleration_and_speed_cap};
#[cfg(test)]
mod tests;

pub(super) fn supported(pattern: MovementPattern, all: bool) -> bool {
    matches!(pattern, MovementPattern::Chase { .. })
        || all
            && matches!(
                pattern,
                MovementPattern::SeekTarget { .. } | MovementPattern::Accelerate { .. }
            )
}
pub(super) fn targeted(pattern: MovementPattern) -> Option<(MovementTarget, f32, Option<f32>)> {
    match pattern {
        MovementPattern::Chase { target, speed } => Some((target, speed, None)),
        MovementPattern::SeekTarget {
            target,
            speed,
            turn_rate,
        } => Some((
            target,
            speed,
            Some(if turn_rate.is_finite() {
                turn_rate.clamp(0., 1.)
            } else {
                0.
            }),
        )),
        _ => None,
    }
}
pub(super) fn observed_velocity(runtime: &UnifiedPhysicsRuntime, entity: Entity) -> Velocity {
    let Ok(body) = runtime.spatial_actor_body(entity) else {
        return Velocity::default();
    };
    let Ok(state) = runtime.physics.character_state(body) else {
        return Velocity::default();
    };
    let dt = runtime.physics.config().step_seconds;
    Velocity {
        vx: (state.translation[0] - state.carry_translation[0]) / dt,
        vy: -(state.translation[2] - state.carry_translation[2]) / dt,
    }
}
pub(super) fn seek_velocity(agent: &Agent, pose: Pose, speed: f32, rate: f32, dt: f32) -> Velocity {
    let Some(target) = agent.route.target() else {
        return Velocity::default();
    };
    let dx = f64::from(target.position[0]) - f64::from(pose.position[0]);
    let dy = f64::from(pose.position[2]) - f64::from(target.position[2]);
    let distance = dx.hypot(dy);
    let speed = if agent.route.is_final() {
        f64::from(speed).min(distance * f64::from(rate) / f64::from(dt))
    } else {
        f64::from(speed)
    };
    let desired = if distance > 0. {
        Velocity {
            vx: (dx / distance * speed) as f32,
            vy: (dy / distance * speed) as f32,
        }
    } else {
        Velocity::default()
    };
    velocity_interpolate(agent.intent, desired, rate)
}

/// A curved follower may bypass a nearby intermediate waypoint only after the
/// whole new segment reaches the next waypoint's native support and height.
pub(super) fn shortcut(
    runtime: &mut UnifiedPhysicsRuntime,
    nav: &mut NativeCombatNavigation,
    scene: &SpatialScene,
    index: usize,
    cell: f32,
) {
    let Ok(body) = runtime.spatial_actor_body(nav.agents[index].entity) else {
        return;
    };
    let Ok(state) = runtime.physics.body_state(body) else {
        return;
    };
    let Some(next) = nav.agents[index].route.shortcut_target(state.pose, cell) else {
        return;
    };
    let Ok(config) = runtime.physics.character_config(body) else {
        return;
    };
    let tolerance = (config.skin_width * 0.4).max(runtime.physics.config().length_unit * 0.0004);
    let stride = config.step_min_width.min(cell).max(config.skin_width * 2.);
    let translation = [
        next.pose.position[0] - state.pose.position[0],
        0.,
        next.pose.position[2] - state.pose.position[2],
    ];
    let segments = (translation[0].hypot(translation[2]) / stride)
        .ceil()
        .max(1.) as u64;
    let cost = segments
        .saturating_mul(
            runtime.physics.collider_count() as u64 * 32 + scene.surfaces.len() as u64 + 8,
        )
        .saturating_add(32);
    if !nav.charge(cost) {
        return;
    }
    if crowd::path_end(
        runtime,
        scene,
        body,
        state.pose,
        translation,
        segments,
        &mut nav.crowd_scratch,
    )
    .is_some_and(|end| {
        end.surface == next.surface
            && (end.pose.position[1] - next.pose.position[1]).abs() <= tolerance
    }) {
        nav.agents[index].route.accept_shortcut();
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn accelerate(
    runtime: &mut UnifiedPhysicsRuntime,
    nav: &mut NativeCombatNavigation,
    scene: &SpatialScene,
    index: usize,
    c: NativeNavigationConfig,
    ax: f32,
    ay: f32,
    maximum: f32,
) {
    let entity = nav.agents[index].entity;
    if ![ax, ay, maximum].iter().all(|v| v.is_finite()) || !(0. ..=1e6).contains(&maximum) {
        nav.agents[index].intent = Velocity::default();
        return;
    }
    let Ok(body) = runtime.spatial_actor_body(entity) else {
        return;
    };
    if let Err(error) = runtime
        .physics
        .set_character_traversal(body, c.step, c.drop)
    {
        runtime.last_error = Some(error.into());
        return;
    }
    let desired =
        velocity_with_acceleration_and_speed_cap(nav.agents[index].intent, ax, ay, maximum);
    nav.cancel(entity);
    nav.agents[index].route.cancel();
    nav.agents[index].target = None;
    let result = crowd::steer(
        runtime,
        nav,
        scene,
        index,
        [desired.vx, 0., -desired.vy],
        c.cell,
        c.avoidance,
        false,
        None,
    );
    if result.admitted {
        nav.agents[index].intent = desired;
    }
    nav.agents[index].velocity_moving = result.velocity[0] != 0. || result.velocity[2] != 0.;
    if let Err(error) = runtime
        .physics
        .set_character_ground_velocity(body, result.velocity)
    {
        runtime.last_error = Some(error.into());
    }
}
