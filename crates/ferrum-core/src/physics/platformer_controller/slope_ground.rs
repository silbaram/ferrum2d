use crate::components::Velocity;
use crate::entity::Entity;
use crate::tilemap::{Tilemap, TilemapSlopeGroundHit};
use crate::world::World;

use super::config::is_slope_config_enabled;
use super::kinematic_sweep::KinematicSweepScratch;
use super::move_and_slide_internal;
use crate::physics::{
    GroundProbeHit, KinematicMoveResult, KinematicMoveSettings, PhysicsCounters, SlopeConfig,
    SlopeSegment, SlopeSurfaceHit, KINEMATIC_EPSILON,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct SlopeGroundHit {
    pub(super) surface: SlopeSurfaceHit,
    pub(super) vertical_delta: f32,
    pub(super) distance: f32,
    pub(super) tile_layer_index: Option<usize>,
    pub(super) tile_index: Option<usize>,
}

impl SlopeGroundHit {
    fn from_tilemap_hit(hit: TilemapSlopeGroundHit) -> Self {
        Self {
            surface: hit.surface,
            vertical_delta: hit.vertical_delta,
            distance: hit.distance,
            tile_layer_index: Some(hit.layer_index),
            tile_index: Some(hit.tile_index),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct SlopeSnapDirection {
    pub(super) allow_upward: bool,
    pub(super) allow_downward: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct SlopeSnapSettings<'a> {
    pub(super) slopes: &'a [SlopeSegment],
    pub(super) slope: SlopeConfig,
    pub(super) direction: SlopeSnapDirection,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct SlopeSnapMoveSettings<'a> {
    pub(super) movement: KinematicMoveSettings,
    pub(super) slope_snap: SlopeSnapSettings<'a>,
}

pub(super) fn move_with_optional_slope_snap(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    movement: KinematicMoveResult,
    settings: SlopeSnapMoveSettings<'_>,
    scratch: &mut KinematicSweepScratch,
    counters: Option<&mut PhysicsCounters>,
) -> KinematicMoveResult {
    let Some(hit) = slope_ground_hit(
        world,
        tilemap,
        entity,
        settings.slope_snap.slopes,
        settings.slope_snap.slope,
        settings.slope_snap.direction.allow_upward,
        settings.slope_snap.direction.allow_downward,
    ) else {
        return movement;
    };
    if hit.vertical_delta.abs() <= KINEMATIC_EPSILON {
        return movement;
    }

    let snap_start = world.transform(entity).unwrap_or(movement.end);
    let snap_movement = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: 0.0,
            vy: hit.vertical_delta,
        },
        settings.movement,
        scratch,
        counters,
    );
    if hit.vertical_delta < -KINEMATIC_EPSILON && snap_movement.blocked_y {
        world.set_transform(entity, snap_start);
        return movement;
    }

    KinematicMoveResult {
        start: movement.start,
        end: world.transform(entity).unwrap_or(snap_movement.end),
        requested: movement.requested,
        remaining: snap_movement.remaining,
        hit_count: movement.hit_count.saturating_add(snap_movement.hit_count),
        blocked_x: movement.blocked_x,
        blocked_y: movement.blocked_y || snap_movement.blocked_y,
        last_hit: snap_movement.last_hit.or(movement.last_hit),
    }
}

pub(super) fn slope_ground_hit(
    world: &World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    slopes: &[SlopeSegment],
    slope: SlopeConfig,
    allow_upward: bool,
    allow_downward: bool,
) -> Option<SlopeGroundHit> {
    if !is_slope_config_enabled(slope) || (slopes.is_empty() && tilemap.is_none()) {
        return None;
    }

    let transform = world.transform(entity)?;
    let collider = world.collider(entity)?;
    if !collider.enabled {
        return None;
    }
    let center = collider.center(transform);
    let bottom_y = center.y + collider.half_height;
    let mut best = None;

    for segment in slopes {
        let Some(surface) = segment.surface_at_x(center.x) else {
            continue;
        };
        if surface.angle_radians > slope.max_climb_angle_radians {
            continue;
        }

        let vertical_delta = surface.y - bottom_y;
        if vertical_delta < -KINEMATIC_EPSILON && !allow_upward {
            continue;
        }
        if vertical_delta > KINEMATIC_EPSILON && !allow_downward {
            continue;
        }

        let distance = vertical_delta.abs();
        if distance > slope.snap_distance + KINEMATIC_EPSILON {
            continue;
        }

        let hit = SlopeGroundHit {
            surface,
            vertical_delta,
            distance,
            tile_layer_index: None,
            tile_index: None,
        };
        update_slope_ground_hit(&mut best, hit);
    }

    if let Some(tilemap) = tilemap {
        if let Some(hit) =
            tilemap.slope_ground_hit(center.x, bottom_y, slope, allow_upward, allow_downward)
        {
            update_slope_ground_hit(&mut best, SlopeGroundHit::from_tilemap_hit(hit));
        }
    }

    best
}

pub(super) fn merge_slope_ground_hit(
    ground: Option<GroundProbeHit>,
    slope: Option<SlopeGroundHit>,
) -> Option<GroundProbeHit> {
    let Some(slope) = slope else {
        return ground;
    };
    let slope_hit = GroundProbeHit {
        entity: None,
        tile_layer_index: slope.tile_layer_index,
        tile_index: slope.tile_index,
        distance: slope.distance,
        normal_x: slope.surface.normal_x,
        normal_y: slope.surface.normal_y,
    };
    if ground.is_none_or(|current| slope_hit.distance < current.distance) {
        Some(slope_hit)
    } else {
        ground
    }
}

fn update_slope_ground_hit(best: &mut Option<SlopeGroundHit>, next: SlopeGroundHit) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| slope_ground_source_key(next).cmp(&slope_ground_source_key(current)))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn slope_ground_source_key(hit: SlopeGroundHit) -> (u8, usize, usize) {
    if let (Some(layer_index), Some(tile_index)) = (hit.tile_layer_index, hit.tile_index) {
        (1, layer_index, tile_index)
    } else {
        (0, usize::MAX, usize::MAX)
    }
}
