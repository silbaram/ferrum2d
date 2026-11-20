//! Bounded local steering over actual capsule geometry. The snapshot of observed
//! peer velocities is shared by every actor in this tick, independent of order.
use super::*;
use crate::physics3d::CharacterProbeScratch;
#[cfg(test)]
mod tests;

#[derive(Default)]
pub(super) struct Motion {
    pub velocity: [f32; 3],
    pub admitted: bool,
}

/// Parallel to the bounded peer snapshot. A component change invalidates the
/// previous canonical Chase target until its normal scheduling visit refreshes
/// it. A budget-deferred zero native velocity does not cancel nonzero intent.
pub(super) fn cohort_target(agent: &Agent, current: Option<MovementPattern>) -> Option<Entity> {
    (current == agent.pattern
        && matches!(current, Some(MovementPattern::Chase { .. }))
        && (agent.intent.vx != 0. || agent.intent.vy != 0.))
        .then_some(agent.target)
        .flatten()
}

/// Admit the bounded target comparison before touching any snapshot row.
pub(super) fn cohort_mask(
    nav: &mut NativeCombatNavigation,
    target: Entity,
    targets: &[Option<Entity>; 64],
) -> Option<u64> {
    let count = nav.peers.len();
    if count > targets.len() || !nav.charge(count as u64 + 8) {
        return None;
    }
    let mut mask = 0;
    for (row, peer_target) in targets[..count].iter().enumerate() {
        if *peer_target == Some(target) {
            mask |= 1u64 << row;
        }
    }
    Some(mask)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn steer(
    runtime: &mut UnifiedPhysicsRuntime,
    nav: &mut NativeCombatNavigation,
    scene: &SpatialScene,
    index: usize,
    desired: [f32; 3],
    cell: f32,
    padding: Option<f32>,
    detours: bool,
    stop: Option<([f32; 3], f32)>,
) -> Motion {
    steer_with_cohort(
        runtime, nav, scene, index, desired, cell, padding, detours, stop, 0,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn steer_with_cohort(
    runtime: &mut UnifiedPhysicsRuntime,
    nav: &mut NativeCombatNavigation,
    scene: &SpatialScene,
    index: usize,
    desired: [f32; 3],
    cell: f32,
    padding: Option<f32>,
    detours: bool,
    stop: Option<([f32; 3], f32)>,
    cohort: u64,
) -> Motion {
    let dt = runtime.physics.config().step_seconds;
    let entity = nav.agents[index].entity;
    let Ok(body) = runtime.spatial_actor_body(entity) else {
        return Motion::default();
    };
    let Ok(state) = runtime.physics.body_state(body) else {
        return Motion::default();
    };
    let Ok(character) = runtime.physics.character_state(body) else {
        return Motion::default();
    };
    let grounded = character.grounded;
    let vertical = if grounded {
        0.
    } else {
        character.vertical_speed
    };
    let Ok(config) = runtime.physics.character_config(body).cloned() else {
        return Motion::default();
    };
    let Ok(radius) = runtime.physics.character_crowd_radius(body) else {
        return Motion::default();
    };
    let speed = desired[0].hypot(desired[2]);
    if !speed.is_finite() || speed > 1e6 {
        return Motion::default();
    }
    if speed == 0. {
        return Motion {
            velocity: desired,
            admitted: nav.charge(1),
        };
    }
    let travel = speed * dt;
    let from = state.pose;
    let goal = nav.agents[index].goal;
    let remaining = if nav.agents[index].target.is_some() {
        (goal[0] - from.position[0]).hypot(goal[2] - from.position[2])
    } else {
        f32::INFINITY
    };
    let horizon = (radius * 4. + padding.unwrap_or(0.))
        .min(remaining)
        .max(travel);
    let seconds = (horizon / speed).min(0.5).max(dt);
    let (x, z) = (desired[0], desired[2]);
    let diagonal = std::f32::consts::FRAC_1_SQRT_2;
    let active = (padding.is_some() || detours)
        .then_some(
            nav.agents[index]
                .detour
                .filter(|(_, distance)| *distance > 0.),
        )
        .flatten();
    let mut candidates = [
        [x, 0., z],
        [(x - z) * diagonal, 0., (x + z) * diagonal],
        [-z, 0., x],
        [(-x - z) * diagonal, 0., (x - z) * diagonal],
        [(x + z) * diagonal, 0., (z - x) * diagonal],
        [z, 0., -x],
        [(z - x) * diagonal, 0., (-x - z) * diagonal],
        [-x, 0., -z],
    ];
    if let Some((heading, _)) = active {
        candidates.rotate_right(1);
        candidates[0] = [heading[0] * speed, 0., heading[1] * speed];
        // Chase retries its certified route before continuing local avoidance.
        // Seek keeps its independent steering heading first.
        if !detours {
            candidates.swap(0, 1);
        }
    }
    let straight = usize::from(active.is_some() && detours);
    let active_index = usize::from(!detours);
    // Keep pre-sort identity with each of the same eight candidates. This is
    // stack-only; equal projected velocities retain their original index order.
    let mut ordered: [(usize, [f32; 3]); 8] = std::array::from_fn(|index| {
        let velocity = candidates[index];
        let norm = f64::from(velocity[0]).hypot(f64::from(velocity[2]));
        let scale = if norm > 0. {
            (f64::from(speed) / norm).min(1.)
        } else {
            1.
        };
        (
            index,
            [
                (f64::from(velocity[0]) * scale).clamp(-1e6, 1e6) as f32,
                0.,
                (f64::from(velocity[2]) * scale).clamp(-1e6, 1e6) as f32,
            ],
        )
    });
    if !detours {
        ordered.sort_unstable_by(|(left_index, left), (right_index, right)| {
            let left_projection =
                f64::from(left[0]) * f64::from(x) + f64::from(left[2]) * f64::from(z);
            let right_projection =
                f64::from(right[0]) * f64::from(x) + f64::from(right[2]) * f64::from(z);
            let projection_order = if left_projection == right_projection {
                std::cmp::Ordering::Equal
            } else {
                right_projection.total_cmp(&left_projection)
            };
            projection_order.then_with(|| left_index.cmp(right_index))
        });
    }
    let stride = config.step_min_width.min(cell).max(config.skin_width * 2.);
    let segments = if grounded {
        (travel / stride).ceil().max(1.) as u64
    } else {
        0
    };
    let terrain_cost = segments.saturating_mul(
        runtime.physics.collider_count() as u64 * 32 + scene.surfaces.len() as u64 + 8,
    );
    let peer_cost = if padding.is_some() {
        // The fixed overhead covers at most 64 mask-bit branches as well as
        // candidate bookkeeping. Geometry remains at most two queries/row.
        nav.peers.len() as u64 * 32 + 128
    } else {
        128
    };
    let mut admitted = false;
    let limit = if padding.is_some() || detours { 8 } else { 1 };
    for (candidate_index, velocity) in ordered.into_iter().take(limit) {
        // Admit both peer forecasts before querying. A peer rejection does not
        // execute terrain probes and must not consume their collider-wide cost.
        if !nav.charge(peer_cost) {
            break;
        }
        let velocity = stop.map_or(velocity, |(goal, radius)| {
            clip_stop(from, velocity, dt, goal, radius, config.skin_width * 0.1)
        });
        let mut allowed = true;
        let mut peer_work = 0u64;
        let mut peer_cost_known = true;
        if let Some(padding) = padding {
            for (forecast, seconds) in [dt, seconds].into_iter().enumerate() {
                let translation = [
                    velocity[0] * seconds,
                    vertical * seconds,
                    velocity[2] * seconds,
                ];
                let check = if forecast == 0 || cohort == 0 {
                    runtime.physics.character_crowd_clear(
                        body,
                        from,
                        translation,
                        seconds,
                        padding,
                        &nav.peers,
                    )
                } else {
                    runtime.physics.character_crowd_clear_masked(
                        body,
                        from,
                        translation,
                        seconds,
                        padding,
                        &nav.peers,
                        cohort,
                    )
                };
                match check {
                    Ok(check) => {
                        peer_work += u64::from(check.tests) * 16;
                        nav.crowd_stats[2] = nav.crowd_stats[2].saturating_add(check.tests);
                        nav.crowd_stats[3] = nav.crowd_stats[3].saturating_add(check.tests);
                        allowed &= check.clear;
                    }
                    Err(_) => {
                        allowed = false;
                        peer_cost_known = false;
                    }
                }
                if !allowed {
                    break;
                }
            }
        }
        // These synchronous queries borrow PhysicsWorld and the peer slice,
        // never Nav or callbacks. Only their reported visits are spent; retain
        // the full reservation when a failed query cannot report its work.
        // The fixed candidate overhead is never returned.
        if peer_cost_known {
            nav.used -= (peer_cost - 128).saturating_sub(peer_work);
        }
        if !allowed {
            admitted = true;
            continue;
        }
        // Peer clearance alone is not a completed candidate: an unadmitted
        // terrain phase must leave canonical intent at its prior value.
        if grounded && !nav.charge(terrain_cost) {
            break;
        }
        admitted = true;
        let translation = [velocity[0] * dt, 0., velocity[2] * dt];
        if grounded
            && path_end(
                runtime,
                scene,
                body,
                from,
                translation,
                segments,
                &mut nav.crowd_scratch,
            )
            .is_none()
        {
            continue;
        }
        if candidate_index != straight {
            if padding.is_some() {
                nav.crowd_stats[4] = nav.crowd_stats[4].saturating_add(1);
            }
            let accepted_speed = velocity[0].hypot(velocity[2]);
            nav.agents[index].detour =
                if let Some((heading, left)) = active.filter(|_| candidate_index == active_index) {
                    (left > travel).then_some((heading, left - travel))
                } else {
                    Some((
                        [
                            velocity[0] / accepted_speed.max(f32::MIN_POSITIVE),
                            velocity[2] / accepted_speed.max(f32::MIN_POSITIVE),
                        ],
                        radius * 2. + padding.unwrap_or(0.),
                    ))
                };
        } else {
            nav.agents[index].detour = None;
        }
        return Motion { velocity, admitted };
    }
    nav.agents[index].detour = None;
    if padding.is_some() {
        nav.crowd_stats[1] = nav.crowd_stats[1].saturating_add(1);
    }
    Motion {
        velocity: [0.; 3],
        admitted,
    }
}

/// Clip before probing so a fast curved step cannot enter and leave the stop
/// circle between observations. Momentum remains the unmodified pattern intent.
fn clip_stop(
    from: Pose,
    velocity: [f32; 3],
    dt: f32,
    goal: [f32; 3],
    radius: f32,
    inset: f32,
) -> [f32; 3] {
    let x = f64::from(from.position[0]) - f64::from(goal[0]);
    let z = f64::from(from.position[2]) - f64::from(goal[2]);
    let dx = f64::from(velocity[0]) * f64::from(dt);
    let dz = f64::from(velocity[2]) * f64::from(dt);
    // The controller's swept slope response may shorten the command slightly.
    // A bounded skin inset avoids repeatedly stopping just outside the radius.
    let r = f64::from(radius) - f64::from(inset.min(radius * 0.5));
    let a = dx * dx + dz * dz;
    let b = x * dx + z * dz;
    let c = x * x + z * z - r * r;
    if c <= 0. {
        return [0.; 3];
    }
    if a == 0. {
        return velocity;
    }
    let discriminant = b * b - a * c;
    if discriminant < 0. {
        return velocity;
    }
    let entry = (-b - discriminant.sqrt()) / a;
    if !(0. ..=1.).contains(&entry) {
        return velocity;
    }
    [
        (f64::from(velocity[0]) * entry) as f32,
        0.,
        (f64::from(velocity[2]) * entry) as f32,
    ]
}

pub(super) fn path_end(
    runtime: &mut UnifiedPhysicsRuntime,
    scene: &SpatialScene,
    body: BodyId,
    start: Pose,
    translation: [f32; 3],
    segments: u64,
    scratch: &mut CharacterProbeScratch,
) -> Option<Point> {
    let tolerance = (runtime.physics.character_config(body).ok()?.skin_width * 0.5)
        .max(runtime.physics.config().length_unit * 0.0001);
    let mut pose = start;
    let mut result = None;
    for segment in 1..=segments {
        let part = segment as f32 / segments as f32;
        let x = start.position[0] + translation[0] * part;
        let z = start.position[2] + translation[2] * part;
        let movement = [x - pose.position[0], 0., z - pose.position[2]];
        let probe = runtime
            .physics
            .probe_character_motion(body, pose, movement, true, scratch)
            .ok()?;
        if !probe.grounded
            || probe.sliding
            || probe.dropped_contacts != 0
            || (probe.pose.position[0] - x).hypot(probe.pose.position[2] - z) > tolerance
        {
            return None;
        }
        let UnifiedTerrainSource::SpatialSurface { id } =
            runtime.terrain.source(probe.ground?.collider)?
        else {
            return None;
        };
        let surface = scene.surfaces.iter().find(|s| s.walkable && s.id == id)?;
        let [left, top, width, depth] = surface.bounds;
        let slope =
            (surface.heights[1] - surface.heights[0]) / if surface.ramp_x { width } else { depth };
        let scale = slope.hypot(1.);
        let normal = if surface.ramp_x {
            [-slope / scale, 1. / scale, 0.]
        } else {
            [0., 1. / scale, slope / scale]
        };
        let (center, point) = runtime
            .physics
            .character_plane_support(body, probe.pose, normal)
            .ok()?;
        if center[0] < left
            || center[0] >= left + width
            || -center[2] < top
            || -center[2] >= top + depth
        {
            return None;
        }
        let offset = if surface.ramp_x {
            point[0] - left
        } else {
            -point[2] - top
        };
        let height = surface.heights[0] + offset * slope;
        let skin = runtime.physics.character_config(body).ok()?.skin_width;
        if ((point[1] - height) / scale - skin).abs() > tolerance * 4. {
            return None;
        }
        pose = probe.pose;
        result = Some(Point { pose, surface: id });
    }
    result
}

#[cfg(test)]
fn terrain_clear(
    runtime: &mut UnifiedPhysicsRuntime,
    scene: &SpatialScene,
    body: BodyId,
    start: Pose,
    translation: [f32; 3],
    segments: u64,
    scratch: &mut CharacterProbeScratch,
) -> bool {
    path_end(runtime, scene, body, start, translation, segments, scratch).is_some()
}
