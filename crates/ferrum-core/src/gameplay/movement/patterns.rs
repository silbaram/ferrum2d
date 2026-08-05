use super::*;

pub(crate) fn first_swept_kinematic_hit<I>(
    world: &World,
    mover: Entity,
    targets: I,
    delta: f32,
) -> Option<SweptKinematicHit>
where
    I: IntoIterator<Item = Entity>,
{
    let mover_index = mover.id as usize;
    let start = world.transforms.get(mover_index).copied().flatten()?;
    let velocity = world.velocities.get(mover_index).copied().flatten()?;
    let collider = world.colliders.get(mover_index).copied().flatten()?;
    if !collider.enabled {
        return None;
    }

    let mut best: Option<SweptKinematicHit> = None;
    for target in targets {
        if target == mover {
            continue;
        }
        let target_index = target.id as usize;
        let Some(live_target) = entity_at(world, target_index) else {
            continue;
        };
        if live_target.generation != target.generation {
            continue;
        }
        let (Some(target_transform), Some(target_collider)) = (
            world.transforms.get(target_index).copied().flatten(),
            world.colliders.get(target_index).copied().flatten(),
        ) else {
            continue;
        };
        if !target_collider.enabled {
            continue;
        }
        let Some(contact) = CollisionSystem::swept_aabb_contact(
            start,
            velocity,
            collider,
            target_transform,
            Velocity::default(),
            target_collider,
            delta,
        ) else {
            continue;
        };
        let time = contact.time.clamp(0.0, 1.0);
        if best.as_ref().is_none_or(|hit| time < hit.time) {
            best = Some(SweptKinematicHit {
                entity: target,
                time,
                normal_x: contact.normal_x,
                normal_y: contact.normal_y,
            });
        }
    }
    best
}

pub(crate) fn apply_velocity_reflection(
    world: &mut World,
    target: Entity,
    reflection: VelocityReflection,
) -> bool {
    match reflection {
        VelocityReflection::SurfaceNormal { normal_x, normal_y } => {
            let Some(velocity) = world
                .velocities
                .get_mut(target.id as usize)
                .and_then(Option::as_mut)
            else {
                return false;
            };
            if normal_x.abs() >= normal_y.abs() {
                velocity.vx = -velocity.vx;
            } else {
                velocity.vy = -velocity.vy;
            }
            true
        }
        VelocityReflection::ContactOffsetX { surface, speed } => {
            let target_index = target.id as usize;
            let surface_index = surface.id as usize;
            let (Some(target_transform), Some(surface_transform), Some(surface_collider)) = (
                world.transforms.get(target_index).copied().flatten(),
                world.transforms.get(surface_index).copied().flatten(),
                world.colliders.get(surface_index).copied().flatten(),
            ) else {
                return false;
            };
            let Some(velocity) = world
                .velocities
                .get_mut(target_index)
                .and_then(Option::as_mut)
            else {
                return false;
            };
            let offset = ((target_transform.x - surface_transform.x) / surface_collider.half_width)
                .clamp(-1.0, 1.0);
            velocity.vx = offset * speed;
            velocity.vy = -speed;
            true
        }
    }
}

pub(crate) fn evaluate_movement_pattern(
    world: &World,
    player_transform: Option<Transform2D>,
    transform: Transform2D,
    current_velocity: Option<Velocity>,
    pattern: MovementPattern,
) -> Option<MovementPatternEvaluation> {
    match pattern {
        MovementPattern::Static => Some(MovementPatternEvaluation::Velocity(Velocity::default())),
        MovementPattern::TopdownInput { .. } => None,
        MovementPattern::PlatformerInput { .. } => None,
        MovementPattern::Linear { vx, vy } => {
            Some(MovementPatternEvaluation::Velocity(Velocity { vx, vy }))
        }
        MovementPattern::Oscillate { .. } => None,
        MovementPattern::MoveToPoint { x, y, speed } => Some(MovementPatternEvaluation::Velocity(
            velocity_toward(transform, Transform2D { x, y }, speed),
        )),
        MovementPattern::Chase { target, speed } => {
            let Some(target_transform) =
                movement_target_transform_from(world, player_transform, transform, target)
            else {
                return Some(MovementPatternEvaluation::Velocity(Velocity::default()));
            };
            Some(MovementPatternEvaluation::Chase {
                target,
                target_transform,
                speed,
            })
        }
        MovementPattern::Orbit {
            target,
            speed,
            radius,
            radial_band,
        } => {
            let Some(target_transform) =
                movement_target_transform_from(world, player_transform, transform, target)
            else {
                return Some(MovementPatternEvaluation::Velocity(Velocity::default()));
            };
            Some(MovementPatternEvaluation::Velocity(
                orbit_velocity_with_band(transform, target_transform, speed, radius, radial_band),
            ))
        }
        MovementPattern::SeekTarget {
            target,
            speed,
            turn_rate,
        } => {
            let Some(target_transform) =
                movement_target_transform_from(world, player_transform, transform, target)
            else {
                return Some(MovementPatternEvaluation::Velocity(Velocity::default()));
            };
            Some(MovementPatternEvaluation::SeekTarget {
                target_transform,
                current_velocity: current_velocity.unwrap_or_default(),
                speed,
                turn_rate: clamp_turn_rate(turn_rate),
            })
        }
        MovementPattern::Accelerate {
            acceleration_x,
            acceleration_y,
            max_speed,
        } => Some(MovementPatternEvaluation::Accelerate {
            current_velocity: current_velocity.unwrap_or_default(),
            acceleration_x,
            acceleration_y,
            max_speed,
        }),
    }
}

pub(crate) fn apply_scene_neutral_movement_pattern(
    world: &mut World,
    entity_index: usize,
    player_transform: Option<Transform2D>,
    pattern: MovementPattern,
) -> MovementPatternApplication {
    let Some(transform) = world.transforms.get(entity_index).and_then(|value| *value) else {
        return MovementPatternApplication::Unsupported;
    };
    let current_velocity = world.velocities.get(entity_index).copied().flatten();
    match evaluate_movement_pattern(
        world,
        player_transform,
        transform,
        current_velocity,
        pattern,
    ) {
        Some(MovementPatternEvaluation::Velocity(velocity)) => {
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity);
            MovementPatternApplication::Applied
        }
        Some(MovementPatternEvaluation::Chase {
            target,
            target_transform,
            speed,
        }) => MovementPatternApplication::DeferredChase {
            target,
            target_transform,
            speed,
        },
        Some(MovementPatternEvaluation::SeekTarget {
            target_transform,
            current_velocity,
            speed,
            turn_rate,
        }) => {
            let desired_velocity = velocity_toward(transform, target_transform, speed);
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity_interpolate(
                current_velocity,
                desired_velocity,
                turn_rate,
            ));
            MovementPatternApplication::Applied
        }
        Some(MovementPatternEvaluation::Accelerate {
            current_velocity,
            acceleration_x,
            acceleration_y,
            max_speed,
        }) => {
            let Some(slot) = world.velocities.get_mut(entity_index) else {
                return MovementPatternApplication::Unsupported;
            };
            *slot = Some(velocity_with_acceleration_and_speed_cap(
                current_velocity,
                acceleration_x,
                acceleration_y,
                max_speed,
            ));
            MovementPatternApplication::Applied
        }
        None => MovementPatternApplication::Unsupported,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DefaultMovementPatternKind {
    ChasePlayer,
    MoveToWorldCenter,
    Static,
    OrbitPlayer,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DefaultMovementPatternConfig {
    pub(crate) kind: DefaultMovementPatternKind,
    pub(crate) speed: f32,
    pub(crate) world_width: f32,
    pub(crate) world_height: f32,
    pub(crate) orbit_radius: f32,
    pub(crate) orbit_radial_band: f32,
}

pub(crate) fn default_movement_pattern(config: DefaultMovementPatternConfig) -> MovementPattern {
    match config.kind {
        DefaultMovementPatternKind::ChasePlayer => MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: config.speed,
        },
        DefaultMovementPatternKind::MoveToWorldCenter => MovementPattern::MoveToPoint {
            x: config.world_width * 0.5,
            y: config.world_height * 0.5,
            speed: config.speed,
        },
        DefaultMovementPatternKind::Static => MovementPattern::Static,
        DefaultMovementPatternKind::OrbitPlayer => MovementPattern::Orbit {
            target: MovementTarget::PrimaryActor,
            speed: config.speed,
            radius: config.orbit_radius,
            radial_band: config.orbit_radial_band,
        },
    }
}

pub(crate) fn layer_movement_pattern_phase_config_with_default_fallback(
    config: LayerMovementPatternDefaultFallbackConfig,
) -> LayerMovementPatternPhaseConfig {
    LayerMovementPatternPhaseConfig {
        layer: config.layer,
        player_transform: config.player_transform,
        navigation_policy: config.navigation_policy,
        fallback_pattern: default_movement_pattern(config.fallback),
    }
}
