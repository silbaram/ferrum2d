use crate::components::{CollisionMask, HeightSpan, Transform2D, Velocity};
use crate::entity::Entity;
use crate::tilemap::{Hd2dTileKind, Tilemap, TilemapHd2dSurfaceHit};
use crate::world::World;

use super::math::finite_velocity;
use super::platformer_controller::move_and_slide_internal;
use super::{
    KinematicMoveResult, KinematicMoveSettings, OneWayPlatformConfig, PhysicsCounters,
    PhysicsSystem, KINEMATIC_EPSILON, MAX_KINEMATIC_ITERATIONS,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hd2dKinematicControllerConfig {
    pub solid_mask: CollisionMask,
    pub max_iterations: u32,
    pub max_step_height: f32,
    pub max_drop_height: f32,
    pub allow_ledge_drop: bool,
}

impl Hd2dKinematicControllerConfig {
    pub const fn new(solid_mask: CollisionMask, max_iterations: u32) -> Self {
        Self {
            solid_mask,
            max_iterations,
            max_step_height: 0.0,
            max_drop_height: 0.0,
            allow_ledge_drop: false,
        }
    }

    pub const fn with_step_height(mut self, max_step_height: f32) -> Self {
        self.max_step_height = max_step_height;
        self
    }

    pub const fn with_drop_height(mut self, max_drop_height: f32) -> Self {
        self.max_drop_height = max_drop_height;
        self
    }

    pub const fn with_ledge_drop(mut self, allow_ledge_drop: bool) -> Self {
        self.allow_ledge_drop = allow_ledge_drop;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hd2dKinematicMoveResult {
    pub movement: KinematicMoveResult,
    pub start_surface: Option<TilemapHd2dSurfaceHit>,
    pub end_surface: Option<TilemapHd2dSurfaceHit>,
    pub start_height_span: Option<HeightSpan>,
    pub end_height_span: Option<HeightSpan>,
    pub elevation_delta: f32,
    pub stepped_up: bool,
    pub stepped_down: bool,
    pub changed_floor: bool,
    pub passed_under_bridge: bool,
    pub blocked_by_step: bool,
    pub blocked_by_drop: bool,
}

impl PhysicsSystem {
    pub fn move_hd2d_kinematic_with_tilemap(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        displacement: Velocity,
        config: Hd2dKinematicControllerConfig,
    ) -> Hd2dKinematicMoveResult {
        Self::move_hd2d_kinematic_with_tilemap_and_counters(
            world,
            tilemap,
            entity,
            displacement,
            config,
            None,
        )
    }

    pub(crate) fn move_hd2d_kinematic_with_tilemap_and_counters(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        displacement: Velocity,
        config: Hd2dKinematicControllerConfig,
        counters: Option<&mut PhysicsCounters>,
    ) -> Hd2dKinematicMoveResult {
        let config = sanitize_hd2d_kinematic_config(config);
        let displacement = finite_velocity(displacement);
        let start_transform = world.transform(entity).unwrap_or_default();
        let start_height_span = world.height_span(entity);
        let start_surface = tilemap.hd2d_surface_at(
            hd2d_surface_point(world, entity, start_transform),
            start_height_span,
        );
        let movement_settings = KinematicMoveSettings::new(
            config.solid_mask,
            OneWayPlatformConfig::default(),
            config.max_iterations,
        )
        .with_height_span(start_height_span);
        let movement = move_and_slide_internal(
            world,
            Some(tilemap),
            entity,
            displacement,
            movement_settings,
            counters,
        );
        let moved_transform = world.transform(entity).unwrap_or(movement.end);
        let start_point = hd2d_surface_point(world, entity, start_transform);
        let end_point = hd2d_surface_point(world, entity, moved_transform);
        let transition = resolve_hd2d_surface_transition(
            tilemap,
            start_point,
            end_point,
            start_height_span,
            start_surface,
            config,
        );

        match transition {
            Hd2dSurfaceTransition::Apply(end_surface) => {
                let end_height_span =
                    apply_hd2d_surface_height_span(world, entity, start_height_span, end_surface);
                hd2d_kinematic_result(
                    movement,
                    start_surface,
                    Some(end_surface),
                    start_height_span,
                    end_height_span,
                    false,
                    false,
                    false,
                )
            }
            Hd2dSurfaceTransition::Preserve {
                passed_under_bridge,
            } => {
                let end_height_span = world.height_span(entity);
                hd2d_kinematic_result(
                    movement,
                    start_surface,
                    None,
                    start_height_span,
                    end_height_span,
                    false,
                    false,
                    passed_under_bridge,
                )
            }
            Hd2dSurfaceTransition::BlockedByStep => {
                world.set_transform(entity, start_transform);
                restore_height_span(world, entity, start_height_span);
                hd2d_kinematic_result(
                    blocked_hd2d_movement(movement, start_transform, displacement),
                    start_surface,
                    None,
                    start_height_span,
                    start_height_span,
                    true,
                    false,
                    false,
                )
            }
            Hd2dSurfaceTransition::BlockedByDrop => {
                world.set_transform(entity, start_transform);
                restore_height_span(world, entity, start_height_span);
                hd2d_kinematic_result(
                    blocked_hd2d_movement(movement, start_transform, displacement),
                    start_surface,
                    None,
                    start_height_span,
                    start_height_span,
                    false,
                    true,
                    false,
                )
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Hd2dSurfaceTransition {
    Apply(TilemapHd2dSurfaceHit),
    Preserve { passed_under_bridge: bool },
    BlockedByStep,
    BlockedByDrop,
}

fn sanitize_hd2d_kinematic_config(
    config: Hd2dKinematicControllerConfig,
) -> Hd2dKinematicControllerConfig {
    Hd2dKinematicControllerConfig {
        solid_mask: config.solid_mask,
        max_iterations: config.max_iterations.min(MAX_KINEMATIC_ITERATIONS),
        max_step_height: sanitize_non_negative(config.max_step_height),
        max_drop_height: sanitize_non_negative(config.max_drop_height),
        allow_ledge_drop: config.allow_ledge_drop,
    }
}

fn sanitize_non_negative(value: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

fn hd2d_surface_point(world: &World, entity: Entity, transform: Transform2D) -> Transform2D {
    world
        .collider(entity)
        .map(|collider| collider.center(transform))
        .unwrap_or(transform)
}

fn resolve_hd2d_surface_transition(
    tilemap: &Tilemap,
    start_point: Transform2D,
    end_point: Transform2D,
    start_height_span: Option<HeightSpan>,
    start_surface: Option<TilemapHd2dSurfaceHit>,
    config: Hd2dKinematicControllerConfig,
) -> Hd2dSurfaceTransition {
    let reference = start_height_span
        .map(|span| (span.floor, span.elevation))
        .or_else(|| start_surface.map(|surface| (surface.floor, surface.elevation)));
    let same_floor_surface = tilemap.hd2d_surface_at(end_point, start_height_span);
    if let Some(surface) = same_floor_surface {
        return validate_hd2d_surface_transition(surface, reference, config);
    }

    if hd2d_bridge_pass_through_surface(tilemap, start_point, end_point, reference).is_some() {
        return Hd2dSurfaceTransition::Preserve {
            passed_under_bridge: true,
        };
    }

    let any_surface = tilemap.hd2d_surface_at_any_floor(end_point);
    let Some(surface) = any_surface else {
        return if start_surface.is_none() || config.allow_ledge_drop {
            Hd2dSurfaceTransition::Preserve {
                passed_under_bridge: false,
            }
        } else {
            Hd2dSurfaceTransition::BlockedByDrop
        };
    };

    if reference.is_some_and(|(floor, _)| {
        surface.floor != floor && surface.kind == Hd2dTileKind::Bridge && !surface.blocks_movement
    }) {
        return Hd2dSurfaceTransition::Preserve {
            passed_under_bridge: true,
        };
    }

    if surface.kind != Hd2dTileKind::Ramp
        && surface.kind != Hd2dTileKind::Stair
        && surface.kind != Hd2dTileKind::Bridge
        && reference.is_some_and(|(floor, _)| surface.floor != floor)
    {
        return Hd2dSurfaceTransition::BlockedByStep;
    }

    validate_hd2d_surface_transition(surface, reference, config)
}

fn hd2d_bridge_pass_through_surface(
    tilemap: &Tilemap,
    start_point: Transform2D,
    end_point: Transform2D,
    reference: Option<(crate::components::PhysicsFloorId, f32)>,
) -> Option<TilemapHd2dSurfaceHit> {
    let (reference_floor, _) = reference?;
    for t in [0.0_f32, 0.25, 0.5, 0.75, 1.0] {
        let point = Transform2D {
            x: start_point.x + (end_point.x - start_point.x) * t,
            y: start_point.y + (end_point.y - start_point.y) * t,
        };
        let Some(surface) = tilemap.hd2d_surface_at_any_floor(point) else {
            continue;
        };
        if surface.kind == Hd2dTileKind::Bridge
            && !surface.blocks_movement
            && surface.floor != reference_floor
        {
            return Some(surface);
        }
    }
    None
}

fn validate_hd2d_surface_transition(
    surface: TilemapHd2dSurfaceHit,
    reference: Option<(crate::components::PhysicsFloorId, f32)>,
    config: Hd2dKinematicControllerConfig,
) -> Hd2dSurfaceTransition {
    let Some((_, reference_elevation)) = reference else {
        return Hd2dSurfaceTransition::Apply(surface);
    };
    let delta = surface.elevation - reference_elevation;
    if delta > config.max_step_height + KINEMATIC_EPSILON {
        return Hd2dSurfaceTransition::BlockedByStep;
    }
    if delta < -config.max_drop_height - KINEMATIC_EPSILON {
        return Hd2dSurfaceTransition::BlockedByDrop;
    }
    if surface.kind == Hd2dTileKind::Ledge && delta < -KINEMATIC_EPSILON && !config.allow_ledge_drop
    {
        return Hd2dSurfaceTransition::BlockedByDrop;
    }
    Hd2dSurfaceTransition::Apply(surface)
}

fn apply_hd2d_surface_height_span(
    world: &mut World,
    entity: Entity,
    start_height_span: Option<HeightSpan>,
    end_surface: TilemapHd2dSurfaceHit,
) -> Option<HeightSpan> {
    let body_height = start_height_span
        .map(|span| span.height)
        .unwrap_or(end_surface.height);
    let end_height_span = HeightSpan::new(end_surface.floor, end_surface.elevation, body_height)?;
    if world.set_height_span(entity, end_height_span) {
        Some(end_height_span)
    } else {
        None
    }
}

fn restore_height_span(world: &mut World, entity: Entity, height_span: Option<HeightSpan>) {
    if let Some(span) = height_span {
        world.set_height_span(entity, span);
    } else {
        world.clear_height_span(entity);
    }
}

fn blocked_hd2d_movement(
    movement: KinematicMoveResult,
    start_transform: Transform2D,
    displacement: Velocity,
) -> KinematicMoveResult {
    KinematicMoveResult {
        end: start_transform,
        remaining: displacement,
        blocked_x: movement.blocked_x || displacement.vx.abs() > KINEMATIC_EPSILON,
        blocked_y: movement.blocked_y || displacement.vy.abs() > KINEMATIC_EPSILON,
        ..movement
    }
}

#[allow(clippy::too_many_arguments)]
fn hd2d_kinematic_result(
    movement: KinematicMoveResult,
    start_surface: Option<TilemapHd2dSurfaceHit>,
    end_surface: Option<TilemapHd2dSurfaceHit>,
    start_height_span: Option<HeightSpan>,
    end_height_span: Option<HeightSpan>,
    blocked_by_step: bool,
    blocked_by_drop: bool,
    passed_under_bridge: bool,
) -> Hd2dKinematicMoveResult {
    let start_elevation = start_height_span
        .map(|span| span.elevation)
        .or_else(|| start_surface.map(|surface| surface.elevation))
        .unwrap_or(0.0);
    let end_elevation = end_height_span
        .map(|span| span.elevation)
        .or_else(|| end_surface.map(|surface| surface.elevation))
        .unwrap_or(start_elevation);
    let start_floor = start_height_span
        .map(|span| span.floor)
        .or_else(|| start_surface.map(|surface| surface.floor));
    let end_floor = end_height_span
        .map(|span| span.floor)
        .or_else(|| end_surface.map(|surface| surface.floor));
    let elevation_delta = end_elevation - start_elevation;

    Hd2dKinematicMoveResult {
        movement,
        start_surface,
        end_surface,
        start_height_span,
        end_height_span,
        elevation_delta,
        stepped_up: elevation_delta > KINEMATIC_EPSILON,
        stepped_down: elevation_delta < -KINEMATIC_EPSILON,
        changed_floor: start_floor.zip(end_floor).is_some_and(|(a, b)| a != b),
        passed_under_bridge,
        blocked_by_step,
        blocked_by_drop,
    }
}
